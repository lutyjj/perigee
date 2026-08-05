import { describe, expect, it } from "vitest";

import {
  BindingPorts,
  NOTHING_COMMITTED,
  SettingsCommit,
  createSettingsBinding,
} from "../../src/core/stream-settings/binding";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: () => void;
} {
  let resolve = (): void => undefined;
  let reject = (): void => undefined;
  const promise = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = () => fail(new Error("backend said no"));
  });
  return { promise, resolve, reject };
}

/** Stores without complaint and rewrites nothing, so a test states only what it is about. */
function ports(overrides: Partial<BindingPorts> = {}): BindingPorts {
  return {
    store: async () => await Promise.resolve(),
    rewrite: async () => await Promise.resolve(NOTHING_COMMITTED),
    ...overrides,
  };
}

describe("the settings binding", () => {
  it("answers with the chosen value while the commit is still in flight", async () => {
    // The hazard: a native picker unmounts the panel, and the remount seeds its state
    // from current(). Answering with the old value makes the first change of any
    // setting appear not to take, while a second attempt sticks.
    const slow = deferred();
    const binding = createSettingsBinding(
      { "audio-config": "stereo" },
      ports({ store: async () => await slow.promise }),
    );

    const write = binding.write({ "audio-config": "5.1-surround" });

    expect(binding.current()).toEqual({ "audio-config": "5.1-surround" });
    slow.resolve();
    await write;
    expect(binding.current()).toEqual({ "audio-config": "5.1-surround" });
  });

  it("gives the old value back when the store fails, because nothing was stored", async () => {
    const failing = deferred();
    const binding = createSettingsBinding(
      { fps: 60 },
      ports({ store: async () => await failing.promise }),
    );

    const write = binding.write({ fps: 90 });
    expect(binding.current()).toEqual({ fps: 90 });

    failing.reject();
    await expect(write).rejects.toThrow("backend said no");
    expect(binding.current()).toEqual({ fps: 60 });
  });

  it("keeps the stored value when the rewrite falls short", async () => {
    // The hazard: rolling back here leaves the panel showing the old value while the
    // backend holds the new one, the silent divergence applying on change exists to end.
    const stored: StreamSettingsRecord[] = [];
    const binding = createSettingsBinding(
      { fps: 60 },
      ports({
        store: async (values) => {
          stored.push(values);
          await Promise.resolve();
        },
        rewrite: async () =>
          await Promise.resolve({ rewritten: 0, warnings: ["Press Sync"] }),
      }),
    );

    const commit = await binding.write({ fps: 90 });

    expect(stored).toEqual([{ fps: 90 }]);
    expect(binding.current()).toEqual({ fps: 90 });
    expect(commit.warnings).toEqual(["Press Sync"]);
  });

  it("rewrites only what it managed to store", async () => {
    const rewritten: StreamSettingsRecord[] = [];
    const binding = createSettingsBinding(
      {},
      ports({
        store: async () => {
          await Promise.resolve();
          throw new Error("backend said no");
        },
        rewrite: async (values) => {
          rewritten.push(values);
          return await Promise.resolve(NOTHING_COMMITTED);
        },
      }),
    );

    await expect(binding.write({ fps: 90 })).rejects.toThrow("backend said no");
    expect(rewritten).toEqual([]);
  });

  it("keeps the newest choice when several land before the backend answers", async () => {
    const stored: StreamSettingsRecord[] = [];
    const binding = createSettingsBinding(
      {},
      ports({
        store: async (values) => {
          await Promise.resolve();
          stored.push(values);
        },
      }),
    );

    await Promise.all([binding.write({ fps: 30 }), binding.write({ fps: 60 })]);

    expect(binding.current()).toEqual({ fps: 60 });
    expect(stored[stored.length - 1]).toEqual({ fps: 60 });
  });

  it("stores before it rewrites, so a rewrite never runs ahead of the value", async () => {
    const order: string[] = [];
    const binding = createSettingsBinding(
      {},
      ports({
        store: async () => {
          await Promise.resolve();
          order.push("store");
        },
        rewrite: async () => {
          order.push("rewrite");
          return await Promise.resolve(NOTHING_COMMITTED);
        },
      }),
    );

    await binding.write({ fps: 60 });

    expect(order).toEqual(["store", "rewrite"]);
  });

  it("hands back what the commit did to the shortcuts", async () => {
    const commit: SettingsCommit = { rewritten: 4, warnings: ["Steam kept two"] };
    const binding = createSettingsBinding({}, ports({ rewrite: async () => commit }));

    expect(await binding.write({ fps: 60 })).toEqual(commit);
  });
});

type StreamSettingsRecord = Readonly<Record<string, string | number>>;
