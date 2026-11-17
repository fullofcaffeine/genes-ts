package genes;

#if macro
import haxe.io.Path;
import haxe.macro.Context;
import haxe.macro.Type;
import genes.ModuleFunctionPlan.ModuleFunctionEntry;

using haxe.macro.TypedExprTools;

/**
 * Which part of a split React module one TypeScript emitter writes.
 *
 * `Whole` is the ordinary single file. `Components` is the public module file
 * when the module is split: it holds only the React component functions.
 * `Fields` is the private sibling file that holds every other declaration.
 */
enum ReactRefreshPart {
  Whole;
  Components(siblingBindings: Array<ReactRefreshBinding>);
  Fields;
}

/**
 * One top-level binding that the `Fields` part declares.
 *
 * `isType` is true for a declaration that exists only as a TypeScript type
 * (a typedef). `wasExported` tells whether the same declaration is exported
 * from the ordinary single file. The `Components` part re-exports exactly
 * those bindings, so the public surface of the module stays the same.
 */
class ReactRefreshBinding {
  public final name: String;
  public final isType: Bool;
  public final wasExported: Bool;

  public function new(name: String, isType: Bool, wasExported: Bool) {
    this.name = name;
    this.isType = isType;
    this.wasExported = wasExported;
  }
}

/**
 * Decides when Genes splits one generated React module into two files, so
 * that React Fast Refresh can hot-update it.
 *
 * Why: React Fast Refresh (for example `@vitejs/plugin-react`) hot-updates a
 * changed module only when each value that the module exports is a React
 * component, or is the same object as before the update. Genes emits a Haxe
 * module as one file. When that file holds a component and also a class, an
 * enum, a hook or the `X_Fields_` class of module-level functions, the dev
 * server rejects the update ("export is incompatible") and reloads the page.
 * The page then loses its React state.
 *
 * What: with `-D genes.react_refresh_modules` (TypeScript profile only), a
 * module that has at least one `@:genes.reactComponent` module function and
 * at least one other runtime declaration becomes two files:
 *
 * - `X.tsx` (public path, unchanged for importers): the component functions,
 *   then a re-export of every binding that `X.tsx` exported before;
 * - `X.fields.tsx` (private sibling): every other declaration, each one
 *   exported so that `X.tsx` can import it.
 *
 * Example: `WorkspaceMap.hx` has the component `WorkspaceMap` and the
 * module-level function `emptyMapNavigation`. `WorkspaceMap.tsx` then holds
 * `export function WorkspaceMap` and `export {WorkspaceMap_Fields_,
 * emptyMapNavigation} from` the sibling. An edit of the component body
 * changes only `WorkspaceMap.tsx`. The re-exported values come from the
 * unchanged sibling, so they are the same objects after the update, and
 * Fast Refresh accepts it. An edit of `emptyMapNavigation` changes the
 * sibling; the dev server then updates the importers, as without the split.
 *
 * Importers do not change: they still import from `X`. A module with only
 * components (and types) is not split, because it is already accepted.
 *
 * How: the decision reads only typed facts of the module itself (members,
 * the component marker and the module function and value plans). The
 * compilation server stores and replays both files of a module together, and
 * the define is part of its session key.
 *
 * Limits: only the component file imports the other one; the sibling reads
 * a component through its `Owner.field` slot (`readsThroughSlot`), which the
 * component file sets after the sibling has loaded. `componentNames` lists
 * the cases where that would be too late, and keeps those modules as one
 * file. Both files repeat the import list of the module, so that module
 * load order stays the same as in one file when the consumer keeps value
 * imports (`verbatimModuleSyntax`). Classic JavaScript output is not
 * supported.
 */
class ReactRefreshModulePlan {
  /** The define that turns the split on. */
  public static final DEFINE = 'genes.react_refresh_modules';

  /** The marker that `genes.react` reads to find a component. */
  static final COMPONENT_METADATA = ':genes.reactComponent';

  /** The suffix of the sibling file, added before the output extension. */
  public static final FIELDS_SUFFIX = '.fields';

  /** True when the define is present for this compilation. */
  public static function enabled(): Bool {
    return Context.defined(DEFINE);
  }

  /**
   * Stops a classic JavaScript build that sets the define.
   *
   * The split is proved only for the TypeScript profile. A silent no-op would
   * let a classic project think that Fast Refresh works.
   */
  public static function validateProfile(): Void {
    if (enabled() && !Context.defined('genes.ts'))
      Context.error('[GENES-REACT-REFRESH-001] -D $DEFINE needs the '
        + 'TypeScript profile (-D genes.ts). Classic JavaScript output does '
        + 'not support React Fast Refresh modules.',
        Context.currentPos());
  }

