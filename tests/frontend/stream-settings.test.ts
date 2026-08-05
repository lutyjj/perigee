import { describe, expect, it } from "vitest";

import {
  StreamSettingDescriptor,
  StreamSettingValue,
  TRISTATE_VALUES,
  flagsFor,
} from "../../src/core/stream-settings/descriptor";
import { STREAM_SETTING_REGISTRY } from "../../src/core/stream-settings/registry";
import {
  groups,
  streamFlags,
  validate,
} from "../../src/core/stream-settings/stream-settings";
import { buildLaunchOptions, parseOwnershipTag } from "../../src/core/launch";

/** Every value a descriptor accepts, so a new entry is covered without touching a test. */
function acceptedValues(descriptor: StreamSettingDescriptor): StreamSettingValue[] {
  switch (descriptor.kind) {
    case "tristate-toggle":
      return [...TRISTATE_VALUES];
    case "enum":
      return descriptor.options.map((option) => option.value);
    case "slider":
      return [descriptor.min, descriptor.max];
  }
}

function rejectedValues(descriptor: StreamSettingDescriptor): StreamSettingValue[] {
  switch (descriptor.kind) {
    case "tristate-toggle":
      return ["maybe", 1];
    case "enum":
      return ["not-an-option", 0];
    case "slider":
      return [descriptor.min - 1, descriptor.max + 1, "not-a-number"];
  }
}

