import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { canonicalDigest, sha256Bytes } from "../artifacts/canonical-json.js";
import { cssModuleFailure } from "./error.js";
import {
  CSS_MODULE_EXPORTS_PROTOCOL,
  CSS_MODULE_EXPORTS_VERSION,
  CSS_MODULE_NAMING_POLICY,
  type CssModuleCompanion,
  type CssModuleCompanionField,
  type CssModuleExport,
  type CssModuleExportsManifestV1,
  type CssModuleInput,
  type CssModuleSourceLocation,
  type GenerateCssModuleCompanionOptions,
} from "./types.js";

const SHA256 = /^[0-9a-f]{64}$/u;
const SUBRESOURCE_INTEGRITY = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/u;
const MAX_TEXT_LENGTH = 16_384;
const MAX_EXPORTS = 10_000;
const HAXE_TYPE_PATH = /^(?:[a-z][A-Za-z0-9_]*\.)*[A-Z][A-Za-z0-9_]*$/u;
const HAXE_KEYWORDS = new Set([
  "abstract", "break", "case", "cast", "catch", "class", "continue",
  "default", "do", "dynamic", "else", "enum", "extends", "extern",
  "false", "final", "for", "from", "function", "if", "implements",
  "import", "in", "inline", "interface", "macro", "never", "new", "null",
  "operator", "overload", "override", "package", "private", "public",
  "return", "static", "super", "switch", "this", "throw", "to", "true",
  "try", "typedef", "untyped", "using", "var", "while",
]);

function haxeTypePath(value: string): boolean {
  if (!HAXE_TYPE_PATH.test(value)) return false;
  const packageSegments = value.split(".").slice(0, -1);
  return packageSegments.every((segment) => !HAXE_KEYWORDS.has(segment));
}

function failManifest(message: string, subject: string): never {
  return cssModuleFailure("GENES-CSS-MODULE-MANIFEST-015", message, subject);
}

function record(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failManifest(`${subject} must be an object.`, subject);
  }
  // JSON begins as `unknown`. After rejecting null, arrays, and primitives,
  // this narrow view lets the explicit field validators below inspect it.
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  subject: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\n") !== wanted.join("\n")) {
    failManifest(
      `${subject} must contain exactly: ${wanted.join(", ")}.`,
      subject,
    );
  }
}

function stringField(
  value: Record<string, unknown>,
  key: string,
  subject: string,
): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0 || field.length > MAX_TEXT_LENGTH) {
    failManifest(
      `${subject}.${key} must be a non-empty string no longer than ${MAX_TEXT_LENGTH} characters.`,
      `${subject}.${key}`,
    );
  }
  return field;
}

function positiveInteger(
  value: Record<string, unknown>,
  key: string,
  subject: string,
): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isSafeInteger(field) || field <= 0) {
    failManifest(`${subject}.${key} must be a positive integer.`, `${subject}.${key}`);
  }
  return field;
}

function portablePath(value: string, subject: string): string {
  if (
    value.length === 0 || value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    path.posix.isAbsolute(value) || value.startsWith("../") ||
    value === ".." || path.posix.normalize(value) !== value ||
    value.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    cssModuleFailure(
      "GENES-CSS-MODULE-PATH-011",
      `${subject} must be a normalized project-relative path using forward slashes.`,
      subject,
    );
  }
  return value;
}

function literalRequest(value: string): string {
  if (
    !(value.startsWith("./") || value.startsWith("../")) ||
    !value.endsWith(".module.css") || value.includes("\\") ||
    value.includes("?") || value.includes("#") || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    cssModuleFailure(
      "GENES-CSS-MODULE-PATH-011",
      "binding.request must be a literal relative path ending in .module.css, without a query or hash.",
      "binding.request",
    );
  }
  return value;
}

function parseLocation(value: unknown, subject: string): CssModuleSourceLocation {
  const source = record(value, subject);
  exactKeys(source, ["path", "line", "column"], subject);
  return Object.freeze({
    path: portablePath(stringField(source, "path", subject), `${subject}.path`),
    line: positiveInteger(source, "line", subject),
    column: positiveInteger(source, "column", subject),
  });
}

function parseInput(value: unknown, index: number): CssModuleInput {
  const subject = `source.inputs[${index}]`;
  const input = record(value, subject);
  exactKeys(input, ["path", "sha256"], subject);
  const digest = stringField(input, "sha256", subject);
  if (!SHA256.test(digest)) {
    failManifest(`${subject}.sha256 must be 64 lowercase hexadecimal characters.`, `${subject}.sha256`);
  }
  return Object.freeze({
    path: portablePath(stringField(input, "path", subject), `${subject}.path`),
    sha256: digest,
  });
}

