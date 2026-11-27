package genes;

#if macro
import genes.incremental.GenerationChangeSet;
import genes.incremental.ModuleRequest;
import genes.incremental.GenerationChangeSet.StampedDeclaration;
import haxe.macro.Context;
import haxe.macro.Type;

/**
 * One class of the program, as the after-typing passes of one request read it.
 *
 * Why: a `ClassType` does not hold its fields and bodies as stored values. On
 * every `fields.get()` and every `ClassField.expr()` call the Haxe macro
 * interpreter copies the field list, or the complete typed expression tree of
 * a field, into new macro values. Three passes read every class, so one
 * request made every copy three times.
 *
 * What: this value makes each copy for the first pass that asks and returns
 * the same value to the next pass. The values are the ones that a direct call
 * returns at that point. The passes only read them.
 *
 * Lifetime: `AfterTypingPasses` makes one value for one class, gives it to
 * every pass, and then drops it before it reads the next class. No copy
 * outlives its class, so nothing passes to a later request, and the copies do
 * not stay in memory while the other classes are read.
 */
class AfterTypingClass {
  /** The class record that Haxe typed. */
  public final type: ClassType;

  /**
   * The full owner name that the passes use as the class key. A type whose
   * name differs from its module keeps both parts, for example
   * `app.Models.User`.
   */
  public final ownerKey: String;

  /**
   * How this class arrived in the request, with the stamp that it carries
   * now. It is `null` unless the request uses the incremental path
   * (`-D genes.dev_incremental`, see `GenerationChangeSet`). A pass that
   * keeps a record between requests gives this value to the keep rule.
   */
  public final stamp: Null<StampedDeclaration>;

  /**
   * The declaration reference that Haxe gave for this class in this request,
   * or `null` unless the request uses the incremental path. A pass that
   * keeps typed values gives it to `genes.incremental.KeptBuckets`, which
   * needs it for the same-object test.
   */
  public final declaration: Null<ModuleType>;

  var instanceFields: Null<Array<ClassField>> = null;
  var staticFields: Null<Array<ClassField>> = null;
  var constructorField: Null<ClassField> = null;
  var constructorRead = false;
  var bodies: Null<Map<String, Null<TypedExpr>>> = null;
  var members: Null<String> = null;

  public function new(type: ClassType, ?stamp: StampedDeclaration,
      ?declaration: ModuleType,
      ?parts: genes.incremental.ModuleFingerprint.ClassParts) {
    this.type = type;
    this.stamp = stamp;
    this.declaration = declaration;
    // The fields that `GenerationChangeSet.compareMetadata` already read in
    // this callback: the same copy, so the walk does not copy them again.
    if (parts != null) {
      instanceFields = parts.fields;
      staticFields = parts.statics;
      constructorField = parts.constructor;
      constructorRead = true;
    }
    final declaredPath = type.pack.concat([type.name]).join('.');
    this.ownerKey = declaredPath == type.module ? declaredPath : type.module
      + '.'
      + type.name;
  }

  /** Returns the instance fields in declaration order. Do not change the array. */
  public function fields(): Array<ClassField> {
    final known = instanceFields;
    if (known != null)
      return known;
    return instanceFields = type.fields.get();
  }

  /** Returns the static fields in declaration order. Do not change the array. */
  public function statics(): Array<ClassField> {
    final known = staticFields;
    if (known != null)
      return known;
    return staticFields = type.statics.get();
  }

  /** Returns the constructor, or `null` when the class declares none. */
  public function constructor(): Null<ClassField> {
    if (!constructorRead) {
      constructorRead = true;
      final reference = type.constructor;
      constructorField = reference == null ? null : reference.get();
    }
    return constructorField;
  }

  /**
   * Returns the member list of the class as one text: the names of the static
   * fields, of the instance fields, and whether the class has a constructor
   * and an `__init__` body. Example: `S:make,plain|I:value|C:1|N:0`.
   *
   * Why: Haxe can add a member to a class that it did not type again. The
   * first use of a `@:generic` method from another module adds one static
   * field for that use, for example `make_Int`. The stamp of the class does
   * not change then. A record of an earlier request is valid only for the
   * same member list (condition 6 of the keep rule).
   */
  public function memberList(): String {
    final known = members;
    if (known != null)
      return known;
    final text = 'S:'
      + [for (field in statics()) field.name].join(',') + '|I:' +
        [for (field in fields()) field.name].join(',')
        + '|C:'
        + (constructor() == null ? '0' : '1')
        + '|N:'
        + (type.init == null ? '0' : '1');
    members = text;
    return text;
  }

