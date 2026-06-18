import foo.Foo;
import foo.AsyncFoo;
import foo.Placeholder;
import foo.EnumAbstract;
import genes.ts.Imports;

typedef ThemeFixture = {
  final name: String;
  final accent: String;
};

class Main {
  static final Theme: ThemeFixture = Imports.defaultImportWith("./resources/theme.json", "json", "ThemeFixture");

  static function main() {
    final f = new Foo(1);
    trace(f.add(2));
    AsyncFoo.demo().then(v -> trace(v));
    trace(Placeholder.demo());
    trace(EnumAbstract.demo());
    trace(Theme.name + ":" + Theme.accent);
  }
}
