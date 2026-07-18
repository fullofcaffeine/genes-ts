package deepnullish;

/**
 * Runs the fixture and prints its results as one JSON array.
 *
 * Using the same compact output in every compiler profile lets the test compare
 * behavior directly instead of relying only on the generated source text.
 */
class Main {
  public static function main():Void {
    NodeConsole.log(haxe.Json.stringify(DeepNullishAliases.run()));
  }
}
