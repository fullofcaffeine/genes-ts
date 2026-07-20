/**
 * Protects the source range that editors highlight for representative HXX
 * errors. Haxe 4 and Haxe 5 format diagnostics differently, so this harness
 * groups each reported location with its own message before checking the
 * diagnostic ID. That prevents a range from one error being mistaken for the
 * expected range merely because the expected ID appeared elsewhere.
 */
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

type ReportedRange = {
  readonly sourceFile: string;
  readonly line: number;
  readonly start: number;
  readonly end: number;
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
    name: "second child for exact element",
    define: "hxx_negative_element_multiple_children",
    diagnostic: "GTS-HXX-CHILD-003",
    sourceFile: "tests/genes-ts/snapshot/react/negative/Negative.hx",
    lineMarker:
      "final value = <ExactElementComponent><span>one</span><strong>two</strong></ExactElementComponent>;",
    rangeMarker: "<strong>two</strong>"
  },
  {
    name: "missing exact element child",
    define: "hxx_negative_element_missing_child",
    diagnostic: "GTS-HXX-CHILD-002",
    sourceFile: "tests/genes-ts/snapshot/react/negative/Negative.hx",
    lineMarker: "final value = <ExactElementComponent />;",
    rangeMarker: "ExactElementComponent"
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

/**
 * Returns only locations whose own diagnostic block contains `diagnostic`.
 *
 * Haxe 4 puts the ID on the location line. Haxe 5 may put it on a following
 * line after a source excerpt. Treating the text up to the next location as
 * one block supports both layouts without accidentally combining two errors.
 */
function rangesForDiagnostic(
  output: string,
  diagnostic: string
): ReadonlyArray<ReportedRange> {
  const normalizedOutput = normalized(output);
  const locationPattern =
    /^(?:\[ERROR\] )?(.*):(\d+): characters (\d+)-(\d+)(?: :.*)?$/gm;
  const matches = [...normalizedOutput.matchAll(locationPattern)];
  const ranges: Array<ReportedRange> = [];
  for (const [index, match] of matches.entries()) {
    const blockStart = match.index ?? 0;
    const blockEnd = matches[index + 1]?.index ?? normalizedOutput.length;
    const block = normalizedOutput.slice(blockStart, blockEnd);
    if (!block.includes(`[${diagnostic}]`)) {
      continue;
    }
    ranges.push({
      sourceFile: match[1],
      line: Number(match[2]),
      start: Number(match[3]),
      end: Number(match[4])
    });
  }
  return ranges;
}

/**
 * Exercises the parser boundary with two diagnostics before invoking Haxe.
 * The expected ID uses Haxe 5's multiline layout and must not inherit the
 * earlier Haxe 4-style location.
 */
function assertDiagnosticBlockGrouping(): void {
  const ranges = rangesForDiagnostic(
    [
      "Other.hx:1: characters 2-3 : [OTHER] Earlier diagnostic.",
      "[ERROR] Target.hx:4: characters 5-8",
      "",
      "[EXPECTED] Target diagnostic."
    ].join("\n"),
    "EXPECTED"
  );
  strictEqual(ranges.length, 1, "diagnostic blocks were combined");
  strictEqual(ranges[0].sourceFile, "Target.hx");
  strictEqual(ranges[0].line, 4);
  strictEqual(ranges[0].start, 5);
  strictEqual(ranges[0].end, 8);
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
  assertDiagnosticBlockGrouping();
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
    // Haxe 4 prints location and message on one line. Haxe 5's pretty formatter
    // prefixes the location with `[ERROR]` and renders the message below it.
    // Both expose the same source coordinates, which are the contract here.
    const ranges = rangesForDiagnostic(output, rangeCase.diagnostic);
    strictEqual(
      ranges.length,
      1,
      `${rangeCase.name} did not report exactly one precise ${rangeCase.diagnostic} range:\n${output}`
    );
    const reported = ranges[0];
    ok(
      reported.sourceFile.endsWith(normalized(rangeCase.sourceFile)),
      `${rangeCase.name} pointed at ${reported.sourceFile} instead of ${rangeCase.sourceFile}`
    );
    strictEqual(reported.line, expectedLine, `${rangeCase.name} line drifted`);
    strictEqual(reported.start, expectedStart, `${rangeCase.name} start drifted`);
    strictEqual(reported.end, expectedEnd, `${rangeCase.name} end drifted`);

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
