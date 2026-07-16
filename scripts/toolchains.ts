import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type TypeScriptLaneName = "legacyFloor" | "apiBridge" | "current";

export interface TypeScriptProgramApiEngine {
  readonly dependency: string;
  readonly package: string;
  readonly version: string;
}

export interface TypeScriptLane {
  readonly dependency: string;
  readonly package: string;
  readonly version: string;
  readonly binary: string;
  readonly contract: "generated-output" | "program-api-and-generated-output" | "generated-output-only";
  readonly programApiEngine: TypeScriptProgramApiEngine | null;
}

export interface ToolchainManifest {
  readonly schemaVersion: 1;
  readonly node: {
    readonly stable: string;
    readonly nextLts: string;
  };
  readonly haxe: {
    readonly stable: string;
    readonly preview: string;
  };
  readonly typescript: Readonly<Record<TypeScriptLaneName, TypeScriptLane>>;
  readonly dts2hx: {
    readonly dependency: string;
    readonly version: string;
    readonly typescriptVersion: string;
    readonly sourceAuditRevision: string;
    readonly contract: "declaration-ingestion";
  };
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, "../..");

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${label} to be a non-empty string`);
  }
  return value;
}

function readLane(value: unknown, label: string): TypeScriptLane {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Expected ${label} to be an object`);
  }
  const lane = value as Record<string, unknown>;
  const contract = nonEmptyString(lane.contract, `${label}.contract`);
  if (!["generated-output", "program-api-and-generated-output", "generated-output-only"].includes(contract)) {
    throw new Error(`Unsupported ${label}.contract: ${contract}`);
  }
  const rawEngine = lane.programApiEngine;
  let programApiEngine: TypeScriptProgramApiEngine | null = null;
  if (rawEngine !== undefined) {
    if (typeof rawEngine !== "object" || rawEngine === null || Array.isArray(rawEngine)) {
      throw new Error(`Expected ${label}.programApiEngine to be an object`);
    }
    const engine = rawEngine as Record<string, unknown>;
    programApiEngine = {
      dependency: nonEmptyString(
        engine.dependency,
        `${label}.programApiEngine.dependency`
      ),
      package: nonEmptyString(engine.package, `${label}.programApiEngine.package`),
      version: nonEmptyString(engine.version, `${label}.programApiEngine.version`)
    };
  }
  const ownsProgramApi = contract === "program-api-and-generated-output";
  if (ownsProgramApi !== (programApiEngine !== null)) {
    throw new Error(
      `${label}.programApiEngine must be present exactly when the lane owns the Program API`
    );
  }
  return {
    dependency: nonEmptyString(lane.dependency, `${label}.dependency`),
    package: nonEmptyString(lane.package, `${label}.package`),
    version: nonEmptyString(lane.version, `${label}.version`),
    binary: nonEmptyString(lane.binary, `${label}.binary`),
    contract: contract as TypeScriptLane["contract"],
    programApiEngine
  };
}

function readDts2hx(value: unknown): ToolchainManifest["dts2hx"] {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected dts2hx to be an object");
  }
  const contract = value as Record<string, unknown>;
  if (contract.contract !== "declaration-ingestion") {
    throw new Error(`Unsupported dts2hx.contract: ${String(contract.contract)}`);
  }
  const sourceAuditRevision = nonEmptyString(
    contract.sourceAuditRevision,
    "dts2hx.sourceAuditRevision"
  );
  if (!/^[0-9a-f]{40}$/.test(sourceAuditRevision)) {
    throw new Error("dts2hx.sourceAuditRevision must be a full Git revision");
  }
  return {
    dependency: nonEmptyString(contract.dependency, "dts2hx.dependency"),
    version: nonEmptyString(contract.version, "dts2hx.version"),
    typescriptVersion: nonEmptyString(
      contract.typescriptVersion,
      "dts2hx.typescriptVersion"
    ),
    sourceAuditRevision,
    contract: "declaration-ingestion"
  };
}

/**
 * Loads the single compiler/toolchain contract used by local runners and CI.
 *
 * Why: generated-code compatibility and TypeScript's programmatic API now have
 * different release paths. Keeping versions in individual shell snippets made
 * it impossible to tell whether a green test represented TS5, TS6, or TS7.
 *
 * What/How: validate the checked-in JSON at module load and expose immutable
 * lane names. The JSON remains dependency-free so GitHub Actions can read it
 * before package installation; TypeScript runners consume the same values
 * after `scripts` has been built.
 */
export function loadToolchains(): ToolchainManifest {
  const parsed: unknown = JSON.parse(
    readFileSync(path.join(repoRoot, "config", "toolchains.json"), "utf8")
  );
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("config/toolchains.json must contain an object");
  }
  const root = parsed as Record<string, unknown>;
  if (root.schemaVersion !== 1) {
    throw new Error("config/toolchains.json schemaVersion must be 1");
  }
  const node = root.node as Record<string, unknown> | undefined;
  const haxe = root.haxe as Record<string, unknown> | undefined;
  const typescript = root.typescript as Record<string, unknown> | undefined;
  const dts2hx = root.dts2hx;
  if (!node || !haxe || !typescript || !dts2hx) {
    throw new Error(
      "config/toolchains.json must define node, haxe, typescript, and dts2hx"
    );
  }
  return {
    schemaVersion: 1,
    node: {
      stable: nonEmptyString(node.stable, "node.stable"),
      nextLts: nonEmptyString(node.nextLts, "node.nextLts")
    },
    haxe: {
      stable: nonEmptyString(haxe.stable, "haxe.stable"),
      preview: nonEmptyString(haxe.preview, "haxe.preview")
    },
    typescript: {
      legacyFloor: readLane(typescript.legacyFloor, "typescript.legacyFloor"),
      apiBridge: readLane(typescript.apiBridge, "typescript.apiBridge"),
      current: readLane(typescript.current, "typescript.current")
    },
    dts2hx: readDts2hx(dts2hx)
  };
}

export const toolchains = loadToolchains();
export const generatedOutputLanes: ReadonlyArray<TypeScriptLaneName> = [
  "legacyFloor",
  "apiBridge",
  "current"
];

/** Runs one pinned compiler lane without shell interpolation. */
export function runTypeScript(
  lane: TypeScriptLaneName,
  args: ReadonlyArray<string>,
  options: ExecFileSyncOptions = {}
): void {
  execFileSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "run-typescript.mjs"), lane, ...args],
    { cwd: repoRoot, stdio: "inherit", ...options }
  );
}

/**
 * Type-checks one generated project against every supported output compiler.
 *
 * The legacy floor emits runnable JavaScript first. TS6 and TS7 then re-check
 * the identical source with `--noEmit`; this keeps runtime ownership singular
 * while detecting current-library and removed-option regressions.
 */
export function runGeneratedTypeScriptMatrix(
  tsconfigPath: string,
  options: { readonly emit?: boolean } = {}
): void {
  const emit = options.emit !== false;
  generatedOutputLanes.forEach((lane, index) => {
    const args = ["-p", tsconfigPath];
    if (!emit || index > 0) args.push("--noEmit");
    runTypeScript(lane, args);
  });
}
