package abstractproperties;

@:keep
abstract StaticControl<T>(Array<T>) {
  public static var label(get, never): String;

  public inline function new(value: T) {
    this = [value];
  }

  static function get_label(): String {
    return "static-control";
  }

  public function value(): T {
    return this[0];
  }
}
