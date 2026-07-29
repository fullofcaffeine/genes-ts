import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const workflow = readFileSync(
  path.join(repoRoot, ".github/workflows/ci.yml"),
  "utf8"
);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function jobBlock(source: string, name: string, nextName?: string): string {
  const end = nextName ? `^  ${nextName}:` : "$(?![\\s\\S])";
  const match = new RegExp(`^  ${name}:\\n([\\s\\S]*?)${end}`, "m").exec(source);
  assert(match != null, `CI workflow is missing the ${name} job`);
  return `  ${name}:\n${match[1].trimEnd()}`;
}

/**
 * Protects the security and publication boundary around hosted CodeQL.
 *
 * Why: the compiler release must wait for CodeQL on the exact tested commit.
 * A separate workflow can have the same required-check name, but jobs in the
 * release workflow cannot depend on its result and could publish first.
 *
 * What/How: this fast local gate requires the action-only JavaScript scan to
 * live in the main CI graph with least-privilege job permissions. It also
 * requires the release job to name that exact job in `needs`, so a failed or
 * unfinished scan blocks publication rather than merely blocking the next PR.
 */
function verifyCodeqlWorkflow(source: string): void {
  const codeql = jobBlock(source, "codeql", "beads-worktree-safety");
  const expected = `  codeql:
    name: Analyze (JavaScript)
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      security-events: write
    steps:
      # CodeQL lives in this workflow so release publication can require the
      # scan result for the exact same main-branch SHA.
      - uses: actions/checkout@v7
      - uses: github/codeql-action/init@v4
        with:
          languages: javascript
      - uses: github/codeql-action/analyze@v4`;
  assert(
    codeql === expected,
    "CodeQL job changed; preserve its name, permissions, JavaScript scope, and action-only steps"
  );
  assert(
    !source.includes("pull_request_target"),
    "CodeQL must not run untrusted changes through pull_request_target"
  );
  assert(!codeql.includes("@v3"), "CodeQL must not restore deprecated v3 actions");

  const release = jobBlock(source, "release");
  assert(
    /^      - codeql$/m.test(release),
    "release publication must wait for the same-run CodeQL job"
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
  workflow.replace("      - codeql", "      - secrets"),
  "release dependency removal"
);
console.log(
  "codeql-workflow:ok (same-run release dependency + Node 24 actions + least privilege)"
);
