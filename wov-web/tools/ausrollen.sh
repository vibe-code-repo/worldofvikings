#!/usr/bin/env bash
#
# Baut die Seite.
#
# ── Seit dem Ein-Ursprung-Container (Bauer "Ein Ursprung im Container",
# 12.09.2026) ────────────────────────────────────────────────────────
# wov-lab braucht KEIN Ausrollen mehr im alten Sinn: Der Container ist
# der Bauort UND der Auslieferort zugleich (tools/wov-update.sh baut
# `wov-web` dort, wo `git pull` den Quellbaum ohnehin hinlegt).
#
# ── Geaendert mit "Das Thing" (16.09.2026) ─────────────────────────────
# Die Seite laeuft jetzt mit adapter-node: `npm run build` erzeugt
# `build/index.js` (den Dienst) neben `build/client/` (Buendel, Assets,
# statische Daten) und `build/prerendered/` (die vorgerenderten Seiten).
# nginx zeigt deshalb NICHT mehr auf `build` als Dateien, sondern reicht
# `/` an `wov-web.service` weiter (deploy/nginx/wov-lab.conf); die
# gehashten Buendel und `/assets/` liefert nginx weiter direkt aus
# `build/client`. Der Vorgabeweg unten baut deshalb NUR NOCH LOKAL und
# kopiert nichts: es gibt keinen zweiten Ort mehr, an den zu kopieren
# waere. Nach dem Bau muss der Dienst neu starten, damit er den neuen
# Baum liest — das tut tools/wov-update.sh (Dienste-Reigen).
#
#   tools/ausrollen.sh             baut lokal (wov-lab, Vorgabe)
#
# ── Der alte Weg, fuer CT 103 (wov-live-Aussenauftritt) ────────────────
# Der bisherige Container bleibt getrennt vom Spiel — die Seite dort
# liegt unter `/var/www/wov`, nicht neben einem laufenden nginx, der
# schon auf `wov-web/build` zeigt. Fuer GENAU DIESEN Fall bleibt der
# alte rsync/ssh/pct-Weg erhalten, jetzt hinter `--fern`:
#
#   tools/ausrollen.sh --fern            baut auf wov-bau, rollt nach CT 103
#   tools/ausrollen.sh --fern --trocken  baut und zeigt nur den Unterschied
#
# Seit dem 23.08.2026 liegt die Seite IM Spiel-Repo (wov-web/). Client und
# Seite teilen sich die Ticket-Uebergabe im Adressfragment, den optionalen
# Zeitparameter sowie die Aussehensdaten fuer die Charaktererstellung.
# Getrennte Repos machten aus jeder solchen Aenderung zwei Commits, die
# niemand zusammen zuruecknehmen kann.
set -euo pipefail

WOV_WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" != "--fern" ]]; then
  # ── Lokal (wov-lab, Vorgabe) ─────────────────────────────────────────
  echo "→ bauen"
  (cd "$WOV_WEB" && npm run build)

  echo "→ ohne JavaScript lesbar?"
  (cd "$WOV_WEB" && bash tools/ohne-js-pruefen.sh)

  # Derselbe Syntax-Check wie im fernen Weg, an der AUSGELIEFERTEN Datei:
  # Am 22.08. ging eine erstellen.js mit Syntaxfehler hinaus, und ein
  # nicht parsebares Modul laeuft gar nicht — die Seite blieb stumm
  # stehen, ohne Fehlermeldung.
  echo "→ Skripte parsebar?"
  (cd "$WOV_WEB/build" && find . -name '*.js' -exec node --check {} \; && echo '  alle ok')

  echo "fertig. wov-web.service liest $WOV_WEB/build; nginx (deploy/nginx/wov-lab.conf)"
  echo "reicht / an den Dienst weiter, die Buendel unter build/client liefert es direkt."
  echo "Damit der Dienst den neuen Baum liest, danach: sudo systemctl restart wov-web"
  exit 0
fi

# ── Fern (CT 103, alter Weg) ───────────────────────────────────────────
shift
BAU=wov-bau
QUELLE=/opt/worldofvikings/wov-web
HOST=wov-host
CT=103
ZIEL=/var/www/wov
TROCKEN=${1:-}

echo "→ Quellbaum auf $BAU auffrischen"
rsync -a --delete \
  --exclude node_modules --exclude .svelte-kit --exclude build --exclude .git \
  "$WOV_WEB/" "$BAU:$QUELLE/"

echo "→ bauen"
ssh "$BAU" "cd $QUELLE && npm run build"

echo "→ ohne JavaScript lesbar?"
ssh "$BAU" "cd $QUELLE && bash tools/ohne-js-pruefen.sh"

# Der Syntax-Check an der AUSGELIEFERTEN Datei, nicht an der lokalen: Am 22.08.
# ging eine erstellen.js mit Syntaxfehler hinaus, und ein nicht parsebares
# Modul laeuft gar nicht — die Seite blieb stumm stehen, ohne Fehlermeldung.
echo "→ Skripte parsebar?"
ssh "$BAU" "cd $QUELLE/build && find . -name '*.js' -exec node --check {} \; && echo '  alle ok'"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "→ Ergebnis holen"
rsync -a "$BAU:$QUELLE/build/" "$TMP/build/"

if [[ "$TROCKEN" == "--trocken" ]]; then
  echo "→ Unterschied zum jetzigen Stand (nichts wird geschrieben):"
  ssh "$HOST" "pct exec $CT -- tar -C $ZIEL -cf - ." > "$TMP/jetzt.tar"
  mkdir -p "$TMP/jetzt" && tar -C "$TMP/jetzt" -xf "$TMP/jetzt.tar"
  diff -rq "$TMP/jetzt" "$TMP/build" || true
  exit 0
fi

STEMPEL=$(date +%Y-%m-%d-%H%M)
echo "→ Sicherung: $ZIEL.vorher.$STEMPEL"
ssh "$HOST" "pct exec $CT -- cp -a $ZIEL $ZIEL.vorher.$STEMPEL"

echo "→ ausrollen"
# Erst leeren, dann einspielen: Ein additives Auspacken laesst Dateien liegen,
# die es im neuen Stand nicht mehr gibt — genau so ueberlebt eine alte
# JavaScript-Datei ihren Aufrufer und wird zur Fehlersuche von morgen.
ssh "$HOST" "pct exec $CT -- find $ZIEL -mindepth 1 -delete"
tar -C "$TMP/build" -cf - . | ssh "$HOST" "pct exec $CT -- tar -C $ZIEL -xf -"

echo "→ nachmessen"
for p in / /saga /karte /ruestkammer /ruhmeshalle /thing /erstellen /sitemap.xml /robots.txt; do
  code=$(ssh "$HOST" "curl -s -o /dev/null -w '%{http_code}' http://10.10.10.13$p")
  printf '   %-16s %s\n' "$p" "$code"
done

echo "fertig. Sicherung liegt in $ZIEL.vorher.$STEMPEL"