  /** True when this module function is a reviewed React component. */
  public static function isComponent(entry: ModuleFunctionEntry): Bool {
    return entry.field.meta != null && entry.field.meta.has(COMPONENT_METADATA);
  }

  /**
   * Returns the requested names of the component functions of a module, in
   * member and field order, or `null` when the module is not split.
   *
   * A module stays one file when:
   * - it has no component, or no other runtime declaration;
   * - it is the entry module (`MMain`): a dev server never hot-updates it;
   * - code that runs while the module loads (a static initializer or a class
   *   `__init__`) can reach a component of the module, also through calls of
   *   other functions, constructors or methods of the module
   *   (`reachesComponent`). The component file sets the `Owner.field` slots
   *   only after the sibling has loaded, so such code would call the
   *   placeholder method;
   * - a direct (hoisted) non-component module function can reach a component
   *   through other direct functions. Another module in an import cycle can
   *   call it before the sibling has defined the slot class;
   * - the owner class of a component is omitted (all its fields are direct
   *   functions) and other code of the module names the component: the
   *   sibling would have no slot to read.
   */
  public static function componentNames(module: Module): Null<Array<String>> {
    if (!enabled() || !Context.defined('genes.ts'))
      return null;
    final plan = module.moduleFunctionPlan;
    final valuePlan = module.moduleValuePlan;
    final graph = new ModuleCodeGraph(module.module);
    final components = [];
    final loadTime: Array<TypedExpr> = [];
    final directBodies: Array<TypedExpr> = [];
    final siblingCode: Array<TypedExpr> = [];
    final omittedComponentKeys = new Map<String, Bool>();
    var hasOtherRuntime = false;
    for (member in module.members) {
      if (!Module.memberProjection(member).emitImplementation)
        continue;
      switch member {
        case MMain(_):
          return null;
        case MClass(cl, _, _) if (cl.isInterface):
          // TypeScript output adds a runtime marker for an interface.
          hasOtherRuntime = true;
        case MClass(cl, _, fields):
          final emittable = Module.emittableFields(fields);
          final ownerOmitted = DirectModuleBinding.canOmitSyntheticOwner(cl,
            emittable);
          if (!ownerOmitted)
            hasOtherRuntime = true;
          if (valuePlan.entriesFor(cl).length > 0)
            hasOtherRuntime = true;
          for (entry in plan.entriesFor(cl)) {
            final key = ModuleCodeGraph.staticKey(cl.name, entry.field.name);
            if (isComponent(entry)) {
              components.push(entry.requestedName);
              graph.components.set(key, true);
              if (ownerOmitted)
                omittedComponentKeys.set(key, true);
            } else {
              hasOtherRuntime = true;
              graph.direct.set(key, true);
              if (entry.field.expr != null)
                directBodies.push(entry.field.expr);
            }
          }
          graph.addClass(cl, emittable);
          for (field in emittable) {
            if (field.expr == null)
              continue;
            final key = ModuleCodeGraph.staticKey(cl.name, field.name);
            if (field.isStatic && graph.components.exists(key))
              continue;
            siblingCode.push(field.expr);
            if (field.isStatic && field.kind.match(Property))
              loadTime.push(field.expr);
          }
          if (cl.init != null) {
            loadTime.push(cl.init);
            siblingCode.push(cl.init);
          }
        case MEnum(_, _):
          hasOtherRuntime = true;
        case MType(_, _):
      }
    }
    if (components.length == 0 || !hasOtherRuntime)
      return null;
    if (graph.reachesComponent(loadTime, true))
      return null;
    if (graph.reachesComponent(directBodies, false))
      return null;
    if (ModuleCodeGraph.names(siblingCode, module.module, omittedComponentKeys))
      return null;
    return components;
  }

  /**
   * True when, in the sibling file of a split module, a reference to this
   * module function must read the `Owner.field` slot instead of the direct
   * function binding.
   *
   * The sibling must not import the component file: that import cycle makes
   * Vite load the sibling again on each component update, so the values that
   * the component file re-exports are no longer the same objects. The slot
   * holds the same function, set by the component file.
   */
  public static function readsThroughSlot(owner: ClassType, field: ClassField,
      module: Module): Bool {
    return owner.module == module.module && field.meta.has(COMPONENT_METADATA);
  }

