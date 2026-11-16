package inc;

/** A subclass in a third module: its override of `rare` lives or dies with the base method. */
class Derived extends Base {
  override public function rare(): String {
    return "derived-rare";
  }
}
