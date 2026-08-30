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
ancestor `node_modules` directories and default realpath behavior. It asks Node
for the ordered lookup paths for each bare package key. The ancestor list must
be an exact prefix of Node's result.

Package keys use a profile-frozen, historical npm-compatible ASCII structure.
This structure is not exact npm publication policy or arbitrary Node specifier
syntax. A key is either one unscoped name or exactly `@scope/package`.
`@` and `/` are structural delimiters. Each body permits letters, digits,
periods, `!`, `'`, `(`, `)`, `*`, `_`, `~`, and `-`.

| Position | Additional rule |
| --- | --- |
| Unscoped name | It must not start with `.`, `_`, or `-`. |
| Scope body | It has no additional first-character restriction. |
| Scoped package body | It must not start with `.`. |

The grammar rejects URLs, imports-map keys, package subpaths, percent input,
backslashes, controls, replacement characters, and non-ASCII text. The helper
does not trim, lowercase, decode, or normalize an accepted key.

The same grammar checks request roots, expected names, installed metadata
names, dependency keys, optional dependency keys, peer keys, and peer metadata
keys. A logical alias key can differ from its installed metadata name.
Dependency declaration values stay opaque and do not select a filesystem path.
Lexical acceptance does not override later built-in, self-edge, ambient, or
filesystem checks.

Node can append user-home and installation-prefix package directories. The
helper checks those ambient directories only to prevent false absence. If an
ambient package or legacy package file would win, the profile fails. It does
not include ambient package bytes in the closure.

Built-in modules, root package self-references, declared self-edges, and default
legacy package files are also unsupported. A root self-reference exists when
the nearest package scope has the requested name and a non-null `exports`
value. This conservative rule keeps the profile stable where supported Node
releases disagree about invalid primitive values. Legacy files are the exact
key and its `.js`, `.json`, or `.node` forms. The profile conservatively rejects
these files beside a package directory, even when package exports would choose
the directory. This rule keeps the helper from becoming a second CommonJS
loader.

Nonempty `NODE_OPTIONS`, `NODE_PATH`, `NODE_PRESERVE_SYMLINKS`,
`NODE_PRESERVE_SYMLINKS_MAIN`, and Plug'n'Play cause failure. The profile also
rejects the
`--loader`, `--experimental-loader`, `--experimental-policy`, `--import`,
`--policy-integrity`, `--require`, `-r`,
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
The helper copies and validates each request field once before the first
capture. Later work uses only that immutable copy.

Each package lookup has fixed internal limits. It permits at most 4,100 lookup
directories and three ambient suffix directories. One lookup path can use at
most 16,448 UTF-8 bytes and 16,448 code units.

One complete capture permits at most 262,144 resolution work units. One Node
lookup request, one generated or observed path, one package-scope metadata
candidate, and one exact or legacy package candidate each use one unit. The 32
MiB retained lookup-path limit also applies to the complete capture.
Verification starts a second complete capture with fresh limits. Lookup paths
never enter the digest or a public error.

The helper reads directories incrementally. It limits retained relative-path
state to 32 MiB. It does not retain absolute directory paths after each local
enumeration check.

Regular files use a fixed 64 KiB read buffer. An overflow check reads at most
one byte past the active allowance. Only `package.json` bytes are retained for
parsing. Each `package.json` has a fixed 1 MiB limit. Measured package metadata
also counts against the caller's cumulative byte limit. Nearest package-scope
metadata is resolution work and does not enter the measured closure totals.

Dependency maps and peer metadata share the remaining edge-work limit for each
package. Dependency specification text is opaque because it does not select a
filesystem path. Metadata reads ignore inherited host properties and unrelated
fields.

The helper identifies case variants of nested `node_modules` directories by
filesystem identity before it excludes their contents. Ancestor resolution
still follows Node's lexical rule. Therefore, a mixed-case ancestor can add a
nested lowercase search path even on a case-insensitive filesystem.

The helper applies the same identity rule to root-level `package.json` case
aliases. It parses the alias only when the listed file and lexical lowercase
path are one unchanged regular file. The digest keeps the listed spelling. On
a case-sensitive filesystem, an uppercase-only file is not package metadata.

Each complete pass resolves the base directory and every package locator again.
Each directory and file also has local before-and-after checks. The capture does
not use a path, size, or timestamp cache.

Installed-closure identity alone is not final `processorIntegrity`. Package
metadata can omit a module that Node later loads, and equal endpoint snapshots
cannot prove which transient bytes existed between checks.

The repository now has an internal execution-admission seam for one fixed
provider adapter. During the second verified capture, it streams the exact
hashed bytes into a private package graph. Only generated links between those
copied package roots participate in dependency lookup. A later replacement in
the original installation therefore cannot change the bytes that execute.

The seam starts a fresh Node process with an empty environment. Synchronous
module hooks admit built-in modules and copied regular files by their exact
real path. They cover ordinary CommonJS, ESM, JSON, `createRequire`, relative
loads, absolute loads, and `file:` loads. An undeclared, ambient, outside, or
otherwise unlisted file fails. `data:`, network, and other custom module
schemes fail. Native add-ons are disabled even when their file was copied.

