import { canonicalDigest } from "../artifacts/canonical-json.js";
import { validateCssModuleExportsManifest } from "./companion.js";
import { cssModuleFailure } from "./error.js";
import { executePackagedProviderAdapter } from "./provider-execution.js";
import {
  POSTCSS_MODULES_MAX_DISCOVERY_RUNS,
  POSTCSS_MODULES_MAX_IMPORT_DEPTH,
  POSTCSS_MODULES_MAX_INPUT_BYTES,
  POSTCSS_MODULES_MAX_INPUTS,
} from "./postcss-modules-policy.js";
import {
  assertProviderFileUnchanged,
  MAX_PROVIDER_FILE_BYTES,
  providerBinding,
  providerProjectRoot,
  providerRecord,
  providerRelativePath,
  readProviderFile,
  type ProviderFile,
} from "./provider-files.js";
import {
  CSS_MODULE_EXPORTS_PROTOCOL,
  CSS_MODULE_EXPORTS_VERSION,
  CSS_MODULE_NAMING_POLICY,
  type CssModuleBinding,
  type CssModuleExport,
  type CssModuleExportsManifestV1,
} from "./types.js";

const ADAPTER_PACKAGE_NAME = "@genes-ts/tooling-postcss-modules-adapter";
const ADAPTER_VERSION = "1.0.0";
const ADAPTER_DIRECTORY = new URL(
  "../../css-modules/v1/adapters/postcss-modules/",
  import.meta.url,
);
const ADAPTER_PROTOCOL = "genes.css-module-postcss-adapter.v1";
const POSTCSS_MODULES_VERSION = "9.0.1";

export interface PostcssModulesManifestConfiguration {
  readonly generateScopedName: string;
  readonly scopeBehaviour: "global" | "local";
  readonly exportGlobals: boolean;
  readonly hashPrefix: string;
}

export interface PostcssModulesManifestOptions {
  readonly projectRoot: string;
  readonly entry: string;
  readonly binding: CssModuleBinding;
  readonly configuration: PostcssModulesManifestConfiguration;
}

interface ProviderOptionsSnapshot {
  readonly projectRoot: string;
  readonly entry: string;
  readonly binding: CssModuleBinding;
  readonly configuration: PostcssModulesManifestConfiguration;
}

interface MissingInput {
  readonly importer: string;
  readonly path: string;
}

interface FinalAdapterResult {
  readonly exports: readonly CssModuleExport[];
  readonly inputs: readonly string[];
  readonly processorPasses: 2;
  readonly processorId: "postcss-modules";
  readonly processorVersion: typeof POSTCSS_MODULES_VERSION;
}

function providerFailure(message: string, subject: string): never {
  return cssModuleFailure("GENES-CSS-MODULE-PROVIDER-016", message, subject);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return providerFailure("The fixed PostCSS adapter returned invalid data.", "postcss-modules");
  }
  return value as Readonly<Record<string, unknown>>;
}

function stringField(
  source: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const value = source[key];
  if (typeof value !== "string") {
    return providerFailure("The fixed PostCSS adapter returned invalid data.", "postcss-modules");
  }
  return value;
}

function configuration(value: unknown): PostcssModulesManifestConfiguration {
  const source = providerRecord(
    value,
    ["exportGlobals", "generateScopedName", "hashPrefix", "scopeBehaviour"],
    "configuration",
  );
  const exportGlobals = source.exportGlobals;
  const generateScopedName = source.generateScopedName;
  const hashPrefix = source.hashPrefix;
  const scopeBehaviour = source.scopeBehaviour;
  if (
    typeof exportGlobals !== "boolean" ||
    typeof generateScopedName !== "string" ||
    generateScopedName.length === 0 ||
    generateScopedName.length > 1024 ||
    typeof hashPrefix !== "string" ||
    hashPrefix.length > 1024 ||
    (scopeBehaviour !== "global" && scopeBehaviour !== "local")
  ) {
    return providerFailure(
      "configuration accepts only a non-empty generateScopedName string, " +
        "a bounded hashPrefix string, a local/global scopeBehaviour, and an " +
        "exportGlobals boolean.",
      "configuration",
    );
  }
  return Object.freeze({
    exportGlobals,
    generateScopedName,
    hashPrefix,
    scopeBehaviour,
  });
}

function optionsSnapshot(options: PostcssModulesManifestOptions): ProviderOptionsSnapshot {
  const source = providerRecord(
    options,
    ["binding", "configuration", "entry", "projectRoot"],
    "options",
  );
  if (typeof source.projectRoot !== "string" || typeof source.entry !== "string") {
    return providerFailure("projectRoot and entry must be strings.", "options");
  }
  return Object.freeze({
    projectRoot: source.projectRoot,
    entry: source.entry,
    binding: providerBinding(source.binding),
    configuration: configuration(source.configuration),
  });
}

