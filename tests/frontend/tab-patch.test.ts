import { beforeEach, describe, expect, it, vi } from "vitest";

const decky = vi.hoisted(() => {
  let routePatch: ((route: { children?: unknown }) => unknown) | undefined;

  function patchAfter(object: Record<string, unknown>, property: string, handler: Function) {
    const original = object[property] as Function;
    object[property] = (...args: unknown[]) => handler(args, original(...args));
  }

  return {
    addPatch: vi.fn((_path: string, patch: typeof routePatch) => {
      routePatch = patch;
      return {};
    }),
    afterPatch: vi.fn(patchAfter),
    replacePatch: vi.fn(
      (object: Record<string, unknown>, property: string, handler: Function) => {
        object[property] = (...args: unknown[]) => handler(args);
      },
    ),
    removePatch: vi.fn(),
    routePatch: () => routePatch,
    wrapReactType: vi.fn((element: { type: object }) => {
      element.type = { ...element.type, __DECKY_WRAPPED: true };
      return element.type;
    }),
  };
});

vi.mock("@decky/ui", () => ({
  afterPatch: decky.afterPatch,
  replacePatch: decky.replacePatch,
  wrapReactType: decky.wrapReactType,
}));

vi.mock("@decky/api", () => ({
  routerHook: { addPatch: decky.addPatch, removePatch: decky.removePatch },
}));

import { LibraryTabPatch } from "../../src/presentation/tabs/patch";

describe("LibraryTabPatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reuses the patched memo type across Steam's repeated inner render", () => {
    const component = () => null;
    const memoType = { type: component };
    const outer = { type: () => ({ type: memoType }) };
    const route = { children: { type: () => outer } };
    const patch = new LibraryTabPatch(
      () => [],
      vi.fn(),
      { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
      () => ({ useMemo: (factory) => factory() }),
    );

    expect(patch.install()).toBe(true);
    decky.routePatch()?.(route);
    const patchedOuter = route.children.type();
    const first = patchedOuter.type();
    const second = patchedOuter.type();

    expect(first.type).toBe(second.type);
    expect(decky.wrapReactType).toHaveBeenCalledTimes(1);
    expect(decky.replacePatch).toHaveBeenCalledTimes(1);
  });
});
