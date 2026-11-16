package inc;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
import sys.FileSystem;
import sys.io.File;

/**
 * Defines the class `inc.Clone` in an after-typing callback of every request.
 * While the file `clone-copy.flag` exists in the working folder, the new
 * class gets the complete metadata of the `inc.Clone` of the previous request,
 * the Genes epoch stamp included.
 *
 * Why: this is the copied-stamp hole of the generation cache (item 1 of the
 * review of #243). The new class is another object, but it carries a stamp
 * that names it, so its epochs equal the stored ones. Its body comes from
 * `res/clone.txt`, so an edit of that file changes its output without any
 * Haxe edit. Only the same-object test of the kept bucket sees that the
 * object changed; a replay of the stored output would publish the old body.
 *
 * Without the flag the class is new in every request and arrives without a
 * stamp, like `inc.Late`.
 */
class CloneMacro {
  static var defined = false;
  @:persistent static var lastMeta: Null<Array<MetadataEntry>> = null;

  public static function install(): Void {
    defined = false;
    Context.onAfterTyping(_ -> {
      if (defined)
        return;
      defined = true;
      final pos = Context.currentPos();
      final earlier = lastMeta;
      final copy = FileSystem.exists('clone-copy.flag') && earlier != null;
      final text = StringTools.trim(File.getContent('res/clone.txt'));
      Context.defineType({
        pack: ['inc'],
        name: 'Clone',
        pos: pos,
        meta: copy ? earlier : [{name: ':keep', pos: pos}],
        kind: TDClass(),
        fields: [
          {
            name: 'value',
            access: [APublic, AStatic],
            kind: FFun({
              args: [],
              ret: macro : String,
              expr: macro return $v{text}
            }),
            pos: pos
          }
        ]
      });
    });
    Context.onGenerate(types -> {
      for (type in types)
        switch type {
          case TInst(_.get() => cls, _) if (cls.module == 'inc.Clone'):
            lastMeta = cls.meta.get();
          default:
        }
    });
  }
}
#end
