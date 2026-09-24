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
  # Waisen der Proben (python3-Vorschalter schreibt seine PID) beenden
  if [[ -s "$TMP/pids" ]]; then
    # shellcheck disable=SC2046
    kill -KILL $(cat "$TMP/pids") 2>/dev/null
  fi
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
echo "\$\$" >> "$TMP/pids"
[[ -n "\${WOV_PROBE_TERM_IGNORE:-}" ]] && trap '' TERM
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
# gültig = blosser Stempelname; .fehlerhaft[.N] und .laeuft zählen nicht.
gute()    { find "$ZIEL/dev" -mindepth 1 -maxdepth 1 -type d -regex '.*/[0-9-]+T[0-9-]+' | wc -l; }
schlechte() { find "$ZIEL/dev" -mindepth 1 -maxdepth 1 -type d -name '*.fehlerhaft*' | wc -l; }
laeuft()  { find "$ZIEL/dev" -mindepth 1 -maxdepth 1 -type d -name '*.laeuft' | wc -l; }
# Ein Datum, das immer denselben Stempel liefert (Namenskollision).
mkdir -p "$TMP/datebin"
printf '#!/bin/bash\nif [[ "$*" == "+%%Y-%%m-%%dT%%H-%%M-%%S" ]]; then echo 2026-01-02T03-04-05; else exec /usr/bin/date "$@"; fi\n' > "$TMP/datebin/date"
chmod +x "$TMP/datebin/date"
laufd() {
  PATH="$TMP/datebin:$TMP/bin:$PATH" WOV_ENV_DATEI="$TMP/wov.env" WOV_SICHERUNG_DATEN="$DATEN" WOV_SICHERUNG_ZIEL="$ZIEL" \
    bash "$TMP/wurzel/tools/wov-sicherung.sh"
}
# Sperr-Halter: hält die Konten-DB exklusiv, bis sperre_aus gerufen wird.
sperre_an() {
  rm -f "$TMP/sperre-bereit" "$TMP/sperre-ende"
  python3 - "$DATEN/konten/dev.db" "$TMP/sperre-bereit" "$TMP/sperre-ende" <<'PYEOF' &
import sqlite3, sys, os, time
c = sqlite3.connect(sys.argv[1], isolation_level=None)
c.execute("PRAGMA locking_mode=EXCLUSIVE"); c.execute("BEGIN EXCLUSIVE")
c.execute("INSERT INTO konten(mail) VALUES ('x')")
open(sys.argv[2], "w").close()
t0 = time.time()
while not os.path.exists(sys.argv[3]) and time.time() - t0 < 120:
    time.sleep(0.1)
PYEOF
  HALTER=$!
  for _ in $(seq 100); do [[ -e "$TMP/sperre-bereit" ]] && break; sleep 0.05; done
}
sperre_aus() { touch "$TMP/sperre-ende"; wait "$HALTER" 2>/dev/null; }
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

