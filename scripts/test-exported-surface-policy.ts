import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assertExportedSurfacePolicy,
  auditExportedSurfaces,
  type ExportedSurfaceFinding
} from "./exported-surface-policy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const tsconfigPath = "tests/typing-policy/semantic/tsconfig.json";
const boundaryManifestPath = "tests/typing-policy/exported-surface-boundaries.json";

/**
 * Proves the semantic gate catches weaknesses that text scanning and `tsc`
 * accept, then proves narrow documented boundaries remain usable.
 */
function main(): void {
  const unsafeFindings = auditExportedSurfaces({
    repoRoot,
    tsconfigPath,
    includePaths: ["tests/typing-policy/semantic/unsafe.ts"]
  });

  assertFinding(unsafeFindings, "ExplicitAny", "any");
  assertFinding(unsafeFindings, "NestedAny", "any");
  assertFinding(unsafeFindings, "ExplicitUnknown", "unknown");
  assertFinding(unsafeFindings, "OpenShape", "string-index");
  assertFinding(unsafeFindings, "GenericDefault", "any");
  assertFinding(unsafeFindings, "ConditionalLeak", "any");
  assertFinding(unsafeFindings, "MappedLeak", "any");
  assertFinding(unsafeFindings, "inferredFromImport", "any");
  assertFinding(unsafeFindings, "reexportedWeak", "any");

  assert.throws(
    () => assertExportedSurfacePolicy({
      repoRoot,
      tsconfigPath,
      includePaths: ["tests/typing-policy/semantic/unsafe.ts"],
      scope: "no-boundaries"
    }),
    /unapproved any/,
    "semantic weaknesses must fail when no boundary owns them"
  );

  assertExportedSurfacePolicy({
    repoRoot,
    tsconfigPath,
    includePaths: [
      "tests/typing-policy/semantic/safe.ts",
      "tests/typing-policy/semantic/boundary.ts"
    ],
    scope: "policy-fixture",
    boundaryManifestPath
  });

  console.log(`Exported-surface policy tests passed (${unsafeFindings.length} unsafe paths detected).`);
}

function assertFinding(
  findings: ReadonlyArray<ExportedSurfaceFinding>,
  exportName: string,
  kind: ExportedSurfaceFinding["kind"]
): void {
  assert.ok(
    findings.some(finding => finding.exportName === exportName && finding.kind === kind),
    `expected ${kind} finding for export ${exportName}; got:\n${JSON.stringify(findings, null, 2)}`
  );
}

main();
