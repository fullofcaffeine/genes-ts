package genes;

#if macro
import haxe.ds.ReadOnlyArray;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
import genes.Dependencies.Dependency;
import genes.Dependencies.DependencyType;
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
  public final alias: Null<String>;
  public final importAttributeType: Null<String>;
  public final pos: Null<SourcePosition>;

  public function new(dependency: Dependency) {
    type = dependency.type;
    name = dependency.name;
    external = dependency.external;
    path = dependency.path;
    alias = dependency.alias;
    importAttributeType = dependency.importAttributeType;
    pos = dependency.pos;
  }

  /** Returns a fresh value because `Dependencies.push` may assign an alias. */
  public function copyForProjection(): Dependency {
    return {
      type: type,
      name: name,
      external: external,
      path: path,
      alias: alias,
      importAttributeType: importAttributeType,
      pos: pos
    };
  }
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
  public final importSpec: Null<DependencyImport>;
  public final provenance: DependencyProvenance;

  public function new(kind: DependencyEdgeKind,
      referencedType: Null<ModuleType>, importSpec: Null<DependencyImport>,
      provenance: DependencyProvenance) {
    this.kind = kind;
    this.referencedType = referencedType;
    this.importSpec = importSpec;
    this.provenance = provenance;
  }
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
 * expressions. Printers request a kind projection, which is routed through the
 * established collision-safe `Dependencies.push` implementation. The edge
 * array is defensively copied and exposed read-only; a plan never changes after
 * construction, making traversal and output deterministic for one compilation.
 */
class DependencyPlan {
  final edgeValues: Array<DependencyEdge>;

  public var edges(get, never): ReadOnlyArray<DependencyEdge>;

  public function new(edges: Array<DependencyEdge>) {
    edgeValues = edges.copy();
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
      final dependency = edge.importSpec.copyForProjection();
      dependencies.push(dependency.path, dependency);
    }
    return dependencies;
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