echo "── Aufbewahrung (Minuten genau, 30 Tage hart)"
ZIEL="$TMP/ziel-a"; mkdir -p "$ZIEL/dev"
stempel() { date -d "$1" +%Y-%m-%dT%H-%M-%S; }
declare -A ALT=( [t3]="3 days ago" [t29h23]="719 hours ago" [t30h1]="721 hours ago" [t31]="31 days ago" [t40]="40 days ago" )
declare -A NAME=()
# Namen EINMAL beim Anlegen merken (sonst kippt die Sekunde zwischen Anlegen und Prüfen)
for k in "${!ALT[@]}"; do NAME[$k]="$(stempel "${ALT[$k]}")"; mkdir -p "$ZIEL/dev/${NAME[$k]}"; touch -d "${ALT[$k]}" "$ZIEL/dev/${NAME[$k]}"; done
FH_ALT="$ZIEL/dev/$(stempel "35 days ago").fehlerhaft"; mkdir -p "$FH_ALT"; touch -d "35 days ago" "$FH_ALT"
FH_ALT2="$ZIEL/dev/$(stempel "36 days ago").fehlerhaft.2"; mkdir -p "$FH_ALT2"; touch -d "36 days ago" "$FH_ALT2"
FH_NEU="$ZIEL/dev/$(stempel "2 days ago").fehlerhaft"; mkdir -p "$FH_NEU"
mkdir -p "$ZIEL/dev/kein-stempel"; touch -d "90 days ago" "$ZIEL/dev/kein-stempel"
lauf > "$TMP/lauf2.log" 2>&1 && ok "Lauf 2 endet mit 0" || rot "Lauf 2 fehlgeschlagen"
[[ -d "$ZIEL/dev/${NAME[t29h23]}" ]] && ok "719 h (29 d 23 h) alt: bleibt" || rot "29 d 23 h alt: gelöscht"
[[ -d "$ZIEL/dev/${NAME[t3]}" ]] && ok "3 Tage alt: bleibt" || rot "3 Tage alt: gelöscht"
for k in t30h1 t31 t40; do [[ ! -e "$ZIEL/dev/${NAME[$k]}" ]] && ok "${ALT[$k]}: gelöscht" || rot "${ALT[$k]}: liegt noch"; done
[[ ! -e "$FH_ALT" && ! -e "$FH_ALT2" ]] && ok "35/36 Tage alte .fehlerhaft(.2): gelöscht" || rot "altes .fehlerhaft liegt noch"
[[ -d "$FH_NEU" ]] && ok "2 Tage altes .fehlerhaft: bleibt" || rot "junges .fehlerhaft gelöscht"
[[ -d "$ZIEL/dev/kein-stempel" ]] && ok "Ordner ohne Stempelnamen: unangetastet" || rot "fremder Ordner gelöscht"

echo "── Uhr VORWÄRTS (nur alte Läufe im Ziel): 30 Tage gelten hart, nur der neue Lauf bleibt"
ZIEL="$TMP/ziel-u"; mkdir -p "$ZIEL/dev"
for t in 41 42 43 44 45 46 47 48 49 50; do d="$ZIEL/dev/$(stempel "$t days ago")"; mkdir -p "$d"; touch -d "$t days ago" "$d"; done
lauf > "$TMP/lauf-u.log" 2>&1 || rot "Lauf im Uhrsprung-Test endet ≠ 0"
[[ "$(gute)" == 1 ]] && ok "alle 10 alten Läufe weg, nur der laufende bleibt (gültig = 1)" || rot "gültige Läufe = $(gute), erwartet 1"

echo "── Uhr RÜCKWÄRTS (Lauf mit Zukunftsstempel): es fällt nur, was älter als 30 Tage ist"
ZIEL="$TMP/ziel-r"; mkdir -p "$ZIEL/dev"
declare -A RN=(); declare -A RA=( [fut]="5 days" [j3]="3 days ago" [j10]="10 days ago" [t29h23]="719 hours ago" [t31]="31 days ago" [t40]="40 days ago" [t60]="60 days ago" )
for k in "${!RA[@]}"; do RN[$k]="$(stempel "${RA[$k]}")"; mkdir -p "$ZIEL/dev/${RN[$k]}"; touch -d "${RA[$k]}" "$ZIEL/dev/${RN[$k]}"; done
lauf > "$TMP/lauf-r.log" 2>&1 && ok "Lauf endet mit 0" || rot "Lauf im Rückwärts-Test endet ≠ 0"
for k in t31 t40 t60; do [[ ! -e "$ZIEL/dev/${RN[$k]}" ]] && ok "${RA[$k]}: gelöscht trotz Zukunftslauf" || rot "${RA[$k]}: liegt noch (Aufräumen abgeschaltet?)"; done
for k in fut j3 j10 t29h23; do [[ -d "$ZIEL/dev/${RN[$k]}" ]] && ok "${RA[$k]}: bleibt" || rot "${RA[$k]}: gelöscht (junger Lauf gefallen)"; done
[[ "$(gute)" == 5 ]] && ok "5 gültige Läufe (Zukunft, 3 d, 10 d, 719 h, neu)" || rot "gültige Läufe = $(gute), erwartet 5"

