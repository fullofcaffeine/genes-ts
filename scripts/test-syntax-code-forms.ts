import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hashTree,
  OwnedHaxeCompilerServer,
  selectedHaxeCompiler
} from "./compiler-server-lifecycle.js";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

/**
 * Proves that Genes prints raw-code calls itself, with the bytes that Haxe's
 * own JavaScript printer produced.
 *
 * Why: Genes used to hand three raw-code forms to Haxe's stock printer:
 * `js.Syntax.code("text")` without value arguments, most `__js__(...)` calls,
 * and `__resources__()`. A module printed that way cannot be proved unchanged
 * by incremental generation, so it was printed again after every edit.
 *
 * What this gate checks, in both output profiles:
 * - the emitted `ZeroArgument`, `LegacyJs` and `LegacyJsStatements` modules
 *   equal the files in `tests/syntax-code-forms/expected`, which Haxe's
 *   printer produced before Genes printed these forms (see the fixture
 *   README);
 * - `LegacyJsStatements` holds the `__js__` values that are not plain
 *   expressions (`throw`, loops, `switch`, `try`, blocks, functions). Genes
 *   leaves those calls to Haxe's printer, so that module, and only that
 *   module, is in the printer-use report;
 * - the `haxe.Resource` table for zero and for one resource equals text that
 *   was written by hand from the Haxe compiler's source;
 * - the `__js__` values that Genes prints differently have the reviewed text,
 *   among them a `try` value and, in the TypeScript profile, an optional field
 *   that is read as `null`;
 * - `genes.HaxePrinterUse` reports no other module, except `haxe.Resource`
 *   when the build embeds three resources;
 * - the programs run and print the same transcript;
 * - every invalid call fails with Haxe's message and position and publishes
 *   no output;
 * - the `__js__` deprecation warning is reported once for each call;
 * - a warm compilation server gives the same tree and the same report.
 */
const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, "../..");
const fixture = "tests/syntax-code-forms";
const fixtureRoot = path.join(repoRoot, fixture);
const outRoot = path.join(fixtureRoot, "out");

type Profile = "classic" | "ts";
type Variant = {
  readonly name: "none" | "one" | "three";
  /** `[file, resource name]` pairs, in command-line order. */
  readonly resources: ReadonlyArray<readonly [string, string]>;
};

// The name holds a quote, a non-ASCII letter, a backslash, and a tab, so the
// string printer must escape it exactly as Haxe does. The tab is not the last
// character, because a compilation server trims each argument it receives.
const oddResourceName = 'odd "name" é\\\tend';
const variants: ReadonlyArray<Variant> = [
  { name: "none", resources: [] },
  { name: "one", resources: [["first.txt", oddResourceName]] },
  {
    name: "three",
    resources: [
      ["first.txt", "first"],
      ["second.txt", "second"],
      ["third.txt", "third"]
    ]
  }
];

const zeroTranscript = "zero:" + [
  "2",
  "1",
  '[{"a":1},{},{}]',
  '{"x":7}',
  "{{x}} {} }{ {0} { 0 } {1e3} {0x} {_1} {a}}",
  "multiline",
  "4",
  "12",
  "1",
  "true",
  "instance"
].join("|");
const legacyTranscript = "legacy:" + [
  "Infinity",
  "2",
  "7",
  "8",
  "42",
  "TEXT",
  "14",
  "2",
  "21",
  '[{"a":3},{}]',
  "4"
].join("|");
// The last entry is `isMissing({})`. The TypeScript profile reads a missing
// optional field as `null`, so `=== undefined` is false there. See the
// "Reviewed differences" in the fixture README.
const legacyValuesTranscripts: Record<Profile, string> = {
  classic: "legacy-values:11|21|2|3|false|true",
  ts: "legacy-values:11|21|2|3|false|false"
};
// One entry for each call of `LegacyJsStatements.run`: a plain `throw`, a
// throwing branch (twice), a `switch` with a throwing default (twice), `??`
// with a throwing right side (twice), `try` with a catch of everything
// (twice), `try` with a typed catch (no exception, caught, rethrown), `while`,
// `do`/`while`, `for`, a block, `var`, and two function expressions.
const legacyStatementsTranscript = "legacy-statements:" + [
  "thrown",
  "5",
  "thrown",
  "21",
  "thrown",
  "6",
  "thrown",
  "5",
  "41",
  "8",
  "5",
  "thrown",
  "3",
  "3",
  "6",
  "9",
  "5",
  "23"
].join("|");
// The module whose `__js__` calls Genes leaves to Haxe's printer on purpose.
const declinedModule = "syntaxcodeforms.LegacyJsStatements";
// Text of `LegacyJsValues` that a reviewer accepted, for each profile.
const reviewedValueText: Record<Profile, ReadonlyArray<string>> = {
  classic: [
    "return ((flag) ? 10 : 20) + 1;",
    "= [a, b].length;",
    '= {"size": a}.size;',
    "return options.limit === undefined;"
  ],
  ts: [
    "return ((flag) ? 10 : 20) + 1;",
    "= [a, b].length;",
    '= {"size": a}.size;',
    "return (options.limit ?? null) === undefined;"
  ]
};
const resourceTranscripts: Record<Variant["name"], string> = {
  none: "resources:",
  one: `resources:${oddResourceName}=first resource`,
  three: "resources:first=first resource|second=second resource"
    + "|third=third resource"
};

