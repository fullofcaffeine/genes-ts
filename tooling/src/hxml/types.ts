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

/**
 * Exact Haxe arguments and provenance contributed by one Haxelib request.
 *
 * `arguments` must be the ordered argument stream that Haxe 4.3.7 would add
 * after `haxelib path`. The session inventories and executes these bytes. It
 * never passes the original `-lib` back to Haxe for a second live resolution.
 */
export interface HxmlLibraryResolution {
  readonly arguments: readonly string[];
  readonly provenanceFiles: readonly string[];
}

/**
 * Optional fail-closed policy applied while the existing parser visits every
 * top-level and nested HXML argument. The inventory reports the exact source
 * file in its structured failure; it never shells out to discover arguments.
 */
export interface HxmlArgumentPolicy {
  readonly forbiddenOptions?: readonly string[];
  readonly forbiddenDefines?: readonly string[];
  /** Reject option spellings absent from the pinned Haxe option manifest. */
  readonly rejectUnknownOptions?: boolean;
}

export interface HxmlInventoryOptions {
  readonly entryFiles: readonly string[];
  readonly workingDirectory: string;
  readonly allowedRoots: readonly string[];
  readonly environment?: (name: string) => string | null;
  /**
   * Resolves the one distinct library identity admitted by the v1 inventory.
   * Repeated requests for that identity are deduplicated like Haxe 4.3.7.
   * Inline library spellings and a second distinct identity fail closed because
   * this single-request callback cannot reproduce Haxe's high-level batching.
   */
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
  readonly libraryProvenanceFiles: readonly string[];
  readonly classPaths: readonly string[];
  readonly resourceInputs: readonly string[];
  readonly libraries: readonly HxmlLibrary[];
  /**
   * Exact flattened arguments that a direct caller can safely pass to Haxe.
   * The public inventory rejects inline values ending in `.hxml`; the complete
   * DevelopmentSession supports them through its private checked input.
   */
  readonly effectiveArguments: readonly string[];
}
