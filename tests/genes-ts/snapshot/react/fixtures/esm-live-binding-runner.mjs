import {
  Parent,
  resetParent
} from "./esm-live-binding-exporter.mjs";
import {jsx} from "./esm-live-binding-runtime.mjs";

resetParent();
const nested = jsx(Parent, {children: jsx("Child", {})});

resetParent();
const child = jsx("Child", {});
const scheduled = jsx(Parent, {children: child});

console.log(JSON.stringify({
  nestedParent: nested.type,
  scheduledParent: scheduled.type
}));
