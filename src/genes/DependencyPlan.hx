package genes;

#if macro
import haxe.ds.ReadOnlyArray;
import haxe.macro.Context;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
import genes.Dependencies.Dependency;
import genes.Dependencies.DependencySpec;
import genes.Dependencies.DependencyType;
import genes.BindingIdentity.BindingIdentity;
import genes.BindingIdentity.ImportBindingFact;
import genes.BindingIdentity.ModuleRequestKey;
import genes.SourceMapGenerator.SourcePosition;
import genes.util.TypeUtil;

/** Describes why a symbol must be reachable from one generated module. */
enum abstract DependencyEdgeKind(String) {
  /** A value read by executable code, including constructors and static fields. */
  var RuntimeValue = "runtime-value";

  /** A module needed only for its initialization side effects. */
  var RuntimeSideEffect = "runtime-side-effect";

  /** A symbol used by annotations in emitted TypeScript implementation code. */
  var TypeOnly = "type-only";

  /** A symbol reachable only from a generated declaration surface. */
  var DeclarationOnly = "declaration-only";
}

/**
 * Immutable import spelling attached to a dependency edge.
 *
 * `Dependencies.Dependency` predates the semantic graph and is intentionally
 * mutable because alias allocation happens while imports are merged. A plan
 * must be reusable by TS, classic JS, and declaration profiles, so it stores
 * this immutable copy and creates a fresh mutable dependency per projection.
 */
class DependencyImport {
  public final type: DependencyType;
  public final name: String;
  public final external: Bool;
  public final path: String;
  public final memberPath: ReadOnlyArray<String>;
  public final alias: Null<String>;
  public final importAttributeType: Null<String>;
  public final pos: Null<SourcePosition>;
  public final bindingFact: ImportBindingFact;

  public function new(dependency: DependencySpec,
      bindingFact: ImportBindingFact) {
    final expectedIntent = BindingIdentity.localIntentFor(dependency);
    if (!expectedIntent.equals(bindingFact.localIntent)
      || !bindingFact.originMapping.localIntent.equals(
        bindingFact.localIntent)
      || !BindingIdentity.memberPathsEqual(dependency.memberPath,
        bindingFact.originMapping.memberPath)) {
      CompilerDiagnostic.fail(
        'GENES-IMPORT-IDENTITY-MISMATCH-001: normalized import syntax and canonical binding identity disagree',
        Context.currentPos());
    }
    type = dependency.type;
    name = dependency.name;
    external = dependency.external;
    path = dependency.path;
    memberPath = dependency.memberPath.copy();
    alias = dependency.alias;
    importAttributeType = dependency.importAttributeType;
    // Provenance travels with the immutable fact so every profile starts from
    // the same Haxe position even though each profile allocates locals again.
    pos = bindingFact.firstPosition;
    this.bindingFact = bindingFact;
  }

  /**
   * Returns a fresh local spelling while preserving every semantic identity.
   *
   * Why: classic runtime, genes-ts, and classic declarations can allocate a
   * different collision suffix because their reachable binding subsets differ.
   * Request, export, requested-local intent, origin, and member path must remain
   * byte-for-byte semantic copies; only `alias` may be changed by projection.
   */
  public function copyForProjection(): Dependency {
    return {
      type: type,
      name: name,
      external: external,
      path: path,
      memberPath: [for (part in memberPath) part],
      alias: alias,
      importAttributeType: importAttributeType,
      pos: pos,
      bindingFact: bindingFact
    };
  }
}

/**
 * Identifies one ESM module request independently from imported bindings.
 *
 * Why: `import "setup"` requests and evaluates a module without introducing a
 * local name. Modeling that declaration as `DName`, `DDefault`, or `DAsterisk`
 * would invent an export contract and make alias allocation responsible for a
 * fact that has no binding.
 *
 * What: request identity is the target kind, path, and optional loader
 * attribute. Internal paths are Haxe module identities; external paths are
 * literal runtime specifiers. `pos` supplies source-map provenance but is not
 * part of identity.
 *
 * How: `DependencyPlan.projectImplementation` coalesces equal requests at
 * their first runtime edge. Printers project internal paths through their
 * profile extension policy and leave external specifiers unchanged.
 */
class DependencyModuleRequest {
  public final key: ModuleRequestKey;
  public final external: Bool;
  public final path: String;
  public final importAttributeType: Null<String>;
  public final pos: Null<SourcePosition>;

  public function new(external: Bool, path: String,
      importAttributeType: Null<String>, pos: Null<SourcePosition>) {
    this.key = new ModuleRequestKey(external, path, importAttributeType);
    this.external = external;
    this.path = path;
    this.importAttributeType = importAttributeType;
    this.pos = pos;
  }

