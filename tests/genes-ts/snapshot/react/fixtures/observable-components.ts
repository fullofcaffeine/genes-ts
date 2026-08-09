import { createElement, type ReactNode } from "react";

const reads: string[] = [];

interface ParentProps {
  readonly children?: ReactNode;
}

function Parent(props: ParentProps): ReactNode {
  return createElement("section", { "data-order": reads.join(",") }, props.children);
}

function Child(): ReactNode {
  return createElement("span", null, "child");
}

export function DirectParent(props: ParentProps): ReactNode {
  return createElement("section", { "data-import": "direct" }, props.children);
}

export function DirectChild(): ReactNode {
  return createElement("span", null, "direct child");
}

const components = new Proxy({ Parent, Child }, {
  get(target, property, receiver) {
    if (property === "Parent" || property === "Child") {
      reads.push(property);
    }
    return Reflect.get(target, property, receiver);
  }
});

export default components;
