#!/usr/bin/env bash
#
# Prueft, dass jede gebaute Seite ohne JavaScript lesbar bleibt.
#
# Das ist die Eigenschaft, wegen der diese Seite vorgerendert wird statt
# clientseitig gebaut. Sie geht lautlos verloren — eine Seite, die versehentlich
# `csr`-abhaengig wird, sieht im Browser voellig normal aus. Deshalb wird sie
# gemessen und nicht geglaubt.
#
# Gemessen wird der sichtbare Text: HTML ohne <script>-Bloecke und ohne Tags.
set -euo pipefail

WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$WURZEL/build"
MINDESTENS=800   # Zeichen. Eine Seite mit weniger ist eine leere Huelle.

[[ -d "$BUILD" ]] || { echo "Kein build/ — erst 'npm run build'." >&2; exit 1; }

fehler=0
for datei in "$BUILD"/*.html; do
  name="$(basename "$datei" .html)"
  text=$(sed 's|<script[^>]*>.*</script>||g; s/<[^>]*>//g' "$datei" | tr -s ' \n' ' ')
  n=${#text}
  if (( n < MINDESTENS )); then
    printf '%-14s %5d Zeichen  ZU WENIG (mindestens %d)\n' "$name" "$n" "$MINDESTENS"
    fehler=1
  else
    printf '%-14s %5d Zeichen  ok\n' "$name" "$n"
  fi
done

if (( fehler )); then
  echo
  echo "Mindestens eine Seite ist ohne JavaScript leer. Das ist ein Rueckschritt," >&2
  echo "kein Schoenheitsfehler — siehe README, Abschnitt 'Was hier anders ist'." >&2
  exit 1
fi
