package syntaxcodeforms;

/**
 * `__js__` values whose layout differs between Genes and Haxe's own printer.
 *
 * Why: Genes prints each `__js__` value with its ordinary value printer, as
 * it does for `js.Syntax.code`. For most values the text is the same as
 * Haxe's. For the two below only spaces and parentheses differ:
 *
 * | value | Haxe's printer | Genes |
 * | --- | --- | --- |
 * | `flag ? 10 : 20` | `(flag ? 10 : 20)` | `((flag) ? 10 : 20)` |
 * | `[a, b]` | `[a,b]` | `[a, b]` |
 *
 * `yarn test:syntax-code-forms` checks the exact Genes text and the runtime
 * result. `untyped` is required because Haxe exposes `__js__` only to untyped
 * code.
 */
class LegacyJsValues {
  static function choose(flag: Bool): Int {
    return untyped __js__("{0} + 1", flag ? 10 : 20);
  }

  public static function run(): Array<String> {
    final a = 3;
    final b = 4;
    final list: Int = untyped __js__("{0}.length", [a, b]);
    return
      [Std.string(choose(true)), Std.string(choose(false)), Std.string(list)];
  }
}
