# Output modes (genes-ts)

genes-ts supports **two output modes** within the same library (`-lib genes-ts`).

The mode is selected by the presence of `-D genes.ts`.

## 1) TypeScript source output (recommended for “Haxe → TS” migration)

Enable with:

```hxml
-D genes.ts
```

Characteristics:
- Emits split ESM **TypeScript source** (`.ts` / `.tsx`) that is intended to be compiled by `tsc` (or a bundler).
- Good fit when you want to:
  - migrate a codebase to TypeScript over time
  - interop deeply with TS/React tooling
  - diff/review generated output as readable TS

Related knobs:
- `-D genes.ts.no_extension` for bundler workflows (extensionless imports).
- `-D genes.ts.minimal_runtime` for a “TS-first / no-reflection” profile.

React authoring:
- `genes.react.JSX.jsx(...)` + inline markup are intended for this mode (see `docs/typescript-target/REACT_HXX.md`).

## 2) Classic Genes JS output (recommended for Haxe-first projects)

Default when `-D genes.ts` is **not** set.

Characteristics:
- Emits split ESM **JavaScript** (`.js`).
- Can emit `.d.ts` alongside `.js` via `-D dts`.
- Does **not** require a TS compilation step (useful when TS compilation cost/complexity is a net negative).

Related knobs:
- `-D genes.no_extension` for extensionless imports in JS output.

## Picking a mode

- If your goal is “Haxe is a better language on top of TS, and we may port to TS later” → use **TypeScript output** (`-D genes.ts`).
- If your goal is “we keep writing Haxe, but want modern ESM output + excellent `.d.ts`” → use **classic Genes JS output** (omit `-D genes.ts`, keep `-D dts`).

