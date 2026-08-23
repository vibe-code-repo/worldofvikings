#!/usr/bin/env bash
#
# wov-sicherung.sh — sichert Spielstand und Weltdokumente EINER Instanz.
#
#     tools/wov-sicherung.sh
#
# Anlass: server/data/worlds/<instanz>.db.zst hat als einzige Rotation eine
# .prev-Datei im SELBEN Verzeichnis (WorldManager.save/saveAsync, s.u.). Ein
# Plattenfehler auf wov-dev nimmt beide mit — 16 MB, rund 250.000 ZDOs,
# Mikes gewachsener Spielstand. Dieses Skript legt eine zweite, datierte
# Kopie an.
#
# INSTANZ kommt aus /etc/wov.env (WOV_INSTANZ), nicht als Parameter: ein
# Aufruf mit "--instanz live" von Hand vertippt wäre auf einem
# Nicht-live-Container ein Sicherungslauf, der nichts sichert (Datei fehlt
# einfach) oder — schlimmer, auf dem falschen Container ausgeführt — den
# falschen Spielstand sichert, ohne dass es auffiele.
#
# ── Warum `cp` für .db.zst sicher ist, für .db.zst.prev aber NICHT ────────
# WorldManager.save() und saveAsync() (server/src/world/WorldManager.ts,
# nachgelesen 21.08.2026) schreiben die HAUPTDATEI <instanz>.db.zst nach
# <instanz>.db.zst.tmp und benennen die tmp-Datei erst danach per
# renameSync()/rename() auf den endgültigen Namen um. rename() innerhalb
# desselben Dateisystems ist atomar: Ein `cp`, das mitten in diesem Vorgang
# liest, bekommt entweder vollständig die alte Datei oder vollständig die
# neue — nie eine angerissene. Deshalb ist ein einfaches `cp` der Hauptdatei
# jederzeit sicher, auch während der Server läuft.
#
# Die Rotation nach .prev ist etwas ANDERES: Sie läuft VOR diesem tmp+rename
# und schreibt per copyFileSync()/copyFile() DIREKT auf die Zieldatei .prev —
# kein .tmp, kein rename, also NICHT atomar. Trifft dieses Skript genau in
# dieses Kopierfenster (Saves laufen alle 30 Minuten, das Fenster selbst
# dauert für 16 MB Sekundenbruchteile), kann die gesicherte .prev angerissen
# sein. Das wird hier nicht angenommen, sondern geprüft: Nach dem Kopieren
# läuft `zstd -t` über beide .db.zst-Dateien; schlägt sie fehl, wird die
# Kopie wiederholt (ZSTD_VERSUCHE unten). Ein zweiter Versuch trifft das
# seltene Fenster praktisch nie zweimal hintereinander.
#
# server/data/welten/<instanz>.json wird nach demselben tmp+rename-Muster
# geschrieben (shared/src/worldlayout/layoutDatei.ts) — ein `cp` ist dort aus
# demselben Grund sicher. server/data/server.yml wird selten und von Hand
# bzw. vom Betriebsdienst geändert, nicht im 30-Minuten-Takt; hier genügt
# ein einfaches `cp`, geprüft wird trotzdem (Datei muss nach dem Kopieren
# denselben Byte-Umfang haben wie die Quelle in diesem Moment).
#
# ── ZIEL: lokal, NICHT ausser Haus ─────────────────────────────────────
# Dieses Skript läuft nur auf wov-dev (CT101, siehe Roadmap "weg von
# CT101") und kann von sich aus keinen anderen Host erreichen, den es nicht
# kennt. ZIEL unten ist deshalb eine VARIABLE, die auf ein lokales
# Verzeichnis zeigt — besser als gar keine zweite Kopie, aber bei einem
# Totalausfall des Containers oder seiner Platte ist auch diese Kopie weg.
#
# Um wirklich vom Container wegzukommen, muss Mike:
#   1. Auf dem Zielhost (Proxmox-Host, NAS, ein zweiter Container) ein
#      Sicherungsverzeichnis und einen eigenen SSH-Schlüssel für einen
#      möglichst eingeschränkten Nutzer einrichten (kein root-Login nötig —
#      der Nutzer braucht nur Schreibrecht in seinem Sicherungsordner).
#   2. Den privaten Schlüssel auf wov-dev ablegen, z.B. unter
#      /root/.ssh/wov-sicherung (chmod 600), und den öffentlichen Teil beim
#      Zielhost eintragen.
#   3. ZIEL unten NICHT mehr als lokalen Pfad, sondern als rsync-Ziel lesen
#      und den Kopierblock (Abschnitt "Kopieren") von `cp -a` auf rsync
#      umstellen, etwa:
#        ZIEL_SSH="mike@backup-host:/srv/backup/wov/welten"
#        rsync -a -e "ssh -i /root/.ssh/wov-sicherung" \
#          "$LAUF_ORDNER/" "$ZIEL_SSH/$INSTANZ/$STEMPEL/"
#      Die Prüfung (zstd -t, JSON-Parse, Grössenvergleich) davor bleibt
#      unverändert; sie soll auf der LOKALEN Kopie laufen, bevor die Bytes
#      ein zweites Mal über das Netz gehen.
#   4. Bis Schritt 1–3 erledigt sind, bleibt es bei der lokalen Kopie unter
#      $ZIEL — das ist ehrlich, aber kein Ersatz für "ausser Haus".

