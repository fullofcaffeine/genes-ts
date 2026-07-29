package genes.react.flight.v19;

#if macro
import haxe.macro.Type;

/**
 * Framework-neutral macro policy for host-proven React transport values.
 *
 * Genes calls this only for unknown nominal class or abstract shapes. Raw
 * Promises, symbols, functions, broad values, and unresolved types never reach
 * the extension point, so shape alone cannot manufacture provenance.
 */
typedef FlightExtensionPolicy = (type: Type,
  path: String) -> FlightExtensionDecision;
#end
