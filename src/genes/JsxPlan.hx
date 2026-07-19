package genes;

import haxe.macro.Context;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
import genes.BindingIdentity.CompilerCapabilityId;

using haxe.macro.TypedExprTools;

/** The output capability selected for target-neutral JSX intent. */
enum abstract JsxEmissionProfile(String) to String {
  /** TypeScript source keeps JSX syntax and uses the automatic JSX runtime. */
  var TsxAutomatic = "tsx-automatic";

  /** TypeScript source keeps JSX syntax and expects `React.createElement`. */
  var TsxClassic = "tsx-classic";

  /** JavaScript source keeps JSX syntax with all Haxe types erased. */
  var JavaScriptJsxAutomatic = "jsx-automatic";

  /** Plain TypeScript source lowers intent directly to `createElement`. */
  var TypeScriptCreateElement = "typescript-create-element";

  /** Classic Genes JavaScript lowers intent directly to `createElement`. */
  var ClassicCreateElement = "classic-create-element";
}

/** Target-neutral identity of a JSX tag. */
enum JsxTagIntent {
  /** A compile-time intrinsic such as `div` or `my-element`. */
  IntrinsicTag(name: String, expression: TypedExpr);

  /** A runtime string whose intrinsic tag is selected dynamically. */
  DynamicIntrinsicTag(expression: TypedExpr);

  /** A component value such as an imported `Button` function. */
  ComponentTag(expression: TypedExpr);
}

/** Target-neutral JSX property semantics, before target spelling is chosen. */
enum JsxPropIntent {
  NamedProp(name: String, value: TypedExpr, source: JsxValueSource);
  SpreadProp(expression: TypedExpr, source: JsxValueSource);
}

/** One child plus the runtime location from which its value must be read. */
enum JsxChildIntent {
  ChildIntent(expression: TypedExpr, source: JsxValueSource);
}

/**
 * Separates semantic marker meaning from evaluation provenance.
 *
 * `DirectValue` means the semantic expression has not already been evaluated.
 * `RuntimeValuePath` means Haxe lifted marker data into a local; printers must
 * read that local path instead of inlining the initializer and duplicating its
 * side effects. Paths are target-neutral and preserve array/field order.
 */
enum JsxValueSource {
  DirectValue;
  RuntimeValuePath(root: TypedExpr, path: Array<JsxValueAccess>);
}

/** One target-neutral access segment within an already-evaluated marker value. */
enum JsxValueAccess {
  JsxObjectField(name: String);
}

/**
 * One validated JSX expression recovered from the typed Haxe marker protocol.
 *
 * The arrays retain Haxe evaluation order. Emitters may choose TSX syntax or a
 * runtime call, but they must not reinterpret tag, property, or child meaning.
 */
enum JsxIntent {
  ElementIntent(tag: JsxTagIntent, props: Array<JsxPropIntent>,
    children: Array<JsxChildIntent>, pos: Position);
  FragmentIntent(children: Array<JsxChildIntent>, pos: Position);
}

/**
 * Explicit capability contract for emitting a `JsxPlan`.
 *
 * Why: JSX used to be recognized only while the TypeScript printer was already
 * writing source. Classic Genes therefore emitted opaque marker calls with no
 * runtime implementation, and unsupported configurations could leave a partial
 * output tree.
 *
 * What: the policy selects one named output profile and, when direct runtime
 * calls are required, one React-compatible namespace module. The default is
 * `react`; `-D genes.react.jsx_runtime_module=none` deliberately disables that
 * capability, while another module specifier opts into a compatible factory.
 *
 * How: `Generator` validates every reachable module before opening output
 * writers. `DependencyPlanBuilder` records the namespace import as a runtime
 * edge, and emitters resolve the collision-safe binding from `Dependencies`.
 * TSX automatic output needs no namespace unless it contains a dynamic string
 * tag; TSX classic and both createElement profiles always need one.
 */
