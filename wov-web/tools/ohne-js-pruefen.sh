#!/usr/bin/env bash
#
# Prueft, dass jede gebaute Seite ohne JavaScript Inhalt hat.
#
# Das ist die Eigenschaft, wegen der diese Seite vorgerendert wird statt
# clientseitig gebaut. Sie geht lautlos verloren — eine Seite, die versehentlich
# `csr`-abhaengig wird, sieht im Browser voellig normal aus. Deshalb wird sie
# gemessen und nicht geglaubt.
#
# ── Was hier am 23.08.2026 repariert wurde ───────────────────────────────
# Die alte Fassung mass mit `sed` das GANZE Dokument und entfernte nur
# <script>-Bloecke und Tags. Zwei Fehler auf einmal:
#
#   1. HTML-Kommentare blieben stehen. src/app.html traegt rund 1900 Zeichen
#      Kommentar. Die Schwelle von 800 war damit ALLEIN durch Kommentare
#      erfuellt — das Skript meldete fuer de/konto "2633 Zeichen ok", wo
#      688 Zeichen sichtbarer Text standen. Es haette eine voellig leere
#      Seite durchgewunken.
#   2. `sed` arbeitet zeilenweise; ein mehrzeiliger <script>-Block wurde
#      gar nicht entfernt, sondern floss als Text mit ein.
#
# Gemessen wird jetzt der Text INNERHALB von <main>, mit Python (mehrzeilig)
# und ohne Kommentare, Skripte und Stile. Der gemeinsame Rahmen (Kopfleiste,
# Fuss, Sprachumschalter) faellt damit aus der Zahl heraus — eine Seite, die
# ihren Inhalt verliert, faellt auf nahe null, egal wie fett der Rahmen ist.
# Genau das soll dieser Waechter sehen.
#
# ── Was er NICHT behauptet ───────────────────────────────────────────────
# "ok" heisst: die Seite hat eigenen Inhalt im HTML. Es heisst NICHT, dass
# sie ohne JavaScript VOLLSTAENDIG ist. Mehrere Seiten holen ihre Daten
# weiterhin im Browser nach — saga und ruhmeshalle seit jeher, karte und
# ruestkammer ebenso; konto kann es gar nicht anders, weil dort etwas
# Persoenliches stuende. Die drei mit einer eigenen Schwelle stehen unten
# namentlich in NACHGELADEN, mit Begruendung je Zeile.
#
# Das ist Altbestand, kein Ergebnis des Sprachumbaus — aber es steht hier,
# damit niemand die Zahl fuer eine Zusicherung haelt, die sie nicht ist.
# Wer eine dieser Seiten vorrendert, darf ihre Schwelle anheben oder sie
# aus der Liste nehmen.
set -euo pipefail

WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$WURZEL/build"

[[ -d "$BUILD" ]] || { echo "Kein build/ — erst 'npm run build'." >&2; exit 1; }

python3 - "$BUILD" <<'PY'
import re, sys, pathlib

BUILD = pathlib.Path(sys.argv[1])

# Regelfall: eine Seite mit weniger eigenem Text ist eine leere Huelle.
MINDESTENS = 250

# Seiten, deren Inhalt an Laufzeitdaten haengt und deshalb kurz ausfaellt.
# Ausdruecklich aufgezaehlt statt die Schwelle fuer alle zu senken: So steht
# die Einschraenkung sichtbar da, statt sich in einer weichen Zahl zu
# verstecken. Jede Zeile braucht einen Grund.
NACHGELADEN = {
    # Eintraege kommen aus /api/saga.json (Altbestand).
    'saga': 90,
    # Tafeln werden im Browser umgeschaltet (Altbestand).
    'ruhmeshalle': 300,
    # Zeigt die Recken des ANGEMELDETEN Kontos. Vorgerendert kann hier
    # nichts Persoenliches stehen; die Seite erklaert genau das und bietet
    # Anmelden und Konto anlegen an. Kurz, aber nicht leer.
    'konto': 180,
}

def eigener_text(datei: pathlib.Path) -> tuple[int, bool]:
    roh = datei.read_text(errors='replace')
    treffer = re.search(r'<main\b.*?</main>', roh, re.S | re.I)
    if not treffer:
        return 0, False
    t = treffer.group(0)
    t = re.sub(r'<!--.*?-->', ' ', t, flags=re.S)
    t = re.sub(r'<(script|style)\b.*?</\1>', ' ', t, flags=re.S | re.I)
    t = re.sub(r'<[^>]*>', ' ', t)
    return len(re.sub(r'\s+', ' ', t).strip()), True

dateien = sorted(BUILD.rglob('*.html'))
if not dateien:
    print('Keine HTML-Datei in build/ gefunden — das ist kein Erfolg.', file=sys.stderr)
    sys.exit(1)

fehler = 0
for datei in dateien:
    name = str(datei.relative_to(BUILD))[:-len('.html')]
    n, hat_main = eigener_text(datei)
    grundname = name.split('/')[-1]
    schwelle = NACHGELADEN.get(grundname, MINDESTENS)

    if not hat_main:
        print(f'{name:<20} {"—":>5}          KEIN <main> — Geruest kaputt?')
        fehler = 1
    elif n < schwelle:
        print(f'{name:<20} {n:5d} Zeichen  ZU WENIG (mindestens {schwelle})')
        fehler = 1
    else:
        vermerk = '  (Inhalt wird nachgeladen)' if grundname in NACHGELADEN else ''
        print(f'{name:<20} {n:5d} Zeichen  ok{vermerk}')

print(f'\n{len(dateien)} Seiten geprueft, gemessen wird der Text in <main>.')
if fehler:
    print('\nMindestens eine Seite hat ohne JavaScript keinen eigenen Inhalt.',
          file=sys.stderr)
    print('Das ist ein Rueckschritt, kein Schoenheitsfehler.', file=sys.stderr)
    sys.exit(1)
PY
