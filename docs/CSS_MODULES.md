# Closed CSS Module types

Genes can import a CSS Module as an exact Haxe object type while leaving all CSS
behavior with the application's normal processor and bundler.

This feature is useful in any Haxe-to-JavaScript or Haxe-to-TypeScript host. It
contains no Next.js assumptions; NextJsHx, WordPressHx/Gutenberg, Vite-based
projects, and other hosts can build their own placement and development rules
on the same small contract.

## What problem this solves

Typical TypeScript projects often describe CSS Modules with a broad declaration:

```ts
declare module "*.module.css" {
  const styles: Record<string, string>
  export default styles
}
```

That declaration accepts `styles.misspelled` because it claims every string is a
possible key. A hand-written closed declaration is safer, but then a person has
to keep the stylesheet, TypeScript declaration, and Haxe type synchronized.

Genes uses one processor-produced manifest instead. Here, a **manifest** means
a small JSON file that records the exact exported keys plus the source,
processor, configuration, and hashes that produced them. If a stylesheet
changes without a new manifest, tooling rejects the stale data.

## Why Genes does not parse the stylesheet

Reading `.card` selectors looks simple until real CSS Module behavior enters the
picture. `:global`, `composes`, escaped selectors, naming options, preprocessors,
and plugins can all change the JavaScript object's keys.

The configured CSS Modules processor is the only honest authority for those
keys. Genes validates the exact list it reports; it does not build a second CSS
parser that could disagree with the application.

## Tested authoring flow

The maintained fixture uses this authored Haxe module:

```haxe
package css_module_companions;

import genes.css.CssModule.imported;

@:genes.moduleFunction("classNames")
function classNames():String {
  final styles:CardStyles =
    imported("./card.module.css", "styles");

  return [
    styles.card,
    styles.title,
    styles.errorState,
    styles.element,
    styles.hxButton
  ].join("|");
}
```

The named import keeps this API as a Haxe module function instead of an
all-static shell class. The explicit `:CardStyles` is part of the safety
contract. It lets Haxe offer completion and lets `imported` verify that the
generated companion belongs to this Haxe module and this exact stylesheet.

The same tooling result also includes a precise declaration for the real CSS
import. For `card.module.css`, the host publishes `card.module.d.css.ts` beside
the admitted CSS Module and enables TypeScript's `allowArbitraryExtensions`
option. This is TypeScript's exact lookup convention for a non-TypeScript file
extension. A common wildcard declaration such as `Record<string, string>` is
not enough for strict TypeScript: it permits arbitrary keys but does not prove
that required keys such as `card` exist. The generated per-file declaration
derives those required keys from the same processor-owned manifest:

```ts
declare const styles: {
  readonly "card": string
  readonly "error-state": string
  readonly "title": string
}

export default styles
```

The processor reports the runtime key `error-state`. Tooling generates the
friendlier Haxe field `errorState` with `@:native("error-state")`, so the source
stays pleasant without changing the JavaScript property.

Projects that keep Haxe modules at the classpath root are supported too. Such a
project may use `Main` and `CardStyles` without inventing a package solely for
this feature; the generated companion simply omits the `package` line.
Qualified names are checked as real Haxe names, including rejecting a language
keyword as a package segment, so tooling cannot generate an invalid line such
as `package import;`.

The public manifest rules and the tooling runtime enforce the same safety
limits. Text values are capped at 16,384 characters, and stylesheet line and
column numbers must fit safely in JavaScript's exact integer range. Hosts can
therefore validate a manifest before storing it without accepting data that the
tooling would reject later.

The recorded `source.entry` must itself end in `.module.css`, and it must appear
in the hashed input list. This prevents a manifest from hashing an unrelated
file while claiming that its class names still describe the stylesheet.

The three binding paths must also agree. `generatedModule` names the generated
JavaScript or TypeScript module, `request` is the relative CSS import written in
that module, and `hostModulePath` is where the host exposes that CSS file.
`generatedModule` must be the slash-separated form of the Haxe owner—for
example, `app.Main` becomes `app/Main`. After allowing for the host's output-root
prefix, resolving the request from that module must produce the host CSS path.
Tooling rejects a declaration candidate placed somewhere TypeScript would never
inspect for the emitted import.

