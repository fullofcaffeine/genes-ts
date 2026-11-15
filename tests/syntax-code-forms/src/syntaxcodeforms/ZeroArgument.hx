package syntaxcodeforms;

/**
 * `js.Syntax.code` calls that have a literal template and no value argument.
 *
 * Why: this is the form that Genes used to hand to Haxe's own printer. Each
 * line below is one shape of that form. `yarn test:syntax-code-forms` compares
 * the emitted module with the text that Haxe's printer produced before Genes
 * printed these calls itself.
 *
 * The values are typed at once, so no `Dynamic` value leaves a raw template.
 */
class ZeroArgument {
  static inline final TEMPLATE = "Math.min(1, 2)";

  public final label = "instance";

  public function new() {}

  /** The template `this` must print the JavaScript receiver. */
  public function receiver(): ZeroArgument {
    return js.Syntax.code("this");
  }

  public static function run(): Array<String> {
    final out: Array<String> = [];
    // Statement position.
    js.Syntax.code("Reflect.set(globalThis, '__syntaxCodeForms', [])");
    js.Syntax.code("Reflect.get(globalThis, '__syntaxCodeForms').push('statement')");
    // Value position.
    final max: Float = js.Syntax.code("Math.max(1, 2)");
    out.push(Std.string(max));
    // A template that comes from an inline constant is still a literal.
    final min: Float = js.Syntax.code(TEMPLATE);
    out.push(Std.string(min));
    // Haxe reads `{{` as one `{` and `}}` as one `}`.
    final doubled: String = js.Syntax.code("JSON.stringify([{{a: 1}}, {}, {{}}])");
    out.push(doubled);
    // Braces around text that is not a number stay as they are.
    final named: String = js.Syntax.code("JSON.stringify(((x) => ({x}))(7))");
    out.push(named);
    final braces: String = js.Syntax.code("'{{{x}}} {} }{ {{0}} { 0 } {1e3} {0x} {_1} {a}}'");
    out.push(braces);
    // A template with line breaks keeps its own layout.
    final multiline: String = js.Syntax.code("(function () {
      // a comment stays
      return 'multiline';
    })()");
    out.push(multiline);
    // A raw value that at once receives a property access or a call.
    final length: Int = js.Syntax.code("'four'").length;
    out.push(Std.string(length));
    final parsed: Int = js.Syntax.code("parseInt")("12");
    out.push(Std.string(parsed));
    final pushed: Int = js.Syntax.code("Reflect.get(globalThis, '__syntaxCodeForms').length");
    out.push(Std.string(pushed));
    final instance = new ZeroArgument();
    out.push(Std.string(instance.receiver() == instance));
    out.push(instance.receiver().label);
    return out;
  }
}
