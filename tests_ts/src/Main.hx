import foo.Foo;
import foo.AsyncFoo;

class Main {
  static function main() {
    final f = new Foo(1);
    trace(f.add(2));
    AsyncFoo.demo().then(v -> trace(v));
  }
}
