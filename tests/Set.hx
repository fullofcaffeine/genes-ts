package tests;

// benmerckx/genes#82
@:forward
abstract Set<T>(js.lib.Set<T>) {
  public inline function new(?initial: Iterable<T>) {
    this = new js.lib.Set<T>();
  }

  public function iterator(): js.lib.HaxeIterator<T> {
    return new js.lib.HaxeIterator(this.values());
  }
}
