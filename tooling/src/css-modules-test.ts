import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";

import {
  CSS_MODULE_EXPORTS_PROTOCOL,
  CSS_MODULE_EXPORTS_VERSION,
  CSS_MODULE_NAMING_POLICY,
  CssModuleCompanionError,
  generateCssModuleCompanion,
} from "./css-modules/index.js";

const currentFile = fileURLToPath(import.meta.url);
const toolingRoot = path.resolve(path.dirname(currentFile), "..");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function manifestFor(css: string): Record<string, unknown> {
  return {
    protocol: CSS_MODULE_EXPORTS_PROTOCOL,
    version: CSS_MODULE_EXPORTS_VERSION,
    namingPolicy: CSS_MODULE_NAMING_POLICY,
    binding: {
      haxeOwner: "css_module_companions.Main",
      generatedModule: "css_module_companions/Main",
      request: "./card.module.css",
      hostModulePath: "src-gen/css_module_companions/card.module.css",
      companionType: "css_module_companions.CardStyles",
    },
    source: {
      entry: "styles/card.module.css",
      inputs: [{ path: "styles/card.module.css", sha256: sha256(css) }],
    },
    producer: {
      providerId: "genes-test-css-modules-provider",
      providerVersion: "1.0.0",
      processorId: "postcss-modules",
      processorVersion: "9.0.1",
      processorIntegrity: `sha512-${"A".repeat(86)}==`,
      configurationSha256: "b".repeat(64),
    },
    exports: [
      { name: "2xl", source: { path: "styles/card.module.css", line: 4, column: 2 } },
      { name: "card", source: { path: "styles/card.module.css", line: 1, column: 2 } },
      { name: "class", source: { path: "styles/card.module.css", line: 3, column: 2 } },
      { name: "error-state", source: { path: "styles/card.module.css", line: 2, column: 2 } },
    ],
  };
}

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    if (!(error instanceof CssModuleCompanionError)) return false;
    assert.equal(error.code, code);
    return true;
  });
}

