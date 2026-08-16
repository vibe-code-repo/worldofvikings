#!/usr/bin/env bash
#
# Bringt DIESEN Container auf den Stand von origin/main.
#
#     sudo tools/wov-update.sh
#
# Es gibt keine Ziel-Angabe und keine Optionen. Welcher Container das hier
# ist, steht in /etc/wov.env und sonst nirgends.
#
# ── Warum es diese Datei gibt ────────────────────────────────────────
# Vorgänger war tools/deploy.sh. Der schnürte auf der Entwicklungsmaschine
# ein tar, schob es per scp und "pct push" auf beide Container und packte
# es dort aus. Zwei Dinge waren daran faul:
#
#   1. Der Stand eines Containers stand in keiner Datei. Wer wissen wollte,
#      was auf live läuft, musste den fragen, der zuletzt deployt hat.
#   2. Die Prüfung war eine Attrappe. Dort stand
#          npm run typecheck 2>&1 | tail -1
#      und der Exit-Code einer Pipeline ist der des LETZTEN Glieds, also
#      der von tail, also immer 0. Typecheck, Tests und Client-Build
#      durften durchfallen — neu gestartet wurde trotzdem.
#
# Neues Modell: EIN Repo, EIN Branch "main", beide Container ziehen
# denselben Stand per git pull. Was wo läuft, sagt der Commit.
#
# ── Was hier NIE angefasst wird (Wissen aus deploy.sh) ───────────────
# server/data/          Spielstände und Weltdokumente gehören dem Server,
#                       nicht dem Repo. server/data/worlds/ steht ohnehin
#                       in .gitignore. deploy.sh übertrug das Weltdokument
#                       nur auf ausdrückliches --karte hin, und genau das
#                       war der Punkt: Editor-Code will man sofort live
#                       haben, die im Editor gebaute Welt erst, wenn sie
#                       fertig ist. Ein Update, das beides mitnimmt,
#                       veröffentlicht jede halbfertige Insel.
# server/data/server.yml  Wird hier nur GELESEN (Spielserver-Port).
#                       Geändert wird er über den Betriebsdienst.
# /etc/wov.env          Gehört dem Container, nicht dem Code. Es ist die
#                       einzige Stelle, an der dev und live sich
#                       unterscheiden — deshalb liegt es außerhalb des
#                       Baums und wird von hier nur gelesen.
# tools/assetripper/    5,1 GB entpackte Valheim-Bundles. deploy.sh musste
#                       sie beim tar von Hand ausschließen; beim ersten
#                       Lauf ging das Code-Paket sonst mit 2,7 GB und
#                       39.901 Dateien hinaus statt mit ein paar hundert
#                       Kilobyte. Heute erledigt das .gitignore — der
#                       Ordner kommt per git gar nicht erst mit.
# assets/               Modelle, Texturen, Sprites, Audio. Stehen nicht im
#                       Repo (.gitignore) und gingen bei deploy.sh nur mit
#                       --assets als eigenes tar hinüber. Sie wandern
#                       weiterhin getrennt; git pull rührt sie nicht an.
# __pycache__/, *.pyc   Ebenfalls in .gitignore, brauchen keine
#                       Ausschlussliste mehr.

set -euo pipefail

# Absoluter Pfad auf uns selbst, VOR dem cd — er wird für den Neustart
# nach dem Pull gebraucht (s.u.).
SKRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
cd "$(dirname "$SKRIPT")/.."
WURZEL="$PWD"

DIENSTE=(wov-server wov-client wov-admin)
ENV_DATEI=/etc/wov.env
ADMIN_TOKEN_DATEI=/etc/wov-admin.token

