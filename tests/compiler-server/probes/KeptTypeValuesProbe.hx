import haxe.DynamicAccess;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
import haxe.macro.TypedExprTools;

using haxe.macro.TypeTools;

/** One typed value that a pass would keep, with the name of its place. */
private typedef KeptSlot = {
  final name: String;
  final value: Type;
}

/** One typed field body that a pass would keep. */
private typedef KeptBody = {
  final name: String;
  final value: TypedExpr;
}

/** One local variable of a field body: its Haxe id, its type, its field. */
private typedef KeptLocal = {
  final id: Int;
  final name: String;
  final type: Type;
  final owner: String;
}

/** Everything that the probe reads from one declaration at one moment. */
private typedef Reading = {
  final slots: Array<KeptSlot>;
  final bodies: Array<KeptBody>;
  final locals: Array<KeptLocal>;
}

/** What the kept values of one declaration print at one stage of a request. */
private typedef StagePrints = {
  final slots: Map<String, String>;
  final bodies: Map<String, String>;
  final localTypes: Map<Int, String>;
  final freshLocalIds: Map<String, String>;
  final freshLocals: Map<String, String>;
}

/**
 * The values that the probe keeps for one declaration, from the request in
 * which Haxe typed it until Haxe types it again.
 */
private typedef Bucket = {
  final key: String;
  final module: String;
  final stamp: String;
  final members: Null<String>;
  final capturedIn: Int;
  final declaration: ModuleType;
  final reading: Reading;
  final recorded: Map<String, StagePrints>;
}

/** One declaration of the current request. */
private typedef ProgramEntry = {
  final key: String;
  final module: String;
  final declaration: ModuleType;
  final state: String;
}

/**
 * Tests whether typed values that a macro keeps from an earlier request are
 * still correct in a later request of the same Haxe compilation server.
 *
 * Why: three Genes passes run after typing on every request and read every
 * declaration, also the ones that Haxe did not type again. To do that work
 * only for the modules that Haxe typed again, the passes must keep `Type`
 * values, typed bodies and local variable ids from one request to the next.
 * That is safe only when this holds (assumption H2 of the incremental
 * design): a value that was read from a declaration stays correct while Haxe
 * does not type that declaration again. The probe tests H2, and it tests the
 * rule that decides "typed again". It uses no Genes code, so it also runs in
 * a request without Genes.
 *
 * What it keeps: one bucket for each declaration. A bucket holds the same
 * kinds of values as `genes.ts.SignatureCache` and `genes.PublicSurface`:
 * the type of each field, parameter, constructor and typedef body, each typed
 * field body, and the id and type of each local variable. The bucket also
 * holds the declaration itself, as the macro value that Haxe gave.
 *
 * How it decides "typed again": like `RetypedModulesProbe`, with private
 * metadata, but with a value in it. A declaration without the mark is a new
 * object, so Haxe typed it again; the probe marks it with a stamp that names
 * this macro interpreter, this request and the declaration, and makes a new
 * bucket with that stamp. A declaration with a mark is "kept" only when all
 * of this holds:
 * - The stamp names this declaration. A macro can define a type with the
 *   metadata of another class; that type carries the stamp of that class
 *   (state `foreignStamp`).
 * - The stamp equals the stamp of the bucket. A mark alone is not enough.
 *   When an init macro sets a define, Haxe reads most modules from another
 *   cache but the macro state stays. The next request without that define
 *   gets the marked declarations of the first cache, and the buckets made in
 *   between are for other objects (state `stampMismatch`).
 * - For a class, the member list equals the one of the bucket. The first use
 *   of a `@:generic` method from another module adds a static field to the
 *   class that owns the method, and Haxe does not type that class again
 *   (state `membersChanged`).
 * - The bucket addresses the declaration that Haxe gives now (the
 *   same-object test below). The first three tests need only text; this one
 *   needs the kept declaration value.
 * The report also says what the rule before these additions answers: "the
 * stamp value equals the stamp value of the bucket" (`stampOnlyKept`).
 *
 * What it checks, in three stages of each request (after typing; in
 * `onGenerate`, after Haxe changed the bodies; after generation, after
 * dead-code elimination):
 * - A kept bucket must still address the declaration that Haxe gives now.
 *   The probe writes one metadata entry through the old value and reads it
 *   through the new one.
 * - Each kept value must print the same text as in the same stage of the
 *   request that made the bucket.
 * - Each kept type must print the same text as the type that a new read of
 *   the same place gives now.
 * - The local variable ids that a new read of each body gives must be the
 *   ids of the request that made the bucket, and no id may belong to two
 *   declarations.
 * For a declaration that Haxe typed again, the probe reports the opposite
 * evidence: the old bucket no longer addresses the declaration, which old
 * prints are now wrong, and how many old local ids the new bodies use.
 *
 * The probe writes one JSON report for each request to `reportPath`, again
 * after each stage, so that a request that fails still leaves the stages it
 * reached. `detailPrefix` selects the declarations that the report lists one
 * by one. `definesDigest` names the `-D` values of the request, so that the
 * test can show a kept bucket in a request with other values. `failAt` names
 * a stage after which the probe raises a compiler error; that is how the test
 * makes a request fail between typing and generation, or after generation.
 *
 * Limit: the probe proves these facts for this fixture on the Haxe version
 * that runs it. It keeps a bucket in the after-typing callback of a request
 * that can still fail. That is deliberate: the stamp comparison, not a
 * commit step, must reject such a bucket in the next request.
 */
