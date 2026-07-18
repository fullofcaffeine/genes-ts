package genes.util;

import sys.FileSystem;
import haxe.io.Path;

class PathUtil {
  static function absolute(path: String): String
    return Path.normalize(FileSystem.absolutePath(path));

  static function comparable(path: String): String
    return if (Sys.systemName() == 'Windows') path.toLowerCase() else path;

  static function withoutTrailingSlash(path: String): String {
    var end = path.length;
    while (end > 1 && path.charAt(end - 1) == '/')
      end--;
    return path.substr(0, end);
  }

  /**
   * Reports whether `path` belongs to `root` without relying on a textual
   * prefix that would also accept siblings such as `/project-copy`.
   */
  public static function isWithin(root: String, path: String): Bool {
    final normalizedRoot = withoutTrailingSlash(absolute(root));
    final normalizedPath = absolute(path);
    final rootForComparison = comparable(normalizedRoot);
    final pathForComparison = comparable(normalizedPath);
    return pathForComparison == rootForComparison
      || StringTools.startsWith(pathForComparison, rootForComparison + '/');
  }

  /** Returns a slash-normalized path relative to a proven owning root. */
  public static function fromRoot(root: String, path: String): Null<String> {
    final normalizedRoot = withoutTrailingSlash(absolute(root));
    final normalizedPath = absolute(path);
    if (!isWithin(normalizedRoot, normalizedPath))
      return null;
    if (comparable(normalizedRoot) == comparable(normalizedPath))
      return '';
    return normalizedPath.substr(normalizedRoot.length + 1);
  }

  public static function relative(from: String, to: String) {
    from = absolute(from);
    to = absolute(to);
    final fromParts = from.split('/').filter(v -> v != '');
    final toParts = to.split('/').filter(v -> v != '');
    // Substract one since don't want to compare the file part
    final length: Int = cast Math.min(fromParts.length, toParts.length) - 1;
    var samePartsLength = length;
    for (i in 0...length)
      if (fromParts[i] != toParts[i]) {
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
