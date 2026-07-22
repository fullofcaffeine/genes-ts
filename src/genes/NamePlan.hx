package genes;

#if macro
import haxe.ds.ObjectMap;
import haxe.macro.Type;

using haxe.macro.TypedExprTools;

/** Selects naming policy without changing the shared local identities. */
enum abstract NamePlanProfile(String) to String {
  /** Preserve the compact Haxe/vanilla spelling used by classic Genes. */
  var ClassicStable = "classic-stable";

  /** Close TS function-scope collisions and improve safe generated names. */
  var TypeScriptReadable = "typescript-readable";
}

private typedef AllocationScope = {
  final counts: Map<String, Int>;
}

private typedef ObjectFieldLocalUse = {
  final local: TVar;
  final fieldName: String;
}

/**
 * Immutable emitted-name plan for every typed local in one module.
 *
 * Why: TypeScript naming previously depended on the order in which the printer
 * happened to encounter `TLocal` nodes. That mixed symbol identity, collision
 * repair, JSX/object readability heuristics, and formatting in one 5k-line
 * emitter. It also meant a formatting refactor could rename later locals.
 *
 * What: the plan maps stable `TVar.id` values to target-policy names. Classic
 * keeps the Haxe spelling. TS plans function-local collision suffixes and the
 * existing safe readability preferences before any source is written.
 *
 * How: `NamePlanBuilder` walks module expressions deterministically. Ordinary
 * Haxe blocks share their function allocation scope because historical Genes
 * can emit `var`; switch cases receive explicit child scopes because the TS
 * printer wraps them in braces. Nested functions receive independent counters.
 * Once built, printers perform lookup only—no name counters or preference maps
 * remain in either emitter.
 */
class NamePlan {
  final names: Map<Int, String>;
  final moduleBindings: Array<String>;

  public static function build(module: Module, temps: TempPlan,
      profile: NamePlanProfile, jsxEmitTsx = false): NamePlan {
    return new NamePlanBuilder(temps, profile, jsxEmitTsx,
      module.jsxPlan).build(module);
  }

  public function new(names: Map<Int, String>, moduleBindings: Array<String>) {
    this.names = names;
    this.moduleBindings = moduleBindings.copy();
  }

  /** Returns a precomputed raw name; identifier escaping remains printer syntax. */
  public function nameFor(local: TVar): String {
    final planned = names.get(local.id);
    if (planned != null)
      return planned;
    throw '[GTS-NAME-PLAN-001] Missing emitted name for TVar ${local.id} '
      + '(${local.name}). The typed expression must be added to NamePlan traversal.';
  }

  /** Returns locals emitted outside a function in deterministic order. */
  public function moduleBindingNames(): Array<String> {
    return moduleBindings.copy();
  }
}

/**
 * Builds one immutable `TVar.id` projection without emitting target text.
 *
 * Why: Haxe local identity is stronger than a source spelling. Inline expansion
 * can create several distinct `TVar` values named `value`, while lowered record
 * and JSX expressions can expose mechanically correct but noisy names.
 *
 * What/How: each function receives an independent allocation scope, switch
 * cases receive child scopes matching the braces emitted by TS, and module
 * initializers share their historical module scope. Preferences are computed
 * from complete blocks before any local is allocated, so traversal and printer
 * formatting cannot retroactively rename a symbol.
 */
private class NamePlanBuilder {
  final temps: TempPlan;
  final profile: NamePlanProfile;
  final jsxEmitTsx: Bool;
  final jsxPlan: JsxPlan;
  final names: Map<Int, String> = [];
  final moduleBindings: Array<String> = [];
  final generatedCounts: Map<String, Int> = [];
  final plannedFunctions = new ObjectMap<TFunc, Bool>();

  public function new(temps: TempPlan, profile: NamePlanProfile,
      jsxEmitTsx: Bool, jsxPlan: JsxPlan) {
    this.temps = temps;
    this.profile = profile;
    this.jsxEmitTsx = jsxEmitTsx;
    this.jsxPlan = jsxPlan;
  }

