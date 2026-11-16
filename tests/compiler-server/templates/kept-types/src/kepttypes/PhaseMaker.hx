package kepttypes;

/**
 * No module imports this one; the after-typing gate names it on the command
 * line. An edit makes it the first caller of `GenericOwner.make` with the
 * type argument `Phase`. `@:keep` keeps it in the output, so the output also
 * has `GenericOwner.make_kepttypes_Phase` and its locals.
 */
@:keep
class PhaseMaker {
  public static function run(): Int {
    return GenericOwner.plain(); // phase-maker-body
  }
}
