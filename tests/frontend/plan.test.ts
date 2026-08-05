import { describe, expect, it } from "vitest";

import { AppEntry, HostState, HostStatus, SyncState, parseSyncState } from "../../src/core/model";
import { buildLaunchOptions, parseOwnershipTag } from "../../src/core/launch";
import { OwnedShortcut, computePlan, specFor } from "../../src/core/plan";
import fixture from "../fixtures/sync_state.json";

const MOONSHINE = "15b43594-35e7-4df6-956b-908ffabb2ef2";
const STALE = "6ce1ac65-da63-4643-92af-471dda73012c";
const UNPAIRED = "00000000-0000-0000-0000-000000000000";

function host(uuid: string, status: HostStatus, apps: AppEntry[] = []): HostState {
  return { uuid, name: `host-${uuid}`, address: "192.0.2.10", status, apps };
}

function app(hostAppId: string, title: string): AppEntry {
  return { host_app_id: hostAppId, title, art_cached: false };
}

function state(hosts: HostState[], errors: SyncState["errors"] = []): SyncState {
  return { schema_version: 3, captured_at: 1750000000, hosts, errors };
}

function ownedFrom(steamAppId: number, hostState: HostState, entry: AppEntry): OwnedShortcut {
  const spec = specFor(hostState, entry);
  return {
    steamAppId,
    hostUuid: spec.hostUuid,
    hostAppId: spec.hostAppId,
    hostTitle: spec.title,
    address: hostState.address,
    displayName: spec.title,
    launchOptions: spec.launchOptions,
  };
}

