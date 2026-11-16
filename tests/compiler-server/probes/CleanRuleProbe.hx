import genes.incremental.GenerationCache;
import genes.incremental.GenerationChangeSet;
import genes.incremental.IncrementalRequest;
import haxe.macro.Context;

/**
 * Checks rules of incremental generation on their own, with made-up inputs:
 * the output lines of the session key, the clean rule for a module without a
 * declaration stamp, the refusal of `"generation": "compare"` and `"reuse"`
 * without `"afterTyping": "reuse"`, and the rules that slice S1 added before
 * any replay (the items of the review of #243): same-object proofs (item 1),
 * "left the program" from the current request (item 3), sources inside the
 * folder where output paths part (item 4), rule 6 for modules without an
 * output file (item 6), and no replay from a cache of afterTyping
 * `"measure"` (item 7).
 *
 * Why: these are the three changes that the G2 design review requires
 * before stored output may be replayed. A request sequence shows only the
 * cases that Haxe can produce today. Haxe 4.3.7 gives every declaration to
 * the after-typing callback, also a type that a macro defines there, so no
 * real request has a generated module with an empty epoch list. The rule
 * must still hold if that changes, so this probe calls
 * `GenerationCache.decide` directly. Each case differs from a clean case in
 * one input.
 *
 * What: `check()` is an init macro. It reports a fatal error for the first
 * case with a wrong answer. When all cases pass it prints one line,
 * `clean-rule-probe:ok (<n> cases)`, which `yarn test:compiler-server:shadow`
 * requires. It changes the generation cache of its own compiler process
 * only; run it with `--no-output` in a new process.
 */
/** Optional inputs of `CleanRuleProbe.store`. */
private typedef StoreOptions = {
  final ?answers: Array<String>;
  final ?mapSources: Array<String>;
  final ?outputFolder: String;
  final ?underReuse: Bool;
}

/** Optional inputs of `CleanRuleProbe.facts`. */
private typedef FactOptions = {
  final ?absent: Array<String>;
  final ?proofs: Map<String, Null<String>>;
  final ?failures: Array<String>;
  final ?outputFolder: String;
}

class CleanRuleProbe {
  static inline final OUTPUT = '/p/cand/rev-3/output';
  static inline final KEY = 'probe session key';
  static inline final DIGEST = 'probe reserved names';
  static var cases = 0;

  public static function check(): Void {
    checkOutputLines();
    checkUnstamped();
    checkRefusal();
    checkReplayRules();
    Sys.println('clean-rule-probe:ok ($cases cases)');
  }

  /** Required change 1: no absolute output path in the session key. */
  static function checkOutputLines(): Void {
    final root = '/p';
    final first = GenerationChangeSet.outputKeyLines('/p/.genes/dev/candidates/revision-3-ab/output/index.tsx',
      root);
    expectText('candidate folder',
      'output-root ../../../../..\noutput-file index.tsx\n', first);
    expectText('sibling candidate folder keeps the lines', first,
      GenerationChangeSet.outputKeyLines('/p/.genes/dev/candidates/revision-4-cd/output/index.tsx',
        root));
    expectDifferent('folder at another depth', first,
      GenerationChangeSet.outputKeyLines('/p/.genes/dev/candidates/revision-4-cd/index.tsx',
        root));
    expectDifferent('other extension', first,
      GenerationChangeSet.outputKeyLines('/p/.genes/dev/candidates/revision-3-ab/output/index.ts',
        root));
    expectDifferent('other file name', first,
      GenerationChangeSet.outputKeyLines('/p/.genes/dev/candidates/revision-3-ab/output/main.tsx',
        root));
    expectText('output folder is the project root',
      'output-root .\noutput-file index.tsx\n',
      GenerationChangeSet.outputKeyLines('/p/index.tsx', root));
    expectText('output outside the project root names the way back',
      'output-root ../../p\noutput-file index.tsx\n',
      GenerationChangeSet.outputKeyLines('/q/out/index.tsx', root));
    expectText('sibling folders outside the project root',
      GenerationChangeSet.outputKeyLines('/q/out/index.tsx', root),
      GenerationChangeSet.outputKeyLines('/q/out2/index.tsx', root));
  }

