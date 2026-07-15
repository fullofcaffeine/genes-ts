class Driver {
  static version = "cjs-fixture-1";

  constructor(label) {
    this.label = label;
  }

  close() {
    return `closed:${this.label}`;
  }
}

module.exports = Driver;
