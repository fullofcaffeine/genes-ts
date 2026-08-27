import { canonicalDigest } from "../artifacts/canonical-json.js";
import { validateCssModuleExportsManifest } from "./companion.js";
import { cssModuleFailure } from "./error.js";
import { executePackagedProviderAdapter } from "./provider-execution.js";
import {
  assertProviderFileUnchanged,
  providerBinding,
  providerProjectRoot,
  providerRecord,
  providerRelativePath,
  readProviderFile,
} from "./provider-files.js";
import {
  CSS_MODULE_EXPORTS_PROTOCOL,
  CSS_MODULE_EXPORTS_VERSION,
  CSS_MODULE_NAMING_POLICY,
  type CssModuleBinding,
  type CssModuleExport,
  type CssModuleExportsManifestV1,
} from "./types.js";

const ADAPTER_PACKAGE_NAME = "@genes-ts/tooling-typescript-declaration-adapter";
const ADAPTER_VERSION = "1.0.0";
const ADAPTER_DIRECTORY = new URL(
  "../../css-modules/v1/adapters/typescript-declaration/",
  import.meta.url,
);
const ADAPTER_PROTOCOL = "genes.css-module-typescript-declaration-adapter.v1";
const TYPESCRIPT_VERSION = "6.0.3";

export interface TypeScriptDeclarationManifestOptions {
  readonly projectRoot: string;
  readonly entry: string;
  readonly declaration: string;
  readonly binding: CssModuleBinding;
}

function declarationFailure(message: string, subject: string): never {
  return cssModuleFailure("GENES-CSS-MODULE-DECLARATION-017", message, subject);
}

function resultRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return declarationFailure("The fixed TypeScript adapter returned invalid data.", "typescript");
  }
  return value as Readonly<Record<string, unknown>>;
}

function resultString(source: Readonly<Record<string, unknown>>, key: string): string {
  const value = source[key];
  if (typeof value !== "string") {
    return declarationFailure("The fixed TypeScript adapter returned invalid data.", "typescript");
  }
  return value;
}

function resultExports(value: unknown, declarationPath: string): readonly CssModuleExport[] {
  if (!Array.isArray(value) || value.length === 0) {
    return declarationFailure("The declaration must contain at least one closed export.", declarationPath);
  }
  return Object.freeze(value.map((candidate) => {
    const item = resultRecord(candidate);
    const name = resultString(item, "name");
    const source = resultRecord(item.source);
    const sourcePath = providerRelativePath(
      resultString(source, "path"),
      "declaration export source",
    );
    const line = source.line;
    const column = source.column;
    if (
      name.length === 0 ||
      sourcePath !== declarationPath ||
      typeof line !== "number" ||
      !Number.isSafeInteger(line) ||
      line < 1 ||
      typeof column !== "number" ||
      !Number.isSafeInteger(column) ||
      column < 1
    ) {
      return declarationFailure(
        "The fixed TypeScript adapter returned invalid source facts.",
        declarationPath,
      );
    }
    return Object.freeze({
      name,
      source: Object.freeze({ path: sourcePath, line, column }),
    });
  }));
}

/** Converts one finite per-file declaration through a measured TypeScript adapter. */
export async function createTypeScriptDeclarationManifest(
  options: TypeScriptDeclarationManifestOptions,
): Promise<CssModuleExportsManifestV1> {
  const snapshot = providerRecord(
    options,
    ["binding", "declaration", "entry", "projectRoot"],
    "options",
    declarationFailure,
  );
  if (
    typeof snapshot.projectRoot !== "string" ||
    typeof snapshot.entry !== "string" ||
    typeof snapshot.declaration !== "string"
  ) {
    return declarationFailure("projectRoot, entry, and declaration must be strings.", "options");
  }
  const binding = providerBinding(snapshot.binding);
  const root = providerProjectRoot(snapshot.projectRoot);
  const entryPath = providerRelativePath(snapshot.entry, "entry");
  const declarationPath = providerRelativePath(snapshot.declaration, "declaration");
  if (!entryPath.endsWith(".module.css") || declarationPath !== `${entryPath}.d.ts`) {
    return declarationFailure(
      "declaration must be the exact per-file path `<entry>.d.ts` for one .module.css entry.",
      "declaration",
    );
  }
  const entry = readProviderFile(root, entryPath, "entry");
  const declaration = readProviderFile(root, declarationPath, "declaration");
  const execution = await executePackagedProviderAdapter({
    adapterDirectory: ADAPTER_DIRECTORY,
    adapterPackageName: ADAPTER_PACKAGE_NAME,
    adapterVersion: ADAPTER_VERSION,
    providerKind: "genes.css-module.typescript-declaration.v1",
    subject: "typescript",
    input: Object.freeze({
      protocol: ADAPTER_PROTOCOL,
      declarationPath,
      text: declaration.text,
    }),
  });
  const result = resultRecord(execution.result);
  if (resultString(result, "kind") !== "success") {
    const detail = typeof result.code === "string" ? result.code : "declaration-invalid";
    return declarationFailure(
      `The per-file declaration is not a closed readonly string map (${detail}).`,
      declarationPath,
    );
  }
  if (
    resultString(result, "processorId") !== "typescript" ||
    resultString(result, "processorVersion") !== TYPESCRIPT_VERSION
  ) {
    return declarationFailure("The fixed TypeScript adapter returned invalid identity.", "typescript");
  }
  const exports = resultExports(result.exports, declarationPath);
  assertProviderFileUnchanged(root, entry);
  assertProviderFileUnchanged(root, declaration);
  return validateCssModuleExportsManifest({
    protocol: CSS_MODULE_EXPORTS_PROTOCOL,
    version: CSS_MODULE_EXPORTS_VERSION,
    namingPolicy: CSS_MODULE_NAMING_POLICY,
    binding,
    source: {
      entry: entryPath,
      inputs: [entry.input, declaration.input],
    },
    producer: {
      providerId: "@genes-ts/tooling/css-modules/typescript-declaration",
      providerVersion: "1",
      processorId: "typescript",
      processorVersion: TYPESCRIPT_VERSION,
      processorIntegrity: execution.processorIntegrity,
      configurationSha256: canonicalDigest({
        protocol: "genes.css-module.typescript-declaration.configuration.v1",
        shape: "declare-const-closed-readonly-string-literal-default-export",
      }),
    },
    exports,
  });
}
