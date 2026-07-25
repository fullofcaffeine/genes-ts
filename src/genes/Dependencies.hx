package genes;

import genes.util.TypeUtil;
import genes.util.GlobalTypes;
import haxe.macro.Type;
import genes.Module;
import genes.TypeAccessor;
import genes.SourceMapGenerator;
import haxe.macro.Context;
import haxe.ds.ReadOnlyArray;
import genes.BindingIdentity.BindingIdentity;
import genes.BindingIdentity.BindingOriginKey;
import genes.BindingIdentity.CompilerCapabilityId;
import genes.BindingIdentity.HaxeDeclarationKey;
import genes.BindingIdentity.ImportBindingFact;
import genes.BindingIdentity.LocalBindingIntent;
import genes.BindingIdentity.OriginBindingMapping;

enum DependencyType {
  DName;
  DDefault;
  DAsterisk;
}

/**
 * Import syntax and metadata before a projection chooses a local identifier.
 *
 * `memberPath` contains access after the imported root. For example,
 * `@:jsRequire("menu", "Dropdown.Item")` imports `Dropdown` and later reads
 * `.Item` from its collision-safe local. Keeping both pieces here prevents an
 * expression emitter from reparsing metadata and accidentally bypassing an
 * allocated alias.
 */
typedef DependencySpec = {
  type: DependencyType,
  name: String,
  external: Bool,
  path: String,
  memberPath: Array<String>,
  ?alias: String,
  ?importAttributeType: String,
  ?pos: SourcePosition
}

/** One projection-local binding with immutable semantic identity attached. */
typedef Dependency = {
  > DependencySpec,
  final bindingFact: ImportBindingFact;
}

/**
 * One unresolved import request derived from a typed Haxe declaration.
 *
 * Why: import spelling and module reachability used to be coupled through
 * `Dependencies.add`: callers received only the eventual string import and the
 * generator later attempted to reconstruct a Haxe type with `Context.getType`.
 * Keeping the original `ModuleType` beside the import request lets
 * `DependencyPlan` grow type/declaration graphs from compiler-owned refs and
 * report invalid edges deterministically.
 *
 * What/How: `dependency` is the pre-alias import request, `originType` is the
 * declaration the Haxe source named, and `referencedType` is the declaration
 * retained for reachability. Those differ for a local typedef that aliases an
 * imported type. `bindingFact` connects the source declaration to the exact
 * export/local intent before projection-specific alias allocation.
 */
typedef DependencyRequest = {
  final dependency: DependencySpec;
  final bindingFact: ImportBindingFact;
  final originType: ModuleType;
  final referencedType: ModuleType;
}

private typedef ModuleName = String;

class Dependencies {
  public final imports: Map<ModuleName, Array<Dependency>> = [];

  final module: Module;
  final runtime: Bool;
  final names: Array<{name: String, module: String}>;
  final allocated: Array<Dependency> = [];
  final originMappings: Array<OriginBindingMapping> = [];
  final aliasCount = new Map<String, Int>();

  public function new(module: Module, runtime = true) {
    this.module = module;
    this.runtime = runtime;
    this.names = [];
    for (member in module.members)
      switch member {
        case MClass(type, _, _):
          names.push({name: TypeUtil.className(type), module: type.module});
        case MEnum(et, _):
          // Treat enum constructor names as reserved identifiers in the module.
          //
          // This matters for TS output where enums are emitted via declaration
          // merging (`export declare namespace EnumName { export type Ctor = ... }`).
          // Without reserving ctor names, imported types that share a ctor name
          // (e.g. enum ctor `Assertion` and class `Assertion`) can become ambiguous
          // or recursively refer to themselves in generated TS types.
          names.push({name: et.name, module: et.module});
          for (ctorName in et.names)
            names.push({name: ctorName, module: et.module});
        case MType({name: name, module: module}, _):
          names.push({name: name, module: module});
        default:
      }
  }

