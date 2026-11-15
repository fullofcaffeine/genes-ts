package syntaxcodeforms;

/**
 * `__js__` values that Genes prints differently than Haxe's own printer.
 *
 * Why: Genes prints each `__js__` value with its ordinary value printer, as
 * it does for `js.Syntax.code`. Names, constants, calls, static fields, and
 * binary and unary operations give Haxe's bytes. Other values do not, and
 * this module holds one of each kind:
 *
 * | value | Haxe's printer | Genes | kind |
 * | --- | --- | --- | --- |
 * | `flag ? 10 : 20` | `(flag ? 10 : 20)` | `((flag) ? 10 : 20)` | layout |
 * | `[a, b]` | `[a,b]` | `[a, b]` | layout |
 * | `try f() catch (e) 40` | a function with one statement on each line | a function with Genes' layout | layout |
 * | `options.limit`, an optional field | `options.limit` | TypeScript profile only: `(options.limit ?? null)` | **behavior** |
 *
 * The last row changes a result. Genes' TypeScript profile reads a missing
 * optional field as `null`, where JavaScript gives `undefined`. So
 * `__js__("{0} === undefined", options.limit)` is `true` in the classic
 * profile and `false` in the TypeScript profile when the field is missing.
 * `js.Syntax.code` with values has always done the same.
 *
 * `yarn test:syntax-code-forms` checks the exact Genes text and the runtime
 * result of every row. The fixture README lists all kinds of values.
 * `untyped` is required because Haxe exposes `__js__` only to untyped code.
 */
class LegacyJsValues {
  static function choose(flag: Bool): Int {
    return untyped __js__("{0} + 1", flag ? 10 : 20);
  }

  /** Throws for an empty text, so that the `try` value below takes both paths. */
  static function measure(text: String): Int {
    if (text == "")
      throw "empty";
    return text.length;
  }

  static function recover(text: String): Int {
    return untyped __js__("{0} + 1",
      try measure(text) catch (error:haxe.Exception) 40);
  }

  static function isMissing(options: {?limit: Int}): Bool {
    return untyped __js__("{0} === undefined", options.limit);
  }

  public static function run(): Array<String> {
    final a = 3;
    final b = 4;
    final list: Int = untyped __js__("{0}.length", [a, b]);
    return [
      Std.string(choose(true)),
      Std.string(choose(false)),
      Std.string(list),
      Std.string(recover("six!")),
      Std.string(recover("")),
      Std.string(isMissing({
        limit: 1
      })),
      Std.string(isMissing({}))
    ];
  }
}