class KeptTypeValuesProbe {
  static inline final STAMP = ':genes.test.keptStamp';
  static inline final IDENTITY = ':genes.test.keptIdentity';
  static inline final UNBOUND = '(open monomorph)';
  static inline final MAX_EXAMPLES = 6;
  static inline final MAX_TEXT = 400;

  @:persistent static var nonce: Null<String> = null;
  @:persistent static var requests = 0;
  @:persistent static var buckets: Map<String, Bucket> = new Map();
  @:persistent static var highestLocalId = 0;
  @:persistent static var identityTokens = 0;

  static var identitySeconds = 0.0;
  static var identityTests = 0;

  static var installed = false;
  static var started = false;
  static var reportPath = '';
  static var detailPrefix = '';
  static var failAt: Null<String> = null;
  static var program: Array<ProgramEntry> = [];
  static var seen: Map<String, Bool> = new Map();
  static var report: DynamicAccess<Dynamic> = {};
  static var details: DynamicAccess<Dynamic> = {};

  public static function install(reportPath: String, detailPrefix: String,
      ?failAt: String): Void {
    if (installed)
      return;
    installed = true;
    KeptTypeValuesProbe.reportPath = reportPath;
    KeptTypeValuesProbe.detailPrefix = detailPrefix;
    KeptTypeValuesProbe.failAt = failAt;
    Context.onAfterTyping(afterTyping);
    Context.onGenerate(_ -> stage('generate'));
    Context.onAfterGenerate(() -> stage('afterGenerate'));
  }

  static function baseOf(declaration: ModuleType): BaseType {
    return switch declaration {
      case TClassDecl(reference): reference.get();
      case TEnumDecl(reference): reference.get();
      case TTypeDecl(reference): reference.get();
      case TAbstract(reference): reference.get();
    }
  }

  static function keyOf(declaration: ModuleType, base: BaseType): String {
    final kind = switch declaration {
      case TClassDecl(_): 'class';
      case TEnumDecl(_): 'enum';
      case TTypeDecl(_): 'typedef';
      case TAbstract(_): 'abstract';
    }
    return kind + ' ' + base.module + '#' + base.name;
  }

  /**
   * Returns the stamp of a declaration: its value and the key of the
   * declaration that it was made for. `null` when there is no stamp.
   */
  static function stampOf(meta: MetaAccess): Null<{value: String, key: String}> {
    for (entry in meta.extract(STAMP))
      switch entry.params {
        case [{expr: EConst(CString(value))}, {expr: EConst(CString(key))}]:
          return {value: value, key: key};
        default:
      }
    return null;
  }

