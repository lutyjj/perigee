import {
  ButtonItem,
  ConfirmModal,
  Dropdown,
  Field,
  PanelSection,
  PanelSectionRow,
  showModal,
  staticClasses,
} from "@decky/ui";
import { addEventListener, callable, definePlugin, removeEventListener } from "@decky/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaMoon } from "react-icons/fa";

import packageJson from "../package.json";

import { HostState, HostStatus, SyncState, parseHostState, parseSyncState } from "./core/model";
import { parseDisplayCapabilities } from "./core/display";
import { consoleLogger } from "./core/logger";
import { describeAge } from "./core/age";
import { emptyState, withHost } from "./core/patch-state";
import { createPresentationGateway } from "./presentation/factory";
import { PresentationHost } from "./presentation/host";
import {
  DEFAULT_PRESENTATION_MODE,
  PRESENTATION_MODES,
  PRESENTATION_MODE_DESCRIPTION,
  PRESENTATION_MODE_LABEL,
  PresentationMode,
  parsePresentationMode,
} from "./presentation/modes";
import { STREAM_SETTING_REGISTRY } from "./core/stream-settings/registry";
import { StreamSettingValue, StreamSettings } from "./core/stream-settings/descriptor";
import { PanelSession, createPanelSession } from "./core/panel-session";
import { SectionHeading } from "./panel/SectionHeading";
import { StreamingControls } from "./panel/StreamingSection";
import { useSessionState } from "./panel/session";
import { parsePluginSettings } from "./core/stream-settings/document";
import { groups, streamFlags } from "./core/stream-settings/stream-settings";
import {
  BindingPorts,
  SettingsBinding,
  SettingsCommit,
  createSettingsBinding,
} from "./core/stream-settings/binding";
import { NOTHING_DETECTED, OptionContext } from "./core/stream-settings/option-providers";
import { ShortcutGateway } from "./steam/shortcuts";
import { steamEnvironment } from "./steam/api";
import { SyncController, SyncReport } from "./sync/controller";
import { SHORTCUTS_NOT_REWRITTEN, StreamFlagWriter } from "./sync/flags";

const HOST_EVENT = "perigee/host";
const REFRESH_DONE_EVENT = "perigee/refresh_done";
const AGE_TICK_MS = 30_000;

const callLastSnapshot = callable<[], unknown>("last_snapshot");
const callRefresh = callable<[], unknown>("refresh");
const callArtBase64 = callable<[host_uuid: string, host_app_id: string], string | null>(
  "art_base64",
);
const callPurge = callable<[], void>("purge");
const callSettings = callable<[], unknown>("settings");
const callDisplayCapabilities = callable<[], unknown>("display_capabilities");
const callSetPresentationMode = callable<[mode: string], unknown>("set_presentation_mode");
const callSetStreamSettings = callable<[values: StreamSettings], unknown>("set_stream_settings");

const SETTING_GROUPS = groups(STREAM_SETTING_REGISTRY);
const PLUGIN_VERSION: string = packageJson.version;


// The one place the panel states what removal does. The last sentence is the only
// UI-discoverable statement of the uninstall ordering.
const REMOVAL_DESCRIPTION =
  "Removes every shortcut and collection Perigee created, and clears its caches and " +
  "settings. Your Moonlight pairing is untouched. Do this before uninstalling the plugin.";

const STATUS_LABEL: Record<HostStatus, string> = {
  online: "online",
  offline: "offline",
  stale_pairing: "stale pairing",
  unauthorized: "re-pair needed",
};