  public static function fromImport(importSpec: DependencyImport): DependencyModuleRequest {
    final key = importSpec.bindingFact.exportBinding.request;
    return new DependencyModuleRequest(key.external, key.path,
      key.importAttributeType, importSpec.pos);
  }

  /** Attribute-aware identity comparison; positions deliberately do not count. */
  public function equals(other: DependencyModuleRequest): Bool {
    return key.equals(other.key);
  }
}

/** Separates a real imported binding from a binding-free module request. */
enum DependencyImportSpec {
  Bound(importSpec: DependencyImport);
  SideEffect(request: DependencyModuleRequest);
}

/** Stable evidence explaining which compiler rule created an edge. */
class DependencyProvenance {
  public final rule: String;
  public final pos: SourcePosition;
  public final sourcePosition: Position;

  public function new(rule: String, sourcePosition: Position) {
    this.rule = rule;
    this.sourcePosition = sourcePosition;
    this.pos = sourcePosition;
  }
}

/**
 * One immutable semantic dependency edge.
 *
 * Why: a string import alone cannot tell whether its destination is needed at
 * runtime, only for TS annotations, or only by `.d.ts`. It also cannot safely
 * recover the originating Haxe declaration after DCE.
 *
 * What: `referencedType` keeps the compiler-owned declaration ref used for
 * graph expansion. `importSpec` is null for same-module and known-global type
 * references, which still need validation even though no import is printed.
 * Provenance makes failures source-positioned and attributes them to a stable
 * planning rule rather than to printer order.
 *
 * How: builders create edges before any alias is allocated. Emission profiles
 * select kinds and project them through the existing `Dependencies` machinery.
 */
class DependencyEdge {
  public final kind: DependencyEdgeKind;
  public final referencedType: Null<ModuleType>;
  public final importSpec: Null<DependencyImportSpec>;
  public final provenance: DependencyProvenance;

  public function new(kind: DependencyEdgeKind,
      referencedType: Null<ModuleType>, importSpec: Null<DependencyImportSpec>,
      provenance: DependencyProvenance) {
    this.kind = kind;
    this.referencedType = referencedType;
    this.importSpec = importSpec;
    this.provenance = provenance;
  }
}

/**
 * One ordered implementation declaration request after alias allocation.
 *
 * An empty `bindings` array prints as `import "specifier"`. A non-empty array
 * prints the existing default/namespace/named forms and thereby satisfies the
 * same module request without a redundant bare declaration.
 */
class ModuleRequestPlan {
  public final request: DependencyModuleRequest;
  public final bindings: ReadOnlyArray<Dependency>;
  public final firstProvenance: DependencyProvenance;

  public function new(request: DependencyModuleRequest,
      bindings: Array<Dependency>, firstProvenance: DependencyProvenance) {
    this.request = request;
    this.bindings = bindings.copy();
    this.firstProvenance = firstProvenance;
  }
}

/** One implementation import declaration and whether TypeScript erases it. */
class ImportDeclarationPlan {
  public final requestPlan: ModuleRequestPlan;
  public final typeOnly: Bool;

  public function new(requestPlan: ModuleRequestPlan, typeOnly: Bool) {
    this.requestPlan = requestPlan;
    this.typeOnly = typeOnly;
  }
}

/**
 * Concrete import projection shared by classic JS and TypeScript emitters.
 *
 * `bindings` remains the lookup surface used by expression/type printers.
 * `runtimeRequests` is the only implementation runtime-declaration order.
 * `typeOnlyRequests` is deterministic TS-only syntax and never creates a
 * runtime request. `declarations` combines those arrays in the exact order the
 * TypeScript printer consumes. Every array is copied before exposure.
 */
class DependencyProjection {
  public final bindings: Dependencies;
  public final runtimeRequests: ReadOnlyArray<ModuleRequestPlan>;
  public final typeOnlyRequests: ReadOnlyArray<ModuleRequestPlan>;
  public final declarations: ReadOnlyArray<ImportDeclarationPlan>;

  public function new(bindings: Dependencies,
      runtimeRequests: Array<ModuleRequestPlan>,
      typeOnlyRequests: Array<ModuleRequestPlan>,
      declarations: Array<ImportDeclarationPlan>) {
    this.bindings = bindings;
    this.runtimeRequests = runtimeRequests.copy();
    this.typeOnlyRequests = typeOnlyRequests.copy();
    this.declarations = declarations.copy();
  }
}

