import { describe, it, expect, vi } from "vitest";
import { createSerialQueue } from "../components/artboard/lib/utils/serialQueue";

/**
 * The rules that decide whether dropping a second folder mid-upload corrupts
 * the first batch. Each maps to a guarantee documented on `createSerialQueue`.
 */

/** A job that resolves only when told to, so overlap is observable. */
const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("serial queue", () => {
  it("runs the first job immediately and defers the rest", () => {
    const gate = deferred();
    const queue = createSerialQueue<string>(() => gate.promise);

    expect(queue.submit("a")).toBe(true);
    expect(queue.submit("b")).toBe(false);
    expect(queue.submit("c")).toBe(false);

    expect(queue.pending()).toEqual(["b", "c"]);
    expect(queue.isActive()).toBe(true);
  });

  it("never runs two jobs at once", async () => {
    let running = 0;
    let maxConcurrent = 0;
    const queue = createSerialQueue<number>(async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await flush();
      running -= 1;
    });

    // Everything submitted in one tick, which is what rapid repeated
    // drag-and-drop actually looks like.
    for (let i = 0; i < 8; i++) queue.submit(i);
    while (queue.isActive()) await flush();

    expect(maxConcurrent).toBe(1);
  });

  it("runs queued jobs in arrival order and loses none", async () => {
    const order: number[] = [];
    const queue = createSerialQueue<number>(async (job) => {
      await flush();
      order.push(job);
    });

    for (let i = 0; i < 6; i++) queue.submit(i);
    while (queue.isActive()) await flush();

    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("keeps draining after a job throws", async () => {
    // A failed batch must not strand the ones behind it — those files are
    // artwork the customer has already handed over.
    const done: string[] = [];
    const onError = vi.fn();
    const queue = createSerialQueue<string>(async (job) => {
      await flush();
      if (job === "bad") throw new Error("upload failed");
      done.push(job);
    }, { onError });

    queue.submit("first");
    queue.submit("bad");
    queue.submit("last");
    while (queue.isActive()) await flush();

    expect(done).toEqual(["first", "last"]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("goes idle only once the queue is empty", async () => {
    const seen: boolean[] = [];
    const queue = createSerialQueue<number>(
      async () => {
        await flush();
      },
      { onChange: ({ active, pending }) => { if (pending.length === 0) seen.push(active); } },
    );

    queue.submit(1);
    queue.submit(2);
    // Active must not flicker false between the two jobs, or a drop landing in
    // that window would start a second concurrent chain.
    while (queue.isActive()) await flush();

    expect(seen[seen.length - 1]).toBe(false);
    expect(queue.pending()).toEqual([]);
  });

  it("reports its shape so a caller can mirror it into state", () => {
    const gate = deferred();
    const onChange = vi.fn();
    const queue = createSerialQueue<string>(() => gate.promise, { onChange });

    queue.submit("a");
    queue.submit("b");

    expect(onChange).toHaveBeenLastCalledWith({ active: true, pending: ["b"] });
  });

  it("clear() discards what is waiting", async () => {
    const gate = deferred();
    const ran: string[] = [];
    const queue = createSerialQueue<string>(async (job) => {
      ran.push(job);
      await gate.promise;
    });

    queue.submit("running");
    queue.submit("queued");
    queue.clear();

    expect(queue.pending()).toEqual([]);

    gate.resolve();
    while (queue.isActive()) await flush();

    // The cancelled job must not resurrect itself once the active one finishes.
    expect(ran).toEqual(["running"]);
  });

  it("accepts new work again after draining", async () => {
    const queue = createSerialQueue<number>(async () => { await flush(); });

    queue.submit(1);
    while (queue.isActive()) await flush();

    // A fresh drop after everything settles is a normal start, not a queued one.
    expect(queue.submit(2)).toBe(true);
  });
});