  /**
   * Returns the typed body of `field`, or `null` when the field has no body.
   *
   * `field` must come from `fields()`, `statics()` or `constructor()` of this
   * class; pass `false` for `isStatic` for the constructor. The static flag
   * and the field name are an exact identity inside one class, because Haxe
   * does not permit two fields with one name. An overload signature shares the
   * name of its field: read it with `signature.expr()` instead.
   *
   * On the incremental path, a copy from a class that arrived `Kept` is
   * counted for the report (`GenerationChangeSet.recordKeptBodyRead`).
   */
  public function body(field: ClassField, isStatic: Bool): Null<TypedExpr> {
    var known = bodies;
    if (known == null)
      known = bodies = new Map();
    final key = (isStatic ? 'S:' : 'I:') + field.name;
    if (known.exists(key))
      return known.get(key);
    final arrived = stamp;
    if (arrived != null && arrived.arrival == Kept)
      GenerationChangeSet.recordKeptBodyRead();
    final body = field.expr();
    known.set(key, body);
    return body;
  }
}

/**
 * One declaration list that Haxe gave to `onAfterTyping`, as the second
 * function of a pass receives it.
 */
typedef AfterTypingDeclarations = {
  /** The declarations, in Haxe's order. */
  final types: Array<ModuleType>;

  /**
   * The stamp of each entry of `types`, at the same index. The array is
   * `null` unless the request uses the incremental path
   * (`-D genes.dev_incremental`); one entry is `null` when the request left
   * that path after the stamps were read.
   */
  final stamps: Null<Array<Null<StampedDeclaration>>>;
}

/**
 * Runs the passes that read every typed class before dead-code elimination in
 * one walk, class by class.
 *
 * Why: `genes.PublicSurface`, `genes.ts.SignatureCache` and
 * `genes.react.ReactDiagnosticsMacro` each registered an `onAfterTyping`
 * callback that read every class of the program. Each pass made the macro
 * interpreter copy every field body again. On an application with 1,100
 * modules these copies were about a third of the time that the passes use on
 * every request of a warm compiler server, also when no file changed.
 *
 * What: a pass gives `add` a function for one class. For each class of the
 * request, the walk makes one `AfterTypingClass` and calls every pass with it,
 * so all passes share one copy of the fields and bodies of that class. A pass
 * may also give a second function that receives the whole declaration list
 * after all classes; it reads the other declaration kinds there, and it can
 * rely on its class function having seen every class. That function also
 * gets the stamp of each declaration of the list, or `null` unless the
 * request uses the incremental path.
 *
 * Stamps before passes: a pass that keeps a record between requests must
 * know, before it reads a class, whether Haxe typed that class again. One
 * owner, `genes.incremental.GenerationChangeSet`, answers that with a stamp
 * on each declaration. `run` calls it first, so the answer exists before the
 * first pass of this callback, in every order of the `install()` calls.
 * Nothing else adds stamps. Without `-D genes.dev_incremental` that call
 * returns at once and reads nothing.
 *
 * Order: for one class, the passes run in the order of their `add` calls.
 * Haxe 4.3.7 runs `onAfterTyping` callbacks in reverse order of registration.
 * In the usual order of the init macros (`Generator.use()` first), the order
 * is: this walk for each class (`PublicSurface`, `SignatureCache`, the React
 * audit), then the declaration functions, then `ModuleDirectivePlan`, then
 * `TypedModuleInventory`. No pass reads a fact of another pass during the
 * walk. The class functions of `PublicSurface` and `SignatureCache` raise no
 * errors, and the audit adds no metadata.
 *
 * Why `ModuleDirectivePlan` and `TypedModuleInventory` keep callbacks of
 * their own: Haxe isolates callbacks, not statements. `Context.error`
 * reports the error and then ends the callback that called it; macro code
 * cannot catch that. The next callback still runs. Example: with
 * `-D genes.library`, `LibraryProfile.retain` reports
 * "@:genes.library does not accept arguments" from this walk, and the
 * module-directive callback still reports a wrong `@:genes.moduleDirective`
 * in the same build. If those captures ran at the end of this walk, the
 * second error would be lost. Their own callbacks also keep their place in
 * Haxe's order when `Generator.use()` runs twice or after the React install.
 *
 * Errors: the React audit is not the only pass that can report an error. The
 * declaration function of `PublicSurface` calls `LibraryProfile.retain`,
 * which can call `Context.error`. The audit runs before it in this walk, so
 * its error comes first. A diagnostic of the audit is fatal: it stops the
 * compilation at the first class that has one.
 *
 * Module requests (G3): in a request with `"kind": "module"`, a class that
 * Haxe kept and that lies outside the requested module and its parent
 * classes and interfaces skips the `publicSurface` and `reactAudit` passes
 * and the member-list clock (`ModuleRequest.skipsClassPass`). Only the
 * incremental path takes this branch.
 *
 * Lifetime: the lists are ordinary statics, not `@:persistent`. Haxe replaces
 * them at the start of each compilation on a compiler server, and each
 * `install()` of a pass adds its functions again. The walk keeps no typed
 * value after it returns.
 */