  public function build(module: Module): NamePlan {
    final moduleScope = allocationScope();
    final preferences: Map<Int, String> = [];
    for (member in module.members) {
      switch member {
        case MClass(cl, _, fields):
          // Methods are printed before static initializers in both profiles.
          for (field in fields) {
            if (field.expr == null)
              continue;
            switch field.expr.expr {
              case TFunction(func):
                planFunction(func);
              default:
            }
          }
          for (field in fields) {
            if (!field.isStatic || field.expr == null)
              continue;
            switch field.expr.expr {
              case TFunction(_):
              default:
                visit(field.expr, moduleScope, preferences, true);
            }
          }
          if (cl.init != null)
            visit(cl.init, moduleScope, preferences, true);
        case MMain(expression):
          visit(expression, moduleScope, preferences, true);
        case MEnum(_, _) | MType(_, _):
      }
    }
    return new NamePlan(names, moduleBindings);
  }

  /** Plans arguments and body locals in one independent function scope. */
  function planFunction(func: TFunc): Void {
    if (plannedFunctions.exists(func))
      return;
    plannedFunctions.set(func, true);
    final scope = allocationScope();
    final preferences: Map<Int, String> = [];
    for (argument in func.args)
      allocate(argument.v, scope, preferences, false);
    visit(func.expr, scope, preferences, false);
  }

  /** Traverses typed expressions using the lexical scopes the printers expose. */
  function visit(expression: TypedExpr, scope: AllocationScope,
      preferences: Map<Int, String>, moduleContext: Bool): Void {
    switch expression.expr {
      case TBlock(elements):
        final blockPreferences = copyPreferences(preferences);
        if (profile == TypeScriptReadable)
          addObjectConstructionPreferences(elements, blockPreferences);
        if (jsxEmitTsx) {
          if (profile == TypeScriptReadable)
            addTsxElementPreferences(elements, blockPreferences);
        }
        for (element in elements)
          visit(element, scope, blockPreferences, moduleContext);
      case TVar(local, initializer):
        allocate(local, scope, preferences, moduleContext);
        if (initializer != null)
          visit(initializer, scope, preferences, moduleContext);
      case TFunction(func):
        planFunction(func);
      case TFor(variable, iterator, body):
        visit(iterator, scope, preferences, moduleContext);
        allocate(variable, scope, preferences, moduleContext);
        visit(body, scope, preferences, moduleContext);
      case TTry(body, catches):
        visit(body, scope, preferences, moduleContext);
        for (entry in catches) {
          allocate(entry.v, scope, preferences, moduleContext);
          visit(entry.expr, scope, preferences, moduleContext);
        }
      case TSwitch(condition, cases, fallback):
        visit(condition, scope, preferences, moduleContext);
        for (entry in cases) {
          for (value in entry.values)
            visit(value, scope, preferences, moduleContext);
          visit(entry.expr, allocationScope(), preferences, moduleContext);
        }
        if (fallback != null)
          visit(fallback, allocationScope(), preferences, moduleContext);
      default:
        expression.iter(child -> visit(child, scope, preferences,
          moduleContext));
    }
  }

  /**
   * Allocates one raw target-policy name exactly once.
   *
   * Haxe-generated `_gN` locals retain the historical module-wide suffix
   * sequence; ordinary TS locals use function/case counts; classic locals keep
   * their upstream spelling. Identifier escaping remains printer syntax and is
   * applied only after this identity-based lookup.
   */
  function allocate(local: TVar, scope: AllocationScope,
      preferences: Map<Int, String>, moduleContext: Bool): Void {
    if (names.exists(local.id))
      return;
    if (jsxEmitTsx && jsxPlan.isSourceInlineChild(local))
      return;
    if (jsxEmitTsx && profile == ClassicStable
      && preferences.exists(local.id)) {
      final preferred = preferences.get(local.id);
      final count = countAndIncrement(scope.counts, preferred);
      final planned = suffix(preferred, count);
      names.set(local.id, planned);
      if (moduleContext)
        addModuleBinding(planned);
      return;
    }
    if (profile == ClassicStable) {
      names.set(local.id, local.name);
      if (moduleContext)
        addModuleBinding(local.name);
      return;
    }

    final temp = temps.tempForLocal(local);
    if (temp != null && temp.kind == HaxeGeneratedLocal) {
      final count = countAndIncrement(generatedCounts, local.name);
      final planned = suffix(local.name, count);
      names.set(local.id, planned);
      if (moduleContext)
        addModuleBinding(planned);
      return;
    }

    final baseName = preferences.exists(local.id)
      ? preferences.get(local.id)
      : local.name;
    final count = countAndIncrement(scope.counts, baseName);
    final planned = suffix(baseName, count);
    names.set(local.id, planned);
    if (moduleContext)
      addModuleBinding(planned);
  }

