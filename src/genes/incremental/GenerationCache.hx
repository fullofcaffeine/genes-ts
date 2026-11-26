package genes.incremental;

#if macro
/** One output file of one module, with the exact text that was staged. */
typedef CachedFile = {
  final path: String;
  final text: String;
}

/**
 * One warning that Genes reported while it printed a module: the text, and
 * the source position as plain data (`Context.getPosInfos`).
 *
 * Why: a warning that the printer reports is output of the request, like
 * the files. Example: "__js__ is deprecated" comes from `ExprEmitter`, not
 * from Haxe's typing. A request that does not print a clean module must
 * still report it; `Context.makePosition` turns the three values back into
 * a position.
 */
typedef CachedWarning = {
  final message: String;
  final file: String;
  final min: Int;
  final max: Int;
}

/**
 * One public entry that the second validation loop added for a module: an
 * exported module function of the root module. The position is plain data,
 * like `CachedWarning`.
 *
 * Why: a replayed module skips that loop, but the root module still needs
 * the entry in its export list, in the same order as in a full generation.
 */
typedef CachedPublicEntry = {
  final name: String;
  final file: String;
  final min: Int;
  final max: Int;
}

/**
 * The epochs and the fingerprint of one module of the generator's list that
 * got no output file, for example a module of typedefs that nothing reached.
 * Rule 6 reads it (item 6 of the review of #243): a change of such a module
 * without new typing must make the request fall back too.
 */
typedef CachedInventoryModule = {
  final epochs: String;
  final fingerprint: String;
}

/**
 * The steps of one visit of the reachability walk to a module, keyed by the
 * module's member list when the visit started (Stage 3, slice S2).
 *
 * Why: the walk can visit a module more than once, when another module adds
 * a declaration to it; each member list gives other steps. A later request
 * that walks a clean module with stored edges looks up the visit with the
 * member list of that moment, and leaves the stored walk when there is none.
 *
 * Example: `inc.Den` with the member list of `Den` alone has the steps
 * of `Den`; after a late `DenNote` it has also the step to
 * `class:inc.DenDeep.DenDeep`.
 */
typedef CachedVisit = {
  /** `IncrementalShadow.memberState` of the module when the visit started. */
  final members: String;

  /** The steps of the visit, in edge order, each declaration key once. */
  final steps: Array<genes.WalkStep>;

  /**
   * For each step, the stamp of its declaration in the recording request
   * (`GenerationChangeSet.stampOf`; empty when it had none).
   */
  final stamps: Array<String>;

  /**
   * For each step, the text of the target facts of its declaration in the
   * recording request (`WalkTarget.inputsText`). The live walk reads a
   * target only through `WalkTarget.inputsOf`, so this text holds every
   * fact that the walk reads before it takes the step: the kind, the extern
   * flag, the module and the name. It also holds the metadata, which the
   * plan of the visiting module reads. An after-typing macro can change
   * some of these facts without a new stamp:
   *
   * - `@:ts.type("string")` on a class removes the edge of every module
   *   that names the class only in a type position;
   * - `exclude()` on an enum makes it extern, and the live walk takes no
   *   step to an extern declaration.
   *
   * The walk with stored edges leaves the recorded path when the text
   * differs (`IncrementalShadow.checkStoredTarget`).
   */
  final targets: Array<String>;
}

/** One module that a module read by name during generation, with its epochs then. */
typedef CachedWitness = {
  final module: String;
  final epochs: String;
}

/**
 * The stored result of one emitted module. Plain data only: no `Type`,
 * `TypedExpr`, `Ref`, `Position`, `Module`, plan or emitter.
 */
