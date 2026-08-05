/**
 * React's hook dispatcher, read fresh every time.
 *
 * React swaps the dispatcher between render phases, so the object that is current
 * while a component renders is not the one that is current at any other moment.
 * Anything holding a reference from module load is wrapping an idle dispatcher that
 * no render will ever consult. Under React 19 that slot is
 * `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H`; React 18 keeps
 * it under `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher`.
 */
export interface HookDispatcher {
  useMemo<T>(factory: () => T, deps: unknown[]): T;
}

interface ReactInternals {
  readonly __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: Record<
    string,
    unknown
  >;
  readonly __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: {
    ReactCurrentDispatcher?: { current?: unknown };
  };
}

export function currentDispatcher(react: unknown = steamReact()): HookDispatcher | null {
  const internals = react as ReactInternals | undefined;
  const client = internals?.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const candidates = [
    client?.["H"],
    ...Object.values(client ?? {}),
    internals?.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactCurrentDispatcher?.current,
  ];
  return candidates.find(isDispatcher) ?? null;
}

function steamReact(): unknown {
  return typeof window === "undefined" ? undefined : (window as { SP_REACT?: unknown }).SP_REACT;
}

function isDispatcher(value: unknown): value is HookDispatcher {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { useMemo?: unknown }).useMemo === "function"
  );
}
