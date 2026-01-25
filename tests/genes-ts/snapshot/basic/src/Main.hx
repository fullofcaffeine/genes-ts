import foo.Foo;
import foo.AsyncFoo;
import foo.Placeholder;
import foo.EnumAbstract;

class Main {
  static function main() {
    final f = new Foo(1);
    trace(f.add(2));
    AsyncFoo.demo().then(v -> trace(v));
    trace(Placeholder.demo());
    trace(EnumAbstract.demo());
  }
}
