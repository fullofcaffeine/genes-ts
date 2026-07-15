export class Counter {
  public value(): number {
    return 1;
  }
}

export function mutatePrototype(): void {
  Counter.prototype.value = function (): number {
    return 2;
  };
}
