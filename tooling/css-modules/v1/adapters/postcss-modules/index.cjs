"use strict";

const { createHash } = require("node:crypto");
const path = require("node:path");
const { types: utilTypes } = require("node:util");

const postcss = require("postcss");
const postcssModules = require("postcss-modules");
const selectorParser = require("postcss-selector-parser");

const PROTOCOL = "genes.css-module-postcss-adapter.v1";
const POSTCSS_VERSION = "8.5.25";
const POSTCSS_MODULES_VERSION = "9.0.1";
const SELECTOR_PARSER_VERSION = "7.1.4";
// The admitted child always starts in its private materialized entry directory.
// Keeping virtual project paths below that fixed context makes string-pattern
// hashes independent of the real checkout and temporary-directory name.
const VIRTUAL_ROOT = path.resolve(process.cwd(), "project");
const postcssModulesEntry = require.resolve("postcss-modules");
const FileSystemLoader = require(
  path.join(path.dirname(postcssModulesEntry), "FileSystemLoader.js"),
).default;

class AdapterFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new AdapterFailure(code);
}

function compareUtf8(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

function record(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !utilTypes.isProxy(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function exactRecord(value, keys) {
  if (!record(value)) fail("invalid-input");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.getOwnPropertySymbols(value).length !== 0 ||
    Object.keys(descriptors).sort().join("\n") !== [...keys].sort().join("\n")
  ) {
    fail("invalid-input");
  }
  const result = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      fail("invalid-input");
    }
    result[key] = descriptor.value;
  }
  return result;
}

function portablePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 4096 ||
    value.includes("\\") ||
    value.includes(":") ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    fail("invalid-path");
  }
  return value;
}

function virtualPath(portable) {
  const absolute = path.resolve(VIRTUAL_ROOT, ...portable.split("/"));
  const relative = path.relative(VIRTUAL_ROOT, absolute);
  if (
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    fail("invalid-path");
  }
  return absolute;
}

function fromVirtual(absolute) {
  const relative = path.relative(VIRTUAL_ROOT, path.resolve(absolute));
  if (
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    fail("composition-path-invalid");
  }
  return portablePath(relative.split(path.sep).join("/"));
}

function validateVersions() {
  const versions = [
    [require("postcss/package.json").version, POSTCSS_VERSION],
    [
      require(path.join(path.dirname(postcssModulesEntry), "..", "package.json"))
        .version,
      POSTCSS_MODULES_VERSION,
    ],
    [require("postcss-selector-parser/package.json").version, SELECTOR_PARSER_VERSION],
  ];
  if (versions.some(([actual, expected]) => actual !== expected)) {
    fail("processor-version-mismatch");
  }
}

function parseInput(input) {
  const source = exactRecord(input, [
    "configuration",
    "entry",
    "files",
    "protocol",
  ]);
  if (source.protocol !== PROTOCOL || !Array.isArray(source.files)) {
    fail("invalid-input");
  }
  const entry = portablePath(source.entry);
  if (!entry.endsWith(".module.css")) fail("invalid-entry");
  const configuration = exactRecord(source.configuration, [
    "exportGlobals",
    "generateScopedName",
    "hashPrefix",
    "scopeBehaviour",
  ]);
  if (
    typeof configuration.generateScopedName !== "string" ||
    configuration.generateScopedName.length === 0 ||
    configuration.generateScopedName.length > 1024 ||
    typeof configuration.hashPrefix !== "string" ||
    configuration.hashPrefix.length > 1024 ||
    typeof configuration.exportGlobals !== "boolean" ||
    (configuration.scopeBehaviour !== "local" &&
      configuration.scopeBehaviour !== "global") ||
    source.files.length === 0 ||
    source.files.length > 256
  ) {
    fail("invalid-input");
  }
  const files = new Map();
  let previous;
  for (const value of source.files) {
    const file = exactRecord(value, ["path", "text"]);
    const filePath = portablePath(file.path);
    if (
      typeof file.text !== "string" ||
      (previous !== undefined && compareUtf8(filePath, previous) <= 0) ||
      files.has(filePath)
    ) {
      fail("invalid-input");
    }
    previous = filePath;
    files.set(filePath, file.text);
  }
  if (!files.has(entry)) fail("invalid-entry");
  return { configuration, entry, files };
}

function lineStarts(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 13) {
      if (source.charCodeAt(index + 1) === 10) index += 1;
      starts.push(index + 1);
    } else if (code === 10 || code === 12) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function location(starts, offset, sourcePath) {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] <= offset) low = middle;
    else high = middle;
  }
  return {
    path: sourcePath,
    line: low + 1,
    column: offset - starts[low] + 1,
  };
}

