package lexicalbinding;

/** An imported interface whose value is read by generated reflection code. */
@:genesLexicalBindingMissingModuleProbe
@:jsRequire("lexical-structural-fixture", "RuntimeInterface")
extern interface RuntimeInterface {}

/** An accessor requires TypeScript to publish a runtime property descriptor. */
class AccessorClass implements RuntimeInterface {
  public var value(get, set): Int;

  public function new() {}

  function get_value(): Int {
    return 1;
  }

  function set_value(next: Int): Int {
    return next;
  }
}

/** Haxe stores this imported module function on a synthetic owner class. */
@:jsRequire("lexical-structural-fixture", "fieldValue")
extern function fieldValue(): String;

function retainStructuralClassCases(): Void {
  final value = new AccessorClass();
  value.value = 2;
  trace(fieldValue());
}