  /** Required change 2: a module with no observed declaration stamp is never clean. */
  static function checkUnstamped(): Void {
    final epochs = [
      'app.Clean' => 'class:app.Clean@n:1',
      'app.Unstamped' => '',
      'app.Reader' => 'class:app.Reader@n:1',
      'app.Index' => 'class:app.Index@n:1'
    ];
    final fingerprints = [
      'app.Clean' => 'f-clean',
      'app.Unstamped' => 'f-unstamped',
      'app.Reader' => 'f-reader',
      'app.Index' => 'f-index'
    ];
    store(epochs, fingerprints, [], ['app.Reader' => ['app.Unstamped']]);
    final decision = GenerationCache.decide(facts(epochs, fingerprints));
    switch decision {
      case Rules(clean, dirty):
        expectState('stamped module with equal epochs', true, clean, dirty,
          'app.Clean', null);
        // Both epoch lists are empty, so their texts are equal. Before the
        // rule, this module was clean.
        expectState('module with no declaration stamp, both lists empty',
          false, clean, dirty, 'app.Unstamped', 'no declaration stamp');
        expectState('module that read an unstamped module by name', false,
          clean, dirty, 'app.Reader',
          'read app.Unstamped by name, and it changed or has no declaration stamp');
      default:
        fail('unstamped module', 'Rules', Std.string(decision));
    }
    // An unstamped module whose fingerprint changed: nothing says that Haxe
    // did not type it again, so rule 6 falls back as for a kept module.
    final changed = fingerprints.copy();
    changed.set('app.Unstamped', 'f-unstamped-2');
    switch GenerationCache.decide(facts(epochs, changed)) {
      case Fallback(_):
        cases++;
      case other:
        fail('unstamped module with a changed fingerprint', 'Fallback',
          Std.string(other));
    }
    // A module that had a stamp, has none now and is absent from the
    // generator list left the program (the last use of a type, a deleted
    // module). It is dirty, and its changed fingerprint must not make the
    // whole request fall back (item 3: decided from this request).
    final stored = epochs.copy();
    stored.set('app.Gone', 'class:app.Gone@n:1');
    final storedFingerprints = fingerprints.copy();
    storedFingerprints.set('app.Gone', 'f-gone');
    store(stored, storedFingerprints, [], []);
    switch GenerationCache.decide(facts(epochs, fingerprints)) {
      case Rules(clean, dirty):
        expectState('module that left the program', false, clean, dirty,
          'app.Gone', 'left the program');
      case other:
        fail('module that left the program', 'Rules', Std.string(other));
    }
    // A read outside any module, of a module without a stamp.
    store(epochs, fingerprints, ['app.Unstamped'], []);
    switch GenerationCache.decide(facts(epochs, fingerprints)) {
      case Fallback(_):
        cases++;
      case other:
        fail('read outside any module of an unstamped module', 'Fallback',
          Std.string(other));
    }
    GenerationCache.drop();
  }

  /** Required change 3: compare needs `afterTyping: "reuse"`. */
  static function checkRefusal(): Void {
    expectRefusal('compare with reuse', null, CompareClean, Reuse);
    expectRefusal('compare with measure', 'compare-needs-after-typing-reuse',
      CompareClean, Measure);
    expectRefusal('compare with compare', 'compare-needs-after-typing-reuse',
      CompareClean, Compare);
    expectRefusal('measure with measure', null, MeasureClean, Measure);
    expectRefusal('no generation value', null, Regenerate, Measure);
    expectRefusal('reuse with reuse', null, ReuseClean, Reuse);
    expectRefusal('reuse with measure', 'reuse-needs-after-typing-reuse',
      ReuseClean, Measure);
    expectRefusal('reuse with compare', 'reuse-needs-after-typing-reuse',
      ReuseClean, Compare);
  }

