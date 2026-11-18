package inc;

/**
 * A class with a type override that no expression uses (genes-f8vc.9.27,
 * M2a of the review of genes-ts #246). Dead-code elimination removes it, so
 * it is in no generator list. `inc.TsTypedUser` names it in a typedef field,
 * and the TypeScript printer of that module prints the override without a
 * dependency edge, so the walk never adds this class as a member.
 * `inc.UnlistedMacro` changes the override from another module after typing.
 */
@:ts.type("number")
class TsTyped {}
