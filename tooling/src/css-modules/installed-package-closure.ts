import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readFileSync,
  realpathSync,
  type BigIntStats,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const INSTALLED_PACKAGE_RESOLUTION_PROFILE =
  "node-modules-realpath-v1" as const;

export type InstalledPackageClosureFailureCode =
  | "invalid-request"
  | "resolution-profile-unsupported"
  | "package-unavailable"
  | "package-version-mismatch"
  | "package-metadata-invalid"
  | "package-filesystem-unsupported"
  | "package-symlink-unsupported"
  | "package-closure-limit"
  | "package-closure-changed";

/** One path-free failure from installed package capture. */
export class InstalledPackageClosureError extends Error {
  readonly code: InstalledPackageClosureFailureCode;
  readonly subject: string;

  constructor(code: InstalledPackageClosureFailureCode, subject: string) {
    super(`${code}: ${subject}`);
    this.name = "InstalledPackageClosureError";
    this.code = code;
    this.subject = subject;
  }
}

export interface InstalledPackageRoot {
  /** The bare package key used at this resolver boundary. */
  readonly packageName: string;
  /** The package.json name expected at the installed root. */
  readonly expectedPackageName?: string;
  readonly expectedVersion: string;
}

export interface InstalledPackageClosureLimits {
  readonly maxPackages: number;
  readonly maxEdges: number;
  readonly maxEntries: number;
  readonly maxFiles: number;
  readonly maxBytes: number;
  readonly maxPathBytes: number;
}

export interface InstalledPackageClosureRequest {
  readonly providerKind: string;
  readonly resolutionProfile: typeof INSTALLED_PACKAGE_RESOLUTION_PROFILE;
  readonly resolutionBaseUrl: string;
  readonly roots: readonly InstalledPackageRoot[];
  readonly limits: InstalledPackageClosureLimits;
}

export interface InstalledPackageClosureMeasurement {
  /** Path-free identity for the measured installed package graph and bytes. */
  readonly installedClosureIntegrity: `sha256-${string}`;
  readonly packageCount: number;
  readonly edgeCount: number;
  /** Directory entries examined, including skipped node_modules directories. */
  readonly entryCount: number;
  readonly fileCount: number;
  readonly totalBytes: number;
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

interface CapturedPackage {
  readonly root: string;
  readonly metadata: ParsedPackageMetadata;
  readonly files: readonly CapturedFile[];
}

interface DependencyEdge {
  readonly kind: DependencyKind;
  readonly key: string;
  readonly target: PackageNode | null;
}

interface DependencySpecification {
  readonly kind: DependencyKind;
  readonly key: string;
  readonly optional: boolean;
}

interface PackageNode extends CapturedPackage {
  readonly specifications: readonly DependencySpecification[];
  edges: readonly DependencyEdge[];
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

interface PendingDirectory {
  readonly absolute: string;
  readonly segments: readonly string[];
}

interface ObservedDirectory {
  readonly absolute: string;
  readonly before: BigIntStats;
  readonly subject: string;
}

type Locator = readonly string[];

const ABSOLUTE_LIMITS: InstalledPackageClosureLimits = Object.freeze({
  maxPackages: 512,
  maxEdges: 4096,
  maxEntries: 100_000,
  maxFiles: 100_000,
  maxBytes: 512 * 1024 * 1024,
  maxPathBytes: 4096,
});

function fail(
  code: InstalledPackageClosureFailureCode,
  subject: string,
): never {
  throw new InstalledPackageClosureError(code, subject);
}

function nativeErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
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
    Buffer.from(value, "utf8").toString("utf8") === value &&
    !/[\u0000-\u001f\u007f\\]/u.test(value)
  );
}

function safeEntryName(value: string): boolean {
  return (
    value.length > 0 &&
    Buffer.from(value, "utf8").toString("utf8") === value &&
    !/[\u0000-\u001f\u007f\uFFFD/\\]/u.test(value)
  );
}

function packageSegment(value: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._~-]*$/u.test(value) &&
    value !== "." &&
    value !== ".."
  );
}

