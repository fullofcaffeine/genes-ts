import { createElement } from "react";

const reads = [];

function Parent(props) {
  return createElement("section", { "data-order": reads.join(",") }, props.children);
}

function Child() {
  return createElement("span", null, "child");
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
