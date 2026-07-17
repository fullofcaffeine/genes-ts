# Typed template-literal evidence

This fixture compiles one Haxe source through genes-ts and classic Genes. The
TypeScript profile must retain a native template literal so an exact template
type accepts `Main.href`; the ordinary-interpolation control demonstrates the
pre-feature widening failure under `@ts-expect-error`. Both profiles execute
the same escaping and evaluation-order transcript.

`build-invalid.hxml` separately proves that an arbitrary runtime `String` is
not accepted as authored template syntax and reports the stable authoring
diagnostic at the call site.
