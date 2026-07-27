package template_late;

/**
 * Keeps the owner method at runtime while using its result only as a type.
 *
 * The optional blocker gives the harness a later planning error. It is not
 * enabled for the successful characterization build.
 */
class Main {
  static function main():Void {
    final owner = new ZLateOwner();
    owner.lateValue();
    #if late_template_blocker
    new ALateBlocker().invalidInstanceFunction();
    #end
  }
}
