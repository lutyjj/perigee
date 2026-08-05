import { StreamSettings } from "./descriptor";

/**
 * Hand-written mirror of the settings half of py_modules/perigee/settings.py, pinned
 * from both sides by tests/fixtures/plugin_settings.json. The backend keeps the map
 * opaque, so this is the only place its shape is asserted on the frontend.
 */
export const PLUGIN_SETTINGS_SCHEMA_VERSION = 2;

export interface PluginSettingsDocument {
  readonly schema_version: number;
  readonly presentation_mode: string;
  readonly stream_settings: StreamSettings;
}

export class PluginSettingsFormatError extends Error {}

export function parsePluginSettings(value: unknown): PluginSettingsDocument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PluginSettingsFormatError("Expected an object for plugin settings");
  }
  const document = value as Record<string, unknown>;
  if (document["schema_version"] !== PLUGIN_SETTINGS_SCHEMA_VERSION) {
    throw new PluginSettingsFormatError(
      `Backend speaks settings schema ${String(document["schema_version"])}, ` +
        `frontend speaks ${PLUGIN_SETTINGS_SCHEMA_VERSION}`,
    );
  }
  const mode = document["presentation_mode"];
  if (typeof mode !== "string") {
    throw new PluginSettingsFormatError("Expected a string for presentation_mode");
  }
  return {
    schema_version: PLUGIN_SETTINGS_SCHEMA_VERSION,
    presentation_mode: mode,
    stream_settings: readStreamSettings(document["stream_settings"]),
  };
}

function readStreamSettings(value: unknown): StreamSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const settings: Record<string, string | number> = {};
  for (const [key, stored] of Object.entries(value)) {
    if (typeof stored === "string" || typeof stored === "number") {
      settings[key] = stored;
    }
  }
  return settings;
}
