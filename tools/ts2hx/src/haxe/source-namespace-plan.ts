import path from "path";
import ts from "../typescript-api.js";
import { toHaxeModuleName, toHaxePackagePath } from "../util.js";

export type SourceNamespaceEntry = Readonly<{
  sourceFile: ts.SourceFile;
  sourceKey: string;
  sourcePath: string;
  kind: "emitted" | "declaration-only" | "unsupported";
  packageSegments: readonly string[];
  packagePath: string | null;
  moduleName: string | null;
  moduleFqn: string | null;
  outputRelativeFile: string | null;
  outputFile: string | null;
}>;

export type SourceNamespaceProblem = Readonly<{
  sourceFile: ts.SourceFile;
  sourceKey: string;
  id:
    | "TS2HX-SOURCE-NAMESPACE-BASE-PACKAGE-001"
    | "TS2HX-SOURCE-NAMESPACE-PACKAGE-SEGMENT-001"
    | "TS2HX-SOURCE-NAMESPACE-MODULE-NAME-001"
    | "TS2HX-SOURCE-NAMESPACE-OUTSIDE-ROOT-001"
    | "TS2HX-SOURCE-NAMESPACE-COLLISION-001";
  message: string;
  outputRelativeFile: string | null;
}>;

export type SourceNamespacePlan = Readonly<{
  basePackageSegments: readonly string[];
  basePackagePath: string;
  entries: readonly SourceNamespaceEntry[];
  bySourceFile: ReadonlyMap<string, SourceNamespaceEntry>;
  problems: readonly SourceNamespaceProblem[];
}>;

export type SourceNamespacePlanOptions = Readonly<{
  rootDir: string;
  outDir: string;
  basePackage: string;
  sourceFiles: readonly ts.SourceFile[];
}>;

// These are lexical package-name failures on the pinned Haxe parser. Contextual
// words such as `macro`, `from`, and `to` are intentionally absent: Haxe 4.3.7
// accepts them as package segments, so rejecting them here would invent a
// stricter language than the compiler we are preparing source for.
const HAXE_PACKAGE_RESERVED = new Set([
  "abstract", "break", "case", "cast", "catch", "class", "continue",
  "default", "do", "dynamic", "else", "enum", "extends", "extern",
  "false", "final", "for", "function", "if", "implements", "import", "in",
  "inline", "interface", "is", "new", "null",
  "operator", "overload", "override", "package", "private", "public",
  "return", "static", "super", "switch", "this", "throw", "true",
  "try", "typedef", "untyped", "using", "var", "while"
]);

function portablePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isInsideRoot(relativePath: string): boolean {
  return relativePath !== ".."
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}

function isValidPackageSegment(segment: string): boolean {
  return /^[_a-z][_a-zA-Z0-9]*$/.test(segment) && !HAXE_PACKAGE_RESERVED.has(segment);
}

function sourceKind(fileName: string): SourceNamespaceEntry["kind"] {
  if (/\.d\.ts$/i.test(fileName)) return "declaration-only";
  return /\.(tsx?|jsx?)$/i.test(fileName) ? "emitted" : "unsupported";
}

function compareProblems(a: SourceNamespaceProblem, b: SourceNamespaceProblem): number {
  return a.sourceFile.fileName.localeCompare(b.sourceFile.fileName)
    || a.id.localeCompare(b.id)
    || a.message.localeCompare(b.message);
}

/**
 * Assigns every TypeScript root one validated, immutable Haxe identity.
 *
 * Why: TypeScript filenames are more permissive than Haxe module and package
 * names. Deriving names independently in import planning, source rendering,
 * and publication let two roots such as `foo-bar.ts` and `foo_bar.ts` both
 * claim `FooBar.hx`; the later staged write silently replaced the earlier one.
 *
 * What: the plan owns the exact source path, Haxe package/module FQN, and
 * output path for every configured root. It validates the base package,
 * directory segments, root containment, usable module names, and project-wide
 * output uniqueness before runtime requests, externs, or source text exist.
 * Declaration files remain explicit non-emitting entries.
 *
 * How: naming preserves the existing `toHaxeModuleName` compatibility rule,
 * then validates its result and groups output paths case-insensitively so the
 * same project is safe on both case-sensitive and case-insensitive hosts. A
 * problem is attached to each colliding source. Callers must treat every
 * problem as non-scaffoldable because one Haxe identity cannot represent two
 * source modules, even in assisted mode.
 */
