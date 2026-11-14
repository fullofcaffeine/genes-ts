package genes;

import haxe.macro.Context;
import haxe.macro.Type;

/**
 * Answers "which declarations does this Haxe module contain?" during
 * generation, without asking Haxe to look the module up by name.
 *
 * Why: a lookup by name is not free on a compilation server. When a macro
 * calls `Context.getModule` or `Context.getType`, Haxe 4.3.7 records that its
 * "current module" depends on the module that was looked up. During
 * generation the current module is only the last module that Haxe's filter
 * step visited; it has no relation to the lookup. Genes used to look up
 * almost every emitted module by name, so that one module came to depend on
 * almost every other. The dependency stays in the server's cache. The next
 * edit of any file then made Haxe type that module again, and every module
 * that depends on it. On one application with 1,100 modules, a one-string
 * edit of a file that nothing imports made Haxe type 566 modules again
 * instead of 1.
 *
 * What: `moduleTypes(module)` returns the same declarations, in the same
 * order, as `Context.getModule(module)`. `typeByPath(path)` returns the same
 * declaration as `Context.getType(path)`. Both include declarations that
 * dead-code elimination later removes, such as the implementation class of an
 * abstract. The generator's own type list does not include those, so it
 * cannot replace this owner.
 *
 * How: Haxe gives every typed declaration to `onAfterTyping` callbacks, before
 * dead-code elimination, and in module order. `install()` keeps those arrays
 * for the current request. The first query groups them by module. No name is
 * looked up, so Haxe records nothing.
 *
 * Limits: a module that is not in the inventory is still looked up by name,
 * so the answer stays correct. This happens in two cases. First, a macro that
 * runs while Haxe is still typing: the dependency is then a real one, from
 * the module that calls the macro. Second, a module that the program did not
 * load during typing. Example: a JSX build whose source never names the
 * intrinsic element provider; the JSX checker loads the provider during the
 * first generation. That lookup still records a dependency, on library
 * modules only.
 *
 * Proof: the retyped-module case of `yarn test:compiler-server` runs a
 * complete generation, edits a module that nothing imports, and requires
 * that Haxe types only that module again.
 *
 * Lifetime: the arrays hold compiler-owned declarations, so they belong to
 * one request only. `install()` replaces them before it registers the
 * callback. A request that does not install Genes gets no answer from the
 * inventory and looks up by name. Nothing is used in a later request.
 *
 * See also: `docs/ARCHITECTURE.md`, "State-owner ledger".
 */
class TypedModuleInventory {
  /** Declarations that Haxe typed in this request, not grouped yet. */
  @:persistent static var pending: Array<Array<ModuleType>> = [];

  /** Declarations of each module, in Haxe's module order. */
  @:persistent static var modules: Map<String, Array<Type>> = new Map();

  /** Starts an empty inventory for the current request and fills it after typing. */
  public static function install(): Void {
    pending = [];
    modules = new Map();
    Context.onAfterTyping(types -> pending.push(types));
  }

  /**
   * Returns the declarations of one Haxe module, like `Context.getModule`.
   *
   * Use this instead of `Context.getModule` in code that can run during
   * generation. See the class comment for the reason.
   */
  public static function moduleTypes(module: String): Array<Type> {
    final indexed = known(module);
    return indexed != null ? indexed : Context.getModule(module);
  }

  /**
   * Returns the declaration that a dotted path names, like `Context.getType`.
   *
   * The path follows Haxe's rule: `pack.Name` is the declaration `Name` of
   * module `pack.Name`, and `pack.Module.Name` is the declaration `Name` of
   * module `pack.Module`. A path that the inventory cannot answer, for example
   * a wrong path or a type that needs no import such as `String`, goes to
   * `Context.getType`, which also reports the error for a wrong path.
   */
  public static function typeByPath(path: String): Type {
    final parts = path.split('.');
    final name = parts[parts.length - 1];
    final owner = parts.length > 1 ? parts[parts.length - 2] : '';
    final first = owner.charAt(0);
    final inModule = first != '' && first == first.toUpperCase()
      && first != first.toLowerCase();
    final indexed = known(inModule ? parts.slice(0, -1).join('.') : path);
    if (indexed != null) {
      for (candidate in indexed) {
        final base = baseOf(candidate);
        if (base != null && base.name == name && !base.isPrivate)
          return candidate;
      }
    }
    return Context.getType(path);
  }

  static function known(module: String): Null<Array<Type>> {
    // A request that did not install Genes has no inventory of its own. The
    // arrays could then still hold declarations of an earlier request on the
    // same compilation server, so they must not answer.
    if (!Context.defined(CompilerInternal.GENERATOR_ACTIVE_DEFINE))
      return null;
    if (pending.length > 0) {
      for (types in pending) {
        for (type in types) {
          final declared = declaredType(type);
          final base = baseOf(declared);
          if (base == null)
            continue;
          final found = modules.get(base.module);
          if (found == null)
            modules.set(base.module, [declared]);
          else
            found.push(declared);
        }
      }
      pending = [];
    }
    return modules.get(module);
  }

  /**
   * Builds the `Type` that `Context.getModule` returns for a declaration: the
   * declaration applied to its own type parameters.
   */
  static function declaredType(type: ModuleType): Type {
    return switch type {
      case TClassDecl(ref): TInst(ref,
          [for (param in ref.get().params) param.t]);
      case TEnumDecl(ref): TEnum(ref,
          [for (param in ref.get().params) param.t]);
      case TTypeDecl(ref): TType(ref,
          [for (param in ref.get().params) param.t]);
      case TAbstract(ref): TAbstract(ref,
          [for (param in ref.get().params) param.t]);
    }
  }

  static function baseOf(type: Type): Null<BaseType> {
    return switch type {
      case TInst(ref, _): ref.get();
      case TEnum(ref, _): ref.get();
      case TType(ref, _): ref.get();
      case TAbstract(ref, _): ref.get();
      default: null;
    }
  }
}
