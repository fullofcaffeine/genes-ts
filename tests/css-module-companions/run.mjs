import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os, { homedir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { generateCssModuleCompanion } from "../../tooling/dist/css-modules/index.js";
import {
  canonicalDigest,
  canonicalJson,
} from "../../tooling/dist/artifacts/index.js";
import {
  createGenesDevelopmentSession,
  HAXE_4_3_7_DEVELOPMENT_JS_POLICY,
} from "../../tooling/dist/session/index.js";

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

function buildClassicDeclarations(companionFile) {
  // Files below tests/ inherit the repository's test-only import.hx, which in
  // turn loads tink_unittest. Stage this deliberately small public API outside
  // that test package so the classic declaration check covers only the CSS
  // contract instead of retaining an unrelated testing-library type graph.
  const sourceRoot = mkdtempSync(path.join(os.tmpdir(), "genes-css-dts-source-"));
  try {
    const authoredPackage = path.join(sourceRoot, "src/css_module_companions");
    const generatedPackage = path.join(sourceRoot, "generated/css_module_companions");
    mkdirSync(authoredPackage, { recursive: true });
    mkdirSync(generatedPackage, { recursive: true });
    for (const name of ["Entry.hx", "Main.hx"]) {
      copyFileSync(
        path.join(fixtureRoot, "src/css_module_companions", name),
        path.join(authoredPackage, name),
      );
    }
    copyFileSync(companionFile, path.join(generatedPackage, "CardStyles.hx"));
    run("haxe", [
      "-lib", "genes-ts",
      "-cp", path.join(sourceRoot, "src"),
      "-cp", path.join(sourceRoot, "generated"),
      "--main", "css_module_companions.Entry",
      "-js", path.join(fixtureRoot, "out/classic-dts/index.js"),
      "-D", "dts",
      "-D", "no-deprecation-warnings",
      "-D", "js-es=6",
      "-dce", "full",
      "-debug",
    ]);
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
  }
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
      hostModulePath: "out/ts/css_module_companions/card.module.css",
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

function warmSource({ useTitle, useSelected }) {
  const fields = ["styles.card"];
  if (useTitle) fields.push("styles.title");
  if (useSelected) fields.push("styles.selected");
  return [
    "package app;",
    "",
    "import genes.css.CssModule.imported;",
    "",
    "/** Returns the real class names supplied by the current CSS Module. */",
    '@:genes.moduleFunction("classNames")',
    "function classNames():String {",
    "  final styles:CardStyles = imported(\"./card.module.css\", \"styles\");",
    `  return [${fields.join(", ")}].join("|");`,
    "}",
    "",
  ].join("\n");
}

function warmEntrySource() {
  return [
    "package app;",
    "",
    "/** Small executable entry used by the real loader check. */",
    "class Entry {",
    "  static function main():Void trace(Card.classNames());",
    "}",
    "",
  ].join("\n");
}

function sourceLocationIn(file, relativePath, name) {
  const css = readFileSync(file, "utf8");
  const offset = css.indexOf(`.${name}`);
  assert.notEqual(offset, -1, `${relativePath} contains .${name}`);
  const before = css.slice(0, offset).split("\n");
  return {
    path: relativePath,
    line: before.length,
    column: before.at(-1).length + 2,
  };
}

async function makeWarmManifest(projectRoot, expected) {
  const sourceRelative = "styles/card.module.css";
  const file = path.join(projectRoot, sourceRelative);
  const processed = await processCss(file);
  const keys = Object.keys(processed.tokens).sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );
  assert.deepEqual(
    keys,
    expected,
    "the hand-written expectation agrees with the real CSS processor",
  );
  const providerLock = JSON.parse(
    readFileSync(path.join(fixtureRoot, "provider/package-lock.json"), "utf8"),
  );
  const processorPackage = providerLock.packages["node_modules/postcss-modules"];
  return {
    protocol: "genes.css-module-exports",
    version: 1,
    namingPolicy: "genes-haxe-css-fields-v1",
    binding: {
      haxeOwner: "app.Card",
      generatedModule: "app/Card",
      request: "./card.module.css",
      hostModulePath: "src-gen/app/card.module.css",
      companionType: "app.CardStyles",
    },
    source: {
      entry: sourceRelative,
      inputs: [{ path: sourceRelative, sha256: sha256(readFileSync(file)) }],
    },
    producer: {
      providerId: "genes-css-module-warm-test-provider",
      providerVersion: "1.0.0",
      processorId: "postcss-modules",
      processorVersion: processorPackage.version,
      processorIntegrity: processorPackage.integrity,
      configurationSha256: sha256(
        "generateScopedName=genes_test_[name]__[local]",
      ),
    },
    exports: keys.map((name) => ({
      name,
      source: sourceLocationIn(file, sourceRelative, name),
    })),
  };
}

async function prepareWarmRevision(projectRoot, expectedKeys) {
  const css = path.join(projectRoot, "styles/card.module.css");
  const manifest = await makeWarmManifest(projectRoot, expectedKeys);
  const companion = generateCssModuleCompanion({ projectRoot, manifest });
  return {
    classPaths: ["generated-haxe"],
    files: [
      {
        relativePath: `generated-haxe/${companion.relativePath}`,
        content: companion.content,
        publishPath: `generated-haxe/${companion.relativePath}`,
      },
      {
        relativePath: "evidence/css-module-exports.json",
        content: `${canonicalJson(companion.manifest)}\n`,
        publishPath: "generated-haxe/css-module-exports.json",
      },
      {
        relativePath: "host/app/card.module.css",
        content: readFileSync(css),
        publishPath: "src-gen/app/card.module.css",
      },
      {
        relativePath: "host/app/card.module.d.css.ts",
        content: companion.typescriptDeclarationContent,
        publishPath: companion.typescriptDeclarationRelativePath,
      },
    ],
  };
}

function haxeExecutable() {
  const version = execFileSync("haxe", ["--version"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const executable = process.env.HAXE_STD_PATH === undefined
    ? path.join(
        homedir(),
        "haxe",
        "versions",
        version,
        process.platform === "win32" ? "haxe.exe" : "haxe",
      )
    : path.join(
        path.dirname(process.env.HAXE_STD_PATH),
        process.platform === "win32" ? "haxe.exe" : "haxe",
      );
  return { executable, version };
}

function copyValidationTree(tree, destination) {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  const seen = new Set();
  for (const file of [...tree.files, ...tree.extraFiles]) {
    assert.equal(seen.has(file.logicalPath), false, file.logicalPath);
    seen.add(file.logicalPath);
    const target = path.join(destination, ...file.logicalPath.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(file.physicalPath, target);
  }
}

function snapshotFiles(root, directories) {
  const entries = [];
  const visit = (absolute, relative) => {
    for (const name of readdirSync(absolute).sort()) {
      const child = path.join(absolute, name);
      const childRelative = relative.length === 0 ? name : `${relative}/${name}`;
      const stats = lstatSync(child);
      assert.equal(stats.isSymbolicLink(), false, childRelative);
      if (stats.isDirectory()) visit(child, childRelative);
      else entries.push([childRelative, sha256(readFileSync(child))]);
    }
  };
  for (const directory of directories) {
    const absolute = path.join(root, directory);
    if (existsSync(absolute)) visit(absolute, directory);
  }
  return entries;
}

function fileViews(root, logicalRoot) {
  const files = [];
  const visit = (absolute, relative) => {
    for (const name of readdirSync(absolute).sort()) {
      const child = path.join(absolute, name);
      const childRelative = relative.length === 0 ? name : `${relative}/${name}`;
      const stats = lstatSync(child);
      if (stats.isDirectory()) visit(child, childRelative);
      else {
        files.push({
          logicalPath: `${logicalRoot}/${childRelative}`,
          physicalPath: child,
          digest: sha256(readFileSync(child)),
        });
      }
    }
  };
  visit(root, "");
  return files;
}

function preparedRevisionDigest(prepared) {
  return canonicalDigest({
    protocol: "genes.tooling.prepared-revision.v1",
    classPaths: prepared.classPaths,
    files: prepared.files.map((file) => {
      const bytes = typeof file.content === "string"
        ? Buffer.from(file.content, "utf8")
        : Buffer.from(file.content);
      return {
        path: file.relativePath,
        sha256: sha256(bytes),
        sizeBytes: bytes.byteLength,
        mode: file.mode ?? 0o644,
        publishPath: file.publishPath ?? null,
      };
    }),
  });
}

async function isolatedColdSnapshot({
  projectRoot,
  expectedKeys,
  executable,
  validationRoot,
}) {
  const prepared = await prepareWarmRevision(projectRoot, expectedKeys);
  // Match the session candidate's directory depth. Source maps are relative to
  // the generated module, so an equally deep isolated build should have the
  // exact same portable source names without copying the live nonce.
  const coldRoot = path.join(
    projectRoot,
    ".cold/dev/candidates/revision-cold",
  );
  const preparedRoot = coldRoot;
  const outputRoot = path.join(coldRoot, "output");
  const haxeTarget = path.join(coldRoot, "haxe-target/compiler.js");
  const publicRoot = path.join(coldRoot, "public");
  rmSync(path.join(projectRoot, ".cold"), { recursive: true, force: true });
  for (const file of prepared.files) {
    const target = path.join(preparedRoot, ...file.relativePath.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.content, { mode: file.mode ?? 0o644 });
  }
  mkdirSync(outputRoot, { recursive: true });
  mkdirSync(path.dirname(haxeTarget), { recursive: true });
  execFileSync(
    executable,
    [
      "build.hxml",
      "--js",
      haxeTarget,
      ...prepared.classPaths.flatMap((classPath) => [
        "-cp",
        path.join(preparedRoot, ...classPath.split("/")),
      ]),
      "-D",
      `genes.tooling.prepared=${preparedRevisionDigest(prepared)}`,
      "-D",
      `genes.output=${path.join(outputRoot, "index.ts")}`,
    ],
    { cwd: projectRoot, stdio: "pipe" },
  );
  cpSync(outputRoot, path.join(publicRoot, "src-gen"), { recursive: true });
  const extraFiles = [];
  for (const file of prepared.files) {
    if (file.publishPath === undefined) continue;
    const source = path.join(preparedRoot, ...file.relativePath.split("/"));
    const target = path.join(publicRoot, ...file.publishPath.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    extraFiles.push({
      logicalPath: file.publishPath,
      physicalPath: target,
      digest: sha256(readFileSync(target)),
    });
  }
  const receipt = await validateWarmTree(
    {
      entryLogicalPath: "src-gen/index.ts",
      files: fileViews(outputRoot, "src-gen"),
      extraFiles,
    },
    validationRoot,
  );
  const receiptFile = path.join(publicRoot, "generated-haxe/host-agreement.json");
  mkdirSync(path.dirname(receiptFile), { recursive: true });
  writeFileSync(receiptFile, receipt, "utf8");
  return {
    root: publicRoot,
    snapshot: snapshotFiles(publicRoot, ["src-gen", "generated-haxe"]),
  };
}

async function validateWarmTree(tree, validationRoot) {
  copyValidationTree(tree, validationRoot);
  const manifestFile = path.join(
    validationRoot,
    "generated-haxe/css-module-exports.json",
  );
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const expectedKeys = manifest.exports.map((entry) => entry.name).sort();
  const tsconfig = path.join(validationRoot, "tsconfig.json");
  writeFileSync(
    tsconfig,
    `${JSON.stringify({
      compilerOptions: {
        allowArbitraryExtensions: true,
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "Bundler",
        noEmit: true,
        strict: true,
        target: "ES2022",
      },
      include: ["src-gen/**/*.ts"],
    }, null, 2)}\n`,
    "utf8",
  );
  run(path.join(repoRoot, "node_modules/.bin/tsc6"), ["-p", tsconfig], validationRoot);

  const observed = [];
  const bundle = path.join(validationRoot, "runtime.mjs");
  await esbuild.build({
    entryPoints: [path.join(validationRoot, tree.entryLogicalPath)],
    outfile: bundle,
    bundle: true,
    format: "esm",
    platform: "node",
    plugins: [cssLoaderPlugin(observed)],
  });
  assert.equal(observed.length, 1, "the real loader sees one CSS Module import");
  assert.deepEqual(observed[0].keys.sort(), expectedKeys);
  for (const value of Object.values(observed[0].values)) {
    assert.equal(typeof value, "string");
    assert.notEqual(value.length, 0);
  }
  execFileSync(process.execPath, [bundle], { encoding: "utf8" });
  return `${canonicalJson({
    protocol: "genes.css-module-host-agreement",
    version: 1,
    manifestSha256: sha256(readFileSync(manifestFile)),
    observedKeysSha256: sha256(JSON.stringify(expectedKeys)),
    result: "accepted",
  })}\n`;
}

async function exerciseWarmCssModuleSession() {
  const projectRoot = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-css-warm-")),
  );
  const sourceRoot = path.join(projectRoot, "src");
  const styleRoot = path.join(projectRoot, "styles");
  const genesSourceRoot = path.join(projectRoot, "genes-src");
  const helderCopyRoot = path.join(projectRoot, "helder-src");
  const validationRoot = path.join(projectRoot, ".validation");
  const css = path.join(styleRoot, "card.module.css");
  const card = path.join(sourceRoot, "app/Card.hx");
  const { executable, version } = haxeExecutable();
  const helderSourceRoot = execFileSync("haxelib", ["path", "helder.set"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split(/\r?\n/u)
    .find((line) => line.length > 0 && !line.startsWith("-"));
  assert.notEqual(helderSourceRoot, undefined);
  let expectedKeys = ["card", "title"];
  const events = [];
  try {
    mkdirSync(path.dirname(card), { recursive: true });
    mkdirSync(styleRoot, { recursive: true });
    cpSync(path.join(repoRoot, "src"), genesSourceRoot, { recursive: true });
    cpSync(helderSourceRoot, helderCopyRoot, { recursive: true });
    copyFileSync(
      path.join(repoRoot, "extraParams.hxml"),
      path.join(projectRoot, "genes-extraParams.hxml"),
    );
    writeFileSync(card, warmSource({ useTitle: true, useSelected: false }));
    writeFileSync(path.join(sourceRoot, "app/Entry.hx"), warmEntrySource());
    writeFileSync(
      css,
      ".card { border: 1px solid; }\n.title { font-weight: 700; }\n",
    );
    writeFileSync(
      path.join(projectRoot, "build.hxml"),
      [
        path.join(projectRoot, "genes-extraParams.hxml"),
        `-cp ${genesSourceRoot}`,
        `-cp ${helderCopyRoot}`,
        `-cp ${sourceRoot}`,
        "-main app.Entry",
        "-D genes.ts",
        "-D js-source-map",
        "-D no-deprecation-warnings",
        "-D js-es=6",
        "-dce full",
        "-debug",
        "",
      ].join("\n"),
    );

    let recoveryChecks = 0;
    const sessionOptions = {
      projectRoot,
      projectIdentity: "real-css-module-warm-session",
      hxml: {
        allowedRoots: [projectRoot],
      },
      publicOutputFile: "src-gen/index.ts",
      stateDirectory: ".genes/dev",
      extraInputs: [
        { path: "styles/card.module.css", impact: { rebuild: true } },
      ],
      resolveInvocation: () => ({
        executable,
        cwd: projectRoot,
        args: ["build.hxml"],
        ioPolicy: HAXE_4_3_7_DEVELOPMENT_JS_POLICY,
        compatibilityFacts: {
          fixture: "real-css-module-warm-session",
          haxe: version,
        },
      }),
      prepareRevision: async () => {
        try {
          return {
            ok: true,
            prepared: await prepareWarmRevision(projectRoot, expectedKeys),
          };
        } catch (error) {
          return {
            ok: false,
            diagnostic: {
              code: "CSS_MODULE_PREPARATION_FAILED",
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
      },
      validate: async (tree, { recovery }) => {
        try {
          if (recovery) recoveryChecks += 1;
          const receipt = await validateWarmTree(tree, validationRoot);
          return {
            ok: true,
            artifacts: [{
              path: "generated-haxe/host-agreement.json",
              content: receipt,
            }],
          };
        } catch (error) {
          return {
            ok: false,
            diagnostic: {
              code: "CSS_MODULE_HOST_DISAGREEMENT",
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
      },
      validatorPolicyFacts: {
        fixture: "strict-ts-and-real-css-loader",
        loader: "esbuild-css-module-test-loader-v1",
      },
      debounceMs: 0,
      pollIntervalMs: 60_000,
      shutdownTimeoutMs: 2_000,
    };
    const session = createGenesDevelopmentSession(sessionOptions);
    session.subscribe((event) => events.push(event));
    const reconcileEdit = async () => {
      session.reconcile();
      await session.waitForIdle();
    };
    const expectReady = () => {
      assert.equal(
        session.state.kind,
        "ready",
        JSON.stringify(session.inspect()),
      );
    };
    const expectRetained = (snapshot, code, message, hostCode) => {
      assert.equal(session.state.kind, "degraded", JSON.stringify(session.inspect()));
      assert.equal(session.state.failure.diagnostic.code, code);
      if (message !== undefined) {
        assert.match(session.state.failure.diagnostic.message, message);
      }
      if (hostCode !== undefined) {
        assert.equal(
          session.state.failure.diagnostic.details?.code,
          hostCode,
          "the general preparation error must retain the exact CSS error",
        );
      }
      assert.deepEqual(
        snapshotFiles(projectRoot, ["src-gen", "generated-haxe"]),
        snapshot,
        "a rejected CSS/Haxe revision keeps every accepted public byte",
      );
    };
    const expectColdMatch = async () => {
      const publicMap = JSON.parse(
        readFileSync(path.join(projectRoot, "src-gen/app/Card.ts.map"), "utf8"),
      );
      assert.equal(
        publicMap.sources.includes("../../generated-haxe/app/CardStyles.hx"),
        true,
        "the source map names the stable public companion path",
      );
      assert.equal(
        JSON.stringify(publicMap).includes("/.genes/dev/candidates/"),
        false,
        "the source map does not expose a private revision path",
      );
      const cold = await isolatedColdSnapshot({
        projectRoot,
        expectedKeys,
        executable,
        validationRoot: path.join(projectRoot, ".cold-validation"),
      });
      assert.deepEqual(
        snapshotFiles(projectRoot, ["src-gen", "generated-haxe"]),
        cold.snapshot,
        "the accepted warm tree matches a fresh isolated Haxe build",
      );
    };

    try {
      await session.start();
      await session.waitForIdle();
      expectReady();
      await expectColdMatch();

      expectedKeys = ["card", "selected", "title"];
      writeFileSync(
        css,
        ".card { border: 1px solid; }\n.title { font-weight: 700; }\n.selected { color: red; }\n",
      );
      writeFileSync(card, warmSource({ useTitle: true, useSelected: true }));
      await reconcileEdit();
      expectReady();
      await expectColdMatch();
      const acceptedAfterAdd = snapshotFiles(projectRoot, ["src-gen", "generated-haxe"]);

      expectedKeys = ["card", "selected"];
      writeFileSync(
        css,
        ".card { border: 1px solid; }\n.selected { color: red; }\n",
      );
      await reconcileEdit();
      expectRetained(acceptedAfterAdd, "HAXE_COMPILE_FAILED", /has no field title/u);

      writeFileSync(css, ".card { color: ;\n");
      await reconcileEdit();
      expectRetained(
        acceptedAfterAdd,
        "PREPARATION_REJECTED",
        undefined,
        "CSS_MODULE_PREPARATION_FAILED",
      );

      writeFileSync(card, warmSource({ useTitle: false, useSelected: true }));
      writeFileSync(
        css,
        ".card { border: 2px solid; }\n.selected { color: blue; }\n",
      );
      await reconcileEdit();
      expectReady();
      await expectColdMatch();
      const acceptedAfterRepair = snapshotFiles(projectRoot, ["src-gen", "generated-haxe"]);

      rmSync(css, { force: true });
      await reconcileEdit();
      expectRetained(
        acceptedAfterRepair,
        "PREPARATION_REJECTED",
        undefined,
        "CSS_MODULE_PREPARATION_FAILED",
      );

      writeFileSync(
        css,
        ".card { border: 2px solid; }\n.selected { color: blue; }\n",
      );
      await reconcileEdit();
      expectReady();
      await expectColdMatch();
      assert.equal(
        events.filter(
          (event) =>
            event.event.kind === "compiler-lifecycle" &&
            event.event.event.kind === "started",
        ).length,
        1,
        "all CSS edits reuse one owned Haxe compiler server",
      );
    } finally {
      await session.close();
    }

    const restarted = createGenesDevelopmentSession(sessionOptions);
    try {
      await restarted.start();
      await restarted.waitForIdle();
      assert.equal(
        recoveryChecks,
        0,
        "a clean restart builds a new private candidate; recovery validation is reserved for an unfinished publication journal",
      );
      assert.equal(restarted.state.kind, "ready", JSON.stringify(restarted.inspect()));
      const restartCold = await isolatedColdSnapshot({
        projectRoot,
        expectedKeys,
        executable,
        validationRoot: path.join(projectRoot, ".restart-cold-validation"),
      });
      assert.deepEqual(
        snapshotFiles(projectRoot, ["src-gen", "generated-haxe"]),
        restartCold.snapshot,
        "restart recovery keeps the same complete cold-build result",
      );
    } finally {
      await restarted.close();
    }
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
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

  assert.throws(
    () => generateCssModuleCompanion({
      projectRoot: fixtureRoot,
      manifest: {
        ...manifest,
        binding: {
          ...manifest.binding,
          companionType: manifest.binding.haxeOwner,
        },
      },
    }),
    /GENES-CSS-MODULE-BINDING-010/u,
    "the generated companion cannot replace the authored Haxe owner module",
  );

  const packageLess = generateCssModuleCompanion({
    projectRoot: fixtureRoot,
    manifest: {
      ...manifest,
      binding: {
        ...manifest.binding,
        haxeOwner: "Main",
        generatedModule: "Main",
        hostModulePath: "out/ts/card.module.css",
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
  buildClassicDeclarations(companionFile);
  assert.equal(
    readFileSync(
      path.join(fixtureRoot, "out/classic-dts/css_module_companions/Main.d.ts"),
      "utf8",
    ).includes("exportedStyles"),
    true,
    "classic JavaScript emits a declaration for the CSS Module public contract",
  );
  for (const profile of ["ts", "classic"]) {
    const target = path.join(fixtureRoot, `out/${profile}/css_module_companions/card.module.css`);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(cssFile, target);
  }
  const broadDeclarationResult = spawnSync(
    path.join(repoRoot, "node_modules/.bin/tsc6"),
    ["-p", "tsconfig.json"],
    { cwd: fixtureRoot, encoding: "utf8" },
  );
  assert.notEqual(
    broadDeclarationResult.status,
    0,
    "a broad wildcard declaration cannot prove the required closed CSS keys",
  );
  assert.match(
    `${broadDeclarationResult.stdout ?? ""}${broadDeclarationResult.stderr ?? ""}`,
    /missing the following properties/u,
  );
  const cssDeclarationFile = path.join(
    fixtureRoot,
    companion.typescriptDeclarationRelativePath,
  );
  mkdirSync(path.dirname(cssDeclarationFile), { recursive: true });
  writeFileSync(cssDeclarationFile, companion.typescriptDeclarationContent, "utf8");
  run(path.join(repoRoot, "node_modules/.bin/tsc6"), ["-p", "tsconfig.json"], fixtureRoot);
  run(path.join(repoRoot, "node_modules/.bin/tsc6"), ["-p", "tsconfig.declarations.json"], fixtureRoot);
  run(path.join(repoRoot, "node_modules/.bin/tsc6"), ["-p", "tsconfig.declaration-consumer.json"], fixtureRoot);
  run(path.join(repoRoot, "node_modules/.bin/tsc6"), ["-p", "tsconfig.classic-declaration-consumer.json"], fixtureRoot);

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
  const cssDeclaration = readFileSync(cssDeclarationFile, "utf8");
  assert.match(cssDeclaration, /readonly "error-state": string/u);
  assert.doesNotMatch(cssDeclaration, /Record<string, string>/u);
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
  await exerciseWarmCssModuleSession();
}

await main();
