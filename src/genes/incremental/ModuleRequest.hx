package genes.incremental;

#if macro
import haxe.Json;
import haxe.io.Path;
import haxe.macro.Context;
import haxe.macro.Type;
import haxe.macro.TypeTools;
import haxe.macro.TypedExprTools;
import sys.FileSystem;
import sys.io.File;
import genes.AfterTypingPasses.AfterTypingClass;
import genes.incremental.IncrementalRequest;
import genes.util.PathUtil;
import genes.util.TypeUtil;

using Lambda;

/**
 * The facts of one module that a module request compares with the last full
 * request. A full request with `"moduleRecords": true` keeps one record for
 * each module that it emitted. Plain text only: no `Type`, `Ref` or
 * `TypedExpr`.
 */
typedef ModuleRecord = {
  /** `GenerationCache` epochs of the module when the record was made. */
  final epochs: String;

  /**
   * The declarations and fields of the module that survived dead-code
   * elimination, one sorted line each (`kept`). Example:
   * `class app.Button i:render`.
   */
  final kept: Array<String>;

  /**
   * What the kept fields of the module use from other modules, sorted:
   * `field <type> <s|i>:<name>`, `type <type>` and `anon <name>` lines, and
   * `define <feature>` for each `__define_feature__` call in its kept
   * bodies (for example in the inlined getter of `js.Lib.global`).
   */
  final foreignRefs: Array<String>;

  /**
   * The declarations of other modules that the signatures of its kept
   * fields name (`type <type>` lines, sorted). Dead-code elimination keeps
   * them for this module; `addRoots` reads them as uses.
   */
  final mentions: Array<String>;

  /**
   * The public shape of the module before dead-code elimination
   * (`shapeOf`), or `null` when Haxe did not type the module in a request
   * that made records.
   */
  final shape: Null<String>;
}

/** The live facts of the requested module that the generator gives to `decide`. */
typedef ModuleRequestFacts = {
  /** The module that the request previews. */
  final module: String;

  /** The output root module (the output file name without extension). */
  final rootModule: String;

  /** The module's declarations after dead-code elimination. */
  final types: Array<Type>;

  /** Every declaration of the request after dead-code elimination (`api.types`). */
  final allTypes: Array<Type>;

  /** `referencesOf` the module, read once by the generator. */
  final references: ModuleReferences;

  /** `ModuleFingerprint.members` of the module's final member list. */
  final members: String;

  /** `IncrementalShadow.rootFlags` of the module. */
  final rootFlags: String;

  /** True when the module gets an implementation file. */
  final emits: Bool;

  /** True when an `@:expose` names the module or it has public root entries. */
  final exposed: Bool;

  /** The absolute, normalized output folder of this request. */
  final outputFolder: String;

  /** True when the request has a `--main` expression. */
  final hasMain: Bool;
}

/** What `ModuleRequest.referencesOf` reads from the kept bodies of one module. */
typedef ModuleReferences = {
  /** See `ModuleRecord.foreignRefs`. */
  final foreign: Array<String>;

  /** See `ModuleRecord.mentions`. */
  final mentions: Array<String>;

  /** The other modules that `foreign` names. */
  final modules: Array<String>;
}

/** The report of one module request, written beside the request descriptor. */
typedef ModuleRequestReport = {
  final format: Int;

  /** Always `module`. */
  final kind: String;

  final module: String;

  /** `preview` (the module's files were published), `refused` or `off`. */
  final result: String;

  /** A stable code for a refused request, for example `answers-changed`. */
  final refusal: Null<String>;

  final reason: Null<String>;
  final typedAgainModules: Array<String>;

  /** The published paths, relative to the output folder; empty unless `preview`. */
  final files: Array<String>;

  /** Kept declarations and fields of the module. */
  final kept: Int;

  /** Wall time of the generator for this request. */
  final generationMs: Float;

  /** Time of the checks (`decide`), part of `generationMs`. */
  final checkMs: Float;

  /** Time of the shape and root step before dead-code elimination. */
  final rootMs: Float;
}

/** The report of the record step of one full request with `"moduleRecords": true`. */
typedef ModuleRecordsReport = {
  final format: Int;
  final stored: Bool;
  final reason: Null<String>;
  final modules: Int;

  /** Modules whose references were read again from their bodies. */
  final walked: Int;

  /** Modules whose shape this request computed (Haxe typed them). */
  final shapes: Int;

  final shapeMs: Float;
  final recordMs: Float;
}

/**
 * Serves module requests (G3): Haxe types the program rooted at one edited
 * module, and Genes prints only that module, so that a development session
 * can show an edit before the full request of the program has finished.
 *
 * Why: on a warm server, Haxe types one edited module in about 0.3 s, but a
 * full request plans and prints every reachable module. A request that
 * prints only the edited module can show the edit in well under a second.
 * Such a preview is useful only when its files are the files that the full
 * request will publish for the module. This class owns the checks that
 * decide that, and it publishes nothing when one check fails.
 *
 * What a session does:
 *
 * 1. A full request with `"generation": "reuse"`, `"afterTyping": "reuse"`
 *    and `"moduleRecords": true` publishes the program and keeps one
 *    `ModuleRecord` for each emitted module (`programCommitted`).
 * 2. After an edit of `app.ui.Button`, the session sends a module request
 *    to the same server: the same arguments without `--main` and the other
 *    roots, the module path `app.ui.Button` as the only root, an output
 *    folder of its own, and a descriptor with `"kind": "module"`,
 *    `"module": "app.ui.Button"` and the `programDigest` of the full
 *    request. The output folder must be a sibling of the program's output
 *    folder (same depth from the project root), so that the session key and
 *    the source-map paths are the program's.
 * 3. Genes roots dead-code elimination at the uses of the module that the
 *    full request saw in other modules (`afterSave`), prints the module into
 *    the request's output folder, and runs `decide`. When every check holds,
 *    it publishes the module's files (`result: "preview"`); otherwise it
 *    publishes nothing (`result: "refused"` with a code and a reason).
 * 4. The session runs the full request afterwards; it remains the authority
 *    for the published tree.
 *
 * The descriptor is one file for the whole session (its path is a define,
 * and a new define value starts a new Haxe cache). A server runs one request
 * at a time and queues the others, and each request reads the descriptor
 * when it starts typing. So the session writes the descriptor of a request
 * only when no other request is in flight. A request with `--main` that
 * reads a module descriptor is refused (`has-main`).
 *
 * The checks (`decide`), all must hold:
 *
 * - the request is eligible, with `generation` and `afterTyping` `"reuse"`;
 * - the records were made under this session key and output folder depth,
 *   and the record of the module belongs to the stored generation;
 * - the module is not the output root, is not exposed, has no public root
 *   entries, and gets an implementation file;
 * - Haxe typed no module other than the requested one, and every other
 *   module of the request has the epochs of the stored full request (so a
 *   module that an earlier module request typed again is a refusal too);
 * - the visible public shape before dead-code elimination (public fields
 *   with their kinds, types and metadata, private fields that another
 *   module uses or can reach through a subclass, and the bodies and
 *   positions of inline fields) is the stored one, and the module defines
 *   no macro and no `@:generic` declaration: modules that import it then
 *   need no new typing;
 * - no source file of the stored program other than the module's own
 *   changed since the full request (time and size), so an edit outside the
 *   module's imports is a refusal too (`source-changed`);
 * - the kept declarations and fields, the final member list and the root
 *   flags are the stored ones, and the uses of other modules are the stored
 *   ones (so the files of other modules that are already published still
 *   fit this module);
 * - every question that planning and printing of the module asked
 *   (features, module map, import cycles, signature facts) got the answer
 *   of a full build (`featureAnswer`, `wrongAnswer`), and no question names
 *   a feature that emission of another module can add;
 * - Haxe's own printer was not used, nothing was looked up by name outside
 *   the inventory, the output folder is not the program's, and no source of
 *   its maps is inside a folder where the program and preview output paths
 *   part.
 *
 * Why the kept fields are the full build's (dead-code elimination): the
 * request roots only declarations and fields with a reason that holds in the
 * full build after the edit: a use that the stored full request saw in a
 * module outside this request's program (so its liveness cannot depend on
 * the edited module) whose classes do not extend a class of the module. A
 * field that overrides such a used parent field gets `@:maybeUsed`, so it
 * stays only when its class stays, as Haxe decides. Everything else is
 * left to Haxe's own dead-code elimination over the new code, whatever it
 * follows (fields, types of parameters, `toString` through `Std.string`).
 * Call the result K. Each root is a root of the full build, and the request
 * holds a part of the full program, so the full build keeps all of K. The
 * full build reaches the module first through a chain that does not pass
 * the module, which existed in the stored build, so it reaches a stored
 * kept line first; when K holds every stored kept line, Haxe's closure from
 * those lines lies in K, so the full build keeps nothing outside K. The
 * check "kept lines equal" therefore proves that K is the full build's set.
 * Example: an edit removes the only call of a private helper. No reason
 * roots the helper, Haxe drops it, and its stored kept line is missing:
 * `kept-changed`.
 *
 * Limits: a use through reflection, a dynamic or anonymous-structure field
 * name, or an `@:ifFeature` field of a module outside the request can keep a
 * field of the module in a full build that this request does not see; such
 * a field is then missing here and the request is refused, or (for a field
 * that the edit makes newly reachable that way) the preview can differ. A
 * class kept only because another module names it as a type, or an override
 * reached only through a parent type (s04b, s06), has no reason here, so
 * such modules are refused. Import-cycle answers are computed from the
 * modules of this request only, so an edit inside an import cycle is
 * usually refused.
 *
 * Effects on the compiler server: the roots are `@:keep` and `@:maybeUsed`
 * entries with the argument `"genes.moduleRequest"`, which Genes adds after
 * Haxe saved the class state and removes before printing, so they never
 * reach Haxe's cache (unlike `--macro keep(...)`). A request that fails
 * before the generator runs leaves them; the next request removes them
 * before dead-code elimination (`leftoverRoots`). When Haxe typed the
 * module in this request, Genes marks it for a new typing
 * (`retypeLater`), so that the next full request types
 * it again with the whole program: a type that another module's use decides,
 * such as `static final items = []`, would otherwise stay as typed alone. A
 * module request stores nothing in the generation cache and keeps no records
 * of its own.
 *
 * Without `-D genes.dev_incremental` nothing here runs.
 */
