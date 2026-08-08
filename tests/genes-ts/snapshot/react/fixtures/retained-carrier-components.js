import { createElement } from "react";

const order = [];

export function recordCarrierProp(value) {
  order.push("prop");
  return value.toUpperCase();
}

export function recordCarrierChild(value) {
  order.push("child");
  return value.toLowerCase();
}

export function carrierTranscript() {
  return order.join(",");
}

function Child() {
  order.push("child-render");
  return createElement("span", null, "child");
}

export function DirectParent(props) {
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