typedef CachedModule = {
  /** `GenerationChangeSet.epochs` of the module when it was emitted. */
  final epochs: String;

  /** `ModuleFingerprint` text of the module when it was emitted. */
  final fingerprint: String;

  /** Modules that this module's planning or emission read by name. */
  final witnesses: Array<CachedWitness>;

  /**
   * True when emission handed an expression to Haxe's own printer. That
   * printer can add feature flags that Genes does not see, so such a module
   * is never clean.
   */
  final usedHaxePrinter: Bool;

  /** The staged files, sorted by path. */
  final files: Array<CachedFile>;

  /** The warnings that the printer reported for the module, in report order. */
  final warnings: Array<CachedWarning>;

  /**
   * The same-object proofs of the module's declarations when the output was
   * printed (`GenerationChangeSet.declarationProofs`), or `null` when a
   * declaration had none. A module is clean only when this request proves
   * the same text.
   */
  final proofs: Null<String>;

  /**
   * The final member list of the module after the walk of reachability, in
   * order (`ModuleFingerprint.members`). It holds the declarations that the
   * walk added because another module refers to them.
   */
  final members: String;

  /** Whether the module was an implementation root, exposed, and emitted (`IncrementalShadow.rootFlags`). */
  final rootFlags: String;

  /**
   * The global questions that planning and emission of the module asked,
   * with their answers: sorted, unique `answerLine` texts. The kinds:
   *
   * - `feature`: a Haxe feature flag (`api.hasFeature`);
   * - `module`: a module-function owner was in the module map
   *   (`Module.resolveModuleFunction`);
   * - `cycle`: the named module reaches this one through runtime imports
   *   (`Module.isCyclic`; review of #244, M1);
   * - `anonTs` and `anonSource`: a `SignatureCache` fact keyed by the source
   *   position of an anonymous-structure field. The capture of another
   *   module's declaration can write it (review of #244, M2);
   * - `bodyParams` and `bodyType`: the metadata text of a holder that only
   *   a typed body of the module declares or names, keyed by its class and
   *   variable id (`SignatureCache.localTypeParameters`,
   *   `localDeclaredType`; genes-f8vc.9.27). A macro can change it without
   *   a new typing and without a change of any fingerprint;
   * - `refreshSplit`: the component names of the named module when
   *   `-D genes.react_refresh_modules` splits it, or `-`
   *   (`Module.reactRefreshSplitOf`). An importer of a split module imports
   *   its other bindings from `X.fields`.
   */
  final answers: Array<String>;

  /** The features that emission of the module added (`api.addFeature`), sorted. */
  final additions: Array<String>;

  /** The public entries of the module, in the order of the second validation loop. */
  final publicEntries: Array<CachedPublicEntry>;

  /**
   * The absolute paths of the sources that the module's source maps name by
   * a relative path, sorted. Item 4 of the review of #243 reads them.
   */
  final mapSources: Array<String>;

  /**
   * The visits of the reachability walk to the module (slice S2), in the
   * order of the recording request, each member list once.
   */
  final visits: Array<CachedVisit>;

  /**
   * The internal runtime requests of the module's printed plan
   * (`Module.internalRuntimeRequests`), or `null` when none were recorded.
   * A request with stored edges answers import-cycle questions about the
   * clean module from them (slice S2).
   */
  final runtimeRequests: Null<Array<String>>;
}

/** What the clean rules decide for one request, before generation starts. */
enum CacheDecision {
  /** No usable cache: every module is dirty. */
  NoCache(reason: String);

  /**
   * Only a new compiler process gives cold output (review R1: a warm server
   * can hold state that a fallback to full generation cannot repair). The
   * session then starts a new server.
   *
   * No rule gives this result yet. The first candidate was "the names that
   * Haxe's local-rename filter reserves changed". The fixture edit "new
   * top-level package with the name of a local in another module" showed no
   * byte difference between warm and cold output (G0), because the cold
   * build did not rename the local either; so, as the review asked, the rule
   * was dropped. The report still says when that name set changed
   * (`reservedNamesChanged`), so a real project can show otherwise.
   */
  RestartRequired(reason: String);

  /**
   * Rule 6 (or a changed read without an asker) failed: the request generates
   * in full in the first replay version.
   */
  Fallback(reason: String);

  /** The modules that rules 1 to 7 call clean, and why each other stored module is dirty. */
  Rules(clean: Map<String, Bool>, dirty: Map<String, String>);
}

/** The current facts that the clean rules compare with the stored ones. */
typedef CacheRequestFacts = {
  final sessionKey: String;
  final reservedNameDigest: String;
  final rootModule: String;
  final fingerprint: String->String;
  final epochs: String->String;

  /** True when the module has a declaration in this request's generator list. */
  final present: String->Bool;

  /** `GenerationChangeSet.declarationProofs` of this request. */
  final proofs: String->Null<String>;

  /** `GenerationChangeSet.sameObjectFailures` of this request. */
  final sameObjectFailures: Array<String>;

  /** The absolute, normalized output folder of this request. */
  final outputFolder: String;

  /**
   * True for `generation: "compare"` and `"reuse"`: such a request uses only
   * a cache that a request with `afterTyping: "reuse"` wrote (item 7 of the
   * review of #243).
   */
  final needsReuseCache: Bool;
}

