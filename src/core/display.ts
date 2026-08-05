// Hand-written mirror of py_modules/perigee/display.py.
// tests/fixtures/display_capabilities.json is the pin: the backend asserts
// from_json(fixture).to_json() equals it, the frontend asserts the whole parsed object
// equals a literal, so a field added on either side fails one of them.
import { reader } from "./parse";

export const DISPLAY_CAPABILITIES_SCHEMA_VERSION = 1;

/** Derived from `modes`, never read off the document, so nothing validates a stated one. */
export type DisplayDetection = "detected" | "unknown";

export interface DisplayMode {
  readonly width: number;
  readonly height: number;
  readonly refresh_hz: number;
}

export interface DisplayCapabilities {
  readonly schema_version: number;
  readonly detection: DisplayDetection;
  /** The DRM connector the EDID came from, or null when none was connected. */
  readonly connector: string | null;
  /** Null exactly when detection is `unknown`, which is what a consumer branches on. */
  readonly max_refresh_hz: number | null;
  readonly modes: readonly DisplayMode[];
  /** Why the display is unknown, in the backend's words. Null when it is known. */
  readonly reason: string | null;
}

/** What every consumer starts from, and where a failed call leaves it. */
export const UNKNOWN_DISPLAY: DisplayCapabilities = {
  schema_version: DISPLAY_CAPABILITIES_SCHEMA_VERSION,
  detection: "unknown",
  connector: null,
  max_refresh_hz: null,
  modes: [],
  reason: "the display was not read",
};

export class DisplayCapabilitiesFormatError extends Error {}

const read = reader(DisplayCapabilitiesFormatError);

export function parseDisplayCapabilities(value: unknown): DisplayCapabilities {
  const root = read.record(value, "display capabilities");
  const version = root["schema_version"];
  if (version !== DISPLAY_CAPABILITIES_SCHEMA_VERSION) {
    throw new DisplayCapabilitiesFormatError(
      `Backend speaks display schema ${String(version)}, ` +
        `frontend speaks ${DISPLAY_CAPABILITIES_SCHEMA_VERSION}`,
    );
  }
  const modes = read.list(root["modes"], "modes").map(parseMode);
  const detection = detectionOf(modes);
  const maxRefreshHz = maxRefreshOf(modes);
  // Read off the modes here exactly as the backend reads them, so a document that
  // states either otherwise came from some other producer.
  if (root["detection"] !== detection || root["max_refresh_hz"] !== maxRefreshHz) {
    throw new DisplayCapabilitiesFormatError("detection and max_refresh_hz disagree with modes");
  }
  return {
    schema_version: DISPLAY_CAPABILITIES_SCHEMA_VERSION,
    detection,
    connector: optionalText(root["connector"], "connector"),
    max_refresh_hz: maxRefreshHz,
    modes,
    reason: optionalText(root["reason"], "reason"),
  };
}

function detectionOf(modes: readonly DisplayMode[]): DisplayDetection {
  return modes.length > 0 ? "detected" : "unknown";
}

/** Rounded half up, the way the backend rounds, so the two derive the same whole number. */
function maxRefreshOf(modes: readonly DisplayMode[]): number | null {
  return modes.length > 0 ? Math.round(Math.max(...modes.map((mode) => mode.refresh_hz))) : null;
}

function parseMode(value: unknown): DisplayMode {
  const mode = read.record(value, "mode");
  return {
    width: read.number(mode["width"], "mode.width"),
    height: read.number(mode["height"], "mode.height"),
    refresh_hz: read.number(mode["refresh_hz"], "mode.refresh_hz"),
  };
}

function optionalText(value: unknown, what: string): string | null {
  return value === null ? null : read.text(value, what);
}
