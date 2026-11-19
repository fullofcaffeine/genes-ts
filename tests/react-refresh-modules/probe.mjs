// Runtime probe for one compiled build of the react-refresh-modules fixture.
//
// It prints one JSON line: the module load order, the server-rendered HTML,
// and, for each component module, whether React Fast Refresh would accept a
// hot update of that module.
//
// The hot-update check copies the rule of `@vitejs/plugin-react` 6.0.4
// (`refresh-runtime.js`, `validateRefreshBoundaryAndEnqueueUpdate`): every
// export of the new module instance must look like a component, or must be
// the same value as in the old instance. A dev server re-runs only the edited
// module; its imports keep their old instances. Importing the same file with a
// new query string does exactly that in Node.
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

console.log(JSON.stringify({ loadOrder, html, hotUpdates }));
