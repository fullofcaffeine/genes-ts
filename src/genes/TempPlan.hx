package genes;

#if macro
import haxe.ds.ObjectMap;
import haxe.macro.Expr.Position;
import haxe.macro.Type;

using haxe.macro.TypedExprTools;

/** Classifies a temporary by the compiler layer that requires it. */
enum abstract PlannedTempKind(String) to String {
  /** A local already introduced by Haxe's typed-expression lowering. */
  var HaxeGeneratedLocal = "haxe-generated-local";

  /** A local Genes must introduce because the JS loop reuses its iterator. */
  var ForIterator = "for-iterator";

  /** The result binding inside an IIFE for an expression-valued statement. */
  var ValueResult = "value-result";
}

/**
 * One immutable temporary fact shared by the TS and classic JS printers.
 *
 * Why: a printer-local counter hides whether a temporary is semantically
 * required, makes names depend on formatting order, and lets the two output
 * modes drift. Haxe-generated locals and Genes-generated locals also have
 * different ownership: the former must retain their `TVar` identity, while the
 * latter need an explicit initializer and a stable compiler reason.
 *
 * What: `local` identifies an existing Haxe local when present. `initializer`
 * is populated only for a Genes-created binding. `rule` is stable provenance
 * suitable for diagnostics and future output-quality manifests.
 *
 * How: `TempPlan.build` walks the typed module once, before either printer
 * writes source. Printers may choose TS or JS syntax, but they must consume this
 * fact rather than independently deciding whether to allocate a temporary.
 */
class PlannedTemp {
  public final name: String;
  public final kind: PlannedTempKind;
  public final local: Null<TVar>;
  public final initializer: Null<TypedExpr>;
  public final pos: Position;
  public final rule: String;

  public function new(name: String, kind: PlannedTempKind,
      local: Null<TVar>, initializer: Null<TypedExpr>, pos: Position,
      rule: String) {
    this.name = name;
    this.kind = kind;
    this.local = local;
    this.initializer = initializer;
    this.pos = pos;
    this.rule = rule;
  }
}

/** The already-evaluated iterator binding consumed by a lowered `for` loop. */
enum LoweredForIterator {
  ExistingIterator(local: TVar);
  TemporaryIterator(temp: PlannedTemp);
}

/**
 * Minimal normalized statement shape for a lowered `for` loop.
 *
 * This is intentionally not a universal target AST. Haxe's typed AST remains
 * authoritative for the loop variable and body; only the iterator reuse fact
 * survives as a normalized node because both printers need it.
 */
class LoweredForStatement {
  public final variable: TVar;
  public final iteratorExpression: TypedExpr;
  public final iterator: LoweredForIterator;
  public final body: TypedExpr;
  public final pos: Position;

  public function new(variable: TVar, iteratorExpression: TypedExpr,
      iterator: LoweredForIterator, body: TypedExpr, pos: Position) {
    this.variable = variable;
    this.iteratorExpression = iteratorExpression;
    this.iterator = iterator;
    this.body = body;
    this.pos = pos;
  }
}

/**
 * Minimal normalized expression shape for statement forms used as values.
 *
 * Why: JavaScript needs an expression where Haxe permits blocks, switches, and
 * try/catch forms to produce a value. Genes lowers those forms through an IIFE
 * with one result binding. Allocating that binding in `asValue` made its name
 * depend on recursive printer state.
 *
 * What/How: the original typed expression remains authoritative; this node only
 * records that it needs the shared result-IIFE strategy and the preplanned
 * binding. Each IIFE owns a function scope, so `$r0` is stable and collision-
 * free even when another lowered value is nested inside it.
 */
class LoweredValueExpression {
  public final expression: TypedExpr;
  public final result: PlannedTemp;
  public final pos: Position;

  public function new(expression: TypedExpr, result: PlannedTemp,
      pos: Position) {
    this.expression = expression;
    this.result = result;
    this.pos = pos;
  }
}

/**
 * Immutable temporary and minimal lowering plan for one generated module.
 *
 * Determinism contract:
 *
 * - module members and typed-expression children are visited in source order;
 * - planned iterator names are `$it0`, `$it1`, ... within one output module;
 * - every result IIFE uses `$r0` because each binding has its own function scope;
 * - Haxe `TVar.id` is the identity for existing generated locals;
 * - no target printer may allocate iterator or expression-result temporaries.
 *
 * The plan is target-neutral. TypeScript can add annotations and classic Genes
 * can erase them, while both retain the same evaluation count and order.
 */
class TempPlan {
  public static final FOR_ITERATOR_RULE = "lowering.for-iterator-reuse";
  public static final HAXE_LOCAL_RULE = "typed-ast.haxe-generated-local";
  public static final VALUE_RESULT_RULE = "lowering.expression-result-iife";

  final localTemps: Map<Int, PlannedTemp>;
  final loweredFors: ObjectMap<TypedExpr, LoweredForStatement>;
  final loweredValues: ObjectMap<TypedExpr, LoweredValueExpression>;

  public static function build(module: Module): TempPlan {
    return new TempPlanBuilder().build(module);
  }

