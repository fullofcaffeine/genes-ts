package module_directives;

/**
 * Carries module intent on a module-level function without becoming a
 * generated runtime declaration.
 *
 * Haxe types this declaration as a field on a synthetic `KModuleFields` class.
 * Full DCE removes the unused function, but the compiler must still recover its
 * directives before DCE without retaining the function or its container.
 */
@:genes.moduleDirective("alpha-mode")
@:genes.moduleDirective("beta-mode")
@:genes.moduleDirective("alpha-mode")
function directiveOwner(): Void {}

/** Executes the same ordinary typed program through both output profiles. */
class Main {
  public static function main(): Void {
    HostConsole.log(Support.message());
  }
}
