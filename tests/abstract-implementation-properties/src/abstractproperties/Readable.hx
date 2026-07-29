package abstractproperties;

@:keep
abstract Readable<T>(Array<T>) {
  public var readable(get, never): T;

  public inline function new(value: T) {
    this = [value];
  }

  function get_readable(): T {
    return this[0];
  }
}
