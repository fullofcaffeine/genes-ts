console.log("TYPED_PACKAGE_INIT");

export default function greet(name) {
  return `Hello ${name}`;
}

export function add(left, right) {
  return left + right;
}

export function notify(message) {
  console.log(`TYPED_PACKAGE_NOTIFY:${message}`);
}

export const PI = 3.14;
export const label = "typed";
export const enabled = true;
export const unused = 99;
