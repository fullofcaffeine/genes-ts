# genes-ts — example configs

These files are a **contract draft** for how a consuming project is expected to compile Haxe to TypeScript (Haxe 4.7) using **genes-ts**, and then package it.

Nothing here is wired up yet; this is for settling the interface early (M0).

## Haxe usage (planned)

- `build.hxml` shows the intended invocation pattern.

## TypeScript configs

- `tsconfig.node-next.json`: Node ESM friendly defaults (explicit `.js` specifiers).
- `tsconfig.bundler.json`: bundler-friendly defaults (extensionless imports).
