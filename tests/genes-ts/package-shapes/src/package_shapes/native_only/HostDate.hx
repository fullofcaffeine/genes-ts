package package_shapes.native_only;

/**
 * A direct binding to JavaScript's built-in `Date` constructor.
 *
 * Why: fixing package-backed `@:native` declarations must not change the
 * separate, useful case where no package is involved.
 *
 * What/How: because this declaration has no `@:jsRequire`, `@:native("Date")`
 * is the complete runtime identity. Genes emits the host global directly and
 * does not create an import.
 */
@:native("Date")
extern class HostDate {
  public function new(milliseconds: Float);
  public function getUTCFullYear(): Int;
}
