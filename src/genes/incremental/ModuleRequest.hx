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

  /**
   * Time spent reading, hashing and reading the status of source files in
   * this request.
   */
  final digestMs: Float;

  /**
   * The files of the stored program that the source check read and hashed,
   * because the status rule could not trust them (`ModuleRequest.holdsContent`),
   * sorted. Example: the module's own file is never here; a file saved a
   * moment before the full request is.
   */
  final hashedSources: Array<String>;

  /** The number of files of the stored program that the status rule trusted without reading them. */
  final trustedSources: Int;
}

/**
 * The file status that Genes keeps with a proven digest (`SourceContent`),
 * as the macro interpreter's `FileSystem.stat` reports it. Times are in
 * milliseconds; on APFS they are finer than 1 ms.
 */
typedef SourceStat = {
  final size: Int;

  /** Time of the last change of the bytes. A tool can set it to any value. */
  final mtime: Float;

  /**
   * Time of the last change of the file (bytes, times, name or rights).
   * Only the system sets it, to its clock at the change.
   */
  final ctime: Float;

  final ino: Int;

  /** `Sys.time()` in milliseconds, read before the first status and the bytes of the digest. */
  final readAt: Float;
}

/**
 * What Genes knows about the content of one source file: its digest, and
 * the file status that was read before and after the bytes of that digest
 * (`ModuleRequest.readSource`). Example: `{digest: "3f2a...", stat: {size:
 * 412, mtime: ..., ctime: ..., ino: 1385596042, readAt: ...}}`. A missing
 * file, an unknown digest, and a read whose two statuses differ have no
 * status.
 */
typedef SourceContent = {
  /** The SHA-1 of the bytes as hexadecimal text, `missing`, or `unknown`. */
  final digest: String;

  final stat: Null<SourceStat>;
}

/**
 * What `ModuleRequest` knows about Haxe's module cache, as stored beside the
 * descriptor (`<descriptor>.typed-sources.json`) so that a new macro state
 * of Genes can read it again (`ModuleRequest.readCacheFacts`). Plain text and
 * numbers only.
 */
