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
 * Limits: the two files import each other. This is safe because the
 * component file holds only hoisted function declarations at the top level.
 * Both files repeat the import list of the module, so that module load order
 * stays the same as in one file when the consumer keeps value imports
 * (`verbatimModuleSyntax`). Classic JavaScript output is not supported.
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
   */
  public static function componentNames(module: Module): Null<Array<String>> {
    if (!enabled() || !Context.defined('genes.ts'))
      return null;
    final plan = module.moduleFunctionPlan;
    final valuePlan = module.moduleValuePlan;
    final components = [];
    final componentKeys = new Map<String, Bool>();
    final loadTimeExpressions: Array<TypedExpr> = [];
    var hasOtherRuntime = false;
    for (member in module.members) {
      if (!Module.memberProjection(member).emitImplementation)
        continue;
      switch member {
        case MMain(_):
          // The entry module runs the program; a dev server never hot-updates it.
          return null;
        case MClass(cl, _, fields) if (!cl.isInterface):
          for (entry in plan.entriesFor(cl))
            if (isComponent(entry))
              componentKeys.set(cl.name + '.' + entry.field.name, true);
          for (field in Module.emittableFields(fields))
            if (field.isStatic && field.expr != null
              && field.kind.match(Property))
              loadTimeExpressions.push(field.expr);
          if (cl.init != null)
            loadTimeExpressions.push(cl.init);
        default:
      }
      switch member {
        case MClass(cl, _, _) if (cl.isInterface):
          // TypeScript output adds a runtime marker for an interface.
          hasOtherRuntime = true;
        case MClass(cl, _, fields):
          for (entry in plan.entriesFor(cl))
            if (isComponent(entry))
              components.push(entry.requestedName);
            else
              hasOtherRuntime = true;
          if (valuePlan.entriesFor(cl).length > 0)
            hasOtherRuntime = true;
          if (!DirectModuleBinding.canOmitSyntheticOwner(cl,
            Module.emittableFields(fields)))
            hasOtherRuntime = true;
        case MEnum(_, _) | MMain(_):
          hasOtherRuntime = true;
        case MType(_, _):
      }
    }
    if (components.length == 0 || !hasOtherRuntime)
      return null;
    for (expression in loadTimeExpressions)
      if (readsComponent(expression, module.module, componentKeys))
        return null;
    return components;
  }

  /**
   * True when an expression that runs while the module loads (a static
   * initializer or a class `__init__`) reads a component of the same module.
   *
   * Why: in a split module the component file sets the `Owner.field` slots
   * after the sibling has loaded. A read during the load of the sibling
   * would see the placeholder method. Genes then keeps the module as one
   * file. Calls inside function bodies run later and are safe.
   */
  static function readsComponent(expression: TypedExpr, module: String,
      componentKeys: Map<String, Bool>): Bool {
    var found = false;
    function visit(current: TypedExpr): Void {
      if (found || current == null)
        return;
      switch current.expr {
        case TField(_, FStatic(owner, field)):
          final ownerType = owner.get();
          if (ownerType.module == module
            && componentKeys.exists(ownerType.name + '.' + field.get().name)) {
            found = true;
            return;
          }
        default:
      }
      current.iter(visit);
    }
    visit(expression);
    return found;
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
#end
