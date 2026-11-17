// Vite dev-server proof for the react-refresh-modules fixture (manual).
//
// Vite is not a Genes test dependency, so this check is not in CI. Run it from
// a scratch folder that has the pinned packages:
//
//   npm install vite@8.2.6 @vitejs/plugin-react@6.0.4 react@19.2.8 react-dom@19.2.8 playwright
//   node <genes>/tests/react-refresh-modules/vite-proof.mjs on|off PORT [component|fields]
//
// It builds a copy of the fixture with Genes, serves it with Vite, opens it in
// headless Chromium, clicks the counter three times, edits Panel.hx (the
// component body, or a non-component function), builds again, and prints
// whether Vite hot-updated the page (no reload, counter kept) as JSON.
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const mode = process.argv[2];
const port = Number(process.argv[3]);
const scenario = process.argv[4] ?? "component";
if (mode !== "on" && mode !== "off") throw new Error("mode must be on or off");
const here = process.cwd();
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const local = createRequire(path.join(here, "package.json"));
const load = (name) => import(pathToFileURL(local.resolve(name)).href);
const { createServer } = await load("vite");
const react = (await load("@vitejs/plugin-react")).default;
const playwright = await load("playwright");
const chromium = playwright.chromium ?? playwright.default.chromium;
const srcCopy = path.join(here, `src-${mode}`);
const gen = path.join(here, `gen-${mode}`);
const hxml = path.join(here, `build-${mode}.hxml`);

rmSync(srcCopy, { recursive: true, force: true });
rmSync(gen, { recursive: true, force: true });
cpSync(path.join(repo, "tests/react-refresh-modules/src"), srcCopy, { recursive: true });
writeFileSync(hxml, [
  "-lib genes-ts",
  `-cp ${srcCopy}`,
  "-main refresh.Main",
  `-js ${path.join(gen, "index.tsx")}`,
  "-D genes.ts",
  "-D genes.ts.jsx_import_source=react",
  "-D genes.ts.no_extension",
  "-D genes.unchanged_no_rewrite",
  ...(mode === "on" ? ["-D genes.react_refresh_modules"] : []),
  "-dce full",
  ""
].join("\n"));
const build = () => execFileSync("haxe", [hxml], { cwd: repo, stdio: "inherit" });
const digests = () => {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[path.relative(gen, full)] = createHash("sha256").update(readFileSync(full)).digest("hex");
    }
  };
  walk(gen);
  return out;
};
build();
const before = digests();
writeFileSync(path.join(here, `index-${mode}.html`),
  `<!doctype html><html><body><div id="root"></div><script type="module" src="/gen-${mode}/index.tsx"></script></body></html>\n`);

const viteLog = [];
const logger = {
  hasWarned: false,
  info: (m) => viteLog.push(`info ${m}`),
  warn: (m) => viteLog.push(`warn ${m}`),
  warnOnce: (m) => viteLog.push(`warn ${m}`),
  error: (m) => viteLog.push(`error ${m}`),
  clearScreen: () => {},
  hasErrorLogged: () => false
};
const server = await createServer({
  root: here,
  configFile: false,
  cacheDir: path.join(here, `.vite-${mode}`),
  plugins: [react()],
  customLogger: logger,
  server: { port, strictPort: true, host: "127.0.0.1" }
});
await server.listen();
const browser = await chromium.launch({ headless: true });
const result = { mode, scenario };
try {
  const page = await browser.newPage();
  const consoleLines = [];
  page.on("console", (m) => consoleLines.push(m.text()));
  let navigations = 0;
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) navigations += 1; });
  await page.goto(`http://127.0.0.1:${port}/index-${mode}.html`);
  await page.waitForSelector("[data-increment]");
  await page.evaluate(() => { window.__proofMarker = "kept"; });
  for (let i = 0; i < 3; i += 1) await page.click("[data-increment]");
  await page.waitForFunction(() => document.querySelector("[data-badge]")?.textContent === "3");
  const navigationsBeforeEdit = navigations;
  viteLog.length = 0;

  // Edit only the component body in the Haxe source, then rebuild.
  const panel = path.join(srcCopy, "refresh/Panel.hx");
  const source = readFileSync(panel, "utf8");
  const edited = scenario === "component"
    ? source.replace('<h1 data-title="">{props.title}</h1>', '<h1 data-title="">{props.title + " (edited)"}</h1>')
    : source.replace("case Calm: 'count $count';", "case Calm: 'total $count';");
  if (edited === source) throw new Error("edit anchor not found");
  writeFileSync(panel, edited);
  const editStart = Date.now();
  build();
  const after = digests();
  result.changedFiles = Object.keys(after).filter((k) => before[k] !== after[k]).sort();
  if (scenario === "component")
    await page.waitForFunction(() => document.querySelector("[data-title]")?.textContent === "Fast Refresh (edited)", null, { timeout: 20000 });
  else
    await page.waitForFunction(() => document.querySelector("[data-increment]")?.textContent?.startsWith("total"), null, { timeout: 20000 });
  result.editVisibleMs = Date.now() - editStart;
  await new Promise((r) => setTimeout(r, 500));
  result.title = await page.textContent("[data-title]");
  result.button = await page.textContent("[data-increment]");
  result.badgeAfterEdit = await page.textContent("[data-badge]");
  result.markerAfterEdit = await page.evaluate(() => window.__proofMarker ?? null);
  result.navigationsAfterEdit = navigations - navigationsBeforeEdit;
  result.viteLog = viteLog.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
  result.consoleLines = consoleLines.filter((l) => /vite|Fast Refresh|hot|reload/i.test(l));
} finally {
  await browser.close();
  await server.close();
}
console.log(JSON.stringify(result, null, 2));
