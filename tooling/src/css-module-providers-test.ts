import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import {
  createPostcssModulesManifest,
  type PostcssModulesManifestOptions,
} from "./css-modules/postcss-modules-provider.js";
import {
  createTypeScriptDeclarationManifest,
  type TypeScriptDeclarationManifestOptions,
} from "./css-modules/typescript-declaration-provider.js";
import {
  POSTCSS_MODULES_MAX_DISCOVERY_RUNS,
  POSTCSS_MODULES_MAX_IMPORT_DEPTH,
  POSTCSS_MODULES_MAX_INPUT_BYTES,
} from "./css-modules/postcss-modules-policy.js";
import { MAX_PROVIDER_FILE_BYTES } from "./css-modules/provider-files.js";
import { generateCssModuleCompanion } from "./css-modules/index.js";

const projectRoot = mkdtempSync(path.join(os.tmpdir(), "genes-css-providers-"));
const requireForTest = createRequire(import.meta.url);
const hostProcessorEntries = [
  requireForTest.resolve("postcss"),
  requireForTest.resolve("postcss-modules"),
  requireForTest.resolve("postcss-selector-parser"),
  requireForTest.resolve("typescript"),
];
for (const entry of hostProcessorEntries) {
  assert.equal(requireForTest.cache[entry], undefined, `${entry} starts unloaded in the host`);
}

