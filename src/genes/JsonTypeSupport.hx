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
    function visitType(type: Type): Void {
      if (!found && type != null)
        found = typeUsesJsonTypes(type);
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
    return typeUsesJsonTypesWithSeen(type, []);
  }

  static function typeUsesJsonTypesWithSeen(type: Type,
      seen: Map<String, Bool>): Bool {
    if (type == null)
      return false;
    return switch type {
      case TAbstract(_.get() => abstractType, params):
        final key = 'abstract:${abstractType.module}:${abstractType.name}';
        if (seen.exists(key))
          false;
        else {
          seen.set(key, true);
          isJsonTypeModule(abstractType.module)
            || params.exists(param -> typeUsesJsonTypesWithSeen(param, seen))
            || typeUsesJsonTypesWithSeen(abstractType.type, seen);
        }
      case TInst(_.get() => cl, params):
        isJsonTypeModule(cl.module)
          || params.exists(param -> typeUsesJsonTypesWithSeen(param, seen));
      case TEnum(_.get() => enumType, params):
        isJsonTypeModule(enumType.module)
          || params.exists(param -> typeUsesJsonTypesWithSeen(param, seen));
      case TType(_.get() => definition, params):
        final key = 'typedef:${definition.module}:${definition.name}';
        if (seen.exists(key))
          false;
        else {
          seen.set(key, true);
          isJsonTypeModule(definition.module)
            || params.exists(param -> typeUsesJsonTypesWithSeen(param, seen))
            || typeUsesJsonTypesWithSeen(definition.type, seen);
        }
      case TAnonymous(_.get() => anonymous):
        anonymous.fields.exists(field ->
          typeUsesJsonTypesWithSeen(field.type, seen));
      case TFun(arguments, result):
        typeUsesJsonTypesWithSeen(result, seen)
          || arguments.exists(argument ->
            typeUsesJsonTypesWithSeen(argument.t, seen));
      case TDynamic(inner):
        inner != null && typeUsesJsonTypesWithSeen(inner, seen);
      case TMono(ref):
        final inner = ref.get();
        inner != null && typeUsesJsonTypesWithSeen(inner, seen);
      case TLazy(resolve):
        typeUsesJsonTypesWithSeen(resolve(), seen);
    }
  }

  /** Returns whether a Haxe module owns one erased recursive JSON helper. */
  public static function isJsonTypeModule(module: String): Bool {
    return module == 'genes.ts.JsonValue'
      || module == 'genes.ts.JsonObject'
      || module == 'genes.ts.JsonArray'
      || module == 'genes.ts.JsonPrimitive'
      || module == 'genes.ts.JsonNonNullValue';
  }
}
#end
