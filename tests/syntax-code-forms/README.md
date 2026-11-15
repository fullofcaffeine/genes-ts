# Raw-code forms that Genes prints itself

Run it with:

```bash
yarn test:syntax-code-forms
```

## The question this fixture answers

Haxe has three ways to put target text into JavaScript output without
checking it:

- `js.Syntax.code(template, values...)`;
- `__js__(template, values...)`, the old name of the same helper, which older
  code and externs still use through `untyped`;
- `__resources__()`, the compiler intrinsic behind `haxe.Resource`.

Genes used to print only two of their shapes itself: `js.Syntax.code` with a
literal template and at least one value, and `__js__` with one literal
identifier. It handed every other shape to Haxe's own JavaScript printer.

That printer is a black box. Genes cannot tell which names or compiler
settings its text depends on, so incremental generation cannot prove that a
module it helped to print is unchanged. Such a module is printed again after
every edit. The Haxe standard library uses the first shape, so `genes.Register`
and `js.Boot` were in that state in almost every build.

The fixture proves that Genes now prints these shapes itself and that the
bytes did not change.

## The shapes

"Before" is the old path. Every "Genes" row is printed without Haxe's printer.

| Shape | Example | Output | Before | Now | Checked by |
| --- | --- | --- | --- | --- | --- |
| `js.Syntax.code`, literal template, values | `js.Syntax.code("console.log({0})", x)` | `console.log(x)` | Genes | Genes, unchanged | `Main.hx`, older suites |
| `js.Syntax.code("$global")` | `js.Lib.global` | `Register.$global` | Genes | Genes, unchanged | older suites |
| `js.Syntax.code`, literal template, no value | `js.Syntax.code("[{{a: 1}}]")` | `[{a: 1}]` | Haxe | Genes, same bytes | `ZeroArgument.hx`, `expected/` |
| `__js__`, one literal identifier | `__js__("Infinity")` | `Infinity` | Genes | Genes, unchanged | `LegacyJs.hx`, `expected/` |
| `__js__`, other literal template, no value | `__js__("Math.max(1, 2)")` | `Math.max(1, 2)` | Haxe | Genes, same bytes | `LegacyJs.hx`, `expected/` |
| `__js__`, literal template, values | `__js__("{0} * 2", a + b)` | `(a + b) * 2` | Haxe | Genes; same bytes except two value layouts | `LegacyJs.hx`, `LegacyJsValues.hx` |
| `__resources__()`, no resource | `haxe.Resource` | `[]` | Haxe | Genes, same bytes | `Resources.hx` |
| `__resources__()`, one resource | `-resource first.txt@name` | `[{ name : "name", data : "Zmly..."}]` | Haxe | Genes, same bytes | `Resources.hx` |
| `__resources__()`, two or more resources | three `-resource` flags | Haxe's order | Haxe | **Haxe** (see below) | `Resources.hx` |
| Template that is not a string constant | `js.Syntax.code(variable)` | error | Haxe's error | Genes, same text and position | `invalid/` |
| Placeholder without a value | `js.Syntax.code("x = {0}")` | error | Haxe's error, output still published | Genes, same text and position, nothing published | `invalid/` |
| `__js__()` without arguments | `__js__()` | error | Haxe's error | Genes, same text and position | `invalid/` |

### The template rules

Haxe's printer reads a template from left to right
(`Codegen.interpolate_code` in the Haxe compiler). `genes.RawCodeTemplate`
repeats the rules:

- `{{` prints one `{`, and `}}` prints one `}`.
- `{text}` is a placeholder when `text` has no brace and is an integer in
  OCaml's notation: `{0}`, `{12}`, and also `{+1}`, `{0x1}`, `{1_0}`.
- `{text}` with any other text prints unchanged: `{x}`, `{ 0 }`, `{1e3}`.
- Every other brace prints unchanged.

`ZeroArgument.hx` holds one template with all of these cases:
`'{{{x}}} {} }{ {{0}} { 0 } {1e3} {0x} {_1} {a}}'` prints
`'{{x}} {} }{ {0} { 0 } {1e3} {0x} {_1} {a}}'`.