  /**
   * Allocates or reuses the canonical binding for one immutable plan edge.
   *
   * Why: ordered request slots and expression type access must reference the
   * same collision-resolved local identifier. A `Void` push API forced callers
   * to reconstruct that binding from a path-grouped map and thereby lost the
   * original declaration order.
   *
   * What: repeated requests for the same exact export and requested local reuse
   * one object. Different exports remain different even when both prefer the
   * word `Foo`; the later one receives a stable `Foo__N` suffix. Two Haxe
   * declarations may still share a binding when they intentionally describe
   * the same JavaScript export.
   *
   * How: origin mappings are validated first, then local intent controls
   * de-duplication and collision allocation. Binding the same module export
   * through two different import attributes is rejected because the loader
   * contracts disagree; changing only the local alias cannot make them safe.
   * The returned object is the one both request planning and expression/type
   * lookup must use.
   */
  public function pushAndGet(module: String, dependency: Dependency,
      ?position: haxe.macro.Expr.Position): Dependency {
    final intent = dependency.bindingFact.localIntent;
    final mapping = dependency.bindingFact.originMapping;
    final diagnosticPosition = position == null ? Context.currentPos() : position;

    // One typed origin must keep one meaning throughout a projection. A second
    // equal mapping is ordinary repeated use; a different mapping means the
    // planner assigned one Haxe declaration or field to two JavaScript values.
    var knownOrigin = false;
    for (existing in originMappings) {
      if (!BindingIdentity.originsEqual(existing.origin, mapping.origin))
        continue;
      knownOrigin = true;
      if (!existing.localIntent.equals(mapping.localIntent)
        || !BindingIdentity.memberPathsEqual(existing.memberPath,
          mapping.memberPath)) {
        CompilerDiagnostic.fail(
          'GENES-IMPORT-ORIGIN-CONFLICT-001: '
          + BindingIdentity.originDescription(mapping.origin)
          + ' was assigned to two different JavaScript bindings',
          diagnosticPosition);
      }
      break;
    }
    if (!knownOrigin)
      originMappings.push(mapping);

    for (existing in allocated) {
      final existingIntent = existing.bindingFact.localIntent;
      if (BindingIdentity.attributeConflictKeyEquals(existingIntent, intent)
        && existing.importAttributeType != dependency.importAttributeType) {
        CompilerDiagnostic.fail(
          'GENES-IMPORT-ATTRIBUTE-BINDING-001: the '
          + BindingIdentity.selectorDescription(intent.exportBinding.selector)
          + ' from "' + intent.exportBinding.request.path
          + '" cannot use multiple loader attributes; local aliases do not '
          + 'create separate module requests',
          diagnosticPosition);
      }
      if (existingIntent.equals(intent))
        return existing;
    }

    /** Whether a local is already owned by source, a global, or another import. */
    function unavailable(candidate: String): Bool {
      if (GlobalTypes.exists(candidate))
        return true;
      for (named in names)
        if (named.name == candidate)
          return true;
      for (existing in allocated) {
        final local = existing.alias == null ? existing.name : existing.alias;
        if (local == candidate)
          return true;
      }
      return false;
    }

    var local = intent.requestedLocal;
    if (unavailable(local)) {
      var suffix = switch aliasCount[local] {
        case null: 0;
        case value: value;
      }
      do {
        suffix++;
        local = intent.requestedLocal + '__' + suffix;
      } while (unavailable(local));
      aliasCount[intent.requestedLocal] = suffix;
    }
    dependency.alias = local == dependency.name ? null : local;
    allocated.push(dependency);

    if (imports.exists(module))
      imports.get(module).push(dependency);
    else
      imports.set(module, [dependency]);
    return dependency;
  }

  /** Compatibility wrapper for lookup-only/declaration projections. */
  public function push(module: String, dependency: Dependency): Void {
    pushAndGet(module, dependency);
  }

  /**
   * Returns the final local names allocated for this import projection.
   *
   * An exact module-function name must not silently force an import alias (or
   * be shadowed by one). Allocation therefore finishes first, and the semantic
   * module-binding validator compares against this immutable snapshot before a
   * printer writes source.
   */
  public function localBindingNames():Array<String> {
    return [
      for (dependency in allocated)
        dependency.alias == null ? dependency.name : dependency.alias
    ];
  }

  /**
   * Groups bindings that can legally share one ESM import declaration.
   *
   * Why: an import attribute belongs to the whole declaration, not to one
   * named binding. Merging bindings with different attribute contracts either
   * drops runtime semantics or assigns the wrong loader contract to a sibling.
   *
   * What: dependencies with the same optional import-attribute type share a
   * deterministic group; first appearance controls group and member order.
   *
   * How: TS and classic printers call this after separating default/namespace
   * bindings, which already require their own declarations. Keeping grouping
   * here makes the target printers responsible only for syntax.
   */
  public static function groupByImportAttribute(imports: Array<Dependency>): Array<Array<Dependency>> {
    final groups:Array<Array<Dependency>> = [];
    for (dependency in imports) {
      var group:Null<Array<Dependency>> = null;
      for (candidate in groups)
        if (candidate[0].importAttributeType == dependency.importAttributeType) {
          group = candidate;
          break;
        }
      if (group == null) {
        group = [];
        groups.push(group);
      }
      group.push(dependency);
    }
    return groups;
  }

