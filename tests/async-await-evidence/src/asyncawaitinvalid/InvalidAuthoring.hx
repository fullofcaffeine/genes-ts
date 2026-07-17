package asyncawaitinvalid;

/** Proves async metadata cannot silently attach to a non-function value. */
class InvalidAuthoring {
  static function main():Void {
    final invalid = @:async 1;
  }
}
