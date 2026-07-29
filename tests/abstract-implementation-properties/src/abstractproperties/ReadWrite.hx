package abstractproperties;

@:keep
abstract ReadWrite<T>(Array<T>) {
  public var current(get, set): T;

  public inline function new(value: T) {
    this = [value];
  }

  function get_current(): T {
    return this[0];
  }

  function set_current(value: T): T {
    return this[0] = value;
  }
}
