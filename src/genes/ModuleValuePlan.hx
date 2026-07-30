package genes;

#if macro
import haxe.macro.Expr.MetadataEntry;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
import genes.Module.Field;
import genes.ModuleFunctionPlan.ModuleBindingFact;
import genes.util.TypeUtil;

using haxe.macro.TypedExprTools;

/** One validated top-level Haxe value emitted as a direct ESM `const`. */
class ModuleValueEntry {
  public final owner: ClassType;
  public final field: Field;
  public final requestedName: String;
  public final requestedPos: Position;

  public function new(owner: ClassType, field: Field, requestedName: String,
      requestedPos: Position) {
    this.owner = owner;
    this.field = field;
    this.requestedName = requestedName;
    this.requestedPos = requestedPos;
  }
}

/**
 * One exact Haxe function body that can occupy a callable local.
 *
 * The body object is compiler-owned identity; its emitted name is irrelevant.
 * Parameters are retained so an immediately invoked helper can connect a
 * callback argument to the exact `TVar` read inside that helper. Multiple
 * targets are possible after a branch or loop and must all remain visible to
 * the forward-read validator.
 */
private typedef ModuleValueCallableTarget = {
  final body: TypedExpr;
  final parameters: Array<TVar>;
}

/**
 * Validates opt-in direct lowering for genuine Haxe module-level values.
 *
 * `@:genes.moduleValue("name")` is deliberately framework-neutral. It turns
 * one retained, public, immutable top-level Haxe value into the corresponding
 * `export const name` in TypeScript and classic JavaScript. Typed references
 * in the same or another Haxe module resolve to that exact ESM binding.
 *
 * The initial contract accepts only Haxe's synthetic `KModuleFields` owner and
 * requires every retained field on that owner to be a selected module function
 * or module value. That narrow rule lets Genes remove the owner completely,
 * preserves initializer order, and avoids inventing reflection semantics for a
 * compiler-only class. Metadata is inspected after Haxe DCE and never roots a
 * value by itself.
 */
class ModuleValuePlan {
  public static final METADATA = ':genes.moduleValue';

  final entries: Array<ModuleValueEntry>;

  public static function requestedName(field: ClassField): Null<String> {
    return requestedNameFromMetadata(field.meta);
  }

  public static function requestedNameFromMetadata(meta: MetaAccess): Null<String> {
    final entries = meta.extract(METADATA);
    return switch entries {
      case [{params: [{expr: EConst(CString(value))}]}]
        if (value.length > 0 && IdentifierPolicy.isValidModuleBinding(value)):
        value;
      default:
        null;
    }
  }

  public static function build(module: Module): ModuleValuePlan {
    final bindings = ModuleFunctionPlan.bindingInventory(module);
    // Functions and values share one lexical ESM namespace even though their
    // complete shape validation belongs to separate focused plans.
    for (member in module.members) {
      switch member {
        case MClass(owner, _, fields):
          for (field in Module.emittableFields(fields)) {
            if (field.meta == null)
              continue;
            final requested = ModuleFunctionPlan.requestedNameFromMetadata(field.meta);
            if (requested != null)
              bindings.push({
                name: requested,
                kind: 'direct module function ${owner.name}.${field.name}',
                pos: field.pos
              });
          }
        case MEnum(_, _) | MType(_, _) | MMain(_):
      }
    }

    final result: Array<ModuleValueEntry> = [];
    for (member in module.members) {
      switch member {
        case MClass(owner, _, fields):
          for (field in Module.emittableFields(fields)) {
            final metadata = field.meta == null ? [] : field.meta.extract(METADATA);
            if (metadata.length == 0)
              continue;
            final entry = parseAndValidate(owner, field, fields, metadata,
              bindings, module);
            result.push(entry);
            bindings.push({
              name: entry.requestedName,
              kind: 'direct module value ${owner.name}.${field.name}',
              pos: entry.requestedPos
            });
          }
        case MEnum(_, _) | MType(_, _) | MMain(_):
      }
    }
    return new ModuleValuePlan(result);
  }

