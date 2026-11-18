package inc;

/**
 * The class comes first in this module, then two enums that `value` uses at
 * run time, so dead-code elimination keeps them. `inc.ExcludeMacro` makes
 * each enum extern with `exclude()` in a later request. The order matters:
 * the walk adds this module through the class, and adds each enum later
 * through a step from `inc.ExclHintUser`.
 */
class ExclOwner {
  public static function value(): String {
    final early = switch (EarlyTwo(1)) {
      case EarlyOne: "one";
      case EarlyTwo(n): "two" + n;
    }
    final late = switch (LateTwo(2)) {
      case LateOne: "one";
      case LateTwo(n): "two" + n;
    }
    return early + late;
  }
}

/** Made extern before the passes of Genes after typing. */
enum ExclEarly {
  EarlyOne;
  EarlyTwo(n: Int);
}

/** Made extern after the passes of Genes after typing. */
enum ExclLate {
  LateOne;
  LateTwo(n: Int);
}
