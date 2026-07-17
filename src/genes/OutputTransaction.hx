package genes;

import haxe.io.Bytes;
import haxe.io.Path;
import sys.FileSystem;
import sys.io.File;

using StringTools;

/**
 * Owns one compilation's generated files and publishes them as a transaction.
 *
 * Why: per-file buffering prevents a half-written module, but it still allows
 * an emitter failure in module N to leave modules 1..N-1 from the new build
 * beside modules N..end from the previous build. Source maps historically
 * bypassed `Writer` as well, so they could drift independently.
 *
 * What: each emitter buffers one complete file, then its writer closes into a
 * private staging directory. `commit()` snapshots every public target it will
 * mutate, publishes the complete owned set, removes stale owned paths, and
 * rolls all mutations back if publication fails. A deterministic manifest per
 * `-js` entrypoint stem is the sole authority for stale-file deletion; files
 * absent from that manifest are never removed.
 *
 * How: paths are canonicalized beneath the output directory before admission.
 * The staging directory lives on the same filesystem as the destination, so
 * each final move is a rename. The whole set is failure-atomic through backup
 * and rollback rather than a directory swap, because output directories may
 * also contain user assets or artifacts owned by another tool. This class owns
 * filesystem policy only; TS/classic/declaration semantics remain in their
 * existing planners and emitters.
 */
class OutputTransaction {
  static inline final MANIFEST_HEADER = 'genes-output-manifest-v1';

  final outputRoot: String;
  final outputPrefix: String;
  final manifestRelative: String;
  final stageRelative: String;
  final outputRootExisted: Bool;
  final staged: Map<String, Bool> = new Map();
  var stagePrepared = false;
  var committed = false;

  public function new(outputDirectory: String, entrypointStem: String) {
    outputRoot = absolutePath(outputDirectory.length == 0
      ? '.'
      : outputDirectory);
    outputRootExisted = FileSystem.exists(outputRoot);
    outputPrefix = outputRoot.endsWith('/') ? outputRoot : outputRoot + '/';
    final scope = safeScope(entrypointStem);
    manifestRelative = '.genes-output-$scope.manifest';
    stageRelative = '.genes-output-$scope.stage';
  }

  /**
   * Creates a writer whose close operation stages text outside the public tree.
   *
   * The writer deliberately preserves the existing empty-file behavior: an
   * emitter that writes nothing owns no path. Closing twice is harmless, while
   * writes after close diagnose an emitter lifecycle bug.
   */
  public function writer(path: String): Writer {
    final relative = relativePath(path);
    final buffer = new StringBuf();
    var closed = false;
    return new Writer(data -> {
      if (closed)
        throw new haxe.Exception('Genes output writer is already closed: $relative');
      buffer.add(data);
    }, () -> {
      if (closed)
        return;
      closed = true;
      if (buffer.length > 0)
        register(relative, buffer.toString());
    });
  }

  /** Registers a complete non-emitter artifact such as a source map. */
  public function writeContent(path: String, content: String): Void {
    register(relativePath(path), content);
  }

  /**
   * Abandons an uncommitted generation and removes private staging artifacts.
   *
   * Registered emitter content exists only under the private stage. The
   * configured Haxe output is a separate sentinel owned by `Generator`, so no
   * user-visible file needs repair before `commit()`. Cleanup is idempotent
   * after a failed commit rollback.
   */
  public function abort(): Void {
    if (committed)
      return;
    deleteTree(stagePath(''));
    stagePrepared = false;
    removeNewEmptyRoot();
  }

