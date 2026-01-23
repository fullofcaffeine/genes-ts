export enum Color {
  Red,
  Green = 2
}

export class Counter {
  public value: number;

  constructor(initial: number) {
    this.value = initial;
  }

  public inc(): void {
    this.value = this.value + 1;
  }

  public static example(color: Color): void {
    const c = new Counter(color);
    c.inc();
  }
}

