export function main(): void {
  const base = {
    a: 1,
    inc(x: number): number {
      return x + 1;
    }
  };

  const extra = { b: 2 };
  const merged = { ...base, ...extra, c: 3 };

  console.log(merged.a);
  console.log(merged.inc(1));
  console.log(merged.b);
  console.log(merged.c);
}

