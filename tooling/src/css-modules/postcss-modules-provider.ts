import path from "node:path";
import { createRequire } from "node:module";

import postcss from "postcss";
import postcssModules from "postcss-modules";
import selectorParser from "postcss-selector-parser";

import { canonicalDigest } from "../artifacts/canonical-json.js";
import { validateCssModuleExportsManifest } from "./companion.js";
import { cssModuleFailure } from "./error.js";
import {
  assertProviderFileUnchanged,
  providerProjectRoot,
  providerRelativePath,
  readProviderFile,
  type ProviderFile,
} from "./provider-files.js";
import {
  CSS_MODULE_EXPORTS_PROTOCOL,
  CSS_MODULE_EXPORTS_VERSION,
  CSS_MODULE_NAMING_POLICY,
  type CssModuleBinding,
  type CssModuleExportsManifestV1,
  type CssModuleSourceLocation,
} from "./types.js";

const POSTCSS_VERSION = "8.5.25";
const POSTCSS_INTEGRITY =
  "sha512-DTPx3RWSSnWyzLxQnlH0rJP+EW5ekl16ZU4/psbIhA0e53kJfdgaN5vKM+xP7yJtXVu+nfdVFmlgFDEKAe4Pyw==";
const POSTCSS_MODULES_VERSION = "9.0.1";
const POSTCSS_MODULES_INTEGRITY =
  "sha512-BrSXxWSls23TzqMuplpeMRL5VHnDOLh2H9EiHNTMIdLBFumJcurDIi47TBuvkn9GsoTLAoPjv2wLzAt1wdQ2aQ==";
const SELECTOR_PARSER_VERSION = "7.1.4";
const SELECTOR_PARSER_INTEGRITY =
  "sha512-HeP7D2wyhkR+XaK6v4W8oRF62Dsz4flyuczALJp61GckGm42u1saSSJ/0auvcBqxs3jMRFEcPK34At/0JBKdOg==";
const requirePackage = createRequire(import.meta.url);

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

function providerFailure(message: string, subject: string): never {
  return cssModuleFailure("GENES-CSS-MODULE-PROVIDER-016", message, subject);
}

function installedVersion(packageName: string, expected: string): void {
  let metadata: unknown;
  try {
    metadata = requirePackage(`${packageName}/package.json`);
  } catch {
    return providerFailure(
      `The pinned CSS Module provider package ${packageName}@${expected} is unavailable.`,
      packageName,
    );
  }
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    !("version" in metadata) ||
    metadata.version !== expected
  ) {
    return providerFailure(
      `The CSS Module provider requires ${packageName}@${expected}.`,
      packageName,
    );
  }
}

function configuration(
  value: unknown,
): PostcssModulesManifestConfiguration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return providerFailure("configuration must be one data-only object.", "configuration");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return providerFailure(
      "configuration must be a plain data object.",
      "configuration",
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    return providerFailure(
      "configuration must not contain symbol properties.",
      "configuration",
    );
  }
  const keys = ownKeys.map(String).sort();
  const expected = [
    "exportGlobals",
    "generateScopedName",
    "hashPrefix",
    "scopeBehaviour",
  ];
  if (keys.join("\n") !== expected.join("\n")) {
    return providerFailure(
      `configuration must contain exactly: ${expected.join(", ")}.`,
      "configuration",
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    expected.some((key) => {
      const descriptor = descriptors[key];
      return descriptor === undefined || !("value" in descriptor);
    })
  ) {
    return providerFailure(
      "configuration properties must be inert data values, not accessors.",
      "configuration",
    );
  }
  const generateScopedName: unknown = descriptors.generateScopedName?.value;
  const hashPrefix: unknown = descriptors.hashPrefix?.value;
  const exportGlobals: unknown = descriptors.exportGlobals?.value;
  const scopeBehaviour: unknown = descriptors.scopeBehaviour?.value;
  if (
    typeof generateScopedName !== "string" ||
    generateScopedName.length === 0 ||
    typeof hashPrefix !== "string" ||
    typeof exportGlobals !== "boolean" ||
    (scopeBehaviour !== "local" && scopeBehaviour !== "global")
  ) {
    return providerFailure(
      "configuration accepts only a non-empty generateScopedName string, " +
        "a hashPrefix string, a local/global scopeBehaviour, and an " +
        "exportGlobals boolean.",
      "configuration",
    );
  }
  return Object.freeze({
    generateScopedName,
    scopeBehaviour,
    exportGlobals,
    hashPrefix,
  });
}

function sourceLocation(
  source: string,
  offset: number,
  sourcePath: string,
): CssModuleSourceLocation {
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return Object.freeze({
    path: sourcePath,
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  });
}

function selectorLocations(
  source: string,
  sourcePath: string,
): ReadonlyMap<string, CssModuleSourceLocation> {
  const locations = new Map<string, CssModuleSourceLocation>();
  const root = postcss.parse(source, { from: sourcePath });
  root.walkRules((rule) => {
    if (rule.source?.start?.offset === undefined) {
      return providerFailure(
        `postcss did not report a source offset for a selector in ${sourcePath}.`,
        sourcePath,
      );
    }
    const selectorOffset = rule.source.start.offset;
    try {
      selectorParser((selectors) => {
        selectors.walkClasses((classNode) => {
          if (classNode.sourceIndex === undefined || locations.has(classNode.value)) {
            return;
          }
          // sourceIndex points at the dot. Point the manifest at the class name.
          locations.set(
            classNode.value,
            sourceLocation(source, selectorOffset + classNode.sourceIndex + 1, sourcePath),
          );
        });
      }).processSync(rule.selector);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return providerFailure(
        `postcss-selector-parser could not inspect ${sourcePath}: ${detail}`,
        sourcePath,
      );
    }
  });
  return locations;
}