echo "── Instanzordner ist ein Symlink: Aufräumen wirkt trotzdem"
ZIEL="$TMP/ziel-l"; mkdir -p "$ZIEL" "$TMP/real-l"; ln -s "$TMP/real-l" "$ZIEL/dev"
SL_ALT="$TMP/real-l/$(stempel "100 days ago")"; SL_JUNG="$TMP/real-l/$(stempel "3 days ago")"
mkdir "$SL_ALT" "$SL_JUNG"; touch -d "100 days ago" "$SL_ALT"; touch -d "3 days ago" "$SL_JUNG"
lauf > "$TMP/lauf-l.log" 2>&1 && ok "Lauf endet mit 0" || rot "Lauf mit Symlink-Instanzordner endet ≠ 0"
[[ ! -e "$SL_ALT" ]] && ok "100 Tage alter Lauf hinter dem Symlink gelöscht" || rot "alter Lauf hinter dem Symlink liegt noch"
[[ -d "$SL_JUNG" ]] && ok "junger Lauf bleibt" || rot "junger Lauf gelöscht"

echo "── ZIEL-Schutz (B5)"
# Ungefährlich: mkdir/cp/rm/mv/chmod/touch sind Attrappen, die nur protokollieren.
# (Ein Skript, das ZIEL=/ durchlässt, darf hier nichts auf der Platte anrichten.)
mkdir -p "$TMP/fakebin"
for w in mkdir cp rm mv chmod touch ln; do printf '#!/bin/bash\necho "%s $*" >> "%s/fake.log"\nexit 0\n' "$w" "$TMP" > "$TMP/fakebin/$w"; chmod +x "$TMP/fakebin/$w"; done
ln -s / "$TMP/lnk-wurzel"
for z in "/" "//" "///" "relativ/pfad" "/./" "/." "/.." "/tmp/.." "/dev/.." "$TMP/lnk-wurzel" "/dev" "/dev/x" "/etc/y" "/usr/z" "/proc/1" "/sys/a" "/bin/b" "/boot/c"; do
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
# d2/d3) nur EINE der erwarteten Tabellen fehlt
frisch f4b; rm -f "$DATEN/konten/dev.db"*; python3 -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('create table konten(a)'); c.commit()" "$DATEN/konten/dev.db"
lauf > "$TMP/f4b.log" 2>&1 && rot "Konten-DB ohne charaktere endete mit 0" || ok "Konten-DB nur mit konten → Exit ≠ 0"
grep -q "charaktere" "$TMP/f4b.log" && ok "Meldung nennt charaktere" || rot "Meldung nennt charaktere nicht"
frisch f4c; rm -f "$DATEN/konten/dev.db"* "$DATEN/forum/dev.db"*; neue_db "$DATEN" x
rm -f "$DATEN/forum/dev.db"*; python3 -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('create table boards(a)'); c.commit()" "$DATEN/forum/dev.db"
lauf > "$TMP/f4c.log" 2>&1 && rot "Forum-DB nur mit boards endete mit 0" || ok "Forum-DB nur mit boards → Exit ≠ 0"
grep -q "threads" "$TMP/f4c.log" && ok "Meldung nennt threads" || rot "Meldung nennt threads nicht"
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
sperre_an
T0=$SECONDS
PATH="$TMP/bin:$PATH" WOV_SICHERUNG_DB_FRIST=5 WOV_ENV_DATEI="$TMP/wov.env" WOV_SICHERUNG_DATEN="$DATEN" WOV_SICHERUNG_ZIEL="$ZIEL" \
  timeout 40 bash "$TMP/wurzel/tools/wov-sicherung.sh" > "$TMP/g1.log" 2>&1; RCG=$?
