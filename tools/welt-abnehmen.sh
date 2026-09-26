#!/usr/bin/env bash
# Welt abnehmen oder verwerfen (K5.7) / Accept or discard the world working copy.
#
# Die Welt liegt zur Laufzeit als Arbeitskopie ausserhalb von Git (WOV_WELT_VERZEICHNIS, sonst
# /var/lib/wov/welten/<instanz>.json). server/data/welten/<instanz>.json im Repo ist der abgenommene
# Stand. Dieses Skript ist der einzige Weg dazwischen; der Betriebsdienst und der Spielserver fassen Git nie an.
#
#   tools/welt-abnehmen.sh <dev|live>             Arbeitskopie -> Repo-Datei (sanitisiert, byte-gleich wie der
#                                                 Betriebsdienst), Basis aktualisieren, Diff zeigen. KEIN Commit.
#   tools/welt-abnehmen.sh <dev|live> --commit    dasselbe, danach genau ein Commit nur dieser Datei.
#   tools/welt-abnehmen.sh <dev|live> --verwerfen Arbeitskopie neu aus dem Repo anlegen (alte gesichert).
#   tools/welt-abnehmen.sh <dev|live> --status    nur prüfen, nichts schreiben: die Zeile WELT_FALL=<fall>
#                                                 (angelegt | nachgezogen | unveraendert | konflikt | ...) und die
#                                                 Meldung, bei einem Konflikt mit der Warnung. Exit immer 0.
#
# Nach --verwerfen den Spielserver neu starten, damit er die neue Welt liest.
set -euo pipefail

WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
usage() { echo "Aufruf: tools/welt-abnehmen.sh <dev|live> [--commit | --verwerfen | --status]" >&2; exit 2; }

[ $# -ge 1 ] && [ $# -le 2 ] || usage
INSTANZ="$1"
case "$INSTANZ" in dev|live) ;; *) usage ;; esac
MODUS="abnehmen"
COMMIT=0
if [ $# -eq 2 ]; then
  case "$2" in
    --commit) COMMIT=1 ;;
    --verwerfen) MODUS="verwerfen" ;;
    --status) MODUS="status" ;;
    *) usage ;;
  esac
fi

cd "$WURZEL"
TSX="$WURZEL/node_modules/.bin/tsx"
[ -x "$TSX" ] || { echo "FEHLER: $TSX fehlt (npm ci)." >&2; exit 1; }

if [ "$MODUS" = "status" ]; then
  exec "$TSX" tools/welt-abnehmen.ts pruefen "$INSTANZ"
fi
if [ "$MODUS" = "verwerfen" ]; then
  exec "$TSX" tools/welt-abnehmen.ts verwerfen "$INSTANZ"
fi

DATEI="server/data/welten/$INSTANZ.json"
"$TSX" tools/welt-abnehmen.ts abnehmen "$INSTANZ"

if git diff --quiet -- "$DATEI"; then
  echo "Nichts abzunehmen: $DATEI ist unveraendert gegenueber dem letzten Commit."
  exit 0
fi
git --no-pager diff --stat -- "$DATEI"
git --no-pager diff -- "$DATEI" | head -n 200

if [ "$COMMIT" != "1" ]; then
  echo "Kein Commit (Option --commit fehlt). Die Datei liegt geaendert im Arbeitsbaum."
  exit 0
fi

MSG="$(mktemp "${TMPDIR:-/tmp}/welt-abnehmen-XXXXXX")"
trap 'rm -f "$MSG"' EXIT
{
  echo "Accept world $INSTANZ from the working copy / Welt $INSTANZ aus der Arbeitskopie abgenommen"
  echo
  echo "The working copy of the world ($INSTANZ) was accepted into server/data/welten/$INSTANZ.json (sanitized,"
  echo "byte-identical to the operations service)."
  echo
  echo "Die Arbeitskopie der Welt ($INSTANZ) wurde in server/data/welten/$INSTANZ.json abgenommen (sanitisiert,"
  echo "byte-gleich wie im Betriebsdienst)."
} > "$MSG"
git add -- "$DATEI"
git commit -F "$MSG" -- "$DATEI"
