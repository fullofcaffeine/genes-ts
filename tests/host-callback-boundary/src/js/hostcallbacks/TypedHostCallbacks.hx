package js.hostcallbacks;

/**
 * A native-host control whose callback contract is concrete in both Haxe and
 * TypeScript. Genes must not route this through the opaque callback bridge.
 */
@:native("TypedHostCallbacks")
extern class TypedHostCallbacks {
  public var onready: String->Void;

  public function new();
}
