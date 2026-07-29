package abstractproperties;

@:keep
abstract Plain(Array<Int>) {
  public var plain(get, never): Int;

  public inline function new(value: Int) {
    this = [value];
  }

  function get_plain(): Int {
    return this[0];
  }
}
