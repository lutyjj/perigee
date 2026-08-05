import { Logger } from "../../core/logger";
import { CollectionPresentation } from "../collections";
import { HostPresentation, PresentationGateway } from "../gateway";
import { ReactLike, buildTabContent } from "./content";
import { LibraryTabPatch } from "./patch";
import { SteamTab, plannedTabs } from "./model";

/** Resolves the Steam collection object a tab renders. */
export interface CollectionResolver {
  names(): string[];
  byName(collectionName: string): unknown | undefined;
}

/**
 * A library tab per host, on top of the collections. The tabs render Perigee's own
 * collections, which is why this mode keeps them converged rather than replacing
 * them: Steam already knows how to draw a collection, and if the tab injection ever
 * stops working the user still has everything, one level down.
 */
export class TabPresentation implements PresentationGateway {
  constructor(
    private readonly collections: CollectionPresentation,
    private readonly resolver: CollectionResolver,
    private readonly react: ReactLike,
    private readonly patch: LibraryTabPatch,
    private readonly logger: Logger,
  ) {}

  engage(): void {
    this.patch.install();
  }

  disengage(): void {
    this.patch.uninstall();
  }

  async apply(
    hosts: readonly HostPresentation[],
    ownedSteamAppIds: ReadonlySet<number>,
  ): Promise<readonly string[]> {
    const warnings = await this.collections.apply(hosts, ownedSteamAppIds);
    this.patch.install();
    return warnings;
  }

  async remove(): Promise<readonly string[]> {
    this.patch.uninstall();
    return await this.collections.remove();
  }

  /** Called from inside Steam's render, so it must not do I/O and must not throw. */
  buildTabs = (template: SteamTab): SteamTab[] =>
    plannedTabs(this.resolver.names()).flatMap((planned) => {
      const collection = this.resolver.byName(planned.collectionName);
      if (collection === undefined) {
        this.logger.warn(`No Steam collection behind the tab for ${planned.title}`);
        return [];
      }
      return [
        {
          ...template,
          id: planned.id,
          title: planned.title,
          content: buildTabContent(this.react, template, collection),
          // The template's addon counts the tab it came from; ours would lie.
          renderTabAddon: undefined,
        },
      ];
    });
}
