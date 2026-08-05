import { Logger } from "../core/logger";
import { ShortcutSpec, computePlan } from "../core/plan";
import { SyncState } from "../core/model";
import { HostPresentation, PresentationGateway } from "../presentation/gateway";
import { ShortcutGateway } from "../steam/shortcuts";

export interface SyncReport {
  readonly created: number;
  readonly updated: number;
  readonly removed: number;
  readonly warnings: readonly string[];
}

export interface PurgeReport {
  readonly removed: number;
  readonly warnings: readonly string[];
}

export type ArtSource = (hostUuid: string, hostAppId: string) => Promise<string | null>;
export type BackendPurge = () => Promise<void>;

// A sync the user just asked for that could not start. The rewrite path states its own
// next step instead, because there the change is already stored and only Sync repairs it.
const STEAM_NOT_READY = "Steam is not ready, nothing was changed";

/**
 * Converges Steam from a state the caller already has. Probing belongs to the panel
 * now, so pressing Sync never waits on the network.
 */
export class SyncController {
  constructor(
    private readonly artSource: ArtSource,
    private readonly backendPurge: BackendPurge,
    private readonly shortcuts: ShortcutGateway,
    private readonly presentation: PresentationGateway,
    private readonly logger: Logger,
  ) {}

  async sync(state: SyncState, flags: readonly string[] = []): Promise<SyncReport> {
    const owned = await this.shortcuts.listOwned();
    if (owned === null) {
      return { created: 0, updated: 0, removed: 0, warnings: [STEAM_NOT_READY] };
    }

    const plan = computePlan(state, owned, flags);
    const warnings = [...plan.warnings, ...state.errors.map(describe)];
    const placed = new Map<number, ShortcutSpec>();

    let created = 0;
    for (const spec of plan.creates) {
      const steamAppId = await this.shortcuts.create(spec);
      if (steamAppId === null) {
        warnings.push(`Steam would not accept a shortcut for ${spec.title}`);
        continue;
      }
      placed.set(steamAppId, spec);
      created += 1;
    }

    let updated = 0;
    for (const target of plan.updates) {
      if (await this.shortcuts.update(target.steamAppId, target.spec)) {
        updated += 1;
      } else {
        warnings.push(`Steam would not update the shortcut for ${target.spec.title}`);
      }
      placed.set(target.steamAppId, target.spec);
    }
    for (const target of plan.unchanged) {
      placed.set(target.steamAppId, target.spec);
    }

    // Artwork is re-applied to every converged shortcut, not only the ones that changed:
    // box art added on the host later has no other way in, and a manual sync over a
    // handful of apps can afford the writes.
    for (const [steamAppId, spec] of placed) {
      await this.applyArt(steamAppId, spec);
    }

    for (const shortcut of plan.deletes) {
      this.shortcuts.remove(shortcut.steamAppId);
    }

    warnings.push(
      ...(await this.presentation.apply(hostsOf(state, placed), new Set(placed.keys()))),
    );
    return { created, updated, removed: plan.deletes.length, warnings };
  }

  /** The explicit abandon edge: give back every shortcut and collection Perigee made. */
  async purge(): Promise<PurgeReport> {
    const owned = await this.shortcuts.listOwned();
    if (owned === null) {
      return { removed: 0, warnings: [STEAM_NOT_READY] };
    }
    for (const shortcut of owned) {
      this.shortcuts.remove(shortcut.steamAppId);
    }
    const warnings = [...(await this.presentation.remove())];
    await this.backendPurge();
    return { removed: owned.length, warnings };
  }

  private async applyArt(steamAppId: number, spec: ShortcutSpec): Promise<void> {
    try {
      const base64Png = await this.artSource(spec.hostUuid, spec.hostAppId);
      if (base64Png !== null) {
        await this.shortcuts.setCapsule(steamAppId, base64Png);
      }
    } catch (error) {
      this.logger.warn(`Capsule artwork for ${spec.title} failed`, error);
    }
  }
}

function describe(error: SyncState["errors"][number]): string {
  return error.host_uuid === null ? error.message : `${error.host_uuid}: ${error.message}`;
}

/** Only hosts that actually converged get a presentation; the rest keep whatever they had. */
export function hostsOf(
  state: SyncState,
  placed: ReadonlyMap<number, ShortcutSpec>,
): HostPresentation[] {
  return state.hosts
    .filter((host) => host.status === "online" && host.apps.length > 0)
    .map((host) => ({
      hostUuid: host.uuid,
      hostName: host.name,
      steamAppIds: [...placed.entries()]
        .filter(([, spec]) => spec.hostUuid === host.uuid)
        .map(([steamAppId]) => steamAppId),
    }));
}
