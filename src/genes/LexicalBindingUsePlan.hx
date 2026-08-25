package genes;

#if macro
import genes.BindingIdentity.HaxeDeclarationKey;
import genes.DynamicImportBindingPlan.DynamicImportBindingToken;
import genes.Module.FieldKind;
import genes.RuntimeTypeOccurrenceCollector.RuntimeTypeOccurrence;
import genes.TypeAccessor.TypeAccessorImpl;
import genes.util.TypeUtil;
import haxe.ds.ObjectMap;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;

using haxe.macro.TypedExprTools;

/** Selects only the implementation-profile spelling of one runtime root. */
enum abstract LexicalBindingProfile(String) to String {
  var ClassicLexicalBindings = "classic";
  var TypeScriptLexicalBindings = "typescript";
}

private enum LexicalRuntimeAuthority {
  Accessor(value: TypeAccessor);
  DirectBinding(name: String);
  DynamicBinding(originKey: String, localName: String);
}

private enum abstract RuntimeProfileMask(Int) from Int to Int {
  var BothProfiles = 0;
  var ClassicProfileOnly = 1;
  var TypeScriptProfileOnly = 2;
}

private typedef MutableLexicalScope = {
  final id: Int;
  final entry: Int;
  final parentId: Null<Int>;
  var exit: Int;
  var opaque: Bool;
}

private typedef RuntimeAuthorityOccurrence = {
  final scopeId: Int;
  final authority: LexicalRuntimeAuthority;
  final profile: RuntimeProfileMask;
}

private typedef ScopedBinding = {
  final scopeId: Int;
  final name: String;
}

#if genes.lexical_binding_inventory
private typedef QueryInventoryProbe = {
  final group: String;
  final role: String;
  final candidates: Array<String>;
  final expression: TypedExpr;
  final func: Null<TFunc>;
}

private typedef QueryInventoryGroup = {
  final id: String;
  final candidates: Array<String>;
  final uses: Array<TypedExpr>;
  final expressionProbes: Array<{label: String, expression: TypedExpr}>;
  final functionProbes: Array<{label: String, func: TFunc}>;
  var declaration: Null<TypedExpr>;
}
#end

/** Deterministic structural evidence for the bounded plan walk. */
typedef LexicalBindingUseCounts = {
  final expressions: Int;
  final scopes: Int;
  final runtimeAuthorities: Int;
  final fixedBindings: Int;
  final opaqueScopes: Int;
}

/**
 * One compiler-created binding request against a frozen lexical scope graph.
 *
 * The request contains no naming policy. `NamePlan` supplies a preferred name,
 * asks whether it conflicts, and reserves the final name in scopes that
 * capture one of the exact synthetic uses.
 */
final class LexicalBindingRequest {
  final plan: LexicalBindingUsePlan;
  final declarationScopeId: Int;
  final useScopeIds: Array<Int>;
  final capturedFunctionScopeIds: Map<Int, Bool>;

  public function new(plan: LexicalBindingUsePlan, declarationScopeId: Int,
      useScopeIds: Array<Int>) {
    this.plan = plan;
    this.declarationScopeId = declarationScopeId;
    this.useScopeIds = useScopeIds.copy();
    capturedFunctionScopeIds = plan.capturedFunctionScopes(declarationScopeId,
      this.useScopeIds);
  }

  /** True when arbitrary target text is visible from the declaration. */
  public function hasOpaqueRegion(): Bool {
    return plan.hasOpaqueDescendant(declarationScopeId);
  }

  /** Whether this exact candidate would change lexical resolution. */
  public function conflicts(name: String,
      profile: LexicalBindingProfile): Bool {
    return plan.hasRuntimeRoot(declarationScopeId, name, profile)
      || plan.hasFixedBindingOnUsePath(declarationScopeId, useScopeIds, name);
  }

  /** Whether an exact function body must reserve the allocated binding. */
  public function capturedByFunction(func: TFunc): Bool {
    final scopeId = plan.functionScopeId(func);
    return scopeId != null && capturedFunctionScopeIds.exists(scopeId);
  }

  /** Visits each exact function on a synthetic use's capture path once. */
  public function forEachCapturingFunction(visit: TFunc->Void): Void {
    plan.forEachFunctionScope(capturedFunctionScopeIds, visit);
  }

  /** Whether an exact block/case scope must reserve the allocated binding. */
  public function capturedByExpression(expression: TypedExpr): Bool {
    final scopeId = plan.expressionScopeId(expression);
    return scopeId != null
      && plan.scopeCapturesUse(declarationScopeId, useScopeIds, scopeId);
  }
}

/**
 * Exact runtime-binding and lexical-scope authority for synthetic names.
 *
 * Why: a compiler-created local has no authored `TVar`, so ordinary local-name
 * allocation cannot see imports, direct native roots, lazy callback locals,
 * checked-cast targets, or runtime owners added by lowering. Reconstructing
 * those authorities in each consumer leads to an open-ended expression scan.
 *
 * What: this request-local plan records the function and case scopes used by
 * `NamePlan`, one structured authority for every runtime value occurrence,
 * each fixed dynamic-import callback binding, and every opaque target-syntax scope.
 * Runtime roots retain `TypeAccessor` identity until a profile projection has
 * finalized import aliases and host-global spelling.
 *
 * How: one source-order walk keys expressions and functions by typed object
 * identity. Scope intervals answer descendant queries; parent links enumerate
 * each function on a synthetic use path once without rescanning function
 * bodies. Dynamic-import tokens form a scoped environment and take precedence
 * over static dependencies. The plan is built only after a consumer explicitly
 * requests synthetic-name hygiene.
 */
@:allow(genes.LexicalBindingRequest)
@:allow(genes.LexicalBindingUsePlanBuilder)
final class LexicalBindingUsePlan {
  final module: Module;
  final scopes: Array<MutableLexicalScope>;
  final expressionScopes: ObjectMap<TypedExpr, Int>;
  final functionScopes: ObjectMap<TFunc, Int>;
  final scopeFunctions: Map<Int, TFunc>;
  final occurrences: Array<RuntimeAuthorityOccurrence>;
  final moduleOccurrences: Array<RuntimeAuthorityOccurrence>;
  final expressionOccurrences: ObjectMap<TypedExpr,
    Array<RuntimeAuthorityOccurrence>>;
  final fixedBindings: Array<ScopedBinding>;
  final countsValue: LexicalBindingUseCounts;
  final rootIndexes: Map<String, Map<String, Array<Int>>> = [];
  #if genes.lexical_binding_inventory
  var queryProbes: Array<QueryInventoryProbe> = [];
  #end

