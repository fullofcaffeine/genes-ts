package genes.react;

#if macro
import haxe.ds.ObjectMap;
import haxe.macro.Context;
import haxe.macro.Expr.Binop;
import haxe.macro.Expr.Unop;
import haxe.macro.Type;
import genes.Module;
import genes.DirectModuleBinding;

using haxe.macro.TypedExprTools;

/** Selects the native binding that replaces one exact lowered State access. */
enum ReactStateProjectedAccess {
  CurrentValue;
  Dispatcher;
}

/** One exact field occurrence authorized by the complete use inventory. */
typedef ReactStateProjectedAccessDecision = {
  final local: TVar;
  final access: ReactStateProjectedAccess;
}

private typedef ReactStateProjectionEntry = {
  final declaration: TypedExpr;
  final local: TVar;
  final initializer: TypedExpr;
  final usesCurrentValue: Bool;
  final usesDispatcher: Bool;
}

private typedef ReactStateProjectionCandidate = {
  final declaration: TypedExpr;
  final local: TVar;
  final initializer: TypedExpr;
}

private typedef PendingReactStateAccess = {
  final localId: Int;
  final decision: ReactStateProjectedAccessDecision;
}

private enum ReactStateUseRole {
  Read;
  CallTarget;
  CallableReplacementDispatcher;
  OpaqueTarget;
  WriteTarget;
}

/**
 * Projects closed compiler-owned React State locals onto native tuple bindings.
 *
 * Why: `genes.react.State` gives Haxe separate `value`, `set`, and `update`
 * operations, but React already returns the corresponding value/dispatcher
 * pair. Keeping an otherwise unobserved State local in generated source adds a
 * wrapper type and tuple indices that a JavaScript or TypeScript author would
 * normally avoid.
 *
 * What: a local is admitted only when its exact type and initializer prove the
 * compiler-owned State/useState boundary and every typed use is the lowered
 * current-value field or a dispatcher call. A whole-State read, alias, cast,
 * write, comparison, dependency, or unknown operation rejects the local.
 *
 * How: one source-order walk registers each declaration before its legal uses,
 * then inventories those uses through nested closures with role context.
 * Decisions use `TVar.id`, exact compiler declarations, and exact expression
 * identity. Both output profiles consume this immutable plan; printers do not
 * infer React meaning from names, positions, or emitted text.
 */
final class ReactStateProjectionPlan {
  final entries: Map<Int, ReactStateProjectionEntry>;
  final accesses: ObjectMap<TypedExpr, ReactStateProjectedAccessDecision>;

  public static function build(module: Module): ReactStateProjectionPlan {
    // TypeScript can downlevel destructuring itself. Classic output can use the
    // projection only when its selected JavaScript syntax level supports it.
    if (!Context.defined('genes.ts') && Context.definedValue('js-es') != '6')
      return new ReactStateProjectionPlan([], new ObjectMap());
    // Dependency planning authenticates exact state bindings before local type
    // collection requests projection. Avoid another complete typed-tree walk
    // for ordinary modules and for state modules with no eligible declaration.
    final initializationPlan = module.plannedReactStateInitializations();
    if (initializationPlan == null || !initializationPlan.hasDecisions())
      return new ReactStateProjectionPlan([], new ObjectMap());
    return new ReactStateProjectionPlanBuilder(initializationPlan)
      .build(module);
  }

  public function new(entries: Map<Int, ReactStateProjectionEntry>,
      accesses: ObjectMap<TypedExpr, ReactStateProjectedAccessDecision>) {
    this.entries = entries;
    this.accesses = accesses;
  }

  /** Whether this exact typed declaration may become a native destructure. */
  public function projectsDeclaration(declaration: TypedExpr, local: TVar,
      initializer: TypedExpr): Bool {
    final entry = entries.get(local.id);
    return entry != null
      && entry.declaration == declaration
      && entry.local == local
      && entry.initializer == initializer;
  }

  /** Whether this exact local receives a separately planned dispatcher name. */
  public function projectsLocal(local: TVar): Bool {
    return entries.exists(local.id);
  }

  /** Whether name planning can encounter a synthetic dispatcher at all. */
  public inline function hasDispatchers(): Bool {
    return entries.keys().hasNext();
  }

  /** Whether the projected declaration needs its current-value binding. */
  public function usesCurrentValue(local: TVar): Bool {
    final entry = entries.get(local.id);
    return entry != null && entry.usesCurrentValue;
  }

  /** Whether the projected declaration needs its dispatcher binding. */
  public function usesDispatcher(local: TVar): Bool {
    final entry = entries.get(local.id);
    return entry != null && entry.usesDispatcher;
  }

  /** Returns the prevalidated replacement for this exact field occurrence. */
  public function accessFor(expression: TypedExpr): Null<ReactStateProjectedAccessDecision> {
    return accesses.get(expression);
  }
}

/** Mutable complete-tree collector discarded after the plan is frozen. */
private final class ReactStateProjectionPlanBuilder {
  final initializationPlan: ReactStateInitializationPlan;
  final candidates: Map<Int, ReactStateProjectionCandidate> = [];
  final rejected: Map<Int, Bool> = [];
  final usedCurrentValues: Map<Int, Bool> = [];
  final usedDispatchers: Map<Int, Bool> = [];
  final pending = new ObjectMap<TypedExpr, PendingReactStateAccess>();

  public function new(initializationPlan: ReactStateInitializationPlan) {
    this.initializationPlan = initializationPlan;
  }

