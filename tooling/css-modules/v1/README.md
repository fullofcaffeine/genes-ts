# Closed CSS Module companions, protocol version 1

This protocol lets Haxe know the exact class names exported by one CSS Module
without making Genes pretend to understand CSS.

## The idea in everyday language

A CSS Module is loaded at runtime as an object:

```ts
import styles from "./card.module.css"

styles.card
styles["error-state"]
```

The difficult part is deciding which keys that object really has. Features such
as `:global`, `composes`, escaped selectors, and processor options can change the
answer. The application's real CSS Modules processor already owns those rules,
so Genes must not guess by scanning the stylesheet.

Instead, the application or framework bridge asks one exact, recorded processor
version for the keys and writes a small manifest. A manifest is just a checked
JSON record containing:

- the exported keys;
- the stylesheet and every other file that affected those keys;
- fingerprints (SHA-256 hashes) of those files so stale information is rejected;
- the processor and configuration identity;
- the Haxe owner, generated module, imported CSS path, and companion type.

`@genes-ts/tooling/css-modules` validates that record and generates a closed
Haxe companion plus a precise per-file TypeScript declaration. “Closed” means
only the listed fields exist: `styles.card` compiles while `styles.missing`
fails in Haxe, and strict TypeScript sees the same required keys.

## Complete one-shot flow

```text
authored card.module.css
  → host-selected CSS Modules processor reports exact keys
  → host writes genes.css-module-exports@1 manifest
  → Genes tooling checks paths, hashes, duplicate identities, and processor identity
  → Genes tooling normalizes list order for deterministic output
  → Genes tooling generates CardStyles.hx and card.module.d.css.ts
  → Haxe checks every styles.<field> access
  → genes.css.CssModule emits one ordinary default import
  → Genes produces TypeScript/TSX or JavaScript/JSX
  → the host's real loader still owns the CSS at build and runtime
```

## Authoring example

The host-generated companion is a normal structural object type:

```haxe
package app.styles;

@:genes.cssModuleCompanion(
  "app.components.Card",
  "./card.module.css",
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
)
typedef CardStyles = {
  final card:String;

  @:native("error-state")
  final errorState:String;

  final title:String;
}
```

Application Haxe imports the runtime object with that explicit type:

```haxe
package app.components;

import app.styles.CardStyles;
import genes.css.CssModule.imported;

function classNames():String {
  final styles:CardStyles =
    imported("./card.module.css", "styles");

  return [styles.card, styles.title, styles.errorState].join(" ");
}
```

The named import keeps this API as a module function rather than an all-static
shell class. The explicit `:CardStyles` is intentional. It gives Haxe completion
and lets the macro prove that this companion belongs to this Haxe module and
this exact stylesheet. Leaving it off fails with a message that shows the
expected form.

The metadata is a consistency marker, not a security signature. Host tooling
must still own the generated companion path and must not accept a hand-written
file merely because it copied the marker.

## Generated TypeScript and JavaScript

The TypeScript profile emits the familiar default import and a closed type:

```ts
import __genes_import_styles from "./card.module.css"
import type { CardStyles } from "../styles/CardStyles.js"

const styles: CardStyles = __genes_import_styles
const names = [styles.card, styles.title, styles["error-state"]].join(" ")
```

```ts
export type CardStyles = {
  card: string
  "error-state": string
  title: string
}
```

Strict TypeScript resolves `card.module.css` through the generated exact
`card.module.d.css.ts` file when the host enables `allowArbitraryExtensions`:

```ts
declare const styles: {
  readonly "card": string
  readonly "error-state": string
  readonly "title": string
}

export default styles
```

A wildcard `Record<string, string>` declaration is deliberately insufficient:
it allows arbitrary keys but cannot prove that required keys exist. The focused
fixture first shows that broad declaration failing strict TypeScript, then
publishes the generated exact declaration and shows the same module passing.
`hostModulePath` must end in `.module.css`; tooling rejects another extension
before deriving the declaration path.

The classic JavaScript profile emits the same runtime import without a runtime
type module:

```js
import __genes_import_styles from "./card.module.css"

const styles = __genes_import_styles
const names = [styles.card, styles.title, styles["error-state"]].join(" ")
```

