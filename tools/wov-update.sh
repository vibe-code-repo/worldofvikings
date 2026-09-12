#!/usr/bin/env bash
#
# Bringt DIESEN Container auf den Stand von origin/main.
#
#     sudo tools/wov-update.sh
#     sudo tools/wov-update.sh zurueck
#
# Welcher Container das hier ist, steht in /etc/wov.env und sonst nirgends.
# Es gibt kein Ziel-Argument — nur den einen Befehl oben oder "zurueck".
#
# "zurueck" macht GENAU einen Schritt rückgängig: den in VERSION als
# "vorher" vermerkten Commit auschecken und, auf live, den zuletzt
# gesicherten client/dist auspacken. Kein Stapel, kein zweites "zurueck"
# in Folge — wer weiter zurück will, tut das von Hand mit git.
#
#     bash tools/wov-update.sh --probe /tmp/irgendein-verzeichnis
#
# "--probe" spielt Bauen, Sichern, Tauschen und Zurücknehmen komplett in
# einem Wegwerfverzeichnis durch — ohne root, ohne systemctl, ohne den
# echten Baum anzufassen. Das ist der Trockenlauf für die Logik unten
# (s. "Der Rückweg").
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
# ── Der Rückweg ──────────────────────────────────────────────────────
# Bis hierher gab es kein Zurück: ging etwas NACH der Gesundheitsprüfung
# schief — ein Folgefehler, der erst im Betrieb auffällt —, blieb nur,
# den vorherigen Commit von Hand zu suchen und zu raten. Deshalb:
#
#   1. Der Client-Tausch (Schritt 7) baut ohnehin schon nach
#      client/dist.neu und tauscht erst am Ende per mv — auf demselben
#      Dateisystem ein einzelner rename(), also atomar.
#   2. VOR jedem solchen Tausch wandert der bisherige client/dist als
#      tar nach /var/backups/wov/ (samt der bisherigen VERSION-Datei).
#      Gehalten werden die letzten fünf; ältere fliegen rechtzeitig
#      raus, bevor sie die Platte füllen.
#   3. Nach jedem erfolgreichen Lauf steht der ausgerollte Commit in
#      VERSION — mit Zeitpunkt, Zweig und dem Commit, der davor lief.
#   4. "wov-update.sh zurueck" liest genau dieses "davor" aus VERSION,
#      checkt es aus und packt die letzte Sicherung wieder aus.
#
# Was git allein nicht kann, kann der Rückweg trotzdem: client/dist ist
# .gitignored (die Website liegt nicht im Repo, sie wird gebaut) — ein
# bloßes "git checkout" drehte den Commit zurück und ließe den
# unpassenden Client stehen. Alles andere, was deploy.sh beim Sichern
# vergaß (admin/, Tests, Docs, tsconfig, eslint-Konfiguration — es
# sicherte von Hand nur eine Handvoll Quellordner), holt "git checkout"
# hier vollständig zurück, weil es der GANZE Baum ist, den git kennt.
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
# tools/assetripper/    5,1 GB entpackte Fremd-Bundles. deploy.sh musste
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
# VERSION,               Gehören dem Container, nicht dem Code — wie
# /var/backups/wov/      /etc/wov.env liegen sie außerhalb des Baums
#                       (unter /var/lib/wov bzw. /var/backups/wov). Im
#                       Repo würde jeder Lauf sie als Schmutz sehen, und
#                       die Sauberkeitsprüfung liefe gegen sich selbst.
# Der Rückweg           Geht GENAU einen Schritt zurück, nie mehrere, und
#                       lässt server/data/ so unberührt wie das Update
#                       selbst — ein Rückweg, der Spielstände zurücksetzt,
#                       wäre schlimmer als gar keiner. node_modules wird
#                       nicht gesichert, sondern aus dem zurückgeholten
#                       package-lock.json neu installiert (npm ci) —
#                       derselbe Weg wie beim Update, nur rückwärts, und
#                       deshalb ebenso deterministisch.

set -euo pipefail

# Absoluter Pfad auf uns selbst, VOR dem cd — er wird für den Neustart
# nach dem Pull gebraucht (s.u.).
SKRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

# Befehl: "aktualisieren" (Vorgabe, wie bisher ohne Argument), "zurueck"
# oder "--probe VERZEICHNIS". Kein Ziel-Argument wie oben erklärt — nur
# dieser eine Schalter.
BEFEHL="${1:-aktualisieren}"

