package inc;

/**
 * Declarations that the generator adds late (genes-f8vc.9.26, L6 of the
 * review of genes-ts #245).
 *
 * No expression uses them, so dead-code elimination removes them and they
 * are not in the generator's list. A type position in `inc.LateUser` makes
 * the walk of reachability add them to this module. `inc.Mark3Macro`
 * writes metadata on them from another module, after typing.
 */
enum LateEnum {
  Item(data: {q: Int});
  Empty;
}

/** A late class with a structure in the constraint of its type parameter. */
class LateBox<T:{lb: Int}> {}

/**
 * A late class with a type override, so a type position that names it adds
 * no dependency edge. `inc.Mark3Macro` removes the override
 * (`unmarkLateTyped`).
 */
@:ts.type("number")
class LateTyped {}