function sourceLocation(value: unknown): CssModuleExport["source"] {
  const source = record(value);
  const sourcePath = providerRelativePath(stringField(source, "path"), "export source path");
  const line = source.line;
  const column = source.column;
  if (
    typeof line !== "number" ||
    !Number.isSafeInteger(line) ||
    line < 1 ||
    typeof column !== "number" ||
    !Number.isSafeInteger(column) ||
    column < 1
  ) {
    return providerFailure("The fixed PostCSS adapter returned invalid source facts.", sourcePath);
  }
  return Object.freeze({ path: sourcePath, line, column });
}

function finalResult(value: Readonly<Record<string, unknown>>): FinalAdapterResult {
  if (!Array.isArray(value.exports) || !Array.isArray(value.inputs)) {
    return providerFailure("The fixed PostCSS adapter returned invalid data.", "postcss-modules");
  }
  const exports = value.exports.map((candidate) => {
    const item = record(candidate);
    const name = stringField(item, "name");
    if (name.length === 0) {
      return providerFailure("The fixed PostCSS adapter returned an empty export.", "exports");
    }
    return Object.freeze({ name, source: sourceLocation(item.source) });
  });
  const inputs = value.inputs.map((candidate) =>
    providerRelativePath(candidate, "processor input"),
  );
  if (
    new Set(inputs).size !== inputs.length ||
    [...inputs].sort(compareUtf8).join("\n") !== inputs.join("\n") ||
    value.processorPasses !== 2 ||
    stringField(value, "processorId") !== "postcss-modules" ||
    stringField(value, "processorVersion") !== POSTCSS_MODULES_VERSION
  ) {
    return providerFailure("The fixed PostCSS adapter returned invalid data.", "postcss-modules");
  }
  return Object.freeze({
    exports: Object.freeze(exports),
    inputs: Object.freeze(inputs),
    processorPasses: 2,
    processorId: "postcss-modules",
    processorVersion: POSTCSS_MODULES_VERSION,
  });
}

function missingInputs(value: unknown): readonly MissingInput[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > POSTCSS_MODULES_MAX_INPUTS
  ) {
    return providerFailure("The fixed PostCSS adapter returned invalid missing inputs.", "inputs");
  }
  return Object.freeze(value.map((candidate) => {
    const item = record(candidate);
    const importer = providerRelativePath(stringField(item, "importer"), "composition importer");
    const requestedPath = providerRelativePath(stringField(item, "path"), "composition input");
    if (!requestedPath.endsWith(".css")) {
      return providerFailure("Composition inputs must be relative CSS files.", requestedPath);
    }
    return Object.freeze({ importer, path: requestedPath });
  }));
}

function addInput(
  root: string,
  files: Map<string, ProviderFile>,
  depths: Map<string, number>,
  inputPath: string,
  depth: number,
): void {
  if (depth > POSTCSS_MODULES_MAX_IMPORT_DEPTH) {
    return providerFailure(
      `CSS Module composition exceeds the ${POSTCSS_MODULES_MAX_IMPORT_DEPTH}-level depth limit.`,
      inputPath,
    );
  }
  const previousDepth = depths.get(inputPath);
  if (previousDepth === undefined || depth < previousDepth) depths.set(inputPath, depth);
  if (files.has(inputPath)) return;
  if (files.size >= POSTCSS_MODULES_MAX_INPUTS) {
    return providerFailure(
      `CSS Module composition exceeds the ${POSTCSS_MODULES_MAX_INPUTS}-file input limit.`,
      inputPath,
    );
  }
  const file = readProviderFile(root, inputPath, inputPath);
  const total = [...files.values()].reduce(
    (bytes, current) => bytes + current.bytes.byteLength,
    file.bytes.byteLength,
  );
  if (
    total > POSTCSS_MODULES_MAX_INPUT_BYTES ||
    file.bytes.byteLength > MAX_PROVIDER_FILE_BYTES
  ) {
    return providerFailure(
      `CSS Module composition exceeds the ${POSTCSS_MODULES_MAX_INPUT_BYTES}-byte input limit.`,
      inputPath,
    );
  }
  files.set(inputPath, file);
}