/**
 * Keeps the plain-data result of the last successful generation between
 * requests of one compiler server, and decides which modules are clean
 * (interface I6 of the Stage 3 review).
 *
 * Why: a warm server keeps typed modules, but Genes planned and printed every
 * module again on each request. Before any work is skipped, the shadow slice
 * must show that a module the rules call clean has the same bytes as a new
 * generation.
 *
 * Clean rules, all must hold:
 *
 * 1. the session key equals the stored key (the one key of
 *    `GenerationChangeSet`, which the passes after typing also read; it
 *    holds a digest of the name and content of each embedded resource,
 *    because `haxe.Resource` prints them and no stamp shows their change);
 * 2. the module has an entry from the last successful generation;
 * 3. its epoch list is not empty and is equal (Haxe did not type it again,
 *    and no declaration was added or removed). An empty list means that the
 *    after-typing callback saw no declaration of the module, so no stamp
 *    says that Haxe kept it: such a module is never clean, also when the
 *    stored list is empty too (G2 design review, required change 2);
 * 4. its fingerprint is equal;
 * 5. it is not the root module, and its last emission did not use Haxe's own
 *    printer;
 * 6. no stored module that was not typed again has a changed fingerprint;
 *    otherwise the whole request falls back;
 * 7. the epoch list of each module that it read by name is not empty and is
 *    equal. A read module without a stamp counts as changed.
 * 8. every declaration of the module has a same-object proof in this
 *    request, and the proofs equal the stored ones
 *    (`GenerationChangeSet.declarationProofs`). A failed same-object test
 *    anywhere makes the whole request fall back: a macro gave a new object
 *    the stamp of an old one, and other modules may read that object.
 * 9. no source that its stored maps name by a relative path lies inside a
 *    folder where the stored and the current output paths part
 *    (`partingFolders`);
 * 10. its stored answers name no feature that emission can add
 *    (`EMISSION_FEATURES`).
 * 11. its stored answers hold no `UNKNOWN_ANSWER`: a question that the
 *    request that recorded it could not answer in a form that a later
 *    request can ask again (genes-f8vc.9.27).
 *
 * Rule 6 reads every stored module of the generator's list, also one that
 * got no output file (`CachedInventoryModule`). It decides "left the
 * program" from this request (item 3 of the review of #243): a module with
 * no stamp that is absent from the generator list left the program and is
 * only dirty; a module with no stamp that is present with a changed
 * fingerprint makes the request fall back, because nothing shows that Haxe
 * did not type it again.
 *
 * Item 7 of the review of #243: `generation: "compare"` and `"reuse"` use
 * only a cache that a request with `afterTyping: "reuse"` wrote. A cache of
 * a `generation: "measure"` request with `afterTyping: "measure"` holds bytes
 * of the path in which the passes after typing read every kept class again,
 * which the replay never takes.
 *
 * Print warnings: an entry also holds the warnings that the printer
 * reported for the module (`CachedWarning`). Rule for the version that
 * replays stored files: when it does not print a clean module, it reports
 * the stored warnings of that module, at the place in the module order where
 * it would have printed the module. Then a warm request gives the warnings
 * of a cold build. The shadow already compares the stored warnings of each
 * clean module with the ones of the new print.
 *
 * Lifetime: one `@:persistent` value for one session key. `commit` replaces it
 * only after `OutputTransaction.commit` returned, so a failed request leaves
 * the cache of the last successful generation, whose epochs still mark every
 * change since then. A different key drops it. Above `BYTE_BUDGET` it is not
 * stored. Without `-D genes.dev_incremental` it is never read or written.
 */
class GenerationCache {
  /** The entry format. A new field or meaning needs a new number. */
  public static inline final FORMAT = 7;

  /**
   * The features that emission can add while Genes prints modules, so that
   * the answer for one of them depends on the place of a module in the
   * emission order.
   *
   * Where they come from: Genes' own emitters add `use.$iterator` and
   * `use.$getIterator` (`ExprEmitter`). Haxe 4.3.7's printer, which Genes
   * reaches through `api.generateStatement` and `api.generateValue`, adds
   * the others in `genjs.ml` (`gen_expr`). No other feature changes during
   * generation: the rest come from typing and dead-code elimination, which
   * end before the generator starts.
   *
   * Why it matters: the answers of a replayed module are checked before the
   * first module is printed. For any other feature, the answer then is the
   * answer at every later moment of the request. For these features a dirty
   * module printed earlier can change the answer, so a module that asked for
   * one is never clean.
   */
  public static final EMISSION_FEATURES = [
    "use.$iterator",
    "use.$getIterator",
    "use.$keyValueIterator",
    "use.$getKeyValueIterator",
    "use.$arrayPush",
    "use.$bind",
    "thisForCallWithRestArgs"
  ];

