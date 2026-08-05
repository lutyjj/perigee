import { Logger } from "../core/logger";
import { MOONLIGHT_EXEC_PATH, parseOwnershipTag } from "../core/launch";
import { OwnedShortcut, ShortcutSpec } from "../core/plan";
import {
  SteamAppDetails,
  SteamEnvironment,
  Unregisterable,
  VERTICAL_CAPSULE_ASSET_TYPE,
} from "./api";

const DETAILS_TIMEOUT_MS = 2000;
const SETTLE_ATTEMPTS = 8;
const SETTLE_DELAY_MS = 250;

export class ShortcutGateway {
  constructor(
    private readonly steam: SteamEnvironment,
    private readonly logger: Logger,
  ) {}

  /**
   * Returns null when Steam cannot be enumerated. An empty list means "Perigee owns
   * nothing", and converging on that when the store simply had not hydrated would
   * duplicate the whole library.
   */
  async listOwned(): Promise<OwnedShortcut[] | null> {
    const nonSteamApps = this.steam.collectionStore.deckDesktopApps?.allApps;
    if (nonSteamApps === undefined) {
      this.logger.error("Steam has not published the non-Steam app collection yet");
      return null;
    }
    const owned: OwnedShortcut[] = [];
    for (const overview of nonSteamApps) {
      const details = await this.appDetails(overview.appid);
      if (details === null) {
        continue;
      }
      const tag = parseOwnershipTag(details.strLaunchOptions);
      if (tag !== null) {
        owned.push({
          steamAppId: overview.appid,
          hostUuid: tag.hostUuid,
          hostAppId: tag.hostAppId,
          hostTitle: tag.hostTitle,
          address: tag.address,
          displayName: details.strDisplayName,
          launchOptions: details.strLaunchOptions,
        });
      }
    }
    return owned;
  }

  /**
   * The ownership tag lives in the launch options, so the shortcut is only Perigee's
   * once that write is observable. A shortcut that never gets there is removed again:
   * an untagged leftover is invisible to every later sync and duplicates on each one.
   */
  async create(spec: ShortcutSpec): Promise<number | null> {
    const steamAppId = await this.steam.apps.AddShortcut(
      spec.title,
      MOONLIGHT_EXEC_PATH,
      "",
      spec.launchOptions,
    );
    if (typeof steamAppId !== "number") {
      this.logger.error(`Steam refused a shortcut for ${spec.title}`);
      return null;
    }
    if (await this.update(steamAppId, spec)) {
      return steamAppId;
    }
    this.logger.error(`Rolling back a half-created shortcut for ${spec.title}`);
    this.remove(steamAppId);
    return null;
  }

  async update(steamAppId: number, spec: ShortcutSpec): Promise<boolean> {
    this.steam.apps.SetShortcutName(steamAppId, spec.title);
    this.steam.apps.SetAppLaunchOptions(steamAppId, spec.launchOptions);
    return await this.settled(
      steamAppId,
      (details) =>
        details.strLaunchOptions === spec.launchOptions && details.strDisplayName === spec.title,
    );
  }

  /**
   * The launch options alone. A streaming setting has no business touching the shortcut's
   * name: the user may have renamed it, and only a sync is documented to put that back.
   */
  async setLaunchOptions(steamAppId: number, launchOptions: string): Promise<boolean> {
    this.steam.apps.SetAppLaunchOptions(steamAppId, launchOptions);
    return await this.settled(steamAppId, (details) => details.strLaunchOptions === launchOptions);
  }

  remove(steamAppId: number): void {
    this.steam.apps.RemoveShortcut(steamAppId);
  }

  async setCapsule(steamAppId: number, base64Png: string): Promise<void> {
    await this.steam.apps.ClearCustomArtworkForApp(steamAppId, VERTICAL_CAPSULE_ASSET_TYPE);
    await this.steam.apps.SetCustomArtworkForApp(
      steamAppId,
      base64Png,
      "png",
      VERTICAL_CAPSULE_ASSET_TYPE,
    );
  }

  private async settled(
    steamAppId: number,
    matches: (details: SteamAppDetails) => boolean,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
      const details = await this.appDetails(steamAppId);
      if (details !== null && matches(details)) {
        return true;
      }
      await sleep(SETTLE_DELAY_MS);
    }
    return false;
  }

  private appDetails(steamAppId: number): Promise<SteamAppDetails | null> {
    return new Promise((resolve) => {
      let settled = false;
      let registration: Unregisterable | undefined;
      const settle = (details: SteamAppDetails | null): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          registration?.unregister();
          resolve(details);
        }
      };
      const timer = setTimeout(() => settle(null), DETAILS_TIMEOUT_MS);
      registration = this.steam.apps.RegisterForAppDetails(steamAppId, (details) => {
        if (Object.keys(details).length > 0) {
          settle(details);
        }
      });
    });
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
