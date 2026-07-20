import foo.Foo;
import foo.AsyncFoo;
import foo.BoundaryTypes;
import foo.Placeholder;
import foo.EnumAbstract;
import foo.JsonAlias;
import foo.Narrowing;
import foo.ServerCallbacks;
import foo.TypedCatch;
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
    trace(Foo.normalize("OK"));
    AsyncFoo.demo().then(v -> trace(v));
    AsyncFoo.demoPrivateStaticAsync().then(v -> trace(v));
    asyncFoo.doubleWithAwaitMacro(21).then(v -> trace(v));
    asyncFoo.metadataAwaitLocalScope(39).then(v -> trace(v));
    asyncFoo.metadataAwaitOptionalParam({}).then(v -> trace(v));
    trace(BoundaryTypes.demo());
    trace(Placeholder.demo());
    trace(Date.now().getTime() > 0);
    trace(EnumAbstract.demo());
    trace(EnumAbstract.localDemo());
    trace(EnumAbstract.fieldLocalDemo());
    trace(EnumAbstract.recordDemo());
    trace(EnumAbstract.arrayLoopDemo());
    trace(JsonAlias.passthrough({metadata: cast null}).metadata);
    final server = {
      off: (event, handler) -> {},
      closeAllConnections: () -> {}
    };
    ServerCallbacks.callbackInitializedLater(server);
    ServerCallbacks.optionalForwardedMethod(server);
    trace(Narrowing.switchExitingNull({value: "present"}));
    trace(TypedCatch.recover("fixture"));
    trace(TypedCatch.recover("plain"));
    trace(Theme.name + ":" + Theme.accent);
    foo.ProjectedNullCall.demo(null);
  }
}
