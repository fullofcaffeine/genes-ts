package abstractproperties;

@:keep
abstract Writable<T>(Array<T>) {
  public var writable(never, set): T;

  public inline function new(value: T) {
    this = [value];
  }

  function set_writable(value: T): T {
    return this[0] = value;
  }

  public function current(): T {
    return this[0];
  }
}
