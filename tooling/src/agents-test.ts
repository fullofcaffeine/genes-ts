import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkGenesAgentGuidance,
  GENES_AGENT_GUIDANCE_BEGIN,
  GENES_AGENT_GUIDANCE_END,
  GenesAgentGuidanceError,
  installGenesAgentGuidance,
  readCanonicalGenesAgentGuidance,
} from "./agents/index.js";

const root = mkdtempSync(path.join(tmpdir(), "genes-agent-guidance-"));
const canonical = Buffer.from(readCanonicalGenesAgentGuidance());

function fixture(name: string): string {
  const directory = path.join(root, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function agentsFile(directory: string): string {
  return path.join(directory, "AGENTS.md");
}

function expectMalformed(directory: string, bytes: Buffer): void {
  const file = agentsFile(directory);
  writeFileSync(file, bytes);
  assert.throws(
    () => installGenesAgentGuidance(directory),
    (error: unknown) =>
      error instanceof GenesAgentGuidanceError &&
      error.code === "GENES-AGENT-GUIDANCE-003",
  );
  assert.deepEqual(readFileSync(file), bytes);
}

try {
  const canonicalText = canonical.toString("utf8");
  assert.equal(canonicalText.startsWith(`${GENES_AGENT_GUIDANCE_BEGIN}\n`), true);
  assert.equal(canonicalText.endsWith(`${GENES_AGENT_GUIDANCE_END}\n`), true);
  for (const fact of [
    "genes-agent-guidance-version: 1",
    "complete candidate tree",
    "last accepted public tree",
    "inspect()",
    "firstAccepted",
    "waitForIdle()",
    "accepted-generation event",
    "production build, validator, and test gates",
  ]) {
    assert.equal(canonicalText.includes(fact), true, `canonical guide omits ${fact}`);
  }

  const clean = fixture("clean project");
  assert.deepEqual(checkGenesAgentGuidance(clean), {
    path: agentsFile(clean),
    status: "missing",
    version: 1,
  });
  assert.equal(installGenesAgentGuidance(clean).action, "created");
  assert.deepEqual(readFileSync(agentsFile(clean)), canonical);
  assert.equal(checkGenesAgentGuidance(clean).status, "current");
  assert.equal(installGenesAgentGuidance(clean).action, "unchanged");
  assert.deepEqual(readFileSync(agentsFile(clean)), canonical);

  const existing = fixture("existing project");
  const authored = Buffer.from(
    "# Project rules\r\n\r\nKeep café and 雪 exactly.\r\n",
    "utf8",
  );
  writeFileSync(agentsFile(existing), authored);
  assert.equal(installGenesAgentGuidance(existing).action, "inserted");
  const inserted = readFileSync(agentsFile(existing));
  assert.deepEqual(inserted.subarray(0, authored.length), authored);
  assert.deepEqual(inserted.subarray(inserted.length - canonical.length), canonical);
  const insertedCopy = Buffer.from(inserted);
  assert.equal(installGenesAgentGuidance(existing).action, "unchanged");
  assert.deepEqual(readFileSync(agentsFile(existing)), insertedCopy);

  const stale = fixture("stale project");
  const before = Buffer.from("# Before\r\n\r\n", "utf8");
  const oldBlock = Buffer.from(
    [
      GENES_AGENT_GUIDANCE_BEGIN,
      "<!-- genes-agent-guidance-version: 0 -->",
      "Old managed text.",
      GENES_AGENT_GUIDANCE_END,
      "",
    ].join("\n"),
    "utf8",
  );
  const after = Buffer.from("# After\r\nKeep this byte-for-byte.\r\n", "utf8");
  writeFileSync(agentsFile(stale), Buffer.concat([before, oldBlock, after]));
  assert.equal(checkGenesAgentGuidance(stale).status, "stale");
  assert.equal(installGenesAgentGuidance(stale).action, "updated");
  assert.deepEqual(
    readFileSync(agentsFile(stale)),
    Buffer.concat([before, canonical, after]),
  );
  assert.equal(checkGenesAgentGuidance(stale).status, "current");

  expectMalformed(
    fixture("missing end"),
    Buffer.from(`${GENES_AGENT_GUIDANCE_BEGIN}\nManaged text.\n`, "utf8"),
  );
  expectMalformed(
    fixture("missing begin"),
    Buffer.from(`Managed text.\n${GENES_AGENT_GUIDANCE_END}\n`, "utf8"),
  );
  expectMalformed(
    fixture("duplicate begin"),
    Buffer.from(
      `${GENES_AGENT_GUIDANCE_BEGIN}\n${GENES_AGENT_GUIDANCE_BEGIN}\n${GENES_AGENT_GUIDANCE_END}\n`,
      "utf8",
    ),
  );
  expectMalformed(
    fixture("damaged marker"),
    Buffer.from("<!-- BEGIN @genes-ts/tooling:agent-guidance -- >\n", "utf8"),
  );

  const cliRoot = fixture("CLI path with spaces and 雪");
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  const installed = spawnSync(
    process.execPath,
    [cli, "agents", "install", "--root", cliRoot],
    { encoding: "utf8" },
  );
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /genes agents: created .* \(v1\)/);
  const checked = spawnSync(
    process.execPath,
    [cli, "agents", "check", "--root", cliRoot],
    { encoding: "utf8" },
  );
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /genes agents: current .* \(v1\)/);

  const missing = fixture("CLI missing");
  const missingCheck = spawnSync(
    process.execPath,
    [cli, "agents", "check", "--root", missing],
    { encoding: "utf8" },
  );
  assert.equal(missingCheck.status, 1);
  assert.match(missingCheck.stderr, /genes agents: missing/);
  assert.equal(readFileSync(agentsFile(cliRoot)).equals(canonical), true);

  const packageJson: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(typeof packageJson, "object");
  const scripts = (packageJson as { scripts?: Record<string, string> }).scripts ?? {};
  for (const lifecycle of ["preinstall", "install", "postinstall"]) {
    assert.equal(scripts[lifecycle], undefined, `${lifecycle} must not mutate consumers`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

process.stdout.write("genes-agent-guidance:ok\n");