  /**
   * Returns the member list of a class as one text: the names of its static
   * and instance fields and whether it has a constructor. `null` for a
   * declaration that is not a class.
   */
  static function membersOf(declaration: ModuleType): Null<String> {
    return switch declaration {
      case TClassDecl(reference):
        final type = reference.get();
        'static ' + [for (field in type.statics.get()) field.name].join(',') +
          ' | instance ' +
          [for (field in type.fields.get()) field.name].join(',') +
          ' | constructor ' + (type.constructor == null ? 'no' : 'yes');
      default:
        null;
    }
  }

  /**
   * Makes Haxe use the `Retype` module check policy for a package in this
   * request. With it, Haxe types a module again in place when a module that
   * it reads changed: the declaration object and its metadata stay.
   */
  public static function retype(pack: String): Void {
    haxe.macro.CompilationServer.setModuleCheckPolicy([pack], [Retype]);
  }

  static function text(value: String): Expr {
    return {expr: EConst(CString(value)), pos: Context.currentPos()};
  }

  /**
   * Returns true when the kept declaration value and the declaration that
   * Haxe gives now are one compiler object.
   *
   * Each `get()` of a reference copies the current record, so the two macro
   * values are never the same macro object. The test writes one metadata
   * entry through the old reference and looks for it through the new one,
   * then removes it. Every step reads a new copy first, because a write
   * through an old copy would replace newer metadata with that copy.
   */
  static function addresses(kept: ModuleType, current: ModuleType): Bool {
    final started = haxe.Timer.stamp();
    final same = writesThrough(kept, current);
    identitySeconds += haxe.Timer.stamp() - started;
    identityTests++;
    return same;
  }

  static function writesThrough(kept: ModuleType, current: ModuleType): Bool {
    final token = '$nonce/$requests/${identityTokens++}';
    baseOf(kept).meta.add(IDENTITY, [text(token)], Context.currentPos());
    var found = false;
    for (entry in baseOf(current).meta.extract(IDENTITY))
      switch entry.params {
        case [{expr: EConst(CString(value))}] if (value == token):
          found = true;
        default:
      }
    baseOf(kept).meta.remove(IDENTITY);
    return found;
  }

  static function printParameters(parameters: Array<Type>, depth: Int): String {
    return parameters.length == 0 ? '' : '<' + [
      for (parameter in parameters)
        printType(parameter, depth + 1)
    ].join(', ') + '>';
  }

  /** Prints the shape of a type through the macro values and their references. */
  static function printType(type: Type, depth = 0): String {
    if (depth > 8)
      return '...';
    return switch type {
      case TMono(reference):
        // Haxe can give a type to an open monomorph later in the request.
        // The kept value then reads that type, like a new read does.
        final bound = reference.get();
        bound == null ? UNBOUND : printType(bound, depth);
      case TEnum(reference, parameters):
        'enum ' + reference.toString() + printParameters(parameters, depth);
      case TInst(reference, parameters):
        'class ' + reference.toString() + printParameters(parameters, depth);
      case TType(reference, parameters):
        'typedef ' + reference.toString() + printParameters(parameters, depth);
      case TAbstract(reference, parameters):
        'abstract ' + reference.toString() + printParameters(parameters, depth);
      case TFun(arguments, result):
        '(' + [
          for (argument in arguments)
            (argument.opt ? '?' : '') + argument.name + ': ' +
            printType(argument.t, depth
              + 1)
        ].join(', ') + ') -> ' + printType(result, depth + 1);
      case TAnonymous(reference):
        final fields = reference.get().fields.copy();
        fields.sort((left, right) -> Reflect.compare(left.name, right.name));
        '{' + [
          for (field in fields)
            field.name + ': ' + printType(field.type, depth + 1)
        ].join(', ') + '}';
      case TDynamic(inner):
        inner == null ? 'Dynamic' : 'Dynamic<' + printType(inner,
          depth + 1) + '>';
      case TLazy(resolve):
        printType(resolve(), depth);
    }
  }