  /**
   * Returns the loader attribute shared by one already-grouped declaration.
   *
   * A null result means ordinary ESM. A mixed non-null group is an internal
   * invariant violation: fail closed instead of silently dropping one loader
   * contract. Callers should form groups with `groupByImportAttribute`, whose
   * exact comparison prevents that state.
   */
  public static function commonImportAttributeType(imports: Array<Dependency>): Null<String> {
    var result:Null<String> = null;
    for (dependency in imports) {
      if (dependency.importAttributeType == null)
        continue;
      if (result == null)
        result = dependency.importAttributeType;
      else if (result != dependency.importAttributeType)
        throw 'Cannot combine import attributes "${result}" and "${dependency.importAttributeType}" in one declaration.';
    }
    return result;
  }

  /**
   * Projects one typed Haxe declaration into its JavaScript module binding.
   *
   * Why: Haxe modules may contain several extern declarations, but sharing a
   * `.hx` file does not necessarily mean sharing a JavaScript package export.
   * Import ownership must follow metadata/runtime identity or a host global can
   * be shadowed by an unrelated sibling package.
   *
   * What: a declaration's own `@:jsRequire` is authoritative. An explicit
   * `@:native` without `@:jsRequire` is an independent host/global path and has
   * no package dependency. Only metadata-free secondary externs may reuse the
   * primary module type's package binding, which preserves declaration-only
   * module shapes such as Node's `Readable.IReadable`.
   *
   * How: resolve direct import forms first, then inspect the primary Haxe
   * module owner only for secondary externs with no explicit native identity.
   * The returned request remains target-neutral; TS and classic printers share
   * the later alias/import projection.
   */
  public static function makeDependency(base: BaseType): DependencySpec {
    final name = TypeUtil.baseTypeName(base);
    final explicitAlias = switch base.meta.extract(':genes.importAlias') {
      case [{params: [{expr: EConst(CString(alias))}]}]: alias;
      default: null;
    }
    final importAttributeType = extractImportAttributeType(base.meta);
    if (base.isExtern) {
      switch base.meta.extract(':jsRequire') {
        case [{params: [{expr: EConst(CString(path))}]}]:
          final cl = TypeUtil.classTypeForBase(base);
          final isWildcard = switch cl {
            case null:
              false;
            case cl:
              switch [cl.kind, cl.fields.get(), cl.statics.get()] {
                case [KAbstractImpl(_.get() => {meta: meta}), _, _]
                  if (meta.has(':enum')):
                  true;
                case [_, fields, statics]:
                  cl.kind.equals(KNormal)
                  && !cl.isInterface
                  && cl.superClass == null
                  && cl.constructor == null
                  && fields.length == 0
                  && statics.filter(st -> st.meta.has(':selfCall')).length == 0;
              }
          }

          return {
            type: if (isWildcard) DAsterisk else DDefault,
            name: name,
            path: path,
            external: true,
            memberPath: [],
            alias: explicitAlias,
            importAttributeType: importAttributeType,
            pos: base.pos
          }
        case [{params: [{expr: EConst(CString(path))}, {expr: EConst(CString('default'))}]}]:
          return {
            type: DDefault,
            name: name,
            path: path,
            external: true,
            memberPath: [],
            alias: explicitAlias,
            importAttributeType: importAttributeType,
            pos: base.pos
          }
        case [{params: [{expr: EConst(CString(path))}, {expr: EConst(CString(name))}]}]:
          final native = switch base.meta.extract(':native') {
            case [{params: [{expr: EConst(CString(native))}]}]:
              native;
            default: null;
          }
          // If we have a native name with a dot path we need a default import
          if (native != null && native.indexOf('.') > -1) {
            final nativeParts = native.split('.');
            return {
              type: DDefault,
              name: nativeParts.shift(),
              path: path,
              external: true,
              memberPath: nativeParts,
              alias: explicitAlias,
              importAttributeType: importAttributeType,
              pos: base.pos
            }
          }
          // benmerckx/genes#7
          if (name.indexOf('.') > -1) {
            final nameParts = name.split('.');
            return {
              type: DName,
              name: nameParts.shift(),
              path: path,
              external: true,
              memberPath: nameParts,
              alias: explicitAlias,
              importAttributeType: importAttributeType,
              pos: base.pos
            }
          }
          return {
            type: DName,
            name: name,
            path: path,
            external: true,
            memberPath: [],
            alias: explicitAlias,
            importAttributeType: importAttributeType,
            pos: base.pos
          }
        default:
          // Secondary externs often live beside a runtime owner in one Haxe
          // module without repeating its `@:jsRequire`, for example
          // `js.node.stream.Readable.IReadable`. They still denote the owner's
          // package export in generated TypeScript. Reuse that owner import and
          // alias it to the secondary Haxe name so signatures remain resolvable
          // without inventing a runtime dependency or downstream workaround.
          final declaredPath = base.pack.concat([base.name]).join('.');
          if (declaredPath != base.module) {
            // An explicit native path is already the complete runtime identity.
            // Standard Haxe does not infer a package dependency from physical
            // `.hx` co-location, so Genes must not do so either. This keeps host
            // globals independent while metadata-free secondary externs can
            // still reuse the primary module export below.
            if (TypeUtil.nativeName(base.meta) != null)
              return null;
            final moduleName = base.module.split('.').pop();
            for (moduleType in Context.getModule(base.module)) {
              switch moduleType {
                case TInst((_.get() : BaseType) => owner, _)
                  if (owner.name == moduleName
                    && owner.meta.has(':jsRequire')):
                  final dependency = makeDependency(owner);
                  if (dependency != null) {
                    dependency.alias = explicitAlias != null ? explicitAlias : name;
                    return dependency;
                  }
                default:
              }
            }
          }
          return null;
      }
    }
    return {
      type: DName,
      name: name,
      external: false,
      path: base.module,
      memberPath: [],
      alias: explicitAlias,
      importAttributeType: importAttributeType,
      pos: base.pos
    }
  }

