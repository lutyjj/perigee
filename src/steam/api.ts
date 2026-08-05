// This whole file transcribes the Steam client surface MoonDeck drives in
// src/steam-utils/*.ts. Only what Perigee calls is declared, and each signature is
// what Steam really returns, not what would be convenient.

/**
 * Steam's eAppArtworkAssetType: 0 is the vertical (portrait) capsule.
 * Source: github.com/SteamGridDB/decky-steamgriddb, src/constants.ts `ASSET_TYPE.grid_p`
 * at v1.7.1, commit 271c01d9ba5a775e573f5a15ad0786ff9beb00ae.
 */
export const VERTICAL_CAPSULE_ASSET_TYPE = 0;

export interface Unregisterable {
  unregister(): void;
}

export interface SteamAppDetails {
  readonly strDisplayName: string;
  readonly strLaunchOptions: string;
}

export interface SteamAppOverview {
  readonly appid: number;
  readonly display_name: string;
}

export interface SteamAppsApi {
  AddShortcut(
    name: string,
    execPath: string,
    launchDirectory: string,
    launchOptions: string,
    // Steam answers with undefined when it refuses, which the declared type must admit.
  ): Promise<number | undefined>;
  RemoveShortcut(appId: number): void;
  // Both writes settle asynchronously: the caller must re-read app details to confirm.
  SetShortcutName(appId: number, name: string): void;
  SetAppLaunchOptions(appId: number, launchOptions: string): void;
  SetCustomArtworkForApp(
    appId: number,
    base64: string,
    extension: string,
    assetType: number,
  ): Promise<void>;
  ClearCustomArtworkForApp(appId: number, assetType: number): Promise<void>;
  RegisterForAppDetails(
    appId: number,
    callback: (details: SteamAppDetails) => void,
  ): Unregisterable;
}

export interface SteamDragDropCollection {
  AddApps(overviews: readonly SteamAppOverview[]): void;
  RemoveApps(overviews: readonly SteamAppOverview[]): void;
}

export interface SteamCollection {
  readonly id?: string;
  AsDragDropCollection(): SteamDragDropCollection;
  Save(): Promise<void>;
  Delete(): Promise<void>;
  readonly allApps: readonly SteamAppOverview[];
  readonly apps: { has(appId: number): boolean };
  readonly displayName: string;
}

export interface SteamCollectionStore {
  readonly deckDesktopApps?: SteamCollection;
  readonly userCollections?: readonly SteamCollection[];
  GetCollection(collectionId: string): SteamCollection | undefined;
  GetCollectionIDByUserTag(tag: string): string | null;
  NewUnsavedCollection(
    tag: string,
    filter: undefined,
    overviews: readonly SteamAppOverview[],
  ): SteamCollection | undefined;
}

export interface SteamAppStore {
  readonly m_mapApps: { get(appId: number): SteamAppOverview | undefined };
}

export interface SteamEnvironment {
  readonly apps: SteamAppsApi;
  readonly appStore: SteamAppStore;
  readonly collectionStore: SteamCollectionStore;
}

interface SteamGlobals {
  SteamClient?: { Apps?: SteamAppsApi };
  appStore?: SteamAppStore;
  collectionStore?: SteamCollectionStore;
}

export function steamEnvironment(): SteamEnvironment | null {
  const globals = window as unknown as SteamGlobals;
  const apps = globals.SteamClient?.Apps;
  const appStore = globals.appStore;
  const collectionStore = globals.collectionStore;
  if (apps === undefined || appStore === undefined || collectionStore === undefined) {
    return null;
  }
  return { apps, appStore, collectionStore };
}