  /**
   * Reads the declaration that a type names, one level deep.
   *
   * The emitters do this with a kept type: they follow a typedef, and they
   * read the values of an enum abstract from its implementation class. Field
   * lists of an ordinary class are not printed, because dead-code elimination
   * changes them for a reason that is not the kept value.
   */
  static function printHead(type: Type): String {
    return switch type {
      case TType(reference, _):
        ' | body: ' + printType(reference.get().type);
      case TAbstract(reference, _):
        final declaration = reference.get();
        final implementation = declaration.impl;
        if (!declaration.meta.has(':enum') || implementation == null)
          ' | over: '
          + printType(declaration.type); else ' | values: ' + [
          for (field in implementation.get().statics.get())
            if (field.meta.has(':enum')) {
              final value = field.expr();
              field.name + '=' +
              (value == null ? 'null' : TypedExprTools.toString(value, true));
            }
        ].join(', ');
      case TInst(reference, _):
        ' | in: ' + reference.get().module;
      case TEnum(reference, _):
        ' | constructors: ' + reference.get().names.join(', ');
      case TLazy(resolve):
        printHead(resolve());
      default:
        '';
    }
  }

  /**
   * Prints one kept type three ways: through the macro values, through
   * Haxe's own printer (which turns the macro value back into a compiler
   * type), and after `Context.follow`. An exception is part of the text: a
   * kept value that cannot be used is a wrong value.
   */
  static function describe(type: Type): String {
    return try {
      printType(type) + printHead(type) + ' | haxe: ' + type.toString() +
      ' | followed: ' + Context.follow(type)
        .toString();
    } catch (error:haxe.Exception) {
      'ERROR ' + error.message;
    }
  }

  static function describeBody(body: TypedExpr): String {
    return try {
      TypedExprTools.toString(body, true);
    } catch (error:haxe.Exception) {
      'ERROR ' + error.message;
    }
  }

  static function collectLocals(owner: String, expression: TypedExpr,
      into: Array<KeptLocal>): Void {
    function add(variable: TVar): Void {
      into.push({
        id: variable.id,
        name: variable.name,
        type: variable.t,
        owner: owner
      });
    }
    function visit(current: TypedExpr): Void {
      switch current.expr {
        case TVar(variable, _):
          add(variable);
        case TFunction(definition):
          for (argument in definition.args)
            add(argument.v);
        case TTry(_, catches):
          for (entry in catches)
            add(entry.v);
        default:
      }
      TypedExprTools.iter(current, visit);
    }
    visit(expression);
  }

  /**
   * Counts the parts of a new bucket's types that Haxe has not decided when
   * the bucket is made: lazy types and open monomorphs. A lazy type holds a
   * function of the request that made it, so a kept one would be a risk.
   */
  static function countUndecided(type: Type, depth = 0): Void {
    if (depth > 8)
      return;
    switch type {
      case TMono(reference):
        final bound = reference.get();
        if (bound == null)
          count('capturedOpenMonomorphs');
        else
          countUndecided(bound, depth + 1);
      case TEnum(_, parameters) | TInst(_, parameters) |
        TType(_, parameters) | TAbstract(_, parameters):
        for (parameter in parameters)
          countUndecided(parameter, depth + 1);
      case TFun(arguments, result):
        for (argument in arguments)
          countUndecided(argument.t, depth + 1);
        countUndecided(result, depth + 1);
      case TAnonymous(reference):
        for (field in reference.get().fields)
          countUndecided(field.type, depth + 1);
      case TDynamic(inner):
        if (inner != null)
          countUndecided(inner, depth + 1);
      case TLazy(_):
        count('capturedLazyTypes');
    }
  }

