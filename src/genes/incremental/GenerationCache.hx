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
  public static inline final FORMAT = 1;

  /** Largest cache that is stored, counted in string characters (64 MB). */
  public static inline final BYTE_BUDGET = 64 * 1024 * 1024;

  @:persistent static var storedKey: Null<String> = null;
  @:persistent static var storedReservedNames: Null<String> = null;
  @:persistent static var storedGlobalWitnesses: Array<CachedWitness> = [];
  @:persistent static var entries: Map<String, CachedModule> = new Map();
  @:persistent static var storedBytes = 0;

  /** Returns the stored entry of one module, or `null`. */
  public static function entry(module: String): Null<CachedModule> {
    return storedKey == null ? null : entries.get(module);
  }

  /** Returns the stored module names, sorted. */
  public static function storedModules(): Array<String> {
    if (storedKey == null)
      return [];
    final names = [for (name in entries.keys()) name];
    names.sort(compareStrings);
    return names;
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
    for (witness in storedGlobalWitnesses)
      if (!sameStampedEpochs(facts.epochs(witness.module), witness.epochs))
        return Fallback('a module read by name outside any module changed '
          + 'or has no declaration stamp: ${witness.module}');
    final clean = new Map<String, Bool>();
    final dirty = new Map<String, String>();
    final changedFingerprints = [];
    for (module in storedModules()) {
      final stored = entries.get(module);
      if (stored == null)
        continue;
      final epochs = facts.epochs(module);
      final unstamped = epochs.length == 0;
      final sameEpochs = !unstamped && epochs == stored.epochs;
      final sameFingerprint = facts.fingerprint(module) == stored.fingerprint;
      // Rule 6 needs to know that Haxe did not type the module again. A
      // module without a stamp now and in the stored entry gives no such
      // answer, so a changed fingerprint there falls back, as it did when
      // two empty lists counted as equal. A module that had a stamp and has
      // none now left the program (or lost its declarations): no fallback,
      // as for a module that Haxe typed again.
      if ((sameEpochs || (unstamped && stored.epochs.length == 0))
        && !sameFingerprint)
        changedFingerprints.push(module);
      final reason = if (module == facts.rootModule) 'root module' else
        if (unstamped) 'no declaration stamp' else if (!sameEpochs)
          'typed again' else if (!sameFingerprint) 'fingerprint changed' else
          if (stored.usedHaxePrinter) 'used Haxe\'s printer' else
            changedWitness(stored, facts);
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
   * Replaces the stored cache with the result of a successful generation.
   * Returns false, and drops the cache, when the result is above
   * `BYTE_BUDGET`.
   */
  public static function commit(sessionKey: String,
      reservedNameDigest: String, globalWitnesses: Array<CachedWitness>,
      modules: Map<String, CachedModule>): Bool {
    var size = sessionKey.length + reservedNameDigest.length;
    for (witness in globalWitnesses)
      size += witness.module.length + witness.epochs.length;
    for (name => module in modules) {
      size += name.length + module.epochs.length + module.fingerprint.length;
      for (witness in module.witnesses)
        size += witness.module.length + witness.epochs.length;
      for (file in module.files)
        size += file.path.length + file.text.length;
      for (warning in module.warnings)
        size += warning.message.length + warning.file.length;
    }
    if (size > BYTE_BUDGET) {
      drop();
      return false;
    }
    storedKey = sessionKey;
    storedReservedNames = reservedNameDigest;
    storedGlobalWitnesses = globalWitnesses;
    entries = modules;
    storedBytes = size;
    return true;
  }

  /** Forgets the stored cache. */
  public static function drop(): Void {
    storedKey = null;
    storedReservedNames = null;
    storedGlobalWitnesses = [];
    entries = new Map();
    storedBytes = 0;
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