The child receives only validated inert JSON data. Node's permission model
grants read access only to the private execution tree and fixed child entry,
with no filesystem writes, child processes, workers, or native add-ons. Node's
permission model does not restrict sockets, so the child separately rejects
network built-ins, all private underscore or internal built-ins, private native
bindings, and the `fetch`, `WebSocket`, `EventSource`, and `WebTransport`
globals. The same rule covers direct built-in lookup. String-based `eval` and
`Function` code generation are disabled. The process has bounded request,
result, diagnostic-output, and wall-clock limits. It is terminated once and
the private graph is removed before a result returns. Copy, child, or cleanup
failure releases no result.

Execution admission is available only on the reviewed Node 22.22-or-newer and
Node 24.10-or-newer lanes declared by the package. Earlier and later Node lines
require their own review.

This is a trusted-processor correctness boundary, not a hostile-code sandbox.
Node documents its permission model as a guard for trusted code. Private
built-ins and common private native entry points are disabled, but deliberate
use of another private runtime API, `node:vm`, dynamic WebAssembly, protocol
spoofing, or another in-process escape is outside this claim. Hosts must still
select a reviewed adapter, normalize configuration as inert data, and decide
whether installed bytes satisfy registry or lock policy.

After successful execution, the copied second capture's path-free
`installedClosureIntegrity` becomes `processorIntegrity`. Configuration,
provider, processor, and version fields remain separate manifest facts. The
public CSS Modules subpath does not discover or choose processors; the next
finite provider layer owns when to call this internal seam. A provider returns
no manifest when admission fails.

## Reusable manifest providers

Two public subpaths implement that finite provider layer. Both functions are
asynchronous and return `CssModuleExportsManifestV1`. Neither function writes
files.

### Fixed PostCSS Modules provider

Install the exact optional peers:

```bash
npm install --save-exact postcss@8.5.25 postcss-modules@9.0.1 postcss-selector-parser@7.1.4
```

Import `createPostcssModulesManifest` from
`@genes-ts/tooling/css-modules/postcss-modules`.

The provider accepts four configuration fields:

- `generateScopedName`: one nonempty string pattern.
- `scopeBehaviour`: `local` or `global`.
- `exportGlobals`: one Boolean value.
- `hashPrefix`: one string.

The object must contain only inert data properties. Accessors, proxies,
functions, symbols, and extra fields fail before execution. Application
PostCSS configuration is outside this contract.

The host reads one `.module.css` entry as an ordinary UTF-8 file. Each file is
limited to 2 MiB. One manifest can use at most 256 files and 8 MiB of source
text. Relative `.css` composition can use at most 32 levels and 33 fresh child
runs, including the final complete run. Absolute requests, package requests,
queries, fragments, links, and paths outside the project fail.

Each child gets only an inert in-memory file map. Exact UTF-8 source bytes use
canonical base64 in the private adapter request, so JSON escaping cannot reduce
the documented 8 MiB source allowance. The adapter decodes and rechecks the
per-file and aggregate byte limits before processing. It records all missing
composition paths and discards provisional tokens. The host reads those paths
and starts another fresh measured child. The measured processor identity must
stay unchanged across every run.

The final complete child runs exactly two processor passes, independent of the
number of composition inputs. The normal pass supplies the exact runtime keys.
The marker pass replaces local classes with unique deterministic markers and
retains each transformed input for classification. Comparing authored and
transformed selectors identifies local and global ownership. The first marker
token owns a key. Duplicate eligible selectors use the earliest portable path
and source offset.

Source indexing is linear and recognizes LF, CR, CRLF, and form feed as CSS
line breaks. Escaped names are decoded before marker lookup. A key without one
eligible class selector fails. This includes classless ICSS, value-only, and
composition-only exports.

The manifest reports `postcss-modules` 9.0.1 as the processor. Its
`processorIntegrity` covers the fixed adapter and every admitted installed
package byte. The digest changes for a same-version local patch.

The configuration digest contains only the normalized four-field policy and a
domain tag. It excludes packages, source hashes, lock data, and machine paths.

### Closed TypeScript declaration adapter

Install exact optional TypeScript 6.0.3:

```bash
npm install --save-exact typescript@6.0.3
```

Import `createTypeScriptDeclarationManifest` from
`@genes-ts/tooling/css-modules/typescript-declaration`.

The declaration path must be exactly `<entry>.d.ts`. The file must have two
statements. The first is one `declare const` with no initializer and one direct
object type. The second default-exports that constant.

Every object member must be a required `readonly` identifier or string-literal
property with the exact type `string`. The adapter rejects property
initializers, wildcard modules, imports, index signatures, records, mapped
types, optional or mutable fields, duplicate keys, and other value types.

The fixed adapter uses TypeScript's public no-emit program diagnostics. It does
not generate discarded JavaScript. Exact declaration locations become source
facts. The CSS file and declaration are both hashed inputs.

The TypeScript package loads only in the measured child. The host process does
not import any optional processor.

## Complete one-shot flow

```text
authored card.module.css
  → fixed host-selected adapter executes only its measured package copy
  → admitted CSS Modules processor reports exact keys and processorIntegrity
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
