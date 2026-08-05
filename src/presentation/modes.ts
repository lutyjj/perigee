/**
 * The vocabulary of library grouping: what the modes are called and how a stored value
 * is read back. Deliberately free of Steam imports, so the panel and the tests can
 * reason about modes without dragging the client in.
 */
export const PRESENTATION_MODES = ["collections", "tabs"] as const;

export type PresentationMode = (typeof PRESENTATION_MODES)[number];

export const DEFAULT_PRESENTATION_MODE: PresentationMode = "collections";

export const PRESENTATION_MODE_LABEL: Record<PresentationMode, string> = {
  collections: "Collections",
  tabs: "Library tabs",
};

export const PRESENTATION_MODE_DESCRIPTION: Record<PresentationMode, string> = {
  collections: "One Steam collection per host.",
  tabs: "A library tab per host, on top of the collections.",
};

export function isPresentationMode(value: unknown): value is PresentationMode {
  return PRESENTATION_MODES.some((mode) => mode === value);
}

export function parsePresentationMode(value: unknown): PresentationMode {
  return isPresentationMode(value) ? value : DEFAULT_PRESENTATION_MODE;
}
