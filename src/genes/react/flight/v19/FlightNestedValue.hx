package genes.react.flight.v19;

#if macro
import haxe.macro.Type;
import haxe.macro.Expr.Position;

/**
 * A host-proven capability's nested value that Genes must validate with the
 * ordinary React 19 Flight algebra.
 *
 * `path` is the complete user-facing path for diagnostics. `position` should
 * identify the nested declaration when the host has one; `null` deliberately
 * inherits the enclosing value's source position.
 */
typedef FlightNestedValue = {
  final type: Type;
  final path: String;
  final position: Null<Position>;
}
#end
