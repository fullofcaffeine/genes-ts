export class NamespaceProcess {
  constructor(label) {
    this.label = label;
  }

  close() {
    return `secondary:${this.label}`;
  }
}

export function spawn(label) {
  return new NamespaceProcess(label);
}
