import { describe, expect, it } from "vitest";

import {
  PLUGIN_SETTINGS_SCHEMA_VERSION,
  PluginSettingsDocument,
  PluginSettingsFormatError,
  parsePluginSettings,
} from "../../src/core/stream-settings/document";
import fixture from "../fixtures/plugin_settings.json";
import { DEFAULT_PRESENTATION_MODE } from "../../src/presentation/modes";

const EXPECTED: PluginSettingsDocument = {
  schema_version: 2,
  presentation_mode: "tabs",
  stream_settings: {
    resolution: "1920x1080",
    fps: 60,
    bitrate: 40,
    hdr: "off",
    "performance-overlay": "on",
  },
};

describe("the plugin settings contract", () => {
  it("parses the fixture the backend pins itself against, field for field", () => {
    expect(parsePluginSettings(fixture)).toEqual(EXPECTED);
  });

  it("carries every key the fixture declares", () => {
    expect(Object.keys(fixture).sort()).toEqual([
      "presentation_mode",
      "schema_version",
      "stream_settings",
    ]);
  });

  it("rejects a schema version it does not speak", () => {
    expect(() =>
      parsePluginSettings({ ...fixture, schema_version: PLUGIN_SETTINGS_SCHEMA_VERSION + 1 }),
    ).toThrow(PluginSettingsFormatError);
  });

  it("reads a document with no stream settings as none set", () => {
    const document = parsePluginSettings({
      schema_version: 2,
      presentation_mode: "collections",
    });

    expect(document.stream_settings).toEqual({});
  });

  it("drops a stored value the map cannot hold", () => {
    const document = parsePluginSettings({
      schema_version: 2,
      presentation_mode: "collections",
      stream_settings: { fps: 60, nested: { no: true } },
    });

    expect(document.stream_settings).toEqual({ fps: 60 });
  });
});

describe("the default presentation mode", () => {
  it("is the one the backend also defaults to", async () => {
    // Two hand-maintained copies of one fact, pinned by a fixture both sides assert.
    const shared = (await import("../fixtures/default_presentation_mode.json")).default;

    expect(shared.default_presentation_mode).toBe(DEFAULT_PRESENTATION_MODE);
  });
});