class ModuleRequest {
  /** The format of `ModuleRequestReport` and `ModuleRecordsReport`. */
  static inline final REPORT_FORMAT = 1;

  /**
   * Words that `shapeOf` writes for a macro field and a `@:generic`
   * declaration or field. `#` cannot start a Haxe name or a printed type.
   */
  static inline final MACRO_MARK = ' #macro';

  static inline final GENERIC_MARK = ' #generic';

  /**
   * Metadata that `shapeOf` leaves out, with the reason, in addition to
   * `ModuleFingerprint.EXCLUDED_META`. Only the module's own print reads
   * these entries, and their arguments hold source positions of the module,
   * which an edit above them moves.
   */
  static final SHAPE_EXCLUDED_META: Map<String, String> = [
    ':genes.asyncContext' =>
    'a source position key that only the async plan ' +
    'of the module itself reads (`genes.js.Async`, `Module.nativeAsyncPlanForEmission`)'
  ];

  /** The start of the shape line of a private field (see `addShapeField`). */
  static inline final PRIVATE_MARK = 'private ';

  /** The after-typing passes that a module request skips for kept classes. */
  static final SKIPPED_PASSES = ['publicSurface', 'reactAudit'];

  @:persistent static var storedKey: Null<String> = null;
  @:persistent static var storedOutputFolder = '';
  @:persistent static var records: Map<String, ModuleRecord> = new Map();

  /**
   * The private fields that other modules can see in the stored full
   * request: `<type> <s|i>:<name>` (or `<type> new`) of each field that a
   * module uses from another module, and `<type> *` for each class that a
   * class of another module extends (directly or through a parent).
   */
  @:persistent static var externalUses: Map<String, Bool> = new Map();

  /**
   * For each use line (`field <type> <s|i>:<name>` or `type <type>`) that a
   * module of the stored full request makes of another module, the modules
   * that make it.
   */
  @:persistent static var usersByRef: Map<String, Array<String>> = new Map();

  /** For each module of the stored program, the modules of the parents and interfaces of its classes. */
  @:persistent static var ancestorModules: Map<String, Map<String,
    Bool>> = new Map();

  /** The time and size (`stampOf`) of each source file of the stored program. */
  @:persistent static var storedFiles: Map<String, String> = new Map();

  /**
   * Modules whose roots a request added and did not remove (it failed
   * before the generator ran). The next request removes them.
   */
  @:persistent static var leftoverRoots: Array<String> = [];

  /** `GenerationChangeSet.epochs` of every module that the stored full request saw. */
  @:persistent static var storedEpochs: Map<String, String> = new Map();

  /**
   * The last computed shape of each module, with the epochs that it was
   * computed for, so that a full request computes the shape of a module
   * again only after Haxe typed it again. Dropped with the records.
   */
  @:persistent static var shapeCache: Map<String,
    {epochs: String, shape: String}> = new Map();

  static var shapes: Map<String, String> = new Map();
  static var shapesComputed = 0;
  static var shapeSeconds = 0.0;
  static var rootSeconds = 0.0;
  static var requestShape: Null<String> = null;
  static var addedRoots: Array<MetaAccess> = [];
  static var moduleFiles: Map<String, String> = new Map();
  static var loadedModules: Map<String, Bool> = new Map();
  static var surfaceOwners: Null<Map<String, Bool>> = null;

  /**
   * Registers the step after Haxe saved the class state and before dead-code
   * elimination. `Generator.use()` calls it once per request; without the
   * define it registers nothing.
   */
  public static function install(): Void {
    shapes = new Map();
    shapesComputed = 0;
    shapeSeconds = 0.0;
    rootSeconds = 0.0;
    requestShape = null;
    addedRoots = [];
    moduleFiles = new Map();
    loadedModules = new Map();
    surfaceOwners = null;
    if (!Context.defined(IncrementalRequest.DEFINE))
      return;
    // `false`: after Haxe saved the class state, so that the roots that
    // `afterSave` adds never reach the server's cache.
    Context.onGenerate(afterSave, false);
  }

  /**
   * Returns the module that the descriptor of this request names in a
   * module request, also when the request left the incremental path, or
   * `null` for any other request. The generator takes the module path for
   * such a request, so that it never publishes a partial program tree.
   */
  public static function requestedTarget(): Null<String> {
    final descriptor = IncrementalRequest.requestedDescriptor();
    return descriptor == null ? null : switch descriptor.kind {
      case Module(module): module;
      case Full: null;
    }
  }

  /** Returns the module that this request previews, or `null` for any other request. */
  public static function target(): Null<String> {
    final descriptor = IncrementalRequest.descriptor();
    return descriptor == null ? null : switch descriptor.kind {
      case Module(module): module;
      case Full: null;
    }
  }

  /**
   * Returns true when this request is a module request. The generator then
   * adds no `@:genes.generate` stamp: the TypeScript profile, the only
   * profile of the incremental path, does not read it.
   */
  public static function skipsGenerationStamps(): Bool {
    return target() != null;
  }

  /**
   * Returns true when the after-typing walk of a module request can skip
   * the pass `pass` for `current`: a class that Haxe kept, outside the
   * requested module and outside the parent classes and interfaces of its
   * classes. `PublicSurface` (`publicSurface`) and the React audit
   * (`reactAudit`) are skipped; `SignatureCache` always runs, because a
   * module's print reads signature facts of other classes.
   *
   * Why it is safe: a skipped class's surface is captured on first use
   * (`PublicSurface.forClass`), and the printer of the requested module
   * reads only the surfaces of its own classes and of their parents and
   * interfaces, which the walk still captures. The audit passed for a kept
   * class in an earlier request.
   */
  public static function skipsClassPass(pass: String,
      current: AfterTypingClass, types: Array<ModuleType>): Bool {
    final module = target();
    if (module == null || SKIPPED_PASSES.indexOf(pass) < 0)
      return false;
    final stamp = current.stamp;
    if (stamp == null || stamp.arrival != Kept || current.type.module == module)
      return false;
    return !surfaceOwnersOf(module, types).exists(current.ownerKey);
  }

  /**
   * Returns true when the walk of a module request can skip reading the
   * member list of `current` for the after-typing report: a kept class
   * outside the requested module. No pass reads that copy.
   */
  public static function skipsMemberRead(current: AfterTypingClass): Bool {
    final module = target();
    final stamp = current.stamp;
    return module != null
      && stamp != null
      && stamp.arrival == Kept
      && current.type.module != module;
  }

