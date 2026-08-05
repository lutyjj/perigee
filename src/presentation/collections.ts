import { Logger } from "../core/logger";
import { collectionNames } from "../steam/collections";
import { HostPresentation, PresentationGateway } from "./gateway";

export interface CollectionApi {
  setMembership(
    collectionName: string,
    steamAppIds: readonly number[],
    ownedSteamAppIds: ReadonlySet<number>,
  ): Promise<void>;
  ownedNames(): string[];
  find(collectionName: string): unknown | undefined;
  remove(collectionName: string): Promise<void>;
}

/** One Steam collection per host. The default, and the only mode Steam supports natively. */
export class CollectionPresentation implements PresentationGateway {
  constructor(
    private readonly collections: CollectionApi,
    private readonly logger: Logger,
  ) {}

  engage(): void {
    // Steam draws collections on its own; nothing has to stay running.
  }

  disengage(): void {
    // Nothing to stop.
  }

  async apply(
    hosts: readonly HostPresentation[],
    ownedSteamAppIds: ReadonlySet<number>,
  ): Promise<readonly string[]> {
    const names = collectionNames(hosts);
    const warnings: string[] = [];
    for (const host of hosts) {
      const name = names.get(host.hostUuid);
      if (name === undefined) {
        continue;
      }
      try {
        await this.collections.setMembership(name, host.steamAppIds, ownedSteamAppIds);
      } catch (error) {
        this.logger.warn(`Collection ${name} failed`, error);
        warnings.push(`Collection ${name} could not be updated`);
      }
    }
    return warnings;
  }

  async remove(): Promise<readonly string[]> {
    const warnings: string[] = [];
    for (const name of this.collections.ownedNames()) {
      try {
        await this.collections.remove(name);
      } catch (error) {
        this.logger.warn(`Collection ${name} could not be removed`, error);
        warnings.push(`Collection ${name} is still there`);
      }
    }
    return warnings;
  }
}
