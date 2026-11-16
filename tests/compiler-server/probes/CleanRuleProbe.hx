import genes.incremental.GenerationCache;
import genes.incremental.GenerationChangeSet;
import genes.incremental.IncrementalRequest;
import haxe.macro.Context;

/**
 * Checks three rules of the incremental generation shadow on their own,
 * with made-up inputs: the output lines of the session key, the clean rule
 * for a module without a declaration stamp, and the refusal of
 * `"generation": "compare"` without `"afterTyping": "reuse"`.
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
class CleanRuleProbe {
  static inline final KEY = 'probe session key';
  static inline final DIGEST = 'probe reserved names';
  static var cases = 0;

  public static function check(): Void {
    checkOutputLines();
    checkUnstamped();
    checkRefusal();
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
  }

  static function store(epochs: Map<String, String>,
      fingerprints: Map<String, String>, globalReads: Array<String>,
      reads: Map<String, Array<String>>): Void {
    final modules = new Map<String, CachedModule>();
    for (module => text in epochs) {
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
        warnings: []
      });
    }
    GenerationCache.commit(KEY, DIGEST, [
      for (name in globalReads)
        {module: name, epochs: epochs.get(name)}
    ], modules);
  }

  static function facts(epochs: Map<String, String>,
      fingerprints: Map<String, String>): CacheRequestFacts {
    return {
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
