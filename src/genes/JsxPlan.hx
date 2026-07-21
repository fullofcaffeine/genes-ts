package genes;

import haxe.macro.Context;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
import haxe.ds.ObjectMap;
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

/** The four typed calls in the internal JSX marker protocol. */
private enum JsxMarkerKind {
  ElementMarker;
  FragmentMarker;
  HxxChildElementMarker;
  HxxChildFragmentMarker;
}

/**
 * Compiler-owned identity of one nested element or fragment created by HXX.
 *
 * Why: a source range says where an expression came from, not who created it.
 * Authored code and another macro may legitimately share or copy that range.
 * Removing a local therefore needs a fact that only the HXX child conversion
 * creates.
 *
 * What/How: the parser emits a distinct extern static call for direct nested
 * markup. Haxe retains the exact call, owner, and field objects in its typed
 * tree. The plan records those objects for this compilation only; paths and
 * names locate the internal protocol declaration but never authorize a local
 * substitution by themselves.
 */
private typedef HxxChildMarkerIdentity = {
  final kind: JsxMarkerKind;
  final call: TypedExpr;
  final owner: Ref<ClassType>;
  final field: Ref<ClassField>;
}

/** Exact function-like owner used only while proving one source rewrite. */
private enum SourceInlineFunctionOwner {
  FunctionOwner(func: TFunc);
  MemberRootOwner(root: TypedExpr);
}

/** Exact lexical region shared by a removable declaration and its sole use. */
private typedef SourceInlineScope = {
  final functionOwner: SourceInlineFunctionOwner;
  final block: TypedExpr;
  final functionOrdinal: Int;
  final blockOrdinal: Int;
}

/** Closed set of parent statements admitted by the first sound rewrite. */
private enum SourceInlineParentSite {
  DirectReturn(statement: TypedExpr);
  DirectLocalInitializer(owner: TVar, declaration: TypedExpr);
  DirectLocalAssignment(owner: TVar, assignment: TypedExpr);
}

/**
 * One exact HXX child declaration that a source-JSX profile may remove.
 *
 * Why: looking up an initializer by `TVar.id` allowed any occurrence of that
 * local to trigger substitution. This record instead connects one declaration,
 * one typed marker, and one direct child occurrence in one function and block.
 *
 * What: object-valued fields are occurrence identities from Haxe's typed tree;
 * `childId` is the stable variable identity. Positions are retained only for
 * source maps and diagnostics. They never decide ownership or equality.
 *
 * How: `JsxPlan` creates facts in deterministic traversal order. Source
 * emitters consume them through exact declaration/child-expression maps, while
 * createElement profiles never receive a consumer.
 */
@:noCompletion
final class JsxSourceInlineFact {
  public final child: TVar;
  public final childId: Int;
  public final declaration: TypedExpr;
  public final initializer: TypedExpr;
  public final marker: HxxChildMarkerIdentity;
  public final childValue: TypedExpr;
  public final soleLocalUse: TypedExpr;
  public final parentMarker: TypedExpr;
  public final parentSite: SourceInlineParentSite;
  public final scope: SourceInlineScope;
  public final declarationIndex: Int;
  public final parentIndex: Int;
  public final childOrdinal: Int;
  public final mappingPos: Position;

  public function new(child: TVar, declaration: TypedExpr,
      initializer: TypedExpr, marker: HxxChildMarkerIdentity,
      childValue: TypedExpr, soleLocalUse: TypedExpr,
      parentMarker: TypedExpr, parentSite: SourceInlineParentSite,
      scope: SourceInlineScope, declarationIndex: Int, parentIndex: Int,
      childOrdinal: Int, mappingPos: Position) {
    this.child = child;
    childId = child.id;
    this.declaration = declaration;
    this.initializer = initializer;
    this.marker = marker;
    this.childValue = childValue;
    this.soleLocalUse = soleLocalUse;
    this.parentMarker = parentMarker;
    this.parentSite = parentSite;
    this.scope = scope;
    this.declarationIndex = declarationIndex;
    this.parentIndex = parentIndex;
    this.childOrdinal = childOrdinal;
    this.mappingPos = mappingPos;
  }
}

/**
 * Per-emitter accounting for exact source-inline facts.
 *
 * The semantic plan stays immutable and may serve both `.tsx` and `.jsx`.
 * Each source emitter gets its own small consumer, which rejects duplicate or
 * incomplete declaration/use consumption before the output transaction can
 * commit. This mutable counter is publication validation, not a second source
 * of rewrite semantics.
 */
