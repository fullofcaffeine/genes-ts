const base = 1;

function inc(x: number): number {
  return x + 1;
}

class Foo {
  static get(): number {
    return 123;
  }
}

export { base as Base, inc, Foo as RenamedFoo };
export { base as default };

export function main(): void {
  console.log(base);
  console.log(inc(1));
  console.log(Foo.get());
}

