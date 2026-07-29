package react_flight;

import haxe.Constraints.Function;

/**
 * Nominal callable established by a hypothetical non-Next React host.
 *
 * The fixture extension accepts this capability while the same validator
 * rejects an ordinary function with identical shape.
 */
@:callable
abstract HostAction<F:Function>(F) {}
