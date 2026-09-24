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
# Der python3-Vorschalter protokolliert bei JEDEM Aufruf durch das Skript umask
# und Modus des neuesten Lauf-Ordners (Fenster vor dem chmod am Ende).
mkdir -p "$TMP/bin"
cat > "$TMP/bin/python3" <<SHIM
#!/bin/bash
n="\$(ls -1d "\$WOV_SICHERUNG_ZIEL"/dev/2*T* 2>/dev/null | grep -v fehlerhaft | tail -1)"
echo "umask=\$(umask) lauf=\$([[ -n "\$n" ]] && stat -c%a "\$n")" >> "$TMP/shim.log"
exec /usr/bin/python3 "\$@"
SHIM
chmod +x "$TMP/bin/python3"
lauf() {
  PATH="$TMP/bin:$PATH" WOV_ENV_DATEI="$TMP/wov.env" WOV_SICHERUNG_DATEN="$DATEN" WOV_SICHERUNG_ZIEL="$ZIEL" \
    bash "$TMP/wurzel/tools/wov-sicherung.sh"
}
# Frisch angelegte, gültige Konten-/Forum-DBs (Tabellen wie im Server).
neue_db() { python3 - "$1" "$2" <<'PYEOF'
import sqlite3, sys
import os
for _n in ("konten","forum"):
    for _x in ("","-wal","-shm"):
        try: os.remove("%s/%s/dev.db%s" % (sys.argv[1], _n, _x))
        except FileNotFoundError: pass
c = sqlite3.connect(sys.argv[1] + "/konten/dev.db"); c.execute("PRAGMA journal_mode=WAL")
c.execute("CREATE TABLE konten(id INTEGER PRIMARY KEY, mail TEXT)"); c.execute("CREATE TABLE charaktere(id INTEGER PRIMARY KEY, n TEXT)")
c.execute("CREATE TABLE t(a)"); c.execute("CREATE INDEX i ON t(a)")
c.executemany("INSERT INTO t VALUES (?)", [(x,) for x in range(1000, 1040)])
c.execute("INSERT INTO konten(mail) VALUES ('a')"); c.commit(); c.close()
f = sqlite3.connect(sys.argv[1] + "/forum/dev.db"); f.execute("PRAGMA journal_mode=WAL")
for t in ("boards", "threads", "posts"): f.execute("CREATE TABLE %s(id INTEGER PRIMARY KEY)" % t)
f.commit(); f.close()
PYEOF
}
# Ordner der Läufe (ohne .fehlerhaft / mit) im Ziel dieses Aufrufs.
gute()    { find "$ZIEL/dev" -mindepth 1 -maxdepth 1 -type d -name '2*T*' ! -name '*.fehlerhaft' | wc -l; }
schlechte() { find "$ZIEL/dev" -mindepth 1 -maxdepth 1 -type d -name '*.fehlerhaft' | wc -l; }
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
f.execute("CREATE TABLE threads(id INTEGER PRIMARY KEY, board INTEGER, titel TEXT)")
f.execute("CREATE TABLE posts(id INTEGER PRIMARY KEY, thread INTEGER, text TEXT)")
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

touch "$TMP/stopp"; wait "$SCHREIBER_PID" 2>/dev/null; SCHREIBER_PID=""

echo "── umask/Modus während des Laufs (Fenster vor dem chmod)"
if [[ -s "$TMP/shim.log" ]] && ! grep -v '^umask=0077 lauf=700$' "$TMP/shim.log" | grep -v 'lauf=$' | grep -q .; then
  ok "umask 0077 und Lauf-Ordner 0700 bei allen $(wc -l < "$TMP/shim.log") python3-Aufrufen"
else
  rot "umask/Modus im Lauf: $(sort -u "$TMP/shim.log" | tr '\n' ' ')"
fi

