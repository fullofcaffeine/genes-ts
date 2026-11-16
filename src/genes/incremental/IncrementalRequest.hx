package genes.incremental;

#if macro
import haxe.macro.Context;
import haxe.io.Path;
import sys.FileSystem;
import sys.io.File;

/** The kinds of request that a development session can ask for. */
enum IncrementalRequestKind {
  /** The whole program, as an ordinary build generates it. */
  Full;
}

/**
 * What the passes after typing do with the results of earlier requests.
 *
 * The descriptor field `afterTyping` selects it for one request. All three
 * values stamp declarations and keep the records and buckets of the passes;
 * they differ only in what a pass does when the keep rule holds for a
 * declaration.
 */
enum AfterTypingReuse {
  /**
   * Measure only (the default): every pass does its full work. The keep rule
   * is decided and counted, and its result is not used.
   */
  Measure;

  /**
   * A pass skips its work for a declaration when the keep rule holds. The
   * React audit skips the class. `SignatureCache` puts the kept facts of
   * the declaration back and does not read it.
   */
  Reuse;

  /**
   * Every pass does its full work, as in `Measure`, and the output uses
   * that work. Genes reports each case in which the kept result would have
   * been wrong: a class with a valid record that fails the React audit, and
   * an answer of a kept `SignatureCache` bucket that differs from the new
   * capture.
   */
  Compare;
}

/**
 * What the generator does with the output of earlier requests.
 *
 * The descriptor field `generation` selects it for one request. Only
 * `ReuseClean` skips work: it stages the stored files of each module that
 * the clean rules and the checks before emission accept. Every value still
 * publishes the complete tree.
 */
enum GenerationReuse {
  /**
   * The field is absent (the default): the generator keeps no output and
   * decides nothing. The request runs as without the field.
   */
  Regenerate;

  /**
   * `"measure"`: after the commit, Genes applies the clean rules, stores the
   * files of each module as plain data and reports the clean share and the
   * module clocks. It compares nothing. See `IncrementalShadow`.
   */
  MeasureClean;

  /**
   * `"compare"`: as `MeasureClean`, and Genes also compares the stored files
   * of each module that the clean rules call clean with the files that it
   * just staged (the byte-stability shadow of Stage 3, slice 1). It also
   * compares the member list, the recorded answers, the public entries and
   * the root flags of each module that `ReuseClean` would replay. Needs
   * `afterTyping: "reuse"` (see `GenerationRefusal`).
   */
  CompareClean;

  /**
   * `"reuse"` (Stage 3, slice S1): for each module that the clean rules and
   * the checks before emission accept, Genes skips both validation loops and
   * emission, and stages the stored files, maps and print warnings of the
   * module instead. The walk of reachability stays live. Needs
   * `afterTyping: "reuse"` (see `GenerationRefusal`). See
   * `IncrementalShadow` for the checks.
   */
  ReuseClean;
}

/**
 * Why the generator does not serve the `generation` value that the
 * descriptor asks for. The request then generates in full as without the
 * field, and the generation report names this reason.
 */
enum GenerationRefusal {
  /**
   * `generation: "compare"` or `"reuse"` with an `afterTyping` value other
   * than `"reuse"`.
   *
   * Why (G2 design review, required change 3): `"reuse"` replays the stored
   * output of clean modules. Its output must come from the same after-typing
   * facts as the request that compare checks. With `"measure"` or
   * `"compare"` the passes after typing read every kept class again from its
   * current bodies, so a compare run would prove the bytes of a path that
   * the replay never takes, and a replay would mix two paths.
   */
  NeedsAfterTypingReuse(generation: GenerationReuse,
    afterTyping: AfterTypingReuse);
}

/**
 * The request descriptor that a development session writes before each
 * request.
 *
 * Why: the define value must stay the same for the whole session, because
 * Haxe 4.3.7 starts the macro state again when a `-D` value changes. Facts
 * that can change from one request to the next therefore live in a file that
 * the define names.
 *
 * Format (JSON, version 1). `afterTyping` is optional and means `"measure"`
 * when absent. `generation` is optional; when absent, the generator keeps
 * and compares nothing:
 *
 * ```json
 * {"format": 1, "programDigest": "<digest of the argument list>",
 *  "kind": "full", "afterTyping": "measure" | "reuse" | "compare",
 *  "generation": "measure" | "compare" | "reuse"}
 * ```
 *
 * `"generation": "compare"` and `"reuse"` need `"afterTyping": "reuse"`;
 * with another `afterTyping` value the generator refuses them
 * (`generationRefusal`).
 *
 * One descriptor serves every consumer of the incremental path: the passes
 * after typing read `afterTyping`, the generator reads `generation`. Both
 * use the stamps and the session key of the one `GenerationChangeSet`.
 *
 * The session owns `programDigest`: a macro cannot read the `--macro`
 * arguments of its request, so the session names them. Genes only compares
 * the value with the one of the earlier request.
 */
