package genes;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr.Constant;
import haxe.macro.Expr.ExprDef;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
import genes.Dependencies.Dependency;
import genes.Dependencies.DependencyType;
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

  public static function build(module: Module): DependencyPlan {
    final builder = new DependencyPlanBuilder(module);
    builder.collectRuntimeEdges();
    if (Context.defined('genes.ts'))
      builder.collectTypeEdges(TypeOnly, true);
    if (Context.defined('dts'))
      builder.collectTypeEdges(DeclarationOnly, false);
    return new DependencyPlan(builder.edges);
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
        Bound(new DependencyImport(request.dependency)), rule, pos);
    }
  }

  function addImport(kind: DependencyEdgeKind, dependency: Dependency,
      rule: String, pos: Position): Void {
    addEdge(kind, null, Bound(new DependencyImport(dependency)), rule, pos);
  }

  function addEdge(kind: DependencyEdgeKind,
      referencedType: Null<ModuleType>, importSpec: Null<DependencyImportSpec>,
      rule: String, pos: Position): Void {
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
    final jsxPlan = module.jsxPlan;
    final jsxCapability = JsxCapabilityPolicy.current();
    jsxCapability.validate(jsxPlan);
    if (jsxCapability.requiresRuntimeNamespace(jsxPlan)) {
      addImport(RuntimeValue, {
        type: DependencyType.DAsterisk,
        name: jsxCapability.runtimeBindingName,
        path: jsxCapability.runtimeModule,
        external: true,
        pos: jsxPlan.firstPosition
      }, JsxCapabilityPolicy.RUNTIME_IMPORT_RULE, jsxPlan.firstPosition);
    }

    #if (haxe_ver >= 4.2)
    function addModuleFieldRequires(cl: ClassType,
        fields: Array<Field>): Void {
      if (!cl.kind.match(KModuleFields(_)))
        return;
      for (field in fields) {
        if (!field.isStatic || field.meta == null)
          continue;
        switch field.meta.extract(':jsRequire') {
          case [{params: [{expr: EConst(CString(path))}]}] |
            [{
              params: [
                {expr: EConst(CString(path))},
                {expr: EConst(CString('default'))}
              ]
            }]:
            addImport(RuntimeValue, {
              type: DependencyType.DDefault,
              name: field.name,
              path: path,
              external: true,
              importAttributeType: Dependencies.extractImportAttributeType(
                field.meta),
              pos: field.pos
            }, 'runtime.module-field-js-require', field.pos);
          case [{
            params: [
              {expr: EConst(CString(path))},
              {expr: EConst(CString(name))}
            ]
          }]:
            addImport(RuntimeValue, {
              type: DependencyType.DName,
              name: name,
              path: path,
              external: true,
              importAttributeType: Dependencies.extractImportAttributeType(
                field.meta),
              pos: field.pos
            }, 'runtime.module-field-js-require', field.pos);
          default:
        }
      }
    }
    #end

    function addJsRequireFromExpr(expression: TypedExpr): Void {
      if (expression == null)
        return;
      switch expression.expr {
        case TField(_, FStatic(_, _.get() => field)):
          switch field.meta.extract(':jsRequire') {
            case [{params: [{expr: EConst(CString(path))}]}] |
              [{
                params: [
                  {expr: EConst(CString(path))},
                  {expr: EConst(CString('default'))}
                ]
              }]:
              addImport(RuntimeValue, {
                type: DependencyType.DDefault,
                name: field.name,
                path: path,
                external: true,
                importAttributeType: Dependencies.extractImportAttributeType(
                  field.meta),
                pos: field.pos
              }, 'runtime.expression-js-require', field.pos);
            case [{
              params: [
                {expr: EConst(CString(path))},
                {expr: EConst(CString(name))}
              ]
            }]:
              addImport(RuntimeValue, {
                type: DependencyType.DName,
                name: name,
                path: path,
                external: true,
                importAttributeType: Dependencies.extractImportAttributeType(
                  field.meta),
                pos: field.pos
              }, 'runtime.expression-js-require', field.pos);
            default:
          }
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
          CompilerDiagnostic.fail(
            'GENES-SIDE-EFFECT-IMPORT-ATTRIBUTE-001: import attribute type must be a non-empty string literal or null',
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
            CompilerDiagnostic.fail(
              'GENES-SIDE-EFFECT-IMPORT-INTERNAL-001: external marker requires a specifier and attribute',
              expression.pos);
          final path = literalString(marker.arguments[0],
            'GENES-SIDE-EFFECT-IMPORT-LITERAL-001: module specifier must be a non-empty string literal');
          final attribute = optionalLiteralString(marker.arguments[1]);
          addSideEffect(null, new DependencyModuleRequest(true, path,
            attribute, expression.pos), 'runtime.side-effect.external',
            expression.pos);

        case 'internal':
          if (marker.arguments.length != 1)
            CompilerDiagnostic.fail(
              'GENES-SIDE-EFFECT-IMPORT-INTERNAL-001: internal marker requires one typed target token',
              expression.pos);
          final argument = unwrap(marker.arguments[0]);
          final targetType = switch argument.expr {
            case TField({expr: TTypeExpr(type)}, FStatic(_, _)): type;
            case TTypeExpr(type): type;
            default:
              CompilerDiagnostic.fail(
                'GENES-SIDE-EFFECT-IMPORT-INTERNAL-001: internal marker target must be a static field or type token',
                argument.pos);
          }
          final requests = Dependencies.requests(module, targetType);
          if (requests.length != 1 || requests[0].dependency.external)
            CompilerDiagnostic.fail(
              'GENES-SIDE-EFFECT-IMPORT-INTERNAL-001: internal marker target must resolve to one generated module',
              argument.pos);
          final target = requests[0];
          final dependency = new DependencyImport(target.dependency);
          addSideEffect(target.referencedType,
            new DependencyModuleRequest(false, dependency.path,
              dependency.importAttributeType, expression.pos),
            'runtime.side-effect.internal', expression.pos);

        default:
          CompilerDiagnostic.fail(
            'GENES-SIDE-EFFECT-IMPORT-INTERNAL-001: unknown compiler marker',
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
      for (type in TypeUtil.typesInExpr(expression))
        addReference(RuntimeValue, type, 'runtime.typed-expression',
          expression.pos);
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
          CompilerDiagnostic.fail(
            'GENES-SIDE-EFFECT-IMPORT-CONTEXT-001: compiler marker must be a direct static-initialization statement',
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
          CompilerDiagnostic.fail(
            'GENES-SIDE-EFFECT-IMPORT-CONTEXT-001: compiler marker must be a direct static-initialization statement',
            statement.pos);
        addOrdinaryExpression(statement);
      }
    }

    for (member in module.members) {
      switch member {
        case MClass(cl, _, fields):
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
          addFromExpr(expression);
        default:
      }
    }
    if (module.module != 'genes.Register')
      addReference(RuntimeValue, TypeUtil.registerType,
        'runtime.registration', Context.currentPos());
  }

  function collectTypeEdges(kind: DependencyEdgeKind,
      includeExpressionLocals: Bool): Void {
    final collector = new TypeReferenceCollector((type, rule, pos) ->
      addReference(kind, type, rule, pos));

    function collectLocalTypes(expression: TypedExpr): Void {
      if (expression == null)
        return;
      switch expression.expr {
        case TVar(variable, _):
          collector.collect(variable.t, 'type.local-variable', expression.pos);
        case TFunction(functionType):
          for (argument in functionType.args)
            collector.collect(argument.v.t, 'type.local-argument',
              expression.pos);
        default:
      }
      expression.iter(collectLocalTypes);
    }

    function collectSignature(field: Field): Void {
      if (field.tsType != null)
        return;
      collector.collectParams(field.params.map(parameter -> parameter.t), true,
        '$kind.member-parameters', field.pos);
      collector.collect(field.type, '$kind.member-signature', field.pos);
      for (signature in field.overloads)
        collectSignature(signature);
    }

    for (member in module.members) {
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
          final signatureFields = if (cl.isInterface)
            Module.fieldsOf(cl, publicSurface, params,
              kind == TypeOnly, null)
          else if (kind == DeclarationOnly)
            Module.fieldsOf(cl, publicSurface, params, false, fields)
          else
            fields;
          for (field in signatureFields)
            collectSignature(field);
          if (includeExpressionLocals) {
            for (field in fields)
              collectLocalTypes(field.expr);
            collectLocalTypes(cl.init);
          }

        case MEnum(enumType, params):
          collector.collectParams(params, true, '$kind.enum-parameters',
            enumType.pos);
          for (constructor in enumType.constructs) {
            collector.collectParams(
              constructor.params.map(parameter -> parameter.t), true,
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
          if (includeExpressionLocals)
            collectLocalTypes(expression);

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
