package genes;

import genes.util.TypeUtil;
import genes.util.GlobalTypes;
import haxe.macro.Type;
import genes.Module;
import genes.TypeAccessor;
import genes.SourceMapGenerator;
import haxe.macro.Context;

enum DependencyType {
  DName;
  DDefault;
  DAsterisk;
}

typedef Dependency = {
  type: DependencyType,
  name: String,
  external: Bool,
  path: String,
  ?alias: String,
  ?importAttributeType: String,
  ?pos: SourcePosition
}

private typedef ModuleName = String;

class Dependencies {
  public final imports: Map<ModuleName, Array<Dependency>> = [];

  final module: Module;
  final runtime: Bool;
  final names: Array<{name: String, module: String}>;
  final aliases = new Map<String, String>();
  final aliasCount = new Map<String, Int>();

  public function new(module: Module, runtime = true) {
    this.module = module;
    this.runtime = runtime;
    this.names = [];
    for (member in module.members)
      switch member {
        case MClass(type, _, _):
          names.push({name: TypeUtil.className(type), module: type.module});
        case MEnum(et, _):
          // Treat enum constructor names as reserved identifiers in the module.
          //
          // This matters for TS output where enums are emitted via declaration
          // merging (`export declare namespace EnumName { export type Ctor = ... }`).
          // Without reserving ctor names, imported types that share a ctor name
          // (e.g. enum ctor `Assertion` and class `Assertion`) can become ambiguous
          // or recursively refer to themselves in generated TS types.
          names.push({name: et.name, module: et.module});
          for (ctorName in et.names)
            names.push({name: ctorName, module: et.module});
        case MType({name: name, module: module}, _):
          names.push({name: name, module: module});
        default:
      }
  }

  public function push(module: String, dependency: Dependency) {
    final key = module + '.' + dependency.name;
    inline function alias(key: String, name: String) {
      return aliases[key] = name
        + '__'
        + (aliasCount[name] = switch aliasCount[name] {
          case null: 1;
          case v: v + 1;
        });
    }
    switch aliases[key] {
      case null:
        if (GlobalTypes.exists(dependency.name)) {
          dependency.alias = alias(key, dependency.name);
        } else
          for (named in names) {
            if (named.module != module && named.name == dependency.name) {
              dependency.alias = alias(key, named.name);
              break;
            }
          }
      case v:
        dependency.alias = v;
    }
    if (imports.exists(module)) {
      final deps = imports.get(module);
      for (i in deps)
        if (i.name == dependency.name && i.alias == dependency.alias
          && i.importAttributeType == dependency.importAttributeType)
          return;
      deps.push(dependency);
      names.push({name: dependency.name, module: module});
    } else {
      imports.set(module, [dependency]);
      names.push({name: dependency.name, module: module});
    }
  }

