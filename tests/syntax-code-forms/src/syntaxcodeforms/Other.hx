package syntaxcodeforms;

/**
 * A second module, so that a placeholder argument can name an import.
 *
 * `LegacyJs` passes `Other.counter` and `Other.two()` into raw code. The
 * emitted text must then use the imported `Other` binding.
 */
class Other {
  public static var counter = 40;

  public static function two(): Int
    return 2;
}
