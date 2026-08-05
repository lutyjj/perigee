import { describe, expect, it } from "vitest";

import { WriteQueue } from "../../src/core/stream-settings/write-queue";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("WriteQueue", () => {
  it("collapses a burst to the newest value", async () => {
    // A slider drag submits per step; the intermediate steps must not each be written.
    const written: number[] = [];
    const queue = new WriteQueue<number, void>(async (value) => {
      await Promise.resolve();
      written.push(value);
    }, undefined);

    await Promise.all([queue.submit(1), queue.submit(2), queue.submit(3), queue.submit(4)]);

    expect(written).toEqual([4]);
  });

  it("never runs two writes at once", async () => {
    const active: number[] = [];
    let overlapped = false;
    const queue = new WriteQueue<number, void>(async () => {
      active.push(1);
      overlapped ||= active.length > 1;
      await Promise.resolve();
      active.pop();
    }, undefined);

    const first = queue.submit(1);
    await Promise.resolve();
    const second = queue.submit(2);
    await Promise.all([first, second]);

    expect(overlapped).toBe(false);
  });

  it("cannot leave a superseded value as the final state", async () => {
    const written: number[] = [];
    const slow = deferred();
    const queue = new WriteQueue<number, void>(async (value) => {
      written.push(value);
      if (written.length === 1) {
        await slow.promise;
      }
    }, undefined);

    const first = queue.submit(1);
    await Promise.resolve();
    const last = queue.submit(2);
    slow.resolve();
    await Promise.all([first, last]);

    expect(written[written.length - 1]).toBe(2);
  });

  it("keeps working after a write is rejected", async () => {
    // The hazard: chaining submit onto a retained rejected promise makes one failed
    // write leave the queue refusing every later value with the first one's error.
    const written: number[] = [];
    const queue = new WriteQueue<number, string>(async (value) => {
      await Promise.resolve();
      if (value === 1) {
        throw new Error("steam blew up");
      }
      written.push(value);
      return `wrote ${String(value)}`;
    }, "nothing written");

    await expect(queue.submit(1)).rejects.toThrow("steam blew up");

    expect(await queue.submit(2)).toBe("wrote 2");
    expect(written).toEqual([2]);
  });

  it("tells every caller of a failed write, not only the first", async () => {
    const queue = new WriteQueue<number, string>(async () => {
      await Promise.resolve();
      throw new Error("steam blew up");
    }, "nothing written");

    const first = queue.submit(1);
    const second = queue.submit(2);

    await expect(first).rejects.toThrow("steam blew up");
    await expect(second).rejects.toThrow("steam blew up");
  });

  it("reports a rejection once per submit rather than replaying it", async () => {
    let attempts = 0;
    const queue = new WriteQueue<number, string>(async (value) => {
      attempts += 1;
      await Promise.resolve();
      if (attempts === 1) {
        throw new Error("first only");
      }
      return `wrote ${String(value)}`;
    }, "nothing written");

    await expect(queue.submit(1)).rejects.toThrow("first only");
    await expect(queue.submit(2)).resolves.toBe("wrote 2");
    await expect(queue.submit(3)).resolves.toBe("wrote 3");
    expect(attempts).toBe(3);
  });

  it("settles a superseded caller on the result of the value that won", async () => {
    const queue = new WriteQueue<number, string>(async (value) => {
      await Promise.resolve();
      return `wrote ${String(value)}`;
    }, "nothing written");

    const [first, second] = await Promise.all([queue.submit(1), queue.submit(2)]);

    expect(first).toBe("wrote 2");
    expect(second).toBe("wrote 2");
  });
});