if [ "$BEFEHL" = "--probe" ]; then
  PROBE_VERZEICHNIS="${2:?Aufruf: $0 --probe VERZEICHNIS}"
  # Trockenlauf: eigenes WURZEL statt des echten Repos. Diese Zeile ist
  # der einzige Ort, an dem "--probe" den normalen Ablauf überhaupt
  # berührt — alles Weitere entscheidet sich unten am BEFEHL-Zweig
  # (s. probe_lauf()).
  WURZEL="$PROBE_VERZEICHNIS"
else
  cd "$(dirname "$SKRIPT")/.."
  WURZEL="$PWD"
fi

DIENSTE=(wov-server wov-client wov-admin)
ENV_DATEI=/etc/wov.env
ADMIN_TOKEN_DATEI=/etc/wov-admin.token

# Wie ENV_DATEI: außerhalb des Baums, gehören dem Container. Über
# WOV_SICHERUNG_VERZEICHNIS / WOV_ZUSTAND_VERZEICHNIS umlenkbar — genau
# das nutzt "--probe", um in einem Wegwerfverzeichnis zu arbeiten statt
# in /var/backups/wov bzw. /var/lib/wov herumzuräumen.
SICHERUNG_VERZEICHNIS="${WOV_SICHERUNG_VERZEICHNIS:-/var/backups/wov}"
ZUSTAND_VERZEICHNIS="${WOV_ZUSTAND_VERZEICHNIS:-/var/lib/wov}"
VERSION_DATEI="$ZUSTAND_VERZEICHNIS/VERSION"
SICHERUNGEN_BEHALTEN=5

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
# Wird kurz vor "node scripts/run-tests.mjs" auf den Pfad eines Protokolls
# gesetzt (per tee mitgeschrieben, an der Ausgabe selbst ändert das nichts).
# Bricht der Lauf ab, nennt die Aufräumfunktion daraus die roten Tests
# NAMENTLICH statt nur "Tests nicht bestanden" zu sagen — bisher stand die
# einzige Fundstelle mitten im (oft langen) Protokoll weiter oben.
TEST_PROTOKOLL=""

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
      if [ -n "$TEST_PROTOKOLL" ] && [ -f "$TEST_PROTOKOLL" ] \
        && grep -q '^▶ .* … FEHLGESCHLAGEN' "$TEST_PROTOKOLL"; then
        echo "  Roter Test (siehe Protokoll oben):" >&2
        grep '^▶ .* … FEHLGESCHLAGEN' "$TEST_PROTOKOLL" | sed 's/^/    /' >&2
      fi
      echo "  Ursache beheben, dann erneut: sudo tools/wov-update.sh" >&2
      echo "  Notfalls den vorhandenen Stand starten: systemctl start wov.target" >&2
    fi
  fi
}
trap aufraeumen EXIT

# ── Gemeinsame Bausteine für Update, Rückweg UND Trockenlauf ─────────
# Als Funktionen, weil "zurueck" denselben Tausch, dieselbe Sicherung und
# denselben Dienste-Reigen braucht wie das Update — nur in anderer
# Reihenfolge. Zwei Kopien derselben gut 100 Zeilen wären die Sorte
# zweite Wahrheit, vor der der Kopfkommentar oben bei /etc/wov.env schon
# warnt.

# Tauscht $2 gegen den Inhalt von $1. Zwei mv() statt eines: rename()
# kann nicht über ein nicht-leeres Verzeichnis hinweg umbenennen, daher
# der Umweg über "$2.alt". Setzt selbst KEIN BAU_BEGONNEN — das muss vor
# dem ersten Schreibzugriff auf $2 stehen, auch schon vor dem Erzeugen
# von $1, falls das fehlschlägt, und das weiß nur der Aufrufer.
dist_tauschen() {
  local neu="$1" ziel="$2"
  if [ -d "$ziel" ]; then
    mv "$ziel" "$ziel.alt"
  fi
  mv "$neu" "$ziel"
  rm -rf "$ziel.alt"
}

