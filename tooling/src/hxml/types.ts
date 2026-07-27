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

export interface HxmlInventoryOptions {
  readonly entryFiles: readonly string[];
  readonly workingDirectory: string;
  readonly allowedRoots: readonly string[];
  readonly environment?: (name: string) => string | null;
  readonly resolveLibrary?: (
    request: HxmlLibraryRequest,
  ) => readonly string[] | Promise<readonly string[]>;
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
  readonly hxmlFiles: readonly string[];
  readonly classPaths: readonly string[];
  readonly resourceInputs: readonly string[];
  readonly libraries: readonly HxmlLibrary[];
}
