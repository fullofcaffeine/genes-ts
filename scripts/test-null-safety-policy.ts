import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

type EscapeRecord = {
  path: string;
  owner: string;
  statement: string;
  reason: string;
  containment: string;
};

type EscapeInventory = {
  scope: string;
  mode: string;
  recursive: boolean;
  escapes: EscapeRecord[];
};

type ObservedEscape = {
  path: string;
  statement: string;
  line: number;
};

const canonicalEscapeMetadata = "@:nullSafety(Off)";
const nullSafetyMetadata = /@:\s*nullSafety\b/;
const broadEscapeTarget =
  /^(?:\{|(?:(?:public|private|static|inline|extern|override|macro|dynamic|overload)\s+)*(?:class|interface|abstract|enum|typedef|function|var|final)\b|(?:if|switch|try|for|while|do)\b)/;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function haxeFiles(directory: string): string[] {
  const absolute = path.join(repoRoot, directory);
  return readdirSync(absolute)
    .flatMap((entry) => {
      const relative = path.posix.join(directory, entry);
      return statSync(path.join(repoRoot, relative)).isDirectory()
        ? haxeFiles(relative)
        : relative.endsWith(".hx") ? [relative] : [];
    })
    .sort();
}

function validateMetadataLine(metadataLine: string, location: string): void {
  assert(metadataLine === canonicalEscapeMetadata,
    `${location}: null-safety escapes must use standalone canonical \`${canonicalEscapeMetadata}\``);
}

function validateGuardedStatement(statement: string, location: string): void {
  assert(statement.length > 0,
    `${location}: null-safety escape has no guarded statement`);
  assert(!statement.startsWith("@:"),
    `${location}: null-safety escapes cannot wrap other metadata`);
  assert(!broadEscapeTarget.test(statement),
    `${location}: block, declaration, and compound-control null-safety escapes are forbidden`);
}

function assertRejected(action: () => void, label: string): void {
  let rejected = false;
  try {
    action();
  } catch {
    rejected = true;
  }
  assert(rejected, `Null-safety policy self-test did not reject ${label}`);
}

/**
 * Proves the source scanner rejects common spellings that could otherwise
 * bypass a text-only policy.
 *
 * Why: the repository normally contains only valid reviewed escapes. Without
 * negative examples, a scanner regression could make that tree pass while no
 * longer detecting whitespace variants or broad declarations.
 */
function testEscapeSyntaxPolicy(): void {
  for (const metadata of [
    "@:nullSafety( Off )",
    "@:nullSafety (Off)",
    "@:nullSafety(Strict)",
    "@:nullSafety(Off) return value;"
  ]) {
    assert(nullSafetyMetadata.test(metadata),
      `Null-safety metadata detector missed test case: ${metadata}`);
    assertRejected(
      () => validateMetadataLine(metadata, "<self-test>"),
      `non-canonical metadata \`${metadata}\``
    );
  }

  for (const statement of [
    "@:keep",
    "{",
    "static var value: Null<String>;",
    "public dynamic function read(): Null<String> {}",
    "if (ready) {",
    "switch value {",
    "try {",
    "for (value in values) {",
    "while (ready) {",
    "do {"
  ]) {
    assertRejected(
      () => validateGuardedStatement(statement, "<self-test>"),
      `broad target \`${statement}\``
    );
  }

  validateGuardedStatement("return value;", "<self-test>");
  validateGuardedStatement("value = data.value;", "<self-test>");
}

/**
 * Finds every local null-safety escape in the compiler-owned `genes.*` tree.
 *
 * Why: a broad or undocumented `@:nullSafety(Off)` can make the new compiler
 * source-quality gate look green while silently excluding the code that needs
 * review most. Line numbers are diagnostic only because harmless edits move
 * them; the reviewed identity is the source path plus the guarded statement.
 */
function observedEscapes(): ObservedEscape[] {
  const result: ObservedEscape[] = [];
  for (const relativePath of haxeFiles("src/genes")) {
    const lines = read(relativePath).split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const metadataLine = lines[index]?.trim() ?? "";
      if (!nullSafetyMetadata.test(metadataLine)) continue;
      const location = `${relativePath}:${index + 1}`;
      validateMetadataLine(metadataLine, location);
      const indentation = lines[index]?.match(/^\s*/)?.[0].length ?? 0;
      assert(indentation > 0,
        `${location}: package/module-wide null-safety escapes are forbidden`);

      let statementIndex = index + 1;
      while (statementIndex < lines.length && lines[statementIndex]?.trim() === "")
        statementIndex++;
      const statement = lines[statementIndex]?.trim() ?? "";
      validateGuardedStatement(statement, location);
      result.push({ path: relativePath, statement, line: index + 1 });
    }
  }
  return result;
}

/**
 * Enforces the reviewed scope, macro order, and smallest-possible escape list.
 *
 * Haxe applies package metadata only before a type is loaded, so the
 * null-safety macro must precede `Generator.use()`. The JSON inventory is kept
 * machine-readable so adding or broadening an escape requires an explicit,
 * reviewable policy change rather than only making the compiler green.
 */
function main(): void {
  testEscapeSyntaxPolicy();
  const inventory = JSON.parse(read("config/null-safety-escapes.json")) as EscapeInventory;
  assert(inventory.scope === "genes", "Null-safety scope must remain the compiler-owned genes package");
  assert(inventory.mode === "Loose", "Genes must use the reviewed Loose null-safety baseline");
  assert(inventory.recursive === true, "Genes null safety must include owned subpackages");

  const extraParams = read("extraParams.hxml");
  const nullSafety = `--macro haxe.macro.Compiler.nullSafety("${inventory.scope}", ${inventory.mode}, ${inventory.recursive})`;
  const nullSafetyIndex = extraParams.indexOf(nullSafety);
  const generatorIndex = extraParams.indexOf("--macro genes.Generator.use()");
  assert(nullSafetyIndex >= 0, `extraParams.hxml is missing the reviewed macro: ${nullSafety}`);
  assert(generatorIndex >= 0 && nullSafetyIndex < generatorIndex,
    "Haxe null safety must be installed before Generator.use() can load genes.* types");

  const expected = new Map<string, EscapeRecord>();
  for (const escape of inventory.escapes) {
    for (const field of ["path", "owner", "statement", "reason", "containment"] as const)
      assert(escape[field].trim().length > 0,
        `Null-safety escape has an empty ${field}: ${escape.path || "<unknown>"}`);
    const key = `${escape.path}\0${escape.statement}`;
    assert(!expected.has(key), `Duplicate null-safety escape inventory entry: ${escape.path}`);
    expected.set(key, escape);
  }

  const observed = observedEscapes();
  for (const escape of observed) {
    const key = `${escape.path}\0${escape.statement}`;
    assert(expected.delete(key),
      `${escape.path}:${escape.line}: unreviewed @:nullSafety(Off) before \`${escape.statement}\``);
  }
  assert(expected.size === 0,
    `Null-safety inventory contains stale entries:\n${[...expected.values()]
      .map((entry) => `- ${entry.path}: ${entry.statement}`)
      .join("\n")}`);

  process.stdout.write(
    `null-safety-policy:ok (${inventory.scope}.*, ${inventory.mode}, ${observed.length} statement-local escapes)\n`
  );
}

main();
