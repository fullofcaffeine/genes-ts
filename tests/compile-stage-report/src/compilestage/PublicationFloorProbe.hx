package compilestage;

import genes.OutputTransaction;
import haxe.Json;
import haxe.io.Path;
import sys.FileSystem;
import sys.io.File;

using StringTools;

private typedef PublicationCounters = {
  var files: Int;
  var bytes: Int;
}

/** Externally gated probe for the production output transaction's commit. */
class PublicationFloorProbe {
  static function main(): Void {
    final arguments = Sys.args();
    if (arguments.length != 3)
      throw new haxe.Exception('Expected candidate root, target root, and owner identity');
    final candidateRoot = FileSystem.absolutePath(arguments[0]);
    final targetRoot = FileSystem.absolutePath(arguments[1]);
    final ownerIdentity = arguments[2];
    final transaction = new OutputTransaction(targetRoot, ownerIdentity);
    final counters = {files: 0, bytes: 0};
    stageCandidate(candidateRoot, candidateRoot, targetRoot, transaction,
      counters);

    Sys.stdout().writeString('publication-floor-ready\n');
    Sys.stdout().flush();
    if (Sys.stdin().readLine() != 'go')
      throw new haxe.Exception('Publication floor expected the go command');
    final cpuBefore = Sys.cpuTime();
    transaction.commit();
    final processCpuMs = (Sys.cpuTime() - cpuBefore) * 1000;
    Sys.stdout().writeString(Json.stringify({
      status: 'committed',
      processCpuMs: processCpuMs,
      files: counters.files,
      bytes: counters.bytes
    }) + '\n');
    Sys.stdout().flush();
  }

  static function stageCandidate(candidateRoot: String, directory: String,
      targetRoot: String, transaction: OutputTransaction,
      counters: PublicationCounters): Void {
    final entries = FileSystem.readDirectory(directory);
    entries.sort(Reflect.compare);
    for (entry in entries) {
      if (entry.startsWith('.genes-output-'))
        continue;
      final source = Path.join([directory, entry]);
      if (FileSystem.isDirectory(source)) {
        stageCandidate(candidateRoot, source, targetRoot, transaction,
          counters);
        continue;
      }
      final relative = Path.normalize(source.substr(candidateRoot.length + 1));
      final content = File.getContent(source);
      transaction.writeContent(Path.join([targetRoot, relative]), content);
      counters.files++;
      counters.bytes += FileSystem.stat(source).size;
    }
  }
}