  function addModuleBinding(name:String):Void {
    if (moduleBindings.indexOf(name) == -1)
      moduleBindings.push(name);
  }

  static function countAndIncrement(counts: Map<String, Int>, name: String): Int {
    final count = counts.exists(name) ? counts.get(name) : 0;
    counts.set(name, count + 1);
    return count;
  }

  static inline function suffix(name: String, count: Int): String {
    return count == 0 ? name : '${name}_${count}';
  }

  static function allocationScope(): AllocationScope {
    return {counts: []};
  }

  static function copyPreferences(source: Map<Int, String>): Map<Int, String> {
    final result: Map<Int, String> = [];
    for (key in source.keys())
      result.set(key, source.get(key));
    return result;
  }

  /** Plans readable field names without changing lowered evaluation order. */
  static function addObjectConstructionPreferences(elements: Array<TypedExpr>,
      preferences: Map<Int, String>): Void {
    final declarations: Map<Int, TVar> = [];
    final declarationOrder: Map<Int, Int> = [];
    final uses: Map<Int, Int> = [];

    for (index in 0...elements.length) {
      switch unwrap(elements[index]).expr {
        case TVar(local, _):
          declarations.set(local.id, local);
          declarationOrder.set(local.id, index);
        default:
      }
      countLocalUses(elements[index], uses);
    }

    for (index in 0...elements.length) {
      switch unwrap(elements[index]).expr {
        case TVar(objectLocal, initializer) if (initializer != null):
          final objectParts = numberedLocalName(objectLocal.name);
          if (objectParts == null || objectParts.index == null)
            continue;
          switch unwrap(initializer).expr {
            case TObjectDecl(fields):
              var foundFieldTemp = false;
              final fieldUses: Array<ObjectFieldLocalUse> = [];
              for (field in fields)
                collectObjectFieldLocalUses(field.expr, field.name, fieldUses);
              for (fieldUse in fieldUses) {
                final fieldLocal = fieldUse.local;
                final fieldParts = numberedLocalName(fieldLocal.name);
                if (fieldParts == null || fieldParts.prefix != objectParts.prefix)
                  continue;
                final fieldIndex = fieldParts.index == null ? 0 : fieldParts.index;
                if (fieldIndex >= objectParts.index)
                  continue;
                if (!declarations.exists(fieldLocal.id)
                  || declarationOrder.get(fieldLocal.id) >= index)
                  continue;
                if ((uses.exists(fieldLocal.id) ? uses.get(fieldLocal.id) : 0) != 1)
                  continue;
                final preferred = preferredNameForObjectField(fieldUse.fieldName);
                if (preferred == null)
                  continue;
                preferences.set(fieldLocal.id, preferred);
                foundFieldTemp = true;
              }
              if (foundFieldTemp && isValidIdentifier(objectParts.prefix))
                preferences.set(objectLocal.id, objectParts.prefix);
            default:
          }
        default:
      }
    }
  }

  /** Plans readable TSX child names for single-use Haxe marker locals. */
  static function addTsxElementPreferences(elements: Array<TypedExpr>,
      preferences: Map<Int, String>): Void {
    final uses: Map<Int, Int> = [];
    for (element in elements)
      countLocalUses(element, uses);
    for (element in elements) {
      switch unwrap(element).expr {
        case TVar(local, initializer)
          if (initializer != null && isLowQualityTempName(local.name)
            && (uses.exists(local.id) ? uses.get(local.id) : 0) == 1):
          final preferred = preferredNameForJsxElement(initializer);
          if (preferred != null)
            preferences.set(local.id, preferred);
        default:
      }
    }
  }

  static function preferredNameForJsxElement(expression: TypedExpr): Null<String> {
    return switch unwrap(expression).expr {
      case TCall(callee, arguments):
        switch JsxPlan.markerName(callee) {
          case '__jsx':
            arguments.length == 3 ? preferredNameForJsxTag(arguments[0]) : null;
          case '__frag':
            'fragment';
          case _:
            null;
        }
      default:
        null;
    }
  }