  /**
   * Returns the owner keys (`AfterTypingClass.ownerKey`) of the classes of
   * `module` and of all their parent classes and interfaces.
   */
  static function surfaceOwnersOf(module: String,
      types: Array<ModuleType>): Map<String, Bool> {
    final known = surfaceOwners;
    if (known != null)
      return known;
    final owners = new Map<String, Bool>();
    function add(type: ClassType): Void {
      final key = ownerKeyOf(type);
      if (owners.exists(key))
        return;
      owners.set(key, true);
      final parent = type.superClass;
      if (parent != null)
        add(parent.t.get());
      for (item in type.interfaces)
        add(item.t.get());
    }
    for (type in types)
      switch type {
        case TClassDecl(reference):
          final cls = reference.get();
          if (cls.module == module)
            add(cls);
        default:
      }
    surfaceOwners = owners;
    return owners;
  }

  /** The key of `AfterTypingClass.ownerKey` for one class. */
  static function ownerKeyOf(type: ClassType): String {
    final declaredPath = type.pack.concat([type.name]).join('.');
    return declaredPath == type.module ? declaredPath : type.module
      + '.'
      + type.name;
  }

  /**
   * Runs after Haxe saved the class state and before dead-code elimination.
   *
   * Every request with the define first removes roots that an earlier
   * request left (`leftoverRoots`) and notes the source file of each module.
   * In a module request it then computes the requested module's public
   * shape, marks it for a new typing in the next full request when Haxe typed
   * it in this request (`retypeLater`), and adds
   * the roots of `addRoots` (the request has no `--main`). In a full request
   * with `"moduleRecords": true` it computes the public shape of each module
   * that Haxe typed again.
   */
  static function afterSave(types: Array<Type>): Void {
    removeLeftoverRoots(types);
    final descriptor = IncrementalRequest.descriptor();
    if (descriptor == null)
      return;
    final started = haxe.Timer.stamp();
    final grouped = new Map<String, Array<Type>>();
    for (type in types) {
      final module = moduleOf(type);
      if (module == null)
        continue;
      final list = grouped.get(module);
      if (list == null) {
        grouped.set(module, [type]);
        loadedModules.set(module, true);
        final pos = positionOf(type);
        if (pos != null)
          moduleFiles.set(module, Context.getPosInfos(pos).file);
      } else {
        list.push(type);
      }
    }
    switch descriptor.kind {
      case Module(module):
        final own = typesOf(types, module);
        requestShape = shapeOf(own);
        shapeSeconds += haxe.Timer.stamp() - started;
        final rootStart = haxe.Timer.stamp();
        // Typed without the rest of the program, a type that another
        // module's use decides (a monomorph, for example
        // `static final items = []`) closes differently. The next full
        // request must type every module that this request typed again.
        retypeLater(GenerationChangeSet.retypedModules(), descriptor.path);
        if (storedKey != null)
          addRoots(module, own);
        rootSeconds += haxe.Timer.stamp() - rootStart;
      case Full:
        if (descriptor.moduleRecords != true)
          return;
        // A module needs a new shape when its epochs differ from the ones
        // of its cached shape: Haxe typed it again, or the session key
        // changed (the cache is then empty). Modules of extern classes only
        // never get an output file and are left out.
        if (storedKey == null || storedKey != GenerationChangeSet.sessionKey())
          shapeCache = new Map();
        for (module => list in grouped) {
          final epochs = GenerationChangeSet.epochs(module);
          final cached = shapeCache.get(module);
          if (cached != null && epochs.length > 0 && cached.epochs == epochs) {
            shapes.set(module, cached.shape);
            continue;
          }
          if (list.foreach(isExternClass))
            continue;
          final shape = shapeOf(list);
          shapesComputed++;
          shapes.set(module, shape);
          if (epochs.length > 0)
            shapeCache.set(module, {epochs: epochs, shape: shape});
        }
        shapeSeconds += haxe.Timer.stamp() - started;
    }
  }

  /**
   * Makes the next request type each of `modules` again: each gets a
   * dependency on the file `<descriptor>.module-dep`, which does not exist
   * when Haxe notes its time and exists afterwards. The server then finds
   * the dependency changed and types the modules again, with the whole
   * program in a full request. The dependency lives only on these typed
   * module objects; the next typing drops it.
   *
   * Why not `CompilationServer.invalidateFiles`: during a request it marks
   * only the cached copy from before; the module typed in this request
   * enters the cache when the request ends.
   */
  static function retypeLater(modules: Array<String>,
      descriptorPath: String): Void {
    if (modules.length == 0)
      return;
    final dependency = descriptorPath + '.module-dep';
    try {
      if (FileSystem.exists(dependency))
        FileSystem.deleteFile(dependency);
      for (module in modules)
        Context.registerModuleDependency(module, dependency);
      File.saveContent(dependency, 'genes module request\n');
    } catch (error:haxe.Exception) {
      Context.warning('[GENES-MODULE-REQUEST-002] Genes cannot mark '
        + '${modules.join(', ')} for a new typing in the next full request '
        + '(${error.message}); restart the compilation server before the next '
        + 'full request.',
        Context.currentPos());
    }
  }

  /** The argument of the roots that Genes adds, so that it removes only its own. */
  static inline final ROOT_MARK = 'genes.moduleRequest';

  /**
   * Adds the roots of dead-code elimination for `module` (`types` are its
   * declarations before dead-code elimination), and remembers each metadata
   * so that `removeRoots` can take the entry away again.
   *
   * A root needs a reason that holds in the full build after the edit: a use
   * of the declaration or field that the stored full request saw in a module
   * that is not in this request's program and that extends no class of the
   * module (see the class comment). Such a use gets `@:keep`. An instance
   * field whose parent class or interface field has such a use gets
   * `@:maybeUsed` instead: Haxe then keeps it only when its class stays.
   * An enum with such a use gets `@:keep` (Haxe keeps or drops an enum as a
   * whole). Nothing else is rooted; Haxe's own entry points (`@:keep` in the
   * source, `__init__`) still apply.
   */
  static function addRoots(module: String, types: Array<Type>): Void {
    function used(line: String): Bool {
      final users = usersByRef.get(line);
      if (users == null)
        return false;
      for (user in users) {
        if (user == module || loadedModules.exists(user))
          continue;
        final ancestors = ancestorModules.get(user);
        if (ancestors != null && ancestors.exists(module))
          continue;
        return true;
      }
      return false;
    }
    final pos = Context.currentPos();
    final roots = [];
    function root(meta: MetaAccess, name: String): Void {
      if (meta.has(name))
        return;
      roots.push({meta: meta, name: name});
    }
    for (type in types)
      switch type {
        case TInst(reference, _):
          final cls = reference.get();
          final name = TypeUtil.baseTypeFullName(cls);
          final ancestors = [];
          function addAncestor(other: ClassType): Void {
            final key = TypeUtil.baseTypeFullName(other);
            if (ancestors.indexOf(key) >= 0)
              return;
            ancestors.push(key);
            final parent = other.superClass;
            if (parent != null)
              addAncestor(parent.t.get());
            for (item in other.interfaces)
              addAncestor(item.t.get());
          }
          final parent = cls.superClass;
          if (parent != null)
            addAncestor(parent.t.get());
          for (item in cls.interfaces)
            addAncestor(item.t.get());
          for (field in cls.statics.get())
            if (used('field $name s:${field.name}'))
              root(field.meta, ':keep');
          for (field in cls.fields.get()) {
            if (used('field $name i:${field.name}'))
              root(field.meta, ':keep');
            else if (ancestors.exists(other ->
              used('field $other i:${field.name}')))
              root(field.meta, ':maybeUsed');
          }
          final constructor = cls.constructor;
          if (constructor != null && used('field $name i:new'))
            root(constructor.get().meta, ':keep');
        case TEnum(reference, _):
          final enm = reference.get();
          if (used('type ${TypeUtil.baseTypeFullName(enm)}'))
            root(enm.meta, ':keep');
        default:
      }
    if (roots.length == 0)
      return;
    // Noted before the first entry is added: a request that fails before
    // `removeRoots` leaves them to the next request.
    leftoverRoots = leftoverRoots.concat([module]);
    for (item in roots) {
      item.meta.add(item.name, [macro $v{ROOT_MARK}], pos);
      addedRoots.push(item.meta);
    }
  }