  public static function build(module: Module): LexicalBindingUsePlan {
    return new LexicalBindingUsePlanBuilder(module).build();
  }

  public function new(module: Module, scopes: Array<MutableLexicalScope>,
      expressionScopes: ObjectMap<TypedExpr, Int>,
      functionScopes: ObjectMap<TFunc, Int>, scopeFunctions: Map<Int, TFunc>,
      occurrences: Array<RuntimeAuthorityOccurrence>,
      moduleOccurrences: Array<RuntimeAuthorityOccurrence>,
      expressionOccurrences: ObjectMap<TypedExpr,
      Array<RuntimeAuthorityOccurrence>>,
      fixedBindings: Array<ScopedBinding>, counts: LexicalBindingUseCounts) {
    this.module = module;
    this.scopes = scopes;
    this.expressionScopes = expressionScopes;
    this.functionScopes = functionScopes;
    this.scopeFunctions = scopeFunctions;
    this.occurrences = occurrences;
    this.moduleOccurrences = moduleOccurrences;
    this.expressionOccurrences = expressionOccurrences;
    this.fixedBindings = fixedBindings;
    this.countsValue = counts;
  }

  /** Creates a query from exact declaration and synthetic-use occurrences. */
  public function request(declaration: TypedExpr,
      uses: Array<TypedExpr>): LexicalBindingRequest {
    final declarationScope = expressionScopes.get(declaration);
    if (declarationScope == null)
      return
        CompilerDiagnostic.fail('GTS-LEXICAL-BINDING-PLAN-001: a synthetic binding declaration was not registered',
        declaration.pos);
    final useScopes: Array<Int> = [];
    for (use in uses) {
      final scopeId = expressionScopes.get(use);
      if (scopeId == null)
        return
          CompilerDiagnostic.fail('GTS-LEXICAL-BINDING-PLAN-002: a synthetic binding use was not registered',
          use.pos);
      if (!isDescendant(declarationScope, scopeId))
        return
          CompilerDiagnostic.fail('GTS-LEXICAL-BINDING-PLAN-003: a synthetic binding use is outside its declaration scope',
          use.pos);
      if (useScopes.indexOf(scopeId) == -1)
        useScopes.push(scopeId);
    }
    return new LexicalBindingRequest(this, declarationScope, useScopes);
  }

  /** Returns immutable operation counts for focused complexity evidence. */
  public function counts(): LexicalBindingUseCounts {
    return {
      expressions: countsValue.expressions,
      scopes: countsValue.scopes,
      runtimeAuthorities: countsValue.runtimeAuthorities,
      fixedBindings: countsValue.fixedBindings,
      opaqueScopes: countsValue.opaqueScopes
    };
  }

  #if genes.lexical_binding_inventory
  /** Emits deterministic plan facts for the focused compiler fixture only. */
  public function inventoryDescriptions(profile: LexicalBindingProfile): Array<String> {
    final descriptions: Array<String> = [];
    final roots = rootIndex(profile);
    final names = [for (name in roots.keys()) name];
    names.sort(compareStrings);
    for (name in names)
      descriptions.push('root:$name:${roots.get(name).join(",")}');
    for (scope in scopes)
      if (scope.opaque)
        descriptions.push('opaque:${scope.id}:${scope.entry}-${scope.exit}');
    for (binding in fixedBindings)
      descriptions.push('fixed:${binding.scopeId}:${binding.name}');
    return descriptions;
  }

  /** Exercises every exact query through compiler-owned fixture markers. */
  public function queryInventoryDescriptions(profile: LexicalBindingProfile): Array<String> {
    final groups: Map<String, QueryInventoryGroup> = [];
    for (probe in queryProbes) {
      if (!groups.exists(probe.group))
        groups.set(probe.group, {
          id: probe.group,
          candidates: [],
          uses: [],
          expressionProbes: [],
          functionProbes: [],
          declaration: null
        });
      final group = groups.get(probe.group);
      switch probe.role {
        case 'declaration':
          if (group.declaration != null)
            CompilerDiagnostic.fail('GTS-LEXICAL-BINDING-PLAN-006: duplicate query declaration marker for '
              + group.id,
              probe.expression.pos);
          group.declaration = probe.expression;
          for (candidate in probe.candidates)
            group.candidates.push(candidate);
        case 'use':
          group.uses.push(probe.expression);
        case role if (role.indexOf('scope-') == 0):
          group.expressionProbes.push({
            label: role.substr('scope-'.length),
            expression: probe.expression
          });
        case role if (role.indexOf('function-') == 0):
          if (probe.func == null)
            CompilerDiagnostic.fail('GTS-LEXICAL-BINDING-PLAN-006: query function marker is outside a function',
              probe.expression.pos);
          group.functionProbes.push({
            label: role.substr('function-'.length),
            func: probe.func
          });
        default:
          CompilerDiagnostic.fail('GTS-LEXICAL-BINDING-PLAN-006: unknown query marker role '
            + probe.role,
            probe.expression.pos);
      }
    }

    final descriptions: Array<String> = [];
    final ids = [for (id in groups.keys()) id];
    ids.sort(compareStrings);
    for (id in ids) {
      final group = groups.get(id);
      if (group.declaration == null || group.uses.length == 0)
        CompilerDiagnostic.fail('GTS-LEXICAL-BINDING-PLAN-006: incomplete query marker group '
          + id,
          group.declaration == null ? Context.currentPos() : group.declaration.pos);
      final request = request(group.declaration, group.uses);
      descriptions.push('query:$id:opaque:${request.hasOpaqueRegion()}');
      var capturingFunctions = 0;
      request.forEachCapturingFunction(_ -> capturingFunctions++);
      descriptions.push('query:$id:function-captures:$capturingFunctions');
      for (candidate in group.candidates)
        descriptions.push('query:$id:conflict:$candidate:'
          + request.conflicts(candidate, profile));
      for (probe in group.functionProbes)
        descriptions.push('query:$id:function:${probe.label}:'
          + request.capturedByFunction(probe.func));
      for (probe in group.expressionProbes)
        descriptions.push('query:$id:scope:${probe.label}:'
          + request.capturedByExpression(probe.expression));
    }
    return descriptions;
  }

