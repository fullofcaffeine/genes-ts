package inc;

/**
 * Uses `ExclTailEnum` at run time, so dead-code elimination keeps the enum
 * (genes-zt9w). The shadow gate names this class on the command line. The
 * class comes first in the module, so the walk adds the module through it.
 * `inc.ExclHintTail` sorts before this module, so the walk visits it first
 * and takes its step to the enum before it visits this module.
 */
@:keep
class ExclTail {
  public static function value(): String {
    return switch (TailTwo(3)) {
      case TailOne: "one";
      case TailTwo(n): "two" + n;
    }
  }
}

/**
 * The last declaration of its module, and the module has no abstract and
 * no extern declaration (genes-zt9w). `inc.ExcludeMacro` makes it extern
 * with `exclude()` in a later request. `ModuleFingerprint.of` puts an
 * extern enum after the declarations that can be printed; here it is
 * already last, so the text stays the same, and an enum's text has no
 * extern flag. So no fingerprint sees the change, and
 * `IncrementalShadow.checkStoredTarget`, which compares the extern flag of
 * each stored step's target, is the first check that leaves the recorded
 * path.
 */
enum ExclTailEnum {
  TailOne;
  TailTwo(n: Int);
}
