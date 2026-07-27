import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";

import type {
  HaxeWaitEndpoint,
  HaxeWaitEnsureResult,
  HaxeWaitFallbackReason,
  HaxeWaitServerEvent,
  OwnedHaxeWaitProcess,
  OwnedHaxeWaitServerOptions,
} from "./types.js";

const LEASE_SCHEMA = "genes.tooling.haxe-wait-server-lease.v1";
const DEFAULT_READINESS_TIMEOUT_MS = 4_000;
const DEFAULT_PROBE_INTERVAL_MS = 50;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_500;

interface Lease {
  readonly schema: typeof LEASE_SCHEMA;
  readonly projectIdentity: string;
  readonly compatibilityDigest: string;
  readonly ownerPid: number;
  readonly serverPid: number;
  readonly host: "127.0.0.1";
  readonly port: number;
}

function canonicalLease(lease: Lease): Buffer {
  return Buffer.from(
    `${JSON.stringify({
      compatibilityDigest: lease.compatibilityDigest,
      host: lease.host,
      ownerPid: lease.ownerPid,
      port: lease.port,
      projectIdentity: lease.projectIdentity,
      schema: lease.schema,
      serverPid: lease.serverPid,
    })}\n`,
    "utf8",
  );
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function containedBy(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function safeLeasePath(projectRoot: string, relativeLease: string): string {
  if (
    relativeLease.length === 0 ||
    path.isAbsolute(relativeLease) ||
    relativeLease.split(/[\\/]/u).some((segment) => segment === "..")
  ) {
    throw new Error("leasePath must be a contained project-relative path");
  }
  const absolute = path.resolve(projectRoot, relativeLease);
  if (!containedBy(projectRoot, absolute)) {
    throw new Error("leasePath escapes projectRoot");
  }
  let current = projectRoot;
  const segments = path.relative(projectRoot, path.dirname(absolute)).split(path.sep);
  for (const segment of segments) {
    if (segment.length === 0) {
      continue;
    }
    current = path.join(current, segment);
    if (!existsSync(current)) {
      throw new Error(`lease parent does not exist: ${current}`);
    }
    const stats = lstatSync(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`lease parent is not a real directory: ${current}`);
    }
  }
  if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) {
    throw new Error("leasePath is a symbolic link");
  }
  return absolute;
}

function decodeLease(bytes: Buffer): Lease | null {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "compatibilityDigest,host,ownerPid,port,projectIdentity,schema,serverPid" ||
    record.schema !== LEASE_SCHEMA ||
    typeof record.projectIdentity !== "string" ||
    record.projectIdentity.length === 0 ||
    typeof record.compatibilityDigest !== "string" ||
    record.compatibilityDigest.length === 0 ||
    record.host !== "127.0.0.1" ||
    !Number.isInteger(record.ownerPid) ||
    (record.ownerPid as number) <= 0 ||
    !Number.isInteger(record.serverPid) ||
    (record.serverPid as number) <= 0 ||
    !Number.isInteger(record.port) ||
    (record.port as number) <= 0 ||
    (record.port as number) > 65_535
  ) {
    return null;
  }
  const lease: Lease = {
    schema: LEASE_SCHEMA,
    projectIdentity: record.projectIdentity,
    compatibilityDigest: record.compatibilityDigest,
    ownerPid: record.ownerPid as number,
    serverPid: record.serverPid as number,
    host: "127.0.0.1",
    port: record.port as number,
  };
  return canonicalLease(lease).equals(bytes) ? Object.freeze(lease) : null;
}

export async function reserveLoopbackEndpoint(): Promise<HaxeWaitEndpoint> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error) => {
      try {
        server.close();
      } catch {
        // The reservation may fail before the server enters a listening state.
      }
      reject(error);
    });
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    server.close();
    throw new Error("loopback reservation did not return an address");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return Object.freeze({
    host: "127.0.0.1",
    port: address.port,
    argument: `127.0.0.1:${address.port}`,
  });
}

