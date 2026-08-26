import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createPostcssModulesManifest,
  type PostcssModulesManifestOptions,
} from "./css-modules/postcss-modules-provider.js";
import {
  createTypeScriptDeclarationManifest,
  type TypeScriptDeclarationManifestOptions,
} from "./css-modules/typescript-declaration-provider.js";
import { generateCssModuleCompanion } from "./css-modules/index.js";

const projectRoot = mkdtempSync(path.join(os.tmpdir(), "genes-css-providers-"));

function write(relativePath: string, content: string): void {
  const absolute = path.join(projectRoot, ...relativePath.split("/"));
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
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

function expectDeclarationFailure(
  options: TypeScriptDeclarationManifestOptions,
  code: string,
): void {
  assert.throws(
    () => createTypeScriptDeclarationManifest(options),
    (error: unknown) => error instanceof Error && error.message.includes(code),
  );
}

try {
  const postcssEntry = "styles/card.module.css";
  const postcssDependency = "styles/base.module.css";
  write(postcssDependency, ".base { color: black; }\n");
  write(
    postcssEntry,
    [
      ":global(.public-banner) { display: block; }",
      ".card { composes: base from \"./base.module.css\"; color: red; }",
      ".error-state { opacity: 0.7; }",
      ".escaped\\+name { visibility: visible; }",
      "",
    ].join("\n"),
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
    [postcssDependency, postcssEntry],
    "composition inputs are complete and canonical",
  );
  assert.equal(firstPostcss.producer.processorId, "postcss-modules");
  assert.equal(firstPostcss.producer.processorVersion, "9.0.1");
  assert.match(firstPostcss.producer.processorIntegrity, /^sha512-/u);
  assert.equal(
    firstPostcss.producer.processorIntegrity,
    "sha512-BrSXxWSls23TzqMuplpeMRL5VHnDOLh2H9EiHNTMIdLBFumJcurDIi47TBuvkn9GsoTLAoPjv2wLzAt1wdQ2aQ==",
  );
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

  rmSync(path.join(projectRoot, ...postcssDependency.split("/")));
  await expectPostcssFailure(
    postcssOptions,
    "GENES-CSS-MODULE-FILE-MISSING-002",
  );
  write(postcssDependency, ".base { color: black; }\n");
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
  const firstDeclaration = createTypeScriptDeclarationManifest(declarationOptions);
  const secondDeclaration = createTypeScriptDeclarationManifest(declarationOptions);
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
  assert.equal(
    firstDeclaration.producer.processorIntegrity,
    "sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==",
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
      "duplicate",
      "declare const styles: { readonly panel: string; readonly panel: string }; export default styles;\n",
    ],
    [
      "mutable",
      "declare const styles: { panel: string }; export default styles;\n",
    ],
  ]);
  for (const [name, content] of invalidDeclarations) {
    const invalidEntry = `invalid/${name}.module.css`;
    const invalidDeclaration = `${invalidEntry}.d.ts`;
    write(invalidEntry, ".panel {}\n");
    write(invalidDeclaration, content);
    expectDeclarationFailure(
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

  expectDeclarationFailure(
    { ...declarationOptions, declaration: "styles/unrelated.d.ts" },
    "GENES-CSS-MODULE-DECLARATION-017",
  );
} finally {
  rmSync(projectRoot, { recursive: true, force: true });
}

console.log("css-module-providers:ok");
