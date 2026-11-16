package inc;

#if macro
import haxe.macro.Context;

/**
 * Defines the class `inc.Late` in an after-typing callback of every request.
 *
 * Why: the shadow must never call a module clean when no stamp shows that
 * Haxe kept it (G2 design review, required change 2). A type that a macro
 * defines after typing is the first place to look for such a module. Haxe
 * 4.3.7 gives a new type to the after-typing callbacks again
 * (`Finalization.finalize` repeats them until no type is new), so
 * `inc.Late` arrives without a stamp, gets one, and counts as typed again
 * in every request. The gate requires that it is emitted and dirty.
 *
 * The flag is an ordinary static, so Haxe resets it at the start of each
 * compilation and every request defines the class once.
 */
class LateMacro {
  static var defined = false;

  public static function install(): Void {
    defined = false;
    Context.onAfterTyping(_ -> {
      if (defined)
        return;
      defined = true;
      final pos = Context.currentPos();
      Context.defineType({
        pack: ['inc'],
        name: 'Late',
        pos: pos,
        meta: [{name: ':keep', pos: pos}],
        kind: TDClass(),
        fields: [
          {
            name: 'value',
            access: [APublic, AStatic],
            kind: FFun({
              args: [],
              ret: macro : String,
              expr: macro return "late-v1"
            }),
            pos: pos
          }
        ]
      });
    });
  }
}
#end
