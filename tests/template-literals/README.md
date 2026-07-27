# Typed template-literal evidence

This fixture compiles one Haxe source through genes-ts and classic Genes. The
TypeScript profile must retain a native template literal so an exact template
type accepts `Main.href`; the ordinary-interpolation control demonstrates the
pre-feature widening failure under `@ts-expect-error`. Both profiles execute
the same escaping and evaluation-order transcript.

`build-invalid.hxml` separately proves that an arbitrary runtime `String` is
not accepted as authored template syntax and reports the stable authoring
diagnostic at the call site.

## Late type materialization

`build-late-materialization.hxml` and its classic declaration counterpart
characterize a subtle lifecycle boundary. Genes can add a class after its
module's first dependency/template plan when that class is named only by a
TypeScript or declaration signature. That does not make method bodies appear
late: Haxe's runtime DCE has already removed those bodies. The generated
`ZLateTemplate` class is therefore present but intentionally empty.

The paired negative adds `@:keep` to the malformed method. Retaining executable
code makes Haxe include that body in the generator's initial typed inventory,
so `GENES-TEMPLATE-LITERAL-MARKER-002` is reported before an unrelated
module-function preflight error. Both failures also prove transaction rollback
by leaving the last successful TS/classic output trees byte-identical.

This is why `Module.addTypes` does not invalidate `TemplateLiteralPlan`: the
late path can add declaration shape, but it cannot add a new executable marker
expression. If Haxe changes that DCE boundary in a supported lane, this focused
test must fail before maintainers add cache invalidation speculatively.
