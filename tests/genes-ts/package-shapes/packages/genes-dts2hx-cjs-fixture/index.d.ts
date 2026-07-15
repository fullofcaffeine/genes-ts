declare class Driver {
  static readonly version: "cjs-fixture-1";
  constructor(label: string);
  readonly label: string;
  close(): string;
}

export = Driver;
