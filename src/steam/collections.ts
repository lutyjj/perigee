import { Logger } from "../core/logger";
import { SteamAppOverview, SteamCollection, SteamEnvironment } from "./api";

// Steam keys a user collection by its display name, so the name has to carry the
// namespace. Identity still lives in the shortcut tag; this is only the label.
export const COLLECTION_PREFIX = "Perigee: ";

/**
 * Every collection Perigee owns, read off the store rather than rebuilt from host
 * state. Purge has to work when a host is offline, unpaired, or renamed since the
 * collection was created, and none of those are visible in a fresh probe.
 */
function perigeeCollectionNames(
  userCollections: readonly { readonly displayName: string }[],
): string[] {
  return userCollections
    .map((collection) => collection.displayName)
    .filter((name) => name.startsWith(COLLECTION_PREFIX));
}

export function collectionNames(
  hosts: readonly { hostUuid: string; hostName: string }[],
): Map<string, string> {
  const shared = new Set(
    hosts
      .map((host) => host.hostName)
      .filter((name, index, names) => names.indexOf(name) !== index),
  );
  return new Map(
    hosts.map((host) => [
      host.hostUuid,
      shared.has(host.hostName)
        ? `${COLLECTION_PREFIX}${host.hostName} (${host.hostUuid.slice(0, 8)})`
        : `${COLLECTION_PREFIX}${host.hostName}`,
    ]),
  );
}

export class CollectionGateway {
  constructor(
    private readonly steam: SteamEnvironment,
    private readonly logger: Logger,
  ) {}

  /**
   * Membership converges only over apps Perigee owns. Anything else in the collection
   * was put there by the user and is left alone, whoever created the collection.
   */
  async setMembership(
    collectionName: string,
    steamAppIds: readonly number[],
    ownedSteamAppIds: ReadonlySet<number>,
  ): Promise<void> {
    const collection = await this.findOrCreate(collectionName);
    if (collection === null) {
      this.logger.warn(`No Steam collection for ${collectionName}, shortcuts stay uncollected`);
      return;
    }

    const wanted = new Set(steamAppIds);
    const additions = steamAppIds
      .filter((steamAppId) => !collection.apps.has(steamAppId))
      .map((steamAppId) => this.steam.appStore.m_mapApps.get(steamAppId))
      .filter((overview): overview is SteamAppOverview => overview !== undefined);
    const removals = collection.allApps.filter(
      (overview) => ownedSteamAppIds.has(overview.appid) && !wanted.has(overview.appid),
    );

    if (additions.length === 0 && removals.length === 0) {
      return;
    }

    const dragDrop = collection.AsDragDropCollection();
    if (removals.length > 0) {
      dragDrop.RemoveApps(removals);
    }
    if (additions.length > 0) {
      dragDrop.AddApps(additions);
    }
    await collection.Save();
  }

  /** The Steam collection object behind a name, for callers that render it. */
  find(collectionName: string): SteamCollection | undefined {
    const existingId = this.steam.collectionStore.GetCollectionIDByUserTag(collectionName);
    if (typeof existingId === "string") {
      return this.steam.collectionStore.GetCollection(existingId);
    }
    return (this.steam.collectionStore.userCollections ?? []).find(
      (candidate) => candidate.displayName === collectionName,
    );
  }

  /** Every collection Perigee created, whatever the current hosts happen to be. */
  ownedNames(): string[] {
    return perigeeCollectionNames(this.steam.collectionStore.userCollections ?? []);
  }

  async remove(collectionName: string): Promise<void> {
    const collection = this.find(collectionName);
    if (collection === undefined) {
      throw new Error(`Steam has no collection named ${collectionName}`);
    }
    await collection.Delete();
  }

  private async findOrCreate(collectionName: string): Promise<SteamCollection | null> {
    const existingId = this.steam.collectionStore.GetCollectionIDByUserTag(collectionName);
    if (typeof existingId === "string") {
      return this.steam.collectionStore.GetCollection(existingId) ?? null;
    }
    const created = this.steam.collectionStore.NewUnsavedCollection(collectionName, undefined, []);
    if (created === undefined) {
      return null;
    }
    await created.Save();
    return created;
  }
}
