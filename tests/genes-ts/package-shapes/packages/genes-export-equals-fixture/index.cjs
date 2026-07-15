class ExportEqualsConstructor {
  constructor(label) {
    this.label = label;
  }

  close() {
    return `closed:${this.label}`;
  }
}

ExportEqualsConstructor.version = "fixture-1";

module.exports = ExportEqualsConstructor;
