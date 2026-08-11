import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  canonicalJson,
  publishArtifacts,
  recoverArtifacts,
  sha256Bytes,
  type ArtifactCheckpoint,
  type CanonicalJson,
  type PublicationPlan,
} from "./artifacts/index.js";
import { inventoryHxml } from "./hxml/index.js";
import {
  establishSessionAuthority,
  type AuthorityMigrationCheckpoint,
} from "./session/authority-migration.js";
import type { HaxeWaitServerEvent } from "./haxe-server/index.js";
import type {
  ReconciledWatchOptions,
  ReconciledWatchSession,
} from "./watch/index.js";
import type { SessionCompiler } from "./session/haxe-driver.js";
import {
  resolveSessionLayout,
  type SessionLayout,
} from "./session/layout.js";
import {
  legacyAdmissionDigest,
  legacySessionProjectDigest,
} from "./session/publication.js";
import {
  createGenesDevelopmentSessionWithDependencies,
  type SessionDependencies,
} from "./session/runtime.js";
import { COMPILER_DATA_DEFINE } from "./session/compiler-data.js";
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
const supplementalPath = process.env.GENES_SESSION_CRASH_SUPPLEMENTAL_PATH;
const supplementalContent =
  process.env.GENES_SESSION_CRASH_SUPPLEMENTAL_CONTENT ??
  "generated supplemental file\n";
const compilerDataContent = process.env.GENES_SESSION_CRASH_COMPILER_DATA;
const crashAt = process.env.GENES_SESSION_CRASH_AT as ArtifactCheckpoint | undefined;
const migrationCrashAt = process.env
  .GENES_SESSION_MIGRATION_CRASH_AT as AuthorityMigrationCheckpoint | undefined;
const useLegacyAuthority =
  process.env.GENES_SESSION_CRASH_LEGACY_AUTHORITY === "true";
