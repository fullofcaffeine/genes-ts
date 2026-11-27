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

/**
 * Names the fixed file that tells Genes where this request writes its
 * private candidate tree (see `genes.Generator.OUTPUT_DESCRIPTOR_DEFINE`).
 */
export const GENES_OUTPUT_DESCRIPTOR_DEFINE = "genes.output_descriptor";

/**
 * Names the fixed request descriptor of the Genes incremental path (see
 * `genes.incremental.IncrementalRequest`). Genes keeps plain records between
 * requests only while this define is present.
 */
export const GENES_DEV_INCREMENTAL_DEFINE = "genes.dev_incremental";

/** File names inside the session's fixed request folder. */
export const OUTPUT_DESCRIPTOR_FILE = "genes-output.descriptor";
export const INCREMENTAL_DESCRIPTOR_FILE = "incremental.json";
export const COMPILER_DATA_DESCRIPTOR_FILE = "compiler-data-v1.descriptor";

/**
 * The generation report that Genes writes beside the incremental descriptor
 * (`genes.incremental.IncrementalRequest.generationReportPath`): the
 * descriptor path plus `.report.json`. The session reads its `audit` part
 * after a build with generation reuse.
 */
export const GENERATION_REPORT_FILE = `${INCREMENTAL_DESCRIPTOR_FILE}.report.json`;

/**
 * The folder, inside the session's fixed request folder, where Haxe writes
 * its module dependency lists for Genes (`genes.incremental.HaxeDependencies`):
 * `-D dump-path=<request folder>/haxe-dependencies` in every build that has
 * the incremental define.
 *
 * Why the session gives it: Haxe copies the defines into its macro context
 * before any init macro runs, so a `dump-path` that Genes sets reaches only
 * the program's list, and the macro context's list goes to `dump/macro` of
 * the working folder, which every process there shares. On the command line
 * the define reaches both, so both lists go to the session's own folder and
 * Genes deletes nothing outside it. The path is the same in every build,
 * because `dump-path` is part of Haxe's compilation signature. Users cannot
 * set `dump`, `dump-dependencies` or `dump-path` themselves
 * (`FORBIDDEN_DEFINES`).
 */
export const HAXE_DEPENDENCIES_FOLDER = "haxe-dependencies";

/**
 * What one Haxe request asks of the Genes incremental path.
 *
 * - `measure` (the default): the descriptor asks for `afterTyping:
 *   "measure"` only. Genes keeps its records, but every pass does its full
 *   work, so the output equals a build without the define.
 * - `reuse`: `afterTyping: "reuse"` and `generation: "reuse"`, with
 *   `audit.modules` set to `auditModules` (see
 *   `GenesDevelopmentOptions.generationReuse`).
 * - `none`: no incremental define at all, as in an ordinary build. The cold
 *   build of the output check uses it, so that its tree is the oracle.
 */
export type IncrementalBinding =
  | { readonly kind: "measure" }
  | {
      readonly kind: "reuse";
      readonly auditModules: number;
      /**
       * True when the session also sends module requests
       * (`GenesDevelopmentOptions.modulePreview`): the program request then
       * asks Genes to keep the facts that a module request checks
       * (`"moduleRecords": true`).
       */
      readonly moduleRecords?: boolean;
      /** True asks Genes for the request measure (`"requestMeasure": true`). */
      readonly requestMeasure?: boolean;
    }
  | {
      /**
       * A module request (G3): the edited module is the only root, and Genes
       * prints only that module when it can prove that a program request
       * prints the same files (`genes.incremental.ModuleRequest`).
       */
      readonly kind: "module";
      /** The Haxe module path, for example `ui.controls.Button`. */
      readonly module: string;
      /** True asks Genes for the request measure (`"requestMeasure": true`). */
      readonly requestMeasure?: boolean;
    }
  | { readonly kind: "none" };

const MEASURE_ONLY: IncrementalBinding = Object.freeze({ kind: "measure" });

/**
 * Returns the incremental descriptor text for one binding, or `null` for
 * `none`. `programDigest` is the identity of the effective plan; Genes only
 * compares it with the digest of the earlier request.
 *
 * Example: `{ kind: "reuse", auditModules: 2 }` gives
 * `{"format":1,"programDigest":"...","kind":"full","afterTyping":"reuse",
 * "generation":"reuse","audit":{"modules":2,"seed":0}}`.
 */
