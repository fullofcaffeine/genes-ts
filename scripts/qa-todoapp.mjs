import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const exampleRoot = path.join(repoRoot, "examples", "todoapp");

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...opts
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => resolve(addr.port));
    });
  });
}

async function waitForHealth(baseUrl, { timeoutMs }) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { method: "GET" });
      if (res.ok) {
        const json = await res.json();
        if (json && json.ok === true) return;
      }
    } catch {
      // ignore until timeout
    }
    await sleep(200);
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
}

async function requestJson(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body)
  });
  let json = null;
  if (res.status !== 204) {
    const text = await res.text();
    json = text.length ? JSON.parse(text) : null;
  }
  return { status: res.status, ok: res.ok, json };
}

function killProcessTree(child) {
  if (!child || child.exitCode != null) return;

  if (process.platform !== "win32" && child.pid) {
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

function usage() {
  console.log(
    [
      "Usage: node scripts/qa-todoapp.mjs [--skip-build] [--playwright]",
      "",
      "Env:",
      "  QA_TIMEOUT_MS=30000      Health timeout (default 30000)",
      "  QA_PLAYWRIGHT=1          Enable Playwright E2E",
      "  PLAYWRIGHT_VERSION=...   Override Playwright version (default pinned in script)",
      "  PLAYWRIGHT_BROWSERS_PATH=...  Browser cache path"
    ].join("\n")
  );
}

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  usage();
  process.exit(0);
}

if (typeof fetch !== "function") {
  throw new Error("Node 18+ required (global fetch missing).");
}

const skipBuild = args.has("--skip-build") || process.env.QA_SKIP_BUILD === "1";
const withPlaywright = args.has("--playwright") || process.env.QA_PLAYWRIGHT === "1";
const timeoutMs = Number.parseInt(process.env.QA_TIMEOUT_MS ?? "30000", 10);

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "genes-ts-todoapp-"));
const dataPath = path.join(tmpRoot, "data.json");
writeFileSync(dataPath, JSON.stringify({ todos: [] }, null, 2), "utf8");

const port = await pickFreePort();
const baseUrl = `http://localhost:${port}`;

let server = null;
let serverLog = "";

try {
  if (!skipBuild) {
    run("node", ["scripts/build-example-todoapp.mjs"]);
  }

  server = spawn("node", [path.join(exampleRoot, "server", "dist", "index.js")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      TODOAPP_DATA_PATH: dataPath
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32"
  });

  server.stdout.on("data", (buf) => {
    serverLog += buf.toString("utf8");
    serverLog = serverLog.slice(-200_000);
  });
  server.stderr.on("data", (buf) => {
    serverLog += buf.toString("utf8");
    serverLog = serverLog.slice(-200_000);
  });

  await waitForHealth(baseUrl, { timeoutMs });

  const health = await requestJson("GET", `${baseUrl}/api/health`);
  if (!(health.ok && health.json && health.json.ok === true)) {
    throw new Error(`Unexpected /api/health response: ${JSON.stringify(health)}`);
  }

  const created = await requestJson("POST", `${baseUrl}/api/todos`, { title: "Write tests" });
  if (!(created.status === 201 && created.json && created.json.todo && created.json.todo.id)) {
    throw new Error(`Unexpected POST /api/todos response: ${JSON.stringify(created)}`);
  }
  const todoId = created.json.todo.id;

  const list1 = await requestJson("GET", `${baseUrl}/api/todos`);
  if (!(list1.ok && list1.json && Array.isArray(list1.json.todos) && list1.json.todos.length === 1)) {
    throw new Error(`Unexpected GET /api/todos response: ${JSON.stringify(list1)}`);
  }

  const updated = await requestJson("PATCH", `${baseUrl}/api/todos/${todoId}`, { completed: true });
  if (!(updated.ok && updated.json && updated.json.todo && updated.json.todo.completed === true)) {
    throw new Error(`Unexpected PATCH /api/todos/:id response: ${JSON.stringify(updated)}`);
  }

  const del = await requestJson("DELETE", `${baseUrl}/api/todos/${todoId}`);
  if (del.status !== 204) {
    throw new Error(`Unexpected DELETE /api/todos/:id response: ${JSON.stringify(del)}`);
  }

  const after = await requestJson("GET", `${baseUrl}/api/todos/${todoId}`);
  if (after.status !== 404) {
    throw new Error(`Expected 404 after deletion, got: ${JSON.stringify(after)}`);
  }

  const htmlRes = await fetch(`${baseUrl}/`, { method: "GET" });
  const html = await htmlRes.text();
  if (!htmlRes.ok || !html.includes('<div id="root"></div>')) {
    throw new Error(`Unexpected GET / HTML (status=${htmlRes.status})`);
  }

  if (withPlaywright) {
    run("node", ["scripts/build-todoapp-e2e.mjs"]);

    const pwInstallArgs = ["install"];
    if (process.env.CI) pwInstallArgs.push("--with-deps");
    pwInstallArgs.push("chromium");
    run("npx", ["playwright", ...pwInstallArgs]);

    run(
      "npx",
      ["playwright", "test", "-c", "examples/todoapp/e2e/playwright.config.mjs"],
      { env: { ...process.env, BASE_URL: baseUrl } }
    );
  }

  console.log(`ok (${baseUrl})`);
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
      new Promise((resolve) => server.once("exit", resolve)),
      sleep(2000)
    ]);
    if (server.exitCode == null) {
      try {
        if (process.platform !== "win32" && server.pid) {
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
