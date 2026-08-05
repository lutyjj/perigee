import { describe, expect, it } from "vitest";

import {
  DISPLAY_CAPABILITIES_SCHEMA_VERSION,
  DisplayCapabilities,
  DisplayCapabilitiesFormatError,
  UNKNOWN_DISPLAY,
  parseDisplayCapabilities,
} from "../../src/core/display";
import fixture from "../fixtures/display_capabilities.json";

// The backend asserts from_json(fixture).to_json() equals this same file, so asserting
// the whole parsed object here fails either side of the mirror the moment a field moves.
const EXPECTED: DisplayCapabilities = {
  schema_version: 1,
  detection: "detected",
  connector: "HDMI-A-1",
  max_refresh_hz: 120,
  modes: [
    { width: 3840, height: 2160, refresh_hz: 60.0 },
    { width: 2560, height: 1440, refresh_hz: 119.998 },
  ],
  reason: null,
};

const UNKNOWN_DOCUMENT = {
  schema_version: 1,
  detection: "unknown",
  connector: null,
  max_refresh_hz: null,
  modes: [],
  reason: "no connected display",
};

describe("display capabilities wire contract", () => {
  it("parses the fixture the backend pins itself against, field for field", () => {
    expect(parseDisplayCapabilities(fixture)).toEqual(EXPECTED);
  });

  it("carries every key the fixture declares", () => {
    expect(Object.keys(fixture).sort()).toEqual([
      "connector",
      "detection",
      "max_refresh_hz",
      "modes",
      "reason",
      "schema_version",
    ]);
    expect(Object.keys(fixture.modes[0]!).sort()).toEqual(["height", "refresh_hz", "width"]);
  });

  it("parses an undetected display without a connector", () => {
    const capabilities = parseDisplayCapabilities(UNKNOWN_DOCUMENT);

    expect(capabilities.detection).toBe("unknown");
    expect(capabilities.max_refresh_hz).toBeNull();
    expect(capabilities.reason).toBe("no connected display");
  });

  it("rejects a schema version it does not speak", () => {
    expect(() =>
      parseDisplayCapabilities({
        ...fixture,
        schema_version: DISPLAY_CAPABILITIES_SCHEMA_VERSION + 1,
      }),
    ).toThrow(DisplayCapabilitiesFormatError);
  });

  // Mirrors the backend's table in tests/backend/test_display.py, case for case: both
  // sides derive detection and max_refresh_hz from modes, so both must reject the same
  // documents.
  it.each([
    ["an unknown detection", { detection: "maybe" }],
    ["a detection that contradicts the modes", { detection: "unknown" }],
    ["a rate that contradicts the modes", { max_refresh_hz: 240 }],
    ["a rate that is not a number", { max_refresh_hz: "fast" }],
    ["a rate that is null while modes are present", { max_refresh_hz: null }],
    ["a rate stated without any modes", { modes: [] }],
    [
      "detection stated without any modes",
      { detection: "detected", max_refresh_hz: 240, modes: [] },
    ],
    ["modes that are not an array", { modes: {} }],
    ["a mode missing a dimension", { modes: [{ width: 3840, refresh_hz: 60 }] }],
    ["a connector that is not text", { connector: 1 }],
  ])("rejects %s", (_case, damage) => {
    expect(() => parseDisplayCapabilities({ ...fixture, ...damage })).toThrow(
      DisplayCapabilitiesFormatError,
    );
  });

  // Both mirrors derive the peak, so both must round it the same way or every document
  // one produces is a document the other rejects. The backend pins the same three cases.
  it.each([
    [59.5, 60],
    [60.5, 61],
    [119.998, 120],
  ])("rounds a %f Hz peak half up, the way the backend rounds", (refreshHz, peak) => {
    const document = {
      ...fixture,
      max_refresh_hz: peak,
      modes: [{ width: 1920, height: 1080, refresh_hz: refreshHz }],
    };

    expect(parseDisplayCapabilities(document).max_refresh_hz).toBe(peak);
  });

  it("starts every consumer from an explicit unknown rather than a guess", () => {
    expect(UNKNOWN_DISPLAY.detection).toBe("unknown");
    expect(UNKNOWN_DISPLAY.max_refresh_hz).toBeNull();
    expect(parseDisplayCapabilities({ ...UNKNOWN_DOCUMENT, reason: UNKNOWN_DISPLAY.reason })).toEqual(
      UNKNOWN_DISPLAY,
    );
  });
});
