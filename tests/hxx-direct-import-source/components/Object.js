import {createElement} from "react";

const reads = [];

function Parent(props) {
  return createElement("aside", null, props.children);
}

function Child() {
  return createElement("b", null, "object");
}

const components = {
  get Parent() {
    reads.push("object-parent-read");
    return Parent;
  },
  get Child() {
    reads.push("object-child-read");
    return Child;
  }
};

export default components;

export function takeReads() {
  return reads.splice(0);
}
