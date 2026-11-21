// Runtime probe for one compiled build of the react-refresh-modules fixture.
//
// It prints one JSON line: the module load order, the server-rendered HTML,
// for each component module whether React Fast Refresh would accept a hot
// update of that module, the same check for an edit of the `Panel.fields.js`
// sibling, the runtime exports that break the rule, and the HTML of the
// element that a dynamic import of a split module makes.
//
// The hot-update check copies the rule of `@vitejs/plugin-react` 6.0.4
// (`refresh-runtime.js`, `validateRefreshBoundaryAndEnqueueUpdate`): every
// export of the new module instance must look like a component, or must be
// the same value as in the old instance. A dev server re-runs only the edited
// module; its imports keep their old instances. Importing the same file with a
// new query string does exactly that in Node.
//
// An edit of a sibling (`X.fields.js`) is checked the way Vite propagates it:
// the sibling and each module that imports it get new instances, and every
// such importer must pass the rule. A resolve hook gives an import inside
// such a new instance the new instance of the modules in the edit.
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const dist = path.resolve(process.argv[2]);
const url = (relative) => pathToFileURL(path.join(dist, relative)).href;

// Copied from react-refresh (MIT), as shipped in @vitejs/plugin-react 6.0.4.
function isLikelyComponentType(type) {
  switch (typeof type) {
    case "function": {
      if (type.prototype != null) {
        if (type.prototype.isReactComponent) return true;
        const ownNames = Object.getOwnPropertyNames(type.prototype);
        if (ownNames.length > 1 || ownNames[0] !== "constructor") return false;
        if (type.prototype.__proto__ !== Object.prototype) return false;
      }
      const name = type.name || type.displayName;
      return typeof name === "string" && /^[A-Z]/.test(name);
    }
    case "object":
      return false;
    default:
      return false;
  }
}

function refreshVerdict(previous, next) {
  for (const key in next) {
    const value = next[key];
    if (isLikelyComponentType(value)) continue;
    if (previous[key] === value) continue;
    return `incompatible:${key}`;
  }
  return "accepted";
}

function exportsComponent(namespace) {
  return Object.values(namespace).some((value) => isLikelyComponentType(value));
}

// The files of one sibling edit, as URLs without a query, and its query tag.
let edit = null;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (edit !== null && context.parentURL?.endsWith(`?${edit.tag}`) && edit.files.has(result.url))
      return { ...result, url: `${result.url}?${edit.tag}` };
    return result;
  }
});

await import(url("index.js"));
const { LoadLog } = await import(url("refresh/LoadLog.js"));
const loadOrder = [...LoadLog.entries];
const { App } = await import(url("refresh/App.js"));
const html = renderToString(createElement(App));

const hotUpdates = {};
for (const name of ["Panel", "App", "Greeting"]) {
  const previous = await import(url(`refresh/${name}.js`));
  const next = await import(url(`refresh/${name}.js`) + "?hot=1");
  hotUpdates[name] = refreshVerdict(previous, next);
}

// Runtime exports that break the rule in a module that exports a component.
// Such a module rejects every update of a value that it exports.
const modules = readdirSync(path.join(dist, "refresh"))
  .filter((file) => file.endsWith(".js"))
  .map((file) => file.slice(0, -".js".length))
  .sort();
const mixedExports = {};
for (const name of modules) {
  const namespace = await import(url(`refresh/${name}.js`));
  if (!exportsComponent(namespace)) continue;
  const others = Object.keys(namespace).filter((key) => !isLikelyComponentType(namespace[key]));
  if (others.length > 0) mixedExports[name] = others.sort();
}

// An edit of the Panel.fields.js sibling (only in a split build). Vite updates
// each importer that exports a component; one that does not passes the update
// on to its own importers, up to the entry module, which reloads the page.
let siblingEdit = null;
if (modules.includes("Panel.fields")) {
  const sibling = url("refresh/Panel.fields.js");
  const importers = modules.filter((name) => readFileSync(path.join(dist, "refresh", `${name}.js`), "utf8")
    .includes('from "./Panel.fields.js"'));
  edit = { tag: "edit=1", files: new Set([sibling, ...importers.map((name) => url(`refresh/${name}.js`))]) };
  const verdicts = {};
  for (const name of importers) {
    const previous = await import(url(`refresh/${name}.js`));
    const next = await import(`${url(`refresh/${name}.js`)}?${edit.tag}`);
    verdicts[name] = exportsComponent(next) ? refreshVerdict(previous, next) : "not-a-boundary";
  }
  // The new App instance renders through the new sibling and the slots that
  // the new Panel instance set.
  const { App: nextApp } = await import(`${url("refresh/App.js")}?${edit.tag}`);
  siblingEdit = { verdicts, sameHtml: renderToString(createElement(nextApp)) === html };
  edit = null;
}

// A dynamic import of the split module Lazy must find `LazyEntry`.
const { Main } = await import(url("refresh/Main.js"));
const lazyHtml = await new Promise((resolve, reject) => {
  Main.loadLazy((element) => resolve(renderToString(element)));
  setTimeout(() => reject(new Error("loadLazy did not call back")), 5000).unref();
});

console.log(JSON.stringify({ loadOrder, html, hotUpdates, mixedExports, siblingEdit, lazyHtml }));