# Wird auf 1 gesetzt, sobald die Dienste unten gestoppt sind — die
# Aufräumfunktion sagt dann im Fehlerfall, dass der Container liegt.
DIENSTE_GESTOPPT=0
# Wird auf 1 gesetzt, sobald die Dienste wieder laufen. Ohne diese zweite
# Marke behauptet die Aufräumfunktion auch dann "die Dienste sind gestoppt",
# wenn erst die Gesundheitsprüfung danach gescheitert ist.
DIENSTE_LAUFEN=0
# Erst ab hier darf die Aufräumfunktion an client/dist* rühren. Vorher gilt
# die Zusage der Sauberkeitsprüfung: Bricht sie ab, ist NICHTS passiert —
# auch kein stillschweigend weggeräumter Rest eines früheren Laufs, den sie
# gerade noch als Grund für den Abbruch genannt hat.
BAU_BEGONNEN=0

aufraeumen() {
  local code=$?

  if [ "$BAU_BEGONNEN" = "1" ]; then
    # Halbfertiger Client-Tausch: dist fehlt, dist.alt ist der letzte gute
    # Stand. Erst zurückdrehen, dann wegräumen — in der anderen Reihenfolge
    # löschte ein Abbruch zwischen den beiden mv die ausgelieferte Seite.
    if [ ! -d "$WURZEL/client/dist" ] && [ -d "$WURZEL/client/dist.alt" ]; then
      mv "$WURZEL/client/dist.alt" "$WURZEL/client/dist"
    fi
    # Die beiden Hilfsordner stehen NICHT in .gitignore (dort steht "dist/",
    # das trifft "dist.neu" nicht). Bleiben sie liegen, meldet der nächste
    # Lauf den Baum als schmutzig und weigert sich.
    rm -rf "$WURZEL/client/dist.neu" "$WURZEL/client/dist.alt"
  fi

  if [ "$code" -ne 0 ] && [ "$DIENSTE_GESTOPPT" = "1" ]; then
    echo >&2
    if [ "$DIENSTE_LAUFEN" = "1" ]; then
      # Gescheitert ist die Gesundheitsprüfung, nicht das Ausrollen. Die
      # Dienste laufen — zu behaupten, sie lägen, schickt jemanden mitten in
      # einer Störung an die falsche Stelle.
      echo "Die Dienste LAUFEN — gescheitert ist die Gesundheitsprüfung." >&2
      echo "Der neue Stand ist ausgerollt und in Betrieb; was fehlt, ist die" >&2
      echo "Bestätigung, dass der Server sauber antwortet." >&2
      echo "  Zustand ansehen:  systemctl status wov-server" >&2
      echo "  Log:              journalctl -u wov-server -n 60" >&2
    else
      echo "Die Dienste sind GESTOPPT und bleiben es. Das ist Absicht: Was" >&2
      echo "Typecheck, Tests oder Build nicht besteht, geht nicht in Betrieb." >&2
      echo "  Ursache beheben, dann erneut: sudo tools/wov-update.sh" >&2
      echo "  Notfalls den vorhandenen Stand starten: systemctl start wov.target" >&2
    fi
  fi
}
trap aufraeumen EXIT

if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte mit root-Rechten ausführen: sudo tools/wov-update.sh" >&2
  exit 1
fi

# systemctl stop räumt die ganze cgroup ab. Liefe dieses Skript aus einer
# der Units heraus — etwa vom Betriebsdienst gestartet —, würde es sich
# beim Stoppen selbst erschießen, mitten zwischen Pull und npm ci.
if grep -qE 'wov-(server|client|admin)\.service' /proc/self/cgroup 2>/dev/null; then
  echo "ABBRUCH: Dieses Skript läuft innerhalb einer wov-Unit." >&2
  echo "Es stoppt die Dienste und würde sich dabei selbst beenden." >&2
  echo "Von einer normalen Sitzung aus aufrufen (ssh, dann sudo)." >&2
  exit 1
fi

# ── 1. Umgebung: dev oder live? ──────────────────────────────────────
if [ ! -f "$ENV_DATEI" ]; then
  echo "ABBRUCH: $ENV_DATEI fehlt." >&2
  echo "Ohne sie ist nicht bestimmbar, ob dieser Container dev oder live ist —" >&2
  echo "und das ist der einzige Unterschied zwischen beiden." >&2
  echo "Vorlage: deploy/wov.env.beispiel, einrichten mit deploy/install-services.sh" >&2
  exit 1
