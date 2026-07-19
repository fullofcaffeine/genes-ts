import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync, spawnSync, type ExecFileSyncOptions } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertNoUnsafeTypes } from "./typing-policy.js";
import { runGeneratedTypeScriptMatrix, runTypeScript } from "./toolchains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function rmrf(relPath: string): void {
  // macOS can briefly report ENOTEMPTY while a recursive deletion is
  // finishing. Node's bounded retry keeps generated-fixture cleanup reliable
  // without hiding a persistent filesystem error.
  rmSync(path.join(repoRoot, relPath), {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50
  });
}

function run(cmd: string, args: ReadonlyArray<string>, opts: ExecFileSyncOptions = {}): void {
  execFileSync(cmd, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...opts
  });
}

function capture(cmd: string, args: ReadonlyArray<string>): string {
  return execFileSync(cmd, [...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

function parseTranscript(output: string): unknown {
  const line = output
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0)
    .at(-1);
  if (line === undefined) {
    throw new Error("JSX differential fixture produced no transcript");
  }
  return JSON.parse(line) as unknown;
}

function copyTsxFixtures(intoRelDir: string): void {
  const fixturesDir = path.join(repoRoot, "tests/genes-ts/snapshot/react/fixtures");
  const destDir = path.join(repoRoot, intoRelDir);

  // Copy required local TSX files into the generated source dir so `tsc`
  // can resolve local TS/TSX imports from genes output.
  function copyDir(src: string): void {
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(destDir, path.relative(fixturesDir, srcPath));
      if (entry.isDirectory()) {
        copyDir(srcPath);
      } else if (entry.isFile()) {
        mkdirSync(path.dirname(destPath), { recursive: true });
        cpSync(srcPath, destPath);
      }
    }
  }

  copyDir(fixturesDir);
}

function assertNoGeneratedDomSupportGraph(generatedRelDir: string): void {
  ok(!existsSync(path.join(repoRoot, generatedRelDir, "js/html")),
    `${generatedRelDir} published browser typedef modules loaded only through ambient externs`);
}

function assertHaxeHxxNegatives(): void {
  const negativeSource = readFileSync(
    path.join(repoRoot, "tests/genes-ts/snapshot/react/negative/Negative.hx"),
    "utf8"
  ).split(/\r?\n/);
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["hxx_negative_unknown_intrinsic", "GTS-HXX-TAG-001"],
    ["hxx_negative_unknown_custom_intrinsic", "GTS-HXX-TAG-001"],
    ["hxx_negative_intrinsic_prop", "GTS-HXX-PROP-001"],
    ["hxx_negative_intrinsic_prop_type", "GTS-HXX-PROP-002"],
    ["hxx_negative_intrinsic_null", "GTS-HXX-PROP-002"],
    ["hxx_negative_handler", "GTS-HXX-PROP-002"],
    ["hxx_negative_component_missing", "GTS-HXX-PROP-004"],
    ["hxx_negative_component_extra", "GTS-HXX-PROP-001"],
    ["hxx_negative_component_wrong", "GTS-HXX-PROP-002"],
    ["hxx_negative_component_duplicate", "GTS-HXX-PROP-003"],
    ["hxx_negative_unexpected_child", "GTS-HXX-CHILD-001"],
    ["hxx_negative_wrong_child", "GTS-HXX-CHILD-003"],
    ["hxx_negative_missing_child", "GTS-HXX-CHILD-002"],
    ["hxx_negative_scalar_for_array_child", "GTS-HXX-CHILD-003"],
    ["hxx_negative_unsafe_array_child", "GTS-HXX-TYPE-001"],
    ["hxx_negative_named_and_nested_child", "GTS-HXX-CHILD-004"],
    ["hxx_negative_required_spread_and_nested_child", "GTS-HXX-CHILD-004"],
    ["hxx_negative_optional_spread_missing_child", "GTS-HXX-CHILD-002"],
    ["hxx_negative_intrinsic_child", "GTS-HXX-CHILD-003"],
    ["hxx_negative_spread_non_object", "GTS-HXX-SPREAD-001"],
    ["hxx_negative_spread_extra", "GTS-HXX-SPREAD-003"],
    ["hxx_negative_spread_wrong", "GTS-HXX-SPREAD-002"],
    ["hxx_negative_spread_optional_required", "GTS-HXX-PROP-004"],
    ["hxx_negative_non_component", "GTS-HXX-TAG-002"],
    ["hxx_negative_component_return", "GTS-HXX-TAG-003"],
    ["hxx_negative_unsafe_key", "GTS-HXX-PROP-002"],
    ["hxx_negative_event_target", "GTS-HXX-PROP-002"],
    ["hxx_negative_inherited_event_target", "GTS-HXX-PROP-002"],
    ["hxx_negative_anchor_event_target", "GTS-HXX-PROP-002"],
    ["hxx_negative_optional_callback", "GTS-HXX-PROP-002"],
    ["hxx_negative_inherited_missing", "GTS-HXX-PROP-004"],
    ["hxx_negative_nested_unsafe", "GTS-HXX-TYPE-001"],
    ["hxx_negative_any_value", "GTS-HXX-TYPE-001"],
    ["hxx_negative_nested_any", "GTS-HXX-TYPE-001"],
    ["hxx_negative_nullable_prop", "GTS-HXX-PROP-002"],
    ["hxx_negative_nullable_payload", "GTS-HXX-PROP-002"],
    ["hxx_negative_required_undefinable_missing", "GTS-HXX-PROP-004"],
    ["hxx_negative_null_to_undefinable", "GTS-HXX-PROP-002"]
  ];
  for (const [define, diagnostic] of cases) {
    const branchLine = negativeSource.findIndex((line) =>
      line.includes(`#if ${define}`) || line.includes(`#elseif ${define}`)
    );
    ok(branchLine >= 0, `${define} has no source branch`);
    const valueOffset = negativeSource
      .slice(branchLine + 1)
      .findIndex((line) => line.includes("final value ="));
    ok(valueOffset >= 0, `${define} has no HXX value expression`);
    const valueLine = branchLine + valueOffset + 2;
    const result = spawnSync(
      "haxe",
      ["tests/genes-ts/snapshot/react/build-negative.hxml", "-D", define],
      { cwd: repoRoot, encoding: "utf8" }
    );
    strictEqual(result.status === 0, false, `${define} unexpectedly compiled`);
    const output = `${result.stdout}${result.stderr}`;
    ok(output.includes(`[${diagnostic}]`), `${define} did not report ${diagnostic}:\n${output}`);
    ok(
      output.includes(`Negative.hx:${valueLine}:`),
      `${define} did not retain the authored HXX line ${valueLine}:\n${output}`
    );
  }

  const duplicateProvider = readFileSync(
    path.join(
      repoRoot,
      "tests/genes-ts/snapshot/react/negative/DuplicatePrefixElements.hx"
    ),
    "utf8"
  ).split(/\r?\n/);
  const duplicateLine = duplicateProvider.findIndex((line, index) =>
    index > 0
    && line.includes('@:genes.jsxAttributePrefix("qa-")')
    && duplicateProvider.slice(0, index).some((previous) =>
      previous.includes('@:genes.jsxAttributePrefix("qa-")'))
  ) + 1;
  ok(duplicateLine > 0, "duplicate-prefix fixture has no second declaration");
  const duplicateResult = spawnSync(
    "haxe",
    [
      "tests/genes-ts/snapshot/react/build-negative.hxml",
      "-D",
      "hxx_negative_duplicate_prefix",
      "-D",
      "genes.react.jsx_intrinsic_providers=DuplicatePrefixElements"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  strictEqual(duplicateResult.status === 0, false);
  const duplicateOutput = `${duplicateResult.stdout}${duplicateResult.stderr}`;
  ok(duplicateOutput.includes("[GTS-HXX-SCHEMA-007]"));
  ok(duplicateOutput.includes(`DuplicatePrefixElements.hx:${duplicateLine}:`));

  const weakProvider = readFileSync(
    path.join(
      repoRoot,
      "tests/genes-ts/snapshot/react/negative/WeakPrefixElements.hx"
    ),
    "utf8"
  ).split(/\r?\n/);
  const weakPrefixLine = weakProvider.findIndex((line) =>
    line.includes('@:genes.jsxAttributePrefix("weak-")')
  ) + 1;
  ok(weakPrefixLine > 0, "weak-prefix fixture has no prefix declaration");
  const weakPrefixResult = spawnSync(
    "haxe",
    [
      "tests/genes-ts/snapshot/react/build-negative.hxml",
      "-D",
      "hxx_negative_unknown_custom_intrinsic",
      "-D",
      "genes.react.jsx_intrinsic_providers=WeakPrefixElements"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  strictEqual(weakPrefixResult.status === 0, false);
  const weakPrefixOutput = `${weakPrefixResult.stdout}${weakPrefixResult.stderr}`;
  ok(weakPrefixOutput.includes("[GTS-HXX-SCHEMA-008]"));
  ok(weakPrefixOutput.includes(`WeakPrefixElements.hx:${weakPrefixLine}:`));

  for (const [define, fieldSource] of [
    ["hxx_negative_schema_unsafe", "final value: Dynamic;"],
    ["hxx_negative_recursive_unsafe", "final items: Array<RecursiveUnsafeItem>;"]
  ] as const) {
    const fieldLine = negativeSource.findIndex((line) =>
      line.includes(fieldSource)
    ) + 1;
    ok(fieldLine > 0, `${define} has no weak schema field`);
    const result = spawnSync(
      "haxe",
      ["tests/genes-ts/snapshot/react/build-negative.hxml", "-D", define],
      { cwd: repoRoot, encoding: "utf8" }
    );
    strictEqual(result.status === 0, false);
    const output = `${result.stdout}${result.stderr}`;
    ok(output.includes("[GTS-HXX-SCHEMA-008]"));
    ok(output.includes(`Negative.hx:${fieldLine}:`));
  }

  const overlapProvider = readFileSync(
    path.join(
      repoRoot,
      "tests/genes-ts/snapshot/react/negative/OverlappingPrefixElements.hx"
    ),
    "utf8"
  ).split(/\r?\n/);
  const overlapLine = overlapProvider.findIndex((line) =>
    line.includes('@:genes.jsxAttributePrefix("qa-count-")')
  ) + 1;
  ok(overlapLine > 0, "overlap fixture has no specific prefix declaration");
  const overlapResult = spawnSync(
    "haxe",
    [
      "tests/genes-ts/snapshot/react/build-negative.hxml",
      "-D",
      "hxx_negative_unknown_custom_intrinsic",
      "-D",
      "genes.react.jsx_intrinsic_providers=OverlappingPrefixElements"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  strictEqual(overlapResult.status === 0, false);
  const overlapOutput = `${overlapResult.stdout}${overlapResult.stderr}`;
  ok(overlapOutput.includes("[GTS-HXX-SCHEMA-009]"));
  ok(overlapOutput.includes(`OverlappingPrefixElements.hx:${overlapLine}:`));

  const duplicateMetadataProvider = readFileSync(
    path.join(
      repoRoot,
      "tests/genes-ts/snapshot/react/negative/DuplicateMetadataElements.hx"
    ),
    "utf8"
  ).split(/\r?\n/);
  const duplicateMetadataLine = duplicateMetadataProvider.findIndex((line) =>
    line.includes('@:genes.jsxAttributePrefix("qa-count-")')
  ) + 1;
  ok(duplicateMetadataLine > 0,
    "duplicate-metadata fixture has no second annotation");
  const duplicateMetadataResult = spawnSync(
    "haxe",
    [
      "tests/genes-ts/snapshot/react/build-negative.hxml",
      "-D",
      "hxx_negative_unknown_custom_intrinsic",
      "-D",
      "genes.react.jsx_intrinsic_providers=DuplicateMetadataElements"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  strictEqual(duplicateMetadataResult.status === 0, false);
  const duplicateMetadataOutput =
    `${duplicateMetadataResult.stdout}${duplicateMetadataResult.stderr}`;
  ok(duplicateMetadataOutput.includes("[GTS-HXX-SCHEMA-010]"));
  ok(duplicateMetadataOutput.includes(
    `DuplicateMetadataElements.hx:${duplicateMetadataLine}:`
  ));

  const tsOptionalBranch = negativeSource.findIndex((line) =>
    line.includes("#elseif hxx_negative_ts_optional_null")
  );
  const tsOptionalValueOffset = negativeSource
    .slice(tsOptionalBranch + 1)
    .findIndex((line) => line.includes("final value ="));
  const tsOptionalValueLine = tsOptionalBranch + tsOptionalValueOffset + 2;
  ok(tsOptionalBranch >= 0 && tsOptionalValueOffset >= 0,
    "per-field ts.optional fixture has no HXX value");
  const tsOptionalNull = spawnSync(
    "haxe",
    [
      "tests/genes-ts/snapshot/react/build-negative.hxml",
      "-D",
      "hxx_negative_ts_optional_null",
      "-D",
      "genes.react.jsx_intrinsic_providers=TsOptionalElements"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  strictEqual(tsOptionalNull.status === 0, false,
    "@:ts.optional custom intrinsic unexpectedly accepted Haxe null");
  const tsOptionalNullOutput =
    `${tsOptionalNull.stdout}${tsOptionalNull.stderr}`;
  ok(tsOptionalNullOutput.includes("[GTS-HXX-PROP-002]"));
  ok(tsOptionalNullOutput.includes(`Negative.hx:${tsOptionalValueLine}:`));

  const tsOptionalUndefined = spawnSync(
    "haxe",
    [
      "tests/genes-ts/snapshot/react/build-negative.hxml",
      "-D",
      "hxx_positive_ts_optional_undefined",
      "-D",
      "genes.react.jsx_intrinsic_providers=TsOptionalElements"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  strictEqual(
    tsOptionalUndefined.status,
    0,
    `@:ts.optional should accept an explicit Undefinable value:\n${tsOptionalUndefined.stdout}${tsOptionalUndefined.stderr}`
  );

  const tsOptionalSpread = spawnSync(
    "haxe",
    [
      "tests/genes-ts/snapshot/react/build-negative.hxml",
      "-D",
      "hxx_positive_ts_optional_spread",
      "-D",
      "genes.react.jsx_intrinsic_providers=TsOptionalElements"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  strictEqual(
    tsOptionalSpread.status,
    0,
    `@:ts.optional spread fields should keep their present-value type:\n${tsOptionalSpread.stdout}${tsOptionalSpread.stderr}`
  );

  const ignoredCallbackResult = spawnSync(
    "haxe",
    [
      "tests/genes-ts/snapshot/react/build-negative.hxml",
      "-D",
      "hxx_positive_ignored_callback_result"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  strictEqual(
    ignoredCallbackResult.status,
    0,
    `A Void event contract should ignore the callback result:\n${ignoredCallbackResult.stdout}${ignoredCallbackResult.stderr}`
  );

  const recursiveProps = spawnSync(
    "haxe",
    [
      "tests/genes-ts/snapshot/react/build-negative.hxml",
      "-D",
      "hxx_positive_recursive_props"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  strictEqual(
    recursiveProps.status,
    0,
    `A closed recursive property contract should compile:\n${recursiveProps.stdout}${recursiveProps.stderr}`
  );

  const nullableProp = spawnSync(
    "haxe",
    [
      "tests/genes-ts/snapshot/react/build-negative.hxml",
      "-D",
      "hxx_positive_nullable_prop"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  strictEqual(
    nullableProp.status,
    0,
    `A nullable value should fill a nullable property contract:\n${nullableProp.stdout}${nullableProp.stderr}`
  );

  for (const [define, description] of [
    ["hxx_positive_plain_to_nullable", "a concrete value should fill a nullable contract"],
    ["hxx_positive_literal_null", "a literal null should fill a nullable contract"],
    ["hxx_positive_undefinable_prop", "a supplied Undefinable value should fill an explicit Undefinable contract"],
    ["hxx_positive_optional_nullable_spread", "an optional nullable spread should preserve its nullable payload"],
    ["hxx_positive_optional_trailing_callback", "a safe trailing optional callback parameter should be accepted"]
  ] as const) {
    const result = spawnSync(
      "haxe",
      ["tests/genes-ts/snapshot/react/build-negative.hxml", "-D", define],
      { cwd: repoRoot, encoding: "utf8" }
    );
    strictEqual(
      result.status,
      0,
      `${description}:\n${result.stdout}${result.stderr}`
    );
  }
}

const authoredHxxSource = readFileSync(
  path.join(repoRoot, "tests/genes-ts/snapshot/react/src/Main.hx"),
  "utf8"
);
ok(authoredHxxSource.includes('<GenericInt value={7} render={value -> \'n:$value\'} />'));
ok(authoredHxxSource.includes("<GenericValue"));
strictEqual(/<\s+GenericInt/.test(authoredHxxSource), false);

rmrf("tests/genes-ts/snapshot/react/out/tsx");
rmrf("tests/genes-ts/snapshot/react/out/tsx-jsx-source");
rmrf("tests/genes-ts/snapshot/react/out/tsx-classic");
rmrf("tests/genes-ts/snapshot/react/out/ts");
rmrf("tests/genes-ts/snapshot/react/out/dual-tsx");
rmrf("tests/genes-ts/snapshot/react/out/dual-classic");
rmrf("tests/genes-ts/snapshot/react/out/dual-jsx");
rmrf("tests/genes-ts/snapshot/react/out/dual-jsx-dist");
rmrf("tests/genes-ts/snapshot/react/out/dual-jsx-ts-disabled");
rmrf("tests/genes-ts/snapshot/react/out/dual-disabled");
rmrf("tests/genes-ts/snapshot/react/out/negative");
rmrf("tests/genes-ts/snapshot/react/out/custom-provider");
rmrf("tests/genes-ts/snapshot/react/out/packed-consumer");
rmrf("tests/genes-ts/snapshot/react/out/context-first-dom");

assertHaxeHxxNegatives();
ok(!existsSync(path.join(
  repoRoot,
  "tests/genes-ts/snapshot/react/out/negative/js/html"
)), "semantic-only React schemas do not publish unrelated DOM support modules");

// Exercise the release artifact, not the checkout classpath. This proves every
// checker/schema source required by HXX is present in the Haxelib ZIP and can
// produce strict typed TSX for a clean consumer.
try {
  run("yarn", ["submit:zip"]);
  mkdirSync(path.join(
    repoRoot,
    "tests/genes-ts/snapshot/react/out/packed-consumer"
  ), { recursive: true });
  run("unzip", [
    "-q",
    "-o",
    "submit.zip",
    "-d",
    "tests/genes-ts/snapshot/react/out/packed-consumer/package"
  ]);
  for (const packagedSource of [
    "src/genes/JsxTypeChecker.hx",
    "src/genes/react/IntrinsicElements.hx",
    "src/genes/react/ReactProps.hx",
    "src/genes/react/internal/JsxContext.hx"
  ]) {
    ok(existsSync(path.join(
      repoRoot,
      "tests/genes-ts/snapshot/react/out/packed-consumer/package",
      packagedSource
    )), `Haxelib ZIP omitted ${packagedSource}`);
  }
  run("haxe", ["tests/genes-ts/snapshot/react/build-packed-consumer.hxml"]);
  assertNoUnsafeTypes({
    repoRoot,
    generatedDir: "tests/genes-ts/snapshot/react/out/packed-consumer/src-gen",
    fileExts: [".ts", ".tsx"],
    ignoreTopLevelDirs: ["genes", "haxe", "js"]
  });
  runGeneratedTypeScriptMatrix(
    "tests/genes-ts/snapshot/react/tsconfig.packed-consumer.json"
  );
} finally {
  rmSync(path.join(repoRoot, "submit.zip"), { force: true });
}

run("haxe", ["tests/genes-ts/snapshot/react/build-custom-provider.hxml"]);
const customProviderSource = readFileSync(
  path.join(repoRoot, "tests/genes-ts/snapshot/react/out/custom-provider/CustomProviderMain.js"),
  "utf8"
);
ok(customProviderSource.includes('createElement("x-card"'));

// Unlike the main fixture, this source never names a standard DOM type before
// HXX contextualizes the callback. It proves both Haxe module-load orders and
// ensures the richer ambient type remains a checker input, not generated code.
run("haxe", ["tests/genes-ts/snapshot/react/build-context-first-dom.hxml"]);
assertNoGeneratedDomSupportGraph(
  "tests/genes-ts/snapshot/react/out/context-first-dom/src-gen"
);
const contextFirstDomSource = readFileSync(
  path.join(
    repoRoot,
    "tests/genes-ts/snapshot/react/out/context-first-dom/src-gen/ContextFirstDomMain.tsx"
  ),
  "utf8"
);
ok(contextFirstDomSource.includes('event.currentTarget.protocol = "https:"'),
  "context-first HXX exposes the complete standard anchor API");
ok(contextFirstDomSource.includes("MouseEvent<HTMLAnchorElement>"),
  "context-first HXX emits the ambient browser identity");
runGeneratedTypeScriptMatrix(
  "tests/genes-ts/snapshot/react/tsconfig.context-first-dom.json"
);

run("haxe", ["tests/genes-ts/snapshot/react/build-tsx.hxml"]);
assertNoGeneratedDomSupportGraph(
  "tests/genes-ts/snapshot/react/out/tsx/src-gen"
);
copyTsxFixtures("tests/genes-ts/snapshot/react/out/tsx/src-gen");
const automaticTsxSource = readFileSync(
  path.join(repoRoot, "tests/genes-ts/snapshot/react/out/tsx/src-gen/Main.tsx"),
  "utf8"
);
ok(automaticTsxSource.includes(
  "MouseEvent<HTMLAnchorElement>"
), "TSX preserves the complete anchor event target as an ambient DOM type");
ok(automaticTsxSource.includes(
  "ChangeEvent<HTMLInputElement>"
), "TSX preserves the complete input event target as an ambient DOM type");
ok(automaticTsxSource.includes('event.currentTarget.protocol = "https:"'),
  "HXX exposes anchor APIs beyond the focused compatibility facade");
ok(automaticTsxSource.includes("event.target.setSelectionRange(0, 0)"),
  "HXX exposes the complete standard input API");
ok(!automaticTsxSource.includes("./js/html"));
ok(automaticTsxSource.includes(
  "<Main.RequiredChild {...optionalChildren}>{optionalChildSpreadHtml}</Main.RequiredChild>"
), "TSX lets nested markup satisfy required children after an optional spread");
ok(automaticTsxSource.includes(
  "<Main.RequiredChild {...presentOptionalChildren}>{optionalChildOverrideHtml}</Main.RequiredChild>"
), "TSX keeps nested children after and therefore above a present spread child");
ok(automaticTsxSource.includes(
  "<Main.RequiredChildList>{childArray}</Main.RequiredChildList>"
), "TSX preserves one array-valued child for an array children contract");
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "tests/genes-ts/snapshot/react/out/tsx/src-gen",
  fileExts: [".ts", ".tsx"],
  ignoreTopLevelDirs: ["genes", "haxe", "js", "tink", "components"]
});
runGeneratedTypeScriptMatrix(
  "tests/genes-ts/snapshot/react/tsconfig.tsx.json"
);
run("node", ["tests/genes-ts/snapshot/react/out/tsx/dist/index.js"]);

run("haxe", ["tests/genes-ts/snapshot/react/build-tsx-jsx-source.hxml"]);
assertNoGeneratedDomSupportGraph(
  "tests/genes-ts/snapshot/react/out/tsx-jsx-source/src-gen"
);
copyTsxFixtures("tests/genes-ts/snapshot/react/out/tsx-jsx-source/src-gen");
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "tests/genes-ts/snapshot/react/out/tsx-jsx-source/src-gen",
  fileExts: [".ts", ".tsx"],
  ignoreTopLevelDirs: ["genes", "haxe", "js", "tink", "components"]
});
runGeneratedTypeScriptMatrix(
  "tests/genes-ts/snapshot/react/tsconfig.tsx-jsx-source.json"
);
run("node", ["tests/genes-ts/snapshot/react/out/tsx-jsx-source/dist/index.js"]);

rmrf("tests/genes-ts/snapshot/react/out/tsx-classic");
run("haxe", ["tests/genes-ts/snapshot/react/build-tsx-classic.hxml"]);
assertNoGeneratedDomSupportGraph(
  "tests/genes-ts/snapshot/react/out/tsx-classic/src-gen"
);
copyTsxFixtures("tests/genes-ts/snapshot/react/out/tsx-classic/src-gen");
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "tests/genes-ts/snapshot/react/out/tsx-classic/src-gen",
  fileExts: [".ts", ".tsx"],
  ignoreTopLevelDirs: ["genes", "haxe", "js", "tink", "components"]
});
runGeneratedTypeScriptMatrix(
  "tests/genes-ts/snapshot/react/tsconfig.tsx.classic.json"
);
run("node", ["tests/genes-ts/snapshot/react/out/tsx-classic/dist/index.js"]);

run("haxe", ["tests/genes-ts/snapshot/react/build-ts.hxml"]);
assertNoGeneratedDomSupportGraph(
  "tests/genes-ts/snapshot/react/out/ts/src-gen"
);
copyTsxFixtures("tests/genes-ts/snapshot/react/out/ts/src-gen");
const typedCreateElementSource = readFileSync(
  path.join(repoRoot, "tests/genes-ts/snapshot/react/out/ts/src-gen/Main.ts"),
  "utf8"
);
ok(typedCreateElementSource.includes(
  "createElement<GenericValueProps<number>>(Main.GenericValue"
), "typed createElement preserves the Haxe-inferred generic component props");
ok(!typedCreateElementSource.includes(
  "ComponentPropsWithoutRef<typeof Main.GenericValue>"
), "typed createElement does not widen a generic component contract to unknown");
ok(typedCreateElementSource.includes(
  "ComponentPropsWithoutRef<typeof Button>"
), "concrete function components keep React's concise utility-type path");
ok(typedCreateElementSource.includes(
  "ComponentPropsWithoutRef<typeof TypedButton>"
), "metadata-backed component wrappers keep their emitted React prop contract");
ok(typedCreateElementSource.includes(
  "createElement(Main.RequiredChild, ({...optionalChildren, children: optionalChildSpreadHtml}"
), "typed createElement puts a required nested child in the checked property object");
ok(typedCreateElementSource.includes(
  "createElement(Main.RequiredChild, ({...presentOptionalChildren, children: optionalChildOverrideHtml}"
), "typed createElement emits nested children after an optional spread value");
ok(typedCreateElementSource.includes(
  "createElement(Main.RequiredChildList, ({children: childArray}"
), "typed createElement preserves one array-valued child without wrapping it again");
ok(typedCreateElementSource.includes(
  "children: [multipleRequiredChildrenHtml, multipleRequiredChildrenHtml1]"
), "typed createElement aggregates several children for a required array contract");
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "tests/genes-ts/snapshot/react/out/ts/src-gen",
  fileExts: [".ts", ".tsx"],
  ignoreTopLevelDirs: ["genes", "haxe", "js", "tink", "components"]
});
runGeneratedTypeScriptMatrix(
  "tests/genes-ts/snapshot/react/tsconfig.ts.json"
);
run("node", ["tests/genes-ts/snapshot/react/out/ts/dist/index.js"]);

// One Haxe source file now owns a runtime differential between real TSX and
// classic ESM. Static intent remains readable TSX, while a runtime string tag
// deliberately exercises the shared createElement capability in both modes.
run("haxe", ["tests/genes-ts/snapshot/react/build-dual-tsx.hxml"]);
const dualTsxSource = readFileSync(
  path.join(repoRoot, "tests/genes-ts/snapshot/react/out/dual-tsx/src-gen/DualJsxMain.tsx"),
  "utf8"
);
ok(dualTsxSource.includes("<main {...rootProps}>"));
ok(dualTsxSource.includes("let tree1: JSX.Element ="));
ok(dualTsxSource.includes("React__genes_jsx.createElement(runtimeTag"));
runGeneratedTypeScriptMatrix(
  "tests/genes-ts/snapshot/react/tsconfig.dual-tsx.json"
);

run("haxe", ["tests/genes-ts/snapshot/react/build-dual-classic.hxml"]);
const dualClassicSource = readFileSync(
  path.join(repoRoot, "tests/genes-ts/snapshot/react/out/dual-classic/DualJsxMain.js"),
  "utf8"
);
ok(dualClassicSource.includes('import * as React__genes_jsx from "react"'));
ok(dualClassicSource.includes("React__genes_jsx.createElement(\"main\""));
ok(dualClassicSource.includes(
  "createElement(DualJsxMain.RequiredChildHost, {...presentOptionalChildren}, optionalSpreadOverrideElement)"
), "classic createElement passes nested children after a present spread child");
ok(dualClassicSource.includes(
  "createElement(DualJsxMain.RequiredChildListHost, null, childArray)"
), "classic createElement preserves one array-valued child");
strictEqual(dualClassicSource.includes("Jsx.__jsx"), false);

run("haxe", ["tests/genes-ts/snapshot/react/build-dual-jsx.hxml"]);
const dualJsxSource = readFileSync(
  path.join(repoRoot, "tests/genes-ts/snapshot/react/out/dual-jsx/DualJsxMain.jsx"),
  "utf8"
);
ok(dualJsxSource.includes("<main {...rootProps}>"));
ok(dualJsxSource.includes("React__genes_jsx.createElement(runtimeTag"));
strictEqual(dualJsxSource.includes("Jsx.__jsx"), false);
strictEqual(dualJsxSource.includes(": JSX.Element"), false);
runTypeScript("apiBridge", [
  "-p",
  "tests/genes-ts/snapshot/react/tsconfig.dual-jsx.json"
]);

const expectedTranscript = {
  staticHtml: '<main class="shared" id="root"><h1>dual</h1><span>A</span><span>B</span></main>',
  optionalSpreadHtml: '<section><strong>nested child</strong></section>',
  optionalSpreadOverrideHtml: '<section><strong>nested child</strong></section>',
  arrayValueChildHtml: '<section><em>array A</em><strong>array B</strong></section>',
  multipleRequiredChildrenHtml: '<section><em>nested A</em><strong>nested B</strong></section>',
  dynamicHtml: '<aside data-mode="dynamic">D</aside>',
  evaluatedHtml: '<div title="evaluated-once">E</div>',
  arrayPropHtml: '<div data-array="evaluated-once">P</div>',
  arrayChildHtml: '<div>evaluated-once</div>',
  propEvaluations: 3
};
const tsxTranscript = parseTranscript(
  capture("node", ["tests/genes-ts/snapshot/react/out/dual-tsx/dist/index.js"])
);
const classicTranscript = parseTranscript(
  capture("node", ["tests/genes-ts/snapshot/react/out/dual-classic/index.js"])
);
const jsxTranscript = parseTranscript(
  capture("node", ["tests/genes-ts/snapshot/react/out/dual-jsx-dist/index.js"])
);
deepStrictEqual(tsxTranscript, expectedTranscript);
deepStrictEqual(classicTranscript, expectedTranscript);
deepStrictEqual(jsxTranscript, expectedTranscript);

// `.tsx` and `.jsx` are deliberately distinct contracts. Rejecting the
// contradictory `.jsx` + `genes.ts` combination prevents silently erasing the
// Haxe-derived TypeScript annotations a caller explicitly requested.
const jsxWithTypes = spawnSync(
  "haxe",
  ["tests/genes-ts/snapshot/react/build-dual-jsx-ts-disabled.hxml"],
  { cwd: repoRoot, encoding: "utf8" }
);
strictEqual(jsxWithTypes.status === 0, false);
const jsxWithTypesOutput = `${jsxWithTypes.stdout}${jsxWithTypes.stderr}`;
ok(jsxWithTypesOutput.includes("[GTS-JSX-CAPABILITY-007]"));
const jsxWithTypesDirectory = path.join(
  repoRoot,
  "tests/genes-ts/snapshot/react/out/dual-jsx-ts-disabled"
);
if (existsSync(jsxWithTypesDirectory)) {
  deepStrictEqual(readdirSync(jsxWithTypesDirectory), []);
}

// Disabling the required classic runtime is an explicit capability choice. It
// must diagnose the original Haxe source and commit no partial output tree.
const unsupported = spawnSync(
  "haxe",
  ["tests/genes-ts/snapshot/react/build-dual-classic-disabled.hxml"],
  { cwd: repoRoot, encoding: "utf8" }
);
strictEqual(unsupported.status === 0, false);
const unsupportedOutput = `${unsupported.stdout}${unsupported.stderr}`;
ok(unsupportedOutput.includes("[GTS-JSX-CAPABILITY-001]"));
ok(unsupportedOutput.includes("DualJsxMain.hx:"));
const disabledOutput = path.join(
  repoRoot,
  "tests/genes-ts/snapshot/react/out/dual-disabled"
);
if (existsSync(disabledOutput)) {
  deepStrictEqual(readdirSync(disabledOutput), []);
}
