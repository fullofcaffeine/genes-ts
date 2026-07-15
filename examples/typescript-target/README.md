# genes-ts minimal dual-output example

This is the smallest executable proof that one ordinary Haxe source tree can
target either strict TypeScript source or modern classic Genes ESM JavaScript.
The TypeScript profile keeps useful annotations; the classic profile erases
them and optionally emits `.d.ts` without changing runtime behavior.

## Build and verify both profiles

From the repository root:

```bash
yarn build:example:genes-ts
```

That command performs all of the following:

- emits `src-gen/**/*.ts` with `-D genes.ts`;
- compiles it on the supported TypeScript 5.5, 6, and 7 lanes;
- emits `classic-src-gen/**/*.js` plus `.d.ts` without `-D genes.ts`;
- strictly consumes the classic declarations on all three TypeScript lanes;
- executes both programs and requires the same `Hello, World` transcript;
- verifies that the TS annotation is present in `.ts` and absent from `.js`.

## Profiles and files

| Profile | Haxe build | Generated source | Runtime |
| --- | --- | --- | --- |
| `ts-strict` | `build.hxml` | `src-gen/` | `dist/index.js` after `tsc` |
| `classic-esm` | `build.classic.hxml` | `classic-src-gen/` | `classic-src-gen/index.js` directly |

Both HXML files use repository-relative paths because the local genes-ts
haxelib resolves `extraParams.hxml` from the repository root. Run them as
`haxe examples/typescript-target/build*.hxml` from that root.

The NodeNext configs are the executable TS profile. The Bundler and
null-tolerant configs remain explicit compatibility examples. Each config pins
its ambient `types` so unrelated workspace packages cannot change the result.