fi

# Gesourct statt selbst geparst: systemd liest dieselbe Datei mit
# EnvironmentFile=, und die dort erlaubte Teilmenge (KEY=WERT, '#' als
# Kommentarzeile) ist gültiges Shell. Ein eigener Parser wäre eine zweite
# Wahrheit, die irgendwann von systemds abweicht — und dann startet der
# Dienst mit anderen Werten als die, gegen die hier geprüft wurde.
set -a
# shellcheck source=/dev/null
. "$ENV_DATEI"
set +a

INSTANZ="${WOV_INSTANZ:-}"
case "$INSTANZ" in
  dev|live) ;;
  *)
    echo "ABBRUCH: WOV_INSTANZ in $ENV_DATEI ist '$INSTANZ' — erwartet 'dev' oder 'live'." >&2
    echo "Dieselbe Prüfung macht shared/src/instanz.ts beim Start des Servers." >&2
    exit 1
    ;;
esac

echo "══ World of Vikings — Update ($INSTANZ) ══"

# ── 2. Sauberkeitsprüfung ────────────────────────────────────────────
# Sie ist der Grund, warum der Commit die Wahrheit über den Container
# sagen kann. Wer hier von Hand etwas geändert hat, hat einen Stand
# erzeugt, den kein Commit beschreibt — und ein git pull würde ihn
# entweder überschreiben oder mit einem Konflikt stecken bleiben.
#
# Deshalb gibt es KEIN --force und keine Umgehung. Ein Flag, das die
# Prüfung durchwinkt, wäre genau der Zustand, den das neue Modell
# abschaffen soll.
ZWEIG="$(git rev-parse --abbrev-ref HEAD)"
if [ "$ZWEIG" != "main" ]; then
  echo "ABBRUCH: HEAD steht auf '$ZWEIG', erwartet 'main'." >&2
  echo "Ein Container fährt den Branch main. Nichts wurde getan." >&2
  exit 1
fi

SCHMUTZ="$(git status --porcelain)"
if [ -n "$SCHMUTZ" ]; then
  echo "ABBRUCH: Der Arbeitsbaum ist nicht sauber." >&2
  echo >&2
  printf '%s\n' "$SCHMUTZ" | sed 's/^/    /' >&2
  echo >&2
  echo "Es wurde NICHTS getan: kein Pull, kein npm ci, kein Dienst gestoppt." >&2
  echo "Diese Änderungen gehören committet und gepusht, nicht auf dem" >&2
  echo "Container liegengelassen — sonst beschreibt der Commit den" >&2
  echo "Container nicht mehr." >&2
  exit 1
fi

# ── 3. Pull, danach mit der neuen Fassung weitermachen ───────────────
if [ "${WOV_UPDATE_STUFE2:-}" != "1" ]; then
  echo
  echo "▶ git pull --ff-only origin main"
  git pull --ff-only origin main

  # Bash liest ein Skript häppchenweise von der Platte und merkt sich den
  # Byte-Offset. Der Pull kann GENAU DIESE DATEI ändern; bash liest dann
  # ab dem alten Offset in der neuen Datei weiter und führt Bruchstücke
  # aus. Deshalb hier neu starten — ab Stufe 2 ist die Datei stabil, weil
  # danach nichts mehr am Baum geändert wird.
  #
  # Verworfen: das ganze Skript in eine Funktion packen und am Ende
  # aufrufen (der übliche Trick). Das hätte funktioniert, macht die Datei
  # aber zu einer einzigen 300-Zeilen-Funktion und verschiebt das Problem
  # nur auf den, der sie das nächste Mal liest.
  export WOV_UPDATE_STUFE2=1
  exec bash "$SKRIPT" "$@"
fi

echo "  Stand: $(git log -1 --format='%h %s')"