export class OwnedHaxeWaitServer<Result> {
  readonly #options: OwnedHaxeWaitServerOptions<Result>;
  readonly #projectRoot: string;
  readonly #leaseRelative: string;
  readonly #leasePath: string;
  readonly #readinessTimeoutMs: number;
  readonly #probeIntervalMs: number;
  readonly #shutdownTimeoutMs: number;
  #process: OwnedHaxeWaitProcess | null = null;
  #endpoint: HaxeWaitEndpoint | null = null;
  #compatibilityDigest: string | null = null;
  #fallbackDigest: string | null = null;
  #leaseBytes: Buffer | null = null;
  #ready = false;
  #stopping = false;
  #closed = false;
  #operationTail: Promise<void> = Promise.resolve();

  constructor(options: OwnedHaxeWaitServerOptions<Result>) {
    this.#options = options;
    this.#projectRoot = realpathSync.native(path.resolve(options.projectRoot));
    if (!lstatSync(this.#projectRoot).isDirectory()) {
      throw new Error("projectRoot must be a real directory");
    }
    this.#leaseRelative = options.leasePath;
    this.#leasePath = safeLeasePath(this.#projectRoot, options.leasePath);
    if (options.projectIdentity.length === 0) {
      throw new Error("projectIdentity must not be empty");
    }
    positiveInteger(options.ownerPid, "ownerPid");
    this.#readinessTimeoutMs = positiveInteger(
      options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
      "readinessTimeoutMs",
    );
    this.#probeIntervalMs = positiveInteger(
      options.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS,
      "probeIntervalMs",
    );
    this.#shutdownTimeoutMs = positiveInteger(
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
      "shutdownTimeoutMs",
    );
  }

  ensure(compatibilityDigest: string): Promise<HaxeWaitEnsureResult> {
    return this.#serialized(() => this.#ensure(compatibilityDigest));
  }

  async #ensure(
    compatibilityDigest: string,
  ): Promise<HaxeWaitEnsureResult> {
    if (compatibilityDigest.length === 0) {
      throw new Error("compatibilityDigest must not be empty");
    }
    if (this.#closed) {
      return Object.freeze({ mode: "direct", newlyStarted: false });
    }
    if (
      this.#ready &&
      this.#process !== null &&
      this.#compatibilityDigest === compatibilityDigest
    ) {
      return Object.freeze({ mode: "connected", newlyStarted: false });
    }
    if (this.#fallbackDigest === compatibilityDigest) {
      return Object.freeze({ mode: "direct", newlyStarted: false });
    }
    if (this.#process !== null) {
      if (!(await this.#stopOwned())) {
        return this.#fallback(compatibilityDigest, "shutdown-timeout");
      }
    }
    const claim = this.#claimLease();
    if (claim !== null) {
      return this.#fallback(compatibilityDigest, claim);
    }

    let endpoint: HaxeWaitEndpoint;
    try {
      endpoint = await (
        this.#options.reserveEndpoint?.() ?? reserveLoopbackEndpoint()
      );
      this.#validateEndpoint(endpoint);
    } catch {
      return this.#fallback(
        compatibilityDigest,
        "port-reservation-failed",
      );
    }

    let processHandle: OwnedHaxeWaitProcess;
    try {
      processHandle = await this.#options.start(endpoint);
      positiveInteger(processHandle.pid, "server pid");
    } catch {
      return this.#fallback(compatibilityDigest, "start-failed");
    }
    this.#process = processHandle;
    this.#endpoint = endpoint;
    this.#compatibilityDigest = compatibilityDigest;
    processHandle.exit.then(() => this.#unexpectedExit(processHandle));

    const deadline = Date.now() + this.#readinessTimeoutMs;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const outcome = await Promise.race([
        this.#options
          .probe(endpoint)
          .then(
            (available): "ready" | "retry" =>
              available ? "ready" : "retry",
          )
          .catch(() => "retry" as const),
        processHandle.exit.then(() => "exit" as const),
        sleep(remaining).then(() => "timeout" as const),
      ]);
      if (outcome === "ready") {
        if (!this.#writeLease(endpoint, compatibilityDigest, processHandle.pid)) {
          await this.#stopOwned();
          return this.#fallback(
            compatibilityDigest,
            "lease-write-failed",
          );
        }
        this.#ready = true;
        this.#fallbackDigest = null;
        this.#emit({ kind: "started", endpoint });
        return Object.freeze({ mode: "connected", newlyStarted: true });
      }
      if (outcome === "exit") {
        await this.#stopOwned();
        return this.#fallback(compatibilityDigest, "startup-exit");
      }
      if (outcome === "timeout") {
        break;
      }
      await sleep(Math.min(this.#probeIntervalMs, Math.max(0, remaining)));
    }
    await this.#stopOwned();
    return this.#fallback(compatibilityDigest, "readiness-timeout");
  }

  compile(compatibilityDigest: string): Promise<Result> {
    return this.#serialized(() => this.#compile(compatibilityDigest));
  }

  async #compile(compatibilityDigest: string): Promise<Result> {
    if (
      this.#ready &&
      this.#process !== null &&
      this.#endpoint !== null &&
      this.#compatibilityDigest === compatibilityDigest
    ) {
      const processHandle = this.#process;
      const endpoint = this.#endpoint;
      try {
        return await this.#options.compileConnected(endpoint);
      } catch (error) {
        if (
          this.#process === processHandle &&
          (await this.#options.probe(endpoint).catch(() => false))
        ) {
          throw error;
        }
        await this.#stopOwned();
        this.#fallbackDigest = compatibilityDigest;
        this.#emit({ kind: "fallback", reason: "server-unresponsive" });
      }
    }
    return await this.#options.compileDirect();
  }

  close(): Promise<void> {
    return this.#serialized(async () => {
      if (this.#closed) {
        return;
      }
      this.#closed = true;
      await this.#stopOwned();
    });
  }

  #validateEndpoint(endpoint: HaxeWaitEndpoint): void {
    if (
      endpoint.host !== "127.0.0.1" ||
      !Number.isInteger(endpoint.port) ||
      endpoint.port <= 0 ||
      endpoint.port > 65_535 ||
      endpoint.argument !== `127.0.0.1:${endpoint.port}`
    ) {
      throw new Error("reserved endpoint must be canonical loopback");
    }
  }

  #claimLease(): HaxeWaitFallbackReason | null {
    let leasePath: string;
    try {
      leasePath = this.#checkedLeasePath();
    } catch {
      return "untrusted-lease";
    }
    if (!existsSync(leasePath)) {
      return null;
    }
    let bytes: Buffer;
    try {
      if (lstatSync(leasePath).isSymbolicLink()) {
        return "untrusted-lease";
      }
      bytes = readFileSync(leasePath);
    } catch {
      return "untrusted-lease";
    }
    const lease = decodeLease(bytes);
    if (
      lease === null ||
      lease.projectIdentity !== this.#options.projectIdentity
    ) {
      return "untrusted-lease";
    }
    try {
      if (
        this.#options.isProcessAlive(lease.ownerPid) ||
        this.#options.isProcessAlive(lease.serverPid)
      ) {
        return "live-foreign-lease";
      }
    } catch {
      return "untrusted-lease";
    }
    try {
      leasePath = this.#checkedLeasePath();
      if (!readFileSync(leasePath).equals(bytes)) {
        return "lease-race";
      }
      unlinkSync(leasePath);
      return null;
    } catch {
      return "lease-race";
    }
  }

  #writeLease(
    endpoint: HaxeWaitEndpoint,
    compatibilityDigest: string,
    serverPid: number,
  ): boolean {
    const bytes = canonicalLease({
      schema: LEASE_SCHEMA,
      projectIdentity: this.#options.projectIdentity,
      compatibilityDigest,
      ownerPid: this.#options.ownerPid,
      serverPid,
      host: endpoint.host,
      port: endpoint.port,
    });
    let descriptor: number | null = null;
    try {
      descriptor = openSync(this.#checkedLeasePath(), "wx", 0o600);
      writeFileSync(descriptor, bytes);
      closeSync(descriptor);
      descriptor = null;
      this.#leaseBytes = bytes;
      return true;
    } catch {
      if (descriptor !== null) {
        closeSync(descriptor);
      }
      return false;
    }
  }

  #cleanupLease(): void {
    const expected = this.#leaseBytes;
    this.#leaseBytes = null;
    if (expected === null) {
      return;
    }
    try {
      const leasePath = this.#checkedLeasePath();
      if (
        existsSync(leasePath) &&
        readFileSync(leasePath).equals(expected)
      ) {
        unlinkSync(leasePath);
      }
    } catch {
      // Another owner or the host controls the path now; never guess.
    }
  }

  async #stopOwned(): Promise<boolean> {
    const processHandle = this.#process;
    if (processHandle === null) {
      this.#cleanupLease();
      this.#clear();
      return true;
    }
    this.#stopping = true;
    try {
      processHandle.signal("SIGTERM");
    } catch {
      // Continue to the bounded exit wait and escalation.
    }
    let exited = await Promise.race([
      processHandle.exit.then(() => true),
      sleep(this.#shutdownTimeoutMs).then(() => false),
    ]);
    if (!exited) {
      try {
        processHandle.signal("SIGKILL");
      } catch {
        // Cleanup remains bounded even when signaling itself fails.
      }
      exited = await Promise.race([
        processHandle.exit.then(() => true),
        sleep(this.#shutdownTimeoutMs).then(() => false),
      ]);
    }
    if (exited) {
      this.#cleanupLease();
    } else {
      // A process that survived both bounds still owns its lease. Forget our
      // cleanup authority so neither this instance nor a later close can make
      // that live process undiscoverable.
      this.#leaseBytes = null;
      this.#emit({ kind: "shutdown-timeout", pid: processHandle.pid });
    }
    this.#clear();
    return exited;
  }

  #unexpectedExit(processHandle: OwnedHaxeWaitProcess): void {
    if (this.#process !== processHandle || this.#stopping) {
      return;
    }
    this.#cleanupLease();
    this.#emit({ kind: "unexpected-exit", pid: processHandle.pid });
    this.#clear();
  }

  #clear(): void {
    this.#process = null;
    this.#endpoint = null;
    this.#compatibilityDigest = null;
    this.#ready = false;
    this.#stopping = false;
  }

  #fallback(
    compatibilityDigest: string,
    reason: HaxeWaitFallbackReason,
  ): HaxeWaitEnsureResult {
    this.#fallbackDigest = compatibilityDigest;
    this.#emit({ kind: "fallback", reason });
    return Object.freeze({ mode: "direct", newlyStarted: false });
  }

  #emit(event: HaxeWaitServerEvent): void {
    try {
      this.#options.onEvent?.(Object.freeze(event));
    } catch {
      // Reporting is observational and must not change lifecycle ownership.
    }
  }

  #checkedLeasePath(): string {
    const checked = safeLeasePath(this.#projectRoot, this.#leaseRelative);
    if (checked !== this.#leasePath) {
      throw new Error("leasePath identity changed");
    }
    return checked;
  }

  async #serialized<Value>(operation: () => Promise<Value>): Promise<Value> {
    const previous = this.#operationTail;
    let release: (() => void) | null = null;
    this.#operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      assertRelease(release)();
    }
  }
}

function assertRelease(release: (() => void) | null): () => void {
  if (release === null) {
    throw new Error("serialized lifecycle release was not initialized");
  }
  return release;
}