  static function compareStrings(left: String, right: String): Int {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  #end

  /**
   * Fails when an expression emitter requests an authority the plan omitted.
   *
   * Dynamic callback tokens are checked before static accessors, mirroring the
   * emitter environment. This method is inert unless a module requested this
   * plan, so ordinary modules do not pay an assertion lookup cost.
   */
  public function assertRuntimeAccessor(expression: TypedExpr,
      accessor: TypeAccessor, dynamicTokens: Array<String>,
      profile: LexicalBindingProfile): Void {
    final expected = dynamicAuthority(accessor,
      decodeDynamicTokens(dynamicTokens));
    final registered = expressionOccurrences.get(expression);
    if (registered != null)
      for (occurrence in registered)
        if (profileMatches(occurrence.profile, profile)
          && authoritiesEqual(occurrence.authority, expected))
          return;
    CompilerDiagnostic.fail('GTS-LEXICAL-BINDING-PLAN-004: expression emission requested an unregistered runtime binding authority '
      + authorityKey(expected),
      expression.pos);
  }

  /** Same fail-closed assertion for an exact bare runtime identifier. */
  public function assertDirectBinding(expression: TypedExpr, name: String,
      profile: LexicalBindingProfile): Void {
    final expected = DirectBinding(name);
    final registered = expressionOccurrences.get(expression);
    if (registered != null)
      for (occurrence in registered)
        if (profileMatches(occurrence.profile, profile)
          && authoritiesEqual(occurrence.authority, expected))
          return;
    CompilerDiagnostic.fail('GTS-LEXICAL-BINDING-PLAN-004: expression emission requested an unregistered direct runtime binding '
      + name,
      expression.pos);
  }

  /** Fails when module structure emits an unregistered runtime accessor. */
  public function assertModuleRuntimeAccessor(accessor: TypeAccessor,
      profile: LexicalBindingProfile): Void {
    assertModuleAuthority(Accessor(accessor), profile,
      'runtime binding authority ' + authorityKey(Accessor(accessor)));
  }

  /** Fails when module structure emits an unregistered bare runtime root. */
  public function assertModuleDirectBinding(name: String,
      profile: LexicalBindingProfile): Void {
    assertModuleAuthority(DirectBinding(name), profile,
      'direct runtime binding ' + name);
  }

  function assertModuleAuthority(expected: LexicalRuntimeAuthority,
      profile: LexicalBindingProfile, description: String): Void {
    for (occurrence in moduleOccurrences)
      if (profileMatches(occurrence.profile, profile)
        && authoritiesEqual(occurrence.authority, expected))
        return;
    CompilerDiagnostic.fail('GTS-LEXICAL-BINDING-PLAN-004: module '
      + module.module
      + ' emission requested an unregistered '
      + description,
      Context.currentPos());
  }

  function expressionScopeId(expression: TypedExpr): Null<Int> {
    return expressionScopes.get(expression);
  }

  function functionScopeId(func: TFunc): Null<Int> {
    return functionScopes.get(func);
  }

  /** Precomputes function scopes on exact use-to-declaration paths. */
  function capturedFunctionScopes(declarationScopeId: Int,
      useScopeIds: Array<Int>): Map<Int, Bool> {
    final result: Map<Int, Bool> = [];
    for (useScopeId in useScopeIds) {
      var currentScopeId: Null<Int> = useScopeId;
      while (currentScopeId != null) {
        if (scopeFunctions.exists(currentScopeId))
          result.set(currentScopeId, true);
        if (currentScopeId == declarationScopeId)
          break;
        currentScopeId = scopes[currentScopeId].parentId;
      }
    }
    return result;
  }

  /** Visits each precomputed function scope once. */
  function forEachFunctionScope(scopeIds: Map<Int, Bool>,
      visit: TFunc->Void): Void {
    for (scopeId in scopeIds.keys()) {
      final func = scopeFunctions.get(scopeId);
      if (func != null)
        visit(func);
    }
  }

  function hasOpaqueDescendant(declarationScopeId: Int): Bool {
    for (scope in scopes)
      if (scope.opaque && isDescendant(declarationScopeId, scope.id))
        return true;
    return false;
  }

  function hasRuntimeRoot(declarationScopeId: Int, name: String,
      profile: LexicalBindingProfile): Bool {
    final roots = rootIndex(profile);
    final entries = roots.get(name);
    if (entries == null)
      return false;
    final declaration = scopes[declarationScopeId];
    for (entry in entries)
      if (entry >= declaration.entry && entry <= declaration.exit)
        return true;
    return false;
  }

  function hasFixedBindingOnUsePath(declarationScopeId: Int,
      useScopeIds: Array<Int>, name: String): Bool {
    for (binding in fixedBindings) {
      if (binding.name != name
        || !isDescendant(declarationScopeId, binding.scopeId))
        continue;
      for (useScopeId in useScopeIds)
        if (isDescendant(binding.scopeId, useScopeId))
          return true;
    }
    return false;
  }

  function scopeCapturesUse(declarationScopeId: Int, useScopeIds: Array<Int>,
      candidateScopeId: Int): Bool {
    if (!isDescendant(declarationScopeId, candidateScopeId))
      return false;
    for (useScopeId in useScopeIds)
      if (isDescendant(candidateScopeId, useScopeId))
        return true;
    return false;
  }

  function isDescendant(ancestorId: Int, candidateId: Int): Bool {
    final ancestor = scopes[ancestorId];
    final candidate = scopes[candidateId];
    return candidate.entry >= ancestor.entry
      && candidate.entry <= ancestor.exit;
  }

  function rootIndex(profile: LexicalBindingProfile): Map<String, Array<Int>> {
    final key = Std.string(profile);
    if (rootIndexes.exists(key))
      return rootIndexes.get(key);
    final result: Map<String, Array<Int>> = [];
    final dependencies = profile == TypeScriptLexicalBindings ? module.implementationProjection.bindings : module.runtimeProjection.bindings;
    for (occurrence in occurrences) {
      if (!profileMatches(occurrence.profile, profile))
        continue;
      final root = switch occurrence.authority {
        case Accessor(accessor):
          dependencies.shadowableRoot(accessor,
            profile == TypeScriptLexicalBindings);
        case DirectBinding(name) | DynamicBinding(_, name):
          name;
      };
      if (root == null)
        continue;
      if (!result.exists(root))
        result.set(root, []);
      final entry = scopes[occurrence.scopeId].entry;
      final entries = result.get(root);
      if (entries.length == 0 || entries[entries.length - 1] != entry)
        entries.push(entry);
    }
    rootIndexes.set(key, result);
    return result;
  }

  static function profileMatches(mask: RuntimeProfileMask,
      profile: LexicalBindingProfile): Bool {
    return mask == BothProfiles
      || (mask == ClassicProfileOnly && profile == ClassicLexicalBindings)
      || (mask == TypeScriptProfileOnly && profile == TypeScriptLexicalBindings);
  }

  static function authorityKey(authority: LexicalRuntimeAuthority): String {
    return switch authority {
      case Accessor(accessor): 'accessor:'
        + TypeAccessor.authorityKey(accessor);
      case DirectBinding(name): 'direct-binding:$name';
      case DynamicBinding(origin, localName): 'dynamic:$origin:$localName';
    }
  }

  static function authoritiesEqual(left: LexicalRuntimeAuthority,
      right: LexicalRuntimeAuthority): Bool {
    return switch [left, right] {
      case [Accessor(leftValue), Accessor(rightValue)]:
        TypeAccessor.authorityEquals(leftValue, rightValue);
      case [DirectBinding(leftName), DirectBinding(rightName)]:
        leftName == rightName;
      case [DynamicBinding(leftOrigin,
        leftName), DynamicBinding(rightOrigin, rightName)]: leftOrigin == rightOrigin && leftName == rightName;
      default:
        false;
    }
  }

  static function decodeDynamicTokens(values: Array<String>): Array<DynamicImportBindingToken> {
    final result: Array<DynamicImportBindingToken> = [];
    for (value in values) {
      final token = DynamicImportBindingPlan.decode(value);
      if (token != null)
        result.push(token);
    }
    return result;
  }

  static function dynamicAuthority(accessor: TypeAccessor,
      tokens: Array<DynamicImportBindingToken>): LexicalRuntimeAuthority {
    for (offset in 0...tokens.length) {
      final token = tokens[tokens.length - offset - 1];
      final match = dynamicMatch(accessor, token);
      if (match != null)
        return match;
    }
    return Accessor(accessor);
  }

  static function dynamicMatch(accessor: TypeAccessor,
      token: DynamicImportBindingToken): Null<LexicalRuntimeAuthority> {
    return switch [accessor, token] {
      case [
        ImportedDeclaration(key, _, _, _, _),
        Declaration(kind, module, name, localName, _)
      ] if (Std.string(key.kind) == kind && key.module == module
        && key.name == name):
        DynamicBinding('declaration:$kind:$module:$name', localName);
      case [
        ImportedStaticField(key, _, _),
        StaticField(ownerModule, ownerName, fieldName, localName, _)
      ]
        if (key.ownerModule == ownerModule && key.ownerName == ownerName
          && key.fieldName == fieldName):
        DynamicBinding('static-field:$ownerModule:$ownerName:$fieldName',
          localName);
      default:
        null;
    }
  }
}

/** Mutable source-order collector discarded after plan construction. */
private final class LexicalBindingUsePlanBuilder {
  final module: Module;
  final scopes: Array<MutableLexicalScope> = [];
  final expressionScopes = new ObjectMap<TypedExpr, Int>();
  final functionScopes = new ObjectMap<TFunc, Int>();
  final scopeFunctions: Map<Int, TFunc> = [];
  final occurrences: Array<RuntimeAuthorityOccurrence> = [];
  final moduleOccurrences: Array<RuntimeAuthorityOccurrence> = [];
  final expressionOccurrences = new ObjectMap<TypedExpr,
    Array<RuntimeAuthorityOccurrence>>();
  final fixedBindings: Array<ScopedBinding> = [];
  var expressionCount = 0;
  var currentClass: Null<ClassType> = null;
  #if genes.lexical_binding_inventory
  final queryProbes: Array<QueryInventoryProbe> = [];
  var currentFunction: Null<TFunc> = null;
  #end