function main(): void {
  const css = [
    ".card {}",
    ".error-state {}",
    ".class {}",
    ".\\32 xl {}",
    "",
  ].join("\n");
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "genes-css-module-")));
  try {
    mkdirSync(path.join(root, "styles"), { recursive: true });
    writeFileSync(path.join(root, "styles/card.module.css"), css, "utf8");

    const first = generateCssModuleCompanion({ projectRoot: root, manifest: manifestFor(css) });
    const second = generateCssModuleCompanion({ projectRoot: root, manifest: manifestFor(css) });
    assert.deepEqual(second, first, "identical manifests produce byte-identical companions");
    assert.equal(first.relativePath, "css_module_companions/CardStyles.hx");
    assert.deepEqual(
      first.fields.map(({ haxeName, runtimeName }) => ({ haxeName, runtimeName })),
      [
        { haxeName: "css2xl", runtimeName: "2xl" },
        { haxeName: "card", runtimeName: "card" },
        { haxeName: "class_", runtimeName: "class" },
        { haxeName: "errorState", runtimeName: "error-state" },
      ],
    );
    assert.match(first.content, /@:native\("error-state"\)/u);
    assert.match(first.content, /final class_:String;/u);
    assert.match(first.content, /edit the stylesheet, not this file/u);

    const schemaPath = path.join(toolingRoot, "css-modules/v1/exports.schema.json");
    const schema: unknown = JSON.parse(readFileSync(schemaPath, "utf8"));
    assert.equal(typeof schema === "object" && schema !== null && !Array.isArray(schema), true);
    // Ajv owns the external JSON-Schema shape. The object check above narrows
    // the decoded file before it crosses that library boundary.
    const validate = new Ajv2020({ strict: true }).compile(schema as AnySchema);
    assert.equal(validate(manifestFor(css)), true, JSON.stringify(validate.errors));

    const packageLess = manifestFor(css);
    packageLess.binding = {
      haxeOwner: "A",
      generatedModule: "A",
      request: "./card.module.css",
      hostModulePath: "src-gen/card.module.css",
      companionType: "UI",
    };
    assert.equal(validate(packageLess), true, JSON.stringify(validate.errors));
    const packageLessCompanion = generateCssModuleCompanion({
      projectRoot: root,
      manifest: packageLess,
    });
    assert.equal(packageLessCompanion.relativePath, "UI.hx");
    assert.doesNotMatch(packageLessCompanion.content, /^package\b/mu);

    const hiddenStylesheet = manifestFor(css);
    hiddenStylesheet.binding = {
      haxeOwner: "css_module_companions.Main",
      generatedModule: "css_module_companions/Main",
      request: "./.module.css",
      hostModulePath: "src-gen/css_module_companions/.module.css",
      companionType: "css_module_companions.CardStyles",
    };
    assert.equal(validate(hiddenStylesheet), true, JSON.stringify(validate.errors));
    generateCssModuleCompanion({ projectRoot: root, manifest: hiddenStylesheet });

    for (const [field, invalidName] of [
      ["haxeOwner", "app.card"],
      ["companionType", "card-styles"],
    ] as const) {
      const invalidHaxeName = manifestFor(css);
      invalidHaxeName.binding = {
        haxeOwner: "css_module_companions.Main",
        generatedModule: "css_module_companions/Main",
        request: "./card.module.css",
        hostModulePath: "src-gen/css_module_companions/card.module.css",
        companionType: "css_module_companions.CardStyles",
        [field]: invalidName,
      };
      assert.equal(validate(invalidHaxeName), false, `${field} rejects ${invalidName}`);
      expectCode(
        () => generateCssModuleCompanion({ projectRoot: root, manifest: invalidHaxeName }),
        "GENES-CSS-MODULE-MANIFEST-015",
      );
    }

    const punctuationOnly = manifestFor(css);
    punctuationOnly.exports = [
      { name: "$", source: { path: "styles/card.module.css", line: 1, column: 2 } },
      { name: "--", source: { path: "styles/card.module.css", line: 2, column: 2 } },
    ];
    assert.equal(validate(punctuationOnly), true, JSON.stringify(validate.errors));
    const punctuationCompanion = generateCssModuleCompanion({
      projectRoot: root,
      manifest: punctuationOnly,
    });
    assert.deepEqual(
      punctuationCompanion.fields.map(({ haxeName, runtimeName }) => ({ haxeName, runtimeName })),
      [
        { haxeName: "css24", runtimeName: "$" },
        { haxeName: "css2d2d", runtimeName: "--" },
      ],
    );
    assert.match(punctuationCompanion.content, /@:native\("\$"\)/u);
    assert.match(punctuationCompanion.content, /@:native\("--"\)/u);

    const bracketWrapped = manifestFor(css);
    bracketWrapped.exports = [
      { name: "[foo]", source: { path: "styles/card.module.css", line: 1, column: 2 } },
    ];
    assert.equal(validate(bracketWrapped), false, "the public schema rejects computed-name syntax");
    expectCode(
      () => generateCssModuleCompanion({ projectRoot: root, manifest: bracketWrapped }),
      "GENES-CSS-MODULE-EXPORT-NAME-005",
    );

    writeFileSync(path.join(root, "styles/card.module.css"), `${css}.new {}`, "utf8");
    expectCode(
      () => generateCssModuleCompanion({ projectRoot: root, manifest: manifestFor(css) }),
      "GENES-CSS-MODULE-MANIFEST-STALE-004",
    );
    writeFileSync(path.join(root, "styles/card.module.css"), css, "utf8");

    const collision = manifestFor(css);
    collision.exports = [
      { name: "foo--bar", source: { path: "styles/card.module.css", line: 1, column: 2 } },
      { name: "foo-bar", source: { path: "styles/card.module.css", line: 2, column: 2 } },
    ];
    // Sort the processor facts before asking for the companion. The failure is
    // about the Haxe projection, not malformed manifest ordering.
    expectCode(
      () => generateCssModuleCompanion({ projectRoot: root, manifest: collision }),
      "GENES-CSS-MODULE-NAME-COLLISION-006",
    );

    const unknownField = manifestFor(css);
    unknownField.surprise = true;
    expectCode(
      () => generateCssModuleCompanion({ projectRoot: root, manifest: unknownField }),
      "GENES-CSS-MODULE-MANIFEST-015",
    );

    const escapingPath = manifestFor(css);
    escapingPath.source = {
      entry: "../card.module.css",
      inputs: [{ path: "../card.module.css", sha256: sha256(css) }],
    };
    expectCode(
      () => generateCssModuleCompanion({ projectRoot: root, manifest: escapingPath }),
      "GENES-CSS-MODULE-PATH-011",
    );

    const unlistedOrigin = manifestFor(css);
    unlistedOrigin.exports = [
      { name: "card", source: { path: "styles/unlisted.module.css", line: 1, column: 2 } },
    ];
    expectCode(
      () => generateCssModuleCompanion({ projectRoot: root, manifest: unlistedOrigin }),
      "GENES-CSS-MODULE-MANIFEST-015",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main();
