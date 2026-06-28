package genes.ts;

import genes.Dependencies;
import genes.Module;
import genes.TypeAccessor;
import genes.Module.Field as GenesField;
import genes.Module.FieldKind;
import genes.es.ModuleEmitter as JsModuleEmitter;
import genes.dts.TypeEmitter;
import genes.util.Timer.timer;
import genes.util.TypeUtil;
import haxe.ds.Option;
import haxe.macro.Expr;
import haxe.macro.Type;
import genes.util.IteratorUtil.*;

using genes.util.TypeUtil;
using Lambda;
using haxe.macro.Tools;

typedef NullNarrowCheck = {
  final nonNullWhenTrue: Array<String>;
  final nonNullWhenFalse: Array<String>;
}

typedef LocalNameScope = {
  final names: Map<Int, String>;
  final counts: Map<String, Int>;
  final parent: Null<LocalNameScope>;
}

typedef ObjectFieldLocalUse = {
  final local: TVar;
  final fieldName: String;
}

typedef PrivateMethodCall = {
  final owner: ClassType;
  final field: ClassField;
  final receiver: Null<TypedExpr>;
}

/**
 * Minimal TS module emitter (M1):
 * - Emits `.ts` modules with ESM imports/exports
 * - Emits `export class` declarations (not `export const Foo = class Foo`)
 * - Adds enough type annotations for `tsc --noEmit` under `strict`
 *
 * This is intentionally incomplete. Expression coverage and richer typing land in later milestones.
 */
class TsModuleEmitter extends JsModuleEmitter {
  static final JSX_REACT_IMPORT = 'React__genes_jsx';
  static final JSX_CLASSIC_REACT_IMPORT = 'React';

  var jsxEmitTsx: Bool = false;
  var inAssignTarget: Bool = false;
  var currentClass: Null<ClassType> = null;
  var currentReturnIsVoidLike: Bool = false;
  var generatedLocalNames: Map<Int, String> = [];
  var generatedLocalNameCounts: Map<String, Int> = [];
  var mapKeyIteratorOrigins: Map<Int, String> = [];
  var mapKeyLocalOrigins: Map<Int, String> = [];

  /**
   * Per-emitted-function local naming state.
   *
   * Why: Haxe inline expansion can materialize inline parameters as ordinary
   * typed locals named `key`, `value`, etc. TypeScript `var` declarations are
   * function-scoped, so two expanded call sites with different Haxe types can
   * become illegal duplicate TS declarations if they both print `value`.
   *
   * What/How: keyed by stable `TVar.id`, this allocator preserves the first
   * readable source name in each emitted function and suffixes only later
   * distinct locals with the same source name (`value`, `value_1`, ...).
   * Function arguments are registered in the same scope so body references and
   * forwarded constructor calls use the exact emitted argument name. Nested
   * lexical blocks, such as TS switch-case wrappers, can reuse names while still
   * looking up outer locals by `TVar.id`.
   */
  var scopedLocalNames: Map<Int, String> = [];

  var scopedLocalNameCounts: Map<String, Int> = [];
  var scopedLocalParent: Null<LocalNameScope> = null;
  var preferredLocalNames: Map<Int, String> = [];
  var localTsTypeOverrides: Map<Int, String> = [];
  var narrowedNonNullKeys: Array<String> = [];
  var inRawSyntaxTemplate: Bool = false;
  var suppressOptionalFieldNullNormalization: Bool = false;
  var suppressPromiseResolveNullThenableCast: Bool = false;

  function typeEmitsAny(t: Type): Bool {
    final fast = switch t {
      case TDynamic(null):
        true;
      case TInst(_.get() => cl, _)
        if (cl.module != null && cl.module.startsWith('haxe.macro')):
        true;
      case TType(_.get() => dt, _)
        if (dt.module != null && dt.module.startsWith('haxe.macro')):
        true;
      default:
        false;
    };
    if (fast)
      return true;

    final out = new StringBuf();
    final noop = function() {}
    final writer: genes.dts.TypeEmitter.TypeWriter = {
      write: out.add,
      writeNewline: noop,
      emitComment: function(_comment: String) {},
      increaseIndent: noop,
      decreaseIndent: noop,
      emitPos: function(_pos) {},
      includeType: function(_type: Type) {},
      typeAccessor: ctx.typeAccessor
    };
    TypeEmitter.emitType(writer, t);
    return out.toString() == 'any';
  }

  static function isUndefinableType(t: Type): Bool {
    return switch t {
      case TAbstract(_.get() => {
        module: 'genes.ts.Undefinable',
        name: 'Undefinable'
      }, _):
        true;
      case TAbstract(_.get() => {pack: [], name: "Null"}, [inner]) |
        TType(_.get() => {pack: [], name: "Null"}, [inner]):
        isUndefinableType(inner);
      case TType(_, _):
        isUndefinableType(haxe.macro.Context.follow(t));
      case TLazy(f):
        isUndefinableType(f());
      default:
        false;
    }
  }

  static function isUnknownBoundaryType(t: Type): Bool {
    return switch t {
      case TAbstract(_.get() => {module: 'genes.ts.Unknown', name: 'Unknown'},
        _):
        true;
      case TAbstract(_.get() => {pack: [], name: "Null"}, [inner]) |
        TType(_.get() => {pack: [], name: "Null"}, [inner]):
        isUnknownBoundaryType(inner);
      case TType(_, _):
        isUnknownBoundaryType(haxe.macro.Context.follow(t));
      case TLazy(f):
        isUnknownBoundaryType(f());
      default:
        false;
    }
  }

  /**
   * Decides whether a raw JavaScript `undefined` literal should become `null`.
   *
   * Why: ordinary Haxe nullable values use `null`, while JavaScript host APIs
   * often use `undefined`. genes-ts normally normalizes raw
   * `js.Syntax.code("undefined")` into `null` when the surrounding Haxe type is
   * nullable, preserving Haxe runtime expectations under TS strict null checks.
   *
   * What/How: `genes.ts.Undefinable<T>` and `genes.ts.Unknown` are explicit
   * boundary contracts where `undefined` is semantically meaningful. For those
   * types, and for expected/return contexts of those types, keep the real
   * JavaScript `undefined` value instead of collapsing it to Haxe `null`.
   */
  function shouldNormalizeUndefinedToNull(t: Type): Bool {
    return typeAllowsNull(t)
      && !isUndefinableType(t)
      && !isUnknownBoundaryType(t)
      && (currentExpectedValueType == null
        || (!isUndefinableType(currentExpectedValueType)
          && !isUnknownBoundaryType(currentExpectedValueType)))
      && (currentReturnType == null
        || (!isUndefinableType(currentReturnType)
          && !isUnknownBoundaryType(currentReturnType)));
  }

  function shouldNormalizeOptionalFieldRead(e: TypedExpr): Bool {
    final expected = currentExpectedValueType;
    return expected != null && typeAllowsNull(expected)
      && !isUndefinableType(expected) && !isUndefinableType(e.t)
      && !isNarrowedOptionalField(e);
  }

  public function emitTsModule(module: Module, importExtension: Null<String>) {
    final endTimer = timer('emitTsModule');
    jsxEmitTsx = genes.Genes.outExtension == '.tsx';
    generatedLocalNames = [];
    generatedLocalNameCounts = [];
    scopedLocalNames = [];
    scopedLocalNameCounts = [];
    scopedLocalParent = null;
    narrowedNonNullKeys = [];
    final usesReactJsxMarkers = moduleUsesReactJsxMarkers(module);

    // Merge code + type dependencies so TS signatures can resolve.
    final deps = new Dependencies(module, true);
    mergeDepsInto(deps, module.codeDependencies);
    mergeDepsInto(deps, module.typeDependencies);
    ctx.typeAccessor = deps.typeAccessor;

    if (haxe.macro.Context.defined('genes.banner')) {
      write(haxe.macro.Context.definedValue('genes.banner'));
      writeNewline();
    }

    // Ensure React is in scope for JSX output:
    // - `.ts` mode lowers JSX markers into `React__genes_jsx.createElement(...)`.
    // - `.tsx` mode normally relies on the automatic JSX runtime, but we can opt into
    //   classic runtime (which needs a `React` namespace in scope).
    if (usesReactJsxMarkers && !jsxEmitTsx) {
      write('import * as ');
      write(JSX_REACT_IMPORT);
      write(' from ');
      emitString('react');
      writeNewline();
    } else if (usesReactJsxMarkers && jsxEmitTsx
      && haxe.macro.Context.defined('genes.ts.jsx_classic')) {
      write('import * as ');
      write(JSX_CLASSIC_REACT_IMPORT);
      write(' from ');
      emitString('react');
      writeNewline();
    }
    // Some automatic JSX runtimes expose `JSX` as a module export instead of a
    // global namespace. In TSX mode this optional import keeps generated
    // `JSX.Element` annotations resolvable without forcing React globals.
    final jsxImportSource = haxe.macro.Context.definedValue('genes.ts.jsx_import_source');
    if (usesReactJsxMarkers
      && jsxEmitTsx
      && jsxImportSource != null
      && jsxImportSource.length > 0) {
      write('import type {JSX} from ');
      emitString(jsxImportSource);
      writeNewline();
    }

    final endImportTimer = timer('emitImports');
    final runtimeNamesByModule: Map<String, Map<String, Bool>> = [];
    for (path => imports in module.codeDependencies.imports) {
      final names: Map<String, Bool> = [];
      for (dep in imports)
        names.set(dep.name, true);
      runtimeNamesByModule.set(path, names);
    }

    for (path => imports in deps.imports) {
      final runtimeNames = runtimeNamesByModule.get(path);
      final valueImports = [];
      final typeImports = [];
      for (dep in imports) {
        if (runtimeNames != null && runtimeNames.exists(dep.name))
          valueImports.push(dep);
        else
          typeImports.push(dep);
      }
      final rel = if (imports[0].external) path else module.toPath(path);
      if (valueImports.length > 0)
        emitTsImports(rel, valueImports, importExtension, false);
      if (typeImports.length > 0)
        emitTsImports(rel, typeImports, importExtension, true);
    }
    endImportTimer();

    if (moduleUsesJsonTypes(module) || dependenciesUseJsonTypes(deps))
      emitJsonTypeAliases();

    // Keep Genes behavior for js.Lib.global feature.
    final hasRuntimeCode = module.members.exists(m -> switch m {
      case MClass(cl, _, _) if (cl.isInterface): false;
      case MType(_, _): false;
      case _: true;
    });
    if (hasRuntimeCode && module.module != 'genes.Register'
      && ctx.hasFeature('js.Lib.global')) {
      writeNewline();
      write("const $global = ");
      write(ctx.typeAccessor(TypeUtil.registerType));
      write(".$global");
      writeNewline();
    }

    for (member in module.members) {
      switch member {
        case MClass(cl, _, fields) if (cl.isInterface):
          emitTsInterface(cl, fields);
        case MClass(cl, _, fields):
          final endClassTimer = timer('emitClass');
          emitTsClass(module.isCyclic, cl, fields);
          endClassTimer();
          final endStaticsTimer = timer('emitStatics');
          emitTsStatics(module.isCyclic, cl, fields);
          endStaticsTimer();
          emitInit(cl);
        case MEnum(et, _):
          final endEnumTimer = timer('emitEnums');
          emitTsEnum(et);
          endEnumTimer();
        case MType(def, params):
          emitTsTypeDefinition(def, params);
        case MMain(e):
          writeNewline();
          emitExpr(e);
        default:
      }
    }

    for (export in module.expose)
      if (!export.isType)
        emitExport(export, module.toPath(export.module), importExtension);

    return endTimer();
  }

  /**
   * Emits the recursive native JSON type family when a module actually uses it.
   *
   * Why: `genes.ts.JsonValue` is represented by ordinary native JS values at
   * runtime, but strict TypeScript needs the recursive alias family in scope for
   * signatures and inferred locals. Keeping the aliases module-local avoids a
   * hidden global declaration while preserving readable handwritten-style TS.
   */
  function emitJsonTypeAliases() {
    writeNewline();
    write('type JsonPrimitive = null | boolean | number | string');
    writeNewline();
    write('type JsonObject = { readonly [key: string]: JsonValue }');
    writeNewline();
    write('type JsonArray = readonly JsonValue[]');
    writeNewline();
    write('type JsonValue = JsonPrimitive | JsonObject | JsonArray');
    writeNewline();
    write('type JsonNonNullValue = Exclude<JsonValue, null>');
    writeNewline();
  }

  static function moduleUsesJsonTypes(module: Module): Bool {
    if (module.module != null && module.module.startsWith('genes.ts.Json'))
      return true;

    var found = false;
    function visitType(t: Type) {
      if (!found && t != null)
        found = typeUsesJsonTypes(t);
    }
    function visitExpr(e: TypedExpr) {
      if (found || e == null)
        return;
      visitType(e.t);
      switch e.expr {
        case TVar(v, _):
          visitType(v.t);
        case TFunction(f):
          for (arg in f.args)
            visitType(arg.v.t);
          visitType(f.t);
        default:
      }
      e.iter(visitExpr);
    }

    for (member in module.members) {
      if (found)
        break;
      switch member {
        case MClass(cl, params, fields):
          for (param in params)
            visitType(param);
          visitType(cl.init == null ? null : cl.init.t);
          for (field in fields) {
            visitType(field.type);
            visitExpr(field.expr);
            if (found)
              break;
          }
        case MEnum(et, params):
          for (param in params)
            visitType(param);
          for (_ => ctor in et.constructs)
            visitType(ctor.type);
        case MType(def, params):
          for (param in params)
            visitType(param);
          visitType(def.type);
        case MMain(e):
          visitExpr(e);
      }
    }
    return found;
  }

  static function dependenciesUseJsonTypes(deps: Dependencies): Bool {
    for (path => _ in deps.imports) {
      if (isJsonTypeModule(path))
        return true;
    }
    return false;
  }

  static function typeUsesJsonTypes(t: Type): Bool {
    return typeUsesJsonTypesWithSeen(t, []);
  }

  static function typeUsesJsonTypesWithSeen(t: Type, seen: Map<String, Bool>): Bool {
    if (t == null)
      return false;
    return switch t {
      case TAbstract(_.get() => abstractType, params):
        final key = 'abstract:' + abstractType.module + ':' + abstractType.name;
        if (seen.exists(key))
          false;
        else {
          seen.set(key, true);
          isJsonTypeModule(abstractType.module)
            || params.exists(param -> typeUsesJsonTypesWithSeen(param, seen))
            || typeUsesJsonTypesWithSeen(abstractType.type, seen);
        }
      case TInst(_.get() => cl, params):
        isJsonTypeModule(cl.module)
          || params.exists(param -> typeUsesJsonTypesWithSeen(param, seen));
      case TEnum(_.get() => et, params):
        isJsonTypeModule(et.module)
          || params.exists(param -> typeUsesJsonTypesWithSeen(param, seen));
      case TType(_.get() => def, params):
        final key = 'typedef:' + def.module + ':' + def.name;
        if (seen.exists(key))
          false;
        else {
          seen.set(key, true);
          isJsonTypeModule(def.module)
            || params.exists(param -> typeUsesJsonTypesWithSeen(param, seen))
            || typeUsesJsonTypesWithSeen(def.type, seen);
        }
      case TAnonymous(_.get() => anon):
        anon.fields.exists(field -> typeUsesJsonTypesWithSeen(field.type, seen));
      case TFun(args, ret):
        typeUsesJsonTypesWithSeen(ret, seen)
          || args.exists(arg -> typeUsesJsonTypesWithSeen(arg.t, seen));
      case TDynamic(inner):
        inner != null && typeUsesJsonTypesWithSeen(inner, seen);
      case TMono(ref):
        final inner = ref.get();
        inner != null && typeUsesJsonTypesWithSeen(inner, seen);
      case TLazy(f):
        typeUsesJsonTypesWithSeen(f(), seen);
    }
  }

  static function isJsonTypeModule(module: String): Bool {
    return module == 'genes.ts.JsonValue'
      || module == 'genes.ts.JsonObject'
      || module == 'genes.ts.JsonArray'
      || module == 'genes.ts.JsonPrimitive'
      || module == 'genes.ts.JsonNonNullValue';
  }

  static function moduleUsesReactJsxMarkers(module: Module): Bool {
    var found = false;
    function visitExpr(e: TypedExpr) {
      if (found || e == null)
        return;
      if (isReactJsxMarkerCallExpr(e)) {
        found = true;
        return;
      }
      e.iter(visitExpr);
    }
    for (member in module.members) {
      if (found)
        break;
      switch member {
        case MClass(cl, _, fields):
          for (field in fields) {
            visitExpr(field.expr);
            if (found)
              break;
          }
          visitExpr(cl.init);
        case MMain(e):
          visitExpr(e);
        case _:
      }
    }
    return found;
  }

  static function isReactJsxMarkerCallExpr(e: TypedExpr): Bool {
    return switch unwrapExpr(e).expr {
      case TCall(callee, _):
        isReactJsxMarkerCallee(callee) != null;
      default:
        false;
    }
  }

  static function isReactJsxMarkerCallee(callee: TypedExpr): Null<String> {
    return switch unwrapExpr(callee).expr {
      case TField(_, FStatic(_.get() => cl, _.get() => {name: name}))
        if (cl.pack.join('.') == 'genes.react.internal' && cl.name == 'Jsx'
          && (name == '__jsx' || name == '__frag')):
        name;
      default:
        null;
    }
  }

  static function unwrapExpr(e: TypedExpr): TypedExpr {
    var cur = e;
    while (cur != null) {
      switch cur.expr {
        case TMeta(_, e1):
          cur = e1;
        case TCast(e1, null):
          cur = e1;
        case TParenthesis(e1):
          cur = e1;
        default:
          return cur;
      }
    }
    return e;
  }

  static function jsSyntaxCodeTemplate(e: TypedExpr): Null<String> {
    return switch unwrapExpr(e).expr {
      case TCall({
        expr: TField(_,
          FStatic(_.get() => {module: 'js.Syntax'}, _.get() => {name: 'code'}))
      }, args) if (args.length > 1):
        switch args[0].expr {
          case TConst(TString(template)):
            template;
          default:
            null;
        }
      default:
        null;
    }
  }

  static function receiverNeedsRawSyntaxParens(e: TypedExpr): Bool {
    final template = jsSyntaxCodeTemplate(e);
    if (template == null)
      return false;

    // Raw syntax placeholder templates are emitted as the author wrote them.
    // When such a template becomes the receiver of `[]` or `.`, TypeScript
    // precedence would otherwise bind the access to the template's rightmost
    // operand, e.g. `{0} ?? null[0]`. Parenthesize every non-trivial placeholder
    // template receiver rather than maintaining a partial TS precedence parser.
    return StringTools.trim(template) != "{0}";
  }

  static function mergeDepsInto(into: Dependencies, from: Dependencies) {
    for (path => imports in from.imports) {
      for (dep in imports) {
        final isAutoAlias = dep.alias != null && dep.alias.length > 3
          && dep.alias.startsWith(dep.name + "__");
        into.push(path, {
          type: dep.type,
          name: dep.name,
          external: dep.external,
          path: dep.path,
          // Preserve explicit aliases (e.g. `import X in Y;`) but let merged dependency
          // analysis recompute auto-aliases (`Foo__1`, `Foo__2`, ...) deterministically.
          alias: isAutoAlias ? null : dep.alias,
          importAttributeType: dep.importAttributeType,
          pos: dep.pos
        });
      }
    }
  }

