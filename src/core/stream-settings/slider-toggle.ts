import { SliderDescriptor } from "./descriptor";

/**
 * A slider setting is a toggle plus a slider, the way Steam's own performance panel
 * presents its TDP limit. Inherit stays the absence of a stored value: the toggle
 * deletes it, and the slider keeps showing the position it had, so re-enabling gives
 * the user back what they set.
 */
export function sliderShown(
  descriptor: SliderDescriptor,
  value: unknown,
  remembered: number | undefined,
): number {
  if (typeof value === "number") {
    return value;
  }
  return typeof remembered === "number" ? remembered : descriptor.min;
}

export function sliderToggle(enabled: boolean, shown: number): number | undefined {
  return enabled ? shown : undefined;
}
