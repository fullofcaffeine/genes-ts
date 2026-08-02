import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { generateCssModuleCompanion } from "../../tooling/dist/css-modules/index.js";

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(fixtureRoot, "../..");
const repoRequire = createRequire(import.meta.url);
const require = createRequire(path.join(fixtureRoot, "provider/package.json"));
// These packages are test witnesses only. The public compiler and tooling do
// not load them or require an application to use this particular processor.
const esbuild = require("esbuild");
const postcss = require("postcss");
const postcssModules = require("postcss-modules");
const ts = repoRequire("typescript");
const { SourceMapConsumer } = repoRequire("source-map");
const cssRelative = "provider/card.module.css";
const cssFile = path.join(fixtureRoot, cssRelative);
const expectedKeys = JSON.parse(
  readFileSync(path.join(fixtureRoot, "provider/expected-exports.json"), "utf8"),
).keys;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function run(command, args, cwd = repoRoot) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

async function processCss(file) {
  const css = readFileSync(file, "utf8");
  let tokens = null;
  const result = await postcss([
    postcssModules({
      generateScopedName: "genes_test_[name]__[local]",
      getJSON(_filename, output) {
        tokens = output;
      },
    }),
  ]).process(css, { from: file });
  assert.notEqual(tokens, null, "the real processor reports its runtime exports");
  return { css: result.css, tokens };
}

function sourceLocation(name) {
  const css = readFileSync(cssFile, "utf8");
  const needle = `.${name}`;
  const offset = css.indexOf(needle);
  assert.notEqual(offset, -1, `fixture contains ${needle}`);
  const before = css.slice(0, offset).split("\n");
  return { path: cssRelative, line: before.length, column: before.at(-1).length + 2 };
}

async function makeManifest() {
  const processed = await processCss(cssFile);
  const keys = Object.keys(processed.tokens).sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );
  assert.deepEqual(keys, expectedKeys, "hand-reviewed keys agree with the real processor");
  const providerLock = JSON.parse(
    readFileSync(path.join(fixtureRoot, "provider/package-lock.json"), "utf8"),
  );
  const processorPackage = providerLock.packages["node_modules/postcss-modules"];
  assert.equal(processorPackage.version, "9.0.1");
  assert.match(processorPackage.integrity, /^sha512-/u);
  const css = readFileSync(cssFile);
  return {
    protocol: "genes.css-module-exports",
    version: 1,
    namingPolicy: "genes-haxe-css-fields-v1",
    binding: {
      haxeOwner: "css_module_companions.Main",
      generatedModule: "css_module_companions/Main",
      request: "./card.module.css",
      hostModulePath: "out/css_module_companions/card.module.css",
      companionType: "css_module_companions.CardStyles",
    },
    source: {
      entry: cssRelative,
      inputs: [{ path: cssRelative, sha256: sha256(css) }],
    },
    producer: {
      providerId: "genes-css-module-test-provider",
      providerVersion: "1.0.0",
      processorId: "postcss-modules",
      processorVersion: processorPackage.version,
      processorIntegrity: processorPackage.integrity,
      configurationSha256: sha256("generateScopedName=genes_test_[name]__[local]"),
    },
    exports: keys.map((name) => ({ name, source: sourceLocation(name) })),
  };
}

function compileFailure(define, expected) {
  const output = path.join(fixtureRoot, "out/invalid", `${define}.js`);
  mkdirSync(path.dirname(output), { recursive: true });
  const sentinel = `preserved:${define}\n`;
  writeFileSync(output, sentinel, "utf8");
  const result = spawnSync("haxe", [
    "-lib", "genes-ts",
    "-cp", "tests/css-module-companions/src",
    "-cp", "tests/css-module-companions/generated",
    "--main", "css_module_companions.Invalid",
    "-js", path.relative(repoRoot, output),
    "-D", define,
    "-D", "no-deprecation-warnings",
    "-D", "js-es=6",
    "-dce", "full",
    "--macro", "genes.Generator.use()",
  ], { cwd: repoRoot, encoding: "utf8" });
  assert.notEqual(result.status, 0, `${define} must fail`);
  const diagnostic = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.match(diagnostic, new RegExp(expected), `${define} reports ${expected}\n${diagnostic}`);
  assert.match(diagnostic, /Invalid\.hx:\d+: characters/u, `${define} points into authored Haxe`);
  assert.equal(
    readFileSync(output, "utf8"),
    sentinel,
    `${define} leaves the previous public entry byte-identical`,
  );
}

