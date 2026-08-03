export type CssModuleFailureCode =
  | "GENES-CSS-MODULE-FILE-MISSING-002"
  | "GENES-CSS-MODULE-MANIFEST-STALE-004"
  | "GENES-CSS-MODULE-EXPORT-NAME-005"
  | "GENES-CSS-MODULE-NAME-COLLISION-006"
  | "GENES-CSS-MODULE-BINDING-010"
  | "GENES-CSS-MODULE-PATH-011"
  | "GENES-CSS-MODULE-MANIFEST-015";

/** A friendly, stable failure from manifest checking or companion generation. */
export class CssModuleCompanionError extends Error {
  readonly code: CssModuleFailureCode;
  readonly subject: string;

  constructor(code: CssModuleFailureCode, message: string, subject: string) {
    super(`${code}: ${message}`);
    this.name = "CssModuleCompanionError";
    this.code = code;
    this.subject = subject;
  }
}

export function cssModuleFailure(
  code: CssModuleFailureCode,
  message: string,
  subject: string,
): never {
  throw new CssModuleCompanionError(code, message, subject);
}