function authoredClasses(source, sourcePath) {
  const classes = [];
  const starts = lineStarts(source);
  const root = postcss.parse(source, { from: virtualPath(sourcePath) });
  root.walkRules((rule) => {
    const selectorStart = rule.source?.start?.offset;
    if (!Number.isSafeInteger(selectorStart)) fail("source-location-unavailable");
    selectorParser((selectors) => {
      selectors.walkClasses((node) => {
        if (!Number.isSafeInteger(node.sourceIndex)) {
          fail("source-location-unavailable");
        }
        const offset = selectorStart + node.sourceIndex + 1;
        classes.push({
          name: node.value,
          offset,
          source: location(starts, offset, sourcePath),
        });
      });
    }).processSync(rule.selector);
  });
  return classes;
}

function transformedClasses(source, sourcePath) {
  const classes = [];
  const root = postcss.parse(source, { from: virtualPath(sourcePath) });
  root.walkRules((rule) => {
    selectorParser((selectors) => {
      selectors.walkClasses((node) => classes.push(node.value));
    }).processSync(rule.selector);
  });
  return classes;
}

function decodedClassName(value) {
  let decoded;
  let count = 0;
  selectorParser((selectors) => {
    selectors.walkClasses((node) => {
      decoded = node.value;
      count += 1;
    });
  }).processSync(`.${value}`);
  if (count !== 1 || typeof decoded !== "string") {
    fail("selector-ownership-ambiguous");
  }
  return decoded;
}

function markerTable(authoredByPath) {
  const authoredNames = new Set();
  const identities = new Set();
  for (const [sourcePath, classes] of authoredByPath) {
    for (const item of classes) {
      authoredNames.add(item.name);
      identities.add(`${sourcePath}\u0000${item.name}`);
    }
  }
  const used = new Set();
  const markers = new Map();
  for (const identity of [...identities].sort(compareUtf8)) {
    const digest = createHash("sha256").update(identity).digest("hex");
    let marker = `_genes_local_${digest}`;
    let suffix = 0;
    while (authoredNames.has(marker) || used.has(marker)) {
      suffix += 1;
      marker = `_genes_local_${digest}_${suffix}`;
    }
    used.add(marker);
    markers.set(identity, marker);
  }
  return markers;
}

function stringTokens(value) {
  if (!record(value)) fail("processor-result-invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    fail("processor-result-invalid");
  }
  const tokens = new Map();
  for (const key of Object.keys(descriptors).sort(compareUtf8)) {
    const descriptor = descriptors[key];
    if (
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string" ||
      key.length === 0 ||
      descriptor.value.length === 0
    ) {
      fail("processor-result-invalid");
    }
    tokens.set(key, descriptor.value);
  }
  return tokens;
}

function missingResult(missing) {
  return {
    kind: "needs-inputs",
    missing: [...missing.values()].sort((left, right) =>
      compareUtf8(left.path, right.path) || compareUtf8(left.importer, right.importer),
    ),
  };
}

