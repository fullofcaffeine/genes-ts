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

The processor reports the runtime key `error-state`. Tooling generates the
friendlier Haxe field `errorState` with `@:native("error-state")`, so the source
stays pleasant without changing the JavaScript property.

Projects that keep Haxe modules at the classpath root are supported too. Such a
project may use `Main` and `CardStyles` without inventing a package solely for
this feature; the generated companion simply omits the `package` line.

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
```

There is no runtime companion import, CSS registry, wrapper object, or Genes
styling runtime. The host's ordinary CSS loader supplies the imported object.

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

The function returns the proposed generated file in memory: its path, complete
Haxe text, checked manifest and fingerprint, and the exact mapping from friendly
Haxe fields to JavaScript keys. It deliberately does not write anything. The
calling tool can inspect the result and publish it together with its other
generated files only after the whole build succeeds.

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
3. Genes tooling generates the companion from that processor manifest;
4. Haxe checks valid and invalid field access;
5. strict TypeScript checks the generated closed type;
6. Genes emits both TypeScript and classic JavaScript;
7. pinned esbuild loads and runs both generated programs through a controlled
   CSS Modules loader;
8. the object available to the running JavaScript must contain all five
   reviewed keys and string values.

The expected keys are never generated by the companion generator and compared
back to itself.

## Current scope

This first increment is intentionally one-shot: a host calls it during a build,
but Genes does not watch CSS files by itself yet.

- hosts supply an exact manifest from a processor they selected and pinned;
- exact keys wrapped in square brackets are rejected for the reason above;
- tooling checks and generates one candidate companion;
- the compiler checks the binding and emits an ordinary default import;
- both output profiles and a real loader are proven.

It does not yet provide automatic processor discovery, watch integration,
editor-to-CSS navigation, or one all-or-nothing publication covering the
companion and Genes output. Those need the separate warm-development change so
a failed edit cannot make the editor and public native output describe
different generations.

NextJsHx integration is also separate. NextJsHx must prove that the import lands
in the correct native module, production Next builds it, development edits are
safe, and a browser receives the expected style. Those are Next-specific facts;
they do not belong in this reusable Genes implementation.