export function incrementalDescriptorText(
  binding: IncrementalBinding,
  programDigest: string,
): string | null {
  switch (binding.kind) {
    case "none":
      return null;
    case "measure":
      // Genes stamps declarations and keeps its plain records, but every
      // pass still does its full work. The output equals a build without
      // the define.
      return `${JSON.stringify({
        format: 1,
        programDigest,
        kind: "full",
        afterTyping: "measure",
      })}\n`;
    case "reuse":
      return `${JSON.stringify({
        format: 1,
        programDigest,
        kind: "full",
        afterTyping: "reuse",
        generation: "reuse",
        ...(binding.moduleRecords === true ? { moduleRecords: true } : {}),
        ...(binding.requestMeasure === true ? { requestMeasure: true } : {}),
        audit: { modules: binding.auditModules, seed: 0 },
      })}\n`;
    case "module":
      // `programDigest` is the digest of the program that the module request
      // previews, not of its own argument list: Genes compares it with the
      // stored records of that program.
      return `${JSON.stringify({
        format: 1,
        programDigest,
        kind: "module",
        module: binding.module,
        afterTyping: "reuse",
        generation: "reuse",
        ...(binding.requestMeasure === true ? { requestMeasure: true } : {}),
      })}\n`;
  }
}

/** The Haxe 4.3.7 options that name the main class, a root of the program. */
const MAIN_OPTIONS = new Set(["-m", "--main", "-main"]);

/**
 * Matches the value of a `--macro` option that adds roots: Haxe's
 * `include(...)` macro (`haxe.macro.Compiler.include`), which types every
 * module of a package.
 */
const INCLUDE_MACRO = /^\s*(?:haxe\.macro\.Compiler\.)?include\s*\(/u;

/**
 * Returns the arguments of a module request: the program's effective
 * arguments with every root removed, and the edited module as the only
 * root.
 *
 * Why: a module request types only the edited module and loads the rest of
 * the program from the warm compiler-server cache. Each other root would
 * make Haxe type more modules, and Genes then refuses the preview
 * (`other-modules-typed`). The roots of Haxe 4.3.7 are the main class
 * (`-m`, `--main`, `-main`), each class name given as a plain argument, and
 * each `--macro include(...)`. Every other argument stays, in its order,
 * because a define, class path or macro that differs from the program
 * request makes Haxe select another cache, or makes Genes print other
 * bytes.
 *
 * Example: `["-cp", "src", "-main", "Main", "--macro", "include('ui')",
 * "ui.Card", "-dce", "std"]` with `ui.Button` gives `["-cp", "src", "-dce",
 * "std", "ui.Button"]`.
 *
 * Limits: a plain argument that ends in `.hxml` is a private file of the
 * session (`BoundHaxeInvocation.privateArgumentFiles`), not a class name,
 * and stays. An option that Haxe 4.3.7 does not know counts as an option
 * without a value; the session's argument policy rejects such options in
 * authored HXML.
 */
export function moduleRequestArguments(
  effectiveArguments: readonly string[],
  module: string,
): readonly string[] {
  const kept: string[] = [];
  for (let index = 0; index < effectiveArguments.length; index += 1) {
    const argument = effectiveArguments[index]!;
    if (!argument.startsWith("-")) {
      // A plain argument: a class name (a root), or a private HXML file.
      if (argument.endsWith(".hxml")) kept.push(argument);
      continue;
    }
    const equals = argument.indexOf("=");
    const option = equals > 0 ? argument.slice(0, equals) : argument;
    if (equals > 0 && MAIN_OPTIONS.has(option)) continue;
    const arity = HAXE_4_3_7_OPTION_ARITY[argument] ?? 0;
    if (arity === 0) {
      kept.push(argument);
      continue;
    }
    const value = effectiveArguments[index + 1];
    index += 1;
    if (value === undefined) {
      kept.push(argument);
      continue;
    }
    if (MAIN_OPTIONS.has(argument)) continue;
    if (argument === "--macro" && INCLUDE_MACRO.test(value)) continue;
    kept.push(argument, value);
  }
  kept.push(module);
  return Object.freeze(kept);
}

const OUTPUT_DESCRIPTOR_HEADER = "genes.output-descriptor-v1";

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
  "--neko-lib-path",
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
  GENES_OUTPUT_DESCRIPTOR_DEFINE,
  GENES_DEV_INCREMENTAL_DEFINE,
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
  /**
   * The digest of each HXML and library provenance file that the identity
   * covers. `planInputFilesUnchanged` compares them again before a build.
   */
  readonly inputFileDigests: readonly {
    readonly file: string;
    readonly digest: string;
  }[];
}

/**
 * Returns true when every HXML and library provenance file of the plan still
 * has the bytes that the plan was built from.
 *
 * Why: resolving the plan again runs the host callback and the library
 * resolver, which can take seconds. Before each ordinary build the session
 * needs only to know whether these files changed since the plan was made;
 * reading a few small files answers that in about a millisecond. When the
 * answer is false, the session resolves the plan again and compares the
 * identity, as before. A file that cannot be read counts as changed.
 */
