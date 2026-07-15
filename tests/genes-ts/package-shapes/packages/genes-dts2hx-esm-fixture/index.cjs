const {createFeature} = require("./feature.cjs");

class Formatter {
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

module.exports = {
  version: "esm-fixture-1",
  Formatter,
  createFeature
};
