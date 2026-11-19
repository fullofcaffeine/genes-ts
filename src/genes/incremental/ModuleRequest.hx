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
using haxe.macro.TypeTools;

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
   * A digest of the module's use skeleton (`skeletonOf`): the typed bodies
   * of its kept fields and its class initializers, after Haxe's filters,
   * with the values of literal constants left out. Two equal skeletons use
   * the same fields, types and classes in the same way.
   */
  final skeleton: String;

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

  /** See `ModuleRecord.skeleton`. */
  final skeleton: String;

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

  /** Time spent reading and hashing source files in this request. */
  final digestMs: Float;
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

  /** Time spent reading and hashing source files in this request. */
  final digestMs: Float;

  /**
   * Time spent reading the declaration facts of every module
   * (`targetFactsOf`) in this request.
   */
  final factsMs: Float;
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
 * 3. Genes roots dead-code elimination at the declarations and fields that
 *    the full request kept for the module (`afterSave`), prints the module
 *    into the request's output folder, and runs `decide`. When every check
 *    holds, it publishes the module's files (`result: "preview"`);
 *    otherwise it publishes nothing (`result: "refused"` with a code and a
 *    reason).
 * 4. The session runs the full request afterwards; it remains the authority
 *    for the published tree.
 *
 * Before each request (full or module), the session sends Haxe's
 * `server/invalidate` for each file that it saved. Genes also checks file
 * contents itself (`beginRequest`, `stale-source`, `source-changed`),
 * because Haxe compares file times only in whole seconds. It keeps a
 * file's digest as "what Haxe typed" only when the digest read before
 * typing equals the digest after typing (`provenDigest`). A save that lands
 * while Haxe types makes that file unknown: module requests are refused
 * until a full request has made Haxe parse it again, which the next full
 * request does.
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
 * - the defines are the ones that the session key holds: a define that a
 *   macro sets after the first after-typing callback of Genes changes what
 *   printing reads (`GenerationChangeSet.definesChangedAfterTyping`,
 *   `defines-changed`; the same check turns the generation shadow of a full
 *   request off);
 * - the facts of every declaration of every module of the request, read
 *   after every after-typing macro and every after-save callback that was
 *   registered before the save phase began, and before dead-code
 *   elimination (`afterSave`), are the ones that the stored full request
 *   read there
 *   (`targetFactsOf`: the walk's target
 *   facts `WalkTarget.inputsText`, that is kind, extern flag and metadata,
 *   and the metadata text of `ModuleFingerprint.addDeclaration`, with the
 *   metadata of fields, constructors, type parameters and declared
 *   structures). So a macro that changes another module from a literal of
 *   the requested module, after typing or after save, whichever order its
 *   callback has, is a refusal (`target-facts-changed`). Example: a macro copies the
 *   literal of `mr.Probe` into `@:ts.type` of `mr.TsTyped`, or calls
 *   `exclude()` on an enum of `mr.ExclOwner`; cold would then also change
 *   `mr/TsUser.ts` or `mr/ExclOwner.ts`, which a preview does not print.
 *   The requested module's own facts are checked after its signature and
 *   skeleton, so that a structural edit keeps its own refusal code;
 * - the visible public shape before dead-code elimination (public fields
 *   with their kinds, types and metadata, private fields that another
 *   module uses or can reach through a subclass, and the bodies and
 *   positions of inline fields) is the stored one, and the module defines
 *   no macro and no `@:generic` declaration: modules that import it then
 *   need no new typing;
 * - no source file of the stored program other than the module's own
 *   changed since the full request (content digest; also `import.hx`
 *   files, and also files of modules that this request loads, because Haxe
 *   compares file times only in whole seconds),
 *   so an edit outside the module's imports is a refusal too
 *   (`source-changed`);
 * - the module uses exactly what it used: its signature (every declaration
 *   and field, private ones included, with kinds, types, type-parameter
 *   constraints and metadata;
 *   `signature-changed`) and the use skeleton of its kept bodies (the printed
 *   code without literal values and positions, and the declarations that
 *   dead-code elimination marks for the types of its nodes, type-parameter
 *   constraints included;
 *   `uses-changed`) are the stored ones, and it has no `@:ifFeature` field;
 * - the kept declarations and fields, the final member list, the root
 *   flags and the uses of other modules are the stored ones;
 * - every question that planning and printing of the module asked
 *   (features, module map, import cycles, signature facts) got the answer
 *   of a full build (`featureAnswer`, `wrongAnswer`), and no question names
 *   a feature that emission of another module can add;
 * - Haxe's own printer was not used, nothing was looked up by name outside
 *   the inventory, the output folder is not the program's, and no source of
 *   its maps is inside a folder where the program and preview output paths
 *   part.
 *
 * What is proven (dead-code elimination). Dead-code elimination decides
 * what to keep from its roots and from what each kept field uses: the
 * fields it reads and calls, the types of its nodes, the classes it creates,
 * and the overrides of what it calls. Other modules did not change (equal
 * epochs and source files). The module's signature is the stored one, so
 * its roots (`@:keep`, `__init__`) and field types are the same, and the
 * skeleton of each kept body is the stored one, so each kept field uses the
 * same things; only literal values and positions differ, which dead-code
 * elimination does not read. So the full build after the edit has the same
 * input as the stored full build in every place that a kept field reaches,
 * and keeps the same lines: K(new full) = K(stored). The request roots those
 * lines, and its program is a part of the full program, so its own
 * elimination keeps them and nothing that the full build would not keep;
 * the check "kept lines equal" confirms it. Example: an edit removes the
 * only call of a private helper: the skeleton changes (`uses-changed`). A
 * text or markup literal edit keeps the skeleton and can be previewed.
 *
 * Limits: the proof assumes that Haxe's elimination reads only typed trees,
 * signatures and metadata. A macro that reads literal values and changes
 * the metadata or the extern flag of a declaration of a module in the
 * request, in an after-typing or an after-save callback, is covered
 * (`target-facts-changed` above, or `session-changed` when
 * `GenerationChangeSet.compareMetadata` sees it first), and so is a define
 * that it sets (`defines-changed`). Not covered: metadata that only a typed
 * body holds (limit S3 of `ModuleFingerprint`); a change that a macro
 * makes, by name, to a module outside the request's program, which the
 * request never reads; an after-save callback that another after-save
 * callback registers while the save phase runs, when it is registered after
 * the callback of Genes (it runs after `afterSave`); and a file that a
 * macro reads in a module outside the request (other than `import.hx` and
 * resources, which the session key covers). A class kept only because another
 * module names it as a type, and an edit inside an import cycle, are
 * refused. The rule refuses every structural edit: a new or removed field,
 * call, local type or class use.
 *
 * Effects on the compiler server: the roots are `@:keep` entries with the
 * argument `"genes.moduleRequest"`, which Genes adds after
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

  /** The start of the shape line of a copied body (see `addShapeField`). */
  static inline final BODY_MARK = '    #body ';

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
   * The content digest (`digestOf`) of each source file and `import.hx`
   * file of the stored program, read right after typing in the full request.
   */
  @:persistent static var storedFiles: Map<String, String> = new Map();

  /**
   * The content digest of each source file when Haxe last typed its module
   * in a request with the define. A file whose content differs at the start
   * of a request may hold content that Haxe's own check missed: Haxe keeps
   * file times in whole seconds, so a second save in the same second looks
   * unchanged. `beginRequest` makes Haxe parse such a file again.
   */
  @:persistent static var typedDigests: Map<String, String> = new Map();

  /**
   * Files of modules that a module request typed alone and could not mark
   * for a new typing (`retypeLater` failed). The next request invalidates
   * them before typing.
   */
  @:persistent static var typedAlone: Array<String> = [];

  /**
   * Modules whose roots a request added and did not remove (it failed
   * before the generator ran). The next request removes them.
   */
  @:persistent static var leftoverRoots: Array<String> = [];

  /** The class (`TypeUtil.baseTypeFullName`) of the stored full request's `--main` function, or empty. */
  @:persistent static var storedMain = '';

  /** `GenerationChangeSet.epochs` of every module that the stored full request saw. */
  @:persistent static var storedEpochs: Map<String, String> = new Map();

  /**
   * `targetFactsOf` of every module that the stored full request saw, read
   * in `afterSave`: after every after-typing macro, before dead-code
   * elimination.
   */
  @:persistent static var storedTargetFacts: Map<String, String> = new Map();

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

  /** `targetFactsOf` of each module of this request, read in `afterSave`. */
  static var requestFacts: Map<String, String> = new Map();

  static var factsSeconds = 0.0;

  static var addedRoots: Array<MetaAccess> = [];
  static var moduleFiles: Map<String, String> = new Map();
  static var loadedModules: Map<String, Bool> = new Map();
  static var requestDigests: Map<String, String> = new Map();
  static var preDigests: Map<String, String> = new Map();
  static var digestSeconds = 0.0;
  static var targetFile: Null<String> = null;
  static var targetDigestAtStart: Null<String> = null;
  static var targetTypedDigest: Null<String> = null;
  static var retypeFailure: Null<String> = null;
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
    requestFacts = new Map();
    factsSeconds = 0.0;
    addedRoots = [];
    moduleFiles = new Map();
    loadedModules = new Map();
    requestDigests = new Map();
    preDigests = new Map();
    digestSeconds = 0.0;
    targetFile = null;
    targetDigestAtStart = null;
    targetTypedDigest = null;
    retypeFailure = null;
    surfaceOwners = null;
    if (!Context.defined(IncrementalRequest.DEFINE))
      return;
    beginRequest();
    // `false`: after Haxe saved the class state, so that the roots that
    // `afterSave` adds never reach the server's cache. `afterSave` is
    // registered from inside a first after-save callback: Haxe 4.3.7 runs
    // after-save callbacks in order of registration and then, in a new
    // round, the ones that they registered, all before dead-code
    // elimination. So `afterSave` runs after every after-save callback that
    // was registered before the save phase began (by an init macro, a build
    // macro or an after-typing callback, also one given after
    // `Generator.use()`), and it reads the declaration facts after such a
    // macro changed them (`targetFactsOf`). Probe: an init macro whose
    // callback registers another, and a later init macro: the order was
    // first, later, nested, and a class field that dead-code elimination
    // removes was still there in each.
    Context.onGenerate(_ -> Context.onGenerate(afterSave, false), false);
  }

  /**
   * Runs before Haxe types the program (`Generator.use()` is an init
   * macro): makes Haxe parse again each file whose content is not the
   * content that Haxe last typed (`typedDigests`), and each file that an
   * earlier module request typed alone and could not mark (`typedAlone`).
   *
   * Why: Haxe's compilation server compares file times in whole seconds.
   * Two saves of one file in the same second look like one, and the second
   * request types the first save's content. Example: `'Save'` becomes
   * `'Sava'` and then `'Savb'` within one second; without this step the
   * preview of the second save shows `Sava`. A session should still send
   * `server/invalidate` for each saved file before a request.
   *
   * In a module request it also notes the digest of the requested module's
   * file, which `decide` compares with the file after typing.
   */
  static function beginRequest(): Void {
    final descriptor = IncrementalRequest.descriptor();
    if (descriptor == null)
      return;
    final stale = typedAlone.copy();
    typedAlone = [];
    switch descriptor.kind {
      case Module(module):
        final file = try Context.resolvePath(module.split('.').join('/')
          + '.hx') catch (_:haxe.Exception) null;
        if (file != null) {
          targetFile = file;
          final now = digestOf(file);
          preDigests.set(file, now);
          targetDigestAtStart = now;
          targetTypedDigest = typedDigests.get(file);
          if (targetTypedDigest != now)
            stale.push(file);
        }
      case Full:
        // The first full request of this macro interpreter knows no file
        // yet: read every Haxe source of the class paths before typing, so
        // that `provenDigest` can prove what Haxe typed.
        if (descriptor.moduleRecords == true && !typedDigests.keys().hasNext())
          for (root in Context.getClassPath())
            scanSources(root.length == 0 ? '.' : root);
        if (descriptor.moduleRecords == true)
          for (file => digest in typedDigests) {
            final now = digestOf(file);
            preDigests.set(file, now);
            if (now == digest)
              continue;
            stale.push(file);
            // A changed `import.hx` changes how every module of its folder
            // and the folders below is typed.
            if (Path.withoutDirectory(file) == 'import.hx') {
              final folder = Path.directory(file) + '/';
              for (other => _ in typedDigests)
                if (StringTools.startsWith(other, folder))
                  stale.push(other);
            }
          }
    }
    if (stale.length > 0)
      haxe.macro.CompilationServer.invalidateFiles([
        for (file in stale)
          FileSystem.absolutePath(file)
      ]);
  }

  /**
   * Reads the digest of every `.hx` file below `folder` into `preDigests`,
   * under the path that Haxe gives in positions (the class path joined with
   * the relative path).
   */
  static function scanSources(folder: String): Void {
    final entries = try FileSystem.readDirectory(folder)
    catch (_:haxe.Exception) [];
    for (entry in entries) {
      final path = folder == '.' ? entry : Path.join([folder, entry]);
      if (StringTools.endsWith(entry, '.hx')) {
        if (!preDigests.exists(path))
          preDigests.set(path, digestOf(path));
      } else if (!StringTools.startsWith(entry, '.')
        && (try FileSystem.isDirectory(path) catch (_:haxe.Exception) false))
        scanSources(path);
    }
  }

  /** The digest that `typedDigests` keeps for content that is not proven to be what Haxe typed. */
  static inline final UNKNOWN_DIGEST = 'unknown';

  /**
   * Returns the digest of `file` if it is proven to be the content that Haxe
   * typed in this request, or `UNKNOWN_DIGEST`.
   *
   * Proof: the digest read before typing (`beginRequest`) equals the digest
   * after typing, so the file did not change while Haxe read it. A file
   * that `beginRequest` did not read (a new file) is unknown, and so is a
   * file whose content changed during the request (a save landed while
   * Haxe typed): a module request refuses an unknown file, and the next
   * full request makes Haxe parse it again. A file that is missing before
   * and after stays `missing`.
   */
  static function provenDigest(file: String): String {
    final after = digestOf(file);
    final before = preDigests.get(file);
    if (before != null)
      return before == after ? after : UNKNOWN_DIGEST;
    return after == 'missing' ? after : UNKNOWN_DIGEST;
  }

  /**
   * Returns the SHA-1 digest of a file's bytes as hexadecimal text, or
   * `missing`. The macro interpreter computes SHA-1 natively.
   */
  static function digestOf(file: String): String {
    final started = haxe.Timer.stamp();
    final digest = try {
      haxe.crypto.Sha1.make(File.getBytes(file)).toHex();
    } catch (_:haxe.Exception) {
      'missing';
    }
    digestSeconds += haxe.Timer.stamp() - started;
    return digest;
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
    // The declaration facts of every module (`targetFactsOf`): after every
    // after-typing macro, before dead-code elimination and before the roots.
    if (descriptor.kind.match(Module(_)) || descriptor.moduleRecords == true) {
      final factsStart = haxe.Timer.stamp();
      for (module => list in grouped)
        requestFacts.set(module, targetFactsOf(list));
      factsSeconds += haxe.Timer.stamp() - factsStart;
    }
    // Haxe typed these modules in this request; keep a digest only when it
    // is proven to be the content that Haxe read (`provenDigest`).
    for (module in GenerationChangeSet.retypedModules()) {
      final file = moduleFiles.get(module);
      if (file != null)
        typedDigests.set(file, provenDigest(file));
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
        final record = storedKey == null ? null : records.get(module);
        if (record != null)
          addRoots(module, own, record.kept);
        rootSeconds += haxe.Timer.stamp() - rootStart;
      case Full:
        if (descriptor.moduleRecords != true)
          return;
        // The content that Haxe typed for every source file, for the
        // records (`storedFiles`): the proven digest of each module file
        // (`typedDigests`, unknown for a module that Haxe kept from before
        // this session's records), and of each `import.hx` that can apply.
        for (_ => file in moduleFiles)
          if (!requestDigests.exists(file)) {
            final typed = typedDigests.get(file);
            // Haxe kept this module from before the digests that this
            // session keeps (a new macro interpreter): unknown, so that the
            // next full request makes Haxe parse it again.
            if (typed == null)
              typedDigests.set(file, UNKNOWN_DIGEST);
            requestDigests.set(file, typed == null ? UNKNOWN_DIGEST : typed);
          }
        for (file in importFilesOf([for (_ => file in moduleFiles) file]))
          if (!requestDigests.exists(file)) {
            final typed = provenDigest(file);
            typedDigests.set(file, typed);
            requestDigests.set(file, typed);
          }
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
   * dependency on `<descriptor>.module-dep`, which does not exist when Haxe
   * notes its time and exists afterwards, and on
   * `<descriptor>.module-dep-gone`, which exists then and is deleted
   * afterwards. Deleting or writing one of them by hand still leaves the
   * other changed. The server then finds
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
    // Two files, so that deleting or writing either one by hand cannot hide
    // the change: Haxe notes `appears` while it is missing and `vanishes`
    // while it exists, then Genes writes the first and deletes the second.
    final appears = descriptorPath + '.module-dep';
    final vanishes = descriptorPath + '.module-dep-gone';
    try {
      if (FileSystem.exists(appears))
        FileSystem.deleteFile(appears);
      File.saveContent(vanishes, 'genes module request\n');
      for (module in modules) {
        Context.registerModuleDependency(module, appears);
        Context.registerModuleDependency(module, vanishes);
      }
      File.saveContent(appears, 'genes module request\n');
      FileSystem.deleteFile(vanishes);
    } catch (error:haxe.Exception) {
      // The request publishes nothing (`decide` refuses), and the next
      // request makes Haxe parse these files again before it types them.
      retypeFailure = '[GENES-MODULE-REQUEST-002] Genes cannot mark '
        + '${modules.join(', ')} for a new typing in the next full request '
        + '(${error.message})';
      for (module in modules) {
        final file = moduleFiles.get(module);
        if (file != null)
          typedAlone = typedAlone.concat([file]);
      }
      Context.warning(retypeFailure, Context.currentPos());
    }
  }

  /** The argument of the roots that Genes adds, so that it removes only its own. */
  static inline final ROOT_MARK = 'genes.moduleRequest';

  /**
   * Adds `@:keep` to each declaration and field of `types` (the module's
   * declarations before dead-code elimination) that the stored record calls
   * kept, unless it already has one, and remembers each metadata so that
   * `removeRoots` can take the entry away again. The request has no
   * `--main`; these are its roots. `decide` admits the result only when the
   * module's signature and use skeleton equal the stored ones, so the full
   * build keeps exactly these lines (see the class comment).
   */
  static function addRoots(module: String, types: Array<Type>,
      kept: Array<String>): Void {
    final wanted = new Map<String, Bool>();
    for (line in kept)
      wanted.set(line, true);
    final pos = Context.currentPos();
    final roots: Array<MetaAccess> = [];
    function root(meta: MetaAccess): Void {
      if (!meta.has(':keep'))
        roots.push(meta);
    }
    for (type in types)
      switch type {
        case TInst(reference, _):
          final cls = reference.get();
          final name = TypeUtil.baseTypeFullName(cls);
          for (field in cls.statics.get())
            if (wanted.exists('class $name s:${field.name}'))
              root(field.meta);
          for (field in cls.fields.get())
            if (wanted.exists('class $name i:${field.name}'))
              root(field.meta);
          final constructor = cls.constructor;
          if (constructor != null && wanted.exists('class $name new'))
            root(constructor.get().meta);
        case TEnum(reference, _):
          final enm = reference.get();
          if (wanted.exists('enum ${TypeUtil.baseTypeFullName(enm)}'))
            root(enm.meta);
        default:
      }
    if (roots.length == 0)
      return;
    // Noted before the first entry is added: a request that fails before
    // `removeRoots` leaves them to the next request.
    leftoverRoots = leftoverRoots.concat([module]);
    for (meta in roots) {
      meta.add(':keep', [macro $v{ROOT_MARK}], pos);
      addedRoots.push(meta);
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

  /** Removes the `@:keep` entries with `ROOT_MARK` from `meta`, and keeps the others. */
  static function removeMarked(meta: MetaAccess): Void {
    for (name in [':keep']) {
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
          skeleton: earlier.skeleton,
          modules: []
        } else {
          walked++;
          referencesOf(module, own);
      }
      made.set(module, {
        epochs: epochs,
        kept: kept,
        foreignRefs: references.foreign,
        skeleton: references.skeleton,
        shape: shapes.get(module)
      });
    }
    final seen = new Map<String, String>();
    for (module in GenerationChangeSet.observedModules())
      seen.set(module, GenerationChangeSet.epochs(module));
    storedEpochs = seen;
    final facts = new Map<String, String>();
    for (module in seen.keys()) {
      final known = requestFacts.get(module);
      if (known != null)
        facts.set(module, known);
    }
    storedTargetFacts = facts;
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
    // Proven typed content (`afterSave`): every source file, and every
    // `import.hx` that can apply to them (a missing one is `missing`, so a
    // new one counts as a change; an unproven one is `unknown`).
    storedFiles = requestDigests;
    storedMain = '';
    if (main != null) {
      function findMain(expression: TypedExpr): Void {
        switch expression.expr {
          case TField(_, FStatic(owner, field)) if (field.get().name == 'main'):
            storedMain = TypeUtil.baseTypeFullName(owner.get());
          default:
            TypedExprTools.iter(expression, findMain);
        }
      }
      findMain(main);
    }
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
   * Only a folder where Genes published a preview before qualifies (it has
   * `PREVIEW_MARKER`), and never the full request's output folder or a
   * request with `--main`. A session still reads the published files from
   * the report (`files`).
   */
  public static function mayEmptyFolder(outputFolder: String,
      hasMain: Bool): Bool {
    return !hasMain
      && storedKey != null
      && storedOutputFolder != ''
      && outputFolder != storedOutputFolder
      && FileSystem.exists(Path.join([outputFolder, PREVIEW_MARKER]));
  }

  /**
   * The file that marks a folder as a preview folder of module requests.
   * Genes writes it after it published a preview there, and empties only a
   * folder that has it. The name is in Genes' reserved `.genes-output-`
   * space, so no generated file can take it.
   */
  public static inline final PREVIEW_MARKER = '.genes-output-module-preview';

  /** Writes `PREVIEW_MARKER` into the folder of a published preview. */
  public static function markPreviewFolder(outputFolder: String): Void {
    save(Path.join([outputFolder, PREVIEW_MARKER]),
      'Genes module request preview folder. Genes may empty this folder.\n');
  }

  /** Forgets every record. */
  public static function drop(): Void {
    storedKey = null;
    storedOutputFolder = '';
    records = new Map();
    storedEpochs = new Map();
    storedTargetFacts = new Map();
    externalUses = new Map();
    storedFiles = new Map();
    typedDigests = new Map();
    shapeCache = new Map();
  }

  /**
   * Returns the `import.hx` paths that can apply to `sources`: one in each
   * folder from the folder of a source up to the class path that holds it.
   */
  static function importFilesOf(sources: Array<String>): Array<String> {
    final roots = [
      for (entry in Context.getClassPath())
        PathUtil.normalize(FileSystem.absolutePath(entry.length == 0 ? '.' : entry))
    ];
    final found = new Map<String, Bool>();
    for (source in sources) {
      final absolute = PathUtil.normalize(FileSystem.absolutePath(source));
      var root: Null<String> = null;
      for (candidate in roots)
        if (StringTools.startsWith(absolute, candidate + '/')
          && (root == null || candidate.length > root.length))
          root = candidate;
      if (root == null)
        continue;
      var folder = Path.directory(absolute);
      while (folder.length >= root.length) {
        found.set(Path.join([folder, 'import.hx']), true);
        if (folder == root)
          break;
        folder = Path.directory(folder);
      }
    }
    return sortedKeys(found);
  }

  /**
   * Returns `shape` without the lines of private fields that no other
   * module can see: no module of the stored full request uses the field
   * from another module, and no class of another module extends its class.
   * Such a field can change without a new typing of the modules that import
   * this one; `kept` and the reference checks still guard what it does to
   * this module's own file.
   *
   * Example: changing the type of a private helper of `app.Button` that no
   * other module uses keeps the visible shape. (The edit is still refused,
   * by the signature check of `decide`; the visible shape only decides
   * whether modules that import this one need a new typing.)
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
    final failedMark = retypeFailure;
    if (failedMark != null)
      return refuse('retype-mark-failed', failedMark);
    if (descriptor.generation != ReuseClean || descriptor.afterTyping != Reuse)
      return refuse('needs-reuse',
        'a module request needs "generation": "reuse" and "afterTyping": "reuse"');
    // Printing reads the defines of this moment; the session key holds the
    // ones of the first after-typing callback.
    if (GenerationChangeSet.definesChangedAfterTyping())
      return refuse('defines-changed',
        'a macro changed the defines after typing, so the session key does ' +
        'not describe them');
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
      final externs = externClassesOf(declarations);
      if (externs != null && stored != null
        && IncrementalShadow.previewExternFingerprint(name, externs) == stored)
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
    // An after-typing macro can change the declarations of a module that
    // Haxe did not type again: their metadata, or their extern flag
    // (`exclude()`), with no new stamp. A macro whose callback runs after
    // the passes of Genes is not seen by `GenerationChangeSet.compareMetadata`,
    // and no macro sees an extern flag there. Such a change can change the
    // output of other modules, which this request does not print, so the
    // facts of every module of the request, read now, must be the stored
    // ones (`target-facts-changed`). The requested module is checked after
    // its signature and skeleton, so that an edit of its own declarations
    // keeps its own code.
    for (name in GenerationChangeSet.observedModules()) {
      if (name == module)
        continue;
      final failure = targetFactsFailure(name);
      if (failure != null)
        return refuse('target-facts-changed', failure);
    }
    // The requested module was typed from the file's current content: the
    // content that Haxe typed is proven (`provenDigest`) and equals the file
    // now.
    final ownFile = moduleFiles.get(module);
    final typedContent = targetFile == null ? null : typedDigests.get(targetFile);
    if (targetFile == null
      || typedContent == null
      || typedContent == UNKNOWN_DIGEST
      || digestOf(targetFile) != typedContent)
      return refuse('stale-source',
        'Haxe may have typed $module from other ' +
        'content than its file holds now (a save during the request, or two ' +
        'saves in one second); send the module request again');
    // Every other file of the stored program has the content that the full
    // request typed: Haxe compares file times in whole seconds, so its own
    // check can miss an edit, also of a module that this request loads.
    for (file => digest in storedFiles)
      if (file != ownFile && file != targetFile && digestOf(file) != digest)
        return refuse('source-changed', '$file changed since the full request');
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
    // The strict rule: the module uses exactly what it used in the stored
    // full request (see the class comment). Its signature (every field,
    // private ones included, with types and metadata) and the skeleton of
    // its kept bodies must be the stored ones; only literal values and
    // positions may differ.
    if (signatureOf(shape) != signatureOf(record.shape))
      return refuse('signature-changed',
        'a declaration or field of $module ' +
        'changed: ${firstDifference(signatureOf(record.shape), signatureOf(shape))}');
    if (shape.indexOf('@:ifFeature') >= 0)
      return refuse('if-feature',
        '$module has an @:ifFeature field, which ' +
        'dead-code elimination keeps when another module adds the feature');
    if (facts.references.skeleton != record.skeleton)
      return refuse('uses-changed',
        'the code of $module uses other fields, ' +
        'types or classes than in the full request (an edit beyond literal ' +
        'values)');
    // The module's own declaration facts: its signature holds its metadata,
    // but not the extern flag that a macro can set with `exclude()`.
    final ownFailure = targetFactsFailure(module);
    if (ownFailure != null)
      return refuse('target-facts-changed', ownFailure);
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
      rootMs: GenerationChangeSet.milliseconds(shapeSeconds + rootSeconds),
      digestMs: GenerationChangeSet.milliseconds(digestSeconds)
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
      recordMs: GenerationChangeSet.milliseconds(haxe.Timer.stamp() - started),
      digestMs: GenerationChangeSet.milliseconds(digestSeconds),
      factsMs: GenerationChangeSet.milliseconds(factsSeconds)
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
   * for each `__define_feature__` call), sorted and unique, and the digest
   * of the module's use skeleton (`skeleton`, see `skeletonOf`).
   *
   * Example: `render` of `app.Button` calls `Theme.color()` and its own
   * `label()`: the foreign line `field app.Theme s:color` (the call of
   * `label()` stays inside the module and is not listed). `modules` lists
   * the other modules that `foreign` names (here `app.Theme`).
   */
  public static function referencesOf(module: String,
      types: Array<Type>): ModuleReferences {
    final foreign = new Map<String, Bool>();
    final skeleton = new StringBuf();
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
          final name = TypeUtil.baseTypeFullName(cls);
          function addSkeleton(label: String, body: TypedExpr): Void {
            skeleton.add('$name $label\n');
            skeleton.add(skeletonOf(body));
            skeleton.add('\n');
          }
          function walkField(label: String, field: ClassField): Void {
            final body = field.expr();
            if (body != null) {
              visit(body);
              addSkeleton(label, body);
            }
            for (signature in field.overloads.get()) {
              final other = signature.expr();
              if (other != null) {
                visit(other);
                addSkeleton('$label overload', other);
              }
            }
          }
          for (field in cls.statics.get())
            walkField('s:${field.name}', field);
          for (field in cls.fields.get())
            walkField('i:${field.name}', field);
          final constructor = cls.constructor;
          if (constructor != null)
            walkField('new', constructor.get());
          final init = cls.init;
          if (init != null) {
            visit(init);
            addSkeleton('init', init);
          }
        default:
      }
    return {
      foreign: sortedKeys(foreign),
      skeleton: haxe.crypto.Sha1.make(haxe.io.Bytes.ofString(skeleton.toString()))
        .toHex(),
      modules: sortedKeys(modules)
    };
  }

  /**
   * Returns the use skeleton of one typed body: Haxe's printed code of the
   * body (after its filters), without local variable numbers and with the
   * value of every literal constant replaced by a placeholder of the same
   * kind (`0`, `0.0`, `""`), followed by the declarations that dead-code
   * elimination marks for the types of its nodes and locals (`#marks`). The
   * argument of `__define_feature__` stays, because dead-code elimination
   * reads it.
   *
   * Why: dead-code elimination decides what to keep from the fields,
   * types, classes and features that bodies use, never from the value of a
   * literal. Two bodies with the same skeleton, typed against the same
   * other modules, give dead-code elimination the same input. Example:
   * `return 'Save';` and `return 'Store';` have the same skeleton;
   * `return label() + helper();` and `return label();` do not.
   */
  public static function skeletonOf(body: TypedExpr): String {
    final marks = new Map<String, Bool>();
    // The declarations that dead-code elimination marks for a type
    // (`mark_t` in Haxe's `dce.ml`): after `follow`, a class, an enum or an
    // abstract with their type arguments, the arguments and result of a
    // function type, and the type behind an abstract that is not a core
    // type, and the constraints of a type parameter. Anonymous structures
    // and `Dynamic` mark nothing. A core-type
    // abstract (`Null`, `Int`) is left out: it has no implementation to keep.
    function mark(value: Type, depth: Int): Void {
      if (depth > 8)
        return;
      switch Context.follow(value) {
        case TInst(owner, params):
          final cls = owner.get();
          switch cls.kind {
            // A type parameter marks its constraints, as `mark_t` does.
            case KTypeParameter(constraints):
              for (constraint in constraints)
                mark(constraint, depth + 1);
            default:
              marks.set(TypeUtil.baseTypeFullName(cls), true);
          }
          for (param in params)
            mark(param, depth + 1);
        case TEnum(owner, params):
          marks.set(TypeUtil.baseTypeFullName(owner.get()), true);
          for (param in params)
            mark(param, depth + 1);
        case TFun(args, result):
          for (arg in args)
            mark(arg.t, depth + 1);
          mark(result, depth + 1);
        case TAbstract(owner, params):
          final abs = owner.get();
          for (param in params)
            mark(param, depth + 1);
          if (!abs.meta.has(':coreType')) {
            marks.set(TypeUtil.baseTypeFullName(abs), true);
            mark(abs.type.applyTypeParameters(abs.params, params), depth + 1);
          }
        default:
      }
    }
    function blank(expression: TypedExpr): TypedExpr {
      mark(expression.t, 0);
      switch expression.expr {
        case TVar(variable, _):
          mark(variable.t, 0);
        case TTry(_, catches):
          for (item in catches)
            mark(item.v.t, 0);
        default:
      }
      return switch expression.expr {
        case TConst(TInt(_)):
          {expr: TConst(TInt(0)), t: expression.t, pos: expression.pos};
        case TConst(TFloat(_)):
          {expr: TConst(TFloat('0.0')), t: expression.t, pos: expression.pos};
        case TConst(TString(_)):
          {expr: TConst(TString('')), t: expression.t, pos: expression.pos};
        case TCall({expr: TIdent('__define_feature__')}, _):
          expression;
        default:
          TypedExprTools.map(expression, blank);
      }
    }
    final code = TypedExprTools.toString(blank(body), true);
    final names = [for (name in marks.keys()) name];
    names.sort(compareStrings);
    return VARIABLE_NUMBER.replace(code, '$1()')
      + '\n#marks '
      + names.join(' ');
  }

  /** A local variable with its number in Haxe's typed-tree printout, for example `count(512)`. */
  static final VARIABLE_NUMBER = ~/([A-Za-z_$][A-Za-z0-9_$]*)\(-?[0-9]+\)/g;

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
          buffer.add('class ${TypeUtil.baseTypeFullName(cls)} ${paramsText(cls.params)}');
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
          buffer.add('enum ${TypeUtil.baseTypeFullName(enm)} ${paramsText(enm.params)}');
          buffer.add(shapeMetaText(enm.meta));
          for (name in enm.names) {
            final construct = enm.constructs.get(name);
            if (construct != null)
              buffer.add('\n  constructor $name ${TypeTools.toString(construct.type)}'
                + shapeMetaText(construct.meta));
          }
        case TType(reference, _):
          final def = reference.get();
          buffer.add('typedef ${TypeUtil.baseTypeFullName(def)} ${paramsText(def.params)} '
            + TypeTools.toString(def.type)
            + shapeMetaText(def.meta));
        case TAbstract(reference, _):
          final abs = reference.get();
          buffer.add('abstract ${TypeUtil.baseTypeFullName(abs)} ${paramsText(abs.params)} '
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
  /**
   * Returns type parameters as one text with their constraints, for
   * example `<T:mr.Shapes.Square,U>`: a constraint is a type that dead-code
   * elimination marks, so a changed constraint is a changed signature.
   */
  static function paramsText(params: Array<TypeParameter>): String {
    return '<' + [
      for (param in params)
        switch param.t {
          case TInst(owner, _):
            switch owner.get().kind {
              case KTypeParameter(constraints) if (constraints.length > 0):
                param.name + ':' +
                [for (constraint in constraints) TypeTools.toString(constraint)].join('&');
              default: param.name;
            }
          default:
            param.name;
        }
    ].join(',') + '>';
  }

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
    buffer.add(field.params.length > 0 ? ' params=${paramsText(field.params)}' : '');
    buffer.add(field.meta.has(':generic') ? GENERIC_MARK : '');
    buffer.add(shapeMetaText(field.meta));
    if (field.kind.match(FMethod(MethMacro)))
      buffer.add(MACRO_MARK);
    for (signature in field.overloads.get())
      buffer.add(' overload ${TypeTools.toString(signature.type)}'
        + shapeMetaText(signature.meta));
    // The copied body and its position go on a line of their own
    // (`BODY_MARK`), so that `signatureOf` can leave them out.
    if (copied) {
      final body = field.expr();
      buffer.add('\n$BODY_MARK${field.name} at ${placeText(field.pos)}');
      if (body != null)
        buffer.add(' ${placeText(body.pos)} '
          + StringTools.replace(TypedExprTools.toString(body, true), '\n',
            '\\n'));
    }
  }

  /**
   * Returns the signature of a module from its shape: every declaration and
   * field line, private ones included, without the copied bodies and their
   * positions (`BODY_MARK` lines). Equal signatures mean the same
   * declarations, fields, kinds, types and metadata, so the same roots of
   * dead-code elimination (`@:keep`, `__init__`) and the same field types
   * that it follows.
   */
  static function signatureOf(shape: String): String {
    var current = '';
    final lines = [];
    for (line in shape.split('\n')) {
      if (StringTools.startsWith(line, BODY_MARK))
        continue;
      if (StringTools.startsWith(line, 'class '))
        current = line.split(' ')[1];
      // Haxe adds `@:keep` to the `main` function of the `--main` class; a
      // module request has no `--main`, and roots the function itself.
      if (current == storedMain
        && (StringTools.startsWith(line, '  static main ')
          || StringTools.startsWith(line, '  $PRIVATE_MARK$current s:main ')))
        lines.push(MAIN_KEEP.replace(line, ''));
      else
        lines.push(line);
    }
    return lines.join('\n');
  }

  /** The argument-less `@:keep` that Haxe adds to the `main` function. */
  static final MAIN_KEEP = ~/ @:keep(?= |$)/;

  /**
   * Returns why the declaration facts of `module` in this request
   * (`requestFacts`) are not the stored ones, or `null` when they are.
   */
  static function targetFactsFailure(module: String): Null<String> {
    final stored = storedTargetFacts.get(module);
    if (stored != null && stored == requestFacts.get(module))
      return null;
    return 'an after-typing macro changed the metadata or the extern flag of '
      + 'a declaration of $module since the full request';
  }

  /**
   * Returns one digest of the facts of the declarations `typed` of one
   * module. `afterSave` calls it for every module of the request, with all
   * of its declarations, before dead-code elimination removes any field.
   *
   * Why: a macro can change these facts after the passes of Genes, without
   * a new stamp, and they change what other modules print. Example: an
   * after-typing macro writes `@:ts.type("string")` on `mr.TsTyped`, and
   * `mr/TsUser.ts`, which names it in a typedef field, prints `string`; or
   * it calls `exclude()` on an enum, and every module that names the enum
   * drops its import. Both requests read the facts in `afterSave`: after
   * every after-typing macro and every after-save callback that was
   * registered before the save phase began (see `install`), and before
   * dead-code elimination, which
   * keeps other fields of a class in a smaller program (for example of
   * `Array`), and before a module request adds its roots.
   *
   * What: for each declaration, the text of the facts that the walk of
   * reachability reads (`WalkTarget.inputsText`: kind, extern flag, module,
   * name and metadata), and the metadata text of the declaration, its
   * fields, constructors, type parameters and declared structures that
   * `GenerationChangeSet.compareMetadata` compares
   * (`ModuleFingerprint.addDeclaration`). Both are the shared texts of their
   * owners; this function only joins them, sorted, and takes the digest.
   */
  static function targetFactsOf(typed: Array<Type>): String {
    final texts = [];
    for (type in typed) {
      final declaration = TypeUtil.typeToModuleType(type);
      if (declaration == null)
        continue;
      final buffer = new StringBuf();
      buffer.add(WalkTarget.inputsText(WalkTarget.inputsOf(declaration)));
      buffer.add('\n');
      ModuleFingerprint.addDeclaration(buffer, declaration);
      texts.push(buffer.toString());
    }
    texts.sort(compareStrings);
    return Context.signature(texts.join(''));
  }

  /**
   * Returns the classes of `types` when there is at least one and every one
   * is an extern class, or `null` otherwise.
   * `IncrementalShadow.previewExternFingerprint` reads the classes.
   */
  static function externClassesOf(types: Array<Type>): Null<Array<ClassType>> {
    if (types.length == 0)
      return null;
    final classes = [];
    for (type in types)
      switch type {
        case TInst(reference, _):
          final cls = reference.get();
          if (!cls.isExtern)
            return null;
          classes.push(cls);
        default:
          return null;
      }
    return classes;
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
