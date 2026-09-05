package genes;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr.Constant;
import haxe.macro.Expr.ExprDef;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
import haxe.ds.ObjectMap;
import genes.Dependencies.DependencySpec;
import genes.Dependencies.DependencyType;
import genes.BindingIdentity.BindingIdentity;
import genes.BindingIdentity.BindingOriginKey;
import genes.BindingIdentity.CompilerCapabilityId;
import genes.BindingIdentity.StaticFieldOriginKey;
import genes.Dependencies.DependencyRequest;
import genes.DependencyPlan.DependencyEdge;
import genes.DependencyPlan.DependencyEdgeKind;
import genes.DependencyPlan.DependencyImport;
import genes.DependencyPlan.DependencyImportSpec;
import genes.DependencyPlan.DependencyModuleRequest;
import genes.DependencyPlan.DependencyProvenance;
import genes.Module.Field;
import genes.RuntimeTypeOccurrenceCollector.RuntimeTypeOccurrence;
import genes.JsxPlan.JsxCapabilityPolicy;
import genes.util.TypeUtil;
#if genes.compile_stage_profile
import genes.util.Timer.timer;
#end

using haxe.macro.TypedExprTools;

private typedef NormalizedDependencyReference = {
  final referencedType: ModuleType;
  final importSpec: DependencyImport;
}

/**
 * Builds one module's dependency graph from typed Haxe facts.
 *
 * Why: runtime values, implementation annotations, and public declarations
 * have different reachability rules. Combining them in a mutable import table
 * either keeps dead JS or drops types required by strict TypeScript consumers.
 *
 * What: this builder walks executable expressions for runtime edges, adds
 * explicit capability-owned host edges such as the planned JSX factory, and
 * uses `PublicSurface` plus `TypeReferenceCollector` for type/declaration
 * edges. It records the originating `ModuleType` before aliases are allocated.
 *
 * How: all mutation is private to a single build. Edges form an ordered
 * multigraph in stable member/expression order, then freeze in `DependencyPlan`.
 * Repeated encounters are preserved because the legacy collision allocator
 * observes their order; reachability queries de-duplicate only returned types.
 * `Dependencies` remains the sole owner of package forms and aliases.
 */
class DependencyPlanBuilder {
  final module: Module;
  final edges: Array<DependencyEdge> = [];
  final normalizedReferences = new ObjectMap<BaseType,
    Array<NormalizedDependencyReference>>();
  var usesJsxNamespaceType = false;
  var hasReactStateBinding = false;

  public static function build(module: Module): DependencyPlan {
    final builder = new DependencyPlanBuilder(module);
    #if genes.compile_stage_profile
    final endRuntimeEdgesTimer = timer('genes.plan.reachability.runtimeEdges');
    #end
    builder.collectRuntimeEdges();
    #if genes.compile_stage_profile
    endRuntimeEdgesTimer();
    #end
    if (Context.defined('genes.ts')) {
      #if genes.compile_stage_profile
      final endTypeEdgesTimer = timer('genes.plan.reachability.typeEdges');
      #end
      builder.collectTypeEdges(TypeOnly, true);
      #if genes.compile_stage_profile
      endTypeEdgesTimer();
      #end
    }
    if (Context.defined('dts')) {
      #if genes.compile_stage_profile
      final endDeclarationEdgesTimer = timer('genes.plan.reachability.declarationEdges');
      #end
      builder.collectTypeEdges(DeclarationOnly, false);
      #if genes.compile_stage_profile
      endDeclarationEdgesTimer();
      #end
    }
    return new DependencyPlan(builder.edges, builder.usesJsxNamespaceType);
  }

  function new(module: Module) {
    this.module = module;
  }

  function addReference(kind: DependencyEdgeKind, type: ModuleType,
      rule: String, pos: Position): Void {
    if (type == null)
      return;
    final references = normalizedReferencesFor(type);
    if (references.length == 0) {
      addEdge(kind, type, null, rule, pos);
      return;
    }
    for (reference in references)
      addEdge(kind, reference.referencedType, Bound(reference.importSpec),
        rule, pos);
  }