function packageKeySegments(value: string): readonly string[] | null {
  if (!cleanIdentity(value)) return null;
  if (value.startsWith("@")) {
    const segments = value.split("/");
    if (
      segments.length !== 2 ||
      !packageSegment(segments[0]!.slice(1)) ||
      !packageSegment(segments[1]!)
    ) {
      return null;
    }
    return Object.freeze(segments);
  }
  return packageSegment(value) ? Object.freeze([value]) : null;
}

function positiveSafeInteger(value: number, maximum: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= maximum
  );
}

function validateLimits(
  limits: InstalledPackageClosureLimits,
  rootCount: number,
): void {
  if (
    !positiveSafeInteger(limits.maxPackages, ABSOLUTE_LIMITS.maxPackages) ||
    !positiveSafeInteger(limits.maxEdges, ABSOLUTE_LIMITS.maxEdges) ||
    !positiveSafeInteger(limits.maxEntries, ABSOLUTE_LIMITS.maxEntries) ||
    !positiveSafeInteger(limits.maxFiles, ABSOLUTE_LIMITS.maxFiles) ||
    !positiveSafeInteger(limits.maxBytes, ABSOLUTE_LIMITS.maxBytes) ||
    !positiveSafeInteger(limits.maxPathBytes, ABSOLUTE_LIMITS.maxPathBytes) ||
    rootCount > limits.maxPackages
  ) {
    return fail("invalid-request", "limits");
  }
}

function validateResolutionEnvironment(): void {
  if (
    (process.env.NODE_OPTIONS?.length ?? 0) > 0 ||
    (process.env.NODE_PATH?.length ?? 0) > 0 ||
    (process.env.NODE_PRESERVE_SYMLINKS?.length ?? 0) > 0 ||
    process.versions["pnp"] !== undefined
  ) {
    return fail(
      "resolution-profile-unsupported",
      INSTALLED_PACKAGE_RESOLUTION_PROFILE,
    );
  }
  const unsupported = new Set([
    "--experimental-loader",
    "--import",
    "--loader",
    "--preserve-symlinks",
    "--preserve-symlinks-main",
    "--require",
    "-r",
  ]);
  for (const argument of process.execArgv) {
    const equals = argument.indexOf("=");
    const flag = equals < 0 ? argument : argument.slice(0, equals);
    const normalizedFlag = flag.startsWith("--")
      ? flag.replaceAll("_", "-")
      : flag;
    if (unsupported.has(normalizedFlag)) {
      return fail(
        "resolution-profile-unsupported",
        INSTALLED_PACKAGE_RESOLUTION_PROFILE,
      );
    }
  }
}

