export async function plusOne(x: number): Promise<number> {
  const v = await Promise.resolve(x);
  return v + 1;
}

export async function run(): Promise<number> {
  try {
    const out = await plusOne(1);
    return out;
  } catch (_e) {
    return -1;
  }
}

export function main(): void {
  run().then((v: number) => console.log(v));
}

