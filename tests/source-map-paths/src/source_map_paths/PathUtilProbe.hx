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
    require(PathUtil.fromRoot(filesystemRoot,
      rootChild) == 'portable-source/Main.hx',
      'A filesystem-root child must not lose its first directory name');

    checkNormalize(cwd);
  }

  /**
   * `PathUtil.normalize` skips `Path.normalize` for a path that is already
   * normal. It must give the same text as `Path.normalize` for every path:
   * normal ones, each kind of change, and the normalized result again.
   */
  static function checkNormalize(cwd: String): Void {
    final paths = [
      '',
      '/',
      '.',
      '..',
      'a',
      '/a',
      'a/b',
      '/a/b/Main.ts',
      cwd,
      cwd + '/out',
      '/a/',
      'a/',
      '//a',
      '/a//b',
      '/a///b/',
      '/./a',
      '/a/.',
      '/a/./b',
      './a',
      '../a',
      'a/..',
      '/a/..',
      '/a/../b',
      '/..',
      '../../a/b',
      'a\\b',
      '\\\\server\\share',
      'C:/a',
      'C:\\a\\b',
      'C:/a//b',
      'http://x/y',
      '/a:b/c',
      '/a://b',
      '/a:/b',
      '/a/:b',
      ':a',
      'a/:',
      '/a/b.c/.d/..e',
      '/a/\u00e9t\u00e9/b',
      '/a/\u{1F600}/b',
      '/a/ b /c',
      '/.a/b',
      '/a/.../b'
    ];
    for (path in paths)
      for (input in [path, Path.normalize(path)]) {
        final expected = Path.normalize(input);
        final actual = PathUtil.normalize(input);
        require(actual == expected,
          'PathUtil.normalize("$input") gave "$actual"; Path.normalize gives "$expected"');
      }
  }
}
