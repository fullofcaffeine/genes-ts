package asyncawaitinvalid;

/** Proves anonymous async functions cannot infer a trustworthy Promise type. */
class MissingReturn {
  static function main():Void {
    final invalid = @:async function(value:Int) {
      return value;
    };
  }
}
