/**
 * Serialises optimistic writes so a slider drag cannot leave the last value behind.
 * Each request supersedes any that has not started; only the newest is ever in flight,
 * and every caller settles on the outcome of the write that consumed a value, so a
 * superseded caller learns what happened to the value that replaced its own.
 */
export type Write<T, R> = (value: T) => Promise<R>;

export class WriteQueue<T, R> {
  // The chain only orders the writes and must never reject. A rejection lives on
  // `settled`, where the callers of that write pick it up: a queue that carried the
  // failure forward would refuse every later value with the first one's error.
  private chain: Promise<void> = Promise.resolve();
  private settled: Promise<R>;
  private queued: T | undefined;
  private hasQueued = false;

  /** `nothingWritten` is the outcome before any value has been written. */
  constructor(
    private readonly write: Write<T, R>,
    nothingWritten: R,
  ) {
    this.settled = Promise.resolve(nothingWritten);
  }

  submit(value: T): Promise<R> {
    this.queued = value;
    this.hasQueued = true;
    this.chain = this.chain.then(async () => await this.drain());
    return this.chain.then(async () => await this.settled);
  }

  private async drain(): Promise<void> {
    if (!this.hasQueued) {
      return;
    }
    const value = this.queued as T;
    this.hasQueued = false;
    this.queued = undefined;
    this.settled = this.write(value);
    await this.settled.catch(() => undefined);
  }
}
