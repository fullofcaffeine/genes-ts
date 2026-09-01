import {
  execFileSync,
  spawn,
  type ChildProcess,
  type ExecFileSyncOptions,
  type SpawnOptions
} from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { isStableVersionAtLeast, toolchains } from "./toolchains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const exampleRoot = path.join(repoRoot, "examples", "todoapp");
const ownsPrivateProcessGroup = process.platform !== "win32"
  && process.env.GENES_ACCEPTANCE_PROCESS_OWNER !== "1";

function run(cmd: string, args: ReadonlyArray<string>, opts: ExecFileSyncOptions = {}): void {
  execFileSync(cmd, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...opts
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function pickFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => {
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        } else {
          reject(new Error("Unexpected address for ephemeral port server"));
        }
      });
    });
  });
}

async function waitForHealth(baseUrl: string, { timeoutMs }: { timeoutMs: number }): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { method: "GET" });
      if (res.ok) {
        const json: unknown = await res.json();
        if (isRecord(json) && json.ok === true) return;
      }
    } catch {
      // ignore until timeout
    }
    await sleep(200);
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
}

type JsonHttpResponse = { status: number; ok: boolean; json: unknown };

async function requestJson(method: string, url: string, body?: unknown): Promise<JsonHttpResponse> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body)
  });
  let json: unknown = null;
  if (res.status !== 204) {
    const text = await res.text();
    if (text.length) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        // Keep non-JSON error bodies observable so the assertion below reports
        // the real status and response instead of hiding it behind JSON.parse.
        json = text;
      }
    }
  }
  return { status: res.status, ok: res.ok, json };
}

async function requestMalformedJson(url: string): Promise<JsonHttpResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{"
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    // Preserve an unexpected non-JSON response for the assertion diagnostic.
  }
  return { status: res.status, ok: res.ok, json };
}

function assertApiError(
  response: JsonHttpResponse,
  expectedStatus: number,
  expectedError: string,
  label: string
): void {
  if (!(response.status === expectedStatus
    && isRecord(response.json)
    && response.json.error === expectedError)) {
    throw new Error(
      `${label}: expected ${expectedStatus} ${expectedError}, got ${JSON.stringify(response)}`
    );
  }
}

function killProcessTree(child: ChildProcess | null): void {
  if (!child || child.exitCode != null) return;

  if (ownsPrivateProcessGroup && child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // ignore
    }
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
}

function usage(): void {
  console.log(
    [
      "Usage: yarn test:todoapp [--profile ts|classic] [--skip-build] [--playwright]",
      "   or: node scripts/dist/qa-todoapp.js [--profile ts|classic] [--skip-build] [--api-only|--playwright]",
      "",
      "Env:",
      "  QA_TIMEOUT_MS=30000      Health timeout (default 30000)",
      "  QA_PLAYWRIGHT=1          Enable Playwright E2E",
      "  PLAYWRIGHT_VERSION=...   Override Playwright version (default pinned in script)",
      "  PLAYWRIGHT_BROWSERS_PATH=...  Browser cache path"
    ].join("\n")
  );
}

type TodoappProfile = "ts" | "classic";

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
if (args.has("--help") || args.has("-h")) {
  usage();
  process.exit(0);
}

const profileIndex = rawArgs.indexOf("--profile");
const profileValue = profileIndex >= 0 ? rawArgs[profileIndex + 1] : "ts";
if (profileValue !== "ts" && profileValue !== "classic") {
  throw new Error("--profile must be ts or classic");
}
const profile: TodoappProfile = profileValue;

if (!isStableVersionAtLeast(process.versions.node, toolchains.node.minimumRuntime)) {
  throw new Error(
    `Node ${toolchains.node.minimumRuntime}+ required by the React Router 8 Todo harness; `
      + `found ${process.versions.node}.`
  );
}
if (typeof fetch !== "function") {
  throw new Error("The supported Node runtime must provide global fetch.");
}

const skipBuild = args.has("--skip-build") || process.env.QA_SKIP_BUILD === "1";
const withPlaywright = args.has("--playwright") || process.env.QA_PLAYWRIGHT === "1";
const apiOnly = args.has("--api-only");
if (apiOnly && withPlaywright) {
  throw new Error("--api-only and --playwright observe different product surfaces");
}
const skipPlaywrightInstall = args.has("--skip-playwright-install");
const timeoutMs = Number.parseInt(process.env.QA_TIMEOUT_MS ?? "30000", 10);

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "genes-ts-todoapp-"));
const dataPath = path.join(tmpRoot, "data.json");
writeFileSync(dataPath, JSON.stringify({ todos: [] }, null, 2), "utf8");

const port = await pickFreePort();
const baseUrl = `http://localhost:${port}`;

