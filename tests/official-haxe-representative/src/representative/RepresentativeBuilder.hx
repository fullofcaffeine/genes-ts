package representative;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
#end

/**
 * Builds selected official `unitstd` cases without copying their source.
 *
 * The outer runner verifies each pinned file before Haxe starts. This macro
 * asks the official `UnitBuilder` to preserve its assertion rewrite and source
 * positions, then gives the generated class a fixture-local name.
 */
final class RepresentativeBuilder {
  public static macro function evaluationOrderCase(): Expr {
    return defineCase("genes.representative.unitstd_path",
      "TestEvaluationOrder");
  }

  public static macro function mapCase(): Expr {
    return defineCase("genes.representative.unitstd_path", "TestMap");
  }

  public static macro function stringToolsCase(): Expr {
    return defineCase("genes.representative.unitstd_path", "TestStringTools");
  }

  #if macro
  static function defineCase(sourceDefine: String, typeName: String): Expr {
    final sourcePath = Context.definedValue(sourceDefine);
    if (sourcePath == null || sourcePath.length == 0) {
      Context.error('Missing -D $sourceDefine=<verified upstream file>',
        Context.currentPos());
    }

    final sourcePosition = Context.makePosition({
      file: sourcePath,
      min: 0,
      max: 0
    });
    final body = unit.UnitBuilder.read(sourcePath);
    Context.defineType({
      pack: ["unit", "spec"],
      name: typeName,
      pos: sourcePosition,
      kind: TDClass({
        pack: ["unit"],
        name: "Test"
      }),
      fields: [
        {
          name: "test",
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
    final typePath = {pack: ["unit", "spec"], name: typeName};
    return macro new $typePath();
  }
  #end
}
