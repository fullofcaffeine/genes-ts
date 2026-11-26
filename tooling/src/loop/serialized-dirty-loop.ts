export interface SerializedDirtyLoopOptions<Cause> {
  /**
   * The quiet time before a follow-up run: a request that arrives while a
   * run is active starts the next run only after no request came for this
   * long. Bursts of saves then end in one run, not in one run for each save.
   */
  readonly debounceMs: number;
  /**
   * The delay before the first run after an idle period. Default
   * `debounceMs`. A small value (for example 10 ms) starts the build of a
   * single save at once and still joins the writes of one save; a request
   * in that delay restarts it.
   */
  readonly startDelayMs?: number;
  /**
   * Returns the quiet time before a follow-up run of the pending `cause`,
   * instead of `debounceMs`. Default: `debounceMs` for every cause.
   *
   * Why: some follow-up runs start with a cheap step that should run at
   * once. Example: the development session's module-first path starts a
   * follow-up whose first step is a module request after the short start
   * delay, and keeps `debounceMs` as the quiet time before its own program
   * request.
   */
  readonly followUpDelayMs?: (cause: Cause) => number;
  readonly merge: (left: Cause, right: Cause) => Cause;
  readonly run: (cause: Cause) => Promise<void>;
  readonly onError: (error: Error) => void;
}

export type SerializedDirtyLoopState =
  | "idle"
  | "debouncing"
  | "running"
  | "closed";

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Collapses bursts into one run while guaranteeing one newest-state follow-up
 * when requests arrive during the active run.
 *
 * Cause semantics stay with the caller. `merge` must be associative so the
 * observable cause does not depend on burst grouping.
 */
export class SerializedDirtyLoop<Cause> {
  readonly #options: SerializedDirtyLoopOptions<Cause>;
  #state: SerializedDirtyLoopState = "idle";
  #pending!: Cause;
  #hasPending = false;
  #lastRequestAt = 0;
  #timer: NodeJS.Timeout | null = null;
  /** True while the timer waits for the quiet time of a follow-up run. */
  #followUp = false;
  #active: Promise<void> | null = null;
  #idleWaiters: Array<() => void> = [];

  constructor(options: SerializedDirtyLoopOptions<Cause>) {
    if (!Number.isInteger(options.debounceMs) || options.debounceMs < 0) {
      throw new Error(
        "SerializedDirtyLoop debounceMs must be a non-negative integer",
      );
    }
    if (
      options.startDelayMs !== undefined &&
      (!Number.isInteger(options.startDelayMs) || options.startDelayMs < 0)
    ) {
      throw new Error(
        "SerializedDirtyLoop startDelayMs must be a non-negative integer",
      );
    }
    this.#options = options;
  }

  get state(): SerializedDirtyLoopState {
    return this.#state;
  }

  request(cause: Cause): void {
    if (this.#state === "closed") {
      return;
    }
    this.#pending = this.#hasPending
      ? this.#options.merge(this.#pending, cause)
      : cause;
    this.#hasPending = true;
    this.#lastRequestAt = Date.now();
    if (this.#state === "running") {
      return;
    }
    this.#schedule(
      this.#followUp
        ? this.#followUpDelay()
        : (this.#options.startDelayMs ?? this.#options.debounceMs),
      this.#followUp,
    );
  }

  /** The quiet time before a follow-up run of the pending cause. */
  #followUpDelay(): number {
    const delay = this.#options.followUpDelayMs?.(this.#pending);
    return delay === undefined || !Number.isFinite(delay) || delay < 0
      ? this.#options.debounceMs
      : delay;
  }

  async waitForIdle(): Promise<void> {
    if (this.#state === "closed" || this.#isIdle()) {
      return;
    }
    await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
  }

  async close(): Promise<void> {
    if (this.#state !== "closed") {
      if (this.#timer !== null) {
        clearTimeout(this.#timer);
        this.#timer = null;
      }
      this.#followUp = false;
      this.#hasPending = false;
      this.#state = "closed";
    }
    if (this.#active !== null) {
      await this.#active;
    }
    this.#resolveIdle();
  }

  #isIdle(): boolean {
    return (
      this.#state === "idle" &&
      !this.#hasPending &&
      this.#timer === null &&
      this.#active === null
    );
  }

  #schedule(delay: number, followUp: boolean): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
    }
    this.#state = "debouncing";
    this.#followUp = followUp;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#followUp = false;
      this.#start();
    }, delay);
  }

  #start(): void {
    if (this.#state === "closed" || this.#active !== null) {
      return;
    }
    if (!this.#hasPending) {
      this.#state = "idle";
      this.#resolveIdle();
      return;
    }
    const cause = this.#pending;
    this.#hasPending = false;
    this.#state = "running";
    const active = Promise.resolve()
      .then(() => this.#options.run(cause))
      .catch((error: unknown) => this.#options.onError(asError(error)))
      .finally(() => {
        this.#active = null;
        if (this.#state === "closed") {
          this.#resolveIdle();
          return;
        }
        if (!this.#hasPending) {
          this.#state = "idle";
          this.#resolveIdle();
          return;
        }
        const elapsed = Math.max(0, Date.now() - this.#lastRequestAt);
        this.#schedule(
          Math.max(0, this.#followUpDelay() - elapsed),
          true,
        );
      });
    this.#active = active;
  }

  #resolveIdle(): void {
    const waiters = this.#idleWaiters;
    this.#idleWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }
}
