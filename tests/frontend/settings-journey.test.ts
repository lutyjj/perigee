import { describe, expect, it } from "vitest";

import { OwnedShortcut, specFor } from "../../src/core/plan";
import { buildLaunchOptions, parseOwnershipTag } from "../../src/core/launch";
import { parsePluginSettings } from "../../src/core/stream-settings/document";
import { STREAM_SETTING_REGISTRY } from "../../src/core/stream-settings/registry";
import { streamFlags } from "../../src/core/stream-settings/stream-settings";
import { SHORTCUTS_NOT_REWRITTEN, StreamFlagWriter } from "../../src/sync/flags";
import { Logger } from "../../src/core/logger";
import { ShortcutGateway } from "../../src/steam/shortcuts";
import fixture from "../fixtures/plugin_settings.json";

const MOONSHINE = "f0000000-0000-4000-8000-000000000001";
const ADDRESS = "198.51.100.4";

/**
 * The journey this file exists for: a setting the user stored has to end up on the launch
 * line Steam runs. Every unit below was green while that journey was broken, because
 * nothing joined a stored settings document to a real shortcut's launch options.
 */

/** Stands in for Steam, holding the launch options a shortcut actually carries. */
class FakeShortcuts {
  readonly launchOptions = new Map<number, string>();
  readonly refuse = new Set<number>();
  readonly throwOn = new Set<number>();
  readonly names = new Map<number, string>();

  constructor(titles: readonly string[]) {
    titles.forEach((title, index) => {
      this.launchOptions.set(
        index + 1,
        buildLaunchOptions({
          hostUuid: MOONSHINE,
          hostAppId: String(index + 1),
          address: ADDRESS,
          title,
        }),
      );
    });
  }

  async listOwned(): Promise<OwnedShortcut[] | null> {
    await Promise.resolve();
    return [...this.launchOptions.entries()].map(([steamAppId, options]) => {
      const tag = parseOwnershipTag(options);
      if (tag === null) {
        throw new Error(`untagged shortcut ${String(steamAppId)}`);
      }
      return {
        steamAppId,
        hostUuid: tag.hostUuid,
        hostAppId: tag.hostAppId,
        hostTitle: tag.hostTitle,
        address: tag.address,
        displayName: tag.hostTitle,
        launchOptions: options,
      };
    });
  }

  async setLaunchOptions(steamAppId: number, launchOptions: string): Promise<boolean> {
    await Promise.resolve();
    if (this.throwOn.has(steamAppId)) {
      throw new Error(`steam blew up on ${String(steamAppId)}`);
    }
    if (this.refuse.has(steamAppId)) {
      return false;
    }
    this.launchOptions.set(steamAppId, launchOptions);
    return true;
  }

  /** Steam's own rename, which a streaming setting must leave alone. */
  setShortcutName(steamAppId: number, name: string): void {
    this.names.set(steamAppId, name);
  }

  asGateway(): ShortcutGateway {
    return this as unknown as ShortcutGateway;
  }

  /** The flag span of one shortcut: everything Moonlight is told before the stream verb. */
  flagsOn(steamAppId: number): string[] {
    const options = this.launchOptions.get(steamAppId) ?? "";
    const span = /Moonlight (.*?)stream /.exec(options);
    return span?.[1] === undefined ? [] : span[1].trim().split(" ").filter(Boolean);
  }
}

function silentLogger(): Logger {
  return { info: () => undefined, warn: () => undefined, error: () => undefined };
}

function writerOver(steam: FakeShortcuts): StreamFlagWriter {
  return new StreamFlagWriter(steam.asGateway(), silentLogger());
}

describe("a stored streaming setting reaches the shortcuts", () => {
  it("puts the flags on every owned shortcut without a sync", async () => {
    // The P0: settings only reached a launch line through computePlan, which only ran on
    // Sync. Storing a setting changed nothing the user could see, and streams kept
    // following Moonlight's own config.
    const steam = new FakeShortcuts(["Desktop", "Factorio"]);
    expect(steam.flagsOn(1)).toEqual([]);

    const commit = await writerOver(steam).apply(
      streamFlags(STREAM_SETTING_REGISTRY, { fps: 60, "performance-overlay": "on" }),
    );

    expect(commit).toEqual({ rewritten: 2, warnings: [] });
    expect(steam.flagsOn(1)).toEqual(["--fps", "60", "--performance-overlay"]);
    expect(steam.flagsOn(2)).toEqual(["--fps", "60", "--performance-overlay"]);
  });

  it("carries what the settings document the backend stores actually says", async () => {
    // Joins the two mirrors to the launch line: the fixture both sides pin themselves
    // against, read through the real parser and the real registry.
    const steam = new FakeShortcuts(["Desktop"]);
    const stored = parsePluginSettings(fixture);

    await writerOver(steam).apply(
      streamFlags(STREAM_SETTING_REGISTRY, stored.stream_settings),
    );

    expect(steam.flagsOn(1)).toEqual([
      "--resolution",
      "1920x1080",
      "--fps",
      "60",
      "--bitrate",
      "40000",
      "--no-hdr",
      "--performance-overlay",
    ]);
  });

  it("leaves the launch line bare when every setting is inherited", async () => {
    const steam = new FakeShortcuts(["Desktop"]);
    await writerOver(steam).apply([]);

    expect(steam.flagsOn(1)).toEqual([]);
    expect(steam.launchOptions.get(1)).toContain(`stream ${ADDRESS} "Desktop" --quit-after`);
  });

  it("keeps the shortcut's identity while the flags change", async () => {
    const steam = new FakeShortcuts(["Desktop"]);
    const before = parseOwnershipTag(steam.launchOptions.get(1) ?? "");

    await writerOver(steam).apply(["--hdr"]);

    expect(parseOwnershipTag(steam.launchOptions.get(1) ?? "")).toEqual(before);
  });

  it("leaves a shortcut the user renamed in Steam alone", async () => {
    // Only a sync is documented to put a manual rename back; a streaming setting is not
    // a sync, and it needs nothing but the launch line.
    const steam = new FakeShortcuts(["Desktop"]);
    steam.setShortcutName(1, "my name");

    await writerOver(steam).apply(["--hdr"]);

    expect(steam.names.get(1)).toBe("my name");
    expect(steam.flagsOn(1)).toEqual(["--hdr"]);
  });

  it("replaces the previous flags rather than appending to them", async () => {
    const steam = new FakeShortcuts(["Desktop"]);
    const writer = writerOver(steam);

    await writer.apply(["--fps", "120"]);
    await writer.apply(["--fps", "30"]);

    expect(steam.flagsOn(1)).toEqual(["--fps", "30"]);
  });
});

