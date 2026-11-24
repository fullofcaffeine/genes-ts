import type { Readable, Writable } from "node:stream";

/**
 * Haxe 4.3.7 runs a full garbage collection or a compaction after every
 * tenth request of any kind that a compiler server answers
 * (`src/compiler/server.ml`, `update_heap`, a ring of 10 entries). A server on
 * its standard streams runs it at once after the answer of that request,
 * before it reads the next one. So the owner knows, from its own count,
 * which request is followed by the collection.
 */
export const HAXE_SERVER_COLLECTION_PERIOD = 10;

/** The largest answer frame that the channel accepts (64 MiB). */
const DEFAULT_MAX_FRAME_BYTES = 64 * 1024 * 1024;

/**
 * How long a frame may stay incomplete after its last byte. Haxe writes each
 * answer frame in one flush at the end of the request, so a frame whose
 * declared length never arrives means that other bytes were read as a frame
 * length.
 */
const DEFAULT_FRAME_STALL_MS = 2_000;

/**
 * The channel to a `haxe --wait stdio` server cannot be used any more. The
 * owner must stop that server; a new server gives the cold result.
 *
 * Examples: a macro wrote to the server's standard error directly, so bytes
 * arrived outside a frame; the server closed its streams; a frame declared a
 * length above the limit.
 */
export class HaxeStdioTransportError extends Error {
  constructor(message: string) {
    super(`Haxe stdio channel failed: ${message}`);
    this.name = "HaxeStdioTransportError";
  }
}

/**
 * The text of one Haxe server answer, split as the `haxe --connect` client
 * splits it: printed output (`stdout`), messages (`stderr`), and whether the
 * server reported an error (`failed`, the client's exit code 1).
 */
export interface HaxeServerAnswer {
  readonly stdout: string;
  readonly stderr: string;
  readonly failed: boolean;
}

/**
 * Splits the body of one answer frame exactly as the Haxe 4.3.7 client does
 * (`do_connect` in `src/compiler/server.ml`).
 *
 * A line that starts with byte 1 is printed output: its parts between byte 1
 * markers become lines on standard output. A line that starts with byte 2
 * marks an error. Every other line is a message for standard error.
 *
 * Example: the body `"\u0001hello\u0001\nsrc/A.hx:1: error\n\u0002\n"` gives
 * `stdout` `"hello\n"`, `stderr` `"src/A.hx:1: error\n"` and `failed` true.
 */
export function decodeHaxeServerAnswer(body: string): HaxeServerAnswer {
  const lines = body.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let stdout = "";
  let stderr = "";
  let failed = false;
  for (const line of lines) {
    if (line.startsWith("\u0001")) {
      stdout += line.split("\u0001").slice(1).join("\n");
    } else if (line.startsWith("\u0002")) {
      failed = true;
    } else {
      stderr += `${line}\n`;
    }
  }
  return Object.freeze({ stdout, stderr, failed });
}

/** Optional limits of one `HaxeStdioChannel`; tests use small values. */
export interface HaxeStdioChannelOptions {
  readonly maxFrameBytes?: number;
  readonly frameStallMs?: number;
  /** Called once when the channel breaks, with the reason. */
  readonly onBroken?: (error: HaxeStdioTransportError) => void;
}

interface PendingAnswer {
  readonly resolve: (body: Buffer) => void;
  readonly reject: (error: Error) => void;
}

/**
 * One open pipe to a `haxe --wait stdio` compile server.
 *
 * Why: a request over this pipe costs about half a millisecond. A request
 * through `haxe --connect` costs a new client process plus a TCP connection,
 * and Haxe 4.3.7's TCP server sleeps 50 ms when the request bytes are late
 * (`server.ml`, the `Unix.select [] [] [] 0.05` in `init_wait_socket`).
 *
 * Wire form (Haxe owns it): each request is a 4-byte little-endian length and
 * the request text, one argument per line, written to the server's standard
 * input. Each answer is a 4-byte little-endian length and the answer text, on
 * the server's standard error.
 *
 * The channel sends one request at a time and counts every request, so its
 * owner knows when Haxe runs its periodic collection
 * (`HAXE_SERVER_COLLECTION_PERIOD`).
 *
 * Authority: the channel only moves bytes. It never stops the process. When
 * a byte arrives outside a frame, it marks itself broken, rejects the
 * current request with `HaxeStdioTransportError`, and refuses later
 * requests. Its owner then stops the server and starts a new one.
 *
 * Example:
 *
 * ```ts
 * const channel = new HaxeStdioChannel(child.stdin!, child.stderr!);
 * const answer = decodeHaxeServerAnswer(
 *   (await channel.request(["--cwd /project", "-version"])).toString("utf8"),
 * );
 * ```
 */
export class HaxeStdioChannel {
  readonly #input: Writable;
  readonly #output: Readable;
  readonly #maxFrameBytes: number;
  readonly #frameStallMs: number;
  readonly #onBroken: ((error: HaxeStdioTransportError) => void) | undefined;
  #buffer: Buffer = Buffer.alloc(0);
  #pending: PendingAnswer | null = null;
  #tail: Promise<void> = Promise.resolve();
  #broken: HaxeStdioTransportError | null = null;
  #requests = 0;
  #stallTimer: NodeJS.Timeout | null = null;
  #received = 0;