DAUER=$((SECONDS - T0))
sperre_aus
echo "  Exit $RCG nach ${DAUER}s (Frist 5 s, äussere Grenze 40 s)"
[[ "$RCG" != 0 && "$RCG" != 124 && "$DAUER" -lt 30 ]] && ok "gesperrte DB: endet in endlicher Zeit mit Exit ≠ 0" || rot "gesperrte DB: Exit $RCG nach ${DAUER}s"
grep -q "Frist abgelaufen" "$TMP/g1.log" && ok "Meldung nennt die Frist" || rot "keine Fristmeldung"
[[ "$(schlechte)" == 1 && "$(gute)" == 0 ]] && ok "→ .fehlerhaft hinterlassen" || rot "gesperrt: gültig $(gute), fehlerhaft $(schlechte)"
pgrep -f "$TMP/wurzel/tools/wov-sicherung.sh" >/dev/null && rot "Skript läuft noch" || ok "kein Prozess des Skripts übrig"

echo "── Rückspiel-Anleitung wörtlich aus dem Skriptkopf durchspielen"
# Die Codezeilen der Anleitung (8 Leerzeichen nach #) werden ausgelesen und
# unverändert ausgeführt; nur cd-Ziel und /root/vorher- werden auf Temp gebogen.
anleitung() { # $1 Name  $2 Lauf-Ordner  $3 erwartet "konten/charaktere"  $4 erwartete Boards
  local R="$TMP/rs-$1" ok_=1 z b ik if_
  rm -rf "$R"; mkdir -p "$R/konten" "$R/forum"
  for d in konten forum; do echo alt > "$R/$d/dev.db"; echo w > "$R/$d/dev.db-wal"; echo s > "$R/$d/dev.db-shm"; done
  sed -n '/^# ── So spielst du eine Sicherung zurück/,/^# ── Warum/p' "$SKRIPT" | grep -E '^#        ' | sed -E 's/^#        //; s/<instanz>/dev/g' \
    | sed "s#cd /opt/worldofvikings/server/data#cd \"$R\"#; s#/root/vorher-#$TMP/vorher-$1-#" > "$TMP/anleitung-$1.sh"
  [[ -s "$TMP/anleitung-$1.sh" ]] || { rot "Anleitung ($1): keine Codezeilen gefunden"; return; }
  if ! ( export L="$2"; bash -eu "$TMP/anleitung-$1.sh" > "$TMP/anleitung-$1.log" 2>&1 ); then
    rot "Anleitung ($1) bricht ab: $(tail -2 "$TMP/anleitung-$1.log" | tr '\n' ' ')"; return
  fi
  V="$(ls -d "$TMP"/vorher-$1-* 2>/dev/null | head -1)"
  [[ -f "$V/konten/dev.db-wal" && -f "$V/forum/dev.db-wal" && -f "$V/konten/dev.db-shm" && -f "$V/forum/dev.db-shm" ]] || { rot "Anleitung ($1): alte Dateien nicht getrennt beiseite gelegt"; ok_=0; }
  [[ -z "$(ls "$R"/konten "$R"/forum | grep -E -- '-(wal|shm)$')" ]] || { rot "Anleitung ($1): -wal/-shm liegt noch in den Live-Ordnern"; ok_=0; }
  z="$(sql "$R/konten/dev.db" 'select (select count(*) from konten)||"/"||(select count(*) from charaktere)' 2>&1)"
  b="$(sql "$R/forum/dev.db" 'select count(*) from boards' 2>&1)"
  ik="$(sql "$R/konten/dev.db" 'pragma integrity_check' 2>&1)"; if_="$(sql "$R/forum/dev.db" 'pragma integrity_check' 2>&1)"
  echo "  zurückgespielt ($1): Konten/Charaktere $z, Boards $b, integrity_check Konten=$ik Forum=$if_"
  [[ "$z" == "$3" && "$b" == "$4" && "$ik" == ok && "$if_" == ok && "$ok_" == 1 ]] \
    && ok "Anleitung ($1) wörtlich ausgeführt: Zahlen $3 / $4 Boards stimmen, integrity_check ok" || rot "Anleitung ($1): Zahlen oder integrity_check falsch"
}
anleitung synthetisch "$L" "$QK" 6