typedef IncrementalDescriptor = {
  final path: String;
  final programDigest: String;
  final kind: IncrementalRequestKind;
  final afterTyping: AfterTypingReuse;
  final generation: GenerationReuse;
}

/** What one request does with the incremental path. */
enum IncrementalMode {
  /**
   * The define is absent. Genes adds no stamp, keeps no record, writes no
   * report, and runs exactly as without this feature.
   */
  Absent;

  /**
   * The define is present, but this request cannot use the incremental path.
   * Genes does its full work, adds no stamp and leaves every kept record as
   * it is. The reason goes to the report.
   */
  Off(descriptorPath: String, reason: String);

  /**
   * The request is eligible: declarations get stamps and records are kept.
   * This is the only mode in which a consumer (a pass after typing, the
   * generation shadow) may use a result of an earlier request.
   */
  On(descriptor: IncrementalDescriptor);
}

/**
 * Reads `-D genes.dev_incremental=<descriptor path>` once per request and
 * decides whether the request may use the incremental path.
 *
 * Why: reuse between requests is a development-session feature only. A
 * normal build, a test gate and each pinned output must keep today's bytes
 * and today's code path. One owner decides this, so that the stamps, the
 * passes after typing and the reports agree. This is condition 1 of the keep
 * rule (see `GenerationChangeSet`).
 *
 * What: `mode()` returns `Absent` without the define, `Off` when the request
 * is outside the supported scope, and `On` otherwise. The supported scope:
 *
 * - Haxe 4.3.7 only. The proof that a declaration object stays the same
 *   between requests was run on that version. Haxe 5 reads cached modules
 *   into new objects on each request, so the stamps would say "kept" for
 *   objects that are new.
 * - Not a display request (completion, hover): Haxe types only a part of the
 *   program there.
 * - The Genes generator is installed, with the TypeScript or TSX profile
 *   (`-D genes.ts`); no `-D dts`, `-D source_map_content` or
 *   `-D no-macro-cache`.
 *
 * `GenerationChangeSet` adds one more reason after typing: a program with an
 * `@:rtti` class (see `turnOff`).
 *
 * Limits: Haxe 4.3.7 gives a macro no way to see `-xml` or a module check
 * policy. The session owns the argument list and must not set the define
 * together with them. With the `Retype` policy Haxe types a module again in
 * place, and no stamp can show that.
 *
 * One mode for every consumer: the passes after typing and the generation
 * shadow do not decide eligibility themselves. A consumer that cannot serve
 * a request for a reason of its own (the shadow, for an output file that is
 * not `.ts` or `.tsx`, or a `generation` value that `generationRefusal`
 * refuses) stays out without turning the mode off, so that the other
 * consumers keep working.
 *
 * Lifetime: the answer is an ordinary static, so Haxe replaces it at the
 * start of each compilation. Nothing here outlives a request.
 */
class IncrementalRequest {
  /** The define that turns the incremental path on. Its value is the descriptor path. */
  public static inline final DEFINE = 'genes.dev_incremental';

  /** The only descriptor format that this Genes version reads. */
  public static inline final DESCRIPTOR_FORMAT = 1;

  /** The Haxe versions on which the kept-values proof was run. */
  static final PROVED_HAXE_VERSIONS = ['4.3.7'];

  static var current: Null<IncrementalMode> = null;
  static var decoded: Null<IncrementalDescriptor> = null;

  /** Returns the mode of the current request. Reads the descriptor at most once. */
  public static function mode(): IncrementalMode {
    final known = current;
    if (known != null)
      return known;
    final decided = decide();
    current = decided;
    return decided;
  }

  /** Returns the descriptor while this request is still eligible, else `null`. */
  public static function descriptor(): Null<IncrementalDescriptor> {
    return switch mode() {
      case On(descriptor): descriptor;
      case Absent | Off(_, _): null;
    }
  }