  /**
   * Publishes every registered artifact or restores the exact prior contents.
   *
   * The manifest is moved last. A reader can therefore never observe a new
   * ownership declaration before its files exist. Rollback uses byte backups,
   * so it does not depend on text encoding or on regenerating the previous
   * compiler output.
   */
  public function commit(): Void {
    if (committed)
      throw new haxe.Exception('Genes output transaction was already committed');

    final mutated: Map<String, Bool> = new Map();
    final backups: Map<String, Bytes> = new Map();
    var originalError: Null<haxe.Exception> = null;

    try {
      final previous = readManifest();
      final current = sortedKeys(staged);
      final staleSet: Map<String, Bool> = new Map();
      for (relative in previous)
        if (!staged.exists(relative))
          staleSet.set(relative, true);
      final stale = sortedKeys(staleSet);

      // The ownership declaration is the commit marker and must be visible
      // only after every file it names has been published.
      final publicationPaths = current.copy();
      publicationPaths.push(manifestRelative);

      final affected: Map<String, Bool> = new Map();
      for (relative in stale)
        affected.set(relative, true);
      for (relative in publicationPaths)
        affected.set(relative, true);

      stageManifest(current);
      for (relative in sortedKeys(affected)) {
        final target = targetPath(relative);
        if (!FileSystem.exists(target))
          continue;
        if (FileSystem.isDirectory(target))
          throw new haxe.Exception('Genes output path is a directory: $target');
        backups.set(relative, File.getBytes(target));
      }

      for (relative in stale) {
        final target = targetPath(relative);
        if (!FileSystem.exists(target))
          continue;
        mutated.set(relative, true);
        FileSystem.deleteFile(target);
      }

      var published = 0;
      for (relative in publicationPaths) {
        final target = targetPath(relative);
        #if genes.unchanged_no_rewrite
        if (FileSystem.exists(target) && !FileSystem.isDirectory(target)
          && File.getContent(target) == File.getContent(stagePath(relative)))
          continue;
        #end

        mutated.set(relative, true);
        ensureDirectory(Path.directory(target));
        if (FileSystem.exists(target))
          FileSystem.deleteFile(target);
        FileSystem.rename(stagePath(relative), target);
        published++;

        // This private define exists only for the rollback harness. It fails
        // after a real rename so the test exercises restoration, not merely
        // the easier pre-publication staging path.
        #if genes.output_transaction_test_fail_during_commit
        if (published == 1)
          throw new haxe.Exception(
            'Genes output transaction test failure during publication');
        #end
      }

      deleteTree(stagePath(''));
      stagePrepared = false;
      pruneEmptyParents(stale);
      committed = true;
      return;
    } catch (error:haxe.Exception) {
      originalError = error;
    }

    var rollbackError: Null<haxe.Exception> = null;
    try {
      rollback(mutated, backups);
    } catch (error:haxe.Exception) {
      rollbackError = error;
    }
    try {
      deleteTree(stagePath(''));
      stagePrepared = false;
      removeNewEmptyRoot();
    } catch (error:haxe.Exception) {
      if (rollbackError == null)
        rollbackError = error;
    }

    if (rollbackError != null)
      throw new haxe.Exception(
        'Genes output rollback failed after "${originalError.message}": '
        + rollbackError.message,
        rollbackError);
    throw originalError;
  }

  function register(relative: String, content: String): Void {
    if (committed)
      throw new haxe.Exception('Cannot register output after commit: $relative');
    if (staged.exists(relative))
      throw new haxe.Exception('Two emitters own the same output path: $relative');
    prepareStageRoot();
    final path = stagePath(relative);
    ensureDirectory(Path.directory(path));
    File.saveContent(path, content);
    staged.set(relative, true);
  }

  function readManifest(): Array<String> {
    final path = targetPath(manifestRelative);
    if (!FileSystem.exists(path))
      return [];
    if (FileSystem.isDirectory(path))
      throw new haxe.Exception('Genes output manifest is a directory: $path');

    final lines = File.getContent(path).split('\n');
    if (lines.length == 0 || withoutCarriageReturn(lines[0]) != MANIFEST_HEADER)
      throw new haxe.Exception('Unsupported Genes output manifest: $path');

    final seen: Map<String, Bool> = new Map();
    final result = [];
    for (index in 1...lines.length) {
      final line = withoutCarriageReturn(lines[index]);
      if (line.length == 0)
        continue;
      final relative = validateRelative(line);
      if (seen.exists(relative))
        throw new haxe.Exception('Duplicate Genes output manifest path: $relative');
      seen.set(relative, true);
      result.push(relative);
    }
    result.sort(Reflect.compare);
    return result;
  }

  function manifestText(paths: Array<String>): String {
    return MANIFEST_HEADER + '\n'
      + (paths.length == 0 ? '' : paths.join('\n') + '\n');
  }

  function prepareStageRoot(): Void {
    if (stagePrepared)
      return;
    final root = stagePath('');
    deleteTree(root);
    ensureDirectory(root);
    stagePrepared = true;
  }

  function stageManifest(paths: Array<String>): Void {
    prepareStageRoot();
    File.saveContent(stagePath(manifestRelative), manifestText(paths));
  }