private typedef MutableModuleRequestPlan = {
  final request: DependencyModuleRequest;
  final bindings: Array<Dependency>;
  final firstProvenance: DependencyProvenance;
}

/**
 * Immutable dependency facts shared by all Genes output profiles.
 *
 * Why: dependency discovery previously invoked the TypeScript type printer
 * with a sink writer, then reconstructed stripped Haxe types from import names.
 * That made DCE depend on formatting and silently swallowed failed lookups.
 *
 * What: the plan separates runtime, TS-implementation, and declaration edges;
 * retains original `ModuleType` refs; and preserves source provenance. Runtime
 * side effects are a distinct kind even though current Genes inputs only
 * produce value imports, so adding them later cannot be mistaken for type-only
 * reachability.
 *
 * How: `DependencyPlanBuilder` extracts facts from typed Haxe declarations and
 * expressions. Implementation printers consume an explicit ordered request
 * projection routed through the established collision-safe alias allocator.
 * The edge array is defensively copied and exposed read-only, making traversal
 * and output deterministic for one compilation. The edge array remains the
 * order owner for both bound and binding-free runtime requests. `Dependencies`
 * maps are lookup and alias-allocation structures only; iterating them cannot
 * replace source encounter order because ESM evaluates bound imports too.
 */
class DependencyPlan {
  final edgeValues: Array<DependencyEdge>;

  public var edges(get, never): ReadOnlyArray<DependencyEdge>;
  public final usesJsxNamespaceType: Bool;

  public function new(edges: Array<DependencyEdge>, usesJsxNamespaceType: Bool) {
    edgeValues = edges.copy();
    this.usesJsxNamespaceType = usesJsxNamespaceType;
  }

  function get_edges(): ReadOnlyArray<DependencyEdge> {
    return edgeValues;
  }

  /** Projects selected semantic edge kinds into the legacy import allocator. */
  public function dependencies(module: Module,
      kinds: Array<DependencyEdgeKind>, runtime = false): Dependencies {
    final dependencies = new Dependencies(module, runtime);
    for (edge in edgeValues) {
      if (!containsKind(kinds, edge.kind) || edge.importSpec == null)
        continue;
      switch edge.importSpec {
        case Bound(importSpec):
          final dependency = importSpec.copyForProjection();
          dependencies.pushAndGet(dependency.path, dependency,
            edge.provenance.sourcePosition);
        case SideEffect(_):
      }
    }
    return dependencies;
  }

