package module_directives;

/**
 * Proves that a reachable module-level variable can own its module's plan.
 *
 * Haxe stores this metadata on a synthetic module field rather than the
 * `BaseType` inspected for ordinary classes, enums, abstracts, and typedefs.
 */
@:genes.moduleDirective("support-mode")
final supportMessage = "module-directives:ok";

/** Creates a real module import after the caller's directive prologue. */
class Support {
  public static function message(): String {
    return supportMessage;
  }
}