  /**
   * Removes the roots that `afterSave` added. The generator calls it before
   * it reads any declaration, so that no printer sees them.
   */
  public static function removeRoots(): Void {
    for (meta in addedRoots)
      removeMarked(meta);
    addedRoots = [];
    leftoverRoots = [];
  }

  /** Removes the `@:keep` and `@:maybeUsed` entries with `ROOT_MARK` from `meta`, and keeps the others. */
  static function removeMarked(meta: MetaAccess): Void {
    for (name in [':keep', ':maybeUsed']) {
      final entries = meta.extract(name);
      final own = entries.filter(entry -> switch entry.params {
        case [{expr: EConst(CString(value, _))}] if (value == ROOT_MARK): true;
        default: false;
      });
      if (own.length == 0)
        continue;
      meta.remove(name);
      for (entry in entries)
        if (own.indexOf(entry) < 0)
          meta.add(entry.name, entry.params, entry.pos);
    }
  }

  /**
   * Removes roots that an earlier request added and did not remove, from the
   * declarations of the modules in `leftoverRoots` that this request holds.
   * A module that this request does not hold stays on the list.
   */
  static function removeLeftoverRoots(types: Array<Type>): Void {
    if (leftoverRoots.length == 0)
      return;
    final pending = leftoverRoots.copy();
    final cleaned = new Map<String, Bool>();
    for (type in types) {
      final module = moduleOf(type);
      if (module == null || pending.indexOf(module) < 0)
        continue;
      cleaned.set(module, true);
      switch type {
        case TInst(reference, _):
          final cls = reference.get();
          for (field in cls.statics.get())
            removeMarked(field.meta);
          for (field in cls.fields.get())
            removeMarked(field.meta);
          final constructor = cls.constructor;
          if (constructor != null)
            removeMarked(constructor.get().meta);
        case TEnum(reference, _):
          removeMarked(reference.get().meta);
        default:
      }
    }
    leftoverRoots = [for (module in pending) if (!cleaned.exists(module)) module];
  }

  /**
   * Makes the records of a full request with `"moduleRecords": true` after
   * its successful commit. `types` is the generator's declaration list
   * (after dead-code elimination).
   *
   * A record is made for each module of the generation cache whose stored
   * epochs are this request's epochs, that is each module that this request
   * stored. The references of a module are read from its bodies only when
   * its epochs or its kept lines differ from its earlier record; otherwise
   * they are taken from that record. The shape comes from `afterSave` when
   * Haxe typed the module in this request, else from the earlier record with
   * the same epochs, else it is unknown and a module request for that module
   * is refused.
   */
  public static function programCommitted(types: Array<Type>,
      main: Null<TypedExpr>, outputFile: String): Void {
    final descriptor = IncrementalRequest.descriptor();
    if (descriptor == null || descriptor.moduleRecords != true)
      return;
    switch descriptor.kind {
      case Module(_):
        return;
      case Full:
    }
    final started = haxe.Timer.stamp();
    final key = GenerationChangeSet.sessionKey();
    final reason = if (descriptor.generation != ReuseClean
      || descriptor.afterTyping != Reuse)
      'module records need "generation": "reuse" and "afterTyping": "reuse"' else
      if (key == null) 'no declaration was stamped after typing' else null;
    if (reason != null) {
      drop();
      writeRecordsReport(descriptor, false, reason, 0, 0, started);
      return;
    }
    final grouped = new Map<String, Array<Type>>();
    for (type in types) {
      final module = moduleOf(type);
      if (module == null)
        continue;
      final list = grouped.get(module);
      if (list == null)
        grouped.set(module, [type]);
      else
        list.push(type);
    }
    final made = new Map<String, ModuleRecord>();
    var walked = 0;
    for (module in GenerationCache.storedModules()) {
      final entry = GenerationCache.entry(module);
      final epochs = GenerationChangeSet.epochs(module);
      if (entry == null || entry.epochs != epochs || epochs.length == 0)
        continue;
      final list = grouped.get(module);
      final own = list == null ? [] : list;
      final kept = keptLines(own);
      final earlier = storedKey == key ? records.get(module) : null;
      final sameEarlier = earlier != null && earlier.epochs == epochs;
      final references: ModuleReferences = if (sameEarlier
        && earlier.kept.join('\n') == kept.join('\n')) {
          foreign: earlier.foreignRefs,
          mentions: earlier.mentions,
          modules: []
        } else {
          walked++;
          referencesOf(module, own);
      }
      made.set(module, {
        epochs: epochs,
        kept: kept,
        foreignRefs: references.foreign,
        mentions: references.mentions,
        shape: shapes.get(module)
      });
    }
    final seen = new Map<String, String>();
    for (module in GenerationChangeSet.observedModules())
      seen.set(module, GenerationChangeSet.epochs(module));
    storedEpochs = seen;
    final uses = new Map<String, Bool>();
    for (record in made)
      for (line in record.foreignRefs)
        if (StringTools.startsWith(line, 'field '))
          uses.set(line.substr('field '.length), true);
    for (type in types)
      switch type {
        case TInst(reference, _):
          final cls = reference.get();
          var parent = cls.superClass;
          while (parent != null) {
            final base = parent.t.get();
            if (base.module != cls.module)
              uses.set('${TypeUtil.baseTypeFullName(base)} *', true);
            parent = base.superClass;
          }
        default:
      }
    externalUses = uses;
    final users = new Map<String, Array<String>>();
    for (module => record in made)
      for (line in record.foreignRefs.concat(record.mentions)) {
        if (!StringTools.startsWith(line, 'field ')
          && !StringTools.startsWith(line, 'type '))
          continue;
        final list = users.get(line);
        if (list == null)
          users.set(line, [module]);
        else if (list.indexOf(module) < 0)
          list.push(module);
      }
    // The `--main` call is a root of the full program that a module request
    // does not have; it counts as a use by no module (the empty name).
    if (main != null) {
      function visitMain(expression: TypedExpr): Void {
        switch expression.expr {
          case TField(_, FStatic(owner, field)):
            final line = 'field ${TypeUtil.baseTypeFullName(owner.get())} s:${field.get().name}';
            final list = users.get(line);
            if (list == null)
              users.set(line, ['']);
            else if (list.indexOf('') < 0)
              list.push('');
          default:
        }
        TypedExprTools.iter(expression, visitMain);
      }
      visitMain(main);
    }
    usersByRef = users;
    final ancestors = new Map<String, Map<String, Bool>>();
    for (type in types)
      switch type {
        case TInst(reference, _):
          final cls = reference.get();
          var set = ancestors.get(cls.module);
          if (set == null) {
            set = new Map();
            ancestors.set(cls.module, set);
          }
          final seen = new Map<String, Bool>();
          final pending = [cls];
          while (pending.length > 0) {
            final current = pending.pop();
            final parent = current.superClass;
            final others = [for (item in current.interfaces) item.t.get()];
            if (parent != null)
              others.push(parent.t.get());
            for (other in others) {
              final name = TypeUtil.baseTypeFullName(other);
              if (seen.exists(name))
                continue;
              seen.set(name, true);
              if (other.module != cls.module)
                set.set(other.module, true);
              pending.push(other);
            }
          }
        default:
      }
    ancestorModules = ancestors;
    final files = new Map<String, String>();
    for (module => file in moduleFiles)
      if (!files.exists(file))
        files.set(file, stampOf(file));
    storedFiles = files;
    storedKey = key;
    storedOutputFolder = absoluteFolder(outputFile);
    records = made;
    writeRecordsReport(descriptor, true, null, walked, shapesComputed, started);
  }

  /**
   * Returns why a full request must not run, or `null`: a full request with
   * `"moduleRecords": true` and no `--main` is almost always a module
   * request that read a full descriptor (the session wrote the one file too
   * early). It would publish the module's program as the whole tree and
   * store records of that part. The generator then stops before it writes
   * anything.
   */
  public static function fullRequestRefusal(hasMain: Bool): Null<String> {
    final descriptor = IncrementalRequest.descriptor();
    if (descriptor == null || descriptor.moduleRecords != true || hasMain)
      return null;
    return switch descriptor.kind {
      case Full:
        '[GENES-MODULE-REQUEST-001] A full request with "moduleRecords": true '
        + 'needs a --main. This request has none, so it is most likely a '
        + 'module request that read a full request descriptor. Nothing was '
        + 'published; write the descriptor only while no request is in flight.';
      case Module(_): null;
    }
  }

