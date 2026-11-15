package genes.incremental;

#if macro
import haxe.macro.Context;
import haxe.io.Path;
import sys.FileSystem;
import sys.io.File;

/** The kinds of request that a development session can ask for. */
enum IncrementalRequestKind {
  /**
   * The whole program, as an ordinary build would generate it. Only this kind
   * reads or writes the generation cache.
   */
  Full;
}

/**
 * The request descriptor that a development session writes before each
 * request.
 *
 * Why: the define value must stay the same for the whole session, because
 * Haxe keys its own module cache by the defines. Facts that change per
 * request, such as the digest of the complete argument list, therefore live
 * in a file that the define names.
 *
 * Format (JSON, version 1):
 *
 * ```json
 * {"format": 1, "programDigest": "<digest of the argument list>", "kind": "full"}
 * ```
 *
 * The session owns `programDigest`. Genes only compares it with the digest of
 * the last generation.
 */
typedef IncrementalDescriptor = {
  final path: String;
  final programDigest: String;
  final kind: IncrementalRequestKind;
}

/** What one request does with the incremental path. */
enum IncrementalMode {
  /**
   * The define is absent. Genes adds no stamp, reads no cache, writes no
   * report, and generates exactly as before.
   */
  Absent;

  /**
   * The define is present, but this request cannot use the incremental path.
   * Genes generates in full, adds no stamp and leaves the cache as it is. The
   * reason goes to the report.
   */
  Off(descriptorPath: String, reason: String);

  /**
   * Byte-stability shadow (Stage 3, slice 1): the request generates and
   * publishes in full, then compares the stored files of each module that the
   * clean rules call clean with the files it just staged.
   */
  Shadow(descriptor: IncrementalDescriptor);
}

/**
 * Reads `-D genes.dev_incremental=<descriptor path>` once per request and
 * decides whether the request may use the incremental path.
 *
 * Why: incremental generation is a development-session feature only. A
 * normal build, a test gate and each pinned output must keep today's bytes
 * and today's code path. One owner decides this, so that the stamp loop, the
 * generator and the report agree.
 *
 * What: `mode()` returns `Absent` without the define, `Off` when the request
 * is outside the supported scope, and `Shadow` otherwise. The supported scope
 * of slice 1 is the TypeScript and TSX profile (`-D genes.ts`), with or
 * without source maps; a map is one more file of the module, compared byte
 * for byte like the source. `-D dts`,
 * `-D source_map_content` (maps then hold source text read from disk) and
 * `-D no-macro-cache` turn the path off.
 *
 * Limits: Haxe 4.3.7 gives a macro no way to see `-xml` or a module check
 * policy. The session owns the argument list and must not set the define
 * together with them.
 *
 * Lifetime: the answer belongs to one request. `reset()` runs at the first
 * `Generator.use()` of each request.
 */
class IncrementalRequest {
  /** The define that turns the incremental path on. Its value is the descriptor path. */
  public static inline final DEFINE = 'genes.dev_incremental';

  /** The only descriptor format that this Genes version reads. */
  public static inline final DESCRIPTOR_FORMAT = 1;

  @:persistent static var current: Null<IncrementalMode> = null;

  /** Forgets the answer of the previous request. */
  public static function reset(): Void {
    current = null;
  }

  /** Returns true when the define is present, whatever the mode is. */
  public static inline function requested(): Bool {
    return Context.defined(DEFINE);
  }

  /** Returns the mode of the current request. Reads the descriptor at most once. */
  public static function mode(): IncrementalMode {
    final known = current;
    if (known != null)
      return known;
    final decided = decide();
    current = decided;
    return decided;
  }

  /**
   * Turns the incremental path off for the rest of the request, for a reason
   * that is found after the descriptor was read (for example an `@:rtti`
   * class, or an output file that is not `.ts` or `.tsx`).
   */
  public static function turnOff(reason: String): Void {
    switch mode() {
      case Shadow(descriptor):
        current = Off(descriptor.path, reason);
      case Absent | Off(_, _):
    }
  }

  /** Returns true while this request still adds epoch stamps and uses the cache. */
  public static function shadowActive(): Bool {
    return mode().match(Shadow(_));
  }

  /**
   * Returns the report path for a descriptor path: a file beside the
   * descriptor, never inside the output tree, so the tree stays equal to cold
   * output.
   */
  public static function reportPath(descriptorPath: String): String {
    return descriptorPath + '.report.json';
  }

  static function decide(): IncrementalMode {
    if (!requested())
      return Absent;
    final path = Context.definedValue(DEFINE);
    if (path == null || path.length == 0 || path == '1')
      return Off('', '-D $DEFINE needs the path of a request descriptor');
    final absolute = Path.normalize(FileSystem.absolutePath(path));
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
      case Right(descriptor): Shadow(descriptor);
    }
  }

  /**
   * Decodes the descriptor JSON into a typed value, or returns why it cannot.
   *
   * BOUNDARY_DYNAMIC: `haxe.Json.parse` returns an untyped value. This
   * function reads exactly three fields, checks the runtime type of each one
   * before use, and returns only typed values. An unknown format or kind is
   * an answer ("off"), not an error, so an older Genes keeps working with a
   * newer session.
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
    return Right({
      path: path,
      programDigest: (digest : String),
      kind: requestKind
    });
  }
}
#end
