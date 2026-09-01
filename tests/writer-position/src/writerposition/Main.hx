package writerposition;

import genes.Writer;

/**
 * Protects Writer's exact sink text and generated line and column state.
 *
 * The scan-step ceiling permits one search per write and one additional search
 * per newline. This limit rejects a return to per-character scanning.
 */
class Main {
  static function assertEqual<T>(expected: T, actual: T, label: String): Void {
    if (actual != expected)
      throw '$label: expected $expected, got $actual';
  }

  static function assertPosition(writer: Writer, line: Int, column: Int,
      label: String): Void {
    assertEqual(line, writer.line, '$label line');
    assertEqual(column, writer.column, '$label column');
  }

  static function main(): Void {
    final sink = new StringBuf();
    var closed = false;
    final writer = new Writer(sink.add, () -> closed = true);
    Writer.resetPositionScanSteps();

    assertPosition(writer, 1, 0, 'initial');
    writer.write('');
    assertPosition(writer, 1, 0, 'empty');
    writer.write('alpha');
    assertPosition(writer, 1, 5, 'ascii');
    writer.write('é😀');
    assertPosition(writer, 1, 7, 'unicode');
    writer.write('\r\n');
    assertPosition(writer, 2, 0, 'crlf');
    writer.write('x\ny\n');
    assertPosition(writer, 4, 0, 'multiple newlines');
    writer.write('tail');
    assertPosition(writer, 4, 4, 'tail');
    writer.write('\nlast');
    assertPosition(writer, 5, 4, 'leading newline');
    writer.write('\n');
    assertPosition(writer, 6, 0, 'trailing newline');
    writer.close();

    assertEqual('alphaé😀\r\nx\ny\ntail\nlast\n', sink.toString(), 'sink text');
    assertEqual(true, closed, 'closed');
    assertEqual(13, Writer.positionScanSteps, 'position scan steps');
    Sys.println('writer-position:ok');
  }
}