async function execute(
  files: ReadonlyMap<string, ProviderFile>,
  entry: string,
  policy: PostcssModulesManifestConfiguration,
) {
  return executePackagedProviderAdapter({
    adapterDirectory: ADAPTER_DIRECTORY,
    adapterPackageName: ADAPTER_PACKAGE_NAME,
    adapterVersion: ADAPTER_VERSION,
    providerKind: "genes.css-module.postcss-modules.v1",
    subject: "postcss-modules",
    input: Object.freeze({
      protocol: ADAPTER_PROTOCOL,
      entry,
      configuration: Object.freeze({
        exportGlobals: policy.exportGlobals,
        generateScopedName: policy.generateScopedName,
        hashPrefix: policy.hashPrefix,
        scopeBehaviour: policy.scopeBehaviour,
      }),
      files: Object.freeze([...files].sort(([left], [right]) => compareUtf8(left, right)).map(
        ([filePath, file]) => Object.freeze({
          path: filePath,
          // Canonical base64 gives source bytes a finite encoded bound. The
          // 8 MiB source across 256 files, bounded paths, and bounded
          // configuration remain below the admitted execution request's
          // unchanged 16 MiB ceiling, including per-file base64 padding.
          bytesBase64: file.bytes.toString("base64"),
        }),
      )),
    }),
  });
}

/**
 * Runs one fixed, measured postcss-modules policy against inert stylesheet bytes.
 *
 * Application PostCSS configuration is never loaded. Relative CSS composition
 * inputs are discovered in fresh admitted children and read by this host only.
 */
export async function createPostcssModulesManifest(
  options: PostcssModulesManifestOptions,
): Promise<CssModuleExportsManifestV1> {
  const snapshot = optionsSnapshot(options);
  const root = providerProjectRoot(snapshot.projectRoot);
  const entryPath = providerRelativePath(snapshot.entry, "entry");
  if (!entryPath.endsWith(".module.css")) {
    return providerFailure("entry must end in .module.css.", "entry");
  }
  const files = new Map<string, ProviderFile>();
  const depths = new Map<string, number>();
  addInput(root, files, depths, entryPath, 0);

  let processorIntegrity: `sha256-${string}` | undefined;
  let final: FinalAdapterResult | undefined;
  for (let round = 0; round < POSTCSS_MODULES_MAX_DISCOVERY_RUNS; round += 1) {
    const execution = await execute(files, entryPath, snapshot.configuration);
    if (
      processorIntegrity !== undefined &&
      processorIntegrity !== execution.processorIntegrity
    ) {
      return providerFailure(
        "The fixed PostCSS package closure changed between input-discovery runs.",
        "postcss-modules",
      );
    }
    processorIntegrity = execution.processorIntegrity;
    const result = record(execution.result);
    const kind = stringField(result, "kind");
    if (kind === "failure") {
      return providerFailure(
        `The fixed PostCSS adapter rejected the stylesheet (${stringField(result, "code")}).`,
        entryPath,
      );
    }
    if (kind === "success") {
      final = finalResult(result);
      break;
    }
    if (kind !== "needs-inputs") {
      return providerFailure("The fixed PostCSS adapter returned invalid data.", "postcss-modules");
    }
    let added = false;
    for (const missing of missingInputs(result.missing)) {
      const importerDepth = depths.get(missing.importer);
      if (importerDepth === undefined) {
        return providerFailure(
          "The fixed PostCSS adapter reported an unknown composition importer.",
          missing.importer,
        );
      }
      const before = files.size;
      addInput(root, files, depths, missing.path, importerDepth + 1);
      added ||= files.size !== before;
    }
    if (!added) {
      return providerFailure(
        "The fixed PostCSS adapter could not complete composition input discovery.",
        entryPath,
      );
    }
  }
  if (final === undefined || processorIntegrity === undefined) {
    return providerFailure(
      `CSS Module composition exceeds the ${POSTCSS_MODULES_MAX_DISCOVERY_RUNS}-round discovery limit.`,
      entryPath,
    );
  }
  const expectedInputs = [...files.keys()].sort(compareUtf8);
  if (final.inputs.join("\n") !== expectedInputs.join("\n")) {
    return providerFailure(
      "The fixed PostCSS adapter did not account for every discovered input.",
      entryPath,
    );
  }
  for (const file of files.values()) assertProviderFileUnchanged(root, file);

  return validateCssModuleExportsManifest({
    protocol: CSS_MODULE_EXPORTS_PROTOCOL,
    version: CSS_MODULE_EXPORTS_VERSION,
    namingPolicy: CSS_MODULE_NAMING_POLICY,
    binding: snapshot.binding,
    source: {
      entry: entryPath,
      inputs: expectedInputs.map((inputPath) => files.get(inputPath)!.input),
    },
    producer: {
      providerId: "@genes-ts/tooling/css-modules/postcss-modules",
      providerVersion: "1",
      processorId: final.processorId,
      processorVersion: final.processorVersion,
      processorIntegrity,
      configurationSha256: canonicalDigest({
        protocol: "genes.css-module.postcss-modules.configuration.v1",
        ...snapshot.configuration,
      }),
    },
    exports: final.exports,
  });
}