function parseExport(value: unknown, index: number): CssModuleExport {
  const subject = `exports[${index}]`;
  const entry = record(value, subject);
  exactKeys(entry, ["name", "source"], subject);
  const name = stringField(entry, "name", subject);
  if (!/^[\x20-\x7e]+$/u.test(name)) {
    cssModuleFailure(
      "GENES-CSS-MODULE-EXPORT-NAME-005",
      "The processor reported an export name outside the printable ASCII naming policy supported by protocol version 1.",
      subject,
    );
  }
  if (/^\[.*\]$/u.test(name)) {
    cssModuleFailure(
      "GENES-CSS-MODULE-EXPORT-NAME-005",
      "CSS export names wrapped in square brackets are not supported by protocol version 1 because Genes reserves that native-name shape for computed property access.",
      subject,
    );
  }
  return Object.freeze({ name, source: parseLocation(entry.source, `${subject}.source`) });
}

function canonicalBy<T>(
  values: readonly T[],
  identity: (value: T) => string,
  subject: string,
): readonly T[] {
  const identities = values.map(identity);
  if (new Set(identities).size !== identities.length) {
    failManifest(`${subject} must not contain duplicate identities.`, subject);
  }
  return Object.freeze([...values].sort((left, right) =>
    Buffer.from(identity(left)).compare(Buffer.from(identity(right))),
  ));
}

/** Checks untrusted JSON and returns the exact version-one manifest. */
export function validateCssModuleExportsManifest(
  value: unknown,
): CssModuleExportsManifestV1 {
  const manifest = record(value, "manifest");
  exactKeys(
    manifest,
    ["protocol", "version", "namingPolicy", "binding", "source", "producer", "exports"],
    "manifest",
  );
  if (manifest.protocol !== CSS_MODULE_EXPORTS_PROTOCOL || manifest.version !== CSS_MODULE_EXPORTS_VERSION) {
    failManifest("Unsupported CSS Module manifest protocol or version.", "manifest");
  }
  if (manifest.namingPolicy !== CSS_MODULE_NAMING_POLICY) {
    failManifest("Unsupported CSS Module Haxe field naming policy.", "manifest.namingPolicy");
  }

  const binding = record(manifest.binding, "binding");
  exactKeys(binding, ["haxeOwner", "generatedModule", "request", "hostModulePath", "companionType"], "binding");
  const haxeOwner = stringField(binding, "haxeOwner", "binding");
  const generatedModule = portablePath(stringField(binding, "generatedModule", "binding"), "binding.generatedModule");
  const companionType = stringField(binding, "companionType", "binding");
  const hostModulePath = portablePath(
    stringField(binding, "hostModulePath", "binding"),
    "binding.hostModulePath",
  );
  if (!haxeTypePath(haxeOwner) || !haxeTypePath(companionType)) {
    failManifest("Haxe owner or companion type is not a valid qualified Haxe name.", "binding");
  }
  if (!hostModulePath.endsWith(".module.css")) {
    cssModuleFailure(
      "GENES-CSS-MODULE-PATH-011",
      "binding.hostModulePath must end in .module.css.",
      "binding.hostModulePath",
    );
  }

  const source = record(manifest.source, "source");
  exactKeys(source, ["entry", "inputs"], "source");
  if (!Array.isArray(source.inputs) || source.inputs.length === 0 || source.inputs.length > 10_000) {
    failManifest("source.inputs must contain between 1 and 10,000 files.", "source.inputs");
  }
  const inputs = canonicalBy(source.inputs.map(parseInput), (input) => input.path, "source.inputs");
  const entry = portablePath(stringField(source, "entry", "source"), "source.entry");
  if (!inputs.some((input) => input.path === entry)) {
    failManifest("source.entry must also appear in source.inputs.", "source.entry");
  }

  const producer = record(manifest.producer, "producer");
  exactKeys(producer, ["providerId", "providerVersion", "processorId", "processorVersion", "processorIntegrity", "configurationSha256"], "producer");
  const processorIntegrity = stringField(producer, "processorIntegrity", "producer");
  const configurationSha256 = stringField(producer, "configurationSha256", "producer");
  if (!SUBRESOURCE_INTEGRITY.test(processorIntegrity) || !SHA256.test(configurationSha256)) {
    failManifest("Processor integrity must be a sha256/sha384/sha512 SRI value, and configurationSha256 must be lowercase SHA-256.", "producer");
  }

  if (!Array.isArray(manifest.exports) || manifest.exports.length > MAX_EXPORTS) {
    failManifest(`exports must be an array with no more than ${MAX_EXPORTS} entries.`, "exports");
  }
  const exports = canonicalBy(manifest.exports.map(parseExport), (entry) => entry.name, "exports");
  const inputPaths = new Set(inputs.map((input) => input.path));
  for (const entry of exports) {
    if (!inputPaths.has(entry.source.path)) {
      failManifest(
        `Export ${JSON.stringify(entry.name)} points to ${entry.source.path}, but that file is not listed in source.inputs.`,
        `exports.${entry.name}.source.path`,
      );
    }
  }

  return Object.freeze({
    protocol: CSS_MODULE_EXPORTS_PROTOCOL,
    version: CSS_MODULE_EXPORTS_VERSION,
    namingPolicy: CSS_MODULE_NAMING_POLICY,
    binding: Object.freeze({
      haxeOwner,
      generatedModule,
      request: literalRequest(stringField(binding, "request", "binding")),
      hostModulePath,
      companionType,
    }),
    source: Object.freeze({ entry, inputs }),
    producer: Object.freeze({
      providerId: stringField(producer, "providerId", "producer"),
      providerVersion: stringField(producer, "providerVersion", "producer"),
      processorId: stringField(producer, "processorId", "producer"),
      processorVersion: stringField(producer, "processorVersion", "producer"),
      processorIntegrity,
      configurationSha256,
    }),
    exports,
  });
}