function write(relativePath: string, content: string): void {
  const absolute = path.join(projectRoot, ...relativePath.split("/"));
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function escapedCssAtFileLimit(rule: string): string {
  const prefix = `${rule}\n/*`;
  const suffix = "*/\n";
  const padding = MAX_PROVIDER_FILE_BYTES -
    Buffer.byteLength(prefix, "utf8") -
    Buffer.byteLength(suffix, "utf8");
  assert.ok(padding >= 0, "the escaped-source fixture rule fits the file bound");
  const source = `${prefix}${"\\".repeat(padding)}${suffix}`;
  assert.equal(
    Buffer.byteLength(source, "utf8"),
    MAX_PROVIDER_FILE_BYTES,
    "the escaped-source fixture reaches the exact file bound",
  );
  return source;
}

function binding(request: string, hostModulePath: string, companionType: string) {
  return Object.freeze({
    haxeOwner: "app.Card",
    generatedModule: "app/Card",
    request,
    hostModulePath,
    companionType,
  });
}

async function expectPostcssFailure(
  options: PostcssModulesManifestOptions,
  code: string,
): Promise<void> {
  await assert.rejects(
    createPostcssModulesManifest(options),
    (error: unknown) => error instanceof Error && error.message.includes(code),
  );
}

async function expectDeclarationFailure(
  options: TypeScriptDeclarationManifestOptions,
  code: string,
): Promise<void> {
  await assert.rejects(
    createTypeScriptDeclarationManifest(options),
    (error: unknown) => error instanceof Error && error.message.includes(code),
  );
}

try {
  const postcssEntry = "styles/card.module.css";
  const postcssDependency = "styles/base.module.css";
  const postcssNestedDependency = "styles/foundation.module.css";
  write(postcssNestedDependency, ".foundation { display: block; }\n");
  write(
    postcssDependency,
    '.base { composes: foundation from "./foundation.module.css"; color: black; }\n',
  );
  write(
    postcssEntry,
    ":global(.public-banner) { display: block; }\r" +
      ".card { composes: base from \"./base.module.css\"; color: red; }\f" +
      ".error-state { opacity: 0.7; }\r\n" +
      ".escaped\\+name { visibility: visible; }\n",
  );
  const postcssOptions: PostcssModulesManifestOptions = {
    projectRoot,
    entry: postcssEntry,
    binding: binding(
      "../styles/card.module.css",
      "src-gen/styles/card.module.css",
      "app.CardStyles",
    ),
    configuration: {
      generateScopedName: "genes_[name]__[local]",
      scopeBehaviour: "local",
      exportGlobals: true,
      hashPrefix: "genes-provider-test",
    },
  };
  const firstPostcss = await createPostcssModulesManifest(postcssOptions);
  const secondPostcss = await createPostcssModulesManifest(postcssOptions);
  assert.deepEqual(firstPostcss, secondPostcss, "PostCSS manifests are deterministic");
  assert.equal(
    JSON.stringify(firstPostcss),
    JSON.stringify(secondPostcss),
    "PostCSS manifest bytes are deterministic",
  );
  assert.deepEqual(
    firstPostcss.exports.map((entry) => entry.name),
    ["card", "error-state", "escaped+name", "public-banner"],
    "the pinned processor reports the hand-authored runtime keys",
  );
  assert.deepEqual(
    firstPostcss.source.inputs.map((input) => input.path),
    [postcssDependency, postcssEntry, postcssNestedDependency],
    "nested composition inputs are complete and canonical",
  );
  assert.equal(firstPostcss.producer.processorId, "postcss-modules");
  assert.equal(firstPostcss.producer.processorVersion, "9.0.1");
  assert.match(firstPostcss.producer.processorIntegrity, /^sha256-[A-Za-z0-9+/]{43}=$/u);
  assert.deepEqual(
    firstPostcss.exports.map((entry) => [entry.name, entry.source.path]),
    firstPostcss.exports.map((entry) => [entry.name, postcssEntry]),
    "each runtime key points to its exact authored selector",
  );
  assert.deepEqual(
    firstPostcss.exports.map((entry) => [entry.name, entry.source.line, entry.source.column]),
    [
      ["card", 2, 2],
      ["error-state", 3, 2],
      ["escaped+name", 4, 2],
      ["public-banner", 1, 10],
    ],
    "processor exports retain exact decoded selector locations",
  );
  assert.deepEqual(
    generateCssModuleCompanion({ projectRoot, manifest: firstPostcss }).fields.map(
      (field) => field.runtimeName,
    ),
    ["card", "error-state", "escaped+name", "public-banner"],
  );

  const emptyExportsEntry = "styles/empty.module.css";
  write(emptyExportsEntry, "button { color: red; }\n");
  const emptyExports = await createPostcssModulesManifest({
    ...postcssOptions,
    entry: emptyExportsEntry,
    binding: binding(
      "../styles/empty.module.css",
      "src-gen/styles/empty.module.css",
      "app.EmptyStyles",
    ),
    configuration: {
      ...postcssOptions.configuration,
      exportGlobals: false,
    },
  });
  assert.deepEqual(emptyExports.exports, [], "a valid module can export no class names");

  assert.equal(
    POSTCSS_MODULES_MAX_DISCOVERY_RUNS,
    POSTCSS_MODULES_MAX_IMPORT_DEPTH + 1,
    "the maximum composition depth reserves one final complete run",
  );

  const escapedTransportFiles = [
    [
      "transport/entry.module.css",
      '.entry { composes: dependency0 from "./dependency0.css"; ' +
        'composes: dependency1 from "./dependency1.css"; ' +
        'composes: dependency2 from "./dependency2.css"; }',
    ],
    ["transport/dependency0.css", ".dependency0 { color: red; }"],
    ["transport/dependency1.css", ".dependency1 { color: blue; }"],
    ["transport/dependency2.css", ".dependency2 { color: red; }"],
  ] as const;
  for (const [filePath, rule] of escapedTransportFiles) {
    write(filePath, escapedCssAtFileLimit(rule));
  }
  assert.equal(
    escapedTransportFiles.length * MAX_PROVIDER_FILE_BYTES,
    POSTCSS_MODULES_MAX_INPUT_BYTES,
    "the escaped-source fixture reaches the complete documented source bound",
  );
  const escapedTransport = await createPostcssModulesManifest({
    ...postcssOptions,
    entry: escapedTransportFiles[0][0],
    binding: binding(
      "../transport/entry.module.css",
      "src-gen/transport/entry.module.css",
      "app.EscapedTransportStyles",
    ),
  });
  assert.deepEqual(
    escapedTransport.exports.map((item) => item.name),
    ["entry"],
    "the full source allowance survives bounded adapter transport",
  );
  assert.deepEqual(
    escapedTransport.source.inputs.map((item) => item.path),
    escapedTransportFiles.map(([filePath]) => filePath).sort(),
    "the full source allowance retains every composition input",
  );

  rmSync(path.join(projectRoot, ...postcssDependency.split("/")));
  await expectPostcssFailure(
    postcssOptions,
    "GENES-CSS-MODULE-FILE-MISSING-002",
  );
  write(
    postcssDependency,
    '.base { composes: foundation from "./foundation.module.css"; color: black; }\n',
  );
  const executableConfiguration = {
    ...postcssOptions,
    configuration: {
      ...postcssOptions.configuration,
      generateScopedName: () => "unsafe",
    },
  } as unknown as PostcssModulesManifestOptions;
  await expectPostcssFailure(executableConfiguration, "GENES-CSS-MODULE-PROVIDER-016");
  let getterRead = false;
  const accessorConfiguration = Object.defineProperty(
    {
      scopeBehaviour: "local",
      exportGlobals: true,
      hashPrefix: "genes-provider-test",
    },
    "generateScopedName",
    {
      enumerable: true,
      get() {
        getterRead = true;
        return "unsafe_[local]";
      },
    },
  ) as unknown as PostcssModulesManifestOptions["configuration"];
  await expectPostcssFailure(
    { ...postcssOptions, configuration: accessorConfiguration },
    "GENES-CSS-MODULE-PROVIDER-016",
  );
  assert.equal(getterRead, false, "configuration accessors are never executed");

  let proxyTrapCount = 0;
  const proxyConfiguration = new Proxy(postcssOptions.configuration, {
    get() {
      proxyTrapCount += 1;
      return undefined;
    },
    getOwnPropertyDescriptor() {
      proxyTrapCount += 1;
      return undefined;
    },
    getPrototypeOf() {
      proxyTrapCount += 1;
      return Object.prototype;
    },
    ownKeys() {
      proxyTrapCount += 1;
      return [];
    },
  });
  await expectPostcssFailure(
    { ...postcssOptions, configuration: proxyConfiguration },
    "GENES-CSS-MODULE-PROVIDER-016",
  );
  assert.equal(proxyTrapCount, 0, "configuration proxy traps are never executed");

  const scopedDuplicateEntry = "styles/scoped-duplicate.module.css";
  write(
    scopedDuplicateEntry,
    ":global(.scope-card) {}\r.scope-card {}\f.scope-card {}\n",
  );
  const scopedDuplicate = await createPostcssModulesManifest({
    ...postcssOptions,
    entry: scopedDuplicateEntry,
    binding: binding(
      "../styles/scoped-duplicate.module.css",
      "src-gen/styles/scoped-duplicate.module.css",
      "app.ScopedDuplicateStyles",
    ),
    configuration: { ...postcssOptions.configuration, exportGlobals: false },
  });
  assert.deepEqual(
    scopedDuplicate.exports.map((item) => [
      item.name,
      item.source.path,
      item.source.line,
      item.source.column,
    ]),
    [["scope-card", scopedDuplicateEntry, 2, 2]],
    "the first eligible local selector owns the export, not an earlier global selector",
  );
  assert.equal(
    scopedDuplicate.producer.processorIntegrity,
    firstPostcss.producer.processorIntegrity,
    "one measured package closure keeps one processor identity across source and policy changes",
  );
  assert.notEqual(
    scopedDuplicate.producer.configurationSha256,
    firstPostcss.producer.configurationSha256,
    "the normalized configuration has its own identity",
  );

  const unicodeOrderEntry = "styles/unicode-order.module.css";
  const unicodeOrderAsciiDependency = "styles/z.module.css";
  const unicodeOrderNonAsciiDependency = "styles/é.module.css";
  write(unicodeOrderAsciiDependency, ".ascii-order {}\n");
  write(unicodeOrderNonAsciiDependency, ".unicode-order {}\n");
  write(
    unicodeOrderEntry,
    '.both { composes: ascii-order from "./z.module.css"; ' +
      'composes: unicode-order from "./é.module.css"; }\n',
  );
  const unicodeOrder = await createPostcssModulesManifest({
    ...postcssOptions,
    entry: unicodeOrderEntry,
    binding: binding(
      "../styles/unicode-order.module.css",
      "src-gen/styles/unicode-order.module.css",
      "app.UnicodeOrderStyles",
    ),
  });
  assert.deepEqual(
    unicodeOrder.source.inputs.map((input) => input.path),
    [
      unicodeOrderEntry,
      unicodeOrderAsciiDependency,
      unicodeOrderNonAsciiDependency,
    ],
    "portable input paths use canonical UTF-8 byte order instead of host locale order",
  );

  const malformedCssEntry = "invalid/malformed.module.css";
  write(malformedCssEntry, ".card { color: red;\n");
  await expectPostcssFailure(
    {
      ...postcssOptions,
      entry: malformedCssEntry,
      binding: binding(
        "../invalid/malformed.module.css",
        "src-gen/invalid/malformed.module.css",
        "app.MalformedStyles",
      ),
    },
    "GENES-CSS-MODULE-PROVIDER-016",
  );

  const classlessEntry = "invalid/classless.module.css";
  write(classlessEntry, ":export { themeValue: red; }\n");
  await expectPostcssFailure(
    {
      ...postcssOptions,
      entry: classlessEntry,
      binding: binding(
        "../invalid/classless.module.css",
        "src-gen/invalid/classless.module.css",
        "app.ClasslessStyles",
      ),
    },
    "GENES-CSS-MODULE-PROVIDER-016",
  );

  const staleEntry = "invalid/stale.module.css";
  write(staleEntry, ".stale { color: red; }\n");
  const staleManifest = createPostcssModulesManifest({
    ...postcssOptions,
    entry: staleEntry,
    binding: binding(
      "../invalid/stale.module.css",
      "src-gen/invalid/stale.module.css",
      "app.StaleStyles",
    ),
  });
  setTimeout(() => write(staleEntry, ".stale { color: blue; }\n"), 10);
  await assert.rejects(
    staleManifest,
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("GENES-CSS-MODULE-MANIFEST-STALE-004"),
  );

  const declarationEntry = "styles/panel.module.css";
  const declarationPath = `${declarationEntry}.d.ts`;
  write(declarationEntry, ".panel {}\n.error-state {}\n");
  write(
    declarationPath,
    [
      "declare const styles: {",
      "  readonly panel: string;",
      "  readonly \"error-state\": string;",
      "};",
      "export default styles;",
      "",
    ].join("\n"),
  );
  const declarationOptions: TypeScriptDeclarationManifestOptions = {
    projectRoot,
    entry: declarationEntry,
    declaration: declarationPath,
    binding: binding(
      "../styles/panel.module.css",
      "src-gen/styles/panel.module.css",
      "app.PanelStyles",
    ),
  };
  const firstDeclaration = await createTypeScriptDeclarationManifest(declarationOptions);
  const secondDeclaration = await createTypeScriptDeclarationManifest(declarationOptions);
  assert.deepEqual(
    firstDeclaration,
    secondDeclaration,
    "declaration manifests are deterministic",
  );
  assert.equal(
    JSON.stringify(firstDeclaration),
    JSON.stringify(secondDeclaration),
    "declaration manifest bytes are deterministic",
  );
  assert.deepEqual(
    firstDeclaration.exports.map((entry) => entry.name),
    ["error-state", "panel"],
  );
  assert.deepEqual(
    firstDeclaration.source.inputs.map((input) => input.path),
    [declarationEntry, declarationPath],
  );
  assert.equal(firstDeclaration.producer.processorId, "typescript");
  assert.equal(firstDeclaration.producer.processorVersion, "6.0.3");
  assert.match(
    firstDeclaration.producer.processorIntegrity,
    /^sha256-[A-Za-z0-9+/]{43}=$/u,
  );
  assert.notEqual(
    firstDeclaration.producer.processorIntegrity,
    firstPostcss.producer.processorIntegrity,
    "different measured adapters have different processor identities",
  );
  assert.deepEqual(
    firstDeclaration.exports.map((entry) => [entry.name, entry.source.line, entry.source.column]),
    [
      ["error-state", 3, 12],
      ["panel", 2, 12],
    ],
  );
  assert.deepEqual(
    generateCssModuleCompanion({ projectRoot, manifest: firstDeclaration }).fields.map(
      (field) => field.runtimeName,
    ),
    ["error-state", "panel"],
  );

  const invalidDeclarations = new Map<string, string>([
    [
      "wildcard",
      'declare module "*.module.css" { const styles: Record<string, string>; export default styles; }\n',
    ],
    [
      "index",
      "declare const styles: { readonly [key: string]: string }; export default styles;\n",
    ],
    [
      "record",
      "declare const styles: Record<string, string>; export default styles;\n",
    ],
    [
      "optional",
      "declare const styles: { readonly panel?: string }; export default styles;\n",
    ],
    [
      "number",
      "declare const styles: { readonly panel: number }; export default styles;\n",
    ],
    [
      "initializer",
      'declare const styles: { readonly panel: string = "x" }; export default styles;\n',
    ],
    [
      "definite",
      "declare const styles!: { readonly panel: string }; export default styles;\n",
    ],
    [
      "duplicate",
      "declare const styles: { readonly panel: string; readonly panel: string }; export default styles;\n",
    ],
    [
      "mutable",
      "declare const styles: { panel: string }; export default styles;\n",
    ],
    [
      "malformed",
      "declare const styles: { readonly panel: string }; export default styles /*\n",
    ],
  ]);
  for (const [name, content] of invalidDeclarations) {
    const invalidEntry = `invalid/${name}.module.css`;
    const invalidDeclaration = `${invalidEntry}.d.ts`;
    write(invalidEntry, ".panel {}\n");
    write(invalidDeclaration, content);
    await expectDeclarationFailure(
      {
        ...declarationOptions,
        entry: invalidEntry,
        declaration: invalidDeclaration,
        binding: binding(
          `../invalid/${name}.module.css`,
          `src-gen/invalid/${name}.module.css`,
          `app.${name.slice(0, 1).toUpperCase()}${name.slice(1)}Styles`,
        ),
      },
      "GENES-CSS-MODULE-DECLARATION-017",
    );
  }

  await expectDeclarationFailure(
    { ...declarationOptions, declaration: "styles/unrelated.d.ts" },
    "GENES-CSS-MODULE-DECLARATION-017",
  );

  let declarationProxyTrapCount = 0;
  const declarationProxy = new Proxy(declarationOptions, {
    get() {
      declarationProxyTrapCount += 1;
      return undefined;
    },
    getOwnPropertyDescriptor() {
      declarationProxyTrapCount += 1;
      return undefined;
    },
    getPrototypeOf() {
      declarationProxyTrapCount += 1;
      return Object.prototype;
    },
    ownKeys() {
      declarationProxyTrapCount += 1;
      return [];
    },
  });
  await expectDeclarationFailure(
    declarationProxy,
    "GENES-CSS-MODULE-DECLARATION-017",
  );
  assert.equal(
    declarationProxyTrapCount,
    0,
    "declaration option proxy traps are never executed",
  );

  for (const entry of hostProcessorEntries) {
    assert.equal(
      requireForTest.cache[entry],
      undefined,
      `${entry} remains unloaded in the host process`,
    );
  }
} finally {
  rmSync(projectRoot, { recursive: true, force: true });
}

console.log("css-module-providers:ok");
