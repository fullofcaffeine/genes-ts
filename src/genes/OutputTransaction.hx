package genes;

import haxe.crypto.Base64;
import haxe.crypto.Sha256;
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
 * exact `-js` filename is the sole authority for stale-file deletion; files
 * absent from that manifest are never removed.
 *
 * How: paths are canonicalized beneath the output directory before admission,
 * and every existing component is checked with `FileSystem.fullPath` before it
 * is read, removed, or replaced. That second check matters because a lexical
 * child can be a symbolic link to an unrelated directory. The staging
 * directory lives on the same filesystem as the destination, so each final
 * move is a rename. The whole set is failure-atomic through backup and rollback
 * rather than a directory swap, because output directories may also contain
 * user assets or artifacts owned by another tool. This class owns filesystem
 * policy only; TS/classic/declaration semantics remain in their existing
 * planners and emitters. Manifest v2 stores the exact owner identity as well as
 * a collision-resistant scope. Older v1 manifests did not record enough
 * identity to migrate safely, so they are preserved rather than guessed from a
 * lossy filename.
 *
 * The full-path comparison rejects links that exist when a transaction checks
 * them; it is not an operating-system no-follow file handle. Callers must keep
 * the existing rule that writers to the same destination are serialized.
 */
class OutputTransaction {
  static inline final MANIFEST_HEADER = 'genes-output-manifest-v2';
  static inline final MANIFEST_OWNER_PREFIX = 'owner-base64:';
  static inline final READABLE_SCOPE_LIMIT = 48;

  final outputRoot: String;
  final outputPrefix: String;
  final ownerIdentity: String;
  final manifestRelative: String;
  final stageRelative: String;
  final outputRootExisted: Bool;
  final staged: Map<String, Bool> = new Map();
  var stagePrepared = false;
  var committed = false;

  /**
   * Creates one filesystem owner for an exact configured output filename.
   *
   * Why: a stem-only name loses the extension, while replacing punctuation
   * with `_` maps distinct entrypoints such as `entry@one.ts` and
   * `entry#one.ts` to the same manifest and stage. One build can then delete
   * files owned by the other as if they were stale.
   *
   * What/How: `entrypointIdentity` is the normalized basename including its
   * extension. The output root already owns the directory part, so this is the
   * complete identity within that root without making generated filenames
   * depend on a machine-local absolute path. A readable prefix is paired with
   * the full SHA-256 digest for filesystem names, and the exact identity is
   * stored inside the manifest for mismatch detection.
   */
  public function new(outputDirectory: String, entrypointIdentity: String) {
    outputRoot = absolutePath(outputDirectory.length == 0
      ? '.'
      : outputDirectory);
    outputRootExisted = FileSystem.exists(outputRoot);
    outputPrefix = outputRoot.endsWith('/') ? outputRoot : outputRoot + '/';
    ownerIdentity = validateOwnerIdentity(entrypointIdentity);
    final scope = safeScope(ownerIdentity);
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
    // A rejected pre-existing stage link is not compiler-owned cleanup. Skip
    // it instead of following it and turning a safe diagnostic into data loss.
    deleteTree(stagePath(''), false);
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

      // Validate the complete public mutation set before the first backup,
      // deletion, or rename. Stale manifest paths need this check too: they may
      // not have appeared in the current emitter run.
      for (relative in sortedKeys(affected))
        assertNoSymlinkTraversal(targetPath(relative));

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

      deleteTree(stagePath(''), true);
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
      deleteTree(stagePath(''), false);
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
    assertNoSymlinkTraversal(path);
    if (!FileSystem.exists(path))
      return [];
    if (FileSystem.isDirectory(path))
      throw new haxe.Exception('Genes output manifest is a directory: $path');

    final lines = File.getContent(path).split('\n');
    if (lines.length == 0 || withoutCarriageReturn(lines[0]) != MANIFEST_HEADER)
      throw new haxe.Exception('Unsupported Genes output manifest: $path');
    if (lines.length < 2
      || withoutCarriageReturn(lines[1]) != manifestOwnerLine())
      throw new haxe.Exception(
        'Genes output manifest owner does not match "$ownerIdentity": $path');

    final seen: Map<String, Bool> = new Map();
    final result = [];
    for (index in 2...lines.length) {
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
    return MANIFEST_HEADER + '\n' + manifestOwnerLine() + '\n'
      + (paths.length == 0 ? '' : paths.join('\n') + '\n');
  }

  function manifestOwnerLine(): String {
    return MANIFEST_OWNER_PREFIX + Base64.encode(Bytes.ofString(ownerIdentity));
  }

  function prepareStageRoot(): Void {
    if (stagePrepared)
      return;
    final root = stagePath('');
    deleteTree(root, true);
    ensureDirectory(root);
    assertNoSymlinkTraversal(root);
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
      assertNoSymlinkTraversal(directory);
      if (FileSystem.readDirectory(directory).length == 0)
        FileSystem.deleteDirectory(directory);
    }
  }