  /**
   * Returns the descriptor that this request read, also after `turnOff`;
   * `null` when the request never had a readable descriptor.
   *
   * Why: a consumer writes its report also for a request that left the
   * incremental path after typing (an `@:rtti` class). It needs the
   * descriptor to know whether the session asked for it.
   */
  public static function requestedDescriptor(): Null<IncrementalDescriptor> {
    mode();
    return decoded;
  }

  /**
   * Turns the incremental path off for the rest of the request, for a reason
   * that is found after the descriptor was read (for example an `@:rtti`
   * class).
   */
  public static function turnOff(reason: String): Void {
    switch mode() {
      case On(descriptor):
        current = Off(descriptor.path, reason);
      case Absent | Off(_, _):
    }
  }

  /**
   * Returns the path of the after-typing report for a descriptor path: a file
   * beside the descriptor, never inside the output tree, so that the tree
   * stays equal to the output of a build without the define.
   */
  public static function afterTypingReportPath(descriptorPath: String): String {
    return descriptorPath + '.after-typing.json';
  }

  /**
   * Returns the path of the generation report (the shadow report) for a
   * descriptor path: a file beside the descriptor, never inside the output
   * tree, so that the tree stays equal to the output of a build without the
   * define.
   */
  public static function generationReportPath(descriptorPath: String): String {
    return descriptorPath + '.report.json';
  }

  /**
   * Returns why the generator must not serve the `generation` value of
   * `descriptor`, or `null` when it may.
   *
   * `"compare"` and `"reuse"` need `afterTyping: "reuse"` (see
   * `NeedsAfterTypingReuse`). The answer does not turn the request mode off.
   * The passes after typing still run in their own mode; only the generator
   * keeps no output, compares nothing and replays nothing in this request.
   *
   * Example: `{"afterTyping": "measure", "generation": "compare"}` gives
   * `NeedsAfterTypingReuse(CompareClean, Measure)`.
   */
  public static function generationRefusal(descriptor: IncrementalDescriptor): Null<GenerationRefusal> {
    return switch [descriptor.generation, descriptor.afterTyping] {
      case [CompareClean | ReuseClean, Reuse]: null;
      case [CompareClean | ReuseClean, other]:
        NeedsAfterTypingReuse(descriptor.generation, other);
      case [Regenerate | MeasureClean, _]: null;
    }
  }

  /**
   * Returns the stable code of a refusal for the generation report, for
   * example `compare-needs-after-typing-reuse` or
   * `reuse-needs-after-typing-reuse`. A session matches this code, not the
   * sentence of `refusalText`.
   */
  public static function refusalCode(refusal: GenerationRefusal): String {
    return switch refusal {
      case NeedsAfterTypingReuse(generation, _):
        '${generationName(generation)}-needs-after-typing-reuse';
    }
  }

  /** Returns the sentence that the generation report gives for a refusal. */
  public static function refusalText(refusal: GenerationRefusal): String {
    return switch refusal {
      case NeedsAfterTypingReuse(generation, afterTyping):
        'generation "${generationName(generation)}" needs afterTyping '
        +
        '"reuse"; this request has afterTyping "${afterTypingName(afterTyping)}", '
        + 'so the generator keeps no output, compares nothing and replays '
        + 'nothing';
    }
  }

  /** Returns the descriptor text of a `generation` value, or `none` when absent. */
  public static function generationName(generation: GenerationReuse): String {
    return switch generation {
      case Regenerate: 'none';
      case MeasureClean: 'measure';
      case CompareClean: 'compare';
      case ReuseClean: 'reuse';
    }
  }

  /** Returns the descriptor text of an `afterTyping` value. */
  public static function afterTypingName(afterTyping: AfterTypingReuse): String {
    return switch afterTyping {
      case Measure: 'measure';
      case Reuse: 'reuse';
      case Compare: 'compare';
    }
  }

