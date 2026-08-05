import { Logger } from "../core/logger";
import { CollectionGateway } from "../steam/collections";
import { SteamEnvironment } from "../steam/api";
import { CollectionPresentation } from "./collections";
import { FallbackPresentation } from "./fallback";
import { PresentationGateway } from "./gateway";
import { PresentationMode } from "./modes";
import { AnchorMissing } from "./tabs/anchors";
import { ReactLike } from "./tabs/content";
import { LibraryTabPatch } from "./tabs/patch";
import { SteamTab } from "./tabs/model";
import { TabPresentation } from "./tabs/presentation";
import { conflictingLibraryPlugin } from "./tabs/coexistence";

// The one selection point. A new mode is a new module plus one row here; no consumer
// of PresentationGateway changes.
const BUILDERS: Record<
  PresentationMode,
  (steam: SteamEnvironment, logger: Logger, announce: Announce) => PresentationGateway
> = {
  collections: (steam, logger) => collectionsOnly(steam, logger),
  tabs: (steam, logger, announce) => libraryTabs(steam, logger, announce),
};

export type Announce = (notice: string) => void;

export function createPresentationGateway(
  mode: PresentationMode,
  steam: SteamEnvironment,
  logger: Logger,
  announce: Announce = () => undefined,
): PresentationGateway {
  return BUILDERS[mode](steam, logger, announce);
}

function collectionsOnly(steam: SteamEnvironment, logger: Logger): CollectionPresentation {
  return new CollectionPresentation(new CollectionGateway(steam, logger), logger);
}

function libraryTabs(
  steam: SteamEnvironment,
  logger: Logger,
  announce: Announce,
): PresentationGateway {
  const collections = new CollectionGateway(steam, logger);
  const grouped = new CollectionPresentation(collections, logger);
  const react = (window as unknown as { SP_REACT?: ReactLike }).SP_REACT;
  const conflict = conflictingLibraryPlugin();

  // Standing down beats racing: two plugins borrowing React's dispatcher on the same
  // component cannot both win, and the user keeps the other plugin's tabs either way.
  if (react === undefined || conflict !== null) {
    const reason = conflict !== null ? `${conflict} already patches the library` : "React is absent";
    logger.warn(`Library tabs unavailable: ${reason}`);
    return new FallbackPresentation(grouped, grouped, () => reason, logger, announce);
  }

  let missing: AnchorMissing | null = null;
  let tabs: TabPresentation | null = null;
  const patch = new LibraryTabPatch(
    (template: SteamTab) => (tabs === null ? [] : tabs.buildTabs(template)),
    (error) => {
      missing ??= error;
    },
    logger,
  );
  tabs = new TabPresentation(
    grouped,
    { names: () => collections.ownedNames(), byName: (name) => collections.find(name) },
    react,
    patch,
    logger,
  );
  return new FallbackPresentation(tabs, grouped, () => missing?.message ?? null, logger, announce);
}