# ── 4. Dienste stoppen, BEVOR npm ci läuft ───────────────────────────
# npm ci leert node_modules vollständig, bevor es neu installiert. Alle
# drei Units starten aus genau diesem Ordner (tsx bzw. vite) — ein
# laufender Dienst liefe mitten im Lauf in einen halb geleerten Baum.
# Auf dev kommt hinzu, dass "tsx watch" bei jeder Dateiänderung neu
# startet und dabei fröhlich in den Trümmern sucht.
echo
echo "▶ Dienste stoppen"
for dienst in "${DIENSTE[@]}"; do
  if systemctl cat "$dienst.service" >/dev/null 2>&1; then
    systemctl stop "$dienst.service"
    echo "  gestoppt: $dienst"
  fi
done
DIENSTE_GESTOPPT=1

# ── 5. Abhängigkeiten ────────────────────────────────────────────────
# OHNE --omit=dev, und das ist kein Versehen: typescript, vite und die
# Testwerkzeuge stehen in devDependencies. Genau sie sind das Tor, durch
# das dieses Skript den neuen Stand lässt. Ein --omit=dev spart ein paar
# hundert MB Plattenplatz und nimmt dafür jede Prüfung mit.
# (tsx steht seit 16.08.2026 in dependencies — siehe wov-server.service.)
#
# --include=dev ist deshalb KEINE Verzierung: Oben wurde /etc/wov.env
# gesourct, und auf live steht dort NODE_ENV=production. npm leitet daraus
# von sich aus omit=dev ab — ein blankes "npm ci" wäre auf live also genau
# das --omit=dev, das hier nicht sein soll, und zwar unsichtbar. Der Fehler
# fiele erst beim Typecheck auf ("tsc not found"), auf dev nie.
echo
echo "▶ npm ci"
npm ci --include=dev

# ── 6. Das Tor ───────────────────────────────────────────────────────
# NACKT, ohne Pipe, ohne "| tail -1", ohne "|| true". Der Exit-Code einer
# Pipeline ist der des letzten Glieds; "npm run typecheck 2>&1 | tail -1"
# in deploy.sh war deshalb IMMER erfolgreich. set -e greift hier, weil
# beide Befehle unverkettet stehen.
echo
echo "▶ Typecheck"
npm run typecheck
echo
echo "▶ Tests"
node scripts/run-tests.mjs

# ── 7. Client bauen — nur auf live ───────────────────────────────────
# Auf dev liefert der Vite-Dev-Server aus den Quellen aus, ein Build wäre
# dort totes Gewicht. Auf live liefert nginx aus client/dist (root in
# deploy/nginx-live.conf); ohne Build bliebe der alte Stand ausgeliefert,
# und genau diese Falle ist von Hand zweimal fast zugeschnappt.
if [ "$INSTANZ" = "live" ]; then
  echo
  echo "▶ Client bauen"

  # Nicht direkt nach client/dist: der Build läuft eine gute Minute, und
  # nginx liefert die ganze Zeit aus genau diesem Ordner aus. Wer während
  # des Schreibens lädt, bekommt altes index.html mit neuen Bundlenamen —
  # und weil die Namen gehasht sind, wird daraus ein 404 statt einer
  # sichtbaren Fehlermeldung.
  BAU_BEGONNEN=1
  rm -rf client/dist.neu client/dist.alt
  # vite direkt statt "npm run build --workspace=client -- --outDir …":
  # npm reicht Argumente hinter "--" zwar durch, aber die Kette
  # npm → npm-run-script → sh → vite ist genau die Sorte Indirektion, die
  # bei der Umstellung auf node_modules/.bin/tsx schon einmal Ärger machte
  # (siehe Kommentar in deploy/systemd/wov-server.service). Der Aufruf hier
  # soll wörtlich lesbar sein.
  (cd client && ../node_modules/.bin/vite build --outDir dist.neu --emptyOutDir)

  # Getauscht wird mit zwei rename(). Wirklich atomar wäre nur ein
  # Symlink-Tausch (ln -sfn neu + mv -T), weil rename() nicht über ein
  # nicht leeres Verzeichnis hinweg umbenennen kann. Verworfen: dann
  # müsste client/dist ein Symlink sein, und nginx' root zeigt in
  # deploy/nginx-live.conf auf genau diesen Pfad — ein Detail, das beim
  # nächsten Umbau jemand übersieht und das dann still den alten Ordner
  # ausliefert. Das verbleibende Fenster hier ist ein einzelner rename(),
  # nicht die Minute des Builds; bricht es dazwischen ab, dreht die
  # Aufräumfunktion oben den letzten guten Stand zurück.
  if [ -d client/dist ]; then
    mv client/dist client/dist.alt
  fi
  mv client/dist.neu client/dist
  rm -rf client/dist.alt
  echo "  ausgeliefert: $(find client/dist -type f | wc -l) Dateien"
