export interface SerializedDirtyLoopOptions<Cause> {
  readonly debounceMs: number;
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
  #active: Promise<void> | null = null;
  #idleWaiters: Array<() => void> = [];

  constructor(options: SerializedDirtyLoopOptions<Cause>) {
    if (!Number.isInteger(options.debounceMs) || options.debounceMs < 0) {
      throw new Error(
        "SerializedDirtyLoop debounceMs must be a non-negative integer",
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
    this.#schedule(this.#options.debounceMs);
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

  #schedule(delay: number): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
    }
    this.#state = "debouncing";
    this.#timer = setTimeout(() => {
      this.#timer = null;
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
        this.#schedule(Math.max(0, this.#options.debounceMs - elapsed));
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
