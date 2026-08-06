# The user journey

Perigee has one journey: from a paired Moonlight to streaming a host's game from Big Picture.
This document is the contract for that journey. A UI change that strands the user, hides a wait,
or creates state without an exit is not done, even if its own screen works. Commands and setup
live in the [README](../README.md); this document owns only the experience.

## Promises every stage keeps

- **The panel never blocks on the network.** It renders what it already knows and says how old
  that is ("As of 3 min ago"); host rows update in place as probes land.
- **Every failure names the next step in the message itself.** A stale pairing says to re-pair
  in Moonlight; an unauthorized host says the host no longer recognizes this client; a grouping
  fallback names the Steam structure that moved.
- **Sync reports what it did**: added, updated and removed counts plus warnings, and it touches
  nothing Perigee does not own.
- **Absence is not deletion.** An offline or unreachable host freezes its shortcuts. Only
  removing a host from Moonlight's own pairing list releases them.
- **Every state has an exit.** Switching grouping modes hands the previous grouping back first;
  "Remove synced shortcuts" undoes the plugin's entire footprint; Moonlight's pairing survives
  everything Perigee can do.
- **A streaming setting is live the moment it is set.** Changing one rewrites the launch options
  of every shortcut Perigee owns straight away, because a shortcut's own tag carries everything
  that rewrite needs: no host, no network, no sync. A setting the user must remember to apply is
  a setting they will report as broken. Shortcuts Steam refuses are named, with Sync as the retry.

## Stage 1: install

Entry: SteamOS with Decky Loader, and the Moonlight flatpak already paired with at least one
Moonshine host.

Promise: installing the zip is the whole setup. There is nothing to configure, no pairing to
repeat, no host to declare: Perigee reads the pairings Moonlight already holds.

Exit: Perigee appears in the quick-access menu.

## Stage 2: see your hosts

Entry: the panel opens.

Promise: hosts appear immediately, served from the stored snapshot when one exists and from the
first probe otherwise. Each shows a status that explains itself: online, offline, stale pairing
(re-pair in Moonlight), or unauthorized (the host dropped this client). Refresh is a visible,
separate action; its progress shows per host.

Exit: every paired host shows a status the user can act on.

## Stage 3: sync

Entry: at least one host is online.

Promise: one press creates the host's shortcuts with capsule artwork and the chosen grouping.
The result line states the counts; warnings appear under it and stay readable. A second sync
with nothing changed reports nothing changed.

Exit: the library shows a `Perigee: <host>` collection (and a tab per host in tabs mode) whose
contents match what the host offers.

## Stage 4: play

Entry: the user opens a synced shortcut in Big Picture.

Promise: the shortcut *is* the stream: Moonlight launches straight into the app, no menu in
between, and quits when the stream ends. It streams at whatever the Streaming section last said,
because those choices are already on the shortcut's launch line. Waking a sleeping host is
Moonlight's job and happens on connect.

Exit: back in the library, where the shortcut remains current.

## Stage 5: the host changes

Entry: games are installed, renamed or removed on the host; the host goes offline; a pairing
goes stale.

Promise: the next sync converges Steam to the host's current list and reports what moved. An
offline host changes nothing. A host-side rename is a remove-plus-add (the GameStream protocol
carries no stable app identity), and the report shows it as such rather than pretending
otherwise.

Exit: the library again matches the hosts, and every skipped host says why it was skipped.

## Stage 6: leave

Entry: the user wants Perigee gone, or a host gone.

Promise: unpairing a host in Moonlight releases that host's shortcuts on the next sync.
"Remove synced shortcuts" removes every Perigee shortcut, collection and tab in one confirmed
action, then clears the plugin's caches, settings and materialized credentials. Its description carries
the ordering the user cannot discover anywhere else: do this before uninstalling the plugin,
because uninstall runs only the backend and cannot reach Steam. Nothing Perigee does touches
Moonlight's pairings or any shortcut it does not own.

Exit: a library with no Perigee footprint and a Moonlight that still streams.