class AfterTypingPasses {
  static var classPasses: Array<AfterTypingClass->Void> = [];
  static var classPassNames: Array<String> = [];
  static var declarationPasses: Array<AfterTypingDeclarations->Void> = [];
  static var declarationPassNames: Array<String> = [];

  /**
   * Adds one pass for the current compilation.
   *
   * `name` names the pass in the after-typing report, for example
   * `signatureCache`. `visitClass` runs once for each typed class.
   * `visitDeclarations`, when given, runs once after all classes with the
   * complete list that Haxe gave to `onAfterTyping`. Haxe can call
   * `onAfterTyping` again when a callback defines new types; the walk then
   * reads only those new declarations.
   */
  public static function add(name: String, visitClass: AfterTypingClass->Void,
      ?visitDeclarations: AfterTypingDeclarations->Void): Void {
    if (classPasses.length == 0)
      Context.onAfterTyping(run);
    classPasses.push(visitClass);
    classPassNames.push(name);
    if (visitDeclarations != null) {
      declarationPasses.push(visitDeclarations);
      declarationPassNames.push(name);
    }
  }

  static function run(types: Array<ModuleType>): Void {
    // `observed` is `null` unless this request uses the incremental path.
    // Then it holds, for each class, the copy of the class record that the
    // change set already read, so that the walk does not copy it again.
    final observed = GenerationChangeSet.observe(types);
    final walkStart = observed == null ? 0.0 : haxe.Timer.stamp();
    // One clock for each pass, only on the incremental path: the report then
    // shows which pass a later slice must make cheaper. Without the define no
    // clock is read.
    final classSeconds = observed == null ? null : [for (_ in classPasses) 0.0];
    for (index => type in types) {
      switch type {
        case TClassDecl(reference):
          final seen = observed == null ? null : observed[index];
          final record = seen == null ? null : seen.type;
          final current = seen == null
            || record == null ? new AfterTypingClass(reference.get()) : new AfterTypingClass(record,
              seen.stamp, type, seen.parts);
          if (current.stamp != null && !ModuleRequest.skipsMemberRead(current))
            GenerationChangeSet.readMembers(current.memberList);
          if (classSeconds == null) {
            // Without the incremental path no request is a module request,
            // so no pass is skipped (`ModuleRequest.skipsClassPass` would
            // answer false); this branch reads no clock.
            for (visit in classPasses)
              visit(current);
          } else {
            for (index => visit in classPasses) {
              // A module request (G3) skips some passes for a class that
              // Haxe kept; see `ModuleRequest.skipsClassPass`.
              if (ModuleRequest.skipsClassPass(classPassNames[index], current,
                types))
                continue;
              final started = haxe.Timer.stamp();
              visit(current);
              classSeconds[index] += haxe.Timer.stamp() - started;
            }
          }
        default:
      }
    }
    final declarations: AfterTypingDeclarations = {
      types: types,
      stamps: observed == null ? null : [for (seen in observed) seen.stamp]
    };
    if (classSeconds == null) {
      for (visit in declarationPasses)
        visit(declarations);
      return;
    }
    for (index => seconds in classSeconds)
      GenerationChangeSet.passTime(classPassNames[index], seconds, 0.0);
    for (index => visit in declarationPasses) {
      final started = haxe.Timer.stamp();
      visit(declarations);
      GenerationChangeSet.passTime(declarationPassNames[index], 0.0,
        haxe.Timer.stamp() - started);
    }
    GenerationChangeSet.finish(haxe.Timer.stamp() - walkStart);
  }
}
#end