  /**
   * Validates and reads the import-attribute metadata shared by both emitters.
   *
   * Why: TypeScript import attributes, such as `with { type: "json" }`, are a
   * runtime loader contract, not an optional formatting hint. Treating malformed
   * metadata as if it were absent can produce valid-looking output that fails
   * before application code starts. Validation therefore belongs in dependency
   * planning, before either output profile opens a public writer.
   *
   * What: an absent annotation returns `null`. A present annotation must occur
   * once and contain exactly one non-empty string literal; otherwise compilation
   * stops with a stable diagnostic at the offending source metadata.
   *
   * How: callers attach `@:genes.importAttributeType("json")` beside
   * `@:jsRequire`. The validated literal travels on `Dependency`, so TypeScript
   * and classic ESM retain the same request identity while choosing only their
   * profile-specific import syntax.
   */
  public static function extractImportAttributeType(meta: MetaAccess): Null<String> {
    final entries = meta.extract(':genes.importAttributeType');
    if (entries.length == 0)
      return null;
    final entry = entries[0];
    if (entries.length != 1 || entry.params.length != 1) {
      return CompilerDiagnostic.fail('GENES-IMPORT-ATTRIBUTE-ARITY-001: '
        + '@:genes.importAttributeType must appear once with exactly one '
        + 'string-literal argument',
        entry.pos);
    }
    final parameter = entry.params[0];
    return switch parameter.expr {
      case EConst(CString(value)):
        if (StringTools.trim(value).length == 0) {
          CompilerDiagnostic.fail('GENES-IMPORT-ATTRIBUTE-EMPTY-001: '
            + '@:genes.importAttributeType requires a non-empty string literal',
            parameter.pos);
        } else {
          value;
        }
      default:
        CompilerDiagnostic.fail('GENES-IMPORT-ATTRIBUTE-LITERAL-001: '
          + '@:genes.importAttributeType does not accept computed values',
          parameter.pos);
    }
  }

  /**
   * Resolves a typed declaration into import requests without mutating an
   * import table.
   *
   * This preserves Genes' existing extern, secondary-module, and local typedef
   * alias rules while allowing an immutable dependency graph to classify the
   * edge before aliases are allocated for a particular emission profile.
   */
  public static function requests(module: Module,
      type: ModuleType): Array<DependencyRequest> {
    switch type {
      case TClassDecl((_.get() : BaseType) => base) |
        TEnumDecl((_.get() : BaseType) => base) |
        TTypeDecl((_.get() : BaseType) => base):
        final dependency = makeDependency(base);
        if (dependency == null)
          return [];
        if (dependency.path != module.module)
          return [declarationRequest(dependency, type, type)];
        switch type {
          case TTypeDecl(_.get() => t)
            if (module.getMember(TypeUtil.baseTypeName(base)) == null):
            // import X in Y;
            final x = TypeUtil.typeToBaseType(t.type);
            if (x == null)
              return [];
            final y = makeDependency(x);
            if (y == null)
              return [];
            final referencedType = TypeUtil.typeToModuleType(t.type);
            if (referencedType == null)
              return [];
            y.alias = dependency.name;
            return [declarationRequest(y, type, referencedType)];
          default:
        }
      default:
    }
    return [];
  }

