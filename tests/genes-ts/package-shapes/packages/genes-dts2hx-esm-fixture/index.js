import {createFeature} from "./feature.js";

export const version = "esm-fixture-1";

export class Formatter {
  constructor(prefix) {
    this.prefix = prefix;
  }

  format(value) {
    return `${this.prefix}:${value}`;
  }

  feature(name) {
    return createFeature(name);
  }
}

export {createFeature};
