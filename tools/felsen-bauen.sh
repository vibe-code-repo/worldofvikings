#!/usr/bin/env bash
#
# Erzeugt saemtliche Felsen neu.
#
#     tools/felsen-bauen.sh            # alle
#     tools/felsen-bauen.sh findling   # nur eine Art
#
# ── Warum es diese Datei gibt ────────────────────────────────────────
# Wie `tools/baeume-bauen.sh` und `tools/buesche-bauen.sh`: `assets/` ist
# gitignored, die GLBs liegen NICHT im Repo. Das Ergebnis ist fluechtig,
# das Rezept gehoert hinein — sonst wuesste nach einem frischen Checkout
# niemand mehr, mit welchem Seed und welcher Hoehe die Modelle entstanden
# sind, die in shared/src/prefabs.ts eingetragen sind.
#
# Die Texturen zeichnet `tools/felsen-texturen.py`; nichts davon stammt
# aus Valheim.
#
# ── Zur Groessenstaffelung ───────────────────────────────────────────
# `--hoehe` ist die SICHTBARE Hoehe ueber Grund: Jeder Fels steckt zu
# einem Teil im Boden (Profilwert `versenken`), damit er gewachsen wirkt
# statt hingelegt. Ein "1.0 m"-Findling ist also gut 1,2 m gross.
set -euo pipefail

cd "$(dirname "$0")/.."

command -v blender >/dev/null || {
  echo "Blender fehlt — apt-get install blender" >&2
  exit 1
}

GRUPPE="${1:-alle}"

# name           art        seed  hoehe
FELSEN=$(cat <<'EOF'
Findling1        findling     3    0.9
Findling2        findling    11    1.8
Findling3        findling    19    3.2
Findling4        findling    27    5.0
Felsblock1       block        5    1.0
Felsblock2       block       13    2.1
Felsblock3       block       23    3.6
Felsnadel1       nadel        9    3.5
Felsnadel2       nadel       17    6.0
Felsplatte1      platte       7    0.7
Felsplatte2      platte      15    1.4
Felsplatte3      platte      25    2.4
Steinbank1       bank        21    1.5
Steinbank2       bank       29    2.8
EOF
)

if [ ! -f assets/textures/granit_fels.png ]; then
  echo "Felsentexturen fehlen — werden gezeichnet"
  python3 tools/felsen-texturen.py | sed 's/^/      /'
fi

anzahl=0
while read -r name art seed hoehe; do
  [ -z "$name" ] && continue
  case "$GRUPPE" in
    alle) ;;
    *) [[ "$art" == "$GRUPPE"* ]] || continue ;;
  esac
  printf '  %-16s %-10s seed %-3s %5s m\n' "$name" "$art" "$seed" "$hoehe"
  blender --background --python tools/felsen-generieren.py -- \
    --art "$art" --name "$name" --seed "$seed" --hoehe "$hoehe" \
    2>/dev/null | grep -E '^FERTIG' | sed 's/^/      /'
  anzahl=$((anzahl + 1))
done <<< "$FELSEN"

echo
echo "$anzahl Modelle in assets/models/ erzeugt."
echo "Registriert sind sie in shared/src/prefabs.ts (HINT_DEFS + EIGENE_MODELLE)."
