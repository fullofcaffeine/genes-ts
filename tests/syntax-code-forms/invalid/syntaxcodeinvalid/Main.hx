package syntaxcodeinvalid;

/**
 * Raw-code calls that must fail, one for each `-D syntax_code_invalid=NAME`.
 *
 * Why: Haxe's own printer used to report these errors. Genes prints raw code
 * itself now, so it must report the same message at the same position, and
 * it must publish no output. `yarn test:syntax-code-forms` builds each case.
 *
 * The last three cases put `return`, `break`, and `continue` where a `__js__`
 * value is expected. Genes leaves such a call to Haxe's printer, and Haxe
 * rejects it; the case pins that the build still stops with Haxe's message.
 *
 * `untyped` is required for the `__js__` cases: Haxe exposes that helper only
 * to untyped code.
 */
class Main {
  static function text(): String
    return Std.string(Math.random());

  static function main() {
    final template = text();
    #if (syntax_code_invalid == "template")
    js.Syntax.code(template);
    #elseif (syntax_code_invalid == "template_with_value")
    js.Syntax.code(template, 1);
    #elseif (syntax_code_invalid == "placeholder")
    js.Syntax.code("globalThis.x = {0}");
    #elseif (syntax_code_invalid == "hexadecimal_placeholder")
    js.Syntax.code("globalThis.x = {0x1}");
    #elseif (syntax_code_invalid == "negative_placeholder")
    js.Syntax.code("globalThis.x = {-1}");
    #elseif (syntax_code_invalid == "oversized_placeholder")
    js.Syntax.code("globalThis.x = {12345678901234567890123}");
    #elseif (syntax_code_invalid == "legacy_template")
    untyped __js__(template);
    #elseif (syntax_code_invalid == "legacy_empty")
    untyped __js__();
    #elseif (syntax_code_invalid == "legacy_placeholder")
    untyped __js__("globalThis.x = {1}", 1);
    #elseif (syntax_code_invalid == "legacy_return_value")
    untyped __js__("void {0}", return);
    #elseif (syntax_code_invalid == "legacy_break_value")
    while (true)
      untyped __js__("void {0}", break);
    #elseif (syntax_code_invalid == "legacy_continue_value")
    while (template == "")
      untyped __js__("void {0}", continue);
    #end
  }
}