function sourcePoint(file, needle) {
  const source = readFileSync(file, "utf8");
  const offset = source.indexOf(needle);
  assert.notEqual(offset, -1, `${file} contains ${needle}`);
  const lines = source.slice(0, offset).split("\n");
  return { line: lines.length, column: lines.at(-1).length };
}

function assertImportMap(generatedFile) {
  const source = readFileSync(generatedFile, "utf8");
  const token = '"./card.module.css"';
  const offset = source.indexOf(token);
  assert.notEqual(offset, -1, `${generatedFile} contains the CSS request`);
  const generatedLines = source.slice(0, offset).split("\n");
  const consumer = new SourceMapConsumer(
    JSON.parse(readFileSync(`${generatedFile}.map`, "utf8")),
  );
  const original = consumer.originalPositionFor({
    line: generatedLines.length,
    column: generatedLines.at(-1).length,
    bias: SourceMapConsumer.GREATEST_LOWER_BOUND,
  });
  assert.match(original.source ?? "", /src\/css_module_companions\/Main\.hx$/u);
  assert.deepEqual(
    { line: original.line, column: original.column },
    sourcePoint(
      path.join(fixtureRoot, "src/css_module_companions/Main.hx"),
      '"./card.module.css"',
    ),
    "the generated CSS request maps to the authored Haxe literal",
  );
}

function assertOneCssImport(source, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  const cssImports = sourceFile.statements.filter((statement) =>
    ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text === "./card.module.css"
  );
  assert.equal(cssImports.length, 1, `${fileName} has one CSS Module import declaration`);
  assert.equal(
    cssImports[0].importClause?.name?.text,
    "__genes_import_styles",
    `${fileName} uses the ordinary default-import binding`,
  );
}

function cssLoaderPlugin(observed) {
  return {
    name: "genes-test-real-css-modules-loader",
    setup(build) {
      build.onLoad({ filter: /\.module\.css$/ }, async (args) => {
        const processed = await processCss(args.path);
        const keys = Object.keys(processed.tokens).sort();
        observed.push({ keys, values: processed.tokens });
        return {
          contents: `export default ${JSON.stringify(processed.tokens)};`,
          loader: "js",
        };
      });
    },
  };
}

async function bundleAndRun(profile, entry) {
  const observed = [];
  const bundle = path.join(fixtureRoot, "out/runtime", `${profile}.mjs`);
  mkdirSync(path.dirname(bundle), { recursive: true });
  await esbuild.build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "esm",
    platform: "node",
    plugins: [cssLoaderPlugin(observed)],
  });
  assert.equal(observed.length, 1, `${profile} has one runtime CSS Module import`);
  assert.deepEqual(observed[0].keys, expectedKeys);
  for (const value of Object.values(observed[0].values)) {
    assert.equal(typeof value, "string");
    assert.notEqual(value.length, 0);
  }
  const transcript = execFileSync(process.execPath, [bundle], { encoding: "utf8" });
  for (const value of Object.values(observed[0].values)) {
    assert.match(transcript, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  }
}

