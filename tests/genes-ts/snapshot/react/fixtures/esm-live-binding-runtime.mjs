import {replaceParent} from "./esm-live-binding-exporter.mjs";

export function jsx(type, props) {
  if (type === "Child") {
    replaceParent();
  }
  return {type, props};
}
