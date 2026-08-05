import { describe, expect, it, vi } from "vitest";

import { currentDispatcher } from "../../src/presentation/tabs/dispatcher";
import {
  SteamTab,
  isPerigeeTab,
  mergeTabs,
  plannedTabs,
} from "../../src/presentation/tabs/model";

function tab(id: string, title = id): SteamTab {
  return { id, title, content: null };
}

describe("plannedTabs", () => {
  it("gives a tab to every collection Perigee owns", () => {
    expect(plannedTabs(["Perigee: Moonshine", "Perigee: attic"])).toEqual([
      { id: "perigee-Moonshine", title: "Moonshine", collectionName: "Perigee: Moonshine" },
      { id: "perigee-attic", title: "attic", collectionName: "Perigee: attic" },
    ]);
  });

  it("ignores collections that are not Perigee's", () => {
    expect(plannedTabs(["Favourites", "Perigee: attic"]).map((t) => t.title)).toEqual(["attic"]);
  });

  it("keeps the uuid suffix a duplicate host name was given", () => {
    expect(plannedTabs(["Perigee: pc (aaaa1111)"])[0]?.title).toBe("pc (aaaa1111)");
  });
});

describe("mergeTabs", () => {
  it("appends Perigee tabs after Steam's own", () => {
    const merged = mergeTabs([tab("AllGames"), tab("Installed")], [tab("perigee-host")]);

    expect(merged.map((entry) => entry.id)).toEqual(["AllGames", "Installed", "perigee-host"]);
  });

  it("replaces a Perigee tab instead of duplicating it on the next render", () => {
    const existing = [tab("AllGames"), tab("perigee-host", "old name")];

    const merged = mergeTabs(existing, [tab("perigee-host", "new name")]);

    expect(merged).toHaveLength(2);
    expect(merged[1]?.title).toBe("new name");
  });

  it("never touches a tab that is not Perigee's", () => {
    const steamTabs = [tab("AllGames"), tab("Installed")];

    const merged = mergeTabs(steamTabs, []);

    expect(merged).toEqual(steamTabs);
    expect(merged.filter(isPerigeeTab)).toEqual([]);
  });
});

describe("currentDispatcher", () => {
  // The bug this exists for: React swaps the dispatcher between render phases, so a
  // reference taken at module load belongs to a dispatcher no render will consult.
  it("reads React 19's current slot rather than a remembered one", () => {
    const idle = { useMemo: vi.fn() };
    const rendering = { useMemo: vi.fn() };
    const react = {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: idle, A: {}, T: null },
    };

    expect(currentDispatcher(react)).toBe(idle);

    react.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = rendering;

    expect(currentDispatcher(react)).toBe(rendering);
  });

  it("falls back to any internals entry that looks like a dispatcher", () => {
    const dispatcher = { useMemo: vi.fn(), useEffect: vi.fn() };
    const react = {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { S: null, V: dispatcher },
    };

    expect(currentDispatcher(react)).toBe(dispatcher);
  });

  it("still finds React 18's dispatcher", () => {
    const dispatcher = { useMemo: vi.fn() };
    const react = {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: dispatcher },
      },
    };

    expect(currentDispatcher(react)).toBe(dispatcher);
  });

  it("reports nothing rather than guessing when React is unrecognisable", () => {
    expect(currentDispatcher({})).toBeNull();
    expect(currentDispatcher(undefined)).toBeNull();
  });
});
