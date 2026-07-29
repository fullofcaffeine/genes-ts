package genes;

import genes.BindingIdentity.BindingIdentity;
import genes.BindingIdentity.HaxeDeclarationKey;
import genes.BindingIdentity.LocalBindingIntent;
import genes.BindingIdentity.StaticFieldOriginKey;
import genes.util.TypeUtil;
import haxe.macro.Expr.Position;
import haxe.macro.Type;

/**
 * A typed request for the identifier used by an expression or type annotation.
 *
 * Why: the previous request contained only a module path and simple name. When
 * default and named exports shared those strings, lookup returned whichever
 * import happened to appear first. The emitter had already lost which Haxe
 * declaration the typed AST meant.
 *
 * What: imported declarations and static fields retain exact compiler-owned
 * origins. Direct values are tagged separately, so a missing imported mapping
 * cannot silently fall back to a same-looking local. Exact JavaScript host
 * globals are tagged separately from arbitrary `@:native` declarations, so
 * TypeScript can qualify them without changing classic JavaScript spelling.
 * Core Haxe abstract values retain their established generated spelling.
 *
 * How: `Dependencies.typeAccessor` follows an origin mapping to the allocated
 * local and then appends any normalized member path. `@:native` alone remains
 * a direct host/global value or an internal emitted-name override. When
 * `@:jsRequire` is also present, the package import is the value source, so old
 * native text cannot bypass its allocated local. `dependencyPath` and
 * `external` distinguish an expected import from an ordinary same-module value.
 * Source position is diagnostic provenance only and never affects identity.
 */
enum TypeAccessorImpl {
  ImportedDeclaration(key: HaxeDeclarationKey, fallbackName: String,
    dependencyPath: Null<String>, external: Bool, pos: Position);
  ImportedAlias(intent: LocalBindingIntent, fallbackName: String,
    memberPath: Array<String>, dependencyPath: String, external: Bool,
    pos: Position);
  ImportedStaticField(key: StaticFieldOriginKey, fallbackName: String,
    pos: Position);
  HostGlobal(name: String);
  DirectValue(path: String);
  CoreAbstract(name: String);
}

abstract TypeAccessor(TypeAccessorImpl) from TypeAccessorImpl {
  @:from public static function fromModuleType(type: ModuleType): TypeAccessor {
    return switch type {
      case TAbstract(_.get() => cl = {meta: meta, name: name}):
        switch meta.has(':coreType') {
          // Core abstract values use Haxe's generated value namespace rather
          // than an ESM import and therefore have no declaration mapping.
          case true: CoreAbstract('"$$hxCoreType__$name"');
          case false: declaration(HaxeDeclarationKey.fromModuleType(type), cl);
        }
      case TClassDecl((_.get() : BaseType) => base) |
        TEnumDecl((_.get() : BaseType) => base) |
        TTypeDecl((_.get() : BaseType) => base):
        declaration(HaxeDeclarationKey.fromModuleType(type), base);
    }
  }

  @:from public static function fromType(type: Type): TypeAccessor {
    return fromModuleType(TypeUtil.typeToModuleType(type));
  }

  @:from public static function fromBaseType(type: BaseType): TypeAccessor {
    return declaration(HaxeDeclarationKey.tryFromBaseType(type), type);
  }

  /** Creates the exact origin request for a field-level `@:jsRequire`. */
  public static function forStaticField(owner: ClassType,
      field: ClassField): TypeAccessor {
    return forStaticFieldName(owner, field.name, field.pos);
  }

  /** Same field origin factory for Module's normalized field record. */
  public static function forStaticFieldName(owner: ClassType,
      fieldName: String, pos: Position): TypeAccessor {
    return ImportedStaticField(new StaticFieldOriginKey(owner.module,
      owner.name, fieldName), fieldName, pos);
  }

  /**
   * Renders one accessor for a TypeScript source or declaration surface.
   *
   * Why: a generated module may also declare a Haxe class named `Promise` or
   * `Error`. An unqualified exact `js.lib` host reference would then bind to
   * that local declaration instead of JavaScript's global constructor.
   *
   * What/How: only compiler-identified host globals receive `globalThis`.
   * Imported and ordinary local declarations still use the projection's
   * collision-safe allocator. Classic JavaScript calls that allocator directly
   * and keeps its established unqualified host spelling.
   */
  public static function forTypeScript(type: TypeAccessor,
      fallback: TypeAccessor->String): String {
    return switch type {
      case HostGlobal(name): 'globalThis.$name';
      default: fallback(type);
    }
  }

  /**
   * Recognizes compiler-owned declarations whose runtime value is a built-in
   * JavaScript constructor.
   *
   * `NativeException` and `V8Error` are private Haxe standard-library externs,
   * both declared with `@:native("Error")`. Haxe presents their rewritten
   * simple name as `Error` while retaining the defining module. They are listed
   * by that exact typed identity because treating every user-authored
   * `@:native("Error")` extern as the host global would erase information the
   * compiler does not own.
   */
  public static function hostGlobalName(type: BaseType): Null<String> {
    return switch [type.module, type.name] {
      case ['js.lib.Promise', 'Promise']: 'Promise';
      case ['js.lib.Error', 'Error']: 'Error';
      case ['haxe.Exception', 'Error']: 'Error';
      case ['haxe.NativeStackTrace', 'Error']: 'Error';
      default: null;
    }
  }

  static function declaration(key: Null<HaxeDeclarationKey>,
      type: BaseType): TypeAccessor {
    final hostGlobal = hostGlobalName(type);
    if (hostGlobal != null)
      return HostGlobal(hostGlobal);
    final directNative = switch type.meta.extract(':native') {
      case [{params: [{expr: EConst(CString(name))}]}]: name;
      default: null;
    }
    final dependency = Dependencies.makeDependency(type);
    if (dependency == null)
      return directNative == null
        ? DirectValue(TypeUtil.baseTypeName(type))
        : DirectValue(directNative);

    // Internal Haxe declarations can use `@:native` purely to choose their
    // emitted name, for example a typedef renamed in a classic `.d.ts`. They
    // have no package value to resolve. Only an external package dependency
    // makes canonical import identity authoritative over the native spelling.
    if (directNative != null && !dependency.external)
      return DirectValue(directNative);

    // A package-backed declaration must use the package import. For older
    // `@:native("Root.Member")` bindings, `makeDependency` has already kept the
    // compatible member suffix in the canonical mapping. Carrying the raw
    // native text here would let it skip collision-safe import allocation.
    return key == null
      ? ImportedAlias(BindingIdentity.localIntentFor(dependency),
        TypeUtil.baseTypeName(type), dependency.memberPath.copy(),
        dependency.path, dependency.external, type.pos)
      : ImportedDeclaration(key, TypeUtil.baseTypeName(type), dependency.path,
        dependency.external, type.pos);
  }
}