echo "── Ausführungsbit der Quelle wird 0600 (B7)"
chmod 755 "$DATEN/server.yml"
ZIEL="$TMP/ziel-x"; lauf > "$TMP/lauf-x.log" 2>&1
LX="$(find "$ZIEL/dev" -mindepth 1 -maxdepth 1 -type d | sort | tail -1)"
[[ "$(stat -c%a "$LX/server.yml" 2>/dev/null)" == 600 ]] && ok "server.yml (Quelle 0755) → 0600" || rot "server.yml → $(stat -c%a "$LX/server.yml" 2>/dev/null)"
chmod 644 "$DATEN/server.yml"

echo "── Aufbewahrung (Minuten genau, 7 neueste bleiben)"
ZIEL="$TMP/ziel-a"; mkdir -p "$ZIEL/dev"
stempel() { date -d "$1" +%Y-%m-%dT%H-%M-%S; }
# 8 junge, gültige Läufe (1–8 Tage) schützen sich nicht gegenseitig vor der Altersregel
for t in 1 2 3 4 5 6 7 8; do d="$ZIEL/dev/$(stempel "$t days ago")"; mkdir -p "$d"; touch -d "$t days ago" "$d"; done
declare -A ALT=( [t29h23]="719 hours ago" [t30h1]="721 hours ago" [t31]="31 days ago" [t40]="40 days ago" )
for k in "${!ALT[@]}"; do d="$ZIEL/dev/$(stempel "${ALT[$k]}")"; mkdir -p "$d"; touch -d "${ALT[$k]}" "$d"; done
d="$ZIEL/dev/$(stempel "35 days ago").fehlerhaft"; mkdir -p "$d"; touch -d "35 days ago" "$d"; FH_ALT="$d"
d="$ZIEL/dev/$(stempel "3 days ago").fehlerhaft"; mkdir -p "$d"; FH_NEU="$d"
mkdir -p "$ZIEL/dev/kein-stempel"; touch -d "90 days ago" "$ZIEL/dev/kein-stempel"
lauf > "$TMP/lauf2.log" 2>&1 && ok "Lauf 2 endet mit 0" || rot "Lauf 2 fehlgeschlagen"
for k in t29h23; do [[ -d "$ZIEL/dev/$(stempel "${ALT[$k]}")" ]] && ok "719 h (29 d 23 h) alt: bleibt" || rot "29 d 23 h alt: gelöscht"; done
for k in t30h1 t31 t40; do [[ ! -d "$ZIEL/dev/$(stempel "${ALT[$k]}")" ]] && ok "${ALT[$k]}: gelöscht" || rot "${ALT[$k]}: liegt noch"; done
[[ ! -d "$FH_ALT" ]] && ok "35 Tage altes .fehlerhaft: gelöscht (wie ein normaler Lauf)" || rot "altes .fehlerhaft liegt noch"
[[ -d "$FH_NEU" ]] && ok "3 Tage altes .fehlerhaft: bleibt" || rot "junges .fehlerhaft gelöscht"
[[ -d "$ZIEL/dev/kein-stempel" ]] && ok "Ordner ohne Stempelnamen: unangetastet" || rot "fremder Ordner gelöscht"

echo "── Uhrsprung: nur alte Läufe im Ziel, die neuesten 7 bleiben"
ZIEL="$TMP/ziel-u"; mkdir -p "$ZIEL/dev"
for t in 41 42 43 44 45 46 47 48 49 50; do d="$ZIEL/dev/$(stempel "$t days ago")"; mkdir -p "$d"; touch -d "$t days ago" "$d"; done
lauf > "$TMP/lauf-u.log" 2>&1 || rot "Lauf im Uhrsprung-Test endet ≠ 0"
# der neue Lauf + 6 der alten ergeben 7 gültige; 4 Ältere werden gelöscht
[[ "$(gute)" == 7 ]] && ok "gültige Läufe = 7 (neuer + 6 älteste-geschützte)" || rot "gültige Läufe = $(gute), erwartet 7"