The companion must also have its own Haxe module name. For example, an owner
named `app.Card` may use `app.CardStyles`, but it may not also use `app.Card` as
the companion. Two different Haxe files cannot safely own the same module path;
tooling rejects that setup before it can hide or replace the authored component.

Portable manifest paths use project-relative forward-slash spelling and reject
colons as well as backslashes. This keeps a value such as
`C:/card.module.css` from becoming a drive path when a manifest moves from a
POSIX host to Windows.

JSON Schema checks the portable JSON shape and basic bounds. Some meaning
depends on comparing several entries and remains a tooling check: duplicate
source paths and duplicate export names are rejected. Incoming array order is
accepted and normalized byte-for-byte before hashing and generation, so a host
does not need to pre-sort processor output to get deterministic artifacts.

## Actual generated TypeScript

The fixture currently emits the following CSS-related implementation. The
snippet leaves out only the source-map trailer:

```ts
import __genes_import_styles from "./card.module.css"
import {Register} from "../genes/Register.js"
import type {CardStyles} from "./CardStyles.js"

export function classNames(): string {
  const styles: CardStyles = __genes_import_styles;
  return [styles.card, styles.title, styles["error-state"], styles.__element, styles._hx_button].join("|");
}
export function exportedStyles(): CardStyles {
  return __genes_import_styles;
}
```

The `Register` import is part of the current shared Genes support graph; the
CSS Module feature adds only the default CSS import and the type-only companion
import.

The generated companion's public shape is this closed TypeScript type:

```ts
export type CardStyles = {
  __element: string,
  _hx_button: string,
  card: string,
  "error-state": string,
  title: string
}
```

Strict TypeScript independently accepts `styles.card` and rejects
`styles.missing`. Haxe has already performed the same missing-field check before
this TypeScript exists.

## Actual generated classic JavaScript

The same Haxe source currently emits the following CSS-related implementation.
The snippet leaves out its copied Haxe documentation and source-map trailer:

```js
import __genes_import_styles from "./card.module.css"
import {Register} from "../genes/Register.js"

export function classNames() {
  const styles = __genes_import_styles;
  return [styles.card, styles.title, styles["error-state"], styles.__element, styles._hx_button].join("|");
}
export function exportedStyles() {
  return __genes_import_styles;
}
```

There is no runtime companion import, CSS registry, wrapper object, or Genes
styling runtime. The host's ordinary CSS loader supplies the imported object.

## Actual classic declaration output

Classic JavaScript can still serve TypeScript callers. With `-D dts`, the same
fixture emits this declaration for its two public module functions:

```ts
import {CardStyles} from "./CardStyles.js"

export const classNames: () => string
export const exportedStyles: () => CardStyles
```

`CardStyles.d.ts` contains the same finite keys shown in the TypeScript section
above. A separate strict TypeScript consumer calls `exportedStyles()`, accepts
`card` and `"error-state"`, and rejects `missing`. This checks the classic
declaration emitter itself; the TypeScript-profile declaration is not allowed
to stand in for it.

## What the tooling API does

Hosts call:

```ts
import {
  generateCssModuleCompanion,
  type CssModuleExportsManifestV1,
} from "@genes-ts/tooling/css-modules"

const candidate = generateCssModuleCompanion({
  projectRoot,
  manifest,
})
```

The function returns both proposed generated files in memory: the Haxe
companion and exact per-file TypeScript declaration. It also returns the checked
manifest and fingerprint, plus the mapping from friendly Haxe fields to
JavaScript keys. It deliberately does not write anything. The calling tool can
inspect the result and publish both files together with its other generated
files only after the whole build succeeds.

The complete version-one JSON shape is documented and validated by
[`tooling/css-modules/v1/exports.schema.json`](../tooling/css-modules/v1/exports.schema.json).
The protocol guide explains every field and the ownership boundary in
[`tooling/css-modules/v1/README.md`](../tooling/css-modules/v1/README.md).

## Useful failures

Examples of early failures include:

