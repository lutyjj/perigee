import { COLLECTION_PREFIX } from "../../steam/collections";

/** The shape Steam's library tab strip consumes. Only the fields Perigee sets. */
export interface SteamTab {
  readonly id: string;
  readonly title: string;
  readonly footer?: unknown;
  readonly content: unknown;
  readonly renderTabAddon?: (() => unknown) | undefined;
}

export const TAB_ID_PREFIX = "perigee-";

/** Steam's own tab, cloned for structure. Everything else about a tab is copied from it. */
export const TEMPLATE_TAB_ID = "AllGames";

export interface PlannedTab {
  readonly id: string;
  readonly title: string;
  readonly collectionName: string;
}

export function isPerigeeTab(tab: { readonly id?: unknown }): boolean {
  return typeof tab.id === "string" && tab.id.startsWith(TAB_ID_PREFIX);
}

/**
 * A tab per collection Perigee owns. Deriving them from the collections rather than
 * from a sync means the tabs are there the moment the library renders, including on
 * the first render after a restart, and they name exactly what they draw.
 */
export function plannedTabs(collectionNames: readonly string[]): PlannedTab[] {
  return collectionNames
    .filter((name) => name.startsWith(COLLECTION_PREFIX))
    .map((name) => ({
      id: `${TAB_ID_PREFIX}${name.slice(COLLECTION_PREFIX.length)}`,
      title: name.slice(COLLECTION_PREFIX.length),
      collectionName: name,
    }));
}

/**
 * Splice Perigee's tabs into the strip Steam built: replace the ones already ours
 * (so a re-render does not duplicate them) and append the rest after Steam's own.
 */
export function mergeTabs(existing: readonly SteamTab[], ours: readonly SteamTab[]): SteamTab[] {
  const byId = new Map(ours.map((tab) => [tab.id, tab]));
  const kept = existing.map((tab) => byId.get(tab.id) ?? tab);
  const alreadyPresent = new Set(existing.map((tab) => tab.id));
  return [...kept, ...ours.filter((tab) => !alreadyPresent.has(tab.id))];
}