# Sichert $1 (falls vorhanden) zusammen mit der aktuellen VERSION-Datei
# als tar nach $2 und räumt danach alles außer den letzten
# SICHERUNGEN_BEHALTEN weg. Rührt $1 selbst nicht an — unschädlich, auch
# wenn der Tausch danach scheitert.
dist_sichern() {
  local dist_pfad="$1" sicherung_verz="$2" version_datei="$3" markierung="$4"
  [ -d "$dist_pfad" ] || return 0
  mkdir -p "$sicherung_verz"
  local ziel="$sicherung_verz/wov-$(date -u +%Y%m%dT%H%M%SZ)-$markierung.tar.gz"
  local stage
  stage="$(mktemp -d)"
  cp -a "$dist_pfad" "$stage/dist"
  local eintraege=(dist)
  if [ -f "$version_datei" ]; then
    cp -a "$version_datei" "$stage/VERSION"
    eintraege+=(VERSION)
  fi
  tar czf "$ziel" -C "$stage" "${eintraege[@]}"
  rm -rf "$stage"
  echo "  Sicherung: $ziel ($(du -h "$ziel" | cut -f1))"

  # Ein Sicherungsverzeichnis, das die Platte füllt, wird gelöscht, nicht
  # gepflegt — deshalb hier weg, nicht irgendwann von Hand.
  local alt
  while read -r alt; do
    rm -f "$alt"
    echo "  aufgeräumt: $alt"
  done < <(ls -1t "$sicherung_verz"/wov-*.tar.gz 2>/dev/null | tail -n +$((SICHERUNGEN_BEHALTEN + 1)))
}