  /**
   * Returns true when a refused module request may publish an empty tree
   * into `outputFolder`, so that no file of an earlier preview stays there.
   * Only a folder that is known not to be the full request's output folder
   * qualifies: records exist, the folder differs from theirs, and the
   * request has no `--main`. A session still reads the published files from
   * the report (`files`).
   */
  public static function mayEmptyFolder(outputFolder: String,
      hasMain: Bool): Bool {
    return !hasMain
      && storedKey != null
      && storedOutputFolder != ''
      && outputFolder != storedOutputFolder;
  }

  /** Forgets every record. */
  public static function drop(): Void {
    storedKey = null;
    storedOutputFolder = '';
    records = new Map();
    storedEpochs = new Map();
    externalUses = new Map();
    usersByRef = new Map();
    ancestorModules = new Map();
    storedFiles = new Map();
    shapeCache = new Map();
  }

  /**
   * Returns the time and size of a source file as one text, or `missing`.
   * Haxe compares file times too when it decides to type a module again.
   */
  static function stampOf(file: String): String {
    return try {
      final status = FileSystem.stat(file);
      '${status.mtime.getTime()} ${status.size}';
    } catch (_:haxe.Exception) {
      'missing';
    }
  }

  /**
   * Returns `shape` without the lines of private fields that no other
   * module can see: no module of the stored full request uses the field
   * from another module, and no class of another module extends its class.
   * Such a field can change without a new typing of the modules that import
   * this one; `kept` and the reference checks still guard what it does to
   * this module's own file.
   *
   * Example: adding the private helper `format()` to `app.Button` keeps the
   * visible shape, so the edit can be previewed.
   */
  static function visibleShape(shape: String): String {
    return [
      for (line in shape.split('\n'))
        if (isVisibleLine(line)) line
    ].join('\n');
  }

  static function isVisibleLine(line: String): Bool {
    final marker = '  $PRIVATE_MARK';
    if (!StringTools.startsWith(line, marker))
      return true;
    final parts = line.substr(marker.length).split(' ');
    if (parts.length < 2)
      return true;
    return externalUses.exists('${parts[0]} ${parts[1]}')
      || externalUses.exists('${parts[0]} *');
  }

  /**
   * Decides whether the module request may publish the files that it
   * printed for `facts.module`. Returns `null` when every check of the class
   * comment holds, else the refusal code and the reason.
   */
  public static function decide(facts: ModuleRequestFacts): Null<{
    code: String,
    reason: String
  }> {
    function refuse(code: String, reason: String) {
      return {code: code, reason: reason};
    }
    final module = facts.module;
    final descriptor = IncrementalRequest.descriptor();
    if (descriptor == null)
      return refuse('off', 'the request left the incremental path');
    // A module request has no `--main`. With one, the descriptor most
    // likely belongs to another request: the session rewrote the one file
    // while this request was queued on the server.
    if (facts.hasMain)
      return refuse('has-main',
        'the request has a --main, so it is not the ' +
        'module request that its descriptor names; write the descriptor only ' +
        'while no request is in flight');
    if (descriptor.generation != ReuseClean || descriptor.afterTyping != Reuse)
      return refuse('needs-reuse',
        'a module request needs "generation": "reuse" and "afterTyping": "reuse"');
    final shadowOff = IncrementalShadow.inactiveReason();
    if (shadowOff != null)
      return refuse('shadow-off', shadowOff);
    final key = GenerationChangeSet.sessionKey();
    if (storedKey == null)
      return refuse('no-records',
        'no full request with "moduleRecords": true stored records');
    if (key != storedKey)
      return refuse('session-changed',
        'the session key differs from the one of the stored records');
    if (module == facts.rootModule)
      return refuse('root-module', '$module is the output root module');
    final record = records.get(module);
    final entry = GenerationCache.entry(module);
    if (record == null || entry == null)
      return refuse('no-record', 'the last full request emitted no $module');
    if (entry.epochs != record.epochs)
      return refuse('no-record',
        'the record of $module is not the one of ' + 'the stored generation');
    if (facts.outputFolder == storedOutputFolder)
      return refuse('same-folder',
        'the module request writes to the output ' +
        'folder of the full request; it needs a folder of its own');
    // A macro can define a module of extern classes again while Haxe types
    // the requested module, for example a `genes.ts.imports` holder of
    // `genes.ts.Imports`. Such a module is the stored one when its extern
    // fingerprint is the stored one.
    final redefined = new Map<String, Bool>();
    final others = [];
    for (name in GenerationChangeSet.retypedModules()) {
      if (name == module)
        continue;
      final declarations = typesOf(facts.allTypes, name);
      final stored = GenerationCache.storedFingerprint(name);
      if (declarations.length > 0
        && declarations.foreach(isExternClass)
        && stored != null
        && ModuleFingerprint.ofExtern(declarations) == stored)
        redefined.set(name, true);
      else
        others.push(name);
    }
    if (others.length > 0)
      return refuse('other-modules-typed',
        'Haxe typed other modules again: ' + others.slice(0, 5).join(', '));
    // Every other module of this request must be the one of the stored full
    // request: not typed in this request, and not in an earlier module
    // request either (its stamp would then be newer).
    for (name in GenerationChangeSet.observedModules()) {
      if (name == module || redefined.exists(name))
        continue;
      final stored = storedEpochs.get(name);
      if (stored == null || stored != GenerationChangeSet.epochs(name))
        return refuse('other-modules-changed',
          '$name is not the module of ' +
          'the last full request (${stored == null ? 'it was not in that program' : 'Haxe typed it since'})');
    }
    // Haxe checks only the files of the modules that this request loads. An
    // edit of any other file of the stored program (a module that imports
    // this one, for example) is invisible to it, so Genes checks those files.
    final ownFile = moduleFiles.get(module);
    final loadedFiles = new Map<String, Bool>();
    for (name => file in moduleFiles)
      if (name != module)
        loadedFiles.set(file, true);
    for (file => stamp in storedFiles)
      if (file != ownFile && !loadedFiles.exists(file)
        && stampOf(file) != stamp)
        return refuse('source-changed',
          '$file changed since the full request, and this request does not ' +
          'type it');
    final failures = GenerationChangeSet.sameObjectFailures();
    if (failures.length > 0)
      return refuse('same-object-failure',
        'a declaration is not the object of its kept bucket: ' +
        failures.slice(0, 5)
        .join(', '));
    if (facts.types.length == 0)
      return refuse('not-in-program',
        '$module has no declaration after ' + 'dead-code elimination');
    final shape = requestShape;
    if (shape == null || record.shape == null)
      return refuse('no-shape', 'the public shape of $module is not known');
    if (shape.indexOf(MACRO_MARK) >= 0 || shape.indexOf(GENERIC_MARK) >= 0)
      return refuse('macro-or-generic',
        '$module defines a macro or a ' +
        '@:generic declaration, which other modules expand when Haxe types them');
    final storedShape = visibleShape(record.shape);
    final currentShape = visibleShape(shape);
    if (currentShape != storedShape)
      return refuse('public-shape-changed',
        'the public shape of $module ' +
        'changed: ${firstDifference(storedShape, currentShape)}');
    if (facts.exposed)
      return refuse('exposed',
        '$module is exposed or has public root entries, ' +
        'which the root module prints');
    if (!facts.emits)
      return refuse('not-emitted', '$module gets no implementation file');
    final kept = keptLines(facts.types);
    if (kept.join('\n') != record.kept.join('\n'))
      return refuse('kept-changed',
        'the kept declarations or fields of ' +
        '$module differ: ${firstDifference(record.kept.join('\n'), kept.join('\n'))}');
    if (facts.members != entry.members)
      return refuse('member-list-changed',
        'the final member list of $module differs');
    if (facts.rootFlags != entry.rootFlags)
      return refuse('root-flags-changed', 'the root flags of $module differ');
    final references = facts.references;
    if (references.foreign.join('\n') != record.foreignRefs.join('\n'))
      return refuse('foreign-references-changed',
        'what $module uses from ' +
        'other modules changed: ${firstDifference(record.foreignRefs.join('\n'), references.foreign.join('\n'))}');
    final recorded = IncrementalShadow.recordedModule(module);
    for (line in recorded.answers)
      switch GenerationCache.parseAnswer(line) {
        case {kind: 'feature', name: name}
          if (GenerationCache.EMISSION_FEATURES.indexOf(name) >= 0):
          return refuse('emission-feature',
            '$module asked for the feature ' +
            '$name, which emission of another module can add');
        default:
      }
    final ownFiles = new Map<String, Bool>();
    for (type in facts.types) {
      final pos = positionOf(type);
      if (pos != null)
        ownFiles.set(Context.getPosInfos(pos).file, true);
    }
    final wrong = wrongAnswer(recorded.answers, entry.answers, ownFiles);
    if (wrong != null)
      return refuse('answers-changed',
        'an answer that $module asked may ' +
        'differ in a full build: ${GenerationCache.answerText(wrong)}');
    if (entry.usedHaxePrinter || genes.HaxePrinterUse.used(module))
      return refuse('haxe-printer', '$module used Haxe\'s own printer');
    final lookups = TypedModuleInventory.fallbackLookups();
    if (lookups.length > 0)
      return refuse('lookup-by-name',
        'Genes looked up modules by name: ' + lookups.slice(0, 5).join(', '));
    // A module that the module read by name is unchanged: every module of
    // this request other than the requested one has its stored epochs
    // (checked above), and a read outside the inventory is refused.
    final parting = GenerationCache.partingFolders(storedOutputFolder,
      facts.outputFolder);
    if (parting != null)
      for (source in recorded.mapSources)
        for (folder in parting)
          if (source == folder || StringTools.startsWith(source, folder + '/'))
            return refuse('map-source-parting',
              'a source of the maps of ' +
              '$module is inside the folder where the output paths part: $source');
    return null;
  }

