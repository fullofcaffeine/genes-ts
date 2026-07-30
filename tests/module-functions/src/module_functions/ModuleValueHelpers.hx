package module_functions;

/**
 * Provides exact same-module call targets for direct-value initialization.
 *
 * Static methods and constructors execute synchronously when a top-level value
 * calls them. The module-value planner inspects these bodies for unsafe reads,
 * while these controls prove that ordinary helpers with no later-binding read
 * remain legal.
 */
class DirectValueHelper {
  public final value: Int;

  public function new() {
    value = 5;
  }

  public static function constant(): Int {
    return 4;
  }

  public static function invoke(callback: () -> Int): Int {
    return callback();
  }
}

/** Positive control for an exact safe same-module static method call. */
@:genes.moduleValue("staticHelperValue")
final staticHelperValue = DirectValueHelper.constant();

/** Positive control for an exact safe same-module constructor call. */
@:genes.moduleValue("constructorHelperValue")
final constructorHelperValue = new DirectValueHelper().value;

/** Positive control for an exact callback argument invoked by a known helper. */
@:genes.moduleValue("callbackArgumentValue")
final callbackArgumentValue = DirectValueHelper.invoke(() -> 6);

/**
 * Proves branch joins retain possible callbacks without rejecting safe bodies.
 *
 * The time predicate prevents Haxe from folding the branch, while both exact
 * callbacks are independent of direct module values. On ordinary runtimes the
 * first branch produces `2`; either result remains semantically safe.
 */
@:genes.moduleValue("branchCallbackValue")
final branchCallbackValue = {
  var read = () -> 1;
  if (Date.now().getTime() > 0) {
    read = () -> 2;
  } else {
    read = () -> 3;
  }
  read();
};

/**
 * Proves a possibly zero-iteration loop keeps legal callback targets usable.
 */
@:genes.moduleValue("loopCallbackValue")
final loopCallbackValue = {
  var read = () -> 4;
  while (Date.now().getTime() < 0)
    read = () -> 5;
  read();
};