@:noCompletion
final class JsxSourceInlineConsumer {
  final facts: Array<JsxSourceInlineFact>;
  final byDeclaration = new ObjectMap<TypedExpr, JsxSourceInlineFact>();
  final byChildValue = new ObjectMap<TypedExpr, JsxSourceInlineFact>();
  final omitted = new ObjectMap<TypedExpr, Bool>();
  final substituted = new ObjectMap<TypedExpr, Bool>();

  public function new(facts: Array<JsxSourceInlineFact>) {
    this.facts = facts;
    for (fact in facts) {
      byDeclaration.set(fact.declaration, fact);
      byChildValue.set(fact.childValue, fact);
    }
  }

  /** Returns the initializer only for the exact planned declaration object. */
  public function initializerForDeclaration(
      declaration: TypedExpr): Null<TypedExpr> {
    final fact = byDeclaration.get(declaration);
    if (fact == null)
      return null;
    if (omitted.exists(declaration))
      return CompilerDiagnostic.fail(
        '[GTS-JSX-SOURCE-INLINE-004] A planned HXX child declaration was '
        + 'omitted more than once. This is a compiler emission error.',
        fact.mappingPos);
    omitted.set(declaration, true);
    return fact.initializer;
  }

  /** Returns the initializer only for the exact planned direct child object. */
  public function initializerForChildValue(
      childValue: TypedExpr): Null<TypedExpr> {
    final fact = byChildValue.get(childValue);
    if (fact == null)
      return null;
    if (substituted.exists(childValue))
      return CompilerDiagnostic.fail(
        '[GTS-JSX-SOURCE-INLINE-004] A planned HXX child value was '
        + 'substituted more than once. This is a compiler emission error.',
        fact.mappingPos);
    substituted.set(childValue, true);
    return fact.initializer;
  }

  /** Ensures every accepted fact changed exactly one declaration and one use. */
  public function validate(): Void {
    #if genes.jsx_source_inline_test_fail_after_emission
    // This private test hook fails after source emission has consumed a real
    // fact. It lets the transaction fixture prove that even a late compiler
    // consistency error cannot publish half-rewritten JSX. Normal builds never
    // define it, so it cannot affect planning or generated source.
    if (facts.length > 0)
      CompilerDiagnostic.fail(
        '[GTS-JSX-SOURCE-INLINE-004] Injected source-inline consumption '
        + 'failure for output-transaction evidence.', facts[0].mappingPos);
    #end
    for (fact in facts) {
      if (!omitted.exists(fact.declaration)
        || !substituted.exists(fact.childValue)) {
        CompilerDiagnostic.fail(
          '[GTS-JSX-SOURCE-INLINE-004] A planned HXX child rewrite was only '
          + 'partly emitted. Both its exact declaration and exact child use '
          + 'must be consumed once.', fact.mappingPos);
      }
    }
  }
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
 * marker provenance; and whether nested markup fills a required `children`
 * property. It records local initializers because the typer—or reviewed
 * migration code—may lift marker containers into locals. Their field values
 * must then be read, not inlined and evaluated a second time.
 *
 * How: `build` performs four deterministic typed-AST passes. The first
 * captures every initializer by stable `TVar.id`; the second validates every
 * marker, records its permitted carrier-local path, and freezes module
 * capability facts. The third rejects any extra read, write, or escape of a
 * carrier local. The fourth records exact parser-owned nested-child rewrites
 * for source JSX only. `intentForCall` is reused during printing, but performs
 * no target choice. Invalid marker shapes or ownership violations fail with
 * stable IDs and their original Haxe source position.
 */
class JsxPlan {
  final localInitializers: Map<Int, TypedExpr> = [];
  final sourceInlineFacts: Array<JsxSourceInlineFact> = [];
  final sourceInlineByChildId: Map<Int, JsxSourceInlineFact> = [];
  final sourceInlineByDeclaration = new ObjectMap<TypedExpr,
    JsxSourceInlineFact>();
  final sourceInlineByChildValue = new ObjectMap<TypedExpr,
    JsxSourceInlineFact>();
  final sourceInlineByMarker = new ObjectMap<TypedExpr,
    JsxSourceInlineFact>();
  final carrierLocalIds: Map<Int, Bool> = [];
  final allowedCarrierUses = new ObjectMap<TypedExpr, Bool>();
  final validatedComponentProps = new ObjectMap<TypedExpr, Type>();
  final requiredNestedChildren = new ObjectMap<TypedExpr, Bool>();
  var intentCount = 0;
  var dynamicIntrinsic = false;
  var collectingCarrierUses = false;
  var firstIntentPosition: Null<Position> = null;

