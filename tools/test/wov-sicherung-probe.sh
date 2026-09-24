#!/usr/bin/env bash
#
# wov-sicherung-probe.sh — Probe für tools/wov-sicherung.sh (Karte S7).
#
#     tools/test/wov-sicherung-probe.sh [SKRIPT]      # Vorgabe: ../wov-sicherung.sh
#     tools/test/wov-sicherung-probe.sh --echt        # zusätzlich mit DEV-Daten
#
# Baut ein eigenes Datenverzeichnis (Welt, Konten mit laufendem Schreiber,
# Forum), lässt das Skript darüber laufen und prüft: Dateien da,
# integrity_check, Zeilenzahlen, Rechte 0700/0600, Aufbewahrung 29/31 Tage,
# Zurückspielen. Schreibt nur unter /tmp/sicherung-30-<pid>/.
# Mit --echt wird ausserdem die DEV-Datenbank per SQLite-Backup (nie per cp)
# in dieses Verzeichnis gezogen und deren Konten-/Charakterzahl nach dem
# Zurückspielen verglichen. Exit 0 = alles grün.
# Bedingte "A && B || C"-Ketten sind hier Absicht (ok/rot zählen); Hilfsfunktionen
# werden über trap bzw. indirekt aufgerufen.
# shellcheck disable=SC2015,SC2317,SC2016
set -uo pipefail

ECHT=0
if [[ "${1:-}" == "--echt" ]]; then ECHT=1; shift; fi
SKRIPT="$(realpath "${1:-$(dirname "${BASH_SOURCE[0]}")/../wov-sicherung.sh}")"
TMP="/tmp/sicherung-30-$$"
DATEN="$TMP/daten"
ZIEL="$TMP/ziel"
FEHL=0
SCHREIBER_PID=""

aufraeumen() {
  [[ -n "$SCHREIBER_PID" ]] && kill "$SCHREIBER_PID" 2>/dev/null
  [[ -n "$SCHREIBER_PID" ]] && wait "$SCHREIBER_PID" 2>/dev/null
  rm -rf "$TMP"
}
trap aufraeumen EXIT

ok()   { echo "  ok    $*"; }
rot()  { echo "  ROT   $*"; FEHL=$((FEHL + 1)); }
pruef() { local text="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$text"; else rot "$text"; fi; }

# Ein Aufruf des Skripts unter Test in einer nachgebauten Wurzel. So sieht auch
# ein altes Skript ohne WOV_SICHERUNG_DATEN nur die Probedaten, nie die echten.
mkdir -p "$TMP/wurzel/tools" "$TMP/wurzel/server"
cp "$SKRIPT" "$TMP/wurzel/tools/wov-sicherung.sh"
ln -s "$DATEN" "$TMP/wurzel/server/data"
printf 'WOV_INSTANZ=dev\n' > "$TMP/wov.env"
lauf() {
  WOV_ENV_DATEI="$TMP/wov.env" WOV_SICHERUNG_DATEN="$DATEN" WOV_SICHERUNG_ZIEL="$ZIEL" \
    bash "$TMP/wurzel/tools/wov-sicherung.sh"
}
# Bei einem alten Skript liest /etc/wov.env (dev auf wov-dev) — nur lesend.
sql() { python3 - "$@" <<'PYEOF'
import sqlite3, sys
db, q = sys.argv[1], sys.argv[2]
c = sqlite3.connect(db, timeout=30)
r = c.execute(q).fetchall()
print("|".join(str(x) for x in (r[0] if r else ())))
PYEOF
}

echo "══ Probe Sicherung — Skript: $SKRIPT ══"
mkdir -p "$DATEN"/{worlds,welten,konten,forum,dungeons/dev}

# ── Testdaten ──────────────────────────────────────────────────────────
head -c 200000 /dev/urandom | zstd -q -o "$DATEN/worlds/dev.db.zst"
cp "$DATEN/worlds/dev.db.zst" "$DATEN/worlds/dev.db.zst.prev"
echo '{"welt":true}' > "$DATEN/welten/dev.json"
echo '{"raum":1}' > "$DATEN/dungeons/dev/a.json"
echo 'x: 1' > "$DATEN/server.yml"

