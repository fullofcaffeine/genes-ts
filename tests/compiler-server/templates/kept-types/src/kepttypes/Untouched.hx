package kepttypes;

import kepttypes.Shapes;

/** A class with an inline constructor: Haxe replaces its uses with locals. */
class Point {
  public final x: Int;
  public final y: Int;

  public inline function new(x: Int, y: Int) {
    this.x = x;
    this.y = y;
  }
}

/**
 * No case of the kept-types probe edits this module or a module that it
 * reads. Its bodies use the constructs that Haxe changes after typing: a
 * `for` loop, a local with the name of a package, a local that a closure
 * captures in a loop, a `catch`, an inline constructor and an inline call.
 */
class Untouched implements Named {
  public static var defaultPhase: Phase = Draft;

  public var envelope: Envelope<Phase>;
  public var history: Array<Step> = [];

  public function new(phase: Phase) {
    envelope = {value: phase, phase: phase};
  }

  public function name(): String {
    return 'untouched';
  }

  public static inline function twice(value: Int): Int {
    final doubled = value * 2;
    return doubled;
  }

  public function advance(steps: Array<Step>): Phase {
    var phase = envelope.phase;
    final callbacks: Array<() -> Int> = [];
    for (step in steps) {
      final kepttypes = switch step {
        case Start(next):
          phase = next;
          0;
        case Move(by, moved):
          by + moved.value;
        case Stop:
          -1;
      }
      callbacks.push(() -> kepttypes);
      history.push(step);
    }
    try {
      if (callbacks.length > 3)
        throw 'too many';
    } catch (message:String) {
      phase = Done;
    }
    final point = new Point(1, 2);
    final box = new Box<Int>(point.x + point.y);
    box.swap(twice(callbacks.length));
    return phase;
  }
}