  static function preferredNameForJsxTag(tag: TypedExpr): Null<String> {
    return switch unwrap(tag).expr {
      case TConst(TString(name)):
        preferredNameFromJsxTagString(name);
      case TLocal(local):
        sanitizePreferredName(local.name);
      default:
        null;
    }
  }

  static function preferredNameFromJsxTagString(tag: String): Null<String> {
    if (tag == null || tag.length == 0)
      return null;
    final parts = tag.split('-');
    var result = '';
    for (partValue in parts) {
      final part = sanitizePreferredName(partValue);
      if (part == null)
        continue;
      result += result.length == 0
        ? part
        : part.substr(0, 1).toUpperCase() + part.substr(1);
    }
    return result.length == 0 ? null : result;
  }

  static function sanitizePreferredName(name: String): Null<String> {
    if (name == null || name.length == 0)
      return null;
    final result = new StringBuf();
    for (index in 0...name.length) {
      final code = name.charCodeAt(index);
      final valid = (code >= "a".code && code <= "z".code)
        || (code >= "A".code && code <= "Z".code)
        || (index > 0 && code >= "0".code && code <= "9".code)
        || code == "_".code || code == "$".code;
      if (valid)
        result.addChar(code);
    }
    final sanitized = result.toString();
    return sanitized.length == 0 ? null : sanitized;
  }

  static function collectObjectFieldLocalUses(expression: TypedExpr,
      fieldName: String, result: Array<ObjectFieldLocalUse>): Void {
    final direct = directLocalValue(expression);
    if (direct != null) {
      result.push({local: direct, fieldName: fieldName});
      return;
    }
    switch unwrap(expression).expr {
      case TObjectDecl(fields):
        for (field in fields)
          collectObjectFieldLocalUses(field.expr, field.name, result);
      default:
    }
  }

  static function directLocalValue(expression: TypedExpr): Null<TVar> {
    return switch unwrap(expression).expr {
      case TLocal(local): local;
      default: null;
    }
  }

  static function preferredNameForObjectField(name: String): Null<String> {
    if (name == null || name.length == 0)
      return null;
    final cleaned = name == "function" ? "fn" : name;
    return isValidIdentifier(cleaned) ? cleaned : null;
  }

  static function numberedLocalName(name: String): Null<{
    prefix: String,
    index: Null<Int>
  }> {
    if (name == null || name.length == 0)
      return null;
    var split = name.length;
    while (split > 0) {
      final code = name.charCodeAt(split - 1);
      if (code < "0".code || code > "9".code)
        break;
      split--;
    }
    final prefix = name.substr(0, split);
    if (prefix.length == 0)
      return null;
    return split == name.length
      ? {prefix: prefix, index: null}
      : {prefix: prefix, index: Std.parseInt(name.substr(split))};
  }

  static function countLocalUses(expression: TypedExpr,
      uses: Map<Int, Int>): Void {
    switch unwrap(expression).expr {
      case TLocal(local):
        uses.set(local.id, (uses.exists(local.id) ? uses.get(local.id) : 0) + 1);
      default:
    }
    expression.iter(child -> countLocalUses(child, uses));
  }

  static function unwrap(expression: TypedExpr): TypedExpr {
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

  static function isLowQualityTempName(name: String): Bool {
    if (name == "tmp")
      return true;
    if (!StringTools.startsWith(name, "tmp") || name.length == 3)
      return false;
    for (index in 3...name.length) {
      final code = name.charCodeAt(index);
      if (code < "0".code || code > "9".code)
        return false;
    }
    return true;
  }

  static function isValidIdentifier(name: String): Bool {
    if (name == null || name.length == 0)
      return false;
    final first = name.charCodeAt(0);
    if (!((first >= "a".code && first <= "z".code)
      || (first >= "A".code && first <= "Z".code)
      || first == "_".code || first == "$".code))
      return false;
    for (index in 1...name.length) {
      final code = name.charCodeAt(index);
      if (!((code >= "a".code && code <= "z".code)
        || (code >= "A".code && code <= "Z".code)
        || (code >= "0".code && code <= "9".code)
        || code == "_".code || code == "$".code))
        return false;
    }
    return true;
  }
}
#end