echo "── ZIEL-Schutz (B5)"
# Ungefährlich: mkdir/cp/rm/mv/chmod/touch sind Attrappen, die nur protokollieren.
# (Ein Skript, das ZIEL=/ durchlässt, darf hier nichts auf der Platte anrichten.)
mkdir -p "$TMP/fakebin"
for w in mkdir cp rm mv chmod touch ln; do printf '#!/bin/bash\necho "%s $*" >> "%s/fake.log"\nexit 0\n' "$w" "$TMP" > "$TMP/fakebin/$w"; chmod +x "$TMP/fakebin/$w"; done
for z in "/" "//" "relativ/pfad"; do
  : > "$TMP/fake.log"
  (cd "$TMP" && PATH="$TMP/fakebin:$PATH" WOV_ENV_DATEI="$TMP/wov.env" WOV_SICHERUNG_DATEN="$DATEN" WOV_SICHERUNG_ZIEL="$z" \
     bash "$TMP/wurzel/tools/wov-sicherung.sh" >/dev/null 2>&1); RCZ=$?
  if [[ "$RCZ" != 0 && ! -s "$TMP/fake.log" ]]; then ok "ZIEL '$z' → Abbruch, nichts angelegt/gelöscht"; else rot "ZIEL '$z' → Exit $RCZ, Schreibversuche: $(wc -l < "$TMP/fake.log")"; fi
done

echo "── Fehlerläufe werden .fehlerhaft (B2)"
frisch() { ZIEL="$TMP/ziel-$1"; rm -rf "$ZIEL"; mkdir -p "$ZIEL"; }
# a) fehlende Konten-DB
frisch f1; mv "$DATEN/konten/dev.db" "$TMP/konten-weg.db"; rm -f "$DATEN/konten/dev.db-wal" "$DATEN/konten/dev.db-shm"
lauf > "$TMP/f1.log" 2>&1 && rot "fehlende Konten-DB endete mit 0" || ok "fehlende Konten-DB → Exit ≠ 0"
[[ "$(schlechte)" == 1 && "$(gute)" == 0 ]] && ok "→ genau ein .fehlerhaft, kein gültiger Lauf" || rot "fehlend: gültig $(gute), fehlerhaft $(schlechte)"
# b) Zufallsbytes
frisch f2; head -c 5000 /dev/urandom > "$DATEN/konten/dev.db"
lauf > "$TMP/f2.log" 2>&1 && rot "kaputte Konten-DB endete mit 0" || ok "kaputte Konten-DB → Exit ≠ 0"
[[ "$(schlechte)" == 1 && "$(gute)" == 0 ]] && ok "→ .fehlerhaft" || rot "kaputt: gültig $(gute), fehlerhaft $(schlechte)"
# c) 0-Byte-Datei (B3)
frisch f3; : > "$DATEN/konten/dev.db"
lauf > "$TMP/f3.log" 2>&1 && rot "0-Byte-Konten-DB endete mit 0" || ok "0-Byte-Konten-DB → Exit ≠ 0"
grep -q "Tabellen fehlen" "$TMP/f3.log" && ok "Meldung nennt fehlende Tabellen" || rot "keine Meldung über fehlende Tabellen"
[[ "$(schlechte)" == 1 ]] && ok "→ .fehlerhaft" || rot "0-Byte: fehlerhaft $(schlechte)"
# d) DB ohne die erwarteten Tabellen
frisch f4; rm -f "$DATEN/konten/dev.db"*; python3 -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('create table x(a)'); c.commit()" "$DATEN/konten/dev.db"
lauf > "$TMP/f4.log" 2>&1 && rot "DB ohne konten/charaktere endete mit 0" || ok "DB ohne konten/charaktere → Exit ≠ 0"
# e) halber Lauf: Weltdokument ist ein toter Link, stat scheitert nach dem Kopieren unter set -e
frisch f5; rm -f "$DATEN/konten/dev.db"*; neue_db "$DATEN" x; mv "$DATEN/welten/dev.json" "$TMP/dev.json.weg"; ln -s /nichts/da "$DATEN/welten/dev.json"
lauf > "$TMP/f5.log" 2>&1 && rot "fehlendes Weltdokument endete mit 0" || ok "Abbruch mitten im Lauf → Exit ≠ 0"
[[ "$(schlechte)" == 1 && "$(gute)" == 0 ]] && ok "→ halber Lauf ist .fehlerhaft" || rot "halber Lauf: gültig $(gute), fehlerhaft $(schlechte)"
rm -f "$DATEN/welten/dev.json"; mv "$TMP/dev.json.weg" "$DATEN/welten/dev.json"
# f) integrity_check schlägt an, Backup selbst läuft (defekter Indexbaum, B8/M5)
frisch f6; rm -f "$DATEN/konten/dev.db"*; neue_db "$DATEN" x
python3 - "$DATEN/konten/dev.db" <<'PYEOF'
import sqlite3, sys
p = sys.argv[1]
c = sqlite3.connect(p); c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
root = c.execute("select rootpage from sqlite_master where name='i'").fetchone()[0]
ps = c.execute("pragma page_size").fetchone()[0]; c.close()
with open(p, "r+b") as f:
    f.seek(root * ps - 1); f.write(b"\x7f")  # Rowid des ersten Indexeintrags verbiegen