# Schreibt $1 atomar (erst .neu, dann mv) mit den Angaben zum gerade
# ausgerollten Stand. Format bewusst KEY=WERT wie ENV_DATEI, falls doch
# mal jemand von Hand hineinsieht oder die Datei sourct.
version_schreiben() {
  local datei="$1" commit="$2" vorher="$3" zweig="$4" instanz="$5" aktion="$6"
  mkdir -p "$(dirname "$datei")"
  {
    echo "# Von wov-update.sh geschrieben. Von Hand ändern ist zwecklos —"
    echo "# der nächste Lauf überschreibt es wieder."
    echo "WOV_VERSION_COMMIT=$commit"
    echo "WOV_VERSION_VORHER=$vorher"
    echo "WOV_VERSION_ZWEIG=$zweig"
    echo "WOV_VERSION_INSTANZ=$instanz"
    echo "WOV_VERSION_AKTION=$aktion"
    echo "WOV_VERSION_ZEIT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"$datei.neu"
  mv "$datei.neu" "$datei"
}

# grep statt sourcen: die Datei ist vertrauenswürdig (wir haben sie
# selbst geschrieben), aber ein einfacher grep bleibt auch dann richtig,
# wenn das Format sich mal um ein Feld erweitert.
version_feld() {
  grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2-
}

# ── Dienste-Reigen, geteilt zwischen Update und Rückweg ──────────────
dienste_stoppen() {
  echo
  echo "▶ Dienste stoppen"
  for dienst in "${DIENSTE[@]}"; do
    if systemctl cat "$dienst.service" >/dev/null 2>&1; then
      systemctl stop "$dienst.service"
      echo "  gestoppt: $dienst"
    fi
  done
  DIENSTE_GESTOPPT=1
}

dienste_starten() {
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
}

# NICHT "sleep 4; systemctl is-active" — Restart=always lässt einen
# Server, der nach zwei Sekunden stirbt, vier Sekunden später wieder als
# "activating" erscheinen. Gefragt wird deshalb der Port selbst; Details
# s. Kommentar am ursprünglichen Aufrufort (Schritt 9 im Update-Zweig).
gesundheit_pruefen() {
  if ! printf '%s\n' "${GESTARTET[@]:-}" | grep -qx 'wov-server'; then
    echo "ABBRUCH: wov-server ist auf diesem Container nicht aktiviert." >&2
    echo "  systemctl enable wov-server.service   (oder deploy/install-services.sh)" >&2
    exit 1
  fi

  local spiel_port
  spiel_port="$(awk '{gsub(/\r/,"")} /^server:/{drin=1;next} /^[^[:space:]#]/{drin=0} drin && $1=="port:"{print $2; exit}' server/data/server.yml)"
  spiel_port="${spiel_port:-2467}"

  echo
  echo "▶ Gesundheitsprüfung: Spielserver auf Port $spiel_port"
  local frist=120 beginn=$SECONDS code
  while :; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$spiel_port/" || true)"
    if [ "$code" = "426" ]; then
      echo "  ✓ 426 Upgrade Required nach $((SECONDS - beginn)) s"
      break
    fi
    if [ "$(systemctl is-failed wov-server.service 2>/dev/null || true)" = "failed" ]; then
      echo "  ✗ wov-server ist failed" >&2
      journalctl -u wov-server -n 40 --no-pager >&2
      exit 1
    fi
    if [ $((SECONDS - beginn)) -ge "$frist" ]; then
      echo "  ✗ nach $frist s keine brauchbare Antwort (zuletzt HTTP '$code')." >&2
      echo "    '000' heißt: nichts lauscht. Alles andere als 426 heißt:" >&2
      echo "    auf dem Port sitzt etwas anderes." >&2
      journalctl -u wov-server -n 40 --no-pager >&2
      exit 1
    fi
    sleep 2
  done

  if printf '%s\n' "${GESTARTET[@]:-}" | grep -qx 'wov-admin'; then
    local admin_adresse="${WOV_ADMIN_ADRESSE:-127.0.0.1}" admin_port="${WOV_ADMIN_PORT:-2468}"
    echo
    echo "▶ Gesundheitsprüfung: Betriebsdienst http://$admin_adresse:$admin_port/status"
    local admin_token antwort beginn2=$SECONDS code2
    admin_token="$( [ -r "$ADMIN_TOKEN_DATEI" ] && cat "$ADMIN_TOKEN_DATEI" || true)"
    while :; do
      antwort="$(curl -s --max-time 3 -w '\n%{http_code}' \
                   -H "x-wov-token: $admin_token" \
                   "http://$admin_adresse:$admin_port/status" || true)"
      code2="$(printf '%s' "$antwort" | tail -n1)"
      if [ "$code2" = "200" ]; then
        echo "  ✓ $(printf '%s' "$antwort" | head -n-1)"
        break
      fi
      if [ "$code2" = "401" ]; then
        echo "  ✓ antwortet (401 — Token in $ADMIN_TOKEN_DATEI passt nicht)"
        break
      fi
      if [ $((SECONDS - beginn2)) -ge 60 ]; then
        echo "  ✗ nach 60 s keine Antwort (zuletzt HTTP '$code2')" >&2
        journalctl -u wov-admin -n 40 --no-pager >&2
        exit 1
      fi
      sleep 2
    done
  fi
}

# ── Trockenlauf: Bauen/Sichern/Tauschen/Zurücknehmen in $1 durchspielen ──
# Baut sich ein Wegwerf-Repo mit zwei Commits (A = "vorher" mit
# client/dist v1, B = "aktuell" mit v2), fährt den Tausch wie Schritt 7
# und den Rückweg wie unten, und prüft nach jedem Schritt das Ergebnis.
# Kein root, kein systemctl, kein npm ci, kein echter vite-Build — das
# prüft der Rest des Skripts längst (Typecheck, Tests, Schritt 7 auf
# live). Hier geht es NUR um dist_sichern/dist_tauschen/version_schreiben
# und den git-Rückwärtsgang, also genau die vier neuen Bausteine.
probe_lauf() {
  local basis="$1"
  # $repo ist das Git-Repo (spielt WURZEL), $sich_verz/$version_datei
  # liegen als GESCHWISTER daneben — genau wie in der echten Umgebung
  # SICHERUNG_VERZEICHNIS und ZUSTAND_VERZEICHNIS außerhalb von
  # /opt/worldofvikings liegen. Lägen sie IM Repo, sammelte "git add -A"
  # die VERSION-Datei mit ein, und der Rückweg unten bräche an einem
  # "git checkout", das lokale Änderungen sähe, die es gar nicht gibt —
  # genau das ist im ersten Trockenlauf so passiert und hier deshalb
  # absichtlich nachgebaut statt verwischt.
  local repo="$basis/repo" sich_verz="$basis/_sicherungen" version_datei="$basis/_zustand/VERSION"
  echo "══ Trockenlauf in $basis ══"
  rm -rf "$basis"
  mkdir -p "$repo/client"
  (
    cd "$repo"
    git init -q -b main .
    git config user.email probe@wov.local
    git config user.name Probe
  )

  # dist/ wie im echten Repo gitignored — sonst sieht "git status
  # --porcelain" nach dem Tausch fälschlich Schmutz, wo das echte Repo
  # dank .gitignore gar nichts sieht.
  echo "dist/" >"$repo/.gitignore"
  echo "dist.neu/" >>"$repo/.gitignore"
  mkdir -p "$repo/client/dist"
  echo "<h1>v1</h1>" >"$repo/client/dist/index.html"
  echo '{"version":"probe"}' >"$repo/package.json"
  : >"$repo/package-lock.json"
  (cd "$repo" && git add -A && git commit -q -m "Stand A (v1)")
  local commit_a
  commit_a="$(cd "$repo" && git rev-parse HEAD)"

  version_schreiben "$version_datei" "$commit_a" "" main probe aktualisieren
  echo "  Stand A ausgerollt: commit=$(version_feld "$version_datei" WOV_VERSION_COMMIT) vorher='$(version_feld "$version_datei" WOV_VERSION_VORHER)'"

  echo "geändert" >>"$repo/package.json"
  (cd "$repo" && git add -A && git commit -q -m "Stand B (v2)")
  local commit_b
  commit_b="$(cd "$repo" && git rev-parse HEAD)"

  mkdir -p "$repo/client/dist.neu"
  echo "<h1>v2</h1>" >"$repo/client/dist.neu/index.html"

  echo
  echo "▶ Sichern + Tauschen (wie Schritt 7 im echten Lauf)"
  dist_sichern "$repo/client/dist" "$sich_verz" "$version_datei" "${commit_a:0:7}"
  dist_tauschen "$repo/client/dist.neu" "$repo/client/dist"
  version_schreiben "$version_datei" "$commit_b" "$commit_a" main probe aktualisieren

  [ "$(cat "$repo/client/dist/index.html")" = "<h1>v2</h1>" ] || {
    echo "FEHLER: dist zeigt nach dem Tausch nicht v2" >&2
    exit 1
  }
  [ -d "$repo/client/dist.neu" ] && {
    echo "FEHLER: dist.neu wurde nicht weggeräumt" >&2
    exit 1
  }
  echo "  ✓ dist zeigt v2, dist.neu ist weg"
  echo "  ✓ VERSION: commit=$(version_feld "$version_datei" WOV_VERSION_COMMIT) vorher=$(version_feld "$version_datei" WOV_VERSION_VORHER)"
  echo "  ✓ Repo sauber nach dem Tausch: $(cd "$repo" && git status --porcelain | wc -l) Zeilen 'git status --porcelain'"

  local sicherung_b
  sicherung_b="$(ls -1t "$sich_verz"/wov-*.tar.gz | head -1)"
  echo "  ✓ Sicherung liegt bereit: $(basename "$sicherung_b")"

  echo
  echo "▶ Rückweg (wie 'wov-update.sh zurueck')"
  local vorher
  vorher="$(version_feld "$version_datei" WOV_VERSION_VORHER)"
  [ "$vorher" = "$commit_a" ] || {
    echo "FEHLER: VERSION kennt Stand A nicht als vorher" >&2
    exit 1
  }

  (cd "$repo" && git checkout -q -B main "$vorher")
  local head_jetzt
  head_jetzt="$(cd "$repo" && git rev-parse HEAD)"
  [ "$head_jetzt" = "$commit_a" ] || {
    echo "FEHLER: HEAD steht nicht auf Stand A" >&2
    exit 1
  }
  echo "  ✓ git checkout -B main $vorher — HEAD ist wieder Stand A"

  dist_sichern "$repo/client/dist" "$sich_verz" "$version_datei" "vor-zurueck"
  rm -rf "$repo/client/dist.neu"
  mkdir -p "$repo/client/dist.neu"
  tar xzf "$sicherung_b" -C "$repo/client/dist.neu" dist --strip-components=1
  dist_tauschen "$repo/client/dist.neu" "$repo/client/dist"
  version_schreiben "$version_datei" "$commit_a" "$commit_b" main probe zurueck

  [ "$(cat "$repo/client/dist/index.html")" = "<h1>v1</h1>" ] || {
    echo "FEHLER: dist zeigt nach dem Rückweg nicht v1" >&2
    exit 1
  }
  echo "  ✓ dist zeigt wieder v1 (aus der Sicherung ausgepackt)"
  echo "  ✓ VERSION: commit=$(version_feld "$version_datei" WOV_VERSION_COMMIT) vorher=$(version_feld "$version_datei" WOV_VERSION_VORHER) aktion=$(version_feld "$version_datei" WOV_VERSION_AKTION)"

  echo
  echo "▶ Aufräumen der Sicherungen (SICHERUNGEN_BEHALTEN=$SICHERUNGEN_BEHALTEN)"
  local i
  for i in $(seq 1 $((SICHERUNGEN_BEHALTEN + 3))); do
    echo "x" >>"$repo/client/dist/index.html"
    dist_sichern "$repo/client/dist" "$sich_verz" "$version_datei" "fuellauf-$i"
  done
  local anzahl
  anzahl="$(ls -1 "$sich_verz"/wov-*.tar.gz | wc -l)"
  [ "$anzahl" -le "$SICHERUNGEN_BEHALTEN" ] || {
    echo "FEHLER: $anzahl Sicherungen liegen, erwartet höchstens $SICHERUNGEN_BEHALTEN" >&2
    exit 1
  }
  echo "  ✓ $anzahl Sicherungen liegen (Höchstgrenze $SICHERUNGEN_BEHALTEN eingehalten)"

  echo
  echo "══ Trockenlauf erfolgreich — nichts davon hat /opt/worldofvikings berührt ══"
}

if [ "$BEFEHL" = "--probe" ]; then
  probe_lauf "$WURZEL"
  exit 0
fi

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

if [ "$BEFEHL" = "zurueck" ]; then
  echo "══ World of Vikings — Rückweg ($INSTANZ) ══"
else
  echo "══ World of Vikings — Update ($INSTANZ) ══"
fi

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

# server/test/konten/ war bis 12.09.2026 ein GETRACKTER Fixture-Ordner,
# den Servertests ueber einen Pfadfehler in WovServer.ServerConfig
# tatsaechlich als Kontendatenbank-Ordner benutzten (`..` von worldsDir
# abgeleitet statt eines eigenen Feldes) — genau das machte einen
# Testlauf zur lokalen Aenderung und diesen Check hier rot. Behoben:
# jeder Test setzt jetzt sein eigenes `kontenDir` in sein eigenes
# tmp-Verzeichnis, und der Ordner selbst steht in .gitignore. Taucht
# trotzdem etwas darin auf, ist das kein gewoehnlicher Schmutz, sondern
# ein Rueckfall in genau diesen Fehler — eigene Meldung statt der
# generischen "Arbeitsbaum ist nicht sauber" weiter unten, die den Grund
# nicht nennen wuerde.
if [ -n "$(ls -A "$WURZEL/server/test/konten" 2>/dev/null)" ]; then
  echo "ABBRUCH: server/test/konten/ ist nicht leer." >&2
  echo >&2
  ls -A "$WURZEL/server/test/konten" | sed 's/^/    /' >&2
  echo >&2
  echo "Das ist der Rueckfall in den kontenDir-Fehler (s. Kopfkommentar" >&2
  echo "WovServer.ServerConfig.kontenDir): ein Test hat worldsDir auf ein" >&2
  echo "eigenes Testverzeichnis umgebogen, kontenDir aber vergessen, und" >&2
  echo "landete damit wieder in diesem geteilten Ordner." >&2
  echo "Es wurde NICHTS getan: kein Pull, kein npm ci, kein Dienst gestoppt." >&2
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

# ── 2b. Rückweg — eigener Zweig, endet mit exit 0 ─────────────────────
# Steht bewusst NACH der Sauberkeitsprüfung: Ein unsauberer Baum ist beim
# Zurückgehen genauso ein Grund zum Abbruch wie beim Update — sonst
# überschreibt "git checkout -B" von Hand gemachte Änderungen kommentarlos.
if [ "$BEFEHL" = "zurueck" ]; then
  if [ ! -f "$VERSION_DATEI" ]; then
    echo "ABBRUCH: $VERSION_DATEI fehlt." >&2
    echo "Ohne sie ist kein vorheriger Stand bekannt — vermutlich lief seit" >&2
    echo "Einführung des Rückwegs noch kein erfolgreiches Update." >&2
    exit 1
  fi

  AKTUELLER_COMMIT="$(git rev-parse HEAD)"
  VERSION_COMMIT="$(version_feld "$VERSION_DATEI" WOV_VERSION_COMMIT)"
  VORHERIGER_COMMIT="$(version_feld "$VERSION_DATEI" WOV_VERSION_VORHER)"
  VORHERIGE_AKTION="$(version_feld "$VERSION_DATEI" WOV_VERSION_AKTION)"

  # Kein Stapel, nur ein Schritt zurück: War die letzte Aktion selbst schon
  # ein Rückweg, kennt VORHERIGER_COMMIT zwar einen Stand (den soeben
  # verlassenen), aber ein zweites "zurueck" darauf wäre kein zweiter
  # Schritt zurück, sondern liefe wieder nach vorn — genau das, was hier
  # ausdrücklich ausgeschlossen sein soll.
  if [ -z "$VORHERIGER_COMMIT" ] || [ "$VORHERIGE_AKTION" = "zurueck" ]; then
    echo "ABBRUCH: $VERSION_DATEI kennt keinen vorherigen Stand." >&2
    echo "Entweder war das der allererste Lauf, oder die letzte Aktion war" >&2
    echo "bereits selbst ein Rückweg — ein zweiter Rückweg in Folge ist nicht" >&2
    echo "vorgesehen (es gibt keinen Stapel, nur einen Schritt zurück)." >&2
    exit 1
  fi

  if [ -n "$VERSION_COMMIT" ] && [ "$AKTUELLER_COMMIT" != "$VERSION_COMMIT" ]; then
    echo "ABBRUCH: HEAD ($AKTUELLER_COMMIT) weicht vom in $VERSION_DATEI" >&2
    echo "vermerkten Stand ($VERSION_COMMIT) ab. Zwischen dem letzten Update" >&2
    echo "und diesem Rückweg wurde offenbar von Hand am Baum gearbeitet —" >&2
    echo "genau der Fall, in dem raten schlimmer ist als nichts tun." >&2
    exit 1
  fi

  LETZTE_SICHERUNG="$(ls -1t "$SICHERUNG_VERZEICHNIS"/wov-*.tar.gz 2>/dev/null | head -1 || true)"
  if [ "$INSTANZ" = "live" ] && [ -z "$LETZTE_SICHERUNG" ]; then
    echo "ABBRUCH: $SICHERUNG_VERZEICHNIS enthält keine Sicherung." >&2
    echo "Ohne sie ist der bisherige client/dist nicht auszupacken — der" >&2
    echo "Commit allein reicht auf live nicht, weil dist/ nicht im Git steht." >&2
    exit 1
  fi

  echo "  von: $AKTUELLER_COMMIT"
  echo "  auf: $VORHERIGER_COMMIT"
  [ -n "$LETZTE_SICHERUNG" ] && echo "  Sicherung: $LETZTE_SICHERUNG"

  dienste_stoppen

  echo
  echo "▶ git checkout -B main $VORHERIGER_COMMIT"
  # -B statt "git checkout main && git reset --hard": Der Baum ist durch
  # die Sauberkeitsprüfung oben bereits sauber, "-B" verlegt main auf den
  # Zielcommit und aktualisiert den Baum in einem Schritt — OHNE detached
  # HEAD. Ein detached HEAD würde den nächsten normalen Lauf mit "HEAD
  # steht auf 'HEAD', erwartet main" abbrechen lassen, obwohl der Rückweg
  # gerade genau das Richtige getan hat.
  git checkout -B main "$VORHERIGER_COMMIT"

  echo
  echo "▶ npm ci"
  npm ci --include=dev

  if [ "$INSTANZ" = "live" ]; then
    echo
    echo "▶ Client zurücksichern aus $LETZTE_SICHERUNG"
    # Erst den JETZIGEN (mutmaßlich schlechten) dist sichern — war der
    # Rückweg selbst ein Fehlgriff, bleibt so auch DAVON ein Weg zurück,
    # statt dass er ersatzlos überschrieben wird.
    dist_sichern "client/dist" "$SICHERUNG_VERZEICHNIS" "$VERSION_DATEI" "vor-zurueck"

    rm -rf client/dist.neu
    mkdir -p client/dist.neu
    tar xzf "$LETZTE_SICHERUNG" -C client/dist.neu dist --strip-components=1
    BAU_BEGONNEN=1
    dist_tauschen "client/dist.neu" "client/dist"
    echo "  wiederhergestellt: $(find client/dist -type f | wc -l) Dateien"
  fi

  dienste_starten
  gesundheit_pruefen

  version_schreiben "$VERSION_DATEI" "$VORHERIGER_COMMIT" "$AKTUELLER_COMMIT" main "$INSTANZ" zurueck

  echo
  echo "Zurückgesetzt — $INSTANZ steht auf $(git log -1 --format='%h %s')."
  echo "server/data/ blieb unberührt: Spielstände und Weltdokumente gehören dem Server."
  exit 0
fi

# ── 3. Pull, danach mit der neuen Fassung weitermachen ───────────────
if [ "${WOV_UPDATE_STUFE2:-}" != "1" ]; then
  echo
  echo "▶ git pull --ff-only origin main"
  # Vor dem Pull merken, was gerade lief — das ist das "vorher" in
  # VERSION und damit das Ziel eines künftigen "zurueck". Muss VOR dem
  # Pull passieren, danach zeigt HEAD schon auf den neuen Stand.
  export WOV_UPDATE_VORHER="$(git rev-parse HEAD)"
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
dienste_stoppen

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

# ── 5b. Store aufbereiten (Ein Ursprung im Container, 12.09.2026) ────
# `assets/store-lab/` und `assets/generiert/terrain/` sind gitignored —
# sie entstehen erst hier, aus `assets/store` (Mikes Speicher, read-only
# eingehängt) bzw. der externen Boden-Quelle. `store:aufbereiten`
# schreibt zusätzlich `shared/src/storePrefabs.ts` & Nachbarn neu — DAVOR
# lief der Typecheck (Schritt 6) hier oben ohne diesen Schritt einfach
# gegen die im Repo committete Fassung, was auf einem frischen Checkout
# stimmt, nach einer lokalen Änderung an `assets/store/prefabs.json`
# aber nicht mehr. Deshalb VOR dem Tor, nicht danach.
echo
echo "▶ Store aufbereiten"
npm run store:aufbereiten
npm run store:boden

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
# Mitschnitt nach TEST_PROTOKOLL (mktemp) — NUR damit die Aufräumfunktion im
# Fehlerfall die roten Testnamen zitieren kann. Die Ausgabe selbst bleibt
# unverändert (tee schreibt und leitet gleichzeitig durch); set -o pipefail
# (s. oben) sorgt dafür, dass der Exit-Code weiterhin der von run-tests.mjs
# ist, nicht der von tee.
TEST_PROTOKOLL="$(mktemp)"
node scripts/run-tests.mjs 2>&1 | tee "$TEST_PROTOKOLL"

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
  dist_sichern "client/dist" "$SICHERUNG_VERZEICHNIS" "$VERSION_DATEI" "$(git rev-parse --short HEAD)"
  dist_tauschen "client/dist.neu" "client/dist"
  echo "  ausgeliefert: $(find client/dist -type f | wc -l) Dateien"
fi

# ── 7b. Webseite bauen (Ein Ursprung im Container, 12.09.2026) ───────
# IMMER, nicht nur auf live: nginx (deploy/nginx/wov-lab.conf) liefert
# `wov-web/build` als root für "/" auf JEDEM Container mit diesem einen
# Ursprung — anders als beim Client gibt es hier keine Dev-Variante, die
# stattdessen aus den Quellen ausliefert (adapter-static rendert immer
# vor, s. wov-web/svelte.config.js). Ohne diesen Schritt bliebe nach
# jedem Pull der alte Stand der Webseite stehen.
#
# EIGENES npm ci: wov-web ist kein Workspace des Wurzel-package.json
# (eigenes package.json, eigene package-lock.json) — Schritt 5 oben hat
# seine Abhängigkeiten deshalb nicht mitinstalliert.
echo
echo "▶ Webseite bauen"
(cd wov-web && npm ci && npm run build && bash tools/ohne-js-pruefen.sh)

# ── 8. Dienste starten ───────────────────────────────────────────────
# Gestartet wird, was auf DIESEM Container aktiviert ist. Die Unit-Dateien
# sind auf dev und live identisch; auf live ist wov-client zwar
# installiert, aber nicht enabled, weil dort nginx den gebauten Client
# ausliefert und ein Vite-Dev-Server nichts zu suchen hat. Diese
# Entscheidung gehört dem Container — hier wird sie nur gelesen.
dienste_starten
gesundheit_pruefen

# Was vor dem Pull lief (Stufe 1 hat es in WOV_UPDATE_VORHER gemerkt) ist
# das "vorher" in VERSION. Fehlt es ausnahmsweise (Stufe 2 irgendwie ohne
# Stufe 1 gestartet), steht dort leer statt eines geratenen Werts — ein
# künftiges "zurueck" bricht dann korrekt mit "kein vorheriger Stand" ab,
# statt auf einen falschen Commit zu springen.
version_schreiben "$VERSION_DATEI" "$(git rev-parse HEAD)" "${WOV_UPDATE_VORHER:-}" "$ZWEIG" "$INSTANZ" aktualisieren

echo
echo "Fertig — $INSTANZ steht auf $(git log -1 --format='%h %s')."
echo "server/data/ blieb unberührt: Spielstände und Weltdokumente gehören dem Server."