describe("the streaming settings registry", () => {
  it("declares a unique key per setting", () => {
    const keys = STREAM_SETTING_REGISTRY.map((descriptor) => descriptor.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("names only flags with a leading double dash", () => {
    for (const descriptor of STREAM_SETTING_REGISTRY) {
      const flags =
        descriptor.kind === "tristate-toggle"
          ? [descriptor.onFlag, descriptor.offFlag]
          : [descriptor.flag];
      for (const flag of flags) {
        expect(flag).toMatch(/^--[a-z0-9-]+$/);
      }
    }
  });

  it.each(STREAM_SETTING_REGISTRY.map((d) => [d.key, d] as const))(
    "%s round-trips every value it accepts into flags",
    (_key, descriptor) => {
      for (const value of acceptedValues(descriptor)) {
        const flags = flagsFor(descriptor, value);

        expect(flags.length).toBeGreaterThan(0);
        expect(validate([descriptor], { [descriptor.key]: value }).rejected).toEqual([]);
        expect(streamFlags([descriptor], { [descriptor.key]: value })).toEqual(flags);
      }
    },
  );

  it.each(STREAM_SETTING_REGISTRY.map((d) => [d.key, d] as const))(
    "%s rejects values outside what it declares",
    (key, descriptor) => {
      for (const value of rejectedValues(descriptor)) {
        expect(validate([descriptor], { [key]: value }).rejected).toEqual([key]);
        expect(streamFlags([descriptor], { [key]: value })).toEqual([]);
      }
    },
  );

  it.each(STREAM_SETTING_REGISTRY.map((d) => [d.key, d] as const))(
    "%s emits nothing when it is left inherited",
    (key, descriptor) => {
      expect(flagsFor(descriptor, undefined)).toEqual([]);
      expect(streamFlags([descriptor], {})).toEqual([]);
      expect(validate([descriptor], {}).values).toEqual({});
      expect(key).toBe(descriptor.key);
    },
  );

  it("drops a stored key no descriptor claims", () => {
    const result = validate(STREAM_SETTING_REGISTRY, { "gone-in-a-later-release": 1 });

    expect(result.values).toEqual({});
    expect(result.rejected).toEqual(["gone-in-a-later-release"]);
  });

  it("emits nothing at all when nothing is set", () => {
    expect(streamFlags(STREAM_SETTING_REGISTRY, {})).toEqual([]);
  });

  it("emits in registry order so the launch line is stable", () => {
    const values = Object.fromEntries(
      STREAM_SETTING_REGISTRY.map((descriptor) => [
        descriptor.key,
        acceptedValues(descriptor)[0] as StreamSettingValue,
      ]),
    );

    const flags = streamFlags(STREAM_SETTING_REGISTRY, values);
    const firstFlagOf = (descriptor: StreamSettingDescriptor) =>
      flags.indexOf(flagsFor(descriptor, values[descriptor.key])[0] as string);

    const positions = STREAM_SETTING_REGISTRY.map(firstFlagOf);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("converts a slider's unit on the way to the flag", () => {
    const bitrate = STREAM_SETTING_REGISTRY.find((d) => d.key === "bitrate");
    expect(bitrate?.kind).toBe("slider");

    expect(streamFlags(STREAM_SETTING_REGISTRY, { bitrate: 40 })).toEqual(["--bitrate", "40000"]);
  });
});

describe("settings in the launch line", () => {
  const target = {
    hostUuid: "15b43594-35e7-4df6-956b-908ffabb2ef2",
    hostAppId: "1",
    address: "192.0.2.10",
    title: 'Doom" --quit-after ; evil',
  };

  it("puts the flags where Moonlight documents them, before the stream verb", () => {
    const options = buildLaunchOptions({ ...target, flags: ["--fps", "60", "--hdr"] });

    expect(options).toContain("run com.moonlight_stream.Moonlight --fps 60 --hdr stream ");
    expect(options.endsWith(" --quit-after")).toBe(true);
  });

  it("leaves identity and quoting untouched whether or not flags are present", () => {
    const bare = parseOwnershipTag(buildLaunchOptions(target));
    const withFlags = parseOwnershipTag(
      buildLaunchOptions({ ...target, flags: streamFlags(STREAM_SETTING_REGISTRY, { fps: 60 }) }),
    );

    expect(withFlags).toEqual(bare);
    expect(withFlags?.hostTitle).toBe(target.title);
  });

  it("writes the same line for no flags as before settings existed", () => {
    expect(buildLaunchOptions({ ...target, flags: [] })).toBe(buildLaunchOptions(target));
  });
});

describe("panel grouping", () => {
  it("partitions the registry into groups, keeping registry order inside and out", () => {
    // Expectations are derived from the registry, never listed: a new group must not
    // need a test edit any more than it needs a renderer edit.
    const grouped = groups(STREAM_SETTING_REGISTRY);
    const firstAppearance = [...new Set(STREAM_SETTING_REGISTRY.map((d) => d.group))];

    expect(grouped.map((entry) => entry.group)).toEqual(firstAppearance);
    expect(grouped.flatMap((entry) => entry.settings.map((d) => d.key))).toEqual(
      STREAM_SETTING_REGISTRY.map((descriptor) => descriptor.key),
    );
  });

  it("gives every setting exactly one group", () => {
    const placed = groups(STREAM_SETTING_REGISTRY).flatMap((entry) => entry.settings);

    expect(placed).toHaveLength(STREAM_SETTING_REGISTRY.length);
    for (const descriptor of STREAM_SETTING_REGISTRY) {
      expect(descriptor.group).not.toBe("");
    }
  });

  it("orders groups by first appearance, so a new one needs no list to be updated", () => {
    const invented = [
      { ...(STREAM_SETTING_REGISTRY[0] as StreamSettingDescriptor), key: "a", group: "Later" },
      { ...(STREAM_SETTING_REGISTRY[0] as StreamSettingDescriptor), key: "b", group: "Earlier" },
      { ...(STREAM_SETTING_REGISTRY[0] as StreamSettingDescriptor), key: "c", group: "Later" },
    ];

    expect(groups(invented)).toEqual([
      { group: "Later", settings: [invented[0], invented[2]] },
      { group: "Earlier", settings: [invented[1]] },
    ]);
  });
});

describe("the reserved settings namespace", () => {
  it("is claimed by no descriptor, so the device probe cannot unset a real setting", async () => {
    // `make verify` writes and unsets a key in this namespace against the real settings
    // file. A descriptor keyed inside it would make that probe delete the user's value.
    const shared = (await import("../fixtures/reserved_setting_prefix.json")).default;

    const claimed = STREAM_SETTING_REGISTRY.map((descriptor) => descriptor.key).filter((key) =>
      key.startsWith(shared.reserved_setting_key_prefix),
    );

    expect(claimed).toEqual([]);
  });
});
