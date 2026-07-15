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
import genes.DependencyPlan.DependencyProvenance;
import genes.Module.Field;
import genes.util.TypeUtil;

using haxe.macro.TypedExprTools;

/**
 * Builds one module's dependency graph from typed Haxe facts.
 *
 * Why: runtime values, implementation annotations, and public declarations
 * have different reachability rules. Combining them in a mutable import table
 * either keeps dead JS or drops types required by strict TypeScript consumers.
 *
 * What: this builder walks executable expressions for runtime edges and uses
 * `PublicSurface` plus `TypeReferenceCollector` for type/declaration edges. It
 * records the originating `ModuleType` before import aliases are allocated.
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
      addEdge(kind, request.referencedType, request.dependency, rule, pos);
    }
  }

  function addImport(kind: DependencyEdgeKind, dependency: Dependency,
      rule: String, pos: Position): Void {
    addEdge(kind, null, dependency, rule, pos);
  }

  function addEdge(kind: DependencyEdgeKind,
      referencedType: Null<ModuleType>, dependency: Null<Dependency>,
      rule: String, pos: Position): Void {
    // Keep the typed traversal's stable encounter order, including repeated
    // references. `Dependencies.push` owns import de-duplication and its alias
    // allocator historically observes those encounters when same-named symbols
    // from multiple modules collide. The graph is therefore an ordered
    // multigraph; reachability queries de-duplicate only their returned types.
    edges.push(new DependencyEdge(kind, referencedType,
      dependency == null ? null : new DependencyImport(dependency),
      new DependencyProvenance(rule, pos)));
  }

  function collectRuntimeEdges(): Void {
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

    function addFromExpr(expression: TypedExpr): Void {
      if (expression == null)
        return;
      addJsRequireFromExpr(expression);
      for (type in TypeUtil.typesInExpr(expression))
        addReference(RuntimeValue, type, 'runtime.typed-expression',
          expression.pos);
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
            addFromExpr(field.expr);
          addFromExpr(cl.init);
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
            addReference(kind, TClassDecl(parent.type), '$kind.interface',
              cl.pos);
            collector.collectParams(parent.copyArguments(), true,
              '$kind.interface-arguments', cl.pos);
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