  public function new(module: Module) {
    this.module = module;
  }

  public function build(): LexicalBindingUsePlan {
    scopes.push({
      id: 0,
      entry: 0,
      parentId: null,
      exit: 0,
      opaque: false
    });
    registerModuleGlobalAuthority();
    for (member in module.members) {
      final projection = Module.memberProjection(member);
      switch member {
        case MClass(owner, _, fields):
          currentClass = owner;
          registerClassRuntimeAuthorities(owner, fields, projection);
          for (field in fields)
            if (field.expr != null)
              visit(field.expr, 0, []);
          if (owner.init != null)
            visit(owner.init, 0, []);
          currentClass = null;
        case MMain(expression):
          visit(expression, 0, []);
        case MEnum(owner, _):
          registerEnumRuntimeAuthorities(owner, projection);
        case MType(_, _):
      }
    }
    scopes[0].exit = scopes.length - 1;
    var opaqueCount = 0;
    for (scope in scopes)
      if (scope.opaque)
        opaqueCount++;
    final plan = new LexicalBindingUsePlan(module, scopes, expressionScopes,
      functionScopes, scopeFunctions, occurrences, moduleOccurrences,
      expressionOccurrences, fixedBindings, {
        expressions: expressionCount,
        scopes: scopes.length,
        runtimeAuthorities: occurrences.length,
        fixedBindings: fixedBindings.length,
        opaqueScopes: opaqueCount
      });
    #if genes.lexical_binding_inventory
    plan.queryProbes = queryProbes;
    #end
    return plan;
  }

