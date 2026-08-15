#!/usr/bin/env bash
#
# Bringt Code und Assets auf die Server — Bau, Live oder beide.
#
#     tools/deploy.sh bau              # nur Editor/Testflug (CT 102)
#     tools/deploy.sh live             # nur Live-Welt (CT 101)
#     tools/deploy.sh beide            # zuerst Bau, dann Live
#     tools/deploy.sh beide --assets   # zusätzlich Modelle und Texturen
#     tools/deploy.sh live --karte     # NUR das Weltdokument (s.u.)
#
# ── Warum es diese Datei gibt ────────────────────────────────────────
# Bis 08/2026 wurde jede Änderung von Hand übertragen: tar schnüren, scp,
# pct push, entpacken, Tests, Build, Neustart. Das ist sechsmal
# gutgegangen und beim siebten Mal vergisst man den Client-Build oder
# erwischt die falsche Datei. Die Container liefen dadurch regelmässig
# auseinander.
#
# ── Was synchron läuft und was nicht ─────────────────────────────────
# Der CODE gehört auf beide Server, die DATEN nicht. Deshalb zwei
# getrennte Wege:
#
#   Code + Assets   automatisch, mit jedem Deploy
#   Weltdokument    NUR mit --karte, ausdrücklich und einzeln
#   Spielstände     NIE (server/data/worlds/ — die gehören dem Server)
#   server.yml      NIE (Weltname, Ports; die Container unterscheiden sich
#                   genau darin: live fährt "vikings", bau fährt "bau")
#
# Die Trennung ist der ganze Punkt: Man will den Editor-Code sofort live
# haben, die im Editor gebaute Welt aber erst dann, wenn sie fertig ist.
# Ein Deploy, das beides mitnimmt, würde jede halbfertige Insel
# veröffentlichen.
#
# ── Zugang ───────────────────────────────────────────────────────────
# Ohne SSH-Schlüssel: `export SSHPASS='…'` setzen, das Skript benutzt
# dann sshpass. Mit Schlüssel läuft es ohne alles.
set -euo pipefail

cd "$(dirname "$0")/.."

HOST="${WOV_HOST:-51.68.155.50}"
CT_BAU=102
CT_LIVE=101

ZIEL="${1:-}"
shift || true
MIT_ASSETS=0
NUR_KARTE=0
for arg in "$@"; do
  case "$arg" in
    --assets) MIT_ASSETS=1 ;;
    --karte)  NUR_KARTE=1 ;;
    *) echo "Unbekannte Option: $arg" >&2; exit 1 ;;
  esac
done

case "$ZIEL" in
  bau|live|beide) ;;
  *) echo "Aufruf: tools/deploy.sh bau|live|beide [--assets] [--karte]" >&2; exit 1 ;;
esac

