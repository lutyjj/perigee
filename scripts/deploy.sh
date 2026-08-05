#!/usr/bin/env bash
# Ship the built plugin to a Decky device and prove plugin_loader took it.
# The device profile comes from the Makefile (DEVICE_* variables); nothing lab
# specific is hardcoded here.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
staged="$repo/out/perigee"

: "${DEVICE:?set DEVICE to the ssh host of the Decky device}"
: "${PLUGIN_DIR:?set PLUGIN_DIR to the plugin directory on the device}"
: "${PLUGIN_USER:?set PLUGIN_USER to the account Decky runs plugins as}"

# plugin_loader logs this exact line once the plugin's Python side is live.
readonly LOADED_MARKER='Loaded Perigee'
readonly FAILURE_MARKER='traceback|error while loading|failed to (load|start)'
readonly READY_TIMEOUT_SECONDS=60

if [[ ! -d "$staged" ]]; then
  printf 'no build at %s, run make build first\n' "$staged" >&2
  exit 1
fi

printf 'deploying to %s:%s\n' "$DEVICE" "$PLUGIN_DIR"
ssh "$DEVICE" "mkdir -p '$PLUGIN_DIR'"
rsync -a --delete "$staged/" "$DEVICE:$PLUGIN_DIR/"
ssh "$DEVICE" "chown -R $PLUGIN_USER:$PLUGIN_USER '$PLUGIN_DIR'"

since="$(ssh "$DEVICE" 'date +"%Y-%m-%d %H:%M:%S"')"
ssh "$DEVICE" 'systemctl restart plugin_loader'

log=""
for _ in $(seq "$READY_TIMEOUT_SECONDS"); do
  log="$(ssh "$DEVICE" "journalctl -u plugin_loader --since '$since' --no-pager")"
  if printf '%s\n' "$log" | grep -qiE "$FAILURE_MARKER"; then
    printf 'plugin_loader reported a load failure\n' >&2
    printf '%s\n' "$log" >&2
    exit 1
  fi
  if printf '%s\n' "$log" | grep -qF "$LOADED_MARKER"; then
    printf '%s\n' "$log" | grep -i 'perigee'
    printf 'plugin_loader restarted and loaded Perigee cleanly\n'
    exit 0
  fi
  sleep 1
done

printf 'plugin_loader never logged %s within %ss\n' "$LOADED_MARKER" "$READY_TIMEOUT_SECONDS" >&2
printf '%s\n' "$log" >&2
exit 1
