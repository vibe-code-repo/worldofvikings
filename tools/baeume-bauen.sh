#!/usr/bin/env bash
#
# Erzeugt sämtliche prozeduralen Bäume neu.
#
#     tools/baeume-bauen.sh            # alle
#     tools/baeume-bauen.sh birke      # nur eine Gruppe (fichte|tanne|birke)
#
# ── Warum es diese Datei gibt ────────────────────────────────────────
# `assets/` ist gitignored (.gitignore:17) — die GLBs liegen NICHT im
# Repo. Nach einem frischen Checkout fehlen alle Bäume, und ohne diese
# Liste wüsste niemand mehr, mit welchem Seed und welcher Höhe sie
# entstanden sind. Dieselbe Rolle wie `tools/extract-audio.mjs` bei den
# Klängen: Das Ergebnis ist flüchtig, das Rezept gehört ins Repo.
#
# Die Werte sind KEINE Vorschläge, sondern genau die, mit denen die
# registrierten Modelle erzeugt wurden. Wer sie ändert, ändert die Bäume,
# die in shared/src/prefabs.ts stehen — dort sind Breite und Höhe fest
# eingetragen (renderScale) und müssten nachgezogen werden.
#
# Sapling ist bei gleichem Seed deterministisch: derselbe Aufruf liefert
# denselben Baum, Lauf für Lauf.
set -euo pipefail

cd "$(dirname "$0")/.."

command -v blender >/dev/null || {
  echo "Blender fehlt — apt-get install blender" >&2
  exit 1
}

GRUPPE="${1:-alle}"

# name            art          seed  höhe  dichte
BAEUME=$(cat <<'EOF'
Fichte1           fichte        3    12    1.0
Fichte2           fichte        7    14    1.0
Fichte3           fichte       12    10    1.0
Tanne1            tanne         5    12    1.0
Tanne2            tanne        11     9    0.85
Tanne3            tanne        19     6    0.6
Tanne4            tanne        23     3.2  0.4
BirkeHoch1        birke        31     4.5  0.55
BirkeHoch2        birke        37     8    0.8
BirkeHoch3        birke        43    12    1.0
BirkeDicht1       birke_dicht  52     4.5  0.45
BirkeDicht2       birke_dicht  58     8    0.65
BirkeDicht3       birke_dicht  64    11    0.8
EOF
)

anzahl=0
while read -r name art seed hoehe dichte; do
  [ -z "$name" ] && continue
  case "$GRUPPE" in
    alle) ;;
    *) [[ "$art" == "$GRUPPE"* ]] || continue ;;
  esac
  printf '  %-14s %-12s seed %-3s %5s m  dichte %s\n' "$name" "$art" "$seed" "$hoehe" "$dichte"
  blender --background --python tools/baum-generieren.py -- \
    --art "$art" --name "$name" --seed "$seed" --hoehe "$hoehe" --dichte "$dichte" \
    2>/dev/null | grep -E '^(FERTIG|HINWEIS)' | sed 's/^/      /'
  anzahl=$((anzahl + 1))
done <<< "$BAEUME"

echo
echo "$anzahl Modelle in assets/models/ erzeugt."
echo "Registriert sind sie in shared/src/prefabs.ts (HINT_DEFS + EIGENE_MODELLE)."