  function registerModuleGlobalAuthority(): Void {
    if (module.module == 'genes.Register'
      || !module.hasFeature('js.Lib.global'))
      return;
    var classicEmitsModule = module.expose.length > 0;
    var typeScriptHasRuntimeCode = false;
    for (member in module.members)
      switch member {
        case MType(_, _):
        case MClass(owner, _, _) if (owner.isInterface):
          classicEmitsModule = true;
        default:
          classicEmitsModule = true;
          typeScriptHasRuntimeCode = true;
      }
    if (classicEmitsModule)
      recordAccessor(null, TypeUtil.registerType, 0, ClassicProfileOnly, []);
    if (typeScriptHasRuntimeCode)
      recordAccessor(null, TypeUtil.registerType, 0, TypeScriptProfileOnly, []);
  }

  function visit(expression: TypedExpr, scopeId: Int,
      dynamicTokens: Array<DynamicImportBindingToken>,
      suppressPromiseNullCast = false): Void {
    if (expression == null)
      return;
    expressionCount++;
    expressionScopes.set(expression, scopeId);

    #if genes.lexical_binding_inventory
    final queryMarker = CompilerInternal.lexicalBindingQueryMarkerCall(expression);
    if (queryMarker != null) {
      queryProbes.push({
        group: queryMarker.group,
        role: queryMarker.role,
        candidates: queryMarker.candidates,
        expression: expression,
        func: currentFunction
      });
      return;
    }
    #end

    if (CompilerInternal.isSideEffectImportMarkerCall(expression))
      return;
    final dynamicDeclaration = CompilerInternal.dynamicBindingDeclarationMarkerCall(expression);
    if (dynamicDeclaration != null) {
      var authenticated = false;
      for (token in dynamicTokens)
        if (DynamicImportBindingPlan.encode(token) == dynamicDeclaration.token) {
          authenticated = true;
          break;
        }
      if (!authenticated)
        CompilerDiagnostic.fail('GTS-LEXICAL-BINDING-PLAN-005: a dynamic callback declaration has no active binding token',
          expression.pos);
      return;
    }

    switch expression.expr {
      case TFunction(func):
        visitFunction(func, scopeId, dynamicTokens, [],
          suppressPromiseNullCast);

      case TCall({
        expr: TField(_,
          FStatic(_.get() => {module: 'genes.Genes'},
            _.get() => {name: 'ignore'}))
      }, [{expr: TArrayDecl(encoded)}, {expr: TFunction(func)}]):
        final nestedTokens = dynamicTokens.copy();
        final fixed: Array<String> = [];
        for (value in encoded)
          switch value.expr {
            case TConst(TString(text)):
              final token = DynamicImportBindingPlan.decode(text);
              if (token != null) {
                nestedTokens.push(token);
                final localName = tokenLocalName(token);
                if (fixed.indexOf(localName) == -1)
                  fixed.push(localName);
              }
            default:
          }
        visitFunction(func, scopeId, nestedTokens, fixed,
          suppressPromiseNullCast);

      case TSwitch(condition, cases, fallback):
        visit(condition, scopeId, dynamicTokens, suppressPromiseNullCast);
        for (entry in cases) {
          for (value in entry.values)
            visit(value, scopeId, dynamicTokens, suppressPromiseNullCast);
          final child = createScope([], scopeId);
          visit(entry.expr, child, dynamicTokens, suppressPromiseNullCast);
          closeScope(child);
        }
        if (fallback != null) {
          final child = createScope([], scopeId);
          visit(fallback, child, dynamicTokens, suppressPromiseNullCast);
          closeScope(child);
        }

      case TCall(callee, arguments)
        if (isGlobalSyntaxMarker(callee, arguments)):
        recordAccessor(expression, TypeUtil.registerType, scopeId,
          BothProfiles, dynamicTokens);

      case TCall(callee, arguments) if (isOpaqueSyntax(callee)):
        markOpaque(scopeId);
        for (argument in arguments)
          visit(argument, scopeId, dynamicTokens, suppressPromiseNullCast);

      case TCall(callee, _)
        if (CompilerInternal.isDynamicImportMarkerCallee(callee)):
        null;

      case TCall(callee, arguments) if (isKnownCompilerIdent(callee)):
        for (argument in arguments)
          visit(argument, scopeId, dynamicTokens, suppressPromiseNullCast);

      case TCall(callee, arguments):
        registerCallLowering(expression, callee, scopeId, dynamicTokens);
        final suppressNestedNullCast = suppressPromiseNullCast
          || TypeUtil.isJsPromiseResolveCallee(callee);
        visit(callee, scopeId, dynamicTokens, suppressNestedNullCast);
        for (argument in arguments)
          visit(argument, scopeId, dynamicTokens, suppressNestedNullCast);

      case TNew(_, _, arguments):
        recordExactAuthorities(expression, scopeId, dynamicTokens);
        for (argument in arguments)
          visit(argument, scopeId, dynamicTokens, suppressPromiseNullCast);

      case TCast(inner, target) if (target != null):
        recordExactAuthorities(expression, scopeId, dynamicTokens);
        visit(inner, scopeId, dynamicTokens, suppressPromiseNullCast);

      case TField(_, FStatic(ownerRef, fieldRef))
        if (isDirectStaticOccurrence(ownerRef, fieldRef)):
        recordExactAuthorities(expression, scopeId, dynamicTokens);

      case TField(_, FStatic(ownerRef, fieldRef))
        if (isBareStaticOwner(ownerRef.get())):
        recordDirect(expression, fieldRef.get().name, scopeId, BothProfiles);

      case TTypeExpr(_):
        recordExactAuthorities(expression, scopeId, dynamicTokens);

      case TField(receiver, field):
        registerFieldLowering(expression, receiver, field, scopeId,
          dynamicTokens);
        visit(receiver, scopeId, dynamicTokens, suppressPromiseNullCast);

      case TIdent("$hxEnums" | "$hxClasses"):
        recordAccessor(expression, TypeUtil.registerType, scopeId,
          BothProfiles, dynamicTokens);

      case TIdent(_):
        markOpaque(scopeId);

      default:
        expression.iter(child -> visit(child, scopeId, dynamicTokens,
          suppressPromiseNullCast));
    }

    registerTypeScriptLowering(expression, scopeId, dynamicTokens,
      suppressPromiseNullCast);
  }