set -euo pipefail

WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATEN="$WURZEL/server/data"

# ── 1. Instanz feststellen ─────────────────────────────────────────────
ENV_DATEI=/etc/wov.env
if [[ ! -r "$ENV_DATEI" ]]; then
  echo "ABBRUCH: $ENV_DATEI nicht lesbar — ohne sie ist die Instanz nicht" >&2
  echo "bestimmbar, und genau das soll hier NICHT geraten werden." >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
. "$ENV_DATEI"
set +a
INSTANZ="${WOV_INSTANZ:-}"
case "$INSTANZ" in
  dev|live) ;;
  *)
    echo "ABBRUCH: WOV_INSTANZ in $ENV_DATEI ist '$INSTANZ' — erwartet 'dev' oder 'live'." >&2
    exit 1
    ;;
esac

# ── Einstellungen ───────────────────────────────────────────────────────
# Lokales Ziel, s. Kopfkommentar für den Weg nach ausser Haus.
ZIEL="${WOV_SICHERUNG_ZIEL:-/var/backups/wov/welten}"
VORHALTETAGE=14
# Reserve, die nach der Sicherung noch frei bleiben soll — darunter wird
# abgebrochen statt die Platte zu füllen und den laufenden Server zu
# gefährden.
MINDEST_FREI_MB=1024
ZSTD_VERSUCHE=5

DB_DATEI="$DATEN/worlds/$INSTANZ.db.zst"
PREV_DATEI="$DB_DATEI.prev"
WELT_DATEI="$DATEN/welten/$INSTANZ.json"
DUNGEON_ORDNER="$DATEN/dungeons/$INSTANZ"
SERVER_YML="$DATEN/server.yml"

if [[ ! -f "$DB_DATEI" ]]; then
  echo "ABBRUCH: $DB_DATEI fehlt — nichts zu sichern für Instanz '$INSTANZ'." >&2
  exit 1
fi

STEMPEL="$(date +%Y-%m-%dT%H-%M-%S)"
LAUF_ORDNER="$ZIEL/$INSTANZ/$STEMPEL"

echo "══ World of Vikings — Sicherung ($INSTANZ) ══"
echo "  Quelle: $DATEN"
echo "  Ziel:   $LAUF_ORDNER"

# ── 2. Freien Platz prüfen, BEVOR irgendetwas kopiert wird ─────────────
QUELL_PFADE=("$DB_DATEI" "$WELT_DATEI" "$SERVER_YML")
[[ -f "$PREV_DATEI" ]] && QUELL_PFADE+=("$PREV_DATEI")
[[ -d "$DUNGEON_ORDNER" ]] && QUELL_PFADE+=("$DUNGEON_ORDNER")

BENOETIGT_KB="$(du -sk --apparent-size "${QUELL_PFADE[@]}" 2>/dev/null | awk '{s+=$1} END{print s+0}')"

# Nächster existierender Vorfahr von ZIEL — df braucht ein vorhandenes
# Verzeichnis, und $ZIEL/$INSTANZ/$STEMPEL existiert beim ersten Lauf noch
# nicht.
ZIEL_PRUEF="$ZIEL"
while [[ ! -d "$ZIEL_PRUEF" ]]; do
  ZIEL_PRUEF="$(dirname "$ZIEL_PRUEF")"
done
FREI_KB="$(df -Pk "$ZIEL_PRUEF" | awk 'NR==2{print $4}')"
MINDEST_FREI_KB=$((MINDEST_FREI_MB * 1024))

echo "  Benötigt: ${BENOETIGT_KB} KB, frei auf $ZIEL_PRUEF: ${FREI_KB} KB (Reserve: ${MINDEST_FREI_KB} KB)"

if (( FREI_KB < BENOETIGT_KB + MINDEST_FREI_KB )); then
  echo "ABBRUCH: zu wenig Platz auf $ZIEL_PRUEF für diese Sicherung." >&2
  echo "  Es wurde NICHTS geschrieben. Erst Platz schaffen oder VORHALTETAGE senken." >&2
  exit 1
fi

mkdir -p "$LAUF_ORDNER/worlds" "$LAUF_ORDNER/welten"

