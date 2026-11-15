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

  /**
   * Returns whether a Haxe module owns one erased recursive JSON helper.
   *
   * `tests/jsonhelpers/JsonHelperModuleProbe.hx` lists the same five modules
   * and checks what each one declares. Add a new helper module there too.
   */
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
 *
 * Cost: the search runs for the type of every typed expression, more than a
 * million times in a large application. A type holds a reference to its
 * declaration. `ref.get()` makes Haxe copy the complete declaration into a
 * new macro value, which takes about 10 microseconds. `ref.toString()` only
 * returns the dotted path of the declaration. The search therefore reads the
 * path first and calls `ref.get()` only in two cases: the path contains
 * the package of the JSON helpers, or the underlying type of an abstract or
 * typedef has no completed result yet. On an application with 1,100 modules,
 * this removed about 7 seconds from each generation.
 */
private class JsonTypeQuery {
  /**
   * The package of the five JSON helper modules, with its final dot.
   *
   * `mayBeInJsonHelperModule` looks for this text in the dotted path of a
   * declaration, before the search pays for `ref.get()`.
   */
  static inline final JSON_HELPER_PACKAGE = 'genes.ts.';

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
      case TAbstract(ref, params): final path = ref.toString(); (mayBeInJsonHelperModule(path)
          && JsonTypeSupport.isJsonTypeModule(ref.get()
            .module)) || searchTypes(params) || searchDefinition('abstract:$path',
          () -> ref.get()
          .type);
      case TInst(ref, params): (mayBeInJsonHelperModule(ref.toString())
          && JsonTypeSupport.isJsonTypeModule(ref.get()
            .module)) || searchTypes(params);
      case TEnum(ref, params): (mayBeInJsonHelperModule(ref.toString())
          && JsonTypeSupport.isJsonTypeModule(ref.get()
            .module)) || searchTypes(params);
      case TType(ref, params): final path = ref.toString(); (mayBeInJsonHelperModule(path)
          && JsonTypeSupport.isJsonTypeModule(ref.get()
            .module)) || searchTypes(params) || searchDefinition('typedef:$path',
          () -> ref.get()
          .type);
      case TAnonymous(_.get() => anonymous):
        searchFields(anonymous.fields);
      case TFun(arguments, resultType): search(resultType) || searchFunctionArguments(arguments);
      case TDynamic(inner): inner != null && search(inner);
      case TMono(ref): final inner = ref.get(); inner != null && search(inner);
      case TLazy(resolve):
        search(resolve());
    }
  }

  /**
   * Returns `false` only when the dotted path proves that a declaration is
   * not in a JSON helper module. On `true`, the caller reads the module of
   * the declaration with `ref.get()` for the exact answer.
   *
   * Why the path can prove it: these declarations of a module in the package
   * `genes.ts` have that package in their path.
   *
   * - A public declaration: `genes.ts.JsonValue`.
   * - A module-private declaration, such as the implementation class of an
   *   abstract: `genes.ts._JsonValue.JsonValue_Impl_`.
   * - A type parameter of a class or abstract: `genes.ts.JsonValue.T`.
   * - The typedef that Haxe makes for a class, enum, or abstract used as a
   *   value. Its path is `Class<...>`, `Enum<...>`, or `Abstract<...>` around
   *   the path of that declaration, with no package of its own. This is why
   *   the check looks for the package anywhere in the path, not at its start.
   *
   * Limit: two kinds of declaration have a path without the package of their
   * module, and this check answers `false` for them.
   *
   * - A type parameter of a method. Its path starts with the method name:
   *   `pass.T` for `pkg.Generic.pass<T>`.
   * - A class or enum with `@:native`. Haxe replaces its path with the
   *   native path before generation. Haxe does not rename abstracts and
   *   typedefs.
   *
   * Neither can be in a JSON helper module today: each of the five modules
   * declares one abstract with an empty body, so it has no method, class, or
   * enum. `tests/jsonhelpers/JsonHelperModuleProbe.hx` fails the test build
   * when a helper module gets one. If a helper needs a method or a native
   * class, change this check first.
   */
  static inline function mayBeInJsonHelperModule(path: String): Bool {
    return path.indexOf(JSON_HELPER_PACKAGE) != -1;
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

  /**
   * Returns whether the underlying type of one abstract or typedef uses a
   * JSON helper, and keeps each safe result.
   *
   * `key` is the kind and the dotted path of the declaration. Haxe allows one
   * abstract and one typedef for each path, so two declarations never share a
   * key. `underlyingType` reads the type from the declaration. It is called
   * only when no result is kept and the declaration is not already on the
   * search path, because that read is the expensive step.
   */
  function searchDefinition(key: String, underlyingType: () -> Type): Bool {
    final cached = completedDefinitions.get(key);
    if (cached != null)
      return cached;
    if (activeDefinitions.exists(key))
      return false;

    final root = activeDefinitionCount == 0;
    activeDefinitionCount++;
    activeDefinitions.set(key, true);
    final found = search(underlyingType());
    activeDefinitions.remove(key);
    activeDefinitionCount--;
    if (found || root)
      completedDefinitions.set(key, found);
    return found;
  }
}
#end