let hxmlOnFirstWatch = process.env.GENES_SESSION_HXML_ON_WATCH;
const projectIdentity = "fixture-alternate-state-recovery";
const validatorPolicyFacts = { fixture: "alternate-state-recovery" } as const;
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
    invocation: Parameters<SessionCompiler["compile"]>[0],
    _compatibilityDigest: string,
    _signal: AbortSignal,
    assertInvocationCurrent?: () => void | Promise<void>,
  ): Promise<{ readonly mode: "direct" }> {
    const { candidateOutputFile } = invocation;
    await assertInvocationCurrent?.();
    if (compilerDataContent !== undefined) {
      const request = invocation.arguments.find((argument) =>
        argument.startsWith(`${COMPILER_DATA_DEFINE}=`),
      );
      if (request === undefined) {
        throw new Error("crash fixture did not receive its compiler-data request");
      }
      const descriptorPath = request.slice(`${COMPILER_DATA_DEFINE}=`.length);
      const lines = readFileSync(descriptorPath, "utf8").split("\n");
      if (lines.shift() !== "genes.tooling.compiler-data-request-v1") {
        throw new Error("crash fixture received an invalid compiler-data request");
      }
      const slot = lines
        .filter((line) => line.length > 0)
        .map((line) => line.split("\t"))
        .find(
          (fields) =>
            Buffer.from(fields[0]!, "base64").toString("utf8") ===
            "crash.receipt",
        );
      if (slot === undefined || slot.length !== 3) {
        throw new Error("crash fixture could not find its compiler-data slot");
      }
      writeFileSync(
        Buffer.from(slot[2]!, "base64").toString("utf8"),
        compilerDataContent,
        "utf8",
      );
    }
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
  watch: <Cause>(options: ReconciledWatchOptions<Cause>): ReconciledWatchSession => {
    options.onRegistered?.();
    if (hxmlOnFirstWatch !== undefined) {
      writeFileSync(path.join(root, "build.hxml"), hxmlOnFirstWatch, "utf8");
      hxmlOnFirstWatch = undefined;
    }
    return Object.freeze({
      reconcile: () => Object.freeze({ ok: true as const, changed: false }),
      close: () => undefined,
    });
  },
  createCompiler: (
    _layout: SessionLayout,
    _onEvent: (event: HaxeWaitServerEvent) => void,
    _shutdownTimeoutMs: number,
  ) => new FixtureCompiler(),
  publish: async (options) => {
    let plan = options.plan;
    if (useLegacyAuthority) {
      const layout = resolveSessionLayout(
        root,
        projectIdentity,
        publicOutputFile,
        stateDirectory,
      );
      const marker = plan.commitMarker.stagedPath;
      if (marker === null) {
        throw new Error("legacy crash fixture requires a staged marker");
      }
      const markerAbsolute = path.join(root, ...marker.split("/"));
      const current = JSON.parse(
        readFileSync(markerAbsolute, "utf8"),
      ) as Record<string, unknown>;
      const legacyBytes = `${canonicalJson({
        protocol: "genes.tooling.accepted-generation.v1",
        sessionNonce: current.sessionNonce,
        generation: current.generation,
        revision: current.revision,
        acceptedAt: current.acceptedAt,
        manifestDigest: current.manifestDigest,
        publicOutput: layout.publicEntryAuthority,
        publicOutputPath: layout.publicOutputRelative,
      } as CanonicalJson)}\n`;
      writeFileSync(markerAbsolute, legacyBytes, "utf8");
      plan = Object.freeze({
        ...plan,
        projectIdentity: legacySessionProjectDigest(layout),
        authorizationDigest: legacyAdmissionDigest(
          layout,
          String(current.manifestDigest),
          validatorPolicyFacts,
        ),
        transactionRoot: layout.legacyTransactionRelative,
        commitMarker: Object.freeze({
          ...plan.commitMarker,
          path: layout.legacyGenerationMarkerRelative,
          next: Object.freeze({
            kind: "file" as const,
            sha256: sha256Bytes(legacyBytes),
            sizeBytes: Buffer.byteLength(legacyBytes),
            mode: 0o600,
          }),
        }),
      }) satisfies PublicationPlan;
    }
    return await publishArtifacts({
      ...options,
      plan,
      ...(crashAt === undefined
        ? {}
        : {
            faultInjector: (checkpoint) => {
              if (checkpoint === crashAt) process.exit(73);
            },
          }),
    });
  },
  recover: recoverArtifacts,
  acquireLock: acquireSessionLock,
  establishAuthority: async (layout) =>
    await establishSessionAuthority(layout, {
      publish: publishArtifacts,
      recover: recoverArtifacts,
      faultInjector: (checkpoint) => {
        if (checkpoint === migrationCrashAt) process.exit(74);
      },
    }),
  nonce: () => "crash-fixture",
};

const options: GenesDevelopmentOptions<JsonValue> = {
  projectRoot: root,
  projectIdentity,
  hxml: {
    allowedRoots: [root],
  },
  publicOutputFile,
  stateDirectory,
  ...(compilerDataContent === undefined
    ? {}
    : {
        compilerData: [{ id: "crash.receipt", maxBytes: 1_024 }],
      }),
  resolveInvocation: () => ({
    executable: "haxe",
    cwd: root,
    args: ["build.hxml"],
    ioPolicy: "haxe-4.3.7-development-js-v1",
    compatibilityFacts: { fixture: "alternate-state-recovery" },
  }),
  ...(supplementalPath === undefined
    ? {}
    : {
        prepareRevision: async () => ({
          ok: true as const,
          prepared: {
            classPaths: [],
            files: [
              {
                relativePath: "prepared/shared-supplemental.txt",
                publishPath: supplementalPath,
                content: supplementalContent,
              },
            ],
          },
        }),
      }),
  validate: async (tree, context) => {
    if (compilerDataContent === undefined) return { ok: true };
    if (context.recovery) {
      throw new Error(
        "a compiler-data generation must rebuild instead of replaying validation",
      );
    }
    const receipt = tree.compilerData.find(
      (file) => file.id === "crash.receipt",
    );
    if (receipt === undefined) {
      return {
        ok: false,
        diagnostic: "compiler-data receipt is missing",
      };
    }
    return {
      ok: true,
      artifacts: [
        {
          path: "compiler-data-receipt.json",
          content: receipt.readBytes(),
        },
      ],
    };
  },
  validatorPolicyFacts,
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
