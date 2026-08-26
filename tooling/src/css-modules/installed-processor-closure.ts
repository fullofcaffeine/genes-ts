import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  type BigIntStats,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type InstalledProcessorClosureFailureCode =
  | "invalid-request"
  | "package-unavailable"
  | "package-version-mismatch"
  | "package-metadata-invalid"
  | "package-entry-unsupported"
  | "package-filesystem-unsupported"
  | "package-symlink-unsupported"
  | "package-closure-limit"
  | "package-closure-changed";

/** One path-free failure from installed processor measurement. */
export class InstalledProcessorClosureError extends Error {
  readonly code: InstalledProcessorClosureFailureCode;
  readonly subject: string;

  constructor(code: InstalledProcessorClosureFailureCode, subject: string) {
    super(`${code}: ${subject}`);
    this.name = "InstalledProcessorClosureError";
    this.code = code;
    this.subject = subject;
  }
}

export interface InstalledProcessorRoot {
  readonly packageName: string;
  readonly resolvedPackageName?: string;
  readonly expectedVersion: string;
}

export interface InstalledProcessorClosureLimits {
  readonly maxPackages: number;
  readonly maxEdges: number;
  readonly maxEntries: number;
  readonly maxFiles: number;
  readonly maxBytes: number;
  readonly maxPathBytes: number;
}

export interface InstalledProcessorClosureRequest {
  readonly providerKind: string;
  readonly resolutionBaseUrl: string;
  readonly roots: readonly InstalledProcessorRoot[];
  readonly limits: InstalledProcessorClosureLimits;
}

export interface InstalledProcessorClosureMeasurement {
  readonly integrity: `sha256-${string}`;
  readonly packageCount: number;
  readonly edgeCount: number;
  readonly entryCount: number;
  readonly fileCount: number;
  readonly totalBytes: number;
}

export interface MeasuredProcessorOperationResult<Result> {
  readonly processorIntegrity: `sha256-${string}`;
  readonly packageCount: number;
  readonly edgeCount: number;
  readonly entryCount: number;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly result: Result;
}

type DependencyKind = "dependency" | "optional" | "peer";

interface ParsedPackageMetadata {
  readonly name: string;
  readonly version: string;
  readonly dependencies: ReadonlyMap<string, string>;
  readonly optionalDependencies: ReadonlyMap<string, string>;
  readonly peerDependencies: ReadonlyMap<string, string>;
  readonly optionalPeers: ReadonlySet<string>;
}

interface CapturedFile {
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly sha256: Buffer;
}

interface LocatedPackage {
  readonly root: string;
  readonly metadataBytes: Buffer;
  readonly metadata: ParsedPackageMetadata;
}

interface DependencyEdge {
  readonly kind: DependencyKind;
  readonly key: string;
  readonly target: PackageNode | null;
}

interface PackageNode extends LocatedPackage {
  files: readonly CapturedFile[];
  edges: readonly DependencyEdge[];
  expanded: boolean;
}

interface RootRecord {
  readonly packageName: string;
  readonly node: PackageNode;
}

interface InventoryBudget {
  entries: number;
  files: number;
  bytes: number;
}

type Locator = readonly string[];

function fail(
  code: InstalledProcessorClosureFailureCode,
  subject: string,
): never {
  throw new InstalledProcessorClosureError(code, subject);
}

function nativeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: string }).code
    : undefined;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sortedStrings(values: Iterable<string>): readonly string[] {
  return [...values].sort(compareUtf8);
}

function plainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cleanIdentity(value: string): boolean {
  return (
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= 512 &&
    !/[\u0000-\u001f\u007f\\]/u.test(value)
  );
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validateRequest(request: InstalledProcessorClosureRequest): void {
  if (!cleanIdentity(request.providerKind)) {
    return fail("invalid-request", "providerKind");
  }
  let base: URL;
  try {
    base = new URL(request.resolutionBaseUrl);
  } catch {
    return fail("invalid-request", "resolutionBaseUrl");
  }
  if (base.protocol !== "file:" || !path.isAbsolute(fileURLToPath(base))) {
    return fail("invalid-request", "resolutionBaseUrl");
  }
  if (request.roots.length === 0) {
    return fail("invalid-request", "roots");
  }
  const rootNames = new Set<string>();
  for (const root of request.roots) {
    if (
      !cleanIdentity(root.packageName) ||
      (root.resolvedPackageName !== undefined &&
        !cleanIdentity(root.resolvedPackageName)) ||
      !cleanIdentity(root.expectedVersion) ||
      rootNames.has(root.packageName)
    ) {
      return fail("invalid-request", "roots");
    }
    rootNames.add(root.packageName);
  }
  const limits = request.limits;
  if (
    !positiveSafeInteger(limits.maxPackages) ||
    !positiveSafeInteger(limits.maxEdges) ||
    !positiveSafeInteger(limits.maxEntries) ||
    !positiveSafeInteger(limits.maxFiles) ||
    !positiveSafeInteger(limits.maxBytes) ||
    !positiveSafeInteger(limits.maxPathBytes) ||
    request.roots.length > limits.maxPackages
  ) {
    return fail("invalid-request", "limits");
  }
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function lstatBigInt(absolute: string, subject: string): BigIntStats {
  try {
    return lstatSync(absolute, { bigint: true });
  } catch {
    return fail("package-filesystem-unsupported", subject);
  }
}

function safeReadFile(
  absolute: string,
  subject: string,
  maxBytes: number,
): Buffer {
  const lexical = lstatBigInt(absolute, subject);
  if (lexical.isSymbolicLink()) {
    return fail("package-symlink-unsupported", subject);
  }
  if (!lexical.isFile()) {
    return fail("package-filesystem-unsupported", subject);
  }
  if (lexical.size > BigInt(maxBytes)) {
    return fail("package-closure-limit", "maxBytes");
  }
  let descriptor: number | null = null;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile() ||
      before.dev !== lexical.dev ||
      before.ino !== lexical.ino ||
      before.size > BigInt(maxBytes)
    ) {
      return fail("package-closure-changed", subject);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    const linked = lstatBigInt(absolute, subject);
    if (
      BigInt(bytes.length) !== after.size ||
      !sameFile(before, after) ||
      linked.isSymbolicLink() ||
      !sameFile(after, linked)
    ) {
      return fail("package-closure-changed", subject);
    }
    return bytes;
  } catch (error) {
    if (error instanceof InstalledProcessorClosureError) throw error;
    return fail("package-filesystem-unsupported", subject);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function stringMap(
  value: unknown,
  field: string,
  subject: string,
): ReadonlyMap<string, string> {
  if (value === undefined) return new Map();
  if (!plainRecord(value)) {
    return fail("package-metadata-invalid", `${subject}:${field}`);
  }
  const result = new Map<string, string>();
  for (const key of sortedStrings(Object.keys(value))) {
    const entry = value[key];
    if (!cleanIdentity(key) || typeof entry !== "string" || !cleanIdentity(entry)) {
      return fail("package-metadata-invalid", `${subject}:${field}`);
    }
    result.set(key, entry);
  }
  return result;
}

function parsePackageMetadata(bytes: Buffer, subject: string): ParsedPackageMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return fail("package-metadata-invalid", subject);
  }
  if (!plainRecord(parsed)) {
    return fail("package-metadata-invalid", subject);
  }
  const name = parsed.name;
  const version = parsed.version;
  if (
    typeof name !== "string" ||
    typeof version !== "string" ||
    !cleanIdentity(name) ||
    !cleanIdentity(version)
  ) {
    return fail("package-metadata-invalid", subject);
  }
  const peerDependencies = stringMap(
    parsed.peerDependencies,
    "peerDependencies",
    subject,
  );
  const optionalPeers = new Set<string>();
  const peerMetadata = parsed.peerDependenciesMeta;
  if (peerMetadata !== undefined) {
    if (!plainRecord(peerMetadata)) {
      return fail("package-metadata-invalid", `${subject}:peerDependenciesMeta`);
    }
    for (const key of sortedStrings(Object.keys(peerMetadata))) {
      if (!peerDependencies.has(key)) {
        return fail("package-metadata-invalid", `${subject}:peerDependenciesMeta`);
      }
      const metadata = peerMetadata[key];
      if (!plainRecord(metadata)) {
        return fail("package-metadata-invalid", `${subject}:peerDependenciesMeta`);
      }
      if (
        metadata.optional !== undefined &&
        typeof metadata.optional !== "boolean"
      ) {
        return fail("package-metadata-invalid", `${subject}:peerDependenciesMeta`);
      }
      if (metadata.optional === true) optionalPeers.add(key);
    }
  }
  return Object.freeze({
    name,
    version,
    dependencies: stringMap(parsed.dependencies, "dependencies", subject),
    optionalDependencies: stringMap(
      parsed.optionalDependencies,
      "optionalDependencies",
      subject,
    ),
    peerDependencies,
    optionalPeers,
  });
}

function expectedAliasName(key: string, specification: string): string {
  if (!specification.startsWith("npm:")) return key;
  const alias = specification.slice(4);
  if (alias.startsWith("@")) {
    const slash = alias.indexOf("/");
    const version = alias.indexOf("@", slash + 1);
    return version < 0 ? alias : alias.slice(0, version);
  }
  const version = alias.indexOf("@");
  return version < 0 ? alias : alias.slice(0, version);
}

function locatePackageFromEntry(
  resolvedEntry: string,
  expectedPackageName: string,
  maxBytes: number,
): LocatedPackage {
  if (!path.isAbsolute(resolvedEntry)) {
    return fail("package-entry-unsupported", expectedPackageName);
  }
  let realEntry: string;
  try {
    realEntry = realpathSync.native(resolvedEntry);
  } catch {
    return fail("package-entry-unsupported", expectedPackageName);
  }
  let current = path.dirname(realEntry);
  while (true) {
    const metadataPath = path.join(current, "package.json");
    try {
      const descriptor = lstatSync(metadataPath, { bigint: true });
      if (!descriptor.isSymbolicLink() && descriptor.isFile()) {
        const bytes = safeReadFile(
          metadataPath,
          `${expectedPackageName}:package.json`,
          maxBytes,
        );
        const metadata = parsePackageMetadata(bytes, expectedPackageName);
        if (metadata.name === expectedPackageName) {
          let root: string;
          try {
            root = realpathSync.native(current);
          } catch {
            return fail("package-entry-unsupported", expectedPackageName);
          }
          return Object.freeze({ root, metadataBytes: bytes, metadata });
        }
      }
    } catch (error) {
      if (error instanceof InstalledProcessorClosureError) throw error;
      if (nativeErrorCode(error) !== "ENOENT") {
        return fail("package-filesystem-unsupported", expectedPackageName);
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return fail("package-entry-unsupported", expectedPackageName);
    }
    current = parent;
  }
}

function resolveEntry(
  resolver: ReturnType<typeof createRequire>,
  request: string,
  optional: boolean,
  subject: string,
): string | null {
  try {
    return resolver.resolve(request);
  } catch (error) {
    if (optional && nativeErrorCode(error) === "MODULE_NOT_FOUND") return null;
    return fail("package-unavailable", subject);
  }
}

function inventoryPackage(
  node: PackageNode,
  limits: InstalledProcessorClosureLimits,
  budget: InventoryBudget,
): readonly CapturedFile[] {
  const files: CapturedFile[] = [];

  const walk = (directory: string, segments: readonly string[]): void => {
    let names: readonly string[];
    try {
      names = readdirSync(directory).sort(compareUtf8);
    } catch {
      return fail("package-filesystem-unsupported", node.metadata.name);
    }
    for (const name of names) {
      if (name === "node_modules") continue;
      if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
        return fail("package-filesystem-unsupported", node.metadata.name);
      }
      const nextSegments = [...segments, name];
      const relativePath = nextSegments.join("/");
      if (Buffer.byteLength(relativePath, "utf8") > limits.maxPathBytes) {
        return fail("package-closure-limit", "maxPathBytes");
      }
      budget.entries += 1;
      if (budget.entries > limits.maxEntries) {
        return fail("package-closure-limit", "maxEntries");
      }
      const absolute = path.join(directory, name);
      const descriptor = lstatBigInt(
        absolute,
        `${node.metadata.name}:${relativePath}`,
      );
      if (descriptor.isSymbolicLink()) {
        return fail(
          "package-symlink-unsupported",
          `${node.metadata.name}:${relativePath}`,
        );
      }
      if (descriptor.isDirectory()) {
        let realDirectory: string;
        try {
          realDirectory = realpathSync.native(absolute);
        } catch {
          return fail(
            "package-filesystem-unsupported",
            `${node.metadata.name}:${relativePath}`,
          );
        }
        if (path.normalize(realDirectory) !== path.normalize(absolute)) {
          return fail(
            "package-symlink-unsupported",
            `${node.metadata.name}:${relativePath}`,
          );
        }
        walk(absolute, nextSegments);
        continue;
      }
      if (!descriptor.isFile()) {
        return fail(
          "package-filesystem-unsupported",
          `${node.metadata.name}:${relativePath}`,
        );
      }
      budget.files += 1;
      if (budget.files > limits.maxFiles) {
        return fail("package-closure-limit", "maxFiles");
      }
      const remaining = limits.maxBytes - budget.bytes;
      if (remaining <= 0) {
        return fail("package-closure-limit", "maxBytes");
      }
      const bytes = safeReadFile(
        absolute,
        `${node.metadata.name}:${relativePath}`,
        remaining,
      );
      budget.bytes += bytes.length;
      if (budget.bytes > limits.maxBytes) {
        return fail("package-closure-limit", "maxBytes");
      }
      if (
        relativePath === "package.json" &&
        !bytes.equals(node.metadataBytes)
      ) {
        return fail(
          "package-closure-changed",
          `${node.metadata.name}:package.json`,
        );
      }
      files.push(
        Object.freeze({
          relativePath,
          sizeBytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest(),
        }),
      );
    }
  };

  walk(node.root, []);
  if (!files.some((file) => file.relativePath === "package.json")) {
    return fail("package-metadata-invalid", node.metadata.name);
  }
  return Object.freeze(
    files.sort((left, right) =>
      compareUtf8(left.relativePath, right.relativePath),
    ),
  );
}

function edgeSpecifications(
  metadata: ParsedPackageMetadata,
): readonly {
  readonly kind: DependencyKind;
  readonly key: string;
  readonly specification: string;
  readonly optional: boolean;
}[] {
  const result: {
    readonly kind: DependencyKind;
    readonly key: string;
    readonly specification: string;
    readonly optional: boolean;
  }[] = [];
  for (const key of sortedStrings(metadata.dependencies.keys())) {
    if (metadata.optionalDependencies.has(key)) continue;
    result.push({
      kind: "dependency",
      key,
      specification: metadata.dependencies.get(key)!,
      optional: false,
    });
  }
  for (const key of sortedStrings(metadata.optionalDependencies.keys())) {
    result.push({
      kind: "optional",
      key,
      specification: metadata.optionalDependencies.get(key)!,
      optional: true,
    });
  }
  for (const key of sortedStrings(metadata.peerDependencies.keys())) {
    result.push({
      kind: "peer",
      key,
      specification: metadata.peerDependencies.get(key)!,
      optional: metadata.optionalPeers.has(key),
    });
  }
  return result.sort((left, right) => {
    const kind = compareUtf8(left.kind, right.kind);
    return kind === 0 ? compareUtf8(left.key, right.key) : kind;
  });
}

function discoverGraph(
  request: InstalledProcessorClosureRequest,
): {
  readonly roots: readonly RootRecord[];
  readonly nodes: readonly PackageNode[];
  readonly budget: Readonly<InventoryBudget>;
  readonly edgeCount: number;
} {
  const limits = request.limits;
  const baseResolver = createRequire(request.resolutionBaseUrl);
  const nodesByRoot = new Map<string, PackageNode>();
  const queue: PackageNode[] = [];
  const budget: InventoryBudget = { entries: 0, files: 0, bytes: 0 };
  let edgeCount = 0;

  const intern = (located: LocatedPackage): PackageNode => {
    const existing = nodesByRoot.get(located.root);
    if (existing !== undefined) {
      if (
        existing.metadata.name !== located.metadata.name ||
        existing.metadata.version !== located.metadata.version ||
        !existing.metadataBytes.equals(located.metadataBytes)
      ) {
        return fail("package-closure-changed", located.metadata.name);
      }
      return existing;
    }
    if (nodesByRoot.size >= limits.maxPackages) {
      return fail("package-closure-limit", "maxPackages");
    }
    const node: PackageNode = {
      ...located,
      files: Object.freeze([]),
      edges: Object.freeze([]),
      expanded: false,
    };
    nodesByRoot.set(located.root, node);
    queue.push(node);
    return node;
  };

  const roots = [...request.roots]
    .sort((left, right) => compareUtf8(left.packageName, right.packageName))
    .map((root): RootRecord => {
      const entry = resolveEntry(
        baseResolver,
        root.packageName,
        false,
        root.packageName,
      )!;
      const located = locatePackageFromEntry(
        entry,
        root.resolvedPackageName ?? root.packageName,
        limits.maxBytes,
      );
      if (located.metadata.version !== root.expectedVersion) {
        return fail("package-version-mismatch", root.packageName);
      }
      return Object.freeze({ packageName: root.packageName, node: intern(located) });
    });

  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index]!;
    if (node.expanded) continue;
    node.files = inventoryPackage(node, limits, budget);
    const resolver = createRequire(
      pathToFileURL(path.join(node.root, "package.json")).href,
    );
    const edges: DependencyEdge[] = [];
    for (const specification of edgeSpecifications(node.metadata)) {
      edgeCount += 1;
      if (edgeCount > limits.maxEdges) {
        return fail("package-closure-limit", "maxEdges");
      }
      const subject = `${node.metadata.name}:${specification.key}`;
      const entry = resolveEntry(
        resolver,
        specification.key,
        specification.optional,
        subject,
      );
      if (entry === null) {
        edges.push(
          Object.freeze({
            kind: specification.kind,
            key: specification.key,
            target: null,
          }),
        );
        continue;
      }
      const expectedName = expectedAliasName(
        specification.key,
        specification.specification,
      );
      const target = intern(
        locatePackageFromEntry(entry, expectedName, limits.maxBytes),
      );
      edges.push(
        Object.freeze({
          kind: specification.kind,
          key: specification.key,
          target,
        }),
      );
    }
    node.edges = Object.freeze(edges);
    node.expanded = true;
  }

  return Object.freeze({
    roots: Object.freeze(roots),
    nodes: Object.freeze([...nodesByRoot.values()]),
    budget: Object.freeze({ ...budget }),
    edgeCount,
  });
}