// Written by hand from `genjs.ml` (`__resources__`) and `Codegen.bytes_serialize`
// in the Haxe compiler: `[{ name : "<escaped>", data : "<base64 without =>"}]`.
// "first resource\n" is `Zmlyc3QgcmVzb3VyY2UK` in base64.
const resourceTables: Record<"none" | "one", string> = {
  none: ";Resource.content = []",
  one: ';Resource.content = [{ name : "odd \\"name\\" é\\\\\\tend", '
    + 'data : "Zmlyc3QgcmVzb3VyY2UK"}]'
};

function outputDirectory(profile: Profile, variant: Variant["name"]): string {
  return path.join(outRoot, `${profile}-${variant}`);
}

function reportFile(profile: Profile, variant: Variant["name"]): string {
  return path.join(outRoot, `${profile}-${variant}.printer.json`);
}

function genesArguments(
  profile: Profile,
  variant: Variant,
  output: string,
  report: string
): string[] {
  return [
    "-lib", "genes-ts",
    "-cp", `${fixture}/src`,
    "--main", "syntaxcodeforms.Main",
    "-js", path.join(output, profile === "ts" ? "index.ts" : "index.js"),
    ...(profile === "ts" ? ["-D", "genes.ts"] : []),
    "-D", "no-deprecation-warnings",
    "-D", "js-es=6",
    "-dce", "full",
    "-debug",
    "--macro", `genes.HaxePrinterUse.report('${report}')`,
    ...variant.resources.flatMap(([file, name]) => [
      "-resource",
      `${fixture}/resources/${file}@${name}`
    ])
  ];
}

