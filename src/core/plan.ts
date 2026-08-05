import { UnrepresentableTargetError, buildLaunchOptions } from "./launch";
import { AppEntry, HostState, SyncState, configWasRead } from "./model";

export interface OwnedShortcut {
  readonly steamAppId: number;
  readonly hostUuid: string;
  readonly hostAppId: string;
  readonly hostTitle: string;
  readonly address: string;
  readonly displayName: string;
  readonly launchOptions: string;
}

export interface ShortcutSpec {
  readonly hostUuid: string;
  readonly hostAppId: string;
  readonly title: string;
  readonly launchOptions: string;
}

export interface PlacedShortcut {
  readonly steamAppId: number;
  readonly spec: ShortcutSpec;
}

export interface SyncPlan {
  readonly creates: readonly ShortcutSpec[];
  readonly updates: readonly PlacedShortcut[];
  readonly unchanged: readonly PlacedShortcut[];
  readonly deletes: readonly OwnedShortcut[];
  readonly warnings: readonly string[];
}

/**
 * Moonshine derives an app's numeric id from a hash of its title, so the title is the
 * only identity the protocol actually offers. Keying on it makes a host-side id change
 * (a re-hash, a host upgrade) a harmless rewrite instead of a delete plus create, and
 * makes the one case that genuinely cannot be tracked - a host-side retitle - visible.
 */
export function shortcutKey(hostUuid: string, hostTitle: string): string {
  return `${hostUuid}\0${hostTitle}`;
}

export function specFor(
  host: HostState,
  app: AppEntry,
  flags: readonly string[] = [],
): ShortcutSpec {
  return {
    hostUuid: host.uuid,
    hostAppId: app.host_app_id,
    title: app.title,
    launchOptions: buildLaunchOptions({
      hostUuid: host.uuid,
      hostAppId: app.host_app_id,
      address: host.address,
      title: app.title,
      flags,
    }),
  };
}

/**
 * The launch options a shortcut Perigee already owns should carry under a new set of flags.
 * Its own ownership tag is the whole identity, so changing a streaming setting needs no host
 * probe, and nothing outside the launch line has to move.
 */
export function launchOptionsForOwned(
  shortcut: OwnedShortcut,
  flags: readonly string[],
): string {
  return buildLaunchOptions({
    hostUuid: shortcut.hostUuid,
    hostAppId: shortcut.hostAppId,
    address: shortcut.address,
    title: shortcut.hostTitle,
    flags,
  });
}

/**
 * Streaming flags ride in the launch options, so a shortcut whose flags are stale differs
 * from its spec and lands in `updates`. That is the backstop for a rewrite Steam refused,
 * not the path a setting change normally takes.
 */
export function computePlan(
  state: SyncState,
  owned: readonly OwnedShortcut[],
  flags: readonly string[] = [],
): SyncPlan {
  const creates: ShortcutSpec[] = [];
  const updates: PlacedShortcut[] = [];
  const unchanged: PlacedShortcut[] = [];
  const deletes: OwnedShortcut[] = [];
  const warnings: string[] = [];

  const ownedByKey = new Map(owned.map((shortcut) => [keyOf(shortcut), shortcut]));
  const pairedHosts = new Set(state.hosts.map((host) => host.uuid));
  const authoritativeHosts = new Set<string>();
  const expectedKeys = new Set<string>();

  for (const host of state.hosts) {
    if (host.status !== "online") {
      continue;
    }
    // An authoritative host that lists nothing is far more often a host-side glitch than
    // a real empty library, and acting on it would delete every shortcut it owns.
    if (host.apps.length === 0) {
      warnings.push(`${host.name} reported no apps, leaving its shortcuts untouched`);
      continue;
    }
    authoritativeHosts.add(host.uuid);
    for (const app of host.apps) {
      let spec: ShortcutSpec;
      try {
        spec = specFor(host, app, flags);
      } catch (error) {
        if (!(error instanceof UnrepresentableTargetError)) {
          throw error;
        }
        warnings.push(`${host.name}: skipped ${JSON.stringify(app.title)} - ${error.message}`);
        continue;
      }
      const key = shortcutKey(host.uuid, app.title);
      expectedKeys.add(key);
      const existing = ownedByKey.get(key);
      if (existing === undefined) {
        creates.push(spec);
      } else if (
        existing.launchOptions !== spec.launchOptions ||
        existing.displayName !== spec.title
      ) {
        updates.push({ steamAppId: existing.steamAppId, spec });
      } else {
        unchanged.push({ steamAppId: existing.steamAppId, spec });
      }
    }
  }

  const unpairedIsDeletable = configWasRead(state);
  for (const shortcut of owned) {
    if (authoritativeHosts.has(shortcut.hostUuid)) {
      if (!expectedKeys.has(keyOf(shortcut))) {
        deletes.push(shortcut);
      }
    } else if (!pairedHosts.has(shortcut.hostUuid) && unpairedIsDeletable) {
      deletes.push(shortcut);
    }
  }

  return { creates, updates, unchanged, deletes, warnings };
}

function keyOf(shortcut: OwnedShortcut): string {
  return shortcutKey(shortcut.hostUuid, shortcut.hostTitle);
}
