package genes;

import haxe.macro.Context;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
import genes.Dependencies.DependencyType;

using haxe.macro.TypedExprTools;

/** The output capability selected for target-neutral JSX intent. */
enum abstract JsxEmissionProfile(String) to String {
  /** TypeScript source keeps JSX syntax and uses the automatic JSX runtime. */
  var TsxAutomatic = "tsx-automatic";

  /** TypeScript source keeps JSX syntax and expects `React.createElement`. */
  var TsxClassic = "tsx-classic";

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
  JsxArrayIndex(index: Int);
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
    final profile: JsxEmissionProfile = if (!Context.defined('genes.ts'))
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
      case TsxAutomatic: plan.usesDynamicIntrinsicTag;
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
    final imports = dependencies.imports.get(runtimeModule);
    if (imports != null) {
      for (dependency in imports) {
        if (dependency.name != runtimeBindingName)
          continue;
        switch dependency.type {
          case DependencyType.DAsterisk:
            final binding = dependency.alias == null
              ? dependency.name
              : dependency.alias;
            if (profile == TsxClassic && binding != CLASSIC_TSX_BINDING) {
              CompilerDiagnostic.fail('[GTS-JSX-CAPABILITY-003] Classic TSX requires the '
                + '`React` namespace, but that identifier collides in this '
                + 'module. Use the automatic JSX runtime or rename the '
                + 'conflicting Haxe declaration/import.', plan.firstPosition);
            }
            return binding;
          default:
        }
      }
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
  var intentCount = 0;
  var dynamicIntrinsic = false;
  var firstIntentPosition: Null<Position> = null;

  public var hasIntents(get, never): Bool;
  public var usesDynamicIntrinsicTag(get, never): Bool;
  public var firstPosition(get, never): Position;

  public static function build(module: Module): JsxPlan {
    final plan = new JsxPlan();
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
      case TCall(callee, arguments): intentForCall(callee, arguments);
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
    return switch resolved.expr {
      case TArrayDecl(children):
        [for (index in 0...children.length)
          ChildIntent(children[index], sourceRoot == null
            ? DirectValue
            : RuntimeValuePath(sourceRoot, [JsxArrayIndex(index)]))];
      case TConst(TNull): [];
      default:
        markerError('GTS-JSX-INTENT-003',
          'Marker children must be an array literal', resolved.pos);
    }
  }

  function propsIntent(expression: TypedExpr): Array<JsxPropIntent> {
    final sourceRoot = markerLocalSource(expression);
    final resolved = resolveMarkerLocal(expression);
    return switch resolved.expr {
      case TArrayDecl(entries):
        [for (index in 0...entries.length)
          propIntent(entries[index], sourceRoot == null
            ? null
            : RuntimeValuePath(sourceRoot, [JsxArrayIndex(index)]))];
      case TConst(TNull): [];
      default:
        markerError('GTS-JSX-INTENT-004',
          'Marker props must be an array literal', resolved.pos);
    }
  }

  function propIntent(expression: TypedExpr,
      arrayEntrySource: Null<JsxValueSource>): JsxPropIntent {
    final entryRoot = markerLocalSource(expression);
    final resolved = resolveMarkerLocal(expression);
    return switch resolved.expr {
      case TObjectDecl(fields):
        var name: Null<String> = null;
        var value: Null<TypedExpr> = null;
        var spread: Null<TypedExpr> = null;
        for (field in fields) {
          switch field.name {
            case 'name':
              switch unwrap(field.expr).expr {
                case TConst(TString(found)): name = found;
                default:
                  markerError('GTS-JSX-INTENT-005',
                    'Marker prop name must be a string literal', field.expr.pos);
              }
            case 'value': value = field.expr;
            case 'spread': spread = field.expr;
            default:
          }
        }
        if (spread != null)
          SpreadProp(spread, propFieldSource(arrayEntrySource, entryRoot,
            'spread'))
        else if (name != null && value != null)
          NamedProp(name, value, propFieldSource(arrayEntrySource, entryRoot,
            'value'))
        else
          markerError('GTS-JSX-INTENT-006',
            'Marker prop entry must contain name/value or spread', resolved.pos);
      default:
        markerError('GTS-JSX-INTENT-007',
          'Marker prop entry must be an object literal', resolved.pos);
    }
  }

  function propFieldSource(arrayEntrySource: Null<JsxValueSource>,
      entryRoot: Null<TypedExpr>, field: String): JsxValueSource {
    if (arrayEntrySource != null) {
      return switch arrayEntrySource {
        case DirectValue: DirectValue;
        case RuntimeValuePath(root, path):
          final extended = path.copy();
          extended.push(JsxObjectField(field));
          RuntimeValuePath(root, extended);
      }
    }
    return entryRoot == null
      ? DirectValue
      : RuntimeValuePath(entryRoot, [JsxObjectField(field)]);
  }

  /** Returns the original local only when marker data was already evaluated. */
  function markerLocalSource(expression: TypedExpr): Null<TypedExpr> {
    final candidate = unwrap(expression);
    return switch candidate.expr {
      case TLocal(variable) if (localInitializers.exists(variable.id)):
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
