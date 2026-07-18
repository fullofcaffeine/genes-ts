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
 * cannot silently fall back to a same-looking local. Core Haxe abstract values
 * retain their established generated spelling.
 *
 * How: `Dependencies.typeAccessor` follows an origin mapping to the allocated
 * local and then appends any normalized member path. `dependencyPath` and
 * `external` distinguish an expected import from an ordinary same-module value.
 * Source position is diagnostic provenance only and never affects identity.
 */
enum TypeAccessorImpl {
  ImportedDeclaration(key: HaxeDeclarationKey, fallbackName: String,
    directNative: Null<String>, dependencyPath: Null<String>, external: Bool,
    pos: Position);
  ImportedAlias(intent: LocalBindingIntent, fallbackName: String,
    directNative: Null<String>, memberPath: Array<String>,
    dependencyPath: String, external: Bool, pos: Position);
  ImportedStaticField(key: StaticFieldOriginKey, fallbackName: String,
    pos: Position);
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

  static function declaration(key: Null<HaxeDeclarationKey>,
      type: BaseType): TypeAccessor {
    final directNative = switch type.meta.extract(':native') {
      case [{params: [{expr: EConst(CString(name))}]}]: name;
      default: null;
    }
    final dependency = Dependencies.makeDependency(type);
    if (dependency == null)
      return directNative == null
        ? DirectValue(TypeUtil.baseTypeName(type))
        : DirectValue(directNative);

    // Imported @:native compatibility remains a reviewed direct host boundary.
    // Dotted @:jsRequire selectors are not placed here: their suffix belongs to
    // the canonical origin mapping so collision aliases remain effective.
    return key == null
      ? ImportedAlias(BindingIdentity.localIntentFor(dependency),
        TypeUtil.baseTypeName(type), directNative, dependency.memberPath.copy(),
        dependency.path, dependency.external, type.pos)
      : ImportedDeclaration(key, TypeUtil.baseTypeName(type), directNative,
        dependency.path, dependency.external, type.pos);
  }
}
