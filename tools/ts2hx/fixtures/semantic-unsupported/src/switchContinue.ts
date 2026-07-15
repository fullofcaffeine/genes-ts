export function skip(value: number): number {
  let count = 0;
  while (count < 2) {
    count++;
    switch (value) {
      case 1:
        continue;
      default:
        break;
    }
  }
  return count;
}
