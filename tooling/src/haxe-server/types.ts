export interface HaxeWaitEndpoint {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly argument: string;
}

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
  readonly reserveEndpoint?: () => Promise<HaxeWaitEndpoint>;
  readonly onEvent?: (event: HaxeWaitServerEvent) => void;
  readonly readinessTimeoutMs?: number;
  readonly probeIntervalMs?: number;
  readonly shutdownTimeoutMs?: number;
}