There is no Genes CSS runtime, registry, parser, copied style object, or second
import system.

## Who owns what

- The CSS Modules processor owns the real export keys and CSS errors.
- The host integration owns processor configuration, path resolution, and the
  real loader/bundler check.
- Genes tooling owns manifest checking and deterministic Haxe companion plus
  exact TypeScript declaration generation.
- The Genes compiler owns the typed import and normal TypeScript/JavaScript
  output.
- Frameworks such as NextJsHx own only their framework-specific placement,
  build, development-server, and browser checks.

## Field names

Runtime keys remain authoritative. Friendly legal Haxe names stay unchanged.
Other keys receive a stable Haxe spelling and `@:native` keeps the exact runtime
property:

| Runtime key | Haxe field | Generated property |
| --- | --- | --- |
| `card` | `card` | `.card` |
| `error-state` | `errorState` | `["error-state"]` |
| `class` | `class_` | `["class"]` |
| `2xl` | `css2xl` | `["2xl"]` |
| `$` | `css24` | `["$"]` |
| `--` | `css2d2d` | `["--"]` |

Keys beginning with `__` or `_hx_` also receive a friendly alias and
`@:native`. Genes reserves those Haxe field prefixes for compiler runtime
details; renaming only the Haxe view keeps the closed type intact while leaving
the real JavaScript key unchanged.

For a punctuation-only key, the suffix after `css` is each printable ASCII
character code in hexadecimal: `$` is hexadecimal `24`, while two `-`
characters become `2d2d`. This keeps the name deterministic without pretending
the punctuation is a legal Haxe identifier.

If two keys would become the same Haxe field, generation stops and names both
keys. It never invents an order-dependent suffix such as `fooBar2`.

Package-less Haxe projects are supported. `Main` may own a companion named
`CardStyles`; in that case the generated file is `CardStyles.hx` and has no
`package` line. Short valid type names such as `UI` are accepted too. Package
segments must be legal lowercase Haxe identifiers and may not be language
keywords; for example, `app.styles.CardStyles` is valid while
`app.import.CardStyles` is rejected.

Version one rejects an exact JavaScript key wrapped in square brackets, such as
`[foo]`. Genes already uses bracket-wrapped `@:native` names to represent a
computed property access (`styles[foo]`). Rejecting this rare shape prevents
Genes from silently reading a different property than the CSS processor
reported.

## Size and number limits

The JSON schema and runtime validator deliberately apply the same bounds:

- text fields, including the runtime request, are at most 16,384 characters;
- source line and column numbers range from 1 through JavaScript's largest
  exactly represented integer (`9,007,199,254,740,991`);
- one manifest reports at most 10,000 source inputs and 10,000 exported keys.

These are defensive input limits, not CSS language rules. Keeping them in both
the public schema and runtime means a host can safely validate and store a
manifest without discovering a different answer only when Genes consumes it.

The schema validates structure, individual values, and basic limits. JSON
Schema cannot say that two entries with different source positions still carry
the same export-name identity. The tooling runtime therefore rejects duplicate
source paths and duplicate export names. It accepts any incoming order and
sorts both lists bytewise before hashing and generation, so processor iteration
order cannot change generated bytes.

## Current limits

Version 1 is deliberately a one-shot building block:

- the host must already have an exact processor-produced manifest;
- version 1 accepts printable ASCII runtime keys, including escaped selectors
  whose processor-reported key is ASCII, except for the bracket-wrapped shape
  explained above;
- Genes does not execute application configuration or discover a processor;
- a wildcard declaration such as `Record<string, string>` is not enough; hosts
  publish the generated exact `.d.css.ts` candidate and enable
  `allowArbitraryExtensions` instead;
- automatically watching for edits, and replacing the companion plus generated
  JavaScript/TypeScript only when the entire new build succeeds, are a later
  tooling step;
- agreement with Next.js, Vite, Webpack, WordPress tooling, or another loader
  must be proven by that host rather than inferred from this manifest;
- Sass, Less, package aliases, query strings, and named CSS exports are outside
  this first reusable contract.

These limits prevent an easy-looking API from promising class names that the
real application would not export.