python3 - "$DATEN" <<'PYEOF'
import sqlite3, sys
d = sys.argv[1]
k = sqlite3.connect(d + "/konten/dev.db")
k.execute("PRAGMA journal_mode=WAL")
k.execute("CREATE TABLE konten(id INTEGER PRIMARY KEY, mail TEXT, passwort TEXT)")
k.execute("CREATE TABLE charaktere(id INTEGER PRIMARY KEY, konto INTEGER, name TEXT)")
k.execute("CREATE TABLE lauf(id INTEGER PRIMARY KEY, t REAL)")
k.executemany("INSERT INTO konten(mail,passwort) VALUES (?,?)", [("a%d@example.org" % i, "hash%d" % i) for i in range(5)])
k.executemany("INSERT INTO charaktere(konto,name) VALUES (?,?)", [(i % 5 + 1, "Ünï %d" % i) for i in range(13)])
k.commit(); k.close()
f = sqlite3.connect(d + "/forum/dev.db")
f.execute("PRAGMA journal_mode=WAL")
f.execute("CREATE TABLE boards(id INTEGER PRIMARY KEY, name TEXT)")
f.execute("CREATE VIRTUAL TABLE posts_fts USING fts5(text)")
f.executemany("INSERT INTO boards(name) VALUES (?)", [("b%d" % i,) for i in range(6)])
f.executemany("INSERT INTO posts_fts(text) VALUES (?)", [("Beitrag %d" % i,) for i in range(20)])
f.commit(); f.close()
PYEOF

# Schreiber: hält die Konten-DB offen, kein Checkpoint (Daten bleiben im WAL),
# schreibt bis zur Stopp-Datei.
python3 - "$DATEN/konten/dev.db" "$TMP/stopp" <<'PYEOF' &
import sqlite3, sys, os, time
c = sqlite3.connect(sys.argv[1], timeout=60, isolation_level=None)
c.execute("PRAGMA wal_autocheckpoint=0")
while not os.path.exists(sys.argv[2]):
    c.execute("INSERT INTO lauf(t) VALUES (?)", (time.time(),))
    time.sleep(0.002)
PYEOF
SCHREIBER_PID=$!
# Erst loslegen, wenn der Schreiber wirklich schreibt.
for _ in $(seq 100); do
  [[ "$(sql "$DATEN/konten/dev.db" 'select count(*) from lauf')" -gt 50 ]] && break
  sleep 0.05
done

echo "── Lauf 1 (mit laufendem Schreiber)"
HAUPT_B="$(stat -c%s "$DATEN/konten/dev.db")"
WAL_B="$(stat -c%s "$DATEN/konten/dev.db-wal" 2>/dev/null || echo 0)"
echo "  Quelle: Hauptdatei ${HAUPT_B} B, WAL ${WAL_B} B"
VOR="$(sql "$DATEN/konten/dev.db" 'select count(*) from lauf')"
lauf > "$TMP/lauf1.log" 2>&1; RC=$?
NACH="$(sql "$DATEN/konten/dev.db" 'select count(*) from lauf')"
echo "  Exit $RC; lauf-Zeilen vor $VOR, nach $NACH"
[[ "$RC" == 0 ]] && ok "Skript endet mit 0" || { rot "Skript endet mit $RC"; sed 's/^/    | /' "$TMP/lauf1.log" | tail -15; }

L="$(find "$ZIEL/dev" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -1)"
echo "  Lauf-Ordner: ${L:-<keiner>}"

echo "── Dateien"
pruef "Welt-Sicherung da"   test -s "$L/worlds/dev.db.zst"
pruef "Konten-Sicherung da" test -s "$L/konten/dev.db"
pruef "Forum-Sicherung da"  test -s "$L/forum/dev.db"

