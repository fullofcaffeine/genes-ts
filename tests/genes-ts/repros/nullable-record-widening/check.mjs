import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runTypeScriptMatrix } from "../toolchains.mjs";

const fixture = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(fixture, "../../../..");
const relative = path.relative(root, fixture);
const run = (command, args) =>
  execFileSync(command, args, { cwd: root, stdio: "inherit" });

rmSync(path.join(fixture, "out"), { recursive: true, force: true });
run("haxe", [`${relative}/build-ts.hxml`]);
const source = readFileSync(path.join(fixture, "out/typescript/NullableRecordProbe.ts"), "utf8");
assert.ok(!source.includes("unsafeCast"), "Same-record widening must not need an unsafe assertion");
assert.ok(source.includes("NullableRecordProbe.accept(request.review)"), "Direct calls keep their original expression");
runTypeScriptMatrix(["-p", `${relative}/tsconfig.json`]);
runTypeScriptMatrix(["-p", `${relative}/tsconfig.consumer.json`]);
run(process.execPath, [`${relative}/out/runtime/out/typescript/index.js`]);
run(process.execPath, [`${relative}/runtime.mjs`, `${relative}/out/runtime/out/typescript/NullableRecordProbe.js`]);
run("haxe", [`${relative}/build-classic.hxml`]);
run(process.execPath, [`${relative}/out/classic/index.js`]);
run(process.execPath, [`${relative}/runtime.mjs`, `${relative}/out/classic/NullableRecordProbe.js`]);
console.log("Named record widening: type proof, strict consumers and both runtimes passed.");