  function markOpaque(scopeId: Int): Void {
    scopes[scopeId].opaque = true;
  }

  function visitFunction(func: TFunc, parentScopeId: Int,
      dynamicTokens: Array<DynamicImportBindingToken>, fixed: Array<String>,
      suppressPromiseNullCast = false): Void {
    final scopeId = createScope(fixed, parentScopeId);
    functionScopes.set(func, scopeId);
    scopeFunctions.set(scopeId, func);
    #if genes.lexical_binding_inventory
    final previousFunction = currentFunction;
    currentFunction = func;
    #end
    visit(func.expr, scopeId, dynamicTokens, suppressPromiseNullCast);
    #if genes.lexical_binding_inventory
    currentFunction = previousFunction;
    #end
    closeScope(scopeId);
  }

  function createScope(fixed: Array<String>, parentId: Int): Int {
    final id = scopes.length;
    final copied = fixed.copy();
    scopes.push({
      id: id,
      entry: id,
      parentId: parentId,
      exit: id,
      opaque: false
    });
    for (name in copied)
      fixedBindings.push({scopeId: id, name: name});
    return id;
  }

  function closeScope(scopeId: Int): Void {
    scopes[scopeId].exit = scopes.length - 1;
  }

  function recordExactAuthorities(expression: TypedExpr, scopeId: Int,
      dynamicTokens: Array<DynamicImportBindingToken>): Void {
    #if genes.lexical_binding_missing_probe
    switch expression.expr {
      case TNew(ownerRef, _, _)
        if (ownerRef.get().meta.has(':genesLexicalBindingMissingProbe')
          || ownerRef.get().meta.has('genesLexicalBindingMissingProbe')):
        return;
      default:
    }
    #end
    switch expression.expr {
      case TField(_, FStatic(ownerRef, fieldRef))
        if (fieldRef.get().meta.has(':jsRequire')):
        recordAccessor(expression,
          TypeAccessor.forStaticField(ownerRef.get(), fieldRef.get()),
          scopeId, BothProfiles, dynamicTokens);
        return;
      default:
    }
    final exact = RuntimeTypeOccurrenceCollector.collectExact(expression,
      (owner, field) -> module.resolveModuleFunction(owner, field),
      (owner, field) -> {
        if (!DirectModuleBinding.isModuleFieldsOwner(owner.get()))
          return null;
        return ModuleValuePlan.requestedName(field.get());
      });
    for (occurrence in exact)
      switch occurrence {
        case RuntimeType(type):
          recordAccessor(expression, (type : TypeAccessor), scopeId,
            BothProfiles, dynamicTokens);
        case DirectModuleFunction(ownerRef, fieldRef, request):
          if (ownerRef.get().module == module.module)
            recordDirect(expression, request.requestedName, scopeId,
              BothProfiles);
          else
            recordAccessor(expression,
              TypeAccessor.forStaticFieldBinding(ownerRef.get(),
                fieldRef.get(), request.requestedName),
              scopeId, BothProfiles, dynamicTokens);
        case DirectModuleValue(ownerRef, fieldRef, requestedName):
          if (ownerRef.get().module == module.module)
            recordDirect(expression, requestedName, scopeId, BothProfiles);
          else
            recordAccessor(expression,
              TypeAccessor.forStaticFieldBinding(ownerRef.get(),
                fieldRef.get(), requestedName),
              scopeId, BothProfiles, dynamicTokens);
      }
  }

  function recordAccessor(expression: Null<TypedExpr>, accessor: TypeAccessor,
      scopeId: Int, profile: RuntimeProfileMask,
      dynamicTokens: Array<DynamicImportBindingToken>): Void {
    final authority = LexicalBindingUsePlan.dynamicAuthority(accessor,
      dynamicTokens);
    record(expression, scopeId, authority, profile);
  }

  function recordDirect(expression: Null<TypedExpr>, name: String,
      scopeId: Int, profile: RuntimeProfileMask): Void {
    record(expression, scopeId, DirectBinding(name), profile);
  }

  function record(expression: Null<TypedExpr>, scopeId: Int,
      authority: LexicalRuntimeAuthority, profile: RuntimeProfileMask): Void {
    if (expression != null) {
      final known = expressionOccurrences.get(expression);
      if (known != null)
        for (occurrence in known)
          if (occurrence.profile == profile
            && LexicalBindingUsePlan.authoritiesEqual(occurrence.authority,
              authority))
            return;
    }
    final occurrence: RuntimeAuthorityOccurrence = {
      scopeId: scopeId,
      authority: authority,
      profile: profile
    };
    occurrences.push(occurrence);
    if (expression == null) {
      moduleOccurrences.push(occurrence);
    } else {
      if (!expressionOccurrences.exists(expression))
        expressionOccurrences.set(expression, []);
      expressionOccurrences.get(expression).push(occurrence);
    }
  }

  function registerClassRuntimeAuthorities(owner: ClassType,
      fields: Array<Module.Field>, projection: Module.MemberProjection): Void {
    if (!projection.emitImplementation)
      return;
    var hasConstructor = false;
    for (field in fields)
      if (field.kind.equals(Constructor)) {
        hasConstructor = true;
        break;
      }
    if (owner.module != 'genes.Register' || hasConstructor)
      recordAccessor(null, TypeUtil.registerType, 0, BothProfiles, []);
    if (owner.superClass != null)
      recordAccessor(null, TClassDecl(owner.superClass.t), 0, BothProfiles, []);
    if (!owner.isInterface)
      for (implemented in owner.interfaces) {
        final interfaceType = implemented.t.get();
        if (!isMissingModuleProbe(interfaceType))
          recordAccessor(null, TClassDecl(implemented.t), 0, BothProfiles, []);
      }

    var typeScriptUsesObject = false;
    for (field in fields) {
      if (!field.isStatic && field.kind.equals(Property)
        && (field.getter || field.setter))
        typeScriptUsesObject = true;
      if (isFieldLevelRuntimeImport(owner, field))
        recordAccessor(null,
          TypeAccessor.forStaticFieldName(owner, field.name, field.pos), 0,
          BothProfiles, []);
    }
    if (typeScriptUsesObject)
      recordDirect(null, 'Object', 0, TypeScriptProfileOnly);
  }

