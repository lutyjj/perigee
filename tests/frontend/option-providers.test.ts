import { describe, expect, it } from "vitest";

import { DisplayCapabilities } from "../../src/core/display";
import { EnumDescriptor, accepts } from "../../src/core/stream-settings/descriptor";
import {
  NOTHING_DETECTED,
  OPTION_PROVIDER_NAMES,
  OptionContext,
  optionsFor,
} from "../../src/core/stream-settings/option-providers";
import { vrrCap } from "../../src/core/stream-settings/refresh-options";
import { STREAM_SETTING_REGISTRY } from "../../src/core/stream-settings/registry";
import { streamFlags, validate } from "../../src/core/stream-settings/stream-settings";

function displayOf(maxRefreshHz: number): OptionContext {
  const display: DisplayCapabilities = {
    schema_version: 1,
    detection: "detected",
    connector: "HDMI-A-1",
    max_refresh_hz: maxRefreshHz,
    modes: [{ width: 1920, height: 1080, refresh_hz: maxRefreshHz }],
    reason: null,
  };
  return { ...NOTHING_DETECTED, display };
}

const ENUMS: readonly EnumDescriptor[] = STREAM_SETTING_REGISTRY.filter(
  (descriptor): descriptor is EnumDescriptor => descriptor.kind === "enum",
);

const PROVIDER_FED = ENUMS.filter((descriptor) => descriptor.optionsFrom === "client-display");

const labels = (descriptor: EnumDescriptor, context: OptionContext, stored?: number) =>
  optionsFor(descriptor, context, stored).map((option) => option.label);

const values = (descriptor: EnumDescriptor, context: OptionContext, stored?: number) =>
  optionsFor(descriptor, context, stored).map((option) => option.value);

describe("the registry-derived lists these cases iterate", () => {
  // An it.each over an empty array registers no tests and reports green, so the
  // registry dropping `optionsFrom` would delete every case below in silence.
  it("covers at least one enum and at least one provider-fed setting", () => {
    expect(ENUMS.length).toBeGreaterThan(0);
    expect(PROVIDER_FED.length).toBeGreaterThan(0);
  });
});

describe("the VRR cap", () => {
  it.each([
    [120, 116],
    [144, 138],
    [165, 157],
    [240, 224],
  ])("caps a %i Hz display at %i", (maxRefreshHz, expected) => {
    expect(vrrCap(maxRefreshHz)).toBe(expected);
  });

  it("always leaves headroom below the display's own rate", () => {
    for (let maxRefreshHz = 24; maxRefreshHz <= 360; maxRefreshHz += 1) {
      expect(vrrCap(maxRefreshHz)).toBeLessThan(maxRefreshHz);
    }
  });
});

describe("refresh rates offered for a display", () => {
  it.each(PROVIDER_FED.map((descriptor) => [descriptor.key, descriptor] as const))(
    "%s offers the display's rates, its half, its cap and itself",
    (_key, descriptor) => {
      expect(labels(descriptor, displayOf(120))).toEqual(["30", "60", "116 (VRR)", "120"]);
      expect(labels(descriptor, displayOf(144))).toEqual(["30", "60", "72", "138 (VRR)", "144"]);
      expect(labels(descriptor, displayOf(165))).toEqual(["30", "60", "82", "157 (VRR)", "165"]);
      expect(labels(descriptor, displayOf(240))).toEqual(["30", "60", "120", "224 (VRR)", "240"]);
    },
  );

  it.each(PROVIDER_FED.map((descriptor) => [descriptor.key, descriptor] as const))(
    "%s never offers a rate the display cannot reach, in ascending order",
    (_key, descriptor) => {
      for (let maxRefreshHz = 24; maxRefreshHz <= 360; maxRefreshHz += 1) {
        const offered = values(descriptor, displayOf(maxRefreshHz)) as number[];

        expect(offered).toEqual([...offered].sort((left, right) => left - right));
        expect(new Set(offered).size).toBe(offered.length);
        expect(Math.max(...offered)).toBe(maxRefreshHz);
        for (const rate of offered) {
          expect(accepts(descriptor, rate)).toBe(true);
        }
      }
    },
  );

  it.each(PROVIDER_FED.map((descriptor) => [descriptor.key, descriptor] as const))(
    "%s labels a cap that lands on an ordinary rate as the ordinary one",
    (_key, descriptor) => {
      // A 62 Hz display caps at exactly 60, which is already on the list.
      expect(labels(descriptor, displayOf(62))).toEqual(["30", "31", "60", "62"]);
    },
  );

  it.each(PROVIDER_FED.map((descriptor) => [descriptor.key, descriptor] as const))(
    "%s falls back to the list it declares when no display was detected",
    (_key, descriptor) => {
      const declared = descriptor.options.map((option) => option.value);

      expect(values(descriptor, NOTHING_DETECTED)).toEqual(declared);
      expect(values(descriptor, NOTHING_DETECTED).length).toBeGreaterThan(0);
    },
  );

  it.each(PROVIDER_FED.map((descriptor) => [descriptor.key, descriptor] as const))(
    "%s falls back to that list again when the display offers nothing askable",
    (_key, descriptor) => {
      // A peak this client cannot ask for builds an empty list, which is not a control.
      const declared = descriptor.options.map((option) => option.value);

      expect(values(descriptor, displayOf(0))).toEqual(declared);
    },
  );
});

