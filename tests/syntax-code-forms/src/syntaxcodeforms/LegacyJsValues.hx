package syntaxcodeforms;

/**
 * `__js__` values that Genes prints differently than Haxe's own printer.
 *
 * Why: Genes prints a `__js__` value itself when the value is a plain
 * expression, with the same value printer as for `js.Syntax.code`. Names,
 * constants, calls, static fields, and binary and unary operations give
 * Haxe's bytes. A few plain expressions do not, and this module holds them:
 *
 * | value | Haxe's printer | Genes | kind |
 * | --- | --- | --- | --- |
 * | `flag ? 10 : 20` | `(flag ? 10 : 20)` | `((flag) ? 10 : 20)` | layout |
 * | `[a, b]` | `[a,b]` | `[a, b]` | layout |
 * | `{size: a}` | `{ size : a}` | `{"size": a}` | layout |
 * | `options.limit`, an optional field | `options.limit` | TypeScript profile only: `(options.limit ?? null)` | **behavior** |
 *
 * The last row changes a result. Genes' TypeScript profile reads a missing
 * optional field as `null`, where JavaScript gives `undefined`. So
 * `__js__("{0} === undefined", options.limit)` is `true` in the classic
 * profile and `false` in the TypeScript profile when the field is missing.
 * `js.Syntax.code` with values has always done the same.
 *
 * `yarn test:syntax-code-forms` checks the exact Genes text and the runtime
 * result of every row. Values that are not plain expressions stay on Haxe's
 * printer; see `LegacyJsStatements`. `untyped` is required because Haxe
 * exposes `__js__` only to untyped code.
 */
class LegacyJsValues {
  static function choose(flag: Bool): Int {
    return untyped __js__("{0} + 1", flag ? 10 : 20);
  }

  static function isMissing(options: {?limit: Int}): Bool {
    return untyped __js__("{0} === undefined", options.limit);
  }

  public static function run(): Array<String> {
    final a = 3;
    final b = 4;
    final list: Int = untyped __js__("{0}.length", [a, b]);
    final size: Int = untyped __js__("{0}.size", {size: a});
    return [
      Std.string(choose(true)),
      Std.string(choose(false)),
      Std.string(list),
      Std.string(size),
      Std.string(isMissing({
        limit: 1
      })),
      Std.string(isMissing({}))
    ];
  }
}
