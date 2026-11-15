package syntaxcodeforms;

/** Prints one transcript line for each group of raw-code shapes. */
class Main {
  static function main() {
    final lines = [
      "zero:" + ZeroArgument.run().join("|"),
      "legacy:" + LegacyJs.run().join("|"),
      "legacy-values:" + LegacyJsValues.run().join("|"),
      "legacy-statements:" + LegacyJsStatements.run().join("|"),
      "resources:" + Resources.run().join("|")
    ];
    js.Syntax.code("console.log({0})", lines.join("\n"));
  }
}