describe("a stored value the display no longer offers", () => {
  it.each(PROVIDER_FED.map((descriptor) => [descriptor.key, descriptor] as const))(
    "%s keeps offering it and keeps emitting it",
    (key, descriptor) => {
      const onATelevisionThatCannotReachIt = displayOf(60);

      expect(values(descriptor, onATelevisionThatCannotReachIt, 165)).toEqual([30, 59, 60, 165]);
      expect(validate([descriptor], { [key]: 165 }).rejected).toEqual([]);
      expect(streamFlags([descriptor], { [key]: 165 })).toEqual([descriptor.flag, "165"]);
    },
  );

  it.each(PROVIDER_FED.map((descriptor) => [descriptor.key, descriptor] as const))(
    "%s still offers it when the display was not detected at all",
    (_key, descriptor) => {
      expect(values(descriptor, NOTHING_DETECTED, 165)).toContain(165);
    },
  );
});

describe("the option provider seam", () => {
  it("gives every enum a provider the table knows", () => {
    for (const descriptor of ENUMS) {
      expect(OPTION_PROVIDER_NAMES).toContain(descriptor.optionsFrom ?? "static");
      expect(descriptor.options.length).toBeGreaterThan(0);
    }
  });

  it("accepts every option its descriptor declares, which is what makes them a degrade path", () => {
    for (const descriptor of ENUMS) {
      for (const option of descriptor.options) {
        expect(accepts(descriptor, option.value)).toBe(true);
      }
    }
  });

  it("leaves a setting with no named provider on the list it declares", () => {
    const declared = ENUMS.filter((descriptor) => descriptor.optionsFrom === undefined);

    expect(declared.length).toBeGreaterThan(0);
    for (const descriptor of declared) {
      expect(optionsFor(descriptor, displayOf(240), undefined)).toEqual(descriptor.options);
      expect(optionsFor(descriptor, NOTHING_DETECTED, undefined)).toEqual(descriptor.options);
    }
  });

  it("rejects a value outside the provider's domain even when a display is connected", () => {
    for (const descriptor of PROVIDER_FED) {
      expect(accepts(descriptor, 0)).toBe(false);
      expect(accepts(descriptor, 60.5)).toBe(false);
      expect(accepts(descriptor, "sixty")).toBe(false);
    }
  });
});

describe("the frame rate picker on a 120 Hz display", () => {
  it("offers exactly the four rates that display is worth asking for", () => {
    const fps = STREAM_SETTING_REGISTRY.find((descriptor) => descriptor.key === "fps");
    expect(fps?.kind).toBe("enum");

    const offered = optionsFor(fps as EnumDescriptor, displayOf(120), undefined);

    expect(offered).toEqual([
      { value: 30, label: "30" },
      { value: 60, label: "60" },
      { value: 116, label: "116 (VRR)" },
      { value: 120, label: "120" },
    ]);
    expect(streamFlags(STREAM_SETTING_REGISTRY, { fps: 116 })).toEqual(["--fps", "116"]);
  });

  it("stays a usable control with the backend answering nothing", () => {
    for (const descriptor of ENUMS) {
      expect(optionsFor(descriptor, NOTHING_DETECTED, undefined).length).toBeGreaterThan(0);
    }
  });
});
