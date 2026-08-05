// What a streaming setting is, independent of which settings exist.
//
// A descriptor carries everything three consumers need: the launch line builder,
// the settings page, and the validator. None of them may name a setting, so adding
// one is a single entry in registry.ts.
//
// option-providers.ts imports this module for types only, so the pair is not a cycle
// at runtime.
import { OptionProviderName, optionProvider } from "./option-providers";

/** Absence is the third state of a toggle: no stored value means Moonlight decides. */
export const TRISTATE_VALUES = ["on", "off"] as const;

export type TristateValue = (typeof TRISTATE_VALUES)[number];

export type StreamSettingValue = string | number;

/** One setting only makes sense while another holds a value. Data, not a branch. */
export interface SettingRequirement {
  readonly key: string;
  readonly value: StreamSettingValue;
}

interface CommonDescriptor {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /**
   * The heading this setting sits under in the panel. Presentation only and never
   * stored, so the heading text is the grouping key: a new group is a new string in
   * one descriptor, and group order follows first appearance in the registry.
   */
  readonly group: string;
  /** Rendered disabled until this holds. Emission never consults it. */
  readonly requires?: SettingRequirement;
}

export interface TristateToggleDescriptor extends CommonDescriptor {
  readonly kind: "tristate-toggle";
  readonly onFlag: string;
  readonly offFlag: string;
}

export interface SliderDescriptor extends CommonDescriptor {
  readonly kind: "slider";
  readonly flag: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** The unit the user sees. The flag carries `value * flagScale`. */
  readonly unit: string;
  readonly flagScale: number;
}

export interface EnumOption {
  readonly value: StreamSettingValue;
  readonly label: string;
}

export interface EnumDescriptor extends CommonDescriptor {
  readonly kind: "enum";
  readonly flag: string;
  /** The list when no provider is named, and what a provider degrades to. Never empty. */
  readonly options: readonly EnumOption[];
  /** Who fills the list at render time. Absent means the declared list is the list. */
  readonly optionsFrom?: OptionProviderName;
}

export type StreamSettingDescriptor =
  | TristateToggleDescriptor
  | SliderDescriptor
  | EnumDescriptor;

export type StreamSettings = Readonly<Record<string, StreamSettingValue>>;

/** The flags one setting contributes. Empty when the user left it inherited. */
export function flagsFor(
  descriptor: StreamSettingDescriptor,
  value: StreamSettingValue | undefined,
): string[] {
  if (value === undefined || !accepts(descriptor, value)) {
    return [];
  }
  switch (descriptor.kind) {
    case "tristate-toggle":
      return [value === "on" ? descriptor.onFlag : descriptor.offFlag];
    case "slider":
      return [descriptor.flag, String((value as number) * descriptor.flagScale)];
    case "enum":
      return [descriptor.flag, String(value)];
  }
}

export function accepts(
  descriptor: StreamSettingDescriptor,
  value: StreamSettingValue,
): boolean {
  switch (descriptor.kind) {
    case "tristate-toggle":
      return TRISTATE_VALUES.some((allowed) => allowed === value);
    case "slider":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= descriptor.min &&
        value <= descriptor.max
      );
    case "enum":
      // Whoever fills the list owns the domain: a provider-fed list moves under a
      // stored value, and the stored value is the user's.
      return optionProvider(descriptor).accepts(descriptor, value);
  }
}
