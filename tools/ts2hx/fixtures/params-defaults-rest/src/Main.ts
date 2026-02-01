export function defaults(a: number = 1, b: string = "x"): number {
  return a + b.length;
}

export function restNums(start: number = 0, ...nums: number[]): number {
  return start + nums.length;
}

export const restArrow: (...items: Array<string>) => number = (...items: Array<string>): number => {
  return items.length;
};

export class C {
  method(a: string = "hi", b?: string, ...rest: string[]): number {
    const bb = b === undefined ? 0 : b.length;
    return a.length + bb + rest.length;
  }

  static stat(x: number = 3, ...rest: Array<number>): number {
    return x + rest.length;
  }
}

export function main(): void {
  defaults();
  restNums();
  restArrow();
  new C().method();
  C.stat();
}
