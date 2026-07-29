package enumconstructors;

import enumconstructors.marker.PlannedMarker;

/**
 * Framework-neutral proof for destination-typed enum constructors used as
 * function values.
 */
class Main {
  static function map<A, B>(value: A, transform: A->B): InvariantValue<B> {
    return new InvariantValue(transform(value));
  }

  static function first<T>(left: InvariantValue<T>,
      right: InvariantValue<T>): InvariantValue<T> {
    return left;
  }

  /**
   * Both constructor references have the exact Haxe result `Choice<A, B>`.
   *
   * Bare TypeScript references infer their missing owner parameter as `never`,
   * making the two invariant mapped values incompatible.
   */
  static function either<A, B>(left: A, right: B): Choice<A, B> {
    return first(map(left, Choice.Left), map(right, Choice.Right)).value;
  }

  /**
   * Supplies `B` through an empty, compile-time-typed array.
   *
   * The array emits as `[]`, and this function returns only `String`.
   * `PlannedMarker` must therefore be retained as a type-only dependency by
   * the same plan that prints `Choice.Left<String, PlannedMarker>`.
   */
  static function imported<A, B>(left: A, _seed: Array<B>,
      constructor: A->Choice<A, B>): String {
    return switch constructor(left) {
      case Left(value): Std.string(value);
      case Right(_): "unexpected";
    }
  }

  /** Ordinary function value: it must not receive enum type arguments. */
  static function ordinary<A, B>(left: A, right: B): Choice<A, B> {
    return first(map(left, value -> Choice.Left(value)),
      map(right, value -> Choice.Right(value))).value;
  }

  public static function main(): Void {
    final combined = either("left", 7);
    final importedValue = imported("planned", ([] : Array<PlannedMarker>),
      Choice.Left);
    final direct: Choice<String, Int> = Choice.Left("direct");
    final lambda = ordinary("lambda", 9);
    NodeConsole.log([
      switch combined {
        case Left(value):
          value;
        case Right(value):
          Std.string(value);
      },
      importedValue,
      switch direct {
        case Left(value):
          value;
        case Right(value):
          Std.string(value);
      },
      switch lambda {
        case Left(value):
          value;
        case Right(value):
          Std.string(value);
      }
    ].join("|"));
  }
}