  function emitTsImports(where: String,
      imports: Array<genes.Dependencies.Dependency>, extension: Null<String>,
      typeOnly: Bool) {
    final namedGroups: Array<Array<genes.Dependencies.Dependency>> = [];
    for (def in imports)
      switch def.type {
        case genes.Dependencies.DependencyType.DAsterisk | genes.Dependencies.DependencyType.DDefault:
          emitTsImport([def], where, extension, typeOnly);
        default:
          var group = namedGroups.find(group ->
            group[0].importAttributeType == def.importAttributeType);
          if (group == null) {
            group = [];
            namedGroups.push(group);
          }
          group.push(def);
      }
    for (named in namedGroups)
      if (named.length > 0)
        emitTsImport(named, where, extension, typeOnly);
  }

  function emitTsImport(what: Array<genes.Dependencies.Dependency>,
      where: String, extension: Null<String>, typeOnly: Bool) {
    write(typeOnly ? 'import type' : 'import');
    writeSpace();
    switch what {
      case [def = {type: genes.Dependencies.DependencyType.DAsterisk}]:
        emitPos(def.pos);
        write('* as ' + if (def.alias != null) def.alias else def.name);
      case [def = {type: genes.Dependencies.DependencyType.DDefault}]:
        emitPos(def.pos);
        write(if (def.alias != null) def.alias else def.name);
      case defs:
        write('{');
        for (def in join(defs, write.bind(', '))) {
          emitPos(def.pos);
          write(def.name
            + if (def.alias != null && def.alias != def.name)
              ' as ${def.alias}' else '');
        }
        write('}');
    }
    writeSpace();
    write('from');
    writeSpace();
    var isExternal = false;
    for (dependency in what)
      if (dependency.external) {
        isExternal = true;
        break;
      }
    emitString(if (!isExternal && extension != null) '$where$extension' else
      where);
    final importAttributeType = commonImportAttributeType(what);
    if (!typeOnly && importAttributeType != null) {
      write(' with { type: ');
      emitString(importAttributeType);
      write(' }');
    }
    writeNewline();
  }

  function commonImportAttributeType(what: Array<genes.Dependencies.Dependency>): Null<String> {
    var result: Null<String> = null;
    for (dependency in what) {
      if (dependency.importAttributeType == null)
        continue;
      if (result == null)
        result = dependency.importAttributeType;
      else if (result != dependency.importAttributeType)
        return null;
    }
    return result;
  }

  function emitTsStatics(checkCycles: (module: String) -> Bool, cl: ClassType,
      fields: Array<GenesField>) {
    // Emit typed declarations inside the class (for TS), then reuse JS emitter's
    // static initialization logic outside the class.
    //
    // NOTE: This is intentionally conservative to avoid semantic changes.
    // We only declare static fields here; actual initialization remains outside.

    // No-op for now: declarations are emitted in emitTsClass.
    super.emitStatics(checkCycles, cl, fields);
  }

  override function emitStatic(cl: ClassType, field: GenesField) {
    // Some TS special-cases for strict type-checking.
    // `unique symbol` statics must be `readonly`, but Haxe emits assignments after
    // the class body. Keep runtime behavior but silence TS on that assignment.
    if (field.tsType == 'unique symbol') {
      writeNewline();
      write('// @ts-ignore');
      writeNewline();
      emitPos(field.pos);
      emitIdent(TypeUtil.className(cl));
      emitField(staticName(cl, field));
      write(' = ');
      emitValue(field.expr);
      return;
    }
    super.emitStatic(cl, field);
  }

  override function emitCall(e: TypedExpr, params: Array<TypedExpr>,
      inValue: Bool) {
    final privateMethod = privateMethodCall(e);
    if (privateMethod != null) {
      emitPrivateMethodCall(privateMethod, params);
      return;
    }
    switch [e.expr, params] {
      case [TConst(TSuper), args]:
        // Constructors (`new`) are implemented via the `[Register.new]` runtime
        // initializer. In TS output we still emit a normal `constructor`, but
        // `super(...)` calls inside Haxe constructor bodies must target the
        // initializer chain.
        emitPos(e.pos);
        switch extendsExtern {
          case Some(t):
            write(ctx.typeAccessor(t));
            write(args.length > 0 ? '.call(this, ' : '.call(this');
          case None:
            // `[Register.new]` overload signatures are intentionally typed as
            // uncallable (`never[]`) to avoid forcing TS constructor signature
            // compatibility across inheritance. Use an unsafe cast here to
            // call the super initializer without leaking `any`.
            write(ctx.typeAccessor(TypeUtil.registerType));
            write('.unsafeCast<Function>(');
            write('super[');
            write(ctx.typeAccessor(TypeUtil.registerType));
            write('.new]');
            write(').call(this');
            if (args.length > 0) write(', ');
        }
        for (param in join(args, write.bind(', ')))
          emitValue(param);
        write(')');
        return;
      default:
    }
    final marker = isReactJsxMarkerCallee(e);
    if (marker != null) {
      switch marker {
        case '__jsx':
          emitReactJsxElement(params);
        case '__frag':
          emitReactJsxFragment(params);
        default:
      }
      return;
    }
    // If a nullable value is passed to a non-nullable parameter, TS `strict`
    // errors even though Haxe commonly allows this (not null-safe by default).
    // Preserve Haxe semantics by inserting an unsafe cast at the call-site.
    //
    // We only do this for "plain" calls to avoid bypassing special call
    // lowering in the JS emitter (`js.Syntax.*`, feature macros, etc).
    final isEnumCtorCall = switch unwrapExpr(e).expr {
      case TField(_, FEnum(_, _)): true;
      default: false;
    }
    final fnType = haxe.macro.Context.followWithAbstracts(e.t);
    final args = switch fnType {
      case TFun(a, _): a;
      default: null;
    }
    final cachedArgTsTypes = cachedCallableArgTsTypes(e);
    if (params.length > 0) {
      inline function isUnresolvedMono(t: Type): Bool
        return switch t {
          case TMono(r): r.get() == null;
          default: false;
        }
      inline function isTypeParam(t: Type): Bool
        return switch t {
          case TInst(_.get() => {kind: KTypeParameter(_)}, _): true;
          default: false;
        }
      inline function isPromiseResolveNullThenable(actual: TypedExpr,
          expected: Type): Bool {
        return isJsPromiseResolveCallee(e)
          && isNullConst(unwrapExpr(actual)) && isPromiseThenableType(expected);
      }
      var needsCasts = false;
      if (isEnumCtorCall && params.exists(p -> isNullConst(unwrapExpr(p))))
        needsCasts = true;
      if (!needsCasts && args != null) {
        final max = params.length < args.length ? params.length : args.length;
        for (i in 0...max) {
          final expected = args[i].t;
          final actual = params[i];
          final actualUnwrapped = unwrapExpr(actual);
          if (isUnresolvedMono(expected) && isNullConst(actualUnwrapped)) {
            needsCasts = true;
            break;
          }
          // Reuse the branch-local null facts gathered from the surrounding
          // condition. TS understands the same direct local/field guard, so a
          // guarded value can flow to a non-nullable parameter without an
          // emitter-inserted assertion.
          if (!typeAllowsNull(expected)
            && typeAllowsNull(actual.t)
            && !isPromiseResolveNullThenable(actual, expected)
            && !isNarrowedNonNull(actual)) {
            needsCasts = true;
            break;
          }
        }
      }
      if (!needsCasts && cachedArgTsTypes.length > 0) {
        final max = params.length < cachedArgTsTypes.length ? params.length : cachedArgTsTypes.length;
        for (i in 0...max) {
          final expectedTsType = cachedArgTsTypes[i];
          if (expectedTsType != null && needsEnumAbstractExpectedAssertion(expectedTsType,
            params[i])) {
            needsCasts = true;
            break;
          }
        }
      }
      final isPlainCall = switch unwrapExpr(e).expr {
        case TIdent('`trace' | "__resources__" | "__new__" | "__instanceof__" | "__typeof__" | "__strict_eq__" | "__strict_neq__" | "__define_feature__" | "__feature__"):
          false;
        case TCall(_, _):
          false;
        case TField(_,
          FStatic(_.get() => {module: 'js.Syntax'}, _.get() => {name: _})):
          false;
        default:
          true;
      }
      if (needsCasts && isPlainCall) {
        emitPos(e.pos);
        emitValue(e);
        write('(');
        for (i in 0...params.length) {
          if (i > 0)
            write(', ');
          final expected = args != null && i < args.length ? args[i].t : null;
          final expectedTsType = i < cachedArgTsTypes.length ? cachedArgTsTypes[i] : null;
          final actual = params[i];
          final actualUnwrapped = unwrapExpr(actual);
          if (expectedTsType != null && needsEnumAbstractExpectedAssertion(expectedTsType,
            actual)) {
            write('(');
            emitValue(actual);
            write(' as ');
            write(expectedTsType);
            write(')');
          } else if (expected != null && isUnresolvedMono(expected)
            && isNullConst(unwrapExpr(actual))) {
            // Avoid TS inferring `null` for unconstrained generic params.
            // `never` keeps the call assignable without introducing `any`.
            write(ctx.typeAccessor(TypeUtil.registerType));
            write('.unsafeCast<never>(null)');
          } else if (isEnumCtorCall && isNullConst(actualUnwrapped)
            && (expected == null || typeAllowsNull(expected))) {
            // Enum constructors are often used with `null` (e.g. `Noise`). Casting
            // to `never` avoids TS inferring `null` for generic params.
            write(ctx.typeAccessor(TypeUtil.registerType));
            write('.unsafeCast<never>(null)');
          } else if (expected != null
            && !typeAllowsNull(expected)
            && typeAllowsNull(actual.t)
            && !isPromiseResolveNullThenable(actual, expected)
            && !isNarrowedNonNull(actual)
            && !isTypeParam(expected)) {
            // If the expected type is `any`, a cast is unnecessary and emitting
            // `<any>` would violate the typing policy for user modules.
            if (typeEmitsAny(expected)) {
              emitValue(actual);
            } else {
              write(ctx.typeAccessor(TypeUtil.registerType));
              write('.unsafeCast<');
              TypeEmitter.emitType(this, expected);
              write('>(');
              emitValue(actual);
              write(')');
            }
          } else {
            emitValue(actual);
          }
        }
        write(')');
        return;
      }
    }
    if (isJsPromiseResolveCallee(e)
      && params.exists(param -> isNullConst(unwrapExpr(param)))) {
      emitPromiseResolveCall(e, params, inValue);
    } else {
      super.emitCall(e, params, inValue);
    }
  }

  function emitPromiseResolveCall(e: TypedExpr, params: Array<TypedExpr>,
      inValue: Bool) {
    final previous = suppressPromiseResolveNullThenableCast;
    suppressPromiseResolveNullThenableCast = true;
    super.emitCall(e, params, inValue);
    suppressPromiseResolveNullThenableCast = previous;
  }

  function emitReactJsxElement(args: Array<TypedExpr>) {
    if (args.length != 3)
      haxe.macro.Context.error('Invalid JSX marker call',
        args.length > 0 ? args[0].pos : haxe.macro.Context.currentPos());

    final tag = args[0];
    final props = parseJsxProps(args[1]);
    final children = parseJsxChildren(args[2]);

    if (jsxEmitTsx)
      emitTsxElement(tag, props, children);
    else
      emitCreateElement(tag, props, children);
  }

  function emitReactJsxFragment(args: Array<TypedExpr>) {
    if (args.length != 1)
      haxe.macro.Context.error('Invalid JSX fragment marker call',
        args.length > 0 ? args[0].pos : haxe.macro.Context.currentPos());

    final children = parseJsxChildren(args[0]);
    if (jsxEmitTsx)
      emitTsxFragment(children);
    else
      emitCreateElementFragment(children);
  }

  function parseJsxChildren(e: TypedExpr): Array<TypedExpr> {
    return switch unwrapExpr(e).expr {
      case TArrayDecl(el):
        el;
      case TConst(TNull):
        [];
      default:
        haxe.macro.Context.error('Invalid JSX marker children; expected an array literal',
          e.pos);
    }
  }

  function parseJsxProps(e: TypedExpr): Array<ReactJsxProp> {
    return switch unwrapExpr(e).expr {
      case TArrayDecl(el):
        el.map(parseJsxPropEntry);
      case TConst(TNull):
        [];
      default:
        haxe.macro.Context.error('Invalid JSX marker props; expected an array literal',
          e.pos);
    }
  }

  function parseJsxPropEntry(e: TypedExpr): ReactJsxProp {
    return switch unwrapExpr(e).expr {
      case TObjectDecl(fields):
        var name: Null<String> = null;
        var value: Null<TypedExpr> = null;
        var spread: Null<TypedExpr> = null;
        for (f in fields) {
          switch f.name {
            case 'name':
              switch unwrapExpr(f.expr).expr {
                case TConst(TString(s)):
                  name = s;
                default:
                  haxe.macro.Context.error('JSX prop entry `name` must be a string literal',
                    f.expr.pos);
              }
            case 'value':
              value = f.expr;
            case 'spread':
              spread = f.expr;
            case _:
          }
        }
        if (spread != null)
          return Spread(spread);
        if (name == null || value == null)
          haxe.macro.Context.error('Invalid JSX prop entry', e.pos);
        return Normal(name, value);
      default:
        haxe.macro.Context.error('Invalid JSX prop entry; expected an object literal',
          e.pos);
    }
  }

  function emitTsxFragment(children: Array<TypedExpr>) {
    write('<>');
    emitTsxChildren(children);
    write('</>');
  }

  function emitTsxElement(tag: TypedExpr, props: Array<ReactJsxProp>,
      children: Array<TypedExpr>) {
    write('<');
    emitTsxTagName(tag);
    emitTsxAttributes(props);
    if (children.length == 0) {
      write(' />');
      return;
    }
    write('>');
    emitTsxChildren(children);
    write('</');
    emitTsxTagName(tag);
    write('>');
  }

  function emitTsxTagName(tag: TypedExpr) {
    switch unwrapExpr(tag).expr {
      case TConst(TString(s)):
        write(s);
      default:
        emitValue(tag);
    }
  }

  function emitTsxAttributes(props: Array<ReactJsxProp>) {
    for (p in props) {
      switch p {
        case Spread(e):
          write(' {...');
          emitValue(e);
          write('}');
        case Normal(name, value):
          write(' ');
          write(name);
          switch unwrapExpr(value).expr {
            case TConst(TBool(true)):
              // Boolean attribute shorthand.
            case TConst(TString(s)):
              write('=');
              emitString(s);
            default:
              write('={');
              emitValue(value);
              write('}');
          }
      }
    }
  }

  function emitTsxChildren(children: Array<TypedExpr>) {
    for (child in children) {
      if (isReactJsxMarkerCallExpr(child)) {
        emitValue(child);
        continue;
      }
      switch unwrapExpr(child).expr {
        case TConst(TString(s)):
          write(s);
        default:
          write('{');
          emitValue(child);
          write('}');
      }
    }
  }

  function emitCreateElement(tag: TypedExpr, props: Array<ReactJsxProp>,
      children: Array<TypedExpr>) {
    write(JSX_REACT_IMPORT);
    write('.createElement(');
    emitValue(tag);
    write(', ');
    emitCreateElementProps(tag, props);
    for (child in children) {
      write(', ');
      emitValue(child);
    }
    write(')');
  }

  function emitCreateElementFragment(children: Array<TypedExpr>) {
    write(JSX_REACT_IMPORT);
    write('.createElement(');
    write(JSX_REACT_IMPORT);
    write('.Fragment, null');
    for (child in children) {
      write(', ');
      emitValue(child);
    }
    write(')');
  }

  function emitCreateElementProps(tag: TypedExpr, props: Array<ReactJsxProp>) {
    if (props.length == 0) {
      write('null');
      return;
    }
    write('(');
    write('{');
    for (p in join(props, write.bind(', '))) {
      switch p {
        case Spread(e):
          write('...');
          emitValue(e);
        case Normal(name, value):
          emitObjectKey(name);
          write(': ');
          emitValue(value);
      }
    }
    write('}');
    write(' satisfies ');
    write('(');
    write(JSX_REACT_IMPORT);
    write('.ComponentPropsWithoutRef<');
    emitComponentPropsTypeArgForTag(tag);
    write('>');
    // In TSX, TypeScript allows `data-*` / `aria-*` attributes by default.
    // In low-level `createElement(...)` mode, we add explicit mapped types so
    // real-world attributes don't get blocked by excess property checks.
    write(' & { [K in `data-$${string}`]?: string | number | boolean | null | undefined }');
    write(' & { [K in `aria-$${string}`]?: string | number | boolean | null | undefined }');
    write(')');
    write(')');
  }

  function emitObjectKey(name: String) {
    if (isValidTsObjectKey(name)) {
      write(name);
      return;
    }
    emitString(name);
  }

  static function isValidTsObjectKey(name: String): Bool {
    if (name == null || name.length == 0)
      return false;
    final first = name.charCodeAt(0);
    if (!((first >= 'a'.code && first <= 'z'.code)
      || (first >= 'A'.code && first <= 'Z'.code)
      || first == '_'.code
      || first == '$'.code))
      return false;
    for (i in 1...name.length) {
      final c = name.charCodeAt(i);
      if (!((c >= 'a'.code && c <= 'z'.code)
        || (c >= 'A'.code && c <= 'Z'.code)
        || (c >= '0'.code && c <= '9'.code) || c == '_'.code || c == '$'.code))
        return false;
    }
    return true;
  }

  function emitComponentPropsTypeArgForTag(tag: TypedExpr) {
    switch unwrapExpr(tag).expr {
      case TConst(TString(s)):
        emitString(s);
      default:
        write('typeof ');
        emitValue(tag);
    }
  }

