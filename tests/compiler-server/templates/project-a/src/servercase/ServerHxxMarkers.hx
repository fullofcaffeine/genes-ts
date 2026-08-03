package servercase;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
#end

/** Test-only constructor for a deliberately forgeable HXX root candidate. */
class ServerHxxMarkers {
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
