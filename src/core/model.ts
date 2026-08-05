// Hand-written mirror of py_modules/perigee/model.py. tests/fixtures/sync_state.json
// is the pin: the backend asserts to_json() equals it, the frontend asserts the whole
// parsed object equals a literal, so a field added on either side fails one of them.
import { reader } from "./parse";

export const SYNC_STATE_SCHEMA_VERSION = 3;

export const HOST_STATUSES = ["online", "offline", "stale_pairing", "unauthorized"] as const;

export type HostStatus = (typeof HOST_STATUSES)[number];

export interface AppEntry {
  readonly host_app_id: string;
  readonly title: string;
  readonly art_cached: boolean;
}

export interface HostState {
  readonly uuid: string;
  readonly name: string;
  readonly address: string;
  readonly status: HostStatus;
  readonly apps: readonly AppEntry[];
}

export interface SyncError {
  readonly host_uuid: string | null;
  readonly message: string;
}

export interface SyncState {
  readonly schema_version: number;
  /** Epoch seconds, so the panel can say how old what it is showing is. */
  readonly captured_at: number;
  readonly hosts: readonly HostState[];
  readonly errors: readonly SyncError[];
}

export function configWasRead(state: SyncState): boolean {
  return state.errors.every((error) => error.host_uuid !== null);
}

export class SyncStateFormatError extends Error {}

const read = reader(SyncStateFormatError);

export function parseSyncState(value: unknown): SyncState {
  const root = read.record(value, "sync state");
  const version = root["schema_version"];
  if (version !== SYNC_STATE_SCHEMA_VERSION) {
    throw new SyncStateFormatError(
      `Backend speaks schema ${String(version)}, frontend speaks ${SYNC_STATE_SCHEMA_VERSION}`,
    );
  }
  return {
    schema_version: SYNC_STATE_SCHEMA_VERSION,
    captured_at: read.number(root["captured_at"], "captured_at"),
    hosts: read.list(root["hosts"], "hosts").map(parseHostState),
    errors: read.list(root["errors"], "errors").map(parseError),
  };
}

function isHostStatus(value: unknown): value is HostStatus {
  return HOST_STATUSES.some((status) => status === value);
}

export function parseHostState(value: unknown): HostState {
  const host = read.record(value, "host");
  const status = host["status"];
  if (!isHostStatus(status)) {
    throw new SyncStateFormatError(`Unknown host status ${String(status)}`);
  }
  return {
    uuid: read.text(host["uuid"], "host.uuid"),
    name: read.text(host["name"], "host.name"),
    address: read.text(host["address"], "host.address"),
    status,
    apps: read.list(host["apps"], "host.apps").map(parseApp),
  };
}

function parseApp(value: unknown): AppEntry {
  const app = read.record(value, "app");
  return {
    host_app_id: read.text(app["host_app_id"], "app.host_app_id"),
    title: read.text(app["title"], "app.title"),
    art_cached: app["art_cached"] === true,
  };
}

function parseError(value: unknown): SyncError {
  const error = read.record(value, "error");
  const hostUuid = error["host_uuid"];
  return {
    host_uuid: hostUuid === null ? null : read.text(hostUuid, "error.host_uuid"),
    message: read.text(error["message"], "error.message"),
  };
}
