package tempreads;

/**
 * Exercises a nullable receiver both with and without Haxe's evaluate-once
 * temporary introduced by inline expansion.
 */
class Main {
  static function main(): Void {
    final target = new Target();
    final first = target.pushBuilt(7);
    final second = target.pushDirect(8);
    final cleared = target.clearLocal(null) == null;
    NodeConsole.log('$first|$second|${target.snapshot()}|$cleared');
  }
}

private class Target {
  final receiver: Null<Receiver>;
  var buildCount = 0;

  public function new() {
    receiver = new Receiver();
  }

  /**
   * `build(value)` has an observable side effect. Haxe must therefore evaluate
   * `receiver` first and retain it in a local while it inlines `push`.
   */
  public function pushBuilt(value: Int): Int {
    receiver.push(build(value));
    return buildCount;
  }

  /** The simple argument keeps the corresponding direct receiver path. */
  public function pushDirect(value: Int): Int {
    receiver.push(value);
    return buildCount;
  }

  public function snapshot(): String {
    return receiver.values.join(",");
  }

  /**
   * Negative control: an ordinary nullable local remains nullable through its
   * declaration, reassignment target, and later read.
   */
  public function clearLocal(value: Null<Receiver>): Null<Receiver> {
    var local = value;
    local = null;
    return local;
  }

  function build(value: Int): Int {
    buildCount++;
    return value;
  }
}

private class Receiver {
  public final values = new Array<Int>();

  public function new() {}

  public inline function push(value: Int): Void {
    values.push(value);
  }
}