class JsxCapabilityPolicy {
  public static final RUNTIME_IMPORT_RULE = "runtime.jsx-factory";
  public static final DEFAULT_RUNTIME_MODULE = "react";
  public static final INTERNAL_RUNTIME_BINDING = "React__genes_jsx";
  public static final CLASSIC_TSX_BINDING = "React";

  public final profile: JsxEmissionProfile;
  public final runtimeModule: Null<String>;
  public final runtimeBindingName: String;

  public static function current(): JsxCapabilityPolicy {
    final profile: JsxEmissionProfile = if (Genes.outExtension == '.jsx')
      JavaScriptJsxAutomatic else if (!Context.defined('genes.ts'))
      ClassicCreateElement
    else if (Genes.outExtension == '.tsx')
      Context.defined('genes.ts.jsx_classic') ? TsxClassic : TsxAutomatic
    else
      TypeScriptCreateElement;

    final configured = Context.definedValue('genes.react.jsx_runtime_module');
    final normalized = configured == null ? null : StringTools.trim(configured);
    final runtimeModule = if (normalized == null || normalized.length == 0)
      DEFAULT_RUNTIME_MODULE
    else if (normalized.toLowerCase() == 'none')
      null
    else
      normalized;
    final binding = profile == TsxClassic
      ? CLASSIC_TSX_BINDING
      : INTERNAL_RUNTIME_BINDING;
    return new JsxCapabilityPolicy(profile, runtimeModule, binding);
  }

  function new(profile: JsxEmissionProfile, runtimeModule: Null<String>,
      runtimeBindingName: String) {
    this.profile = profile;
    this.runtimeModule = runtimeModule;
    this.runtimeBindingName = runtimeBindingName;
  }

  /** Whether this module needs a runtime namespace import for its JSX intent. */
  public function requiresRuntimeNamespace(plan: JsxPlan): Bool {
    if (!plan.hasIntents)
      return false;
    return switch profile {
      case TsxAutomatic | JavaScriptJsxAutomatic: plan.usesDynamicIntrinsicTag;
      case TsxClassic | TypeScriptCreateElement | ClassicCreateElement: true;
    }
  }

  /** Fails at the source marker before any output writer is opened. */
  public function validate(plan: JsxPlan): Void {
    if (!requiresRuntimeNamespace(plan) || runtimeModule != null)
      return;
    CompilerDiagnostic.fail('[GTS-JSX-CAPABILITY-001] JSX profile `${profile}` requires '
      + 'a React-compatible namespace exposing createElement and Fragment. '
      + 'Remove `-D genes.react.jsx_runtime_module=none` or configure that '
      + 'define with a compatible module specifier.', plan.firstPosition);
  }

  /**
   * Returns the alias chosen by the shared dependency allocator.
   *
   * Looking up the projected edge, instead of printing a hard-coded name,
   * preserves collision handling when a Haxe module already owns the preferred
   * runtime identifier.
   */
  public function resolveRuntimeBinding(dependencies: Dependencies,
      plan: JsxPlan): Null<String> {
    if (!requiresRuntimeNamespace(plan))
      return null;
    validate(plan);
    final binding = dependencies.resolveCapability(
      CompilerCapabilityId.JsxRuntimeNamespace);
    if (binding != null) {
      if (profile == TsxClassic && binding != CLASSIC_TSX_BINDING) {
        CompilerDiagnostic.fail('[GTS-JSX-CAPABILITY-003] Classic TSX requires the '
          + '`React` namespace, but that identifier collides in this '
          + 'module. Use the automatic JSX runtime or rename the '
          + 'conflicting Haxe declaration/import.', plan.firstPosition);
      }
      return binding;
    }
    return CompilerDiagnostic.fail(
      '[GTS-JSX-CAPABILITY-002] JSX runtime dependency was not '
      + 'projected for profile `${profile}`. This is a compiler planning error.',
      plan.firstPosition);
  }
}

