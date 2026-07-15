declare namespace ExportEqualsConstructor {
  interface Instance {
    readonly label: string;
    close(): string;
  }

  interface Constructor {
    new(label: string): Instance;
    readonly version: string;
  }
}

declare const ExportEqualsConstructor: ExportEqualsConstructor.Constructor;

export = ExportEqualsConstructor;
