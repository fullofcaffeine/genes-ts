package inc;

/**
 * A generic structure; `value` has one source position. When another
 * module extends `Envelope<inc.Color>`, the capture of that module writes a
 * fact for this position, and the printed `Envelope<T>` reads it (see
 * "another module extends a generic structure" in the shadow gate).
 */
typedef Envelope<T> = {
  final value: T;
}

/** A second generic structure, extended by `inc.ColorFacts`. */
typedef Bag<T> = {
  final items: T;
}

class Env {
  public static function unwrap<T>(envelope: Envelope<T>): T {
    return envelope.value;
  }
}
