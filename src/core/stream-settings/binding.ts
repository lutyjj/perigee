import { StreamSettings } from "./descriptor";
import { WriteQueue } from "./write-queue";

/** What committing a change did to the shortcuts, so the panel can say what happened. */
export interface SettingsCommit {
  readonly rewritten: number;
  readonly warnings: readonly string[];
}

export const NOTHING_COMMITTED: SettingsCommit = { rewritten: 0, warnings: [] };

/**
 * The panel's view of the stored settings, held for the plugin's lifetime.
 *
 * Steam unmounts the panel whenever the sidebar closes, and every native picker
 * closes it, so a remount can land at any point during a write. `current()` must
 * therefore answer with the value the user just chose, not the one the backend has
 * acknowledged: the optimistic value is adopted before the request and given back
 * only if the request actually fails.
 */
export interface SettingsBinding {
  current(): StreamSettings;
  write(values: StreamSettings): Promise<SettingsCommit>;
}

export interface BindingPorts {
  /** Persist the values. A rejection means nothing was stored. */
  store(values: StreamSettings): Promise<void>;
  /**
   * Put the flags the values imply on every shortcut Perigee owns. Never rejects: by the
   * time it runs the value is stored, and shortcuts that missed out are reported, not undone.
   */
  rewrite(values: StreamSettings): Promise<SettingsCommit>;
}

export function createSettingsBinding(
  initial: StreamSettings,
  ports: BindingPorts,
): SettingsBinding {
  let current = initial;
  // One commit in flight at a time, newest wins: a drag emits a value per step, and
  // each commit rewrites every shortcut.
  const commits = new WriteQueue<StreamSettings, SettingsCommit>(async (values) => {
    await ports.store(values);
    return await ports.rewrite(values);
  }, NOTHING_COMMITTED);

  return {
    current: () => current,
    write: async (values) => {
      const previous = current;
      current = values;
      try {
        return await commits.submit(values);
      } catch (error) {
        // Only a failed store rejects, so the value never reached disk and the panel must
        // stop showing it. A rewrite that fell short keeps the value it stored and says so.
        current = previous;
        throw error;
      }
    },
  };
}