/**
 * A locator is the shortest dependency-name path from a fixed root. Physical
 * package locations never enter the canonical stream.
 */
function compareLocator(left: Locator, right: Locator): number {
  if (left.length !== right.length) return left.length - right.length;
  for (let index = 0; index < left.length; index += 1) {
    const compared = compareUtf8(left[index]!, right[index]!);
    if (compared !== 0) return compared;
  }
  return 0;
}

function assignLocators(
  roots: readonly RootRecord[],
  nodes: readonly PackageNode[],
): ReadonlyMap<PackageNode, Locator> {
  const locators = new Map<PackageNode, Locator>();
  const candidates: { readonly node: PackageNode; readonly locator: Locator }[] =
    roots.map((root) => ({
      node: root.node,
      locator: Object.freeze([root.packageName]),
    }));

  while (candidates.length > 0) {
    candidates.sort((left, right) => compareLocator(left.locator, right.locator));
    const candidate = candidates.shift()!;
    const current = locators.get(candidate.node);
    if (current !== undefined && compareLocator(current, candidate.locator) <= 0) {
      continue;
    }
    locators.set(candidate.node, candidate.locator);
    for (const edge of candidate.node.edges) {
      if (edge.target === null) continue;
      candidates.push({
        node: edge.target,
        locator: Object.freeze([...candidate.locator, edge.key]),
      });
    }
  }

  if (locators.size !== nodes.length) {
    return fail("package-metadata-invalid", "unreachable-package");
  }
  return locators;
}