  public function build(module: Module): ReactStateProjectionPlan {
    forEachExpression(module, expression -> visit(expression, Read));

    final entries: Map<Int, ReactStateProjectionEntry> = [];
    for (localId in candidates.keys()) {
      final usesCurrentValue = usedCurrentValues.exists(localId);
      final usesDispatcher = usedDispatchers.exists(localId);
      if (rejected.exists(localId) || (!usesCurrentValue && !usesDispatcher))
        continue;
      final candidate = candidates.get(localId);
      entries.set(localId, {
        declaration: candidate.declaration,
        local: candidate.local,
        initializer: candidate.initializer,
        usesCurrentValue: usesCurrentValue,
        usesDispatcher: usesDispatcher
      });
    }

    final accesses = new ObjectMap<TypedExpr,
      ReactStateProjectedAccessDecision>();
    for (expression in pending.keys()) {
      final access = pending.get(expression);
      if (!rejected.exists(access.localId))
        accesses.set(expression, access.decision);
    }
    return new ReactStateProjectionPlan(entries, accesses);
  }

  static function forEachExpression(module: Module,
      visit: TypedExpr->Void): Void {
    for (member in module.members)
      switch member {
        case MClass(owner, _, fields):
          for (field in fields)
            if (field.expr != null)
              visit(field.expr);
          if (owner.init != null)
            visit(owner.init);
        case MMain(expression):
          visit(expression);
        case MEnum(_, _) | MType(_, _):
      }
  }

  function visit(expression: TypedExpr, role: ReactStateUseRole): Void {
    final access = exactProjectedAccess(expression);
    if (access != null && candidates.exists(access.local.id)) {
      final allowed = switch access.access {
        case CurrentValue: role == Read || role == CallTarget;
        case Dispatcher: role == CallTarget || role == CallableReplacementDispatcher;
      };
      if (allowed) {
        switch access.access {
          case CurrentValue:
            usedCurrentValues.set(access.local.id, true);
          case Dispatcher:
            usedDispatchers.set(access.local.id, true);
        }
        pending.set(expression, {
          localId: access.local.id,
          decision: access
        });
      } else {
        rejected.set(access.local.id, true);
      }
      return;
    }

    switch expression.expr {
      case TLocal(local) if (candidates.exists(local.id)):
        // Any occurrence not consumed as one exact semantic field observes the
        // State value itself, so the existing representation must remain.
        rejected.set(local.id, true);
      case TVar(local, initializer):
        // Typed local declarations precede every legal use of that TVar. Record
        // the candidate before continuing the same source-order walk so the
        // plan does not add a second full module traversal.
        if (initializer != null
          && initializationPlan.forDeclaration(expression, local,
            initializer) != null)
          candidates.set(local.id, {
            declaration: expression,
            local: local,
            initializer: initializer
          });
        if (initializer != null)
          visit(initializer, Read);
      case TCall(callee, arguments) if (isOpaqueTargetSyntax(callee)):
        visit(callee, CallTarget);
        for (argument in arguments)
          visit(argument, OpaqueTarget);
      case TCall(callee, arguments):
        visit(callee, CallTarget);
        for (index in 0...arguments.length) {
          final argumentRole = index == 0
            && isExactCallableReplacement(callee) ? CallableReplacementDispatcher : Read;
          visit(arguments[index], argumentRole);
        }
      case TBinop(OpAssign | OpAssignOp(_), target, value):
        visit(target, WriteTarget);
        visit(value, Read);
      case TUnop(OpIncrement | OpDecrement, _, target):
        visit(target, WriteTarget);
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, null):
        visit(inner, role);
      default:
        expression.iter(child -> visit(child, Read));
    }
  }

  static function exactProjectedAccess(expression: TypedExpr): Null<ReactStateProjectedAccessDecision> {
    return switch expression.expr {
      case TField(receiver, FAnon(fieldRef))
        if (isExactTupleStorage(receiver.t)):
        final local = transparentLocal(receiver);
        if (local == null) {
          null;
        } else {
          switch fieldRef.get().name {
            case 'first': {local: local, access: CurrentValue};
            case 'second': {local: local, access: Dispatcher};
            default: null;
          }
        }
      default:
        null;
    }
  }

  static function transparentLocal(expression: TypedExpr): Null<TVar> {
    return switch expression.expr {
      case TLocal(local): local;
      case TParenthesis(inner) | TMeta(_, inner) | TCast(inner, null):
        transparentLocal(inner);
      default:
        null;
    }
  }

  static function isExactTupleStorage(type: Type): Bool {
    return switch type {
      case TType(reference, _): final owner = reference.get(); // Private typedefs display through `_Tuple2` in type strings, but the
        // compiler declaration keeps its authored module identity.
        owner.module == 'genes.react.Tuple2' && owner.name == 'Tuple2Storage';
      default:
        false;
    }
  }

  /** Recognizes the one helper that safely wraps callable replacements. */
  static function isExactCallableReplacement(expression: TypedExpr): Bool {
    return switch unwrap(expression).expr {
      case TField(_, FStatic(ownerRef, fieldRef)): final owner = ownerRef.get(); owner.module == 'genes.react.StateRuntime' && DirectModuleBinding.isModuleFieldsOwner(owner) && fieldRef.get()
          .name == 'replaceCallable';
      default:
        false;
    }
  }

  /** Treats raw target-language placeholders as unknown reads or writes. */
  static function isOpaqueTargetSyntax(expression: TypedExpr): Bool {
    return switch unwrap(expression).expr {
      case TIdent('__js__'):
        true;
      case TField(_, FStatic(ownerRef, fieldRef)): final owner = ownerRef.get(); owner.module == 'js.Syntax' && owner.name == 'Syntax' && fieldRef.get()
          .name == 'code';
      default:
        false;
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