  /** The rules that slice S1 added before any replay (items of the review of #243). */
  static function checkReplayRules(): Void {
    final epochs = [
      'app.Clean' => 'class:app.Clean@n:1',
      'app.Index' => 'class:app.Index@n:1',
      'app.Types' => 'typedef:app.Types@n:1'
    ];
    final fingerprints = ['app.Clean' => 'f-clean', 'app.Index' => 'f-index', 'app.Types' => 'f-types'];
    // Item 1: a failed same-object test anywhere falls back.
    store(epochs, fingerprints, [], []);
    expectFallback('a failed same-object test',
      GenerationCache.decide(facts(epochs, fingerprints, {
        failures: ['class:app.Other']
      })));
    // Item 1: a declaration without a proof, or with another proof, is dirty.
    expectDecision('a declaration without a same-object proof',
      GenerationCache.decide(facts(epochs, fingerprints, {
        proofs: ['app.Clean' => null]
      })), 'app.Clean',
      'a declaration has no same-object proof');
    expectDecision('a bucket written after the stored output',
      GenerationCache.decide(facts(epochs, fingerprints,
        {
          proofs: ['app.Clean' => 'class:app.Clean@7']
        })),
      'app.Clean',
      'a declaration object differs from the one that printed the stored output');
    expectDecision('equal proofs',
      GenerationCache.decide(facts(epochs, fingerprints)), 'app.Clean', null);
    // Item 3: no stamp, but present in the generator list with a changed
    // fingerprint: nothing shows that Haxe kept it, so the request falls back.
    final unstamped = epochs.copy();
    unstamped.set('app.Clean', '');
    final changed = fingerprints.copy();
    changed.set('app.Clean', 'f-clean-2');
    expectFallback('no stamp, present, changed fingerprint',
      GenerationCache.decide(facts(unstamped, changed)));
    expectDecision('no stamp, absent, changed fingerprint',
      GenerationCache.decide(facts(unstamped, changed, {
        absent: ['app.Clean']
      })), 'app.Clean', 'left the program');
    // Item 6: a module without an output file is in rule 6 too.
    store(epochs, fingerprints, [], [], ['app.Types']);
    final typesChanged = fingerprints.copy();
    typesChanged.set('app.Types', 'f-types-2');
    expectFallback('a module without an output file changed its fingerprint',
      GenerationCache.decide(facts(epochs, typesChanged)));
    // Item 4: a stored map source inside the folder where the paths part.
    store(epochs, fingerprints, [], [], null,
      {mapSources: ['/p/cand/rev-3/gen/app/Clean.hx']});
    expectDecision('a map source inside the stored parting folder',
      GenerationCache.decide(facts(epochs, fingerprints,
        {
          outputFolder: '/p/cand/rev-4/output'
        })),
      'app.Clean',
      'a source of its source maps is inside the folder where the output paths ' +
      'part: /p/cand/rev-3/gen/app/Clean.hx');
    expectDecision('the same output folder',
      GenerationCache.decide(facts(epochs, fingerprints)), 'app.Clean', null);
    store(epochs, fingerprints, [], [], null,
      {mapSources: ['/p/src/app/Clean.hx']});
    expectDecision('a map source outside the parting folders',
      GenerationCache.decide(facts(epochs, fingerprints, {
        outputFolder: '/p/cand/rev-4/output'
      })), 'app.Clean', null);
    expectText('parting folders', '/p/cand/rev-3,/p/cand/rev-4',
      GenerationCache.partingFolders('/p/cand/rev-3/output',
        '/p/cand/rev-4/output')
        .join(','));
    // Rule 10: a module that asked for a feature that emission adds.
    store(epochs, fingerprints, [], [], null,
      {answers: ['feature use.' + '$' + 'bind 0']});
    expectDecision('asked for a feature that emission adds',
      GenerationCache.decide(facts(epochs, fingerprints)), 'app.Clean',
      'asked for the feature use.' + '$' + 'bind, which emission can add');
    // Item 7: compare and reuse do not use a cache of afterTyping measure.
    store(epochs, fingerprints, [], [], null, {underReuse: false});
    switch GenerationCache.decide(facts(epochs, fingerprints)) {
      case NoCache(_):
        cases++;
      case other:
        fail('a cache written with afterTyping measure', 'NoCache',
          Std.string(other));
    }
    GenerationCache.drop();
  }

  static function expectFallback(name: String, decision: CacheDecision): Void {
    switch decision {
      case Fallback(_):
        cases++;
      default:
        fail(name, 'Fallback', Std.string(decision));
    }
  }

  static function expectDecision(name: String, decision: CacheDecision,
      module: String, wantReason: Null<String>): Void {
    switch decision {
      case Rules(clean, dirty):
        expectState(name, wantReason == null, clean, dirty, module, wantReason);
      default:
        fail(name, 'Rules', Std.string(decision));
    }
  }

