package kepttypes;

/**
 * A `@:generic` class. Haxe makes one new class for each type argument, in a
 * module of its own that has no source file.
 */
@:generic
class Box<T> {
  public var item: T;

  public function new(item: T) {
    this.item = item;
  }

  public function swap(next: T): T {
    final previous = item;
    item = next;
    return previous;
  }
}
