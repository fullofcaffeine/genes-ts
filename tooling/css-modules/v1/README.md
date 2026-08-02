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
Haxe companion. “Closed” means only the listed fields exist: `styles.card`
compiles while `styles.missing` fails in Haxe.

## Complete one-shot flow

```text
authored card.module.css
  → host-selected CSS Modules processor reports exact keys
  → host writes genes.css-module-exports@1 manifest
  → Genes tooling checks paths, hashes, ordering, and processor identity
  → Genes tooling generates CardStyles.hx
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
- Genes tooling owns manifest checking and deterministic companion generation.
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

Keys beginning with `__` or `_hx_` also receive a friendly alias and
`@:native`. Genes reserves those Haxe field prefixes for compiler runtime
details; renaming only the Haxe view keeps the closed type intact while leaving
the real JavaScript key unchanged.

If two keys would become the same Haxe field, generation stops and names both
keys. It never invents an order-dependent suffix such as `fooBar2`.

Package-less Haxe projects are supported. `Main` may own a companion named
`CardStyles`; in that case the generated file is `CardStyles.hx` and has no
`package` line.

## Current limits

Version 1 is deliberately a one-shot building block:

- the host must already have an exact processor-produced manifest;
- version 1 accepts printable ASCII runtime keys, including escaped selectors
  whose processor-reported key is ASCII;
- Genes does not execute application configuration or discover a processor;
- a wildcard declaration such as `Record<string, string>` is not enough;
- automatically watching for edits, and replacing the companion plus generated
  JavaScript/TypeScript only when the entire new build succeeds, are a later
  tooling step;
- agreement with Next.js, Vite, Webpack, WordPress tooling, or another loader
  must be proven by that host rather than inferred from this manifest;
- Sass, Less, package aliases, query strings, and named CSS exports are outside
  this first reusable contract.

These limits prevent an easy-looking API from promising class names that the
real application would not export.