/**
 * Immutable module-level JSX semantic plan shared by TypeScript and JavaScript.
 *
 * Why: macros intentionally lower inline markup and `jsx("...")` templates to
 * a small extern marker protocol so Haxe can type every embedded expression.
 * Parsing that protocol inside one target printer made imports, validation,
 * evaluation order, and classic compatibility depend on printer traversal.
 *
 * What: the plan classifies intrinsic, dynamic-intrinsic, and component tags;
 * ordered named/spread properties; fragments; children; evaluation origins;
 * and marker provenance. It records local initializers because the typer—or
 * reviewed migration code—may lift marker containers into locals. Their field
 * values must then be read, not inlined and evaluated a second time.
 *
 * How: `build` performs two deterministic typed-AST passes. The first captures
 * every initializer by stable `TVar.id`; the second validates every marker and
 * freezes module capability facts. `intentForCall` is reused during printing,
 * but performs no target choice. Invalid marker shapes fail with stable IDs and
 * their original Haxe source position.
 */
class JsxPlan {
  final localInitializers: Map<Int, TypedExpr> = [];
  final carrierLocalIds: Map<Int, Bool> = [];
  var intentCount = 0;
  var dynamicIntrinsic = false;
  var firstIntentPosition: Null<Position> = null;

  public var hasIntents(get, never): Bool;
  public var usesDynamicIntrinsicTag(get, never): Bool;
  public var firstPosition(get, never): Position;

  /** True when a local exists only to retain a typed JSX carrier record. */
  public function isCarrierLocal(id: Int): Bool {
    return carrierLocalIds.exists(id);
  }

  public static function build(module: Module): JsxPlan {
    final plan = new JsxPlan();
    var checker: Null<JsxTypeChecker> = null;
    plan.visitModuleExpressions(module, expression -> {
      switch unwrap(expression).expr {
        case TVar(variable, initializer) if (initializer != null):
          plan.localInitializers.set(variable.id, initializer);
        default:
      }
    });
    plan.visitModuleExpressions(module, expression -> {
      final intent = plan.intentForExpression(expression);
      if (intent == null)
        return;
      if (checker == null)
        checker = new JsxTypeChecker();
      checker.validate(intent);
      plan.intentCount++;
      final pos = intentPosition(intent);
      if (plan.firstIntentPosition == null)
        plan.firstIntentPosition = pos;
      switch intent {
        case ElementIntent(DynamicIntrinsicTag(_), _, _, _):
          plan.dynamicIntrinsic = true;
        default:
      }
    });
    return plan;
  }

  function new() {}

  function get_hasIntents(): Bool {
    return intentCount > 0;
  }

  function get_usesDynamicIntrinsicTag(): Bool {
    return dynamicIntrinsic;
  }

  function get_firstPosition(): Position {
    return firstIntentPosition == null
      ? Context.currentPos()
      : firstIntentPosition;
  }

  /** Returns validated intent when `callee` is a marker, otherwise null. */
  public function intentForCall(callee: TypedExpr,
      arguments: Array<TypedExpr>): Null<JsxIntent> {
    return switch markerName(callee) {
      case '__jsx':
        if (arguments.length != 3)
          markerError('GTS-JSX-INTENT-001',
            'Element marker expects tag, props, and children', callee.pos);
        final tag = tagIntent(arguments[0]);
        final props = propsIntent(arguments[1]);
        final children = childrenIntent(arguments[2]);
        ElementIntent(tag, props, children, arguments[0].pos);
      case '__frag':
        if (arguments.length != 1)
          markerError('GTS-JSX-INTENT-002',
            'Fragment marker expects one children array', callee.pos);
        FragmentIntent(childrenIntent(arguments[0]), arguments[0].pos);
      case _:
        null;
    }
  }

  /** True for a nested child marker after metadata/cast wrappers are removed. */
  public static function isMarkerCallExpression(expression: TypedExpr): Bool {
    return switch unwrap(expression).expr {
      case TCall(callee, _): markerName(callee) != null;
      default: false;
    }
  }

  /** Marker identity is based on the compiler-owned extern declaration. */
  public static function markerName(callee: TypedExpr): Null<String> {
    return switch unwrap(callee).expr {
      case TField(_, FStatic(_.get() => owner, _.get() => field))
        if (owner.pack.join('.') == 'genes.react.internal'
          && owner.name == 'Jsx'
          && (field.name == '__jsx' || field.name == '__frag')):
        field.name;
      default:
        null;
    }
  }

