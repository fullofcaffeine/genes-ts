import {createElement} from "react";

export default function Parent(props) {
  return createElement("section", null, props.children);
}

export function NamedParent(props) {
  return createElement("nav", null, props.children);
}
