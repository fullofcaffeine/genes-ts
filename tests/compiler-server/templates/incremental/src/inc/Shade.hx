package inc;

/**
 * An enum abstract that `inc.ShadeUser` prints as a union of its values
 * (genes-f8vc.9.27, M2b of the review of genes-ts #246). The values are
 * inlined, so dead-code elimination removes the statics of the
 * implementation class. `inc.UnlistedMacro` writes `:value` metadata on one
 * of them from another module after typing.
 */
enum abstract Shade(String) {
  var Light = "light";
  var Dark = "dark";
}