echo "── Inhalt"
if [[ -s "${L:-/nix}/konten/dev.db" && -s "$L/forum/dev.db" ]]; then
  IK="$(sql "$L/konten/dev.db" 'pragma integrity_check')"
  IF="$(sql "$L/forum/dev.db" 'pragma integrity_check')"
  [[ "$IK" == ok ]] && ok "integrity_check Konten = ok" || rot "integrity_check Konten = $IK"
  [[ "$IF" == ok ]] && ok "integrity_check Forum = ok" || rot "integrity_check Forum = $IF"
  QK="$(sql "$DATEN/konten/dev.db" 'select (select count(*) from konten)||"/"||(select count(*) from charaktere)')"
  SK="$(sql "$L/konten/dev.db" 'select (select count(*) from konten)||"/"||(select count(*) from charaktere)')"
  [[ "$QK" == "$SK" ]] && ok "Konten/Charaktere $SK = Quelle $QK" || rot "Konten/Charaktere $SK, Quelle $QK"
  SB="$(sql "$L/forum/dev.db" 'select (select count(*) from boards)||"/"||(select count(*) from posts_fts)')"
  [[ "$SB" == "6/20" ]] && ok "Forum boards/beiträge $SB = 6/20" || rot "Forum boards/beiträge $SB, erwartet 6/20"
  SL="$(sql "$L/konten/dev.db" 'select count(*)||"|"||coalesce(max(id),0) from lauf')"
  N="${SL%%|*}"; M="${SL##*|}"
  echo "  lauf in der Sicherung: $N Zeilen, max(id) $M (Quelle vor $VOR, nach $NACH)"
  [[ "$N" == "$M" && "$N" -ge "$VOR" && "$N" -le "$NACH" ]] \
    && ok "laufende Schreibvorgänge: Stand lückenlos und zwischen vor/nach" \
    || rot "laufende Schreibvorgänge: Stand nicht konsistent"
  [[ "$WAL_B" -gt "$HAUPT_B" ]] && ok "WAL war im Spiel (WAL $WAL_B B > Hauptdatei $HAUPT_B B)" || rot "WAL nicht im Spiel"
  [[ "$SL" != "0|0" ]] && ok "Sicherung nicht leer (Beweis gegen bare cp der Hauptdatei)" || rot "Sicherung leer"
  pruef "kein -wal/-shm neben der Kopie" bash -c '! ls "$1"/konten/*-wal "$1"/forum/*-wal "$1"/konten/*-shm "$1"/forum/*-shm' _ "$L"
else
  rot "Datenbank-Sicherungen fehlen, Inhaltsprüfung entfällt"
fi

echo "── Rechte"
if [[ -n "$L" ]]; then
  BAD_D="$(find "$L" -type d ! -perm 700 | wc -l)"
  BAD_F="$(find "$L" -type f ! -perm 600 | wc -l)"
  [[ "$BAD_D" == 0 ]] && ok "alle Verzeichnisse 0700" || rot "$BAD_D Verzeichnisse nicht 0700"
  [[ "$BAD_F" == 0 ]] && ok "alle Dateien 0600" || rot "$BAD_F Dateien nicht 0600 ($(find "$L" -type f ! -perm 600 | head -3 | tr '\n' ' '))"
else
  rot "Rechte: kein Lauf-Ordner"
fi