# ── 3. Kopieren ──────────────────────────────────────────────────────────
# kopiere_mit_pruefung: kopiert eine zstd-komprimierte Datei und prüft die
# Kopie mit `zstd -t` (Integritätsprüfung über die im Format eingebaute
# Prüfsumme). Schlägt das fehl, wird erneut kopiert — s. Kopfkommentar zur
# NICHT-atomaren .prev-Rotation, die dieser Test auffangen soll.
kopiere_mit_pruefung() {
  local quelle="$1" ziel="$2" versuch
  for ((versuch = 1; versuch <= ZSTD_VERSUCHE; versuch++)); do
    cp -a "$quelle" "$ziel"
    if zstd -t "$ziel" -q 2>/dev/null; then
      return 0
    fi
    echo "  … $ziel nach dem Kopieren unvollständig (Versuch $versuch/$ZSTD_VERSUCHE), erneut" >&2
    sleep 1
  done
  echo "FEHLER: $quelle liess sich nach $ZSTD_VERSUCHE Versuchen nicht sauber kopieren" >&2
  echo "  (vermutlich traf jeder Versuch mitten in eine laufende .prev-Rotation —" >&2
  echo "   das wäre ungewöhnliches Pech, kein Normalfall)." >&2
  return 1
}

echo "  kopiere $DB_DATEI"
kopiere_mit_pruefung "$DB_DATEI" "$LAUF_ORDNER/worlds/$INSTANZ.db.zst"

if [[ -f "$PREV_DATEI" ]]; then
  echo "  kopiere $PREV_DATEI"
  kopiere_mit_pruefung "$PREV_DATEI" "$LAUF_ORDNER/worlds/$INSTANZ.db.zst.prev"
else
  echo "  … keine .prev vorhanden (erster Save seit Anlegen der Welt?), übersprungen"
fi

echo "  kopiere $WELT_DATEI"
cp -a "$WELT_DATEI" "$LAUF_ORDNER/welten/$INSTANZ.json"

if [[ -d "$DUNGEON_ORDNER" ]]; then
  echo "  kopiere $DUNGEON_ORDNER"
  cp -a "$DUNGEON_ORDNER" "$LAUF_ORDNER/dungeons"
else
  echo "  … kein Dungeon-Ordner für '$INSTANZ', übersprungen"
fi

echo "  kopiere $SERVER_YML"
cp -a "$SERVER_YML" "$LAUF_ORDNER/server.yml"

# ── 4. Nachweis: vollständig UND entpackbar ──────────────────────────────
# Grössenvergleich zuerst (billig, fängt grobe Fehler), dann die
# inhaltliche Prüfung (JSON muss parsen, zstd muss sich testen lassen).
FEHLER=0

pruef_groesse() {
  local quelle="$1" ziel="$2"
  local gq gz
  gq="$(stat -c%s "$quelle")"
  gz="$(stat -c%s "$ziel")"
  if [[ "$gq" != "$gz" ]]; then
    echo "FEHLER: Grösse weicht ab — $ziel: ${gz} B, Quelle $quelle: ${gq} B" >&2
    FEHLER=1
  fi
}

pruef_json() {
  local datei="$1"
  if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$datei" 2>/dev/null; then
    echo "FEHLER: $datei ist kein gültiges JSON" >&2
    FEHLER=1
  fi
}

pruef_groesse "$DB_DATEI" "$LAUF_ORDNER/worlds/$INSTANZ.db.zst"
zstd -t "$LAUF_ORDNER/worlds/$INSTANZ.db.zst" -q || { echo "FEHLER: Hauptsicherung besteht zstd -t nicht" >&2; FEHLER=1; }

if [[ -f "$PREV_DATEI" ]]; then
  pruef_groesse "$PREV_DATEI" "$LAUF_ORDNER/worlds/$INSTANZ.db.zst.prev"
  zstd -t "$LAUF_ORDNER/worlds/$INSTANZ.db.zst.prev" -q || { echo "FEHLER: .prev-Sicherung besteht zstd -t nicht" >&2; FEHLER=1; }
fi

pruef_groesse "$WELT_DATEI" "$LAUF_ORDNER/welten/$INSTANZ.json"
pruef_json "$LAUF_ORDNER/welten/$INSTANZ.json"

if [[ -d "$DUNGEON_ORDNER" ]]; then
  while IFS= read -r -d '' datei; do
    pruef_json "$datei"
  done < <(find "$LAUF_ORDNER/dungeons" -name '*.json' -print0)
fi

pruef_groesse "$SERVER_YML" "$LAUF_ORDNER/server.yml"

if (( FEHLER != 0 )); then
  echo "ABBRUCH: die Sicherung unter $LAUF_ORDNER ist NICHT vollständig — sie bleibt" >&2
  echo "liegen für die Fehlersuche, zählt aber nicht als gültiger Lauf." >&2
  exit 1
fi

echo "  ✓ Sicherung vollständig und geprüft: $LAUF_ORDNER"

# ── 5. Alte Läufe abräumen — ERST nachdem der neue Lauf steht ───────────
# In dieser Reihenfolge fällt bei einem Fehlschlag oben (exit 1) kein
# einziger alter, guter Lauf weg.
ALT_ORDNER="$ZIEL/$INSTANZ"
if [[ -d "$ALT_ORDNER" ]]; then
  while IFS= read -r -d '' alt; do
    echo "  räume ab (älter als ${VORHALTETAGE}d): $alt"
    rm -rf "$alt"
  done < <(find "$ALT_ORDNER" -mindepth 1 -maxdepth 1 -type d -mtime "+$VORHALTETAGE" -print0)
fi

echo "Fertig — $INSTANZ gesichert nach $LAUF_ORDNER"
