package tests.publicsurface;

/**
 * Generic parent contract used to prove that public-surface inheritance keeps
 * the applied type argument rather than widening or flattening the member.
 *
 * `@:keep` makes the declaration fixture deterministic under `-dce full`; the
 * PublicSurface tests are about API planning, not whether this test runner
 * happens to make a runtime call through every type.
 */
@:keep
interface SurfaceParent<T> {
  public function inherited(value: T): T;
}

/**
 * Child contract whose parent applies `Array<T>`. Both TS implementation
 * interfaces and classic declarations must preserve that substitution.
 * `@:keep` keeps the type available to both output profiles under full DCE.
 */
@:keep
interface SurfaceChild<T> extends SurfaceParent<Array<T>> {
  public function own(value: T): T;
}

/**
 * Callable boundary used to prove that Haxe overload identity survives public
 * surface planning.
 *
 * Why: `overload` represents several consumer-visible call signatures on one
 * Haxe field. The implementation emitter must not confuse those declaration
 * signatures with multiple runtime methods.
 *
 * What/How: `@:overload` adds an `Int -> Int` signature to the canonical
 * `String -> String` method. Both signatures share one runtime implementation.
 * `@:keep` ensures the focused declaration exists independently of incidental
 * reachability from the test harness.
 */
@:keep
class OverloadedSurface {
  public function new() {}

  @:overload(function(value: Int): Int {})
  public function convert(value: String): String {
    return value;
  }
}

/**
 * Concrete implementation used to separate the public Haxe API from private
 * runtime helpers retained by normal code generation.
 *
 * `@:keep` deliberately retains both sides under `-dce full`: declaration
 * emission must include the public fields and exclude the private runtime
 * state/helpers from the same retained class.
 */
@:keep
class SurfaceImplementation implements SurfaceChild<String> {
  final suffix = "!";

  public var label(get, never): String;

  public function new() {}

  public function inherited(value: Array<String>): Array<String> {
    return value;
  }

  public function own(value: String): String {
    return value;
  }

  public function declaredButUnused(value: String): String {
    return value;
  }

  public static function declaredStaticButUnused(value: Int): Int {
    return value;
  }

  function get_label(): String {
    return runtimeOnly("surface");
  }

  function runtimeOnly(value: String): String {
    return value + suffix;
  }
}
