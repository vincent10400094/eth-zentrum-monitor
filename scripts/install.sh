#!/usr/bin/env bash
# Run on the Odroid H4 (Ubuntu + GNOME), from the repo checkout at ~/monitor.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v node >/dev/null || { echo "Installing node..."; sudo apt update && sudo apt install -y nodejs; }
command -v chromium >/dev/null || command -v chromium-browser >/dev/null || \
  sudo apt install -y chromium-browser || sudo snap install chromium

mkdir -p "$HOME/.config/systemd/user" "$HOME/.config/autostart"
sed "s#%h#$HOME#g" "$HERE/scripts/eth-monitor.service" > "$HOME/.config/systemd/user/eth-monitor.service"
sed "s#\$HOME#$HOME#g" "$HERE/scripts/eth-monitor-kiosk.desktop" > "$HOME/.config/autostart/eth-monitor-kiosk.desktop"

systemctl --user daemon-reload
systemctl --user enable --now eth-monitor.service
loginctl enable-linger "$USER" || true   # keep the server alive across logouts

echo
echo "Server:  systemctl --user status eth-monitor"
echo "Kiosk:   logs out/in to autostart, or run scripts/kiosk.sh now."
