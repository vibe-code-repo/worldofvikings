#!/usr/bin/env bash
# Installiert die systemd-Units dieses Containers.
#
#   sudo deploy/install-services.sh             # installieren + Autostart aktivieren
#   sudo deploy/install-services.sh --no-enable # nur installieren
#
# Danach:
#   systemctl start wov.target    # Server + Client starten
#   systemctl stop wov.target     # beides stoppen
#   journalctl -fu wov-server     # Logs
#
# ── Was sich mit Block A geändert hat ────────────────────────────────
# Es gibt genau DREI Dienste — wov-server, wov-client, wov-admin — und sie
# sind auf dev und live Zeichen für Zeichen identisch. Der Unterschied
# zwischen den Containern steckt allein in /etc/wov.env, das alle drei per
# EnvironmentFile= lesen. Deshalb ersetzt dieses Skript die Units bei jedem
# Lauf, /etc/wov.env aber NIE: die Units gehören dem Code, die Umgebung
# gehört dem Container.
#
# wov-firewall.service ist entfallen. Die Regeln liegen als
# deploy/firewall-rules.v4/.v6 vor und werden von netfilter-persistent
# geladen; eine eigene Unit, die beim Start dasselbe noch einmal tat, war
# eine zweite Wahrheit. Eine früher installierte Unit räumt dieses Skript
# unten weg — sonst bliebe sie enabled liegen und niemand fände sie wieder.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_SRC="$PROJECT_DIR/deploy/systemd"
UNIT_DST="/etc/systemd/system"
ENV_DATEI="/etc/wov.env"
ENV_VORLAGE="$PROJECT_DIR/deploy/wov.env.beispiel"

DIENSTE=(wov-server.service wov-client.service wov-admin.service)
# wov-karten ist ein oneshot mit Timer, kein Dauerdienst — deshalb nicht in
# DIENSTE, aber sehr wohl in UNITS: Die Dateien gehoeren dem Code und werden
# auf beiden Containern abgelegt. Aktiviert wird der Timer nur auf dev
# (Begruendung unten beim Autostart).
UNITS=("${DIENSTE[@]}" wov.target wov-karten.service wov-karten.timer)

if [[ $EUID -ne 0 ]]; then
  echo "Bitte mit root-Rechten ausführen: sudo $0" >&2
  exit 1
fi

# Die Units tragen den Projektpfad ausgeschrieben (ExecStart,
# WorkingDirectory, Documentation). Früher stand dort ein Platzhalter, den
# dieses Skript per sed ersetzte; das ist mit Block A weggefallen, weil ein
# Pfad, der auf beiden Containern gleich ist, in der Unit stehen darf und
# dort auch lesbar bleibt. Der Preis: Wer das Projekt woanders auspackt,
# bekommt Units, die ins Leere zeigen. Also hier prüfen statt später raten.
ERWARTET="/opt/worldofvikings"
if [[ "$PROJECT_DIR" != "$ERWARTET" ]]; then
  echo "ABBRUCH: Das Projekt liegt in $PROJECT_DIR, die Units in $UNIT_SRC" >&2
  echo "verweisen aber fest auf $ERWARTET." >&2
  echo "Entweder das Projekt nach $ERWARTET legen oder die Units anpassen." >&2
  exit 1
fi

# ── /etc/wov.env ─────────────────────────────────────────────────────
# Wird angelegt, wenn sie fehlt, und sonst in Ruhe gelassen. Sie ist die
# einzige Stelle, an der dev und live sich unterscheiden — sie zu
# überschreiben hieße, einen live-Container beim nächsten Lauf auf dev
# umzustellen, und das fällt erst auf, wenn der falsche Spielstand geladen ist.
if [[ -f "$ENV_DATEI" ]]; then
  echo "vorhanden, unverändert: $ENV_DATEI (WOV_INSTANZ=$(grep -m1 '^WOV_INSTANZ=' "$ENV_DATEI" | cut -d= -f2))"
else
  install -m 0640 "$ENV_VORLAGE" "$ENV_DATEI"
  echo "ANGELEGT aus Vorlage: $ENV_DATEI"
  NEUE_ENV=1
fi

# ── Units ────────────────────────────────────────────────────────────
for unit in "${UNITS[@]}"; do
  install -m 0644 "$UNIT_SRC/$unit" "$UNIT_DST/$unit"
  echo "installiert: $UNIT_DST/$unit"
done

# Altlast aus der Zeit vor Block A. enabled bleibt sie sonst für immer, und
# ein fehlendes Unit-File macht daraus bei jedem daemon-reload eine Warnung.
if [[ -e "$UNIT_DST/wov-firewall.service" ]]; then
  systemctl disable --now wov-firewall.service >/dev/null 2>&1 || true
  rm -f "$UNIT_DST/wov-firewall.service"
  echo "entfernt: $UNIT_DST/wov-firewall.service (entfallen, siehe deploy/README-firewall.md)"
fi

systemctl daemon-reload

