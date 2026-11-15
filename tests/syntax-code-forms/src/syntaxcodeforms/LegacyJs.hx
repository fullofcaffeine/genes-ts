package syntaxcodeforms;

/**
 * Calls of `__js__`, the raw-code helper that older Haxe code and externs use.
 *
 * Why: Haxe 4 prints `__js__(template, values...)` like `js.Syntax.code`, but
 * Genes used to print only the single-identifier form itself. Each line below
 * is one other shape. `yarn test:syntax-code-forms` compares the emitted
 * module with the text that Haxe's printer produced for it. Values that Genes
 * lays out differently than Haxe are in `LegacyJsValues`.
 *
 * `untyped` is required here: Haxe exposes `__js__` only to untyped code. Each
 * result is assigned to a typed local at once.
 */
class LegacyJs {
  public static function run(): Array<String> {
    final out: Array<String> = [];
    final a = 3;
    final b = 4;
    // No value: statement and value position.
    untyped __js__("Reflect.set(globalThis, '__legacyJs', 1)");
    final identifier: Float = untyped __js__("Infinity");
    out.push(Std.string(identifier));
    final dotted: Float = untyped __js__("Math.max(1, 2)");
    out.push(Std.string(dotted));
    // Values.
    final sum: Int = untyped __js__("{0} + {1}", a, b);
    out.push(Std.string(sum));
    final repeated: Int = untyped __js__("{0} + {0} + {1}", a, Other.two());
    out.push(Std.string(repeated));
    final imported: Int = untyped __js__("{0} + 2", Other.counter);
    out.push(Std.string(imported));
    final text: String = untyped __js__("{0}.toUpperCase()", "text");
    out.push(text);
    // Haxe puts parentheses around a binary or unary value.
    final product: Int = untyped __js__("{0} * 2", a + b);
    out.push(Std.string(product));
    final negated: Int = untyped __js__("{0}.toString().length", -a);
    out.push(Std.string(negated));
    final castValue: Int = untyped __js__("{0} * 3", (cast(a + b) : Int));
    out.push(Std.string(castValue));
    // `{{` and `}}` also mean one brace when values are present.
    final doubled: String = untyped __js__("JSON.stringify([{{a: {0}}}, {{}}])",
      a);
    out.push(doubled);
    // Statement position with a value.
    untyped __js__("Reflect.set(globalThis, '__legacyJs', {0})", b);
    final stored: Int = untyped __js__("Reflect.get(globalThis, '__legacyJs')");
    out.push(Std.string(stored));
    return out;
  }
}