  /**
   * Returns the answer of `feature` that a module request uses: the answer
   * of a full build after this edit, as far as this request can know it.
   * `live` is Haxe's answer for the program of this request, which holds the
   * requested module and what it imports, but not the rest of the program.
   *
   * Why it is exact: Haxe sets a feature for each field that dead-code
   * elimination keeps (`pack.Type.field`) and for some kinds of code. The
   * program of the request is a part of the full program, so a "yes" stays a
   * "yes". A "no" is right when the stored full request answered "no" too:
   * the other modules did not change, and the requested module's code is in
   * this request. For a "no" against a stored "yes", the feature came from
   * another module when it names a field (`pack.Type.field`) and the
   * requested module neither keeps nor uses a field of that name; then the
   * answer is the stored "yes". Otherwise the answer stays "no", and `decide`
   * refuses because it differs from the stored one.
   *
   * Example: `ReferenceBacklinks` asks for `js.Lib.global`, which another
   * module of the application uses. The request's program does not hold that
   * module, so Haxe answers "no"; the full build answers "yes", and so does
   * this function.
   */
  public static function featureAnswer(feature: String, live: Bool): Bool {
    if (live)
      return true;
    final module = target();
    if (module == null)
      return false;
    final record = records.get(module);
    final entry = GenerationCache.entry(module);
    if (record == null || entry == null
      || entry.answers.indexOf(GenerationCache.answerLine('feature', feature,
        '1')) < 0)
      return false;
    final dot = feature.lastIndexOf('.');
    if (dot <= 0 || dot == feature.length - 1)
      return false;
    // The module itself defined the feature (`__define_feature__` in a kept
    // body, for example the inlined getter of `js.Lib.global`): the stored
    // "yes" may have come from this module only.
    if (record.foreignRefs.indexOf('define $feature') >= 0)
      return false;
    final name = feature.substr(dot + 1);
    for (line in record.kept.concat(record.foreignRefs))
      if (StringTools.endsWith(line, ' s:$name')
        || StringTools.endsWith(line, ' i:$name'))
        return false;
    return true;
  }

  /**
   * Returns the first answer of the requested module that can differ from
   * the answer of a full build, or `null` when none can.
   *
   * - `feature`: `featureAnswer` gave the full build's answer, unless it
   *   kept a "no" against a stored "yes".
   * - `module` (an owner in the module map) and `cycle` (an import cycle):
   *   the request knows only the modules of its program, so a "yes" holds in
   *   the full build too, and a "no" holds only when the stored full request
   *   answered "no" as well. A different stored answer is a refusal.
   * - `anonTs` and `anonSource` facts keyed by a position in the module's
   *   own source file (or a generated position, file `?`): an edit moves
   *   these keys. The facts of each kind, in the order of their positions,
   *   must have the stored answers. A fact that another module's capture
   *   wrote at such a key in the full build and that this request lacks
   *   shows as a different answer.
   * - `anonTs`, `anonSource` with another key, and any other kind: the
   *   stored full request must have asked the same question with the same
   *   answer.
   */
  static function wrongAnswer(now: Array<String>, stored: Array<String>,
      ownFiles: Map<String, Bool>): Null<String> {
    final storedAnswers = new Map<String, String>();
    final storedMoved = new Map<String, Array<{at: Int, line: String}>>();
    final nowMoved = new Map<String, Array<{at: Int, line: String}>>();
    function moved(answer: {kind: String, name: String, answer: String},
        line: String, into: Map<String, Array<{at: Int, line: String}>>): Bool {
      if (answer.kind != 'anonTs' && answer.kind != 'anonSource')
        return false;
      final parts = answer.name.split(':');
      if (parts.length < 3)
        return false;
      final file = parts.slice(0, parts.length - 2).join(':');
      if (file != '?' && !ownFiles.exists(file))
        return false;
      final at = Std.parseInt(parts[parts.length - 2]);
      final list = into.get(answer.kind);
      final item = {at: at == null ? 0 : at, line: answer.answer};
      if (list == null)
        into.set(answer.kind, [item]);
      else
        list.push(item);
      return true;
    }
    for (line in stored) {
      final answer = GenerationCache.parseAnswer(line);
      if (!moved(answer, line, storedMoved))
        storedAnswers.set('${answer.kind}\x01${answer.name}', answer.answer);
    }
    for (kind in ['anonTs', 'anonSource']) {
      final before = storedMoved.get(kind);
      final after = new Array<{at: Int, line: String}>();
      for (line in now) {
        final answer = GenerationCache.parseAnswer(line);
        if (answer.kind == kind)
          moved(answer, line, nowMoved);
      }
      final current = nowMoved.get(kind);
      final left = before == null ? [] : before;
      final right = current == null ? after : current;
      left.sort((a, b) -> a.at - b.at);
      right.sort((a, b) -> a.at - b.at);
      if ([for (item in left) item.line].join('\n') != [for (item in right) item.line].join('\n'))
        return GenerationCache.answerLine(kind,
          'facts in the source of the module', 'differ after the edit');
    }
    for (line in now) {
      final answer = GenerationCache.parseAnswer(line);
      if (moved(answer, line, new Map()))
        continue;
      final before = storedAnswers.get('${answer.kind}\x01${answer.name}');
      switch answer.kind {
        case 'feature' | 'module' | 'cycle':
          if (before == null ? answer.answer != '1' : before != answer.answer)
            return line;
        default:
          if (before != answer.answer)
            return line;
      }
    }
    return null;
  }

  /**
   * Writes the report of a module request beside its descriptor. A failure
   * to write gives one warning; the request goes on.
   */
  public static function writeReport(module: String, result: String,
      refusal: Null<{
      code: String,
      reason: String
    }>,
      files: Array<String>, kept: Int, generationSeconds: Float,
      checkSeconds: Float): Void {
    final descriptor = IncrementalRequest.requestedDescriptor();
    if (descriptor == null)
      return;
    final report: ModuleRequestReport = {
      format: REPORT_FORMAT,
      kind: 'module',
      module: module,
      result: result,
      refusal: refusal == null ? null : refusal.code,
      reason: refusal == null ? null : refusal.reason,
      typedAgainModules: GenerationChangeSet.retypedModules(),
      files: files,
      kept: kept,
      generationMs: GenerationChangeSet.milliseconds(generationSeconds),
      checkMs: GenerationChangeSet.milliseconds(checkSeconds),
      rootMs: GenerationChangeSet.milliseconds(shapeSeconds + rootSeconds)
    };
    save(IncrementalRequest.generationReportPath(descriptor.path),
      Json.stringify(report, null, '  ') + '\n');
  }

