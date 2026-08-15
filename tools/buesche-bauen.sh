#!/usr/bin/env bash
#
# Erzeugt saemtliche prozeduralen Buesche neu.
#
#     tools/buesche-bauen.sh              # alle
#     tools/buesche-bauen.sh wacholder    # nur eine Art
#
# ── Warum es diese Datei gibt ────────────────────────────────────────
# Dieselbe Rolle wie `tools/baeume-bauen.sh`: `assets/` ist gitignored
# (.gitignore:17), die GLBs liegen NICHT im Repo. Nach einem frischen
# Checkout fehlen alle Buesche, und ohne diese Liste wuesste niemand
# mehr, mit welchem Seed und welcher Hoehe sie entstanden sind. Das
# Ergebnis ist fluechtig, das Rezept gehoert ins Repo.
#
# Die Werte sind KEINE Vorschlaege, sondern genau die, mit denen die
# registrierten Modelle erzeugt wurden. Wer sie aendert, aendert die
# Buesche, die in shared/src/prefabs.ts stehen — dort sind Breite und
# Hoehe fest eingetragen (renderScale) und muessten nachgezogen werden.
#
# Anders als bei den Baeumen sind die Texturen KEINE Fremdtexturen: Sie
# werden von `tools/busch-texturen.py` gezeichnet und lassen sich
# jederzeit wiederherstellen. Deshalb erzeugt dieses Skript sie
# gleich mit, wenn sie fehlen.
#
# Sapling ist bei gleichem Seed deterministisch: derselbe Aufruf liefert
# denselben Busch, Lauf fuer Lauf.
set -euo pipefail

cd "$(dirname "$0")/.."

command -v blender >/dev/null || {
  echo "Blender fehlt — apt-get install blender" >&2
  exit 1
}

GRUPPE="${1:-alle}"

# ── Die Groessenstufen ───────────────────────────────────────────────
# Je Art drei Stufen. Sie sind nicht dieselbe Pflanze in drei Groessen:
# `--dichte` senkt bei den kleinen Stufen auch die Trieb-, Ast- und
# Blattzahl, sonst haette ein kniehoher Jungbusch dasselbe
# Dreiecksbudget wie ein ausgewachsener — im Unterholz, wo sie zu
# Dutzenden stehen, ist das der teuerste Fehler.
#
# name           art          seed  hoehe  dichte
BUESCHE=$(cat <<'EOF'
Hasel1           hasel         3    1.4    0.70
Hasel2           hasel         9    2.2    0.85
Hasel3           hasel        17    3.0    1.0
Wacholder1       wacholder     5    0.7    0.65
Wacholder2       wacholder    13    1.2    0.8
Wacholder3       wacholder    21    1.8    1.0
Weide1           weide         7    1.2    0.70
Weide2           weide        15    2.0    0.85
Weide3           weide        23    2.8    1.0
Holunder1        holunder     11    1.6    0.72
Holunder2        holunder     19    2.4    0.85
Holunder3        holunder     29    3.2    1.0
Brombeere1       brombeere     4    0.6    0.70
Brombeere2       brombeere    12    0.9    0.8
Brombeere3       brombeere    26    1.3    1.0
Heidekraut1      heidekraut    6    0.25   0.70
Heidekraut2      heidekraut   14    0.40   0.85
Heidekraut3      heidekraut   22    0.55   1.0
Ginster1         ginster       8    0.8    0.70
Ginster2         ginster      16    1.4    0.85
Ginster3         ginster      24    2.0    1.0
Schlehe1         schlehe      10    1.6    0.70
Schlehe2         schlehe      18    2.4    0.85
Schlehe3         schlehe      27    3.0    1.0
Hartriegel1      hartriegel   30    1.4    0.70
Hartriegel2      hartriegel   34    2.2    0.85
Hartriegel3      hartriegel   41    3.0    1.0
Heidelbeere1     heidelbeere  44    0.25   0.70
Heidelbeere2     heidelbeere  48    0.40   0.85
Heidelbeere3     heidelbeere  53    0.55   1.0
EOF
)

# Die Buschtexturen liegen wie die Modelle NICHT im Repo, lassen sich
# aber wiederherstellen — sie werden gezeichnet, nicht gerippt.
if [ ! -f assets/textures/hasel_leaf.png ]; then
  echo "Buschtexturen fehlen — werden gezeichnet"
  python3 tools/busch-texturen.py | sed 's/^/      /'
fi

anzahl=0
while read -r name art seed hoehe dichte; do
  [ -z "$name" ] && continue
  case "$GRUPPE" in
    alle) ;;
    *) [[ "$art" == "$GRUPPE"* ]] || continue ;;
  esac
  printf '  %-14s %-11s seed %-3s %5s m  dichte %s\n' "$name" "$art" "$seed" "$hoehe" "$dichte"
  blender --background --python tools/busch-generieren.py -- \
    --art "$art" --name "$name" --seed "$seed" --hoehe "$hoehe" --dichte "$dichte" \
    2>/dev/null | grep -E '^(FERTIG|HINWEIS)' | sed 's/^/      /'
  anzahl=$((anzahl + 1))
done <<< "$BUESCHE"

echo
echo "$anzahl Modelle in assets/models/ erzeugt."
echo "Registriert sind sie in shared/src/prefabs.ts (HINT_DEFS + EIGENE_MODELLE)."
