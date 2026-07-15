package dual;

/** Vanilla-compatible entry point over the target-neutral core scenario. */
class VanillaMain {
  public static function main():Void {
    ConsoleOutput.print(CoreScenario.run());
  }
}
