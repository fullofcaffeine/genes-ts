package genes.react.flight.v19;

#if macro
import haxe.macro.Type;
import haxe.macro.Expr.Position;

/**
 * One closed compile-time explanation for a value rejected by React Flight.
 *
 * Genes returns data instead of issuing a framework diagnostic so React hosts
 * can preserve their own error codes and source-position policy. Hosts should
 * branch on `kind`, not parse `reason`; the prose is explanatory and may be
 * improved without changing the stable semantic category.
 */
typedef FlightValidationIssue = {
  final kind: FlightValidationKind;
  final path: String;
  final type: Type;
  final reason: String;
  final position: Null<Position>;
}
#end