function verifyInputs(projectRoot: string, manifest: CssModuleExportsManifestV1): void {
  let root: string;
  try {
    root = realpathSync.native(projectRoot);
  } catch {
    cssModuleFailure("GENES-CSS-MODULE-PATH-011", "The project root does not exist.", "projectRoot");
  }
  for (const input of manifest.source.inputs) {
    const absolute = path.resolve(root, ...input.path.split("/"));
    const relative = path.relative(root, absolute);
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
      cssModuleFailure("GENES-CSS-MODULE-PATH-011", `CSS Module input ${input.path} leaves the project root.`, input.path);
    }
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(absolute);
    } catch {
      cssModuleFailure("GENES-CSS-MODULE-FILE-MISSING-002", `CSS Module input ${input.path} does not exist.`, input.path);
    }
    if (stats.isSymbolicLink() || !stats.isFile() || realpathSync.native(absolute) !== absolute) {
      cssModuleFailure("GENES-CSS-MODULE-PATH-011", `CSS Module input ${input.path} is not a regular, link-free file.`, input.path);
    }
    const actual = sha256Bytes(readFileSync(absolute));
    if (actual !== input.sha256) {
      cssModuleFailure(
        "GENES-CSS-MODULE-MANIFEST-STALE-004",
        `CSS Module manifest is for different bytes of ${input.path}. Regenerate the companion.`,
        input.path,
      );
    }
  }
}

function lowerCamel(runtimeName: string): string {
  const parts = runtimeName.match(/[A-Za-z0-9]+/gu) ?? [];
  let name: string;
  if (parts.length === 0) {
    // Protocol v1 export names are printable ASCII. A short hexadecimal form
    // therefore gives punctuation-only keys a stable legal Haxe spelling.
    name = `css${[...runtimeName]
      .map((character) => character.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")}`;
  } else {
    name = parts[0]!.toLowerCase();
    for (const part of parts.slice(1)) {
      name += part.slice(0, 1).toUpperCase() + part.slice(1);
    }
  }
  if (!/^[A-Za-z_]/u.test(name)) name = `css${name}`;
  if (HAXE_KEYWORDS.has(name)) name = `${name}_`;
  return name;
}

function isSafeHaxeField(name: string): boolean {
  return (
    /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) &&
    !HAXE_KEYWORDS.has(name) &&
    !name.startsWith("__") &&
    !name.startsWith("_hx_")
  );
}

function haxeCommentText(value: string): string {
  // POSIX permits `*` at the end of a path segment. Keep that valid path in
  // the manifest while preventing `*/` from ending generated Haxe comments.
  return value.replaceAll("*/", "* /");
}

function companionFields(exports: readonly CssModuleExport[]): readonly CssModuleCompanionField[] {
  const byHaxeName = new Map<string, CssModuleCompanionField>();
  return Object.freeze(exports.map((entry) => {
    const haxeName = isSafeHaxeField(entry.name)
      ? entry.name
      : lowerCamel(entry.name);
    const field = Object.freeze({ haxeName, runtimeName: entry.name, source: entry.source });
    const previous = byHaxeName.get(haxeName);
    if (previous !== undefined) {
      cssModuleFailure(
        "GENES-CSS-MODULE-NAME-COLLISION-006",
        `CSS exports ${JSON.stringify(previous.runtimeName)} and ${JSON.stringify(entry.name)} both become Haxe field ${JSON.stringify(haxeName)}. Rename one class.`,
        haxeName,
      );
    }
    byHaxeName.set(haxeName, field);
    return field;
  }));
}

