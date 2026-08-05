import { findInReactTree } from "@decky/ui";

import { AnchorMissing } from "./anchors";
import { SteamTab } from "./model";

/**
 * Build a tab that renders one Steam collection, by cloning the tab Steam already
 * built and swapping the collection its grid is bound to. Nothing here invents a
 * component: the provider, the grid and their props all come from Steam's own tab,
 * which is what keeps this from breaking every time the grid's internals change.
 */
export interface ReactLike {
  createElement(type: unknown, props: Record<string, unknown>, ...children: unknown[]): unknown;
}

interface ReactNodeLike {
  readonly type?: unknown;
  readonly props?: Record<string, unknown>;
}

export function buildTabContent(
  react: ReactLike,
  template: SteamTab,
  collection: unknown,
): unknown {
  const provider = template.content as ReactNodeLike | undefined;
  if (provider?.type === undefined || provider.props === undefined) {
    throw new AnchorMissing("template-tab");
  }
  const grid = findInReactTree(
    provider,
    (node: ReactNodeLike) => node?.props?.["collection"] !== undefined,
  ) as ReactNodeLike | undefined;
  if (grid?.type === undefined || grid.props === undefined) {
    throw new AnchorMissing("tab-grid");
  }
  const { children: _children, ...providerProps } = provider.props;
  return react.createElement(
    provider.type,
    providerProps,
    react.createElement(grid.type, { ...grid.props, collection }),
  );
}