  static function store(epochs: Map<String, String>,
      fingerprints: Map<String, String>, globalReads: Array<String>,
      reads: Map<String, Array<String>>, ?inventoryOnly: Array<String>,
      ?options: StoreOptions): Void {
    final modules = new Map<String, CachedModule>();
    final others = new Map<String, CachedInventoryModule>();
    final skip = inventoryOnly == null ? [] : inventoryOnly;
    for (module => text in epochs) {
      if (skip.indexOf(module) >= 0) {
        others.set(module,
          {epochs: text, fingerprint: fingerprints.get(module)});
        continue;
      }
      final read = reads.get(module);
      modules.set(module, {
        epochs: text,
        fingerprint: fingerprints.get(module),
        witnesses: read == null ? [] : [
          for (name in read)
            {module: name, epochs: epochs.get(name)}
        ],
        usedHaxePrinter: false,
        files: [],
        warnings: [],
        proofs: proofOf(module),
        members: '',
        rootFlags: '',
        answers: options != null
        && options.answers != null ? options.answers : [],
        additions: [],
        publicEntries: [],
        mapSources: options != null
        && options.mapSources != null ? options.mapSources : []
      });
    }
    GenerationCache.commit(KEY, DIGEST, [
      for (name in globalReads)
        {module: name, epochs: epochs.get(name)}
    ],
      modules,
      others, options != null && options.outputFolder != null ? options.outputFolder : OUTPUT, options == null
      || options.underReuse != false);
  }

  /** The made-up same-object proof text of one module. */
  static function proofOf(module: String): String {
    return 'class:$module@1';
  }

  static function facts(epochs: Map<String, String>,
      fingerprints: Map<String, String>,
      ?options: FactOptions): CacheRequestFacts {
    final absent = options != null
      && options.absent != null ? options.absent : [];
    final proofs = options != null
      && options.proofs != null ? options.proofs : new Map();
    return {
      present: module -> epochs.exists(module) && absent.indexOf(module) < 0,
      proofs: module ->
        proofs.exists(module) ? proofs.get(module) : proofOf(module),
      sameObjectFailures: options != null
      && options.failures != null ? options.failures : [],
      outputFolder: options != null
      && options.outputFolder != null ? options.outputFolder : OUTPUT,
      needsReuseCache: true,
      sessionKey: KEY,
      reservedNameDigest: DIGEST,
      rootModule: 'app.Index',
      fingerprint: module -> {
        final known = fingerprints.get(module);
        known == null ? '' : known;
      },
      epochs: module -> {
        final known = epochs.get(module);
        known == null ? '' : known;
      }
    };
  }

  static function expectState(name: String, wantClean: Bool,
      clean: Map<String, Bool>, dirty: Map<String, String>, module: String,
      wantReason: Null<String>): Void {
    cases++;
    final isClean = clean.exists(module);
    final reason = dirty.get(module);
    if (isClean != wantClean || reason != wantReason)
      fail(name, wantClean ? 'clean' : 'dirty ($wantReason)',
        isClean ? 'clean' : 'dirty ($reason)');
  }

  static function expectRefusal(name: String, wanted: Null<String>,
      generation: GenerationReuse, afterTyping: AfterTypingReuse): Void {
    cases++;
    final refusal = IncrementalRequest.generationRefusal({
      path: '/probe/request.json',
      programDigest: 'probe',
      kind: Full,
      afterTyping: afterTyping,
      generation: generation
    });
    final code = refusal == null ? null : IncrementalRequest.refusalCode(refusal);
    if (code != wanted)
      fail(name, Std.string(wanted), Std.string(code));
  }

  static function expectText(name: String, wanted: String,
      actual: String): Void {
    cases++;
    if (actual != wanted)
      fail(name, wanted, actual);
  }

  static function expectDifferent(name: String, other: String,
      actual: String): Void {
    cases++;
    if (actual == other)
      fail(name, 'a text other than ${other}', actual);
  }

  static function fail(name: String, wanted: String, actual: String): Void {
    Context.fatalError('clean-rule-probe: "$name": expected $wanted, got $actual',
      Context.currentPos());
  }
}
