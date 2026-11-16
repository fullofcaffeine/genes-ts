package inc;

/**
 * A module that is never clean (it asks for a feature that emission can
 * add, rule 10 of `GenerationCache`) and that Haxe does not type again. The
 * walk adds `CyHubExtra` to it when another module names that class in a
 * type position; `CyHubExtra` extends `CyChild`, which closes an import cycle
 * `CyChild -> CyBase -> CyHub -> CyChild`.
 */
class CyHub {
  public static function tag(): String {
    return "hub" + (untyped __feature__("use.$iterator", "+", "-"));
  }
}

/** Removed by dead-code elimination until a type position names it. */
class CyHubExtra extends CyChild {
  public function new() {
    super();
  }
}
