import { HostState, SYNC_STATE_SCHEMA_VERSION, SyncState } from "./model";

/**
 * Replace one host in a snapshot as its probe lands, so the panel updates in place
 * instead of waiting for the slowest host. A host the snapshot has never seen is
 * appended; ordering otherwise follows the snapshot the user is already looking at.
 */
export function withHost(state: SyncState, host: HostState): SyncState {
  const known = state.hosts.some((existing) => existing.uuid === host.uuid);
  return {
    ...state,
    hosts: known
      ? state.hosts.map((existing) => (existing.uuid === host.uuid ? host : existing))
      : [...state.hosts, host],
  };
}

export function emptyState(capturedAt: number): SyncState {
  return { schema_version: SYNC_STATE_SCHEMA_VERSION, captured_at: capturedAt, hosts: [], errors: [] };
}