  constructor(
    input: Writable,
    output: Readable,
    options: HaxeStdioChannelOptions = {},
  ) {
    this.#input = input;
    this.#output = output;
    this.#maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.#frameStallMs = options.frameStallMs ?? DEFAULT_FRAME_STALL_MS;
    this.#onBroken = options.onBroken;
    output.on("data", this.#onData);
    output.once("end", this.#onEnd);
    output.once("close", this.#onEnd);
    output.on("error", this.#onStreamError);
    input.on("error", this.#onStreamError);
  }

  /** The number of requests written to this server, including failed ones. */
  get requests(): number {
    return this.#requests;
  }

  /** The reason why the channel cannot be used, or null while it works. */
  get broken(): HaxeStdioTransportError | null {
    return this.#broken;
  }

  /** True while a request waits for its answer or is queued. */
  get busy(): boolean {
    return this.#pending !== null || this.#queued > 0;
  }

  #queued = 0;

  /**
   * Sends one request and resolves with the body of its answer frame.
   *
   * Requests wait for each other: the next one is written only after the
   * answer of the previous one arrived, even when the caller of the previous
   * one stopped waiting because `signal` aborted. Haxe cannot stop a request,
   * so its answer must still be read before the next request.
   */
  request(lines: readonly string[], signal?: AbortSignal): Promise<Buffer> {
    if (this.#broken !== null) return Promise.reject(this.#broken);
    if (signal?.aborted === true) {
      return Promise.reject(new Error("Haxe server request was cancelled"));
    }
    this.#queued += 1;
    const answer = this.#tail.then(() => {
      this.#queued -= 1;
      // A request whose caller stopped waiting before it was written is
      // never sent, so it neither costs a compile nor counts.
      if (signal?.aborted === true) {
        throw new Error("Haxe server request was cancelled");
      }
      return this.#send(lines);
    });
    this.#tail = answer.then(
      () => undefined,
      () => undefined,
    );
    if (signal === undefined) return answer;
    return new Promise<Buffer>((resolve, reject) => {
      const abort = (): void =>
        reject(new Error("Haxe server request was cancelled"));
      signal.addEventListener("abort", abort, { once: true });
      answer.then(
        (body) => {
          signal.removeEventListener("abort", abort);
          resolve(body);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  /**
   * Stops reading. A request that waits is rejected. Idempotent; the owner
   * stops the process itself.
   */
  close(): void {
    this.#break("the channel was closed");
    this.#output.off("data", this.#onData);
  }

  #send(lines: readonly string[]): Promise<Buffer> {
    if (this.#broken !== null) return Promise.reject(this.#broken);
    const body = Buffer.from(lines.map((line) => `${line}\n`).join(""), "utf8");
    const head = Buffer.alloc(4);
    head.writeInt32LE(body.length, 0);
    return new Promise<Buffer>((resolve, reject) => {
      this.#pending = { resolve, reject };
      this.#requests += 1;
      this.#input.write(Buffer.concat([head, body]));
    });
  }

  readonly #onData = (chunk: Buffer): void => {
    if (this.#broken !== null) return;
    if (this.#pending === null) {
      this.#break("bytes arrived outside a frame while no request waited");
      return;
    }
    this.#received += chunk.length;
    this.#buffer =
      this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    if (this.#buffer.length < 4) return;
    const length = this.#buffer.readInt32LE(0);
    if (length < 0 || length > this.#maxFrameBytes) {
      this.#break(
        `a frame declared ${length} bytes, which is outside 0 to ${this.#maxFrameBytes}`,
      );
      return;
    }
    if (this.#buffer.length < 4 + length) {
      this.#armStall();
      return;
    }
    if (this.#buffer.length > 4 + length) {
      this.#break("bytes arrived after the end of an answer frame");
      return;
    }
    this.#clearStall();
    const body = this.#buffer.subarray(4);
    this.#buffer = Buffer.alloc(0);
    const pending = this.#pending;
    this.#pending = null;
    pending.resolve(body);
  };

  readonly #onEnd = (): void => {
    this.#break("the server closed its standard error");
  };

  readonly #onStreamError = (error: Error): void => {
    this.#break(`a stream failed: ${error.message}`);
  };

  #armStall(): void {
    this.#clearStall();
    const seen = this.#received;
    this.#stallTimer = setTimeout(() => {
      this.#stallTimer = null;
      // Let bytes that are already readable arrive first: after a long
      // event-loop pause, timers run before the stream delivers its data.
      setImmediate(() => {
        if (this.#received === seen && this.#pending !== null) {
          this.#break(
            `a frame stayed incomplete for ${this.#frameStallMs} ms`,
          );
        }
      });
    }, this.#frameStallMs);
    this.#stallTimer.unref();
  }

  #clearStall(): void {
    if (this.#stallTimer !== null) {
      clearTimeout(this.#stallTimer);
      this.#stallTimer = null;
    }
  }

  #break(reason: string): void {
    if (this.#broken !== null) return;
    this.#clearStall();
    const error = new HaxeStdioTransportError(reason);
    this.#broken = error;
    this.#buffer = Buffer.alloc(0);
    const pending = this.#pending;
    this.#pending = null;
    pending?.reject(error);
    try {
      this.#onBroken?.(error);
    } catch {
      // Reporting must not change the channel state.
    }
  }
}
