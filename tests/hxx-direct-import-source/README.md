# Direct-import source JSX fixture

## Why this fixture exists

HXX typing sometimes introduces a temporary for a nested component:

```haxe
return <Components.Parent>
  <Components.Child />
</Components.Parent>;
```

Keeping that temporary is necessary when `Child` or `Parent` is a JavaScript
property read. A property may be a getter or Proxy trap, so moving it could
change observable `Child,Parent` evaluation order. A field-level direct ESM
import is different: Genes emits it as an ordinary local import binding, and
reading that binding has no getter to run.

## What is proved

The positive fields separately exercise exact field-level `@:jsRequire`
metadata for a default export and for a named root export, both without a
dotted suffix. Source TSX and JSX may emit:

```tsx
return <Parent><Child /></Parent>;
return <NamedParent><NamedChild /></NamedParent>;
```

The controls deliberately use a dotted named import and a class-level imported
object whose component fields are real JavaScript getters. They must retain:

```tsx
const child = <Components.Child />;
return <Components.Parent>{child}</Components.Parent>;
```

The getter transcript proves that the child read still happens before the
parent read. Typed `.ts` and classic `.js` keep their established explicit
`createElement` schedule; this feature changes only syntax profiles that emit
source JSX.

This is not a general field-purity rule. It does not move ordinary static
fields, class-level imports, dotted import members, object or array reads,
authored locals, calls, dynamic tags, or spreads.

## How to verify it

```bash
yarn test:hxx-direct-import-source
```

The focused gate compiles all four output profiles, checks the generated
shapes, validates TSX and typed TypeScript with the supported TypeScript 5, 6,
and 7 lanes, checks child source mappings, and compares the same server-rendered
HTML and getter-order transcript at runtime.
