package library_profile;

/**
 * Models a generic Haxe abstract whose runtime helpers are emitted as statics.
 *
 * Why: Haxe lowers `first()` into a static implementation method whose first
 * argument is the abstract receiver. Its owner type parameter belongs on that
 * helper method, not on the non-generic emitted implementation class. By
 * contrast, `version()` is a true static and must not acquire a meaningless
 * owner generic.
 *
 * What/How: `LibraryApi.first` calls both forms from an otherwise DCE-dead
 * public method. The library profile retains those calls, and the strict
 * declaration gate verifies `first<T>(...)` alongside non-generic `version()`.
 */
abstract GenericView<T>(Array<T>) {
  public inline function new(values:Array<T>) {
    this = values;
  }

  public function first():Null<T> {
    return this.length == 0 ? null : this[0];
  }

  public static function version():String {
    return "v1";
  }
}
