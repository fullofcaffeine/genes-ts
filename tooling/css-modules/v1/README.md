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

## Installed closure evidence

The manifest separates processor code from processor configuration.
`processorIntegrity` identifies the implementation that the provider admitted
to run. `configurationSha256` identifies the normalized, data-only options that
the processor used.

A package version, lock file, registry checksum, or declared dependency graph
cannot establish final processor identity. Those facts can stay constant while
local package bytes or runtime module resolution change.

Tooling provides a narrower prerequisite. It can capture the installed package
closure under the `node-modules-realpath-v1` profile. This profile uses ordinary
ancestor `node_modules` directories and default realpath behavior. Nonempty
`NODE_OPTIONS`, `NODE_PATH`, `NODE_PRESERVE_SYMLINKS`,
`NODE_PRESERVE_SYMLINKS_MAIN`, and Plug'n'Play cause failure. The profile also
rejects the
`--loader`, `--experimental-loader`, `--import`, `--require`, `-r`,
`--preserve-symlinks`, and `--preserve-symlinks-main` process flags.
Internal package links and invalid package roots also cause failure.

The installed closure contains fixed roots, declared runtime dependencies,
present optional dependencies, resolved peers, and optional absence. It also
contains every package-owned regular file except files below nested
`node_modules` directories. The canonical SHA-256 SRI contains logical
dependency paths and exact file hashes. It does not contain installation paths,
timestamps, inode numbers, or package manager layout. Equivalent hoisted,
nested, or package-root-link layouts therefore keep one installed-closure
identity.

Package file names must have one lossless UTF-8 representation. Control
characters, backslashes, and the Unicode replacement character cause failure.

Each capture has reviewed maximums and caller-selected lower limits for
packages, dependency edges, directory entries, files, bytes, and path lengths.
It reads directories incrementally, charges package metadata to the same byte
budget, and processes dependency maps and peer metadata under the edge limit.
Package metadata reads ignore inherited host properties and unrelated fields.
Each complete pass resolves the base directory and every package locator again.
The capture does not use a path, size, or timestamp cache.

Installed-closure identity is not final `processorIntegrity`. Package metadata
can omit a module that Node later loads, and equal endpoint snapshots cannot
prove which transient bytes executed. A provider must separately constrain
execution to measured module bytes. The provider returns no manifest when it
cannot prove that admission. Registry-pristine policy remains with the host.

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
before deriving the declaration path. It must also be the path reached by
resolving `request` from the directory containing `generatedModule`, after an
optional host output-root prefix. For example,
`css_module_companions/Main` plus `./card.module.css` may map to
`src-gen/css_module_companions/card.module.css`, but not to
`src-gen/other/card.module.css`. This keeps the exact declaration beside the
CSS file TypeScript resolves for the emitted import.

`generatedModule` is not an independent alias. It must equal `haxeOwner` with
dots replaced by slashes: `app.Main` maps to `app/Main`. Otherwise Haxe emits
the owner module in one directory while tooling places the CSS declaration for
another directory.

`companionType` must name a different Haxe module from `haxeOwner`. For example,
`app.Card` may own `app.CardStyles`, but it may not also use `app.Card` as its
companion. Reusing the name would make the generated companion and the authored
component compete for the same `.hx` path. The public schema documents this
relationship, and the tooling validator performs the cross-field comparison.

`source.entry` is the actual `.module.css` file described by the manifest. It
must also appear in `source.inputs` with its SHA-256 hash. A different project
file cannot stand in for the stylesheet merely because its current hash is
valid.

All manifest file paths are project-relative and use forward slashes. Colons
and backslashes are rejected so a path such as `C:/card.module.css` cannot be
reinterpreted as a Windows drive path after moving between hosts.

The classic JavaScript profile emits the same runtime import without a runtime
type module:

```js
import __genes_import_styles from "./card.module.css"

const styles = __genes_import_styles
const names = [styles.card, styles.title, styles["error-state"]].join(" ")
```

There is no Genes CSS runtime, registry, parser, copied style object, or second
import system.

When a classic build enables `-D dts`, Genes also emits ordinary `.d.ts` files
for TypeScript consumers. The maintained fixture exposes one function returning
the closed `CardStyles` type and checks that the classic declaration retains
those exact properties without an arbitrary-key fallback.

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
the same export-name identity, nor can it compare `companionType` with
`haxeOwner` or resolve `request` relative to `generatedModule` and compare that
result with `hostModulePath`. The tooling runtime therefore performs those
comparisons and rejects duplicate source paths, duplicate export names, a
companion that reuses the authored owner module, or a declaration path that
would not accompany the emitted CSS import. It accepts any incoming order and
sorts both lists bytewise before hashing and generation, so processor iteration
order cannot change generated bytes.

## Current limits

Version 1 remains a manifest and companion building block:

- the host must already have an exact processor-produced manifest;
- version 1 accepts printable ASCII runtime keys, including escaped selectors
  whose processor-reported key is ASCII, except for the bracket-wrapped shape
  explained above;
- Genes does not execute application configuration or discover a processor;
- a wildcard declaration such as `Record<string, string>` is not enough; hosts
  publish the generated exact `.d.css.ts` candidate and enable
  `allowArbitraryExtensions` instead;
- a host may now combine it with `@genes-ts/tooling/session` so CSS edits create
  a private companion, Haxe checks that exact companion, the real loader checks
  the candidate, and all accepted files publish together;
- Genes still does not automatically choose a processor, discover CSS files,
  or decide which CSS/configuration files a host should watch;
- agreement with Next.js, Vite, Webpack, WordPress tooling, or another loader
  must be proven by that host rather than inferred from this manifest;
- Sass, Less, package aliases, query strings, and named CSS exports are outside
  this first reusable contract.

These limits prevent an easy-looking API from promising class names that the
real application would not export.

## Safe warm use

For a long-running host, call the companion generator from the session's
`prepareRevision` callback. Return the companion under a private class path and
give it the same stable `publishPath`. Include the canonical processor manifest,
the exact per-file TypeScript declaration, and any host-staged CSS file that the
real loader must see.

The host validator then checks `tree.files` together with
`tree.extraFiles`. Only after strict target checks and the real loader agree
should it return `ok: true`; it may attach a loader-agreement receipt through
`artifacts`. The session publishes the companion, manifest, receipt,
declaration, maps, and JS/TS as one accepted generation. Invalid CSS or a Haxe
missing-field error keeps the earlier accepted generation public.

This does not guarantee that a framework dev server will ignore the authored
CSS bytes while a revision is failing. A framework that watches the original
stylesheet directly may still see that edit. The framework adapter must choose
whether to stage CSS for its server or pause/reconcile the server around
admission; Genes cannot choose that policy without changing module identity.
