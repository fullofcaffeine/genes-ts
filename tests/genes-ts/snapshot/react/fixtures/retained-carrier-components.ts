import { createElement, type ReactNode } from "react";

const order: string[] = [];

export function recordCarrierProp(value: string): string {
  order.push("prop");
  return value.toUpperCase();
}

export function recordCarrierChild(value: string): string {
  order.push("child");
  return value.toLowerCase();
}

export function carrierTranscript(): string {
  return order.join(",");
}

function Child(): ReactNode {
  order.push("child-render");
  return createElement("span", null, "child");
}

interface ParentProps {
  readonly children?: ReactNode;
  readonly label?: string;
  readonly value?: string;
}

export function DirectParent(props: ParentProps): ReactNode {
  order.push("parent-render");
  return createElement("section", { "data-carrier": "retained" }, props.children);
}

export default new Proxy({ Child }, {
  get(target, property, receiver) {
    if (property === "Child") {
      order.push("child-tag");
    }
    return Reflect.get(target, property, receiver);
  }
});
