#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
#end

/**
 * Test-only constructor for typed HXX root shapes that Haxe rarely produces.
 *
 * Production code receives this proof only from `genes.react.JSX`. The fixture
 * needs to force dynamic-tag and lifted-tail edge cases, so this macro mirrors
 * the parser's exact private proof issuer without adding a production API.
 */
class HxxTestMarkers {
  public static macro function root(tag: Expr, props: Expr,
      children: Expr): Expr {
    final position = Context.currentPos();
    final rawProof = macro genes.react.internal.HxxParserProof.issue;
    final proof = switch rawProof.expr {
      case EField(owner, field):
        {
          expr: EMeta({
            name: ':privateAccess',
            params: [],
            pos: position
          }, {expr: EField(owner, field), pos: position}),
          pos: position
        };
      default:
        Context.error('Expected the HXX proof issuer to be a field', position);
    }
    final marker = macro genes.react.internal.Jsx.__hxxJsx($proof, $tag,
      $props, $children);
    marker.pos = position;
    return marker;
  }
}
