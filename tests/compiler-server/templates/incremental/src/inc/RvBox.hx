package inc;

/** Probe 6e: a generic class whose instances are made per type argument. */
@:generic
class RvBox<T> {
  public final item: T;

  public function new(item: T) {
    this.item = item;
  }
}
