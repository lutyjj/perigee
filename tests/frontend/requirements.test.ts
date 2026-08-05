import { describe, expect, it } from "vitest";

import {
  StreamSettingDescriptor,
  StreamSettingValue,
  TRISTATE_VALUES,
  flagsFor,
} from "../../src/core/stream-settings/descriptor";
import { STREAM_SETTING_REGISTRY } from "../../src/core/stream-settings/registry";
import {
  requirementLabel,
  requirementMet,
  streamFlags,
} from "../../src/core/stream-settings/stream-settings";

function accepted(descriptor: StreamSettingDescriptor): StreamSettingValue {
  switch (descriptor.kind) {
    case "tristate-toggle":
      return TRISTATE_VALUES[0];
    case "enum":
      return descriptor.options[0]!.value;
    case "slider":
      return descriptor.min;
  }
}

const DEPENDENT = STREAM_SETTING_REGISTRY.filter((descriptor) => descriptor.requires !== undefined);
const INDEPENDENT = STREAM_SETTING_REGISTRY.filter(
  (descriptor) => descriptor.requires === undefined,
);

describe("setting requirements", () => {
  it("covers at least one dependent setting", () => {
    expect(DEPENDENT.length).toBeGreaterThan(0);
  });

  it.each(INDEPENDENT.map((d) => [d.key, d] as const))("%s has nothing to wait for", (_k, d) => {
    expect(requirementMet(d, {})).toBe(true);
    expect(requirementLabel(d, STREAM_SETTING_REGISTRY)).toBeNull();
  });

  it.each(DEPENDENT.map((d) => [d.key, d] as const))(
    "%s is unmet while its owner is inherited or set to anything else",
    (_key, descriptor) => {
      const requirement = descriptor.requires!;

      expect(requirementMet(descriptor, {})).toBe(false);
      expect(requirementMet(descriptor, { [requirement.key]: "something-else" })).toBe(false);
      expect(requirementMet(descriptor, { [requirement.key]: requirement.value })).toBe(true);
    },
  );

  it.each(DEPENDENT.map((d) => [d.key, d] as const))(
    "%s names the setting it waits for, by that setting's own label",
    (_key, descriptor) => {
      const owner = STREAM_SETTING_REGISTRY.find(
        (candidate) => candidate.key === descriptor.requires?.key,
      );

      expect(requirementLabel(descriptor, STREAM_SETTING_REGISTRY)).toBe(
        `Requires ${owner?.label ?? ""}`,
      );
    },
  );

  it.each(DEPENDENT.map((d) => [d.key, d] as const))(
    "%s keeps its stored value while its requirement is unmet",
    (key, descriptor) => {
      const stored = { [key]: accepted(descriptor) };

      // The control greys out; nothing deletes what the user chose.
      expect(requirementMet(descriptor, stored)).toBe(false);
      expect(stored[key]).toBe(accepted(descriptor));
    },
  );

  it.each(DEPENDENT.map((d) => [d.key, d] as const))(
    "%s emits from its stored value alone, whatever its requirement says",
    (key, descriptor) => {
      const value = accepted(descriptor);
      const unmet = streamFlags(STREAM_SETTING_REGISTRY, { [key]: value });
      const met = streamFlags(STREAM_SETTING_REGISTRY, {
        [key]: value,
        [descriptor.requires!.key]: descriptor.requires!.value,
      });

      // Emission is a value-to-flag mapping and stays one; Moonlight decides what an
      // inert flag means.
      expect(unmet).toEqual(expect.arrayContaining(flagsFor(descriptor, value)));
      expect(met).toEqual(expect.arrayContaining(unmet));
    },
  );
});
