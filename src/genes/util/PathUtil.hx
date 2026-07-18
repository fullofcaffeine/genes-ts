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
    return Path.normalize(FileSystem.absolutePath(path));

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
    final childPrefix = StringTools.endsWith(comparableRoot, '/')
      ? comparableRoot
      : comparableRoot + '/';
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
    final childOffset = StringTools.endsWith(normalizedRoot, '/')
      ? normalizedRoot.length
      : normalizedRoot.length + 1;
    return normalizedPath.substr(childOffset);
  }

  public static function relative(from: String, to: String) {
    from = absolute(from);
    to = absolute(to);
    final fromParts = from.split('/').filter(v -> v != '');
    final toParts = to.split('/').filter(v -> v != '');
    // Subtract one because `from` names a file, not a directory to compare.
    final shortestLength = fromParts.length < toParts.length
      ? fromParts.length
      : toParts.length;
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
