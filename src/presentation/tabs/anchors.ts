/**
 * Every assumption the library patch makes about Steam's internals, named and checked
 * in one place. Each is an anchor that a Steam update can move; when one goes, the
 * mode reports itself unavailable rather than rendering a broken library.
 */
export const ANCHORS = [
  "route-patch",
  "outer-element",
  "inner-element",
  "react-hooks",
  "template-tab",
  "tab-grid",
] as const;

export type Anchor = (typeof ANCHORS)[number];

export const ANCHOR_DESCRIPTION: Record<Anchor, string> = {
  "route-patch": "the /library route could not be patched",
  "outer-element": "the library route element had no type to patch",
  "inner-element": "the inner library element had no type to patch",
  "react-hooks": "React's hook dispatcher was not reachable",
  "template-tab": "Steam's own tab to copy from was not found",
  "tab-grid": "the app grid inside Steam's tab was not recognisable",
};

export class AnchorMissing extends Error {
  constructor(readonly anchor: Anchor) {
    super(ANCHOR_DESCRIPTION[anchor]);
  }
}
