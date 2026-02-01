export function main(): void {
  let x = 1;
  x += 2;
  x -= 1;

  const a = x++;
  const b = ++x;

  const s0 = "a";
  const s1 = s0 + "b";

  const label = x > 2 ? "big" : "small";
  const t = typeof label;

  const n = -x;
  const p = +x;
  const not = !false;

  console.log(x);
  console.log(a);
  console.log(b);
  console.log(s1);
  console.log(label);
  console.log(t);
  console.log(n);
  console.log(p);
  console.log(not);
}