  /**
   * Projects runtime edges and optional TS-only bindings in stable edge order.
   *
   * Why: grouping first by `Map<path, bindings>` cannot represent interleaved
   * requests such as A(attribute x), B, A(attribute y). ESM initialization
   * order must be a semantic plan rather than an incidental map iteration.
   *
   * What: runtime value and side-effect edges share ordered request slots.
   * Equal request identities coalesce at first occurrence; a later binding is
   * attached to that first slot. Type-only bindings use the same alias allocator
   * but remain in a separate, erasing declaration array.
   *
   * How: every bound edge receives the canonical object returned by
   * `Dependencies.pushAndGet`. Runtime attachment removes an equivalent
   * type-only attachment, so a real value import always wins. This method is the
   * sole implementation-order projection consumed by both output profiles.
   */
  public function projectImplementation(module: Module,
      includeTypes: Bool): DependencyProjection {
    final bindings = new Dependencies(module, true);
    final runtimePlans: Array<MutableModuleRequestPlan> = [];
    final typePlans: Array<MutableModuleRequestPlan> = [];

    function findOrAdd(plans: Array<MutableModuleRequestPlan>,
        request: DependencyModuleRequest,
        provenance: DependencyProvenance): MutableModuleRequestPlan {
      for (plan in plans)
        if (plan.request.equals(request))
          return plan;
      final plan: MutableModuleRequestPlan = {
        request: request,
        bindings: [],
        firstProvenance: provenance
      };
      plans.push(plan);
      return plan;
    }

    function sameBinding(left: Dependency, right: Dependency): Bool {
      return left.bindingFact.localIntent.equals(
        right.bindingFact.localIntent);
    }

    function attach(plan: MutableModuleRequestPlan,
        binding: Dependency): Void {
      for (existing in plan.bindings)
        if (sameBinding(existing, binding))
          return;
      plan.bindings.push(binding);
    }

    function removeTypeOnlyBinding(binding: Dependency): Void {
      for (plan in typePlans) {
        var index = plan.bindings.length - 1;
        while (index >= 0) {
          if (sameBinding(plan.bindings[index], binding))
            plan.bindings.splice(index, 1);
          index--;
        }
      }
    }

    for (edge in edgeValues) {
      final runtimeEdge = edge.kind == RuntimeValue
        || edge.kind == RuntimeSideEffect;
      final typeEdge = includeTypes && edge.kind == TypeOnly;
      if ((!runtimeEdge && !typeEdge) || edge.importSpec == null)
        continue;

      switch edge.importSpec {
        case SideEffect(request):
          if (runtimeEdge) {
            findOrAdd(runtimePlans, request, edge.provenance);
          }

        case Bound(importSpec):
          final dependency = importSpec.copyForProjection();
          final canonical = bindings.pushAndGet(dependency.path, dependency,
            edge.provenance.sourcePosition);
          final request = DependencyModuleRequest.fromImport(importSpec);
          if (runtimeEdge) {
            removeTypeOnlyBinding(canonical);
            attach(findOrAdd(runtimePlans, request, edge.provenance),
              canonical);
          } else {
            var runtimeOwnsBinding = false;
            for (plan in runtimePlans)
              for (runtimeBinding in plan.bindings)
                if (sameBinding(runtimeBinding, canonical)) {
                  runtimeOwnsBinding = true;
                  break;
                }
            if (!runtimeOwnsBinding)
              attach(findOrAdd(typePlans, request, edge.provenance), canonical);
          }
      }
    }

    function freeze(plans: Array<MutableModuleRequestPlan>,
        omitEmpty: Bool): Array<ModuleRequestPlan> {
      final result: Array<ModuleRequestPlan> = [];
      for (plan in plans) {
        if (omitEmpty && plan.bindings.length == 0)
          continue;
        result.push(new ModuleRequestPlan(plan.request, plan.bindings,
          plan.firstProvenance));
      }
      return result;
    }

    final frozenRuntime = freeze(runtimePlans, false);
    final frozenTypes = freeze(typePlans, true);
    final declarations: Array<ImportDeclarationPlan> = [];
    for (plan in frozenRuntime)
      declarations.push(new ImportDeclarationPlan(plan, false));
    for (plan in frozenTypes)
      declarations.push(new ImportDeclarationPlan(plan, true));

    return new DependencyProjection(bindings, frozenRuntime, frozenTypes,
      declarations);
  }

  /**
   * Returns unique compiler-owned declarations reachable through selected
   * kinds. Import-less same-module references remain present for validation.
   */
  public function referencedTypes(kinds: Array<DependencyEdgeKind>): Array<ModuleType> {
    final seen = new Map<String, Bool>();
    final result: Array<ModuleType> = [];
    for (edge in edgeValues) {
      final type = edge.referencedType;
      if (!containsKind(kinds, edge.kind) || type == null)
        continue;
      final key = moduleTypeKey(type);
      if (seen.exists(key))
        continue;
      seen.set(key, true);
      result.push(type);
    }
    return result;
  }

  public static function containsKind(kinds: Array<DependencyEdgeKind>,
      kind: DependencyEdgeKind): Bool {
    for (candidate in kinds)
      if (candidate == kind)
        return true;
    return false;
  }

  /** Stable declaration identity used by de-duplicated reachability queries. */
  public static function moduleTypeKey(type: ModuleType): String {
    return switch type {
      case TClassDecl(ref):
        final base = ref.get();
        'class:${TypeUtil.baseTypeFullName(base)}';
      case TEnumDecl(ref):
        final base = ref.get();
        'enum:${TypeUtil.baseTypeFullName(base)}';
      case TTypeDecl(ref):
        final base = ref.get();
        'typedef:${TypeUtil.baseTypeFullName(base)}';
      case TAbstract(ref):
        final base = ref.get();
        'abstract:${TypeUtil.baseTypeFullName(base)}';
    }
  }

  /** Converts a declaration ref back to the applied `Type` Module consumes. */
  public static function moduleTypeToType(type: ModuleType): Type {
    return switch type {
      case TClassDecl(ref): TInst(ref, ref.get().params.map(param -> param.t));
      case TEnumDecl(ref): TEnum(ref, ref.get().params.map(param -> param.t));
      case TTypeDecl(ref): TType(ref, ref.get().params.map(param -> param.t));
      case TAbstract(ref):
        TAbstract(ref, ref.get().params.map(param -> param.t));
    }
  }

  public static function moduleTypeBase(type: ModuleType): BaseType {
    return switch type {
      case TClassDecl(ref): ref.get();
      case TEnumDecl(ref): ref.get();
      case TTypeDecl(ref): ref.get();
      case TAbstract(ref): ref.get();
    }
  }
}
#end