function validateRequest(request: InstalledPackageClosureRequest): string {
  if (!cleanIdentity(request.providerKind)) {
    return fail("invalid-request", "providerKind");
  }
  if (request.resolutionProfile !== INSTALLED_PACKAGE_RESOLUTION_PROFILE) {
    return fail("invalid-request", "resolutionProfile");
  }
  validateLimits(request.limits, request.roots.length);
  if (request.roots.length === 0) {
    return fail("invalid-request", "roots");
  }

  let baseDirectory: string;
  try {
    const base = new URL(request.resolutionBaseUrl);
    if (base.protocol !== "file:") {
      return fail("invalid-request", "resolutionBaseUrl");
    }
    const baseFile = fileURLToPath(base);
    if (!path.isAbsolute(baseFile)) {
      return fail("invalid-request", "resolutionBaseUrl");
    }
    baseDirectory = realpathSync.native(path.dirname(baseFile));
  } catch (error) {
    if (error instanceof InstalledPackageClosureError) throw error;
    return fail("invalid-request", "resolutionBaseUrl");
  }

  const rootNames = new Set<string>();
  for (const root of request.roots) {
    if (
      packageKeySegments(root.packageName) === null ||
      (root.expectedPackageName !== undefined &&
        packageKeySegments(root.expectedPackageName) === null) ||
      !cleanIdentity(root.expectedVersion) ||
      rootNames.has(root.packageName)
    ) {
      return fail("invalid-request", "roots");
    }
    rootNames.add(root.packageName);
  }
  validateResolutionEnvironment();
  return baseDirectory;
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

function closeFileDescriptor(descriptor: number, subject: string): void {
  try {
    closeSync(descriptor);
  } catch {
    return fail("package-filesystem-unsupported", subject);
  }
}

function closeDirectory(
  handle: ReturnType<typeof opendirSync>,
  subject: string,
): void {
  try {
    handle.closeSync();
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
    if (error instanceof InstalledPackageClosureError) throw error;
    return fail("package-filesystem-unsupported", subject);
  } finally {
    if (descriptor !== null) closeFileDescriptor(descriptor, subject);
  }
}

function stringMap(
  value: unknown,
  field: string,
  subject: string,
  maximumEntries: number,
): ReadonlyMap<string, string> {
  if (value === undefined) return new Map();
  if (!plainRecord(value)) {
    return fail("package-metadata-invalid", `${subject}:${field}`);
  }
  const result = new Map<string, string>();
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (result.size >= maximumEntries) {
      return fail("package-closure-limit", "maxEdges");
    }
    const entry = value[key];
    if (
      packageKeySegments(key) === null ||
      typeof entry !== "string" ||
      !cleanIdentity(entry)
    ) {
      return fail("package-metadata-invalid", `${subject}:${field}`);
    }
    result.set(key, entry);
  }
  return result;
}