  /** Reads every value of one declaration that an after-typing pass keeps. */
  static function read(declaration: ModuleType): Reading {
    final slots: Array<KeptSlot> = [];
    final bodies: Array<KeptBody> = [];
    final locals: Array<KeptLocal> = [];
    function parameters(prefix: String, list: Array<TypeParameter>): Void {
      for (parameter in list)
        slots.push({
          name: prefix + 'parameter ' + parameter.name,
          value: parameter.t
        });
    }
    switch declaration {
      case TClassDecl(reference):
        final type = reference.get();
        parameters('', type.params);
        final parent = type.superClass;
        if (parent != null)
          slots.push({name: 'extends', value: TInst(parent.t, parent.params)});
        for (index => contract in type.interfaces)
          slots.push({
            name: 'implements ' + index,
            value: TInst(contract.t, contract.params)
          });
        function field(prefix: String, member: ClassField): Void {
          final name = prefix + member.name;
          slots.push({name: name, value: member.type});
          parameters(name + ' ', member.params);
          final body = member.expr();
          if (body != null) {
            bodies.push({name: name, value: body});
            collectLocals(name, body, locals);
          }
        }
        final constructor = type.constructor;
        if (constructor != null)
          field('', constructor.get());
        for (member in type.fields.get())
          field('instance ', member);
        for (member in type.statics.get())
          field('static ', member);
        final init = type.init;
        if (init != null) {
          bodies.push({name: 'init', value: init});
          collectLocals('init', init, locals);
        }
      case TEnumDecl(reference):
        final type = reference.get();
        parameters('', type.params);
        for (name in type.names) {
          final constructor = type.constructs.get(name);
          if (constructor != null)
            slots.push({name: 'constructor ' + name, value: constructor.type});
        }
      case TTypeDecl(reference):
        final type = reference.get();
        parameters('', type.params);
        slots.push({name: 'body', value: type.type});
      case TAbstract(reference):
        final type = reference.get();
        parameters('', type.params);
        slots.push({
          name: 'self',
          value: TAbstract(reference,
            [for (parameter in type.params) parameter.t])
        });
        slots.push({name: 'over', value: type.type});
    }
    return {slots: slots, bodies: bodies, locals: locals};
  }

  /** Prints the kept values of `bucket` now, beside a new read of the bodies. */
  static function printNow(bucket: Bucket, fresh: Reading): StagePrints {
    final freshLocalIds = new Map<String, String>();
    final freshLocals = new Map<String, String>();
    for (local in fresh.locals) {
      final ids = freshLocalIds.get(local.owner);
      freshLocalIds.set(local.owner, (ids == null ? '' : ids + ',') + local.id);
      final full = freshLocals.get(local.owner);
      freshLocals.set(local.owner,
        (full == null ? '' : full
          + '; ') + local.id + ' ' + local.name + ': ' + printType(local.type));
    }
    return {
      slots: [for (slot in bucket.reading.slots) slot.name => describe(slot.value)],
      bodies: [
        for (body in bucket.reading.bodies)
          body.name => describeBody(body.value)
      ],
      localTypes: [
        for (local in bucket.reading.locals)
          local.id => printType(local.type)
      ],
      freshLocalIds: freshLocalIds,
      freshLocals: freshLocals
    };
  }

  /**
   * Returns true when `now` is `before` with other text in the places where
   * `before` names an open monomorph, and nowhere else.
   *
   * An open monomorph is a type that Haxe has not decided yet. Haxe can
   * decide it later in the request that typed the declaration, also after
   * `onGenerate`. A kept value reads the decided type from then on, as a new
   * read does. The probe prints an open monomorph as `(open monomorph)`;
   * Haxe's printer prints `Unknown<0>`.
   */
  static function differsOnlyAtOpenMonomorphs(before: String,
      now: Null<String>): Bool {
    if (now == null)
      return false;
    final pieces = ~/\(open monomorph\)|Unknown<[0-9]+>/g.split(before);
    if (pieces.length < 2)
      return false;
    var from = 0;
    for (index => piece in pieces) {
      final at = index == 0 ? (StringTools.startsWith(now,
        piece) ? 0 : -1) : now.indexOf(piece, from);
      if (at == -1)
        return false;
      from = at + piece.length;
    }
    return StringTools.endsWith(now, pieces[pieces.length - 1]);
  }

