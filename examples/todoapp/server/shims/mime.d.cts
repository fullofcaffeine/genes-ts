// genes-ts: CJS shim for `mime` used by `@types/send` (transitively via Express).
//
// Some tool dependencies (e.g. release tooling) may pull in ESM-only `mime@4`,
// which triggers TS1479 when `@types/send@0.x` tries to `import * as m from "mime"`
// from a CommonJS `.d.ts` under `moduleResolution: "NodeNext"`.
//
// We don't rely on `mime` runtime APIs in the todoapp server, but we do want
// `skipLibCheck: false` and strict TS to remain enabled. This shim keeps the
// type surface minimal and stable.
declare module "mime" {
  const mime: {
    getType(path: string): string | null;
    getExtension(type: string): string | null;
    types: Record<string, string>;
    extensions: Record<string, string>;
  };

  export = mime;
}