echo "── SIGKILL mitten im Lauf (F1) und zweiter gleichzeitiger Lauf (F3)"
frisch k1; rm -f "$DATEN/konten/dev.db"*; neue_db "$DATEN" x; sperre_an
PATH="$TMP/bin:$PATH" WOV_SICHERUNG_DB_FRIST=60 WOV_ENV_DATEI="$TMP/wov.env" WOV_SICHERUNG_DATEN="$DATEN" WOV_SICHERUNG_ZIEL="$ZIEL" \
  setsid bash "$TMP/wurzel/tools/wov-sicherung.sh" > "$TMP/k1.log" 2>&1 &
SK=$!
for _ in $(seq 100); do [[ -n "$(pgrep -P "$SK" 2>/dev/null)" ]] && break; sleep 0.1; done
T0=$SECONDS
WOV_SICHERUNG_DB_FRIST=8 lauf > "$TMP/k1b.log" 2>&1; RC2=$?
[[ "$RC2" != 0 && $((SECONDS - T0)) -lt 10 ]] && ok "zweiter Lauf endet sofort mit Exit ≠ 0 ($((SECONDS - T0)) s)" || rot "zweiter Lauf: Exit $RC2 nach $((SECONDS - T0)) s"
grep -q "läuft bereits eine Sicherung" "$TMP/k1b.log" && ok "Meldung 'läuft bereits'" || rot "keine 'läuft bereits'-Meldung"
[[ "$(laeuft)" == 1 ]] && ok "während des Laufs: genau ein .laeuft, gültig $(gute)" || rot ".laeuft-Zahl während des Laufs: $(laeuft)"
# timeout setzt sich in eine eigene Prozessgruppe: den Baum einzeln einsammeln
PIDS="$SK"
for p in $(pgrep -P "$SK"); do PIDS="$PIDS $p $(pgrep -P "$p" | tr '\n' ' ')"; done
# shellcheck disable=SC2086
kill -KILL $PIDS 2>/dev/null; wait "$SK" 2>/dev/null
sleep 0.3
# shellcheck disable=SC2086
LEBT="$(ps -o pid=,stat= -p $PIDS 2>/dev/null | awk '$2 !~ /^Z/ {print $1}' | tr '\n' ' ')"
[[ -z "$LEBT" ]] && ok "alle Prozesse des Laufs beendet (ps -p $PIDS: keine lebenden)" || rot "Prozesse nach SIGKILL noch da: $LEBT"
sperre_aus
[[ "$(laeuft)" == 1 && "$(gute)" == 0 && "$(schlechte)" == 0 ]] && ok "nach SIGKILL: nur .laeuft, KEIN Ordner ohne Endung" || rot "nach SIGKILL: laeuft $(laeuft), gültig $(gute), fehlerhaft $(schlechte)"
lauf > "$TMP/k1c.log" 2>&1 && ok "Folgelauf endet mit 0 (Sperre war frei)" || { rot "Folgelauf fehlgeschlagen"; tail -5 "$TMP/k1c.log"; }
[[ "$(laeuft)" == 0 && "$(schlechte)" == 1 && "$(gute)" == 1 ]] && ok "Rest → .fehlerhaft, neuer Lauf gültig" || rot "nach Folgelauf: laeuft $(laeuft), fehlerhaft $(schlechte), gültig $(gute)"

echo "── SIGTERM an den Lauf (Trap)"
frisch k2; rm -f "$DATEN/konten/dev.db"*; neue_db "$DATEN" x; sperre_an
PATH="$TMP/bin:$PATH" WOV_SICHERUNG_DB_FRIST=60 WOV_ENV_DATEI="$TMP/wov.env" WOV_SICHERUNG_DATEN="$DATEN" WOV_SICHERUNG_ZIEL="$ZIEL" \
  setsid bash "$TMP/wurzel/tools/wov-sicherung.sh" > "$TMP/k2.log" 2>&1 &
