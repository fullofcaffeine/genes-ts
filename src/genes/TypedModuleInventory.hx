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
 * order, as `Context.getModule(module)`. `typeByPath(path)` finds the
 * declaration that a full dotted path names; it is close to
 * `Context.getType(path)` but not equal to it, see `typeByPath`. Both include
 * declarations that dead-code elimination later removes, such as the
 * implementation class of an abstract. The generator's own type list does
 * not include those, so it cannot replace this owner.
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
 * callback, and `Generator.use()` calls it once in a request, also when the
 * macro runs twice. A request that does not install Genes gets no answer
 * from the inventory and looks up by name. Nothing is used in a later
 * request.
 *
 * Witnesses (incremental shadow only): while `-D genes.dev_incremental`
 * records, each answered query adds a witness, the asking module and the
 * module that was read. A module whose output read another module by name
 * must not count as clean when that module changed, also when its source does
 * not name it (example: a provider type named by a string in metadata). A
 * query that the inventory cannot answer during generation is a fallback
 * lookup: it loads a module after typing and adds a dependency in Haxe. The
 * count goes to the report, and such a request does not use the generation
 * cache. Without the define nothing is recorded.
 *
 * See also: `docs/ARCHITECTURE.md`, "State-owner ledger".
 */
class TypedModuleInventory {
  /** Declarations that Haxe typed in this request, not grouped yet. */
  @:persistent static var pending: Array<Array<ModuleType>> = [];

  /** Declarations of each module, in Haxe's module order. */
  @:persistent static var modules: Map<String, Array<Type>> = new Map();

  /** True while the generator records witnesses for the incremental shadow. */
  @:persistent static var recording = false;

  /** The module whose plan or output is being built, or `null` between modules. */
  @:persistent static var asker: Null<String> = null;

  /** Read modules of each asking module; the empty key holds reads with no asker. */
  @:persistent static var witnessed: Map<String, Map<String, Bool>> = new Map();

  /** Modules that were looked up by name during generation. */
  @:persistent static var fallbacks: Map<String, Bool> = new Map();

  /**
   * Starts an empty inventory for the current request and fills it after
   * typing. The same callback gives each array to the incremental change set,
   * so that one owner sees every declaration once.
   */
  public static function install(): Void {
    pending = [];
    modules = new Map();
    recording = false;
    asker = null;
    witnessed = new Map();
    fallbacks = new Map();
    Context.onAfterTyping(types -> {
      pending.push(types);
      genes.incremental.GenerationChangeSet.observe(types);
    });
  }

  /**
   * Starts recording witnesses and fallback lookups for this request's
   * generation. Only the incremental shadow calls it.
   */
  public static function startRecording(): Void {
    recording = true;
    asker = null;
    witnessed = new Map();
    fallbacks = new Map();
  }

  /** Stops recording; later queries add nothing. */
  public static function stopRecording(): Void {
    recording = false;
    asker = null;
  }

  /** Names the module that the following queries work for, or `null` for none. */
  public static function setAsker(module: Null<String>): Void {
    asker = module;
  }

  /** Returns the sorted modules that `module` read by name; `""` gives reads without an asker. */
  public static function witnessesOf(module: String): Array<String> {
    final reads = witnessed.get(module);
    if (reads == null)
      return [];
    final names = [for (name in reads.keys()) name];
    names.sort((left, right) -> left < right ? -1 : left > right ? 1 : 0);
    return names;
  }

  /** Returns the sorted modules that were looked up by name during generation. */
  public static function fallbackLookups(): Array<String> {
    final names = [for (name in fallbacks.keys()) name];
    names.sort((left, right) -> left < right ? -1 : left > right ? 1 : 0);
    return names;
  }

  static function witness(read: String): Void {
    if (!recording)
      return;
    final key = asker == null ? '' : asker;
    final reads = witnessed.get(key);
    if (reads == null)
      witnessed.set(key, [read => true]);
    else
      reads.set(read, true);
  }

  static function fallback(module: String): Void {
    if (recording)
      fallbacks.set(module, true);
  }

  /**
   * Returns the declarations of one Haxe module, like `Context.getModule`.
   *
   * Use this instead of `Context.getModule` in code that can run during
   * generation. See the class comment for the reason.
   */
  public static function moduleTypes(module: String): Array<Type> {
    final indexed = known(module);
    if (indexed != null) {
      witness(module);
      return indexed;
    }
    fallback(module);
    return Context.getModule(module);
  }

  /**
   * Returns the declaration that a full dotted path names.
   *
   * Use this instead of `Context.getType` in code that can run during
   * generation, when the caller needs to know which declaration the path
   * names. The path follows Haxe's rule: `pack.Name` is the declaration
   * `Name` of module `pack.Name`, and `pack.Module.Name` is the declaration
   * `Name` of module `pack.Module`.
   *
   * The result is not always equal to `Context.getType(path)`:
   *
   * - A generic declaration keeps its own type parameters, not applied to
   *   anything. For `js.lib.Promise` the result is `Promise<T>`, where
   *   `Context.getType` returns `Promise<Unknown>`. A caller that reads the
   *   type arguments of the result must not use this function.
   * - A bare name is read as a top-level module and is not resolved through
   *   imports. `Math` names the top-level `Math`, where `Context.getType`
   *   in a JavaScript build resolves it to `js.lib.Math`. Pass a full path.
   *
   * Today's callers read only which declaration the result refers to, and
   * they pass full paths, so they get the same declaration as before.
   *
   * A path that the inventory cannot answer, for example a wrong path or a
   * type of a module that this request did not type, goes to
   * `Context.getType`, which also reports the error for a wrong path.
   */
  public static function typeByPath(path: String): Type {
    final parts = path.split('.');
    final name = parts[parts.length - 1];
    final owner = parts.length > 1 ? parts[parts.length - 2] : '';
    final first = owner.charAt(0);
    final inModule = first != '' && first == first.toUpperCase()
      && first != first.toLowerCase();
    final moduleName = inModule ? parts.slice(0, -1).join('.') : path;
    final indexed = known(moduleName);
    if (indexed != null) {
      witness(moduleName);
      for (candidate in indexed) {
        final base = baseOf(candidate);
        // A private declaration answers too. `Context.getType` returns one
        // for `pack.Module.Name` only when the current module owns it.
        // Otherwise it fails with "Cannot access private type Name in module
        // pack.Module". During generation the current module is the last
        // module that Haxe typed, so that answer depended on typing order.
        // The inventory answers in both cases.
        if (base != null && base.name == name)
          return candidate;
      }
    }
    fallback(moduleName);
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
