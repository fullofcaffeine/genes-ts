export function main(): void {
  let x: number;
  let flag: boolean;
  x = 0;
  flag = false;

  while (x < 3) {
    x = x + 1;
  }

  let y = 0;
  do {
    y = y + 1;
  } while (y < 2);

  let label = "";
  switch (y) {
    case 0:
      label = "zero";
      break;
    case 1:
    case 2:
      label = "small";
      break;
    default:
      label = "other";
      break;
  }

  let acc = 0;
  let i = 0;
  while (true) {
    i = i + 1;
    if (i == 2) continue;
    if (i == 4) break;
    acc = acc + i;
  }

  console.log(x);
  console.log(y);
  console.log(label);
  console.log(acc);
  console.log(flag);
}