  /**
   * The answer of a recorded question that no later request can ask again,
   * because the recording request kept nothing to ask it with. Rule 11 makes
   * the module that recorded it dirty, so it is printed in each request; the
   * other modules are not affected. `SignatureCache.localTypeParameters`
   * records it for a local function without a kept holder.
   *
   * Why not a fallback of the whole request: `planReplay` compares each
   * answer with the answer now, and no answer now equals this one, so one
   * such module would make every request of the program generate in full
   * (review of genes-ts #258).
   */
  public static inline final UNKNOWN_ANSWER = '!';

  /** Largest cache that is stored, counted in string characters (64 MB). */
  public static inline final BYTE_BUDGET = 64 * 1024 * 1024;

  @:persistent static var storedKey: Null<String> = null;
  @:persistent static var storedReservedNames: Null<String> = null;
  @:persistent static var storedGlobalWitnesses: Array<CachedWitness> = [];
  @:persistent static var storedGlobalAnswers: Array<String> = [];
  @:persistent static var entries: Map<String, CachedModule> = new Map();
  @:persistent static var inventory: Map<String,
    CachedInventoryModule> = new Map();
  @:persistent static var storedOutputFolder = '';
  @:persistent static var storedUnderReuse = false;
  @:persistent static var storedBytes = 0;
  @:persistent static var storedAnswerBytes = 0;

  /** Returns the stored entry of one module, or `null`. */
  public static function entry(module: String): Null<CachedModule> {
    RequestMeasure.recordRead();
    return storedKey == null ? null : entries.get(module);
  }

  /**
   * Returns the stored fingerprint of one module, also of a module without
   * an output file (`CachedInventoryModule`), or `null`. A module request
   * (`ModuleRequest`) reads it for a module of extern classes that a macro
   * defined again, such as a `genes.ts.imports` holder.
   */
  public static function storedFingerprint(module: String): Null<String> {
    if (storedKey == null)
      return null;
    final stored = entries.get(module);
    if (stored != null)
      return stored.fingerprint;
    final other = inventory.get(module);
    return other == null ? null : other.fingerprint;
  }

  /**
   * Returns the answers that were asked outside any module's clock in the
   * stored generation (`answerLine` texts). The checks before emission
   * compare each one with the answer now, like `storedGlobalWitnesses`.
   */
  public static function globalAnswers(): Array<String> {
    return storedKey == null ? [] : storedGlobalAnswers;
  }

  /** Returns the stored module names, sorted. */
  public static function storedModules(): Array<String> {
    if (storedKey == null)
      return [];
    final names = [for (name in entries.keys()) name];
    names.sort(compareStrings);
    return names;
  }

  /**
   * Returns the part of `bytes()` that the stored answers use (module and
   * request answers). They hold source paths, so they can be a large share.
   */
  public static function answerBytes(): Int {
    return storedKey == null ? 0 : storedAnswerBytes;
  }

  /** Returns the size of the stored cache in string characters. */
  public static function bytes(): Int {
    return storedKey == null ? 0 : storedBytes;
  }

  /**
   * Returns true when a cache exists and the names that Haxe's local-rename
   * filter reserves differ from the stored ones. Reported only; see
   * `RestartRequired`.
   */
  public static function reservedNamesChanged(digest: String): Bool {
    return storedKey != null && storedReservedNames != digest;
  }

