/**
 * Readiness budgets for acceptance-test helper processes.
 *
 * These values are not product latency targets. They let successful fresh
 * Node processes start on a contended host while fault-specific tests retain
 * their short, explicit deadlines.
 */
export const acceptanceFixtureStartupTimeoutMs = 30_000;
export const acceptanceFixtureCompletionTimeoutMs = 2 * acceptanceFixtureStartupTimeoutMs;
