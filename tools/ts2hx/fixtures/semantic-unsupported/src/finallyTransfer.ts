export async function protectedReturn(): Promise<number> {
  try {
    return 1;
  } finally {
    // Synchronous return normalization is staged separately. Async finally
    // also crosses the Async macro's scheduling/return rewrite and therefore
    // keeps the stable fail-closed diagnostic until it has its own design.
    await Promise.resolve();
  }
}
