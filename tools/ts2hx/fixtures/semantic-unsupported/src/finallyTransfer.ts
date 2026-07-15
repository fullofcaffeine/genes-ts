export function protectedReturn(): number {
  try {
    return 1;
  } finally {
    // The finalizer itself is harmless; returning across its callback boundary
    // is the unsupported completion that strict mode must diagnose.
    const completed = true;
    if (!completed) throw new Error("unreachable");
  }
}