function parsePackageMetadata(
  bytes: Buffer,
  subject: string,
  maximumEdges: number,
): ParsedPackageMetadata {
  let parsed: unknown;
  try {
    const decoded = bytes.toString("utf8");
    parsed = JSON.parse(decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded);
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
    packageKeySegments(name) === null ||
    !cleanIdentity(version)
  ) {
    return fail("package-metadata-invalid", subject);
  }
  const peerDependencies = stringMap(
    parsed.peerDependencies,
    "peerDependencies",
    subject,
    maximumEdges,
  );
  const optionalPeers = new Set<string>();
  const peerMetadata = parsed.peerDependenciesMeta;
  if (peerMetadata !== undefined) {
    if (!plainRecord(peerMetadata)) {
      return fail("package-metadata-invalid", `${subject}:peerDependenciesMeta`);
    }
    for (const key of sortedStrings(Object.keys(peerMetadata))) {
      if (packageKeySegments(key) === null) {
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
      if (metadata.optional === true && peerDependencies.has(key)) {
        optionalPeers.add(key);
      }
    }
  }
  return Object.freeze({
    name,
    version,
    dependencies: stringMap(
      parsed.dependencies,
      "dependencies",
      subject,
      maximumEdges,
    ),
    optionalDependencies: stringMap(
      parsed.optionalDependencies,
      "optionalDependencies",
      subject,
      maximumEdges,
    ),
    peerDependencies,
    optionalPeers,
  });
}

function nodeModulesSearchDirectories(fromDirectory: string): readonly string[] {
  const result: string[] = [];
  let current = fromDirectory;
  while (true) {
    if (path.basename(current) !== "node_modules") {
      result.push(path.join(current, "node_modules"));
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return Object.freeze(result);
}

function findInstalledPackageRoot(
  fromDirectory: string,
  packageName: string,
  optional: boolean,
  subject: string,
): string | null {
  const segments = packageKeySegments(packageName);
  if (segments === null) {
    return fail("package-metadata-invalid", subject);
  }
  for (const searchDirectory of nodeModulesSearchDirectories(fromDirectory)) {
    const candidate = path.join(searchDirectory, ...segments);
    let before: BigIntStats;
    try {
      before = lstatSync(candidate, { bigint: true });
    } catch (error) {
      const code = nativeErrorCode(error);
      if (code === "ENOENT" || code === "ENOTDIR") continue;
      return fail("package-filesystem-unsupported", subject);
    }
    if (!before.isDirectory() && !before.isSymbolicLink()) {
      return fail("package-filesystem-unsupported", subject);
    }
    let root: string;
    try {
      root = realpathSync.native(candidate);
    } catch {
      return fail("package-filesystem-unsupported", subject);
    }
    const linked = lstatBigInt(candidate, subject);
    const target = lstatBigInt(root, subject);
    if (!sameFile(before, linked)) {
      return fail("package-closure-changed", subject);
    }
    if (!target.isDirectory()) {
      return fail("package-filesystem-unsupported", subject);
    }
    return root;
  }
  return optional ? null : fail("package-unavailable", subject);
}

function readDirectoryNames(
  directory: PendingDirectory,
  subject: string,
  limits: InstalledPackageClosureLimits,
  budget: InventoryBudget,
  observedDirectories: ObservedDirectory[],
): readonly string[] {
  const before = lstatBigInt(directory.absolute, subject);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    return fail("package-filesystem-unsupported", subject);
  }
  const names: string[] = [];
  let handle: ReturnType<typeof opendirSync> | null = null;
  try {
    handle = opendirSync(directory.absolute);
    while (true) {
      const entry = handle.readSync();
      if (entry === null) break;
      if (!safeEntryName(entry.name)) {
        return fail("package-filesystem-unsupported", subject);
      }
      budget.entries += 1;
      if (budget.entries > limits.maxEntries) {
        return fail("package-closure-limit", "maxEntries");
      }
      names.push(entry.name);
    }
  } catch (error) {
    if (error instanceof InstalledPackageClosureError) throw error;
    return fail("package-filesystem-unsupported", subject);
  } finally {
    if (handle !== null) closeDirectory(handle, subject);
  }
  const after = lstatBigInt(directory.absolute, subject);
  if (!sameFile(before, after)) {
    return fail("package-closure-changed", subject);
  }
  observedDirectories.push({ absolute: directory.absolute, before, subject });
  return Object.freeze(names.sort(compareUtf8));
}

function capturePackage(
  root: string,
  subject: string,
  limits: InstalledPackageClosureLimits,
  budget: InventoryBudget,
  maximumEdges: number,
): CapturedPackage {
  const files: CapturedFile[] = [];
  const directories: PendingDirectory[] = [{ absolute: root, segments: [] }];
  const observedDirectories: ObservedDirectory[] = [];
  let metadataBytes: Buffer | undefined;

  while (directories.length > 0) {
    const directory = directories.pop()!;
    const directorySubject =
      directory.segments.length === 0
        ? subject
        : `${subject}:${directory.segments.join("/")}`;
    const names = readDirectoryNames(
      directory,
      directorySubject,
      limits,
      budget,
      observedDirectories,
    );
    const nextDirectories: PendingDirectory[] = [];
    for (const name of names) {
      const segments = [...directory.segments, name];
      const relativePath = segments.join("/");
      if (Buffer.byteLength(relativePath, "utf8") > limits.maxPathBytes) {
        return fail("package-closure-limit", "maxPathBytes");
      }
      const absolute = path.join(directory.absolute, name);
      const entrySubject = `${subject}:${relativePath}`;
      const descriptor = lstatBigInt(absolute, entrySubject);
      if (descriptor.isSymbolicLink()) {
        return fail("package-symlink-unsupported", entrySubject);
      }
      if (descriptor.isDirectory()) {
        if (name === "node_modules") continue;
        let realDirectory: string;
        try {
          realDirectory = realpathSync.native(absolute);
        } catch {
          return fail("package-filesystem-unsupported", entrySubject);
        }
        const linked = lstatBigInt(absolute, entrySubject);
        const target = lstatBigInt(realDirectory, entrySubject);
        if (!sameFile(descriptor, linked)) {
          return fail("package-closure-changed", entrySubject);
        }
        if (
          linked.isSymbolicLink() ||
          !target.isDirectory() ||
          !sameFile(linked, target)
        ) {
          return fail("package-symlink-unsupported", entrySubject);
        }
        nextDirectories.push({ absolute, segments });
        continue;
      }
      if (!descriptor.isFile()) {
        return fail("package-filesystem-unsupported", entrySubject);
      }
      budget.files += 1;
      if (budget.files > limits.maxFiles) {
        return fail("package-closure-limit", "maxFiles");
      }
      const remaining = limits.maxBytes - budget.bytes;
      const bytes = safeReadFile(absolute, entrySubject, remaining);
      budget.bytes += bytes.length;
      if (budget.bytes > limits.maxBytes) {
        return fail("package-closure-limit", "maxBytes");
      }
      if (relativePath === "package.json") metadataBytes = bytes;
      files.push(
        Object.freeze({
          relativePath,
          sizeBytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest(),
        }),
      );
    }
    for (let index = nextDirectories.length - 1; index >= 0; index -= 1) {
      directories.push(nextDirectories[index]!);
    }
  }

  for (const directory of observedDirectories) {
    const after = lstatBigInt(directory.absolute, directory.subject);
    if (!sameFile(directory.before, after)) {
      return fail("package-closure-changed", directory.subject);
    }
  }
  if (metadataBytes === undefined) {
    return fail("package-metadata-invalid", subject);
  }
  return Object.freeze({
    root,
    metadata: parsePackageMetadata(metadataBytes, subject, maximumEdges),
    files: Object.freeze(
      files.sort((left, right) =>
        compareUtf8(left.relativePath, right.relativePath),
      ),
    ),
  });
}

function edgeSpecifications(
  metadata: ParsedPackageMetadata,
): readonly DependencySpecification[] {
  const result: DependencySpecification[] = [];
  for (const key of sortedStrings(metadata.dependencies.keys())) {
    if (metadata.optionalDependencies.has(key)) continue;
    result.push({ kind: "dependency", key, optional: false });
  }
  for (const key of sortedStrings(metadata.optionalDependencies.keys())) {
    result.push({ kind: "optional", key, optional: true });
  }
  for (const key of sortedStrings(metadata.peerDependencies.keys())) {
    result.push({
      kind: "peer",
      key,
      optional: metadata.optionalPeers.has(key),
    });
  }
  return Object.freeze(
    result.sort((left, right) => {
      const kind = compareUtf8(left.kind, right.kind);
      return kind === 0 ? compareUtf8(left.key, right.key) : kind;
    }),
  );
}

function discoverGraph(
  request: InstalledPackageClosureRequest,
  baseDirectory: string,
): {
  readonly roots: readonly RootRecord[];
  readonly nodes: readonly PackageNode[];
  readonly budget: Readonly<InventoryBudget>;
  readonly edgeCount: number;
} {
  const limits = request.limits;
  const nodesByRoot = new Map<string, PackageNode>();
  const queue: PackageNode[] = [];
  const budget: InventoryBudget = { entries: 0, files: 0, bytes: 0 };
  let edgeCount = 0;

  const intern = (root: string, subject: string): PackageNode => {
    const existing = nodesByRoot.get(root);
    if (existing !== undefined) return existing;
    if (nodesByRoot.size >= limits.maxPackages) {
      return fail("package-closure-limit", "maxPackages");
    }
    const captured = capturePackage(
      root,
      subject,
      limits,
      budget,
      limits.maxEdges - edgeCount,
    );
    const specifications = edgeSpecifications(captured.metadata);
    if (specifications.length > limits.maxEdges - edgeCount) {
      return fail("package-closure-limit", "maxEdges");
    }
    edgeCount += specifications.length;
    const node: PackageNode = {
      ...captured,
      specifications,
      edges: Object.freeze([]),
    };
    nodesByRoot.set(root, node);
    queue.push(node);
    return node;
  };

  const roots = [...request.roots]
    .sort((left, right) => compareUtf8(left.packageName, right.packageName))
    .map((root): RootRecord => {
      const installedRoot = findInstalledPackageRoot(
        baseDirectory,
        root.packageName,
        false,
        root.packageName,
      )!;
      const node = intern(installedRoot, root.packageName);
      if (
        node.metadata.name !== (root.expectedPackageName ?? root.packageName) ||
        node.metadata.version !== root.expectedVersion
      ) {
        return fail("package-version-mismatch", root.packageName);
      }
      return Object.freeze({ packageName: root.packageName, node });
    });

  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index]!;
    const edges: DependencyEdge[] = [];
    for (const specification of node.specifications) {
      const subject = `${node.metadata.name}:${specification.key}`;
      const installedRoot = findInstalledPackageRoot(
        node.root,
        specification.key,
        specification.optional,
        subject,
      );
      edges.push(
        Object.freeze({
          kind: specification.kind,
          key: specification.key,
          target:
            installedRoot === null
              ? null
              : intern(installedRoot, subject),
        }),
      );
    }
    node.edges = Object.freeze(edges);
  }

  return Object.freeze({
    roots: Object.freeze(roots),
    nodes: Object.freeze([...nodesByRoot.values()]),
    budget: Object.freeze({ ...budget }),
    edgeCount,
  });
}