// The quick-access column is narrow, so every row states how it gives up space.
const NAME_STYLE = {
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

const STATUS_STYLE = { flex: "0 0 auto", marginLeft: "0.5em", opacity: 0.75 } as const;

const NOTE_STYLE = {
  fontSize: "0.8em",
  opacity: 0.8,
  overflowWrap: "anywhere",
  whiteSpace: "normal",
} as const;

/**
 * Built once at plugin load so the active mode is engaged before anyone opens the
 * panel: a library tab that only appears after a sync reads as a tab that never works.
 */
function startPresentation(mode: PresentationMode): PresentationHost | null {
  const steam = steamEnvironment();
  if (steam === null) {
    consoleLogger.error("Steam client interfaces are unavailable");
    return null;
  }
  return new PresentationHost(
    (built, announce) => createPresentationGateway(built, steam, consoleLogger, announce),
    mode,
    consoleLogger,
  );
}

function createController(presentation: PresentationHost): SyncController | null {
  const steam = steamEnvironment();
  if (steam === null) {
    return null;
  }
  return new SyncController(
    callArtBase64,
    callPurge,
    new ShortcutGateway(steam, consoleLogger),
    presentation.current(),
    consoleLogger,
  );
}

/**
 * Rewriting owned shortcuts needs Steam and nothing else, so it runs from the composition
 * root without waiting for the presentation host a sync depends on. It answers rather than
 * throws, because the setting it carries is already stored by the time it runs.
 */
async function applyToShortcuts(values: StreamSettings): Promise<SettingsCommit> {
  try {
    const flags = streamFlags(STREAM_SETTING_REGISTRY, values);
    const steam = steamEnvironment();
    if (steam === null) {
      return { rewritten: 0, warnings: [SHORTCUTS_NOT_REWRITTEN] };
    }
    const gateway = new ShortcutGateway(steam, consoleLogger);
    return await new StreamFlagWriter(gateway, consoleLogger).apply(flags);
  } catch (error) {
    consoleLogger.error("Could not reach Steam to apply the streaming settings", error);
    return { rewritten: 0, warnings: [SHORTCUTS_NOT_REWRITTEN] };
  }
}

/** A failed store is the one case where the panel must give the value back. */
function describeStoreFailure(error: unknown): string {
  return `Could not save that streaming setting (${String(error)}). Nothing was changed, so try again.`;
}

function reportLine(report: SyncReport): string {
  return `${report.created} added, ${report.updated} updated, ${report.removed} removed`;
}

function HostRow({ host }: { host: HostState }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", width: "100%" }}>
      <span style={NAME_STYLE}>{host.name}</span>
      <span style={STATUS_STYLE}>
        {STATUS_LABEL[host.status]} &middot; {host.apps.length}
      </span>
    </div>
  );
}