  function emitTsClass(checkCycles: (module: String) -> Bool, cl: ClassType,
      fields: Array<GenesField>) {
    final prevClass = currentClass;
    currentClass = cl;

    writeNewline();
    emitComment(cl.doc);
    emitPos(cl.pos);
    write('export class ');
    write(TypeUtil.className(cl));
    if (cl.params != null && cl.params.length > 0)
      emitTypeParamDecls(cl.params.map(p -> p.t), true);

    final extendsInherits = cl.superClass != null
      || JsModuleEmitter.hasConstructor(fields);
    if (extendsInherits) {
      write(' extends ');
      switch cl.superClass {
        case null:
          // Root classes still use `Register.inherits()` so we can share the same
          // `[Register.new]` initialization convention across the runtime.
          write(ctx.typeAccessor(TypeUtil.registerType));
          write('.inherits()');
        case {t: ref, params: superParams}:
          final t: ModuleType = TClassDecl(ref);
          final isCyclic = checkCycles(TypeUtil.moduleTypeModule(t));
          // Preserve Genes' runtime semantics (especially cycle handling) by
          // always extending a `Register.inherits(...)` base class. We then cast
          // to the concrete superclass type so TS can see inherited members.
          write('(');
          write(ctx.typeAccessor(TypeUtil.registerType));
          write('.inherits(');
          if (isCyclic)
            write('() => ');
          write(ctx.typeAccessor(t));
          if (isCyclic)
            write(', true');
          write(') as typeof ');
          write(ctx.typeAccessor(t));
          write(')');
          if (superParams != null)
            TypeEmitter.emitParams(this, superParams, false);
      }
    }

    extendsExtern = switch cl.superClass {
      case null: None;
      case {t: t = _.get() => {isExtern: true}}:
        Some(cl.superClass.t.get());
      default: None;
    }

    write(' {');
    increaseIndent();

    // Emit a typed TS constructor wrapper that forwards to `super(...)`.
    //
    // The actual Haxe initialization logic lives in `[Register.new](...)` and is
    // invoked by the `Register.inherits(...)` constructor at runtime. Having a
    // real TS `constructor` gives correct `new (...)` typing for consumers.
    if (extendsInherits) {
      final ctorField = fields.find(f -> f.kind.equals(Constructor));
      if (ctorField != null)
        switch ctorField.expr {
          case {expr: TFunction(f)}:
            final previousLocalScope = pushLocalNameScope();
            writeNewline();
            emitPos(ctorField.pos);
            write('constructor(');
            emitTypedFunctionArguments(f, ctorField);
            write(') {');
            increaseIndent();
            writeNewline();
            // Haxe constructors are routed through `Register.inherits(...)`
            // and `[Register.new]`. The superclass type may have an unrelated
            // TS constructor signature, so we silence `super(...)` arity/type
            // checks here while keeping the public constructor signature typed.
            if (cl.superClass != null) {
              write('// @ts-ignore');
              writeNewline();
            }
            write('super(');
            emitForwardArgs(f, ctorField);
            write(');');
            decreaseIndent();
            writeNewline();
            write('}');
            restoreLocalNameScope(previousLocalScope);
          default:
        }
    }

    // Emit typed property declarations so TS code can type-check under `strict`.
    for (field in fields) {
      switch field.kind {
        case Property:
          // Skip native accessors for now (handled by JS emitter behavior).
          // Still declare the property name as a field so TS knows it exists.
          writeNewline();
          emitPos(field.pos);
          write('declare ');
          if (field.isStatic) {
            if (field.tsType == 'unique symbol')
              write('static readonly ');
            else
              write('static ');
          }
          emitMemberName(field.isStatic ? staticName(cl,
            field) : moduleFieldName(field));
          write(': ');
          // Node vs DOM timer handles: `setInterval` return type varies by lib.
          // Model `haxe.Timer.id` as whatever the host `setInterval` returns.
          if (!field.isStatic
            && field.name == 'id'
            && cl.pack.join('.') == 'haxe'
            && cl.name == 'Timer') {
            write('ReturnType<typeof setInterval> | null');
          } else {
            emitFieldTsType(field);
          }
          write(';');
        case Method #if (haxe_ver >= 4.2) if (!field.isAbstract) #end:
          // Module-level externs (KModuleFields) can be declared as extern
          // functions (no body) with `@:jsRequire`. These appear as static
          // fields on the module fields class, so we declare them as function
          //-typed properties and bind them at runtime in the JS emitter.
          if (field.expr == null && field.isStatic && field.meta != null #if (haxe_ver >= 4.2)
            && cl.kind.match(KModuleFields(_)) #end
          ) {
            final hasJsRequire = switch field.meta.extract(':jsRequire') {
              case [_]: true;
              default: false;
            };
            if (!hasJsRequire)
              continue;
            writeNewline();
            emitPos(field.pos);
            write('declare static ');
            emitMemberName(staticName(cl, field));
            write(': ');
            emitType(field.type, field.params);
            write(';');
          }
        default:
      }
    }

    // Emit methods/ctors with typed args/returns.
    for (field in fields) {
      if (!shouldEmitClassMethod(cl, field))
        continue;
      switch field.kind {
        case Constructor | Method
          #if (haxe_ver >= 4.2) if (!field.isAbstract) #end:
          switch field.expr {
            case null:
            case {expr: TFunction(f)}:
              final previousLocalScope = pushLocalNameScope();
              writeNewline();
              if (field.doc != null)
                writeNewline();
              emitComment(field.doc);
              emitPos(field.pos);
              final isAsync = field.meta != null
                && (field.meta.has(':jsAsync') || field.meta.has('jsAsync'));
              if (field.isStatic) {
                write('static ');
                if (isAsync)
                  write('async ');
                emitMemberName(staticName(cl, field));
              } else if (field.kind.equals(Constructor)) {
                // Provide an overload signature for `[Register.new]` so
                // subclasses can have different constructor signatures without
                // triggering override incompatibilities in TS.
                //
                // We intentionally make this overload uncallable (`never[]`) to
                // keep `[Register.new]` an internal runtime convention; TS
                // consumers should use `new (...)`.
                write('[');
                write(ctx.typeAccessor(TypeUtil.registerType));
                write('.new](...args: never[]): void;');
                writeNewline();
                emitPos(field.pos);
                write('[');
                write(ctx.typeAccessor(TypeUtil.registerType));
                write('.new]');
              } else {
                if (isAsync)
                  write('async ');
                emitMemberName(moduleFieldName(field));
              }

              emitMethodTypeParams(field);
              write('(');
              emitTypedFunctionArguments(f, field);
              write(')');

              // Return type
              if (field.kind.equals(Constructor)) {
                write(': void ');
              } else {
                write(': ');
                emitReturnTsType(field, f, null);
                write(' ');
              }

              final body = getFunctionBody(f);
              final returnOverride = field.meta != null ? (switch extractStringMeta(field.meta,
                ':ts.returnType') {
                case null: extractStringMeta(field.meta, ':genes.returnType');
                case v: v;
              }) : null;
              final isRuntimeUnsafeCast = field.isStatic
                && field.name == 'unsafeCast'
                && cl.module == 'genes.Register' && cl.name == 'Register';
              if (isRuntimeUnsafeCast) {
                // `Register.unsafeCast` must be the identity function at runtime.
                // Avoid emitter-inserted casts causing infinite recursion here.
                write('{');
                increaseIndent();
                writeNewline();
                write('return ');
                if (f.args.length > 0)
                  emitLocalVar(f.args[0].v);
                else
                  write('undefined');
                write(';');
                decreaseIndent();
                writeNewline();
                write('}');
              } else {
                switch [returnOverride, body.expr] {
                  case [v, TBlock([])]
                    if (v != null
                      && v != 'any'
                      && v != 'void'
                      && v != 'undefined'):
                    // TS requires a return for non-void declared return types.
                    // Preserve JS runtime behavior by returning `undefined`.
                    write('{');
                    increaseIndent();
                    writeNewline();
                    write('return ');
                    write(ctx.typeAccessor(TypeUtil.registerType));
                    write('.unsafeCast<');
                    write(v);
                    write('>(undefined);');
                    decreaseIndent();
                    writeNewline();
                    write('}');
                  default:
                    final prevReturn = currentReturnType;
                    final prevVoidLike = currentReturnIsVoidLike;
                    currentReturnType = switch field.type {
                      case TFun(_, ret): ret;
                      default: null;
                    }
                    currentReturnIsVoidLike = switch returnOverride {
                      case "void" | "Promise<void>":
                        true;
                      default: currentReturnType != null && isVoidLike(currentReturnType);
                    }
                    emitExpr(body);
                    currentReturnType = prevReturn;
                    currentReturnIsVoidLike = prevVoidLike;
                }
              }
              restoreLocalNameScope(previousLocalScope);
            default:
          }
        default:
      }
    }

    // Keep Genes runtime identity helpers.
    writeNewline();
    write('static get __name__(): string {');
    increaseIndent();
    writeNewline();
    write('return ');
    emitString(cl.pack.concat([cl.name]).join('.'));
    decreaseIndent();
    writeNewline();
    write('}');

    switch cl.interfaces {
      case []:
      case v:
        writeNewline();
        write('static get __interfaces__(): Function[] {');
        increaseIndent();
        writeNewline();
        write('return [');
        for (i in join(v, write.bind(', ')))
          write(ctx.typeAccessor(i.t.get()));
        write(']');
        decreaseIndent();
        writeNewline();
        write('}');
    }

    switch cl.superClass {
      case null:
      case {t: TClassDecl(_) => t}:
        writeNewline();
        write('static get __super__(): Function {');
        increaseIndent();
        writeNewline();
        write('return ');
        write(ctx.typeAccessor(t));
        decreaseIndent();
        writeNewline();
        write('}');
    }

    writeNewline();
    write('get __class__(): Function {');
    increaseIndent();
    writeNewline();
    write('return ');
    emitIdent(TypeUtil.className(cl));
    decreaseIndent();
    writeNewline();
    write('}');

    decreaseIndent();
    writeNewline();
    write('}');

    emitPrivateMethodHelpers(cl, fields);

    // Register class in $hxClasses registry (Genes runtime compatibility).
    final id = cl.pack.concat([TypeUtil.className(cl)]).join('.');
    if (id != 'genes.Register'
      && !haxe.macro.Context.defined('genes.ts.minimal_runtime')) {
      writeNewline();
      write(ctx.typeAccessor(TypeUtil.registerType));
      write('.setHxClass(');
      emitString(id);
      write(', ');
      emitIdent(TypeUtil.className(cl));
      write(');');
      writeNewline();
    }

    // Ensure Haxe/Genes reflection works similarly to the JS emitter:
    // - instance vars should appear on the prototype for Type.getInstanceFields()
    // - native accessor properties should exist at runtime for Reflect.field()
    final className = TypeUtil.className(cl);
    for (field in fields) {
      if (!field.kind.equals(Property) || field.isStatic)
        continue;

      if (field.getter || field.setter) {
        writeNewline();
        write('Object.defineProperty(');
        emitIdent(className);
        write('.prototype, ');
        emitString(moduleFieldName(field));
        write(', {');
        increaseIndent();
        if (field.getter) {
          writeNewline();
          write('get: function (this: ');
          emitIdent(className);
          write(') { return this.get_');
          write(field.name);
          write('(); },');
        }
        if (field.setter) {
          writeNewline();
          write('set: function (this: ');
          emitIdent(className);
          write(', v: ');
          emitFieldTsType(field);
          write(') { this.set_');
          write(field.name);
          write('(v); },');
        }
        decreaseIndent();
        writeNewline();
        write('});');
        writeNewline();
      } else {
        writeNewline();
        write(ctx.typeAccessor(TypeUtil.registerType));
        write('.seedProtoField(');
        emitIdent(className);
        write(', ');
        emitString(moduleFieldName(field));
        write(');');
        writeNewline();
      }
    }

    currentClass = prevClass;
  }

  function emitPrivateMethodHelpers(cl: ClassType, fields: Array<GenesField>) {
    if (!canLowerPrivateMethods(cl))
      return;
    for (field in fields) {
      if (!canLowerPrivateStaticGenesField(cl, field))
        continue;
      if (isPrivateStaticMain(field))
        continue;
      #if (haxe_ver >= 4.2)
      if (field.isAbstract)
        continue;
      #end
      switch field.expr {
        case {expr: TFunction(f)}:
          final previousLocalScope = pushLocalNameScope();
          writeNewline();
          if (field.doc != null)
            writeNewline();
          emitComment(field.doc);
          emitPos(field.pos);
          final isAsync = field.meta != null
            && (field.meta.has(':jsAsync') || field.meta.has('jsAsync'));
          if (isAsync)
            write('async ');
          write('function ');
          final helperName = privateMethodHelperName(cl, field.name);
          write(helperName);
          emitMethodTypeParams(field);
          write('(');
          emitTypedFunctionArguments(f, field);
          write('): ');
          emitReturnTsType(field, f, null);
          write(' ');
          final prevReturn = currentReturnType;
          final prevVoidLike = currentReturnIsVoidLike;
          currentReturnType = switch field.type {
            case TFun(_, ret): ret;
            default: null;
          }
          currentReturnIsVoidLike = currentReturnType != null
            && isVoidLike(currentReturnType);
          emitExpr(getFunctionBody(f));
          currentReturnType = prevReturn;
          currentReturnIsVoidLike = prevVoidLike;
          restoreLocalNameScope(previousLocalScope);
          emitPrivateMethodRuntimeAssignment(cl, field, helperName);
        default:
      }
    }
  }

  function emitPrivateMethodRuntimeAssignment(cl: ClassType, field: GenesField,
      helperName: String) {
    writeNewline();
    write(ctx.typeAccessor(TypeUtil.registerType));
    write('.unsafeCast<{');
    emitMemberName(moduleFieldName(field));
    write(': typeof ');
    write(helperName);
    write('}>(');
    emitIdent(TypeUtil.className(cl));
    write(')');
    emitField(moduleFieldName(field));
    write(' = ');
    write(helperName);
    write(';');
  }

  function emitMethodTypeParams(field: GenesField) {
    if (field.params == null || field.params.length == 0)
      return;
    emitTypeParamDecls(field.params.map(p -> p.t), true);
  }

  function emitTypeParamDecls(params: Array<Type>, withConstraints: Bool) {
    if (params.length == 0)
      return;
    write('<');
    for (param in join(params, write.bind(', '))) {
      switch param {
        case TInst(_.get() => {kind: KTypeParameter(constraints)}, _):
          // Use TypeEmitter so `@:ts.type` / `@:genes.type` overrides apply even
          // on type parameter names (see tests/TestTsTypes.hx expectations).
          TypeEmitter.emitType(this, param);
          if (withConstraints && constraints.length > 0) {
            write(' extends ');
            for (c in join(constraints, write.bind(' & ')))
              TypeEmitter.emitType(this, c);
          }
        default:
          // Fallback: best-effort rendering.
          TypeEmitter.emitType(this, param);
      }
    }
    write('>');
  }

  static inline function typeParamKey(param: Type): Null<String> {
    return switch param {
      case TInst(ref, _):
        final cl = ref.get();
        switch cl.kind {
          case KTypeParameter(_): cl.module + '.' + cl.name;
          default: null;
        }
      default:
        null;
    }
  }

  static function collectUsedTypeParamKeys(type: Type,
      used: Map<String, Bool>) {
    final followed = haxe.macro.Context.followWithAbstracts(type);
    switch followed {
      case TInst(ref, params):
        final cl = ref.get();
        switch cl.kind {
          case KTypeParameter(_):
            used.set(cl.module + '.' + cl.name, true);
          default:
        }
        for (p in params)
          collectUsedTypeParamKeys(p, used);
      case TEnum(_, params) | TType(_, params) | TAbstract(_, params):
        for (p in params)
          collectUsedTypeParamKeys(p, used);
      case TFun(args, ret):
        for (a in args)
          collectUsedTypeParamKeys(a.t, used);
        collectUsedTypeParamKeys(ret, used);
      case TAnonymous(a):
        for (f in a.get().fields)
          collectUsedTypeParamKeys(f.type, used);
      case TDynamic(t):
        if (t != null)
          collectUsedTypeParamKeys(t, used);
      case TMono(r):
        final inner = r.get();
        if (inner != null)
          collectUsedTypeParamKeys(inner, used);
      default:
    }
  }

  function emitTypeParamDeclsUnusedNever(params: Array<Type>,
      withConstraints: Bool, used: Map<String, Bool>, tsxSafe: Bool) {
    if (params.length == 0)
      return;
    write('<');
    var first = true;
    var seenDefault = false;
    for (param in params) {
      if (!first)
        write(', ');
      first = false;
      final key = typeParamKey(param);
      final defaultNever = key != null && !used.exists(key);
      final needsDefault = defaultNever || seenDefault;
      switch param {
        case TInst(_.get() => {kind: KTypeParameter(constraints)}, _):
          TypeEmitter.emitType(this, param);
          if (withConstraints && constraints.length > 0) {
            write(' extends ');
            for (c in join(constraints, write.bind(' & ')))
              TypeEmitter.emitType(this, c);
          }
        default:
          TypeEmitter.emitType(this, param);
      }
      if (needsDefault) {
        write(' = never');
        seenDefault = true;
      }
    }
    if (tsxSafe && jsxEmitTsx && params.length == 1)
      write(',');
    write('>');
  }

  function emitTypeParamDeclsTsxSafe(params: Array<Type>,
      withConstraints: Bool) {
    if (params.length == 0)
      return;
    write('<');
    var first = true;
    for (param in params) {
      if (!first)
        write(', ');
      first = false;
      switch param {
        case TInst(_.get() => {kind: KTypeParameter(constraints)}, _):
          TypeEmitter.emitType(this, param);
          if (withConstraints && constraints.length > 0) {
            write(' extends ');
            for (c in join(constraints, write.bind(' & ')))
              TypeEmitter.emitType(this, c);
          }
        default:
          TypeEmitter.emitType(this, param);
      }
    }
    // In TSX files, a single-type-param arrow function needs a trailing comma
    // to disambiguate from JSX (`<T,>(x) => ...`).
    if (jsxEmitTsx && params.length == 1)
      write(',');
    write('>');
  }

  /**
   * Emit type parameters for enum constructor *types*.
   *
   * Constructor-specific type params cannot be left "free" in TS type aliases,
   * so we give them a `never` default to allow referencing the constructor type
   * with only the enum's own parameters.
   */
  function emitEnumCtorTypeParamDecls(enumParams: Array<Type>,
      ctorParams: Array<Type>, withConstraints: Bool) {
    if ((enumParams == null || enumParams.length == 0)
      && (ctorParams == null || ctorParams.length == 0))
      return;
    write('<');
    var first = true;
    inline function emitOne(param: Type, defaultValue: Null<String>) {
      if (!first)
        write(', ');
      first = false;
      switch param {
        case TInst(_.get() => {kind: KTypeParameter(constraints)}, _):
          TypeEmitter.emitType(this, param);
          if (withConstraints && constraints.length > 0) {
            write(' extends ');
            for (c in join(constraints, write.bind(' & ')))
              TypeEmitter.emitType(this, c);
          }
        default:
          TypeEmitter.emitType(this, param);
      }
      if (defaultValue != null) {
        write(' = ');
        write(defaultValue);
      }
    }
    if (enumParams != null) {
      for (param in enumParams)
        emitOne(param, null);
    }
    if (ctorParams != null) {
      for (param in ctorParams)
        emitOne(param, 'never');
    }
    write('>');
  }

  override public function emitVar(v: TVar, eo: Null<TypedExpr>) {
    // Haxe often creates `_g` temporaries while lowering loops. If such a temp
    // is initialized from an optional field already narrowed by a null guard,
    // emit the temp as non-null so generated TS matches the guarded branch.
    final narrowedOptionalInit = eo != null
      && isGeneratedTempLocal(v.name)
      && typeAllowsNull(v.t)
      && isNarrowedOptionalField(eo);
    final narrowedNonNullInit = eo != null && typeAllowsNull(v.t)
      && isNarrowedNonNull(eo);
    final emittedType = (narrowedOptionalInit || narrowedNonNullInit) ? stripNull(v.t) : v.t;
    final emittedTypeOverride = (narrowedOptionalInit || narrowedNonNullInit) ? null : localTsTypeOverride(eo);
    if (emittedTypeOverride != null)
      localTsTypeOverrides.set(v.id, emittedTypeOverride);
    final mapKeysOrigin = eo == null ? null : mapKeysIteratorOrigin(eo);
    if (mapKeysOrigin != null)
      mapKeyIteratorOrigins.set(v.id, mapKeysOrigin);
    final mapKeyOrigin = eo == null ? null : mapIteratorNextOrigin(eo);
    if (mapKeyOrigin != null)
      mapKeyLocalOrigins.set(v.id, mapKeyOrigin);
    write('$declare ');
    emitLocalVar(v);
    write(': ');
    emitLocalType(emittedType, emittedTypeOverride);
    switch (eo) {
      case null:
      case {expr: TConst(TNull)}:
        if (typeAllowsNull(emittedType)) {
          write(' = null');
        } else {
          // A non-nullable local initialized with `null` is an intentional
          // Haxe pattern for later assignment, commonly used for mutually
          // recursive callbacks. TypeScript's non-null assertion keeps the
          // runtime value as plain `null` without routing through Register.
          write(' = null!');
        }
      case e:
        write(' = ');
        if (tryEmitReactUseStateCall(v.t, e)) {
          return;
        }
        if (!narrowedOptionalInit && !narrowedNonNullInit && !isNarrowedNonNull(e)
          && !isUndefinableType(emittedType) && !typeAllowsNull(emittedType)
          && typeAllowsNull(e.t)) {
          write(ctx.typeAccessor(TypeUtil.registerType));
          write('.unsafeCast<');
          emitLocalType(emittedType, emittedTypeOverride);
          write('>(');
          emitValueWithExpectedType(emittedType, e);
          write(')');
        } else {
          emitValueWithExpectedType(emittedType, e);
        }
    }
  }

