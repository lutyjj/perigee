import { describe, expect, it, vi } from "vitest";

import { PresentationGateway } from "../../src/presentation/gateway";
import { PresentationHost } from "../../src/presentation/host";
import { PresentationMode } from "../../src/presentation/modes";

const SILENT = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function recordingGateway(name: string, calls: string[]): PresentationGateway {
  return {
    engage: () => calls.push(`${name}.engage`),
    disengage: () => calls.push(`${name}.disengage`),
    apply: async () => [],
    remove: async () => {
      calls.push(`${name}.remove`);
      return [];
    },
  };
}

function hostWith(mode: PresentationMode, calls: string[]) {
  const announcers = new Map<PresentationMode, (notice: string) => void>();
  const host = new PresentationHost(
    (built, announce) => {
      announcers.set(built, announce);
      return recordingGateway(built, calls);
    },
    mode,
    SILENT,
  );
  return { host, announcers };
}

describe("PresentationHost", () => {
  it("engages the stored mode as soon as it exists, before any sync", () => {
    const calls: string[] = [];

    hostWith("tabs", calls);

    expect(calls).toEqual(["tabs.engage"]);
  });

  it("stores the choice before touching the old grouping", async () => {
    const calls: string[] = [];
    const { host } = hostWith("collections", calls);
    const written: PresentationMode[] = [];

    await host.switchTo("tabs", async (mode) => {
      written.push(mode);
      // The setting is durable at this point; everything after is Steam work.
      expect(host.currentMode()).toBe("collections");
    });

    expect(written).toEqual(["tabs"]);
    expect(host.currentMode()).toBe("tabs");
    expect(calls).toEqual([
      "collections.engage",
      "collections.disengage",
      "tabs.engage",
      "collections.remove",
    ]);
  });

  it("keeps the stored mode when clearing the old grouping fails", async () => {
    const calls: string[] = [];
    const { host } = hostWith("collections", calls);
    const broken: PresentationGateway = {
      ...recordingGateway("collections", calls),
      remove: async () => {
        throw new Error("steam said no");
      },
    };
    Object.assign(host.current(), broken);

    const warnings = await host.switchTo("tabs", async () => undefined);

    expect(host.currentMode()).toBe("tabs");
    expect(warnings).toEqual(["The previous grouping could not be cleared"]);
  });

  it("does not rebuild anything when the mode is unchanged", async () => {
    const calls: string[] = [];
    const { host } = hostWith("tabs", calls);

    await host.switchTo("tabs", async () => expect.unreachable("should not write"));

    expect(calls).toEqual(["tabs.engage"]);
  });

  it("tells subscribers when the active mode complains", () => {
    const calls: string[] = [];
    const { host, announcers } = hostWith("tabs", calls);
    const seen: (string | null)[] = [];
    host.subscribe(() => seen.push(host.currentNotice()));

    announcers.get("tabs")?.("Library tabs unavailable (anchor moved)");

    expect(seen).toEqual(["Library tabs unavailable (anchor moved)"]);
  });

  it("clears a stale complaint when the mode changes", async () => {
    const calls: string[] = [];
    const { host, announcers } = hostWith("tabs", calls);
    announcers.get("tabs")?.("Library tabs unavailable (anchor moved)");

    await host.switchTo("collections", async () => undefined);

    expect(host.currentNotice()).toBeNull();
  });

  it("stops the active mode on dismount", () => {
    const calls: string[] = [];
    const { host } = hostWith("tabs", calls);

    host.dismount();

    expect(calls).toEqual(["tabs.engage", "tabs.disengage"]);
  });
});
