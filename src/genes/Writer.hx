package genes;

import haxe.io.Encoding;
import sys.io.File;
import sys.FileSystem;
import haxe.io.Path;
import genes.util.Timer.timer;

using StringTools;

/**
 * Presents one small text-writing contract to compiler emitters.
 *
 * Why: emitters should focus on source text, line/column tracking, and their
 * own semantic plans rather than repeating filesystem setup and buffering.
 *
 * What: a writer accepts text through `write()` and publishes or closes that
 * text through `close()`. The buffered file variant can also avoid replacing
 * an existing file when its complete contents are unchanged.
 *
 * How: filesystem work is delayed until the first streamed write or until a
 * non-empty buffer closes. The unchanged-file comparison is only an
 * optimization: a failed read falls through to the real write, while errors
 * from that write remain visible to the caller.
 */
class Writer {
  final writer: (data: String) -> Void;

  public final close: () -> Void;
  public var line(default, null): Int = 1;
  public var column(default, null): Int = 0;

  public function new(writer, close) {
    this.writer = writer;
    this.close = close;
  }

  public function write(data: String) {
    writer(data);
    #if (debug || js_source_map)
    for (char in data)
      if (char == '\n'.code) {
        line++;
        column = 0;
      } else {
        column++;
      }
    #end
  }

  public function isEmpty() {
    return line == 1 && column == 0;
  }

  public static function fileWriter(file: String) {
    var input: Null<sys.io.FileOutput> = null;
    return new Writer((data : String) -> {
      if (input == null) {
        final dir = Path.directory(file);
        if (!FileSystem.exists(dir))
          FileSystem.createDirectory(dir);
        input = File.write(file);
      }
      input.writeString(data, Encoding.UTF8);
    }, () -> if (input != null) input.close());
  }

  /**
   * Buffers one complete artifact before publishing it to `file`.
   *
   * The optional unchanged-output check deliberately catches only failures
   * while inspecting the previous file. A stale, unreadable, or concurrently
   * replaced prior file must not prevent the compiler from attempting the new
   * write. `File.saveContent` stays outside that catch so permissions, disk
   * exhaustion, and other publication failures still fail the compilation.
   */
  public static function bufferedFileWriter(file: String) {
    var buffer = new StringBuf();
    return new Writer((data : String) -> {
      buffer.add(data);
    }, () -> {
        if (buffer.length == 0)
          return;
        final dir = Path.directory(file);
        if (!FileSystem.exists(dir))
          FileSystem.createDirectory(dir);
        final endTimer = timer('writeToFile');
        final output = buffer.toString();
        #if genes.unchanged_no_rewrite
        try
          if (FileSystem.exists(file) && output == File.getContent(file))
            return endTimer()
        catch (_) {}
        #end
        File.saveContent(file, output);
        endTimer();
      });
  }
}
