package genes;

import haxe.ds.ObjectMap;
import haxe.macro.Type;
import genes.Module.Field;

using haxe.macro.TypedExprTools;

enum NativeAsyncProjection {
  AnonymousFunction(value: TypedExpr);
  ReturnPayload(value: TypedExpr);
}

/**
 * Owns exact function-scoped authority for native async carrier erasure.
 *
 * Why: a raw `async {0}` template or targetless cast is forgeable syntax. It
 * cannot prove that Genes' async macro owns the surrounding function or the
 * return currently being printed, especially when synchronous and async
 * functions are nested.
 *
 * What: this request-local plan records each exact anonymous `TFunction` and
 * each exact return payload carried by `NativeAsyncMarker`. Named async fields
 * retain their established typed-field `:jsAsync` fact. A return carrier is
 * admitted only as the direct value of a return in the innermost native async
 * function.
 *
 * How: planning walks function defaults and bodies with an explicit context
 * stack. Every nested function replaces the current context; an exact
 * `functionValue` carrier is the only way an anonymous function enters the
 * async context. Emitters later perform identity lookups and never infer
 * ownership from strings, names, source positions, or cast shape.
 */
class NativeAsyncPlan {
  final projections: ObjectMap<TypedExpr, NativeAsyncProjection>;
  final carrierCount: Int;

  public static function build(module: Module): NativeAsyncPlan {
    return new NativeAsyncPlanBuilder().build(module);
  }

  public function new(projections: ObjectMap<TypedExpr, NativeAsyncProjection>,
      carrierCount: Int) {
    this.projections = projections;
    this.carrierCount = carrierCount;
  }

  /** Whether this module contains any planned native-async carriers. */
  public inline function hasCarriers(): Bool {
    return carrierCount > 0;
  }

  /** Returns the immutable decision for this exact typed occurrence. */
  public inline function projection(expression: TypedExpr): Null<NativeAsyncProjection> {
    return projections.get(expression);
  }

  /** Returns the exact source value carried by this async return occurrence. */
  public function returnValue(expression: TypedExpr): Null<TypedExpr> {
    return switch projections.get(expression) {
      case ReturnPayload(value): value;
      default: null;
    }
  }
}

private class NativeAsyncPlanBuilder {
  final projections = new ObjectMap<TypedExpr, NativeAsyncProjection>();
  final functionContexts: Array<Bool> = [];
  var carrierCount = 0;

  public function new() {}

  public function build(module: Module): NativeAsyncPlan {
    for (member in module.members) {
      switch member {
        case MClass(type, _, fields):
          for (field in fields)
            visitField(field);
          visit(type.init);
        case MMain(expression):
          visit(expression);
        case MEnum(_, _) | MType(_, _):
      }
    }
    return new NativeAsyncPlan(projections, carrierCount);
  }

  function visitField(field: Field): Void {
    if (field.expr == null)
      return;
    final isNamedAsync = field.meta != null
      && (field.meta.has(':jsAsync') || field.meta.has('jsAsync'));
    switch field.expr.expr {
      case TFunction(_) if (isNamedAsync):
        visitFunction(field.expr, true);
      default:
        visit(field.expr);
    }
  }

  function inNativeAsyncFunction(): Bool {
    return functionContexts.length > 0
      && functionContexts[functionContexts.length - 1];
  }

  function visitFunction(expression: TypedExpr, nativeAsync: Bool): Void {
    final value = switch expression.expr {
      case TFunction(functionValue): functionValue;
      default:
        CompilerDiagnostic.fail('GENES-NATIVE-ASYNC-PLAN-001: native async carrier must contain one exact function value',
          expression.pos);
    }

    // Default values are evaluated outside the function body contract. A
    // nested marked function still establishes its own async context.
    functionContexts.push(false);
    for (argument in value.args)
      visit(argument.value);
    functionContexts.pop();

    functionContexts.push(nativeAsync);
    visit(value.expr);
    functionContexts.pop();
  }

  function visit(expression: Null<TypedExpr>): Void {
    if (expression == null)
      return;

    final functionMarker = CompilerInternal.nativeAsyncFunctionValueCall(expression);
    if (functionMarker != null) {
      switch functionMarker.value.expr {
        case TFunction(_):
          projections.set(expression, AnonymousFunction(functionMarker.value));
          carrierCount++;
          visitFunction(functionMarker.value, true);
          return;
        default:
          CompilerDiagnostic.fail('GENES-NATIVE-ASYNC-PLAN-001: functionValue must carry one exact anonymous function',
            expression.pos);
      }
    }

    switch expression.expr {
      case TReturn(value):
        if (value == null)
          return;
        final returnMarker = CompilerInternal.nativeAsyncReturnValueCall(value);
        if (returnMarker == null) {
          visit(value);
          return;
        }
        if (!inNativeAsyncFunction())
          CompilerDiagnostic.fail('GENES-NATIVE-ASYNC-PLAN-002: returnValue must be the direct return of its owning native async function',
            value.pos);
        projections.set(value, ReturnPayload(returnMarker.value));
        carrierCount++;
        visit(returnMarker.value);
      case TFunction(_):
        visitFunction(expression, false);
      default:
        if (CompilerInternal.isNativeAsyncMarkerCall(expression))
          CompilerDiagnostic.fail('GENES-NATIVE-ASYNC-PLAN-002: native async marker reached an unsupported function context',
            expression.pos);
        expression.iter(visit);
    }
  }
}