  public var hasIntents(get, never): Bool;
  public var usesDynamicIntrinsicTag(get, never): Bool;
  public var firstPosition(get, never): Position;

  /** True when a local exists only to retain a typed JSX carrier record. */
  public function isCarrierLocal(id: Int): Bool {
    return carrierLocalIds.exists(id);
  }

  /** True only for an exact local owned by a validated HXX child fact. */
  public function isSourceInlineChild(local: TVar): Bool {
    return sourceInlineByChildId.exists(local.id);
  }

  /**
   * Creates one occurrence-based source-emission view of the immutable facts.
   *
   * Source-preserving `.tsx` and `.jsx` profiles call this once. Plain `.ts`
   * and classic `.js` keep the established explicit createElement sequence and
   * must not request a consumer.
   */
  public function sourceInlineConsumer(
      profile: JsxEmissionProfile): JsxSourceInlineConsumer {
    switch profile {
      case TsxAutomatic | TsxClassic | JavaScriptJsxAutomatic:
      case TypeScriptCreateElement | ClassicCreateElement:
        return CompilerDiagnostic.fail(
          '[GTS-JSX-SOURCE-INLINE-006] A createElement output profile '
          + 'attempted to consume source-only HXX rewrite facts. This is a '
          + 'compiler configuration error.', firstPosition);
    }
    return new JsxSourceInlineConsumer(sourceInlineFacts.copy());
  }

  /**
   * Returns the Haxe-specialized property contract recorded by validation.
   *
   * The typed tag expression is the identity: the plan and emitter share the
   * same compiler-owned AST object. Source positions remain diagnostic facts
   * and are not used as keys, because generated expressions can legitimately
   * share a position.
   */
  public function componentPropsType(tag: JsxTagIntent): Null<Type> {
    return switch tag {
      case ComponentTag(expression):
        validatedComponentProps.get(expression);
      default: null;
    }
  }

