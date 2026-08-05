import type { SyncReport } from "../sync/controller";

/**
 * Panel state that must outlive a quick-access unmount.
 *
 * Steam unmounts the panel every time the sidebar closes, and opening a native picker
 * closes it, so anything held only in component state dies between choosing a value
 * and seeing the result. This lives for the plugin's lifetime and is deliberately not
 * persisted: a fresh plugin load starts calm again, collapsed and quiet.
 */
export interface PanelSession {
  streamingOpen: boolean;
  report: SyncReport | null;
  notes: readonly string[];
  /** Where each disabled slider sits, so re-enabling one restores what the user set. */
  sliderPositions: Readonly<Record<string, number>>;
}

export function createPanelSession(): PanelSession {
  return { streamingOpen: false, report: null, notes: [], sliderPositions: {} };
}
