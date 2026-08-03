import {createElement} from "react";

export default function Child() {
  return createElement("span", null, "child");
}

export function NamedChild() {
  return createElement("i", null, "named");
}
