import {createElement} from "react";

const reads = [];

function Parent(props) {
  return createElement("article", null, props.children);
}

function Child() {
  return createElement("em", null, "dotted");
}

export const Components = {
  get Parent() {
    reads.push("dotted-parent-read");
    return Parent;
  },
  get Child() {
    reads.push("dotted-child-read");
    return Child;
  }
};

export function takeReads() {
  return reads.splice(0);
}