ST=$!
for _ in $(seq 100); do [[ -n "$(pgrep -P "$ST" 2>/dev/null)" ]] && break; sleep 0.1; done
# wie systemd: TERM an alle Prozesse des Laufs (timeout reicht es an python weiter)
TPIDS="$ST $(pgrep -P "$ST" | tr '\n' ' ')"
# shellcheck disable=SC2086
kill -TERM $TPIDS 2>/dev/null
for _ in $(seq 150); do kill -0 "$ST" 2>/dev/null || break; sleep 0.1; done
wait "$ST" 2>/dev/null; RCT=$?
sperre_aus
[[ "$(laeuft)" == 0 && "$(schlechte)" == 1 && "$(gute)" == 0 ]] && ok "SIGTERM → .fehlerhaft, kein .laeuft, kein gültiger Lauf (Exit $RCT)" || rot "SIGTERM: laeuft $(laeuft), fehlerhaft $(schlechte), gültig $(gute)"

echo "── SIGINT an den Lauf (INT-Trap: Exit 143, .fehlerhaft)"
frisch k6; rm -f "$DATEN/konten/dev.db"*; neue_db "$DATEN" x; sperre_an
PATH="$TMP/bin:$PATH" WOV_SICHERUNG_DB_FRIST=60 WOV_ENV_DATEI="$TMP/wov.env" WOV_SICHERUNG_DATEN="$DATEN" WOV_SICHERUNG_ZIEL="$ZIEL" \
  /usr/bin/python3 -c 'import signal, os, sys; signal.signal(signal.SIGINT, signal.SIG_DFL); os.setsid(); os.execvp("bash", ["bash", sys.argv[1]])' \
  "$TMP/wurzel/tools/wov-sicherung.sh" > "$TMP/k6.log" 2>&1 &
# (Hintergrundstart schaltet SIGINT auf "ignoriert"; das erbt die Shell und kein Trap greift — daher der Start über python mit SIG_DFL)
SI=$!
for _ in $(seq 100); do [[ -n "$(pgrep -P "$SI" 2>/dev/null)" ]] && break; sleep 0.1; done
IPIDS="$SI $(pgrep -P "$SI" | tr '\n' ' ')"
# shellcheck disable=SC2086
kill -INT $IPIDS 2>/dev/null
for _ in $(seq 150); do kill -0 "$SI" 2>/dev/null || break; sleep 0.1; done
wait "$SI" 2>/dev/null; RCI=$?
sperre_aus
[[ "$RCI" == 143 ]] && ok "SIGINT → Exit 143 (Trap, nicht 130)" || rot "SIGINT → Exit $RCI, erwartet 143"
[[ "$(laeuft)" == 0 && "$(schlechte)" == 1 ]] && ok "SIGINT → .fehlerhaft, kein .laeuft" || rot "SIGINT: laeuft $(laeuft), fehlerhaft $(schlechte)"

echo "── TERM wird ignoriert: --kill-after beendet den DB-Schritt trotzdem"
frisch k3; rm -f "$DATEN/konten/dev.db"*; neue_db "$DATEN" x; sperre_an
T0=$SECONDS
PATH="$TMP/bin:$PATH" WOV_PROBE_TERM_IGNORE=1 WOV_SICHERUNG_DB_FRIST=3 WOV_ENV_DATEI="$TMP/wov.env" WOV_SICHERUNG_DATEN="$DATEN" WOV_SICHERUNG_ZIEL="$ZIEL" \
  timeout 40 bash "$TMP/wurzel/tools/wov-sicherung.sh" > "$TMP/k3.log" 2>&1; RCK=$?
