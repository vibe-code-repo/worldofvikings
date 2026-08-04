#!/usr/bin/env bash
# Installiert die systemd-Units für Server und Client.
#
#   sudo deploy/install-services.sh            # installieren + Autostart aktivieren
#   sudo deploy/install-services.sh --no-enable # nur installieren
#
# Danach:
#   systemctl start wov.target    # beides starten
#   systemctl stop wov.target     # beides stoppen
#   journalctl -fu wov-server     # Logs
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_SRC="$PROJECT_DIR/deploy/systemd"
UNIT_DST="/etc/systemd/system"
# Besitzer des Projektverzeichnisses — unter diesem Nutzer laufen die Dienste
RUN_USER="$(stat -c '%U' "$PROJECT_DIR")"

if [[ $EUID -ne 0 ]]; then
  echo "Bitte mit root-Rechten ausführen: sudo $0" >&2
  exit 1
fi

for unit in wov-server.service wov-client.service wov.target; do
  sed -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" \
      -e "s|__USER__|$RUN_USER|g" \
      "$UNIT_SRC/$unit" > "$UNIT_DST/$unit"
  echo "installiert: $UNIT_DST/$unit"
done

systemctl daemon-reload

if [[ "${1:-}" != "--no-enable" ]]; then
  systemctl enable wov.target wov-server.service wov-client.service >/dev/null
  echo "Autostart aktiviert (wov.target)."
fi

cat <<EOF

Fertig. Projekt: $PROJECT_DIR (Nutzer: $RUN_USER)

  systemctl start wov.target     Server + Client starten
  systemctl stop  wov.target     beides stoppen
  systemctl restart wov-server   nur den Game-Server neu starten
  systemctl status wov-client    Status des Vite-Servers
  journalctl -fu wov-server      Server-Logs live
  journalctl -fu wov-client      Client-Logs live

Client:      http://<host>:5273
Game-Server: ws://<host>:2466 (Client proxyt über /ws)
EOF
