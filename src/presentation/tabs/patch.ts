import { afterPatch, replacePatch, wrapReactType } from "@decky/ui";
import { RoutePatch, routerHook } from "@decky/api";

import { Logger } from "../../core/logger";
import { AnchorMissing } from "./anchors";
import { HookDispatcher, currentDispatcher } from "./dispatcher";
import { SteamTab, TEMPLATE_TAB_ID, mergeTabs } from "./model";

/**
 * The only part of Perigee that reaches into Steam's own React tree, and the only one
 * that cannot be unit tested. The tab array never leaves the memoised component that
 * builds it, so the dispatcher is borrowed for one render to intercept it.
 * docs/design.md lists the anchors this assumes and what happens when one moves.
 */
export type TabsBuilder = (template: SteamTab) => SteamTab[];
export type AnchorReporter = (error: AnchorMissing) => void;
export type DispatcherSource = () => HookDispatcher | null;

export class LibraryTabPatch {
  private patch: RoutePatch | null = null;

  constructor(
    private readonly buildTabs: TabsBuilder,
    private readonly onAnchorMissing: AnchorReporter,
    private readonly logger: Logger,
    private readonly dispatcher: DispatcherSource = currentDispatcher,
  ) {}

  install(): boolean {
    if (this.patch !== null) {
      return true;
    }
    try {
      this.patch = routerHook.addPatch("/library", (route) => this.patchRoute(route));
      return true;
    } catch (error) {
      this.logger.error("Could not patch the library route", error);
      this.onAnchorMissing(new AnchorMissing("route-patch"));
      return false;
    }
  }

  uninstall(): void {
    if (this.patch === null) {
      return;
    }
    try {
      routerHook.removePatch("/library", this.patch);
    } catch (error) {
      this.logger.warn("Could not remove the library patch", error);
    }
    this.patch = null;
  }

  private patchRoute<T extends { children?: unknown }>(route: T): T {
    const children = route.children as { type?: unknown } | undefined;
    if (children?.type === undefined) {
      this.report(new AnchorMissing("outer-element"));
      return route;
    }
    afterPatch(children, "type", (_args: unknown[], outer: { type?: unknown } | null) => {
      if (outer?.type === undefined) {
        this.report(new AnchorMissing("outer-element"));
        return outer;
      }
      let patchedMemoType: unknown;
      afterPatch(outer, "type", (_inner: unknown[], element: { type?: unknown } | null) => {
        if (element?.type === undefined) {
          this.report(new AnchorMissing("inner-element"));
          return element;
        }
        if (patchedMemoType === undefined) {
          this.patchMemo(element);
          patchedMemoType = element.type;
        } else {
          element.type = patchedMemoType;
        }
        return element;
      });
      return outer;
    });
    return route;
  }

  private patchMemo(element: { type?: unknown }): void {
    const memo = element.type as { type?: (...args: unknown[]) => unknown; __PERIGEE?: boolean };
    if (memo.__PERIGEE === true) {
      return;
    }
    const original = memo.type;
    if (original === undefined) {
      this.report(new AnchorMissing("inner-element"));
      return;
    }
    const wrapped = wrapReactType(element) as { __PERIGEE?: boolean };
    wrapped.__PERIGEE = true;
    replacePatch(element.type, "type", (args: unknown[]) => this.renderWithTabs(original, args));
  }

  private renderWithTabs(original: (...args: unknown[]) => unknown, args: unknown[]): unknown {
    // Read the dispatcher here, not at construction: this is the only moment the one
    // the render will consult is current.
    const hooks = this.dispatcher();
    if (hooks === null) {
      this.report(new AnchorMissing("react-hooks"));
      return original(...args);
    }
    const realUseMemo = hooks.useMemo;
    hooks.useMemo = <T,>(factory: () => T, deps: unknown[]): T =>
      realUseMemo.call<HookDispatcher, [() => T, unknown[]], T>(
        hooks,
        () => this.rewrite(factory()),
        deps,
      );
    try {
      return original(...args);
    } finally {
      hooks.useMemo = realUseMemo;
    }
  }

  /** Steam memoises several values here; only the one shaped like the tab strip is touched. */
  private rewrite<T>(memoised: T): T {
    const nested = Array.isArray(memoised) && Array.isArray(memoised[0]);
    const candidate = nested ? (memoised as unknown[])[0] : memoised;
    if (!isTabArray(candidate)) {
      return memoised;
    }
    const template = candidate.find((tab) => tab.id === TEMPLATE_TAB_ID);
    if (template === undefined) {
      this.report(new AnchorMissing("template-tab"));
      return memoised;
    }
    let ours: SteamTab[];
    try {
      ours = this.buildTabs(template);
    } catch (error) {
      this.report(
        error instanceof AnchorMissing ? error : new AnchorMissing("tab-grid"),
        error,
      );
      return memoised;
    }
    const merged = mergeTabs(candidate, ours);
    return (nested ? [merged, (memoised as unknown[])[1]] : merged) as T;
  }

  private report(anchor: AnchorMissing, cause?: unknown): void {
    this.logger.warn(`Library tabs unavailable: ${anchor.message}`, cause);
    this.onAnchorMissing(anchor);
  }
}

function isTabArray(value: unknown): value is SteamTab[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { id?: unknown }).id === "string",
    )
  );
}