let server: ChildProcess | null = null;
let serverLog = "";

try {
  if (!skipBuild) {
    run("node", [
      profile === "ts"
        ? "scripts/dist/build-example-todoapp.js"
        : "scripts/dist/build-example-todoapp-classic.js"
    ]);
  }

  const webDist = path.join(
    exampleRoot,
    "web",
    profile === "ts" ? "dist" : "classic-dist"
  );
  const serverEntry = path.join(
    exampleRoot,
    "server",
    profile === "ts" ? "dist/index.js" : "classic-src-gen/index.js"
  );

  const spawnOpts: SpawnOptions = {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      TODOAPP_DATA_PATH: dataPath,
      TODOAPP_WEB_DIST: webDist
    },
    stdio: ["ignore", "pipe", "pipe"],
    // The outer acceptance owner already provides one private process group.
    // Keep this server inside it so an abrupt gate stop cannot orphan a
    // nested process group.
    detached: ownsPrivateProcessGroup
  };

  server = spawn("node", [serverEntry], spawnOpts);

  server.stdout?.on("data", (buf: Buffer) => {
    serverLog += buf.toString("utf8");
    serverLog = serverLog.slice(-200_000);
  });
  server.stderr?.on("data", (buf: Buffer) => {
    serverLog += buf.toString("utf8");
    serverLog = serverLog.slice(-200_000);
  });

  await waitForHealth(baseUrl, { timeoutMs });

  const health = await requestJson("GET", `${baseUrl}/api/health`);
  if (!(health.ok && isRecord(health.json) && health.json.ok === true)) {
    throw new Error(`Unexpected /api/health response: ${JSON.stringify(health)}`);
  }

  assertApiError(
    await requestJson("POST", `${baseUrl}/api/todos`, []),
    400,
    "invalid_body",
    "array create body"
  );
  assertApiError(
    await requestJson("POST", `${baseUrl}/api/todos`, 42),
    400,
    "invalid_body",
    "primitive create body"
  );
  assertApiError(
    await requestMalformedJson(`${baseUrl}/api/todos`),
    400,
    "invalid_json",
    "malformed JSON body"
  );
  assertApiError(
    await requestJson("POST", `${baseUrl}/api/todos`, { title: 42 }),
    400,
    "invalid_title",
    "numeric create title"
  );
  assertApiError(
    await requestJson("POST", `${baseUrl}/api/todos`, {
      title: "Unexpected field",
      extra: true
    }),
    400,
    "invalid_body",
    "unknown create field"
  );

  const created = await requestJson("POST", `${baseUrl}/api/todos`, { title: "Write tests" });
  if (!(created.status === 201 && isRecord(created.json) && isRecord(created.json.todo))) {
    throw new Error(`Unexpected POST /api/todos response: ${JSON.stringify(created)}`);
  }
  const todoId = created.json.todo.id;
  if (!(typeof todoId === "string" || typeof todoId === "number")) {
    throw new Error(`Unexpected todo id in response: ${JSON.stringify(created)}`);
  }

  // Store is an importable generated class in both profiles. Verify its
  // mutation methods preserve the same non-blank title invariant even when a
  // target-language consumer calls them without the HTTP decoder.
  const storeModule = path.join(
    exampleRoot,
    "server",
    profile === "ts"
      ? "dist/todo/server/Store.js"
      : "classic-src-gen/todo/server/Store.js"
  );
  const importedStore: unknown = await import(pathToFileURL(storeModule).href);
  if (!isRecord(importedStore) || typeof importedStore.Store !== "function") {
    throw new Error(`Generated Store export is unavailable: ${storeModule}`);
  }
  type StoreConstructor = new (dataPath?: string) => {
    create(title: string): {id: string | number};
    get(id: string | number): {title: string; completed: boolean} | null;
    updateTitle(id: string | number, title: string): unknown;
    updateBoth(id: string | number, title: string, completed: boolean): unknown;
  };
  const Store = importedStore.Store as StoreConstructor;
  const directStore = new Store(path.join(tmpRoot, "direct-store.json"));
  const directTodo = directStore.create("Direct store invariant");
  if (directStore.updateTitle(directTodo.id, "   ") !== null
    || directStore.updateBoth(directTodo.id, "\t", true) !== null) {
    throw new Error("Generated Store accepted a blank title");
  }
  const unchangedDirectTodo = directStore.get(directTodo.id);
  if (unchangedDirectTodo == null
    || unchangedDirectTodo.title !== "Direct store invariant"
    || unchangedDirectTodo.completed !== false) {
    throw new Error(
      `Rejected direct Store update mutated the todo: ${JSON.stringify(unchangedDirectTodo)}`
    );
  }

  const list1 = await requestJson("GET", `${baseUrl}/api/todos`);
  if (!(list1.ok && isRecord(list1.json) && Array.isArray(list1.json.todos) && list1.json.todos.length === 1)) {
    throw new Error(`Unexpected GET /api/todos response: ${JSON.stringify(list1)}`);
  }

  assertApiError(
    await requestJson("GET", `${baseUrl}/api/todos/%20`),
    400,
    "invalid_id",
    "blank todo identifier"
  );

  assertApiError(
    await requestJson("PATCH", `${baseUrl}/api/todos/${todoId}`, { completed: "yes" }),
    400,
    "invalid_patch",
    "non-boolean completed patch"
  );
  assertApiError(
    await requestJson("PATCH", `${baseUrl}/api/todos/${todoId}`, { completed: null }),
    400,
    "invalid_patch",
    "null completed patch"
  );
  assertApiError(
    await requestJson("PATCH", `${baseUrl}/api/todos/${todoId}`, 42),
    400,
    "invalid_patch",
    "primitive patch body"
  );
  assertApiError(
    await requestJson("PATCH", `${baseUrl}/api/todos/${todoId}`, {}),
    400,
    "invalid_patch",
    "empty patch"
  );

  const afterRejectedPatch = await requestJson("GET", `${baseUrl}/api/todos/${todoId}`);
  if (!(afterRejectedPatch.ok
    && isRecord(afterRejectedPatch.json)
    && isRecord(afterRejectedPatch.json.todo)
    && afterRejectedPatch.json.todo.title === "Write tests"
    && afterRejectedPatch.json.todo.completed === false)) {
    throw new Error(
      `Rejected PATCH mutated the todo: ${JSON.stringify(afterRejectedPatch)}`
    );
  }

  const updated = await requestJson("PATCH", `${baseUrl}/api/todos/${todoId}`, { completed: true });
  if (!(updated.ok
    && isRecord(updated.json)
    && isRecord(updated.json.todo)
    && updated.json.todo.title === "Write tests"
    && updated.json.todo.completed === true)) {
    throw new Error(`Unexpected PATCH /api/todos/:id response: ${JSON.stringify(updated)}`);
  }

  const titleOnly = await requestJson("PATCH", `${baseUrl}/api/todos/${todoId}`, {
    title: "Write better tests"
  });
  if (!(titleOnly.ok
    && isRecord(titleOnly.json)
    && isRecord(titleOnly.json.todo)
    && titleOnly.json.todo.title === "Write better tests"
    && titleOnly.json.todo.completed === true)) {
    throw new Error(
      `Title-only PATCH did not preserve completed: ${JSON.stringify(titleOnly)}`
    );
  }

  const del = await requestJson("DELETE", `${baseUrl}/api/todos/${todoId}`);
  if (del.status !== 204) {
    throw new Error(`Unexpected DELETE /api/todos/:id response: ${JSON.stringify(del)}`);
  }

  const after = await requestJson("GET", `${baseUrl}/api/todos/${todoId}`);
  if (after.status !== 404) {
    throw new Error(`Expected 404 after deletion, got: ${JSON.stringify(after)}`);
  }

  if (!apiOnly) {
    const htmlRes = await fetch(`${baseUrl}/`, { method: "GET" });
    const html = await htmlRes.text();
    if (!htmlRes.ok || !html.includes('<div id="root"></div>')) {
      throw new Error(`Unexpected GET / HTML (status=${htmlRes.status})`);
    }
  }

  if (withPlaywright) {
    run("node", ["scripts/dist/build-todoapp-e2e.js"]);

    if (!skipPlaywrightInstall) {
      const pwInstallArgs = ["install"];
      if (process.env.CI) pwInstallArgs.push("--with-deps");
      pwInstallArgs.push("chromium");
      run("npx", ["playwright", ...pwInstallArgs]);
    }

    run("npx", ["playwright", "test", "-c", "examples/todoapp/e2e/playwright.config.ts"], {
      env: { ...process.env, BASE_URL: baseUrl }
    });
  }

  console.log(`ok (${profile}, ${baseUrl})`);
} catch (err) {
  if (serverLog.length) {
    console.error("\n--- todoapp server log (tail) ---\n");
    console.error(serverLog.slice(-20_000));
  }
  throw err;
} finally {
  if (server) {
    killProcessTree(server);
    await Promise.race([
      new Promise<void>((resolve) => server?.once("exit", () => resolve())),
      sleep(2000)
    ]);
    if (server.exitCode == null) {
      try {
        if (ownsPrivateProcessGroup && server.pid) {
          process.kill(-server.pid, "SIGKILL");
        }
      } catch {
        // ignore
      }
      try {
        server.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }

  rmSync(tmpRoot, { recursive: true, force: true });
}
