#!/usr/bin/env bash
# Run the deployed CLI harness against the device's real Moonlight config.
# The device profile comes from the Makefile (DEVICE_* variables).
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${DEVICE:?set DEVICE to the ssh host of the Decky device}"
: "${PLUGIN_DIR:?set PLUGIN_DIR to the plugin directory on the device}"
: "${MOONLIGHT_CONF:?set MOONLIGHT_CONF to Moonlight.conf on the device}"
: "${ONLINE_UUID:?set ONLINE_UUID to a host expected to answer}"
: "${STALE_UUID:?set STALE_UUID to a host expected to be a stale pairing}"
: "${PLUGIN_SETTINGS_DIR:?set PLUGIN_SETTINGS_DIR to the plugin settings directory}"
: "${SHORTCUTS_VDF:?set SHORTCUTS_VDF to Steam's shortcuts.vdf on the device}"
: "${DISPLAY_MAX_REFRESH_HZ:?set DISPLAY_MAX_REFRESH_HZ to the attached display's peak refresh rate}"

# Opt in when a sync is known to have run, so a device with no Perigee shortcuts fails
# instead of quietly having nothing to check.
require_shortcuts=""
if [[ -n "${VERIFY_REQUIRE_SHORTCUTS:-}" ]]; then
  require_shortcuts="--require-shortcuts"
fi

work_dir="$(ssh "$DEVICE" 'mktemp -d /tmp/perigee-verify.XXXXXX')"
trap 'ssh "$DEVICE" "rm -rf \"$work_dir\""' EXIT INT TERM

scp -q "$repo/scripts/device_verification.py" "$DEVICE:$work_dir/device_verification.py"
ssh "$DEVICE" "PYTHONPATH='$PLUGIN_DIR/py_modules' python3 '$work_dir/device_verification.py' \
  --plugin-dir '$PLUGIN_DIR' \
  --conf '$MOONLIGHT_CONF' \
  --work-dir '$work_dir' \
  --online-uuid '$ONLINE_UUID' \
  --stale-uuid '$STALE_UUID' \
  --plugin-settings-dir '$PLUGIN_SETTINGS_DIR' \
  --shortcuts-vdf '$SHORTCUTS_VDF' \
  --display-max-refresh-hz '$DISPLAY_MAX_REFRESH_HZ' \
  $require_shortcuts"
