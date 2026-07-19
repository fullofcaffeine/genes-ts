import { ok, strictEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const negativeOutputDir = path.join(
  repoRoot,
  "tests/genes-ts/snapshot/react/out/negative"
);

type DiagnosticRangeCase = {
  readonly name: string;
  readonly define: string;
  readonly diagnostic: string;
  readonly sourceFile: string;
  readonly lineMarker: string;
  readonly rangeMarker: string;
  readonly extraArgs?: ReadonlyArray<string>;
};

const cases: ReadonlyArray<DiagnosticRangeCase> = [
  {
    name: "intrinsic tag",
    define: "hxx_negative_unknown_intrinsic",
    diagnostic: "GTS-HXX-TAG-001",
    sourceFile: "tests/genes-ts/snapshot/react/negative/Negative.hx",
    lineMarker: "final value = <dvi />;",
    rangeMarker: "dvi"
  },
  {
    name: "property value",
    define: "hxx_negative_component_wrong",
    diagnostic: "GTS-HXX-PROP-002",
    sourceFile: "tests/genes-ts/snapshot/react/negative/Negative.hx",
    lineMarker: "final value = <Button label={123} />;",
    rangeMarker: "123"
  },
  {
    name: "spread expression",
    define: "hxx_negative_spread_wrong",
    diagnostic: "GTS-HXX-SPREAD-002",
    sourceFile: "tests/genes-ts/snapshot/react/negative/Negative.hx",
    lineMarker: "final value = <Button {...invalid} />;",
    rangeMarker: "invalid"
  },
  {
    name: "nested child",
    define: "hxx_negative_wrong_child",
    diagnostic: "GTS-HXX-CHILD-003",
    sourceFile: "tests/genes-ts/snapshot/react/negative/Negative.hx",
    lineMarker: "final value = <TextChild><span>wrong</span></TextChild>;",
    rangeMarker: "<span>wrong</span>"
  },
  {
    name: "provider metadata",
    define: "hxx_negative_unknown_custom_intrinsic",
    diagnostic: "GTS-HXX-SCHEMA-010",
    sourceFile:
      "tests/genes-ts/snapshot/react/negative/DuplicateMetadataElements.hx",
    lineMarker: '@:genes.jsxAttributePrefix("qa-count-")',
    rangeMarker: "@:genes.jsxAttributePrefix",
    extraArgs: [
      "-D",
      "genes.react.jsx_intrinsic_providers=DuplicateMetadataElements"
    ]
  }
];

function normalized(value: string): string {
  return value.replaceAll("\\", "/");
}

function publishedFiles(directory: string): ReadonlyArray<string> {
  if (!existsSync(directory)) {
    return [];
  }
  const files: Array<string> = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...publishedFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

export function assertHxxDiagnosticRanges(): void {
  for (const rangeCase of cases) {
    const sourcePath = path.join(repoRoot, rangeCase.sourceFile);
    const sourceLines = readFileSync(sourcePath, "utf8").split(/\r?\n/);
    const lineIndex = sourceLines.findIndex((line) =>
      line.includes(rangeCase.lineMarker)
    );
    ok(lineIndex >= 0, `${rangeCase.name} fixture has no authored source line`);
    const markerIndex = sourceLines[lineIndex].indexOf(rangeCase.rangeMarker);
    ok(
      markerIndex >= 0,
      `${rangeCase.name} fixture has no authored range marker`
    );

    // Haxe's classic diagnostic format reports one-based start columns and an
    // exclusive end column. Derive both from authored source so line movement
    // or indentation changes do not turn the expected range into a magic
    // number.
    const expectedLine = lineIndex + 1;
    const expectedStart = markerIndex + 1;
    const expectedEnd = expectedStart + rangeCase.rangeMarker.length;

    rmSync(negativeOutputDir, { recursive: true, force: true });
    const result = spawnSync(
      "haxe",
      [
        "tests/genes-ts/snapshot/react/build-negative.hxml",
        "-D",
        rangeCase.define,
        ...(rangeCase.extraArgs ?? [])
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );
    strictEqual(
      result.error,
      undefined,
      `${rangeCase.name} failed to start Haxe`
    );
    strictEqual(
      result.status === 0,
      false,
      `${rangeCase.name} unexpectedly compiled`
    );
    const output = `${result.stdout}${result.stderr}`;
    ok(
      output.includes(`[${rangeCase.diagnostic}]`),
      `${rangeCase.name} did not report ${rangeCase.diagnostic}:\n${output}`
    );
    // Haxe 4 prints location and message on one line. Haxe 5's pretty formatter
    // prefixes the location with `[ERROR]` and renders the message below it.
    // Both expose the same source coordinates, which are the contract here.
    const match =
      /^(?:\[ERROR\] )?(.*):(\d+): characters (\d+)-(\d+)(?: :|$)/m.exec(
        output
      );
    ok(
      match !== null,
      `${rangeCase.name} did not report a precise range:\n${output}`
    );
    ok(
      normalized(match[1]).endsWith(normalized(rangeCase.sourceFile)),
      `${rangeCase.name} pointed at ${match[1]} instead of ${rangeCase.sourceFile}`
    );
    strictEqual(Number(match[2]), expectedLine, `${rangeCase.name} line drifted`);
    strictEqual(
      Number(match[3]),
      expectedStart,
      `${rangeCase.name} start drifted`
    );
    strictEqual(Number(match[4]), expectedEnd, `${rangeCase.name} end drifted`);

    const files = publishedFiles(negativeOutputDir);
    strictEqual(
      files.length,
      0,
      `${rangeCase.name} published output after a failed HXX check:\n${files.join("\n")}`
    );
  }

  rmSync(negativeOutputDir, { recursive: true, force: true });
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === __filename) {
  assertHxxDiagnosticRanges();
}
