package inc;

/** Each type argument gets its own generated class. */
@:generic
class Box<T> {
  public final item: T;

  public function new(item: T) {
    this.item = item;
  }
}
