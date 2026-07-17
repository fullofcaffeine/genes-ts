package genes;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.MacroStringTools;
#end

/**
 * Authors one target-neutral string template with typed interpolations.
 *
 * Why: Haxe lowers interpolation to `+`, which TypeScript widens to `string`.
 * That loses useful template-literal inference for APIs whose string shape is
 * part of their type, while raw target syntax enters Genes through `Dynamic`
 * and requires a generated assertion.
 *
 * What: `value` accepts a string literal or an interpolated string whose
 * embedded expressions are `String`. Genes emits a native template literal in
 * TypeScript mode and an equivalent ordered concatenation in classic JS. It
 * does not change ordinary Haxe concatenation.
 *
 * How: the macro separates the authored expression into immutable literal
 * chunks and typed values, then returns an extern compiler marker. The shared
 * `TemplateLiteralPlan` validates that marker after Haxe typing; both output
 * profiles consume it without printing a helper call, import, or assertion.
 */
class TemplateLiteral {
  /**
   * Expands authored Haxe string syntax into a typed compiler marker.
   *
   * Why: by the time normal expression emission sees Haxe interpolation, its
   * authored template boundaries have become ordinary `+` operations. Guessing
   * which concatenations should regain template semantics would change existing
   * programs and could infer a stronger TypeScript type than the author asked
   * for.
   *
   * What: a single-quoted Haxe format string becomes parallel literal-chunk and
   * `String`-value arrays. A non-interpolated string remains one chunk. Runtime
   * strings and hand-built concatenations fail with a source-positioned
   * authoring diagnostic.
   *
   * How: `MacroStringTools.formatString` applies Haxe's own `$name`/`${expr}`
   * grammar. Its generated concatenation is left-associated, so this macro
   * flattens only that outer left spine and retains every right operand as one
   * authored slot. An embedded `+` therefore remains inside `${...}` instead of
   * becoming another template boundary. Reification preserves each expression
   * for ordinary Haxe typing; the marker's `Array<String>` signature rejects
   * implicit broad coercions.
   */
  public static macro function value(template: ExprOf<String>): ExprOf<String> {
    final callPos = Context.currentPos();
    if (!Context.defined('js')
      || !Context.defined(genes.CompilerInternal.GENERATOR_ACTIVE_DEFINE)) {
      Context.error('[GENES-TEMPLATE-LITERAL-TARGET-001] TemplateLiteral.value requires the active Genes JS generator.',
        callPos);
    }

    final chunks: Array<String> = [''];
    final values: Array<Expr> = [];

    function appendPart(expression: Expr): Void {
      switch expression.expr {
        case EConst(CString(value, _)):
          chunks[chunks.length - 1] += value;
        default:
          values.push(expression);
          chunks.push('');
      }
    }

    function appendFormatted(expression: Expr): Void {
      switch expression.expr {
        case EBinop(OpAdd, left, right):
          appendFormatted(left);
          appendPart(right);
        default:
          appendPart(expression);
      }
    }

    final authored = switch template.expr {
      case EConst(CString(value, SingleQuotes)):
        MacroStringTools.formatString(value, template.pos);
      case EConst(CString(_, _)):
        template;
      default:
        Context.error('[GENES-TEMPLATE-LITERAL-AUTHORING-001] TemplateLiteral.value expects a string literal or an authored interpolated string, not an arbitrary String expression.',
          template.pos);
    };
    appendFormatted(authored);

    final chunkExpressions = [
      for (chunk in chunks) {
        final expression: Expr = macro $v{chunk};
        expression.pos = template.pos;
        expression;
      }
    ];
    return
      macro @:pos(callPos) genes.internal.TemplateLiteralMarker.__emit([$a{chunkExpressions}],
        [$a{values}]);
  }
}
