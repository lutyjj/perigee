# Perigee

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin that mirrors the app
libraries of your paired [Moonshine](https://github.com/hgaiser/moonshine) hosts into Steam as
non-Steam shortcuts, artwork included. Big Picture becomes the streaming frontend; each shortcut
launches its stream directly through [Moonlight](https://moonlight-stream.org).

Perigee adds no pairing UI and no streaming UI. Moonlight owns pairing and the stream; Moonshine
owns the app list. Perigee keeps Steam in sync with what your hosts offer.

## Requirements

- SteamOS with Decky Loader.
- The Moonlight flatpak, already paired with at least one Moonshine host.

## Install

Stable: download `perigee.zip` from the latest
[release](https://github.com/lutyjj/perigee/releases) and install it through Decky's
**Manual plugin install**.

Nightly (the latest development build, cut from `main` on demand; the URL never changes):

```
https://github.com/lutyjj/perigee/releases/download/nightly/perigee-nightly.zip
```

## Use

Open the Perigee panel in the quick-access menu. Paired hosts appear immediately with their
status. **Refresh** re-probes the hosts; **Sync** converges Steam: it creates, renames and
removes Perigee-owned shortcuts, sets capsule artwork, and maintains the grouping you chose.
Perigee never touches shortcuts or collections it did not create, and
**Remove synced shortcuts** undoes its entire footprint; your Moonlight pairing survives both.

| Library grouping | Effect |
| ---------------- | ------ |
| Collections (default) | One `Perigee: <host>` Steam collection per host. |
| Library tabs | A Big Picture library tab per host, on top of those collections. |

Library tabs patch Steam internals no API exposes. If Steam moves, or TabMaster is installed,
Perigee falls back to collections and says so in the panel. TabMaster users get the same tabs by
pointing its Collection filter at `Perigee: <host>`.

Both modes keep the `Perigee: <host>` collections, so they show up under Collections either way:
the tabs render those collections, and they are what is left when a tab patch fails
([why](docs/design.md#presentation-modes)).

The panel's **Streaming** section sets Moonlight options for every shortcut Perigee creates:
resolution, frame rate, bitrate, codec, decoder, HDR, YUV 4:4:4, V-Sync, frame pacing, audio
layout and the performance overlay. It sits in the quick-access menu, so it opens over a running
stream. Anything left on "Moonlight decides" emits no flag, so Moonlight keeps its own setting.
A change reaches every shortcut Perigee owns as soon as you make it, so the next launch streams
with it. The performance overlay is the quickest way to see that for yourself. Shortcuts created
by an older version of Perigee carry no streaming settings until you change one or press Sync,
either of which brings all of them up to date at once.

Hero, logo and icon artwork are
[decky-steamgriddb](https://github.com/SteamGridDB/decky-steamgriddb)'s job; Perigee sets only
the capsule.

## More

- [docs/design.md](docs/design.md): architecture and contracts.
- [docs/user-journey.md](docs/user-journey.md): the experience the UI is held to.
- [docs/development.md](docs/development.md): building, testing, deploying, releasing.
- [docs/decky-store-requirements.md](docs/decky-store-requirements.md): the store packaging
  contract and where each rule is enforced.

BSD 3-Clause. See [LICENSE](LICENSE).
