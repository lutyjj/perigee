import { describe, expect, it, vi } from "vitest";

import { CollectionApi, CollectionPresentation } from "../../src/presentation/collections";
import { FallbackPresentation } from "../../src/presentation/fallback";
import { HostPresentation, PresentationGateway } from "../../src/presentation/gateway";
import {
  DEFAULT_PRESENTATION_MODE,
  PRESENTATION_MODES,
  PRESENTATION_MODE_DESCRIPTION,
  PRESENTATION_MODE_LABEL,
  parsePresentationMode,
} from "../../src/presentation/modes";

const SILENT = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const HOSTS: HostPresentation[] = [
  { hostUuid: "aaaa1111-2222", hostName: "Moonshine", steamAppIds: [1, 2] },
  { hostUuid: "bbbb3333-4444", hostName: "attic", steamAppIds: [3] },
];

interface FakeCollections extends CollectionApi {
  membership: [string, readonly number[]][];
  removed: string[];
  existing: string[];
}

function fakeCollections(existing: string[] = []): FakeCollections {
  const membership: [string, readonly number[]][] = [];
  const removed: string[] = [];
  return {
    membership,
    removed,
    existing,
    ownedNames() {
      return existing.filter((name) => !removed.includes(name));
    },
    find(name) {
      return existing.includes(name) ? { displayName: name } : undefined;
    },
    async setMembership(name, steamAppIds) {
      membership.push([name, steamAppIds]);
      if (!existing.includes(name)) {
        existing.push(name);
      }
    },
    async remove(name) {
      removed.push(name);
    },
  };
}

describe("presentation mode selection", () => {
  it("offers collections and tabs, and defaults to collections", () => {
    expect([...PRESENTATION_MODES]).toEqual(["collections", "tabs"]);
    expect(DEFAULT_PRESENTATION_MODE).toBe("collections");
    for (const mode of PRESENTATION_MODES) {
      expect(PRESENTATION_MODE_LABEL[mode]).toBeTruthy();
      expect(PRESENTATION_MODE_DESCRIPTION[mode]).toBeTruthy();
    }
  });

  it.each([undefined, null, "", "none", 7])("falls back on an unusable value: %s", (value) => {
    expect(parsePresentationMode(value)).toBe(DEFAULT_PRESENTATION_MODE);
  });

  it("keeps a mode it recognises", () => {
    expect(parsePresentationMode("tabs")).toBe("tabs");
  });
});

describe("CollectionPresentation", () => {
  it("gives each host its namespaced collection", async () => {
    const collections = fakeCollections();

    const warnings = await new CollectionPresentation(collections, SILENT).apply(
      HOSTS,
      new Set([1, 2, 3]),
    );

    expect(warnings).toEqual([]);
    expect(collections.membership).toEqual([
      ["Perigee: Moonshine", [1, 2]],
      ["Perigee: attic", [3]],
    ]);
  });

  it("reports a failing host and still handles the rest", async () => {
    const collections = fakeCollections();
    collections.setMembership = async (name) => {
      if (name.includes("Moonshine")) {
        throw new Error("steam said no");
      }
      collections.membership.push([name, []]);
    };

    const warnings = await new CollectionPresentation(collections, SILENT).apply(HOSTS, new Set());

    expect(warnings).toHaveLength(1);
    expect(collections.membership).toEqual([["Perigee: attic", []]]);
  });

  it("removes every collection Perigee owns, not only the ones hosts still exist for", async () => {
    // The purge bug: names were rebuilt from a live probe, so a collection whose host
    // had gone offline, been unpaired or been renamed was silently left behind.
    const collections = fakeCollections(["Perigee: Moonshine", "Perigee: retired-host"]);

    const warnings = await new CollectionPresentation(collections, SILENT).remove();

    expect(collections.removed).toEqual(["Perigee: Moonshine", "Perigee: retired-host"]);
    expect(warnings).toEqual([]);
  });

  it("reports a collection Steam refused to delete", async () => {
    const collections = fakeCollections(["Perigee: Moonshine"]);
    collections.remove = async () => {
      throw new Error("steam said no");
    };

    const warnings = await new CollectionPresentation(collections, SILENT).remove();

    expect(warnings).toEqual(["Collection Perigee: Moonshine is still there"]);
  });
});

describe("FallbackPresentation", () => {
  function spyGateway(name: string, calls: string[]): PresentationGateway {
    return {
      engage() {
        calls.push(`${name}.engage`);
      },
      disengage() {
        calls.push(`${name}.disengage`);
      },
      async apply() {
        calls.push(`${name}.apply`);
        return [];
      },
      async remove() {
        calls.push(`${name}.remove`);
        return [];
      },
    };
  }

  it("uses the preferred gateway while it works", async () => {
    const calls: string[] = [];
    const gateway = new FallbackPresentation(
      spyGateway("tabs", calls),
      spyGateway("collections", calls),
      () => null,
      SILENT,
    );

    expect(await gateway.apply(HOSTS, new Set())).toEqual([]);
    expect(calls).toEqual(["tabs.apply"]);
  });

  it("switches to the fallback once and warns exactly once", async () => {
    const calls: string[] = [];
    const announced: string[] = [];
    const gateway = new FallbackPresentation(
      spyGateway("tabs", calls),
      spyGateway("collections", calls),
      () => "the tab strip moved",
      SILENT,
      (notice) => announced.push(notice),
    );

    const first = await gateway.apply(HOSTS, new Set());
    const second = await gateway.apply(HOSTS, new Set());

    const expected = "Library tabs unavailable (the tab strip moved); using collections instead";
    expect(first).toEqual([expected]);
    expect(second).toEqual([]);
    expect(announced).toEqual([expected]);
    expect(calls).toContain("collections.apply");
    expect(calls).toContain("tabs.disengage");
  });

  it("announces a degraded mode without waiting for a sync", () => {
    const announced: string[] = [];
    const gateway = new FallbackPresentation(
      spyGateway("tabs", []),
      spyGateway("collections", []),
      () => "no template tab",
      SILENT,
      (notice) => announced.push(notice),
    );

    gateway.engage();

    expect(announced).toEqual([
      "Library tabs unavailable (no template tab); using collections instead",
    ]);
  });

  it("cleans up after both gateways on remove", async () => {
    const calls: string[] = [];
    const gateway = new FallbackPresentation(
      spyGateway("tabs", calls),
      spyGateway("collections", calls),
      () => null,
      SILENT,
    );

    await gateway.remove();

    expect(calls).toEqual(["tabs.remove", "collections.remove"]);
  });
});
