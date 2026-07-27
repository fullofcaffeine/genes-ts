import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const workflow = readFileSync(
  path.join(repoRoot, ".github/workflows/codeql.yml"),
  "utf8"
);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function topLevelBlock(
  source: string,
  name: string,
  nextName: string
): string {
  const match = new RegExp(
    `^${name}:\\n([\\s\\S]*?)^${nextName}:`,
    "m"
  ).exec(source);
  assert(match != null, `CodeQL workflow is missing the ${name} block`);
  return `${name}:\n${match[1].trimEnd()}`;
}

function finalTopLevelBlock(source: string, name: string): string {
  const match = new RegExp(`^${name}:\\n([\\s\\S]*)$`, "m").exec(source);
  assert(match != null, `CodeQL workflow is missing the ${name} block`);
  return `${name}:\n${match[1].trimEnd()}`;
}

/**
 * Protects the security boundary around the repository's hosted CodeQL scan.
 *
 * Why: action-major upgrades look like harmless YAML edits, but an accidental
 * trigger or permission change can make untrusted pull-request code run with a
 * stronger token. A future downgrade could also restore the deprecated Node 20
 * action runtime without affecting any local compiler test.
 *
 * What/How: this fast local gate checks the small semantic contract that must
 * remain stable. The workflow runs for main pushes, ordinary pull requests,
 * and manual requests; grants only the three reviewed token permissions; scans
 * JavaScript; and uses the reviewed Node 24 action majors. GitHub's hosted
 * `Analyze (JavaScript)` job remains the executable proof that CodeQL itself
 * initializes, analyzes, and uploads a result.
 */
function verifyCodeqlWorkflow(source: string): void {
  const triggerContract = `on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:`;
  assert(
    topLevelBlock(source, "on", "permissions") === triggerContract,
    "CodeQL trigger contract changed; review push, pull_request, and manual ownership"
  );
  assert(
    !source.includes("pull_request_target"),
    "CodeQL must not run untrusted changes through pull_request_target"
  );

  const permissionContract = `permissions:
  actions: read
  contents: read
  security-events: write`;
  assert(
    topLevelBlock(source, "permissions", "jobs") === permissionContract,
    "CodeQL token permissions changed; preserve the reviewed least-privilege set"
  );
  assert(!source.includes("write-all"), "CodeQL must not receive write-all");

  const jobContract = `jobs:
  analyze:
    name: Analyze (JavaScript)
    runs-on: ubuntu-latest
    steps:
      # These action majors run on Node 24. Keep them aligned with the
      # structural policy in scripts/test-codeql-workflow.ts.
      - uses: actions/checkout@v7
      - uses: github/codeql-action/init@v4
        with:
          languages: javascript
      - uses: github/codeql-action/analyze@v4`;
  assert(
    finalTopLevelBlock(source, "jobs") === jobContract,
    "CodeQL analysis job changed; preserve its exact name, runner, JavaScript scope, and action-only steps"
  );
  assert(
    !source.includes("@v3"),
    "CodeQL workflow must not restore deprecated v3 action references"
  );
}

function assertRejected(source: string, description: string): void {
  let rejected = false;
  try {
    verifyCodeqlWorkflow(source);
  } catch {
    rejected = true;
  }
  assert(rejected, `CodeQL policy accepted unsafe mutation: ${description}`);
}

verifyCodeqlWorkflow(workflow);
assertRejected(
  workflow.replace(
    "      - uses: github/codeql-action/analyze@v4",
    "      - run: npm test\n      - uses: github/codeql-action/analyze@v4"
  ),
  "arbitrary shell step"
);
assertRejected(
  workflow.replace("languages: javascript", "languages: javascript, python"),
  "additional scan language"
);
assertRejected(
  workflow.replace("name: Analyze (JavaScript)", "name: Security scan"),
  "required-check rename"
);
console.log("codeql-workflow:ok (Node 24 actions + reviewed triggers/permissions)");