class FramedSha256 {
  readonly #hash = createHash("sha256");

  bytes(value: Uint8Array): void {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(value.byteLength));
    this.#hash.update(length);
    this.#hash.update(value);
  }

  text(value: string): void {
    this.bytes(Buffer.from(value, "utf8"));
  }

  integer(value: number): void {
    this.text(String(value));
  }

  locator(value: Locator): void {
    this.integer(value.length);
    for (const segment of value) this.text(segment);
  }

  finish(): Buffer {
    return this.#hash.digest();
  }
}

function canonicalIntegrity(
  request: InstalledProcessorClosureRequest,
  roots: readonly RootRecord[],
  nodes: readonly PackageNode[],
): `sha256-${string}` {
  const locators = assignLocators(roots, nodes);
  const writer = new FramedSha256();
  writer.text("genes.processor-closure.v1");
  writer.text(request.providerKind);
  writer.integer(roots.length);
  for (const root of roots) {
    writer.text(root.packageName);
    writer.locator(locators.get(root.node)!);
  }
  const orderedNodes = [...nodes].sort((left, right) =>
    compareLocator(locators.get(left)!, locators.get(right)!),
  );
  writer.integer(orderedNodes.length);
  for (const node of orderedNodes) {
    writer.locator(locators.get(node)!);
    writer.text(node.metadata.name);
    writer.text(node.metadata.version);
    writer.integer(node.files.length);
    for (const file of node.files) {
      writer.text(file.relativePath);
      writer.integer(file.sizeBytes);
      writer.bytes(file.sha256);
    }
    writer.integer(node.edges.length);
    for (const edge of node.edges) {
      writer.text(edge.kind);
      writer.text(edge.key);
      if (edge.target === null) {
        writer.text("optional-absent");
      } else {
        writer.text("target");
        writer.text(edge.target.metadata.name);
        writer.locator(locators.get(edge.target)!);
      }
    }
  }
  return `sha256-${writer.finish().toString("base64")}`;
}