typedef CacheFacts = {
  /** The defines key of the request that wrote the facts (`definesKey`). */
  final defines: String;

  /** The process token of the Haxe process that wrote the facts (`claimProcessToken`). */
  final process: String;

  /** `typedDigests`: the content that Haxe last typed for each file. */
  final typed: Array<{file: String, content: SourceContent}>;

  /** `typedAlone`: files that a module request typed alone and could not mark. */
  final typedAlone: Array<String>;

  /** `leftoverRoots`: modules whose roots a failed request left. */
  final leftoverRoots: Array<String>;
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

  /**
   * Time spent reading, hashing and reading the status of source files in
   * this request. A full request reads every file of the program.
   */
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
 * file's digest as "what Haxe typed" only when the digest and the file
 * status (size, modification time, change time and inode) read before
 * typing equal the ones read after typing (`provenSource`). A save that
 * lands while Haxe types makes that file unknown, also a save and a revert
 * in the same second where the change time is finer than a second (APFS,
 * ext4; not HFS+ or ext3, which keep whole seconds): module requests are
 * refused until a full request has made Haxe parse it again, which the next
 * full request does. A file that Genes did not read before typing (a new
 * module, or a library module that the program uses for the first time) is
 * unknown too, so the first module request after it is refused. A deleted
 * file keeps the digest `missing`, so that later full requests do not make
 * Haxe parse it, or the folder of a deleted `import.hx`, again, and a file
 * created again at that path counts as changed.
 *
 * The cache facts (genes-lnrv). `typedDigests`, `typedAlone` and
 * `leftoverRoots` say what Haxe's module cache holds, and Haxe keeps that
 * cache while the server runs. Genes keeps them in `@:persistent` fields,
 * and Haxe sets those back to their first values when it types the macro
 * classes of Genes again: after a request with other defines, when a macro
 * module changes, or after a macro error. An editor's diagnostics request
 * (`--display Main.hx@0@diagnostics`, or the JSON-RPC method
 * `display/diagnostics`) without the descriptor define is such a request:
 * Haxe types the whole program for it and generates nothing. So Genes also
 * stores the three facts beside the descriptor
 * (`<descriptor>.typed-sources.json`, `storeCacheFacts`) whenever they
 * change, and the first request of a new macro state reads them again
 * (`readCacheFacts`) before it compares any file. Example: a full request
 * types `mr/Fresh.hx` with `'one'`; an editor request comes; the file is
 * saved with `'two'` and its modification time kept. The next full request
 * reads the stored digest of `'one'`, sees that the file changed, and makes
 * Haxe parse it again, so it publishes `'two'` at once. Before, it knew no
 * file and published `'one'`. Only a request with the same defines
 * (`definesKey`) in the same Haxe process (`claimProcessToken`, a token in
 * the process environment, which Haxe does not reset) reads the facts. The
 * first such request of a new process knows no file, which is exact,
 * because that process holds no module yet. A later new macro state that
 * finds no facts of its own process (missing, damaged, or written by
 * another process) makes Haxe parse every source file again once, and can
 * be refused once (`GENES-MODULE-REQUEST-003`). Rule: one Haxe process per
 * descriptor path; a cold `haxe` run must not pass the session's descriptor
 * define. Only module records and module requests read or write the facts.
 *
 * Init macros given before `genes.Generator.use()` (genes-v54c). Haxe runs
 * init macros in the order of the arguments, so such a macro runs before
 * `beginRequest`. If it types a project module by name (for example
 * `Context.getType('app.Config')`), Haxe types that module from its cached
 * text, and a save that Haxe's whole-second check missed reaches neither
 * this request nor the proof of `provenSource`. No macro can see what an
 * earlier macro typed, so Genes reads the arguments
 * (`typingMacrosBeforeGenes`): an init macro before `genes.Generator.use()`
 * that is not a call of a few `haxe.macro.Compiler` functions that type
 * nothing (`INIT_ONLY_CALLS`, for example `nullSafety`) can type a module.
 * Such a function can add a `@:build` or `@:using` that loads a module when
 * a type is built, so Genes itself reads the files (`begin`) before it types
 * anything: before `Generator.use()` looks up `genes.Register` and
 * `js.Boot`. When there is a macro that can type and a file differs from
 * what Haxe last read (its digest or its file status, `sameSinceRead`),
 * Genes makes Haxe parse the changed files again, notes their current
 * content, and refuses the request once: a full request stops before typing
 * the program with `GENES-MODULE-REQUEST-003` and publishes nothing; a
 * module request is refused with `init-macro-before-genes`. The same
 * request sent again is correct, because Haxe then holds no other text for
 * those files; if a file changed again in between, that request is refused
 * once more.
 *
 * Haxe also loads modules before any init macro: when it creates its typer,
 * it loads `StdTypes`, `String`, `Array` and `haxe.EnumTools` from its
 * cache together with every module that they depend on. A project module
 * can be among them: for example, a global `@:build` macro that called
 * `Context.getType('app.Config')` while Haxe built a standard type in an
 * earlier request made that type depend on `app.Config`. Haxe then reuses
 * the cached `app.Config` object as a whole; it does not type it again
 * there, because no init macro or build macro has run yet. Its declarations
 * keep their stamps of the earlier request (`GenerationChangeSet`), so after
 * typing, a full request whose changed file has such a kept module
 * (`keptStaleModules`) stops with `GENES-MODULE-REQUEST-003` before it
 * publishes, with no digest noted. Making Haxe parse the file again also
 * marked the cached object as changed, so the request sent again types the
 * module from the file. A module request already refuses such a module: a
 * kept requested module with `stale-source`, any other with
 * `source-changed`. A program with an `@:rtti` class adds no stamps and
 * leaves the incremental path, so this check does not apply there.
 *
 * What a client must do (no shipping client asks for module records yet;
 * the Genes development session in `tooling/` does not): after
 * `GENES-MODULE-REQUEST-003` or `init-macro-before-genes`, send the same
 * request again once, and if it is refused again, report the refusal
 * instead of looping. A second refusal means that a file changed again in
 * between; an init macro or a tool that writes a class-path `.hx` file at
 * every request makes every request refuse. The refusal does not depend on
 * what the macro really does, so a session with such a macro pays one extra
 * request after each change (a refused full request took about 0.3 to 0.55
 * s and the request sent again 0.75 to 1.1 s in a review run on a loaded
 * host). Give `--macro genes.Generator.use()` before every other init macro
 * to avoid the refusal.
 *
 * The status rule of a module request (git's rule for its index): a full
 * request reads every file of the program, but a module request does not
 * read a file again when its status equals the status kept with its proven
 * digest, and the kept modification and change times were older than the
 * moment of that read by more than the grain (`holdsContent`). A status is
 * kept only when the status read before the bytes equals the one read
 * after them (`readSource`). Any other file is read and hashed. Why it
 * holds: the system sets the change time to its clock at every change of
 * the file, and a change during the read would give a change time within
 * the grain of that moment; so an equal status means that nothing changed
 * since the bytes were read. Example: a save that keeps the size and resets
 * the modification time still changes the change time, and a file replaced
 * by another one has another inode. The rule trusts that the system clock
 * is not set back, that file times come from this machine's clock (a local
 * file system), that the file system moves the change time at every change
 * (FAT and exFAT may not), and that nobody restores a file below the file
 * system. On Windows, where the change time is the creation time, Genes
 * reads every file.
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
 * - no init macro that can type a module ran before `genes.Generator.use()`
 *   while the requested module's file differed from what Haxe last read
 *   (`init-macro-before-genes`, see above);
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
 *   changed since the full request (content digest, or the status rule
 *   above; also `import.hx` files, and also files of modules that this
 *   request loads, because Haxe compares file times only in whole seconds),
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
 * that it sets (`defines-changed`). An init macro given before
 * `genes.Generator.use()` that types project modules is covered by the init
 * macro rule above, for full and module requests (genes-v54c). Not covered:
 * metadata that only a typed body holds (limit S3 of `ModuleFingerprint`);
 * a module that Haxe keeps from its cache before Genes reads the files, in a
 * program with an `@:rtti` class (no stamps, see above); a module that
 * Haxe typed in a request whose cache facts Genes did not keep (a full
 * request without module records in the same process before the first
 * request with them); a process that a macro of the server starts, which
 * inherits the process token; the status rule on a file system whose change time does not move at every
 * change (FAT and exFAT may not); a change that a macro
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
   * The proven content (`typedDigests`) of each source file and `import.hx`
   * file of the stored program, as the full request kept it. A module
   * request compares every file with it (`holdsContent`).
   */
  @:persistent static var storedFiles: Map<String, SourceContent> = new Map();

  /**
   * The content of each source file when Haxe last typed its module in a
   * request with the define (`provenSource`), with the file status read
   * with the digest. A file whose content differs at the start of a request
   * may hold content that Haxe's own check missed: Haxe keeps file times in
   * whole seconds, so a second save in the same second looks unchanged.
   * `beginRequest` makes Haxe parse such a file again. A full request reads
   * every file here before typing and keeps the newer status when the digest
   * is the same; a deleted file keeps the digest `missing`. A cache fact:
   * also stored beside the descriptor (`storeCacheFacts`), so that a new
   * macro state reads it again (`readCacheFacts`).
   */
  @:persistent static var typedDigests: Map<String, SourceContent> = new Map();

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

  /**
   * Whether this macro state has read the stored cache facts
   * (`readCacheFacts`). It starts `false` in each new macro state, so the
   * first request of a new state reads them once.
   */
  @:persistent static var cacheFactsRead = false;

  /**
   * Whether `typedDigests`, `typedAlone` or `leftoverRoots` changed since
   * `storeCacheFacts` last wrote them. A request that changes nothing
   * writes nothing.
   */
  @:persistent static var cacheFactsChanged = false;

  /**
   * The file of the stored cache facts of this request
   * (`<descriptor>.typed-sources.json`), set by `beginRequest`; `null` when
   * the request has no descriptor.
   */
  static var cacheFactsFile: Null<String> = null;

  /** The defines key of this request (`definesKey`), set with `cacheFactsFile`. */
  static var cacheFactsKey = '';

  /** The process token of this request (`claimProcessToken`), set with `cacheFactsFile`. */
  static var cacheFactsToken = '';

  /**
   * True when this request runs in a Haxe process that already ran a
   * request with these defines, but the macro state is new and no stored
   * cache facts of this process were found (`beginRequest`): Genes then
   * makes Haxe parse every source file again.
   */
  static var cacheFactsLost = false;

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
  static var requestDigests: Map<String, SourceContent> = new Map();

  /** The content of each file that this request read before typing. */
  static var preDigests: Map<String, SourceContent> = new Map();

  static var digestSeconds = 0.0;

  /** See `ModuleRequestReport.hashedSources` and `trustedSources`. */
  static var hashedSources: Array<String> = [];

  static var trustedSources = 0;
  static var targetFile: Null<String> = null;
  static var retypeFailure: Null<String> = null;
  static var surfaceOwners: Null<Map<String, Bool>> = null;

  /**
   * Why `decide` refuses this module request before any other check: an
   * init macro that can type a module ran before Genes, and the requested
   * module's file changed since Haxe last read it (`beginRequest`,
   * `init-macro-before-genes`). `null` in every other request.
   */
  static var earlyRefusal: Null<String> = null;

  /**
   * The files that `beginRequest` made Haxe parse again in this request
   * (`invalidate`): their content differs from what Haxe last typed, or an
   * earlier module request typed their module alone. A module of one of them
   * that arrives as an object of an earlier request was typed from old text
   * (`keptStaleModules`).
   */
  static var invalidatedFiles: Map<String, Bool> = new Map();

  /**
   * Starts the file check of this request: forgets the facts of the last
   * request and, with the define, reads the source files (`beginRequest`).
   * `Generator.use()` calls it once per request, as its first step that can
   * lead to typing: before it looks up `genes.Register` and `js.Boot`.
   *
   * Why first: a module that Haxe types before `beginRequest` reads its file
   * may be typed from Haxe's cached text (genes-v54c). Example: an init macro
   * `addGlobalMetadata('genes.Register', '@:build(app.Setup.build())')` only
   * records metadata, but when Genes types `genes.Register`, that build
   * macro runs and can type `app.Config` by name.
   */
  public static function begin(): Void {
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
    hashedSources = [];
    trustedSources = 0;
    targetFile = null;
    retypeFailure = null;
    surfaceOwners = null;
    earlyRefusal = null;
    invalidatedFiles = new Map();
    cacheFactsFile = null;
    cacheFactsKey = '';
    cacheFactsToken = '';
    cacheFactsLost = false;
    if (!Context.defined(IncrementalRequest.DEFINE))
      return;
    beginRequest();
  }

  /**
   * Registers the step after Haxe saved the class state and before dead-code
   * elimination. `Generator.use()` calls it once per request, after `begin`;
   * without the define it registers nothing.
   */
  public static function install(): Void {
    if (!Context.defined(IncrementalRequest.DEFINE))
      return;
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
   * In a module request it also notes the content of the requested module's
   * file, which `afterSave` compares with the file after typing. In a full
   * request it keeps the newer file status of each file whose digest did
   * not change, and the digest `missing` for a deleted file, so that the
   * next full request does not make Haxe parse it (or the folder of a
   * deleted `import.hx`) again.
   *
   * The init macro rule (genes-v54c): this step runs inside
   * `Generator.use()`, so an init macro given before it has already run. If
   * such a macro can type a module (`typingMacrosBeforeGenes`), Haxe may
   * have typed a changed file from its cached text, and making Haxe parse
   * the file again now is too late for this request. So when a file
   * differs from what Haxe last read (`sameSinceRead`: digest or file
   * status, also a file that an earlier module request typed alone), Genes
   * still makes Haxe parse those files again, keeps their current content as
   * `typedDigests` (Haxe's caches now hold none of their text, so the next
   * parse reads the file as it is now), and refuses the request: a full
   * request stops here with `GENES-MODULE-REQUEST-003` and publishes
   * nothing; a module request is refused by `decide`
   * (`init-macro-before-genes`). The same request sent again is correct:
   * when the files still equal `typedDigests`, Haxe holds no other text for
   * them, and a file that changed again refuses that request too. Example: `--macro mr.Early.install()` calls
   * `Context.getType('mr.Fresh')` and is given before
   * `--macro genes.Generator.use()`; `mr/Fresh.hx` is saved in the same
   * second as the last request and no `server/invalidate` is sent; the next
   * full request is refused, and the one after it prints the new text.
   */
  static function beginRequest(): Void {
    final descriptor = IncrementalRequest.descriptor();
    if (descriptor == null)
      return;
    // Only module records and module requests use the cache facts.
    if (descriptor.moduleRecords == true || descriptor.kind.match(Module(_))) {
      cacheFactsFile = descriptor.path + CACHE_FACTS_SUFFIX;
      cacheFactsKey = definesKey();
      final fresh = claimProcessToken();
      if (!cacheFactsRead) {
        cacheFactsRead = true;
        // A new process holds no module for these defines, so knowing no
        // file is exact there, and facts of another process are not read.
        cacheFactsLost = !fresh && !readCacheFacts();
      }
    }
    final alone = typedAlone.copy();
    final stale = alone.copy();
    if (alone.length > 0) {
      typedAlone = [];
      cacheFactsChanged = true;
    }
    if (cacheFactsLost) {
      // This process typed modules with these defines before, and Genes
      // lost what it knew about them: make Haxe parse every source file of
      // the class paths again, and store facts of this process.
      for (root in Context.getClassPath())
        scanSources(root.length == 0 ? '.' : root);
      for (file in preDigests.keys())
        stale.push(file);
      cacheFactsChanged = true;
      Context.warning('[GENES-MODULE-REQUEST-004] Genes has no usable record '
        + 'of what this Haxe process typed with these defines '
        + '(${cacheFactsFile ?? ''} is missing, damaged, or was written by '
        + 'another Haxe process). Without it, a file saved without a new '
        + 'modification time could keep its old text in the output, so Genes '
        + 'makes Haxe parse every source file again in this request; the '
        + 'request is slower and can be refused once with '
        + 'GENES-MODULE-REQUEST-003. Use one Haxe process per descriptor '
        + 'path: a cold haxe run must not pass the session\'s '
        + '-D genes.dev_incremental define.',
        Context.currentPos());
    }
    // Files that differ from what Haxe last read, with their content now.
    final changed: Array<{file: String, content: SourceContent}> = [];
    switch descriptor.kind {
      case Module(module):
        final file = try Context.resolvePath(module.split('.').join('/')
          + '.hx') catch (_:haxe.Exception) null;
        if (file != null) {
          targetFile = file;
          final now = readSource(file);
          preDigests.set(file, now);
          final typed = typedDigests.get(file);
          if (typed == null || typed.digest != now.digest)
            stale.push(file);
          if (typed == null || !sameSinceRead(typed, now))
            changed.push({file: file, content: now});
        }
        if (changed.length + alone.length > 0 || cacheFactsLost) {
          final early = typingMacrosBeforeGenes();
          if (early.length > 0) {
            for (item in changed)
              noteTyped(item.file, item.content);
            earlyRefusal = earlyMacroReason(early,
              [for (item in changed) item.file].concat(alone));
          }
        }
      case Full:
        // A full request that knows no file yet (the first of the session,
        // or of a macro state that found no stored cache facts): read every
        // Haxe source of the class paths before typing, so that
        // `provenSource` can prove what Haxe typed.
        if (descriptor.moduleRecords == true && !typedDigests.keys().hasNext())
          for (root in Context.getClassPath())
            scanSources(root.length == 0 ? '.' : root);
        if (descriptor.moduleRecords == true) {
          final started = haxe.Timer.stamp();
          final newer: Array<{file: String, content: SourceContent}> = [];
          for (file => typed in typedDigests) {
            final now = readSource(file);
            preDigests.set(file, now);
            if (!sameSinceRead(typed, now))
              changed.push({file: file, content: now});
            if (now.digest == typed.digest) {
              newer.push({file: file, content: now});
              continue;
            }
            if (now.digest == MISSING_DIGEST)
              newer.push({file: file, content: now});
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
          final differs = changed.length + alone.length > 0 || cacheFactsLost;
          final early = differs ? typingMacrosBeforeGenes() : [];
          if (early.length > 0) {
            for (item in changed)
              noteTyped(item.file, item.content);
            invalidate(stale);
            storeCacheFacts();
            final reason = earlyMacroReason(early,
              [for (item in changed) item.file].concat(alone));
            writeRecordsReport(descriptor, false, reason, 0, 0, started);
            Context.fatalError(reason, Context.currentPos());
          }
          for (item in newer)
            noteTyped(item.file, item.content);
        }
    }
    invalidate(stale);
    storeCacheFacts();
  }

  /**
   * Makes Haxe parse each of `files` again before it types them
   * (`CompilationServer.invalidateFiles`), and notes them in
   * `invalidatedFiles`.
   */
  static function invalidate(files: Array<String>): Void {
    for (file in files)
      invalidatedFiles.set(file, true);
    if (files.length > 0)
      haxe.macro.CompilationServer.invalidateFiles([
        for (file in files)
          FileSystem.absolutePath(file)
      ]);
  }

  /**
   * Returns true when `now` is the same file version as `typed`, the content
   * that Genes noted as what Haxe last read: the same digest and, for a file
   * that exists, the same file status (`sameStatus`: size, modification
   * time, change time and inode). A file without a kept status is never the
   * same. The change time moves at every change, so an equal status means
   * that the file did not change since that read, also not with a save and
   * a revert. Example: a save that keeps the size and the modification
   * time still moves the change time, so it is not the same.
   */
  static function sameSinceRead(typed: SourceContent,
      now: SourceContent): Bool {
    if (typed.digest != now.digest)
      return false;
    if (now.digest == MISSING_DIGEST)
      return true;
    final typedStat = typed.stat;
    final nowStat = now.stat;
    return typedStat != null && nowStat != null
      && sameStatus(typedStat, nowStat);
  }

  /** The suffix of the stored cache facts, after the descriptor path. */
  static inline final CACHE_FACTS_SUFFIX = '.typed-sources.json';

  /** The format of the stored cache facts (`encodeCacheFacts`). */
  static inline final CACHE_FACTS_FORMAT = 1;

  /**
   * Notes `content` as what Haxe holds for `file` (`typedDigests`), and marks
   * the cache facts as changed when its digest or file status differs from
   * the noted content. A newer `readAt` alone is kept in memory and not
   * stored: the stored copy then has an older read moment, which only makes
   * the status rule (`holdsContent`) read a file more often after a new
   * macro state, and a request without a change writes nothing.
   */
  static function noteTyped(file: String, content: SourceContent): Void {
    final known = typedDigests.get(file);
    typedDigests.set(file, content);
    if (known == null || !sameContent(known, content))
      cacheFactsChanged = true;
  }

  /** Returns true when two contents have the same digest and the same status, or both no status. */
  static function sameContent(left: SourceContent, right: SourceContent): Bool {
    final leftStat = left.stat;
    final rightStat = right.stat;
    if (left.digest != right.digest)
      return false;
    if (leftStat == null || rightStat == null)
      return leftStat == null && rightStat == null;
    return sameStatus(leftStat, rightStat);
  }

  /**
   * Returns the SHA-1 of the sorted `name=value` lines of every define at the
   * start of this request. The stored cache facts are read only by a request
   * with the same key.
   *
   * Why: Haxe keeps one module cache for each set of defines. Facts that a
   * request wrote with other defines describe another cache. Example: an
   * editor request without the descriptor define, or a session that changes
   * a define and keeps its descriptor path.
   */
  static function definesKey(): String {
    final lines = [for (name => value in Context.getDefines()) '$name=$value'];
    lines.sort(compareStrings);
    return haxe.crypto.Sha1.encode(lines.join('\n'));
  }

  /**
   * Reads the stored cache facts (`<descriptor>.typed-sources.json`) into
   * `typedDigests`, `typedAlone` and `leftoverRoots`. `beginRequest` calls it
   * once in each macro state, before it compares any file.
   *
   * Why: these three facts say what Haxe's module cache holds, and Haxe keeps
   * that cache as long as the server runs. Genes keeps them in `@:persistent`
   * fields, which Haxe sets back to their first values when it types the
   * macro classes of Genes again: after a request with other defines (an
   * editor's `--display ...@diagnostics` or `display/diagnostics` request
   * without the descriptor define), when a macro module changes, or after a
   * macro error. Haxe then still holds the modules of earlier requests.
   * Without these facts, the first full request of the new macro state did
   * not know that `mr/Fresh.hx` had changed since Haxe parsed it (a save
   * that kept the modification time), did not make Haxe parse it again, and
   * published the old text (genes-lnrv).
   *
   * Returns true when it used facts: the file exists and decodes, and it
   * has this request's defines key and this process's token
   * (`claimProcessToken`). Otherwise it reads nothing and returns false;
   * `beginRequest` then makes Haxe parse every source file again
   * (`cacheFactsLost`), because this process may hold old text. Rule: one
   * Haxe process per descriptor path. A cold `haxe` run with the session's
   * descriptor define writes facts with its own token; the server then
   * parses every file again once after its next new macro state, and can
   * refuse that request once (`GENES-MODULE-REQUEST-003`).
   */
  static function readCacheFacts(): Bool {
    final file = cacheFactsFile;
    if (file == null || !FileSystem.exists(file))
      return false;
    final text = try File.getContent(file) catch (_:haxe.Exception) null;
    final facts = text == null ? null : decodeCacheFacts(text);
    if (facts == null || facts.defines != cacheFactsKey
      || facts.process != cacheFactsToken)
      return false;
    for (entry in facts.typed)
      if (!typedDigests.exists(entry.file))
        typedDigests.set(entry.file, entry.content);
    for (item in facts.typedAlone)
      if (typedAlone.indexOf(item) < 0)
        typedAlone = typedAlone.concat([item]);
    for (item in facts.leftoverRoots)
      if (leftoverRoots.indexOf(item) < 0)
        leftoverRoots = leftoverRoots.concat([item]);
    return true;
  }

  /** The start of the environment variable that holds the process token (`claimProcessToken`). */
  static inline final PROCESS_TOKEN_VARIABLE = 'GENES_TYPED_SOURCES_';

  /**
   * Sets `cacheFactsToken` to the token of this Haxe process for the defines
   * key of this request, and returns true when this process had none yet:
   * it never ran such a request with these defines, so Haxe holds no module
   * for them and knowing no file is exact.
   *
   * Why the process environment: Haxe resets every `@:persistent` field when
   * it types the macro classes of Genes again, but it keeps its module cache
   * and its environment while the server runs, and a new process starts
   * without the variable. So the token names one Haxe process, also across
   * new macro states. Example: `GENES_TYPED_SOURCES_<key>=<token>`. Facts
   * that another process wrote (a cold `haxe` run, or a second server, with
   * the same descriptor define) have another token, and `readCacheFacts`
   * does not use them. Limit: a process that a macro of the server starts
   * inherits the variable.
   */
  static function claimProcessToken(): Bool {
    final name = PROCESS_TOKEN_VARIABLE + cacheFactsKey;
    final known = Sys.getEnv(name);
    if (known != null && known.length > 0) {
      cacheFactsToken = known;
      return false;
    }
    final token = haxe.crypto.Sha1.encode(Std.string(Sys.time())
      + ':'
      + Std.string(Std.random(0x3FFFFFFF))
      + ':'
      + Std.string(Std.random(0x3FFFFFFF)))
      .substr(0, 16);
    Sys.putEnv(name, token);
    cacheFactsToken = token;
    return true;
  }

  /**
   * Writes `typedDigests`, `typedAlone` and `leftoverRoots` to the stored
   * cache facts when they changed since the last write (`readCacheFacts`
   * explains why). Called at the end of each step that changes them, also
   * before a refusal stops the request.
   *
   * It writes a temporary file beside the facts and renames it, so a
   * reader sees the old or the new file, never a part. If the file cannot
   * be written, Genes warns and deletes the older file, so that a new macro
   * state cannot read facts that are no longer true (it then parses every
   * file again once). It tries again at the next step.
   */
  static function storeCacheFacts(): Void {
    final file = cacheFactsFile;
    if (file == null || !cacheFactsChanged)
      return;
    // A whole new file, then a rename: a reader never sees part of a file.
    final temporary = '$file.$cacheFactsToken.tmp';
    try {
      File.saveContent(temporary, encodeCacheFacts());
      FileSystem.rename(temporary, file);
      cacheFactsChanged = false;
    } catch (error:haxe.Exception) {
      try
        FileSystem.deleteFile(temporary)
      catch (_:haxe.Exception) {}
      try
        FileSystem.deleteFile(file)
      catch (_:haxe.Exception) {}
      Context.warning('[GENES-MODULE-REQUEST-004] Genes cannot write its '
        + 'record of what Haxe typed ($file: ${error.message}). After Haxe '
        + 'types the macro classes of Genes again, Genes makes Haxe parse '
        + 'every source file again once.',
        Context.currentPos());
    }
  }

  /**
   * Returns the cache facts as JSON text: the format, the defines key, the
   * process token (`claimProcessToken`), one
   * entry per file of `typedDigests` (`[file, digest]`, or `[file, digest,
   * size, mtime, ctime, ino, readAt]` when a status is kept; sorted by
   * file), `typedAlone` and `leftoverRoots`. Times are milliseconds, and
   * Haxe's JSON keeps them exactly.
   */
  static function encodeCacheFacts(): String {
    final files = [for (file in typedDigests.keys()) file];
    files.sort(compareStrings);
    final typed: Array<Array<haxe.extern.EitherType<String, Float>>> = [];
    for (file in files) {
      final content = typedDigests.get(file);
      if (content == null)
        continue;
      final stat = content.stat;
      typed.push(stat == null ? [file, content.digest] : [file, content.digest, stat.size, stat.mtime, stat.ctime, stat.ino, stat.readAt]);
    }
    return Json.stringify({
      format: CACHE_FACTS_FORMAT,
      defines: cacheFactsKey,
      process: cacheFactsToken,
      typed: typed,
      typedAlone: typedAlone,
      leftoverRoots: leftoverRoots
    }) + '\n';
  }

  /**
   * Decodes the text of `encodeCacheFacts`, or returns `null` when any part
   * of it is not as `encodeCacheFacts` writes it.
   *
   * BOUNDARY_DYNAMIC: `haxe.Json.parse` returns an untyped value, and the
   * standard library has no typed JSON decoder. This function checks the
   * runtime type of every value before use and returns only typed values.
   * One bad entry rejects the whole file, because a missing file entry would
   * read as a file that Haxe does not hold.
   */
  static function decodeCacheFacts(text: String): Null<CacheFacts> {
    final parsed: Dynamic = try Json.parse(text) catch (_:haxe.Exception) null;
    if (parsed == null)
      return null;
    final format: Dynamic = Reflect.field(parsed, 'format');
    final defines: Dynamic = Reflect.field(parsed, 'defines');
    final process: Dynamic = Reflect.field(parsed, 'process');
    final entries: Dynamic = Reflect.field(parsed, 'typed');
    final alone = stringsOf(Reflect.field(parsed, 'typedAlone'));
    final roots = stringsOf(Reflect.field(parsed, 'leftoverRoots'));
    if (!Std.isOfType(format, Int)
      || (format : Int) != CACHE_FACTS_FORMAT
        || !Std.isOfType(defines, String) || !Std.isOfType(process, String)
        || !Std.isOfType(entries, Array) || alone == null || roots == null)
      return null;
    final typed: Array<{file: String, content: SourceContent}> = [];
    for (entry in (entries : Array<Dynamic>)) {
      if (!Std.isOfType(entry, Array))
        return null;
      final parts: Array<Dynamic> = entry;
      if (parts.length != 2 && parts.length != 7)
        return null;
      final file: Dynamic = parts[0];
      final digest: Dynamic = parts[1];
      if (!Std.isOfType(file, String) || !Std.isOfType(digest, String))
        return null;
      var stat: Null<SourceStat> = null;
      if (parts.length == 7) {
        final size: Dynamic = parts[2];
        final mtime: Dynamic = parts[3];
        final ctime: Dynamic = parts[4];
        final ino: Dynamic = parts[5];
        final readAt: Dynamic = parts[6];
        if (!Std.isOfType(size, Int) || !Std.isOfType(mtime, Float)
          || !Std.isOfType(ctime, Float) || !Std.isOfType(ino, Int)
          || !Std.isOfType(readAt, Float))
          return null;
        stat = {
          size: (size : Int),
          mtime: (mtime : Float),
          ctime: (ctime : Float),
          ino: (ino : Int),
          readAt: (readAt : Float)
        };
      }
      typed.push({
        file: (file : String),
        content: {digest: (digest : String), stat: stat}
      });
    }
    return {
      defines: (defines : String),
      process: (process : String),
      typed: typed,
      typedAlone: alone,
      leftoverRoots: roots
    };
  }

  /**
   * Returns `value` as an array of strings, or `null` when it is not one.
   * BOUNDARY_DYNAMIC: see `decodeCacheFacts`.
   */
  static function stringsOf(value: Dynamic): Null<Array<String>> {
    if (!Std.isOfType(value, Array))
      return null;
    final items: Array<String> = [];
    for (item in (value : Array<Dynamic>)) {
      if (!Std.isOfType(item, String))
        return null;
      items.push((item : String));
    }
    return items;
  }

  /** The init macro call of Genes itself (`--macro genes.Generator.use()`). */
  static inline final GENES_USE_CALL = 'genes.Generator.use';

  /**
   * The functions that an init macro may call before
   * `genes.Generator.use()` without making Haxe type a module while init
   * macros run. Each one only records a define, metadata, a class path or a
   * package rule, or registers its typing with `Context.onAfterInitMacros`
   * (`include`, `setModuleCheckPolicy`), which runs after Genes read the
   * files (read in the standard library of Haxe 4.3.7). Haxe accepts only
   * constant`), so an argument cannot run code. Example: the Genes haxelib
   * gives `nullSafety("genes", Loose, true)` before `genes.Generator.use()`.
   *
   * Metadata can still load a module later: `addGlobalMetadata` or
   * `addMetadata` can add `@:build(...)`, `@:autoBuild(...)`,
   * `@:genericBuild(...)` or `@:using(...)`, which run or resolve when Haxe
   * builds the type that carries it. That is safe because nothing builds a
   * type before `beginRequest` reads the files: Haxe types the program after
   * the init macros, and `Generator.use()` calls `begin` before it types its
   * own helpers (`genes.Register`, `js.Boot`). Example:
   * `addGlobalMetadata('genes.Register', '@:using(mr.Fresh)')` loads
   * `mr.Fresh` only after Genes made Haxe parse a changed `mr/Fresh.hx`
   * again.
   */
  static final INIT_ONLY_CALLS = [
    'haxe.macro.Compiler.addClassPath',
    'haxe.macro.Compiler.addGlobalMetadata',
    'haxe.macro.Compiler.addMetadata',
    'haxe.macro.Compiler.allowPackage',
    'haxe.macro.Compiler.define',
    'haxe.macro.Compiler.include',
    'haxe.macro.Compiler.keep',
    'haxe.macro.Compiler.nullSafety',
    'haxe.macro.CompilationServer.setModuleCheckPolicy'
  ];

  /**
   * Returns the init macros (the text after `--macro`) that run before the
   * first `genes.Generator.use()` of this request and can make Haxe type a
   * module: every one that does not call a function of `INIT_ONLY_CALLS`.
   * Example: for `--macro mr.Early.install() --macro genes.Generator.use()`
   * it returns `["mr.Early.install()"]`; for the init macros of the Genes
   * haxelib it returns `[]`.
   *
   * Why: Haxe runs init macros in the order of the arguments, before it types
   * the program. A macro that runs before Genes can make Haxe type a project
   * module from its cached text before `beginRequest` reads the module's
   * file, and no macro can see what an earlier macro typed (genes-v54c).
   * The arguments are `Compiler.getConfiguration().args`, with HXML files and
   * `-lib` arguments already expanded. A macro whose call Genes cannot read
   * counts as one that can type, and so does every macro when no
   * `genes.Generator.use()` is among the arguments (another macro then
   * called it). So does a macro whose text has conditional compilation
   * (`#`): Haxe parsed it with the defines of its own moment, and Genes would
   * parse it with the defines of a later moment, which an init macro between
   * them can change (`initMacroCall`).
   */
  static function typingMacrosBeforeGenes(): Array<String> {
    final configuration = haxe.macro.Compiler.getConfiguration();
    if (configuration == null)
      return ['(the compiler arguments are not known)'];
    final args = configuration.args;
    final found = [];
    var index = 0;
    while (index + 1 < args.length) {
      if (args[index] != '--macro') {
        index++;
        continue;
      }
      final text = args[index + 1];
      index += 2;
      final call = initMacroCall(text);
      if (call == GENES_USE_CALL)
        return found;
      if (call == null || INIT_ONLY_CALLS.indexOf(call) < 0)
        found.push(text);
    }
    return found;
  }

  /**
   * Returns the full path of the function that the init macro `text` calls,
   * as Haxe resolves it: `nullSafety(...)` calls
   * `haxe.macro.Compiler.nullSafety`, `server.setModuleCheckPolicy(...)`
   * calls `haxe.macro.CompilationServer.setModuleCheckPolicy`, and
   * `genes.Generator.use()` calls `genes.Generator.use`. Returns `null` when
   * the text is not a call of a dotted path, and when it holds a `#`: Genes
   * parses with the defines of its own moment, so the conditional
   * compilation of `#if x define("a") #else mr.Typer.run() #end` could read
   * otherwise than Haxe read it when `x` was set by an init macro between.
   */
  static function initMacroCall(text: String): Null<String> {
    if (text.indexOf('#') >= 0)
      return null;
    final pos = Context.currentPos();
    final parsed = try Context.parse(text, pos) catch (_:haxe.Exception) null;
    final callee = parsed == null ? null : switch parsed.expr {
      case ECall(callee, _): callee;
      default: null;
    }
    final path = callee == null ? null : dottedPath(callee);
    if (path == null)
      return null;
    if (path.length == 1)
      return 'haxe.macro.Compiler.${path[0]}';
    if (path.length == 2 && path[0] == 'server')
      return 'haxe.macro.CompilationServer.${path[1]}';
    return path.join('.');
  }

  /** Returns the names of a dotted path expression (`a.b.c`), or `null` for any other expression. */
  static function dottedPath(expr: haxe.macro.Expr): Null<Array<String>> {
    return switch expr.expr {
      case EConst(CIdent(name)): [name];
      case EField(owner, name):
        final head = dottedPath(owner);
        head == null ? null : head.concat([name]);
      default: null;
    }
  }

  /**
   * What a client must do after a `GENES-MODULE-REQUEST-003` refusal: send
   * the request again once, and report a second refusal instead of looping.
   */
  static inline final RESEND_ONCE = 'Genes made Haxe read them again: send '
    + 'the request again, once. If the request sent again is refused too, a '
    + 'file changed again in between (for example a tool or an init macro '
    + 'that writes a source file at every request): report this refusal '
    + 'instead of sending the request again.';

  /** The reason of a request that the init macro rule of `beginRequest` refuses. */
  static function earlyMacroReason(macros: Array<String>,
      files: Array<String>): String {
    final named = [for (text in macros.slice(0, 3)) '`$text`'].join(', ');
    return '[GENES-MODULE-REQUEST-003] An init macro given before '
      + '`--macro genes.Generator.use()` ($named) can make Haxe type a module '
      + 'before Genes reads its file, and '
      + (cacheFactsLost ? 'Genes has no record of what Haxe last read '
        +
        '(GENES-MODULE-REQUEST-004). ' : 'these files changed since Haxe last '
        + 'read them: ${listOf(files)}. ')
      + 'Haxe may have typed their old text, so '
      + 'Genes published nothing. $RESEND_ONCE Give '
      + '`--macro genes.Generator.use()` before such init macros to avoid '
      + 'this extra request.';
  }

  /**
   * Returns the modules of this request whose file `beginRequest` made Haxe
   * parse again (`invalidatedFiles`) but that have a declaration that Haxe
   * kept from an earlier request (`GenerationChangeSet.keptModules`), so
   * Haxe typed them from old text. Example: `["mr.Fresh"]` when Haxe loaded
   * `mr.Fresh` from its cache as a dependency of `String` before
   * `mr/Fresh.hx`, saved with its modification time kept, was parsed again.
   */
  static function keptStaleModules(): Array<String> {
    return [
      for (module in GenerationChangeSet.keptModules())
        if (invalidatedFiles.exists(moduleFiles.get(module) ?? '')) module
    ];
  }

  /** The reason of a full request that stops because of `keptStaleModules`. */
  static function keptStaleReason(modules: Array<String>): String {
    final files = [for (module in modules) moduleFiles.get(module) ?? module];
    final why = cacheFactsLost ? 'although Genes has no record of the text '
      + 'that Haxe read for these files then (GENES-MODULE-REQUEST-004): '
      +
      '${listOf(files)}. Genes made Haxe parse every source file again, but ' : 'although these files changed since Haxe last read them: '
      + '${listOf(files)}. Haxe\'s whole-second file-time check missed the '
      + 'save, and ';
    return '[GENES-MODULE-REQUEST-003] Haxe used its typing of '
      + '${listOf(modules)} from an earlier request, $why'
      + 'Haxe loaded the modules before Genes could make it read the files '
      + 'again (for example as dependencies of the standard types, which Haxe '
      + 'loads before any init macro). Genes published nothing. $RESEND_ONCE';
  }

  /** Returns up to five items of `items`, joined with commas, and `...` when there are more. */
  static function listOf(items: Array<String>): String {
    return items.slice(0, 5).join(', ') + (items.length > 5 ? ', ...' : '');
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
          preDigests.set(path, readSource(path));
      } else if (!StringTools.startsWith(entry, '.')
        && (try FileSystem.isDirectory(path) catch (_:haxe.Exception) false))
        scanSources(path);
    }
  }

  /** The digest that `typedDigests` keeps for content that is not proven to be what Haxe typed. */
  static inline final UNKNOWN_DIGEST = 'unknown';

  /** The digest of a file that does not exist (or cannot be read). */
  static inline final MISSING_DIGEST = 'missing';

  /**
   * The timestamp grain in milliseconds: the coarsest step of file times
   * on a common file system (FAT keeps modification times in 2 s steps,
   * HFS+ in 1 s). A time that is older than a moment by more than the grain
   * was set before that moment on every such file system.
   */
  static inline final TIME_GRAIN_MS = 2000.0;

  /**
   * Returns the content of `file` if it is proven to be the content that
   * Haxe typed in this request, or the content `UNKNOWN_DIGEST`.
   *
   * Proof: `beginRequest` read the file before typing, and the digest and
   * the file status (`sameStatus`) read then equal the ones read now, so the
   * file did not change while Haxe read it. The change time also catches a
   * save and a revert in the same second, which leave the digest equal,
   * where the file system keeps change times finer than a second. A file
   * whose content or status changed during the request (a save landed while
   * Haxe typed), or whose status was not kept (`readSource`), is unknown: a
   * module request refuses an unknown file, and the next full request makes
   * Haxe parse it again. A file that `beginRequest` did not read (a new
   * module, or a library module that the program uses for the first time)
   * is unknown too: Haxe may have parsed it outside the reads of Genes. A
   * file that is missing before and after stays `missing`.
   */
  static function provenSource(file: String): SourceContent {
    final after = readSource(file);
    final before = preDigests.get(file);
    if (after.digest == MISSING_DIGEST) {
      final missingBefore = before == null || before.digest == MISSING_DIGEST;
      return missingBefore ? after : unknownSource();
    }
    if (before == null || before.digest != after.digest)
      return unknownSource();
    final beforeStat = before.stat;
    final afterStat = after.stat;
    return beforeStat != null && afterStat != null
      && sameStatus(beforeStat, afterStat) ? after : unknownSource();
  }

  /** The content that `provenSource` gives when it cannot prove what Haxe typed. */
  static function unknownSource(): SourceContent {
    return {digest: UNKNOWN_DIGEST, stat: null};
  }

  /**
   * Reads `file` and returns its SHA-1 digest, or `missing`. The macro
   * interpreter computes SHA-1 natively. The time counts into `digestMs`.
   *
   * The file status is read before and after the bytes, as git reads it
   * before the bytes, and is kept only when both reads are equal. Why: a
   * save between the bytes and a single status read would give the old
   * digest with the new status, and the status rule would then trust the
   * old digest for the new file. With two equal reads, no change that moves
   * the change time happened while the bytes were read. A missing file, or
   * two different reads, give no status, so the file is never trusted by
   * its status (`holdsContent`) or proven by it (`provenSource`).
   */
  static function readSource(file: String): SourceContent {
    final started = haxe.Timer.stamp();
    final readAt = Sys.time() * 1000;
    final first = statusOf(file, readAt);
    final digest = try {
      haxe.crypto.Sha1.make(File.getBytes(file)).toHex();
    } catch (_:haxe.Exception) {
      MISSING_DIGEST;
    }
    final second = digest == MISSING_DIGEST ? null : statusOf(file, readAt);
    final stat = first != null && second != null
      && sameStatus(first, second) ? second : null;
    digestSeconds += haxe.Timer.stamp() - started;
    return {digest: digest, stat: stat};
  }

  /** Returns the status of `file` with the moment `readAt`, or `null` when it cannot be read. */
  static function statusOf(file: String, readAt: Float): Null<SourceStat> {
    return try {
      final stat = FileSystem.stat(file);
      {
        size: stat.size,
        mtime: stat.mtime.getTime(),
        ctime: stat.ctime.getTime(),
        ino: stat.ino,
        readAt: readAt
      };
    } catch (_:haxe.Exception) {
      null;
    }
  }

  /**
   * Returns true when two statuses describe the same file version: equal
   * size, modification time, change time and inode. `readAt` is not
   * compared.
   */
  static function sameStatus(left: SourceStat, right: SourceStat): Bool {
    return left.size == right.size
      && left.mtime == right.mtime
      && left.ctime == right.ctime
      && left.ino == right.ino;
  }

  /**
   * Returns true when the modification and change times of `stat` are
   * older than `moment` by more than the grain (`TIME_GRAIN_MS`).
   */
  static function olderThanGrain(stat: SourceStat, moment: Float): Bool {
    return stat.mtime < moment - TIME_GRAIN_MS
      && stat.ctime < moment - TIME_GRAIN_MS;
  }

  /**
   * Returns false on Windows, where the change time of a file is its
   * creation time and does not change when the file is saved: the status
   * rule then never trusts a file status.
   */
  static function statusRuleApplies(): Bool {
    return Sys.systemName() != 'Windows';
  }

  /**
   * Returns true when `file` now holds the content `stored` of the full
   * request (the source check of `decide`).
   *
   * The status rule (git's rule for its index): when the status kept with
   * the digest is settled (its times were older than its read by more than
   * the grain) and equals the status now, the file did not change since its
   * bytes were read, and it is not read again (`trustedSources`). Why: the
   * system sets the change time to its clock at every change; a change
   * after the read gives a change time after the read; and a change during
   * the read gives a change time within the grain of the read, which the
   * settled status does not have. A kept status exists only when the reads
   * before and after the bytes were equal (`readSource`). Any other file is
   * read and hashed (`hashedSources`). A file whose status cannot be read is
   * missing.
   * Example: a save that keeps the size and sets the modification time back
   * changes the change time; a file replaced by another has another inode;
   * a file saved a moment before the full request read it is not settled.
   */
  static function holdsContent(file: String, stored: SourceContent): Bool {
    final started = haxe.Timer.stamp();
    final now = statusOf(file, Sys.time() * 1000);
    digestSeconds += haxe.Timer.stamp() - started;
    if (now == null)
      return stored.digest == MISSING_DIGEST;
    final kept = stored.stat;
    if (kept != null
      && statusRuleApplies()
      && olderThanGrain(kept, kept.readAt)
      && sameStatus(kept, now)) {
      trustedSources++;
      return true;
    }
    hashedSources.push(file);
    return readSource(file).digest == stored.digest;
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
    afterSaveSteps(types);
    storeCacheFacts();
  }

  /** The steps of `afterSave`, which then stores the cache facts that they changed. */
  static function afterSaveSteps(types: Array<Type>): Void {
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
    // Haxe can load a module from its cache before `beginRequest` made it
    // parse the module's changed file again (genes-v54c): with the standard
    // types, which it loads with every dependency before any init macro, or
    // in an init macro given before Genes. Such a module arrives as an object
    // of an earlier request. A full request stops here, before it publishes
    // or notes any digest. A module request refuses such a target with
    // `stale-source` and such another module with `source-changed`.
    if (descriptor.kind.match(Full) && descriptor.moduleRecords == true) {
      final kept = keptStaleModules();
      if (kept.length > 0) {
        final reason = keptStaleReason(kept);
        storeCacheFacts();
        writeRecordsReport(descriptor, false, reason, 0, 0, started);
        Context.fatalError(reason, Context.currentPos());
      }
    }
    // Haxe typed these modules in this request; keep a digest only when it
    // is proven to be the content that Haxe read (`provenSource`).
    for (module in GenerationChangeSet.retypedModules()) {
      final file = moduleFiles.get(module);
      if (file != null)
        noteTyped(file, provenSource(file));
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
            // Haxe kept this module from a request whose content Genes did
            // not note (a request without module records in this process
            // before the first one with them): unknown, so that the next
            // full request makes Haxe parse it again.
            if (typed == null)
              noteTyped(file, unknownSource());
            requestDigests.set(file, typed == null ? unknownSource() : typed);
          }
        for (file in importFilesOf([for (_ => file in moduleFiles) file]))
          if (!requestDigests.exists(file)) {
            final typed = provenSource(file);
            noteTyped(file, typed);
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
        if (file != null) {
          typedAlone = typedAlone.concat([file]);
          cacheFactsChanged = true;
        }
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
    cacheFactsChanged = true;
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
    if (leftoverRoots.length > 0) {
      leftoverRoots = [];
      cacheFactsChanged = true;
      storeCacheFacts();
    }
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
    if (leftoverRoots.length != pending.length)
      cacheFactsChanged = true;
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

  /**
   * Forgets every record of the last full request. It keeps the cache facts
   * (`typedDigests`, `typedAlone`, `leftoverRoots`): they say what Haxe's
   * cache holds, which does not depend on the records, and an empty
   * `typedDigests` would read as a cache that holds no module.
   */
  public static function drop(): Void {
    storedKey = null;
    storedOutputFolder = '';
    records = new Map();
    storedEpochs = new Map();
    storedTargetFacts = new Map();
    externalUses = new Map();
    storedFiles = new Map();
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
    // An init macro given before `genes.Generator.use()` can have typed the
    // requested module from Haxe's cached text (`beginRequest`).
    final early = earlyRefusal;
    if (early != null)
      return refuse('init-macro-before-genes', early);
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
    // content that Haxe typed is proven (`provenSource`) and equals the file
    // now (read again: the edited file is never trusted by its status).
    final ownFile = moduleFiles.get(module);
    final typedContent = targetFile == null ? null : typedDigests.get(targetFile);
    if (targetFile == null
      || typedContent == null
      || typedContent.digest == UNKNOWN_DIGEST
      || readSource(targetFile).digest != typedContent.digest)
      return refuse('stale-source',
        'Haxe may have typed $module from other ' +
        'content than its file holds now (a save during the request, or two ' +
        'saves in one second); send the module request again');
    // Every other file of the stored program has the content that the full
    // request typed: Haxe compares file times in whole seconds, so its own
    // check can miss an edit, also of a module that this request loads. A
    // file whose settled status did not change is not read (`holdsContent`).
    for (file => stored in storedFiles)
      if (file != ownFile && file != targetFile && !holdsContent(file, stored))
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
    final hashed = hashedSources.copy();
    hashed.sort(compareStrings);
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
      digestMs: GenerationChangeSet.milliseconds(digestSeconds),
      hashedSources: hashed,
      trustedSources: trustedSources
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
