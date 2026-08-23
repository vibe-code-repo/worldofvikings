#!/usr/bin/env bash
#
# Baut die Seite auf wov-dev und legt das Ergebnis in CT 103 (wov-web).
#
# Warum von Mikes Arbeitsplatz aus und nicht auf einem Container: Der Build
# braucht `wov-bau` (dort liegt der Quellbaum samt node_modules), das Ausrollen
# braucht `wov-host` (nur der Proxmox-Host kommt per `pct` in CT 103 hinein).
# Beides zusammen hat nur der Arbeitsplatz.
#
#   tools/ausrollen.sh            baut und rollt aus
#   tools/ausrollen.sh --trocken  baut und zeigt nur den Unterschied
set -euo pipefail

BAU=wov-bau
QUELLE=/opt/wov-web
HOST=wov-host
CT=103
ZIEL=/var/www/wov
TROCKEN=${1:-}

echo "→ Quellbaum auf $BAU auffrischen"
rsync -a --delete \
  --exclude node_modules --exclude .svelte-kit --exclude build --exclude .git \
  "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/" "$BAU:$QUELLE/"

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
