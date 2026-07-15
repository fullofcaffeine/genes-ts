package dual;

/** Entry point compiled unchanged by TS, classic Genes, and standard Haxe JS. */
class Main {
  public static function main():Void {
    final report = {
      core: CoreScenario.run(),
      helpers: HelperScenario.run()
    };
    ConsoleOutput.print(report);
  }

  /**
   * Provides one stable failure site for executable source-map verification.
   *
   * Why: the normal differential run must succeed, while the QA harness also
   * needs a real thrown stack frame whose generated TS and classic JS locations
   * can be followed back to this exact Haxe source line.
   *
   * What/How: `@:keep` prevents full DCE from removing this externally invoked
   * test hook. Both Genes profiles emit an ordinary static method; the Node
   * harness imports `Main`, calls it, and checks the resulting mapped frame.
   */
  @:keep
  public static function sourceMapProbe():Void {
    throw new js.lib.Error("GENES_SOURCE_MAP_PROBE");
  }
}
