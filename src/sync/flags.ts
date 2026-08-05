import { Logger } from "../core/logger";
import { OwnedShortcut, launchOptionsForOwned } from "../core/plan";
import { SettingsCommit } from "../core/stream-settings/binding";
import { ShortcutGateway } from "../steam/shortcuts";

/** Sync is the repair for every way a rewrite can fall short, so every message names it. */
export const SHORTCUTS_NOT_REWRITTEN =
  "Your shortcuts still carry the old streaming settings. Press Sync to bring them up to date.";

// Enough names to recognise what was missed without filling the panel column.
const NAMES_SHOWN = 3;

/**
 * Puts the current streaming flags on every shortcut Perigee already owns.
 *
 * A shortcut's own ownership tag carries everything the new launch line needs, so this
 * asks no host and touches no network. That is what lets a setting apply the moment it
 * changes rather than waiting for a sync.
 */
export class StreamFlagWriter {
  constructor(
    private readonly shortcuts: ShortcutGateway,
    private readonly logger: Logger,
  ) {}

  /**
   * Never rejects. The setting is already stored by the time this runs, so a rewrite that
   * falls short is a warning about shortcuts, not a failure of the change the user made.
   */
  async apply(flags: readonly string[]): Promise<SettingsCommit> {
    let owned: readonly OwnedShortcut[] | null;
    try {
      owned = await this.shortcuts.listOwned();
    } catch (error) {
      this.logger.error("Could not enumerate the shortcuts to rewrite", error);
      return { rewritten: 0, warnings: [SHORTCUTS_NOT_REWRITTEN] };
    }
    if (owned === null) {
      return { rewritten: 0, warnings: [SHORTCUTS_NOT_REWRITTEN] };
    }

    const missed: string[] = [];
    let rewritten = 0;
    for (const shortcut of owned) {
      if (await this.rewrite(shortcut, flags)) {
        rewritten += 1;
      } else {
        missed.push(shortcut.hostTitle);
      }
    }
    return { rewritten, warnings: missed.length === 0 ? [] : [describeMissed(missed)] };
  }

  /**
   * One shortcut Steam would not take is that shortcut's result, never the batch's. A throw
   * here would cost every other shortcut its new flags and hand the caller an error about
   * a shortcut it never named.
   */
  private async rewrite(shortcut: OwnedShortcut, flags: readonly string[]): Promise<boolean> {
    try {
      return await this.shortcuts.setLaunchOptions(
        shortcut.steamAppId,
        launchOptionsForOwned(shortcut, flags),
      );
    } catch (error) {
      this.logger.warn(`Could not rewrite the shortcut for ${shortcut.hostTitle}`, error);
      return false;
    }
  }
}

function describeMissed(missed: readonly string[]): string {
  const shown = missed.slice(0, NAMES_SHOWN).join(", ");
  const rest = missed.length - NAMES_SHOWN;
  const named = rest > 0 ? `${shown} and ${String(rest)} more` : shown;
  return `Steam kept the old streaming settings on ${named}. Press Sync to bring them up to date.`;
}