  static function shorten(value: Null<String>): Null<String> {
    return value == null
      || value.length <= MAX_TEXT ? value : value.substr(0, MAX_TEXT) + '...';
  }

  static function list(name: String): Array<Dynamic> {
    final existing: Null<Array<Dynamic>> = report.get(name);
    if (existing != null)
      return existing;
    final created: Array<Dynamic> = [];
    report.set(name, created);
    return created;
  }

  static function count(name: String, by = 1): Void {
    final existing: Null<Int> = report.get(name);
    report.set(name, (existing == null ? 0 : existing) + by);
  }

  /**
   * Keeps a few examples of one finding. Declarations under `detailPrefix`
   * have their own list, so that the standard library cannot fill it first.
   */
  static function example(name: String, module: String, value: Dynamic): Void {
    final examples = list(StringTools.startsWith(module,
      detailPrefix) ? name : name
      + '.other');
    if (examples.length < MAX_EXAMPLES)
      examples.push(value);
  }

  static function detail(key: String): DynamicAccess<Dynamic> {
    final existing: Null<DynamicAccess<Dynamic>> = details.get(key);
    if (existing != null)
      return existing;
    final created: DynamicAccess<Dynamic> = {};
    details.set(key, created);
    return created;
  }

  static function addModule(name: String, module: String): Void {
    final modules = list(name);
    if (modules.indexOf(module) == -1)
      modules.push(module);
  }

  /**
   * Records what the old bucket of a declaration is worth after Haxe typed
   * the declaration again, or gave a declaration of another cache.
   */
  static function observeReplaced(old: Bucket, entry: ProgramEntry,
      fresh: Reading): Void {
    final held = addresses(old.declaration, entry.declaration);
    // A class with a new member is the same object by design (state
    // `membersChanged`); every other replaced bucket must hold another one.
    if (held && entry.state != 'membersChanged')
      list('replacedButSameObject').push(entry.key);
    final recorded = old.recorded.get('afterTyping');
    final freshSlots = [for (slot in fresh.slots) slot.name => describe(slot.value)];
    final stale: Array<String> = [];
    if (recorded != null)
      for (name => before in recorded.slots) {
        final now = freshSlots.get(name);
        if (now != before) {
          stale.push(name);
          example('staleExamples', entry.module, {
            key: entry.key,
            slot: name,
            kept: shorten(before),
            current: shorten(now)
          });
        }
      }
    if (stale.length > 0)
      count('replacedWithStaleSlots');
    final freshIds = [for (local in fresh.locals) local.id => true];
    var reused = 0;
    for (local in old.reading.locals)
      if (freshIds.exists(local.id))
        reused++;
    count('replacedLocalIds', old.reading.locals.length);
    count('replacedLocalIdsStillUsed', reused);
    if (StringTools.startsWith(entry.module, detailPrefix)) {
      final item = detail(entry.key);
      item.set('oldBucketFromRequest', old.capturedIn);
      item.set('oldBucketIsSameObject', held);
      item.set('staleSlots', stale);
      item.set('oldLocalIds', old.reading.locals.length);
      item.set('oldLocalIdsStillUsed', reused);
    }
  }

