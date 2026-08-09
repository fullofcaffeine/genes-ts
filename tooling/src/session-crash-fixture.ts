import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  publishArtifacts,
  recoverArtifacts,
  type ArtifactCheckpoint,
} from "./artifacts/index.js";
import { inventoryHxml } from "./hxml/index.js";
import type { HaxeWaitServerEvent } from "./haxe-server/index.js";
import type {
  ReconciledWatchOptions,
  ReconciledWatchSession,
} from "./watch/index.js";
import type { SessionCompiler } from "./session/haxe-driver.js";
import type { SessionLayout } from "./session/layout.js";
import {
  createGenesDevelopmentSessionWithDependencies,
  type SessionDependencies,
} from "./session/runtime.js";
import { acquireSessionLock } from "./session/session-lock.js";
import type {
  GenesDevelopmentOptions,
  JsonValue,
} from "./session/types.js";

const root = process.env.GENES_SESSION_CRASH_ROOT;
const stateDirectory = process.env.GENES_SESSION_CRASH_STATE;
const publicOutputFile =
  process.env.GENES_SESSION_CRASH_OUTPUT ?? "src-gen/index.ts";
const content = process.env.GENES_SESSION_CRASH_CONTENT ?? "export const value = 1;\n";
const crashAt = process.env.GENES_SESSION_CRASH_AT as ArtifactCheckpoint | undefined;
if (root === undefined || stateDirectory === undefined) {
  throw new Error("session crash fixture requires root and state directory");
}

function manifestName(owner: string): string {
  let sanitized = "";
  for (let index = 0; index < owner.length; index += 1) {
    const code = owner.charCodeAt(index);
    const allowed =
      (code >= 97 && code <= 122) ||
      (code >= 65 && code <= 90) ||
      (code >= 48 && code <= 57) ||
      code === 45 ||
      code === 95 ||
      code === 46;
    sanitized += allowed ? owner[index] : "_";
  }
  return `.genes-output-${sanitized.slice(0, 48)}-${createHash("sha256").update(owner).digest("hex")}.manifest`;
}

class FixtureCompiler implements SessionCompiler {
  async compile(
    _invocation: Parameters<SessionCompiler["compile"]>[0],
    _compatibilityDigest: string,
    _signal: AbortSignal,
    assertInvocationCurrent?: () => void | Promise<void>,
  ): Promise<{ readonly mode: "direct" }> {
    const { candidateOutputFile } = _invocation;
    await assertInvocationCurrent?.();
    mkdirSync(path.dirname(candidateOutputFile), { recursive: true });
    writeFileSync(candidateOutputFile, content, "utf8");
    const owner = path.basename(candidateOutputFile);
    writeFileSync(
      path.join(path.dirname(candidateOutputFile), manifestName(owner)),
      `genes-output-manifest-v2\nowner-base64:${Buffer.from(owner).toString("base64")}\n${owner}\n`,
      "utf8",
    );
    return { mode: "direct" };
  }

  async close(): Promise<void> {}
}

const dependencies: SessionDependencies<JsonValue> = {
  now: () => Date.now(),
  inventory: inventoryHxml,
  watch: <Cause>(_options: ReconciledWatchOptions<Cause>): ReconciledWatchSession =>
    Object.freeze({
      reconcile: () => Object.freeze({ ok: true as const, changed: false }),
      close: () => undefined,
    }),
  createCompiler: (
    _layout: SessionLayout,
    _onEvent: (event: HaxeWaitServerEvent) => void,
    _shutdownTimeoutMs: number,
  ) => new FixtureCompiler(),
  publish: async (options) =>
    await publishArtifacts({
      ...options,
      ...(crashAt === undefined
        ? {}
        : {
            faultInjector: (checkpoint) => {
              if (checkpoint === crashAt) process.exit(73);
            },
          }),
    }),
  recover: recoverArtifacts,
  acquireLock: acquireSessionLock,
  nonce: () => "crash-fixture",
};

const options: GenesDevelopmentOptions<JsonValue> = {
  projectRoot: root,
  projectIdentity: "fixture-alternate-state-recovery",
  hxml: {
    allowedRoots: [root],
  },
  publicOutputFile,
  stateDirectory,
  resolveInvocation: () => ({
    executable: "haxe",
    cwd: root,
    args: ["build.hxml"],
    ioPolicy: "haxe-4.3.7-development-js-v1",
    compatibilityFacts: { fixture: "alternate-state-recovery" },
  }),
  validate: async () => ({ ok: true }),
  validatorPolicyFacts: { fixture: "alternate-state-recovery" },
  debounceMs: 0,
  pollIntervalMs: 10,
  shutdownTimeoutMs: 20,
};

const session = createGenesDevelopmentSessionWithDependencies(
  options,
  dependencies,
);
await session.start();
await session.waitForIdle();
if (session.state.kind !== "ready") {
  throw new Error(`session fixture did not become ready: ${JSON.stringify(session.inspect())}`);
}
await session.close();