  static function isMissingModuleProbe(type: BaseType): Bool {
    #if genes.lexical_binding_missing_module_probe
    return type.meta.has(':genesLexicalBindingMissingModuleProbe')
      || type.meta.has('genesLexicalBindingMissingModuleProbe');
    #else
    return false;
    #end
  }

  function registerEnumRuntimeAuthorities(owner: EnumType,
      projection: Module.MemberProjection): Void {
    if (!projection.emitImplementation)
      return;
    final classicRegisters = projection.registerRuntimeType;
    final typeScriptRegisters = projection.registerRuntimeType
      && !Context.defined('genes.ts.minimal_runtime');
    recordModuleAccessorProfiles(TypeUtil.registerType, classicRegisters,
      typeScriptRegisters);

    var classicUsesObject = false;
    for (name in owner.names)
      if (owner.constructs.get(name).type.match(TFun(_, _))) {
        classicUsesObject = true;
        break;
      }
    recordModuleDirectProfiles('Object', classicUsesObject, true);
  }

  function recordModuleAccessorProfiles(accessor: TypeAccessor, classic: Bool,
      typeScript: Bool): Void {
    if (classic && typeScript)
      recordAccessor(null, accessor, 0, BothProfiles, []);
    else if (classic)
      recordAccessor(null, accessor, 0, ClassicProfileOnly, []);
    else if (typeScript)
      recordAccessor(null, accessor, 0, TypeScriptProfileOnly, []);
  }

  function recordModuleDirectProfiles(name: String, classic: Bool,
      typeScript: Bool): Void {
    if (classic && typeScript)
      recordDirect(null, name, 0, BothProfiles);
    else if (classic)
      recordDirect(null, name, 0, ClassicProfileOnly);
    else if (typeScript)
      recordDirect(null, name, 0, TypeScriptProfileOnly);
  }

  static function isFieldLevelRuntimeImport(owner: ClassType,
      field: Module.Field): Bool {
    if (!DirectModuleBinding.isModuleFieldsOwner(owner) || !field.isStatic
      || field.meta == null)
      return false;
    return switch field.meta.extract(':jsRequire') {
      case [{params: [{expr: EConst(CString(_))}]}] | [
        {
          params: [{expr: EConst(CString(_))}, {expr: EConst(CString(_))}]
        }
      ]:
        true;
      default:
        false;
    };
  }

  function registerFieldLowering(expression: TypedExpr, receiver: TypedExpr,
      field: FieldAccess, scopeId: Int,
      dynamicTokens: Array<DynamicImportBindingToken>): Void {
    switch field {
      case FClosure(_, _):
        recordAccessor(expression, TypeUtil.registerType, scopeId,
          BothProfiles, dynamicTokens);
      default:
    }
    if (fieldName(field) == 'iterator' && TypeUtil.isDynamicIterator(receiver))
      recordAccessor(expression, TypeUtil.registerType, scopeId, BothProfiles,
        dynamicTokens);
    registerPrivateMethodOwner(expression, field, scopeId, dynamicTokens);
  }

  function registerCallLowering(expression: TypedExpr, callee: TypedExpr,
      scopeId: Int, dynamicTokens: Array<DynamicImportBindingToken>): Void {
    final boundary = module.tsBoundaryPlan;
    final enumDecision = boundary.enumCall(callee);
    final callDecision = boundary.call(callee);
    if ((enumDecision != null && enumDecision.bridges.length > 0)
      || (callDecision != null && callDecision.bridges.length > 0))
      recordAccessor(expression, TypeUtil.registerType, scopeId,
        TypeScriptProfileOnly, dynamicTokens);
    if (enumDecision == null && callDecision == null
      && callNeedsNullInferenceCast(callee, expression))
      recordAccessor(expression, TypeUtil.registerType, scopeId,
        TypeScriptProfileOnly, dynamicTokens);
    switch callee.expr {
      case TField(receiver, field)
        if (fieldName(field) == 'iterator'
          && TypeUtil.isDynamicIterator(receiver)):
        recordAccessor(expression, TypeUtil.registerType, scopeId,
          BothProfiles, dynamicTokens);
      case TConst(TSuper):
        final superClass = currentClass == null ? null : currentClass.superClass;
        if (superClass != null && superClass.t.get().isExtern)
          recordAccessor(expression, TClassDecl(superClass.t), scopeId,
            BothProfiles, dynamicTokens);
        else
          recordAccessor(expression, TypeUtil.registerType, scopeId,
            BothProfiles, dynamicTokens);
      default:
    }
    switch callee.expr {
      case TField(_, field):
        registerPrivateMethodOwner(expression, field, scopeId, dynamicTokens);
      default:
    }
  }

  static function callNeedsNullInferenceCast(callee: TypedExpr,
      call: TypedExpr): Bool {
    final arguments = switch call.expr {
      case TCall(_, values): values;
      default: return false;
    };
    final isEnumConstructor = switch unwrap(callee).expr {
      case TField(_, FEnum(_, _)): true;
      default: false;
    };
    final expectedArguments = switch Context.followWithAbstracts(callee.t) {
      case TFun(values, _): values;
      default: [];
    };
    for (index in 0...arguments.length) {
      final actual = arguments[index];
      if (!TypeUtil.isNullConstant(actual))
        continue;
      final expected = index < expectedArguments.length ? expectedArguments[index].t : null;
      if (expected != null
        && TypeUtil.explicitTypeProjection(expected) == 'null')
        continue;
      if (expected != null)
        switch expected {
          case TMono(reference) if (reference.get() == null):
            return true;
          default:
        }
      if (isEnumConstructor
        && (expected == null
          || NullishContract.forType(expected).haxeAllowsNull))
        return true;
    }
    return false;
  }

