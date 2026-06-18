import foo.Foo;
import foo.AsyncFoo;
import foo.BoundaryTypes;
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
    final asyncFoo = new AsyncFoo();
    trace(f.add(2));
    AsyncFoo.demo().then(v -> trace(v));
    asyncFoo.doubleWithAwaitMacro(21).then(v -> trace(v));
    asyncFoo.metadataAwaitLocalScope(39).then(v -> trace(v));
    trace(BoundaryTypes.demo());
    trace(Placeholder.demo());
    trace(EnumAbstract.demo());
    trace(Theme.name + ":" + Theme.accent);
  }
}
