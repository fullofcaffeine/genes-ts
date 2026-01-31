# Packaging and publishing (genes-ts)

genes-ts supports **two output modes**. They have different “shipping” stories:

- **TypeScript source output** (`-D genes.ts`): you *generate TS source* and then use
  normal TS tooling to produce runtime artifacts for production.
- **Classic Genes JS output** (default): you *generate JS (and optionally `.d.ts`)*
  directly from Haxe without a TS compilation step.

If you haven’t yet, read `docs/OUTPUT_MODES.md` first.

---

## Mode A: publish a compiled JS package (recommended)

This is the recommended approach even if you author in Haxe and emit TS:

1) genes-ts emits TypeScript into `src-gen/`
2) `tsc` compiles `src-gen/` → `dist/` (`.js` + `.d.ts` + `.map`)
3) you publish `dist/` as a normal Node ESM package

### Suggested layout

```
my-lib/
  src/          # Haxe sources
  src-gen/      # generated TS (not published; intermediate)
  dist/         # published output (JS + d.ts)
  package.json
  tsconfig.json
  build.hxml
```

### Suggested `build.hxml`

```hxml
-lib genes-ts
-cp src
--main my.lib.Entry

-js src-gen/index.ts
-D genes.ts

# Node ESM friendly (recommended for packages):
# (imports are written as ./Foo.js, TS resolves them to ./Foo.ts during build)
# omit if you want bundler-only workflows
# (or use -D genes.ts.no_extension for extensionless)
```

### Suggested `tsconfig.json` (Node ESM package)

This is the same structure used by `examples/typescript-target/`:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "sourceMap": true,
    "rootDir": "./src-gen",
    "outDir": "./dist",
    "verbatimModuleSyntax": true,
    "skipLibCheck": false
  },
  "include": ["src-gen/**/*.ts"]
}
```

### Suggested `package.json` template

```jsonc
{
  "name": "@yourscope/my-lib",
  "version": "0.1.0",
  "type": "module",
  "files": ["dist/**"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build:haxe": "haxe build.hxml",
    "build:ts": "tsc -p tsconfig.json",
    "build": "npm run build:haxe && npm run build:ts"
  }
}
```

Notes:

- If you ship multiple entrypoints, add them under `exports` explicitly.
- Keep `verbatimModuleSyntax: true` so TS preserves import shapes produced by genes-ts.
- Prefer default `.js` import specifiers for NodeNext compatibility; opt into
  extensionless only for bundler-first apps.

### Worked example

See `examples/typescript-target/`:

- `examples/typescript-target/build.hxml` emits TS into `src-gen/`
- `examples/typescript-target/tsconfig.node-next.json` compiles to `dist/`

From the repo root:

```bash
npm run build:example:genes-ts
```

---

## Mode B: publish “classic Genes” JS (+ optional `.d.ts`)

In classic mode (omit `-D genes.ts`), Genes emits:

- ESM JavaScript (`.js`)
- optional `.d.ts` alongside `.js` with `-D dts`

This can be a net win when you want to avoid a TS compilation step entirely.

### Suggested layout

```
my-lib/
  src/      # Haxe sources
  dist/     # published output (JS + optional d.ts)
  package.json
  build.hxml
```

### Suggested `build.hxml`

```hxml
-lib genes-ts
-cp src
--main my.lib.Entry

-js dist/index.js
-D dts
```

### Suggested `package.json` template

```jsonc
{
  "name": "@yourscope/my-lib",
  "version": "0.1.0",
  "type": "module",
  "files": ["dist/**"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "haxe build.hxml"
  }
}
```

### When to pick Mode B

- you want a “Haxe-first” workflow where generated output is a final artifact
- you don’t want TS tooling in CI/build at all
- you still want `.d.ts` for consumers

---

## App packaging (web bundlers)

If you’re building an app (not a library), you typically keep:

- `src-gen/` as intermediate output
- `dist/` as bundler output (assets + JS)

The todoapp example demonstrates this shape:

- `examples/todoapp/web/src-gen/` (generated TSX)
- `examples/todoapp/web/dist/` (bundled runtime assets)
- `examples/todoapp/web/dist-ts/src-gen/` (committed “intended output” snapshot tree)

See `examples/todoapp/README.md`.