  public function new(localTemps: Map<Int, PlannedTemp>,
      loweredFors: ObjectMap<TypedExpr, LoweredForStatement>,
      loweredValues: ObjectMap<TypedExpr, LoweredValueExpression>) {
    this.localTemps = localTemps;
    this.loweredFors = loweredFors;
    this.loweredValues = loweredValues;
  }

  /** Returns the Haxe-generated classification for a local, if any. */
  public function tempForLocal(local: TVar): Null<PlannedTemp> {
    return localTemps.get(local.id);
  }

  /**
   * Returns the prevalidated lowering for one typed `TFor` expression.
   *
   * A missing entry means a new AST path bypassed planning. Fail at the source
   * expression instead of silently returning to printer-order allocation.
   */
  public function loweredFor(expression: TypedExpr): LoweredForStatement {
    final lowered = loweredFors.get(expression);
    if (lowered != null)
      return lowered;
    return CompilerDiagnostic.fail(
      '[GTS-TEMP-PLAN-001] A typed for-loop reached emission '
      + 'without a shared TempPlan entry.', expression.pos);
  }

  /** Returns the preplanned IIFE result binding for a statement used as a value. */
  public function loweredValue(expression: TypedExpr): LoweredValueExpression {
    final lowered = loweredValues.get(expression);
    if (lowered != null)
      return lowered;
    return CompilerDiagnostic.fail(
      '[GTS-TEMP-PLAN-003] An expression-valued statement reached emission '
      + 'without a shared TempPlan entry.', expression.pos);
  }
}

/**
 * Deterministically extracts the small lowering facts owned by `TempPlan`.
 *
 * Why: Haxe's typed tree already contains almost every evaluation-order
 * temporary, so a general-purpose rewriter would duplicate authoritative
 * compiler work. Genes only needs to identify those locals and add the two
 * JavaScript shapes it owns: reusable iterators and result-producing IIFEs.
 *
 * What/How: one source-ordered walk classifies existing `_gN` locals, attaches
 * normalized records to every `TFor`, and records every statement form that
 * may require expression-value lowering. The builder is discarded before
 * printing; only immutable maps survive.
 */
private class TempPlanBuilder {
  final localTemps: Map<Int, PlannedTemp> = [];
  final loweredFors = new ObjectMap<TypedExpr, LoweredForStatement>();
  final loweredValues = new ObjectMap<TypedExpr, LoweredValueExpression>();
  var iteratorCounter = 0;

  public function new() {}

  public function build(module: Module): TempPlan {
    for (member in module.members) {
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
    }
    return new TempPlan(localTemps, loweredFors, loweredValues);
  }

  /** Visits each typed node once and records facts before visiting its children. */
  function visit(expression: TypedExpr): Void {
    if (requiresValueResult(expression)) {
      final result = new PlannedTemp("$r0", ValueResult, null, null,
        expression.pos, TempPlan.VALUE_RESULT_RULE);
      loweredValues.set(expression,
        new LoweredValueExpression(expression, result, expression.pos));
    }
    switch expression.expr {
      case TVar(local, initializer):
        classifyLocal(local, expression.pos);
        if (initializer != null)
          visit(initializer);
      case TFunction(func):
        for (argument in func.args)
          classifyLocal(argument.v, expression.pos);
        visit(func.expr);
      case TFor(variable, iteratorExpression, body):
        visit(iteratorExpression);
        classifyLocal(variable, expression.pos);
        final iterator = switch iteratorExpression.expr {
          case TLocal(local):
            ExistingIterator(local);
          default:
            final tempName = "$it" + iteratorCounter;
            iteratorCounter++;
            final temp = new PlannedTemp(tempName,
              ForIterator, null, iteratorExpression, iteratorExpression.pos,
              TempPlan.FOR_ITERATOR_RULE);
            TemporaryIterator(temp);
        };
        loweredFors.set(expression,
          new LoweredForStatement(variable, iteratorExpression, iterator, body,
            expression.pos));
        visit(body);
      case TTry(body, catches):
        visit(body);
        for (entry in catches) {
          classifyLocal(entry.v, entry.expr.pos);
          visit(entry.expr);
        }
      default:
        expression.iter(visit);
    }
  }

  function classifyLocal(local: TVar, pos: Position): Void {
    if (localTemps.exists(local.id) || !isHaxeGeneratedTemp(local.name))
      return;
    localTemps.set(local.id, new PlannedTemp(local.name, HaxeGeneratedLocal,
      local, null, pos, TempPlan.HAXE_LOCAL_RULE));
  }

  static function isHaxeGeneratedTemp(name: String): Bool {
    if (name == "_g")
      return true;
    if (!StringTools.startsWith(name, "_g") || name.length == 2)
      return false;
    for (index in 2...name.length) {
      final code = name.charCodeAt(index);
      if (code < "0".code || code > "9".code)
        return false;
    }
    return true;
  }

  /** Mirrors the bounded statement-as-value shapes supported by `emitValue`. */
  static function requiresValueResult(expression: TypedExpr): Bool {
    return switch expression.expr {
      case TVar(_) | TFor(_) | TWhile(_) | TThrow(_) | TSwitch(_) | TTry(_):
        true;
      case TBlock(elements):
        elements.length > 1;
      default:
        false;
    }
  }
}
#end