  static function afterTyping(types: Array<ModuleType>): Void {
    final ownNonce = nonce ?? (nonce = Std.string(Std.random(0x3FFFFFFF))
      + '-'
      + Std.string(Sys.time()));
    if (!started) {
      started = true;
      requests++;
      report.set('request', requests);
      report.set('nonce', ownNonce);
      report.set('stages', []);
      report.set('details', details);
      for (name in [
        'declarations',
        'first',
        'typedAgain',
        'kept',
        'stampMismatch',
        'foreignStamp',
        'membersChanged',
        'replacedWithStaleSlots',
        'replacedLocalIds',
        'replacedLocalIdsStillUsed',
        'duplicateLocalIds',
        'capturedTypes',
        'capturedLazyTypes',
        'capturedOpenMonomorphs'
      ])
        report.set(name, 0);
      for (name in [
        'typedAgainModules',
        'stampMismatchModules',
        'replacedButSameObject',
        'keptButOtherObject',
        'stampOnlyKept',
        'staleExamples'
      ])
        list(name);
      report.set('highestLocalIdBefore', highestLocalId);
      final defines = [
        for (name => value in Context.getDefines())
          name + '=' + value
      ];
      defines.sort(Reflect.compare);
      report.set('definesDigest', haxe.crypto.Md5.encode(defines.join('\n')));
    }
    var lowestNew: Null<Int> = report.get('lowestNewLocalId');
    for (declaration in types) {
      final base = baseOf(declaration);
      final key = keyOf(declaration, base);
      if (seen.exists(key))
        continue;
      seen.set(key, true);
      final found = stampOf(base.meta);
      final old = buckets.get(key);
      final members = membersOf(declaration);
      final state = found == null ? 'typedAgain' : found.key != key ? 'foreignStamp' : old == null
        || old.stamp != found.value ? 'stampMismatch' : old.members != members ? 'membersChanged' : 'kept';
      // What the rule before the review answers: only the stamp value counts.
      if (found != null
        && old != null
        && old.stamp == found.value
        && state != 'kept')
        list('stampOnlyKept').push({
          key: key,
          state: state,
          stampNames: found.key,
          sameObject: addresses(old.declaration, declaration),
          membersBefore: old.members,
          membersNow: members
        });
      final entry: ProgramEntry = {
        key: key,
        module: base.module,
        declaration: declaration,
        state: state
      };
      program.push(entry);
      count('declarations');
      count(state);
      if (state == 'typedAgain' && old == null)
        count('first');
      if (state == 'typedAgain')
        addModule('typedAgainModules', base.module);
      if (state == 'stampMismatch')
        addModule('stampMismatchModules', base.module);
      if (StringTools.startsWith(base.module, detailPrefix)) {
        final item = detail(key);
        item.set('module', base.module);
        item.set('state', state);
        item.set('hadBucket', old != null);
      }
      if (state == 'kept')
        continue;
      final fresh = read(declaration);
      if (old != null)
        observeReplaced(old, entry, fresh);
      final stamp = found != null
        && found.key == key ? found.value : '$ownNonce/$requests';
      if (found == null || found.key != key) {
        if (found != null)
          baseOf(declaration).meta.remove(STAMP);
        baseOf(declaration).meta.add(STAMP, [text(stamp), text(key)],
          Context.currentPos());
      }
      buckets.set(key, {
        key: key,
        module: base.module,
        stamp: stamp,
        members: members,
        capturedIn: requests,
        declaration: declaration,
        reading: fresh,
        recorded: new Map()
      });
      count('capturedTypes', fresh.slots.length + fresh.locals.length);
      for (slot in fresh.slots)
        countUndecided(slot.value);
      for (local in fresh.locals) {
        countUndecided(local.type);
        if (lowestNew == null || local.id < lowestNew)
          lowestNew = local.id;
      }
    }
    report.set('lowestNewLocalId', lowestNew);

    // One id must belong to one declaration: a flat map from id to type, as
    // `SignatureCache.localSourceTypes` is, needs that.
    final owners = new Map<Int, String>();
    var duplicates = 0;
    var keptIds = 0;
    for (entry in program) {
      final bucket = buckets.get(entry.key);
      if (bucket == null)
        continue;
      for (local in bucket.reading.locals) {
        keptIds++;
        if (owners.exists(local.id)) {
          duplicates++;
          example('duplicateLocalIdExamples', entry.module, {
            id: local.id,
            first: owners.get(local.id),
            second: entry.key + ' ' + local.owner
          });
        } else
          owners.set(local.id, entry.key + ' ' + local.owner);
        if (local.id > highestLocalId)
          highestLocalId = local.id;
      }
    }
    report.set('duplicateLocalIds', duplicates);
    report.set('keptLocalIds', keptIds);
    stage('afterTyping');
  }

