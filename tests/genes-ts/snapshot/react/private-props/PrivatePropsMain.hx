/**
 * Proves that a private props typedef resolves from any module.
 *
 * Both modules declare their own private `HiddenProps`. `pk.Widgets` is typed
 * last, so it is the current module of the compiler during generation. The
 * HXX check for `pk.Other` must still find `pk.Other.HiddenProps`.
 */
class PrivatePropsMain {
  static function main() {
    trace(pk.Other.OtherView);
    trace(pk.Widgets.WidgetView);
  }
}
