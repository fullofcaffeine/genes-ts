export function skip(value: number): number {
  let count = 0;
  outer: while (count < 2) {
    count++;
    switch (value) {
      case 1:
        continue outer;
      default:
        break;
    }
  }
  return count;
}
