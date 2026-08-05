import { describe, expect, it } from "vitest";

import { describeAge } from "../../src/core/age";
import { emptyState, withHost } from "../../src/core/patch-state";
import { HostState } from "../../src/core/model";

const CAPTURED = 1_750_000_000;

function host(uuid: string, status: HostState["status"] = "online"): HostState {
  return { uuid, name: uuid, address: "192.0.2.10", status, apps: [] };
}

describe("describeAge", () => {
  it.each([
    [0, "just now"],
    [59, "just now"],
    [60, "1 min ago"],
    [3 * 60 + 59, "3 min ago"],
    [3600, "1 h ago"],
    [86_400 * 2, "2 d ago"],
  ])("reads %s seconds as %s", (seconds, expected) => {
    expect(describeAge(CAPTURED, (CAPTURED + seconds) * 1000)).toBe(expected);
  });

  it("never reports a snapshot from the future as old", () => {
    expect(describeAge(CAPTURED, (CAPTURED - 30) * 1000)).toBe("just now");
  });
});

describe("withHost", () => {
  it("replaces a host in place, keeping the order the user is looking at", () => {
    const state = {
      ...emptyState(CAPTURED),
      hosts: [host("a"), host("b"), host("c")],
    };

    const patched = withHost(state, host("b", "offline"));

    expect(patched.hosts.map((entry) => entry.uuid)).toEqual(["a", "b", "c"]);
    expect(patched.hosts[1]?.status).toBe("offline");
  });

  it("appends a host the snapshot has never seen", () => {
    const patched = withHost(emptyState(CAPTURED), host("new"));

    expect(patched.hosts.map((entry) => entry.uuid)).toEqual(["new"]);
  });
});
