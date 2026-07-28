package react_flight;

#if macro
import genes.react.flight.v19.FlightExtensionDecision;
import genes.react.flight.v19.FlightNestedValue;
import genes.react.flight.v19.FlightValueValidation.validateFlightValue;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;

using haxe.macro.TypeTools;

private function hostPolicy(type: Type, path: String): FlightExtensionDecision {
  return switch type {
    case TAbstract(reference, parameters):
      final definition = reference.get();
      if (definition.module == "react_flight.HostResource"
        && definition.name == "HostResource" && parameters.length == 1) {
        Recurse([
          {
            type: parameters[0],
            path: path + ".resolved",
            position: null
          }
        ]);
      } else if (definition.module == "react_flight.HostAction"
        && definition.name == "HostAction" && parameters.length == 1) {
        Accept;
      } else if (definition.module == "react_flight.HostLoop"
        && definition.name == "HostLoop" && parameters.length == 0) {
        Recurse([
          {
            type: type,
            path: path + ".again",
            position: null
          }
        ]);
      } else {
        Unhandled;
      }
    case TInst(reference, _):
      final definition = reference.get();
      // These deliberately hostile responses prove Genes reserves raw
      // standard-library shapes before consulting a host policy.
      if (definition.module == "js.lib.Promise"
        || definition.module == "js.lib.Symbol") {
        Accept;
      } else {
        Unhandled;
      }
    case TFun(_, _):
      Accept;
    case _:
      Unhandled;
  };
}

private function literalString(expression: Expr): String {
  return switch expression.expr {
    case EConst(CString(value, _)):
      value;
    case _:
      Context.fatalError("GTS-REACT-FLIGHT-FIXTURE expects a literal type path",
        expression.pos);
  };
}
#end

/**
 * Requires one named type to satisfy the generic React 19 Flight contract.
 *
 * The optional host policy proves that framework-specific provenance remains
 * outside Genes while nested values still use Genes' recursive validator.
 */
macro function requireFlight(typePath: Expr, ?withHostPolicy: Expr): Expr {
  #if macro
  final name = literalString(typePath);
  final useHostPolicy = withHostPolicy != null && switch withHostPolicy.expr {
    case EConst(CIdent("true")): true;
    case _: false;
  };
  final type = Context.getType(name);
  final validationIssue = useHostPolicy ? validateFlightValue(type, name,
    hostPolicy) : validateFlightValue(type, name);
  if (validationIssue != null) {
    Context.fatalError('[GTS-REACT-FLIGHT-001] ${validationIssue.path}: ${validationIssue.reason} Found ${validationIssue.type.toString()}.',
      validationIssue.position == null ? typePath.pos : validationIssue.position);
  }
  return macro null;
  #else
  return macro null;
  #end
}
