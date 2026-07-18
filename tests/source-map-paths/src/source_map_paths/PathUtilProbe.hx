package source_map_paths;

import genes.util.PathUtil;
import haxe.io.Path;
import sys.FileSystem;

/**
 * Checks the path-boundary rules used by portable source maps.
 *
 * These examples use paths that do not need to exist. That keeps the test
 * focused on ownership: a real child belongs to its root, a similarly named
 * sibling does not, and the host filesystem root still owns nested paths.
 */
class PathUtilProbe {
  static function require(condition: Bool, message: String): Void {
    if (!condition)
      throw message;
  }

  static function main(): Void {
    final cwd = Path.normalize(FileSystem.absolutePath('.'));
    final owner = Path.join([cwd, 'source-map-owner']);
    final child = Path.join([owner, 'src', 'Main.hx']);
    final sibling = Path.join([cwd, 'source-map-owner-copy', 'Main.hx']);

    require(PathUtil.isWithin(owner + '/', child),
      'A nested source must belong to its project root');
    require(PathUtil.fromRoot(owner, child) == 'src/Main.hx',
      'A nested source must keep its path inside the owning root');
    require(!PathUtil.isWithin(owner, sibling),
      'A similarly named sibling must not be mistaken for a project source');
    require(PathUtil.fromRoot(owner, sibling) == null,
      'A source outside the root must not receive a project-relative path');

    #if windows
    final driveSeparator = cwd.indexOf(':');
    require(driveSeparator == 1,
      'The Windows source-map test expects an ordinary drive path');
    final filesystemRoot = cwd.substr(0, driveSeparator + 1) + '/';
    final rootChild = filesystemRoot + 'portable-source/Main.hx';
    #else
    final filesystemRoot = '/';
    final rootChild = '/portable-source/Main.hx';
    #end

    require(PathUtil.isWithin(filesystemRoot, rootChild),
      'The filesystem root must own an absolute child path');
    require(PathUtil.fromRoot(filesystemRoot, rootChild) == 'portable-source/Main.hx',
      'A filesystem-root child must not lose its first directory name');
  }
}
