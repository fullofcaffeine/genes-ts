package genes;

#if macro
import haxe.macro.Type;

using haxe.macro.TypedExprTools;
using Lambda;

/**
 * Plans the recursive native-JSON aliases shared by generated TypeScript and
 * classic declaration files.
 *
 * Why: the `genes.ts.Json*` abstracts erase to ordinary JavaScript values, but
 * their `@:ts.type(...)` projections name a mutually recursive TypeScript type
 * family. A raw metadata string cannot create an importable Haxe declaration,
 * so every generated module that prints one of those projections must also own
 * the aliases. Keeping this rule in the TS implementation printer left classic
 * `.d.ts` files with unresolved `JsonValue`-style names.
 *
 * What: this target-polymorphic support fact detects JSON types in typed module
 * members, local expressions, and planned dependencies, then supplies the one
 * canonical alias family. It does not change runtime values or retain code.
 *
 * How: detection walks typed Haxe types with a recursion guard and recognizes
 * the five helper modules before their abstracts erase. Printers provide only a
 * line callback, so this semantic contract owns alias spelling while each
 * output profile still owns whitespace and placement. Future helper aliases
 * must be added here rather than as target-local string patches.
 */
class JsonTypeSupport {
  /** Emits the canonical module-local recursive JSON alias family. */
  public static function emitAliases(writeLine: String->Void): Void {
    writeLine('type JsonPrimitive = null | boolean | number | string');
    writeLine('type JsonObject = { readonly [key: string]: JsonValue }');
    writeLine('type JsonArray = readonly JsonValue[]');
    writeLine('type JsonValue = JsonPrimitive | JsonObject | JsonArray');
    writeLine('type JsonNonNullValue = Exclude<JsonValue, null>');
  }

  /** Returns whether executable or declaration members require JSON aliases. */
  public static function moduleUsesJsonTypes(module: Module): Bool {
    if (module.module != null && module.module.startsWith('genes.ts.Json'))
      return true;

    var found = false;
    final query = new JsonTypeQuery();
    function visitType(type: Type): Void {
      if (!found && type != null)
        found = query.uses(type);
    }
    function visitExpr(expression: TypedExpr): Void {
      if (found || expression == null)
        return;
      visitType(expression.t);
      switch expression.expr {
        case TVar(variable, _):
          visitType(variable.t);
        case TFunction(fn):
          for (argument in fn.args)
            visitType(argument.v.t);
          visitType(fn.t);
        default:
      }
      expression.iter(visitExpr);
    }

    for (member in module.members) {
      if (found)
        break;
      switch member {
        case MClass(cl, params, fields):
          for (param in params)
            visitType(param);
          visitType(cl.init == null ? null : cl.init.t);
          for (field in fields) {
            visitType(field.type);
            visitExpr(field.expr);
            if (found)
              break;
          }
        case MEnum(enumType, params):
          for (param in params)
            visitType(param);
          for (_ => constructor in enumType.constructs)
            visitType(constructor.type);
        case MType(definition, params):
          for (param in params)
            visitType(param);
          visitType(definition.type);
        case MMain(expression):
          visitExpr(expression);
      }
    }
    return found;
  }

  /** Returns whether an already-planned dependency names a JSON helper. */
  public static function dependenciesUseJsonTypes(dependencies: Dependencies): Bool {
    for (path => _ in dependencies.imports)
      if (isJsonTypeModule(path))
        return true;
    return false;
  }

  /** Returns whether a typed Haxe type projects through the JSON helper family. */
  public static function typeUsesJsonTypes(type: Type): Bool {
    return new JsonTypeQuery().uses(type);
  }

  /** Returns whether a Haxe module owns one erased recursive JSON helper. */
  public static function isJsonTypeModule(module: String): Bool {
    return module == 'genes.ts.JsonValue'
      || module == 'genes.ts.JsonObject' || module == 'genes.ts.JsonArray'
      || module == 'genes.ts.JsonPrimitive'
      || module == 'genes.ts.JsonNonNullValue';
  }
}

/**
 * Reuses completed declaration searches during one module inventory scan.
 *
 * Why: many expressions repeat the same standard abstracts and typedefs. Each
 * application still owns its generic arguments, but the declaration's
 * underlying type is unchanged for the request. Re-expanding it for every
 * expression dominated production compile time.
 *
 * How: completed definitions use the same exact declaration key as the
 * recursion guard. Generic arguments are always searched before that shared
 * result. A cycle edge returns false, but a nested false result is not cached
 * because an active ancestor can still find JSON in another branch. A true
 * result and an outermost completed false result are both safe to reuse.
 */
private class JsonTypeQuery {
  final completedDefinitions = new Map<String, Bool>();
  final activeDefinitions = new Map<String, Bool>();
  var activeDefinitionCount = 0;

  public function new() {}

  public function uses(type: Type): Bool {
    return search(type);
  }

  function search(type: Type): Bool {
    if (type == null)
      return false;
    return switch type {
      case TAbstract(_.get() => abstractType, params): JsonTypeSupport.isJsonTypeModule(abstractType.module) || searchTypes(params) || searchDefinition('abstract:${abstractType.module}:${abstractType.name}',
          abstractType.type);
      case TInst(_.get() => cl, params): JsonTypeSupport.isJsonTypeModule(cl.module) || searchTypes(params);
      case TEnum(_.get() => enumType, params): JsonTypeSupport.isJsonTypeModule(enumType.module) || searchTypes(params);
      case TType(_.get() => definition, params): JsonTypeSupport.isJsonTypeModule(definition.module) || searchTypes(params) || searchDefinition('typedef:${definition.module}:${definition.name}',
          definition.type);
      case TAnonymous(_.get() => anonymous):
        searchFields(anonymous.fields);
      case TFun(arguments, resultType): search(resultType) || searchFunctionArguments(arguments);
      case TDynamic(inner): inner != null && search(inner);
      case TMono(ref): final inner = ref.get(); inner != null && search(inner);
      case TLazy(resolve):
        search(resolve());
    }
  }

  function searchTypes(types: Array<Type>): Bool {
    for (type in types)
      if (search(type))
        return true;
    return false;
  }

  function searchFields(fields: Array<ClassField>): Bool {
    for (field in fields)
      if (search(field.type))
        return true;
    return false;
  }

  function searchFunctionArguments(arguments: Array<{
    name: String,
    opt: Bool,
    t: Type
  }>): Bool {
    for (argument in arguments)
      if (search(argument.t))
        return true;
    return false;
  }

  function searchDefinition(key: String, type: Type): Bool {
    final cached = completedDefinitions.get(key);
    if (cached != null)
      return cached;
    if (activeDefinitions.exists(key))
      return false;

    final root = activeDefinitionCount == 0;
    activeDefinitionCount++;
    activeDefinitions.set(key, true);
    final found = search(type);
    activeDefinitions.remove(key);
    activeDefinitionCount--;
    if (found || root)
      completedDefinitions.set(key, found);
    return found;
  }
}
#end
