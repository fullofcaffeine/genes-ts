package inc;

import inc.PrivA.UsesA;
import inc.PrivB.UsesB;

/*FRESH_IMPORT*/
/**
 * Root of the incremental-generation fixture.
 *
 * Each module below covers one kind of scripted edit of
 * `scripts/test-compiler-server-shadow.ts`. The markers in comments are the
 * places that the script replaces.
 */
class Main {
  public static function main(): Void {
    final parts = [
      Shared.label("main"),
      A.run(),
      B.run(),
      C.run(),
      Ui.render("main") != null ? "ui" : "none",
      User.describe(),
      ChainUser.read({
        x: 1
      }),
      GenericUse.use(),
      MacroUser.loadedName(),
      Std.string(Built.kind),
      First.value(),
      Exposed.value(),
      Std.string(Features.sum([1, 2])),
      UsesA.value() + UsesB.value(),
      Std.string(Locals.compute(3)),
      Directive.value(),
      GlobalUse.value(),
      EnumCheck.value(Square),
      BaseUser.run(),
      Std.string(PropUser.run()),
      Std.string(GenericMethodUse.run()),
      parted.Parted.value(),
      Extras.value() /*FRESH_USE*/
    ];
    trace(parts.join(","));
  }
}
