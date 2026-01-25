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
  var currentReturnType: Null<Type> = null;
  var currentReturnIsVoidLike: Bool = false;

  function typeEmitsAny(t: Type): Bool {
    final fast = switch t {
      case TDynamic(null):
        true;
      case TInst(_.get() => cl, _) if (cl.module != null && cl.module.startsWith('haxe.macro')):
        true;
      case TType(_.get() => dt, _) if (dt.module != null && dt.module.startsWith('haxe.macro')):
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

  public function emitTsModule(module: Module, importExtension: Null<String>) {
    final endTimer = timer('emitTsModule');
    jsxEmitTsx = genes.Genes.outExtension == '.tsx';
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
    } else if (usesReactJsxMarkers && jsxEmitTsx && haxe.macro.Context.defined('genes.ts.jsx_classic')) {
      write('import * as ');
      write(JSX_CLASSIC_REACT_IMPORT);
      write(' from ');
      emitString('react');
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
      case TField(_,
        FStatic(_.get() => cl, _.get() => {name: name}))
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
          pos: dep.pos
        });
      }
    }
  }

  function emitTsImports(where: String,
      imports: Array<genes.Dependencies.Dependency>, extension: Null<String>,
      typeOnly: Bool) {
    final named = [];
    for (def in imports)
      switch def.type {
        case genes.Dependencies.DependencyType.DAsterisk
          | genes.Dependencies.DependencyType.DDefault:
          emitTsImport([def], where, extension, typeOnly);
        default:
          named.push(def);
      }
    if (named.length > 0)
      emitTsImport(named, where, extension, typeOnly);
  }

  function emitTsImport(what: Array<genes.Dependencies.Dependency>, where: String,
      extension: Null<String>, typeOnly: Bool) {
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
    writeNewline();
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
            if (args.length > 0)
              write(', ');
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
          if (!typeAllowsNull(expected) && typeAllowsNull(actual.t)) {
            needsCasts = true;
            break;
          }
        }
      }
      final isPlainCall = switch unwrapExpr(e).expr {
        case TIdent('`trace' | "__resources__" | "__new__" | "__instanceof__"
          | "__typeof__" | "__strict_eq__" | "__strict_neq__"
          | "__define_feature__" | "__feature__"):
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
          final actual = params[i];
          final actualUnwrapped = unwrapExpr(actual);
          if (expected != null && isUnresolvedMono(expected)
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
          } else if (expected != null && !typeAllowsNull(expected)
            && typeAllowsNull(actual.t) && !isTypeParam(expected)) {
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
    super.emitCall(e, params, inValue);
  }

  function emitReactJsxElement(args: Array<TypedExpr>) {
    if (args.length != 3)
      haxe.macro.Context.error('Invalid JSX marker call', args.length > 0 ? args[0].pos : haxe.macro.Context.currentPos());

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
      || first == '_'.code || first == '$'.code))
      return false;
    for (i in 1...name.length) {
      final c = name.charCodeAt(i);
      if (!((c >= 'a'.code && c <= 'z'.code) || (c >= 'A'.code && c <= 'Z'.code)
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
          emitMemberName(field.isStatic ? staticName(cl, field) : field.name);
          write(': ');
          // Node vs DOM timer handles: `setInterval` return type varies by lib.
          // Model `haxe.Timer.id` as whatever the host `setInterval` returns.
          if (!field.isStatic && field.name == 'id' && cl.pack.join('.') == 'haxe'
            && cl.name == 'Timer') {
            write('ReturnType<typeof setInterval> | null');
          } else {
            emitFieldTsType(field);
          }
          write(';');
        case Method
          #if (haxe_ver >= 4.2) if (!field.isAbstract) #end:
          // Module-level externs (KModuleFields) can be declared as extern
          // functions (no body) with `@:jsRequire`. These appear as static
          // fields on the module fields class, so we declare them as function
          //-typed properties and bind them at runtime in the JS emitter.
          if (field.expr == null && field.isStatic && field.meta != null
            #if (haxe_ver >= 4.2)
            && cl.kind.match(KModuleFields(_))
            #end
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
      switch field.kind {
        case Constructor | Method
          #if (haxe_ver >= 4.2) if (!field.isAbstract) #end:
          switch field.expr {
            case null:
            case {expr: TFunction(f)}:
              writeNewline();
              if (field.doc != null)
                writeNewline();
              emitComment(field.doc);
              emitPos(field.pos);
              final isAsync = field.meta != null && (field.meta.has(':jsAsync') || field.meta.has('jsAsync'));
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
              emitMemberName(field.name);
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
              final isRuntimeUnsafeCast = field.isStatic && field.name == 'unsafeCast'
                && cl.module == 'genes.Register' && cl.name == 'Register';
              if (isRuntimeUnsafeCast) {
                // `Register.unsafeCast` must be the identity function at runtime.
                // Avoid emitter-inserted casts causing infinite recursion here.
                write('{');
                increaseIndent();
                writeNewline();
                write('return ');
                if (f.args.length > 0)
                  emitLocalIdent(f.args[0].v.name);
                else
                  write('undefined');
                write(';');
                decreaseIndent();
                writeNewline();
                write('}');
              } else {
                switch [returnOverride, body.expr] {
                  case [v, TBlock([])] if (v != null && v != 'any' && v != 'void' && v != 'undefined'):
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
                      default:
                        currentReturnType != null && isVoidLike(currentReturnType);
                    }
                    emitExpr(body);
                    currentReturnType = prevReturn;
                    currentReturnIsVoidLike = prevVoidLike;
                }
              }
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

    // Register class in $hxClasses registry (Genes runtime compatibility).
    final id = cl.pack.concat([TypeUtil.className(cl)]).join('.');
    if (id != 'genes.Register' && !haxe.macro.Context.defined('genes.ts.minimal_runtime')) {
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
        emitString(field.name);
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
        emitString(field.name);
        write(');');
        writeNewline();
      }
    }

    currentClass = prevClass;
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

  static function collectUsedTypeParamKeys(type: Type, used: Map<String, Bool>) {
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

  function emitTypeParamDeclsUnusedNever(params: Array<Type>, withConstraints: Bool,
      used: Map<String, Bool>, tsxSafe: Bool) {
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

  function emitTypeParamDeclsTsxSafe(params: Array<Type>, withConstraints: Bool) {
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
    write('$declare ');
    emitLocalIdent(v.name);
    write(': ');
    TypeEmitter.emitType(this, v.t);
    switch (eo) {
      case null:
      case {expr: TConst(TNull)}:
        if (typeAllowsNull(v.t)) {
          write(' = null');
        } else {
          write(' = ');
          write(ctx.typeAccessor(TypeUtil.registerType));
          write('.unsafeCast<');
          TypeEmitter.emitType(this, v.t);
          write('>(null)');
        }
      case e:
        write(' = ');
        if (tryEmitReactUseStateCall(v.t, e)) {
          return;
        }
        if (!typeAllowsNull(v.t) && typeAllowsNull(e.t)) {
          write(ctx.typeAccessor(TypeUtil.registerType));
          write('.unsafeCast<');
          TypeEmitter.emitType(this, v.t);
          write('>(');
          emitValue(e);
          write(')');
        } else {
          emitValue(e);
        }
    }
  }

  static function extractTypeArgs(t: Type): Array<Type> {
    return switch t {
      case TAbstract(_, params) | TType(_, params) | TInst(_, params) | TEnum(_, params):
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
        if (isUseStateCallee(callee)
          && args.length == 1):
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
      case TInst(_.get() => {module: "js.lib.Promise", name: "Promise"}, [inner])
        | TInst(_.get() => {pack: ["js", "lib"], name: "Promise"}, [inner]):
        isVoidLike(inner);
      case TType(_.get() => {module: "js.lib.Promise", name: "Promise"}, [inner])
        | TType(_.get() => {pack: ["js", "lib"], name: "Promise"}, [inner]):
        isVoidLike(inner);
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

  override public function emitValue(e: TypedExpr) {
    emitPos(e.pos);
    switch e.expr {
      case TCall({
        expr: TField(_,
          FStatic(_.get() => {module: 'js.Syntax'}, _.get() => {name: 'code'}))
      }, [{expr: TConst(TString("undefined"))}])
        if (typeAllowsNull(e.t)):
        // See `emitExpr` for rationale.
        write('null');
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
      default:
        super.emitValue(e);
    }
  }

  override public function emitExpr(e: TypedExpr) {
    emitPos(e.pos);
    switch e.expr {
      case TCall({
        expr: TField(_,
          FStatic(_.get() => {module: 'js.Syntax'}, _.get() => {name: 'code'}))
      }, [{expr: TConst(TString("undefined"))}])
        if (typeAllowsNull(e.t)):
        // Haxe stdlib sometimes uses `js.Syntax.code("undefined")` in places
        // where `null` is the intended "no value" signal (e.g. `HxOverrides.cca`).
        // Normalize to `null` to keep TS `strictNullChecks` consistent.
        write('null');
      case TConst(TNull):
        if (typeAllowsNull(e.t)) {
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
        if (typeEmitsAny(e.t)) {
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
          case FInstance(_, _, cf) | FStatic(_, cf) | FAnon(cf): cf.get().meta;
          default: null;
        }
        final typeOverride = extractStringMeta(meta, ':ts.type')
          ?? extractStringMeta(meta, ':genes.type');
        // If the override is `any`, no cast is required and emitting `<any>`
        // would leak `any` into user modules.
        if (typeOverride == null || typeOverride == 'any') {
          emitValue(rhs);
        } else {
          write(ctx.typeAccessor(TypeUtil.registerType));
          write('.unsafeCast<');
          write(typeOverride);
          write('>(');
          emitValue(rhs);
          write(')');
        }
      case TBinop(op = OpAssign, lhs, rhs)
        if (!typeAllowsNull(lhs.t) && typeAllowsNull(rhs.t)):
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
        emitValue(rhs);
        write(')');
      case TBinop(op = OpAssign | OpAssignOp(_), lhs, rhs):
        // Avoid optional-field `?? null` rewrites on assignment targets.
        inAssignTarget = true;
        emitValue(lhs);
        inAssignTarget = false;
        writeSpace();
        writeBinop(op);
        writeSpace();
        emitValue(rhs);
      case TArray(_, _)
        if (!inAssignTarget && typeAllowsNull(e.t)):
        // Haxe generally models missing values as `null` while JS property/index
        // reads can produce `undefined`. Normalize to `null` for TS `strict`.
        write('(');
        super.emitExpr(e);
        write(' ?? null)');
      case TField(x, f)
        // If the receiver type is nullable in TS (`T | null`), TS does not
        // reliably narrow property accesses across statements (e.g. `this.pos`).
        // Add a non-null assertion to preserve Haxe semantics under `strict`.
        //
        // Note: skip dynamic-iterator special cases handled by the JS emitter.
        if (typeAllowsNull(x.t)
          && !(fieldAccessName(f) == "iterator" && genes.util.TypeUtil.isDynamicIterator(x))):
        final isOptionalField = !inAssignTarget && switch f {
          case FAnon(cf) | FInstance(_, _, cf) | FStatic(_, cf):
            final meta = cf.get().meta;
            meta != null && meta.has(':optional');
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
        write('(');
        emitValue(skip(x));
        write('!)');
        switch f {
          case FStatic(_.get() => c, _):
            emitStaticField(c, TypeUtil.fieldName(f));
          case FEnum(_), FInstance(_), FAnon(_), FDynamic(_), FClosure(_):
            emitField(TypeUtil.fieldName(f));
        }
        if (isOptionalField)
          write(' ?? null)');
      case TField(_, f)
        if (!inAssignTarget && switch f {
          case FAnon(cf) | FInstance(_, _, cf) | FStatic(_, cf):
            final meta = cf.get().meta;
            meta != null && meta.has(':optional');
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
            final isNull = isNullConst(unwrapped) || isJsUndefinedConst(unwrapped);
            if (currentReturnIsVoidLike && isNull) {
              // Haxe often uses `null` as the implicit return value for `Void`.
              // In TS, `return null` is not valid for `void` / `Promise<void>`.
              write('return');
            } else {
              write('return ');
              if (ret != null && !typeAllowsNull(ret) && typeAllowsNull(e1.t)) {
                write(ctx.typeAccessor(TypeUtil.registerType));
                write('.unsafeCast<');
                TypeEmitter.emitType(this, ret);
                write('>(');
                emitValue(e1);
                write(')');
              } else {
                emitValue(e1);
              }
            }
        }
      case TCall({expr: TField(_, f)}, [])
        if (switch fieldAccessName(f) { case "shift" | "pop": true; default: false; }):
        // Normalize JS `undefined` to Haxe `null` for Array#shift/#pop.
        // This keeps TS strict-null types aligned with Haxe semantics.
        write('(');
        super.emitExpr(e);
        write(' ?? null)');
      case TCall(fn = {expr: TCall({expr: TField(_, f)}, _)}, args)
        if (switch fieldAccessName(f) { case "shift" | "pop": true; default: false; }):
        // Array#shift/#pop returns `T | undefined` in TS. When the Haxe code
        // guarantees non-emptiness (e.g. checked `.length > 0`), allow calling
        // the returned function under `strict`.
        write('(');
        emitValue(fn);
        write('!)(');
        for (arg in join(args, write.bind(', ')))
          emitValue(arg);
        write(')');
      case TFunction(f):
        final inValue = this.inValue;
        final inLoop = this.inLoop;
        final prevReturn = currentReturnType;
        final prevVoidLike = currentReturnIsVoidLike;
        currentReturnType = switch e.t {
          case TFun(_, ret): ret;
          default: null;
        }
        currentReturnIsVoidLike = currentReturnType != null && isVoidLike(currentReturnType);
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
          emitLocalIdent(arg.v.name);
          final omitType = (arg.v.name == '_' || StringTools.startsWith(arg.v.name, '_'))
            && typeEmitsAny(t);
          if (!omitType) {
            final optional = i < args.length && args[i].opt && i > noOptionalUntil;
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
      case TBinop(op = OpEq | OpNotEq, e1, e2) if (isNullConst(e1) || isNullConst(e2)):
        emitValueWithPlainNull(e1);
        writeSpace();
        writeBinop(op);
        writeSpace();
        emitValueWithPlainNull(e2);
      case TCall({expr: TField(_, f)}, [{expr: TConst(TString(name))}])
        if (switch f {
          case FStatic(cl, cf)
            if (cl.get().module == "genes.Register" && cl.get().name == "Register"
              && cf.get().name == "global"):
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

  override function emitSwitch(cond: TypedExpr,
      cases: Array<{values: Array<TypedExpr>, expr: TypedExpr}>,
      def: Null<TypedExpr>, leaf: TypedExpr->Void) {
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
      increaseIndent();
      leaf(c.expr);
      writeNewline();
      write('break');
      decreaseIndent();
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
          write('default:');
          increaseIndent();
          writeNewline();
          write('throw ');
          emitString('unreachable');
          write(';');
          decreaseIndent();
          writeNewline();
        }
      case e:
        emitPos(e.pos);
        write('default:');
        leaf(e);
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
      case FInstance(_, _, cf) | FStatic(_, cf) | FAnon(cf): cf.get().name;
      case FDynamic(name): name;
      default: null;
    }
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
    return switch e.expr {
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
      default:
        emitValue(e);
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
          final argName = f.args[i].v.name;
          if (genes.util.TypeUtil.isRest(arg.t))
            write('...');
          emitLocalIdent(argName);
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
    final cachedSig = (currentClass != null) ? SignatureCache.getSig(currentClass, field.isStatic, field.name) : null;
    switch effectiveType {
      case TFun(args, _):
        final cachedArgs = (cachedSig != null && cachedSig.args.length == args.length) ? cachedSig.args : null;
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
          final argName = f.args[i].v.name;
          final argType = (i >= 0 && i < f.args.length) ? f.args[i].v.t : arg.t;
          final opt = cachedArgs != null ? cachedArgs[i].opt : arg.opt;
          if (genes.util.TypeUtil.isRest(arg.t))
            write('...');
          emitLocalIdent(argName);
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
          final argName = f.args[i].v.name;
          if (genes.util.TypeUtil.isRest(arg.t))
            write('...');
          emitLocalIdent(argName);
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

  function emitArgTsType(field: GenesField, f: TFunc, index: Int,
      type: Type, fallbackType: Null<String>) {
    // TS `strict` enables `useUnknownInCatchVariables`, so catch variables are
    // `unknown`. Avoid emitting `Register.unsafeCast<any>(...)` in user modules
    // by making `haxe.Exception.caught` accept `unknown` in TS.
    if (currentClass != null && currentClass.module == 'haxe.Exception'
      && currentClass.name == 'Exception' && field.name == 'caught' && index == 0) {
      write('unknown');
      return;
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
    final cachedSig = (currentClass != null) ? SignatureCache.getSig(currentClass, field.isStatic, field.name) : null;
    if (cachedSig != null && cachedSig.retTsType != null) {
      write(cachedSig.retTsType);
      return;
    }
    emitType(f.t);
  }

  function emitFieldTsType(field: GenesField) {
    if (field.tsType != null) {
      write(field.tsType);
      return;
    }
    emitType(field.type, field.isStatic ? null : field.params);
  }

  function emitTsInterface(cl: ClassType, fields: Array<GenesField>) {
    var clForFields = cl;
    try {
      final declaredPath = cl.pack.concat([cl.name]).join('.');
      final fullName = (declaredPath == cl.module) ? declaredPath : (cl.module + '.' + cl.name);
      switch haxe.macro.Context.getType(fullName) {
        case TInst(ref, _):
          clForFields = ref.get();
        default:
      }
    } catch (_: Dynamic) {}

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
          emitMemberName(field.name);
          write(': ');
          final typeOverride = extractStringMeta(field.meta, ':ts.type')
            ?? extractStringMeta(field.meta, ':genes.type');
          if (typeOverride != null)
            write(typeOverride);
          else
            emitType(field.type);
          write(';');
        case FMethod(_):
          writeNewline();
          emitPos(field.pos);
          emitMemberName(field.name);
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
    if (def.module == 'js.html.HeadersIterator' && def.name == 'HeadersIterator') {
      writeNewline();
      emitComment(def.doc);
      emitPos(def.pos);
      write('export type ');
      TypeEmitter.emitBaseType(this, def, params, true);
      write(' = IterableIterator<[string, string]>');
      writeNewline();
      return;
    }
    if (def.module == 'js.html.URLSearchParamsIterator' && def.name == 'URLSearchParamsIterator') {
      writeNewline();
      emitComment(def.doc);
      emitPos(def.pos);
      write('export type ');
      TypeEmitter.emitBaseType(this, def, params, true);
      write(' = IterableIterator<[string, string]>');
      writeNewline();
      return;
    }
    if (def.module == 'js.html.FormDataIterator' && def.name == 'FormDataIterator') {
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
