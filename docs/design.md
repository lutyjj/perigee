# Perigee architecture

Perigee is a Decky Loader plugin that mirrors the app libraries of paired Moonshine
(GameStream-protocol) hosts into Steam as non-Steam shortcuts, so SteamOS Big Picture is the
streaming frontend. No pairing UI, no streaming UI, no host agent: Moonlight (flatpak) is the
pairing tool and the streaming runner; Moonshine's native app auto-discovery is the library
source.

Perigee = the point of the moon's orbit closest to Earth.

## Scope

Perigee reads paired hosts and the client TLS identity from Moonlight's own config, queries each
host over the GameStream HTTPS API (`/serverinfo`, `/applist`, `/appasset`), caches box art, and
converges Steam: Perigee-owned shortcuts with capsule artwork, grouped per host. Every backend
capability is also a CLI verb (`python3 -m perigee …`), so the backend is verifiable over SSH
without the UI.

Non-goals, by design: pairing flow and mDNS discovery (Moonlight owns pairing), wake-on-LAN
(Moonlight wakes paired hosts on connect), per-app resolution/HDR settings, hero/logo/icon
artwork (decky-steamgriddb's job; Perigee sets only the capsule), server-certificate pinning
(`srvcert` exists in Moonlight.conf; accepted follow-up).

## Ground truth

Properties of SteamOS, Decky Loader, Moonlight and the GameStream protocol, not of any
particular installation. Device specifics (ssh destination, plugin directory, the uuids
`make verify` asserts) live only in the gitignored `device.env`.

- Decky Loader runs as the `plugin_loader` systemd unit and keeps plugins under
  `<user home>/homebrew/plugins/`. Verified against Decky Loader v3.2.8-pre1.
- Decky runs plugin backends inside its own frozen CPython **3.11**, whose bundled stdlib omits
  `xml.etree` and `xml.dom`. 3.11 is the floor every gate holds to; the device's own `python3`
  (newer) runs the CLI harness.
- Moonlight's flatpak config, relative to the user's home:
  `.var/app/com.moonlight_stream.Moonlight/config/Moonlight Game Streaming Project/Moonlight.conf`
  (a QSettings INI). `[General]` holds `certificate` and `key` as
  `"@ByteArray(-----BEGIN …\n…)"` (PEM with literal `\n` escapes); `[hosts]` holds `N\hostname`,
  `N\uuid`, `N\localaddress`, `N\manualaddress`, `N\srvcert` and cached `N\apps\…`.
  `tests/fixtures/Moonlight.conf` is a synthetic config in exactly this shape.
- A Moonshine host serves HTTP on 47989 and HTTPS on 47984. `/serverinfo` needs no auth over
  HTTP and returns `<root status_code="200">` with `<uniqueid>` and `<hostname>`. A conf entry
  whose `uuid` differs from the live `uniqueid` is a stale pairing (the host was rebuilt or
  migrated); the status classification below keeps one dead entry from breaking the sync.
- Protocol source: [github.com/hgaiser/moonshine](https://github.com/hgaiser/moonshine),
  `moonshine-core/src/webserver/mod.rs`: `/applist` and `/appasset` are HTTPS, gated on a
  paired client certificate; applist XML is
  `<root status_code="200"><App><IsHdrSupported>…<AppTitle>…<ID>…</App>…</root>`;
  `/appasset?appid=<id>` returns image bytes.
- Steam-side reference: [github.com/FrogTheFrog/moondeck](https://github.com/FrogTheFrog/moondeck)
  (`src/steam-utils/*.ts` for `SteamClient.Apps` patterns,
  `defaults/python/lib/moonlightproxy.py` for the Moonlight CLI invocation shape).

## Wire contract (backend callables → frontend)

Two components: the backend knows GameStream and the filesystem; the frontend knows Steam.
Neither reaches into the other's domain.

Callable `refresh() -> SyncState` (JSON):

```json
{
  "schema_version": 3,
  "captured_at": 1750000000.0,
  "hosts": [
    {
      "uuid": "15b43594-…",            // identity key everywhere; canonical lowercase
      "name": "Moonshine",             // display label only, never identity
      "address": "192.0.2.10",
      "status": "online" | "offline" | "stale_pairing" | "unauthorized",
      "apps": [ { "host_app_id": "123", "title": "Factorio", "art_cached": true } ]
    }
  ],
  "errors": [ { "host_uuid": "…" | null, "message": "…" } ]
}
```

`uuid` is lowercased by `MoonlightConfigReader`, so the wire, the shortcut tag and every
comparison share one form. `art_cached` says only whether a capsule is on disk: probing never
fetches art. `captured_at` (epoch seconds) lets the panel say how old what it shows is.

`refresh()` probes every host at once, each on its own thread with a per-host timeout, emits
`perigee/host` as each lands and `perigee/refresh_done` at the end, and stores the result.

- `last_snapshot() -> SyncState | null`: the stored result, no network I/O. What the panel
  renders on open.
- `art_base64(host_uuid, host_app_id) -> str | None`: the capsule, from cache or fetched on a
  miss; the only art path, which is how art added on the host later still arrives.
- `purge() -> None`: deletes the art cache, the stored snapshot, the settings and the
  materialized client identity. The frontend half of the same edge removes shortcuts and
  collections.
- `settings() / set_presentation_mode(mode)`: the stored library-grouping choice. The backend
  keeps an opaque bounded string; the frontend owns what it means and falls back to the default
  for a value it does not recognize.
- `display_capabilities() -> DisplayCapabilities`: what the display attached to the device
  reports, so the panel offers rates that display can actually show.

```json
{
  "schema_version": 1,
  "detection": "detected",         // or "unknown"
  "connector": "HDMI-A-1",         // the DRM connector, or null when none is connected
  "max_refresh_hz": 120,           // null exactly when detection is "unknown"
  "modes": [ { "width": 3840, "height": 2160, "refresh_hz": 60.0 } ],
  "reason": null                   // why the display is unknown, else null
}
```

`detection` and `max_refresh_hz` are both read off `modes`. A producer never states them and a
parser never trusts a stated one, so both sides reject a document that disagrees with its own
modes. That is what lets a consumer branch on `max_refresh_hz === null` alone. The peak rounds
half up on both sides, so neither mirror produces a document the other refuses. The backend
enumerates `/sys/class/drm/card*-*/`, takes a connector whose `status` is `connected`, prefers
one whose `enabled` attribute says it is driving a mode, and parses that connector's EDID. No
connected connector, and an EDID that cannot be read or parsed, each yield the `unknown` result
rather than an exception: the panel has to keep working with nothing plugged in.
`src/core/display.ts` mirrors this schema by hand, pinned from both sides by
`tests/fixtures/display_capabilities.json` exactly as the sync state is.

Host status semantics (drives deletion safety):

- `online`: `/serverinfo` answered and its uniqueid equals the conf uuid → the app list is
  authoritative; converge fully. An authoritative host listing *zero* apps is treated as a
  host-side glitch: reported, nothing touched.
- `offline`: no answer → existing shortcuts stay untouched.
- `stale_pairing`: answered but uniqueid mismatch → report, keep, skip.
- `unauthorized`: the host refused the client certificate → report "pair again in Moonlight",
  keep, skip.
- A uuid absent from Moonlight.conf entirely (unpaired) does not appear in `hosts`; the frontend
  deletes shortcuts tagged with unknown uuids only when the conf itself was read cleanly, never
  on a failed sync.

The TS types in `src/core/model.ts` mirror this schema by hand: accepted debt, pinned from both
sides by `tests/fixtures/sync_state.json`: the backend asserts `to_json()` equals the file and
`from_json` round-trips it; the frontend asserts the parsed object equals a literal carrying
exactly the declared keys. A field added on either side fails one of them.

## Backend (Python 3.11 floor, stdlib only)

Lives in `py_modules/perigee/` (Decky puts `py_modules` on `sys.path`); `main.py` at the plugin
root is a thin Decky adapter. One class per file:

- `config.py` (`MoonlightConfigReader`): QSettings INI → frozen `ClientIdentity(cert_pem,
  key_pem)` and `PairedHost(uuid, hostname, address)`; unescapes `@ByteArray(…)`; picks
  `manualaddress or localaddress`; lowercases the uuid and dedupes on it. `ClientIdentity` keeps
  both PEMs out of every `repr`.
- `identity.py` (`IdentityStore`): materializes the PEMs as 0600 `O_NOFOLLOW` files under the
  runtime dir (`ssl` needs paths), once per identity, under a lock with staged-then-renamed
  writes so concurrent probes cannot race; returns an `ssl.SSLContext` with the client cert
  loaded and server verification off (LAN, self-signed hosts).
- `xmltree.py`: a read-only element tree over `xml.sax` (the frozen runtime has no
  `xml.etree`). Rejects any document carrying a DTD and caps document size.
- `gamestream.py` (`GameStreamClient(address, ssl_context)`): `server_info()`, `app_list()`,
  `app_asset(host_app_id)` over `http.client`, byte-capped, parsed at the boundary into typed
  `HostInfo`/`GameStreamApp`; typed errors (`HostUnreachable`, `PairingRejected`,
  `ProtocolError`).
- `art.py` (`ArtCache(dir)`): keyed `<host_uuid>/<host_app_id>.png`, staged-then-renamed writes,
  path segments validated (`.`/`..` included).
- `sync.py` (`SyncService(reader, client_factory, storage, clock, probe_timeout)`): conf → concurrent
  per-host probe → status classification → applist → `SyncState`; plus `art()` and `purge()`.
  `build_sync_service()` is the single composition root `main.py` and the CLI share.
- `snapshot.py` / `settings.py` / `storage.py`: staged-file stores for the last probe result and
  the plugin preferences, and `Storage`, which holds all four stores and is the only place their
  locations are derived. Both the plugin and the CLI build it, so the settings verb cannot edit a
  file the plugin does not read, and `purge()` has one owner. `purge()` removes the settings too:
  the panel offers it as the thing to do before uninstalling, so it must leave nothing behind.
- `edid.py`: refresh rates out of EDID bytes. A rate is the pixel clock over the total pixels
  of a detailed timing, taken from the base block's four descriptor slots and from a CTA-861
  extension's, starting at the offset its byte 2 declares. Anything that is not an EDID raises
  `EdidError` rather than yielding a plausible number: the length must be whole blocks, the
  header must be the fixed eight bytes, and every block must sum to zero.
- `display.py` (`DisplayProbe`): the connector rule above, and the `DisplayCapabilities`
  dataclass with its `to_json()`/`from_json()`.
- `model.py`: the `SyncState` dataclasses, `to_json()`/`from_json()`; the on-device verifier
  parses through this module, so the schema has no third mirror.
- `parse.py` (`JsonReader`): the boundary guards both schema mirrors share, bound once to each
  mirror's own error type so the mirrors differ only in what they describe.
- `cli.py` + `__main__.py`:
  `python3 -m perigee {refresh,snapshot,art,settings,display,purge}`; every callable has a verb.

## Frontend (TypeScript strict, React, @decky/ui + @decky/api)

- `src/core/model.ts`: the schema mirror (see wire contract).
- `src/core/display.ts`: the display-capabilities mirror, and the explicit unknown every
  consumer starts from.
- `src/core/parse.ts`: the boundary guards both mirrors share, the counterpart of `parse.py`.
- `src/core/launch.ts`: builds and parses the launch line. Host text is validated (no control
  characters, no `%command%`) and quoted, so a hostile app title cannot break into the argument
  list; the host title is read back out of the stream argument, which is what makes it usable as
  identity.
- `src/core/plan.ts`: pure `computePlan(state, ownedShortcuts, flags) → {creates, updates,
  unchanged, deletes, warnings}`; encodes the deletion-safety semantics above. Also `launchOptionsForOwned`,
  the launch line an already-owned shortcut takes under new flags, built from its own tag alone. The
  flags ride in the launch options, so a shortcut whose flags are stale lands in `updates`: the
  backstop for a rewrite Steam refused, not the path a setting change normally takes.
- `src/core/stream-settings/`: the streaming settings (see below).
- `src/steam/api.ts`: the transcribed Steam surface; the vertical-capsule asset type cites the
  decky-steamgriddb commit it was read from.
- `src/steam/shortcuts.ts` (`ShortcutGateway`): enumerates shortcuts, filters Perigee's by tag,
  returns `null` (not an empty list) when Steam cannot be enumerated; creates via `AddShortcut`
  then polls app details until the tag is observable, rolling back on timeout.
- `src/steam/collections.ts` (`CollectionGateway`): one `Perigee: <host name>` collection per
  host, uuid-prefix-disambiguated on name collisions; membership converges only over apps
  Perigee owns; failures degrade to a warning.
- `src/presentation/`: the grouping seam (next section).
- `src/sync/controller.ts` (`SyncController`): callable → gateways → plan → apply →
  `SyncReport`; also `purge()`. The only stateful frontend piece.
- `src/sync/flags.ts` (`StreamFlagWriter`): rewrites the launch options of every owned shortcut
  under a new flag set, through `setLaunchOptions` so a shortcut the user renamed keeps its name.
  It needs the shortcut gateway and nothing else, which is what lets a setting apply on change;
  a refusal costs that one shortcut and is named, never the batch.
- `src/index.tsx`: the QAM panel, in three sections. **Hosts** renders the stored snapshot
  immediately, refreshes in the background, and patches host rows in place per `perigee/host`
  event; Refresh and Sync are separate actions with their own busy states. **Library** carries
  the grouping selector and, under it, a **Streaming** disclosure that is collapsed on each
  plugin load and expands into the registry-driven controls. **Maintenance** carries the removal
  action and the version.
  Every row states how it gives up space (ellipsis, wrap, full-width controls), because the
  quick-access column is narrow.
- `src/panel/StreamingSection.tsx`: the streaming controls, rendered from the registry. It
  names no setting and no group. A slider setting renders as a toggle row above an
  always-visible slider row, the way Steam's performance panel presents its TDP limit: two
  ordinary stacked rows, so navigation is d-pad down and nothing nests a focusable. Toggling
  off deletes the stored value, and `src/core/panel-session.ts` keeps the slider's position for
  the session so re-enabling restores it.
- `src/core/panel-session.ts`: panel state that outlives an unmount. Steam unmounts the panel
  whenever the sidebar closes, and opening a native picker closes it, so whether Streaming is
  expanded and what the last sync reported live for the plugin's lifetime rather than the
  component's. None of it is persisted: a fresh load starts collapsed and quiet.

Streaming settings live in the panel rather than a route of their own. SteamOS keeps this class
of A/V control in the quick-access sidebar, which is also the surface that opens over a running
stream, and a plugin page has to hand-build chrome Steam otherwise owns: the footer legend stops
following a scrolling page. The registry is what keeps that placement cheap: the panel section
is one renderer over it, so which surface hosts the controls is a renderer choice.

## Presentation modes

`PresentationGateway` (`src/presentation/`) owns how a host's shortcuts are grouped. `modes.ts`
is the single selection point: a mode is a module plus one row in its builder table.

| Mode | Effect |
| ---- | ------ |
| `collections` (default) | One `Perigee: <host>` Steam collection per host. |
| `tabs` | A Big Picture library tab per host, on top of those collections. |

`tabs` is additive on purpose: the tabs render Perigee's own collections, so Steam draws them
with the grid it already has, and a failed injection costs only the tabs; the collections
remain one level down.

The collections stay visible in Steam's own Collections view in `tabs` mode. That redundancy
buys three properties an in-memory collection object cannot hold. Steam's grid reads
`visibleApps` inside a mobx computed, so a persisted collection is an observable: a sync reaches
an open tab without Perigee re-rendering anything. It is also the state that survives a reload,
which is what puts the right tabs on the first library render after a reboot; app overviews
carry no launch options, so nothing else on the Steam side says which shortcuts belong to which
host. It is finally what `FallbackPresentation` falls back to. Were the collections created only
while tabs worked, an anchor that moved at plugin load would announce a grouping that is not
there until the user presses Sync, a state with no exit.

Rendering is not the obstacle: the grid dereferences only `visibleApps` and `id`, and
TabMaster's custom tabs are backed by an object built in memory. Steam exposes no way to keep a
user collection out of the Collections view either, so hiding it is not an option.

Steam exposes no API for the library tab strip. The tab array is built inside a memoised Steam
component, so `tabs/patch.ts` intercepts it where it is produced: React's hook dispatcher is
borrowed for one render, its `useMemo` wrapped, and the tab array rewritten. The technique is
[TabMaster](https://github.com/Tormak9970/TabMaster)'s. A Perigee tab is Steam's own `AllGames`
tab cloned with `id`, `title` and one `collection` prop replaced, so when Steam changes the
grid's internals the clone follows.

`tabs/dispatcher.ts` reads that dispatcher fresh on every render, and this is load bearing.
React swaps the dispatcher between render phases, so the object current while a component renders
is not the one current at any other moment. Anything holding a reference from module load wraps
an idle dispatcher no render consults, and the interception silently never runs. React 19 keeps
the live slot at `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H`; React 18
kept it at `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher`.

The active mode is engaged by `PresentationHost` at plugin load, not by the first sync and not by
the panel. A host owns the gateway for the plugin's lifetime, engages the stored mode straight
away, and outlives every panel mount. A mode that only takes effect while something else runs is
a mode the user reads as broken.

Every structural assumption is an **anchor**, named in `tabs/anchors.ts` and checked where it is
used:

| Anchor | What must be true |
| ------ | ----------------- |
| `route-patch` | `routerHook.addPatch("/library", …)` accepts a patch. |
| `outer-element` | The route's `children` is an element with a `type`; patching yields another. |
| `inner-element` | The inner element's `type` is a memo object carrying a `type` function. |
| `react-hooks` | React's current dispatcher is reachable and exposes a swappable `useMemo`. |
| `template-tab` | That array contains Steam's `AllGames` tab, whose `content` has props. |
| `tab-grid` | Inside that content is a node carrying a `collection` prop (the app grid). |

A missing anchor is reported, never worked around: `FallbackPresentation` switches the session to
collections and announces one panel line, `Library tabs unavailable (<reason>); using collections
instead`. The announcement goes through the host, so the panel shows it whenever it is next
opened rather than only inside a sync report. The switch is one-way per session: an anchor Steam
moved will not return before a reload, and retrying every sync would flicker the library.

`tabs` stands down entirely when another plugin patches the same route (`tabs/coexistence.ts`;
today that list is TabMaster): two plugins borrowing the hook dispatcher on one component cannot
both win. The user keeps TabMaster's tabs and Perigee's collections, and the panel says so;
TabMaster's own Collection filter over `Perigee: <host>` yields the same tabs.

Changing the mode stores the choice first and cleans up the old grouping afterwards. Cleanup is
Steam work that can fail or hang, and a setting held hostage to it is a setting that silently
reverts.

Vitest covers the pure tab model, dispatcher lookup, and patch lifecycle. Steam's real React
tree remains the owner-native test for content discovery and scroll-state preservation; those
paths are anchored and fail toward fallback.

## Shortcut identity and launch shape

- Ownership tag: launch options begin with `PERIGEE=<host_uuid>:<host_app_id> %command%`.
  Enumeration filters on `^PERIGEE=([^:\s]+):(\S+) ` and lowercases the uuid it reads.
- exe `/usr/bin/flatpak`; options continue
  `run com.moonlight_stream.Moonlight <flags…> stream <address> "<AppTitle>" --quit-after`, title
  backslash-quoted. Moonlight documents its options before the `stream` verb, which also keeps
  the identity suffix at the end of the line where the parser anchors it.
- **Identity is `(host_uuid, host title)`, not the host's app id.** Moonshine computes `<ID>` as
  a `DefaultHasher` over the title (`moonshine-core/src/session/application.rs`), so the number
  is a function of the label. Keying on the title makes an id change (host upgrade, hasher
  change) a harmless tag rewrite instead of a device-wide delete-plus-create, and matches what
  Moonlight addresses: the title is the stream argument.
- Accepted consequences: a host-side rename is a delete-plus-create (nothing in the protocol
  connects the entries; a stable host-side id is an upstream decision); two apps sharing a title
  on one host collapse to one shortcut, reported; renaming the Steam shortcut is undone on the
  next sync; the host owns the title.

## Streaming settings

One registry declares every Moonlight option Perigee offers, and three consumers read it: the
launch line builder, the panel's Streaming section, and the validator. None of them names a
setting or a group, so adding either is a single entry in
`src/core/stream-settings/registry.ts` and nothing else, tests included.

- `descriptor.ts` owns what a setting *is*: the three kinds (`tristate-toggle`, `slider`,
  `enum`), what each accepts, and the flags each emits. A kind is the seam; a setting is data.
- `registry.ts` is the data: stable key, kind, group heading, label and description, flag names,
  enum options and the provider that fills them, slider range and the scale between the unit
  shown and the unit the flag takes.
  Bitrate is the scale's reason for existing: the panel reads Mbps, `--bitrate` takes Kbps.
- `stream-settings.ts` validates a stored map against the registry, emits flags in registry
  order, and partitions the settings into the panel's groups. Stored values outlive the registry
  that wrote them, so a removed setting or a narrowed range drops out here rather than reaching a
  launch line.

A descriptor may also declare `requires: {key, value}`. The control renders disabled, naming the
setting it waits for, until that setting holds that value: Moonlight itself only offers frame
pacing while V-Sync is on. The constraint is the panel's alone. The stored value survives while
the control is inert, and emission stays a value-to-flag mapping that never consults the
requirement, so what a launch line carries is always what the user chose.

An enum descriptor may name an **option provider** rather than stand on the list it declares.
`option-providers.ts` is the table: `static` hands back the declared list, `client-display`
builds one from `display_capabilities()`. Frame rate is why it exists. A fixed 30 to 120 range
is wrong on every display that is not 120 Hz, and only the device knows which one is attached.
For a display whose peak is R the provider offers 30, 60, R/2, the VRR cap
`floor(R - R²/3600)` and R, ascending and deduplicated, with the cap labelled so its nature
shows: on a 120 Hz television that reads `30, 60, 116 (VRR), 120`. The cap leaves one 3600 Hz
tick of headroom per frame, which is what stops a variable-refresh display having to wait a
whole further refresh.

A provider owns acceptance as well as the list, and the two are deliberately not the same set.
The list is what the panel offers now; acceptance is what the setting still takes later. A
display can be swapped under a stored value, so `client-display` accepts any whole refresh rate
and keeps offering a stored one this display cannot reach: the value is the user's, not the
display's. `static` is also every provider's degrade path, and the degrade condition is an
unusable list rather than an unread display. A display the backend could not read, and one
reporting only rates this client cannot ask for, both leave the control on the list its
descriptor declares rather than on an empty one.

A provider reads what the device reports through an `OptionContext`: one field per capability,
held as one piece of panel state and passed as one prop. So a new provider is one object plus
one row in that table, and a provider fed by a capability the context does not carry yet adds
one field there and one fetch at the composition root. No renderer names a capability, the same
way no renderer names a setting.

A group is presentation only and never stored, so the heading text is the grouping key and group
order follows first appearance in the registry. That keeps a new group as cheap as a new
setting: one string, one file.
- `document.ts` mirrors the settings half of `settings.py`, pinned from both sides by
  `tests/fixtures/plugin_settings.json`.

Unset is inherit. The tri-state is the absence of a stored value, not a third value, so a
setting nobody touched emits no flag and Moonlight keeps its own. Flags are transcribed from
`moonlight stream --help` on the target build; one this build does not accept has no descriptor.
Moonlight's own usage line is `moonlight [options] stream <host> "<app>"`, and it validates
option values in that position, which is why the flags sit before the verb.

Storing a setting and putting it on the shortcuts is one act, and the binding's queue runs both
so a slider drag rewrites the shortcuts once rather than once per step. The rewrite reads a
shortcut's own ownership tag for the host, address and title it needs, so it asks no host and
touches no network: that is what makes applying on change affordable enough to be the only path.

The two halves fail differently, so `BindingPorts` keeps them apart. `store` may reject, and a
rejection is the one case the panel gives the value back, because nothing reached disk. `rewrite`
never rejects: by the time it runs the value is stored, so a shortcut Steam would not take is
reported and kept, never undone. Rolling a stored value back would leave the panel showing one
thing and the disk holding another, and the panel never diverges from what is stored. Sync is
the repair for every shortcut a rewrite missed, and every message says so.

Two gates own the journey rather than its pieces, because a full set of green unit tests is
compatible with no shortcut on the device carrying a single flag.
`tests/frontend/settings-journey.test.ts` joins a stored settings document to the launch options
a shortcut ends up with, and `make verify` asserts the same against Steam's own `shortcuts.vdf`:
stored settings present means flags present, blind to which flags exist.

The device half checks presence, not currency, and that is a deliberate ceiling. Which flags a
setting turns into is the registry's to say, and teaching the Python harness that table would
give the contract a second owner, which is the failure mode the registry exists to prevent. So a
shortcut still carrying `--fps 60` after the user moved to 120 passes on the device; the frontend
journey test is what catches that. What the device gate does own is the case no unit test can
reach: a real `shortcuts.vdf` where the flags are missing altogether. A device with nothing
synced is reported as a skipped check rather than a pass, and `VERIFY_REQUIRE_SHORTCUTS=1` turns
that skip into a failure for a caller that knows a sync has already run.

The backend stays name-blind. `settings.py` keeps `stream_settings` as an opaque key-to-scalar
map, bounded by entry count and value length, and validates nothing about meaning. That is why
the settings wire contract versions once for the map and never again per setting.

Settings are global: one document covers every shortcut Perigee owns. Per-host overrides would
be a second sparse map merged over this one, which the registry already allows and nothing here
presumes.

## Abandon edge

Uninstall is asymmetric: Decky runs only the plugin's Python at uninstall time, so `SteamClient`
is unreachable and shortcuts cannot be removed there. The exit is split, both halves
programmable:

- `_uninstall` (and `purge()` / `python3 -m perigee purge`) removes the art cache and the
  materialized client identity.
- The panel's confirm-gated "Remove synced shortcuts" removes every tagged shortcut
  and every `Perigee: …` collection, then calls the backend purge. This is the action to take
  *before* uninstalling.

Moonlight's pairing and config are never touched by either.

## Repository layout

The root is the Decky store's contract: the store rebuilds a submitted plugin from the repo
itself and packages a fixed set of root paths, so `plugin.json`, `package.json`, `main.py`,
`py_modules/` and the frontend build config are pinned to the root
([decky-store-requirements.md](decky-store-requirements.md), R10–R16).

```
perigee/
  plugin.json  package.json  main.py   # the Decky plugin contract (shipped)
  py_modules/perigee/                  # backend package (shipped)
  src/                                 # frontend source → dist/ (shipped as dist/)
  docs/                                # this document and its siblings
  tests/backend/ frontend/ fixtures/   # pytest, vitest, and the shared schema fixture
  scripts/                             # stage/check/deploy/verify, all container- or ssh-run
  Makefile  Dockerfile                 # every gate in a digest-pinned container
  device.env.example                   # template for the gitignored device profile
  .github/workflows/                   # runs the same make targets
```

Build, deploy and release mechanics live in [development.md](development.md).