  /** Applies the clean rules to the stored cache. Changes nothing. */
  public static function decide(facts: CacheRequestFacts): CacheDecision {
    final key = storedKey;
    if (key == null)
      return NoCache('no generation cache yet');
    if (key != facts.sessionKey)
      return NoCache('the session key changed');
    if (facts.needsReuseCache && !storedUnderReuse)
      return NoCache('the cache was written by a request with afterTyping '
        + '"measure" or "compare"; compare and reuse use only a cache written '
        + 'with afterTyping "reuse"');
    final failures = facts.sameObjectFailures;
    if (failures.length > 0)
      return Fallback('a declaration carries a stamp that names it, but it is '
        + 'not the object of its kept bucket (a macro copied the stamp): '
        + failures.slice(0, 5).join(', '));
    for (witness in storedGlobalWitnesses)
      if (!sameStampedEpochs(facts.epochs(witness.module), witness.epochs))
        return Fallback('a module read by name outside any module changed '
          + 'or has no declaration stamp: ${witness.module}');
    final parting = partingFolders(storedOutputFolder, facts.outputFolder);
    final clean = new Map<String, Bool>();
    final dirty = new Map<String, String>();
    final changedFingerprints = [];
    final rule6 = [for (name in inventory.keys()) name];
    for (name in entries.keys())
      if (!inventory.exists(name))
        rule6.push(name);
    rule6.sort(compareStrings);
    for (module in rule6) {
      final stored = entries.get(module);
      final storedInventory = inventory.get(module);
      final storedFingerprint = stored != null ? stored.fingerprint : storedInventory.fingerprint;
      final storedEpochs = stored != null ? stored.epochs : storedInventory.epochs;
      final epochs = facts.epochs(module);
      final unstamped = epochs.length == 0;
      final sameEpochs = !unstamped && epochs == storedEpochs;
      final sameFingerprint = facts.fingerprint(module) == storedFingerprint;
      // Rule 6 needs to know that Haxe did not type the module again. Equal
      // stamped epochs say so. A module without a stamp gives no such answer:
      // when it is still in this request's generator list, a changed
      // fingerprint falls back; when it is absent, it left the program and is
      // only dirty (item 3 of the review of #243).
      if (!sameFingerprint
        && (sameEpochs || (unstamped && facts.present(module))))
        changedFingerprints.push(module);
      if (stored == null)
        continue;
      final reason = if (module == facts.rootModule) 'root module' else
        if (unstamped
        && !facts.present(module)) 'left the program' else if (unstamped)
          'no declaration stamp' else if (!sameEpochs) 'typed again' else
          if (!sameFingerprint) 'fingerprint changed' else
            if (stored.usedHaxePrinter) 'used Haxe\'s printer' else
              cleanBeyondEpochs(module, stored, facts, parting);
      if (reason == null)
        clean.set(module, true);
      else
        dirty.set(module, reason);
    }
    if (changedFingerprints.length > 0)
      return Fallback('the fingerprint of a module that was not typed again '
        + 'changed: ${changedFingerprints.join(', ')}');
    return Rules(clean, dirty);
  }

  /**
   * Applies rules 7 to 11 to one module whose epochs and fingerprint are
   * equal. Returns why the module is dirty, or `null` when it is clean.
   */
  static function cleanBeyondEpochs(module: String, stored: CachedModule,
      facts: CacheRequestFacts, parting: Null<Array<String>>): Null<String> {
    final witness = changedWitness(stored, facts);
    if (witness != null)
      return witness;
    final proofs = facts.proofs(module);
    if (proofs == null || stored.proofs == null)
      return 'a declaration has no same-object proof';
    if (proofs != stored.proofs)
      return
        'a declaration object differs from the one that printed the stored output';
    if (parting != null)
      for (source in stored.mapSources)
        for (folder in parting)
          if (isInside(source, folder))
            return 'a source of its source maps is inside the folder where '
              + 'the output paths part: $source';
    for (answer in stored.answers)
      switch parseAnswer(answer) {
        case {kind: 'feature', name: name}
          if (EMISSION_FEATURES.indexOf(name) >= 0):
          return 'asked for the feature $name, which emission can add';
        case {kind: kind, name: name, answer: value}
          if (value == UNKNOWN_ANSWER):
          return 'recorded the question $kind $name, which no later request '
            + 'can ask again';
        default:
      }
    return null;
  }

  /**
   * Returns the two folders where `stored` and `current`, two absolute
   * output folders, part: the first folder of each path below their common
   * folder. Returns `null` when the paths are equal.
   *
   * Example: `/p/cand/rev-3/output` and `/p/cand/rev-4/output` give
   * `/p/cand/rev-3` and `/p/cand/rev-4`. A source map names a source inside
   * one of these folders by a relative path that starts with the folder
   * name, so the stored bytes of such a map differ from a new print (item 4
   * of the review of #243). Every other source gets the same relative path
   * from both folders, because the session key holds equal output-root
   * lines.
   */
  public static function partingFolders(stored: String,
      current: String): Null<Array<String>> {
    if (stored == current)
      return null;
    final left = stored.split('/');
    final right = current.split('/');
    var index = 0;
    while (index < left.length && index < right.length
      && left[index] == right[index])
      index++;
    final folders = [];
    if (index < left.length)
      folders.push(left.slice(0, index + 1).join('/'));
    if (index < right.length)
      folders.push(right.slice(0, index + 1).join('/'));
    return folders;
  }

  /** Returns true when the absolute path `path` is `folder` or lies below it. */
  static function isInside(path: String, folder: String): Bool {
    return folder.length > 0
      && (path == folder
        || StringTools.startsWith(path,
          StringTools.endsWith(folder, '/') ? folder : folder + '/'));
  }