  /** Shared wrapper removal used only to interpret the marker protocol. */
  public static function unwrap(expression: TypedExpr): TypedExpr {
    var current = expression;
    while (current != null) {
      switch current.expr {
        case TMeta(_, inner) | TCast(inner, null) | TParenthesis(inner):
          current = inner;
        default:
          return current;
      }
    }
    return expression;
  }

  public static function tagExpression(tag: JsxTagIntent): TypedExpr {
    return switch tag {
      case IntrinsicTag(_, expression)
        | DynamicIntrinsicTag(expression)
        | ComponentTag(expression):
        expression;
    }
  }

  static function intentPosition(intent: JsxIntent): Position {
    return switch intent {
      case ElementIntent(_, _, _, pos) | FragmentIntent(_, pos): pos;
    }
  }

  function intentForExpression(expression: TypedExpr): Null<JsxIntent> {
    return switch unwrap(expression).expr {
      case TCall(callee, arguments):
        final intent = intentForCall(callee, arguments);
        intent == null ? null : switch intent {
          case ElementIntent(tag, props, children, _):
            ElementIntent(tag, props, children, expression.pos);
          case FragmentIntent(children, _):
            FragmentIntent(children, expression.pos);
        };
      default: null;
    }
  }

  function tagIntent(expression: TypedExpr): JsxTagIntent {
    return switch unwrap(expression).expr {
      case TConst(TString(name)):
        IntrinsicTag(name, expression);
      default:
        if (isStringType(expression.t))
          DynamicIntrinsicTag(expression)
        else
          ComponentTag(expression);
    }
  }

  function childrenIntent(expression: TypedExpr): Array<JsxChildIntent> {
    final sourceRoot = markerLocalSource(expression);
    final resolved = resolveMarkerLocal(expression);
    return readChildren(resolved, sourceRoot, [], 0);
  }

  function propsIntent(expression: TypedExpr): Array<JsxPropIntent> {
    final sourceRoot = markerLocalSource(expression);
    final resolved = resolveMarkerLocal(expression);
    return readProps(resolved, sourceRoot, [], 0);
  }

  function readChildren(expression: TypedExpr, sourceRoot: Null<TypedExpr>,
      path: Array<JsxValueAccess>, depth: Int): Array<JsxChildIntent> {
    if (depth > 4096)
      markerError('GTS-JSX-INTENT-008',
        'Marker children carrier exceeds the supported depth', expression.pos);
    final fields = objectFields(expression, 'children');
    if (fields.exists('__genesJsxChildrenEnd'))
      return [];
    final value = requiredCarrierField(fields, '__genesJsxChildValue',
      'GTS-JSX-INTENT-003', expression.pos);
    final next = requiredCarrierField(fields, '__genesJsxChildNext',
      'GTS-JSX-INTENT-003', expression.pos);
    final valuePath = appendPath(path, '__genesJsxChildValue');
    final nextState = nestedCarrierState(next, sourceRoot,
      appendPath(path, '__genesJsxChildNext'));
    final out = [ChildIntent(value, sourceFor(sourceRoot, valuePath))];
    for (child in readChildren(nextState.expression, nextState.sourceRoot,
      nextState.path, depth + 1))
      out.push(child);
    return out;
  }