## What still uses Haxe's printer

Only `__resources__()` when the build embeds **two or more** resources.

Haxe prints the entries in the iteration order of a hash table inside the
compiler. With the three resources of this fixture the order is `first`,
`third`, `second`: not the command-line order and not sorted. A macro can read
the resources (`Context.getResources()`), but not that order, so Genes cannot
print the same bytes. A resource name that is not valid UTF-8 takes the same
path.

Why this is rare: only the standard-library module `haxe.Resource` contains
the call. At most one module of a build is affected, only when the build
embeds two or more resources, and nobody edits that module.

A possible later change: print the entries sorted by name. That would remove
the last use of Haxe's printer, but it would change the order that
`haxe.Resource.listNames()` returns. It needs an owner decision and is not
part of this fixture.

## Reviewed differences

1. **Two `__js__` value layouts.** Genes prints a `__js__` value with its
   ordinary value printer, as it does for `js.Syntax.code`. Names, constants,
   calls, static fields, and binary and unary operations give Haxe's bytes.
   `LegacyJsValues.hx` holds the two layouts that differ, in spaces and
   parentheses only:

   | value | Haxe's printer | Genes |
   | --- | --- | --- |
   | `flag ? 10 : 20` | `(flag ? 10 : 20)` | `((flag) ? 10 : 20)` |
   | `[a, b]` | `[a,b]` | `[a, b]` |

   Source maps also gain mappings for `__js__` values.
2. **Errors stop the build.** Haxe reported "Out-of-bounds special parameter"
   without stopping, so Genes still published the output tree. Genes now
   raises the error itself and rolls the output back.
3. **A very large placeholder number is always an error.** Haxe printed
   `{12345678901234567890123}` as text, because the number does not fit its
   integer type. Genes reports it as out of bounds. Write `{{...}}` to print
   such braces.
4. **Haxe 5 preview.** Haxe 5 no longer knows `__js__` and printed a call to a
   function that does not exist. Genes now gives it the Haxe 4 output. This
   fixture runs on the stable Haxe lane only.

## Where the expected files come from

`expected/classic` and `expected/ts` hold the modules `ZeroArgument` and
`LegacyJs` exactly as Haxe's printer emitted them. They were generated from
these sources on commit `48666e15`, the last commit on which Genes handed the
shapes to Haxe (Haxe 4.3.7). They are not regenerated by the code under test.
To check them again, build the fixture on that commit with the arguments in
`scripts/test-syntax-code-forms.ts`.

The resource tables in the script were written by hand from the Haxe compiler
source (`genjs.ml` and `Codegen.bytes_serialize`).

## What the gate checks

In both output profiles (`-D genes.ts` and classic), with zero, one, and three
resources:

- `ZeroArgument` and `LegacyJs` equal the expected files, byte for byte;
- the `haxe.Resource` table equals the hand-written text (zero and one
  resource) or holds all three entries (three resources);
- `genes.HaxePrinterUse` reports no module, or only `haxe.Resource` for three
  resources;
- the classic program and the compiled TypeScript program print the expected
  transcript;
- each case in `invalid/` fails with Haxe's message and position and leaves
  no output directory;
- without `-D no-deprecation-warnings`, each `__js__` call except the
  single-identifier one gets Haxe's deprecation warning exactly once;
- two requests on one warm compilation server give the same tree as a cold
  build and each write their own printer report.

It does not measure build time, and it does not prove incremental generation.

## Seen while writing this fixture, not changed here

`js.Syntax.code` WITH values has always been printed by Genes, with a simpler
rule than Haxe's. Programs depend on its output, so this work did not touch
it. Two differences from stock Haxe exist there:

- A binary value gets no parentheses: `js.Syntax.code("{0} * 2", a + b)`
  prints `a + b * 2`. Stock Haxe prints `(a + b) * 2`.
- `{{` and `}}` are not joined: `js.Syntax.code("{{0}}", x)` prints `{x}`.
  Stock Haxe prints `{0}`.

`js.Syntax.plainCode` is not supported by Genes at all (the build stops with
"Unknown js.Syntax method").
