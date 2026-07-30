package portable;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
#end

/**
 * Builds one official `unitstd` smoke case from the pinned upstream file.
 *
 * Why: Haxe's `*.unit.hx` files are assertion bodies rather than standalone
 * modules. The official suite turns them into `unit.Test` subclasses through
 * `unit.UnitBuilder`; copying or translating the body here would lose its
 * upstream source identity.
 *
 * What: `unitStdCase()` reads the exact file selected by the runner, asks the
 * official `UnitBuilder` to preserve its assertion rewrite and source
 * positions, and defines one temporary test class.
 *
 * How: the runner supplies an absolute path through
 * `genes.portable.unitstd_path` after it has verified the pinned Haxe commit
 * and SHA-256. This macro never changes the upstream assertions. A missing
 * path or a duplicate generated type fails during Haxe typing.
 */
final class PortableSmokeBuilder {
  public static macro function unitStdCase(): Expr {
    #if macro
    final sourcePath = Context.definedValue("genes.portable.unitstd_path");
    if (sourcePath == null || sourcePath.length == 0) {
      Context.error("Missing -D genes.portable.unitstd_path=<verified upstream file>",
        Context.currentPos());
    }

    final sourcePosition = Context.makePosition({
      file: sourcePath,
      min: 0,
      max: 0
    });
    final body = unit.UnitBuilder.read(sourcePath);
    Context.defineType({
      pack: ["portable"],
      name: "GeneratedIntIteratorSpec",
      pos: sourcePosition,
      kind: TDClass({
        pack: ["unit"],
        name: "Test"
      }),
      fields: [
        {
          name: "testIntIterator",
          access: [APublic],
          kind: FFun({
            args: [],
            expr: body,
            params: [],
            ret: macro : Void
          }),
          pos: sourcePosition
        }
      ]
    });
    return macro new portable.GeneratedIntIteratorSpec();
    #else
    return macro null;
    #end
  }
}