  /** The output path of the sibling file for a module output path. */
  public static function fieldsPath(modulePath: String,
      extension: String): String {
    return modulePath + FIELDS_SUFFIX + extension;
  }

  /** The import specifier, without extension, from one part to the other. */
  public static function siblingSpecifier(module: Module,
      toFields: Bool): String {
    final base = './' + Path.withoutDirectory(module.path);
    return toFields ? base + FIELDS_SUFFIX : base;
  }
}

/**
 * The code of one Haxe module as a graph of function bodies, used to find
 * whether some code can reach a React component of the same module.
 *
 * Keys: `Owner.field` for a static field, `Owner#new` for a constructor, and
 * `#name` for every instance field named `name` (a method call can dispatch
 * to an override in any class of the module, so all of them are followed).
 * Only references to the same module are followed; calls through `Dynamic`
 * values are not visible to the typed tree.
 */
private class ModuleCodeGraph {
  public final components = new Map<String, Bool>();
  public final direct = new Map<String, Bool>();

  final module: String;
  final bodies = new Map<String, Array<TypedExpr>>();
  final superConstructor = new Map<String, String>();

  public function new(module: String) {
    this.module = module;
  }

  public static function staticKey(owner: String, field: String): String {
    return owner + '.' + field;
  }

  static function constructorKey(owner: String): String {
    return owner + '#new';
  }

  static function instanceKey(field: String): String {
    return '#' + field;
  }

  function add(key: String, body: TypedExpr): Void {
    final list = bodies.get(key);
    if (list == null)
      bodies.set(key, [body]);
    else
      list.push(body);
  }

  /** Adds the bodies of one class: statics, constructor and instance fields. */
  public function addClass(cl: ClassType, fields: Array<Module.Field>): Void {
    if (cl.superClass != null) {
      final parent = cl.superClass.t.get();
      if (parent.module == module)
        superConstructor.set(cl.name, parent.name);
    }
    for (field in fields) {
      if (field.expr == null)
        continue;
      if (field.isStatic)
        add(staticKey(cl.name, field.name), field.expr);
      else if (field.kind.match(Constructor))
        add(constructorKey(cl.name), field.expr);
      else {
        add(instanceKey(field.name), field.expr);
        // An instance variable initializer runs in the constructor.
        if (field.kind.match(Property))
          add(constructorKey(cl.name), field.expr);
      }
    }
  }

  /**
   * True when one of `starts` reaches a component. With `followAll` it
   * follows static calls, constructors and instance methods of the module;
   * otherwise only direct module functions.
   */
  public function reachesComponent(starts: Array<TypedExpr>,
      followAll: Bool): Bool {
    final visited = new Map<String, Bool>();
    final queue = starts.copy();
    function follow(key: String): Void {
      if (visited.exists(key))
        return;
      visited.set(key, true);
      final list = bodies.get(key);
      if (list != null)
        for (body in list)
          queue.push(body);
    }
    function followConstructor(owner: String): Void {
      var current: Null<String> = owner;
      while (current != null) {
        follow(constructorKey(current));
        current = superConstructor.get(current);
      }
    }
    var found = false;
    function visit(current: TypedExpr): Void {
      if (found || current == null)
        return;
      switch current.expr {
        case TField(_, FStatic(owner, field)) if (owner.get().module == module):
          final key = staticKey(owner.get().name, field.get().name);
          if (components.exists(key)) {
            found = true;
            return;
          }
          if (followAll || direct.exists(key))
            follow(key);
        case TField(_, FInstance(owner, _, field))
          if (followAll && owner.get().module == module):
          follow(instanceKey(field.get().name));
        case TField(_, FClosure(owner, field))
          if (followAll && owner != null && owner.c.get().module == module):
          follow(instanceKey(field.get().name));
        case TNew(owner, _, _) if (followAll && owner.get().module == module):
          followConstructor(owner.get().name);
        default:
      }
      current.iter(visit);
    }
    while (queue.length > 0 && !found)
      visit(queue.shift());
    return found;
  }

  /** True when one of `expressions` names one of the `keys` statics. */
  public static function names(expressions: Array<TypedExpr>, module: String,
      keys: Map<String, Bool>): Bool {
    var found = false;
    function visit(current: TypedExpr): Void {
      if (found || current == null)
        return;
      switch current.expr {
        case TField(_, FStatic(owner, field))
          if (owner.get().module == module
            && keys.exists(staticKey(owner.get().name, field.get().name))):
          found = true;
          return;
        default:
      }
      current.iter(visit);
    }
    for (expression in expressions)
      visit(expression);
    return found;
  }
}
#end