export function planSourceNamespace(opts: SourceNamespacePlanOptions): SourceNamespacePlan {
  const rootDir = path.resolve(opts.rootDir);
  const outDir = path.resolve(opts.outDir);
  const rawBaseSegments = opts.basePackage.split(".");
  const basePackageSegments = rawBaseSegments.map((segment) => segment.trim());
  const basePackagePath = toHaxePackagePath(basePackageSegments);
  const sortedSources = opts.sourceFiles.slice().sort((a, b) =>
    path.resolve(a.fileName).localeCompare(path.resolve(b.fileName))
  );
  const entries: SourceNamespaceEntry[] = [];
  const problems: SourceNamespaceProblem[] = [];
  const invalidSources = new Set<string>();

  const firstSource = sortedSources[0];
  const invalidBaseSegments = rawBaseSegments.filter((raw, index) => {
    const segment = basePackageSegments[index] ?? "";
    return raw !== segment || !isValidPackageSegment(segment);
  });
  if (firstSource && (opts.basePackage.trim().length === 0 || invalidBaseSegments.length > 0)) {
    const sourceKey = path.resolve(firstSource.fileName);
    for (const sourceFile of sortedSources)
      invalidSources.add(path.resolve(sourceFile.fileName));
    problems.push(Object.freeze({
      sourceFile: firstSource,
      sourceKey,
      id: "TS2HX-SOURCE-NAMESPACE-BASE-PACKAGE-001",
      message:
        `Base package ${JSON.stringify(opts.basePackage)} is not a dot-separated Haxe package. `
        + "Each segment must start with a lowercase letter or underscore, contain only identifier characters, and not be reserved.",
      outputRelativeFile: null
    }));
  }

  for (const sourceFile of sortedSources) {
    const sourceKey = path.resolve(sourceFile.fileName);
    const relative = path.relative(rootDir, sourceKey);
    const sourcePath = portablePath(relative);
    const kind = sourceKind(sourceKey);
    const directory = path.dirname(relative);
    const directorySegments = directory === "."
      ? []
      : directory.split(path.sep).filter((segment) => segment.length > 0);
    const packageSegments = Object.freeze([...basePackageSegments, ...directorySegments]);
    const packagePath = toHaxePackagePath(packageSegments);
    const fileBase = path.basename(relative).replace(/\.(d\.)?(tsx?|jsx?)$/i, "");
    const moduleName = kind === "emitted" ? toHaxeModuleName(fileBase) : null;
    const outputRelativeFile = moduleName === null
      ? null
      : path.posix.join(...packageSegments, `${moduleName}.hx`);
    const outputFile = outputRelativeFile === null
      ? null
      : path.resolve(outDir, ...outputRelativeFile.split("/"));
    const moduleFqn = moduleName === null
      ? null
      : packagePath.length > 0 ? `${packagePath}.${moduleName}` : moduleName;
    const entry: SourceNamespaceEntry = Object.freeze({
      sourceFile,
      sourceKey,
      sourcePath,
      kind,
      packageSegments,
      packagePath: moduleName === null ? null : packagePath,
      moduleName,
      moduleFqn,
      outputRelativeFile,
      outputFile
    });
    entries.push(entry);

    if (!isInsideRoot(relative)) {
      invalidSources.add(sourceKey);
      problems.push(Object.freeze({
        sourceFile,
        sourceKey,
        id: "TS2HX-SOURCE-NAMESPACE-OUTSIDE-ROOT-001",
        message: `Source ${JSON.stringify(sourcePath)} is outside the configured root directory.`,
        outputRelativeFile
      }));
      continue;
    }
    if (kind !== "emitted") continue;

    const invalidDirectory = directorySegments.find((segment) => !isValidPackageSegment(segment));
    if (invalidDirectory !== undefined) {
      invalidSources.add(sourceKey);
      problems.push(Object.freeze({
        sourceFile,
        sourceKey,
        id: "TS2HX-SOURCE-NAMESPACE-PACKAGE-SEGMENT-001",
        message:
          `Directory segment ${JSON.stringify(invalidDirectory)} in ${JSON.stringify(sourcePath)} is not a valid Haxe package segment. `
          + "Rename the directory before translation; ts2hx does not guess a package spelling.",
        outputRelativeFile
      }));
    }

    if (
      !/[a-z0-9]/i.test(fileBase)
      || moduleName === null
      || !/^[A-Z][_a-zA-Z0-9]*$/.test(moduleName)
    ) {
      invalidSources.add(sourceKey);
      problems.push(Object.freeze({
        sourceFile,
        sourceKey,
        id: "TS2HX-SOURCE-NAMESPACE-MODULE-NAME-001",
        message:
          `Filename ${JSON.stringify(path.basename(relative))} does not produce a usable Haxe module name. `
          + "Rename it to include a letter or digit and to produce an uppercase Haxe identifier.",
        outputRelativeFile
      }));
    }
  }

  const outputOwners = new Map<string, SourceNamespaceEntry[]>();
  for (const entry of entries) {
    if (
      entry.kind !== "emitted"
      || entry.outputRelativeFile === null
      || entry.moduleFqn === null
      || invalidSources.has(entry.sourceKey)
    ) continue;
    const key = entry.outputRelativeFile.toLowerCase();
    const owners = outputOwners.get(key) ?? [];
    owners.push(entry);
    outputOwners.set(key, owners);
  }
  for (const owners of outputOwners.values()) {
    if (owners.length < 2) continue;
    owners.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
    const sourceList = owners.map((entry) => entry.sourcePath).join(", ");
    const outputList = Array.from(new Set(owners.map((entry) => entry.outputRelativeFile as string))).join(", ");
    const fqnList = Array.from(new Set(owners.map((entry) => entry.moduleFqn as string))).join(", ");
    for (const entry of owners) {
      invalidSources.add(entry.sourceKey);
      problems.push(Object.freeze({
        sourceFile: entry.sourceFile,
        sourceKey: entry.sourceKey,
        id: "TS2HX-SOURCE-NAMESPACE-COLLISION-001",
        message:
          `Sources ${sourceList} map to conflicting Haxe identities ${fqnList} and output paths ${outputList}. `
          + "Those paths share one portable, case-insensitive output key. "
          + "Rename one source so every TypeScript root has a unique Haxe module and output path.",
        outputRelativeFile: entry.outputRelativeFile
      }));
    }
  }

  const bySourceFile = new Map(entries.map((entry) => [entry.sourceKey, entry] as const));
  return Object.freeze({
    basePackageSegments: Object.freeze(basePackageSegments.slice()),
    basePackagePath,
    entries: Object.freeze(entries.slice()),
    bySourceFile,
    problems: Object.freeze(problems.sort(compareProblems))
  });
}