  public static function makeDependency(base: BaseType): Dependency {
    final name = TypeUtil.baseTypeName(base);
    final explicitAlias = switch base.meta.extract(':genes.importAlias') {
      case [{params: [{expr: EConst(CString(alias))}]}]: alias;
      default: null;
    }
    final importAttributeType = extractImportAttributeType(base.meta);
    if (base.isExtern) {
      switch base.meta.extract(':jsRequire') {
        case [{params: [{expr: EConst(CString(path))}]}]:
          final cl: ClassType = cast base;
          final isWildcard = switch [cl.kind, cl.fields.get(), cl.statics.get()] {
            case [KAbstractImpl(_.get() => {meta: meta}), _, _]
              if (meta.has(':enum')):
              true;
            case [_, fields, statics]:
              cl.kind.equals(KNormal)
              && !cl.isInterface
              && cl.superClass == null
              && cl.constructor == null
              && fields.length == 0
              && statics.filter(st -> st.meta.has(':selfCall')).length == 0;
          }

          return {
            type: if (isWildcard) DAsterisk else DDefault,
            name: name,
            path: path,
            external: true,
            alias: explicitAlias,
            importAttributeType: importAttributeType,
            pos: base.pos
          }
        case [{params: [{expr: EConst(CString(path))}, {expr: EConst(CString('default'))}]}]:
          return {
            type: DDefault,
            name: name,
            path: path,
            external: true,
            alias: explicitAlias,
            importAttributeType: importAttributeType,
            pos: base.pos
          }
        case [{params: [{expr: EConst(CString(path))}, {expr: EConst(CString(name))}]}]:
          final native = switch base.meta.extract(':native') {
            case [{params: [{expr: EConst(CString(native))}]}]:
              native;
            default: null;
          }
          // If we have a native name with a dot path we need a default import
          if (native != null && native.indexOf('.') > -1) {
            return {
              type: DDefault,
              name: native.split('.')[0],
              path: path,
              external: true,
              alias: explicitAlias,
              importAttributeType: importAttributeType,
              pos: base.pos
            }
          }
          // benmerckx/genes#7
          if (name.indexOf('.') > -1) {
            return {
              type: DName,
              name: name.split('.')[0],
              path: path,
              external: true,
              alias: explicitAlias,
              importAttributeType: importAttributeType,
              pos: base.pos
            }
          }
          return {
            type: DName,
            name: name,
            path: path,
            external: true,
            alias: explicitAlias,
            importAttributeType: importAttributeType,
            pos: base.pos
          }
        default:
          // Secondary externs often live beside a runtime owner in one Haxe
          // module without repeating its `@:jsRequire`, for example
          // `js.node.stream.Readable.IReadable`. They still denote the owner's
          // package export in generated TypeScript. Reuse that owner import and
          // alias it to the secondary Haxe name so signatures remain resolvable
          // without inventing a runtime dependency or downstream workaround.
          final declaredPath = base.pack.concat([base.name]).join('.');
          if (declaredPath != base.module) {
            final moduleName = base.module.split('.').pop();
            for (moduleType in Context.getModule(base.module)) {
              switch moduleType {
                case TInst((_.get() : BaseType) => owner, _)
                  if (owner.name == moduleName
                    && owner.meta.has(':jsRequire')):
                  final dependency = makeDependency(owner);
                  if (dependency != null) {
                    dependency.alias = explicitAlias != null ? explicitAlias : name;
                    return dependency;
                  }
                default:
              }
            }
          }
          return null;
      }
    }
    return {
      type: DName,
      name: name,
      external: false,
      path: base.module,
      alias: explicitAlias,
      importAttributeType: importAttributeType,
      pos: base.pos
    }
  }

  /**
   * Reads the internal import-attribute metadata used by genes-ts import emitters.
   *
   * Why: TypeScript import attributes, such as `with { type: "json" }`, are a
   * dependency-level property rather than an expression-level property. Carrying
   * them through `Dependency` keeps both macro-generated externs and hand-written
   * `@:jsRequire` bindings on the same deterministic import path.
   *
   * What: `@:genes.importAttributeType("json")` lowers to an optional string on
   * `Dependency`. The TypeScript emitter prints it only for value imports.
   *
   * How: callers attach the metadata beside `@:jsRequire`; this helper extracts
   * the literal value and rejects non-literal shapes by ignoring them, matching
   * existing metadata extraction conventions in this module.
   */
  public static function extractImportAttributeType(meta: MetaAccess): Null<String> {
    return switch meta.extract(':genes.importAttributeType') {
      case [{params: [{expr: EConst(CString(value))}]}]: value;
      default: null;
    }
  }

  public function add(type: ModuleType) {
    switch type {
      case TClassDecl((_.get() : BaseType) => base) |
        TEnumDecl((_.get() : BaseType) => base) |
        TTypeDecl((_.get() : BaseType) => base):
        final dependency = makeDependency(base);
        if (dependency == null)
          return;
        if (dependency.path != module.module)
          return push(dependency.path, dependency);
        switch type {
          case TTypeDecl(_.get() => t)
            if (module.getMember(TypeUtil.baseTypeName(base)) == null):
            // import X in Y;
            final x = TypeUtil.typeToBaseType(t.type);
            if (x == null)
              return;
            final y = makeDependency(x);
            y.alias = dependency.name;
            push(y.path, y);
          default:
        }
      default:
    }
  }

  public function typeAccessor(type: TypeAccessor)
    return switch type {
      case Abstract(name): name;
      case Concrete(module, name, native):
        if (native != null)
          return native;
        final deps = imports.get(module);
        if (deps != null)
          for (i in deps)
            if (i.name == name || i.alias == name)
              return if (i.alias != null) i.alias else i.name;
        return name;
    }
}