fi

# ── 8. Dienste starten ───────────────────────────────────────────────
# Gestartet wird, was auf DIESEM Container aktiviert ist. Die Unit-Dateien
# sind auf dev und live identisch; auf live ist wov-client zwar
# installiert, aber nicht enabled, weil dort nginx den gebauten Client
# ausliefert und ein Vite-Dev-Server nichts zu suchen hat. Diese
# Entscheidung gehört dem Container — hier wird sie nur gelesen.
echo
echo "▶ Dienste starten"
GESTARTET=()
for dienst in "${DIENSTE[@]}"; do
  if [ "$(systemctl is-enabled "$dienst.service" 2>/dev/null || true)" = "enabled" ]; then
    systemctl start "$dienst.service"
    GESTARTET+=("$dienst")
    echo "  gestartet: $dienst"
  else
    echo "  übersprungen (nicht aktiviert): $dienst"
  fi
done
DIENSTE_LAUFEN=1

# ── 9. Gesundheitsprüfung ────────────────────────────────────────────
# NICHT "sleep 4; systemctl is-active". In der Unit steht Restart=always:
# ein Server, der startet und nach zwei Sekunden stirbt, ist vier Sekunden
# später wieder "activating" — und galt damit als Erfolg. Gefragt wird
# stattdessen der Port selbst.
#
# Der Port ist die richtige Frage, weil er SPÄT aufgeht: WovServer.start()
# ruft init() vor net.start(), und ein Kaltstart ohne Placement-Cache
# dauert rund 65 s (jede Layout-Änderung verwirft ihn; TimeoutStartSec in
# der Unit steht deshalb auf 300). Offener Port heißt hier also: Welt
# geladen, Server bereit. Frist: 120 s.

# wov-client darf auf live fehlen, wov-server nirgends. Ohne diese Zeile
# liefe die Prüfung unten 120 s ins Leere und meldete "keine Antwort" —
# richtig, aber nicht die Ursache.
if ! printf '%s\n' "${GESTARTET[@]:-}" | grep -qx 'wov-server'; then
  echo "ABBRUCH: wov-server ist auf diesem Container nicht aktiviert." >&2
  echo "  systemctl enable wov-server.service   (oder deploy/install-services.sh)" >&2
  exit 1
fi

# gsub(/\r/,"") ist hier KEINE Vorsicht, sondern Erfahrung: server.yml ist
# die einzige Datei im Repo mit CRLF-Zeilenenden. Ohne die Zeile liefert awk
# "2467\r", curl baut daraus eine kaputte URL und antwortet 000 — und dieses
# Skript wartet 120 s auf einen Server, der die ganze Zeit lief. Genau so am
# 16.08.2026 beim ersten Live-Lauf passiert.
SPIEL_PORT="$(awk '{gsub(/\r/,"")} /^server:/{drin=1;next} /^[^[:space:]#]/{drin=0} drin && $1=="port:"{print $2; exit}' server/data/server.yml)"
SPIEL_PORT="${SPIEL_PORT:-2467}"