echo "── Zurückspielen (Konten/Forum in frisches Verzeichnis, öffnen, zählen)"
if [[ -s "${L:-/nix}/konten/dev.db" ]]; then
  mkdir -p "$TMP/rest/konten" "$TMP/rest/forum"
  cp "$L/konten/dev.db" "$TMP/rest/konten/"; cp "$L/forum/dev.db" "$TMP/rest/forum/"
  RK="$(sql "$TMP/rest/konten/dev.db" 'select (select count(*) from konten)||"/"||(select count(*) from charaktere)')"
  RB="$(sql "$TMP/rest/forum/dev.db" 'select count(*) from boards')"
  [[ "$RK" == "$QK" && "$RB" == 6 ]] && ok "zurückgespielt: Konten/Charaktere $RK, Boards $RB" || rot "zurückgespielt: $RK / $RB"
  python3 -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(\"insert into konten(mail,passwort) values ('n@x','h')\"); c.commit()" "$TMP/rest/konten/dev.db" \
    && ok "zurückgespielte DB ist schreibbar" || rot "zurückgespielte DB nicht schreibbar"
fi

echo "── Aufbewahrung 29/31 Tage"
touch "$TMP/stopp"; wait "$SCHREIBER_PID" 2>/dev/null; SCHREIBER_PID=""
for tage in 13 15 29 31 40; do
  mkdir -p "$ZIEL/dev/alt-$tage"; touch -d "$tage days ago" "$ZIEL/dev/alt-$tage"
done
lauf > "$TMP/lauf2.log" 2>&1 && ok "Lauf 2 endet mit 0" || rot "Lauf 2 fehlgeschlagen"
for tage in 13 15 29; do
  [[ -d "$ZIEL/dev/alt-$tage" ]] && ok "$tage Tage alt: bleibt" || rot "$tage Tage alt: wurde gelöscht"
done
for tage in 31 40; do
  [[ ! -d "$ZIEL/dev/alt-$tage" ]] && ok "$tage Tage alt: gelöscht" || rot "$tage Tage alt: liegt noch"
done

echo "── Fehlerfall: kaputte Konten-DB muss Exit ≠ 0 geben"
mv "$DATEN/konten/dev.db" "$TMP/konten-weg.db"; rm -f "$DATEN/konten/dev.db-wal" "$DATEN/konten/dev.db-shm"
lauf > "$TMP/lauf3.log" 2>&1 && rot "Lauf ohne Konten-DB endete mit 0" || ok "fehlende Konten-DB → Exit ≠ 0"
head -c 5000 /dev/urandom > "$DATEN/konten/dev.db"
lauf > "$TMP/lauf4.log" 2>&1 && rot "Lauf mit kaputter Konten-DB endete mit 0" || ok "kaputte Konten-DB → Exit ≠ 0"

if (( ECHT )); then
  echo "── --echt: DEV-Daten per SQLite-Backup gezogen, Sicherung, Rückspielen"
  rm -rf "$DATEN/konten" "$DATEN/forum"; mkdir -p "$DATEN/konten" "$DATEN/forum"
  python3 - "$DATEN" <<'PYEOF'
import sqlite3, sys
for d in ("konten", "forum"):
    s = sqlite3.connect("file:/opt/worldofvikings/server/data/%s/dev.db?mode=ro" % d, uri=True, timeout=30)
    t = sqlite3.connect("%s/%s/dev.db" % (sys.argv[1], d))
    s.backup(t); t.close(); s.close()
PYEOF
  ZIEL="$TMP/ziel-echt"
  lauf > "$TMP/lauf5.log" 2>&1 && ok "Sicherung der DEV-Kopie endet mit 0" || { rot "Sicherung der DEV-Kopie fehlgeschlagen"; tail -8 "$TMP/lauf5.log"; }
  L2="$(find "$ZIEL/dev" -mindepth 1 -maxdepth 1 -type d | sort | tail -1)"
  Q="$(sql "$DATEN/konten/dev.db" 'select (select count(*) from konten)||"/"||(select count(*) from charaktere)||"/"||(select count(*) from banns)')"
  R="$(sql "$L2/konten/dev.db" 'select (select count(*) from konten)||"/"||(select count(*) from charaktere)||"/"||(select count(*) from banns)')"
  echo "  Konten/Charaktere/Banns Quelle $Q, Sicherung $R"
  [[ "$Q" == "$R" && "$Q" != "0/0/0" ]] && ok "DEV-Zahlen stimmen" || rot "DEV-Zahlen weichen ab"
fi

echo
if (( FEHL == 0 )); then echo "PROBE GRÜN"; exit 0; else echo "PROBE ROT ($FEHL Fehler)"; exit 1; fi