async function main() {
  rmSync(path.join(fixtureRoot, "generated"), { recursive: true, force: true });
  rmSync(path.join(fixtureRoot, "out"), { recursive: true, force: true });
  const manifest = await makeManifest();
  const companion = generateCssModuleCompanion({
    projectRoot: fixtureRoot,
    manifest,
  });

  const packageLess = generateCssModuleCompanion({
    projectRoot: fixtureRoot,
    manifest: {
      ...manifest,
      binding: {
        ...manifest.binding,
        haxeOwner: "Main",
        companionType: "CardStyles",
      },
    },
  });
  assert.equal(packageLess.relativePath, "CardStyles.hx");
  assert.doesNotMatch(packageLess.content, /^package\b/mu);

  const unusualPath = "out/styles*/card.module.css";
  const unusualFile = path.join(fixtureRoot, unusualPath);
  mkdirSync(path.dirname(unusualFile), { recursive: true });
  writeFileSync(unusualFile, readFileSync(cssFile));
  const unusualPathCompanion = generateCssModuleCompanion({
    projectRoot: fixtureRoot,
    manifest: {
      ...manifest,
      source: {
        entry: unusualPath,
        inputs: [{ path: unusualPath, sha256: sha256(readFileSync(unusualFile)) }],
      },
      exports: manifest.exports.map((entry) => ({
        ...entry,
        source: { ...entry.source, path: unusualPath },
      })),
    },
  });
  assert.doesNotMatch(unusualPathCompanion.content, /styles\*\//u);
  assert.match(unusualPathCompanion.content, /styles\* \/card\.module\.css/u);

  const runtimePrefixCompanion = generateCssModuleCompanion({
    projectRoot: fixtureRoot,
    manifest: {
      ...manifest,
      exports: [
        { name: "__element", source: manifest.exports[0].source },
        { name: "_hx_button", source: manifest.exports[1].source },
      ],
    },
  });
  assert.deepEqual(
    runtimePrefixCompanion.fields.map(({ haxeName, runtimeName }) => ({ haxeName, runtimeName })),
    [
      { haxeName: "element", runtimeName: "__element" },
      { haxeName: "hxButton", runtimeName: "_hx_button" },
    ],
  );
  assert.match(runtimePrefixCompanion.content, /@:native\("__element"\)/u);
  assert.match(runtimePrefixCompanion.content, /@:native\("_hx_button"\)/u);
  const companionFile = path.join(fixtureRoot, "generated", companion.relativePath);
  mkdirSync(path.dirname(companionFile), { recursive: true });
  writeFileSync(companionFile, companion.content, "utf8");

  run("haxe", ["tests/css-module-companions/build-ts.hxml"]);
  run("haxe", ["tests/css-module-companions/build-classic.hxml"]);
  for (const profile of ["ts", "classic"]) {
    const target = path.join(fixtureRoot, `out/${profile}/css_module_companions/card.module.css`);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(cssFile, target);
  }
  run(path.join(repoRoot, "node_modules/.bin/tsc6"), ["-p", "tsconfig.json"], fixtureRoot);
  run(path.join(repoRoot, "node_modules/.bin/tsc6"), ["-p", "tsconfig.declarations.json"], fixtureRoot);
  run(path.join(repoRoot, "node_modules/.bin/tsc6"), ["-p", "tsconfig.declaration-consumer.json"], fixtureRoot);

  const tsSource = readFileSync(path.join(fixtureRoot, "out/ts/css_module_companions/Main.ts"), "utf8");
  const classicSource = readFileSync(path.join(fixtureRoot, "out/classic/css_module_companions/Main.js"), "utf8");
  assertOneCssImport(tsSource, "Main.ts");
  assertOneCssImport(classicSource, "Main.js");
  for (const source of [tsSource, classicSource]) {
    assert.match(source, /styles\["error-state"\]/u);
  }
  assertImportMap(path.join(fixtureRoot, "out/ts/css_module_companions/Main.ts"));
  assertImportMap(path.join(fixtureRoot, "out/classic/css_module_companions/Main.js"));
  assert.match(tsSource, /const styles: CardStyles = __genes_import_styles/u);
  assert.doesNotMatch(classicSource, /import .*CardStyles/u);
  const publicType = readFileSync(
    path.join(fixtureRoot, "out/dts/css_module_companions/CardStyles.d.ts"),
    "utf8",
  );
  assert.match(publicType, /"error-state": string/u);
  assert.match(publicType, /\b__element: string/u);
  assert.match(publicType, /\b_hx_button: string/u);
  assert.doesNotMatch(publicType, /\bany\b/u, "runtime-looking CSS keys keep a closed public type");
  assert.doesNotMatch(publicType, /\[.*: string\]/u, "the public type has no arbitrary-key index");

  compileFailure("css_module_missing_field", "has no field missing");
  compileFailure("css_module_no_type", "GENES-CSS-MODULE-TYPE-009");
  compileFailure("css_module_wrong_request", "GENES-CSS-MODULE-BINDING-010");
  compileFailure("css_module_wrong_owner", "GENES-CSS-MODULE-BINDING-010");
  compileFailure("css_module_unmarked_type", "GENES-CSS-MODULE-TYPE-009");
  compileFailure("css_module_nonliteral", "GENES-CSS-MODULE-REQUEST-LITERAL-001");

  await bundleAndRun("ts", path.join(fixtureRoot, "out/ts/index.ts"));
  await bundleAndRun("classic", path.join(fixtureRoot, "out/classic/index.js"));
}

await main();