  /**
   * Creates declaration-backed identity only after import normalization ends.
   *
   * A local typedef may replace its first dependency with an underlying
   * package import and request the typedef's name as the local. Creating the
   * key before that substitution would identify the wrong module/export. The
   * source `originType` remains separate from `referencedType`, which continues
   * to own DCE and declaration reachability.
   */
  static function declarationRequest(dependency: DependencySpec,
      originType: ModuleType, referencedType: ModuleType): DependencyRequest {
    final origin = BindingOriginKey.HaxeDeclaration(
      HaxeDeclarationKey.fromModuleType(originType));
    return {
      dependency: dependency,
      bindingFact: BindingIdentity.create(dependency, origin),
      originType: originType,
      referencedType: referencedType
    };
  }

  public function add(type: ModuleType) {
    for (request in requests(module, type)) {
      final spec = request.dependency;
      final dependency: Dependency = {
        type: spec.type,
        name: spec.name,
        external: spec.external,
        path: spec.path,
        memberPath: spec.memberPath.copy(),
        alias: spec.alias,
        importAttributeType: spec.importAttributeType,
        pos: spec.pos,
        bindingFact: request.bindingFact
      };
      push(dependency.path, dependency);
    }
  }

  /**
   * Resolves one compiler origin through the exact projected binding.
   *
   * Lookup never starts from generated text. It first finds the immutable
   * origin mapping, then the equal local intent allocated for this projection,
   * and finally appends any dotted member path. A mapping without an allocation
   * is an internal planning error rather than permission to print a simple name.
   */
  public function resolveOrigin(origin: BindingOriginKey): Null<String> {
    for (mapping in originMappings) {
      if (!BindingIdentity.originsEqual(mapping.origin, origin))
        continue;
      final resolved = resolveIntent(mapping.localIntent, mapping.memberPath);
      if (resolved != null)
        return resolved;
      CompilerDiagnostic.fail(
        'GENES-IMPORT-BINDING-MISSING-001: the projected import for '
        + BindingIdentity.originDescription(origin)
        + ' was not allocated', Context.currentPos());
    }
    return null;
  }

  /**
   * Resolves a compiler-created Haxe import alias that has no ModuleType owner.
   *
   * Normal declarations always use origin lookup. Haxe's `import X in Alias`
   * can instead create a local `BaseType` without a declaration node; its exact
   * export form and requested local still provide a non-lossy lookup key.
   */
  public function resolveIntent(intent: LocalBindingIntent,
      memberPath: ReadOnlyArray<String>): Null<String> {
    for (dependency in allocated) {
      if (!dependency.bindingFact.localIntent.equals(intent))
        continue;
      var result = dependency.alias == null
        ? dependency.name
        : dependency.alias;
      for (member in memberPath)
        result += '.' + member;
      return result;
    }
    return null;
  }

  /** Resolves the reviewed JSX runtime capability without a name scan. */
  public function resolveCapability(id: CompilerCapabilityId): Null<String> {
    return resolveOrigin(BindingOriginKey.CompilerCapability(id));
  }

  public function typeAccessor(type: TypeAccessor)
    return switch type {
      case CoreAbstract(name) | DirectValue(name): name;
      case ImportedDeclaration(key, fallbackName, dependencyPath, external,
          pos):
        final origin = BindingOriginKey.HaxeDeclaration(key);
        final resolved = resolveOrigin(origin);
        if (resolved != null)
          return resolved;
        if (external || (dependencyPath != null
          && dependencyPath != module.module)) {
          return CompilerDiagnostic.fail(
            'GENES-IMPORT-BINDING-MISSING-001: no projected import exists for '
            + key.describe() + ' while emitting ' + module.module
            + ' (dependency path: ' + dependencyPath + ')', pos);
        }
        fallbackName;
      case ImportedAlias(intent, fallbackName, memberPath, dependencyPath,
          external, pos):
        final resolved = resolveIntent(intent, memberPath);
        if (resolved != null)
          return resolved;
        if (external || dependencyPath != module.module) {
          return CompilerDiagnostic.fail(
            'GENES-IMPORT-BINDING-MISSING-001: no projected import exists for Haxe alias '
            + fallbackName + ' while emitting ' + module.module, pos);
        }
        fallbackName;
      case ImportedStaticField(key, fallbackName, pos):
        final origin = BindingOriginKey.StaticField(key);
        final resolved = resolveOrigin(origin);
        if (resolved == null)
          CompilerDiagnostic.fail(
            'GENES-IMPORT-BINDING-MISSING-001: no projected import exists for '
            + key.describe(), pos)
        else
          resolved;
    }
}
