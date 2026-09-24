#!/usr/bin/env bash
#
# wov-sicherung.sh — sichert Spielstand, Weltdokumente sowie Konten- und
# Forumsdatenbank EINER Instanz. Aufbewahrung: 30 Tage.
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
# ── Konten- und Forumsdatenbank (SQLite, WAL) ─────────────────────────────
# server/data/konten/<instanz>.db und server/data/forum/<instanz>.db laufen im
# WAL-Modus: Die Hauptdatei bleibt tagelang fast leer, die Daten stehen in
# <name>.db-wal. Ein `cp` der Hauptdatei ergäbe eine LEERE Datenbank, ein `cp`
# aller drei Dateien eine womöglich angerissene. Deshalb: SQLite-Online-
# Sicherung (Backup-API des python3-Moduls sqlite3; auf wov-dev gibt es kein
# sqlite3-Programm), konsistent bei laufendem Server. Die Kopie wird auf
# journal_mode=DELETE gestellt (eine Datei, kein -wal daneben) und mit
# PRAGMA integrity_check geprüft; alles ausser "ok" ist ein Fehler (Exit 1).
# Die Kopien enthalten E-Mail-Adressen und Passwort-Hashes: Lauf-Ordner 0700,
# Dateien 0600 (umask 077 + chmod am Ende).
#
# NICHT gesichert (bewusst, Karte S7): assets/hochgeladen/ (Modell-Uploads)
# und metriken-*.jsonl.
#
# ── Scheitern, Fristen, Aufbewahrung ────────────────────────────────────────
# * Jeder DB-Schritt hat eine harte Frist (WOV_SICHERUNG_DB_FRIST, Vorgabe
#   300 s): Python-backup() versucht bei gesperrter DB endlos weiter, ohne
#   Frist bliebe die oneshot-Unit hängen und blockierte alle Folgeläufe.
#   Frist abgelaufen = Lauf fehlerhaft, Exit 1. (Die Unit hat zusätzlich
#   TimeoutStartSec, siehe deploy/systemd/wov-sicherung.service.)
# * Ein Lauf entsteht als <stempel>.laeuft und wird erst ganz am Ende, wenn
#   alles geprüft ist, atomar (mv) in <stempel> umbenannt. Scheitert er
#   (Exit ≠ 0, auch bei SIGTERM), heisst er danach <stempel>.fehlerhaft
#   (ist der Name belegt: .fehlerhaft.2, .3 …). Nach SIGKILL, OOM oder
#   Stromausfall bleibt <stempel>.laeuft liegen; der nächste Lauf benennt
#   solche Reste beim Start in .fehlerhaft um. Nur Ordner mit blossem
#   Stempelnamen sind gültige Läufe.
# * Das ganze Skript läuft unter flock auf $ZIEL/<instanz>/.sperre; ein zweiter
#   gleichzeitiger Lauf endet sofort mit Meldung.
# * Eine DB gilt nur mit den erwarteten Tabellen (Konten: konten, charaktere;
#   Forum: boards, threads, posts) als gesichert; eine leere Datei ist ein
#   Fehler.
# * Aufbewahrung: Läufe älter als 30 Tage (in Minuten gemessen) werden
#   gelöscht, .fehlerhaft-Ordner nach demselben Alter — die 30 Tage gelten
#   hart (Datenschutzerklärung). Einziger Schutz gegen Uhrsprünge: der gerade
#   geschriebene Lauf wird nie gelöscht, und ist der neue Stempel älter als
#   der neueste vorhandene gültige Lauf (Uhr ging rückwärts), wird gar nicht
#   aufgeräumt. Springt die Uhr VORWÄRTS um mehr als 30 Tage, gelten alle
#   bisherigen Läufe als zu alt und fallen weg; es bleibt nur der neue Lauf.
#   Angefasst werden nur Ordner mit Stempelnamen unter $ZIEL/<instanz>/.
#
# ── So spielst du eine Sicherung zurück ─────────────────────────────────────
#   1. Server stoppen:  systemctl stop wov-server
#   2. Lauf wählen:     L=/var/backups/wov/welten/<instanz>/<stempel>
#      NUR Ordner OHNE Endung (weder .fehlerhaft noch .laeuft) — so heissen
#      gescheiterte bzw. unfertige Läufe.
#      Hinweis: Welt (.zst), Konten und Forum werden nacheinander gezogen
#      (Sekunden bis Minuten Abstand), sind also nicht auf die Sekunde
#      gleich alt.
#   3. Alte Dateien BEISEITE legen (nicht löschen), inklusive -wal und -shm —
#      ein übrig gebliebenes -wal würde auf die zurückgespielte Datei
#      angewendet und sie zerstören:
#        cd /opt/worldofvikings/server/data
#        V=/root/vorher-$(date +%s); mkdir -p "$V"
#        mv konten/<instanz>.db* forum/<instanz>.db* "$V"/
#   4. Zurückkopieren (Rechte bleiben 0600):
#        cp "$L/konten/<instanz>.db" konten/ ; cp "$L/forum/<instanz>.db" forum/
#   5. Server starten, in der Oberfläche Konten und Charaktere prüfen.
#   Spielstand: "$L/worlds/<instanz>.db.zst" nach server/data/worlds/ (bei
#   gestopptem Server, die alte .db.zst und .prev vorher beiseite legen).
#   Weltdokument: "$L/welten/<instanz>.json" nach server/data/welten/.
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
# Vorgaben; für Proben umbiegbar (der Betrieb setzt beides nicht).
DATEN="${WOV_SICHERUNG_DATEN:-$WURZEL/server/data}"
DB_FRIST="${WOV_SICHERUNG_DB_FRIST:-300}"
umask 077