  function readProps(expression: TypedExpr, sourceRoot: Null<TypedExpr>,
      path: Array<JsxValueAccess>, depth: Int): Array<JsxPropIntent> {
    if (depth > 4096)
      markerError('GTS-JSX-INTENT-009',
        'Marker props carrier exceeds the supported depth', expression.pos);
    final fields = objectFields(expression, 'props');
    if (fields.exists('__genesJsxPropsEnd'))
      return [];

    final next = requiredCarrierField(fields, '__genesJsxPropNext',
      'GTS-JSX-INTENT-004', expression.pos);
    final current = if (fields.exists('__genesJsxSpreadValue')) {
      final value = fields.get('__genesJsxSpreadValue');
      SpreadProp(value,
        sourceFor(sourceRoot, appendPath(path, '__genesJsxSpreadValue')));
    } else {
      final nameExpr = requiredCarrierField(fields, '__genesJsxPropName',
        'GTS-JSX-INTENT-005', expression.pos);
      final name = switch unwrap(nameExpr).expr {
                case TConst(TString(found)): found;
                default:
                  markerError('GTS-JSX-INTENT-005',
                    'Marker prop name must be a string literal', nameExpr.pos);
              };
      final value = requiredCarrierField(fields, '__genesJsxPropValue',
        'GTS-JSX-INTENT-006', expression.pos);
      NamedProp(name, value,
        sourceFor(sourceRoot, appendPath(path, '__genesJsxPropValue')));
    }

    final nextState = nestedCarrierState(next, sourceRoot,
      appendPath(path, '__genesJsxPropNext'));
    final out = [current];
    for (prop in readProps(nextState.expression, nextState.sourceRoot,
      nextState.path, depth + 1))
      out.push(prop);
    return out;
  }

  function objectFields(expression: TypedExpr,
      carrierName: String): Map<String, TypedExpr> {
    return switch unwrap(expression).expr {
      case TObjectDecl(fields):
        [for (field in fields) field.name => field.expr];
      default:
        markerError(carrierName == 'props' ? 'GTS-JSX-INTENT-004' : 'GTS-JSX-INTENT-003',
          'Marker $carrierName must use the compiler-owned linked record carrier',
          expression.pos);
    }
  }

  function requiredCarrierField(fields: Map<String, TypedExpr>, name: String,
      id: String, pos: Position): TypedExpr {
    final field = fields.get(name);
    return field == null ? markerError(id,
      'Marker carrier is missing `$name`', pos) : field;
  }

  function nestedCarrierState(expression: TypedExpr,
      inheritedRoot: Null<TypedExpr>, inheritedPath: Array<JsxValueAccess>): {
    final expression: TypedExpr;
    final sourceRoot: Null<TypedExpr>;
    final path: Array<JsxValueAccess>;
  } {
    if (inheritedRoot != null)
      return {
        expression: resolveMarkerLocal(expression),
        sourceRoot: inheritedRoot,
        path: inheritedPath
      };
    final localRoot = markerLocalSource(expression);
    return {
      expression: resolveMarkerLocal(expression),
      sourceRoot: localRoot,
      path: []
    };
  }

  static function appendPath(path: Array<JsxValueAccess>,
      field: String): Array<JsxValueAccess> {
    final out = path.copy();
    out.push(JsxObjectField(field));
    return out;
  }

  static function sourceFor(root: Null<TypedExpr>,
      path: Array<JsxValueAccess>): JsxValueSource {
    return root == null
      ? DirectValue
      : RuntimeValuePath(root, path);
  }

  /** Returns the original local only when marker data was already evaluated. */
  function markerLocalSource(expression: TypedExpr): Null<TypedExpr> {
    final candidate = unwrap(expression);
    return switch candidate.expr {
      case TLocal(variable) if (localInitializers.exists(variable.id)):
        carrierLocalIds.set(variable.id, true);
        candidate;
      default:
        null;
    }
  }

  /** Resolves marker-protocol containers, never ordinary prop/child values. */
  function resolveMarkerLocal(expression: TypedExpr): TypedExpr {
    var current = unwrap(expression);
    final seen: Map<Int, Bool> = [];
    while (true) {
      switch current.expr {
        case TLocal(variable)
          if (!seen.exists(variable.id)
            && localInitializers.exists(variable.id)):
          seen.set(variable.id, true);
          current = unwrap(localInitializers.get(variable.id));
        default:
          return current;
      }
    }
  }

  static function isStringType(type: Type): Bool {
    return switch Context.follow(type) {
      case TInst(_.get() => {pack: [], name: 'String'}, _): true;
      default: false;
    }
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
