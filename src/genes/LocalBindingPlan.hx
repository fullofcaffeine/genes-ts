package genes;

#if macro
import haxe.macro.Expr.Binop;
import haxe.macro.Expr.Unop;
import haxe.macro.Type;

using haxe.macro.TypedExprTools;

/**
 * Records which typed local bindings are reassigned after declaration.
 *
 * Why
 * ---
 * Haxe 4.3 exposes finality to its own typer but not through the public
 * `haxe.macro.TVar` API used by custom generators. Target printers therefore
 * cannot reliably distinguish source `final` from source `var` by inspecting
 * one declaration. They can, however, prove the stronger output fact that an
 * initialized binding has no write anywhere in the complete typed module.
 *
 * What
 * ----
 * A local is mutable when the typed tree assigns to it, applies an assignment
 * operator, or increments/decrements it. Writes through an array or object
 * stored in the local do not rebind the local itself and therefore do not
 * count. Printers combine this fact with initializer presence: JavaScript
 * `const` always requires an initializer.
 *
 * How
 * ---
 * `LocalBindingPlanBuilder` walks every retained field, class initializer, and
 * main expression, including nested functions, before source emission. Local
 * identity is the stable Haxe `TVar.id`; names and source positions never
 * participate. TypeScript, TSX, and classic JavaScript consume the same plan,
 * so they cannot disagree about `const` versus `let`.
 *
 * A local passed into a `js.Syntax.code` or legacy `__js__` placeholder is
 * conservatively mutable because the opaque template may use that placeholder
 * as an assignment target. Raw text that guesses an emitted local name remains
 * outside this typed-tree proof and must not mutate Haxe locals.
 */
final class LocalBindingPlan {
  final reassignedLocalIds: Map<Int, Bool>;

  public static function build(module: Module): LocalBindingPlan {
    return new LocalBindingPlanBuilder().build(module);
  }

  public function new(reassignedLocalIds: Map<Int, Bool>) {
    this.reassignedLocalIds = reassignedLocalIds;
  }

  /** Whether the typed program writes this local after its declaration. */
  public function isReassigned(local: TVar): Bool {
    return reassignedLocalIds.exists(local.id);
  }

  /** Whether an initialized local can use an ES2015 `const` declaration. */
  public function canUseConst(local: TVar, hasInitializer: Bool): Bool {
    return hasInitializer && !isReassigned(local);
  }
}

/** Mutable source-order collector discarded after the immutable plan is built. */
private final class LocalBindingPlanBuilder {
  final reassignedLocalIds: Map<Int, Bool> = [];

  public function new() {}

  public function build(module: Module): LocalBindingPlan {
    for (member in module.members)
      switch member {
        case MClass(cl, _, fields):
          for (field in fields)
            if (field.expr != null)
              visit(field.expr);
          if (cl.init != null)
            visit(cl.init);
        case MMain(expression):
          visit(expression);
        case MEnum(_, _) | MType(_, _):
      }
    return new LocalBindingPlan(reassignedLocalIds);
  }

  function visit(expression: TypedExpr): Void {
    switch expression.expr {
      case TBinop(OpAssign | OpAssignOp(_), target, value):
        recordTarget(target);
        visit(target);
        visit(value);
      case TUnop(OpIncrement | OpDecrement, _, target):
        recordTarget(target);
        visit(target);
      case TCall({
        expr: TField(_,
          FStatic(_.get() => {module: 'js.Syntax'},
            _.get() => {name: 'code'}))
      }, arguments) | TCall({expr: TIdent('__js__')}, arguments):
        // A raw placeholder is a value expression in the typed tree but may be
        // placed on the left of `=`, `++`, `for (... in ...)`, or another
        // target-only write. Keep every passed local mutable rather than parse
        // or partially trust the opaque target-language string.
        for (index in 1...arguments.length)
          recordTarget(arguments[index]);
        for (argument in arguments)
          visit(argument);
      default:
        expression.iter(visit);
    }
  }

  function recordTarget(target: TypedExpr): Void {
    switch unwrap(target).expr {
      case TLocal(local):
        reassignedLocalIds.set(local.id, true);
      default:
    }
  }

  static function unwrap(expression: TypedExpr): TypedExpr {
    return switch expression.expr {
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, null):
        unwrap(inner);
      default:
        expression;
    }
  }
}
#end
