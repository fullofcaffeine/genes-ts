package genes.util;

import sys.FileSystem;
import haxe.io.Path;

/**
 * Keeps filesystem path comparisons consistent across compiler features.
 *
 * Why: source maps and module imports compare paths that may be relative,
 * absolute, or written with a trailing slash. A plain text-prefix check is not
 * enough: `/work/app-copy` is not inside `/work/app`, while `/` really does own
 * every absolute Unix path.
 *
 * What: these helpers normalize paths before comparing them, preserve real
 * filesystem roots, and return `/`-separated relative paths. They do not follow
 * symbolic links or decide whether a caller owns a file.
 *
 * How: Windows comparisons ignore letter case because its ordinary filesystems
 * are case-insensitive. Other hosts keep their native case-sensitive behavior.
 */
class PathUtil {
  static function absolute(path: String): String
    return normalize(FileSystem.absolutePath(path));

  /**
   * Returns the same text as `haxe.io.Path.normalize(path)`, and skips its
   * work when `path` is already in normal form.
   *
   * Why: `Path.normalize` copies the path one character at a time. In the
   * Haxe 4.3.7 macro interpreter that takes about 25 microseconds for a
   * path of a usual length. The output transaction checks every directory
   * between a generated file and the output root, and it normalizes the same
   * absolute paths again and again: about 100,000 calls and 3 seconds in
   * the `test.hxml` build of this repository. Almost all of these paths are
   * already normal.
   *
   * What: when `isNormalForm` proves that `Path.normalize` returns its input
   * unchanged, this function returns the input. Otherwise it calls
   * `Path.normalize`. Example: `/work/out/app/Main.ts` comes back as it is,
   * while `/work/out/../out/app/` goes through `Path.normalize`. The result
   * is always the text that `Path.normalize` gives;
   * `tests/source-map-paths/src/source_map_paths/PathUtilProbe.hx` compares
   * the two on paths of each kind.
   */
  public static function normalize(path: String): String
    return isNormalForm(path) ? path : Path.normalize(path);

  /**
   * Returns true only when `Path.normalize(path)` equals `path`.
   *
   * `Path.normalize` changes a path only for one of these: a backslash, an
   * empty segment (`//`, or a `/` at the end), a `.` or `..` segment, and a
   * colon (it moves a `/` that comes just before a colon: `/a/:b` becomes
   * `/a:/b`). A non-empty path with none of them comes back unchanged: the
   * segment list stays the same, and each `/` is followed by another
   * character, so the printing loop writes every character again. A path
   * with one of them can still be normal (`../a` is); this check then
   * returns false, and the caller does the full work.
   */
  static function isNormalForm(path: String): Bool {
    return path.length > 0
      && path.indexOf('\\') == -1
      && path.indexOf(':') == -1
      && path.indexOf('//') == -1
      && !StringTools.endsWith(path, '/')
      && path.indexOf('/./') == -1
      && path.indexOf('/../') == -1
      && !StringTools.endsWith(path, '/.')
      && !StringTools.endsWith(path, '/..')
      && !StringTools.startsWith(path, './')
      && !StringTools.startsWith(path, '../')
      && path != '.'
      && path != '..';
  }

  static function comparable(path: String): String
    return if (Sys.systemName() == 'Windows') path.toLowerCase() else path;

  static function withoutTrailingSlash(path: String): String {
    var end = path.length;
    while (end > 1 && path.charAt(end - 1) == '/') {
      // `C:/` is a filesystem root, not the relative drive path `C:`.
      if (end == 3 && path.charAt(1) == ':')
        break;
      end--;
    }
    return path.substr(0, end);
  }

  static function containsNormalized(root: String, path: String): Bool {
    final comparableRoot = comparable(root);
    final comparablePath = comparable(path);
    if (comparablePath == comparableRoot)
      return true;
    final childPrefix = StringTools.endsWith(comparableRoot,
      '/') ? comparableRoot : comparableRoot
      + '/';
    return StringTools.startsWith(comparablePath, childPrefix);
  }

  /**
   * Reports whether `path` is `root` itself or a child of it.
   *
   * Unlike a string-prefix check, this requires a directory boundary after the
   * root. The paths do not need to exist; callers use this while planning files
   * that may be written later.
   */
  public static function isWithin(root: String, path: String): Bool {
    final normalizedRoot = withoutTrailingSlash(absolute(root));
    final normalizedPath = absolute(path);
    return containsNormalized(normalizedRoot, normalizedPath);
  }

  /**
   * Returns `path` relative to an owning root, or `null` when it is outside.
   *
   * Callers should use this instead of manually removing a root prefix. The
   * result never starts with `../`, so it is safe to use as an identity inside
   * an already-proven classpath or project root.
   */
  public static function fromRoot(root: String, path: String): Null<String> {
    final normalizedRoot = withoutTrailingSlash(absolute(root));
    final normalizedPath = absolute(path);
    if (!containsNormalized(normalizedRoot, normalizedPath))
      return null;
    if (comparable(normalizedRoot) == comparable(normalizedPath))
      return '';
    final childOffset = StringTools.endsWith(normalizedRoot,
      '/') ? normalizedRoot.length : normalizedRoot.length
      + 1;
    return normalizedPath.substr(childOffset);
  }

  public static function relative(from: String, to: String) {
    from = absolute(from);
    to = absolute(to);
    final fromParts = from.split('/').filter(v -> v != '');
    final toParts = to.split('/').filter(v -> v != '');
    // Subtract one because `from` names a file, not a directory to compare.
    final shortestLength = fromParts.length < toParts.length ? fromParts.length : toParts.length;
    final length = shortestLength > 0 ? shortestLength - 1 : 0;
    var samePartsLength = length;
    for (i in 0...length)
      if (comparable(fromParts[i]) != comparable(toParts[i])) {
        samePartsLength = i;
        break;
      }
    final to = [
      for (i in samePartsLength...fromParts.length - 1)
        '..'
    ].concat(toParts.slice(samePartsLength)).join('/');
    return if (to.charAt(0) != '.') './' + to else to;
  }
}
