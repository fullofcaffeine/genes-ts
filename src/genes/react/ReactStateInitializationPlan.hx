package genes.react;

#if macro
import genes.ExplicitTypeArguments;
import genes.Module;
import haxe.ds.ObjectMap;
import haxe.macro.Context;
import haxe.macro.Expr.Position;
import haxe.macro.Type;

using haxe.macro.TypedExprTools;

/** One exact local whose declared State type authorizes a TS call witness. */
final class ReactStateInitializationDecision {
  public final declaration: TypedExpr;
  public final local: TVar;
  public final initializer: TypedExpr;
  public final call: TypedExpr;
  public final valueType: Type;
  public final pos: Position;

  public function new(declaration: TypedExpr, local: TVar,
      initializer: TypedExpr, call: TypedExpr, valueType: Type) {
    this.declaration = declaration;
    this.local = local;
    this.initializer = initializer;
    this.call = call;
    this.valueType = valueType;
    this.pos = declaration.pos;
  }
}

/** One type dependency introduced by a planned React state witness. */
typedef ReactStateInitializationReference = {
  final type: Type;
  final pos: Position;
}

/**
 * Owns destination-typed React state initialization for one module.
 *
 * Haxe can use a declared `State<T>` local to accept an initializer that is
 * narrower than `T`. TypeScript sees only the native `useState` call and can
 * infer that narrower type. This plan records the exact local declaration,
 * compiler-owned binding call, and closed `T` before imports are allocated.
 * The TypeScript emitter later prints one `useState<T>` for that same call;
 * classic JavaScript never consumes the type witness.
 */
final class ReactStateInitializationPlan {
  final byCall: ObjectMap<TypedExpr, ReactStateInitializationDecision>;
  final byDeclaration: ObjectMap<TypedExpr, ReactStateInitializationDecision>;
  final decisions: Array<ReactStateInitializationDecision>;

  public static function build(module: Module): ReactStateInitializationPlan {
    return new ReactStateInitializationPlanBuilder().build(module);
  }

  public function new(byCall: ObjectMap<TypedExpr,
    ReactStateInitializationDecision>,
      byDeclaration: ObjectMap<TypedExpr, ReactStateInitializationDecision>,
      decisions: Array<ReactStateInitializationDecision>) {
    this.byCall = byCall;
    this.byDeclaration = byDeclaration;
    this.decisions = decisions.copy();
  }

  /** Whether one exact static field is a compiler-owned state binding. */
  public static function isStateBinding(owner: ClassType,
      field: ClassField): Bool {
    return owner.module == 'genes.react.ReactHookBindings'
      && owner.name == 'ReactHookBindings'
      && (field.name == 'useStateValue'
        || field.name == 'useStateContextual' || field.name == 'useStateLazy');
  }

  /** Returns the decision for this exact typed call occurrence. */
  public function forCall(call: Null<TypedExpr>): Null<ReactStateInitializationDecision> {
    return call == null ? null : byCall.get(call);
  }

  /**
   * Returns the decision for this exact declaration and its original parts.
   *
   * Other React plans can reuse this authority without duplicating State or
   * binding recognition.
   */
  public function forDeclaration(declaration: TypedExpr, local: TVar,
      initializer: TypedExpr): Null<ReactStateInitializationDecision> {
    final decision = byDeclaration.get(declaration);
    return decision != null && decision.local == local
      && decision.initializer == initializer ? decision : null;
  }

  /** Whether another state plan has any authenticated declaration to inspect. */
  public inline function hasDecisions(): Bool {
    return decisions.length > 0;
  }

  /** Every type that TypeScript emission may print, in source order. */
  public function referencedTypes(): Array<ReactStateInitializationReference> {
    return [
      for (decision in decisions)
        {
          type: decision.valueType,
          pos: decision.pos
        }
    ];
  }
}

private final class ReactStateInitializationPlanBuilder {
  final byCall = new ObjectMap<TypedExpr, ReactStateInitializationDecision>();
  final byDeclaration = new ObjectMap<TypedExpr,
    ReactStateInitializationDecision>();
  final decisions = new Array<ReactStateInitializationDecision>();

  public function new() {}

  public function build(module: Module): ReactStateInitializationPlan {
    for (member in module.members)
      switch member {
        case MClass(owner, _, fields):
          for (field in fields)
            visit(field.expr);
          visit(owner.init);
        case MMain(expression):
          visit(expression);
        case MEnum(_, _) | MType(_, _):
      }
    return new ReactStateInitializationPlan(byCall, byDeclaration, decisions);
  }

  function visit(expression: Null<TypedExpr>): Void {
    if (expression == null)
      return;
    switch expression.expr {
      case TVar(local, initializer) if (initializer != null):
        final decision = recognize(expression, local, initializer);
        if (decision != null) {
          byCall.set(decision.call, decision);
          byDeclaration.set(expression, decision);
          decisions.push(decision);
        }
      default:
    }
    expression.iter(visit);
  }

  static function recognize(declaration: TypedExpr, local: TVar,
      initializer: TypedExpr): Null<ReactStateInitializationDecision> {
    final valueType = stateValueType(local.t);
    if (valueType == null
      || !ExplicitTypeArguments.isSafeTypeArgument(valueType))
      return null;

    final marker = ExplicitTypeArguments.callSiteMarker(initializer);
    final value = unwrap(marker == null ? initializer : marker.value);
    return switch value.expr {
      case TCall(callee, _):
        switch unwrap(callee).expr {
          case TField(_, FStatic(ownerRef, fieldRef))
            if (ReactStateInitializationPlan.isStateBinding(ownerRef.get(),
              fieldRef.get())):
            new ReactStateInitializationDecision(declaration, local,
              initializer, value, valueType);
          default:
            null;
        }
      default:
        null;
    }
  }

  /** Follows transparent compiler shells without erasing the State abstract. */
  static function stateValueType(type: Type, depth = 0): Null<Type> {
    if (depth > 64)
      return null;
    return switch type {
      case TType(_, _) | TLazy(_):
        stateValueType(Context.follow(type), depth + 1);
      case TMono(reference) if (reference.get() != null):
        stateValueType(reference.get(), depth + 1);
      case TAbstract(reference, [valueType]): final owner = reference.get(); owner.module == 'genes.react.State' && owner.name == 'State' ? valueType : null;
      default:
        null;
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