function generatedContent(
  manifest: CssModuleExportsManifestV1,
  digest: string,
  fields: readonly CssModuleCompanionField[],
): { readonly path: string; readonly content: string } {
  const typeParts = manifest.binding.companionType.split(".");
  const typeName = typeParts.pop()!;
  const packageName = typeParts.join(".");
  const lines = [
    ...(packageName.length === 0 ? [] : [`package ${packageName};`, ""]),
    "/**",
    " * Exact CSS class names reported by the configured CSS Modules processor.",
    " *",
    ` * Source: ${haxeCommentText(manifest.source.entry)}`,
    " * Generated by @genes-ts/tooling; edit the stylesheet, not this file.",
    " */",
    "@:genes.cssModuleCompanion(",
    `  ${JSON.stringify(manifest.binding.haxeOwner)},`,
    `  ${JSON.stringify(manifest.binding.request)},`,
    `  ${JSON.stringify(`sha256:${digest}`)}`,
    ")",
    `typedef ${typeName} = {`,
  ];
  for (const field of fields) {
    lines.push("");
    lines.push(`  /** ${haxeCommentText(field.source.path)}:${field.source.line}:${field.source.column} */`);
    if (field.haxeName !== field.runtimeName) {
      lines.push(`  @:native(${JSON.stringify(field.runtimeName)})`);
    }
    lines.push(`  final ${field.haxeName}:String;`);
  }
  lines.push("}", "");
  return Object.freeze({
    path: `${manifest.binding.companionType.replaceAll(".", "/")}.hx`,
    content: lines.join("\n"),
  });
}

function generatedTypeScriptDeclaration(
  manifest: CssModuleExportsManifestV1,
  fields: readonly CssModuleCompanionField[],
): { readonly path: string; readonly content: string } {
  const lines = [
    "/**",
    " * Exact CSS Module export declared from the processor-owned manifest.",
    ` * Source: ${haxeCommentText(manifest.source.entry)}`,
    " * Generated by @genes-ts/tooling; edit the stylesheet, not this file.",
    " */",
    "declare const styles: {",
  ];
  for (const field of fields) {
    lines.push(`  readonly ${JSON.stringify(field.runtimeName)}: string;`);
  }
  lines.push("};", "", "export default styles;", "");
  return Object.freeze({
    // TypeScript resolves `card.module.css` through
    // `card.module.d.css.ts` when `allowArbitraryExtensions` is enabled.
    path: manifest.binding.hostModulePath.replace(/\.css$/u, ".d.css.ts"),
    content: lines.join("\n"),
  });
}

/**
 * Validates one processor-owned manifest and creates its closed Haxe companion.
 *
 * This function does not write files. Hosts may inspect the exact candidate and
 * include it in their own safe publication step.
 */
export function generateCssModuleCompanion(
  options: GenerateCssModuleCompanionOptions,
): CssModuleCompanion {
  const manifest = validateCssModuleExportsManifest(options.manifest);
  verifyInputs(options.projectRoot, manifest);
  const fields = companionFields(manifest.exports);
  // Spell out the versioned wire value so the digest cannot accidentally pick
  // up a future in-memory helper field that is not part of protocol version 1.
  const manifestSha256 = canonicalDigest({
    protocol: manifest.protocol,
    version: manifest.version,
    namingPolicy: manifest.namingPolicy,
    binding: {
      haxeOwner: manifest.binding.haxeOwner,
      generatedModule: manifest.binding.generatedModule,
      request: manifest.binding.request,
      hostModulePath: manifest.binding.hostModulePath,
      companionType: manifest.binding.companionType,
    },
    source: {
      entry: manifest.source.entry,
      inputs: manifest.source.inputs.map((input) => ({
        path: input.path,
        sha256: input.sha256,
      })),
    },
    producer: {
      providerId: manifest.producer.providerId,
      providerVersion: manifest.producer.providerVersion,
      processorId: manifest.producer.processorId,
      processorVersion: manifest.producer.processorVersion,
      processorIntegrity: manifest.producer.processorIntegrity,
      configurationSha256: manifest.producer.configurationSha256,
    },
    exports: manifest.exports.map((entry) => ({
      name: entry.name,
      source: {
        path: entry.source.path,
        line: entry.source.line,
        column: entry.source.column,
      },
    })),
  });
  const generated = generatedContent(manifest, manifestSha256, fields);
  const typescriptDeclaration = generatedTypeScriptDeclaration(manifest, fields);
  return Object.freeze({
    manifest,
    manifestSha256,
    relativePath: generated.path,
    content: generated.content,
    typescriptDeclarationRelativePath: typescriptDeclaration.path,
    typescriptDeclarationContent: typescriptDeclaration.content,
    fields,
  });
}
