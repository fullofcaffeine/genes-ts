# genes-ts — example project

This directory is a minimal end-to-end example of:
1) compiling **Haxe → TypeScript** with `genes-ts`, then
2) compiling **TypeScript → JavaScript** with `tsc` for Node ESM.

## Run it

From the repo root:

```bash
npm run build:example:genes-ts
```

## Files

- `build.hxml`: emits TS into `src-gen/` (still uses `-js` because we compile on the JS platform).
- `tsconfig.node-next.json`: NodeNext-friendly TS→JS compile (explicit `.js` import specifiers).
- `tsconfig.bundler.json`: bundler-friendly TS→JS compile (extensionless imports).