describe("computePlan", () => {
  it("creates a shortcut for every app of an online host", () => {
    const moonshine = host(MOONSHINE, "online", [app("1", "Desktop"), app("2", "Factorio")]);

    const plan = computePlan(state([moonshine]), []);

    expect(plan.creates.map((spec) => spec.title)).toEqual(["Desktop", "Factorio"]);
    expect(plan.updates).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it("leaves a converged host alone", () => {
    const entry = app("1", "Desktop");
    const moonshine = host(MOONSHINE, "online", [entry]);

    const plan = computePlan(state([moonshine]), [ownedFrom(7, moonshine, entry)]);

    expect(plan).toMatchObject({ creates: [], updates: [], deletes: [] });
    expect(plan.unchanged.map((placed) => placed.steamAppId)).toEqual([7]);
  });

  it("rebinds a shortcut when only the host-side app id changed", () => {
    const before = host(MOONSHINE, "online", [app("111", "Desktop")]);
    const after = host(MOONSHINE, "online", [app("222", "Desktop")]);

    const plan = computePlan(state([after]), [ownedFrom(7, before, app("111", "Desktop"))]);

    expect(plan.creates).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.updates[0]?.steamAppId).toBe(7);
    expect(plan.updates[0]?.spec.hostAppId).toBe("222");
  });

  it("rewrites the launch options when the host address changed", () => {
    const before = host(MOONSHINE, "online", [app("1", "Desktop")]);
    const after: HostState = { ...before, address: "198.51.100.4" };

    const plan = computePlan(state([after]), [ownedFrom(7, before, app("1", "Desktop"))]);

    expect(plan.updates[0]?.spec.launchOptions).toContain("stream 198.51.100.4");
  });

  it("restores a shortcut renamed inside Steam", () => {
    const moonshine = host(MOONSHINE, "online", [app("1", "Desktop")]);
    const owned = { ...ownedFrom(7, moonshine, app("1", "Desktop")), displayName: "my name" };

    const plan = computePlan(state([moonshine]), [owned]);

    expect(plan.updates[0]?.spec.title).toBe("Desktop");
  });

  it("treats a host-side retitle as a replacement, because the protocol offers no other key", () => {
    const before = host(MOONSHINE, "online", [app("1", "Desktop")]);
    const after = host(MOONSHINE, "online", [app("9", "Desktop (4K)")]);

    const plan = computePlan(state([after]), [ownedFrom(7, before, app("1", "Desktop"))]);

    expect(plan.creates.map((spec) => spec.title)).toEqual(["Desktop (4K)"]);
    expect(plan.deletes.map((shortcut) => shortcut.steamAppId)).toEqual([7]);
  });

  it("deletes shortcuts an online host no longer offers", () => {
    const previous = host(MOONSHINE, "online", [app("9", "Removed")]);
    const moonshine = host(MOONSHINE, "online", [app("1", "Desktop")]);

    const plan = computePlan(state([moonshine]), [ownedFrom(7, previous, app("9", "Removed"))]);

    expect(plan.deletes.map((shortcut) => shortcut.steamAppId)).toEqual([7]);
  });

  it("never deletes when an authoritative host reports an empty library", () => {
    const empty = host(MOONSHINE, "online");
    const owned = ownedFrom(7, host(MOONSHINE, "online"), app("1", "Desktop"));

    const plan = computePlan(state([empty]), [owned]);

    expect(plan.deletes).toEqual([]);
    expect(plan.warnings).toHaveLength(1);
  });

  it("freezes the shortcuts of an offline host", () => {
    const offline = host(MOONSHINE, "offline");
    const owned = ownedFrom(7, host(MOONSHINE, "online"), app("1", "Desktop"));

    const plan = computePlan(state([offline]), [owned]);

    expect(plan).toMatchObject({ creates: [], updates: [], deletes: [] });
  });

  it.each(["stale_pairing", "unauthorized"] as const)("never deletes for a %s host", (status) => {
    const host_ = host(STALE, status);
    const owned = ownedFrom(7, host(STALE, "online"), app("1", "Desktop"));

    const plan = computePlan(state([host_], [{ host_uuid: STALE, message: "nope" }]), [owned]);

    expect(plan.deletes).toEqual([]);
  });

  it("deletes shortcuts of hosts Moonlight is no longer paired with", () => {
    const owned = ownedFrom(7, host(UNPAIRED, "online"), app("1", "Desktop"));

    const plan = computePlan(state([]), [owned]);

    expect(plan.deletes.map((shortcut) => shortcut.steamAppId)).toEqual([7]);
  });

  it("keeps unknown-host shortcuts when the Moonlight config could not be read", () => {
    const owned = ownedFrom(7, host(UNPAIRED, "online"), app("1", "Desktop"));

    const plan = computePlan(state([], [{ host_uuid: null, message: "conf missing" }]), [owned]);

    expect(plan.deletes).toEqual([]);
  });

  it("adopts a shortcut tagged before uuids were canonicalised to lower case", () => {
    const moonshine = host(MOONSHINE, "online", [app("1", "Desktop")]);
    const legacyOptions = buildLaunchOptions({
      hostUuid: MOONSHINE.toUpperCase(),
      hostAppId: "1",
      address: moonshine.address,
      title: "Desktop",
    });
    const tag = parseOwnershipTag(legacyOptions)!;
    const legacy: OwnedShortcut = {
      steamAppId: 7,
      hostUuid: tag.hostUuid,
      hostAppId: tag.hostAppId,
      hostTitle: tag.hostTitle,
      address: tag.address,
      displayName: "Desktop",
      launchOptions: legacyOptions,
    };

    const plan = computePlan(state([moonshine]), [legacy]);

    expect(plan.deletes).toEqual([]);
    expect(plan.creates).toEqual([]);
    // The tag itself is rewritten to the canonical form on the next converge.
    expect(plan.updates[0]?.spec.launchOptions).toContain(MOONSHINE);
  });

  it("skips an app whose title cannot be represented, without failing the sync", () => {
    const moonshine = host(MOONSHINE, "online", [app("1", "Desktop"), app("2", "bad\ntitle")]);

    const plan = computePlan(state([moonshine]), []);

    expect(plan.creates.map((spec) => spec.title)).toEqual(["Desktop"]);
    expect(plan.warnings[0]).toContain("control character");
  });

  it("plans the shared fixture into two creates and no deletions", () => {
    const plan = computePlan(parseSyncState(fixture), []);

    expect(plan.creates.map((spec) => spec.title)).toEqual(["Desktop", "Steam Big Picture"]);
    expect(plan.deletes).toEqual([]);
  });
});
