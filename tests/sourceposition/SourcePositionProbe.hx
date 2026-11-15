package tests.sourceposition;

#if macro
import genes.SourceMapGenerator.SourcePosition;
import genes.SourceMapGenerator.SourcePositionData;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.PositionTools;
import haxe.macro.Type;
#end

/**
 * Compile-time checks that a `genes.SourceMapGenerator.SourcePosition` gives
 * the line, column, and file that Haxe reports for a position.
 *
 * Why at macro time: a `SourcePosition` made from a Haxe position converts
 * that position only when a field is first read. The value exists only in
 * the macro interpreter, and a build without source maps never reads it, so
 * generated output cannot show a wrong late conversion.
 *
 * What it protects: the fields must equal the result of Haxe's own
 * `PositionTools.toLocation`, which is the independent answer here. The
 * probe reads each field first in turn, reads a value twice, and checks that
 * a value made from numbers keeps its numbers.
 *
 * `test.hxml` runs this probe, so `yarn test` fails when a case fails.
 */
class SourcePositionProbe {
  public static macro function validate(): Expr {
    final elements = typedElements(Context.parseInlineString("[10, 20, 30]",
      Context.currentPos()));
    require(elements.length == 3, "Probe setup: expected three typed elements");

    // Each case reads a different field first.
    final lineFirst: SourcePosition = elements[0].pos;
    final expectedFirst = expected(elements[0].pos);
    require(lineFirst.line == expectedFirst.line
      && lineFirst.column == expectedFirst.column
      && lineFirst.file == expectedFirst.file,
      "A position read line first differs from PositionTools.toLocation");

    final columnFirst: SourcePosition = elements[1].pos;
    final expectedSecond = expected(elements[1].pos);
    require(columnFirst.column == expectedSecond.column
      && columnFirst.file == expectedSecond.file
      && columnFirst.line == expectedSecond.line,
      "A position read column first differs from PositionTools.toLocation");

    // A typed expression converts through its position.
    final fileFirst: SourcePosition = elements[2];
    final expectedThird = expected(elements[2].pos);
    require(fileFirst.file == expectedThird.file
      && fileFirst.line == expectedThird.line
      && fileFirst.column == expectedThird.column,
      "A typed expression read file first differs from PositionTools.toLocation");

    require(place(expectedFirst) != place(expectedSecond)
      && place(expectedSecond) != place(expectedThird)
      && place(expectedFirst) != place(expectedThird),
      "Probe setup: the three elements must have different places");

    // A second read returns the values of the first read.
    require(lineFirst.line == expectedFirst.line
      && lineFirst.column == expectedFirst.column
      && lineFirst.file == expectedFirst.file,
      "A second read of one position changed its values");

    // A value made from numbers keeps them and converts nothing.
    final fromNumbers: SourcePositionData = {line: 7, column: 3, file: null};
    require(fromNumbers.line == 7 && fromNumbers.column == 3
      && fromNumbers.file == null,
      "A value made from numbers did not keep its numbers");
    require(SourcePosition.EMPTY.line == 1
      && SourcePosition.EMPTY.column == 0 && SourcePosition.EMPTY.file == null,
      "SourcePosition.EMPTY is not line 1, column 0, no file");
    return macro null;
  }

  #if macro
  /** Returns Haxe's own line, zero-based column, and file of a position. */
  static function expected(position: Position): {
    line: Int,
    column: Int,
    file: String
  } {
    final location = PositionTools.toLocation(position);
    return {
      line: location.range.start.line,
      column: location.range.start.character - 1,
      file: location.file.toString()
    };
  }

  static function place(location: {line: Int, column: Int, file: String}): String {
    return location.line + ":" + location.column;
  }

  /** Types an array literal and returns its typed elements. */
  static function typedElements(literal: Expr): Array<TypedExpr> {
    return switch Context.typeExpr(literal).expr {
      case TArrayDecl(elements): elements;
      default:
        Context.fatalError("SourcePosition probe setup: expected a typed array literal",
          Context.currentPos());
    }
  }

  static function require(condition: Bool, message: String): Void {
    if (!condition)
      Context.fatalError("SourcePosition probe failed: " + message,
        Context.currentPos());
  }
  #end
}
