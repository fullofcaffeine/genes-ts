package genes;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr.Constant;
import haxe.macro.Expr.ExprDef;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
import genes.Dependencies.DependencySpec;
import genes.Dependencies.DependencyType;
import genes.BindingIdentity.BindingIdentity;
import genes.BindingIdentity.BindingOriginKey;
import genes.BindingIdentity.CompilerCapabilityId;
import genes.BindingIdentity.StaticFieldOriginKey;
import genes.DependencyPlan.DependencyEdge;
import genes.DependencyPlan.DependencyEdgeKind;
import genes.DependencyPlan.DependencyImport;
import genes.DependencyPlan.DependencyImportSpec;
import genes.DependencyPlan.DependencyModuleRequest;
import genes.DependencyPlan.DependencyProvenance;
import genes.Module.Field;
import genes.JsxPlan.JsxCapabilityPolicy;
import genes.util.TypeUtil;

using haxe.macro.TypedExprTools;

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
  var usesJsxNamespaceType = false;

  public static function build(module: Module): DependencyPlan {
    final builder = new DependencyPlanBuilder(module);
    builder.collectRuntimeEdges();
    if (Context.defined('genes.ts'))
      builder.collectTypeEdges(TypeOnly, true);
    if (Context.defined('dts'))
      builder.collectTypeEdges(DeclarationOnly, false);
    return new DependencyPlan(builder.edges, builder.usesJsxNamespaceType);
  }

  function new(module: Module) {
    this.module = module;
  }

  function addReference(kind: DependencyEdgeKind, type: ModuleType,
      rule: String, pos: Position): Void {
    if (type == null)
      return;
    final requests = Dependencies.requests(module, type);
    if (requests.length == 0) {
      addEdge(kind, type, null, rule, pos);
      return;
    }
    for (request in requests) {
      addEdge(kind, request.referencedType,
        Bound(new DependencyImport(request.dependency, request.bindingFact)),
        rule, pos);
    }
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
    var onlyDirectModuleBindings = module.members.length > 0;
    var hasDirectModuleBindingOwner = false;
    var registerHelperPos: Null<Position> = null;
    if (Context.defined('genes.ts'))
      registerHelperPos = module.tsBoundaryPlan.firstIdentityAssertionPosition();
    if (module.module != 'genes.Register'
      && module.hasFeature('js.Lib.global') && registerHelperPos == null) {
      // Both implementation emitters add `$global = Register.$global` at the
      // module prologue when Haxe selected this feature. That use is invented
      // after typed-expression traversal, so record its runtime dependency
      // from the same compiler feature fact instead of hoping a field happens
      // to mention `$global`.
      registerHelperPos = Context.currentPos();
    }
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
          final dependency = fieldImport(field.name, field.meta, field.pos);
          if (dependency != null)
            addImport(RuntimeValue, dependency,
              fieldOrigin(owner.get(), field.name),
              'runtime.expression-js-require', field.pos);
        default:
      }
      expression.iter(addJsRequireFromExpr);
    }

    /**
     * Reserves `genes.Register` when expression lowering needs a runtime helper.
     *
     * Why: ordinary classes already retain Register for reflection setup, which
     * historically hid expression-level uses such as method binding, dynamic
     * iteration, and Haxe's `$global` carrier. A module made entirely from
     * direct functions/values has no class registration, but those expressions
     * still emit Register calls and therefore still need the import.
     *
     * What/How: recognize the exact typed shapes shared by both emitters before
     * imports are allocated. This edge is independent from
     * `runtime.registration`: removing a compiler-synthetic owner must remove
     * only its reflection work, never helpers used by the retained body.
     */
    function addRegisterHelperFromExpr(expression: TypedExpr): Void {
      if (expression == null || registerHelperPos != null)
        return;
      function unwrapExpression(expression: TypedExpr): TypedExpr {
        var current = expression;
        while (true) {
          switch current.expr {
            case TMeta(_, inner) | TParenthesis(inner) | TCast(inner, null):
              current = inner;
            default:
              return current;
          }
        }
        return expression;
      }
      function typeAllowsNull(type: Type): Bool {
        return NullishContract.forType(type).haxeAllowsNull;
      }
      function extractStringMeta(meta: MetaAccess, name: String): Null<String> {
        return switch meta.extract(name) {
          case [{params: [{expr: EConst(CString(value))}]}]:
            value;
          default:
            null;
        }
      }
      function explicitTypeProjection(type: Type): Null<String> {
        return switch type {
          case TInst(_.get().meta => meta, _) |
            TAbstract(_.get().meta => meta, _):
            extractStringMeta(meta,
              ':ts.type') ?? extractStringMeta(meta, ':genes.type');
          case TLazy(resolve):
            explicitTypeProjection(resolve());
          case TMono(reference) if (reference.get() != null):
            explicitTypeProjection(reference.get());
          default:
            null;
        }
      }
      function enumNullInferenceNeedsHelper(callee: TypedExpr,
          parameters: Array<TypedExpr>): Bool {
        if (!Context.defined('genes.ts'))
          return false;
        switch unwrapExpression(callee).expr {
          case TField(_, FEnum(_, _)):
          default:
            return false;
        }
        final arguments = switch Context.followWithAbstracts(callee.t) {
          case TFun(arguments, _): arguments;
          default: [];
        }
        for (index in 0...parameters.length) {
          final parameter = unwrapExpression(parameters[index]);
          if (!parameter.expr.match(TConst(TNull)))
            continue;
          final expected = index < arguments.length ? arguments[index].t : null;
          if (expected != null && explicitTypeProjection(expected) == 'null')
            continue;
          if (expected == null || typeAllowsNull(expected))
            return true;
          switch expected {
            case TMono(reference) if (reference.get() == null):
              return true;
            default:
          }
        }
        return false;
      }
      function overriddenFieldType(field: FieldAccess): Null<String> {
        final meta = switch field {
          case FInstance(_, _, reference) | FStatic(_, reference) |
            FAnon(reference):
            reference.get().meta;
          default:
            null;
        }
        if (meta == null)
          return null;
        return extractStringMeta(meta,
          ':ts.type') ?? extractStringMeta(meta, ':genes.type');
      }
      function isNumberLike(type: Type): Bool {
        final nonNull = NullishContract.stripHaxeNull(type);
        return switch Context.followWithAbstracts(nonNull) {
          case TAbstract(_.get() => {pack: [], name: 'Int' | 'Float'}, _):
            true;
          default:
            false;
        }
      }
      var helperPos: Null<Position> = null;
      function visit(current: TypedExpr): Void {
        if (helperPos != null)
          return;
        switch current.expr {
          case TField(_, FClosure(_, _)):
            helperPos = current.pos;
          case TField(receiver, field)
            if (TypeUtil.fieldName(field) == 'iterator'
              && TypeUtil.isDynamicIterator(receiver)):
            helperPos = current.pos;
          case TCall({
            expr: TField(_,
              FStatic(_.get() => {module: 'js.Syntax'},
                _.get() => {name: 'code'}))
          }, [{expr: TConst(TString("$global"))}]):
            helperPos = current.pos;
          case TCall(callee, parameters)
            if (enumNullInferenceNeedsHelper(callee, parameters)):
            // TypeScript must prevent a literal `null` from fixing an enum's
            // generic payload parameter to `null`. The emitter uses
            // `Register.unsafeCast<never>` for that inference-only assertion,
            // so a direct-only module must retain Register even though classic
            // JavaScript emits the ordinary enum call.
            helperPos = current.pos;
          case TBinop(OpAssign, {expr: TField(_, field)}, _)
            if (Context.defined('genes.ts')
              && overriddenFieldType(field) != null
              && overriddenFieldType(field) != 'any'):
            // An authored target-type override changes the TypeScript field
            // contract without changing the Haxe value. Assignment emission
            // preserves that boundary with a Register identity assertion.
            helperPos = current.pos;
          case TBinop(OpGt | OpGte | OpLt | OpLte, left, right)
            if (Context.defined('genes.ts')
              && ((typeAllowsNull(left.t) && isNumberLike(left.t))
                || (typeAllowsNull(right.t) && isNumberLike(right.t)))):
            // Strict TypeScript needs the emitter's identity assertion for a
            // nullable numeric relation that Haxe already accepted. Classic
            // JavaScript prints the native operator and needs no helper.
            helperPos = current.pos;
          case TConst(TNull)
            if (Context.defined('genes.ts') && !typeAllowsNull(current.t)):
            // Haxe permits literal null at a non-null destination. Strict
            // TypeScript needs the emitter's identity assertion even when the
            // direct-only module has no reflection registration of its own.
            helperPos = current.pos;
          default:
        }
        if (helperPos == null)
          current.iter(visit);
      }
      visit(expression);
      if (helperPos == null)
        return;
      registerHelperPos = helperPos;
    }

    /**
     * Imports a selected Haxe module function/value by its direct ESM binding.
     *
     * The compiler-synthetic `_Fields_` owner is skipped only when every
     * retained field has a valid direct-binding marker.
     */
    function addDirectModuleImports(expression: TypedExpr): Array<ClassType> {
      final directOwners: Array<ClassType> = [];
      if (expression == null)
        return directOwners;
      function visit(current: TypedExpr): Void {
        switch current.expr {
          case TField(_, FStatic(ownerRef, _.get() => field)):
            final owner = ownerRef.get();
            final requestedName = DirectModuleBinding.requestedName(field);
            if (DirectModuleBinding.isModuleFieldsOwner(owner)
              && requestedName != null) {
              if (owner.module != module.module) {
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
                  'runtime.direct-module-binding', field.pos);
              }
              final ownerFields = Module.emittableFields(Module.fieldsOf(owner));
              if (DirectModuleBinding.canOmitSyntheticOwner(owner, ownerFields)
                && directOwners.filter(existing -> existing.module == owner.module
                  && existing.name == owner.name)
                  .length == 0)
                directOwners.push(owner);
            }
          default:
        }
        current.iter(visit);
      }
      visit(expression);
      return directOwners;
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
      addJsRequireFromExpr(expression);
      addRegisterHelperFromExpr(expression);
      final directModuleOwners = addDirectModuleImports(expression);
      for (type in TypeUtil.typesInExpr(expression)) {
        final base = DependencyPlan.moduleTypeBase(type);
        if (base != null
          && directModuleOwners.filter(owner -> owner.module == base.module
            && owner.name == base.name)
            .length > 0)
          continue;
        addReference(RuntimeValue, type, 'runtime.typed-expression',
          expression.pos);
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

    for (member in module.members) {
      switch member {
        case MClass(cl, _, fields):
          final emittableFields = Module.emittableFields(fields);
          final directOwner = DirectModuleBinding.canOmitSyntheticOwner(cl,
            emittableFields);
          if (directOwner)
            hasDirectModuleBindingOwner = true;
          else
            onlyDirectModuleBindings = false;
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
          onlyDirectModuleBindings = false;
          addFromExpr(expression);
        case MEnum(_, _):
          onlyDirectModuleBindings = false;
        case MType(_, _):
      }
    }
    if (module.module != 'genes.Register') {
      if (!onlyDirectModuleBindings || !hasDirectModuleBindingOwner) {
        addReference(RuntimeValue, TypeUtil.registerType,
          'runtime.registration', Context.currentPos());
      } else if (registerHelperPos != null) {
        // Direct-only modules deliberately omit reflection registration. Add
        // the helper edge only after ordinary expression dependencies have
        // retained their historical encounter order; ordinary class modules
        // already receive the equivalent Register binding above.
        addReference(RuntimeValue, TypeUtil.registerType,
          'runtime.expression-register-helper', registerHelperPos);
      }
    }
  }

  function collectTypeEdges(kind: DependencyEdgeKind,
      includeExpressionLocals: Bool): Void {
    final collector = new TypeReferenceCollector((type, rule,
        pos) -> addReference(kind, type, rule, pos),
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
    if (includeExpressionLocals)
      for (reference in module.tsBoundaryPlan.referencedTypes())
        collector.collect(reference.type,
          'type.ts-boundary.${reference.rule}', reference.pos);

    function collectLocalTypes(expression: TypedExpr): Void {
      if (expression == null)
        return;
      switch expression.expr {
        case TVar(variable, _):
          collector.observeOverrideMeta(variable.meta,
            'type.local-variable-override', expression.pos);
          collector.collect(variable.t, 'type.local-variable', expression.pos);
        case TFunction(functionType):
          for (argument in functionType.args) {
            collector.observeOverrideMeta(argument.v.meta,
              'type.local-argument-override', expression.pos);
            collector.collect(argument.v.t, 'type.local-argument',
              expression.pos);
          }
        default:
      }
      expression.iter(collectLocalTypes);
    }

    /**
     * Reserves types printed only by the `Undefinable` presence assertion.
     *
     * Why: the typed marker carries its exact instantiated `T`, but ordinary
     * expression dependency discovery does not inspect every `TypedExpr.t`.
     * An emitter-local discovery could therefore name an imported type after
     * binding allocation had already frozen the import plan.
     *
     * What/How: TypeScript implementation planning walks exact marker calls
     * and collects the same return type that `TsModuleEmitter` later prints.
     * The marker owner remains compiler-only and creates no runtime edge.
     */
    function collectUndefinablePresentTypes(expression: TypedExpr): Void {
      if (expression == null)
        return;
      switch expression.expr {
        case TCall(callee, arguments):
          final marker = CompilerInternal.undefinablePresentMarkerCall(callee,
            arguments);
          if (marker != null)
            collector.collect(marker.resultType,
              'type.undefinable-present-assertion', expression.pos);
        default:
      }
      expression.iter(collectUndefinablePresentTypes);
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
              addReference(kind, TClassDecl(parent.type), '$kind.interface',
                cl.pos);
              collector.collectParams(parent.copyArguments(), true,
                '$kind.interface-arguments', cl.pos);
            }
          }
          switch publicSurface.superClassFor(params) {
            case null:
            case parent:
              addReference(kind, TClassDecl(parent.type), '$kind.superclass',
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
              field -> field.meta != null
                && field.meta.has(':genes.moduleFunction'))) {
            final sourceFields = Module.fieldsOf(cl, publicSurface, params,
              true, fields);
            for (field in sourceFields)
              if (field.meta != null && field.meta.has(':genes.moduleFunction')) {
                collectSignature(field);
              }
          }
          if (includeExpressionLocals) {
            for (field in fields) {
              collectLocalTypes(field.expr);
              collectUndefinablePresentTypes(field.expr);
            }
            collectLocalTypes(cl.init);
            collectUndefinablePresentTypes(cl.init);
          }

        case MEnum(enumType, params):
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

        case MMain(expression):
          collector.collect(expression.t, '$kind.main-result', expression.pos);
          if (includeExpressionLocals) {
            collectLocalTypes(expression);
            collectUndefinablePresentTypes(expression);
          }

        case MType(definition, params):
          collector.collectParams(params, true, '$kind.typedef-parameters',
            definition.pos);
          collector.collect(definition.type, '$kind.typedef-body',
            definition.pos);
      }
    }
  }
}
#end
