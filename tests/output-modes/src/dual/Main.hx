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
}