/** A locator is the shortest dependency-key path from one fixed root. */
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
  let candidates: { readonly node: PackageNode; readonly locator: Locator }[] =
    roots.map((root) => ({
      node: root.node,
      locator: Object.freeze([root.packageName]),
    }));

  while (candidates.length > 0) {
    candidates.sort((left, right) => compareLocator(left.locator, right.locator));
    const next: typeof candidates = [];
    for (const candidate of candidates) {
      if (locators.has(candidate.node)) continue;
      locators.set(candidate.node, candidate.locator);
      for (const edge of candidate.node.edges) {
        if (edge.target === null) continue;
        next.push({
          node: edge.target,
          locator: Object.freeze([...candidate.locator, edge.key]),
        });
      }
    }
    candidates = next;
  }
  if (locators.size !== nodes.length) {
    return fail("package-metadata-invalid", "unreachable-package");
  }
  const encoded = new Set<string>();
  for (const locator of locators.values()) {
    const key = JSON.stringify(locator);
    if (encoded.has(key)) {
      return fail("package-metadata-invalid", "canonical-locator-collision");
    }
    encoded.add(key);
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
  request: InstalledPackageClosureRequest,
  roots: readonly RootRecord[],
  nodes: readonly PackageNode[],
): `sha256-${string}` {
  const locators = assignLocators(roots, nodes);
  const writer = new FramedSha256();
  writer.text("genes.installed-package-closure.v1");
  writer.text(request.resolutionProfile);
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

/**
 * Measures one bounded closure from two matching, path-free captures.
 * This evidence does not prove which module bytes a provider later executes.
 */
export function measureInstalledPackageClosure(
  request: InstalledPackageClosureRequest,
): InstalledPackageClosureMeasurement {
  const baseDirectory = validateRequest(request);
  const capture = (): InstalledPackageClosureMeasurement => {
    const graph = discoverGraph(request, baseDirectory);
    return Object.freeze({
      installedClosureIntegrity: canonicalIntegrity(
        request,
        graph.roots,
        graph.nodes,
      ),
      packageCount: graph.nodes.length,
      edgeCount: graph.edgeCount,
      entryCount: graph.budget.entries,
      fileCount: graph.budget.files,
      totalBytes: graph.budget.bytes,
    });
  };
  // A package captured early can change while a later dependency is scanned.
  // Repeating resolution and inventory makes that stale first view fail closed.
  const first = capture();
  let verified: InstalledPackageClosureMeasurement;
  try {
    verified = capture();
  } catch (error) {
    if (error instanceof InstalledPackageClosureError) {
      return fail("package-closure-changed", request.providerKind);
    }
    throw error;
  }
  if (
    first.installedClosureIntegrity !== verified.installedClosureIntegrity ||
    first.packageCount !== verified.packageCount ||
    first.edgeCount !== verified.edgeCount ||
    first.entryCount !== verified.entryCount ||
    first.fileCount !== verified.fileCount ||
    first.totalBytes !== verified.totalBytes
  ) {
    return fail("package-closure-changed", request.providerKind);
  }
  return verified;
}