# ── 1. Instanz feststellen ─────────────────────────────────────────────
ENV_DATEI="${WOV_ENV_DATEI:-/etc/wov.env}"
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
# Ein leeres, relatives oder nur aus "/" bestehendes ZIEL ist ein Fehler, kein
# Anlass zu raten (die Aufräumschleife löscht unterhalb von $ZIEL). Danach
# wird der Pfad aufgelöst (.., ., Symlinks) und gegen Systempfade geprüft.
if [[ -z "${ZIEL//\//}" || "$ZIEL" != /* ]]; then
  echo "ABBRUCH: ZIEL '$ZIEL' muss ein absoluter Pfad sein und darf nicht '/' sein." >&2
  exit 1
fi
ZIEL="$(realpath -m -- "$ZIEL")"
case "$ZIEL" in
  / | /dev | /dev/* | /proc | /proc/* | /sys | /sys/* | /etc | /etc/* | /usr | /usr/* | /bin | /bin/* | /boot | /boot/*)
    echo "ABBRUCH: ZIEL '$ZIEL' ist ein Systempfad und kein Sicherungsziel." >&2
    exit 1
    ;;
esac
VORHALTETAGE=30
# Reserve, die nach der Sicherung noch frei bleiben soll — darunter wird
# abgebrochen statt die Platte zu füllen und den laufenden Server zu
# gefährden.
MINDEST_FREI_MB=1024
ZSTD_VERSUCHE=5
FEHLER_DB=0

DB_DATEI="$DATEN/worlds/$INSTANZ.db.zst"
PREV_DATEI="$DB_DATEI.prev"
WELT_DATEI="$DATEN/welten/$INSTANZ.json"
DUNGEON_ORDNER="$DATEN/dungeons/$INSTANZ"
SERVER_YML="$DATEN/server.yml"
KONTEN_DB="$DATEN/konten/$INSTANZ.db"
FORUM_DB="$DATEN/forum/$INSTANZ.db"

if [[ ! -f "$DB_DATEI" ]]; then
  echo "ABBRUCH: $DB_DATEI fehlt — nichts zu sichern für Instanz '$INSTANZ'." >&2
  exit 1
fi

STEMPEL="$(date +%Y-%m-%dT%H-%M-%S)"
LAUF_ORDNER="$ZIEL/$INSTANZ/$STEMPEL"
LAUF_ARBEIT="$LAUF_ORDNER.laeuft"

# Nur ein Lauf zur Zeit. Die Sperre hängt am Dateideskriptor 9 (das Kind
# python bekommt ihn nicht: 9>&-), fällt also mit dem Skript weg, auch bei
# SIGKILL.
mkdir -p "$ZIEL/$INSTANZ"
exec 9>"$ZIEL/$INSTANZ/.sperre"
if ! flock -n 9; then
  echo "ABBRUCH: es läuft bereits eine Sicherung (Sperre $ZIEL/$INSTANZ/.sperre)." >&2
  exit 1
fi

# Freier Name für einen gescheiterten Lauf: <name>.fehlerhaft, sonst .2, .3 …
# — nie in einen vorhandenen Ordner hinein.
fehlerhaft_name() {
  local basis="$1.fehlerhaft" n="$1.fehlerhaft" i=2
  while [[ -e "$n" || -L "$n" ]]; do
    n="$basis.$i"
    i=$((i + 1))
  done
  echo "$n"
}

# Reste abgestürzter Läufe (SIGKILL, OOM, Stromausfall): unter der Sperre kann
# kein anderer Lauf mehr schreiben, also sind alle *.laeuft Reste.
for rest in "$ZIEL/$INSTANZ"/*.laeuft; do
  [[ -d "$rest" ]] || continue
  ziel_rest="$(fehlerhaft_name "${rest%.laeuft}")"
  mv -T "$rest" "$ziel_rest"
  echo "  Rest eines abgebrochenen Laufs: $rest → $ziel_rest" >&2
done

if [[ -e "$LAUF_ORDNER" || -L "$LAUF_ORDNER" ]]; then
  echo "ABBRUCH: $LAUF_ORDNER existiert schon (zweiter Lauf in derselben Sekunde?) — nichts angefasst." >&2
  exit 1
fi

echo "══ World of Vikings — Sicherung ($INSTANZ) ══"
echo "  Quelle: $DATEN"
echo "  Ziel:   $LAUF_ORDNER"

# ── 2. Freien Platz prüfen, BEVOR irgendetwas kopiert wird ─────────────
QUELL_PFADE=("$DB_DATEI" "$WELT_DATEI" "$SERVER_YML")
# Konten/Forum samt -wal (dort stehen die Daten); ob sie fehlen, meldet die
# Sicherung selbst.
for db in "$KONTEN_DB" "$FORUM_DB"; do
  for teil in "$db" "$db-wal"; do
    [[ -f "$teil" ]] && QUELL_PFADE+=("$teil")
  done
done
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

# Ab hier gibt es einen halben Lauf (<stempel>.laeuft), bis er ganz durch ist:
# jeder Abbruch mit Trap (set -e, exit 1, SIGTERM) benennt ihn in .fehlerhaft
# um; ohne Trap (SIGKILL) macht es der nächste Lauf beim Start.
LAUF_OK=0
LAUF_ANGELEGT=0
markiere_fehlerhaft() {
  local rc=$? neu
  if (( LAUF_OK == 0 && LAUF_ANGELEGT == 1 )) && [[ -d "$LAUF_ARBEIT" ]]; then
    neu="$(fehlerhaft_name "$LAUF_ORDNER")"
    mv -T "$LAUF_ARBEIT" "$neu" 2>/dev/null \
      && echo "  Lauf gescheitert — umbenannt: $neu" >&2
  fi
  exit "$rc"
}
trap markiere_fehlerhaft EXIT
trap 'exit 143' TERM INT
# Ohne -p: existiert der Ordner schon, ist das ein Abbruch.
mkdir "$LAUF_ARBEIT"
LAUF_ANGELEGT=1
mkdir "$LAUF_ARBEIT/worlds" "$LAUF_ARBEIT/welten" "$LAUF_ARBEIT/konten" "$LAUF_ARBEIT/forum"

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
kopiere_mit_pruefung "$DB_DATEI" "$LAUF_ARBEIT/worlds/$INSTANZ.db.zst"

if [[ -f "$PREV_DATEI" ]]; then
  echo "  kopiere $PREV_DATEI"
  kopiere_mit_pruefung "$PREV_DATEI" "$LAUF_ARBEIT/worlds/$INSTANZ.db.zst.prev"
else
  echo "  … keine .prev vorhanden (erster Save seit Anlegen der Welt?), übersprungen"
fi

echo "  kopiere $WELT_DATEI"
cp -a "$WELT_DATEI" "$LAUF_ARBEIT/welten/$INSTANZ.json"

if [[ -d "$DUNGEON_ORDNER" ]]; then
  echo "  kopiere $DUNGEON_ORDNER"
  cp -a "$DUNGEON_ORDNER" "$LAUF_ARBEIT/dungeons"
else
  echo "  … kein Dungeon-Ordner für '$INSTANZ', übersprungen"
fi

echo "  kopiere $SERVER_YML"
cp -a "$SERVER_YML" "$LAUF_ARBEIT/server.yml"

# sichere_sqlite: Online-Sicherung einer WAL-Datenbank (s. Kopfkommentar),
# dann integrity_check auf der KOPIE. Rückgabe 0 nur bei "ok".
sichere_sqlite() {
  local quelle="$1" ziel="$2" tabellen="$3"
  if [[ ! -f "$quelle" ]]; then
    echo "FEHLER: $quelle fehlt — Datenbank nicht gesichert" >&2
    return 1
  fi
  local rc=0
  timeout --kill-after=10 "$DB_FRIST" python3 - "$quelle" "$ziel" "$tabellen" 9>&- <<'PYEOF' || rc=$?
import sqlite3, sys
quelle, ziel, erwartet = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
src = sqlite3.connect(quelle, timeout=60)
dst = sqlite3.connect(ziel)
try:
    src.backup(dst)
    dst.execute("PRAGMA journal_mode=DELETE")
    ergebnis = [r[0] for r in dst.execute("PRAGMA integrity_check")]
    vorhanden = {r[0] for r in dst.execute("SELECT name FROM sqlite_master WHERE type='table'")}
finally:
    dst.close()
    src.close()
if ergebnis != ["ok"]:
    print("integrity_check: " + "; ".join(ergebnis), file=sys.stderr)
    sys.exit(1)
fehlend = [t for t in erwartet if t not in vorhanden]
if fehlend:
    print("Tabellen fehlen in der Sicherung: " + ", ".join(fehlend), file=sys.stderr)
    sys.exit(1)
PYEOF
  if (( rc == 124 || rc == 137 )); then
    echo "FEHLER: $quelle nicht innerhalb von ${DB_FRIST}s gesichert (gesperrt?) — Frist abgelaufen" >&2
  fi
  return "$rc"
}

echo "  sichere $KONTEN_DB"
sichere_sqlite "$KONTEN_DB" "$LAUF_ARBEIT/konten/$INSTANZ.db" konten,charaktere || FEHLER_DB=1
echo "  sichere $FORUM_DB"
sichere_sqlite "$FORUM_DB" "$LAUF_ARBEIT/forum/$INSTANZ.db" boards,threads,posts || FEHLER_DB=1

# Nur root darf lesen (E-Mail, Passwort-Hashes): Ordner 0700, Dateien 0600 —
# auch bei einem späteren Abbruch, deshalb VOR den Prüfungen.
find "$LAUF_ARBEIT" -type d -exec chmod 700 {} +
find "$LAUF_ARBEIT" -type f -exec chmod 600 {} +

# ── 4. Nachweis: vollständig UND entpackbar ──────────────────────────────
# Grössenvergleich zuerst (billig, fängt grobe Fehler), dann die
# inhaltliche Prüfung (JSON muss parsen, zstd muss sich testen lassen).
FEHLER=$FEHLER_DB
if (( FEHLER_DB != 0 )); then
  echo "FEHLER: Konten- oder Forumsdatenbank nicht sauber gesichert (s. oben)" >&2
fi

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

pruef_groesse "$DB_DATEI" "$LAUF_ARBEIT/worlds/$INSTANZ.db.zst"
zstd -t "$LAUF_ARBEIT/worlds/$INSTANZ.db.zst" -q || { echo "FEHLER: Hauptsicherung besteht zstd -t nicht" >&2; FEHLER=1; }

if [[ -f "$PREV_DATEI" ]]; then
  pruef_groesse "$PREV_DATEI" "$LAUF_ARBEIT/worlds/$INSTANZ.db.zst.prev"
  zstd -t "$LAUF_ARBEIT/worlds/$INSTANZ.db.zst.prev" -q || { echo "FEHLER: .prev-Sicherung besteht zstd -t nicht" >&2; FEHLER=1; }
fi

pruef_groesse "$WELT_DATEI" "$LAUF_ARBEIT/welten/$INSTANZ.json"
pruef_json "$LAUF_ARBEIT/welten/$INSTANZ.json"

if [[ -d "$DUNGEON_ORDNER" ]]; then
  while IFS= read -r -d '' datei; do
    pruef_json "$datei"
  done < <(find "$LAUF_ARBEIT/dungeons" -name '*.json' -print0)
fi

pruef_groesse "$SERVER_YML" "$LAUF_ARBEIT/server.yml"

if (( FEHLER != 0 )); then
  echo "ABBRUCH: die Sicherung unter $LAUF_ARBEIT ist NICHT vollständig — sie bleibt" >&2
  echo "als .fehlerhaft liegen für die Fehlersuche und zählt nicht als gültiger Lauf." >&2
  exit 1
fi

# Erst jetzt, atomar, wird aus dem Arbeitsordner ein gültiger Lauf.
mv -T "$LAUF_ARBEIT" "$LAUF_ORDNER"
LAUF_OK=1
echo "  ✓ Sicherung vollständig und geprüft: $LAUF_ORDNER"

# ── 5. Alte Läufe abräumen — ERST nachdem der neue Lauf steht ───────────
# In dieser Reihenfolge fällt bei einem Fehlschlag oben (exit 1) kein
# einziger alter, guter Lauf weg. Alter in Minuten (30 Tage = 43200), nicht
# in ganzen Tagen; die 30 Tage gelten hart. Nur Stempel-Ordner (auch
# .fehlerhaft[.N]) werden angefasst. Schutz gegen Uhrsprünge: der laufende Lauf
# wird nie gelöscht, und ging die Uhr rückwärts (neuester gültiger Lauf ist
# jünger als dieser), wird nicht aufgeräumt.
ALT_ORDNER="$ZIEL/$INSTANZ"
STEMPEL_MUSTER='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}(\.fehlerhaft(\.[0-9]+)?)?$'
NEUESTER="$(find "$ALT_ORDNER" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
              | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}$' | sort | tail -n 1 || true)"
if [[ "$NEUESTER" > "$STEMPEL" ]]; then
  echo "WARNUNG: die Uhr ging rückwärts (neuester Lauf $NEUESTER ist jünger als $STEMPEL) — es wird NICHT aufgeräumt." >&2
else
  while IFS= read -r -d '' alt; do
    name="$(basename "$alt")"
    [[ "$name" =~ $STEMPEL_MUSTER ]] || continue
    [[ "$name" == "$STEMPEL" ]] && continue
    echo "  räume ab (älter als ${VORHALTETAGE}d): $alt"
    rm -rf "$alt"
  done < <(find "$ALT_ORDNER" -mindepth 1 -maxdepth 1 -type d -mmin "+$((VORHALTETAGE * 1440))" -print0)
fi

echo "Fertig — $INSTANZ gesichert nach $LAUF_ORDNER"
