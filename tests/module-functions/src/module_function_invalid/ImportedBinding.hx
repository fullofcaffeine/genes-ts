package module_function_invalid;

/** External value used only to prove final import-alias collision checks. */
@:jsRequire("module-function-import", "ImportedBinding")
extern class ImportedBinding {
  public static function value(): Int;
}