PYEOF
lauf > "$TMP/f6.log" 2>&1 && rot "beschädigter Index: Lauf endete mit 0" || ok "beschädigter Index → Exit ≠ 0"
grep -q "^integrity_check:" "$TMP/f6.log" && ok "Meldung stammt vom integrity_check (nicht vom Backup)" || rot "kein integrity_check-Befund: $(tail -3 "$TMP/f6.log" | tr '\n' ' ')"
[[ "$(schlechte)" == 1 ]] && ok "→ .fehlerhaft" || rot "beschädigter Index: fehlerhaft $(schlechte)"

echo "── Gesperrte DB: Frist statt Hänger (B1)"
frisch g1; rm -f "$DATEN/konten/dev.db"*; neue_db "$DATEN" x
python3 - "$DATEN/konten/dev.db" "$TMP/sperre-bereit" "$TMP/sperre-ende" <<'PYEOF' &
import sqlite3, sys, os, time
c = sqlite3.connect(sys.argv[1], isolation_level=None)
c.execute("PRAGMA locking_mode=EXCLUSIVE"); c.execute("BEGIN EXCLUSIVE")
c.execute("INSERT INTO konten(mail) VALUES ('x')")
open(sys.argv[2], "w").close()
t0 = time.time()
while not os.path.exists(sys.argv[3]) and time.time() - t0 < 90:
    time.sleep(0.1)
PYEOF
HALTER=$!
for _ in $(seq 100); do [[ -e "$TMP/sperre-bereit" ]] && break; sleep 0.05; done
T0=$SECONDS
PATH="$TMP/bin:$PATH" WOV_SICHERUNG_DB_FRIST=5 WOV_ENV_DATEI="$TMP/wov.env" WOV_SICHERUNG_DATEN="$DATEN" WOV_SICHERUNG_ZIEL="$ZIEL" \
  timeout 40 bash "$TMP/wurzel/tools/wov-sicherung.sh" > "$TMP/g1.log" 2>&1; RCG=$?
DAUER=$((SECONDS - T0))
touch "$TMP/sperre-ende"; wait "$HALTER" 2>/dev/null
echo "  Exit $RCG nach ${DAUER}s (Frist 5 s, äussere Grenze 40 s)"
[[ "$RCG" != 0 && "$RCG" != 124 && "$DAUER" -lt 30 ]] && ok "gesperrte DB: endet in endlicher Zeit mit Exit ≠ 0" || rot "gesperrte DB: Exit $RCG nach ${DAUER}s"
grep -q "Frist abgelaufen" "$TMP/g1.log" && ok "Meldung nennt die Frist" || rot "keine Fristmeldung"
[[ "$(schlechte)" == 1 && "$(gute)" == 0 ]] && ok "→ .fehlerhaft hinterlassen" || rot "gesperrt: gültig $(gute), fehlerhaft $(schlechte)"
pgrep -f "$TMP/wurzel/tools/wov-sicherung.sh" >/dev/null && rot "Skript läuft noch" || ok "kein Prozess des Skripts übrig"

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