  /**
   * Normalizes each declaration once while preserving every encountered edge.
   *
   * Type collection can encounter one declaration hundreds of times through
   * member signatures and expression locals. Import metadata and canonical
   * binding identity depend only on that typed declaration and this builder's
   * fixed source module, so repeating that work cannot change the result.
   *
   * The key is the exact compiler-owned declaration object. A textual
   * module/name key is not sufficient because Haxe can apply `@:native` to two
   * declarations in one module and expose the same rewritten target name for
   * both. Object identity is safe for this request-local cache and cannot leak
   * across compiler-server builds. Cached imports are immutable; callers still
   * append one edge for every occurrence in its original order and with its
   * original provenance.
   */
  function normalizedReferencesFor(type: ModuleType): Array<NormalizedDependencyReference> {
    final declaration = declarationFor(type);
    if (normalizedReferences.exists(declaration))
      return normalizedReferences.get(declaration);

    final references = normalizeRequests(Dependencies.requests(module, type));
    normalizedReferences.set(declaration, references);
    return references;
  }

  static function declarationFor(type: ModuleType): BaseType {
    return switch type {
      case TClassDecl(ref): ref.get();
      case TEnumDecl(ref): ref.get();
      case TTypeDecl(ref): ref.get();
      case TAbstract(ref): ref.get();
    }
  }

  static function normalizeRequests(requests: Array<DependencyRequest>): Array<NormalizedDependencyReference> {
    return [
      for (request in requests)
        {
          referencedType: request.referencedType,
          importSpec: new DependencyImport(request.dependency,
            request.bindingFact)
        }
    ];
  }

  function addImport(kind: DependencyEdgeKind, dependency: DependencySpec,
      origin: BindingOriginKey, rule: String, pos: Position): Void {
    addEdge(kind, null,
      Bound(new DependencyImport(dependency,
        BindingIdentity.create(dependency, origin))),
      rule, pos);
  }

  function addEdge(kind: DependencyEdgeKind, referencedType: Null<ModuleType>,
      importSpec: Null<DependencyImportSpec>, rule: String,
      pos: Position): Void {
    // Keep the typed traversal's stable encounter order, including repeated
    // references. `Dependencies.push` owns import de-duplication and its alias
    // allocator historically observes those encounters when same-named symbols
    // from multiple modules collide. The graph is therefore an ordered
    // multigraph; reachability queries de-duplicate only their returned types.
    edges.push(new DependencyEdge(kind, referencedType, importSpec,
      new DependencyProvenance(rule, pos)));
  }

  function addSideEffect(referencedType: Null<ModuleType>,
      request: DependencyModuleRequest, rule: String, pos: Position): Void {
    addEdge(RuntimeSideEffect, referencedType, SideEffect(request), rule, pos);
  }

