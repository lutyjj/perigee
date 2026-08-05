import { describe, expect, it } from "vitest";

import { createPanelSession } from "../../src/core/panel-session";

describe("panel session", () => {
  it("starts calm: collapsed, with nothing reported", () => {
    const session = createPanelSession();

    expect(session).toEqual({
      streamingOpen: false,
      report: null,
      notes: [],
      sliderPositions: {},
    });
  });

  it("forgets everything on a fresh plugin load", () => {
    const previous = createPanelSession();
    previous.streamingOpen = true;
    previous.report = { created: 1, updated: 0, removed: 0, warnings: [] };

    expect(createPanelSession()).toEqual({
      streamingOpen: false,
      report: null,
      notes: [],
      sliderPositions: {},
    });
  });
});
