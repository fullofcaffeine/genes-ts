package module_directives;

/** Typed by package inclusion but deliberately absent from the runtime graph. */
@:genes.moduleDirective("pruned-mode")
class Pruned {
  public static function unused(): String {
    return "must-not-be-emitted";
  }
}
