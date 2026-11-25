package inc;

/**
 * Names `inc.ExclTail.ExclTailEnum` only in a typedef field, so the plan of
 * this module has a type-only edge to the enum, and the walk records a step
 * to it (genes-zt9w). The shadow gate names this class on the command line.
 */
typedef ExclHintTailShape = {
  final ?last: inc.ExclTail.ExclTailEnum;
}

@:keep
class ExclHintTail {
  public static function run(): String {
    final hint: Null<ExclHintTailShape> = null;
    return hint == null ? "last" : "hint";
  }
}
