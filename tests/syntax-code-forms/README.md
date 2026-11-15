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
| `__js__`, literal template, every value a plain expression | `__js__("{0} * 2", a + b)` | `(a + b) * 2` | Haxe | Genes; the template is the same, each value is printed by Genes (see "Reviewed differences") | `LegacyJs.hx`, `LegacyJsValues.hx` |
| `__js__`, a value that is not a plain expression | `__js__("{0} + 1", throw text)` | Haxe's text | Haxe | **Haxe**, same bytes (see below) | `LegacyJsStatements.hx`, `expected/` |
| `__resources__()`, no resource | `haxe.Resource` | `[]` | Haxe | Genes, same bytes | `Resources.hx` |
| `__resources__()`, one resource | `-resource first.txt@name` | `[{ name : "name", data : "Zmly..."}]` | Haxe | Genes, same bytes | `Resources.hx` |
| `__resources__()`, two or more resources | three `-resource` flags | Haxe's order | Haxe | **Haxe** (see below) | `Resources.hx` |
| Template that is not a string constant | `js.Syntax.code(variable)` | error | Haxe's error | Genes, same text and position | `invalid/` |
| Placeholder without a value | `js.Syntax.code("x = {0}")` | error | Haxe's error, output still published | Genes, same text and position, nothing published | `invalid/` |
| `__js__()` without arguments | `__js__()` | error | Haxe's error | Genes, same text and position | `invalid/` |
| `return`, `break` or `continue` as a `__js__` value | `__js__("void {0}", break)` | error | Haxe's error | Haxe's error, unchanged | `invalid/` |

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

Two forms, both on purpose.

### 1. `__resources__()` when the build embeds two or more resources

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
this use of Haxe's printer, but it would change the order that
`haxe.Resource.listNames()` returns. It needs an owner decision and is not
part of this fixture.

### 2. A `__js__` call with a value that is not a plain expression

Before Genes sees a program, Haxe rewrites every expression so that a
statement never stands where a value is expected. For example,
`var x = try f() catch (e) 0` becomes a `try` statement that assigns `x`.
Genes' value printer relies on that rewrite.

Haxe does not rewrite the arguments of `__js__`: it treats a call of an
unknown identifier as opaque. A `__js__` value can therefore be a `throw`, a
loop, a `switch`, a `try`, a block, or a function whose body was never
rewritten. Genes' value printer has no sound output for these. An earlier
state of this work printed them anyway; a `throw` value then stopped the
build with "Stack overflow".

The rule (`ExprEmitter.isPlainRawCodeValue`): Genes prints a `__js__` call
itself only when every value is a **plain expression**, built from constants,
locals, field and array reads, calls, `new`, unary and binary operations,
conditionals, array and object literals, parentheses, casts, metadata, and
enum reads. If one value is anything else, the whole call goes to Haxe's
printer, exactly as before this work, with the same bytes.

| Value kind | Printed by | Function in `LegacyJsStatements.hx` |
| --- | --- | --- |
| plain expression | Genes | (`LegacyJs.hx`, `LegacyJsValues.hx`) |
| `throw` | Haxe | `plainThrow`, `branchThrow`, `coalesceThrow` |
| `switch` | Haxe | `switchThrow` |
| `try` with a catch of everything | Haxe | `anyCatch` |
| `try` with a typed catch | Haxe | `typedCatch` |
| `while`, `do`/`while` | Haxe | `whileLoop`, `doWhileLoop` |
| `for` | Haxe | `forLoop` |
| block | Haxe | `blockValue` |
| `var` | Haxe | `varValue` |
| function expression | Haxe | `functionValue` |
| `return`, `break`, `continue` | Haxe, which rejects them | `invalid/` |

Values that Haxe itself turns into a block before printing are declined in
the same way: `a++` on a captured local, `n ?? 3`, `Std.downcast`, and an
inlined loop such as `arr.map`.

Why this is rare: `__js__` is a deprecated helper, and a statement as its
value is unusual even in old code. `genes.HaxePrinterUse` names each module
that has such a call.

Two properties of Haxe's printer stay as they were for these calls:

- It prints a method value as `$bind(this,this.method)`, a name that Genes
  output does not define.
- When it raises an error, the build ends at once and Genes cannot remove its
  private staging folder (`.genes-output-*.stage`). No public file is
  written.

## Reviewed differences

### 1. A plain `__js__` value is printed by Genes

