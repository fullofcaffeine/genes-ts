import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
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

interface ValidatedInstalledPackageClosureRequest {
  readonly providerKind: string;
  readonly resolutionProfile: typeof INSTALLED_PACKAGE_RESOLUTION_PROFILE;
  readonly baseDirectoryLocator: string;
  readonly roots: readonly Readonly<InstalledPackageRoot>[];
  readonly limits: Readonly<InstalledPackageClosureLimits>;
}

interface ParsedPackageMetadata {
  readonly name: string;
  readonly version: string;
  readonly specifications: readonly DependencySpecification[];
}

interface CapturedFile {
  readonly relativePath: Buffer;
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
  relativePathBytes: number;
}

interface MetadataWorkBudget {
  remaining: number;
}

interface PendingDirectory {
  readonly relativePath: string;
  readonly relativePathBytes: number;
}

interface DirectoryName {
  readonly text: string;
  readonly bytes: Buffer;
}

interface StableFileCapture {
  readonly sizeBytes: number;
  readonly sha256: Buffer;
  readonly retainedBytes?: Buffer;
}

export interface InstalledPackageClosureTestHooks {
  readonly afterFirstCapture?: () => void;
  readonly afterFileRead?: (subject: string) => void;
  readonly maxRetainedPathBytes?: number;
  readonly readFileChunk?: (input: {
    readonly descriptor: number;
    readonly buffer: Buffer;
    readonly requestedBytes: number;
    readonly subject: string;
  }) => number | undefined;
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

const MAX_PACKAGE_METADATA_BYTES = 1024 * 1024;
const MAX_RETAINED_PATH_BYTES = 32 * 1024 * 1024;
const FILE_READ_CHUNK_BYTES = 64 * 1024;
const MAX_RESOLUTION_BASE_URL_CODE_UNITS =
  4 * ABSOLUTE_LIMITS.maxPathBytes + 64;

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

function ownValue(
  record: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function cleanIdentity(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 512 &&
    Buffer.byteLength(value, "utf8") <= 512 &&
    Buffer.from(value, "utf8").toString("utf8") === value &&
    !/[\u0000-\u001f\u007f\\]/u.test(value)
  );
}

function safeEntryNameBytes(value: string): Buffer | null {
  if (value.length === 0 || value.length > ABSOLUTE_LIMITS.maxPathBytes) {
    return null;
  }
  const bytes = Buffer.from(value, "utf8");
  if (
    bytes.length > ABSOLUTE_LIMITS.maxPathBytes ||
    bytes.toString("utf8") !== value ||
    /[\u0000-\u001f\u007f\uFFFD/\\]/u.test(value)
  ) {
    return null;
  }
  return bytes;
}

function packageSegment(value: string): boolean {
  return (
    /^[A-Za-z0-9!'()*][A-Za-z0-9.!'()*_~-]*$/u.test(value) &&
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

function validateLimits(limits: InstalledPackageClosureLimits): void {
  if (
    !positiveSafeInteger(limits.maxPackages, ABSOLUTE_LIMITS.maxPackages) ||
    !positiveSafeInteger(limits.maxEdges, ABSOLUTE_LIMITS.maxEdges) ||
    !positiveSafeInteger(limits.maxEntries, ABSOLUTE_LIMITS.maxEntries) ||
    !positiveSafeInteger(limits.maxFiles, ABSOLUTE_LIMITS.maxFiles) ||
    !positiveSafeInteger(limits.maxBytes, ABSOLUTE_LIMITS.maxBytes) ||
    !positiveSafeInteger(limits.maxPathBytes, ABSOLUTE_LIMITS.maxPathBytes)
  ) {
    return fail("invalid-request", "limits");
  }
}

function validateResolutionEnvironment(): void {
  if (
    (process.env.NODE_OPTIONS?.length ?? 0) > 0 ||
    (process.env.NODE_PATH?.length ?? 0) > 0 ||
    (process.env.NODE_PRESERVE_SYMLINKS?.length ?? 0) > 0 ||
    (process.env.NODE_PRESERVE_SYMLINKS_MAIN?.length ?? 0) > 0 ||
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

function requestRecord(
  value: unknown,
  subject: string,
): Readonly<Record<string, unknown>> {
  try {
    if (plainRecord(value)) return value;
  } catch {
    // A caller-owned proxy can throw while its prototype is inspected.
  }
  return fail("invalid-request", subject);
}

function requestValue(
  record: Readonly<Record<string, unknown>>,
  key: string,
  subject: string,
): unknown {
  try {
    return record[key];
  } catch {
    return fail("invalid-request", subject);
  }
}

function snapshotAndValidateRequest(
  request: InstalledPackageClosureRequest,
): ValidatedInstalledPackageClosureRequest {
  const source = requestRecord(request, "request");
  const providerKind = requestValue(source, "providerKind", "providerKind");
  const resolutionProfile = requestValue(
    source,
    "resolutionProfile",
    "resolutionProfile",
  );
  const resolutionBaseUrl = requestValue(
    source,
    "resolutionBaseUrl",
    "resolutionBaseUrl",
  );
  const rootsValue = requestValue(source, "roots", "roots");
  const limitsValue = requestValue(source, "limits", "limits");

  const limitSource = requestRecord(limitsValue, "limits");
  const maxPackages = requestValue(limitSource, "maxPackages", "limits");
  const maxEdges = requestValue(limitSource, "maxEdges", "limits");
  const maxEntries = requestValue(limitSource, "maxEntries", "limits");
  const maxFiles = requestValue(limitSource, "maxFiles", "limits");
  const maxBytes = requestValue(limitSource, "maxBytes", "limits");
  const maxPathBytes = requestValue(limitSource, "maxPathBytes", "limits");
  if (
    typeof maxPackages !== "number" ||
    typeof maxEdges !== "number" ||
    typeof maxEntries !== "number" ||
    typeof maxFiles !== "number" ||
    typeof maxBytes !== "number" ||
    typeof maxPathBytes !== "number"
  ) {
    return fail("invalid-request", "limits");
  }
  const limits: InstalledPackageClosureLimits = Object.freeze({
    maxPackages,
    maxEdges,
    maxEntries,
    maxFiles,
    maxBytes,
    maxPathBytes,
  });
  validateLimits(limits);

  let rootsAreArray = false;
  try {
    rootsAreArray = Array.isArray(rootsValue);
  } catch {
    return fail("invalid-request", "roots");
  }
  if (!rootsAreArray) return fail("invalid-request", "roots");
  const rootSource = rootsValue as readonly unknown[];
  let rootCount: unknown;
  try {
    rootCount = rootSource.length;
  } catch {
    return fail("invalid-request", "roots");
  }
  if (
    typeof rootCount !== "number" ||
    !Number.isSafeInteger(rootCount) ||
    rootCount < 1 ||
    rootCount > ABSOLUTE_LIMITS.maxPackages ||
    rootCount > limits.maxPackages
  ) {
    return fail("invalid-request", "roots");
  }

  const roots: InstalledPackageRoot[] = [];
  const rootNames = new Set<string>();
  for (let index = 0; index < rootCount; index += 1) {
    let rootValue: unknown;
    try {
      rootValue = rootSource[index];
    } catch {
      return fail("invalid-request", "roots");
    }
    const root = requestRecord(rootValue, "roots");
    const packageName = requestValue(root, "packageName", "roots");
    const expectedPackageName = requestValue(
      root,
      "expectedPackageName",
      "roots",
    );
    const expectedVersion = requestValue(root, "expectedVersion", "roots");
    if (
      typeof packageName !== "string" ||
      packageKeySegments(packageName) === null ||
      (expectedPackageName !== undefined &&
        (typeof expectedPackageName !== "string" ||
          packageKeySegments(expectedPackageName) === null)) ||
      typeof expectedVersion !== "string" ||
      !cleanIdentity(expectedVersion) ||
      rootNames.has(packageName)
    ) {
      return fail("invalid-request", "roots");
    }
    rootNames.add(packageName);
    roots.push(
      Object.freeze({
        packageName,
        ...(expectedPackageName === undefined ? {} : { expectedPackageName }),
        expectedVersion,
      }),
    );
  }

  if (typeof providerKind !== "string" || !cleanIdentity(providerKind)) {
    return fail("invalid-request", "providerKind");
  }
  if (resolutionProfile !== INSTALLED_PACKAGE_RESOLUTION_PROFILE) {
    return fail("invalid-request", "resolutionProfile");
  }
  if (
    typeof resolutionBaseUrl !== "string" ||
    resolutionBaseUrl.length > MAX_RESOLUTION_BASE_URL_CODE_UNITS
  ) {
    return fail("invalid-request", "resolutionBaseUrl");
  }

  let baseDirectoryLocator: string;
  try {
    const base = new URL(resolutionBaseUrl);
    if (base.protocol !== "file:") {
      return fail("invalid-request", "resolutionBaseUrl");
    }
    const baseFile = fileURLToPath(base);
    if (
      !path.isAbsolute(baseFile) ||
      baseFile.length > ABSOLUTE_LIMITS.maxPathBytes ||
      Buffer.byteLength(baseFile, "utf8") > ABSOLUTE_LIMITS.maxPathBytes
    ) {
      return fail("invalid-request", "resolutionBaseUrl");
    }
    baseDirectoryLocator = path.dirname(baseFile);
  } catch (error) {
    if (error instanceof InstalledPackageClosureError) throw error;
    return fail("invalid-request", "resolutionBaseUrl");
  }

  validateResolutionEnvironment();
  return Object.freeze({
    providerKind,
    resolutionProfile,
    baseDirectoryLocator,
    roots: Object.freeze(roots),
    limits,
  });
}

function resolveBaseDirectory(baseDirectoryLocator: string): string {
  try {
    return realpathSync.native(baseDirectoryLocator);
  } catch {
    return fail("invalid-request", "resolutionBaseUrl");
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

function sameFilesystemObject(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
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

function lstatAfterRead(absolute: string, subject: string): BigIntStats {
  try {
    return lstatSync(absolute, { bigint: true });
  } catch (error) {
    const code = nativeErrorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      return fail("package-closure-changed", subject);
    }
    return fail("package-filesystem-unsupported", subject);
  }
}

function safeReadFile(
  absolute: string,
  subject: string,
  maxBytes: number,
  retainBytes: boolean,
  scratch: Buffer,
  hooks: InstalledPackageClosureTestHooks | undefined,
): StableFileCapture {
  const metadataAllowance = retainBytes
    ? MAX_PACKAGE_METADATA_BYTES
    : Number.MAX_SAFE_INTEGER;
  const allowance = Math.min(maxBytes, metadataAllowance);
  const limitSubject =
    maxBytes <= metadataAllowance ? "maxBytes" : "maxPackageMetadataBytes";
  const lexical = lstatBigInt(absolute, subject);
  if (lexical.isSymbolicLink()) {
    return fail("package-symlink-unsupported", subject);
  }
  if (!lexical.isFile()) {
    return fail("package-filesystem-unsupported", subject);
  }
  if (lexical.size > BigInt(allowance)) {
    return fail("package-closure-limit", limitSubject);
  }
  let descriptor: number | null = null;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || !sameFile(lexical, before)) {
      return fail("package-closure-changed", subject);
    }

    const hash = createHash("sha256");
    const retainedChunks: Buffer[] = [];
    let totalRead = 0;
    let overflow = false;
    while (true) {
      const requested = Math.min(scratch.length, allowance + 1 - totalRead);
      if (requested <= 0) {
        overflow = true;
        break;
      }
      const overriddenCount = hooks?.readFileChunk?.({
        descriptor,
        buffer: scratch,
        requestedBytes: requested,
        subject,
      });
      const count =
        overriddenCount ?? readSync(descriptor, scratch, 0, requested, null);
      if (!Number.isInteger(count) || count < 0 || count > requested) {
        return fail("package-filesystem-unsupported", subject);
      }
      if (count === 0) break;
      const inBudget = Math.min(count, Math.max(0, allowance - totalRead));
      if (inBudget > 0) {
        const chunk = scratch.subarray(0, inBudget);
        hash.update(chunk);
        if (retainBytes) retainedChunks.push(Buffer.from(chunk));
      }
      totalRead += count;
      if (totalRead > allowance) {
        overflow = true;
        break;
      }
    }
    hooks?.afterFileRead?.(subject);
    const after = fstatSync(descriptor, { bigint: true });
    const linked = lstatAfterRead(absolute, subject);
    if (
      !sameFile(before, after) ||
      linked.isSymbolicLink() ||
      !linked.isFile() ||
      !sameFile(after, linked)
    ) {
      return fail("package-closure-changed", subject);
    }
    if (overflow) return fail("package-closure-limit", limitSubject);
    if (BigInt(totalRead) !== after.size) {
      return fail("package-filesystem-unsupported", subject);
    }
    return Object.freeze({
      sizeBytes: totalRead,
      sha256: hash.digest(),
      ...(retainBytes
        ? { retainedBytes: Buffer.concat(retainedChunks, totalRead) }
        : {}),
    });
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
  budget: MetadataWorkBudget,
): ReadonlyMap<string, string> {
  if (value === undefined) return new Map();
  if (!plainRecord(value)) {
    return fail("package-metadata-invalid", `${subject}:${field}`);
  }
  Object.setPrototypeOf(value, null);
  const result = new Map<string, string>();
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (budget.remaining === 0) {
      return fail("package-closure-limit", "maxEdges");
    }
    budget.remaining -= 1;
    const entry = value[key];
    if (packageKeySegments(key) === null || typeof entry !== "string") {
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
    parsed = JSON.parse(
      decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded,
    );
  } catch {
    return fail("package-metadata-invalid", subject);
  }
  if (!plainRecord(parsed)) {
    return fail("package-metadata-invalid", subject);
  }
  const name = ownValue(parsed, "name");
  const version = ownValue(parsed, "version");
  if (
    typeof name !== "string" ||
    typeof version !== "string" ||
    packageKeySegments(name) === null ||
    !cleanIdentity(version)
  ) {
    return fail("package-metadata-invalid", subject);
  }
  const budget: MetadataWorkBudget = { remaining: maximumEdges };
  const dependencies = stringMap(
    ownValue(parsed, "dependencies"),
    "dependencies",
    subject,
    budget,
  );
  const optionalDependencies = stringMap(
    ownValue(parsed, "optionalDependencies"),
    "optionalDependencies",
    subject,
    budget,
  );
  const peerDependencies = stringMap(
    ownValue(parsed, "peerDependencies"),
    "peerDependencies",
    subject,
    budget,
  );
  const optionalPeers = new Set<string>();
  const peerMetadata = ownValue(parsed, "peerDependenciesMeta");
  if (peerMetadata !== undefined) {
    if (!plainRecord(peerMetadata)) {
      return fail("package-metadata-invalid", `${subject}:peerDependenciesMeta`);
    }
    Object.setPrototypeOf(peerMetadata, null);
    for (const key in peerMetadata) {
      if (!Object.hasOwn(peerMetadata, key)) continue;
      if (budget.remaining === 0) {
        return fail("package-closure-limit", "maxEdges");
      }
      budget.remaining -= 1;
      if (packageKeySegments(key) === null) {
        return fail("package-metadata-invalid", `${subject}:peerDependenciesMeta`);
      }
      const metadata = peerMetadata[key];
      if (!plainRecord(metadata)) {
        return fail("package-metadata-invalid", `${subject}:peerDependenciesMeta`);
      }
      const optional = ownValue(metadata, "optional");
      if (optional !== undefined && typeof optional !== "boolean") {
        return fail("package-metadata-invalid", `${subject}:peerDependenciesMeta`);
      }
      if (optional === true && peerDependencies.has(key)) {
        optionalPeers.add(key);
      }
    }
  }
  return Object.freeze({
    name,
    version,
    specifications: edgeSpecifications(
      dependencies,
      optionalDependencies,
      peerDependencies,
      optionalPeers,
    ),
  });
}

function caseAliasedNodeModules(
  parent: string,
  listedName: string,
  listedBefore: BigIntStats,
  subject: string,
): boolean {
  if (listedName === "node_modules") return true;
  if (listedName.toLowerCase() !== "node_modules") return false;
  if (!listedBefore.isDirectory() || listedBefore.isSymbolicLink()) return false;

  const listedPath = path.join(parent, listedName);
  const lowercasePath = path.join(parent, "node_modules");
  let lowercaseBefore: BigIntStats;
  try {
    lowercaseBefore = lstatSync(lowercasePath, { bigint: true });
  } catch (error) {
    const code = nativeErrorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    return fail("package-filesystem-unsupported", subject);
  }
  if (!lowercaseBefore.isDirectory() || lowercaseBefore.isSymbolicLink()) {
    return false;
  }

  let listedRealpath: string;
  let lowercaseRealpath: string;
  try {
    listedRealpath = realpathSync.native(listedPath);
    lowercaseRealpath = realpathSync.native(lowercasePath);
  } catch {
    return fail("package-filesystem-unsupported", subject);
  }
  const listedAfter = lstatAfterRead(listedPath, subject);
  const lowercaseAfter = lstatAfterRead(lowercasePath, subject);
  if (
    !sameFile(listedBefore, listedAfter) ||
    !sameFile(lowercaseBefore, lowercaseAfter)
  ) {
    return fail("package-closure-changed", subject);
  }
  return (
    sameFilesystemObject(listedAfter, lowercaseAfter) &&
    listedRealpath === lowercaseRealpath
  );
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
  absolute: string,
  directory: PendingDirectory,
  subject: string,
  limits: InstalledPackageClosureLimits,
  budget: InventoryBudget,
  maximumRetainedPathBytes: number,
): readonly DirectoryName[] {
  const before = lstatBigInt(absolute, subject);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    return fail("package-filesystem-unsupported", subject);
  }
  const names: DirectoryName[] = [];
  let handle: ReturnType<typeof opendirSync> | null = null;
  try {
    handle = opendirSync(absolute);
    while (true) {
      const entry = handle.readSync();
      if (entry === null) break;
      const bytes = safeEntryNameBytes(entry.name);
      if (bytes === null) {
        return fail("package-filesystem-unsupported", subject);
      }
      budget.entries += 1;
      if (budget.entries > limits.maxEntries) {
        return fail("package-closure-limit", "maxEntries");
      }
      const relativePathBytes =
        directory.relativePathBytes +
        (directory.relativePathBytes === 0 ? 0 : 1) +
        bytes.length;
      if (relativePathBytes > limits.maxPathBytes) {
        return fail("package-closure-limit", "maxPathBytes");
      }
      budget.relativePathBytes += relativePathBytes;
      if (budget.relativePathBytes > maximumRetainedPathBytes) {
        return fail("package-closure-limit", "maxRetainedPathBytes");
      }
      names.push(Object.freeze({ text: entry.name, bytes }));
    }
  } catch (error) {
    if (error instanceof InstalledPackageClosureError) throw error;
    return fail("package-filesystem-unsupported", subject);
  } finally {
    if (handle !== null) closeDirectory(handle, subject);
  }
  const after = lstatBigInt(absolute, subject);
  if (!sameFile(before, after)) {
    return fail("package-closure-changed", subject);
  }
  return Object.freeze(
    names.sort((left, right) => Buffer.compare(left.bytes, right.bytes)),
  );
}

function capturePackage(
  root: string,
  subject: string,
  limits: InstalledPackageClosureLimits,
  budget: InventoryBudget,
  maximumEdges: number,
  scratch: Buffer,
  hooks: InstalledPackageClosureTestHooks | undefined,
): CapturedPackage {
  const files: CapturedFile[] = [];
  const directories: PendingDirectory[] = [
    { relativePath: "", relativePathBytes: 0 },
  ];
  let metadata: ParsedPackageMetadata | undefined;

  while (directories.length > 0) {
    const directory = directories.pop()!;
    const absoluteDirectory =
      directory.relativePath.length === 0
        ? root
        : path.join(root, directory.relativePath);
    const directorySubject =
      directory.relativePath.length === 0
        ? subject
        : `${subject}:${directory.relativePath}`;
    const names = readDirectoryNames(
      absoluteDirectory,
      directory,
      directorySubject,
      limits,
      budget,
      hooks?.maxRetainedPathBytes ?? MAX_RETAINED_PATH_BYTES,
    );
    const nextDirectories: PendingDirectory[] = [];
    for (const name of names) {
      const relativePath =
        directory.relativePath.length === 0
          ? name.text
          : `${directory.relativePath}/${name.text}`;
      const relativePathBytes =
        directory.relativePathBytes +
        (directory.relativePathBytes === 0 ? 0 : 1) +
        name.bytes.length;
      const absolute = path.join(absoluteDirectory, name.text);
      const entrySubject = `${subject}:${relativePath}`;
      const descriptor = lstatBigInt(absolute, entrySubject);
      if (descriptor.isSymbolicLink()) {
        return fail("package-symlink-unsupported", entrySubject);
      }
      if (descriptor.isDirectory()) {
        if (
          caseAliasedNodeModules(
            absoluteDirectory,
            name.text,
            descriptor,
            entrySubject,
          )
        ) {
          continue;
        }
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
        nextDirectories.push({ relativePath, relativePathBytes });
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
      const isPackageMetadata = relativePath === "package.json";
      const captured = safeReadFile(
        absolute,
        entrySubject,
        remaining,
        isPackageMetadata,
        scratch,
        hooks,
      );
      budget.bytes += captured.sizeBytes;
      if (budget.bytes > limits.maxBytes) {
        return fail("package-closure-limit", "maxBytes");
      }
      if (isPackageMetadata) {
        metadata = parsePackageMetadata(
          captured.retainedBytes!,
          subject,
          maximumEdges,
        );
      }
      files.push(
        Object.freeze({
          relativePath: Buffer.from(relativePath, "utf8"),
          sizeBytes: captured.sizeBytes,
          sha256: captured.sha256,
        }),
      );
    }
    for (let index = nextDirectories.length - 1; index >= 0; index -= 1) {
      directories.push(nextDirectories[index]!);
    }
  }

  if (metadata === undefined) {
    return fail("package-metadata-invalid", subject);
  }
  return Object.freeze({
    root,
    metadata,
    files: Object.freeze(
      files.sort((left, right) =>
        Buffer.compare(left.relativePath, right.relativePath),
      ),
    ),
  });
}

function edgeSpecifications(
  dependencies: ReadonlyMap<string, string>,
  optionalDependencies: ReadonlyMap<string, string>,
  peerDependencies: ReadonlyMap<string, string>,
  optionalPeers: ReadonlySet<string>,
): readonly DependencySpecification[] {
  const result: DependencySpecification[] = [];
  for (const key of sortedStrings(dependencies.keys())) {
    if (optionalDependencies.has(key)) continue;
    result.push({ kind: "dependency", key, optional: false });
  }
  for (const key of sortedStrings(optionalDependencies.keys())) {
    result.push({ kind: "optional", key, optional: true });
  }
  for (const key of sortedStrings(peerDependencies.keys())) {
    result.push({
      kind: "peer",
      key,
      optional: optionalPeers.has(key),
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
  request: ValidatedInstalledPackageClosureRequest,
  baseDirectory: string,
  hooks: InstalledPackageClosureTestHooks | undefined,
): {
  readonly roots: readonly RootRecord[];
  readonly nodes: readonly PackageNode[];
  readonly budget: Readonly<InventoryBudget>;
  readonly edgeCount: number;
} {
  const limits = request.limits;
  const nodesByRoot = new Map<string, PackageNode>();
  const queue: PackageNode[] = [];
  const budget: InventoryBudget = {
    entries: 0,
    files: 0,
    bytes: 0,
    relativePathBytes: 0,
  };
  const scratch = Buffer.allocUnsafe(FILE_READ_CHUNK_BYTES);
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
      scratch,
      hooks,
    );
    const specifications = captured.metadata.specifications;
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
  request: ValidatedInstalledPackageClosureRequest,
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
      writer.bytes(file.relativePath);
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
  return measureInstalledPackageClosureWithHooks(request);
}

/** Internal deterministic race seam; this module is not package-exported. */
export function measureInstalledPackageClosureWithHooks(
  request: InstalledPackageClosureRequest,
  hooks?: InstalledPackageClosureTestHooks,
): InstalledPackageClosureMeasurement {
  const validated = snapshotAndValidateRequest(request);
  const capture = (): InstalledPackageClosureMeasurement => {
    const baseDirectory = resolveBaseDirectory(validated.baseDirectoryLocator);
    const graph = discoverGraph(validated, baseDirectory, hooks);
    return Object.freeze({
      installedClosureIntegrity: canonicalIntegrity(
        validated,
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
  hooks?.afterFirstCapture?.();
  let verified: InstalledPackageClosureMeasurement;
  try {
    verified = capture();
  } catch (error) {
    if (error instanceof InstalledPackageClosureError) {
      return fail("package-closure-changed", validated.providerKind);
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
    return fail("package-closure-changed", validated.providerKind);
  }
  return verified;
}
