package genes;

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

/**
 * One possible portable name for an external source file.
 *
 * A file can sit under more than one classpath. We keep every spelling because
 * the shortest spelling is pleasant for debuggers, while a longer spelling may
 * be needed to distinguish it from another file in the same source map.
 */
private typedef SourceIdentityCandidate = {
  final path: String;
  final classPathOrder: Int;
}

/**
 * Connects an external source-map entry to all of its portable name choices.
 *
 * The source index is the stable order already used by the source-map mapping
 * table. Candidate allocation may run in a different order so files with only
 * one possible name get that name before more flexible files are considered.
 */
private typedef ExternalSourceIdentityPlan = {
  final sourceIndex: Int;
  final candidates: Array<SourceIdentityCandidate>;
}

/**
 * Builds version-three source maps while target emitters write generated code.
 *
 * Original Haxe positions stay in a typed table until serialization. The
 * generator owns mapping math and portable source names; the surrounding
 * output transaction still owns when source and map files become public.
 */
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

  static function encodeSourcePath(path: String): String
    return path.split('/')
      .map(part -> StringTools.replace(StringTools.urlEncode(part), '+', '%20'))
      .join('/');

  static function projectRoot(): String {
    final configured = Context.definedValue('genes.source_map_root');
    return if (configured == null || configured.length == 0)
      Sys.getCwd()
    else
      configured;
  }

  static function pathPartCount(path: String): Int
    return path.length == 0 ? 0 : path.split('/').length;

  /**
   * Lists every classpath-relative name that can describe one source file.
   *
   * A source can belong to nested entries. The shortest candidate is usually
   * the name a developer expects, such as `Std.hx`, so candidates are ordered
   * from shortest to longest. We keep longer candidates because two different
   * files can otherwise both become `foo/Util.hx`; allocation resolves that
   * ambiguity before the map is serialized.
   */
  static function sourceIdentityCandidates(source: String): Array<SourceIdentityCandidate> {
    final candidates: Array<SourceIdentityCandidate> = [];
    final classPaths = Context.getClassPath();
    for (classPathOrder in 0...classPaths.length) {
      final classPath = classPaths[classPathOrder];
      if (classPath.length == 0)
        continue;
      final relative = PathUtil.fromRoot(classPath, source);
      if (relative == null || relative.length == 0)
        continue;
      var alreadyKnown = false;
      for (candidate in candidates)
        if (candidate.path == relative) {
          alreadyKnown = true;
          break;
        }
      if (!alreadyKnown)
        candidates.push({path: relative, classPathOrder: classPathOrder});
    }
    if (candidates.length == 0)
      candidates.push({
        path: Path.withoutDirectory(Path.normalize(source)),
        classPathOrder: classPaths.length
      });
    candidates.sort((left, right) -> {
      final partDifference = pathPartCount(left.path) - pathPartCount(right.path);
      if (partDifference != 0)
        return partDifference;
      final lengthDifference = left.path.length - right.path.length;
      return lengthDifference != 0
        ? lengthDifference
        : left.classPathOrder - right.classPathOrder;
    });
    return candidates;
  }

  /**
   * Tries to give one external source a name no other source currently owns.
   *
   * This is a small deterministic matching step. It first takes an unused
   * candidate. If every candidate is already owned, it asks an earlier source
   * whether that source can move to another valid name. This preserves concise
   * names where possible without letting two source indices share one URI.
   */
  static function claimSourceIdentity(planIndex: Int,
      plans: Array<ExternalSourceIdentityPlan>, ownerByPath: Map<String, Int>,
      chosenByPlan: Array<Null<String>>, visitedPaths: Map<String, Bool>): Bool {
    final plan = plans[planIndex];
    for (candidate in plan.candidates) {
      if (visitedPaths.exists(candidate.path) || ownerByPath.exists(candidate.path))
        continue;
      visitedPaths.set(candidate.path, true);
      ownerByPath.set(candidate.path, planIndex);
      chosenByPlan[planIndex] = candidate.path;
      return true;
    }
    for (candidate in plan.candidates) {
      if (visitedPaths.exists(candidate.path))
        continue;
      visitedPaths.set(candidate.path, true);
      final currentOwner = ownerByPath.get(candidate.path);
      if (currentOwner != null
        && claimSourceIdentity(currentOwner, plans, ownerByPath, chosenByPlan, visitedPaths)) {
        ownerByPath.set(candidate.path, planIndex);
        chosenByPlan[planIndex] = candidate.path;
        return true;
      }
    }
    return false;
  }

  /**
   * Gives every mapped source a useful, unambiguous name without machine paths.
   *
   * Why: turning every absolute Haxe position into `../../...` keeps project
   * files navigable, but it also records a developer's Haxelib cache and Haxe
   * installation layout in maps that may be committed or published. Choosing
   * the shortest classpath spelling independently is also unsafe: overlapping
   * classpaths can give two different files the same apparent name.
   *
   * What: files inside the configured project root keep ordinary relative
   * paths. Dependency and standard-library files instead use distinct, stable
   * `haxe://classpath/...` names based on paths Haxe can use to find them.
   *
   * How: external sources are matched to unique classpath-relative candidates.
   * If genuinely separate classpath roots offer no distinct spelling, a stable
   * `_duplicate_N` segment based on source-map encounter order keeps the URIs
   * separate. `sourcesContent` still reads from the original absolute path, so
   * `-D source_map_content` can display the source while hiding its cache path.
   */
  function sourceIdentities(mapPath: String): Array<Null<String>> {
    final identities: Array<Null<String>> = [for (_ in sources) null];
    final externalPlans: Array<ExternalSourceIdentityPlan> = [];
    for (sourceIndex in 0...sources.length) {
      final source = sources[sourceIndex];
      if (source == '?')
        continue;
      if (PathUtil.isWithin(projectRoot(), source))
        identities[sourceIndex] = PathUtil.relative(mapPath, source);
      else
        externalPlans.push({
          sourceIndex: sourceIndex,
          candidates: sourceIdentityCandidates(source)
        });
    }

    externalPlans.sort((left, right) -> {
      final candidateDifference = left.candidates.length - right.candidates.length;
      return candidateDifference != 0
        ? candidateDifference
        : left.sourceIndex - right.sourceIndex;
    });
    final ownerByPath = new Map<String, Int>();
    final chosenByPlan: Array<Null<String>> = [for (_ in externalPlans) null];
    for (planIndex in 0...externalPlans.length)
      claimSourceIdentity(planIndex, externalPlans, ownerByPath, chosenByPlan, new Map());

    final usedPaths = new Map<String, Bool>();
    for (chosen in chosenByPlan)
      if (chosen != null)
        usedPaths.set(chosen, true);
    for (planIndex in 0...externalPlans.length) {
      final plan = externalPlans[planIndex];
      var chosen = chosenByPlan[planIndex];
      if (chosen == null) {
        final base = plan.candidates[0].path;
        var duplicateNumber = 2;
        do {
          chosen = '_duplicate_${duplicateNumber}/${base}';
          duplicateNumber++;
        } while (usedPaths.exists(chosen));
        usedPaths.set(chosen, true);
      }
      identities[plan.sourceIndex] = 'haxe://classpath/${encodeSourcePath(chosen)}';
    }
    return identities;
  }

  public function toJSON(path: String, withSources: Bool): SourceMapJson {
    final map: SourceMapJson = {
      version: 3,
      names: [],
      file: Path.withoutDirectory(Path.withoutExtension(path)),
      sourceRoot: "",
      sources: sourceIdentities(path),
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