DAUER=$((SECONDS - T0))
echo "  Exit $RCK nach ${DAUER}s (Frist 3 s + kill-after 10 s, äussere Grenze 40 s)"
[[ "$RCK" != 0 && "$RCK" != 124 && "$DAUER" -lt 30 ]] && ok "endet nach Frist + kill-after (nicht am äusseren Limit)" || rot "hängt: Exit $RCK nach ${DAUER}s"
[[ "$(schlechte)" == 1 && "$(laeuft)" == 0 ]] && ok "→ .fehlerhaft" || rot "kill-after: fehlerhaft $(schlechte), laeuft $(laeuft)"
sperre_aus

echo "── SIGKILL nur am Skript: Waisen halten die Sperre NICHT (fd 9 wird nicht vererbt)"
frisch k4; rm -f "$DATEN/konten/dev.db"*; neue_db "$DATEN" x; sperre_an
PATH="$TMP/bin:$PATH" WOV_SICHERUNG_DB_FRIST=60 WOV_ENV_DATEI="$TMP/wov.env" WOV_SICHERUNG_DATEN="$DATEN" WOV_SICHERUNG_ZIEL="$ZIEL" \
  setsid bash "$TMP/wurzel/tools/wov-sicherung.sh" > "$TMP/k4.log" 2>&1 &
SW=$!
for _ in $(seq 100); do [[ -n "$(pgrep -P "$SW" 2>/dev/null)" ]] && break; sleep 0.1; done
WAISEN="$(pgrep -P "$SW" | tr '\n' ' ')"
for p in $WAISEN; do WAISEN="$WAISEN $(pgrep -P "$p" | tr '\n' ' ')"; done
kill -KILL "$SW" 2>/dev/null; wait "$SW" 2>/dev/null
# shellcheck disable=SC2086
LEBEN="$(ps -o pid=,stat= -p $WAISEN 2>/dev/null | awk '$2 !~ /^Z/ {print $1}' | tr '\n' ' ')"
[[ -n "$LEBEN" ]] && ok "Waisen leben noch ($LEBEN) — die Sperre muss trotzdem frei sein" || rot "Waisen sind schon weg, Test sagt nichts"
WOV_SICHERUNG_DB_FRIST=3 lauf > "$TMP/k4b.log" 2>&1
grep -q "Rest eines abgebrochenen Laufs" "$TMP/k4b.log" && ! grep -q "läuft bereits" "$TMP/k4b.log" \
  && ok "Folgelauf startet (Rest umbenannt), keine 'läuft bereits'-Meldung" || rot "Folgelauf: $(head -3 "$TMP/k4b.log" | tr '\n' ' ')"
# shellcheck disable=SC2086
kill -KILL $WAISEN 2>/dev/null; sleep 0.3
# shellcheck disable=SC2086
LEBEN="$(ps -o pid=,stat= -p $WAISEN 2>/dev/null | awk '$2 !~ /^Z/ {print $1}' | tr '\n' ' ')"
[[ -z "$LEBEN" ]] && ok "Waisen beendet (ps -p $WAISEN: keine lebenden)" || rot "Waisen leben: $LEBEN"
sperre_aus

echo "── mv am Ende scheitert: Lauf wird .fehlerhaft, nicht .laeuft (LAUF_OK erst nach dem mv)"
frisch k5; rm -f "$DATEN/konten/dev.db"*; neue_db "$DATEN" x
mkdir -p "$TMP/mvbin"
printf '#!/bin/bash\nif [[ "${*: -1}" =~ T[0-9]{2}-[0-9]{2}-[0-9]{2}$ ]]; then echo "mv: Attrappe schlägt fehl" >&2; exit 1; fi\nexec /usr/bin/mv "$@"\n' > "$TMP/mvbin/mv"; chmod +x "$TMP/mvbin/mv"
PATH="$TMP/mvbin:$TMP/bin:$PATH" WOV_ENV_DATEI="$TMP/wov.env" WOV_SICHERUNG_DATEN="$DATEN" WOV_SICHERUNG_ZIEL="$ZIEL" \
  bash "$TMP/wurzel/tools/wov-sicherung.sh" > "$TMP/k5.log" 2>&1 && rot "Lauf mit scheiterndem End-mv endete mit 0" || ok "scheiternder End-mv → Exit ≠ 0"
