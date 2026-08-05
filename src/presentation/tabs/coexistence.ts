/**
 * Plugins that patch the same library route. Two of them borrowing React's hook
 * dispatcher on the same component cannot both win, so Perigee stands down rather
 * than race: the user keeps the other plugin's tabs and Perigee's collections.
 */
const CONFLICTING_PLUGINS = ["TabMaster"] as const;

interface DeckyLoader {
  readonly plugins?: readonly { readonly name?: unknown }[];
  readonly pluginReloadQueue?: readonly { readonly name?: unknown }[];
}

export function conflictingLibraryPlugin(): string | null {
  const loader = (window as unknown as { DeckyPluginLoader?: DeckyLoader }).DeckyPluginLoader;
  const names = [...(loader?.plugins ?? []), ...(loader?.pluginReloadQueue ?? [])]
    .map((plugin) => plugin.name)
    .filter((name): name is string => typeof name === "string");
  return CONFLICTING_PLUGINS.find((conflict) => names.includes(conflict)) ?? null;
}
