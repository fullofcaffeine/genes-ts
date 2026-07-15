import { createHash } from "crypto";
import fs from "fs";
import path from "path";

export type RuntimeModuleManifestEntry = {
  /** Importing source path, relative to the TypeScript project rootDir. */
  importer: string;
  /** Literal relative module specifier present in the importing source. */
  specifier: string;
  /** Literal relative specifier emitted by Genes in the generated module. */
  runtimeSpecifier: string;
  /** Source asset path, relative to the manifest file. */
  source: string;
  /** Destination path, relative to the generated importing module. */
  stagedPath: string;
  /** Build owner responsible for installing the staged asset beside final JS. */
  owner: string;
  /** SHA-256 of the source bytes. */
  sha256: string;
  /** Optional ESM `type` import attribute. */
  importType: string | null;
  /** Absolute source path used only while planning the transaction. */
  sourceFile: string;
};

export type RuntimeModuleManifestPlan = {
  manifestFile: string;
  entries: readonly RuntimeModuleManifestEntry[];
  byRequest: ReadonlyMap<string, RuntimeModuleManifestEntry>;
};

type JsonObject = { [key: string]: unknown };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: JsonObject, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${context}.${key} must be a non-empty string.`);
  return value;
}

function optionalString(record: JsonObject, key: string, context: string): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${context}.${key} must be a non-empty string or null.`);
  return value;
}

function portableRelative(value: string, label: string, allowParent: boolean): string {
  if (value.includes("\\"))
    throw new Error(`${label} must use forward slashes.`);
  if (path.posix.isAbsolute(value))
    throw new Error(`${label} must be relative.`);
  const normalized = path.posix.normalize(value);
  if (normalized === "." || normalized.length === 0)
    throw new Error(`${label} must name a file.`);
  if (!allowParent && (normalized === ".." || normalized.startsWith("../")))
    throw new Error(`${label} must stay inside its declared root.`);
  return normalized.replace(/^\.\//, "");
}

function relativeSpecifier(value: string, label: string): string {
  if (!(value.startsWith("./") || value.startsWith("../")))
    throw new Error(`${label} must be an explicit relative module specifier.`);
  if (value.includes("\\") || value.includes("?") || value.includes("#"))
    throw new Error(`${label} must be a plain forward-slash path without a query or fragment.`);
  return value;
}

export function runtimeModuleRequestKey(importer: string, specifier: string): string {
  return `${importer}\u0000${specifier}`;
}

/**
 * Loads and verifies the build-owned runtime-module staging manifest.
 *
 * Why: a relative side-effect import cannot be reclassified as an external
 * runtime file merely because TypeScript conversion did not emit its source.
 * That would leave both its identity and deployment ownership implicit.
 *
 * What: schema v1 pins the importing source/specifier, emitted relative
 * specifier, staging destination, owner, and exact source bytes. Duplicate
 * request identities and stale hashes fail before any output transaction.
 *
 * How: paths remain portable strings in the public contract; only `source` is
 * resolved against the manifest directory. The emitter later proves that the
 * staged destination matches the runtime specifier from the generated module
 * and that it remains inside the output tree.
 */
export function loadRuntimeModuleManifest(manifestFile: string): RuntimeModuleManifestPlan {
  const absoluteManifest = path.resolve(manifestFile);
  const raw: unknown = JSON.parse(fs.readFileSync(absoluteManifest, "utf8"));
  if (!isJsonObject(raw))
    throw new Error("Runtime-module manifest must be a JSON object.");
  if (raw.schemaVersion !== 1)
    throw new Error("Runtime-module manifest schemaVersion must be 1.");
  if (!Array.isArray(raw.modules))
    throw new Error("Runtime-module manifest modules must be an array.");

  const manifestDirectory = path.dirname(absoluteManifest);
  const entries: RuntimeModuleManifestEntry[] = [];
  const byRequest = new Map<string, RuntimeModuleManifestEntry>();

  for (let index = 0; index < raw.modules.length; index++) {
    const value: unknown = raw.modules[index];
    const context = `runtime module ${index}`;
    if (!isJsonObject(value))
      throw new Error(`${context} must be an object.`);

    const importer = portableRelative(
      requiredString(value, "importer", context),
      `${context}.importer`,
      false
    );
    const specifier = relativeSpecifier(
      requiredString(value, "specifier", context),
      `${context}.specifier`
    );
    const runtimeSpecifier = relativeSpecifier(
      requiredString(value, "runtimeSpecifier", context),
      `${context}.runtimeSpecifier`
    );
    const source = portableRelative(
      requiredString(value, "source", context),
      `${context}.source`,
      true
    );
    const stagedPath = relativeSpecifier(
      requiredString(value, "stagedPath", context),
      `${context}.stagedPath`
    );
    const owner = requiredString(value, "owner", context);
    const sha256 = requiredString(value, "sha256", context);
    if (!/^[a-f0-9]{64}$/.test(sha256))
      throw new Error(`${context}.sha256 must be 64 lowercase hexadecimal characters.`);
    const importType = optionalString(value, "importType", context);

    const sourceFile = path.resolve(manifestDirectory, source);
    if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile())
      throw new Error(`${context}.source does not name a file: ${source}.`);
    const actualHash = createHash("sha256").update(fs.readFileSync(sourceFile)).digest("hex");
    if (actualHash !== sha256)
      throw new Error(`${context}.sha256 does not match ${source}; expected ${sha256}, got ${actualHash}.`);

    const entry: RuntimeModuleManifestEntry = {
      importer,
      specifier,
      runtimeSpecifier,
      source,
      stagedPath,
      owner,
      sha256,
      importType,
      sourceFile
    };
    const key = runtimeModuleRequestKey(importer, specifier);
    if (byRequest.has(key))
      throw new Error(`${context} duplicates ${importer} ${specifier}.`);
    byRequest.set(key, entry);
    entries.push(entry);
  }

  return { manifestFile: absoluteManifest, entries, byRequest };
}