export function planInputFilesUnchanged(
  plan: EffectiveHaxeInvocationPlan,
): boolean {
  return plan.inputFileDigests.every(({ file, digest }) => {
    try {
      return canonicalDigest(readFileSync(file, "utf8")) === digest;
    } catch {
      return false;
    }
  });
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
  /**
   * Request files at fixed paths that the session writes before each
   * request. The defines name only these fixed paths, so their values, and
   * with them Haxe's compiler-server cache, stay the same between builds.
   */
  readonly requestFiles: readonly {
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
  const digestOf = (file: string) => ({
    file,
    digest: canonicalDigest(readFileSync(file, "utf8")),
  });
  const hxmlFileDigests = closure.hxmlFiles.map(digestOf);
  const provenanceFileDigests = closure.libraryProvenanceFiles.map(digestOf);
  const identity = canonicalDigest({
    protocol: "genes.tooling.effective-haxe-invocation.v1",
    executable: invocation.executable,
    cwd: invocation.cwd,
    arguments: invocation.args,
    environment,
    compatibilityFacts: invocation.compatibilityFacts,
    ioPolicyId: invocation.ioPolicy,
    allowedRoots: closure.allowedRoots,
    entryHxmlFiles: closure.entryHxmlFiles,
    hxmlOccurrences: closure.hxmlOccurrences.map((occurrence) => ({
      file: occurrence.file,
      workingDirectory: occurrence.workingDirectory,
    })),
    hxmlFiles: hxmlFileDigests,
    libraryProvenanceFiles: provenanceFileDigests,
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
    inputFileDigests: Object.freeze(
      [...hxmlFileDigests, ...provenanceFileDigests].map((entry) =>
        Object.freeze(entry),
      ),
    ),
  });
}

/**
 * Adds the only two output paths Haxe may own for one revision.
 *
 * The ordinary JavaScript target is deliberately outside the Genes ownership
 * root but inside the disposable candidate stage. If Genes does not activate,
 * Haxe can create that private file but cannot mutate the public output tree.
 *
 * Every define that this function adds has the same value in each build of
 * the session. Haxe 4.3.7 selects its compiler-server cache by all define
 * values, so a define that names the new candidate folder would make Haxe
 * type the whole program again for every build. The Genes output path of
 * this revision is therefore in a descriptor file at a fixed path in
 * `requestRoot`, and the define names that fixed path. The incremental
 * descriptor and the compiler-data descriptor follow the same rule.
 *
 * Example: `-D genes.output_descriptor=<project>/.genes/dev/haxe-request/genes-output.descriptor`
 * for every build, while the file names
 * `.genes/dev/candidates/revision-3-ab/output/index.tsx` in build 3.
 *
 * `incremental` selects the descriptor (`IncrementalBinding`); `none` leaves
 * out the incremental define, its file, and the `dump-path` of Haxe's
 * dependency lists (`HAXE_DEPENDENCIES_FOLDER`). `module` also replaces the
 * roots of the program by the module (`moduleRequestArguments`); the defines
 * stay the same, so a module request uses the cache of the program requests.
 */
export function bindHaxeInvocation(
  plan: EffectiveHaxeInvocationPlan,
  candidateStageRoot: string,
  candidateOutputFile: string,
  requestRoot: string,
  compilerDataDescriptorPath?: string,
  incremental: IncrementalBinding = MEASURE_ONLY,
): BoundHaxeInvocation {
  const haxeTarget = path.join(candidateStageRoot, "haxe-target", "compiler.js");
  const outputDescriptor = path.join(requestRoot, OUTPUT_DESCRIPTOR_FILE);
  const incrementalDescriptor = path.join(
    requestRoot,
    INCREMENTAL_DESCRIPTOR_FILE,
  );
  const incrementalText = incrementalDescriptorText(incremental, plan.identity);
  const environment: Record<string, string> = {
    ...(plan.invocation.env ?? {}),
  };
  const privateArgumentFiles: {
    readonly path: string;
    readonly contents: string;
  }[] = [];
  const bridgedArguments = plan.inventory.effectiveArguments.map(
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
  // The roots are removed after the bridge, so that each private file and
  // environment key keeps the index of the program request.
  const checkedArguments = incremental.kind === "module"
    ? moduleRequestArguments(bridgedArguments, incremental.module)
    : bridgedArguments;
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
      `${GENES_OUTPUT_DESCRIPTOR_DEFINE}=${outputDescriptor}`,
      ...(incrementalText === null
        ? []
        : [
            "-D",
            `${GENES_DEV_INCREMENTAL_DEFINE}=${incrementalDescriptor}`,
            "-D",
            `dump-path=${path.join(requestRoot, HAXE_DEPENDENCIES_FOLDER)}`,
          ]),
      ...(compilerDataDescriptorPath === undefined
        ? []
        : ["-D", `${COMPILER_DATA_DEFINE}=${compilerDataDescriptorPath}`]),
    ]),
    privateArgumentFiles: Object.freeze(privateArgumentFiles),
    requestFiles: Object.freeze([
      Object.freeze({
        path: outputDescriptor,
        contents: `${OUTPUT_DESCRIPTOR_HEADER}\n${Buffer.from(candidateOutputFile, "utf8").toString("base64")}\n`,
      }),
      ...(incrementalText === null
        ? []
        : [
            Object.freeze({
              path: incrementalDescriptor,
              contents: incrementalText,
            }),
          ]),
    ]),
    candidateRoot: candidateStageRoot,
    candidateOutputFile,
  });
}
