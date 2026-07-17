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

  const manuallySelectedOwnedFindings = auditExportedSurfaces({
    repoRoot,
    tsconfigPath,
    includePaths: ["tests/typing-policy/semantic/owned-safe.ts"]
  });
  assert.equal(
    manuallySelectedOwnedFindings.length,
    0,
    "the fail-first setup must demonstrate why a caller-maintained include list is incomplete"
  );
  assert.throws(
    () => assertExportedSurfacePolicy({
      repoRoot,
      tsconfigPath,
      ownershipInventories: [{
        outputRoot: "tests/typing-policy/semantic",
        outputIdentity: "semantic.ts"
      }],
      scope: "owned-inventory"
    }),
    /ownedUnsafe/,
    "every type-bearing file in a compiler ownership manifest must enroll automatically"
  );
  assertExportedSurfacePolicy({
    repoRoot,
    tsconfigPath,
    ownershipInventories: [{
      outputRoot: "tests/typing-policy/semantic",
      outputIdentity: "semantic.ts",
      classifications: [{
        file: "owned-unsafe.ts",
        disposition: "runtime-boundary",
        reason: "Policy fixture proving that an intentional host boundary needs exact ownership."
      }]
    }],
    scope: "owned-inventory"
  });
  assert.throws(
    () => assertExportedSurfacePolicy({
      repoRoot,
      tsconfigPath,
      ownershipInventories: [{
        outputRoot: "tests/typing-policy/semantic",
        outputIdentity: "semantic.ts",
        classifications: [{
          file: "removed-runtime-boundary.ts",
          disposition: "runtime-boundary",
          reason: "This deliberately stale record must never become a permanent exclusion."
        }]
      }],
      scope: "owned-inventory"
    }),
    /Stale exported-surface classification/,
    "runtime-boundary classifications must be exact and stale-detecting"
  );
  assert.throws(
    () => assertExportedSurfacePolicy({
      repoRoot,
      tsconfigPath,
      ownershipInventories: [{
        outputRoot: "tests/typing-policy/semantic",
        outputIdentity: "semantic.ts",
        classifications: [{
          file: "owned-unsafe.ts",
          disposition: "known-gap",
          reason: "This fixture proves deferred weakness cannot become anonymous debt."
        }]
      }],
      scope: "owned-inventory"
    }),
    /needs an owning issue/,
    "known gaps must name the issue that owns their removal or justification"
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