  public function new(entries: Array<ModuleValueEntry>) {
    this.entries = entries.copy();
  }

  public function entriesFor(owner: ClassType): Array<ModuleValueEntry> {
    return entries.filter(entry -> sameOwner(entry.owner, owner));
  }

  public function entryFor(owner: ClassType,
      field: Field): Null<ModuleValueEntry> {
    for (entry in entries)
      if (sameOwner(entry.owner, owner) && entry.field == field)
        return entry;
    return null;
  }

  public function publicEntries(): Array<ModuleValueEntry> {
    return entries.copy();
  }

  static function parseAndValidate(owner: ClassType, field: Field,
      ownerFields: Array<Field>, metadata: Array<MetadataEntry>,
      bindings: Array<ModuleBindingFact>, module: Module): ModuleValueEntry {
    final first = metadata[0];
    if (metadata.length != 1 || first.params.length != 1) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-ARITY-001: @:genes.moduleValue on '
        + '${owner.name}.${field.name} must appear once with exactly one '
        + 'string-literal binding name',
        first.pos);
    }
    final parameter = first.params[0];
    final requestedName = switch parameter.expr {
      case EConst(CString(value)): value;
      default:
        return
          CompilerDiagnostic.fail('GENES-MODULE-VALUE-LITERAL-002: @:genes.moduleValue on '
          + '${owner.name}.${field.name} requires a direct string literal; '
          + 'computed binding names are not supported',
          parameter.pos);
    };
    if (requestedName.length == 0) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-EMPTY-003: @:genes.moduleValue on '
        + '${owner.name}.${field.name} requires a non-empty binding name',
        parameter.pos);
    }
    if (!IdentifierPolicy.isValidModuleBinding(requestedName)) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-IDENTIFIER-004: "${requestedName}" requested '
        + 'by ${owner.name}.${field.name} is not a valid non-reserved ASCII '
        + 'ES-module binding; use [A-Za-z_$][A-Za-z0-9_$]*',
        parameter.pos);
    }
    if (field.meta.has(DirectModuleBinding.FUNCTION_METADATA)) {
      return
        CompilerDiagnostic.fail('GENES-DIRECT-MODULE-BINDING-CONFLICT-001: '
        + '${owner.name}.${field.name} cannot be both '
        + '@:genes.moduleValue and @:genes.moduleFunction',
        first.pos);
    }
    if (!DirectModuleBinding.isModuleFieldsOwner(owner)) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-OWNER-006: "${requestedName}" requires '
        + 'a genuine Haxe module-level value; class static fields keep their '
        + 'class identity',
        owner.pos);
    }
    if (!field.isPublic || !field.isStatic || !field.kind.equals(Property)) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-SHAPE-007: "${requestedName}" requires '
        + 'a public static module-level value; ${owner.name}.${field.name} is '
        + fieldShape(field),
        field.pos);
    }
    if (field.expr == null) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-INITIALIZER-008: ${owner.name}.${field.name} '
        + 'has no retained initializer to emit as "${requestedName}"',
        field.pos);
    }
    if (!isFinal(owner, field)) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-MUTABLE-009: ${owner.name}.${field.name} '
        + 'is mutable; direct ESM values require a top-level `final` so Haxe '
        + 'and native consumers observe the same immutable binding',
        field.pos);
    }
    final nativeName = TypeUtil.nativeName(field.meta);
    if (nativeName != null && nativeName != requestedName) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-NATIVE-NAME-011: ${owner.name}.${field.name} '
        + 'has @:native("${nativeName}") but @:genes.moduleValue requests '
        + '"${requestedName}"; direct module values require one exact name',
        field.pos);
    }
    if (requestedName != field.name) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-PUBLIC-NAME-010: public module value '
        + '${owner.name}.${field.name} exports as "${field.name}", but '
        + '@:genes.moduleValue requests "${requestedName}"; use the exact '
        + 'Haxe field name',
        parameter.pos);
    }
    for (binding in bindings) {
      if (binding.name == requestedName) {
        return
          CompilerDiagnostic.fail('GENES-MODULE-VALUE-COLLISION-012: "${requestedName}" requested '
          + 'by ${owner.name}.${field.name} collides with an existing '
          + '${binding.kind}; choose another source field name',
          parameter.pos);
      }
    }
    final retained = Module.emittableFields(ownerFields);
    final ordinary = retained.filter(candidate -> candidate.meta == null
      || DirectModuleBinding.requestedNameFromMetadata(candidate.meta) == null);
    if (ordinary.length > 0) {
      final firstOrdinary = ordinary[0];
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-MIXED-OWNER-013: ${owner.name}.${field.name} '
        + 'cannot lower directly while the same Haxe module-fields owner keeps '
        + 'ordinary field "${firstOrdinary.name}"; mark every retained '
        + 'top-level function/value for direct lowering or move the ordinary '
        + 'field to another module',
        firstOrdinary.pos);
    }
    validateNoForwardValueReads(owner, field, retained, module);
    if (module.isCyclic(module.module)) {
      return
        CompilerDiagnostic.fail('GENES-MODULE-VALUE-CYCLE-014: ${owner.name}.${field.name} '
        + 'belongs to a cyclic module; v1 keeps cyclic static initialization '
        + 'on the existing deferred owner path',
        field.pos);
    }
    return new ModuleValueEntry(owner, field, requestedName, parameter.pos);
  }

  /**
   * Rejects initializer-time reads of a later direct value on the same owner.
   *
   * Why: Haxe's synthetic owner can preserve deferred static initialization,
   * while direct ESM `const` declarations enter the temporal dead zone until
   * their declaration executes. Emitting `const first = second` before
   * `second` would therefore turn a valid typed program into a native runtime
   * failure (and a TypeScript use-before-declaration error).
   *
   * What/How: compare exact same-owner static field identities in retained
   * source order. A function body is ignored while it is merely stored,
   * because creating a closure does not read its captures. When the initializer
   * immediately calls an exact local closure, same-generated-module method, or
   * constructor, that body is scanned because it runs before the following ESM
   * declaration. Callable locals carry every body that can reach them through
   * structured branches and loops; lexical visitation order is never treated
   * as control-flow proof. Unknown external/dynamic call targets stay outside
   * this bounded proof; Genes does not attempt general alias or effect analysis
   * here.
   */
  static function validateNoForwardValueReads(owner: ClassType, field: Field,
      retained: Array<Field>, module: Module): Void {
    final sourceIndex = retained.indexOf(field);
    if (sourceIndex < 0 || field.expr == null)
      return;
    final localFunctions = new Map<Int, Array<ModuleValueCallableTarget>>();
    final activeFunctionBodies = new haxe.ds.ObjectMap<TypedExpr, Bool>();

    function retainedIndex(name: String): Int {
      for (index in 0...retained.length)
        if (retained[index].name == name)
          return index;
      return -1;
    }

    function copyTargets(source: Array<ModuleValueCallableTarget>): Array<ModuleValueCallableTarget> {
      return source.copy();
    }

    function addTarget(targets: Array<ModuleValueCallableTarget>,
        target: ModuleValueCallableTarget): Void {
      for (existing in targets)
        if (existing.body == target.body)
          return;
      targets.push(target);
    }

    function copyLocalFunctions(source: Map<Int,
      Array<ModuleValueCallableTarget>>): Map<Int,
        Array<ModuleValueCallableTarget>> {
      final result = new Map<Int, Array<ModuleValueCallableTarget>>();
      for (id => targets in source)
        result.set(id, copyTargets(targets));
      return result;
    }

    function mergeLocalFunctions(states: Array<Map<Int,
      Array<ModuleValueCallableTarget>>>): Map<Int,
        Array<ModuleValueCallableTarget>> {
      final result = new Map<Int, Array<ModuleValueCallableTarget>>();
      for (state in states) {
        for (id => targets in state) {
          var merged = result.get(id);
          if (merged == null) {
            merged = [];
            result.set(id, merged);
          }
          for (target in targets)
            addTarget(merged, target);
        }
      }
      return result;
    }

    function replaceLocalFunctions(target: Map<Int,
      Array<ModuleValueCallableTarget>>,
        source: Map<Int, Array<ModuleValueCallableTarget>>): Void {
      final existingIds = [for (id => _ in target) id];
      for (id in existingIds)
        target.remove(id);
      for (id => targets in source)
        target.set(id, copyTargets(targets));
    }

    function sameLocalFunctions(left: Map<Int,
      Array<ModuleValueCallableTarget>>,
        right: Map<Int, Array<ModuleValueCallableTarget>>): Bool {
      for (id => leftTargets in left) {
        final rightTargets = right.get(id);
        if (rightTargets == null || leftTargets.length != rightTargets.length)
          return false;
        for (leftTarget in leftTargets) {
          var found = false;
          for (rightTarget in rightTargets)
            if (leftTarget.body == rightTarget.body) {
              found = true;
              break;
            }
          if (!found)
            return false;
        }
      }
      for (id => _ in right)
        if (!left.exists(id))
          return false;
      return true;
    }

    function functionTarget(expression: TypedExpr): Null<ModuleValueCallableTarget> {
      return switch unwrap(expression).expr {
        case TFunction(func):
          {
            body: func.expr,
            parameters: [for (argument in func.args) argument.v]
          };
        default:
          null;
      }
    }

    function callableTargets(expression: TypedExpr,
        locals: Map<Int,
        Array<ModuleValueCallableTarget>>): Array<ModuleValueCallableTarget> {
      return switch unwrap(expression).expr {
        case TFunction(func):
          [
            {
              body: func.expr,
              parameters: [for (argument in func.args) argument.v]
            }
          ];
        case TLocal(variable):
          final targets = locals.get(variable.id);
          targets == null ? [] : copyTargets(targets);
        case TField(_, FStatic(ownerRef, fieldRef)):
          final targetOwner = ownerRef.get();
          final targetField = fieldRef.get();
          if (targetOwner.module == module.module) {
            final targetExpression = targetField.expr();
            if (targetExpression == null)
              [];
            else {
              final target = functionTarget(targetExpression);
              target == null ? [] : [target];
            }
          } else [];
        case TField(_, FInstance(ownerRef, _, fieldRef)):
          final targetOwner = ownerRef.get();
          final targetField = fieldRef.get();
          if (targetOwner.module == module.module) {
            final targetExpression = targetField.expr();
            if (targetExpression == null)
              [];
            else {
              final target = functionTarget(targetExpression);
              target == null ? [] : [target];
            }
          } else [];
        case TIf(_, thenExpression, elseExpression):
          final result: Array<ModuleValueCallableTarget> = [];
          for (target in callableTargets(thenExpression, locals))
            addTarget(result, target);
          if (elseExpression != null)
            for (target in callableTargets(elseExpression, locals))
              addTarget(result, target);
          result;
        case TSwitch(_, cases, defaultExpression):
          final result: Array<ModuleValueCallableTarget> = [];
          for (caseEntry in cases)
            for (target in callableTargets(caseEntry.expr, locals))
              addTarget(result, target);
          if (defaultExpression != null)
            for (target in callableTargets(defaultExpression, locals))
              addTarget(result, target);
          result;
        case TBlock(elements) if (elements.length > 0):
          callableTargets(elements[elements.length - 1], locals);
        case TBinop(OpAssign, _, right):
          callableTargets(right, locals);
        default:
          [];
      }
    }

    /**
     * Returns callback argument slots invoked synchronously by one reviewed
     * compiler-library raw template.
     *
     * Haxe inlines `genes.js.ArrayCallbacks.findIndex` to the exact
     * `values.findIndex(callback)` template before this plan runs. JavaScript
     * may call that callback while the current module initializer is still
     * executing, so a stored function argument must be scanned as an immediate
     * call target. The template and arity are integrity checks for this
     * synchronous behavior; no type or assertion authority comes from them.
     */
    function synchronousRawCallbackSlots(callee: TypedExpr,
        arguments: Array<TypedExpr>): Array<Int> {
      return switch unwrap(callee).expr {
        case TField(_, FStatic(ownerRef, fieldRef))
          if (ownerRef.get().module == 'js.Syntax'
            && fieldRef.get().name == 'code' && arguments.length == 3):
          switch arguments[0].expr {
            case TConst(TString(template))
              if (template == '{0}.findIndex({1})'):
              [2];
            default:
              [];
          }
        default:
          [];
      }
    }

    function recordObserved(observed: Null<Map<Int,
      Array<ModuleValueCallableTarget>>>, id: Int,
        targets: Array<ModuleValueCallableTarget>): Void {
      if (observed == null || targets.length == 0)
        return;
      var existing = observed.get(id);
      if (existing == null) {
        existing = [];
        observed.set(id, existing);
      }
      for (target in targets)
        addTarget(existing, target);
    }

    function assignLocal(locals: Map<Int, Array<ModuleValueCallableTarget>>,
        observed: Null<Map<Int, Array<ModuleValueCallableTarget>>>, id: Int,
        targets: Array<ModuleValueCallableTarget>): Void {
      if (targets.length == 0)
        locals.remove(id);
      else
        locals.set(id, copyTargets(targets));
      recordObserved(observed, id, targets);
    }

    function visit(expression: TypedExpr,
        locals: Map<Int, Array<ModuleValueCallableTarget>>,
        ?observed: Map<Int, Array<ModuleValueCallableTarget>>): Void {
      switch expression.expr {
        case TFunction(_):
          return;
        case TBlock(elements):
          for (element in elements)
            visit(element, locals, observed);
          return;
        case TVar(variable, initializer):
          if (initializer != null) {
            visit(initializer, locals, observed);
            assignLocal(locals, observed, variable.id,
              callableTargets(initializer, locals));
          }
          return;
        case TIf(condition, thenExpression, elseExpression):
          visit(condition, locals, observed);
          final branchEntry = copyLocalFunctions(locals);
          final thenState = copyLocalFunctions(branchEntry);
          visit(thenExpression, thenState, observed);
          final elseState = copyLocalFunctions(branchEntry);
          if (elseExpression != null)
            visit(elseExpression, elseState, observed);
          replaceLocalFunctions(locals,
            mergeLocalFunctions([thenState, elseState]));
          return;
        case TSwitch(subject, cases, defaultExpression):
          visit(subject, locals, observed);
          final branchEntry = copyLocalFunctions(locals);
          final exits: Array<Map<Int, Array<ModuleValueCallableTarget>>> = [];
          for (caseEntry in cases) {
            final caseState = copyLocalFunctions(branchEntry);
            for (value in caseEntry.values)
              visit(value, caseState, observed);
            visit(caseEntry.expr, caseState, observed);
            exits.push(caseState);
          }
          if (defaultExpression == null) {
            exits.push(branchEntry);
          } else {
            final defaultState = copyLocalFunctions(branchEntry);
            visit(defaultExpression, defaultState, observed);
            exits.push(defaultState);
          }
          replaceLocalFunctions(locals, mergeLocalFunctions(exits));
          return;
        case TTry(body, catches):
          final tryEntry = copyLocalFunctions(locals);
          final tryObserved = copyLocalFunctions(tryEntry);
          final tryExit = copyLocalFunctions(tryEntry);
          visit(body, tryExit, tryObserved);
          final catchEntry = mergeLocalFunctions([tryEntry, tryExit, tryObserved]);
          final exits = [tryExit];
          for (entry in catches) {
            final catchState = copyLocalFunctions(catchEntry);
            visit(entry.expr, catchState, observed);
            exits.push(catchState);
          }
          replaceLocalFunctions(locals, mergeLocalFunctions(exits));
          return;
        case TWhile(condition, body, normalWhile):
          final loopEntry = copyLocalFunctions(locals);
          final loopObserved = copyLocalFunctions(loopEntry);
          var header = copyLocalFunctions(loopEntry);
          var exit = copyLocalFunctions(loopEntry);
          var converged = false;
          while (!converged) {
            final iteration = copyLocalFunctions(header);
            if (normalWhile) {
              visit(condition, iteration, loopObserved);
              exit = copyLocalFunctions(iteration);
              visit(body, iteration, loopObserved);
            } else {
              visit(body, iteration, loopObserved);
              visit(condition, iteration, loopObserved);
              exit = copyLocalFunctions(iteration);
            }
            final nextHeader = mergeLocalFunctions([loopEntry, iteration, loopObserved]);
            converged = sameLocalFunctions(header, nextHeader);
            header = nextHeader;
          }
          replaceLocalFunctions(locals,
            mergeLocalFunctions([exit, loopObserved]));
          return;
        case TFor(_, iteratorExpression, body):
          visit(iteratorExpression, locals, observed);
          final loopEntry = copyLocalFunctions(locals);
          final loopObserved = copyLocalFunctions(loopEntry);
          var header = copyLocalFunctions(loopEntry);
          var converged = false;
          while (!converged) {
            final iteration = copyLocalFunctions(header);
            visit(body, iteration, loopObserved);
            final nextHeader = mergeLocalFunctions([loopEntry, iteration, loopObserved]);
            converged = sameLocalFunctions(header, nextHeader);
            header = nextHeader;
          }
          replaceLocalFunctions(locals, header);
          return;
        case TBinop(op = OpBoolAnd | OpBoolOr, left, right):
          visit(left, locals, observed);
          final skipped = copyLocalFunctions(locals);
          final evaluated = copyLocalFunctions(locals);
          visit(right, evaluated, observed);
          replaceLocalFunctions(locals,
            mergeLocalFunctions([skipped, evaluated]));
          return;
        case TBinop(OpAssign, left, right):
          // A callback local can change after its declaration. Update the
          // exact TVar-owned body only after evaluating the assignment's
          // right-hand side, matching JavaScript evaluation order. Removing a
          // non-callable replacement is equally important: a later call must
          // not inspect a stale closure that no longer occupies the local.
          visit(left, locals, observed);
          visit(right, locals, observed);
          switch unwrap(left).expr {
            case TLocal(variable):
              assignLocal(locals, observed, variable.id,
                callableTargets(right, locals));
            default:
          }
          return;
        case TCall(callee, arguments):
          visit(callee, locals, observed);
          final targets = callableTargets(callee, locals);
          final argumentTargets: Array<Array<ModuleValueCallableTarget>> = [];
          for (argument in arguments) {
            visit(argument, locals, observed);
            // JavaScript saves this argument's result after evaluating its own
            // effects, but before it starts the next argument. A block can
            // assign a new closure and then return that local, so asking before
            // visit() would capture the stale pre-block value.
            argumentTargets.push(callableTargets(argument, locals));
          }
          switch unwrap(callee).expr {
            case TField(_, FInstance(ownerRef, _, fieldRef)):
              final targetOwner = ownerRef.get();
              final targetField = fieldRef.get();
              if (targetOwner.module == module.module
                && !targetOwner.isFinal && !targetField.isFinal) {
                CompilerDiagnostic.fail('GENES-MODULE-VALUE-VIRTUAL-CALL-017: '
                  + '${owner.name}.${field.name} calls overridable same-module '
                  + 'method ${targetOwner.name}.${targetField.name} during '
                  + 'initialization; make the class or method final, defer the '
                  + 'call until after module initialization, or keep the '
                  + 'synthetic owner',
                  callee.pos);
              }
            default:
          }
          if (targets.length > 0) {
            final callEntry = copyLocalFunctions(locals);
            final exits: Array<Map<Int, Array<ModuleValueCallableTarget>>> = [];
            for (target in targets) {
              if (activeFunctionBodies.exists(target.body))
                continue;
              final callState = copyLocalFunctions(callEntry);
              for (index in 0...target.parameters.length) {
                final parameter = target.parameters[index];
                final parameterTargets = index < argumentTargets.length ? argumentTargets[index] : [];
                assignLocal(callState, observed, parameter.id,
                  parameterTargets);
              }
              activeFunctionBodies.set(target.body, true);
              visit(target.body, callState, observed);
              activeFunctionBodies.remove(target.body);
              exits.push(callState);
            }
            if (exits.length > 0)
              replaceLocalFunctions(locals, mergeLocalFunctions(exits));
          }
          final synchronousTargets: Array<ModuleValueCallableTarget> = [];
          for (slot in synchronousRawCallbackSlots(callee, arguments)) {
            if (slot < 0 || slot >= argumentTargets.length)
              continue;
            for (target in argumentTargets[slot])
              addTarget(synchronousTargets, target);
          }
          if (synchronousTargets.length > 0) {
            // Native findIndex can invoke its callback zero, one, or many
            // times. Iterate until the finite callable-local state stabilizes:
            // one callback run may install a closure that a later run calls.
            final callbackEntry = copyLocalFunctions(locals);
            final callbackObserved = copyLocalFunctions(callbackEntry);
            var header = copyLocalFunctions(callbackEntry);
            var converged = false;
            while (!converged) {
              final callbackExits: Array<Map<Int,
                Array<ModuleValueCallableTarget>>> = [];
              for (target in synchronousTargets) {
                if (activeFunctionBodies.exists(target.body))
                  continue;
                final callbackState = copyLocalFunctions(header);
                activeFunctionBodies.set(target.body, true);
                visit(target.body, callbackState, callbackObserved);
                activeFunctionBodies.remove(target.body);
                callbackExits.push(callbackState);
              }
              final candidates = [callbackEntry, callbackObserved];
              for (exit in callbackExits)
                candidates.push(exit);
              final nextHeader = mergeLocalFunctions(candidates);
              converged = sameLocalFunctions(header, nextHeader);
              header = nextHeader;
            }
            replaceLocalFunctions(locals, header);
          }
          return;
        case TNew(classRef, _, arguments):
          final argumentTargets: Array<Array<ModuleValueCallableTarget>> = [];
          for (argument in arguments) {
            visit(argument, locals, observed);
            argumentTargets.push(callableTargets(argument, locals));
          }
          final targetOwner = classRef.get();
          if (targetOwner.module == module.module
            && targetOwner.constructor != null) {
            final constructorExpression = targetOwner.constructor.get().expr();
            if (constructorExpression != null) {
              final target = functionTarget(constructorExpression);
              if (target != null && !activeFunctionBodies.exists(target.body)) {
                final callState = copyLocalFunctions(locals);
                for (index in 0...target.parameters.length) {
                  final parameter = target.parameters[index];
                  final parameterTargets = index < argumentTargets.length ? argumentTargets[index] : [];
                  assignLocal(callState, observed, parameter.id,
                    parameterTargets);
                }
                activeFunctionBodies.set(target.body, true);
                visit(target.body, callState, observed);
                activeFunctionBodies.remove(target.body);
                replaceLocalFunctions(locals, callState);
              }
            }
          }
          return;
        case TField(_, FStatic(ownerRef, fieldRef)):
          final targetOwner = ownerRef.get();
          final targetField = fieldRef.get();
          final targetIndex = retainedIndex(targetField.name);
          if (sameOwner(owner, targetOwner)
            && ModuleValuePlan.requestedName(targetField) != null
            && targetIndex > sourceIndex) {
            CompilerDiagnostic.fail('GENES-MODULE-VALUE-FORWARD-015: ${owner.name}.${field.name} '
              + 'reads later direct module value "${targetField.name}" during '
              + 'initialization; reorder the values, defer the read until '
              + 'after module initialization, or keep the synthetic owner',
              expression.pos);
          }
        default:
      }
      expression.iter(child -> visit(child, locals, observed));
    }

    visit(field.expr, localFunctions);
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

  static function isFinal(owner: ClassType, field: Field): Bool {
    for (candidate in owner.statics.get()) {
      if (candidate.name != field.name)
        continue;
      return switch candidate.kind {
        case FVar(_, AccNever): true;
        default: false;
      }
    }
    return false;
  }

  static function fieldShape(field: Field): String {
    if (!field.isPublic)
      return 'non-public';
    if (!field.isStatic)
      return 'an instance member';
    return Std.string(field.kind);
  }

  static inline function sameOwner(left: ClassType, right: ClassType): Bool {
    return left.module == right.module && left.name == right.name;
  }
}
#end