# ── nginx: der eine Ursprung (Bauer "Ein Ursprung im Container", 12.09.2026) ──
# deploy/nginx/wov-lab.conf verteilt / (Webseite), /play/ (Client),
# /editor/, /api/accounts/ (Konten-API) und /api/ (Betriebsdienst) hinter
# EINEM Port — Begründung und Wegeliste im Kopf dieser Datei,
# Einhängeschritte in deploy/nginx/README.md.
#
# Fehlt nginx (frischer Container), wird hier NICHT installiert (apt
# gehört dem Betreiber, nicht diesem Skript, s. deploy/nginx/README.md)
# — nur ein Hinweis, damit der fehlende Ursprung nicht stillschweigend
# unbemerkt bleibt.
NGINX_SITE=/etc/nginx/sites-available/wov-lab
if command -v nginx >/dev/null 2>&1; then
  ln -sfn "$PROJECT_DIR/deploy/nginx/wov-lab.conf" "$NGINX_SITE"
  ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/wov-lab
  echo "verlinkt: $NGINX_SITE"
  if [[ ! -f /etc/nginx/wov-admin-token.conf ]]; then
    echo "FEHLT NOCH: /etc/nginx/wov-admin-token.conf (Anleitung in deploy/nginx/README.md) — /api/ bleibt bis dahin ein Startfehler."
  else
    nginx -t && systemctl reload nginx && echo "nginx neu geladen."
  fi
else
  echo "HINWEIS: nginx ist nicht installiert — 'apt install nginx' und danach"
  echo "         dieses Skript erneut ausführen, oder von Hand gemäß"
  echo "         deploy/nginx/README.md einhängen."
fi

# ── Webseite bauen ───────────────────────────────────────────────────
# nginx liefert / aus wov-web/build — ohne einen ersten Build stünde dort
# nichts, sobald die Site verlinkt ist. tools/wov-update.sh hält das bei
# jedem künftigen Pull nach; hier ist es der EINMALIGE erste Bau.
if [[ -d "$PROJECT_DIR/wov-web" ]]; then
  echo "→ Webseite bauen (wov-web)"
  (cd "$PROJECT_DIR/wov-web" && npm ci --include=dev && bash tools/ausrollen.sh) || \
    echo "FEHLGESCHLAGEN: Webseite nicht gebaut — 'wov-web/tools/ausrollen.sh' von Hand nachholen."
fi

# ── Autostart ────────────────────────────────────────────────────────
if [[ "${1:-}" != "--no-enable" ]]; then
  INSTANZ="$(grep -m1 '^WOV_INSTANZ=' "$ENV_DATEI" | cut -d= -f2 || true)"
  # wov-client ist der Vite-Dev-Server. Auf live liefert nginx den gebauten
  # Client aus client/dist aus; ein zweiter Server, der dieselbe Anwendung
  # aus den Quellen ausliefert, wäre dort ein offener Nebeneingang. Die Unit
  # wird trotzdem installiert (sie ist auf beiden Containern dieselbe
  # Datei) — nur eben nicht aktiviert.
  ZU_AKTIVIEREN=(wov.target wov-server.service wov-admin.service)
  if [[ "$INSTANZ" == "dev" ]]; then
    ZU_AKTIVIEREN+=(wov-client.service)
    # Der Kartenlauf rendert BEIDE Instanzen aus den beiden Weltdateien, die
    # nur hier nebeneinander im Arbeitsbaum liegen (dev.json ist das
    # Original, live.json die committete Kopie, die live zieht). Auf live
    # waere derselbe Lauf dieselbe Rechnung ueber dieselben Dokumente — und
    # brauchte einen zweiten Schluessel nach wov-web.
    ZU_AKTIVIEREN+=(wov-karten.timer)
  else
    systemctl disable wov-client.service >/dev/null 2>&1 || true
    echo "nicht aktiviert (Instanz '$INSTANZ'): wov-client.service"
    systemctl disable wov-karten.timer >/dev/null 2>&1 || true
    echo "nicht aktiviert (Instanz '$INSTANZ'): wov-karten.timer"
  fi
  systemctl enable "${ZU_AKTIVIEREN[@]}" >/dev/null
  echo "Autostart aktiviert: ${ZU_AKTIVIEREN[*]}"
fi

cat <<EOF

Fertig. Projekt: $PROJECT_DIR

  systemctl start wov.target     Server + Client starten
  systemctl stop  wov.target     beides stoppen
  systemctl restart wov-server   nur den Spielserver neu starten
  systemctl status wov-admin     Status des Betriebsdienstes
  journalctl -fu wov-server      Server-Logs live

  sudo tools/wov-update.sh       Container auf den Stand von origin/main bringen

Ein Ursprung (nginx, Port 80 — deploy/nginx/wov-lab.conf):
  http://<host>/            Webseite (wov-web)
  http://<host>/play/       Spiel-Client
  http://<host>/editor/     Editor
  http://<host>/api/accounts/  Konten-API
  http://<host>/api/           Betriebsdienst
  ws://<host>/ws                Spielserver

Direkt, ohne nginx (zum Nachmessen, nicht die Aussenadresse):
Client (dev):  http://<host>:5274
Spielserver:   ws://<host>:2467
Betriebsdienst: http://<WOV_ADMIN_ADRESSE>:<WOV_ADMIN_PORT>/status
                (Token aus /etc/wov-admin.token als Kopf x-wov-token)
EOF

if [[ "${NEUE_ENV:-}" == "1" ]]; then
  cat <<EOF

ACHTUNG: $ENV_DATEI wurde eben erst aus der Vorlage angelegt und steht
damit auf WOV_INSTANZ=dev. Auf einem live-Container jetzt bearbeiten —
WOV_INSTANZ=live, WOV_WATCH leer, NODE_ENV=production — und danach
diesen Aufruf wiederholen, damit der Autostart dazu passt.
EOF
fi
