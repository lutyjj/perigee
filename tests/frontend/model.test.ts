import { describe, expect, it } from "vitest";

import { SyncState, SyncStateFormatError, parseSyncState } from "../../src/core/model";
import fixture from "../fixtures/sync_state.json";

// The backend asserts SyncState.to_json() equals this same file, so asserting the whole
// parsed object here fails either side of the mirror the moment a field moves.
const EXPECTED: SyncState = {
  schema_version: 3,
  captured_at: 1750000000.0,
  hosts: [
    {
      uuid: "6ce1ac65-da63-4643-92af-471dda73012c",
      name: "stale-pairing-host",
      address: "192.0.2.10",
      status: "stale_pairing",
      apps: [],
    },
    {
      uuid: "15b43594-35e7-4df6-956b-908ffabb2ef2",
      name: "Moonshine",
      address: "192.0.2.10",
      status: "online",
      apps: [
        { host_app_id: "1", title: "Desktop", art_cached: true },
        { host_app_id: "2", title: "Steam Big Picture", art_cached: false },
      ],
    },
    {
      uuid: "11111111-2222-3333-4444-555555555555",
      name: "manual-address-host",
      address: "198.51.100.9",
      status: "offline",
      apps: [],
    },
  ],
  errors: [
    {
      host_uuid: "6ce1ac65-da63-4643-92af-471dda73012c",
      message:
        "Host reports uniqueid 15b43594-35e7-4df6-956b-908ffabb2ef2, " +
        "Moonlight is paired with 6ce1ac65-da63-4643-92af-471dda73012c",
    },
  ],
};

describe("sync state wire contract", () => {
  it("parses the fixture the backend pins itself against, field for field", () => {
    expect(parseSyncState(fixture)).toEqual(EXPECTED);
  });

  it("carries every key the fixture declares", () => {
    expect(Object.keys(fixture).sort()).toEqual([
      "captured_at",
      "errors",
      "hosts",
      "schema_version",
    ]);
    expect(Object.keys(fixture.hosts[1]!.apps[0]!).sort()).toEqual([
      "art_cached",
      "host_app_id",
      "title",
    ]);
  });

  it("rejects a schema version it does not speak", () => {
    expect(() => parseSyncState({ schema_version: 2, captured_at: 1, hosts: [], errors: [] })).toThrow(
      SyncStateFormatError,
    );
  });

  it("rejects an unknown host status", () => {
    const broken = {
      schema_version: 3,
      captured_at: 1,
      hosts: [{ uuid: "u", name: "n", address: "a", status: "paused", apps: [] }],
      errors: [],
    };

    expect(() => parseSyncState(broken)).toThrow(SyncStateFormatError);
  });
});