  /**
   * Reuses declaration-time TS literal unions for locals whose Haxe expression
   * type has already widened to the enum abstract's primitive representation.
   *
   * Why: Haxe enum abstracts erase to their underlying primitive in many typed
   * expression positions, so locals such as `final mode: Mode = choose()` or
   * `final mode: Mode = record.mode` can arrive here as `String` even though the
   * declaration that produced the value is emitted as `"a" | "b"`. TypeScript
   * then rejects passing that local to a parameter that still has the literal
   * union type.
   *
   * What: when the initializer is a call to a cached method, a cached class
   * field read, or an anonymous typedef field read, use the cached TS type for
   * the local annotation. The expression itself is unchanged, and classic JS
   * output is unaffected because this logic lives only in the TS emitter.
   *
   * How: `SignatureCache` records enum-abstract literal unions during
   * `onAfterTyping`, before later compiler phases follow abstracts. This helper
   * bridges that declaration-time fact back into local variable emission.
   */
  function localTsTypeOverride(eo: Null<TypedExpr>): Null<String> {
    if (eo == null)
      return null;
    if (isExceptionCaughtUnwrap(eo))
      return '{} | null | undefined';
    return cachedInitializerTsType(eo);
  }

  /**
   * Detects Haxe's lowered representation of typed catch values.
   *
   * Why: source such as `catch (error:MyError)` is lowered by Haxe to one
   * JavaScript catch variable, then `haxe.Exception.caught(raw).unwrap()` plus
   * runtime type guards for each typed catch arm. The lowered temporary has
   * Haxe type `Dynamic`, which would normally emit as TypeScript `any` in the
   * user module.
   *
   * What/How: when a local initializer is exactly the exception unwrap
   * sequence, annotate the local as `{ } | null | undefined`. That is the
   * broadest useful TypeScript surface that can still contain primitive throws,
   * object throws, and nullish throws without spelling `any` or `unknown` in a
   * user module. TypeScript can then narrow the value with the emitted
   * `typeof`/`instanceof` checks before assigning it to the typed catch
   * variable, while arbitrary `Dynamic` values elsewhere keep their normal Haxe
   * semantics.
   */
  static function isExceptionCaughtUnwrap(expr: TypedExpr): Bool {
    return switch unwrapExpr(expr).expr {
      case TCall(unwrapCallee, []) if (isExceptionUnwrapCallee(unwrapCallee)):
        true;
      default:
        false;
    }
  }

  static function isExceptionUnwrapCallee(callee: TypedExpr): Bool {
    return switch unwrapExpr(callee).expr {
      case TField(receiver, field) if (fieldAccessName(field) == 'unwrap'):
        isExceptionCaughtCall(receiver);
      default:
        false;
    }
  }

  static function isExceptionCaughtCall(expr: TypedExpr): Bool {
    return switch unwrapExpr(expr).expr {
      case TCall(caughtCallee, [_]) if (isExceptionCaughtCallee(caughtCallee)):
        true;
      default:
        false;
    }
  }

  static function isExceptionCaughtCallee(callee: TypedExpr): Bool {
    return switch unwrapExpr(callee).expr {
      case TField(_,
        FStatic(_.get() => {module: 'haxe.Exception', name: 'Exception'},
          _.get() => {name: 'caught'})):
        true;
      default:
        false;
    }
  }

