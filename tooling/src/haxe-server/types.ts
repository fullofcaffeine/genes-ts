/**
 * The loopback address of an owned `haxe --server-listen 127.0.0.1:PORT`
 * server. A client opens one TCP connection for each request.
 */
export interface HaxeWaitLoopbackEndpoint {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly argument: string;
}

/**
 * The standard streams of an owned `haxe --wait stdio` server. The owner
 * writes each request to the server's standard input and reads each answer
 * from its standard error, as one length-prefixed frame. Only the process
 * that started the server can reach it; no other client can connect.
 */
export interface HaxeWaitStdioEndpoint {
  readonly transport: "stdio";
  readonly argument: "stdio";
}

/** Where an owned server takes requests. */
export type HaxeWaitEndpoint = HaxeWaitLoopbackEndpoint | HaxeWaitStdioEndpoint;

/**
 * How an owned server takes requests: `loopback` (one TCP connection for each
 * request, the default) or `stdio` (one pipe that stays open).
 */
export type HaxeWaitTransport = "loopback" | "stdio";

export interface HaxeWaitProcessExit {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface OwnedHaxeWaitProcess {
  readonly pid: number;
  readonly exit: Promise<HaxeWaitProcessExit>;
  signal(signal: "SIGTERM" | "SIGKILL"): void;
}

export type HaxeWaitFallbackReason =
  | "live-foreign-lease"
  | "untrusted-lease"
  | "lease-race"
  | "lease-write-failed"
  | "port-reservation-failed"
  | "start-failed"
  | "readiness-timeout"
  | "startup-exit"
  | "server-unresponsive"
  | "shutdown-timeout";

export type HaxeWaitServerEvent =
  | {
      readonly kind: "fallback";
      readonly reason: HaxeWaitFallbackReason;
    }
  | {
      readonly kind: "started";
      readonly endpoint: HaxeWaitEndpoint;
    }
  | {
      readonly kind: "unexpected-exit";
      readonly pid: number;
    }
  | {
      readonly kind: "shutdown-timeout";
      readonly pid: number;
    };

export interface HaxeWaitEnsureResult {
  readonly mode: "connected" | "direct";
  readonly newlyStarted: boolean;
}

export interface OwnedHaxeWaitServerOptions<Result> {
  readonly projectRoot: string;
  readonly leasePath: string;
  readonly projectIdentity: string;
  readonly ownerPid: number;
  readonly isProcessAlive: (pid: number) => boolean;
  readonly start: (
    endpoint: HaxeWaitEndpoint,
  ) => OwnedHaxeWaitProcess | Promise<OwnedHaxeWaitProcess>;
  readonly probe: (endpoint: HaxeWaitEndpoint) => Promise<boolean>;
  readonly compileConnected: (
    endpoint: HaxeWaitEndpoint,
  ) => Promise<Result>;
  readonly compileDirect: () => Promise<Result>;
  /**
   * `stdio` starts the server on its standard streams: no port is reserved,
   * `start`, `probe` and `compileConnected` receive the fixed stdio endpoint,
   * and the lease records no address. Default `loopback`.
   */
  readonly transport?: HaxeWaitTransport;
  readonly reserveEndpoint?: () => Promise<HaxeWaitLoopbackEndpoint>;
  readonly onEvent?: (event: HaxeWaitServerEvent) => void;
  readonly readinessTimeoutMs?: number;
  readonly probeIntervalMs?: number;
  readonly shutdownTimeoutMs?: number;
}
