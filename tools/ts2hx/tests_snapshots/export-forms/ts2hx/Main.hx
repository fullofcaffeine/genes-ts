package ts2hx;

final base = 1;

function inc(x: Float): Float {
  return (x + 1);
}

class Foo {
  public static function get(): Float {
    return 123;
  }
}

function main(): Void {
  trace(base);
  trace(inc(1));
  trace(Foo.get());
}

final Base = base;

class RenamedFoo extends Foo {}

final __default = base;
