package genes;

import genes.CompilerDiagnostic;
import haxe.macro.Context;
import haxe.macro.Expr.Position;
import haxe.macro.Type;

using haxe.macro.TypedExprTools;

/** One validated, ordered string-template expression. */
typedef TemplateLiteralIntent = {
  final chunks: Array<String>;
  final values: Array<TypedExpr>;
  final pos: Position;
}

/**
 * Immutable semantic plan for compiler-owned string-template markers.
 *
 * Why: target printers must agree on marker identity, arity, literal chunks,
 * interpolation types, and evaluation order. Reinterpreting raw syntax in the
 * TypeScript printer would leave classic JS with a different contract and
 * could expose partially written output after malformed carrier data.
 *
 * What: the plan validates every reachable `TemplateLiteralMarker.__emit`
 * call before module emission. It preserves literal chunks and the original
 * typed `String` expressions in source order, without choosing output syntax.
 *
 * How: `build` walks the module's typed expressions and fails closed on an
 * invalid marker. Emitters later query the same parser for the already-proven
 * intent; classic JS prints concatenation and genes-ts prints a native template
 * literal. No target assertion, broad type, or runtime carrier is introduced.
 */
class TemplateLiteralPlan {
  static inline final MARKER_MODULE = 'genes.internal.TemplateLiteralMarker';
  static inline final MARKER_FIELD = '__emit';

  public static function build(module: Module): TemplateLiteralPlan {
    final plan = new TemplateLiteralPlan();
    plan.visitModuleExpressions(module, expression -> {
      switch unwrap(expression).expr {
        case TCall(callee, arguments):
          plan.intentForCall(callee, arguments);
        default:
      }
    });
    return plan;
  }

  function new() {}

  /** Returns validated intent when `callee` is the exact marker, else null. */
  public function intentForCall(callee: TypedExpr,
      arguments: Array<TypedExpr>): Null<TemplateLiteralIntent> {
    if (!isMarkerCallee(callee))
      return null;
    if (arguments.length != 2) {
      return markerError('GENES-TEMPLATE-LITERAL-MARKER-001',
        'Template literal marker expects chunks and values arrays', callee.pos);
    }

    final chunks = literalChunks(arguments[0]);
    final values = interpolationValues(arguments[1]);
    if (chunks.length != values.length + 1) {
      return markerError('GENES-TEMPLATE-LITERAL-MARKER-002',
        'Template literal marker requires exactly one more chunk than value',
        callee.pos);
    }
    for (value in values) {
      if (!isStringType(value.t)) {
        return markerError('GENES-TEMPLATE-LITERAL-MARKER-003',
          'Template literal interpolation must have type String', value.pos);
      }
    }
    return {chunks: chunks, values: values, pos: callee.pos};
  }

  public static function isMarkerCallee(callee: TypedExpr): Bool {
    return switch unwrap(callee).expr {
      case TField(_, FStatic(_.get() => owner, _.get() => field)): owner.module == MARKER_MODULE && field.name == MARKER_FIELD;
      default:
        false;
    }
  }

  static function literalChunks(expression: TypedExpr): Array<String> {
    return switch unwrap(expression).expr {
      case TArrayDecl(entries):
        [
          for (entry in entries)
            switch unwrap(entry).expr {
              case TConst(TString(value)):
                value;
              default:
                return markerError('GENES-TEMPLATE-LITERAL-MARKER-004',
                  'Template literal chunks must be string literals', entry.pos);
            }
        ];
      default:
        markerError('GENES-TEMPLATE-LITERAL-MARKER-005',
          'Template literal chunks must be an array literal', expression.pos);
    }
  }

  static function interpolationValues(expression: TypedExpr): Array<TypedExpr> {
    return switch unwrap(expression).expr {
      case TArrayDecl(entries): entries;
      default:
        markerError('GENES-TEMPLATE-LITERAL-MARKER-006',
          'Template literal values must be an array literal', expression.pos);
    }
  }

  static function isStringType(type: Type): Bool {
    return switch Context.followWithAbstracts(type) {
      case TInst(_.get() => {pack: [], name: 'String'}, _): true;
      default: false;
    }
  }

  static function unwrap(expression: TypedExpr): TypedExpr {
    var current = expression;
    while (current != null) {
      switch current.expr {
        case TMeta(_, inner) | TParenthesis(inner) | TCast(inner, null):
          current = inner;
        default:
          return current;
      }
    }
    return expression;
  }

  function visitModuleExpressions(module: Module,
      visit: TypedExpr->Void): Void {
    function walk(expression: TypedExpr): Void {
      if (expression == null)
        return;
      visit(expression);
      expression.iter(walk);
    }
    for (member in module.members) {
      switch member {
        case MClass(owner, _, fields):
          for (field in fields)
            walk(field.expr);
          walk(owner.init);
        case MMain(expression):
          walk(expression);
        default:
      }
    }
  }

  static function markerError<T>(id: String, message: String,
      pos: Position): T {
    return CompilerDiagnostic.fail('[$id] $message.', pos);
  }
}