/** Measures one installed processor closure without serializing install paths. */
export function measureInstalledProcessorClosure(
  request: InstalledProcessorClosureRequest,
): InstalledProcessorClosureMeasurement {
  validateRequest(request);
  const graph = discoverGraph(request);
  return Object.freeze({
    integrity: canonicalIntegrity(request, graph.roots, graph.nodes),
    packageCount: graph.nodes.length,
    edgeCount: graph.edgeCount,
    entryCount: graph.budget.entries,
    fileCount: graph.budget.files,
    totalBytes: graph.budget.bytes,
  });
}

/**
 * Runs one worker-owned operation between two independent closure measures.
 * The worker must not import its optional processor before it calls this helper.
 */
export async function runMeasuredProcessorOperation<Result>(
  request: InstalledProcessorClosureRequest,
  operation: () => Promise<Result>,
): Promise<MeasuredProcessorOperationResult<Result>> {
  const before = measureInstalledProcessorClosure(request);
  const result = await operation();
  let after: InstalledProcessorClosureMeasurement;
  try {
    after = measureInstalledProcessorClosure(request);
  } catch (error) {
    if (error instanceof InstalledProcessorClosureError) {
      return fail("package-closure-changed", request.providerKind);
    }
    throw error;
  }
  if (before.integrity !== after.integrity) {
    return fail("package-closure-changed", request.providerKind);
  }
  return Object.freeze({
    processorIntegrity: before.integrity,
    packageCount: before.packageCount,
    edgeCount: before.edgeCount,
    entryCount: before.entryCount,
    fileCount: before.fileCount,
    totalBytes: before.totalBytes,
    result,
  });
}
