export type GenesAgentGuidanceFailureKind =
  | "invalid-project-root"
  | "invalid-agents-file"
  | "malformed-markers"
  | "filesystem-error";

const failureCodes: Readonly<Record<GenesAgentGuidanceFailureKind, string>> = {
  "invalid-project-root": "GENES-AGENT-GUIDANCE-001",
  "invalid-agents-file": "GENES-AGENT-GUIDANCE-002",
  "malformed-markers": "GENES-AGENT-GUIDANCE-003",
  "filesystem-error": "GENES-AGENT-GUIDANCE-004",
};

/** A stable, actionable failure from the explicit AGENTS.md workflow. */
export class GenesAgentGuidanceError extends Error {
  readonly code: string;
  readonly kind: GenesAgentGuidanceFailureKind;
  readonly target: string;

  constructor(
    kind: GenesAgentGuidanceFailureKind,
    target: string,
    detail: string,
    options?: ErrorOptions,
  ) {
    const code = failureCodes[kind];
    super(`[${code}] ${detail}`, options);
    this.name = "GenesAgentGuidanceError";
    this.code = code;
    this.kind = kind;
    this.target = target;
  }
}
