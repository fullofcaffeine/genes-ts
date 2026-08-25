package genes;

import genes.BindingIdentity.BindingIdentity;
import genes.BindingIdentity.ExportSelector;
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
  /**
   * Returns the lexical root carried by an exact direct target path.
   *
   * This inspects compiler-owned `@:native`/declaration authority before the
   * path is rendered. It is not a generated-source parser: member suffixes are
   * discarded at their structured boundary so name planning never has to
   * split an emitted accessor such as `Alias.Member`.
   */
  public static function directRoot(path: String): Null<String> {
    if (path == null || path.length == 0)
      return null;
    var end = path.length;
    for (index in 0...path.length) {
      final code = path.charCodeAt(index);
      if (code == ".".code || code == "[".code) {
        end = index;
        break;
      }
    }
    return end == 0 ? null : path.substr(0, end);
  }

  /** Stable structured identity used by runtime-occurrence assertions. */
  public static function authorityKey(type: TypeAccessor): String {
    return switch type {
      case ImportedDeclaration(key, _, _, _, _):
        'declaration:${Std.string(key.kind)}:${key.module}:${key.name}';
      case ImportedAlias(intent, _, memberPath, _, _, _):
        final request = intent.exportBinding.request;
        final attribute = request.importAttributeType == null ? 'none' : request.importAttributeType;
        final selector = switch intent.exportBinding.selector {
          case DefaultExport: 'default';
          case NamedExport(name): 'named:$name';
          case NamespaceExport: 'namespace';
        };
        'alias:${request.external}:${request.path}:$attribute:$selector:' +
        '${intent.requestedLocal}:${memberPath.join(".")}';
      case ImportedStaticField(key, _, _):
        'static-field:${key.ownerModule}:${key.ownerName}:${key.fieldName}';
      case HostGlobal(name): 'host-global:$name';
      case DirectValue(path): 'direct:$path';
      case CoreAbstract(name): 'core-abstract:$name';
    }
  }

  /** Exact structured equality for runtime-occurrence assertions. */
  public static function authorityEquals(left: TypeAccessor,
      right: TypeAccessor): Bool {
    return switch [left, right] {
      case [
        ImportedDeclaration(leftKey, _, _, _, _),
        ImportedDeclaration(rightKey, _, _, _, _)
      ]:
        leftKey.equals(rightKey);
      case [
        ImportedAlias(leftIntent, _, leftMembers, _, _, _),
        ImportedAlias(rightIntent, _, rightMembers, _, _, _)
      ]: leftIntent.equals(rightIntent) && BindingIdentity.memberPathsEqual(leftMembers,
        rightMembers);
      case [ImportedStaticField(leftKey, _,
        _), ImportedStaticField(rightKey, _, _)]:
        leftKey.equals(rightKey);
      case [HostGlobal(leftName), HostGlobal(rightName)] |
        [DirectValue(leftName), DirectValue(rightName)] |
        [CoreAbstract(leftName), CoreAbstract(rightName)]:
        leftName == rightName;
      default:
        false;
    }
  }

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

  /**
   * Keeps one static field's Haxe identity while changing its emitted fallback.
   *
   * A relocated module function is still identified by its original owner and
   * field, but a dynamic-import callback reads the validated direct ESM name
   * from the loaded namespace. No static import mapping exists in that scope,
   * so the accessor must carry that public fallback explicitly.
   */
  public static function forStaticFieldBinding(owner: ClassType,
      field: ClassField, fallbackName: String): TypeAccessor {
    return ImportedStaticField(new StaticFieldOriginKey(owner.module,
      owner.name, field.name),
      fallbackName, field.pos);
  }

  /** Same field origin factory for Module's normalized field record. */
  public static function forStaticFieldName(owner: ClassType,
      fieldName: String, pos: Position): TypeAccessor {
    return ImportedStaticField(new StaticFieldOriginKey(owner.module,
      owner.name, fieldName),
      fieldName, pos);
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
      return
        directNative == null ? DirectValue(TypeUtil.baseTypeName(type)) : DirectValue(directNative);

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
    return
      key == null ? ImportedAlias(BindingIdentity.localIntentFor(dependency),
        TypeUtil.baseTypeName(type),
      dependency.memberPath.copy(), dependency.path, dependency.external,
      type.pos) : ImportedDeclaration(key, TypeUtil.baseTypeName(type),
        dependency.path, dependency.external, type.pos);
  }
}
