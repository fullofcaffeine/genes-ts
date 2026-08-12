import type {
  HxmlLibraryRequest,
  HxmlLibraryResolution,
} from "../hxml/index.js";

/** Stable failure classes returned by the Lix library resolver. */
export type LixLibraryResolverFailureCode =
  | "LIX_RESOLVER_INVALID_OPTIONS"
  | "LIX_RESOLVER_UNSAFE_SCOPE"
  | "LIX_RESOLVER_COMMAND_FAILED"
  | "LIX_RESOLVER_OUTPUT_TOO_LARGE"
  | "LIX_RESOLVER_MALFORMED_OUTPUT"
  | "LIX_RESOLVER_UNSAFE_LIBRARY"
  | "LIX_RESOLVER_ABORTED"
  | "LIX_RESOLVER_TIMEOUT";

/** A structured resolver error that a host can translate into its own wording. */
export class LixLibraryResolverError extends Error {
  readonly code: LixLibraryResolverFailureCode;

  constructor(code: LixLibraryResolverFailureCode, message: string) {
    super(message);
    this.name = "LixLibraryResolverError";
    this.code = code;
  }
}

/** One exact executable invocation. It never passes through a shell. */
export interface LixHaxelibCommand {
  readonly executable: string;
  readonly argsPrefix?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
}

/** Inputs for one adjacent, ordered library group from an HXML file. */
export interface ResolveLixLibraryGroupOptions {
  readonly projectRoot: string;
  readonly requests: readonly HxmlLibraryRequest[];
  readonly command: LixHaxelibCommand;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

/**
 * The exact resolver answer plus the external package folders it may read.
 *
 * Return this value directly from the matching HXML `resolveLibraries`
 * callback. The HXML inventory checks `allowedRoots`, then uses `arguments`
 * and `provenanceFiles`. Resolve again after a scope, command, or lock change.
 */
export interface ResolvedLixLibraryGroup extends HxmlLibraryResolution {
  readonly requests: readonly string[];
  readonly allowedRoots: readonly string[];
}
