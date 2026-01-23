package foo;

class Foo {
  public final x: Int;

  public function new(x: Int) {
    this.x = x;
  }

  public function add(y: Int): Int {
    return x + y;
  }
}

