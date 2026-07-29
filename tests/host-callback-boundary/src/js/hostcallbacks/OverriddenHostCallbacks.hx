package js.hostcallbacks;

/**
 * Explicit field projections remain authoritative over the generic
 * native-host callback bridge.
 */
@:native("OverriddenHostCallbacks")
extern class OverriddenHostCallbacks {
  @:ts.type("(value: number) => void")
  public var onnumber: haxe.Constraints.Function;

  @:genes.type("(value: string) => void")
  public var ontext: haxe.Constraints.Function;
}
