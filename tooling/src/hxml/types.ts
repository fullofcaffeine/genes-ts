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
  ) => readonly string[] | Promise<readonly string[]>;
  readonly signal?: AbortSignal;
  readonly argumentPolicy?: HxmlArgumentPolicy;
  readonly maxHxmlFiles?: number;
  readonly maxArguments?: number;
}

export interface HxmlLibrary {
  readonly request: string;
  readonly name: string;
  readonly version: string | null;
  readonly fromFile: string;
}

export interface HxmlInventory {
  /** Canonical top-level HXML entries, excluding files reached transitively. */
  readonly entryHxmlFiles: readonly string[];
  readonly hxmlFiles: readonly string[];
  readonly classPaths: readonly string[];
  readonly resourceInputs: readonly string[];
  readonly libraries: readonly HxmlLibrary[];
}
