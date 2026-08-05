import { DisplayCapabilities, UNKNOWN_DISPLAY } from "../display";
// Types only: descriptor.ts imports this module for values, so the pair is not a cycle.
import type { EnumDescriptor, EnumOption, StreamSettingValue } from "./descriptor";
import { RefreshCandidate, isRefreshRate, offeredRates, refreshOptions } from "./refresh-options";

/**
 * What the device reports about itself, for the providers that render from it. One
 * field per capability, so a provider fed by a new capability costs that field and one
 * fetch, and no renderer ever learns the capability exists.
 */
export interface OptionContext {
  readonly display: DisplayCapabilities;
}

/** Every capability undetected: where the panel starts, and where a failed read leaves it. */
export const NOTHING_DETECTED: OptionContext = { display: UNKNOWN_DISPLAY };

/**
 * Who fills an enum's option list. A descriptor names one; nothing else does, so a
 * new provider is one object plus one row in the table below.
 */
export const OPTION_PROVIDER_NAMES = ["static", "client-display"] as const;

export type OptionProviderName = (typeof OPTION_PROVIDER_NAMES)[number];

export interface OptionProvider {
  /** What the panel offers now. `stored` is the user's current value, which must stay offerable. */
  options(
    descriptor: EnumDescriptor,
    context: OptionContext,
    stored: StreamSettingValue | undefined,
  ): readonly EnumOption[];
  /** What the setting still accepts later, when the list has moved on. */
  accepts(descriptor: EnumDescriptor, value: StreamSettingValue): boolean;
}

const STATIC: OptionProvider = {
  options: (descriptor) => descriptor.options,
  accepts: (descriptor, value) => descriptor.options.some((option) => option.value === value),
};

/**
 * Refresh rates read off the connected display. A display can be swapped under a stored
 * value, so acceptance is the whole rate domain rather than what this display offers.
 */
const CLIENT_DISPLAY: OptionProvider = {
  options: (descriptor, context, stored) => {
    const declared = STATIC.options(descriptor, context, stored);
    const peak = context.display.max_refresh_hz;
    const offered =
      peak === null
        ? declared.flatMap((option) => rateCandidate(option.value))
        : offeredRates(peak);
    // The stored value is the user's, not the display's, so it stays on the list.
    const built = refreshOptions([...offered, ...rateCandidate(stored)]);
    // An unusable list degrades too, not only an undetected display: a display reporting
    // nothing this client can ask for must not empty the control either.
    return built.length > 0 ? built : declared;
  },
  accepts: (_descriptor, value) => isRefreshRate(value),
};

const PROVIDERS: Record<OptionProviderName, OptionProvider> = {
  static: STATIC,
  "client-display": CLIENT_DISPLAY,
};

export function optionProvider(descriptor: EnumDescriptor): OptionProvider {
  return PROVIDERS[descriptor.optionsFrom ?? "static"];
}

export function optionsFor(
  descriptor: EnumDescriptor,
  context: OptionContext,
  stored: StreamSettingValue | undefined,
): readonly EnumOption[] {
  return optionProvider(descriptor).options(descriptor, context, stored);
}

function rateCandidate(value: StreamSettingValue | undefined): RefreshCandidate[] {
  return typeof value === "number" ? [{ hz: value, vrr: false }] : [];
}
