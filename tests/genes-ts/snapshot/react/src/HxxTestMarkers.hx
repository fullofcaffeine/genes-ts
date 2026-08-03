#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
#end

/**
 * Test-only constructor for typed HXX root shapes that Haxe rarely produces.
 *
 * The candidate is intentionally forgeable with `@:privateAccess`. These
 * fixtures prove that minting it cannot authorize an unsafe representation
 * change: only complete use accounting and exact carrier shape can do that.
 */
class HxxTestMarkers {
  public static macro function root(tag: Expr, props: Expr,
      children: Expr): Expr {
    final position = Context.currentPos();
    final rawCandidate = macro genes.react.internal.HxxRootCandidate.issue;
    final candidate = switch rawCandidate.expr {
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
        Context.error('Expected the HXX candidate issuer to be a field',
          position);
    }
    final marker = macro genes.react.internal.Jsx.__hxxJsx($candidate, $tag,
      $props, $children);
    marker.pos = position;
    return marker;
  }
}