function Content({
  presentation,
  settings,
  session,
}: {
  presentation: PresentationHost | null;
  settings: SettingsBinding;
  session: PanelSession;
}) {
  const [streamSettings, setStreamSettings] = useState<StreamSettings>(settings.current());
  const [capabilities, setCapabilities] = useState<OptionContext>(NOTHING_DETECTED);
  const [streamingOpen, setStreamingOpen] = useSessionState(session, "streamingOpen");
  const [sliderPositions, setSliderPositions] = useSessionState(session, "sliderPositions");
  const [applying, setApplying] = useState(false);
  const [mode, setMode] = useState<PresentationMode>(
    presentation?.currentMode() ?? DEFAULT_PRESENTATION_MODE,
  );
  const [notice, setNotice] = useState<string | null>(presentation?.currentNotice() ?? null);
  const [generation, setGeneration] = useState(0);
  const controller = useMemo(
    () => (presentation === null ? null : createController(presentation)),
    // The gateway behind the host is replaced by switchTo, so a bump is the honest
    // dependency; `mode` was a phantom standing in for it.
    [presentation, generation],
  );
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  const [state, setState] = useState<SyncState | null>(null);
  const [report, setReport] = useSessionState(session, "report");
  const [notes, setNotes] = useSessionState(session, "notes");
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(() => {
    setRefreshing(true);
    void callRefresh()
      .then((document) => setState(parseSyncState(document)))
      .catch((error: unknown) => {
        consoleLogger.error("Refresh failed", error);
        setNotes([String(error)]);
      })
      .finally(() => setRefreshing(false));
  }, []);

  // Render whatever was stored last, then bring it up to date in the background.
  useEffect(() => {
    void callLastSnapshot()
      .then((document) => {
        if (document !== null) {
          setState(parseSyncState(document));
        }
      })
      .catch((error: unknown) => consoleLogger.error("Could not read the snapshot", error))
      .finally(refresh);
  }, [refresh]);

  // The active mode reports its own problems, so a fallback names itself even if the
  // panel is opened long after it happened.
  useEffect(() => {
    if (presentation === null) {
      return undefined;
    }
    setNotice(presentation.currentNotice());
    return presentation.subscribe(() => {
      setNotice(presentation.currentNotice());
      setGeneration((previous) => previous + 1);
    });
  }, [presentation]);

  // Per-host events land while the refresh is still running, so a slow host does not
  // hold up the ones that already answered.
  useEffect(() => {
    const onHost = addEventListener<[host: unknown]>(HOST_EVENT, (host) => {
      try {
        const parsed = parseHostState(host);
        setState((current) => withHost(current ?? emptyState(Date.now() / 1000), parsed));
      } catch (error) {
        consoleLogger.warn("Ignoring an unreadable host event", error);
      }
    });
    const onDone = addEventListener<[document: unknown]>(REFRESH_DONE_EVENT, (document) => {
      try {
        setState(parseSyncState(document));
      } catch (error) {
        consoleLogger.warn("Ignoring an unreadable refresh event", error);
      }
    });
    return () => {
      removeEventListener(HOST_EVENT, onHost);
      removeEventListener(REFRESH_DONE_EVENT, onDone);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Asked again on every mount: the display can be swapped while the plugin runs, and
  // a failed read leaves the settings on the list they declare rather than on none.
  useEffect(() => {
    void callDisplayCapabilities()
      .then((document) =>
        setCapabilities((current) => ({ ...current, display: parseDisplayCapabilities(document) })),
      )
      .catch((error: unknown) => consoleLogger.warn("Could not read the display", error));
  }, []);

  const onSync = useCallback(() => {
    const active = controllerRef.current;
    if (active === null || state === null) {
      return;
    }
    setSyncing(true);
    void active
      .sync(state, streamFlags(STREAM_SETTING_REGISTRY, streamSettings))
      .then((result) => {
        setReport(result);
        setNotes(result.warnings);
      })
      .catch((error: unknown) => {
        consoleLogger.error("Sync failed", error);
        setNotes([String(error)]);
      })
      .finally(() => setSyncing(false));
  }, [state, streamSettings]);

  const onSliderPosition = useCallback(
    (key: string, position: number) => setSliderPositions({ ...sliderPositions, [key]: position }),
    [sliderPositions, setSliderPositions],
  );

  const onSettingChange = useCallback(
    (key: string, value: StreamSettingValue | undefined) => {
      const previous = streamSettings;
      const next = { ...streamSettings };
      if (value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
      setStreamSettings(next);
      setApplying(true);
      void settings
        .write(next)
        .then((commit) => setNotes(commit.warnings))
        .catch((error: unknown) => {
          // Only a failed store rejects, so this value is not on disk: give the old one
          // back. A rewrite that fell short arrives as a warning above, value kept.
          consoleLogger.error("Could not store the streaming settings", error);
          setStreamSettings(previous);
          setNotes([describeStoreFailure(error)]);
        })
        .finally(() => setApplying(false));
    },
    [settings, streamSettings, setNotes],
  );

  const onModeChange = useCallback(
    (next: PresentationMode) => {
      if (presentation === null) {
        return;
      }
      setMode(next);
      void presentation
        .switchTo(next, async (chosen) => {
          await callSetPresentationMode(chosen);
        })
        .then((warnings) => setNotes(warnings))
        .catch((error: unknown) => {
          consoleLogger.error("Could not store the mode", error);
          setMode(presentation.currentMode());
          setNotes([String(error)]);
        });
    },
    [presentation],
  );

  const onPurge = useCallback(() => {
    const active = controllerRef.current;
    if (active === null) {
      return;
    }
    showModal(
      <ConfirmModal
        strTitle="Remove synced shortcuts"
        strDescription={REMOVAL_DESCRIPTION}
        strOKButtonText="Remove"
        onOK={() => {
          setSyncing(true);
          void active
            .purge()
            .then((result) => {
              setReport(null);
              setNotes([`removed ${result.removed} shortcuts`, ...result.warnings]);
            })
            .catch((error: unknown) => setNotes([String(error)]))
            .finally(() => setSyncing(false));
        }}
      />,
    );
  }, []);

  if (controller === null || presentation === null) {
    return (
      <PanelSection title="Perigee">
        <PanelSectionRow>
          <div style={NOTE_STYLE}>Steam interfaces are unavailable.</div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  const busy = refreshing || syncing;

  return (
    <PanelSection title="Perigee">
      <PanelSectionRow>
        <SectionHeading level="section">Hosts</SectionHeading>
      </PanelSectionRow>
      {state?.hosts.map((host) => (
        <PanelSectionRow key={host.uuid}>
          <HostRow host={host} />
        </PanelSectionRow>
      ))}
      {state !== null && state.hosts.length === 0 && (
        <PanelSectionRow>
          <div style={NOTE_STYLE}>No paired Moonlight hosts.</div>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <div style={NOTE_STYLE}>
          {state === null
            ? "Loading..."
            : refreshing
              ? "Checking hosts..."
              : `As of ${describeAge(state.captured_at, now)}`}
        </div>
      </PanelSectionRow>

      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy} onClick={refresh}>
          {refreshing ? "Checking hosts..." : "Refresh"}
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy || state === null} onClick={onSync}>
          {syncing ? "Syncing..." : "Sync to Steam"}
        </ButtonItem>
      </PanelSectionRow>
      {report !== null && (
        <PanelSectionRow>
          <div style={NOTE_STYLE}>{reportLine(report)}</div>
        </PanelSectionRow>
      )}
      {notice !== null && (
        <PanelSectionRow>
          <div style={NOTE_STYLE}>{notice}</div>
        </PanelSectionRow>
      )}
      {notes.map((note) => (
        <PanelSectionRow key={note}>
          <div style={NOTE_STYLE}>{note}</div>
        </PanelSectionRow>
      ))}

      <PanelSectionRow>
        <SectionHeading level="section">Library</SectionHeading>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field
          label="Library grouping"
          description={PRESENTATION_MODE_DESCRIPTION[mode]}
          childrenLayout="below"
          childrenContainerWidth="max"
          bottomSeparator="standard"
        >
          <Dropdown
            rgOptions={PRESENTATION_MODES.map((option) => ({
              data: option,
              label: PRESENTATION_MODE_LABEL[option],
            }))}
            selectedOption={mode}
            onChange={(option) => onModeChange(option.data as PresentationMode)}
          />
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => setStreamingOpen(!streamingOpen)}>
          <div style={{ display: "flex", alignItems: "baseline", width: "100%" }}>
            <span style={NAME_STYLE}>Streaming</span>
            <span style={STATUS_STYLE}>{streamingOpen ? "\u25be" : "\u25b8"}</span>
          </div>
        </ButtonItem>
      </PanelSectionRow>
      {applying && (
        <PanelSectionRow>
          <div style={NOTE_STYLE}>Applying to your shortcuts...</div>
        </PanelSectionRow>
      )}
      {streamingOpen && (
        <StreamingControls
          descriptors={STREAM_SETTING_REGISTRY}
          groups={SETTING_GROUPS}
          values={streamSettings}
          capabilities={capabilities}
          sliderPositions={sliderPositions}
          onChange={onSettingChange}
          onSliderPosition={onSliderPosition}
        />
      )}

      <PanelSectionRow>
        <SectionHeading level="section">Maintenance</SectionHeading>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={busy}
          description={REMOVAL_DESCRIPTION}
          onClick={onPurge}
        >
          Remove synced shortcuts&hellip;
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <div style={NOTE_STYLE}>Perigee {PLUGIN_VERSION}</div>
      </PanelSectionRow>
    </PanelSection>
  );
}

export default definePlugin(() => {
  // The stored settings are read once here, not per panel mount: the presentation
  // they name is engaged straight away, and the panel opens with the stored values.
  const ports: BindingPorts = {
    store: async (values) => {
      await callSetStreamSettings(values);
    },
    rewrite: applyToShortcuts,
  };

  let presentation: PresentationHost | null = null;
  let binding = createSettingsBinding({}, ports);

  const ready = callSettings()
    .then((stored) => {
      const settings = parsePluginSettings(stored);
      binding = createSettingsBinding(settings.stream_settings, ports);
      presentation = startPresentation(parsePresentationMode(settings.presentation_mode));
    })
    .catch((error: unknown) => {
      consoleLogger.error("Could not read the settings", error);
      presentation = startPresentation(DEFAULT_PRESENTATION_MODE);
    });

  const session = createPanelSession();

  function Panel() {
    const [host, setHost] = useState<PresentationHost | null>(presentation);
    useEffect(() => {
      void ready.then(() => setHost(presentation));
    }, []);
    return <Content presentation={host} settings={binding} session={session} />;
  }

  return {
    name: "Perigee",
    titleView: <div className={staticClasses.Title}>Perigee</div>,
    content: <Panel />,
    icon: <FaMoon />,
    onDismount() {
      presentation?.dismount();
    },
  };
});