# ── Fernaufruf: mit Schlüssel oder mit sshpass ───────────────────────
ferne() {
  if [ -n "${SSHPASS:-}" ]; then
    sshpass -e ssh -o StrictHostKeyChecking=no "root@$HOST" "$@"
  else
    ssh -o BatchMode=yes -o StrictHostKeyChecking=no "root@$HOST" "$@"
  fi
}
schieben() {
  if [ -n "${SSHPASS:-}" ]; then
    sshpass -e scp -o StrictHostKeyChecking=no "$1" "root@$HOST:$2"
  else
    scp -o BatchMode=yes -o StrictHostKeyChecking=no "$1" "root@$HOST:$2"
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── Vor dem Übertragen: hier prüfen, nicht dort ──────────────────────
# Ein Deploy, der auf dem Server durchfällt, hinterlässt einen halb
# aktualisierten Container. Typecheck und Tests laufen deshalb ZUERST
# lokal; der Server bekommt nur, was hier schon grün war.
if [ "$NUR_KARTE" = "0" ]; then
  echo "▶ Lokale Prüfung"
  npm run typecheck >/dev/null 2>&1 || { echo "  Typecheck FEHLGESCHLAGEN — nichts übertragen" >&2; exit 1; }
  # EIN Lauf, Ausgabe gemerkt: Zweimal zu testen kostete anderthalb
  # Minuten für dieselbe Antwort.
  if ! npm test >"$TMP/test.log" 2>&1; then
    tail -3 "$TMP/test.log" | sed 's/^/  /'
    echo "  Tests FEHLGESCHLAGEN — nichts übertragen" >&2
    exit 1
  fi
  tail -1 "$TMP/test.log" | sed 's/^/  /'
fi

# ── Pakete schnüren ─────────────────────────────────────────────────
if [ "$NUR_KARTE" = "0" ]; then
  echo "▶ Code-Paket"
  # `tools/` NUR mit den Skripten. Darin liegt `tools/assetripper/` mit
  # den entpackten Valheim-Bundles — 5,1 GB, die auf einem Spielserver
  # nichts zu suchen haben. Beim ersten Lauf ging das Code-Paket dadurch
  # mit 2,7 GB und 39.901 Dateien hinaus statt mit ein paar hundert
  # Kilobyte.
  tar czf "$TMP/code.tar.gz" \
    --exclude='tools/assetripper' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    shared/src shared/test \
    server/src server/test \
    client/src client/*.html client/vite.config.ts \
    scripts tools Docs \
    package.json 2>/dev/null
  echo "  $(tar tzf "$TMP/code.tar.gz" | wc -l) Dateien, $(du -h "$TMP/code.tar.gz" | cut -f1)"

  if [ "$MIT_ASSETS" = "1" ]; then
    echo "▶ Asset-Paket"
    tar czf "$TMP/assets.tar.gz" -C assets models textures sprites audio 2>/dev/null || true
    echo "  $(du -h "$TMP/assets.tar.gz" | cut -f1)"
  fi
fi

if [ "$NUR_KARTE" = "1" ]; then
  echo "▶ Weltdokument"
  cp server/data/worldlayout.json "$TMP/worldlayout.json"
  python3 -c "
import json, collections
d = json.load(open('server/data/worldlayout.json'))
print('  %d Regionen, %d Platzierungen, %d Routen' % (
    len(d['regions']), len(d.get('placements', [])), len(d.get('routes', []))))
print('  Biome:', dict(collections.Counter(r['biome'] for r in d['regions'])))
"
fi

# ── Ein Container ───────────────────────────────────────────────────
aufspielen() {
  local ct="$1" name="$2" bauen="$3"
  echo
  echo "══ $name (CT $ct) ══"

  if [ "$NUR_KARTE" = "1" ]; then
    schieben "$TMP/worldlayout.json" "/tmp/wl-deploy.json"
    ferne "pct push $ct /tmp/wl-deploy.json /tmp/wl-deploy.json; rm -f /tmp/wl-deploy.json"
    ferne "pct exec $ct -- bash -lc '
      cd /opt/worldofvikings
      cp server/data/worldlayout.json server/data/worldlayout.json.\$(date +%Y-%m-%dT%H-%M-%S).bak
      cp /tmp/wl-deploy.json server/data/worldlayout.json && rm -f /tmp/wl-deploy.json
      echo \"  Karte gesetzt, Sicherung daneben\"
    '"
  else
    schieben "$TMP/code.tar.gz" "/tmp/wov-code.tar.gz"
    ferne "pct push $ct /tmp/wov-code.tar.gz /tmp/wov-code.tar.gz; rm -f /tmp/wov-code.tar.gz"
    if [ "$MIT_ASSETS" = "1" ]; then
      schieben "$TMP/assets.tar.gz" "/tmp/wov-assets.tar.gz"
      ferne "pct push $ct /tmp/wov-assets.tar.gz /tmp/wov-assets.tar.gz; rm -f /tmp/wov-assets.tar.gz"
    fi

    # Sicherung des Quellbaums, dann entpacken. Die Karte und die
    # Spielstände liegen unter server/data/ und werden vom Paket gar
    # nicht erst berührt — es enthält nur server/src und server/test.
    ferne "pct exec $ct -- bash -lc '
      set -e
      cd /opt/worldofvikings
      tar czf /tmp/vor-deploy-\$(date +%Y%m%d-%H%M%S).tar.gz shared/src server/src client/src scripts tools 2>/dev/null || true
      tar xzf /tmp/wov-code.tar.gz && rm -f /tmp/wov-code.tar.gz
      if [ -f /tmp/wov-assets.tar.gz ]; then
        cd assets && tar xzf /tmp/wov-assets.tar.gz && cd .. && rm -f /tmp/wov-assets.tar.gz
      fi
      echo \"  entpackt\"
    '"

    echo "  Prüfung im Container:"
    ferne "pct exec $ct -- bash -lc 'cd /opt/worldofvikings && npm run typecheck 2>&1 | tail -1'" | sed 's/^/    /'
    ferne "pct exec $ct -- bash -lc 'cd /opt/worldofvikings && npm test 2>&1 | tail -1'" | sed 's/^/    /'

    if [ "$bauen" = "1" ]; then
      # Live liefert aus client/dist — ohne Build bleibt der alte Stand
      # ausgeliefert, und genau das ist die Falle, die von Hand zweimal
      # fast passiert wäre. Der Bau-Container braucht es nicht (Vite).
      echo "  Client-Build:"
      ferne "pct exec $ct -- bash -lc 'cd /opt/worldofvikings/client && npm run build 2>&1 | tail -1'" | sed 's/^/    /'
    fi
  fi

  ferne "pct exec $ct -- bash -lc 'systemctl restart wov-server; sleep 4; systemctl is-active wov-server'" | sed 's/^/  Server: /'
}

case "$ZIEL" in
  bau)   aufspielen "$CT_BAU"  "Bau / Editor" 0 ;;
  live)  aufspielen "$CT_LIVE" "Live"         1 ;;
  beide) aufspielen "$CT_BAU"  "Bau / Editor" 0
         aufspielen "$CT_LIVE" "Live"         1 ;;
esac

echo
if [ "$NUR_KARTE" = "1" ]; then
  echo "Karte übertragen. Spielstände und server.yml blieben unberührt."
else
  echo "Fertig. Weltdokument, Spielstände und server.yml blieben unberührt —"
  echo "die Karte geht nur mit 'tools/deploy.sh <ziel> --karte' hinüber."
fi
