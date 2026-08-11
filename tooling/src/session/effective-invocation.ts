import { readFileSync } from "node:fs";
import path from "node:path";

import { canonicalDigest, type CanonicalJson } from "../artifacts/index.js";
import {
  HAXE_4_3_7_OPTION_ARITY,
  type HxmlArgumentPolicy,
  type HxmlInventory,
  type HxmlInventoryOptions,
} from "../hxml/index.js";
import {
  inventoryHxmlForDevelopmentSession,
  isHaxe437OrdinaryInlineHxmlOption,
} from "../hxml/inventory.js";
import type {
  GenesDevelopmentOptions,
  HaxeInvocation,
  JsonValue,
} from "./types.js";
import { COMPILER_DATA_DEFINE } from "./compiler-data.js";

export const HAXE_4_3_7_DEVELOPMENT_JS_POLICY =
  "haxe-4.3.7-development-js-v1" as const;

const ALLOWED_OPTIONS = new Set([
  "-p",
  "--class-path",
  "-cp",
  "-m",
  "--main",
  "-main",
  "-D",
  "--define",
  "-v",
  "--verbose",
  "--debug",
  "-debug",
  "--dce",
  "-dce",
  "--no-traces",
  "--times",
  "--no-inline",
  "--no-opt",
  "--remap",
  "--macro",
  "-w",
  "-L",
  "--library",
  "-lib",
]);

/** Every other exact Haxe 4.3.7 spelling is rejected by the fixed JS policy. */
const FORBIDDEN_OPTIONS = Object.freeze(
  Object.keys(HAXE_4_3_7_OPTION_ARITY)
    .filter((option) => !ALLOWED_OPTIONS.has(option))
    .sort(),
);

const FORBIDDEN_DEFINES = Object.freeze([
  "dump",
  "dump-dependencies",
  "dump-path",
  "genes.output",
  COMPILER_DATA_DEFINE,
  "genes.tooling.prepared",
  "gen_hx_classes",
  "message.log-file",
]);

/**
 * One immutable authority shared by inventory, watching, server compatibility,
 * and execution. No sibling HXML configuration may change these facts after
 * the host invocation has been copied.
 */
export interface EffectiveHaxeInvocationPlan {
  readonly invocation: HaxeInvocation;
  readonly inventory: HxmlInventory;
  readonly ioPolicyId: HaxeInvocation["ioPolicy"];
  readonly identity: string;
}

export interface BoundHaxeInvocation {
  readonly sourceInvocation: HaxeInvocation;
  readonly executable: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly arguments: readonly string[];
  /**
   * Small private HXML files needed to preserve an authored inline option.
   *
   * Haxe can mistake any argument ending in `.hxml` for another build file.
   * The private bridge writes the checked option beside a private environment
   * placeholder. Haxe expands that placeholder only after it has decided which
   * arguments are build files, so the original value stays ordinary data.
   */
  readonly privateArgumentFiles: readonly {
    readonly path: string;
    readonly contents: string;
  }[];
  readonly candidateRoot: string;
  readonly candidateOutputFile: string;
}

type SessionHxmlOptions<Diagnostic extends JsonValue> =
  GenesDevelopmentOptions<Diagnostic>["hxml"];

function mergedPolicy(
  policy: HxmlArgumentPolicy | undefined,
): HxmlArgumentPolicy {
  return Object.freeze({
    forbiddenOptions: Object.freeze(
      [...new Set([...(policy?.forbiddenOptions ?? []), ...FORBIDDEN_OPTIONS])]
        .sort(),
    ),
    forbiddenDefines: Object.freeze(
      [...new Set([...(policy?.forbiddenDefines ?? []), ...FORBIDDEN_DEFINES])]
        .sort(),
    ),
    rejectUnknownOptions: true,
  });
}

function assertEntryArguments(invocation: HaxeInvocation): void {
  if (invocation.args.length === 0) {
    throw new Error("Haxe invocation must contain at least one HXML entry");
  }
  for (const argument of invocation.args) {
    if (argument.startsWith("-") || !argument.endsWith(".hxml")) {
      throw new Error(
        "Haxe invocation may contain only ordered top-level HXML files; DevelopmentSession owns target and output arguments",
      );
    }
  }
}

export async function buildEffectiveHaxeInvocationPlan<
  Diagnostic extends JsonValue,
