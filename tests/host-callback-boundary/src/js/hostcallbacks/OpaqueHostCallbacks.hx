package js.hostcallbacks;

/**
 * An opaque native callback used to prove that nullable receivers fail closed
 * instead of producing an illegal TypeScript type query.
 */
@:native("OpaqueHostCallbacks")
extern class OpaqueHostCallbacks {
  public var onready: haxe.Constraints.Function;
}
