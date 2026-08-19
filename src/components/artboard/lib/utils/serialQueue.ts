/**
 * Runs async jobs strictly one at a time, queueing the rest in arrival order.
 *
 * Extracted from `useDropHandler` so the concurrency rule can be tested without
 * a network, a canvas or a React tree — the invariants below are the ones that
 * decide whether a second folder dropped mid-upload corrupts the first batch,
 * and they are not observable from the outside once they are tangled up in a
 * hook.
 *
 * Guarantees, each of which has a test:
 *
 *  - **Never two at once.** A job submitted while one is running is stored, not
 *    started. This is what stops two 100-file batches competing for the same
 *    six upload slots and the same packer.
 *  - **Order is arrival order.** Queued jobs run FIFO, so artwork lands in the
 *    order the customer dropped it.
 *  - **Nothing is dropped.** Every submitted job runs exactly once, including
 *    when several arrive in the same tick.
 *  - **A failure does not strand the queue.** A throwing job is reported and
 *    stepped over; the ones behind it still run. Losing a batch because the one
 *    ahead of it failed would lose artwork the customer has already handed over.
 *  - **`clear()` is honoured immediately.** Cancelling drops everything still
 *    waiting, so a cancelled upload cannot resurrect itself.
 */

export interface SerialQueue<T> {
  /**
   * Submits a job. Resolves `true` if it started immediately, `false` if it was
   * queued behind a running one.
   *
   * Resolution does not wait for the job to finish — the caller is a drop
   * handler, not a batch runner, and must return to the UI at once.
   */
  submit(job: T): boolean;
  /** Jobs still waiting, in the order they will run. */
  pending(): T[];
  /** Whether a job is currently running (or a chain of them is draining). */
  isActive(): boolean;
  /** Discards everything queued. Does not abort the running job. */
  clear(): void;
}

export interface SerialQueueOptions<T> {
  /**
   * Called whenever the queue's shape changes, so a caller can mirror it into
   * React state without the queue itself depending on React.
   */
  onChange?: (state: { active: boolean; pending: T[] }) => void;
  /** Where a failing job's error goes. Defaults to `console.error`. */
  onError?: (error: unknown, job: T) => void;
}

export function createSerialQueue<T>(
  run: (job: T) => Promise<void>,
  options: SerialQueueOptions<T> = {},
): SerialQueue<T> {
  const { onChange, onError } = options;

  const pending: T[] = [];
  // Synchronous by design. Several drops can be submitted between two React
  // renders, so a flag derived from state would still read "idle" for the
  // second of them and let it start alongside the first.
  let active = false;

  const notify = () => onChange?.({ active, pending: [...pending] });

  const drain = async (first: T) => {
    active = true;
    notify();
    try {
      let next: T | undefined = first;
      while (next !== undefined) {
        try {
          await run(next);
        } catch (error) {
          // Reported, then stepped over — see the "does not strand" guarantee.
          if (onError) onError(error, next);
          else console.error("[serialQueue] job failed", error);
        }
        next = pending.shift();
        if (next !== undefined) notify();
      }
    } finally {
      // Released only once the queue is empty. Releasing between jobs would
      // let a submission landing in that window start a second drain, which is
      // exactly the concurrency this exists to prevent.
      active = false;
      notify();
    }
  };

  return {
    submit(job: T) {
      if (active) {
        pending.push(job);
        notify();
        return false;
      }
      // Deliberately not awaited: the caller returns to the UI immediately and
      // the chain runs on its own. `void` documents that the floating promise
      // is intentional — `drain` never rejects.
      void drain(job);
      return true;
    },
    pending: () => [...pending],
    isActive: () => active,
    clear() {
      if (pending.length === 0) return;
      pending.length = 0;
      notify();
    },
  };
}
