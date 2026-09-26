#!/usr/bin/env bash
# Welt abnehmen oder verwerfen (K5.7) / Accept or discard the world working copy.
#
# Die Welt liegt zur Laufzeit als Arbeitskopie ausserhalb von Git: WOV_WELT_VERZEICHNIS (absolut; die Units auf
# DEV und live setzen /var/lib/wov/welten), sonst <Wurzel>/server/data/welten-arbeit/<instanz>.json (von Git
# ignoriert). server/data/welten/<instanz>.json im Repo ist der abgenommene Stand. Dieses Skript ist der einzige
# Weg dazwischen; der Betriebsdienst und der Spielserver fassen Git nie an.
#
#   tools/welt-abnehmen.sh <dev|live>             Arbeitskopie -> Repo-Datei (sanitisiert, byte-gleich wie der
#                                                 Betriebsdienst), Diff zeigen. KEIN Commit. Schreibt KEINE Basis:
#                                                 die Basis gleicht sich beim naechsten Start des Spielservers an.
#   tools/welt-abnehmen.sh <dev|live> --commit    dasselbe, danach genau ein Commit nur dieser Datei.
#   tools/welt-abnehmen.sh <dev|live> --verwerfen Arbeitskopie neu aus dem Repo anlegen (die alte wird vorher als
#                                                 <datei>.verworfen-<zeit>.gesichert gesichert, bis zu 50 bleiben;
#                                                 fehlt sie, wird sie angelegt).
#   tools/welt-abnehmen.sh <dev|live> --status    nur pruefen, nichts schreiben: die Zeile WELT_FALL=<fall>
#                                                 (angelegt | nachgezogen | unveraendert | konflikt | repo-kaputt |
#                                                 arbeit-kaputt | ...), WELT_GESCHRIEBEN=nein und die Meldung.
#                                                 Exit immer 0.
#   tools/welt-abnehmen.sh <dev|live> --diff      nur zeigen, nichts schreiben: Repo-Datei gegen Arbeitskopie.
#
# Gedachter Ablauf beim Abnehmen (das DEV-Deployment /opt/worldofvikings wird nie bearbeitet; hier verweigert das
# Skript Abnehmen und --commit):
#   1. Auf DEV:  tools/welt-abnehmen.sh dev --status   und   tools/welt-abnehmen.sh dev --diff
#      Eine Shell auf DEV hat WOV_WELT_VERZEICHNIS nicht (es steht nur in den Units, nie in /etc/wov.env). Das
#      Werkzeug liest die Variable dort aus der Unit (systemctl show -p Environment wov-server). Gelingt das nicht,
#      verweigert es alle Modi mit Exit 2; dann: WOV_WELT_VERZEICHNIS=/var/lib/wov/welten tools/welt-abnehmen.sh dev --status
#   2. Im eigenen Worktree (Branch agent/<agent>/<slug>), die DEV-Arbeitskopie nur LESEND:
#        WOV_WELT_VERZEICHNIS=/var/lib/wov/welten tools/welt-abnehmen.sh dev --commit
#      (uebernimmt die Datei in server/data/welten/dev.json des Worktrees, ein Commit).
#   3. Pull Request, Merge mit Mikes Go. Nach dem Rollout ist Arbeitskopie = Repo, und der naechste Start traegt
#      die Basis nach. Bis dahin bleibt die Bearbeitung liegen: Repo = Basis, ein DEV-Neustart zieht sie nicht zurueck.
#
# Wurde die Welt nach dem Abnehmen weiterbearbeitet, bleibt der Fall "konflikt", bis auch dieser Stand abgenommen
# oder verworfen ist (nichts geht verloren).
#
# Nach --verwerfen den Spielserver neu starten, damit er die neue Welt liest.
set -euo pipefail

WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
usage() { echo "Aufruf: tools/welt-abnehmen.sh <dev|live> [--commit | --verwerfen | --status | --diff]" >&2; exit 2; }

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
    --diff) MODUS="diff" ;;
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
if [ "$MODUS" = "diff" ]; then
  # Gleiche Auflosung des Ordners wie das Werkzeug: die Zeile ARBEITSDATEI= kommt von dort.
  ARBEIT="$("$TSX" tools/welt-abnehmen.ts pfad "$INSTANZ")"
  [ -f "$ARBEIT" ] || { echo "Arbeitskopie fehlt: $ARBEIT (nichts zu vergleichen)."; exit 0; }
  git --no-pager diff --no-index --stat -- "$DATEI" "$ARBEIT" || true
  git --no-pager diff --no-index -- "$DATEI" "$ARBEIT" | head -n 200 || true
  exit 0
fi
"$TSX" tools/welt-abnehmen.ts abnehmen "$INSTANZ"

# Gegen HEAD vergleichen, nicht gegen den Index: eine vorher gestagte Weltdatei sonst als "unveraendert" gemeldet.
if git diff --quiet HEAD -- "$DATEI"; then
  echo "Nichts abzunehmen: $DATEI ist unveraendert gegenueber dem letzten Commit."
  exit 0
fi
git --no-pager diff --stat HEAD -- "$DATEI"
git --no-pager diff HEAD -- "$DATEI" | head -n 200

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
