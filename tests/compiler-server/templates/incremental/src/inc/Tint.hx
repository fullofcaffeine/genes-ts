package inc;

/**
 * Stage 3, slice S2: a class that is concrete only while a module uses it at
 * run time. `inc.Tinted.TintAlias` names it.
 */
class Tint {
  public final shade: Int;

  public function new() {
    shade = 3;
  }
}