  function registerPrivateMethodOwner(expression: TypedExpr,
      field: FieldAccess, scopeId: Int,
      dynamicTokens: Array<DynamicImportBindingToken>): Void {
    switch field {
      case FStatic(ownerRef, fieldRef):
        final owner = ownerRef.get();
        final value = fieldRef.get();
        if (!canLowerPrivateStaticField(owner, value)
          || (currentClass != null && currentClass.module == owner.module
            && currentClass.name == owner.name))
          return;
        recordAccessor(expression, TypeUtil.registerType, scopeId,
          TypeScriptProfileOnly, dynamicTokens);
        recordAccessor(expression, (owner : TypeAccessor), scopeId,
          TypeScriptProfileOnly, dynamicTokens);
      default:
    }
  }

  function registerTypeScriptLowering(expression: TypedExpr, scopeId: Int,
      dynamicTokens: Array<DynamicImportBindingToken>,
      suppressPromiseNullCast: Bool): Void {
    final boundary = module.tsBoundaryPlan;
    final needsNullCast = switch expression.expr {
      case TConst(TNull): !NullishContract.forType(expression.t)
          .haxeAllowsNull && !(suppressPromiseNullCast
          && TypeUtil.isJsPromiseThenableType(expression.t));
      default:
        false;
    };
    final needsNullableNumberCast = switch expression.expr {
      case TBinop(OpGt | OpGte | OpLt | OpLte, left, right): (NullishContract.forType(left.t)
          .haxeAllowsNull && TypeUtil.isHaxeNumberLike(left.t)) || (NullishContract.forType(right.t)
          .haxeAllowsNull && TypeUtil.isHaxeNumberLike(right.t));
      default:
        false;
    };
    final needsFieldTypeOverride = switch expression.expr {
      case TBinop(OpAssign, {expr: TField(_, field)}, _): final meta = switch field {
          case FInstance(_, _, value) | FStatic(_, value) | FAnon(value):
            value.get().meta;
          default:
            null;
        }; final typeOverride = TypeUtil.stringMetadata(meta,
          ':ts.type') ?? TypeUtil.stringMetadata(meta,
            ':genes.type'); typeOverride != null && typeOverride != 'any';
      default:
        false;
    };
    final needsInitializerBridge = switch expression.expr {
      case TVar(_, initializer) if (initializer != null): boundary.initializerBridge(initializer) != null || boundary.runtimeGuardBridge(initializer) != null;
      default:
        false;
    };
    final needsRegister = needsNullCast
      || needsNullableNumberCast
      || needsFieldTypeOverride
      || needsInitializerBridge
      || boundary.enumPayloadRead(expression) != null
      || boundary.constructor(expression) != null
      || boundary.returnBridge(expression) != null
      || boundary.assignmentBridge(expression) != null
      || boundary.hostCallbackBridge(expression) != null
      || boundary.runtimeByteCacheRead(expression) != null;
    if (needsRegister)
      recordAccessor(expression, TypeUtil.registerType, scopeId,
        TypeScriptProfileOnly, dynamicTokens);
    final payload = boundary.enumPayloadRead(expression);
    if (payload != null)
      recordAccessor(expression, TEnumDecl(payload.owner), scopeId,
        TypeScriptProfileOnly, dynamicTokens);
  }

  function isDirectStaticOccurrence(owner: Ref<ClassType>,
      field: Ref<ClassField>): Bool {
    if (field.get().meta.has(':jsRequire'))
      return true;
    final functionRequest = module.resolveModuleFunction(owner, field);
    if (functionRequest != null && functionRequest.isSourceModuleBinding)
      return true;
    return DirectModuleBinding.isModuleFieldsOwner(owner.get())
      && ModuleValuePlan.requestedName(field.get()) != null;
  }

  static function isBareStaticOwner(owner: ClassType): Bool {
    return owner.pack.length == 0 && owner.name == '';
  }

  static function tokenLocalName(token: DynamicImportBindingToken): String {
    return switch token {
      case Declaration(_, _, _, localName, _) |
        StaticField(_, _, _, localName, _):
        localName;
    }
  }

  static function isOpaqueSyntax(expression: TypedExpr): Bool {
    return switch unwrap(expression).expr {
      case TIdent('__js__'):
        true;
      case TField(_, FStatic(ownerRef, fieldRef)): final owner = ownerRef.get(); owner.module == 'js.Syntax' && owner.name == 'Syntax' && fieldRef.get()
          .name == 'code';
      default:
        false;
    }
  }

  static function isGlobalSyntaxMarker(callee: TypedExpr,
      arguments: Array<TypedExpr>): Bool {
    if (arguments.length != 1)
      return false;
    return switch [unwrap(callee).expr, arguments[0].expr] {
      case [TField(_, FStatic(ownerRef, fieldRef)), TConst(TString("$global"))]: final owner = ownerRef.get(); owner.module == 'js.Syntax' && owner.name == 'Syntax' && fieldRef.get()
          .name == 'code';
      default:
        false;
    }
  }

  static function isKnownCompilerIdent(expression: TypedExpr): Bool {
    return switch unwrap(expression).expr {
      case TIdent('`trace' | '__resources__' | '__new__' | '__instanceof__' | '__typeof__' | '__strict_eq__' | '__strict_neq__' | '__define_feature__' | '__feature__'):
        true;
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

  static function fieldName(field: FieldAccess): Null<String> {
    return switch field {
      case FInstance(_, _, value) | FStatic(_, value) | FAnon(value) |
        FClosure(_, value):
        value.get().name;
      case FEnum(_, value): value.name;
      case FDynamic(name): name;
    }
  }

  static function canLowerPrivateStaticField(owner: ClassType,
      field: ClassField): Bool {
    return Context.defined('genes.ts.lower_private_helpers')
      && !owner.isExtern
      && (owner.pack.length == 0
        || (owner.pack[0] != 'haxe' && owner.pack[0] != 'js'))
      && !field.isPublic
      && field.name != 'main'
      && field.kind.match(FMethod(_))
      && (field.meta.has(':genesLowerPrivateHelper')
        || field.meta.has('genesLowerPrivateHelper')
        || field.meta.has(':genes.lowerPrivateHelper')
        || field.meta.has('genes.lowerPrivateHelper'));
  }
}
#end
