package servercase;

import genes.ts.Imports;

/**
 * Project B deliberately reuses Project A's complete Haxe declaration names.
 *
 * Its public value and generated markers differ so a stale name-only or
 * source-position cache cannot accidentally produce the expected tree.
 * `@:genes.library` retains this unreferenced public facade only for the
 * explicit library profile, making its `Int` surface independently consumable.
 */
@:genes.library
class LibraryApi {
  public function new() {}

  public function count(value: SharedValue): Int {
    return value.count;
  }
}

/**
 * Named ESM import whose explicit TypeScript witness must be rebuilt as `Int`.
 *
 * The paired metadata has the same lowering contract documented on Project A;
 * the different witness is what makes cross-project reuse observable.
 */
private extern class RuntimePackage {
  /** The emitted call is `identity<number>(...)`, never Project A's `string`. */
  @:ts.explicitTypeArguments
  @:jsRequire("./runtime/package.js", "identity")
  static function identity<T>(value: T): T;
}

#if server_import_matrix
@:jsRequire("./runtime/package.js")
private extern class DefaultMarker {
  static final value: String;
}

@:jsRequire("./runtime/package.js", "NamedMarker")
private extern class NamedMarker {
  static final value: String;
}

@:jsRequire("./runtime/config.json", "default")
@:genes.importAttributeType("json")
private extern class ConfigMarker {
  static final project: String;
}
#end

/**
 * Owns Project B's distinct prologue and module-function spellings.
 *
 * The metadata emits the directive before imports and lowers `transform` to
 * the named module function while preserving the static Haxe entrypoint.
 */
@:genes.moduleDirective("server-project-b-v1")
class Main {
  static inline final REVISION = 21;

  static function __init__(): Void {
    #if server_import_matrix
    // The helper lowers to a bare request; no carrier call may reach output.
    Imports.sideEffect("./runtime/side-effect.js");
    #end
  }

  @:genes.moduleFunction("serverTransformB")
  public static function transform<T>(value: T): T {
    return value;
  }

  public static function main(): Void {
    final current = RuntimePackage.identity(REVISION);
    var transcript = "project-b:" + current + ":" + Extra.value();
    #if server_removed
    transcript += ":" + Removed.value();
    #end
    #if server_import_matrix
    transcript += ":" + DefaultMarker.value + ":" + NamedMarker.value
      + ":" + ConfigMarker.project;
    #end
    trace(transform(transcript));
  }
}