  /**
   * Decides the mode of this request from the defines and the descriptor
   * file. `mode()` calls it once and keeps the answer.
   *
   * It returns `Absent` without the define. With the define it checks the
   * supported scope in a fixed order (see the class comment) and returns
   * `Off` with the first reason that applies, for example "Haxe 5.0.0 is not
   * a proved version". Only when every check passes and the descriptor
   * decodes, it returns `On`. It never raises an error: a request outside the
   * scope must build exactly as without the define.
   */
  static function decide(): IncrementalMode {
    if (!Context.defined(DEFINE))
      return Absent;
    final path = Context.definedValue(DEFINE);
    if (path == null || path.length == 0 || path == '1')
      return Off('', '-D $DEFINE needs the path of a request descriptor');
    final absolute = Path.normalize(FileSystem.absolutePath(path));
    final version = Context.definedValue('haxe');
    if (version == null || PROVED_HAXE_VERSIONS.indexOf(version) == -1)
      return Off(absolute,
        'Haxe $version is not a proved version (${PROVED_HAXE_VERSIONS.join(', ')})');
    if (Context.defined('display'))
      return Off(absolute,
        'a display request types only a part of the program');
    if (!Context.defined(genes.CompilerInternal.GENERATOR_ACTIVE_DEFINE))
      return Off(absolute, 'the Genes generator is not installed');
    if (!Context.defined('genes.ts'))
      return Off(absolute,
        'only the TypeScript and TSX profile is supported (-D genes.ts)');
    if (Context.defined('dts'))
      return Off(absolute, '-D dts is not supported yet');
    if (Context.defined('source_map_content'))
      return Off(absolute, '-D source_map_content reads source text from disk');
    if (Context.defined('no_macro_cache'))
      return Off(absolute, '-D no-macro-cache resets the macro interpreter');
    if (!FileSystem.exists(absolute) || FileSystem.isDirectory(absolute))
      return Off(absolute, 'the request descriptor does not exist');
    return switch decodeDescriptor(absolute, File.getContent(absolute)) {
      case Left(reason): Off(absolute, reason);
      case Right(descriptor):
        decoded = descriptor;
        On(descriptor);
    }
  }

  /**
   * Decodes the descriptor JSON into a typed value, or returns why it cannot.
   *
   * BOUNDARY_DYNAMIC: `haxe.Json.parse` returns an untyped value, and the
   * standard library has no typed JSON decoder. This function reads exactly
   * five fields, checks the runtime type of each one before use, and returns
   * only typed values. An unknown format, kind, `afterTyping` or `generation`
   * value is an answer ("off"), not an error, so an older Genes keeps working
   * with a newer session.
   */
  static function decodeDescriptor(path: String,
      text: String): haxe.ds.Either<String, IncrementalDescriptor> {
    final parsed: Dynamic = try haxe.Json.parse(text) catch (_:haxe.Exception)
      null;
    if (parsed == null)
      return Left('the request descriptor is not valid JSON');
    final format: Dynamic = Reflect.field(parsed, 'format');
    if (!Std.isOfType(format, Int) || (format : Int) != DESCRIPTOR_FORMAT)
      return Left('unknown request descriptor format');
    final kind: Dynamic = Reflect.field(parsed, 'kind');
    if (!Std.isOfType(kind, String))
      return Left('the request descriptor has no kind');
    final requestKind = switch (kind : String) {
      case 'full': Full;
      case other: return Left('unknown request kind "$other"');
    }
    final digest: Dynamic = Reflect.field(parsed, 'programDigest');
    if (!Std.isOfType(digest, String) || (digest : String).length == 0)
      return Left('the request descriptor has no programDigest');
    final reuse: Dynamic = Reflect.field(parsed, 'afterTyping');
    final afterTyping = if (reuse == null) {
      Measure;
    } else if (!Std.isOfType(reuse, String)) {
      return
        Left('the afterTyping value of the request descriptor is not text');
    } else switch (reuse : String) {
      case 'measure': Measure;
      case 'reuse': Reuse;
      case 'compare': Compare;
      case other: return Left('unknown afterTyping value "$other"');
    }
    final stored: Dynamic = Reflect.field(parsed, 'generation');
    final generation = if (stored == null) {
      Regenerate;
    } else if (!Std.isOfType(stored, String)) {
      return Left('the generation value of the request descriptor is not text');
    } else switch (stored : String) {
      case 'measure': MeasureClean;
      case 'compare': CompareClean;
      case 'reuse': ReuseClean;
      case other: return Left('unknown generation value "$other"');
    }
    return Right({
      path: path,
      programDigest: (digest : String),
      kind: requestKind,
      afterTyping: afterTyping,
      generation: generation
    });
  }
}
#end