  static function writeRecordsReport(descriptor: IncrementalDescriptor,
      stored: Bool, reason: Null<String>, walked: Int, shapeCount: Int,
      started: Float): Void {
    final report: ModuleRecordsReport = {
      format: REPORT_FORMAT,
      stored: stored,
      reason: reason,
      modules: [for (_ in records.keys()) 1].length,
      walked: walked,
      shapes: shapeCount,
      shapeMs: GenerationChangeSet.milliseconds(shapeSeconds),
      recordMs: GenerationChangeSet.milliseconds(haxe.Timer.stamp() - started)
    };
    save(descriptor.path + '.module-records.json',
      Json.stringify(report, null, '  ') + '\n');
  }

  static function save(file: String, text: String): Void {
    try {
      File.saveContent(file, text);
    } catch (error:haxe.Exception) {
      Context.warning('[GENES-INCREMENTAL-REPORT-003] Genes cannot write the '
        + 'module request report $file (${error.message}). The build '
        + 'continues without it.',
        Context.currentPos());
    }
  }

  /**
   * Returns the kept lines of one module's declarations after dead-code
   * elimination, sorted: `class <type>`, `class <type> new`, `class <type>
   * init`, `class <type> s:<field>`, `class <type> i:<field>`,
   * `enum <type>`, `typedef <type>` and `abstract <type>`.
   */
  public static function keptLines(types: Array<Type>): Array<String> {
    final lines = [];
    for (type in types)
      switch type {
        case TInst(reference, _):
          final cls = reference.get();
          final name = TypeUtil.baseTypeFullName(cls);
          lines.push('class $name');
          if (cls.constructor != null)
            lines.push('class $name new');
          if (cls.init != null)
            lines.push('class $name init');
          for (field in cls.statics.get())
            lines.push('class $name s:${field.name}');
          for (field in cls.fields.get())
            lines.push('class $name i:${field.name}');
        case TEnum(reference, _):
          lines.push('enum ${TypeUtil.baseTypeFullName(reference.get())}');
        case TType(reference, _):
          lines.push('typedef ${TypeUtil.baseTypeFullName(reference.get())}');
        case TAbstract(reference, _):
          lines.push('abstract ${TypeUtil.baseTypeFullName(reference.get())}');
        default:
      }
    lines.sort(compareStrings);
    return lines;
  }

  /**
   * Reads the kept fields of `module` (after dead-code elimination) and
   * returns what they use from other modules: the fields, declarations and
   * structure field names that their bodies name (`foreign`, with the
   * `toString` that `Std.string` and `trace` reach, and `define <feature>`
   * for each `__define_feature__` call), and the declarations that their
   * signatures name (`mentions`). Both lists are sorted and unique.
   *
   * Example: `render` of `app.Button` calls `Theme.color()` and its own
   * `label()`: the foreign line `field app.Theme s:color` (the call of
   * `label()` stays inside the module and is not listed). `modules` lists
   * the other modules that `foreign` names (here `app.Theme`).
   */
  public static function referencesOf(module: String,
      types: Array<Type>): ModuleReferences {
    final foreign = new Map<String, Bool>();
    final mentions = new Map<String, Bool>();
    final modules = new Map<String, Bool>();
    final owners = new Map<String, {module: String, name: String}>();
    function classOf(reference: Ref<ClassType>): {module: String, name: String} {
      final key = reference.toString();
      final known = owners.get(key);
      if (known != null)
        return known;
      final cls = reference.get();
      final found = {module: cls.module, name: TypeUtil.baseTypeFullName(cls)};
      owners.set(key, found);
      return found;
    }
    function use(targetModule: String, text: String): Void {
      if (targetModule == module)
        return;
      foreign.set(text, true);
      modules.set(targetModule, true);
    }
    function useField(owner: Ref<ClassType>, isStatic: Bool,
        field: String): Void {
      final found = classOf(owner);
      use(found.module, 'field ${found.name} ${isStatic ? 's' : 'i'}:$field');
      use(found.module, 'type ${found.name}');
    }
    function useType(declaration: ModuleType): Void {
      final base = DependencyPlan.moduleTypeBase(declaration);
      use(base.module, 'type ${TypeUtil.baseTypeFullName(base)}');
    }
    function useValueType(value: Type): Void {
      switch Context.follow(value) {
        case TInst(owner, _):
          final found = classOf(owner);
          use(found.module, 'type ${found.name}');
        case TEnum(owner, _):
          final enm = owner.get();
          use(enm.module, 'type ${TypeUtil.baseTypeFullName(enm)}');
        default:
      }
    }
    // `Std.string(x)` and `trace(x)` keep `toString` of the class of `x`.
    function useToString(value: Type): Void {
      switch Context.follow(value) {
        case TInst(owner, _):
          useField(owner, false, 'toString');
        default:
      }
    }
    function mention(value: Type, depth: Int): Void {
      if (depth > 6)
        return;
      switch Context.follow(value) {
        case TInst(owner, params):
          final found = classOf(owner);
          if (found.module != module)
            mentions.set('type ${found.name}', true);
          for (param in params)
            mention(param, depth + 1);
        case TEnum(owner, params):
          final enm = owner.get();
          if (enm.module != module)
            mentions.set('type ${TypeUtil.baseTypeFullName(enm)}', true);
          for (param in params)
            mention(param, depth + 1);
        case TFun(args, result):
          for (arg in args)
            mention(arg.t, depth + 1);
          mention(result, depth + 1);
        case TAbstract(_, params):
          for (param in params)
            mention(param, depth + 1);
        default:
      }
    }
    for (type in types)
      switch type {
        case TInst(reference, _):
          final cls = reference.get();
          final parent = cls.superClass;
          function visit(expression: TypedExpr): Void {
            switch expression.expr {
              case TField(_, access):
                switch access {
                  case FStatic(owner, field):
                    useField(owner, true, field.get().name);
                  case FInstance(owner, _, field):
                    useField(owner, false, field.get().name);
                  case FClosure(owner, field):
                    if (owner == null) foreign.set('anon ${field.get().name}',
                      true); else useField(owner.c, false, field.get().name);
                  case FAnon(field):
                    foreign.set('anon ${field.get().name}', true);
                  case FDynamic(field):
                    foreign.set('anon $field', true);
                  case FEnum(owner, _):
                    final enm = owner.get();
                    use(enm.module, 'type ${TypeUtil.baseTypeFullName(enm)}');
                }
              case TNew(owner, _, _):
                useField(owner, false, 'new');
              case TTypeExpr(declaration):
                useType(declaration);
              case TCast(_, declaration) if (declaration != null):
                useType(declaration);
              case TVar(variable, _):
                useValueType(variable.t);
              case TTry(_, catches):
                for (item in catches)
                  useValueType(item.v.t);
              case TCall({expr: TConst(TSuper)}, _) if (parent != null):
                useField(parent.t, false, 'new');
              case TCall({expr: TIdent('__define_feature__')},
                [{expr: TConst(TString(feature))}, _]):
                foreign.set('define $feature', true);
              case TCall({expr: TField(_, FStatic(owner, field))}, [argument]) |
                TCall({expr: TField(_, FStatic(owner, field))}, [argument, _])
                if ((field.get().name == 'string'
                  && classOf(owner).name == 'Std.Std')
                  || (field.get().name == 'trace'
                    && classOf(owner).name == 'haxe.Log.Log')):
                useToString(argument.t);
              default:
            }
            TypedExprTools.iter(expression, visit);
          }
          function walkField(field: ClassField): Void {
            mention(field.type, 0);
            final body = field.expr();
            if (body != null)
              visit(body);
            for (signature in field.overloads.get()) {
              final other = signature.expr();
              if (other != null)
                visit(other);
            }
          }
          for (field in cls.statics.get())
            walkField(field);
          for (field in cls.fields.get())
            walkField(field);
          final constructor = cls.constructor;
          if (constructor != null)
            walkField(constructor.get());
          final init = cls.init;
          if (init != null)
            visit(init);
        default:
      }
    return {
      foreign: sortedKeys(foreign),
      mentions: sortedKeys(mentions),
      modules: sortedKeys(modules)
    };
  }

