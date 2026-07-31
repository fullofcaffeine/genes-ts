package module_functions;

import module_functions.DependencyOrderDirect.directOrderValue;
import module_functions.DependencyOrderOrdinary.ordinaryOrderValue;

/**
 * The first argument observes an ordinary module value; the second calls a
 * selected direct function. Their ESM requests must retain that occurrence
 * order because both dependency modules have observable initialization.
 */
class DependencyOrderConsumer {
  public static function value(): Int {
    return add(ordinaryOrderValue, directOrderValue());
  }

  public static function events(): String {
    return DependencyOrderState.events.join(",");
  }

  static function add(left: Int, right: Int): Int {
    return left + right;
  }
}