describe("when Steam will not take a rewrite", () => {
  it("gives the other shortcuts their new flags anyway", async () => {
    const steam = new FakeShortcuts(["Desktop", "Factorio", "Balatro"]);
    steam.refuse.add(2);

    const commit = await writerOver(steam).apply(["--hdr"]);

    expect(commit.rewritten).toBe(2);
    expect(steam.flagsOn(1)).toEqual(["--hdr"]);
    expect(steam.flagsOn(3)).toEqual(["--hdr"]);
  });

  it("names what was missed and the next step", async () => {
    const steam = new FakeShortcuts(["Desktop", "Factorio"]);
    steam.refuse.add(2);

    const commit = await writerOver(steam).apply(["--hdr"]);

    expect(commit.warnings).toHaveLength(1);
    expect(commit.warnings[0]).toContain("Factorio");
    expect(commit.warnings[0]).toContain("Sync");
  });

  it("treats a shortcut that throws as one that was missed, not as a failed change", async () => {
    // The setting is already stored by the time the rewrite runs, so a throw here must
    // not reach the write queue: it would cost every other shortcut its new flags.
    const steam = new FakeShortcuts(["Desktop", "Factorio", "Balatro"]);
    steam.throwOn.add(2);

    const commit = await writerOver(steam).apply(["--hdr"]);

    expect(commit.rewritten).toBe(2);
    expect(commit.warnings[0]).toContain("Factorio");
    expect(steam.flagsOn(1)).toEqual(["--hdr"]);
    expect(steam.flagsOn(3)).toEqual(["--hdr"]);
  });

  it("answers rather than throws when the shortcuts cannot be listed at all", async () => {
    const broken = {
      listOwned: async () => {
        await Promise.resolve();
        throw new Error("steam blew up");
      },
    } as unknown as ShortcutGateway;

    const commit = await new StreamFlagWriter(broken, silentLogger()).apply(["--hdr"]);

    expect(commit.rewritten).toBe(0);
    expect(commit.warnings[0]).toContain("Sync");
  });

  it("names Sync when Steam cannot be enumerated", async () => {
    const unavailable = {
      listOwned: async () => await Promise.resolve(null),
    } as unknown as ShortcutGateway;

    const commit = await new StreamFlagWriter(unavailable, silentLogger()).apply(["--hdr"]);

    expect(commit).toEqual({ rewritten: 0, warnings: [SHORTCUTS_NOT_REWRITTEN] });
  });

  it("names the next step on every way a rewrite can fall short", async () => {
    // The journey promise: a failure that does not say what to do next reads as a bug.
    const steam = new FakeShortcuts(["Desktop"]);
    steam.refuse.add(1);
    const refused = await writerOver(steam).apply(["--hdr"]);

    for (const warning of [...refused.warnings, SHORTCUTS_NOT_REWRITTEN]) {
      expect(warning).toContain("Sync");
    }
  });
});

describe("a later sync", () => {
  it("agrees with what the rewrite already wrote, so it reports nothing changed", async () => {
    // The backstop must not fight the fast path: a shortcut the writer brought up to date
    // has to equal the spec computePlan would build for it.
    const steam = new FakeShortcuts(["Desktop"]);
    const flags = streamFlags(STREAM_SETTING_REGISTRY, { fps: 60 });
    await writerOver(steam).apply(flags);

    const expected = specFor(
      {
        uuid: MOONSHINE,
        name: "Moonshine",
        address: ADDRESS,
        status: "online",
        apps: [],
      },
      { host_app_id: "1", title: "Desktop", art_cached: false },
      flags,
    );

    expect(steam.launchOptions.get(1)).toBe(expected.launchOptions);
  });
});
