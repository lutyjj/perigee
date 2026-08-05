import { describe, expect, it } from "vitest";

import {
  UnrepresentableTargetError,
  buildLaunchOptions,
  parseOwnershipTag,
} from "../../src/core/launch";

const TARGET = {
  hostUuid: "15b43594-35e7-4df6-956b-908ffabb2ef2",
  hostAppId: "1",
  address: "192.0.2.10",
  title: "Steam Big Picture",
};

describe("launch options", () => {
  it("tags the shortcut and streams the app by title", () => {
    expect(buildLaunchOptions(TARGET)).toBe(
      "PERIGEE=15b43594-35e7-4df6-956b-908ffabb2ef2:1 %command% " +
        'run com.moonlight_stream.Moonlight stream 192.0.2.10 "Steam Big Picture" --quit-after',
    );
  });

  it("round-trips the identity, including the host title", () => {
    expect(parseOwnershipTag(buildLaunchOptions(TARGET))).toEqual({
      hostUuid: TARGET.hostUuid,
      hostAppId: TARGET.hostAppId,
      hostTitle: TARGET.title,
      address: TARGET.address,
    });
  });

  it("reads back a uuid that an older shortcut wrote in upper case", () => {
    const legacy = buildLaunchOptions({ ...TARGET, hostUuid: TARGET.hostUuid.toUpperCase() });

    expect(parseOwnershipTag(legacy)?.hostUuid).toBe(TARGET.hostUuid);
  });

  it("ignores shortcuts owned by anything else", () => {
    expect(parseOwnershipTag("%command% -foo")).toBeNull();
    expect(parseOwnershipTag("MOONDECK=1:2 %command%")).toBeNull();
    expect(parseOwnershipTag("")).toBeNull();
  });

  it.each([
    'Doom" --quit-after ; xdg-open http://evil ; #',
    'back\\slash and "quote"',
    "ends with a backslash \\",
    "100% Orange Juice",
  ])("survives a hostile host title: %s", (title) => {
    const options = buildLaunchOptions({ ...TARGET, title });

    expect(parseOwnershipTag(options)?.hostTitle).toBe(title);
    expect(options.endsWith(" --quit-after")).toBe(true);
  });

  it.each([
    ["newlines", "Doom\nmalicious"],
    ["tabs", "Doom\tmalicious"],
    ["the command token", "Doom %command% rm -rf"],
    ["nothing at all", ""],
  ])("refuses a title with %s", (_label, title) => {
    expect(() => buildLaunchOptions({ ...TARGET, title })).toThrow(UnrepresentableTargetError);
  });

  it("refuses an address that would break argument alignment", () => {
    expect(() => buildLaunchOptions({ ...TARGET, address: "192.0.2.9 --extra" })).toThrow(
      UnrepresentableTargetError,
    );
  });
});