async function processFile(metrics, parsed, entry, generateScopedName) {
  metrics.processorPasses += 1;
  const missing = new Map();
  const used = new Set([entry]);
  const virtualFiles = new Map(
    [...parsed.files].map(([filePath, text]) => [virtualPath(filePath), text]),
  );
  let loader;

  class MemoryLoader extends FileSystemLoader {
    constructor(root, plugins, resolve) {
      super(root, plugins, resolve);
      loader = this;
      this.fs = {
        readFile: (filename, _encoding, callback) => {
          const absolute = path.resolve(filename);
          const text = virtualFiles.get(absolute);
          callback(null, text ?? "");
        },
      };
    }

    async fetch(requestValue, relativeTo, trace) {
      const request = String(requestValue).replace(/^["']|["']$/g, "");
      if (
        !(request.startsWith("./") || request.startsWith("../")) ||
        request.includes("\\") ||
        request.includes("?") ||
        request.includes("#")
      ) {
        fail("composition-path-invalid");
      }
      const importer = fromVirtual(relativeTo);
      const absolute = path.resolve(path.dirname(relativeTo), request);
      const requestedPath = fromVirtual(absolute);
      if (!virtualFiles.has(absolute)) {
        missing.set(`${requestedPath}\u0000${importer}`, {
          path: requestedPath,
          importer,
        });
      } else {
        used.add(requestedPath);
      }
      return super.fetch(request, relativeTo, trace);
    }

    get finalSource() {
      return "";
    }
  }

  let output;
  try {
    await postcss([
      postcssModules({
        Loader: MemoryLoader,
        exportGlobals: parsed.configuration.exportGlobals,
        generateScopedName,
        getJSON(_filename, value) {
          output = value;
        },
        hashPrefix: parsed.configuration.hashPrefix,
        scopeBehaviour: parsed.configuration.scopeBehaviour,
      }),
    ]).process(parsed.files.get(entry), {
      from: virtualPath(entry),
      map: false,
    }).then((result) => {
      output = { css: result.css, tokens: output };
    });
  } catch (error) {
    if (error instanceof AdapterFailure) throw error;
    if (missing.size > 0) return missingResult(missing);
    fail("css-invalid");
  }
  if (missing.size > 0) return missingResult(missing);
  if (!record(output) || typeof output.css !== "string") {
    fail("processor-result-invalid");
  }
  if (loader === undefined) fail("processor-result-invalid");
  const cssByPath = new Map([[entry, output.css]]);
  for (const [absolute, source] of Object.entries(loader.sources)) {
    if (typeof source !== "string") fail("processor-result-invalid");
    cssByPath.set(fromVirtual(absolute), source);
  }
  if (
    cssByPath.size !== used.size ||
    [...used].some((sourcePath) => !cssByPath.has(sourcePath))
  ) {
    fail("processor-result-invalid");
  }
  return {
    kind: "processed",
    css: output.css,
    cssByPath,
    tokens: stringTokens(output.tokens),
    used,
  };
}

function firstToken(value) {
  return value.trim().split(/\s+/u)[0] || "";
}

function compareCandidate(left, right) {
  return compareUtf8(left.source.path, right.source.path) || left.offset - right.offset;
}

async function run(input) {
  validateVersions();
  const parsed = parseInput(input);
  const metrics = { processorPasses: 0 };
  const authoredByPath = new Map();
  for (const [sourcePath, source] of parsed.files) {
    authoredByPath.set(sourcePath, authoredClasses(source, sourcePath));
  }
  const markers = markerTable(authoredByPath);
  const scoped = parsed.configuration.generateScopedName;
  const actual = await processFile(metrics, parsed, parsed.entry, scoped);
  if (actual.kind === "needs-inputs") return actual;
  const probeName = (name, filename) => {
    const sourcePath = fromVirtual(filename);
    const marker = markers.get(`${sourcePath}\u0000${decodedClassName(name)}`);
    if (marker === undefined) fail("selector-ownership-ambiguous");
    return marker;
  };
  const probe = await processFile(metrics, parsed, parsed.entry, probeName);
  if (probe.kind !== "processed") fail("processor-result-invalid");
  const actualKeys = [...actual.tokens.keys()];
  const probeKeys = [...probe.tokens.keys()];
  const actualInputs = [...actual.used].sort(compareUtf8);
  const probeInputs = [...probe.used].sort(compareUtf8);
  if (
    actualKeys.join("\n") !== probeKeys.join("\n") ||
    actualInputs.join("\n") !== probeInputs.join("\n")
  ) {
    fail("probe-export-mismatch");
  }

  const localCandidates = new Map();
  const globalCandidates = new Map();
  for (const sourcePath of actualInputs) {
    const authored = authoredByPath.get(sourcePath);
    const transformedSource = probe.cssByPath.get(sourcePath);
    if (!Array.isArray(authored) || typeof transformedSource !== "string") {
      fail("processor-result-invalid");
    }
    const transformed = transformedClasses(transformedSource, sourcePath);
    if (authored.length !== transformed.length) {
      fail("selector-class-count-mismatch");
    }
    for (let index = 0; index < authored.length; index += 1) {
      const item = authored[index];
      const observed = transformed[index];
      const marker = markers.get(`${sourcePath}\u0000${item.name}`);
      const candidate = { offset: item.offset, source: item.source };
      if (observed === marker) {
        const values = localCandidates.get(marker) ?? [];
        values.push(candidate);
        localCandidates.set(marker, values);
      } else if (observed === item.name) {
        const values = globalCandidates.get(item.name) ?? [];
        values.push(candidate);
        globalCandidates.set(item.name, values);
      } else {
        fail("selector-class-transform-mismatch");
      }
    }
  }

  const exports = [];
  for (const name of actualKeys) {
    const owner = firstToken(probe.tokens.get(name));
    const candidates = localCandidates.get(owner) ?? globalCandidates.get(owner) ?? [];
    if (candidates.length === 0) fail("export-source-unavailable");
    candidates.sort(compareCandidate);
    exports.push({ name, source: candidates[0].source });
  }
  if (metrics.processorPasses !== 2) fail("processor-result-invalid");
  return {
    kind: "success",
    exports,
    inputs: actualInputs,
    processorPasses: metrics.processorPasses,
    processorId: "postcss-modules",
    processorVersion: POSTCSS_MODULES_VERSION,
  };
}

exports.runGenesProcessor = async (input) => {
  try {
    return await run(input);
  } catch (error) {
    return {
      kind: "failure",
      code: error instanceof AdapterFailure ? error.code : "processor-failed",
    };
  }
};
