/**
 * A single-slot serial queue.
 *
 * `bdata scraper create` and `bdata scraper heal` are AI-Flow jobs behind a
 * concurrent-job cap: the CLI's own `--max-retries` flag exists to wait out the
 * resulting 429, backing off up to about four minutes. Running two heals at once
 * therefore does not go faster — it goes slower, and unpredictably so.
 *
 * Runs are unaffected and stay concurrent.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  /** Number of tasks queued or running. */
  get pending(): number {
    return this.depth;
  }

  /**
   * Queue a task behind any already waiting.
   *
   * A rejected task does not poison the queue: the chain is continued from a
   * settled promise so a failed heal cannot wedge every later one.
   */
  add<T>(task: () => Promise<T>): Promise<T> {
    this.depth += 1;

    const result = this.tail.then(task, task);

    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result.finally(() => {
      this.depth -= 1;
    });
  }
}
