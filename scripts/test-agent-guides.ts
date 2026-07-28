import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

/** Mirrors the GitHub heading slugs used by the repository's ASCII anchors. */
function headingSlug(heading: string): string {
  return heading
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}\p{Mark}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/**
 * Verifies links that teach contributors where an owner or workflow lives.
 *
 * Why: an onboarding guide can look polished while pointing a new agent at a
 * renamed file or dead heading. That failure is especially costly here because
 * the guide intentionally delegates detailed contracts to maintained docs.
 *
 * What/How: local Markdown links must resolve from the file that contains
 * them, and heading fragments must match a real heading. External links are
 * outside this deterministic repository check.
 */
function validateLocalLinks(relativePath: string): void {
  const markdownPath = path.join(repoRoot, relativePath);
  const source = readFileSync(markdownPath, "utf8");
  for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
    const href = match[1] ?? "";
    if (/^(https?:|mailto:)/.test(href)) continue;

    const [encodedPath = "", encodedFragment] = href.split("#", 2);
    const target = encodedPath.length > 0
      ? path.resolve(path.dirname(markdownPath), decodeURIComponent(encodedPath))
      : markdownPath;
    assert(existsSync(target), `${relativePath}: local link does not exist: ${href}`);

    if (!encodedFragment || !statSync(target).isFile()) continue;
    const expected = decodeURIComponent(encodedFragment);
    const anchors = readFileSync(target, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^#{1,6} /.test(line))
      .map((line) => headingSlug(line.replace(/^#{1,6} /, "")));
    assert(anchors.includes(expected),
      `${relativePath}: local heading does not exist: ${href}`);
  }
}

/**
 * Keeps the agent entrypoints tied to executable repository facts.
 *
 * The gate does not judge prose. It checks the practical promises most likely
 * to drift: required guides exist and link to each other, selected critical
 * onboarding commands still have package-script owners, and the two compiler
 * profiles plus ts2hx remain explicitly distinguished.
 */
function main(): void {
  const guides = [
    "AGENTS.md",
    "src/genes/AGENTS.md",
    "tools/ts2hx/AGENTS.md",
    "docs/README.md",
    "docs/TESTING_STRATEGY.md",
    "readme.md",
    "CONTRIBUTING.md"
  ];
  for (const guide of guides) {
    assert(existsSync(path.join(repoRoot, guide)), `Missing agent navigation file: ${guide}`);
    validateLocalLinks(guide);
  }

  const rootGuide = read("AGENTS.md");
  for (const required of [
    "Haxe source -> Haxe typed AST -> genes.Generator",
    "-D genes.ts",
    "classic split ESM JavaScript",
    "tools/ts2hx",
    "src/genes/AGENTS.md",
    "tools/ts2hx/AGENTS.md",
    "docs/WORKFLOWS.md",
    "docs/ARCHITECTURE.md",
    "docs/TESTING_STRATEGY.md",
    "yarn beads:install",
    "yarn bd ready",
    "yarn hooks:install",
    "yarn test:precommit-hook",
    "yarn build:example:genes-ts",
    "yarn --cwd tools/ts2hx build"
  ])
    assert(rootGuide.includes(required), `AGENTS.md omits required onboarding fact: ${required}`);

  const compilerGuide = read("src/genes/AGENTS.md");
  for (const owner of [
    "Generator.hx",
    "OutputTransaction.hx",
    "DependencyPlan.hx",
    "TsModuleEmitter.hx",
    "ModuleEmitter.hx",
    "DefinitionEmitter.hx",
    "JsxPlan.hx"
  ])
    assert(compilerGuide.includes(owner), `Compiler AGENTS.md omits owner: ${owner}`);

  const ts2hxGuide = read("tools/ts2hx/AGENTS.md");
  for (const owner of [
    "src/cli.ts",
    "src/project.ts",
    "src/semantic/ir.ts",
    "src/haxe/emit.ts",
    "test:semantic-diff",
    "test:strict-diagnostics",
    "yarn --cwd tools/ts2hx test"
  ])
    assert(ts2hxGuide.includes(owner), `ts2hx AGENTS.md omits owner or gate: ${owner}`);

  const packageJson = JSON.parse(read("package.json")) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};
  for (const command of [
    "build:example:genes-ts",
    "beads:install",
    "bd",
    "hooks:install",
    "test:examples",
    "test:ci",
    "test:agent-guides",
    "test:beads-pin",
    "test:precommit-hook"
  ])
    assert(typeof scripts[command] === "string",
      `AGENTS.md references missing package script: ${command}`);

  const ts2hxPackage = JSON.parse(read("tools/ts2hx/package.json")) as {
    scripts?: Record<string, string>;
  };
  for (const command of ["build", "test", "test:semantic-diff", "test:strict-diagnostics"])
    assert(typeof ts2hxPackage.scripts?.[command] === "string",
      `ts2hx AGENTS.md references missing tool script: ${command}`);

  process.stdout.write(`agent-guides:ok (${guides.length} linked guides)\n`);
}

main();