  /**
   * Returns one answer line: the kind, the question and the answer, joined
   * by the character U+0001, which no module name, source path or type text
   * holds. Example: `answerLine('feature', 'js.Lib.global', '1')`.
   */
  public static function answerLine(kind: String, question: String,
      answer: String): String {
    return '$kind\x01$question\x01$answer';
  }

  /** Returns the text of a yes-or-no answer: `1` or `0`. */
  public static function flag(answer: Bool): String {
    return answer ? '1' : '0';
  }

  /** Splits one `answerLine` text into its kind, question and answer. */
  public static function parseAnswer(line: String): {kind: String, name: String, answer: String} {
    final parts = line.split('\x01');
    return {
      kind: parts[0],
      name: parts.length > 1 ? parts[1] : '',
      answer: parts.length > 2 ? parts.slice(2).join('\x01') : ''
    };
  }

  /** Returns a stored answer line in a form for a report or a diagnostic. */
  public static function answerText(line: String): String {
    final answer = parseAnswer(line);
    return '${answer.kind} ${answer.name} = ${answer.answer}';
  }

  /**
   * Replaces the stored cache with the result of a successful generation.
   * Returns false, and drops the cache, when the result is above
   * `BYTE_BUDGET`.
   *
   * `outputFolder` is the absolute output folder of the request, and
   * `underReuse` is true when the request had `afterTyping: "reuse"`.
   * `inventoryModules` holds the modules of the generator's list that got no
   * output file.
   */
  public static function commit(sessionKey: String,
      reservedNameDigest: String, globalWitnesses: Array<CachedWitness>,
      modules: Map<String, CachedModule>,
      ?inventoryModules: Map<String, CachedInventoryModule>,
      outputFolder = '', underReuse = false,
      ?globalAnswers: Array<String>): Bool {
    final others = inventoryModules == null ? new Map() : inventoryModules;
    final asked = globalAnswers == null ? [] : globalAnswers;
    var size = sessionKey.length + reservedNameDigest.length;
    var answerSize = 0;
    for (answer in asked)
      answerSize += answer.length;
    for (witness in globalWitnesses)
      size += witness.module.length + witness.epochs.length;
    for (name => module in others)
      size += name.length + module.epochs.length + module.fingerprint.length;
    for (name => module in modules) {
      final counted = sizeOf(name, module);
      size += counted.size;
      answerSize += counted.answers;
    }
    size += answerSize;
    if (size > BYTE_BUDGET) {
      drop();
      return false;
    }
    storedKey = sessionKey;
    storedReservedNames = reservedNameDigest;
    storedGlobalWitnesses = globalWitnesses;
    storedGlobalAnswers = asked;
    entries = modules;
    inventory = others;
    RequestMeasure.recordsWritten(Lambda.count(modules));
    storedOutputFolder = outputFolder;
    storedUnderReuse = underReuse;
    storedBytes = size;
    storedAnswerBytes = answerSize;
    return true;
  }

  /**
   * Returns the size of one entry in string characters for `BYTE_BUDGET`:
   * `answers` counts the answer lines (`answerBytes`), `size` every other
   * part.
   */
  static function sizeOf(name: String,
      module: CachedModule): {size: Int, answers: Int} {
    var size = name.length + module.epochs.length + module.fingerprint.length;
    var answers = 0;
    size += module.members.length + module.rootFlags.length;
    size += module.proofs == null ? 0 : module.proofs.length;
    for (witness in module.witnesses)
      size += witness.module.length + witness.epochs.length;
    for (file in module.files)
      size += file.path.length + file.text.length;
    for (warning in module.warnings)
      size += warning.message.length
        + warning.file.length
        + Std.string(warning.min).length
        + Std.string(warning.max).length;
    for (answer in module.answers)
      answers += answer.length;
    for (feature in module.additions)
      size += feature.length;
    for (entry in module.publicEntries)
      size += entry.name.length
        + entry.file.length
        + Std.string(entry.min).length
        + Std.string(entry.max).length;
    for (source in module.mapSources)
      size += source.length;
    for (visit in module.visits) {
      size += visit.members.length;
      for (step in visit.steps)
        size += step.key.length
          + step.module.length
          + step.name.length
          + step.typeName.length;
      for (stamp in visit.stamps)
        size += stamp.length;
      for (target in visit.targets)
        size += target.length;
    }
    if (module.runtimeRequests != null)
      for (request in module.runtimeRequests)
        size += request.length;
    return {size: size, answers: answers};
  }

