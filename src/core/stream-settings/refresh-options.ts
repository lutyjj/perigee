import type { EnumOption } from "./descriptor";

// What the client will ask a host for at all: a floor and a ceiling on the flag's own
// value, not a property of any display. A display's own peak is `max_refresh_hz`.
const REFRESH_HZ_FLOOR = 1;
const REFRESH_HZ_CEILING = 1000;

/** One 3600 Hz tick of headroom per frame, so the flag on `--fps` is what a VRR display can hold. */
const HEADROOM_HZ = 3600;

export interface RefreshCandidate {
  readonly hz: number;
  readonly vrr: boolean;
}

export function vrrCap(maxRefreshHz: number): number {
  return Math.floor(maxRefreshHz - (maxRefreshHz * maxRefreshHz) / HEADROOM_HZ);
}

export function isRefreshRate(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= REFRESH_HZ_FLOOR &&
    value <= REFRESH_HZ_CEILING
  );
}

/** What a display of this peak is worth offering: the common rates, its half, its cap, itself. */
export function offeredRates(maxRefreshHz: number): RefreshCandidate[] {
  return [
    { hz: 30, vrr: false },
    { hz: 60, vrr: false },
    { hz: Math.floor(maxRefreshHz / 2), vrr: false },
    { hz: vrrCap(maxRefreshHz), vrr: true },
    { hz: maxRefreshHz, vrr: false },
  ].filter((candidate) => candidate.hz <= maxRefreshHz);
}

/**
 * Ascending and deduplicated. A rate is marked VRR only where nothing plainer also
 * claims it, so a cap that lands on an ordinary rate is labelled as the ordinary one.
 */
export function refreshOptions(candidates: readonly RefreshCandidate[]): EnumOption[] {
  const vrrByRate = new Map<number, boolean>();
  for (const candidate of candidates) {
    if (!isRefreshRate(candidate.hz)) {
      continue;
    }
    vrrByRate.set(candidate.hz, (vrrByRate.get(candidate.hz) ?? true) && candidate.vrr);
  }
  return [...vrrByRate.entries()]
    .sort(([left], [right]) => left - right)
    .map(([hz, vrr]) => ({ value: hz, label: vrr ? `${String(hz)} (VRR)` : String(hz) }));
}
