package genes;

import haxe.macro.Compiler;
import haxe.macro.Context;
import haxe.macro.Type;
import haxe.macro.Expr.Position;
import haxe.display.Position.Location;
import haxe.macro.PositionTools.toLocation;
import haxe.io.Path;
import sys.io.File;
import sys.FileSystem;
import haxe.Json;
import genes.util.PathUtil;

@:structInit
class SourcePositionData {
  public final line: Int;
  public final column: Int;
  public final file: Null<String>;
}

/**
 * The exact JSON record written for one version-three source map.
 *
 * Why: this compiler-owned value used to be `Dynamic`, even though every key
 * is fixed by the source-map contract. That made a misspelled or wrongly typed
 * field invisible to Haxe and encouraged callers to treat serialization as an
 * untyped boundary.
 *
 * What: required map fields are immutable after construction. Source entries
 * may be `null` for compiler-generated positions, and `sourcesContent` is
 * optional because it is emitted only for the `source_map_content` profile.
 *
 * How: the type remains private to this implementation module. `haxe.Json`
 * serializes the same anonymous record as before, so typing the record must not
 * change property order, bytes, source paths, or transaction ownership.
 */
private typedef SourceMapJson = {
  final version: Int;
  final names: Array<String>;
  final file: String;
  final sourceRoot: String;
  final sources: Array<Null<String>>;
  final mappings: String;
  @:optional var sourcesContent: Array<Null<String>>;
}

@:forward
abstract SourcePosition(SourcePositionData) from SourcePositionData {
  @:from static function fromTypedExpr(expr: TypedExpr)
    return fromPos(expr.pos);

  @:from static function fromPos(pos: Position)
    return fromLocation(toLocation(pos));

  @:from static function fromLocation(location: Location): SourcePosition
    return ({
      line: location.range.start.line,
      column: location.range.start.character - 1,
      file: location.file.toString()
    } : SourcePositionData);

  public static final EMPTY: SourcePosition = ({
    line: 1,
    column: 0,
    file: null
  } : SourcePositionData);
}

class SourceMapGenerator {
  static final chars = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O',
    'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'a', 'b', 'c', 'd',
    'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's',
    't', 'u', 'v', 'w', 'x', 'y', 'z', '0', '1', '2', '3', '4', '5', '6', '7',
    '8', '9', '+', '/'
  ];

  final sources: Array<String> = [];
  var mappings = '';
  var previousGeneratedColumn = 0;
  var previousGeneratedLine = 1;
  var previousOriginalColumn = 0;
  var previousOriginalLine = 0;
  var previousSource = 0;

  public function new() {}

  static function toVlq(number: Int)
    return (number < 0) ? ((-1 * number) << 1) + 1 : (number << 1);

  function base64Vlq(number: Int) {
    var vlq = toVlq(number);
    do {
      final shift = 5;
      final base = 1 << shift;
      final mask = base - 1;
      final continuationBit = base;
      final digit = vlq & mask;
      final next = vlq >> shift;
      final mapping = chars[
        if (next > 0)
          digit | continuationBit
        else
          digit
      ];
      mappings += mapping;
      vlq = next;
    } while (vlq > 0);
  }

  public function addMapping(original: SourcePosition,
      generated: SourcePositionData) {
    final source = switch sources.indexOf(original.file) {
      case -1: sources.push(original.file) - 1;
      case v: v;
    }
    if (generated.line != previousGeneratedLine) {
      previousGeneratedColumn = 0;
      while (generated.line != previousGeneratedLine) {
        mappings += ";";
        previousGeneratedLine++;
      }
    } else if (mappings.length > 0) {
      mappings += ",";
    }

    base64Vlq(generated.column - previousGeneratedColumn);
    base64Vlq(source - previousSource);
    base64Vlq(original.line - 1 - previousOriginalLine);
    base64Vlq(original.column - previousOriginalColumn);

    previousGeneratedColumn = generated.column;
    previousOriginalLine = original.line - 1;
    previousOriginalColumn = original.column;
    previousSource = source;
  }

  static function encodePath(path: String): String
    return path.split('/').map(part -> StringTools.replace(StringTools.urlEncode(part), '+', '%20')).join('/');

  static function projectRoot(): String {
    final configured = Context.definedValue('genes.source_map_root');
    return if (configured == null || configured.length == 0) Sys.getCwd() else configured;
  }

  static function containingClassPath(source: String): Null<String> {
    var owner: Null<String> = null;
    for (classPath in Context.getClassPath())
      if (classPath.length > 0 && PathUtil.isWithin(classPath, source)
        && (owner == null || classPath.length < owner.length))
        owner = classPath;
    return owner;
  }

  /**
   * Produces a portable source identity without weakening application-source
   * debugging.
   *
   * Source maps used to relativize every compiler position against the output
   * file. Application files were useful, but Haxelib and Haxe-stdlib positions
   * then walked out of the project and encoded the invoking machine's cache
   * layout. Files owned by the configured project root remain ordinary relative
   * paths. External classpath files receive a stable virtual URI based on their
   * Haxe module path; `-D source_map_content` embeds their contents when a
   * debugger needs the original dependency source.
   */
  static function sourceIdentity(mapPath: String, source: String): String {
    if (PathUtil.isWithin(projectRoot(), source))
      return PathUtil.relative(mapPath, source);

    final classPath = containingClassPath(source);
    final relative = if (classPath == null) null else PathUtil.fromRoot(classPath, source);
    final identity = if (relative == null || relative.length == 0)
      Path.withoutDirectory(Path.normalize(source))
    else
      relative;
    return 'haxe://classpath/${encodePath(identity)}';
  }

  public function toJSON(path: String, withSources: Bool): SourceMapJson {
    final map: SourceMapJson = {
      version: 3,
      names: [],
      file: Path.withoutDirectory(Path.withoutExtension(path)),
      sourceRoot: "",
      sources: sources.map(source -> if (source == '?') null else sourceIdentity(path, source)),
      mappings: mappings
    }
    #if source_map_content
    if (withSources)
      map.sourcesContent = sources.map(source -> switch source {
        case null | '?': null;
        case file: File.getContent(file);
      });
    #end
    return map;
  }

  public function write(path: String, withSources: Bool) {
    final dir = Path.directory(path);
    if (!FileSystem.exists(dir))
      FileSystem.createDirectory(dir);
    File.saveContent(path, serialize(path, withSources));
  }

  /**
   * Serializes a complete deterministic map without choosing file ownership.
   *
   * `Emitter` uses this separation to place maps in the same output transaction
   * as generated source. `write()` remains the compatibility path for callers
   * that intentionally own an individual file outside compiler orchestration.
   */
  public function serialize(path: String, withSources: Bool): String
    return Json.stringify(toJSON(path, withSources));
}
