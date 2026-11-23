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
   * The import aliases of each module that `importAlias` searched in this
   * request, by `DependencyPlan.moduleTypeKey`. Filled on demand.
   */
  @:persistent static var aliases: Map<String, Map<String,
    Ref<DefType>>> = new Map();

  /**
   * Starts an empty inventory for the current request and fills it after
   * typing. The callback only collects: the stamps of the incremental path
   * are added by `GenerationChangeSet.observe`, which `AfterTypingPasses.run`
   * calls, so this callback keeps its own place in Haxe's callback order and
   * an error of a pass cannot stop it.
   */
  public static function install(): Void {
    pending = [];
    modules = new Map();
    recording = false;
    asker = null;
    witnessed = new Map();
    fallbacks = new Map();
    aliases = new Map();
    Context.onAfterTyping(types -> pending.push(types));
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

  /**
   * Returns the declaration of `module` whose `DependencyPlan.moduleTypeKey`
   * is `key`, applied to its own type parameters, or `null` when the
   * inventory has no such declaration. It never looks a module up by name
   * and records no witness.
   *
   * Why: the walk with stored edges of Stage 3, slice S2 must add a
   * declaration that a stored step names, for example
   * `class:inc.Den.DenNote`, which dead-code elimination removed from the
   * generator's list. The live walk takes that declaration from a typed ref
   * of the visiting module, not by name, so this answer is no read by name
   * either: the caller first checks that the declaration's stamp equals the
   * recorded one (`GenerationChangeSet.stampOf`), so it is the object that
   * the typed ref holds. A `null` answer makes the caller leave the stored
   * walk; there is no `Context.getType` fallback.
   *
   * An import alias of `module` answers too (`importAlias`), although it is
   * in no declaration list. Example: `declarationByKey('inc.AliasModel',
   * 'typedef:inc.AliasModel.AliasedShape')` gives the private typedef that
   * Haxe made for `import inc.AliasShape as AliasedShape`.
   */
  public static function declarationByKey(module: String,
      key: String): Null<Type> {
    final indexed = known(module);
    if (indexed == null)
      return null;
    for (candidate in indexed) {
      final declaration: Null<ModuleType> = switch candidate {
        case TInst(ref, _): TClassDecl(ref);
        case TEnum(ref, _): TEnumDecl(ref);
        case TType(ref, _): TTypeDecl(ref);
        case TAbstract(ref, _): TAbstract(ref);
        default: null;
      }
      if (declaration != null
        && DependencyPlan.moduleTypeKey(declaration) == key)
        return candidate;
    }
    final alias = importAlias(module, key);
    return alias == null ? null : declaredType(TTypeDecl(alias));
  }

  /**
   * Returns the import alias of `module` whose `DependencyPlan.moduleTypeKey`
   * is `key`, or `null` when there is none. Like `declarationByKey` it never
   * looks a module up by name and records no witness.
   *
   * What an import alias is: for `import inc.AliasShape as AliasedShape` in
   * the module `inc.AliasModel`, Haxe 4.3.7 makes a private typedef
   * `AliasedShape` that belongs to `inc.AliasModel`
   * (`ImportHandling.init_import`, "create a temp private typedef, does not
   * register it in module"). Every type that the module writes as
   * `AliasedShape` refers to that typedef, and Genes prints it as
   * `export type AliasedShape = AliasShape`. Haxe does not put it in the
   * module's declaration list, so `onAfterTyping` never gives it, and the
   * other queries of this class cannot see it.
   *
   * Why: the walk with stored edges finds the declaration of a stored step
   * by its key (`IncrementalShadow.checkStoredTarget`,
   * `IncrementalShadow.resolveStoredStep`). Without this answer, every
   * program that reaches an alias left the recorded path on every request,
   * and generation reuse never replayed a module (genes-44h0: a Caffeine
   * session with 31 aliases).
   *
   * How: the first query for a module reads the declared types of each of
   * its declarations (fields, statics, constructor, super class and
   * interface arguments, enum constructors, typedef and abstract types), and
   * keeps each typedef that belongs to `module` but is not in its
   * declaration list. Lazy types are not forced. The fields are read as
   * dead-code elimination left them.
   *
   * An alias that only a body of its own module names is not this miss: in
   * the review of genes-ts #261 such a walk stayed on the recorded path.
   *
   * Limit (genes-cil5): an alias that reaches another module while no
   * declaration of its own module that survives dead-code elimination names
   * it is not found. Example: `inc.AliasInline` imports `inc.AliasShape as
   * InlinePt` and only its `static inline function make(): InlinePt` names
   * it; after `inc.AliasUser` inlines `make()`, dead-code elimination
   * removes `make` but keeps the class for another field, and the inferred
   * return type of a function of `inc.AliasUser` still names `InlinePt`.
   * The answer is then `null`, so the stored walk leaves the recorded path
   * in every request while that use stays (the tree still equals cold, but
   * no module is replayed).
   */
  public static function importAlias(module: String,
      key: String): Null<Ref<DefType>> {
    // The inventory guard first: a request without Genes must not read
    // aliases that an earlier request kept.
    final indexed = known(module);
    if (indexed == null)
      return null;
    var found = aliases.get(module);
    if (found == null) {
      found = findImportAliases(module, indexed);
      aliases.set(module, found);
    }
    return found.get(key);
  }

  /**
   * Finds the import aliases of one module, as `importAlias` describes.
   * `indexed` holds the module's declarations from the inventory.
   */
  static function findImportAliases(module: String,
      indexed: Array<Type>): Map<String, Ref<DefType>> {
    final found = new Map<String, Ref<DefType>>();
    final declared = new Map<String, Bool>();
    for (candidate in indexed) {
      final declaration = moduleTypeOf(candidate);
      if (declaration != null)
        declared.set(DependencyPlan.moduleTypeKey(declaration), true);
    }
    function visit(type: Null<Type>, depth: Int): Void {
      if (type == null || depth > ALIAS_SEARCH_DEPTH)
        return;
      switch type {
        case TType(ref, params):
          if (ref.get().module == module) {
            final key = DependencyPlan.moduleTypeKey(TTypeDecl(ref));
            if (!declared.exists(key) && !found.exists(key))
              found.set(key, ref);
          }
          for (param in params)
            visit(param, depth + 1);
        case TInst(_, params) | TEnum(_, params) | TAbstract(_, params):
          for (param in params)
            visit(param, depth + 1);
        case TFun(args, result):
          for (arg in args)
            visit(arg.t, depth + 1);
          visit(result, depth + 1);
        case TAnonymous(anonymous):
          final read = anonymous.get();
          switch read.status {
            case AClassStatics(_) | AEnumStatics(_) | AAbstractStatics(_):
              return;
            default:
          }
          for (field in read.fields)
            visit(field.type, depth + 1);
        case TMono(ref):
          visit(ref.get(), depth + 1);
        case TDynamic(inner):
          visit(inner, depth + 1);
        case TLazy(_):
      }
    }
    for (candidate in indexed)
      switch candidate {
        case TInst(ref, _):
          final cls = ref.get();
          final parent = cls.superClass;
          if (parent != null)
            for (param in parent.params)
              visit(param, 0);
          for (item in cls.interfaces)
            for (param in item.params)
              visit(param, 0);
          final constructor = cls.constructor;
          if (constructor != null)
            visit(constructor.get().type, 0);
          for (field in cls.fields.get())
            visit(field.type, 0);
          for (field in cls.statics.get())
            visit(field.type, 0);
        case TEnum(ref, _):
          for (construct in ref.get().constructs)
            visit(construct.type, 0);
        case TType(ref, _):
          visit(ref.get().type, 0);
        case TAbstract(ref, _):
          visit(ref.get().type, 0);
        default:
      }
    return found;
  }

  /** How deep `findImportAliases` reads into one declared type. */
  static inline final ALIAS_SEARCH_DEPTH = 32;

  /**
   * Returns the declaration that a declared type of the inventory stands
   * for (`TInst` gives `TClassDecl`, and so on), or `null` for any other
   * type. The inventory keeps `Type` values (`declaredType`); the keys of
   * `DependencyPlan.moduleTypeKey` are made from declarations.
   */
  static function moduleTypeOf(type: Type): Null<ModuleType> {
    return switch type {
      case TInst(ref, _): TClassDecl(ref);
      case TEnum(ref, _): TEnumDecl(ref);
      case TType(ref, _): TTypeDecl(ref);
      case TAbstract(ref, _): TAbstract(ref);
      default: null;
    }
  }

  /**
   * Returns, for each declaration of `module`, the text that `text` gives
   * for it, keyed by `DependencyPlan.moduleTypeKey`; `null` when the
   * inventory has no such module. Each declaration is read once. Like
   * `declarationByKey` it never looks a module up by name, records no
   * witness, and keeps the first declaration of a key.
   *
   * Why: the walk with stored edges of Stage 3, slice S2 checks the
   * target facts (`WalkTarget.inputsText`) of the declaration that each
   * stored step names (`IncrementalShadow.checkStoredTarget`). Example: an
   * after-typing macro adds `@:ts.type("string")` to `inc.LateEnum.LateBox`;
   * the plan of a module that names `LateBox` in a type position then has
   * no edge to it, although no stamp changed. Reading the whole module once is cheaper
   * than one `declarationByKey` search for each step, which reads every
   * declaration of the module again.
   */
  public static function textsByKey(module: String,
      text: ModuleType->String): Null<Map<String, String>> {
    final indexed = known(module);
    if (indexed == null)
      return null;
    final texts = new Map<String, String>();
    for (candidate in indexed) {
      final declaration: Null<ModuleType> = switch candidate {
        case TInst(ref, _): TClassDecl(ref);
        case TEnum(ref, _): TEnumDecl(ref);
        case TType(ref, _): TTypeDecl(ref);
        case TAbstract(ref, _): TAbstract(ref);
        default: null;
      }
      if (declaration == null)
        continue;
      final base = DependencyPlan.moduleTypeBase(declaration);
      final key = DependencyPlan.moduleTypeKeyOf(declaration, base);
      if (!texts.exists(key))
        texts.set(key, text(declaration));
    }
    return texts;
  }

  /**
   * Returns every module that Haxe typed in this request, each with its
   * declarations in Haxe's order, also the ones that dead-code elimination
   * removes later. Returns `null` when the request did not install Genes.
   *
   * Only the incremental shadow calls it: `ModuleFingerprint.unlisted`
   * gives each declaration that is in no generator list a fingerprint
   * (genes-f8vc.9.27). It adds no witness, because the shadow reads every
   * module and is not the output of one of them. Do not change the returned
   * map.
   */
  public static function allModules(): Null<Map<String, Array<Type>>> {
    return index();
  }

  static function known(module: String): Null<Array<Type>> {
    final all = index();
    return all == null ? null : all.get(module);
  }

  /** Groups the pending declarations by module, and returns all groups. */
  static function index(): Null<Map<String, Array<Type>>> {
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
      // New declarations can name an alias that an earlier search missed.
      aliases = new Map();
    }
    return modules;
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
