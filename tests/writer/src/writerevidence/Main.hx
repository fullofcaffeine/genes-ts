package writerevidence;

import genes.Writer;

/**
 * Runs one direct buffered-writer publication for the filesystem harness.
 *
 * Why: compiler output normally passes through `OutputTransaction`, while the
 * standalone support-module API still exposes `Writer.bufferedFileWriter`.
 * This tiny entry point lets the transaction owner exercise that fallback as
 * an ordinary Haxe 4.3.7 program instead of reimplementing its behavior in
 * JavaScript.
 *
 * What/How: the harness supplies a target path and exact payload. Closing the
 * writer either skips an identical file, replaces it, or propagates the real
 * filesystem error to the Haxe process.
 */
class Main {
  static function main(): Void {
    final arguments = Sys.args();
    if (arguments.length != 2)
      throw new haxe.Exception('Expected target path and payload');

    final writer = Writer.bufferedFileWriter(arguments[0]);
    writer.write(arguments[1]);
    writer.close();
  }
}
