package inc;

/** Dead-code elimination removes `set_level` when no module writes `level`. */
class Prop {
  public var level(get, set): Int;

  var stored = 1;

  public function new() {}

  function get_level(): Int {
    return stored;
  }

  function set_level(value: Int): Int {
    return stored = value;
  }
}