  function collectRuntimeEdges(): Void {
    var onlyRegisterFreeDirectModuleBindings = module.members.length > 0;
    var hasDirectModuleBindingOwner = false;
    // Validate compiler-owned string templates before output projection opens
    // any implementation writer. The plan itself adds no dependency edge.
    module.templateLiteralPlan;
    final jsxPlan = module.jsxPlan;
    final jsxCapability = JsxCapabilityPolicy.current();
    jsxCapability.validate(jsxPlan);
    if (jsxCapability.requiresRuntimeNamespace(jsxPlan)) {
      addImport(RuntimeValue, {
        type: DependencyType.DAsterisk,
        name: jsxCapability.runtimeBindingName,
        path: jsxCapability.runtimeModule,
        external: true,
        memberPath: [],
        pos: jsxPlan.firstPosition
      },
        BindingOriginKey.CompilerCapability(CompilerCapabilityId.JsxRuntimeNamespace),
        JsxCapabilityPolicy.RUNTIME_IMPORT_RULE, jsxPlan.firstPosition);
    }

    /**
     * Normalizes one field-level `@:jsRequire` before creating its identity.
     *
     * The first named segment is the ESM export. Any remaining dotted segments
     * are member access after the collision-safe local has been resolved.
     */
    function fieldImport(name: String, meta: MetaAccess,
        pos: Position): Null<DependencySpec> {
      final attribute = Dependencies.extractImportAttributeType(meta);
      return switch meta.extract(':jsRequire') {
        case [{params: [{expr: EConst(CString(path))}]}] | [
          {
            params: [{expr: EConst(CString(path))}, {expr: EConst(CString('default'))}]
          }
        ]:
          {
            type: DependencyType.DDefault,
            name: name,
            path: path,
            external: true,
            memberPath: [],
            importAttributeType: attribute,
            pos: pos
          };
        case [
          {
            params: [{expr: EConst(CString(path))}, {expr: EConst(CString(name))}]
          }
        ]:
          final parts = name.split('.');
          {
            type: DependencyType.DName,
            name: parts.shift(),
            path: path,
            external: true,
            memberPath: parts,
            importAttributeType: attribute,
            pos: pos
          };
        default: null;
      }
    }

    function fieldOrigin(owner: ClassType,
        fieldName: String): BindingOriginKey {
      return
        BindingOriginKey.StaticField(new StaticFieldOriginKey(owner.module,
          owner.name, fieldName));
    }

    #if (haxe_ver >= 4.2)
    function addModuleFieldRequires(cl: ClassType, fields: Array<Field>): Void {
      if (!cl.kind.match(KModuleFields(_)))
        return;
      for (field in fields) {
        if (!field.isStatic || field.meta == null)
          continue;
        final dependency = fieldImport(field.name, field.meta, field.pos);
        if (dependency != null)
          addImport(RuntimeValue, dependency, fieldOrigin(cl, field.name),
            'runtime.module-field-js-require', field.pos);
      }
    }
    #end

    function addJsRequireFromExpr(expression: TypedExpr): Void {
      if (expression == null)
        return;
      switch expression.expr {
        case TField(_, FStatic(owner, _.get() => field)):
          if (genes.react.ReactStateInitializationPlan.isStateBinding(owner.get(),
            field)) {
            hasReactStateBinding = true;
            module.planReactStateInitializations();
          }
          final dependency = fieldImport(field.name, field.meta, field.pos);
          if (dependency != null)
            addImport(RuntimeValue, dependency,
              fieldOrigin(owner.get(), field.name),
              'runtime.expression-js-require', field.pos);
        default:
      }
      expression.iter(addJsRequireFromExpr);
    }

    function unwrap(expression: TypedExpr): TypedExpr {
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

    function literalString(expression: TypedExpr, diagnostic: String): String {
      return switch unwrap(expression).expr {
        case TConst(TString(value)) if (value.length > 0): value;
        default: CompilerDiagnostic.fail(diagnostic, expression.pos);
      }
    }

    function optionalLiteralString(expression: TypedExpr): Null<String> {
      return switch unwrap(expression).expr {
        case TConst(TNull): null;
        case TConst(TString(value)) if (value.length > 0): value;
        default:
          CompilerDiagnostic.fail('GENES-SIDE-EFFECT-IMPORT-ATTRIBUTE-001: import attribute type must be a non-empty string literal or null',
            expression.pos);
      }
    }

    /**
     * Consumes a typed marker without traversing its owner or retention token.
     *
     * The internal token is evidence that made the target visible to Haxe DCE;
     * it is not an imported value. A module-level field arrives as `TField`;
     * an imported class or enum value arrives as `TTypeExpr`. Resolving either
     * compiler-owned form to an immutable module request here prevents the
     * ordinary expression walker from manufacturing a named binding for the
     * token while still supporting every typed ESM binding shape.
     */
    function addMarker(expression: TypedExpr): Void {
      final marker = CompilerInternal.sideEffectImportMarkerCall(expression);
      if (marker == null)
        return;
      switch marker.method {
        case 'external':
          if (marker.arguments.length != 2)
            CompilerDiagnostic.fail('GENES-SIDE-EFFECT-IMPORT-INTERNAL-001: external marker requires a specifier and attribute',
              expression.pos);
          final path = literalString(marker.arguments[0],
            'GENES-SIDE-EFFECT-IMPORT-LITERAL-001: module specifier must be a non-empty string literal');
          final attribute = optionalLiteralString(marker.arguments[1]);
          addSideEffect(null,
            new DependencyModuleRequest(true, path, attribute, expression.pos),
            'runtime.side-effect.external', expression.pos);

        case 'internal':
          if (marker.arguments.length != 1)
            CompilerDiagnostic.fail('GENES-SIDE-EFFECT-IMPORT-INTERNAL-001: internal marker requires one typed target token',
              expression.pos);
          final argument = unwrap(marker.arguments[0]);
          final targetType = switch argument.expr {
            case TField({expr: TTypeExpr(type)}, FStatic(_, _)): type;
            case TTypeExpr(type): type;
            default:
              CompilerDiagnostic.fail('GENES-SIDE-EFFECT-IMPORT-INTERNAL-001: internal marker target must be a static field or type token',
                argument.pos);
          }
          final requests = Dependencies.requests(module, targetType);
          if (requests.length != 1 || requests[0].dependency.external)
            CompilerDiagnostic.fail('GENES-SIDE-EFFECT-IMPORT-INTERNAL-001: internal marker target must resolve to one generated module',
              argument.pos);
          final target = requests[0];
          addSideEffect(target.referencedType,
            new DependencyModuleRequest(false, target.dependency.path,
              target.dependency.importAttributeType, expression.pos),
            'runtime.side-effect.internal', expression.pos);

        default:
          CompilerDiagnostic.fail('GENES-SIDE-EFFECT-IMPORT-INTERNAL-001: unknown compiler marker',
            expression.pos);
      }
    }

    function containsMarker(expression: TypedExpr): Bool {
      if (expression == null)
        return false;
      if (CompilerInternal.isSideEffectImportMarkerCall(expression))
        return true;
      var found = false;
      expression.iter(child -> {
        if (!found && containsMarker(child))
          found = true;
      });
      return found;
    }

    function addOrdinaryExpression(expression: TypedExpr): Void {
      if (expression == null)
        return;
      #if genes.lexical_binding_inventory
      if (CompilerInternal.lexicalBindingQueryMarkerCall(expression) != null)
        return;
      #end
      addJsRequireFromExpr(expression);
      final occurrences = RuntimeTypeOccurrenceCollector.collect(expression,
        (owner, field) -> {
          final request = module.resolveModuleFunction(owner, field);
          return request != null
            && request.isSourceModuleBinding ? request : null;
        }, (owner, field) -> {
          final ownerValue = owner.get();
          if (!DirectModuleBinding.isModuleFieldsOwner(ownerValue))
            return null;
          return ModuleValuePlan.requestedName(field.get());
        }, expression -> {
          return switch module.nativeAsyncPlan.projection(expression) {
            case AnonymousFunction(value) | ReturnPayload(value): value;
            case null: null;
          }
        });
      for (occurrence in occurrences) {
        switch occurrence {
          case RuntimeTypeOccurrence.RuntimeType(type):
            addReference(RuntimeValue, type, 'runtime.typed-expression',
              expression.pos);
          case RuntimeTypeOccurrence.DirectModuleFunction(ownerRef, fieldRef,
            request):
            final owner = ownerRef.get();
            final field = fieldRef.get();
            if (owner.module == module.module)
              continue;
            final dependency: DependencySpec = {
              type: DependencyType.DName,
              name: request.requestedName,
              path: owner.module,
              external: false,
              memberPath: [],
              pos: field.pos
            };
            addEdge(RuntimeValue, TClassDecl(ownerRef),
              Bound(new DependencyImport(dependency,
                BindingIdentity.create(dependency,
                  fieldOrigin(owner, field.name)))),
              'runtime.module-function', field.pos);
          case RuntimeTypeOccurrence.DirectModuleValue(ownerRef, fieldRef,
            requestedName):
            final owner = ownerRef.get();
            final field = fieldRef.get();
            if (owner.module == module.module)
              continue;
            final dependency: DependencySpec = {
              type: DependencyType.DName,
              name: requestedName,
              path: owner.module,
              external: false,
              memberPath: [],
              pos: field.pos
            };
            addEdge(RuntimeValue, TClassDecl(ownerRef),
              Bound(new DependencyImport(dependency,
                BindingIdentity.create(dependency,
                  fieldOrigin(owner, field.name)))),
              'runtime.module-value', field.pos);
        }
      }
    }

    /**
     * Accepts markers only as direct outer statements of compiler-owned
     * carriers or a class initializer. ESM requests are statically hoisted, so
     * accepting a conditional, loop, nested function, or call-time marker
     * would claim runtime control flow that import declarations cannot honor.
     */
    function addFromExpr(expression: TypedExpr,
        allowDirectMarkers = false): Void {
      if (expression == null)
        return;
      if (!allowDirectMarkers) {
        if (containsMarker(expression))
          CompilerDiagnostic.fail('GENES-SIDE-EFFECT-IMPORT-CONTEXT-001: compiler marker must be a direct static-initialization statement',
            expression.pos);
        addOrdinaryExpression(expression);
        return;
      }

      final outer = unwrap(expression);
      final statements = switch outer.expr {
        case TBlock(elements): elements;
        default: [outer];
      }
      for (statement in statements) {
        if (CompilerInternal.isSideEffectImportMarkerCall(statement)) {
          addMarker(statement);
          continue;
        }
        if (containsMarker(statement))
          CompilerDiagnostic.fail('GENES-SIDE-EFFECT-IMPORT-CONTEXT-001: compiler marker must be a direct static-initialization statement',
            statement.pos);
        addOrdinaryExpression(statement);
      }
    }

    /**
     * Proves the one direct-function body that cannot emit a runtime helper.
     *
     * Why: a compiler-synthetic module owner normally retains `genes.Register`
     * for registration and shared Haxe runtime operations. Omitting that owner
     * also removed the conservative Register dependency, but a relocated body
     * may still emit helpers such as `Register.bind` for method extraction.
     *
     * What/How: omit Register only for the exact generic identity shape already
     * covered by the direct-function fixture: one required non-rest argument
     * and one unwrapped `return` of that same `TVar`. Defaults, async functions,
     * return-type overrides, and TypeScript return bridges all fail closed.
     * Other supported bodies keep the dependency even when a particular
     * emitter later proves not to use it.
     */
    function directFunctionNeedsNoRegister(field: Field): Bool {
      if (field.meta == null || field.meta.has(':jsAsync')
        || field.meta.has('jsAsync') || field.meta.has(':ts.returnType')
        || field.meta.has(':genes.returnType'))
        return false;

      final signatureArguments = switch Context.follow(field.type) {
        case TFun(arguments, _): arguments;
        default: return false;
      };
      if (signatureArguments.length != 1 || signatureArguments[0].opt
        || TypeUtil.isRest(signatureArguments[0].t))
        return false;

      final functionBody = switch field.expr {
        case {expr: TFunction(value)}: value;
        default: return false;
      };
      if (functionBody.args.length != 1
        || functionBody.args[0].value != null
        || TypeUtil.isRest(functionBody.args[0].v.t))
        return false;

      final returnExpression = switch functionBody.expr.expr {
        case TBlock([
          statement = {
            expr: TReturn({expr: TLocal(returnedVariable)})
          }
        ]) if (returnedVariable.id == functionBody.args[0].v.id):
          statement;
        default:
          return false;
      };

      if (Context.defined('genes.ts')
        && module.tsBoundaryPlan.returnBridge(returnExpression) != null)
        return false;
      return true;
    }

    for (member in module.members) {
      switch member {
        case MClass(cl, _, fields):
          final emittableFields = Module.emittableFields(fields);
          final directOwner = DirectModuleBinding.canOmitSyntheticOwner(cl,
            emittableFields);
          if (directOwner) {
            hasDirectModuleBindingOwner = true;
            if (emittableFields.filter(field ->
              module.moduleFunctionRequestPlan.entryFor(cl, field) != null
              && !directFunctionNeedsNoRegister(field))
              .length > 0)
              onlyRegisterFreeDirectModuleBindings = false;
          } else
            onlyRegisterFreeDirectModuleBindings = false;
          for (parent in cl.interfaces)
            addReference(RuntimeValue, TClassDecl(parent.t),
              'runtime.interface', cl.pos);
          switch cl.superClass {
            case null:
            case parent:
              addReference(RuntimeValue, TClassDecl(parent.t),
                'runtime.superclass', cl.pos);
          }
          #if (haxe_ver >= 4.2)
          addModuleFieldRequires(cl, fields);
          #end
          for (field in fields)
            addFromExpr(field.expr, CompilerInternal.isField(field.meta));
          addFromExpr(cl.init, true);
        case MMain(expression):
          onlyRegisterFreeDirectModuleBindings = false;
          addFromExpr(expression);
        case MEnum(_, _):
          onlyRegisterFreeDirectModuleBindings = false;
        case MType(_, _):
      }
    }
    if (module.module != 'genes.Register'
      && (module.hasFeature('js.Lib.global')
        || !onlyRegisterFreeDirectModuleBindings || !hasDirectModuleBindingOwner))
      addReference(RuntimeValue, TypeUtil.registerType,
        'runtime.registration', Context.currentPos());
  }

  function collectTypeEdges(kind: DependencyEdgeKind,
      includeExpressionLocals: Bool): Void {
    function addTypeReference(type: ModuleType, rule: String,
        pos: Position): Void {
      #if genes.compile_stage_profile
      final endImportNormalizationTimer = timer('genes.plan.reachability.typeCollection.importNormalization');
      #end
      addReference(kind, type, rule, pos);
      #if genes.compile_stage_profile
      endImportNormalizationTimer();
      #end
    }

    final collector = new TypeReferenceCollector((type, rule,
        pos) -> addTypeReference(type, rule, pos),
      (template, _, _) -> {
        // Both typed implementations and classic declarations can print a raw
        // `JSX.*` projection. Record one shared semantic fact so neither
        // emitter has to rediscover type use from formatted output.
        if (TypeReferenceCollector.overrideReferencesNamespace(template,
          'JSX')) {
          usesJsxNamespaceType = true;
        }
      });

    // The TypeScript boundary plan is the sole authority for assertion targets
    // and explicit generic arguments that implementation emission may print.
    // Collect every referenced type before binding allocation; the emitter must
    // never discover another imported type after this point.
    #if genes.compile_stage_profile
    final endBoundaryPlanTimer = timer('genes.plan.reachability.typeCollection.boundaryPlanReferences');
    #end
    if (includeExpressionLocals)
      for (reference in module.tsBoundaryPlan.referencedTypes())
        collector.collect(reference.type,
          'type.ts-boundary.${reference.rule}', reference.pos);

    if (includeExpressionLocals && hasReactStateBinding)
      for (reference in module.reactStateInitializationPlan.referencedTypes())
        collector.collect(reference.type, 'type.react-state-initialization',
          reference.pos);
    #if genes.compile_stage_profile
    endBoundaryPlanTimer();
    #end

    final undefinablePresentTypes: Array<{
      final type: Type;
      final pos: Position;
    }> = [];

    function visitExpressionTypes(expression: TypedExpr): Void {
      if (expression == null)
        return;
      switch expression.expr {
        case TVar(variable, initializer):
          // A projected React State declaration emits an inferred native
          // destructure, not the Haxe State annotation. Keep dependency planning
          // aligned with that syntax so a projected-only module does not retain
          // a phantom UseStateResult type import.
          final projected = initializer != null
            && module.reactStateProjectionPlan.projectsDeclaration(expression,
              variable, initializer);
          if (!projected) {
            collector.observeOverrideMeta(variable.meta,
              'type.local-variable-override', expression.pos);
            collector.collect(variable.t, 'type.local-variable',
              expression.pos);
          }
        case TFunction(functionType):
          for (argument in functionType.args) {
            collector.observeOverrideMeta(argument.v.meta,
              'type.local-argument-override', expression.pos);
            collector.collect(argument.v.t, 'type.local-argument',
              expression.pos);
          }
        case TCall(callee, arguments):
          final marker = CompilerInternal.undefinablePresentMarkerCall(callee,
            arguments);
          if (marker != null)
            undefinablePresentTypes.push({
              type: marker.resultType,
              pos: expression.pos
            });
        default:
      }
      expression.iter(visitExpressionTypes);
    }

    /**
     * Collects expression-owned type edges in their established order.
     *
     * Why: local declarations and `Undefinable` presence assertions used to
     * recurse over the same typed tree separately. Emitting marker edges during
     * the local walk would change alias allocation because all local edges
     * historically precede marker edges for one expression root.
     *
     * What/How: one walk emits local edges immediately and remembers only the
     * rare exact marker result facts. Replaying those facts after the walk
     * preserves both previous encounter orders without a second AST traversal.
     */
    function collectExpressionTypes(expression: TypedExpr): Void {
      if (expression == null)
        return;
      #if genes.compile_stage_profile
      final endExpressionLocalsTimer = timer('genes.plan.reachability.typeCollection.expressionLocals');
      #end
      undefinablePresentTypes.resize(0);
      visitExpressionTypes(expression);
      for (marker in undefinablePresentTypes)
        collector.collect(marker.type, 'type.undefinable-present-assertion',
          marker.pos);
      #if genes.compile_stage_profile
      endExpressionLocalsTimer();
      #end
    }

    function collectSignature(field: Field): Void {
      if (field.tsType != null) {
        collector.observeOverrideTemplate(field.tsType,
          '$kind.member-signature-override', field.pos);
        return;
      }
      collector.collectParams(field.callableSignature.parameterTypes(), true,
        '$kind.member-parameters', field.pos);
      collector.collect(field.type, '$kind.member-signature', field.pos);
      for (signature in field.overloads)
        collectSignature(signature);
    }

    for (member in module.members) {
      final projection = Module.memberProjection(member);
      // Type dependencies must follow the syntax that will actually be
      // printed. An ordinary compiler-internal alias still has a local
      // implementation and therefore keeps its imports. A semantic-only alias
      // has no emitted syntax at all, so retaining its dependencies would
      // generate unrelated modules for a checker contract no output can name.
      // Declaration planning applies the same rule to every hidden member.
      if ((kind == TypeOnly && !projection.emitImplementation)
        || (kind == DeclarationOnly && !projection.emitDeclaration))
        continue;
      switch member {
        case MClass(cl, params, fields):
          #if genes.compile_stage_profile
          final endMemberSignaturesTimer = timer('genes.plan.reachability.typeCollection.memberSignatures');
          #end
          collector.collectParams(params, true, '$kind.owner-parameters',
            cl.pos);
          final publicSurface = PublicSurface.forClass(cl);
          for (parent in publicSurface.interfacesFor(params)) {
            // Classic declarations omit an interface clause when application
            // DCE stripped part of its runtime contract. Keep dependency
            // planning aligned so that honest omission does not leave a
            // declaration-only import with no consumer.
            if (kind != DeclarationOnly || cl.isInterface
              || PublicSurface.runtimeSatisfiesInterface(cl,
                parent.type.get())) {
              addTypeReference(TClassDecl(parent.type), '$kind.interface',
                cl.pos);
              collector.collectParams(parent.copyArguments(), true,
                '$kind.interface-arguments', cl.pos);
            }
          }
          switch publicSurface.superClassFor(params) {
            case null:
            case parent:
              addTypeReference(TClassDecl(parent.type), '$kind.superclass',
                cl.pos);
              collector.collectParams(parent.copyArguments(), true,
                '$kind.superclass-arguments', cl.pos);
          }

          // TS interfaces consume their complete pre-DCE surface. Classic
          // class declarations remain constrained to actual runtime members:
          // a `.d.ts` must not promise a DCE-stripped value that the emitted JS
          // does not contain. Declaration-only reachability retains the types
          // named by those honest signatures without broadening classic JS.
          final signatureFields = if (cl.isInterface) Module.fieldsOf(cl,
            publicSurface, params, kind == TypeOnly,
            null) else if (kind == DeclarationOnly) Module.fieldsOf(cl,
            publicSurface, params, false, fields) else fields;
          for (field in signatureFields)
            collectSignature(field);
          /*
           * A module-function body keeps a compiler-owned descriptor in its
           * original class slot. The TypeScript emitter nevertheless prints
           * the source-level overload before assigning the genuine module
           * function. Haxe's post-DCE field can therefore be weaker than the
           * signature captured by PublicSurface.
           *
           * Collect the retained source signature for those exact fields so a
           * projected type such as `JSX.Element` still plans its `JSX` import.
           * This is a type-only supplement: it adds no runtime edge and does
           * not retain an otherwise dead module function.
           */
          if (kind == TypeOnly
            && Lambda.exists(fields,
              field -> module.moduleFunctionRequestPlan.hasCandidate(cl,
                field))) {
            final sourceFields = Module.fieldsOf(cl, publicSurface, params,
              true, fields);
            for (field in sourceFields)
              if (module.moduleFunctionRequestPlan.hasCandidate(cl, field)) {
                collectSignature(field);
              }
          }
          #if genes.compile_stage_profile
          endMemberSignaturesTimer();
          #end
          if (includeExpressionLocals) {
            for (field in fields)
              collectExpressionTypes(field.expr);
            collectExpressionTypes(cl.init);
          }

        case MEnum(enumType, params):
          #if genes.compile_stage_profile
          final endMemberSignaturesTimer = timer('genes.plan.reachability.typeCollection.memberSignatures');
          #end
          collector.collectParams(params, true, '$kind.enum-parameters',
            enumType.pos);
          for (constructor in enumType.constructs) {
            collector.collectParams(constructor.params.map(parameter ->
              parameter.t), true,
              '$kind.enum-constructor-parameters', constructor.pos);
            switch constructor.type {
              case TFun(arguments, _):
                for (argument in arguments)
                  collector.collect(argument.t, '$kind.enum-argument',
                    constructor.pos);
              default:
            }
          }
          #if genes.compile_stage_profile
          endMemberSignaturesTimer();
          #end

        case MMain(expression):
          #if genes.compile_stage_profile
          final endMemberSignaturesTimer = timer('genes.plan.reachability.typeCollection.memberSignatures');
          #end
          collector.collect(expression.t, '$kind.main-result', expression.pos);
          #if genes.compile_stage_profile
          endMemberSignaturesTimer();
          #end
          if (includeExpressionLocals)
            collectExpressionTypes(expression);

        case MType(definition, params):
          #if genes.compile_stage_profile
          final endMemberSignaturesTimer = timer('genes.plan.reachability.typeCollection.memberSignatures');
          #end
          collector.collectParams(params, true, '$kind.typedef-parameters',
            definition.pos);
          collector.collect(definition.type, '$kind.typedef-body',
            definition.pos);
          #if genes.compile_stage_profile
          endMemberSignaturesTimer();
          #end
      }
    }
  }
}
#end
