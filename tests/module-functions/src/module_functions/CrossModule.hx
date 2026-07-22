package module_functions;

/**
 * Exercises a real ESM cycle whose static initializer calls a selected method.
 *
 * `Selected` calls this class and this selected body calls `Selected` back.
 * Genes must install `CrossModule.selected` before the initializer executes,
 * while its existing cyclic type accessor must keep `Selected` observable.
 */
@:keep
class CrossModule {
  public static var initialized(default, null): Int = selected(1);

  @:genes.moduleFunction("crossModuleFunction")
  public static function selected(value: Int): Int {
    return value + Selected.crossBase(2);
  }
}