[[ "$(laeuft)" == 0 && "$(schlechte)" == 1 && "$(gute)" == 0 ]] && ok "→ .fehlerhaft, kein .laeuft, kein gültiger Lauf" || rot "End-mv: laeuft $(laeuft), fehlerhaft $(schlechte), gültig $(gute)"

echo "── Namenskollision (gleicher Sekundenstempel, F3)"
frisch c1; rm -f "$DATEN/konten/dev.db"*; rm -rf "$DATEN/forum"; mkdir "$DATEN/forum"
laufd > "$TMP/c1a.log" 2>&1 && rot "Lauf ohne DBs endete mit 0" || ok "1. Fehllauf → Exit ≠ 0"
laufd > "$TMP/c1b.log" 2>&1 && rot "2. Fehllauf endete mit 0" || ok "2. Fehllauf → Exit ≠ 0"
[[ -d "$ZIEL/dev/2026-01-02T03-04-05.fehlerhaft" && -d "$ZIEL/dev/2026-01-02T03-04-05.fehlerhaft.2" ]] \
  && ok ".fehlerhaft und .fehlerhaft.2 nebeneinander" || rot "Namen: $(ls "$ZIEL/dev" | tr '\n' ' ')"
[[ -z "$(find "$ZIEL/dev" -mindepth 2 -maxdepth 2 -type d -name '2026*' 2>/dev/null)" ]] && ok "nichts ineinander verschachtelt" || rot "verschachtelt: $(find "$ZIEL/dev" -mindepth 2 -maxdepth 2 -type d -name '2026*' | tr '\n' ' ')"
neue_db "$DATEN" x
laufd > "$TMP/c1c.log" 2>&1 && ok "guter Lauf mit festem Stempel → 0" || { rot "guter Lauf fehlgeschlagen"; tail -5 "$TMP/c1c.log"; }
SUM="$(md5sum "$ZIEL/dev/2026-01-02T03-04-05/konten/dev.db" | cut -c1-32)"
laufd > "$TMP/c1d.log" 2>&1 && rot "zweiter Lauf im selben Stempel endete mit 0" || ok "gleicher Stempel wie gültiger Lauf → Exit ≠ 0"
[[ "$(md5sum "$ZIEL/dev/2026-01-02T03-04-05/konten/dev.db" 2>/dev/null | cut -c1-32)" == "$SUM" && "$(gute)" == 1 && "$(laeuft)" == 0 ]] \
  && ok "gültiger Lauf unangetastet (kein Umbenennen, kein Überschreiben)" || rot "gültiger Lauf verändert: gültig $(gute), laeuft $(laeuft)"

echo "── Leerer Ordner mit dem Zielstempel (mv -T würde ihn stillschweigend ersetzen)"
frisch c2; mkdir -p "$ZIEL/dev/2026-01-02T03-04-05"
laufd > "$TMP/c2.log" 2>&1 && rot "Lauf über leeren Stempel-Ordner endete mit 0" || ok "vorhandener (leerer) Ordner gleichen Stempels → Exit ≠ 0"
[[ -d "$ZIEL/dev/2026-01-02T03-04-05" && -z "$(ls -A "$ZIEL/dev/2026-01-02T03-04-05")" && "$(laeuft)" == 0 ]] && ok "leerer Ordner unverändert, kein .laeuft" || rot "leerer Ordner verändert oder .laeuft übrig"

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
  anleitung echt "$L2" "${Q%/*}" "$(sql "$DATEN/forum/dev.db" 'select count(*) from boards')"
fi

echo
if (( FEHL == 0 )); then echo "PROBE GRÜN"; exit 0; else echo "PROBE ROT ($FEHL Fehler)"; exit 1; fi