>(
  invocation: HaxeInvocation,
  hxml: SessionHxmlOptions<Diagnostic>,
  signal: AbortSignal,
  inventory: (
    options: HxmlInventoryOptions,
  ) => Promise<HxmlInventory> = inventoryHxmlForDevelopmentSession,
): Promise<EffectiveHaxeInvocationPlan> {
  assertEntryArguments(invocation);
  if (invocation.ioPolicy !== HAXE_4_3_7_DEVELOPMENT_JS_POLICY) {
    throw new Error("unsupported DevelopmentSession compiler I/O policy");
  }
  const environment: Readonly<Record<string, string>> =
    invocation.env ?? Object.freeze({});
  const options: HxmlInventoryOptions = Object.freeze({
    ...hxml,
    entryFiles: invocation.args,
    workingDirectory: invocation.cwd,
    environment: (name: string) => environment[name] ?? null,
    signal,
    argumentPolicy: mergedPolicy(hxml.argumentPolicy),
  });
  const closure = await inventory(options);
  const identity = canonicalDigest({
    protocol: "genes.tooling.effective-haxe-invocation.v1",
    executable: invocation.executable,
    cwd: invocation.cwd,
    arguments: invocation.args,
    environment,
    compatibilityFacts: invocation.compatibilityFacts,
    ioPolicyId: invocation.ioPolicy,
    entryHxmlFiles: closure.entryHxmlFiles,
    hxmlOccurrences: closure.hxmlOccurrences.map((occurrence) => ({
      file: occurrence.file,
      workingDirectory: occurrence.workingDirectory,
    })),
    hxmlFiles: closure.hxmlFiles.map((file) => ({
      file,
      digest: canonicalDigest(readFileSync(file, "utf8")),
    })),
    libraryProvenanceFiles: closure.libraryProvenanceFiles.map((file) => ({
      file,
      digest: canonicalDigest(readFileSync(file, "utf8")),
    })),
    classPaths: closure.classPaths,
    resourceInputs: closure.resourceInputs,
    effectiveArguments: closure.effectiveArguments,
    libraries: closure.libraries.map((library) => ({
      request: library.request,
      name: library.name,
      version: library.version,
      fromFile: library.fromFile,
      workingDirectory: library.workingDirectory,
    })),
    libraryClosureComplete: closure.libraryClosureComplete,
  } satisfies CanonicalJson);
  return Object.freeze({
    invocation,
    inventory: closure,
    ioPolicyId: invocation.ioPolicy,
    identity,
  });
}

/**
 * Adds the only two output paths Haxe may own for one revision.
 *
 * The ordinary JavaScript target is deliberately outside the Genes ownership
 * root but inside the disposable candidate stage. If Genes does not activate,
 * Haxe can create that private file but cannot mutate the public output tree.
 */
export function bindHaxeInvocation(
  plan: EffectiveHaxeInvocationPlan,
  candidateStageRoot: string,
  candidateOutputFile: string,
  compilerDataDescriptorPath?: string,
): BoundHaxeInvocation {
  const haxeTarget = path.join(candidateStageRoot, "haxe-target", "compiler.js");
  const environment: Record<string, string> = {
    ...(plan.invocation.env ?? {}),
  };
  const privateArgumentFiles: {
    readonly path: string;
    readonly contents: string;
  }[] = [];
  const checkedArguments = plan.inventory.effectiveArguments.map(
    (argument, index) => {
      if (!isHaxe437OrdinaryInlineHxmlOption(argument)) {
        return argument;
      }
      const bridge = path.join(
        candidateStageRoot,
        "haxe-input",
        `inline-option-${index}.hxml`,
      );
      const equals = argument.indexOf("=");
      const option = argument.slice(0, equals);
      const value = argument.slice(equals + 1);
      const environmentKey = `GENES_TOOLING_HXML_OPTION_VALUE_${index}`;
      if (Object.hasOwn(environment, environmentKey)) {
        throw new Error(
          `Haxe invocation environment uses reserved key ${environmentKey}`,
        );
      }
      environment[environmentKey] = value;
      privateArgumentFiles.push(
        Object.freeze({
          path: bridge,
          contents: `${option} %${environmentKey}%\n`,
        }),
      );
      return bridge;
    },
  );
  return Object.freeze({
    sourceInvocation: plan.invocation,
    executable: plan.invocation.executable,
    cwd: plan.invocation.cwd,
    environment: Object.freeze(environment),
    arguments: Object.freeze([
      ...checkedArguments,
      "--js",
      haxeTarget,
      "-D",
      `genes.output=${candidateOutputFile}`,
      ...(compilerDataDescriptorPath === undefined
        ? []
        : ["-D", `${COMPILER_DATA_DEFINE}=${compilerDataDescriptorPath}`]),
    ]),
    privateArgumentFiles: Object.freeze(privateArgumentFiles),
    candidateRoot: candidateStageRoot,
    candidateOutputFile,
  });
}
