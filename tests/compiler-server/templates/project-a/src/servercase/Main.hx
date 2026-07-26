package servercase;

import genes.ts.Imports;

/**
 * Project A's reusable public facade.
 *
 * The warm-server test switches this module between application and library
 * DCE, then loads a second project with the same Haxe identity. The generated
 * surface must always match an isolated compilation of the current request.
 *
 * `@:genes.library` makes this otherwise-unreferenced facade a reusable-output
 * root only when the build enables `-D genes.library`. Ordinary application
 * DCE must still remove it.
 */
@:genes.library
class LibraryApi {
  public function new() {}

  public function label(value: SharedValue): String {
    return value.label;
  }
}

/**
 * Generic package function whose explicit TS type argument is typed by Haxe.
 *
 * `@:jsRequire` turns the extern method's value dependency into the named ESM
 * import `identity`; `@:ts.explicitTypeArguments` preserves Haxe's current
 * generic witness in TypeScript while classic JavaScript erases the type
 * argument. Together they expose stale import and typed-witness state.
 */
private extern class RuntimePackage {
  /**
   * `@:ts.explicitTypeArguments` preserves the current request's exact witness
   * in TypeScript and erases in classic JavaScript.
   */
  @:ts.explicitTypeArguments
  @:jsRequire("./runtime/package.js", "identity")
  static function identity<T>(value: T): T;
}

#if server_import_matrix
/** `@:jsRequire(path)` emits the package's namespace/default-compatible value. */
@:jsRequire("./runtime/package.js")
private extern class DefaultMarker {
  static final value: String;
}

/** The second `@:jsRequire` argument emits the exact named ESM binding. */
@:jsRequire("./runtime/package.js", "NamedMarker")
private extern class NamedMarker {
  static final value: String;
}

/**
 * Imports the JSON default value with `with { type: "json" }`.
 *
 * The attribute metadata is part of loader-request identity, so a warm request
 * must neither lose it nor reuse a differently attributed binding.
 */
@:jsRequire("./runtime/config.json", "default")
@:genes.importAttributeType("json")
private extern class ConfigMarker {
  static final project: String;
}
#end

/**
 * Project A's executable root and pre-DCE metadata owner.
 *
 * The directive and module-function names are edited in place by the harness.
 * That exposes stale callback, metadata, and name-plan state without adding a
 * product-specific compiler branch.
 *
 * `@:genes.moduleDirective` emits the literal before imports.
 * `@:genes.moduleFunction` emits `transform` as a module-scoped function and
 * reconnects the static Haxe method to it. Their authored positions continue
 * to own the generated source-map tokens.
 */
@:genes.moduleDirective("server-project-a-v1")
class Main {
  static inline final REVISION = "a1";

  static function __init__(): Void {
    #if server_import_matrix
    // This typed macro carrier becomes a bare ESM request and emits no runtime
    // marker value of its own.
    Imports.sideEffect("./runtime/side-effect.js");
    #end
  }

  @:genes.moduleFunction("serverTransformA")
  public static function transform<T>(value: T): T {
    return value;
  }

  public static function main(): Void {
    final current = RuntimePackage.identity(REVISION);
    var transcript = "project-a:" + current + ":" + Extra.value();
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
