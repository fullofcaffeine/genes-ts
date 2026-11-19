package genes;

/**
 * One step of the reachability walk: "the visited module needs this
 * declaration", as plain data.
 *
 * Why: the walk in `Generator` turns each internal edge of a module's
 * `DependencyPlan` into a declaration that must be a member of its output
 * module. Stage 3, slice S2 of incremental generation stores these steps for
 * a module that did not change, so that a later request on a warm compiler
 * server can repeat its part of the walk without building the plan again.
 * A step therefore holds text only: no `Type`, `Ref` or plan.
 *
 * What: `key` is the declaration identity of `DependencyPlan.moduleTypeKey`,
 * for example `class:inc.Den.DenNote`. `module` is the output module that
 * owns it (`inc.Den`). `name` and `typeName` are the two member names that
 * the walk looks for in that module (`BaseType.name` and
 * `TypeUtil.baseTypeName`); they differ for the implementation class of an
 * abstract. The walk reads `typeName` only when no member has `name`, so a
 * recorded step holds it only when its walk read it; an empty `typeName`
 * means "read it from the declaration".
 *
 * How: the live walk builds a step from the typed edge, and the walk with
 * stored edges reads a recorded one. Both are applied by the same code, so
 * the order of the queue and the member decision of `Module.addTypes` are
 * the same for both. Only when a step adds a declaration does the walk need
 * the typed value: the live walk takes it from the edge, and the stored walk
 * finds it again by `key` (`IncrementalShadow.resolveStoredStep`).
 */
typedef WalkStep = {
  final key: String;
  final module: String;
  final name: String;
  final typeName: String;
}