  function removeNewEmptyRoot(): Void {
    if (!outputRootExisted && FileSystem.exists(outputRoot)
      && FileSystem.isDirectory(outputRoot)
      && FileSystem.readDirectory(outputRoot).length == 0)
      FileSystem.deleteDirectory(outputRoot);
  }

  function rollback(mutated: Map<String, Bool>,
      backups: Map<String, Bytes>): Void {
    final paths = sortedKeys(mutated);
    paths.reverse();
    for (relative in paths) {
      final target = targetPath(relative);
      if (FileSystem.exists(target)) {
        if (FileSystem.isDirectory(target))
          throw new haxe.Exception(
            'Cannot roll back output file replaced by a directory: $target');
        FileSystem.deleteFile(target);
      }
      if (backups.exists(relative)) {
        ensureDirectory(Path.directory(target));
        File.saveBytes(target, backups.get(relative));
      }
    }
    pruneEmptyParents(paths);
  }

  function pruneEmptyParents(relativePaths: Array<String>): Void {
    final candidates: Map<String, Bool> = new Map();
    for (relative in relativePaths) {
      var directory = Path.directory(targetPath(relative));
      while (directory.length > outputRoot.length
        && directory.startsWith(outputPrefix)) {
        candidates.set(directory, true);
        directory = Path.directory(directory);
      }
    }
    final directories = sortedKeys(candidates);
    directories.sort((left, right) -> right.length - left.length);
    for (directory in directories) {
      if (!FileSystem.exists(directory) || !FileSystem.isDirectory(directory))
        continue;
      if (FileSystem.readDirectory(directory).length == 0)
        FileSystem.deleteDirectory(directory);
    }
  }

  function relativePath(path: String): String {
    final absolute = absolutePath(path);
    if (!absolute.startsWith(outputPrefix))
      throw new haxe.Exception(
        'Genes output path escapes $outputRoot: $absolute');
    return validateRelative(absolute.substr(outputPrefix.length));
  }

  function targetPath(relative: String): String {
    return relative.length == 0 ? outputRoot : outputPrefix + relative;
  }

  function stagePath(relative: String): String {
    final root = outputPrefix + stageRelative;
    return relative.length == 0 ? root : root + '/' + relative;
  }

  static function validateRelative(path: String): String {
    final normalized = path.replace('\\', '/');
    if (normalized.length == 0 || normalized.startsWith('/')
      || normalized.indexOf('\x00') != -1
      || normalized.indexOf('\n') != -1
      || normalized.indexOf('\r') != -1)
      throw new haxe.Exception('Invalid Genes output path: $path');
    final segments = normalized.split('/');
    for (segment in segments)
      if (segment.length == 0 || segment == '.' || segment == '..')
        throw new haxe.Exception('Invalid Genes output path: $path');
    if (segments[0].startsWith('.genes-output-'))
      throw new haxe.Exception('Genes output path uses a reserved name: $path');
    return normalized;
  }

  static function absolutePath(path: String): String {
    return Path.normalize(FileSystem.absolutePath(path)).replace('\\', '/');
  }

  static function safeScope(value: String): String {
    final result = new StringBuf();
    for (index in 0...value.length) {
      final code = value.charCodeAt(index);
      final allowed = code >= 'a'.code && code <= 'z'.code
        || code >= 'A'.code && code <= 'Z'.code
        || code >= '0'.code && code <= '9'.code
        || code == '-'.code || code == '_'.code || code == '.'.code;
      result.addChar(allowed ? code : '_'.code);
    }
    final scope = result.toString();
    return scope.length == 0 ? 'output' : scope;
  }

  static function withoutCarriageReturn(value: String): String {
    return value.endsWith('\r') ? value.substr(0, value.length - 1) : value;
  }

  static function sortedKeys<T>(values: Map<String, T>): Array<String> {
    final result = [for (key in values.keys()) key];
    result.sort(Reflect.compare);
    return result;
  }

  static function ensureDirectory(path: String): Void {
    if (path.length > 0 && !FileSystem.exists(path))
      FileSystem.createDirectory(path);
  }

  static function deleteTree(path: String): Void {
    if (!FileSystem.exists(path))
      return;
    if (!FileSystem.isDirectory(path)) {
      FileSystem.deleteFile(path);
      return;
    }
    for (entry in FileSystem.readDirectory(path))
      deleteTree(Path.join([path, entry]));
    FileSystem.deleteDirectory(path);
  }
}