  /**
   * Replaces the stored entry of `module` with `entry`, the entry that an
   * accepted module request made for the module that it printed
   * (genes-f8vc.14.8, `ModuleRequest.previewCommitted`). The rest of the
   * cache stays as the last full request stored it. Returns false and
   * changes nothing when no cache is stored, the module has no entry, or the
   * cache would grow above `BYTE_BUDGET`; the caller then forgets its module
   * records, so that no module request reads the old entry as current.
   *
   * Why: a later module request reads the entry of a module (its answers,
   * visits, member list and runtime requests) as the facts of the program
   * now. After a preview of `app.Card` the stored entry describes the old
   * text of `app.Card`; with it, the next module request would compare with
   * records that no longer match the sources.
   *
   * The next full request stays the authority: Haxe types the module again
   * there (its epochs then differ from `entry.epochs`, so the module is
   * dirty and printed again), and `commit` replaces the whole cache.
   */
  public static function advance(module: String, entry: CachedModule): Bool {
    final stored = entries.get(module);
    if (storedKey == null || stored == null)
      return false;
    final before = sizeOf(module, stored);
    final after = sizeOf(module, entry);
    final size = storedBytes
      - before.size
      - before.answers
      + after.size
      + after.answers;
    if (size > BYTE_BUDGET)
      return false;
    entries.set(module, entry);
    RequestMeasure.recordsWritten();
    storedBytes = size;
    storedAnswerBytes = storedAnswerBytes - before.answers + after.answers;
    return true;
  }

  /**
   * Returns the stored entry of `module` as plain text for
   * `ModuleRequest.recordsText` (genes-f8vc.14.8), or an empty text when it
   * has none. Facts that name one typing of a module, not its sources, are
   * left out, so that a preview and a full request of the same sources give
   * the same text: the stamps of the epochs, of the proofs and of the
   * visits, and the `bodyParams` and `bodyType` answers, which are keyed by
   * variable ids (`answerLinesText`). The file texts appear as SHA-1
   * digests.
   *
   * The witnesses are left out too: a module records a module that it reads
   * by name only when it reads that name first in the request
   * (`TypedModuleInventory`), so they follow the order of the modules that
   * the request printed, not the sources. Example: a full request records
   * no witness for `mr.Card` when another module read `mr.Theme` before it;
   * a preview of `mr.Card` records `mr.Theme`. Only the clean rules of a
   * full request read them (rule 7), and a module that a preview advanced is
   * typed again in the next full request, so it is never clean there.
   *
   * The second name of each visit step (`WalkStep.typeName`) is left out
   * for the same reason (review of genes-ts #268). The walk stores it only
   * when it read it, and it reads it only when the step's target module
   * already exists without a member of the plain name; whether that module
   * exists then depends on which module's step made it first. Example: a
   * module that names `haxe.ds.List`, which dead-code elimination removes,
   * stores `List` when another module's step made `haxe.ds.List` before,
   * and an empty text otherwise. An empty text only makes a walk with
   * stored edges read the name from the declaration.
   */
  public static function entryText(module: String): String {
    final stored = entry(module);
    if (stored == null)
      return '';
    final buffer = new StringBuf();
    buffer.add('  epochs ${stampFree(stored.epochs)}\n');
    buffer.add('  fingerprint ${haxe.crypto.Sha1.encode(stored.fingerprint)}\n');
    buffer.add('  printer ${flag(stored.usedHaxePrinter)}\n');
    for (file in stored.files)
      buffer.add('  file ${file.path} ${haxe.crypto.Sha1.encode(file.text)}\n');
    for (warning in stored.warnings)
      buffer.add('  warning ${warning.file}:${warning.min}-${warning.max} ${warning.message}\n');
    final proofs = stored.proofs;
    buffer.add('  proofs ${proofs == null ? '-' : stampFree(proofs)}\n');
    buffer.add('  members ${stored.members.split('\n').join(' | ')}\n');
    buffer.add('  root-flags ${stored.rootFlags}\n');
    for (line in answerLinesText(stored.answers))
      buffer.add('  answer $line\n');
    for (feature in stored.additions)
      buffer.add('  addition $feature\n');
    for (item in stored.publicEntries)
      buffer.add('  public-entry ${item.name} ${item.file}:${item.min}-${item.max}\n');
    for (source in stored.mapSources)
      buffer.add('  map-source $source\n');
    for (visit in stored.visits) {
      buffer.add('  visit ${visit.members.split('\n').join(' | ')}\n');
      for (index => step in visit.steps)
        buffer.add('    step ${step.key} ${step.module} ${step.name} '
          + '${visit.targets == null ? '' : visit.targets[index]}\n');
    }
    final requests = stored.runtimeRequests;
    buffer.add('  runtime-requests ${requests == null ? '-' : requests.join(' ')}\n');
    return buffer.toString();
  }