echo
echo "▶ Gesundheitsprüfung: Spielserver auf Port $SPIEL_PORT"
# Geprüft wird auf HTTP 426 "Upgrade Required" — das antwortet ein
# ws-WebSocketServer ohne eigenen HTTP-Teil auf jede Anfrage ohne
# Upgrade-Kopf (server/src/net/WebSocketAcceptor.ts). Nachgemessen am
# 16.08.2026 auf dev. "Port ist offen" allein wäre zu wenig: das sagt nur,
# dass irgendjemand lauscht, nicht dass es unser Server ist.
FRIST=120
BEGINN=$SECONDS
while :; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$SPIEL_PORT/" || true)"
  if [ "$CODE" = "426" ]; then
    echo "  ✓ 426 Upgrade Required nach $((SECONDS - BEGINN)) s"
    break
  fi
  if [ "$(systemctl is-failed wov-server.service 2>/dev/null || true)" = "failed" ]; then
    echo "  ✗ wov-server ist failed" >&2
    journalctl -u wov-server -n 40 --no-pager >&2
    exit 1
  fi
  if [ $((SECONDS - BEGINN)) -ge "$FRIST" ]; then
    echo "  ✗ nach $FRIST s keine brauchbare Antwort (zuletzt HTTP '$CODE')." >&2
    echo "    '000' heißt: nichts lauscht. Alles andere als 426 heißt:" >&2
    echo "    auf dem Port sitzt etwas anderes." >&2
    journalctl -u wov-server -n 40 --no-pager >&2
    exit 1
  fi
  sleep 2
done

# Betriebsdienst. Auf live ist er die einzige Fernbedienung des Servers —
# fällt er aus, merkt man es erst, wenn man ihn braucht. Geprüft wird
# überall dort, wo er auch gestartet wurde.
if printf '%s\n' "${GESTARTET[@]:-}" | grep -qx 'wov-admin'; then
  ADMIN_ADRESSE="${WOV_ADMIN_ADRESSE:-127.0.0.1}"
  ADMIN_PORT="${WOV_ADMIN_PORT:-2468}"
  echo
  echo "▶ Gesundheitsprüfung: Betriebsdienst http://$ADMIN_ADRESSE:$ADMIN_PORT/status"
  # Jede Anfrage braucht den Token aus /etc/wov-admin.token (admin/src/main.ts).
  # Ohne ihn antwortet der Dienst mit 401 — auch das beweist, dass er
  # lebt, aber die 200 liefert nebenbei Instanz und Weltstand zurück, und
  # die will man in der Update-Ausgabe sehen.
  ADMIN_TOKEN="$( [ -r "$ADMIN_TOKEN_DATEI" ] && cat "$ADMIN_TOKEN_DATEI" || true)"
  BEGINN=$SECONDS
  while :; do
    ANTWORT="$(curl -s --max-time 3 -w '\n%{http_code}' \
                 -H "x-wov-token: $ADMIN_TOKEN" \
                 "http://$ADMIN_ADRESSE:$ADMIN_PORT/status" || true)"
    CODE="$(printf '%s' "$ANTWORT" | tail -n1)"
    if [ "$CODE" = "200" ]; then
      echo "  ✓ $(printf '%s' "$ANTWORT" | head -n-1)"
      break
    fi
    if [ "$CODE" = "401" ]; then
      echo "  ✓ antwortet (401 — Token in $ADMIN_TOKEN_DATEI passt nicht)"
      break
    fi
    if [ $((SECONDS - BEGINN)) -ge 60 ]; then
      echo "  ✗ nach 60 s keine Antwort (zuletzt HTTP '$CODE')" >&2
      journalctl -u wov-admin -n 40 --no-pager >&2
      exit 1
    fi
    sleep 2
  done
fi

echo
echo "Fertig — $INSTANZ steht auf $(git log -1 --format='%h %s')."
echo "server/data/ blieb unberührt: Spielstände und Weltdokumente gehören dem Server."
