import { describe, expect, it } from "vitest";

import { collectionNames } from "../../src/steam/collections";

describe("collectionNames", () => {
  it("namespaces the collection so a user's own list is never adopted", () => {
    const names = collectionNames([{ hostUuid: "aaaa1111-2222", hostName: "Moonshine" }]);

    expect(names.get("aaaa1111-2222")).toBe("Perigee: Moonshine");
  });

  it("disambiguates two paired hosts that share a display name", () => {
    const names = collectionNames([
      { hostUuid: "aaaa1111-2222", hostName: "pc" },
      { hostUuid: "bbbb3333-4444", hostName: "pc" },
    ]);

    expect([...names.values()]).toEqual(["Perigee: pc (aaaa1111)", "Perigee: pc (bbbb3333)"]);
  });
});
