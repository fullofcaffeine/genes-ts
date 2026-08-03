export class NamespaceProcess {
  readonly label: string;
  close(): string;
}

export function spawn(label: string): NamespaceProcess;