  function cachedInitializerTsType(expr: TypedExpr): Null<String> {
    return switch expr.expr {
      case TCall(callee, _):
        cachedCallableReturnTsType(callee);
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, _):
        cachedInitializerTsType(inner);
      default:
        cachedFieldValueTsType(expr);
    }
  }

  function cachedCallableReturnTsType(expr: TypedExpr): Null<String> {
    return switch expr.expr {
      case TField(_, FStatic(_.get() => cl, _.get() => field)):
        final sig = SignatureCache.getSig(cl, true, field.name);
        sig == null ? null : sig.retTsType;
      case TField(_, FInstance(_.get() => cl, _, _.get() => field)):
        final sig = SignatureCache.getSig(cl, false, field.name);
        sig == null ? null : sig.retTsType;
      case TField(_, FClosure({c: _.get() => cl}, _.get() => field)):
        final sig = SignatureCache.getSig(cl, false, field.name);
        sig == null ? null : sig.retTsType;
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, _):
        cachedCallableReturnTsType(inner);
      default:
        null;
    }
  }

  function cachedCallableArgTsTypes(expr: TypedExpr): Array<Null<String>> {
    return switch expr.expr {
      case TField(_, FStatic(_.get() => cl, _.get() => field)):
        final sig = SignatureCache.getSig(cl, true, field.name);
        sig == null ? [] : [for (arg in sig.args) arg.tsType];
      case TField(_, FInstance(_.get() => cl, _, _.get() => field)):
        final sig = SignatureCache.getSig(cl, false, field.name);
        sig == null ? [] : [for (arg in sig.args) arg.tsType];
      case TField(_, FClosure({c: _.get() => cl}, _.get() => field)):
        final sig = SignatureCache.getSig(cl, false, field.name);
        sig == null ? [] : [for (arg in sig.args) arg.tsType];
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, _):
        cachedCallableArgTsTypes(inner);
      default:
        [];
    }
  }

  function cachedFieldValueTsType(expr: TypedExpr): Null<String> {
    return switch expr.expr {
      case TField(_, FStatic(_.get() => cl, _.get() => field)):
        switch field.kind {
          case FVar(_, _):
            SignatureCache.getFieldTsType(cl, true, field.name);
          default:
            null;
        }
      case TField(_, FInstance(_.get() => cl, _, _.get() => field)):
        switch field.kind {
          case FVar(_, _):
            SignatureCache.getFieldTsType(cl, false, field.name);
          default:
            null;
        }
      case TField(_, FAnon(_.get() => field)):
        SignatureCache.getAnonFieldTsType(field.pos);
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, _):
        cachedFieldValueTsType(inner);
      default:
        null;
    }
  }

  function emitLocalType(type: Type, typeOverride: Null<String>): Void {
    if (typeOverride != null)
      write(typeOverride);
    else
      TypeEmitter.emitType(this, type);
  }

  override function emitValueWithExpectedType(expected: Null<Type>,
      expr: TypedExpr) {
    final expectedTsType = expected == null ? null : SignatureCache.enumAbstractLiteralUnionTsType(expected);
    if (expectedTsType != null && needsEnumAbstractExpectedAssertion(expectedTsType,
      expr)) {
      write('(');
      emitValue(expr);
      write(' as ');
      write(expectedTsType);
      write(')');
      return;
    }
    super.emitValueWithExpectedType(expected, expr);
  }

  /**
   * Re-applies closed enum-abstract parameter types after Haxe lowers values to
   * their primitive runtime representation.
   *
   * Haxe can lower `for (id in [A, B]) consume(id)` to locals initialized from
   * primitive string literals. Those locals are still Haxe-typed as the enum
   * abstract at the call boundary, but TS only sees `string`. A tiny TS
   * assertion at the expected-type boundary preserves the source contract
   * without globally narrowing mutable local declarations.
   */
  function needsEnumAbstractExpectedAssertion(expectedTsType: String,
      expr: TypedExpr): Bool {
    final unwrapped = unwrapExpr(expr);
    switch unwrapped.expr {
      case TConst(TString(_) | TInt(_) | TFloat(_) | TBool(_) | TNull):
        return false;
      case TLocal(v):
        if (localTsTypeOverrides.get(v.id) == expectedTsType)
          return false;
      case TCall(callee, _):
        if (cachedCallableReturnTsType(callee) == expectedTsType)
          return false;
      case TField(_, _):
        if (cachedFieldValueTsType(unwrapped) == expectedTsType)
          return false;
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, _):
        return needsEnumAbstractExpectedAssertion(expectedTsType, inner);
      default:
    }
    return true;
  }

  static function extractTypeArgs(t: Type): Array<Type> {
    return switch t {
      case TAbstract(_, params) | TType(_, params) | TInst(_, params) |
        TEnum(_, params):
        params;
      case TMono(tref):
        final inner = tref.get();
        inner == null ? [] : extractTypeArgs(inner);
      default:
        [];
    };
  }

  static function isUseStateCallee(callee: TypedExpr): Bool {
    return switch unwrapExpr(callee).expr {
      case TField(_, f):
        fieldAccessName(f) == "useState";
      case TLocal(v):
        v.name == "useState";
      case TIdent(name):
        name == "useState";
      default:
        false;
    }
  }

  function tryEmitReactUseStateCall(varType: Type, init: TypedExpr): Bool {
    final unwrapped = unwrapExpr(init);
    return switch unwrapped.expr {
      case TCall(callee, args)
        if (isUseStateCallee(callee) && args.length == 1):
        final typeArgs = extractTypeArgs(varType);
        final stateTypeArg = (typeArgs.length == 1) ? typeArgs[0] : null;
        // Avoid leaking explicit `any` type arguments into user modules.
        if (stateTypeArg == null || typeEmitsAny(stateTypeArg)) {
          return false;
        }
        emitValue(callee);
        write('<');
        TypeEmitter.emitType(this, stateTypeArg);
        write('>(');
        emitValue(args[0]);
        write(')');
        true;
      default:
        false;
    }
  }

  static function typeAllowsNull(t: Type): Bool {
    return switch t {
      case TAbstract(_.get() => {pack: [], name: "Null"}, _):
        true;
      case TType(_.get() => {pack: [], name: "Null"}, _):
        true;
      case TDynamic(_):
        true;
      case TMono(tref):
        final inner = tref.get();
        inner == null ? true : typeAllowsNull(inner);
      case TType(_, _):
        typeAllowsNull(haxe.macro.Context.follow(t));
      default:
        false;
    }
  }

  static function stripNull(t: Type): Type {
    return switch t {
      case TAbstract(_.get() => {pack: [], name: "Null"}, [inner]):
        inner;
      case TType(_.get() => {pack: [], name: "Null"}, [inner]):
        inner;
      case TMono(tref):
        final inner = tref.get();
        inner == null ? t : stripNull(inner);
      case TType(_, _):
        stripNull(haxe.macro.Context.follow(t));
      default:
        t;
    }
  }

  static function isNumberLike(t: Type): Bool {
    return switch haxe.macro.Context.followWithAbstracts(stripNull(t)) {
      case TAbstract(_.get() => {pack: [], name: "Int" | "Float"}, _): true;
      default: false;
    }
  }

  static function isVoidLike(t: Type): Bool {
    return switch haxe.macro.Context.followWithAbstracts(t) {
      case TAbstract(_.get() => {pack: [], name: "Void"}, _):
        true;
      case TInst(_.get() => {module: "js.lib.Promise", name: "Promise"},
        [inner]) |
        TInst(_.get() => {pack: ["js", "lib"], name: "Promise"}, [inner]):
        isVoidLike(inner);
      case TType(_.get() => {module: "js.lib.Promise", name: "Promise"},
        [inner]) |
        TType(_.get() => {pack: ["js", "lib"], name: "Promise"}, [inner]):
        isVoidLike(inner);
      default:
        false;
    }
  }

  /**
   * Why: Haxe's `js.lib.Promise.resolve(null)` can type through the stdlib
   * `ThenableStruct<T>` overload, even though native TypeScript accepts the
   * plain `null` argument and infers the resolved promise type itself.
   *
   * What/How: when the only reason to insert a `Promise.resolve(null)` cast is
   * that Haxe chose one of the stdlib thenable overload shapes
   * (`js.lib.Thenable<T>`, older `ThenableStruct<T>`, or a union containing
   * one), let the argument emit directly in that call's emission context. This
   * keeps generated TS idiomatic (`Promise.resolve(null)`) and avoids leaking
   * an imported helper alias or `PromiseLike<any>` assertion into user modules.
   * Ordinary `Thenable<T>` parameters still keep their strict null assertions.
   */
  static function isPromiseThenableType(t: Type): Bool {
    return switch t {
      case TAbstract(_.get() => {pack: ["js", "lib"], name: "Thenable"}, _):
        true;
      case TType(_.get() => {pack: ["js", "lib"], name: "ThenableStruct"}, _):
        true;
      case TAbstract(_.get() => {pack: ["haxe", "extern"], name: "EitherType"},
        [left, right]): isPromiseThenableType(left) || isPromiseThenableType(right);
      case TMono(tref): final inner = tref.get(); inner != null && isPromiseThenableType(inner);
      case TType(_, _):
        isPromiseThenableType(haxe.macro.Context.follow(t));
      default:
        false;
    }
  }

  static function isJsPromiseResolveCallee(callee: TypedExpr): Bool {
    return switch unwrapExpr(callee).expr {
      case TField(_, f = FStatic(_.get() => cl, _)): (cl.module == 'js.lib.Promise'
          || (cl.pack.join('.') == 'js.lib' && cl.name == 'Promise')) && fieldAccessName(f) == 'resolve';
      default:
        false;
    }
  }

  function typeToString(type: Type): String {
    final buf = new StringBuf();
    final noop = function() {};
    final writer = {
      write: (code: String) -> buf.add(code),
      writeNewline: noop,
      emitComment: (_: String) -> {},
      increaseIndent: noop,
      decreaseIndent: noop,
      emitPos: (_: Dynamic) -> {},
      includeType: (_: Type) -> {},
      typeAccessor: ctx.typeAccessor
    }
    TypeEmitter.emitType(writer, type);
    return buf.toString();
  }

  static function addChainedAccessReceiverParens(e: TypedExpr): TypedExpr {
    function loop(e: TypedExpr): TypedExpr
      return switch e.expr {
        case TCast(e1, null) | TMeta(_, e1):
          loop(e1);
        case TConst(TInt(_) | TFloat(_)) | TObjectDecl(_):
          TypeUtil.with(e, TParenthesis(e));
        case _:
          e;
      }
    return loop(e);
  }

  function emitTsFieldAccess(field: FieldAccess) {
    switch field {
      case FStatic(_.get() => c, _):
        emitStaticField(c, TypeUtil.fieldName(field));
      case FEnum(_), FInstance(_), FAnon(_), FDynamic(_), FClosure(_):
        emitField(TypeUtil.fieldName(field));
    }
  }

  function emitChainedAccessReceiver(receiver: TypedExpr, assertNonNull: Bool) {
    final value = addChainedAccessReceiverParens(receiver);
    final wrapRawSyntax = receiverNeedsRawSyntaxParens(value);

    if (assertNonNull)
      write('(');
    if (wrapRawSyntax)
      write('(');

    if (assertNonNull) {
      // The following member/index access asserts the receiver is present, so
      // suppress TS-only optional-field `?? null` normalization for this inner
      // value and apply the usual Haxe non-null receiver assertion instead.
      withoutOptionalFieldNullNormalization(() ->
        emitValueWithExpectedType(null, value));
    } else {
      emitValue(value);
    }

    if (wrapRawSyntax)
      write(')');
    if (assertNonNull)
      write('!)');
  }

  function emitArrayAccess(e: TypedExpr, receiver: TypedExpr,
      index: TypedExpr) {
    final normalizeResult = !inAssignTarget && typeAllowsNull(e.t);
    if (normalizeResult)
      write('(');
    emitChainedAccessReceiver(receiver, typeAllowsNull(receiver.t));
    write('[');
    emitValue(index);
    write(']');
    if (normalizeResult)
      write(' ?? null)');
  }

  override public function emitValue(e: TypedExpr) {
    if (inRawSyntaxTemplate) {
      super.emitValue(e);
      return;
    }

    emitPos(e.pos);
    final privateMethod = privateMethodCall(e);
    if (privateMethod != null) {
      emitPrivateMethodValue(privateMethod);
      return;
    }
    switch e.expr {
      case TCall({
        expr: TField(_,
          FStatic(_.get() => {module: 'js.Syntax'}, _.get() => {name: 'code'}))
      },
        [{expr: TConst(TString("undefined"))}])
        if (shouldNormalizeUndefinedToNull(e.t)):
        // See `emitExpr` for rationale.
        write('null');
      case TCall({
        expr: TField(_,
          FStatic(_.get() => {module: 'js.Syntax'}, _.get() => {name: 'code'}))
      }, args) if (emitSyntaxCodeWithTsArgs(args)):
        null;
      case TCall(callee = {expr: TField(target, f)}, params)
        if (fieldAccessName(f) == "get" && tsIsIMapType(target.t)
          && isNarrowedNonNull(e)):
        emitCall(callee, params, true);
        if (typeAllowsNull(e.t))
          write('!');
      case TBinop(op = OpGt | OpGte | OpLt | OpLte, e1, e2)
        if ((typeAllowsNull(e1.t) && isNumberLike(e1.t))
          || (typeAllowsNull(e2.t) && isNumberLike(e2.t))):
        // See `emitExpr` for rationale.
        inline function emitOperand(expr: TypedExpr) {
          if (typeAllowsNull(expr.t) && isNumberLike(expr.t)) {
            write(ctx.typeAccessor(TypeUtil.registerType));
            write('.unsafeCast<number>(');
            emitValue(expr);
            write(')');
          } else {
            emitValue(expr);
          }
        }
        emitOperand(e1);
        writeSpace();
        writeBinop(op);
        writeSpace();
        emitOperand(e2);
      case TIf(cond, thenExpr, elseExpr):
        final check = nullNarrowCheck(cond);
        final expected = currentExpectedValueType;
        emitValue(cond);
        write(' ? ');
        emitNullNarrowedBranch(check, true,
          () -> emitValueWithExpectedType(expected, thenExpr));
        write(' : ');
        switch elseExpr {
          case null:
            write('null');
          case branch:
            emitNullNarrowedBranch(check, false,
              () -> emitValueWithExpectedType(expected, branch));
        }
      case TField(_, f) if (isOptionalField(f) && isNarrowedOptionalField(e)):
        emitNarrowedOptionalField(e);
      case TField(_, f)
        if (!inAssignTarget
          && isOptionalField(f)
          && !suppressOptionalFieldNullNormalization
          && shouldNormalizeOptionalFieldRead(e)):
        emitOptionalFieldAsNull(e);
      case TBlock(elements):
        final previousPreferredLocalNames = pushBlockLocalNamePreferences(elements);
        super.emitValue(e);
        preferredLocalNames = previousPreferredLocalNames;
      default:
        super.emitValue(e);
    }
  }

  override public function emitExpr(e: TypedExpr) {
    if (inRawSyntaxTemplate) {
      super.emitExpr(e);
      return;
    }

    emitPos(e.pos);
    switch e.expr {
      case TBlock(el):
        write('{');
        increaseIndent();
        emitNarrowedBlockElements(el);
        decreaseIndent();
        writeNewline();
        write('}');
      case TLocal(v):
        emitLocalVar(v);
      case TObjectDecl(fields):
        emitObjectDeclWithFieldTypes(e, fields);
      case TCall({
        expr: TField(_,
          FStatic(_.get() => {module: 'js.Syntax'}, _.get() => {name: 'code'}))
      },
        [{expr: TConst(TString("undefined"))}])
        if (shouldNormalizeUndefinedToNull(e.t)):
        // Haxe stdlib sometimes uses `js.Syntax.code("undefined")` in places
        // where `null` is the intended "no value" signal (e.g. `HxOverrides.cca`).
        // Normalize to `null` to keep TS `strictNullChecks` consistent.
        write('null');
      case TCall({
        expr: TField(_,
          FStatic(_.get() => {module: 'js.Syntax'}, _.get() => {name: 'code'}))
      }, args) if (emitSyntaxCodeWithTsArgs(args)):
        null;
      case TConst(TNull):
        if (typeAllowsNull(e.t)
          || (suppressPromiseResolveNullThenableCast
            && isPromiseThenableType(e.t))) {
          write('null');
        } else {
          write(ctx.typeAccessor(TypeUtil.registerType));
          write('.unsafeCast<');
          TypeEmitter.emitType(this, e.t);
          write('>(null)');
        }
      case TCast(e1, null):
        // Haxe inserts implicit casts in a few places where its non-null-safe
        // type system differs from TS strict null checks. Preserve those casts
        // as TS-only assertions (no runtime effect).
        // If the cast target is `any`, emitting `unsafeCast<any>(...)` would
        // leak `any` into user modules. For `any`, the cast is a no-op in TS
        // anyway, so omit it.
        final nullThenableCast = suppressPromiseResolveNullThenableCast
          && isNullConst(unwrapExpr(e1)) && isPromiseThenableType(e.t);
        // In the scoped `Promise.resolve(null)` path, TypeScript can choose its
        // value overload naturally, so Haxe's internal thenable-overload cast
        // would only make the generated code noisier and harder to import.
        if (typeEmitsAny(e.t) || nullThenableCast
          || (!typeAllowsNull(e.t) && typeAllowsNull(e1.t)
            && isNarrowedNonNull(e1))) {
          emitValue(e1);
        } else {
          write(ctx.typeAccessor(TypeUtil.registerType));
          write('.unsafeCast<');
          TypeEmitter.emitType(this, e.t);
          write('>(');
          emitValue(e1);
          write(')');
        }
      case TBinop(op = OpAssign, lhs = {expr: TField(_, f)}, rhs)
        if (isOverriddenField(f)):
        inAssignTarget = true;
        emitValue(lhs);
        inAssignTarget = false;
        writeSpace();
        writeBinop(op);
        writeSpace();
        final meta = switch f {
          case FInstance(_, _, cf) | FStatic(_, cf) | FAnon(cf): cf.get()
              .meta;
          default: null;
        }
        final typeOverride = extractStringMeta(meta,
          ':ts.type') ?? extractStringMeta(meta, ':genes.type');
        // If the override is `any`, no cast is required and emitting `<any>`
        // would leak `any` into user modules.
        if (typeOverride == null || typeOverride == 'any') {
          emitValueWithExpectedType(lhs.t, rhs);
        } else {
          write(ctx.typeAccessor(TypeUtil.registerType));
          write('.unsafeCast<');
          write(typeOverride);
          write('>(');
          emitValueWithExpectedType(lhs.t, rhs);
          write(')');
        }
      case TBinop(op = OpAssign, lhs, rhs)
        if (!isUndefinableType(lhs.t)
          && !typeAllowsNull(lhs.t)
          && typeAllowsNull(rhs.t)
          && !isNarrowedNonNull(rhs)):
        // Haxe allows assigning nullable values to non-nullable types in many
        // cases. Preserve that behavior under TS `strictNullChecks` by casting.
        inAssignTarget = true;
        emitValue(lhs);
        inAssignTarget = false;
        writeSpace();
        writeBinop(op);
        writeSpace();
        write(ctx.typeAccessor(TypeUtil.registerType));
        write('.unsafeCast<');
        TypeEmitter.emitType(this, lhs.t);
        write('>(');
        emitValueWithExpectedType(lhs.t, rhs);
        write(')');
      case TBinop(op = OpAssign | OpAssignOp(_), lhs, rhs):
        // Avoid optional-field `?? null` rewrites on assignment targets.
        inAssignTarget = true;
        emitValue(lhs);
        inAssignTarget = false;
        writeSpace();
        writeBinop(op);
        writeSpace();
        emitValueWithExpectedType(lhs.t, rhs);
      case TField(_, f)
        if (!inAssignTarget && isOptionalField(f) && isNarrowedOptionalField(e)):
        emitNarrowedOptionalField(e);
      case TArray(receiver, index) if (receiverNeedsRawSyntaxParens(receiver)):
        emitArrayAccess(e, receiver, index);
      case TArray(_, _) if (!inAssignTarget && typeAllowsNull(e.t)):
        // Haxe generally models missing values as `null` while JS property/index
        // reads can produce `undefined`. Normalize to `null` for TS `strict`.
        write('(');
        super.emitExpr(e);
        write(' ?? null)');
      case TField(x,
        f) // If the receiver type is nullable in TS (`T | null`), TS does not
        // reliably narrow property accesses across statements (e.g. `this.pos`).
        // Add a non-null assertion to preserve Haxe semantics under `strict`.
        //
        // Note: skip dynamic-iterator special cases handled by the JS emitter.
        if (typeAllowsNull(x.t)
          && !(fieldAccessName(f) == "iterator"
            && genes.util.TypeUtil.isDynamicIterator(x))):
        final isOptionalField = !inAssignTarget
          && !suppressOptionalFieldNullNormalization && switch f {
            case FAnon(cf) | FInstance(_, _, cf) | FStatic(_, cf): final meta = cf.get()
                .meta; meta != null && meta.has(':optional');
            default:
              false;
          };
        function skip(e: TypedExpr): TypedExpr
          return switch e.expr {
            case TCast(e1, null) | TMeta(_, e1): skip(e1);
            case TConst(TInt(_) | TFloat(_)) | TObjectDecl(_): TypeUtil.with(e,
                TParenthesis(e));
            case _: e;
          }
        if (isOptionalField)
          write('(');
        emitChainedAccessReceiver(skip(x), !isNarrowedNonNull(x));
        emitTsFieldAccess(f);
        if (isOptionalField)
          write(' ?? null)');
      case TField(x, f)
        if (receiverNeedsRawSyntaxParens(x)
          && !(fieldAccessName(f) == "iterator"
            && genes.util.TypeUtil.isDynamicIterator(x))):
        final fieldIsOptional = !inAssignTarget
          && !suppressOptionalFieldNullNormalization && isOptionalField(f);
        if (fieldIsOptional)
          write('(');
        emitChainedAccessReceiver(x, false);
        emitTsFieldAccess(f);
        if (fieldIsOptional)
          write(' ?? null)');
      case TField(_, f)
        if (!inAssignTarget && !suppressOptionalFieldNullNormalization
          && switch f {
            case FAnon(cf) | FInstance(_, _, cf) | FStatic(_, cf): final meta = cf.get()
                .meta; meta != null && meta.has(':optional');
            default:
              false;
          }):
          // Optional anonymous structure fields may be absent at runtime (`undefined`)
          // but Haxe treats access as `null` in most contexts. Normalize to `null`
          // to avoid leaking `undefined` into TS types.
          write('(');
          super.emitExpr(e);
          write(' ?? null)');
      case TReturn(eo):
        switch eo {
          case null:
            write('return');
          case e1:
            final ret = currentReturnType;
            final unwrapped = unwrapExpr(e1);
            final isNull = isNullConst(unwrapped)
              || isJsUndefinedConst(unwrapped);
            if (currentReturnIsVoidLike && isNull) {
              // Haxe often uses `null` as the implicit return value for `Void`.
              // In TS, `return null` is not valid for `void` / `Promise<void>`.
              write('return');
            } else {
              write('return ');
              if (ret != null
                && !typeAllowsNull(ret)
                && typeAllowsNull(e1.t)
                && isNarrowedNonNull(e1)) {
                emitValueWithExpectedType(ret, e1);
              } else if (ret != null && !typeAllowsNull(ret)
                && typeAllowsNull(e1.t)) {
                write(ctx.typeAccessor(TypeUtil.registerType));
                write('.unsafeCast<');
                TypeEmitter.emitType(this, ret);
                write('>(');
                emitValueWithExpectedType(ret, e1);
                write(')');
              } else {
                emitValueWithExpectedType(ret, e1);
              }
            }
        }
      case TCall({expr: TField(_, f)}, []) if (switch fieldAccessName(f) {
          case "shift" | "pop": true;
          default: false;
        }):
        // Normalize JS `undefined` to Haxe `null` for Array#shift/#pop.
        // This keeps TS strict-null types aligned with Haxe semantics.
        write('(');
        super.emitExpr(e);
        write(' ?? null)');
      case TCall(fn = {expr: TCall({expr: TField(_, f)}, _)}, args)
        if (switch fieldAccessName(f) {
            case "shift" | "pop": true;
            default: false;
          }):
          // Array#shift/#pop returns `T | undefined` in TS. When the Haxe code
          // guarantees non-emptiness (e.g. checked `.length > 0`), allow calling
          // the returned function under `strict`.
          write('(');
          emitValue(fn);
          write('!)(');
          for (arg in join(args, write.bind(', ')))
            emitValue(arg);
          write(')');
      case TCall(callee = {expr: TField(target, f)}, params)
        if (fieldAccessName(f) == "get" && tsIsIMapType(target.t)
          && isNarrowedNonNull(e)):
        emitCall(callee, params, true);
        if (typeAllowsNull(e.t))
          write('!');
      case TFor(v, itExpr, body):
        final wasInLoop = inLoop;
        inLoop = true;
        final localIt = switch itExpr.expr {
          case TLocal(it):
            it;
          default:
            null;
        };
        final tempIt = if (localIt == null) {
          final id = idCounter;
          idCounter++;
          final name = "$it" + id;
          write('$declare ${name} = ');
          emitValue(itExpr);
          writeNewline();
          name;
        } else {
          null;
        };

        function emitIterator() {
          if (localIt != null)
            emitLocalVar(localIt);
          else
            emitLocalIdent(tempIt);
        }

        final mapKeysOrigin = localIt == null ? mapKeysIteratorOrigin(itExpr) : mapKeyIteratorOrigins.get(localIt.id);
        final mapGetKey = mapKeysOrigin == null ? null : mapGetNarrowKeyFromParts(mapKeysOrigin,
          stableValueKey({expr: TLocal(v), t: v.t, pos: itExpr.pos}));

        write('while (');
        emitIterator();
        write('.hasNext()) {');
        increaseIndent();
        writeNewline();
        write('$declare ');
        emitLocalVar(v);
        write(' = ');
        emitIterator();
        write('.next()');
        writeNewline();
        if (mapGetKey == null) {
          emitBlockElement(body);
        } else {
          final previousKeyOrigin = mapKeyLocalOrigins.get(v.id);
          mapKeyLocalOrigins.set(v.id, mapKeysOrigin);
          narrowedNonNullKeys.push(mapGetKey);
          emitBlockElement(body);
          narrowedNonNullKeys.pop();
          if (previousKeyOrigin == null)
            mapKeyLocalOrigins.remove(v.id);
          else
            mapKeyLocalOrigins.set(v.id, previousKeyOrigin);
        }
        decreaseIndent();
        writeNewline();
        write('}');
        inLoop = wasInLoop;
      case TIf(cond, thenExpr, elseExpr):
        final check = nullNarrowCheck(cond);
        write('if ');
        emitValue(cond);
        writeSpace();
        emitNullNarrowedBranch(check, true,
          () -> emitExpr(TypeUtil.block(thenExpr)));
        switch elseExpr {
          case null:
          case branch:
            emitPos(branch.pos);
            write(' else ');
            emitNullNarrowedBranch(check, false,
              () -> emitExpr(switch branch.expr {
                case TIf(_, _, _): branch;
                case _: TypeUtil.block(branch);
              }));
        }
      case TTry(etry, [{v: v, expr: ecatch}]):
        write('try ');
        emitExpr(etry);
        write('catch (');
        emitLocalVar(v);
        write(') ');
        emitExpr(ecatch);
      case TTry(_):
        throw 'Unhandled try/catch, please report';
      case TFunction(f):
        final previousLocalScope = pushLocalNameScope();
        final inValue = this.inValue;
        final inLoop = this.inLoop;
        final prevReturn = currentReturnType;
        final prevVoidLike = currentReturnIsVoidLike;
        final prevNarrowedNonNullKeys = narrowedNonNullKeys;
        narrowedNonNullKeys = [];
        currentReturnType = switch e.t {
          case TFun(_, ret): ret;
          default: null;
        }
        currentReturnIsVoidLike = currentReturnType != null
          && isVoidLike(currentReturnType);
        this.inValue = 0;
        this.inLoop = false;
        final args = switch e.t {
          case TFun(args, _): args;
          default: [];
        }
        var noOptionalUntil = -1;
        var hadOptional = true;
        for (i in 0...args.length) {
          final arg = args[i];
          if (arg.opt) {
            hadOptional = true;
          } else if (hadOptional && !arg.opt) {
            noOptionalUntil = i;
            hadOptional = false;
          }
        }
        write('function (');
        for (i in joinIt(0...f.args.length, write.bind(', '))) {
          final arg = f.args[i];
          final t = i < args.length ? args[i].t : arg.v.t;
          if (genes.util.TypeUtil.isRest(t))
            write('...');
          emitLocalVar(arg.v);
          final omitType = (arg.v.name == '_'
            || StringTools.startsWith(arg.v.name, '_'))
            && typeEmitsAny(t);
          if (!omitType) {
            final optional = i < args.length && args[i].opt
              && i > noOptionalUntil;
            final defaultNull = optional && typeAllowsNull(t);
            if (optional && !defaultNull)
              write('?');
            write(': ');
            TypeEmitter.emitType(this, t);
            if (defaultNull)
              write(' = null');
          }
        }
        // Omit explicit return annotations so TS can infer and preserve generic
        // inference. Writing `: any` here causes widespread `unknown` inference
        // under `strict` in downstream code (e.g. tink.*).
        write(') ');
        emitExpr(getFunctionBody(f));
        this.inValue = inValue;
        this.inLoop = inLoop;
        currentReturnType = prevReturn;
        currentReturnIsVoidLike = prevVoidLike;
        narrowedNonNullKeys = prevNarrowedNonNullKeys;
        restoreLocalNameScope(previousLocalScope);
      case TBinop(op = OpGt | OpGte | OpLt | OpLte, e1, e2)
        if ((typeAllowsNull(e1.t) && isNumberLike(e1.t))
          || (typeAllowsNull(e2.t) && isNumberLike(e2.t))):
        // Relational operators on nullable numbers are allowed in Haxe but
        // rejected by TS `strictNullChecks`. Cast to `number` to preserve JS
        // coercion semantics (`null > 0` is `false`, etc).
        inline function emitOperand(expr: TypedExpr) {
          if (typeAllowsNull(expr.t) && isNumberLike(expr.t)) {
            write(ctx.typeAccessor(TypeUtil.registerType));
            write('.unsafeCast<number>(');
            emitValue(expr);
            write(')');
          } else {
            emitValue(expr);
          }
        }
        emitOperand(e1);
        writeSpace();
        writeBinop(op);
        writeSpace();
        emitOperand(e2);
      case TBinop(op = OpEq | OpNotEq, e1, e2)
        if (isNullConst(e1) || isNullConst(e2)):
        emitValueWithPlainNull(e1);
        writeSpace();
        writeBinop(op);
        writeSpace();
        emitValueWithPlainNull(e2);
      case TCall({expr: TField(_, f)}, [{expr: TConst(TString(name))}])
        if (switch f {
            case FStatic(cl, cf)
              if (cl.get().module == "genes.Register"
                && cl.get().name == "Register" && cf.get().name == "global"):
              true;
            default:
              false;
          }):
          // Avoid leaking `unknown` from `Register.global()` into user modules for
          // common reflection registries.
          switch name {
            case "$hxEnums":
              write(ctx.typeAccessor(TypeUtil.registerType));
              write('.hxEnums()');
            case "$hxClasses":
              write(ctx.typeAccessor(TypeUtil.registerType));
              write('.hxClasses()');
            default:
              super.emitExpr(e);
          }
      default:
        super.emitExpr(e);
    }
  }

  /**
   * Why: nullable Haxe values often lower to TypeScript unions containing
   * `null`. If Haxe has already proven a stable nullable local or optional
   * field non-null, emitting `Register.unsafeCast<T>(value)` is noisier than
   * the TypeScript code a person would write and hides useful flow facts.
   *
   * What/How: for stable locals and stable optional field paths only
   * (`local`, `local.field`, `this.field`, and nested field chains), record
   * null facts proven by direct `== null` / `!= null` checks. The facts flow
   * through simple boolean conditions: `a && b` proves true-branch facts from
   * both sides, while `a || b` proves false-branch facts from both sides. An
   * `if (value == null)` branch that exits with `return`, `throw`, `continue`,
   * or `break` proves the following same-block statements are in the non-null
   * path. Those facts intentionally reset at nested function expressions because
   * TypeScript does not trust captured mutable locals to stay narrowed when a
   * callback runs later. Matching locals can then emit directly, and matching
   * optional field reads emit as `receiver.field!`. Unstable receivers such as
   * calls stay on the conservative cast / `?? null` paths.
   */
  function nullNarrowCheck(e: TypedExpr): Null<NullNarrowCheck> {
    return switch unwrapExpr(e).expr {
      case TBinop(op = OpEq | OpNotEq, left, right):
        final leftKey = nonNullNarrowKey(left);
        if (leftKey != null && isNullConst(unwrapExpr(right))) {
          op == OpNotEq ? {
            nonNullWhenTrue: [leftKey],
            nonNullWhenFalse: []
          } : {
            nonNullWhenTrue: [],
            nonNullWhenFalse: [leftKey]
          };
        } else {
          final rightKey = nonNullNarrowKey(right);
          if (rightKey != null && isNullConst(unwrapExpr(left)))
            op == OpNotEq ? {
              nonNullWhenTrue: [rightKey],
              nonNullWhenFalse: []
            } : {
              nonNullWhenTrue: [],
              nonNullWhenFalse: [rightKey]
            }
          else
            null;
        }
      case TBinop(OpBoolAnd, left, right):
        final leftCheck = nullNarrowCheck(left);
        final rightCheck = nullNarrowCheck(right);
        if (leftCheck == null && rightCheck == null) null else {
          nonNullWhenTrue: uniqueNarrowKeys(concatNarrowKeys(leftCheck == null ? [] : leftCheck.nonNullWhenTrue,
            rightCheck == null ? [] : rightCheck.nonNullWhenTrue)),
          nonNullWhenFalse: []
        };
      case TBinop(OpBoolOr, left, right):
        final leftCheck = nullNarrowCheck(left);
        final rightCheck = nullNarrowCheck(right);
        if (leftCheck == null && rightCheck == null) null else {
          nonNullWhenTrue: [],
          nonNullWhenFalse: uniqueNarrowKeys(concatNarrowKeys(leftCheck == null ? [] : leftCheck.nonNullWhenFalse,
            rightCheck == null ? [] : rightCheck.nonNullWhenFalse))
        };
      case TUnop(OpNot, _, inner):
        final check = nullNarrowCheck(inner);
        check == null ? null : {
          nonNullWhenTrue: check.nonNullWhenFalse,
          nonNullWhenFalse: check.nonNullWhenTrue
        };
      case TCall({expr: TField(mapExpr, f)}, [keyExpr])
        if (fieldAccessName(f) == "exists"):
        final key = mapGetNarrowKeyFromParts(stableMapKey(mapExpr),
          stableValueKey(keyExpr));
        key == null ? null : {
          nonNullWhenTrue: [key],
          nonNullWhenFalse: []
        };
      default:
        null;
    }
  }

  function emitNullNarrowedBranch(check: Null<NullNarrowCheck>,
      thenBranch: Bool, emit: Void->Void) {
    final keys = check == null ? [] : thenBranch ? check.nonNullWhenTrue : check.nonNullWhenFalse;
    if (keys.length == 0) {
      emit();
      return;
    }

    for (key in keys)
      narrowedNonNullKeys.push(key);
    emit();
    for (_ in keys)
      narrowedNonNullKeys.pop();
  }

  function emitNarrowedBlockElements(elements: Array<TypedExpr>) {
    final previousPreferredLocalNames = pushBlockLocalNamePreferences(elements);
    var activeKeys: Array<String> = [];
    for (element in elements) {
      for (key in activeKeys)
        narrowedNonNullKeys.push(key);
      emitBlockElement(element);
      for (_ in activeKeys)
        narrowedNonNullKeys.pop();
      activeKeys = removeNarrowKeys(activeKeys, assignedNarrowKeys(element));
      activeKeys = uniqueNarrowKeys(concatNarrowKeys(activeKeys,
        continuationNonNullKeys(element)));
    }
    preferredLocalNames = previousPreferredLocalNames;
  }

  function pushBlockLocalNamePreferences(elements: Array<TypedExpr>): Map<Int, String> {
    final previousPreferredLocalNames = preferredLocalNames;
    preferredLocalNames = copyLocalNamePreferences(preferredLocalNames);
    addObjectConstructionLocalNamePreferences(elements);
    addTsxElementLocalNamePreferences(elements);
    return previousPreferredLocalNames;
  }

  /**
   * Renames Haxe-lowered object-construction temporaries without changing
   * evaluation order.
   *
   * Why: when a typed object literal needs intermediate values, Haxe can lower
   * source like `final parsed:Record = {...}` into a cluster of locals named
   * `parsed`, `parsed1`, ..., `parsed9`, where the last local is the object and
   * the earlier locals are direct field values. Those names are correct but
   * noisy in generated TypeScript.
   *
   * What/How: if a numbered local initialized to an object literal directly
   * consumes earlier same-prefix locals exactly once, prefer the object field
   * names for those consumed locals and the shared prefix for the final object
   * local. The declarations remain separate, preserving Haxe's lowered
   * evaluation order; only emitted TS identifiers become more meaningful.
   */
  function addObjectConstructionLocalNamePreferences(elements: Array<TypedExpr>) {
    final declarations: Map<Int, TVar> = [];
    final declarationOrder: Map<Int, Int> = [];
    final uses: Map<Int, Int> = [];

    for (i in 0...elements.length) {
      switch unwrapExpr(elements[i]).expr {
        case TVar(v, _):
          declarations.set(v.id, v);
          declarationOrder.set(v.id, i);
        default:
      }
      countLocalUses(elements[i], uses);
    }

    for (i in 0...elements.length) {
      switch unwrapExpr(elements[i]).expr {
        case TVar(objectLocal, init) if (init != null):
          final objectParts = numberedLocalName(objectLocal.name);
          if (objectParts == null || objectParts.index == null)
            continue;
          switch unwrapExpr(init).expr {
            case TObjectDecl(fields):
              var foundFieldTemp = false;
              final fieldUses: Array<ObjectFieldLocalUse> = [];
              for (field in fields) {
                collectObjectFieldLocalUses(field.expr, field.name, fieldUses);
              }
              for (fieldUse in fieldUses) {
                final fieldLocal = fieldUse.local;
                if (fieldLocal == null)
                  continue;
                final fieldParts = numberedLocalName(fieldLocal.name);
                if (fieldParts == null || fieldParts.prefix != objectParts.prefix)
                  continue;
                final fieldIndex = fieldParts.index == null ? 0 : fieldParts.index;
                if (fieldIndex >= objectParts.index)
                  continue;
                if (!declarations.exists(fieldLocal.id)
                  || declarationOrder.get(fieldLocal.id) >= i)
                  continue;
                if ((uses.exists(fieldLocal.id) ? uses.get(fieldLocal.id) : 0) != 1)
                  continue;
                final preferred = preferredNameForObjectField(fieldUse.fieldName);
                if (preferred == null)
                  continue;
                preferredLocalNames.set(fieldLocal.id, preferred);
                foundFieldTemp = true;
              }
              if (foundFieldTemp && isValidTsObjectKey(objectParts.prefix))
                preferredLocalNames.set(objectLocal.id, objectParts.prefix);
            default:
          }
        default:
      }
    }
  }

  /**
   * Gives Haxe-lowered TSX child element temporaries readable names.
   *
   * Why: inline JSX/TSX markup in value position can be lowered by Haxe into a
   * sequence of locals named `tmp`, `tmp1`, ... before the final root element
   * expression. The order-preserving declarations are useful, but the raw temp
   * names make generated TSX snapshots hard to review.
   *
   * What/How: in TSX mode only, if a low-quality local is initialized directly
   * from a JSX marker and consumed exactly once, prefer a name based on the JSX
   * tag (`text`, `input`, `fragment`, ...). The declarations stay separate, so
   * evaluation order remains exactly Haxe's lowered order; only the emitted
   * TypeScript identifiers change.
   */
  function addTsxElementLocalNamePreferences(elements: Array<TypedExpr>) {
    if (!jsxEmitTsx)
      return;
    final uses: Map<Int, Int> = [];
    for (element in elements)
      countLocalUses(element, uses);
    for (element in elements) {
      switch unwrapExpr(element).expr {
        case TVar(v, init)
          if (init != null && isLowQualityTempLocalName(v.name)
            && (uses.exists(v.id) ? uses.get(v.id) : 0) == 1):
          final preferred = preferredNameForJsxElementLocal(init);
          if (preferred != null)
            preferredLocalNames.set(v.id, preferred);
        default:
      }
    }
  }

  function preferredNameForJsxElementLocal(e: TypedExpr): Null<String> {
    return switch unwrapExpr(e).expr {
      case TCall(callee, args):
        switch isReactJsxMarkerCallee(callee) {
          case '__jsx':
            args.length == 3 ? preferredNameForJsxTag(args[0]) : null;
          case '__frag':
            'fragment';
          case _:
            null;
        }
      default:
        null;
    }
  }

  function preferredNameForJsxTag(tag: TypedExpr): Null<String> {
    return switch unwrapExpr(tag).expr {
      case TConst(TString(s)):
        preferredNameFromJsxTagString(s);
      case TLocal(v):
        sanitizePreferredLocalName(v.name);
      default:
        null;
    }
  }

  function preferredNameFromJsxTagString(tag: String): Null<String> {
    if (tag == null || tag.length == 0)
      return null;
    final parts = tag.split('-');
    var out = '';
    for (i in 0...parts.length) {
      final part = sanitizePreferredLocalName(parts[i]);
      if (part == null)
        continue;
      if (out.length == 0) {
        out = part;
      } else {
        out += part.substr(0, 1).toUpperCase() + part.substr(1);
      }
    }
    return out.length == 0 ? null : out;
  }

  function sanitizePreferredLocalName(name: String): Null<String> {
    if (name == null || name.length == 0)
      return null;
    final out = new StringBuf();
    for (i in 0...name.length) {
      final code = name.charCodeAt(i);
      final valid = (code >= "a".code && code <= "z".code)
        || (code >= "A".code && code <= "Z".code)
        || (i > 0 && code >= "0".code && code <= "9".code)
        || code == "_".code || code == "$".code;
      if (valid)
        out.addChar(code);
    }
    final result = out.toString();
    return result.length == 0 ? null : getLocalIdent(result);
  }

  static function isLowQualityTempLocalName(name: String): Bool {
    if (name == "tmp")
      return true;
    if (!StringTools.startsWith(name, "tmp"))
      return false;
    if (name.length == 3)
      return true;
    for (i in 3...name.length) {
      final code = name.charCodeAt(i);
      if (code < "0".code || code > "9".code)
        return false;
    }
    return true;
  }

  static function copyLocalNamePreferences(source: Map<Int, String>): Map<Int, String> {
    final out: Map<Int, String> = [];
    for (key in source.keys())
      out.set(key, source.get(key));
    return out;
  }

  static function directLocalValue(e: TypedExpr): Null<TVar> {
    return switch unwrapExpr(e).expr {
      case TLocal(v):
        v;
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, _):
        directLocalValue(inner);
      default:
        null;
    }
  }

  static function collectObjectFieldLocalUses(e: TypedExpr, fieldName: String,
      out: Array<ObjectFieldLocalUse>) {
    final direct = directLocalValue(e);
    if (direct != null) {
      out.push({local: direct, fieldName: fieldName});
      return;
    }
    switch unwrapExpr(e).expr {
      case TObjectDecl(fields):
        for (field in fields)
          collectObjectFieldLocalUses(field.expr, field.name, out);
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, _):
        collectObjectFieldLocalUses(inner, fieldName, out);
      default:
    }
  }

  static function preferredNameForObjectField(name: String): Null<String> {
    if (name == null || name.length == 0)
      return null;
    final cleaned = name == "function" ? "fn" : name;
    return isValidTsObjectKey(cleaned) ? cleaned : null;
  }

  static function numberedLocalName(name: String): Null<{prefix: String, index: Null<Int>}> {
    if (name == null || name.length == 0)
      return null;
    var split = name.length;
    while (split > 0) {
      final code = name.charCodeAt(split - 1);
      if (code < "0".code || code > "9".code)
        break;
      split--;
    }
    final prefix = name.substr(0, split);
    if (prefix.length == 0)
      return null;
    if (split == name.length)
      return {prefix: prefix, index: null};
    return {prefix: prefix, index: Std.parseInt(name.substr(split))};
  }

  static function countLocalUses(e: TypedExpr, uses: Map<Int, Int>) {
    switch unwrapExpr(e).expr {
      case TLocal(v):
        uses.set(v.id, (uses.exists(v.id) ? uses.get(v.id) : 0) + 1);
      default:
    }
    haxe.macro.TypedExprTools.iter(e, child -> countLocalUses(child, uses));
  }

  function continuationNonNullKeys(e: TypedExpr): Array<String> {
    return switch unwrapExpr(e).expr {
      case TVar(v, init)
        if (init != null && isNarrowedNonNull(init) && typeAllowsNull(v.t)):
        // Haxe can introduce a nullable local while lowering patterns such as
        // `case value:` in the non-null branch of a nullable switch. The
        // initializer is already proven non-null by the surrounding branch, so
        // carry that flow fact to the next statement and avoid emitting a
        // TypeScript-only identity cast when the local is consumed immediately.
        ['local:${v.id}'];
      case TIf(cond, thenExpr, null): final check = nullNarrowCheck(cond); check != null && definitelyExits(thenExpr) ? check.nonNullWhenFalse : [];
      default:
        [];
    }
  }

  function assignedNarrowKeys(e: TypedExpr): Array<String> {
    return switch unwrapExpr(e).expr {
      case TBinop(OpAssign | OpAssignOp(_), lhs, _):
        final key = nonNullNarrowKey(lhs);
        key == null ? [] : [key];
      case TBlock(elements):
        var keys: Array<String> = [];
        for (element in elements)
          keys = concatNarrowKeys(keys, assignedNarrowKeys(element));
        uniqueNarrowKeys(keys);
      case TIf(_, thenExpr, elseExpr):
        var keys = assignedNarrowKeys(thenExpr);
        if (elseExpr != null)
          keys = concatNarrowKeys(keys, assignedNarrowKeys(elseExpr));
        uniqueNarrowKeys(keys);
      default:
        [];
    }
  }

  static function definitelyExits(e: TypedExpr): Bool {
    return switch unwrapExpr(e).expr {
      case TReturn(_) | TThrow(_) | TContinue | TBreak:
        true;
      case TBlock(elements): elements.length > 0 && definitelyExits(elements[elements.length
          - 1]);
      case TIf(_, thenExpr, elseExpr): elseExpr != null && definitelyExits(thenExpr) && definitelyExits(elseExpr);
      default:
        false;
    }
  }

  static function concatNarrowKeys(left: Array<String>,
      right: Array<String>): Array<String> {
    final out = left.copy();
    for (key in right)
      out.push(key);
    return out;
  }

  static function uniqueNarrowKeys(keys: Array<String>): Array<String> {
    final out: Array<String> = [];
    for (key in keys) {
      var exists = false;
      for (item in out)
        if (item == key) {
          exists = true;
          break;
        }
      if (!exists)
        out.push(key);
    }
    return out;
  }

  static function removeNarrowKeys(keys: Array<String>,
      removed: Array<String>): Array<String> {
    if (removed.length == 0)
      return keys;
    final out: Array<String> = [];
    for (key in keys) {
      var keep = true;
      for (item in removed)
        if (item == key) {
          keep = false;
          break;
        }
      if (keep)
        out.push(key);
    }
    return out;
  }

  function isNarrowedOptionalField(e: TypedExpr): Bool {
    final key = optionalFieldNarrowKey(e);
    if (key == null)
      return false;
    for (narrowed in narrowedNonNullKeys)
      if (narrowed == key)
        return true;
    return false;
  }

  function isNarrowedNonNull(e: TypedExpr): Bool {
    final key = nonNullNarrowKey(e);
    if (key != null)
      for (narrowed in narrowedNonNullKeys)
        if (narrowed == key)
          return true;
    return isMapGetFromKnownKey(e);
  }

  function nonNullNarrowKey(e: TypedExpr): Null<String> {
    final unwrapped = unwrapExpr(e);
    return switch unwrapped.expr {
      case TLocal(v) if (typeAllowsNull(unwrapped.t)):
        'local:${v.id}';
      default:
        final mapKey = mapGetNarrowKey(unwrapped);
        mapKey != null ? mapKey : optionalFieldNarrowKey(unwrapped);
    }
  }

  /**
   * Why: Haxe `Map.get` returns `Null<V>` because a key can be missing, even
   * when `V` itself is non-null. TypeScript then needs a cast in places where
   * the surrounding Haxe code has already proven key presence with
   * `map.exists(key)` or by iterating `map.keys()`.
   *
   * What/How: represent "this stable map contains this stable key" as another
   * flow fact in the same stack used by local/field null narrowing. The fact is
   * intentionally limited to stable map receivers and stable key expressions,
   * and only for maps whose value type is non-null. Maps storing nullable
   * values still need the conservative `V | null` output.
   */
  function mapGetNarrowKey(e: TypedExpr): Null<String> {
    return switch unwrapExpr(e).expr {
      case TCall({expr: TField(mapExpr, f)}, [keyExpr])
        if (fieldAccessName(f) == "get"):
        mapGetNarrowKeyFromParts(stableMapKey(mapExpr), stableValueKey(keyExpr));
      default:
        null;
    }
  }

  function mapKeysIteratorOrigin(e: TypedExpr): Null<String> {
    return switch unwrapExpr(e).expr {
      case TCall({expr: TField(mapExpr, f)}, [])
        if (fieldAccessName(f) == "keys"):
        stableMapKey(mapExpr);
      default:
        null;
    }
  }

  function mapIteratorNextOrigin(e: TypedExpr): Null<String> {
    return switch unwrapExpr(e).expr {
      case TCall({expr: TField({expr: TLocal(iteratorLocal)}, f)}, [])
        if (fieldAccessName(f) == "next"):
        mapKeyIteratorOrigins.get(iteratorLocal.id);
      default:
        null;
    }
  }

  function isMapGetFromKnownKey(e: TypedExpr): Bool {
    return switch unwrapExpr(e).expr {
      case TCall({expr: TField(mapExpr, f)}, [{expr: TLocal(keyLocal)}])
        if (fieldAccessName(f) == "get"):
        final mapKey = stableMapKey(mapExpr);
        final origin = mapKeyLocalOrigins.get(keyLocal.id);
        mapKey != null && origin != null && mapKey == origin;
      default:
        false;
    }
  }

  function mapGetNarrowKeyFromParts(mapKey: Null<String>,
      keyKey: Null<String>): Null<String> {
    return mapKey != null && keyKey != null ? 'map:$mapKey|key:$keyKey' : null;
  }

  function stableMapKey(e: TypedExpr): Null<String> {
    if (mapValueAllowsNull(e.t))
      return null;
    return stableValueKey(e);
  }

  function stableValueKey(e: TypedExpr): Null<String> {
    return switch unwrapExpr(e).expr {
      case TLocal(v):
        'local:${v.id}';
      case TConst(TThis):
        'this';
      case TConst(TString(value)):
        'string:$value';
      case TConst(TInt(value)):
        'int:$value';
      case TConst(TFloat(value)):
        'float:$value';
      case TConst(TBool(value)):
        'bool:$value';
      case TField(receiver, f):
        final parent = stableValueKey(receiver);
        final name = fieldAccessName(f);
        parent != null && name != null ? parent + "." + name : null;
      default:
        null;
    }
  }

  static function mapValueAllowsNull(t: Type): Bool {
    final valueType = mapValueType(t);
    return valueType == null || typeAllowsNull(valueType);
  }

  static function tsIsIMapType(t: Type): Bool {
    return mapValueType(t) != null;
  }

  static function mapValueType(t: Type, ?seen: Map<String, Bool>): Null<Type> {
    if (seen == null)
      seen = [];
    return switch haxe.macro.Context.follow(t) {
      case TInst(ref, params):
        final cl = ref.get();
        final id = cl.module + "." + cl.name;
        if (seen.exists(id)) {
          null;
        } else if (cl.module == "haxe.Constraints" && cl.name == "IMap"
          && params.length >= 2) {
          params[1];
        } else {
          seen.set(id, true);
          var found: Null<Type> = null;
          for (iface in cl.interfaces) {
            final ifaceParams = [for (param in iface.params) param.applyTypeParameters(cl.params,
              params)];
            found = mapValueType(TInst(iface.t, ifaceParams), seen);
            if (found != null)
              break;
          }
          if (found == null && cl.superClass != null) {
            final superParams = [for (param in cl.superClass.params) param.applyTypeParameters(cl.params,
              params)];
            found = mapValueType(TInst(cl.superClass.t, superParams), seen);
          }
          found;
        }
      default:
        null;
    }
  }

  function optionalFieldNarrowKey(e: TypedExpr): Null<String> {
    return switch unwrapExpr(e).expr {
      case TField(receiver, f) if (isOptionalField(f)): final receiverKey = stableFieldReceiverKey(receiver); final name = fieldAccessName(f); receiverKey != null && name != null ? receiverKey + "." + name : null;
      default:
        null;
    }
  }

  function stableFieldReceiverKey(e: TypedExpr): Null<String> {
    return switch unwrapExpr(e).expr {
      case TLocal(v):
        'local:${v.id}';
      case TConst(TThis):
        'this';
      case TField(receiver, f): final parent = stableFieldReceiverKey(receiver); final name = fieldAccessName(f); parent != null && name != null ? parent + "." + name : null;
      default:
        null;
    }
  }

  static function isOptionalField(f: FieldAccess): Bool {
    return switch f {
      case FAnon(cf) | FInstance(_, _, cf) | FStatic(_, cf): final meta = cf.get()
          .meta; meta != null && meta.has(':optional');
      default:
        false;
    }
  }

  function emitNarrowedOptionalField(e: TypedExpr) {
    switch unwrapExpr(e).expr {
      case TField(receiver, f):
        write('(');
        emitValue(receiver);
        switch f {
          case FStatic(_.get() => c, _):
            emitStaticField(c, TypeUtil.fieldName(f));
          case FEnum(_), FInstance(_), FAnon(_), FDynamic(_), FClosure(_):
            emitField(TypeUtil.fieldName(f));
        }
        write('!)');
      default:
        emitValue(e);
    }
  }

  function emitOptionalFieldAsNull(e: TypedExpr) {
    // Re-enter TS expression emission so nested receiver rewrites still apply.
    // The base JS emitter would print `record.child.label ?? null` and skip the
    // TS-only non-null receiver handling needed for strict null checks.
    emitExpr(e);
  }

  function withoutOptionalFieldNullNormalization(emit: Void->Void) {
    final previous = suppressOptionalFieldNullNormalization;
    suppressOptionalFieldNullNormalization = true;
    emit();
    suppressOptionalFieldNullNormalization = previous;
  }

  /**
   * Emits `js.Syntax.code("...", args...)` placeholders through genes-ts.
   *
   * Why: the base JS emitter delegates the whole syntax expression to Haxe's JS
   * stringifier. That is fine for plain JS output, but it bypasses TypeScript
   * emitter knowledge attached to placeholder expressions: native anonymous
   * field names, type-only references, nullable rewrites, and other TS-specific
   * expression lowering. For example, `@:native("function") final fn` inside
   * `js.Syntax.code("{0} ?? null", record.fn.description)` must emit
   * `record["function"].description ?? null`, not `record.fn.description`.
   *
   * What/How: keep the raw template text as the author wrote it, but replace
   * numeric `{0}` / `{1}` placeholders by genes' own TypeScript value emitter.
   * The template still owns surrounding syntax such as `await {0}` or
   * `{0} ?? null`, while placeholder expressions retain TS-specific knowledge:
   * native anonymous field names, call-argument expected types, type-only
   * references, and strict-null rewrites. Calls without placeholder arguments
   * stay on the base path so special raw forms such as `js.Syntax.code("$global")`
   * keep their existing behavior.
   */
  function emitSyntaxCodeWithTsArgs(args: Array<TypedExpr>): Bool {
    if (args.length <= 1)
      return false;

    final template = switch args[0].expr {
      case TConst(TString(value)):
        value;
      default:
        return false;
    }

    final values = args.slice(1);
    var i = 0;
    while (i < template.length) {
      if (template.charCodeAt(i) == "{".code) {
        var j = i + 1;
        var index = 0;
        var hasDigits = false;
        while (j < template.length) {
          final code = template.charCodeAt(j);
          if (code < "0".code || code > "9".code)
            break;
          hasDigits = true;
          index = index * 10 + (code - "0".code);
          j++;
        }
        if (hasDigits && j < template.length
          && template.charCodeAt(j) == "}".code) {
          if (index >= values.length) {
            haxe.macro.Context.error('js.Syntax.code placeholder {$index} has no argument',
              args[0].pos);
          }
          emitRawSyntaxTemplateValue(values[index]);
          i = j + 1;
          continue;
        }
      }
      write(template.charAt(i));
      i++;
    }
    return true;
  }

  function emitRawSyntaxTemplateValue(value: TypedExpr) {
    if (isJsUndefinedConst(value)) {
      // A raw syntax template argument that is explicitly JavaScript
      // `undefined` must stay `undefined`. The ordinary nullable-Haxe
      // normalization to `null` would change nested raw checks such as
      // `js.Syntax.code("({0}) === undefined", Undefinable.absent())`.
      write('undefined');
      return;
    }
    final previous = inRawSyntaxTemplate;
    inRawSyntaxTemplate = false;
    emitValue(value);
    inRawSyntaxTemplate = previous;
  }

  /**
   * Emits object literals while preserving anonymous-field type context.
   *
   * Why: Haxe treats most absent JS values as `null`, so genes-ts normally
   * rewrites `js.Syntax.code("undefined")` to `null` when the expression is
   * nullable. `genes.ts.Undefinable<T>` is the explicit exception: it means the
   * public TypeScript contract is `T | undefined`, not `T | null`.
   *
   * What/How: object-literal fields carry their expected anonymous field type on
   * the enclosing object, not always on the field expression itself. While
   * emitting each field value, record that expected type so the existing
   * undefined-normalization rule can skip Undefinable fields only.
   */
  function emitObjectDeclWithFieldTypes(e: TypedExpr,
      fields: Array<{name: String, expr: TypedExpr}>) {
    write('{');
    final objectType = currentExpectedValueType != null ? currentExpectedValueType : e.t;
    for (field in join(fields, write.bind(', '))) {
      final anonymousField = TypeUtil.anonymousField(objectType, field.name);
      emitPos(field.expr.pos);
      emitString(anonymousField == null ? field.name : TypeUtil.classFieldName(anonymousField));
      write(': ');
      emitObjectDeclFieldValue(anonymousField, TypeUtil.anonymousFieldType(objectType,
        field.name), field.expr);
    }
    write('}');
  }

  function emitObjectDeclFieldValue(field: Null<ClassField>,
      expected: Null<Type>, expr: TypedExpr): Void {
    if (field != null && field.meta.has(':optional')
      && field.meta.has(':ts.optional') && mayEmitNull(expr)) {
      // `@:ts.optional` keeps Haxe source reads nullable, but the generated TS
      // object-boundary contract is omission/undefined. Normalize only while
      // emitting that marked field so ordinary Haxe optional fields still use
      // null as their source-level missing sentinel.
      write('(');
      emitValueWithExpectedType(expected, expr);
      write(' ?? undefined)');
      return;
    }
    emitValueWithExpectedType(expected, expr);
  }

  static function mayEmitNull(expr: TypedExpr): Bool {
    return switch expr.expr {
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, _):
        mayEmitNull(inner);
      case TConst(TNull):
        true;
      case TConst(_):
        false;
      case TObjectDecl(_) | TArrayDecl(_) | TFunction(_):
        false;
      default:
        typeAllowsNull(expr.t);
    }
  }

  function emitLocalVar(v: TVar) {
    write(localVarName(v));
  }

  function localVarName(v: TVar): String {
    final name = isGeneratedTempLocal(v.name) ? generatedLocalVarName(v) : scopedLocalVarName(v);
    return getLocalIdent(name);
  }

  function pushLocalNameScope(?parented: Bool = false): LocalNameScope {
    final previous: LocalNameScope = {
      names: scopedLocalNames,
      counts: scopedLocalNameCounts,
      parent: scopedLocalParent
    };
    scopedLocalNames = [];
    scopedLocalNameCounts = [];
    scopedLocalParent = parented ? previous : null;
    return previous;
  }

  function restoreLocalNameScope(previous: LocalNameScope) {
    scopedLocalNames = previous.names;
    scopedLocalNameCounts = previous.counts;
    scopedLocalParent = previous.parent;
  }

  function scopedLocalVarName(v: TVar): String {
    final found = scopedLocalNames.get(v.id);
    if (found != null)
      return found;
    var parent = scopedLocalParent;
    while (parent != null) {
      final found = parent.names.get(v.id);
      if (found != null)
        return found;
      parent = parent.parent;
    }

    final baseName = preferredLocalNames.exists(v.id) ? preferredLocalNames.get(v.id) : v.name;
    final count = scopedLocalNameCounts.exists(baseName) ? scopedLocalNameCounts.get(baseName) : 0;
    scopedLocalNameCounts.set(baseName, count + 1);
    final name = count == 0 ? baseName : '${baseName}_${count}';
    scopedLocalNames.set(v.id, name);
    return name;
  }

  function generatedLocalVarName(v: TVar): String {
    final found = generatedLocalNames.get(v.id);
    if (found != null)
      return found;

    final count = generatedLocalNameCounts.exists(v.name) ? generatedLocalNameCounts.get(v.name) : 0;
    generatedLocalNameCounts.set(v.name, count + 1);
    final name = count == 0 ? v.name : '${v.name}_${count}';
    generatedLocalNames.set(v.id, name);
    return name;
  }

  static function isGeneratedTempLocal(name: String): Bool {
    if (name == "_g")
      return true;
    if (!StringTools.startsWith(name, "_g"))
      return false;
    if (name.length == 2)
      return true;
    for (i in 2...name.length) {
      final code = name.charCodeAt(i);
      if (code < "0".code || code > "9".code)
        return false;
    }
    return true;
  }

  override function emitSwitch(cond: TypedExpr,
      cases: Array<{values: Array<TypedExpr>, expr: TypedExpr}>,
      def: Null<TypedExpr>, leaf: TypedExpr->Void,
      ?leafStartsWithNewline: Bool = true) {
    write('switch ');
    emitValue(cond);
    write(' {');
    increaseIndent();
    writeNewline();
    for (c in cases) {
      emitPos(c.expr.pos);
      for (v in c.values) {
        emitPos(v.pos);
        switch v.expr {
          case TConst(TNull):
            write('case null: case undefined:');
          default:
            write('case ');
            emitValue(v);
            write(':');
        }
      }
      // TypeScript/JavaScript `case` clauses do not create lexical scopes by
      // themselves. Wrap each body so Haxe enum-pattern locals with the same
      // source name can be emitted as normal declarations in sibling cases.
      write(' {');
      increaseIndent();
      if (!leafStartsWithNewline)
        writeNewline();
      final previousDeclare = declare;
      final previousLocalScope = pushLocalNameScope(true);
      declare = 'let';
      leaf(c.expr);
      declare = previousDeclare;
      restoreLocalNameScope(previousLocalScope);
      writeNewline();
      write('break;');
      decreaseIndent();
      writeNewline();
      write('}');
      writeNewline();
    }
    switch def {
      case null:
        // When Haxe proves a switch exhaustive, it often omits a `default` case.
        // In TS mode, a missing `default` can cause inferred return types to
        // include `undefined`, breaking assignability for callbacks (e.g. `Next.ofSafe`).
        // If any branch returns, add a default that throws to keep TS happy
        // without changing the successful-path semantics.
        if (cases.exists(c -> hasReturnExpr(c.expr))) {
          emitPos(cond.pos);
          write('default: {');
          increaseIndent();
          writeNewline();
          write('throw ');
          emitString('unreachable');
          write(';');
          decreaseIndent();
          writeNewline();
          write('}');
          writeNewline();
        }
      case e:
        emitPos(e.pos);
        write('default: {');
        increaseIndent();
        if (!leafStartsWithNewline)
          writeNewline();
        final previousLocalScope = pushLocalNameScope(true);
        leaf(e);
        restoreLocalNameScope(previousLocalScope);
        decreaseIndent();
        writeNewline();
        write('}');
        writeNewline();
    }
    decreaseIndent();
    writeNewline();
    write('}');
  }

  static function hasReturnExpr(e: TypedExpr): Bool {
    var found = false;
    function visit(e: TypedExpr) {
      if (found)
        return;
      switch e.expr {
        case TReturn(_):
          found = true;
        case TFunction(_):
          // Returns in nested functions do not affect the outer switch.
        default:
          e.iter(visit);
      }
    }
    visit(e);
    return found;
  }

  static function fieldAccessName(field: FieldAccess): Null<String> {
    return switch field {
      case FInstance(_, _, cf) | FStatic(_, cf) | FAnon(cf):
        TypeUtil.classFieldName(cf.get());
      case FDynamic(name): name;
      default: null;
    }
  }

  function privateMethodCall(e: TypedExpr): Null<PrivateMethodCall> {
    return switch unwrapExpr(e).expr {
      case TField(_, FInstance(_, _, _)):
        null;
      case TField(_, FStatic(owner, cf)):
        final ownerType = owner.get();
        final field = cf.get();
        if (!canLowerPrivateStaticClassField(ownerType, field))
          null;
        else {
          owner: ownerType,
          field: field,
          receiver: null
        };
      default:
        null;
    }
  }

  function isCurrentClass(cl: ClassType): Bool {
    return currentClass != null
      && cl.module == currentClass.module
      && cl.name == currentClass.name;
  }

  static function canLowerPrivateMethods(cl: ClassType): Bool {
    // Keep this opt-in while Genes still supports class-shaped JS output by
    // default. Downstreams that require clean declaration surfaces can opt
    // specific private static source helpers into unexported module functions
    // without changing broad class, stdlib/js support, or extern runtime
    // shapes. Instance helper lowering needs separate accessor/generic/method
    // value coverage before it can be safely enabled.
    return haxe.macro.Context.defined('genes.ts.lower_private_helpers')
      && !cl.isExtern
      && (cl.pack.length == 0 || (cl.pack[0] != 'haxe' && cl.pack[0] != 'js'));
  }

  static function canLowerPrivateStaticGenesField(cl: ClassType,
      field: GenesField): Bool {
    return field.isStatic && canLowerPrivateStaticFieldMeta(cl, field.name,
      field.isPublic, field.kind.equals(Method), field.meta);
  }

  static function canLowerPrivateStaticClassField(cl: ClassType,
      field: ClassField): Bool {
    return canLowerPrivateStaticFieldMeta(cl, field.name, field.isPublic,
      field.kind.match(FMethod(_)), field.meta);
  }

  static function canLowerPrivateStaticFieldMeta(cl: ClassType, name: String,
      isPublic: Bool, isMethod: Bool, meta: Null<MetaAccess>): Bool {
    return canLowerPrivateMethods(cl)
      && !isPublic
      && name != 'main'
      && isMethod
      && meta != null
      && (meta.has(':genesLowerPrivateHelper')
        || meta.has('genesLowerPrivateHelper')
        || meta.has(':genes.lowerPrivateHelper')
        || meta.has('genes.lowerPrivateHelper'));
  }

  function emitPrivateMethodCall(call: PrivateMethodCall,
      params: Array<TypedExpr>) {
    if (isCurrentClass(call.owner)) {
      write(privateMethodHelperName(call.owner, TypeUtil.classFieldName(call.field)));
      switch call.receiver {
        case null:
          write('(');
          for (param in join(params, write.bind(', ')))
            emitValue(param);
          write(')');
        case receiver:
          write('.call(');
          emitValue(receiver);
          if (params.length > 0)
            write(', ');
          for (param in join(params, write.bind(', ')))
            emitValue(param);
          write(')');
      }
    } else {
      emitPrivateMethodRuntimeAccess(call);
      write('(');
      for (param in join(params, write.bind(', ')))
        emitValue(param);
      write(')');
    }
  }

  function emitPrivateMethodValue(call: PrivateMethodCall) {
    if (isCurrentClass(call.owner)) {
      write(privateMethodHelperName(call.owner, TypeUtil.classFieldName(call.field)));
      switch call.receiver {
        case null:
        case receiver:
          write('.bind(');
          emitValue(receiver);
          write(')');
      }
    } else {
      emitPrivateMethodRuntimeAccess(call);
    }
  }

  function emitPrivateMethodRuntimeAccess(call: PrivateMethodCall) {
    write(ctx.typeAccessor(TypeUtil.registerType));
    write('.unsafeCast<{');
    emitMemberName(TypeUtil.classFieldName(call.field));
    write(': ');
    emitType(call.field.type);
    write('}>(');
    switch call.receiver {
      case null:
        write(ctx.typeAccessor((call.owner : BaseType)));
      case receiver:
        emitValue(receiver);
    }
    write(')');
    emitField(TypeUtil.classFieldName(call.field));
  }

  static function privateMethodHelperName(cl: ClassType, fieldName: String): String {
    return '__'
      + TypeUtil.className(cl).split('$').join('_')
      + '_'
      + fieldName.split('$').join('_');
  }

  static function shouldEmitClassMethod(cl: ClassType, field: GenesField): Bool {
    return field.isPublic
      || field.kind.equals(Constructor)
      || !field.isStatic
      || !canLowerPrivateStaticGenesField(cl, field)
      || !canLowerPrivateMethods(cl);
  }

  static function isPrivateStaticMain(field: GenesField): Bool {
    return field.isStatic && field.name == 'main' && field.kind.equals(Method);
  }

  static function moduleFieldName(field: GenesField): String {
    final native = TypeUtil.nativeName(field.meta);
    return native != null ? native : field.name;
  }

  static function isOverriddenField(field: FieldAccess): Bool {
    final meta = switch field {
      case FInstance(_, _, cf) | FStatic(_, cf) | FAnon(cf): cf.get().meta;
      default: null;
    }
    if (meta == null)
      return false;
    return meta.has(':ts.type') || meta.has(':genes.type');
  }

  static inline function isNullConst(e: TypedExpr): Bool
    return switch e.expr {
      case TConst(TNull): true;
      default: false;
    }

  static inline function isJsUndefinedConst(e: TypedExpr): Bool
    return switch unwrapExpr(e).expr {
      case TCall({
        expr: TField(_,
          FStatic(_.get() => {module: 'js.Syntax'}, _.get() => {name: 'code'}))
      }, [{expr: TConst(TString("undefined"))}]): true;
      default: false;
    }

  function emitValueWithPlainNull(e: TypedExpr) {
    switch e.expr {
      case TConst(TNull):
        write('null');
      case _ if (comparisonOperandNeedsParens(e)):
        write('(');
        emitValue(e);
        write(')');
      default:
        emitValue(e);
    }
  }

  /**
   * Parenthesizes comparison operands whose emitted TypeScript contains `??`.
   *
   * Why: Haxe code often normalizes TypeScript `undefined` to Haxe `null`
   * through helpers such as `genes.ts.Undefinable<T>.orNull()`, which lowers to
   * `js.Syntax.code("{0} ?? null", value)`. When that expression is compared
   * against `null`, TypeScript precedence would parse `value ?? null != null`
   * as `value ?? (null != null)`. The intended Haxe semantics are
   * `(value ?? null) != null`.
   *
   * What/How: only the null-comparison path calls this helper. It keeps simple
   * operands untouched, but wraps explicit Haxe null-coalescing expressions and
   * raw syntax templates that contain `??`, preserving semantics without adding
   * broad parentheses to ordinary comparisons.
   */
  function comparisonOperandNeedsParens(e: TypedExpr): Bool {
    return switch e.expr {
      #if (haxe_ver >= 4.3)
      case TBinop(OpNullCoal, _, _):
        true;
      #end
      default: final template = jsSyntaxCodeTemplate(e); template != null && template.indexOf('??') != -1;
    }
  }

  override public function emitConstant(c: TConstant)
    switch (c) {
      case TNull:
        write('null');
      default:
        super.emitConstant(c);
    }

  function emitForwardArgs(f: TFunc, field: GenesField) {
    switch field.type {
      case TFun(args, _):
        for (i in 0...args.length) {
          if (i > 0)
            write(', ');
          final arg = args[i];
          if (genes.util.TypeUtil.isRest(arg.t))
            write('...');
          emitLocalVar(f.args[i].v);
        }
      default:
    }
  }

  function emitTypedFunctionArguments(f: TFunc, field: GenesField) {
    emitTypedFunctionArgumentsWithType(f, field, null);
  }

  function emitTypedFunctionArgumentsWithType(f: TFunc, field: GenesField,
      declaredType: Null<Type>) {
    final effectiveType = declaredType != null ? declaredType : field.type;
    final cachedSig = (currentClass != null) ? SignatureCache.getSig(currentClass,
      field.isStatic, field.name) : null;
    switch effectiveType {
      case TFun(args, _):
        final cachedArgs = (cachedSig != null
          && cachedSig.args.length == args.length) ? cachedSig.args : null;
        // Handle Haxe optional argument skipping semantics (same as TypeEmitter.emitArgs).
        var noOptionalUntil = -1;
        var hadOptional = true;
        for (i in 0...args.length) {
          final arg = args[i];
          final opt = cachedArgs != null ? cachedArgs[i].opt : arg.opt;
          if (opt) {
            hadOptional = true;
          } else if (hadOptional && !opt) {
            noOptionalUntil = i;
            hadOptional = false;
          }
        }

        for (i in genes.util.IteratorUtil.joinIt(0...args.length,
          write.bind(', '))) {
          final arg = args[i];
          final argType = (i >= 0 && i < f.args.length) ? f.args[i].v.t : arg.t;
          final opt = cachedArgs != null ? cachedArgs[i].opt : arg.opt;
          if (genes.util.TypeUtil.isRest(arg.t))
            write('...');
          emitLocalVar(f.args[i].v);
          final optional = opt && i > noOptionalUntil;
          final defaultNull = optional
            && (cachedArgs != null ? cachedArgs[i].allowsNull : typeAllowsNull(argType));
          if (optional && !defaultNull)
            write('?');
          write(': ');
          final cachedType = cachedArgs != null ? cachedArgs[i].tsType : null;
          emitArgTsType(field, f, i, argType, cachedType);
          if (defaultNull)
            write(' = null');
        }
      default:
        // Fallback: keep old behavior.
        emitFunctionArguments(f);
    }
  }

  function emitCtorImplementationArguments(f: TFunc, field: GenesField) {
    // Avoid TS override checks across the prototype chain:
    // constructors are not overrides in Haxe, but Genes' runtime uses the same
    // `[Register.new]` key for initialization.
    switch field.type {
      case TFun(args, _):
        for (i in genes.util.IteratorUtil.joinIt(0...args.length,
          write.bind(', '))) {
          final arg = args[i];
          if (genes.util.TypeUtil.isRest(arg.t))
            write('...');
          emitLocalVar(f.args[i].v);
          if (!genes.util.TypeUtil.isRest(arg.t))
            write('?');
          write(': ');
          if (genes.util.TypeUtil.isRest(arg.t))
            write('any[]');
          else
            write('any');
        }
      default:
        emitFunctionArguments(f);
    }
  }

  function emitArgTsType(field: GenesField, f: TFunc, index: Int, type: Type,
      fallbackType: Null<String>) {
    // TS `strict` enables `useUnknownInCatchVariables`, so catch variables are
    // `unknown`. Avoid emitting `Register.unsafeCast<any>(...)` in user modules
    // by making `haxe.Exception.caught` accept `unknown` in TS.
    if (currentClass != null
      && currentClass.module == 'haxe.Exception'
      && currentClass.name == 'Exception'
      && field.name == 'caught'
      && index == 0) {
      write('unknown');
      return;
    }

    // haxe.Exception/ValueException are part of the JS runtime surface.
    //
    // In Haxe, `native: Any` can represent arbitrary thrown values. In TS, the
    // closest semantic match is `unknown` (safe top type), not `any`.
    if (currentClass != null) {
      if (currentClass.module == 'haxe.Exception'
        && currentClass.name == 'Exception'
        && field.kind.equals(Constructor)
        && index == 2) {
        write('unknown | null');
        return;
      }
      if (currentClass.module == 'haxe.Exception'
        && currentClass.name == 'Exception'
        && field.isStatic
        && field.name == 'thrown'
        && index == 0) {
        write('unknown');
        return;
      }
      if (currentClass.module == 'haxe.ValueException'
        && currentClass.name == 'ValueException') {
        if (field.kind.equals(Constructor) && index == 0) {
          write('unknown');
          return;
        }
        if (field.kind.equals(Constructor) && index == 2) {
          write('unknown | null');
          return;
        }
      }
    }

    // Param-level override (preferred): @:ts.type / @:genes.type on the argument var meta.
    final argMeta = f.args[index].v.meta;
    final typeOverride = switch argMeta.extract(':ts.type') {
      case [{params: [{expr: EConst(CString(typeOverride))}]}]:
        typeOverride;
      default:
        switch argMeta.extract(':genes.type') {
          case [{params: [{expr: EConst(CString(typeOverride))}]}]:
            typeOverride;
          default:
            null;
        }
    };
    if (typeOverride != null) {
      write(typeOverride);
      return;
    }
    if (fallbackType != null) {
      write(fallbackType);
      return;
    }
    emitType(type);
  }

  function emitReturnTsType(field: GenesField, f: TFunc,
      declaredType: Null<Type>) {
    final returnOverride = field.meta != null ? (switch extractStringMeta(field.meta,
      ':ts.returnType') {
      case null: extractStringMeta(field.meta, ':genes.returnType');
      case v: v;
    }) : null;
    if (returnOverride != null) {
      write(returnOverride);
      return;
    }
    final cachedSig = (currentClass != null) ? SignatureCache.getSig(currentClass,
      field.isStatic, field.name) : null;
    if (cachedSig != null && cachedSig.retTsType != null) {
      write(cachedSig.retTsType);
      return;
    }

    if (currentClass != null && currentClass.module == 'haxe.Exception'
      && currentClass.name == 'Exception') {
      if (field.isStatic && field.name == 'thrown') {
        write('unknown');
        return;
      }
      if (!field.isStatic && field.name == 'get_native') {
        write('unknown');
        return;
      }
    }
    emitType(f.t);
  }

  function emitFieldTsType(field: GenesField) {
    if (field.tsType != null) {
      write(field.tsType);
      return;
    }

    final cachedFieldType = currentClass == null ? null : SignatureCache.getFieldTsType(currentClass,
      field.isStatic, field.name);
    if (cachedFieldType != null) {
      write(cachedFieldType);
      return;
    }

    if (currentClass != null) {
      if (currentClass.module == 'haxe.Exception'
        && currentClass.name == 'Exception') {
        switch field.name {
          case 'native' | '__nativeException':
            write('unknown');
            return;
          default:
        }
      }
      if (currentClass.module == 'haxe.ValueException'
        && currentClass.name == 'ValueException' && field.name == 'value') {
        write('unknown');
        return;
      }
    }
    emitType(field.type, field.isStatic ? null : field.params);
  }

  function emitTsInterface(cl: ClassType, fields: Array<GenesField>) {
    var clForFields = cl;
    try {
      final declaredPath = cl.pack.concat([cl.name]).join('.');
      final fullName = (declaredPath == cl.module) ? declaredPath : (cl.module
        + '.'
        + cl.name);
      switch haxe.macro.Context.getType(fullName) {
        case TInst(ref, _):
          clForFields = ref.get();
        default:
      }
    } catch (_:Dynamic) {}

    writeNewline();
    emitComment(cl.doc);
    emitPos(cl.pos);
    write('export interface ');
    write(TypeUtil.className(cl));
    if (cl.params != null && cl.params.length > 0)
      emitTypeParamDecls(cl.params.map(p -> p.t), true);
    if (cl.interfaces != null && cl.interfaces.length > 0) {
      write(' extends ');
      for (i in join(cl.interfaces, write.bind(', '))) {
        write(ctx.typeAccessor(i.t.get()));
        if (i.params != null && i.params.length > 0)
          TypeEmitter.emitParams(this, i.params, true);
      }
    }
    write(' {');
    increaseIndent();
    for (field in clForFields.fields.get()) {
      if (!field.isPublic)
        continue;
      switch field.kind {
        case FVar(_, _):
          writeNewline();
          emitPos(field.pos);
          emitMemberName(TypeUtil.classFieldName(field));
          write(': ');
          final typeOverride = extractStringMeta(field.meta,
            ':ts.type') ?? extractStringMeta(field.meta, ':genes.type');
          if (typeOverride != null)
            write(typeOverride);
          else
            emitType(field.type);
          write(';');
        case FMethod(_):
          writeNewline();
          emitPos(field.pos);
          emitMemberName(TypeUtil.classFieldName(field));
          if (field.params != null && field.params.length > 0)
            emitTypeParamDecls(field.params.map(p -> p.t), true);
          write('(');
          emitFunctionTypeArguments(field.type);
          write('): ');
          emitFunctionReturnType(field.type);
          write(';');
      }
    }
    writeNewline();
    write('[key: string]: any;');
    decreaseIndent();
    writeNewline();
    write('}');
    writeNewline();

    // Runtime marker (Genes runtime compatibility).
    write('export const ');
    write(TypeUtil.className(cl));
    write(' = function() {};');
    writeNewline();
    write(TypeUtil.className(cl));
    write('.__isInterface__ = true;');
    writeNewline();
  }

  function emitFunctionTypeArguments(type: Type) {
    switch type {
      case TFun(args, _):
        for (arg in join(args, write.bind(', '))) {
          if (genes.util.TypeUtil.isRest(arg.t))
            write('...');
          emitLocalIdent(arg.name != "" ? arg.name : 'arg');
          if (arg.opt)
            write('?');
          write(': ');
          emitType(arg.t);
        }
      default:
    }
  }

  function emitFunctionReturnType(type: Type) {
    switch type {
      case TFun(_, ret):
        emitType(ret);
      default:
        write('any');
    }
  }

  function emitTsEnum(et: EnumType) {
    final discriminator = haxe.macro.Context.definedValue('genes.enum_discriminator');
    final id = et.pack.concat([et.name]).join('.');
    final enumParams = et.params != null ? et.params.map(p -> p.t) : [];
    writeNewline();
    emitComment(et.doc);
    emitPos(et.pos);

    // Emit TS union types for enums using declaration merging.
    //
    // IMPORTANT: TS does not allow `export const EnumName` to merge with
    // `export declare namespace EnumName` (duplicate identifier). A function
    // works as the runtime enum container while still allowing type namespace
    // merging.
    write('export declare namespace ');
    write(et.name);
    write(' {');
    increaseIndent();
    writeNewline();
    emitPos(et.pos);
    if (ctx.hasFeature('js.Boot.isEnum')) {
      writeNewline();
      emitPos(et.pos);
      write('export const __ename__: string;');
    }

    for (ctorName in et.names) {
      final c = et.constructs.get(ctorName);
      final ctorParams = c.params != null ? c.params.map(p -> p.t) : [];
      writeNewline();
      emitComment(c.doc);
      emitPos(c.pos);
      write('export type ');
      write(ctorName);
      emitEnumCtorTypeParamDecls(enumParams, ctorParams, true);
      write(' = {');
      if (discriminator != null) {
        emitString(discriminator);
        write(': ');
        emitString(ctorName);
        write(', ');
      }
      write('_hx_index: ${c.index}');
      switch c.type {
        case TFun(args, _):
          for (arg in args) {
            write(', ');
            emitIdent(arg.name);
            write(': ');
            emitType(arg.t);
          }
        default:
      }
      write(', __enum__: ');
      emitString(id);
      write('}');

      writeNewline();
      emitPos(c.pos);
      write('export const ');
      write(ctorName);
      write(': ');
      switch c.type {
        case TFun(args, ret):
          final allParams = enumParams.concat(c.params.map(p -> p.t));
          final used = new Map<String, Bool>();
          for (a in args)
            collectUsedTypeParamKeys(a.t, used);
          emitTypeParamDeclsUnusedNever(allParams, true, used, false);
          write('(');
          for (arg in join(args, write.bind(', '))) {
            emitIdent(arg.name);
            if (arg.opt)
              write('?');
            write(': ');
            emitType(arg.t);
          }
          write(') => ');
          emitType(ret);
        default:
          write(ctorName);
          // Nullary constructors should be usable as any instantiation of the
          // enum's type params; emit `<never, ...>` to keep TS assignment-friendly
          // without leaking `any` into user modules.
          if (enumParams.length > 0) {
            write('<');
            for (_ in join(enumParams, write.bind(', ')))
              write('never');
            write('>');
          }
      }
      write(';');
    }
    writeNewline();
    emitPos(et.pos);
    write('export type __Construct = ');
    for (ctorName in join(et.names, write.bind(' | '))) {
      write('typeof ');
      write(ctorName);
    }
    write(';');
    writeNewline();
    emitPos(et.pos);
    write('export const __constructs__: __Construct[];');

    writeNewline();
    emitPos(et.pos);
    write('export type __EmptyConstruct = ');
    final emptyCtorNames = [
      for (name in et.names)
        if (!et.constructs[name].type.match(TFun(_, _))) name
    ];
    if (emptyCtorNames.length == 0) {
      write('never');
    } else {
      for (ctorName in join(emptyCtorNames, write.bind(' | '))) {
        write('typeof ');
        write(ctorName);
      }
    }
    write(';');
    writeNewline();
    emitPos(et.pos);
    write('export const __empty_constructs__: __EmptyConstruct[];');
    decreaseIndent();
    writeNewline();
    write('}');
    writeNewline();

    writeNewline();
    emitComment(et.doc);
    emitPos(et.pos);
    write('export type ');
    write(et.name);
    emitTypeParamDecls(enumParams, true);
    write(' =');
    increaseIndent();
    for (ctorName in et.names) {
      final c = et.constructs.get(ctorName);
      writeNewline();
      emitComment(c.doc);
      write('| ');
      write(et.name);
      write('.');
      emitPos(c.pos);
      write(ctorName);
      TypeEmitter.emitParams(this, enumParams, false);
    }
    decreaseIndent();
    writeNewline();

    emitPos(et.pos);
    write('export function ');
    write(et.name);
    write('() {}');
    writeNewline();
    writeNewline();
    if (!haxe.macro.Context.defined('genes.ts.minimal_runtime')) {
      write(ctx.typeAccessor(TypeUtil.registerType));
      write('.setHxEnum(');
      emitString(id);
      write(', ');
      write(et.name);
      write(');');
      writeNewline();
    }

    writeNewline();
    write('Object.assign(');
    write(et.name);
    write(', {');
    increaseIndent();
    writeNewline();
    if (ctx.hasFeature('js.Boot.isEnum')) {
      write('__ename__: ');
      emitString(id);
      write(',');
      writeNewline();
    }
    for (ctorName in join(et.names, () -> {
      write(',');
      writeNewline();
    })) {
      final c = et.constructs.get(ctorName);
      emitComment(c.doc);
      emitPos(c.pos);
      write(ctorName);
      write(': ');
      switch c.type {
        case TFun(args, _):
          write('Object.assign(');
          final allParams = enumParams.concat(c.params.map(p -> p.t));
          final used = new Map<String, Bool>();
          for (a in args)
            collectUsedTypeParamKeys(a.t, used);
          emitTypeParamDeclsUnusedNever(allParams, true, used, true);
          write('(');
          for (param in join(args, write.bind(', '))) {
            emitLocalIdent(param.name);
            if (param.opt)
              write('?');
            write(': ');
            emitType(param.t);
          }
          write(') => ({_hx_index: ${c.index}, __enum__: ');
          emitString(id);
          write(', ');
          for (param in join(args, write.bind(', '))) {
            emitString(param.name);
            write(': ');
            emitLocalIdent(param.name);
          }
          if (discriminator != null) {
            write(', ');
            emitString(discriminator);
            write(': ');
            emitString(ctorName);
          }
          write('}), {_hx_name: ');
          emitString(ctorName);
          write(', __params__: [');
          for (param in join(args, write.bind(', ')))
            emitString(param.name);
          write(']})');
        default:
          write('{_hx_name: ');
          emitString(ctorName);
          write(', _hx_index: ${c.index}, __enum__: ');
          emitString(id);
          if (discriminator != null) {
            write(', ');
            emitString(discriminator);
            write(': ');
            emitString(ctorName);
          }
          write('}');
      }
    }
    decreaseIndent();
    writeNewline();
    write('});');
    writeNewline();

    writeNewline();
    write('Object.assign(');
    write(et.name);
    write(', {');
    increaseIndent();
    writeNewline();
    write('__constructs__: [');
    for (ctorName in join(et.names, write.bind(', '))) {
      #if (haxe_ver >= 4.2)
      write(et.name);
      emitField(ctorName);
      #else
      emitString(ctorName);
      #end
    }
    write('],');
    writeNewline();
    write('__empty_constructs__: [');
    final empty = [
      for (name in et.names)
        if (!et.constructs[name].type.match(TFun(_, _))) et.constructs[name]
    ];
    for (c in join(empty, write.bind(', '))) {
      write(et.name);
      emitField(c.name);
    }
    write(']');
    decreaseIndent();
    writeNewline();
    write('});');
    writeNewline();
  }

  function emitTsTypeDefinition(def: DefType, params: Array<Type>) {
    // Prefer TypeScript builtins for well-known JS types to avoid "stringly"
    // typedefs (e.g. `{ status: string, ... }`) and reduce `any` usage.
    if (def.module == 'js.lib.Promise') {
      switch def.name {
        case 'PromiseSettleOutcome' if (params.length == 1):
          writeNewline();
          emitComment(def.doc);
          emitPos(def.pos);
          write('export type ');
          TypeEmitter.emitBaseType(this, def, params, true);
          write(' = PromiseSettledResult<');
          emitType(params[0]);
          write('>');
          writeNewline();
          return;
        case 'ThenableStruct' if (params.length == 1):
          writeNewline();
          emitComment(def.doc);
          emitPos(def.pos);
          write('export type ');
          TypeEmitter.emitBaseType(this, def, params, true);
          write(' = PromiseLike<');
          emitType(params[0]);
          write('>');
          writeNewline();
          return;
        default:
      }
    }
    // WebIDL-generated DOM iterator typedefs in Haxe std are often `next(): Dynamic`,
    // which becomes `next(): any` in TS output. Replace the entire typedef with the
    // idiomatic TS iterator type when we can provide the correct element type.
    //
    // NOTE: These are purely type-level overrides; runtime values come from the DOM.
    if (def.module == 'js.html.HeadersIterator'
      && def.name == 'HeadersIterator') {
      writeNewline();
      emitComment(def.doc);
      emitPos(def.pos);
      write('export type ');
      TypeEmitter.emitBaseType(this, def, params, true);
      write(' = IterableIterator<[string, string]>');
      writeNewline();
      return;
    }
    if (def.module == 'js.html.URLSearchParamsIterator'
      && def.name == 'URLSearchParamsIterator') {
      writeNewline();
      emitComment(def.doc);
      emitPos(def.pos);
      write('export type ');
      TypeEmitter.emitBaseType(this, def, params, true);
      write(' = IterableIterator<[string, string]>');
      writeNewline();
      return;
    }
    if (def.module == 'js.html.FormDataIterator'
      && def.name == 'FormDataIterator') {
      writeNewline();
      emitComment(def.doc);
      emitPos(def.pos);
      write('export type ');
      TypeEmitter.emitBaseType(this, def, params, true);
      // TS DOM lib provides `FormDataEntryValue = File | string`.
      write(' = IterableIterator<[string, FormDataEntryValue]>');
      writeNewline();
      return;
    }
    if (def.module == 'js.lib.Object') {
      switch def.name {
        case 'ObjectPropertyDescriptor':
          writeNewline();
          emitComment(def.doc);
          emitPos(def.pos);
          write('export type ');
          TypeEmitter.emitBaseType(this, def, params, true);
          write(' = PropertyDescriptor');
          writeNewline();
          return;
        default:
      }
    }

    writeNewline();
    emitComment(def.doc);
    emitPos(def.pos);
    write('export type ');
    TypeEmitter.emitBaseType(this, def, params, true);
    write(' = ');
    final typeOverride = switch def.meta.extract(':ts.type') {
      case [{params: [{expr: EConst(CString(type))}]}]: type;
      default:
        switch def.meta.extract(':genes.type') {
          case [{params: [{expr: EConst(CString(type))}]}]: type;
          default: null;
        }
    };
    if (typeOverride != null)
      write(typeOverride);
    else
      emitType(def.type);
    writeNewline();
  }

  public function includeType(type: Type) {}

  public function typeAccessor(type: TypeAccessor)
    return ctx.typeAccessor(type);

  function emitType(type: Type, ?params: Array<TypeParameter>) {
    if (params != null && params.length > 0)
      TypeEmitter.emitParams(this, params.map(p -> p.t), true);
    TypeEmitter.emitType(this, type, params == null);
  }

  static function extractStringMeta(meta: Null<MetaAccess>,
      name: String): Null<String> {
    if (meta == null)
      return null;
    return switch meta.extract(name) {
      case [{params: [{expr: EConst(CString(value))}]}]: value;
      default: null;
    }
  }
}

private enum ReactJsxProp {
  Normal(name: String, value: TypedExpr);
  Spread(expr: TypedExpr);
}