- `GENES-CSS-MODULE-TYPE-009` — the Haxe value has no generated companion type;
- `GENES-CSS-MODULE-BINDING-010` — the companion belongs to another module or stylesheet;
- `GENES-CSS-MODULE-MANIFEST-STALE-004` — an input file no longer matches its recorded hash;
- `GENES-CSS-MODULE-NAME-COLLISION-006` — two runtime keys would become the same Haxe field;
- the normal Haxe `has no field ...` error — application code used a class name the processor did not report.

Each compiler-side error points into the authored Haxe call or field access.
Tooling failures name the manifest or source fact that needs repair.

CSS keys beginning with `__` or `_hx_` receive a friendly Haxe alias plus
`@:native`, just like dashed keys. Genes reserves those prefixes for internal
Haxe runtime details, so keeping them as Haxe field names could weaken a closed
public type. The JavaScript property itself remains unchanged.

A key made only from punctuation also gets a predictable Haxe name. For
example, `$` becomes `css24` and `--` becomes `css2d2d`; the digits are the
ASCII character codes written in hexadecimal. `@:native` still preserves the
exact JavaScript key. If this spelling collides with another class name,
generation stops and reports both names instead of inventing a numbered suffix.

Version one rejects an exact JavaScript key wrapped in square brackets, such as
`[foo]`. Genes already uses that `@:native` spelling to mean a computed property
access (`styles[foo]`) rather than the literal key `styles["[foo]"]`. Rejecting
the key is safer than silently generating code that reads a different property.

The companion metadata is a consistency check, not a security seal. A developer
could imitate it in a hand-written typedef. The host remains responsible for
publishing only tooling-generated companions from its owned output area. An
unmarked hand-written lookalike is rejected immediately.

## Evidence and independent checks

Run the complete focused proof with:

```bash
yarn test:css-module-companions
```

The fixture deliberately uses different owners for expected and actual results:

1. a hand-reviewed JSON file states the expected class keys;
2. pinned `postcss-modules` independently reports its keys;
3. Genes tooling generates the Haxe companion and exact TypeScript declaration
   from that processor manifest;
4. Haxe checks valid and invalid field access;
5. strict TypeScript checks the generated closed type;
6. Genes emits TypeScript plus classic JavaScript, including the classic
   `.d.ts` declaration consumed by TypeScript callers;
7. pinned esbuild loads and runs both generated programs through a controlled
   CSS Modules loader;
8. the object available to the running JavaScript must contain all five
   reviewed keys and string values.

The expected keys are never generated by the companion generator and compared
back to itself.

## Current scope

The manifest and companion generator stay useful in a one-shot build. A
long-running host can also compose them with `@genes-ts/tooling/session` for a
safe warm edit loop.

- hosts supply an exact manifest from a processor they selected and pinned;
- exact keys wrapped in square brackets are rejected for the reason above;
- tooling checks and generates one Haxe companion plus one exact TypeScript
  declaration candidate;
- the compiler checks the binding and emits an ordinary default import;
- both output profiles and a real loader are proven.
- a host session can prepare the companion before Haxe typing, keep one
  compatible Haxe server warm, validate the complete private candidate, and
  publish the companion plus generated target files together;
- failed CSS parsing, missing Haxe fields, strict TypeScript failures, or loader
  disagreement keep the previous accepted files byte-for-byte.

Genes still does not provide automatic processor discovery or decide a host's
watch list. The host must watch the authored stylesheet, binding data,
processor configuration, lock identity, and every processor-reported input.
Direct editor navigation from a Haxe field to the CSS selector is also not yet
promised. Published generated Haxe companions do keep a stable source-map path
when the host uses the same private and public relative path.

The generic last-good promise covers the files that the session owns. If a
framework dev server independently watches the original `.module.css`, it may
observe a broken edit before the new Haxe generation is accepted. The later
framework adapter must state and test whether it serves a staged stylesheet or
reconciles its server around accepted generations. Genes does not silently copy
CSS or change the framework's module identity.

NextJsHx integration is also separate. NextJsHx must prove that the import lands
in the correct native module, production Next builds it, development edits are
safe, and a browser receives the expected style. Those are Next-specific facts;
they do not belong in this reusable Genes implementation.
