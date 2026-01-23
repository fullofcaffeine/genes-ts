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
      write(' extends (');
      write(ctx.typeAccessor(TypeUtil.registerType));
      write('.inherits(');
      var superAccessor: Null<String> = null;
      var superTypeParamCount = 0;
      switch cl.superClass {
        case null:
        case {t: ref}:
          final t: ModuleType = TClassDecl(ref);
          superTypeParamCount = ref.get().params.length;
          final isCyclic = checkCycles(TypeUtil.moduleTypeModule(t));
          if (isCyclic)
            write('() => ');
          superAccessor = ctx.typeAccessor(t);
          write(superAccessor);
          if (isCyclic)
            write(', true');
      }
      write(')');
      if (superAccessor != null) {
        final castSuperToAny = superAccessor.indexOf('.') != -1;
        write(' as new (...args: any[]) => ');
        if (castSuperToAny) {
          write('any');
        } else {
          write(superAccessor);
          if (superTypeParamCount > 0) {
            write('<');
            for (_ in joinIt(0...superTypeParamCount, write.bind(', ')))
              write('any');
            write('>');
          }
        }
      } else
        write(' as any');
      write(')');
    }

    extendsExtern = switch cl.superClass {
      case null: None;
      case {t: t = _.get() => {isExtern: true}}:
        Some(cl.superClass.t.get());
      default: None;
    }

    write(' {');
    increaseIndent();

    // Explicit ctor signatures (TS) matching Haxe `new`.
    // Runtime behavior is unchanged: the implementation forwards to `super(...args)`.
    if (extendsInherits) {
      final ctorField = fields.find(f -> f.kind.equals(Constructor));
      writeNewline();
      if (ctorField != null)
        emitPos(ctorField.pos);
      write('constructor(');
      if (ctorField != null)
        switch ctorField.expr {
          case {expr: TFunction(f)}:
            emitTypedFunctionArguments(f, ctorField);
          default:
        }
      write(');');

      writeNewline();
      write('constructor(...args: any[]) {');
      increaseIndent();
      writeNewline();
      write('super(...args);');
      decreaseIndent();
      writeNewline();
      write('}');
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
          emitFieldTsType(field);
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
              if (field.kind.equals(Constructor))
                emitCtorImplementationArguments(f, field);
              else
                emitTypedFunctionArguments(f, field);
              write(')');

              // Return type
              if (field.kind.equals(Constructor)) {
                write(': void ');
              } else {
                write(': ');
                emitReturnTsType(field, f);
                write(' ');
              }

              final body = getFunctionBody(f);
              final returnOverride = field.meta != null ? (switch extractStringMeta(field.meta,
                ':ts.returnType') {
                case null: extractStringMeta(field.meta, ':genes.returnType');
                case v: v;
              }) : null;
              switch [returnOverride, body.expr] {
                case [v, TBlock([])] if (v != null && v != 'any' && v != 'void' && v != 'undefined'):
                  // TS requires a return for non-void declared return types.
                  // Preserve JS runtime behavior by returning `undefined`.
                  write('{');
                  increaseIndent();
                  writeNewline();
                  write('return undefined as any;');
                  decreaseIndent();
                  writeNewline();
                  write('}');
                default:
                  emitExpr(body);
              }
            default:
          }
        default:
      }
    }

    // Keep Genes runtime identity helpers.
    writeNewline();
    write('static get __name__(): any {');
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
        write('static get __interfaces__(): any {');
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
        write('static get __super__(): any {');
        increaseIndent();
        writeNewline();
        write('return ');
        write(ctx.typeAccessor(t));
        decreaseIndent();
        writeNewline();
        write('}');
    }

    writeNewline();
    write('get __class__(): any {');
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
      write('(');
      writeGlobalVar("$hxClasses");
      write(' as any)[');
      emitString(id);
      write('] = ');
      emitIdent(TypeUtil.className(cl));
      write(';');
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
          write('get: function (this: any) { return this.get_');
          write(field.name);
          write('(); },');
        }
        if (field.setter) {
          writeNewline();
          write('set: function (this: any, v: ');
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
        emitIdent(className);
        write('.prototype');
        emitField(field.name);
        write(' = null as any;');
        writeNewline();
      }
    }
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
          // Default Haxe generics to `any` for ergonomics and to avoid `unknown`
          // inference in downstream generic code under `strict`.
          write(' = any');
        default:
          // Fallback: best-effort rendering.
          TypeEmitter.emitType(this, param);
      }
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
        write(' = undefined as any');
      case {expr: TConst(TNull)}:
        write(' = null as any');
      case e:
        write(' = ');
        emitValue(e);
    }
  }

  override public function emitExpr(e: TypedExpr) {
    emitPos(e.pos);
    switch e.expr {
      case TBinop(op = OpAssign, lhs = {expr: TField(_, f)}, rhs)
        if (isOverriddenField(f)):
        emitValue(lhs);
        writeSpace();
        writeBinop(op);
        writeSpace();
        write('(');
        emitValue(rhs);
        write(' as any)');
      case TCall(fn = {expr: TCall({expr: TField(_, f)}, _)}, args)
        if (switch fieldAccessName(f) { case "shift" | "pop": true; default: false; }):
        // Array#shift/#pop returns `T | undefined` in TS. When the Haxe code
        // guarantees non-emptiness (e.g. checked `.length > 0`), allow calling
        // the returned function under `strict`.
        write('(');
        emitValue(fn);
        write(' as any)(');
        for (arg in join(args, write.bind(', ')))
          emitValue(arg);
        write(')');
      case TFunction(f):
        final inValue = this.inValue;
        final inLoop = this.inLoop;
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
          if (i < args.length && args[i].opt && i > noOptionalUntil)
            write('?');
          write(': ');
          TypeEmitter.emitType(this, t);
        }
        // Omit explicit return annotations so TS can infer and preserve generic
        // inference. Writing `: any` here causes widespread `unknown` inference
        // under `strict` in downstream code (e.g. tink.*).
        write(') ');
        emitExpr(getFunctionBody(f));
        this.inValue = inValue;
        this.inLoop = inLoop;
      case TBinop(op = OpEq | OpNotEq, e1, e2) if (isNullConst(e1) || isNullConst(e2)):
        emitValueWithPlainNull(e1);
        writeSpace();
        writeBinop(op);
        writeSpace();
        emitValueWithPlainNull(e2);
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
        write('null as any');
      default:
        super.emitConstant(c);
    }

  function emitTypedFunctionArguments(f: TFunc, field: GenesField) {
    switch field.type {
      case TFun(args, _):
        // Handle Haxe optional argument skipping semantics (same as TypeEmitter.emitArgs).
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

        for (i in genes.util.IteratorUtil.joinIt(0...args.length,
          write.bind(', '))) {
          final arg = args[i];
          final argName = f.args[i].v.name;
          if (genes.util.TypeUtil.isRest(arg.t))
            write('...');
          emitLocalIdent(argName);
          if (arg.opt && i > noOptionalUntil)
            write('?');
          write(': ');
          emitArgTsType(field, f, i, arg.t);
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
      type: Type) {
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
    emitType(type);
  }

  function emitReturnTsType(field: GenesField, f: TFunc) {
    final returnOverride = field.meta != null ? (switch extractStringMeta(field.meta,
      ':ts.returnType') {
      case null: extractStringMeta(field.meta, ':genes.returnType');
      case v: v;
    }) : null;
    if (returnOverride != null) {
      write(returnOverride);
      return;
    }
    switch field.type {
      case TFun(_, ret):
        emitType(ret);
      default:
        write('any');
    }
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
    final enumParamNames = et.params != null ? et.params.map(p -> p.name) : [];
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
    write('export const __constructs__: any[];');
    writeNewline();
    emitPos(et.pos);
    write('export const __empty_constructs__: any[];');
    if (ctx.hasFeature('js.Boot.isEnum')) {
      writeNewline();
      emitPos(et.pos);
      write('export const __ename__: string;');
    }

    for (ctorName in et.names) {
      final c = et.constructs.get(ctorName);
      writeNewline();
      emitComment(c.doc);
      emitPos(c.pos);
      write('export type ');
      write(ctorName);
      emitTypeParamDecls(enumParams, true);
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
            switch arg.t {
              case TInst(_.get() => {
                name: name,
                kind: KTypeParameter(_)
              }, []) if (enumParamNames.indexOf(name) > -1):
                write(name);
              case TInst(_.get() => {kind: KTypeParameter(_)}, []):
                write('any');
              default:
                emitType(arg.t);
            }
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
          emitTypeParamDecls(allParams, true);
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
          // enum's type params; emit `<any, ...>` to keep TS assignment-friendly.
          if (enumParams.length > 0) {
            write('<');
            for (_ in join(enumParams, write.bind(', ')))
              write('any');
            write('>');
          }
      }
      write(';');
    }
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
      writeGlobalVar("$hxEnums");
      write('[');
      emitString(id);
      write('] = ');
      write(et.name);
      write(' as any');
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
          write('Object.assign((');
          for (param in join(args, write.bind(', '))) {
            emitLocalIdent(param.name);
            if (param.opt)
              write('?');
            write(': ');
            write('any');
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
