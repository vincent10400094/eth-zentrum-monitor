#!/usr/bin/env bash
# Opens the monitor full screen on the Odroid H4's GNOME session.
set -euo pipefail

URL="${MONITOR_URL:-http://localhost:8080}"
PROFILE="${HOME}/.local/share/eth-monitor-chrome"

# Wait for the local server to answer before launching the browser.
for _ in $(seq 1 60); do
  curl -sf "${URL}/api/health" >/dev/null && break
  sleep 2
done

# Keep GNOME from blanking the wall display.
gsettings set org.gnome.desktop.session idle-delay 0 || true
gsettings set org.gnome.desktop.screensaver lock-enabled false || true
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing' || true

BROWSER="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"
if [[ -z "${BROWSER}" ]]; then
  echo "No Chromium/Chrome found. Install with: sudo apt install -y chromium-browser" >&2
  exit 1
fi

exec "${BROWSER}" \
  --user-data-dir="${PROFILE}" \
  --kiosk "${URL}" \
  --start-fullscreen \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --password-store=basic
