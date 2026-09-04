/**
 * Readiness budgets for acceptance-test helper processes.
 *
 * These values are not product latency targets. They let successful fresh
 * Node processes start on a contended host while fault-specific tests retain
 * their short, explicit deadlines.
 */
export const acceptanceFixtureStartupTimeoutMs = 30_000;
// A nested owner can consume two complete startup windows while it publishes
// log and state evidence. Keep one more startup-sized window for console
// settlement, cleanup, publication overhead, and process exit.
export const acceptanceFixtureCompletionTimeoutMs = 3 * acceptanceFixtureStartupTimeoutMs;
