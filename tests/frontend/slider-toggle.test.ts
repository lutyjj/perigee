import { describe, expect, it } from "vitest";

import { SliderDescriptor, accepts } from "../../src/core/stream-settings/descriptor";
import { STREAM_SETTING_REGISTRY } from "../../src/core/stream-settings/registry";
import { sliderShown, sliderToggle } from "../../src/core/stream-settings/slider-toggle";
import { createPanelSession } from "../../src/core/panel-session";

const SLIDERS = STREAM_SETTING_REGISTRY.filter(
  (descriptor): descriptor is SliderDescriptor => descriptor.kind === "slider",
);

describe("a slider setting's toggle", () => {
  it("covers every slider the registry declares", () => {
    expect(SLIDERS.length).toBeGreaterThan(0);
  });

  it.each(SLIDERS.map((d) => [d.key, d] as const))(
    "%s: toggling off deletes the value rather than storing one",
    (_key, descriptor) => {
      expect(sliderToggle(false, descriptor.max)).toBeUndefined();
    },
  );

  it.each(SLIDERS.map((d) => [d.key, d] as const))(
    "%s: toggling on stores exactly the position on show",
    (_key, descriptor) => {
      const shown = sliderShown(descriptor, undefined, descriptor.min + descriptor.step);

      expect(sliderToggle(true, shown)).toBe(descriptor.min + descriptor.step);
      expect(accepts(descriptor, shown)).toBe(true);
    },
  );

  it.each(SLIDERS.map((d) => [d.key, d] as const))(
    "%s: a fresh session shows the descriptor's default, disabled",
    (_key, descriptor) => {
      const session = createPanelSession();

      expect(session.sliderPositions[descriptor.key]).toBeUndefined();
      expect(sliderShown(descriptor, undefined, session.sliderPositions[descriptor.key])).toBe(
        descriptor.min,
      );
    },
  );

  it.each(SLIDERS.map((d) => [d.key, d] as const))(
    "%s: the session restores the position a disabled slider had",
    (_key, descriptor) => {
      const session = createPanelSession();
      session.sliderPositions = { [descriptor.key]: descriptor.max };

      expect(sliderShown(descriptor, undefined, session.sliderPositions[descriptor.key])).toBe(
        descriptor.max,
      );
    },
  );

  it.each(SLIDERS.map((d) => [d.key, d] as const))(
    "%s: a stored value wins over whatever the session remembers",
    (_key, descriptor) => {
      expect(sliderShown(descriptor, descriptor.min, descriptor.max)).toBe(descriptor.min);
    },
  );
});