  /**
   * Returns the public shape of one module's declarations before dead-code
   * elimination: what other modules see when Haxe types them. For each
   * declaration: its kind and name, the number of type parameters, its
   * parents with their type arguments, its metadata, and each field (also a
   * private one, which `@:access` can reach) with its kind, type, access
   * and metadata. An inline field or a macro also has its typed body and
   * position, because other modules copy the body while Haxe types them and
   * their source maps name its position. A `@:generic` declaration or field
   * gets the word `generic`.
   *
   * Example: changing `inline static final LIMIT = 3` to `4` changes the
   * shape, so a module request refuses the preview: every module that reads
   * `LIMIT` prints `4` in a full build.
   */
  public static function shapeOf(types: Array<Type>): String {
    final buffer = new StringBuf();
    for (type in types) {
      switch type {
        case TInst(reference, _):
          final cls = reference.get();
          if (cls.kind.match(KTypeParameter(_)))
            continue;
          buffer.add('class ${TypeUtil.baseTypeFullName(cls)} ${cls.params.length}');
          final parent = cls.superClass;
          if (parent != null)
            buffer.add(' extends ${TypeTools.toString(TInst(parent.t, parent.params))}');
          for (item in cls.interfaces)
            buffer.add(' implements ${TypeTools.toString(TInst(item.t, item.params))}');
          buffer.add(cls.isExtern ? ' extern' : '');
          buffer.add(cls.isInterface ? ' interface' : '');
          buffer.add(cls.isFinal ? ' final' : '');
          buffer.add(cls.init != null ? ' init' : '');
          buffer.add(cls.meta.has(':generic') ? GENERIC_MARK : '');
          buffer.add(shapeMetaText(cls.meta));
          final owner = TypeUtil.baseTypeFullName(cls);
          final constructor = cls.constructor;
          if (constructor != null)
            addShapeField(buffer, owner, 'new', 'i:new', constructor.get());
          for (field in cls.fields.get())
            addShapeField(buffer, owner, 'field', 'i:${field.name}', field);
          for (field in cls.statics.get())
            addShapeField(buffer, owner, 'static', 's:${field.name}', field);
        case TEnum(reference, _):
          final enm = reference.get();
          buffer.add('enum ${TypeUtil.baseTypeFullName(enm)} ${enm.params.length}');
          buffer.add(shapeMetaText(enm.meta));
          for (name in enm.names) {
            final construct = enm.constructs.get(name);
            if (construct != null)
              buffer.add('\n  constructor $name ${TypeTools.toString(construct.type)}'
                + shapeMetaText(construct.meta));
          }
        case TType(reference, _):
          final def = reference.get();
          buffer.add('typedef ${TypeUtil.baseTypeFullName(def)} ${def.params.length} '
            + TypeTools.toString(def.type)
            + shapeMetaText(def.meta));
        case TAbstract(reference, _):
          final abs = reference.get();
          buffer.add('abstract ${TypeUtil.baseTypeFullName(abs)} ${abs.params.length} '
            + TypeTools.toString(abs.type)
            + shapeMetaText(abs.meta));
          for (item in abs.from)
            buffer.add(' from ${TypeTools.toString(item.t)}');
          for (item in abs.to)
            buffer.add(' to ${TypeTools.toString(item.t)}');
        default:
      }
      buffer.add('\n');
    }
    return buffer.toString();
  }

  /**
   * Adds one field line to a shape. A private field that other modules
   * cannot copy (not inline, not a macro) gets the line
   * `  private <type> <key> ...`, which `visibleShape` keeps only when
   * another module uses the field or extends its class.
   */
  static function addShapeField(buffer: StringBuf, owner: String,
      label: String, key: String, field: ClassField): Void {
    final copied = switch field.kind {
      case FMethod(MethInline) | FMethod(MethMacro) | FVar(AccInline, _): true;
      default: false;
    }
    final start = field.isPublic
      || copied ? '\n  $label ${field.name}' : '\n  $PRIVATE_MARK$owner $key';
    buffer.add('$start ${Std.string(field.kind)} '
      + TypeTools.toString(field.type));
    buffer.add(field.isPublic ? ' public' : '');
    buffer.add(field.isFinal ? ' final' : '');
    buffer.add(field.isExtern ? ' extern' : '');
    buffer.add(field.params.length > 0 ? ' params=${field.params.length}' : '');
    buffer.add(field.meta.has(':generic') ? GENERIC_MARK : '');
    buffer.add(shapeMetaText(field.meta));
    if (field.kind.match(FMethod(MethMacro)))
      buffer.add(MACRO_MARK);
    if (copied) {
      buffer.add(' at ${placeText(field.pos)}');
      final body = field.expr();
      if (body != null)
        buffer.add(' body ${placeText(body.pos)} '
          + TypedExprTools.toString(body, true));
    }
    for (signature in field.overloads.get())
      buffer.add(' overload ${TypeTools.toString(signature.type)}'
        + shapeMetaText(signature.meta));
  }

  static function isExternClass(type: Type): Bool {
    return switch type {
      case TInst(reference, _): reference.get().isExtern;
      default: false;
    }
  }

  /**
   * Returns where a copied body is, as other modules see it. With source
   * maps (`-debug` or `-D js_source_map`), their maps name each character
   * position, so the text holds the file and the character range. Without
   * them only line numbers can reach output (`haxe.PosInfos`, for example
   * in a `trace` inside an inline function), so the text holds the file and
   * the lines: an edit inside one line of the module before an inline field
   * then keeps the shape.
   */
  static function placeText(pos: haxe.macro.Expr.Position): String {
    if (Context.defined('debug') || Context.defined('js_source_map')) {
      final place = Context.getPosInfos(pos);
      return '${place.file}:${place.min}-${place.max}';
    }
    final location = haxe.macro.PositionTools.toLocation(pos);
    return
      '${location.file}:${location.range.start.line}-${location.range.end.line}';
  }

  /**
   * Returns metadata as `ModuleFingerprint.metaText` does, without the
   * entries of `SHAPE_EXCLUDED_META`: a sorted set of ` @name(arguments)`
   * texts.
   */
  static function shapeMetaText(meta: MetaAccess): String {
    final entries = new Map<String, Bool>();
    for (entry in meta.get()) {
      if (ModuleFingerprint.EXCLUDED_META.exists(entry.name)
        || SHAPE_EXCLUDED_META.exists(entry.name))
        continue;
      final params = entry.params;
      entries.set(params == null
        || params.length == 0 ? '@${entry.name}' : '@${entry.name}(' +
          [for (param in params) haxe.macro.ExprTools.toString(param)].join(', ') +
          ')',
        true);
    }
    final texts = [for (text in entries.keys()) text];
    if (texts.length == 0)
      return '';
    texts.sort(compareStrings);
    return ' ' + texts.join(' ');
  }

  /** Returns the source position of one declaration of the generator's list. */
  static function positionOf(type: Type): Null<haxe.macro.Expr.Position> {
    return switch type {
      case TInst(reference, _): reference.get().pos;
      case TEnum(reference, _): reference.get().pos;
      case TType(reference, _): reference.get().pos;
      case TAbstract(reference, _): reference.get().pos;
      default: null;
    }
  }

  /** Returns the declarations of `module` in `types`, in order. */
  public static function typesOf(types: Array<Type>,
      module: String): Array<Type> {
    return [for (type in types) if (moduleOf(type) == module) type];
  }

  static function moduleOf(type: Type): Null<String> {
    return switch type {
      case TInst(reference, _): reference.get().module;
      case TEnum(reference, _): reference.get().module;
      case TType(reference, _): reference.get().module;
      case TAbstract(reference, _): reference.get().module;
      default: null;
    }
  }

  /** Returns the absolute, normalized folder of an output file. */
  public static function absoluteFolder(outputFile: String): String {
    final folder = Path.directory(outputFile);
    return
      PathUtil.normalize(FileSystem.absolutePath(folder.length == 0 ? '.' : folder));
  }

  /** Returns the first differing line of two texts, clipped, for a reason. */
  static function firstDifference(stored: String, now: String): String {
    final left = stored.split('\n');
    final right = now.split('\n');
    var index = 0;
    while (index < left.length && index < right.length
      && left[index] == right[index])
      index++;
    final before = index < left.length ? left[index] : '<end>';
    final after = index < right.length ? right[index] : '<end>';
    return 'line ${index + 1}: "${clip(before)}" became "${clip(after)}"';
  }

  static function clip(line: String): String {
    return line.length <= 160 ? line : line.substr(0, 160) + '...';
  }

  static function sortedKeys(map: Map<String, Bool>): Array<String> {
    final names = [for (name in map.keys()) name];
    names.sort(compareStrings);
    return names;
  }

  static function compareStrings(left: String, right: String): Int {
    return left < right ? -1 : left > right ? 1 : 0;
  }
}
#end