function haxe(args: ReadonlyArray<string>): {
  readonly code: number | null;
  readonly output: string;
} {
  const result = spawnSync("haxe", [...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function printerReport(file: string): {
  readonly haxePrinterModules: number;
  readonly haxePrinterModuleNames: ReadonlyArray<string>;
} {
  const parsed: unknown = JSON.parse(read(file));
  ok(
    typeof parsed === "object" && parsed !== null,
    `${file} must hold a JSON object`
  );
  const record = parsed as Record<string, unknown>;
  strictEqual(record.format, "genes.haxe-printer-use/v1");
  ok(typeof record.modules === "number" && record.modules > 0);
  const count = record.haxePrinterModules;
  const names = record.haxePrinterModuleNames;
  ok(typeof count === "number", `${file} must count the modules`);
  ok(
    Array.isArray(names) && names.every((name) => typeof name === "string"),
    `${file} must name the modules`
  );
  return {
    haxePrinterModules: count,
    haxePrinterModuleNames: names as string[]
  };
}

function resourceTable(profile: Profile, variant: Variant["name"]): string {
  const extension = profile === "ts" ? "ts" : "js";
  const line = read(
    path.join(outputDirectory(profile, variant), `haxe/Resource.${extension}`)
  ).split("\n").find((candidate) => candidate.includes("Resource.content ="));
  ok(line !== undefined, `${profile} ${variant} emits the resource table`);
  return line;
}

function transcript(file: string): string {
  return execFileSync(process.execPath, [file], {
    cwd: repoRoot,
    encoding: "utf8"
  }).replace(/\n$/, "");
}

function expectedTranscript(
  profile: Profile,
  variant: Variant["name"]
): string {
  return [
    zeroTranscript,
    legacyTranscript,
    legacyValuesTranscripts[profile],
    legacyStatementsTranscript,
    resourceTranscripts[variant]
  ].join("\n");
}

rmSync(outRoot, { recursive: true, force: true });

// 1. Cold builds: bytes, printer report, and the resource table.
for (const profile of ["classic", "ts"] as const) {
  const extension = profile === "ts" ? "ts" : "js";
  for (const variant of variants) {
    const output = outputDirectory(profile, variant.name);
    const report = reportFile(profile, variant.name);
    const build = haxe(genesArguments(profile, variant, output, report));
    strictEqual(
      build.code,
      0,
      `${profile} ${variant.name} build failed\n${build.output}`
    );

    for (const module of ["ZeroArgument", "LegacyJs", "LegacyJsStatements"]) {
      strictEqual(
        read(path.join(output, `syntaxcodeforms/${module}.${extension}`)),
        read(path.join(
          fixtureRoot,
          `expected/${profile}/${module}.${extension}`
        )),
        `${profile} ${variant.name}: ${module} differs from the text that `
        + "Haxe's printer produced"
      );
    }

    const use = printerReport(report);
    if (variant.name === "three") {
      // Haxe alone knows the order of several resources, so this one module
      // stays on Haxe's printer. Every entry must still be present.
      deepStrictEqual(
        use.haxePrinterModuleNames,
        ["haxe.Resource", declinedModule]
      );
      strictEqual(use.haxePrinterModules, 2);
      const table = resourceTable(profile, "three");
      for (const [name, data] of [
        ["first", "Zmlyc3QgcmVzb3VyY2UK"],
        ["second", "c2Vjb25kIHJlc291cmNlCg"],
        ["third", "dGhpcmQgcmVzb3VyY2UK"]
      ]) {
        ok(
          table.includes(`{ name : "${name}", data : "${data}"}`),
          `${profile}: the resource table lost ${name}`
        );
      }
    } else {
      deepStrictEqual(
        use.haxePrinterModuleNames,
        [declinedModule],
        `${profile} ${variant.name}: wrong modules on Haxe's printer`
      );
      strictEqual(use.haxePrinterModules, 1);
      strictEqual(
        resourceTable(profile, variant.name),
        resourceTables[variant.name]
      );
    }

    const values = read(
      path.join(output, `syntaxcodeforms/LegacyJsValues.${extension}`)
    );
    for (const reviewed of reviewedValueText[profile]) {
      ok(
        values.includes(reviewed),
        `${profile} ${variant.name}: LegacyJsValues lost ${reviewed}`
      );
    }
  }
}

// 2. Runtime: classic directly, TypeScript after the compiler matrix.
for (const variant of variants) {
  strictEqual(
    transcript(path.join(outputDirectory("classic", variant.name), "index.js")),
    expectedTranscript("classic", variant.name),
    `classic ${variant.name} transcript`
  );
}
runGeneratedTypeScriptMatrix(`${fixture}/tsconfig.json`);
strictEqual(
  transcript(path.join(outRoot, "ts-dist/index.js")),
  expectedTranscript("ts", "none"),
  "TypeScript transcript"
);

// 3. Invalid calls: Haxe's message and position, and no published output.
const invalidCases: ReadonlyArray<{
  readonly name: string;
  readonly line: number;
  readonly characters: string;
  readonly message: string;
  /**
   * True when Haxe's printer raises the error. Haxe then ends the build at
   * once, as it always did for these calls, and Genes cannot remove its
   * private staging folder. Public output must still be absent.
   */
  readonly raisedByHaxe?: true;
}> = [
  {
    name: "template",
    line: 24,
    characters: "20-28",
    message: "The `code` argument for js.Syntax.code must be a string constant"
  },
  {
    name: "template_with_value",
    line: 26,
    characters: "20-28",
    message: "The `code` argument for js.Syntax.code must be a string constant"
  },
  {
    name: "placeholder",
    line: 28,
    characters: "35-40",
    message: "Out-of-bounds special parameter: 0"
  },
  {
    name: "hexadecimal_placeholder",
    line: 30,
    characters: "35-42",
    message: "Out-of-bounds special parameter: 0x1"
  },
  {
    name: "negative_placeholder",
    line: 32,
    characters: "35-41",
    message: "Out-of-bounds special parameter: -1"
  },
  {
    name: "oversized_placeholder",
    line: 34,
    characters: "35-62",
    message: "Out-of-bounds special parameter: 12345678901234567890123"
  },
  {
    name: "legacy_template",
    line: 36,
    characters: "20-28",
    message: "The `code` argument for js.Syntax.code must be a string constant"
  },
  {
    name: "legacy_empty",
    line: 38,
    characters: "13-19",
    message: "Unknown js.Syntax method `code` with 0 arguments"
  },
  {
    name: "legacy_placeholder",
    line: 40,
    characters: "35-40",
    message: "Out-of-bounds special parameter: 1"
  },
  {
    name: "legacy_return_value",
    line: 42,
    characters: "32-38",
    message: "This expression cannot be compiled to Javascript",
    raisedByHaxe: true
  },
  {
    name: "legacy_break_value",
    line: 45,
    characters: "34-39",
    message: "This expression cannot be compiled to Javascript",
    raisedByHaxe: true
  },
  {
    name: "legacy_continue_value",
    line: 48,
    characters: "34-42",
    message: "This expression cannot be compiled to Javascript",
    raisedByHaxe: true
  }
];
for (const profile of ["classic", "ts"] as const) {
  for (const invalid of invalidCases) {
    const output = path.join(outRoot, `invalid-${profile}-${invalid.name}`);
    const build = haxe([
      "-lib", "genes-ts",
      "-cp", `${fixture}/invalid`,
      "--main", "syntaxcodeinvalid.Main",
      "-js", path.join(output, profile === "ts" ? "index.ts" : "index.js"),
      ...(profile === "ts" ? ["-D", "genes.ts"] : []),
      "-D", "no-deprecation-warnings",
      "-D", "js-es=6",
      "-dce", "full",
      "-D", `syntax_code_invalid=${invalid.name}`
    ]);
    ok(
      build.code !== 0,
      `${profile} ${invalid.name} must fail\n${build.output}`
    );
    const diagnostic = `${fixture}/invalid/syntaxcodeinvalid/Main.hx:`
      + `${invalid.line}: characters ${invalid.characters} : `
      + invalid.message;
    ok(
      build.output.includes(diagnostic),
      `${profile} ${invalid.name}: expected\n${diagnostic}\ngot\n`
      + build.output
    );
    const published = invalid.raisedByHaxe === true
      ? path.join(output, profile === "ts" ? "index.ts" : "index.js")
      : output;
    ok(
      !existsSync(published),
      `${profile} ${invalid.name} published output after its diagnostic`
    );
  }
}

// 4. The deprecation warning: once for each `__js__` call that is not a
// single identifier, with Haxe's text.
const legacySource = ["LegacyJs", "LegacyJsValues", "LegacyJsStatements"]
  .map((module) =>
    read(path.join(fixtureRoot, `src/syntaxcodeforms/${module}.hx`)))
  .join("");
const legacyCalls = legacySource.split("untyped __js__(").length - 1;
const identifierCalls = legacySource.split('untyped __js__("Infinity")').length
  - 1;
strictEqual(identifierCalls, 1, "the fixture has one single-identifier call");
for (const profile of ["classic", "ts"] as const) {
  const output = path.join(outRoot, `warnings-${profile}`);
  const args = genesArguments(
    profile,
    variants[0],
    output,
    path.join(outRoot, `warnings-${profile}.printer.json`)
  ).filter((argument, index, all) =>
    argument !== "no-deprecation-warnings"
    && !(argument === "-D" && all[index + 1] === "no-deprecation-warnings"));
  const build = haxe(args);
  strictEqual(build.code, 0, `${profile} warning build failed\n${build.output}`);
  const warnings = build.output.split("\n").filter((line) => line.includes(
    "Warning : (WDeprecated) __js__ is deprecated, use js.Syntax.code instead"
  ));
  strictEqual(
    warnings.length,
    legacyCalls - identifierCalls,
    `${profile}: one warning for each __js__ call\n${build.output}`
  );
  strictEqual(
    new Set(warnings).size,
    warnings.length,
    `${profile}: a __js__ call was reported twice`
  );
}

// 5. A warm compilation server: same tree, and a report for each request.
const server = await OwnedHaxeCompilerServer.start(
  repoRoot,
  selectedHaxeCompiler(repoRoot)
);
server.installSignalCleanup();
try {
  for (const profile of ["classic", "ts"] as const) {
    for (const request of ["first", "second"]) {
      const output = path.join(outRoot, `warm-${profile}`);
      const report = path.join(outRoot, `warm-${profile}.printer.json`);
      rmSync(report, { force: true });
      const warm = await server.compile(
        genesArguments(profile, variants[1], output, report),
        `Warm ${profile} raw-code build (${request} request)`,
        60_000
      );
      ok(
        warm.code === 0,
        `Warm ${profile} build failed\n${warm.stdout}\n${warm.stderr}`
      );
      deepStrictEqual(
        hashTree(output),
        hashTree(outputDirectory(profile, "one")),
        `warm (${request} request) and cold ${profile} output differ`
      );
      deepStrictEqual(
        printerReport(report).haxePrinterModuleNames,
        [declinedModule],
        `warm ${profile} (${request} request): wrong modules on Haxe's printer`
      );
    }
  }
} finally {
  await server.stop();
}

process.stdout.write(
  "syntax-code-forms:ok (2 profiles × 3 resource counts, "
  + `${invalidCases.length} invalid calls, warnings, warm server)\n`
);
