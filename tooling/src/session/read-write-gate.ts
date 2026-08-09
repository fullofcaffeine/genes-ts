/** A small writer-priority gate around physical public-tree publication. */
export class PublicationGate {
  #readers = 0;
  #writer = false;
  #closed = false;
  readonly #readWaiters: Array<{
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  }> = [];
  readonly #writeWaiters: Array<{
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  }> = [];

  async acquireRead(): Promise<() => void> {
    if (this.#closed) throw new Error("publication gate is closed");
    if (this.#writer || this.#writeWaiters.length > 0) {
      await new Promise<void>((resolve, reject) => {
        this.#readWaiters.push({ resolve, reject });
      });
    }
    if (this.#closed) throw new Error("publication gate is closed");
    this.#readers += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#readers -= 1;
      this.#drain();
    };
  }

  async runWrite<Value>(
    operation: () => Promise<Value>,
    signal: AbortSignal,
  ): Promise<Value> {
    if (this.#closed || signal.aborted) {
      throw new Error("publication was cancelled");
    }
    if (this.#writer || this.#readers > 0) {
      await new Promise<void>((resolve, reject) => {
        const settleResolve = (): void => {
          signal.removeEventListener("abort", abort);
          resolve();
        };
        const settleReject = (error: Error): void => {
          signal.removeEventListener("abort", abort);
          reject(error);
        };
        const waiter = { resolve: settleResolve, reject: settleReject };
        this.#writeWaiters.push(waiter);
        const abort = (): void => {
          const index = this.#writeWaiters.indexOf(waiter);
          if (index !== -1) this.#writeWaiters.splice(index, 1);
          settleReject(new Error("publication was cancelled"));
          this.#drain();
        };
        signal.addEventListener("abort", abort, { once: true });
      });
    } else {
      this.#writer = true;
    }
    if (this.#closed || signal.aborted) {
      this.#writer = false;
      this.#drain();
      throw new Error("publication was cancelled");
    }
    try {
      return await operation();
    } finally {
      this.#writer = false;
      this.#drain();
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    const error = new Error("publication gate is closed");
    for (const waiter of this.#readWaiters.splice(0)) waiter.reject(error);
    for (const waiter of this.#writeWaiters.splice(0)) waiter.reject(error);
  }

  #drain(): void {
    if (this.#closed || this.#writer || this.#readers > 0) return;
    const writer = this.#writeWaiters.shift();
    if (writer !== undefined) {
      this.#writer = true;
      writer.resolve();
      return;
    }
    for (const reader of this.#readWaiters.splice(0)) reader.resolve();
  }
}
