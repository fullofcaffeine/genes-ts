export type HxmlFailureKind =
  | "invalid-option"
  | "missing-input"
  | "unsafe-input"
  | "invalid-syntax"
  | "missing-environment"
  | "resolver-failure"
  | "budget-exceeded";

export interface HxmlFailureFact {
  readonly kind: HxmlFailureKind;
  readonly subject: string;
}

export class HxmlInventoryError extends Error {
  readonly failure: HxmlFailureFact;

  constructor(failure: HxmlFailureFact) {
    super(`${failure.kind}: ${failure.subject}`);
    this.name = "HxmlInventoryError";
    this.failure = Object.freeze(failure);
  }
}

export interface HxmlLibraryRequest {
  readonly request: string;
  readonly name: string;
  readonly version: string | null;
  readonly fromFile: string;
  readonly workingDirectory: string;
}

/** Cancellation owned by the caller inventorying an HXML closure. */
export interface HxmlResolverContext {
  readonly signal: AbortSignal;
  /** The exact environment lookup used while interpreting this inventory. */
  readonly environment: (name: string) => string | null;
}

/** Complete declarative inputs contributed by one resolved Haxelib request. */
export interface HxmlLibraryResolution {
  readonly hxmlFiles: readonly string[];
  readonly classPaths: readonly string[];
}

/**
 * Optional fail-closed policy applied while the existing parser visits every
 * top-level and nested HXML argument. The inventory reports the exact source
 * file in its structured failure; it never shells out to discover arguments.
 */
export interface HxmlArgumentPolicy {
  readonly forbiddenOptions?: readonly string[];
  readonly forbiddenDefines?: readonly string[];
}

export interface HxmlInventoryOptions {
  readonly entryFiles: readonly string[];
  readonly workingDirectory: string;
  readonly allowedRoots: readonly string[];
  readonly environment?: (name: string) => string | null;
  readonly resolveLibrary?: (
    request: HxmlLibraryRequest,
    context: HxmlResolverContext,
  ) => HxmlLibraryResolution | Promise<HxmlLibraryResolution>;
  readonly signal?: AbortSignal;
  readonly argumentPolicy?: HxmlArgumentPolicy;
  readonly maxHxmlFiles?: number;
  readonly maxHxmlOccurrences?: number;
  readonly maxArguments?: number;
}

export interface HxmlLibrary {
  readonly request: string;
  readonly name: string;
  readonly version: string | null;
  readonly fromFile: string;
  readonly workingDirectory: string;
}

/** One semantic interpretation of a physical HXML file. */
export interface HxmlOccurrence {
  readonly file: string;
  readonly workingDirectory: string;
}

export interface HxmlInventory {
  /**
   * True only when every discovered `-lib` request was passed through the
   * caller's resolver. An empty resolved file list is authoritative; a missing
   * resolver is request-only inventory and leaves this false.
   */
  readonly libraryClosureComplete: boolean;

  /** Canonical top-level HXML entries, excluding files reached transitively. */
  readonly entryHxmlFiles: readonly string[];
  readonly hxmlOccurrences: readonly HxmlOccurrence[];
  readonly hxmlFiles: readonly string[];
  readonly classPaths: readonly string[];
  readonly resourceInputs: readonly string[];
  readonly libraries: readonly HxmlLibrary[];
}