  /**
   * Reports when nested markup supplies a required `children` property.
   *
   * Why: React accepts children either in the property object or as later
   * `createElement` arguments, but TypeScript's low-level overload checks a
   * required `children` field only in the property object. HXX already proved
   * the nested values satisfy that field, so the createElement printer needs
   * this fact to preserve the same legal contract as TSX.
   *
   * What/How: validation records the fact against the original typed tag
   * expression. This lookup exposes only the result; printers do not inspect
   * component fields or optional-spread metadata again.
   */
  public function nestedChildrenSupplyRequiredProperty(
      tag: JsxTagIntent): Bool {
    return requiredNestedChildren.exists(tagExpression(tag));
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
    plan.collectingCarrierUses = true;
    plan.visitModuleExpressions(module, expression -> {
      final intent = plan.intentForExpression(expression);
      if (intent == null)
        return;
      if (checker == null)
        checker = new JsxTypeChecker();
      final validation = checker.validate(intent);
      if (validation.componentPropsType != null)
        switch intent {
          case ElementIntent(tag, _, _, _):
            plan.validatedComponentProps.set(tagExpression(tag),
              validation.componentPropsType);
          default:
        }
      if (validation.nestedChildrenSupplyRequiredProperty)
        switch intent {
          case ElementIntent(tag, _, _, _):
            plan.requiredNestedChildren.set(tagExpression(tag), true);
          default:
        }
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
    plan.collectingCarrierUses = false;
    if (plan.carrierLocalIds.iterator().hasNext())
      plan.validateCarrierOwnership(module);
    plan.planSourceInlineLocals(module);
    plan.validateSourceInlineFacts();
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
    return switch markerKind(callee) {
      case ElementMarker | HxxChildElementMarker:
        if (arguments.length != 3)
          markerError('GTS-JSX-INTENT-001',
            'Element marker expects tag, props, and children', callee.pos);
        final tag = tagIntent(arguments[0]);
        final props = propsIntent(arguments[1]);
        final children = childrenIntent(arguments[2]);
        ElementIntent(tag, props, children, arguments[0].pos);
      case FragmentMarker | HxxChildFragmentMarker:
        if (arguments.length != 1)
          markerError('GTS-JSX-INTENT-002',
            'Fragment marker expects one children array', callee.pos);
        FragmentIntent(childrenIntent(arguments[0]), arguments[0].pos);
      case null:
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
    return switch markerKind(callee) {
      case ElementMarker | HxxChildElementMarker: '__jsx';
      case FragmentMarker | HxxChildFragmentMarker: '__frag';
      case null: null;
    }
  }

  /** Classifies one exact field from the internal marker extern. */
  static function markerKind(callee: TypedExpr): Null<JsxMarkerKind> {
    return switch unwrap(callee).expr {
      case TField(_, FStatic(_.get() => owner, _.get() => field))
        if (owner.pack.join('.') == 'genes.react.internal'
          && owner.name == 'Jsx'):
        switch field.name {
          case '__jsx': ElementMarker;
          case '__frag': FragmentMarker;
          case '__hxxChildJsx': HxxChildElementMarker;
          case '__hxxChildFrag': HxxChildFragmentMarker;
          default: null;
        }
      default: null;
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
        allowCarrierUse(candidate, variable);
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
          allowCarrierUse(current, variable);
          current = unwrap(localInitializers.get(variable.id));
        default:
          return current;
      }
    }
  }

  /**
   * Records one compiler-recognized use of a local carrier record.
   *
   * Why: a local lets Haxe evaluate a property or child once before the JSX
   * marker is emitted. The same record also contains property names and linked
   * list structure that `JsxPlan` reads at compile time. If application code
   * changes the record or uses it outside its marker chain, runtime data can
   * disagree with the JSX that was already checked and printed.
   *
   * What/How: the exact typed `TLocal` expression is the permission. Planning
   * records only occurrences followed while resolving a marker argument or its
   * linked carrier nodes, then seals the set. Repeated emitter lookup may use
   * those same expressions but cannot add a late permission. Any other
   * occurrence is an authored read, write, or escape and fails before an output
   * writer is opened. Typed expression identity is safe here because all
   * passes share one Haxe AST; source positions are retained for diagnostics
   * but are not identity.
   */
  function allowCarrierUse(expression: TypedExpr, variable: TVar): Void {
    if (!collectingCarrierUses) {
      if (carrierLocalIds.exists(variable.id)
        && allowedCarrierUses.exists(expression))
        return;
      markerError('GTS-JSX-INTENT-011',
        'A JSX carrier reached emission without being recorded during JSX '
        + 'planning. This is a compiler planning error',
        expression.pos);
    }
    carrierLocalIds.set(variable.id, true);
    allowedCarrierUses.set(expression, true);
  }

  /**
   * Enforces one-owner semantics for local HXX carrier scaffolding.
   *
   * The check deliberately rejects every use outside the marker's carrier
   * chain rather than attempting general alias and mutation analysis. A simple
   * pass-through alias remains part of that chain, but reading or changing the
   * carrier elsewhere does not. Carrier records are an internal compiler
   * protocol, so application data should be prepared first and then copied
   * into an untouched carrier. This keeps ordinary values fully typed,
   * preserves one-time evaluation, and prevents a printer from guessing which
   * post-construction mutations changed compile-time JSX meaning.
   */
  function validateCarrierOwnership(module: Module): Void {
    visitModuleExpressions(module, expression -> {
      switch expression.expr {
        case TLocal(variable)
          if (carrierLocalIds.exists(variable.id)
            && !allowedCarrierUses.exists(expression)):
          markerError('GTS-JSX-INTENT-010',
            'A local JSX carrier may only be passed through the compiler-owned '
            + 'carrier chain into its JSX marker. This record was read, changed, '
            + 'or shared elsewhere, so its runtime contents could disagree with '
            + 'the JSX structure checked at compile time. Prepare ordinary '
            + 'application data first, then build and consume an untouched carrier',
            expression.pos);
        default:
      }
    });
  }

  /**
   * Plans safe source-only removal of one-use nested JSX temporaries.
   *
   * Why: the HXX macro assigns a nested element its own typed local even when
   * the author wrote one expression tree. TypeScript/JavaScript source JSX can
   * represent that tree directly, but deleting an arbitrary local would change
   * evaluation order, exception timing, sharing, or an authored debugging seam.
   *
   * What: a candidate must carry the typed marker emitted only for a direct HXX
   * nested child. Its one exact declaration and one exact direct child use must
   * share a function and block, and its parent must be a direct return, local
   * initializer, or assignment to a local. Every crossed block element and
   * both JSX intents must also be reorder-safe.
   *
   * How: planning records exact typed-expression occurrences. Positions remain
   * source-map facts only. Source JSX printers omit/substitute through exact
   * occurrence maps; typed createElement and classic-JS printers deliberately
   * keep their established lowering and runtime transcript.
   */
  function planSourceInlineLocals(module: Module): Void {
    final uses: Map<Int, Array<TypedExpr>> = [];
    visitModuleExpressions(module, expression -> {
      switch expression.expr {
        case TLocal(local):
          final occurrences = uses.exists(local.id) ? uses.get(local.id) : [];
          occurrences.push(expression);
          uses.set(local.id, occurrences);
        default:
      }
    });

    var nextFunctionOrdinal = 0;
    function visitScopes(expression: TypedExpr,
        functionOwner: SourceInlineFunctionOwner, functionOrdinal: Int,
        blockCounter: {var value: Int;}): Void {
      final current = sourceInlineUnwrap(expression);
      switch current.expr {
        case TBlock(elements):
          final scope: SourceInlineScope = {
            functionOwner: functionOwner,
            block: current,
            functionOrdinal: functionOrdinal,
            blockOrdinal: blockCounter.value++
          };
          planSourceInlineBlock(elements, uses, scope);
          for (element in elements)
            visitScopes(element, functionOwner, functionOrdinal, blockCounter);
        case TFunction(func):
          final nestedOrdinal = nextFunctionOrdinal++;
          visitScopes(func.expr, FunctionOwner(func), nestedOrdinal, {value: 0});
        default:
          current.iter(child -> visitScopes(child, functionOwner,
            functionOrdinal, blockCounter));
      }
    }

    function visitRoot(root: TypedExpr): Void {
      if (root == null)
        return;
      final rootOrdinal = nextFunctionOrdinal++;
      visitScopes(root, MemberRootOwner(root), rootOrdinal, {value: 0});
    }

    for (member in module.members) {
      if (!Module.memberProjection(member).emitImplementation)
        continue;
      switch member {
        case MClass(owner, _, fields):
          for (field in Module.emittableFields(fields))
            if (field.expr != null)
              visitRoot(field.expr);
          if (owner.init != null)
            visitRoot(owner.init);
        case MMain(expression):
          visitRoot(expression);
        case MEnum(_, _) | MType(_, _):
      }
    }
  }

  /** Plans candidates whose declaration and sole parent use share one block. */
  function planSourceInlineBlock(elements: Array<TypedExpr>,
      uses: Map<Int, Array<TypedExpr>>, scope: SourceInlineScope): Void {
    final declarations: Map<Int, {
      final index: Int;
      final declaration: TypedExpr;
      final initializer: TypedExpr;
      final marker: HxxChildMarkerIdentity;
    }> = [];
    for (index in 0...elements.length) {
      switch sourceInlineUnwrap(elements[index]).expr {
        case TVar(local, initializer) if (initializer != null):
          final marker = hxxChildMarkerIdentity(initializer);
          if (marker != null)
            declarations.set(local.id, {
              index: index,
              declaration: elements[index],
              initializer: initializer,
              marker: marker
            });
        default:
      }
    }

    for (parentIndex in 0...elements.length) {
      final parent = directSourceInlineParent(elements[parentIndex]);
      if (parent == null)
        continue;
      final parentIntent = intentForExpression(parent.marker);
      if (parentIntent == null || !isSourceInlineSafeIntent(parentIntent))
        continue;
      final children = switch parentIntent {
        case ElementIntent(_, _, found, _) | FragmentIntent(found, _): found;
      };
      // Plan from right to left. An earlier child may cross a later generated
      // declaration only after that exact declaration has independently been
      // proven removable.
      for (offset in 0...children.length) {
        final childOrdinal = children.length - offset - 1;
        switch children[childOrdinal] {
          case ChildIntent(value, DirectValue):
            final occurrence = directLocalOccurrence(value);
            if (occurrence == null || !declarations.exists(occurrence.local.id))
              continue;
            final candidate = declarations.get(occurrence.local.id);
            final localUses = uses.get(occurrence.local.id);
            if (candidate.index >= parentIndex
              || localUses == null
              || localUses.length != 1
              || localUses[0] != occurrence.use
              || !isSourceInlineSafeMarker(candidate.initializer)
              || !safeInterveningElements(elements, candidate.index,
                parentIndex))
              continue;
            final mappingInfo = Context.getPosInfos(candidate.marker.call.pos);
            if (mappingInfo.file == null || mappingInfo.file.length == 0
              || mappingInfo.max < mappingInfo.min)
              continue;
            recordSourceInlineFact(new JsxSourceInlineFact(
              occurrence.local,
              candidate.declaration,
              candidate.initializer,
              candidate.marker,
              value,
              occurrence.use,
              parent.marker,
              parent.site,
              scope,
              candidate.index,
              parentIndex,
              childOrdinal,
              candidate.marker.call.pos
            ));
          case ChildIntent(_, RuntimeValuePath(_, _)):
        }
      }
    }
  }

  /** Records one fact and rejects any ambiguous typed occurrence immediately. */
  function recordSourceInlineFact(fact: JsxSourceInlineFact): Void {
    if (sourceInlineByChildId.exists(fact.childId)
      || sourceInlineByDeclaration.exists(fact.declaration)
      || sourceInlineByChildValue.exists(fact.childValue)
      || sourceInlineByMarker.exists(fact.marker.call)) {
      CompilerDiagnostic.fail(
        '[GTS-JSX-SOURCE-INLINE-001] One HXX child declaration, marker, or '
        + 'direct child occurrence belongs to more than one source rewrite. '
        + 'This is a compiler planning error.', fact.mappingPos);
    }
    sourceInlineFacts.push(fact);
    sourceInlineByChildId.set(fact.childId, fact);
    sourceInlineByDeclaration.set(fact.declaration, fact);
    sourceInlineByChildValue.set(fact.childValue, fact);
    sourceInlineByMarker.set(fact.marker.call, fact);
  }

  /**
   * Rechecks every accepted fact before an output writer is opened.
   *
   * Why: rejecting an unsafe candidate is ordinary conservative behavior, but
   * an accepted fact becomes permission to remove generated code. If its exact
   * declaration, use, marker, parent, or scope no longer agrees, continuing
   * would risk a partial or incorrect rewrite.
   *
   * What/How: this check follows only compiler-owned object identities already
   * stored by planning. It never falls back to names or positions. A mismatch
   * is an internal compiler diagnostic and therefore aborts the existing output
   * transaction before public files can be replaced.
   */
  function validateSourceInlineFacts(): Void {
    for (fact in sourceInlineFacts) {
      final elements = switch fact.scope.block.expr {
        case TBlock(found): found;
        default:
          return CompilerDiagnostic.fail(
            '[GTS-JSX-SOURCE-INLINE-003] A planned HXX child block no longer '
            + 'has its recorded typed structure.', fact.mappingPos);
      };
      if (fact.declarationIndex < 0
        || fact.declarationIndex >= elements.length
        || fact.parentIndex < 0
        || fact.parentIndex >= elements.length
        || elements[fact.declarationIndex] != fact.declaration
        || elements[fact.parentIndex] != sourceInlineParentStatement(
          fact.parentSite)) {
        CompilerDiagnostic.fail(
          '[GTS-JSX-SOURCE-INLINE-003] A planned HXX child declaration or '
          + 'parent no longer occupies its exact recorded block occurrence.',
          fact.mappingPos);
      }

      switch sourceInlineUnwrap(fact.declaration).expr {
        case TVar(local, initializer)
          if (local.id == fact.childId && initializer == fact.initializer):
        default:
          CompilerDiagnostic.fail(
            '[GTS-JSX-SOURCE-INLINE-003] A planned HXX child declaration no '
            + 'longer owns its exact local and initializer.', fact.mappingPos);
      }

      final marker = hxxChildMarkerIdentity(fact.initializer);
      if (marker == null
        || marker.call != fact.marker.call
        || marker.owner != fact.marker.owner
        || marker.field != fact.marker.field
        || marker.kind != fact.marker.kind) {
        CompilerDiagnostic.fail(
          '[GTS-JSX-SOURCE-INLINE-007] A planned HXX child marker no longer '
          + 'matches its exact typed call, owner, and field identity.',
          fact.mappingPos);
      }

      final occurrence = directLocalOccurrence(fact.childValue);
      if (occurrence == null
        || occurrence.local.id != fact.childId
        || occurrence.use != fact.soleLocalUse) {
        CompilerDiagnostic.fail(
          '[GTS-JSX-SOURCE-INLINE-002] A planned HXX child value no longer '
          + 'contains its exact sole local occurrence.', fact.mappingPos);
      }

      final parent = directSourceInlineParent(
        sourceInlineParentStatement(fact.parentSite));
      if (parent == null || parent.marker != fact.parentMarker) {
        CompilerDiagnostic.fail(
          '[GTS-JSX-SOURCE-INLINE-003] A planned HXX child parent no longer '
          + 'matches its direct return, local initializer, or local assignment.',
          fact.mappingPos);
      }
      final parentIntent = intentForExpression(fact.parentMarker);
      final children = parentIntent == null ? null : switch parentIntent {
        case ElementIntent(_, _, found, _) | FragmentIntent(found, _): found;
      };
      if (children == null
        || fact.childOrdinal < 0
        || fact.childOrdinal >= children.length) {
        CompilerDiagnostic.fail(
          '[GTS-JSX-SOURCE-INLINE-003] A planned HXX child no longer occupies '
          + 'its exact parent child slot.', fact.mappingPos);
      }
      switch children[fact.childOrdinal] {
        case ChildIntent(value, DirectValue) if (value == fact.childValue):
        default:
          CompilerDiagnostic.fail(
            '[GTS-JSX-SOURCE-INLINE-003] A planned HXX child no longer occupies '
            + 'its exact parent child occurrence.', fact.mappingPos);
      }
    }
  }

  /** Returns the exact block statement carried by one admitted parent site. */
  static function sourceInlineParentStatement(
      site: SourceInlineParentSite): TypedExpr {
    return switch site {
      case DirectReturn(statement): statement;
      case DirectLocalInitializer(_, declaration): declaration;
      case DirectLocalAssignment(_, assignment): assignment;
    }
  }

  /** Recognizes only direct parent statements with no observable prefix. */
  function directSourceInlineParent(expression: TypedExpr): Null<{
    final marker: TypedExpr;
    final site: SourceInlineParentSite;
  }> {
    final statement = sourceInlineUnwrap(expression);
    return switch statement.expr {
      case TReturn(value) if (value != null):
        final marker = directMarkerRoot(value);
        marker == null ? null : {
          marker: marker,
          site: DirectReturn(expression)
        };
      case TVar(owner, initializer) if (initializer != null):
        final marker = directMarkerRoot(initializer);
        marker == null ? null : {
          marker: marker,
          site: DirectLocalInitializer(owner, expression)
        };
      case TBinop(OpAssign, left, right):
        final owner = switch sourceInlineUnwrap(left).expr {
          case TLocal(local): local;
          default: null;
        };
        final marker = directMarkerRoot(right);
        owner == null || marker == null ? null : {
          marker: marker,
          site: DirectLocalAssignment(owner, expression)
        };
      default: null;
    }
  }

  /** Returns a marker only when approved non-evaluating wrappers surround it. */
  static function directMarkerRoot(expression: TypedExpr): Null<TypedExpr> {
    final root = sourceInlineUnwrap(expression);
    return isMarkerCallExpression(root) ? root : null;
  }

  /** Retains the exact specialized HXX child call and typed field identity. */
  static function hxxChildMarkerIdentity(
      expression: TypedExpr): Null<HxxChildMarkerIdentity> {
    final call = sourceInlineUnwrap(expression);
    return switch call.expr {
      case TCall(callee, _):
        final kind = markerKind(callee);
        switch [kind, sourceInlineUnwrap(callee).expr] {
          case [HxxChildElementMarker | HxxChildFragmentMarker,
            TField(_, FStatic(owner, field))]:
            {kind: kind, call: call, owner: owner, field: field};
          default: null;
        }
      default: null;
    }
  }

  /** Finds one direct local and preserves both wrapper and local occurrences. */
  static function directLocalOccurrence(expression: TypedExpr): Null<{
    final local: TVar;
    final use: TypedExpr;
  }> {
    final use = sourceInlineUnwrap(expression);
    return switch use.expr {
      case TLocal(local): {local: local, use: use};
      default: null;
    }
  }

  /**
   * Removes only wrappers proved not to evaluate or change the represented
   * value. Arbitrary `TMeta` is intentionally not transparent here: metadata
   * may be compiler- or macro-owned and must receive a separate reviewed rule.
   */
  static function sourceInlineUnwrap(expression: TypedExpr): TypedExpr {
    var current = expression;
    while (current != null) {
      switch current.expr {
        case TCast(inner, null) | TParenthesis(inner): current = inner;
        default: return current;
      }
    }
    return expression;
  }

  /** True when moving a value across the exclusive block interval is inert. */
  function safeInterveningElements(elements: Array<TypedExpr>, start: Int,
      end: Int): Bool {
    for (index in start + 1...end) {
      final element = sourceInlineUnwrap(elements[index]);
      switch element.expr {
        case TVar(_, initializer) if (initializer != null):
          // A JSX marker becomes a runtime jsx/createElement call. It is safe
          // to cross only when it is compiler scaffolding already planned for
          // substitution at its own sole child use. Authored or retained JSX
          // locals remain observable sequencing boundaries.
          if (isMarkerCallExpression(initializer)) {
            if (sourceInlineByDeclaration.exists(elements[index]))
              continue;
            return false;
          }
          if (isSourceInlineSafeValue(initializer))
            continue;
          return false;
        default:
          return false;
      }
    }
    return true;
  }

  function isSourceInlineSafeMarker(expression: TypedExpr): Bool {
    final intent = intentForExpression(expression);
    return intent != null && isSourceInlineSafeIntent(intent);
  }

  /** Conservative purity contract for moving one JSX allocation into a tree. */
  function isSourceInlineSafeIntent(intent: JsxIntent): Bool {
    return switch intent {
      case ElementIntent(tag, props, children, _):
        if (!isSourceInlineSafeTag(tag))
          false;
        else {
          var safe = true;
          for (prop in props) {
            switch prop {
              case NamedProp(_, value, DirectValue):
                safe = safe && isSourceInlineSafeValue(value);
              case NamedProp(_, _, RuntimeValuePath(_, _)):
              case SpreadProp(value, DirectValue):
                safe = safe && isSourceInlineSafeSpread(value);
              case SpreadProp(_, RuntimeValuePath(_, _)):
                safe = false;
            }
          }
          for (child in children) {
            switch child {
              case ChildIntent(value, DirectValue):
                safe = safe && (isMarkerCallExpression(value)
                  ? isSourceInlineSafeMarker(value)
                  : isSourceInlineSafeValue(value));
              case ChildIntent(_, RuntimeValuePath(_, _)):
            }
          }
          safe;
        }
      case FragmentIntent(children, _):
        var safe = true;
        for (child in children) {
          switch child {
            case ChildIntent(value, DirectValue):
              safe = safe && (isMarkerCallExpression(value)
                ? isSourceInlineSafeMarker(value)
                : isSourceInlineSafeValue(value));
            case ChildIntent(_, RuntimeValuePath(_, _)):
          }
        }
        safe;
    }
  }

  static function isSourceInlineSafeTag(tag: JsxTagIntent): Bool {
    return switch tag {
      case IntrinsicTag(_, _): true;
      case DynamicIntrinsicTag(_): false;
      case ComponentTag(expression):
        // Only a lexical local read is proven inert across every supported JS
        // host shape. Static/type/enum fields can become getters, native
        // mappings, or Proxy traps, including fields generated by Haxe itself.
        // Keeping their child temporary preserves child-before-parent reads.
        switch sourceInlineUnwrap(expression).expr {
          case TLocal(_): true;
          default: false;
        }
    }
  }

  /**
   * Accepts only direct values whose evaluation has no calls, mutation, or
   * control flow. Property/array reads are deliberately excluded because a JS
   * interop value may implement them with a getter or Proxy trap.
   */
  function isSourceInlineSafeValue(expression: TypedExpr): Bool {
    final value = unwrap(expression);
    return switch value.expr {
      case TConst(_) | TLocal(_) | TTypeExpr(_) | TFunction(_): true;
      case TArrayDecl(values):
        values.filter(candidate -> !isSourceInlineSafeValue(candidate)).length == 0;
      case TObjectDecl(fields):
        fields.filter(field -> !isSourceInlineSafeValue(field.expr)).length == 0;
      case TBinop(OpAssign | OpAssignOp(_), _, _): false;
      case TBinop(_, left, right):
        isSourceInlinePrimitive(left.t)
        && isSourceInlinePrimitive(right.t)
        && isSourceInlineSafeValue(left)
        && isSourceInlineSafeValue(right);
      case TUnop(OpIncrement | OpDecrement, _, _): false;
      case TUnop(_, _, inner):
        isSourceInlinePrimitive(inner.t)
        && isSourceInlineSafeValue(inner);
      case TField(_, FEnum(_, _)): true;
      case TCall(_, _) if (isMarkerCallExpression(value)):
        isSourceInlineSafeMarker(value);
      default: false;
    }
  }

  /** A spread is movable only when it resolves to a known plain object literal. */
  function isSourceInlineSafeSpread(expression: TypedExpr): Bool {
    final seen: Map<Int, Bool> = [];
    function resolve(value: TypedExpr): Bool {
      return switch unwrap(value).expr {
        case TObjectDecl(fields):
          fields.filter(field -> !isSourceInlineSafeValue(field.expr)).length == 0;
        case TLocal(local)
          if (!seen.exists(local.id) && localInitializers.exists(local.id)):
          seen.set(local.id, true);
          resolve(localInitializers.get(local.id));
        default: false;
      }
    }
    return resolve(expression);
  }

  /** Primitive operators cannot invoke a user-defined JS coercion hook. */
  static function isSourceInlinePrimitive(type: Type): Bool {
    return switch Context.followWithAbstracts(type) {
      case TInst(_.get() => {pack: [], name: 'String'}, _): true;
      case TAbstract(_.get() => {pack: [], name: 'Int' | 'Float' | 'Bool'}, _):
        true;
      default: false;
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