  function relativePath(path: String): String {
    final absolute = absolutePath(path);
    if (!absolute.startsWith(outputPrefix))
      throw new haxe.Exception(
        'Genes output path escapes $outputRoot: $absolute');
    assertNoSymlinkTraversal(absolute);
    return validateRelative(absolute.substr(outputPrefix.length));
  }

  /**
   * Rejects an existing path component that resolves outside its lexical name.
   *
   * Why: `absolutePath` normalizes `.` and `..` but intentionally does not
   * follow links. That is useful for nonexistent destinations, yet insufficient
   * before filesystem mutation because `out/pkg` may point somewhere outside
   * `out`.
   *
   * What/How: walk from the candidate back to this transaction's output root.
   * For each existing path, compare its lexical absolute path with
   * `FileSystem.fullPath`, which resolves links on the POSIX implementations
   * exercised by the transaction fixture. A difference fails closed before
   * publication. Windows comparison is case-insensitive; junction-specific
   * behavior remains owned by its platform fixture rather than inferred from
   * POSIX evidence. This preflight does not replace the compiler's existing
   * same-destination serialization contract.
   */
  function assertNoSymlinkTraversal(path: String): Void {
    final link = firstSymlinkTraversal(path);
    if (link != null)
      throw new haxe.Exception('Genes output path traverses a symbolic link: $link');
  }

  function firstSymlinkTraversal(path: String): Null<String> {
    var current = absolutePath(path);
    final comparableRoot = comparablePath(outputRoot);
    final comparablePrefix = comparableRoot.endsWith('/')
      ? comparableRoot
      : comparableRoot + '/';
    final comparableCandidate = comparablePath(current);
    if (comparableCandidate != comparableRoot
      && !comparableCandidate.startsWith(comparablePrefix))
      throw new haxe.Exception('Genes output path escapes $outputRoot: $current');

    while (true) {
      if (FileSystem.exists(current)) {
        final resolved = absolutePath(FileSystem.fullPath(current));
        if (comparablePath(resolved) != comparablePath(current))
          return current;
      }
      if (comparablePath(current) == comparableRoot)
        return null;
      final parent = absolutePath(Path.directory(current));
      if (comparablePath(parent) == comparablePath(current))
        throw new haxe.Exception('Genes output path escapes $outputRoot: $path');
      current = parent;
    }
  }

  static function comparablePath(path: String): String {
    final normalized = absolutePath(path);
    #if windows
    return normalized.toLowerCase();
    #else
    return normalized;
    #end
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
    final sanitized = result.toString();
    final readable = (sanitized.length == 0 ? 'output' : sanitized)
      .substr(0, READABLE_SCOPE_LIMIT);
    return readable + '-' + Sha256.encode(value);
  }

  static function validateOwnerIdentity(value: String): String {
    final normalized = value.replace('\\', '/');
    if (normalized.length == 0 || normalized.indexOf('/') != -1
      || normalized.indexOf('\x00') != -1
      || normalized.indexOf('\n') != -1
      || normalized.indexOf('\r') != -1
      || normalized == '.' || normalized == '..')
      throw new haxe.Exception(
        'Invalid Genes output transaction owner: $value');
    return normalized;
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

  /**
   * Removes only an ordinary compiler-owned stage tree without following links.
   *
   * Strict cleanup is used before staging and after a successful commit, where
   * any link means private ownership was compromised and must diagnose.
   * Best-effort abort cleanup skips such entries so a hostile pre-existing link
   * cannot redirect recursive deletion into a user directory. Returning
   * `false` tells the parent to remain in place because it still contains an
   * entry the compiler deliberately did not own.
   */
  function deleteTree(path: String, rejectSymlinks: Bool): Bool {
    final link = firstSymlinkTraversal(path);
    if (link != null) {
      if (rejectSymlinks)
        throw new haxe.Exception('Genes output path traverses a symbolic link: $link');
      return false;
    }
    if (!FileSystem.exists(path))
      return true;
    if (!FileSystem.isDirectory(path)) {
      FileSystem.deleteFile(path);
      return true;
    }
    var removed = true;
    for (entry in FileSystem.readDirectory(path))
      if (!deleteTree(Path.join([path, entry]), rejectSymlinks))
        removed = false;
    if (removed)
      FileSystem.deleteDirectory(path);
    return removed;
  }
}
