package genes;

import genes.SourceMapGenerator;
import haxe.io.Path;
import genes.util.Timer.timer;

class Emitter {
  final ctx: genes.Context;
  final writer: Writer;
  final sourceMap: SourceMapGenerator;

  var lastPos = SourcePosition.EMPTY;
  var lastWriterLine = -1;

  public function new(ctx: Context, writer: Writer,
      ?sourceMap: SourceMapGenerator) {
    this.ctx = ctx;
    this.writer = writer;
    this.sourceMap = if (sourceMap == null) new SourceMapGenerator() else
      sourceMap;
  }

  public function emitPos(pos: SourcePosition) {
    #if (debug || js_source_map)
    switch pos {
      case null | {file: '?'}:
      case {column: column, line: line, file: file}:
        if (lastPos.column != column || lastPos.line != line
          || lastWriterLine != writer.line)
          sourceMap.addMapping(pos, {
            line: writer.line,
            column: writer.column,
            file: null
          });
        lastPos = pos;
        lastWriterLine = writer.line;
    }
    #end
  }

  /**
   * Maps a later generated token even when it reuses the current source span.
   *
   * Why: one Haxe expression can own several tokens on the same generated
   * line. The ordinary `emitPos()` path coalesces repeated positions to keep
   * maps compact, but that would leave a relocated token owned by an earlier
   * statement keyword.
   *
   * What/How: invalidate only the line-based de-duplication hint, then route
   * through the virtual `emitPos()` method. Profile emitters still control
   * whether the current member is allowed to publish source provenance.
   */
  public function emitTokenPos(pos: SourcePosition) {
    lastWriterLine = -1;
    emitPos(pos);
  }

  public function write(data: String) {
    writer.write(data);
  }

  /**
   * Finalizes this emitter's source-map reference and complete map artifact.
   *
   * Why: maps describe the exact buffered output and must be published or
   * rolled back with that output; writing them directly used to let maps drift
   * from implementation/declaration files after later compiler failures.
   *
   * What/How: append the relative `sourceMappingURL` before the writer closes,
   * then either register serialized map text with the active transaction or
   * retain the direct-write fallback for standalone emitter callers.
   */
  public function emitSourceMap(path: String, withSources = false,
      ?outputTransaction: OutputTransaction) {
    if (writer.isEmpty())
      return;
    final endTimer = timer('emitSourceMap');
    final output = Path.withoutDirectory(path);
    write('\n//# sourceMappingURL=$output');
    if (outputTransaction == null)
      sourceMap.write(path, withSources);
    else
      outputTransaction.writeContent(path,
        sourceMap.serialize(path, withSources));
    endTimer();
  }

  public function finish() {
    writer.close();
  }
}