Genes prints each plain-expression value of a `__js__` call with its ordinary
value printer, as it does for `js.Syntax.code`. Haxe's printer printed the
value before. (A call with any other value is not affected; see "What still
uses Haxe's printer".)

**Same bytes:** local names, constants (numbers, strings, `null`), calls,
static fields, binary and unary operations, and the parentheses that Haxe
puts around a binary, unary, or conditional value.

**One change of behavior, TypeScript profile only.** A value follows the
genes-ts rule for missing values: an optional field is read as `null`, where
JavaScript gives `undefined`.

| Haxe | Haxe's printer | Genes, classic | Genes, TypeScript |
| --- | --- | --- | --- |
| `__js__("{0} === undefined", options.limit)` | `options.limit === undefined` | `options.limit === undefined` | `(options.limit ?? null) === undefined` |

For a missing field the TypeScript output now answers `false`, and
`__js__("{0} + 1", options.limit)` gives `1` instead of `NaN`.
`js.Syntax.code` with values has always done this, so both helpers now agree.
Raw code that must see `undefined` can read the field inside the template:
`__js__("{0}.limit === undefined", options)`. `LegacyJsValues.isMissing` pins
the text and the result of both profiles.

**Other layout, same result.** `LegacyJsValues.hx` holds the first three; the
fourth was compared by hand against Haxe's printer during review.

| Value | Haxe's printer | Genes |
| --- | --- | --- |
| conditional `flag ? 10 : 20` | `(flag ? 10 : 20)` | `((flag) ? 10 : 20)` |
| array literal `[a, b]` | `[a,b]` | `[a, b]` |
| object literal `{size: a}` | `{ size : a}` | `{"size": a}` |
| `js.Syntax.strictEq(a, b)` | `((a) === b)` | `((a) === (b))` |

In the TypeScript profile a value also gets the profile's usual type text;
for example, an indexed read is `arr[0]!`.

**Two plain values that were wrong before and are right now.**

- A method used as a value, `__js__("{0}.call(null)", method)`: Haxe's
  printer wrote `$bind(this,this.method)`, a name that Genes output does not
  define. Genes writes `Register.bind(this, this.method)`.
- A checked cast as a value, `__js__("{0}.foo", cast(d, String))`: the build
  stopped with "Type not found". It now compiles.

Source maps also gain mappings for these values.

### 2. Errors stop the build

Haxe reported "Out-of-bounds special parameter" without stopping, so Genes
still published the output tree. Genes now raises the error itself and rolls
the output back.

### 3. A very large placeholder number is always an error

Haxe printed `{12345678901234567890123}` as text, because the number does not
fit its integer type. Genes reports it as out of bounds. Write `{{...}}` to
print such braces.

### 4. Haxe 5 preview

Haxe 5 no longer knows `__js__` and printed a call to a function that does
not exist. Genes now gives it the Haxe 4 output, except for a call that
stays on Haxe's printer. This fixture runs on the stable Haxe lane only.

### 5. The `__js__` deprecation warning cannot be turned off by class

Genes reports "(WDeprecated) __js__ is deprecated, use js.Syntax.code
instead" at the same calls as Haxe did. A macro can report a warning but
cannot choose its warning class, so Haxe treats it as a general warning:

- `-D no-deprecation-warnings` still removes it (Genes checks the define);
- `-w -WDeprecated` **no longer** removes it, and
  `@:haxe.warning("-WDeprecated")` on the field does not remove it either.

The form with one literal identifier, such as `__js__("process")`, stays
silent as before. For a call that stays on Haxe's printer (a value that is
not a plain expression), Haxe reports the warning itself, with its class.

## Where the expected files come from

`expected/classic` and `expected/ts` hold the modules `ZeroArgument`,
`LegacyJs` and `LegacyJsStatements` exactly as Haxe's printer emitted them.
They were generated from these sources with the `ExprEmitter.hx` of commit
`48666e15`, the last state in which Genes handed the shapes to Haxe
(Haxe 4.3.7). They are not regenerated by the code under test.
To check them again, build the fixture on that commit with the arguments in
`scripts/test-syntax-code-forms.ts`.

The resource tables in the script were written by hand from the Haxe compiler
source (`genjs.ml` and `Codegen.bytes_serialize`).

## What the gate checks

In both output profiles (`-D genes.ts` and classic), with zero, one, and three
resources:

- `ZeroArgument`, `LegacyJs` and `LegacyJsStatements` equal the expected
  files, byte for byte;
- the `haxe.Resource` table equals the hand-written text (zero and one
  resource) or holds all three entries (three resources);
- `genes.HaxePrinterUse` reports only `syntaxcodeforms.LegacyJsStatements`,
  the module that holds the declined `__js__` values, plus `haxe.Resource`
  for three resources;
- `LegacyJsValues` holds the reviewed text of each plain value that Genes
  prints differently, among them the optional field;
- every function of `LegacyJsStatements` runs in both profiles: a plain
  `throw`, a throwing branch, a `switch` with a throwing default, a typed
  catch, the loops, a block, and function expressions;
- the classic program and the compiled TypeScript program print the expected
  transcript; the two transcripts differ in one entry, the missing optional
  field of `LegacyJsValues.isMissing`;
- each case in `invalid/` fails with Haxe's message and position and leaves
  no output directory; the three cases that Haxe itself rejects leave no
  public file;
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