  /**
   * Prints every kept value again and compares the text with the same stage
   * of the request that made the bucket, and with a new read.
   */
  static function stage(name: String): Void {
    if (!started)
      return;
    final stages: Array<String> = report.get('stages');
    if (stages.indexOf(name) != -1)
      return;
    stages.push(name);
    var localHits = 0;
    for (entry in program) {
      final bucket = buckets.get(entry.key);
      if (bucket == null)
        continue;
      final fresh = read(entry.declaration);
      final now = printNow(bucket, fresh);
      final freshIds = [for (local in fresh.locals) local.id => true];
      for (local in bucket.reading.locals)
        if (freshIds.exists(local.id))
          localHits++;
      final listed = StringTools.startsWith(entry.module, detailPrefix);
      if (bucket.capturedIn == requests) {
        bucket.recorded.set(name, now);
        continue;
      }
      if (name == 'afterTyping') {
        final same = addresses(bucket.declaration, entry.declaration);
        if (!same)
          list('keptButOtherObject').push(entry.key);
        if (listed)
          detail(entry.key).set('keptBucketIsSameObject', same);
      }
      final before = bucket.recorded.get(name);
      if (before == null) {
        // The request that made the bucket failed before this stage.
        count('keptWithoutRecord.' + name);
        bucket.recorded.set(name, now);
        continue;
      }
      function compare(kind: String, was: Map<String, String>,
          is: Map<String, String>): Void {
        for (place => text in was) {
          final current = is .get(place);
          if (current == text)
            continue;
          // A type that was an open monomorph when the bucket was made, and
          // that Haxe closed later in that request, is counted apart.
          final finding = differsOnlyAtOpenMonomorphs(text, current) ? kind
            + 'ClosedLater' : kind;
          count('keptChanged.' + name + '.' + finding);
          example('keptChangedExamples.' + name + '.' + finding, entry.module, {
            key: entry.key,
            place: place,
            before: shorten(text),
            now: shorten(current)
          });
        }
        for (place => text in is)
          if (!was.exists(place)) {
            count('keptChanged.' + name + '.' + kind);
            example('keptChangedExamples.' + name + '.' + kind, entry.module, {
              key: entry.key,
              place: place,
              before: null,
              now: shorten(text)
            });
          }
      }
      compare('types', before.slots, now.slots);
      compare('bodies', before.bodies, now.bodies);
      compare('localTypes', [
        for (id => text in before.localTypes)
          Std.string(id) => text
      ], [for (id => text in now.localTypes) Std.string(id) => text]);
      compare('freshLocalIds', before.freshLocalIds, now.freshLocalIds);
      compare('freshLocals', before.freshLocals, now.freshLocals);

      // A kept type beside the type that a capture in this request reads.
      final freshSlots = [for (slot in fresh.slots) slot.name => slot.value];
      for (slot in bucket.reading.slots) {
        final current = freshSlots.get(slot.name);
        if (current == null)
          continue;
        count('keptComparedWithFresh.' + name);
        final kept = now.slots.get(slot.name);
        final read = describe(current);
        if (kept != read) {
          count('keptDiffersFromFresh.' + name);
          example('keptDiffersFromFreshExamples.' + name, entry.module, {
            key: entry.key,
            place: slot.name,
            kept: shorten(kept),
            fresh: shorten(read)
          });
        }
      }
    }
    report.set('keptLocalIdsFound.' + name, localHits);
    report.set('sameObjectTests', identityTests);
    report.set('sameObjectMs', Math.round(identitySeconds * 100000) / 100);
    for (modules in ['typedAgainModules', 'stampMismatchModules'])
      list(modules).sort(Reflect.compare);
    sys.io.File.saveContent(reportPath, haxe.Json.stringify(report, null, ' '));
    if (failAt == name)
      Context.error('KeptTypeValuesProbe: failure requested after stage '
        + name,
        Context.currentPos());
  }
}
