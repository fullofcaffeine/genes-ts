package module_directives;

/**
 * Carries module intent without becoming a generated runtime declaration.
 *
 * Full DCE removes this private class. The compiler must still recover the
 * directives before DCE, while the metadata itself must not retain this class
 * or create a new output module.
 */
@:genes.moduleDirective("alpha-mode")
@:genes.moduleDirective("beta-mode")
@:genes.moduleDirective("alpha-mode")
private class DirectiveOwner {}

/** Executes the same ordinary typed program through both output profiles. */
class Main {
  public static function main(): Void {
    HostConsole.log(Support.message());
  }
}