  /**
   * Returns the parts of the stored cache that belong to no module entry as
   * plain text for `ModuleRequest.recordsText`: whether it was written under
   * `afterTyping: "reuse"`, the global answers and witnesses, and each
   * module without an output file (`CachedInventoryModule`). As
   * `entryText`, it leaves out the stamps; the output folder and the
   * session key are left out too, because they name the request, not the
   * sources.
   */
  public static function cacheText(): String {
    if (storedKey == null)
      return 'cache none\n';
    final buffer = new StringBuf();
    buffer.add('cache reuse=${flag(storedUnderReuse)}\n');
    for (line in answerLinesText(storedGlobalAnswers))
      buffer.add('global-answer $line\n');
    buffer.add('global-witnesses ${[for (witness in storedGlobalWitnesses) witness.module].join(' ')}\n');
    final names = [for (name in inventory.keys()) name];
    names.sort(compareStrings);
    for (name in names) {
      final other = inventory.get(name);
      if (other != null)
        buffer.add('inventory $name ${stampFree(other.epochs)} '
          + '${haxe.crypto.Sha1.encode(other.fingerprint)}\n');
    }
    return buffer.toString();
  }

  /**
   * Returns the lines of an epoch list or a proof text without the part
   * after the last `@` of each line (the stamp, or the request that proved
   * the object), joined with spaces. Example: `class:app.Leaf@ab12:3`
   * gives `class:app.Leaf`.
   */
  public static function stampFree(text: String): String {
    if (text.length == 0)
      return '';
    return [
      for (line in text.split('\n'))
        line.lastIndexOf('@') < 0 ? line : line.substr(0, line.lastIndexOf('@'))
    ].join(' ');
  }

  /**
   * Returns answer lines as `answerText`, sorted, without the `bodyParams`
   * and `bodyType` answers. Their key is `<owner>#<variable id>`, and Haxe
   * gives each local variable a new id each time it types a module, from a
   * counter of that compilation; so the key names one typing, and so does
   * the presence of an answer. Example: a preview of `mr.Panel` recorded a
   * `bodyType` answer of a `genes.Register` holder, because a local of the
   * new typing of `mr.Panel` got the id of a local that `genes.Register` got
   * in an earlier compilation; the full request after it did not.
   * `SignatureCache.localDeclaredType` prints the variable's own type, so
   * such an answer changes no output. A module request does not compare
   * these answers (`ModuleRequest.wrongAnswer`), and only a replay of a
   * module that Haxe did not type again reads them.
   */
  static function answerLinesText(lines: Array<String>): Array<String> {
    final texts = [];
    for (line in lines) {
      final answer = parseAnswer(line);
      if (answer.kind == genes.ts.SignatureCache.BODY_PARAMS
        || answer.kind == genes.ts.SignatureCache.BODY_TYPE)
        continue;
      texts.push('${answer.kind} ${answer.name} = ${answer.answer}');
    }
    texts.sort(compareStrings);
    return texts;
  }

  /** Forgets the stored cache. */
  public static function drop(): Void {
    storedKey = null;
    storedReservedNames = null;
    storedGlobalWitnesses = [];
    storedGlobalAnswers = [];
    entries = new Map();
    inventory = new Map();
    storedOutputFolder = '';
    storedUnderReuse = false;
    storedBytes = 0;
    storedAnswerBytes = 0;
  }

  static function changedWitness(stored: CachedModule,
      facts: CacheRequestFacts): Null<String> {
    for (witness in stored.witnesses)
      if (!sameStampedEpochs(facts.epochs(witness.module), witness.epochs))
        return 'read ${witness.module} by name, and it changed or has no '
          + 'declaration stamp';
    return null;
  }

  /**
   * Returns true only when `current`, the epoch list of a module in this
   * request, is not empty and equals `stored`.
   *
   * Why: two empty lists are equal text, but an empty list says only that
   * the after-typing callback saw no declaration of that module. No stamp
   * then shows that Haxe kept the module, so equal text proves nothing.
   */
  static function sameStampedEpochs(current: String, stored: String): Bool {
    return current.length > 0 && current == stored;
  }

  static function compareStrings(left: String, right: String): Int {
    return left < right ? -1 : left > right ? 1 : 0;
  }
}
#end