function compositionPath(
  root: string,
  request: string,
  importer: string,
): string {
  if (
    !(request.startsWith("./") || request.startsWith("../")) ||
    request.includes("\\") ||
    request.includes("?") ||
    request.includes("#")
  ) {
    return providerFailure(
      `postcss-modules composition request ${JSON.stringify(request)} ` +
        "must be a relative CSS file without a query or hash.",
      request,
    );
  }
  const absolute = path.resolve(path.dirname(importer), request);
  const relative = path.relative(root, absolute);
  if (
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    return providerFailure(
      `postcss-modules composition request ${JSON.stringify(request)} leaves the project root.`,
      request,
    );
  }
  return providerRelativePath(relative.split(path.sep).join("/"), request);
}

/**
 * Runs the pinned postcss-modules provider with one closed data-only policy.
 *
 * Application PostCSS configuration is never loaded or executed. Relative
 * composition files are the only additional inputs the provider resolves.
 */
export async function createPostcssModulesManifest(
  options: PostcssModulesManifestOptions,
): Promise<CssModuleExportsManifestV1> {
  installedVersion("postcss", POSTCSS_VERSION);
  installedVersion("postcss-modules", POSTCSS_MODULES_VERSION);
  installedVersion("postcss-selector-parser", SELECTOR_PARSER_VERSION);
  const root = providerProjectRoot(options.projectRoot);
  const entryPath = providerRelativePath(options.entry, "entry");
  if (!entryPath.endsWith(".module.css")) {
    return providerFailure("entry must end in .module.css.", "entry");
  }
  const policy = configuration(options.configuration);
  const inputs = new Map<string, ProviderFile>();
  const entry = readProviderFile(root, entryPath, "entry");
  inputs.set(entryPath, entry);
  const locations = selectorLocations(entry.text, entryPath);
  let tokens: Readonly<Record<string, string>> | undefined;

  try {
    await postcss([
      postcssModules({
        generateScopedName: policy.generateScopedName,
        scopeBehaviour: policy.scopeBehaviour,
        exportGlobals: policy.exportGlobals,
        hashPrefix: policy.hashPrefix,
        getJSON(_cssFileName, output) {
          tokens = Object.freeze({ ...output });
        },
        resolve(request, importer) {
          const relative = compositionPath(root, request, importer);
          const input = readProviderFile(root, relative, relative);
          const previous = inputs.get(relative);
          if (previous !== undefined && previous.input.sha256 !== input.input.sha256) {
            cssModuleFailure(
              "GENES-CSS-MODULE-MANIFEST-STALE-004",
              `CSS Module provider input ${relative} changed while it was being resolved.`,
              relative,
            );
          }
          inputs.set(relative, input);
          return input.absolutePath;
        },
      }),
    ]).process(entry.text, { from: entry.absolutePath, map: false });
  } catch (error) {
    if (error instanceof Error && error.name === "CssModuleCompanionError") {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    return providerFailure(`postcss-modules could not process ${entryPath}: ${detail}`, entryPath);
  }

  if (tokens === undefined) {
    return providerFailure(
      `postcss-modules did not report export tokens for ${entryPath}.`,
      entryPath,
    );
  }
  for (const input of inputs.values()) {
    assertProviderFileUnchanged(root, input);
  }
  const exports = Object.keys(tokens).map((name) => {
    const location = locations.get(name);
    if (location === undefined) {
      return providerFailure(
        `postcss-modules exported ${JSON.stringify(name)}, but no exact ` +
          `class selector in ${entryPath} owns that key.`,
        name,
      );
    }
    return { name, source: location };
  });
  const configurationSha256 = canonicalDigest({
    providerProtocol: 1,
    postcssVersion: POSTCSS_VERSION,
    postcssIntegrity: POSTCSS_INTEGRITY,
    selectorParserVersion: SELECTOR_PARSER_VERSION,
    selectorParserIntegrity: SELECTOR_PARSER_INTEGRITY,
    generateScopedName: policy.generateScopedName,
    scopeBehaviour: policy.scopeBehaviour,
    exportGlobals: policy.exportGlobals,
    hashPrefix: policy.hashPrefix,
  });
  return validateCssModuleExportsManifest({
    protocol: CSS_MODULE_EXPORTS_PROTOCOL,
    version: CSS_MODULE_EXPORTS_VERSION,
    namingPolicy: CSS_MODULE_NAMING_POLICY,
    binding: options.binding,
    source: {
      entry: entryPath,
      inputs: [...inputs.values()].map((input) => input.input),
    },
    producer: {
      providerId: "@genes-ts/tooling/css-modules/postcss-modules",
      providerVersion: "1",
      processorId: "postcss-modules",
      processorVersion: POSTCSS_MODULES_VERSION,
      processorIntegrity: POSTCSS_MODULES_INTEGRITY,
      configurationSha256,
    },
    exports,
  });
}
