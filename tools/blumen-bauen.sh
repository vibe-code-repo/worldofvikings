#!/usr/bin/env bash
#
# Erzeugt saemtliche Blumen- und Unkrauthorste neu.
#
#     tools/blumen-bauen.sh            # alle
#     tools/blumen-bauen.sh distel     # nur eine Art
#
# ── Warum es diese Datei gibt ────────────────────────────────────────
# Wie `tools/baeume-bauen.sh` und `tools/buesche-bauen.sh`: `assets/` ist
# gitignored (.gitignore:17), die GLBs liegen NICHT im Repo. Das Ergebnis
# ist fluechtig, das Rezept gehoert hinein — sonst wuesste nach einem
# frischen Checkout niemand mehr, mit welchem Seed und welcher Hoehe die
# Modelle entstanden sind, die in shared/src/prefabs.ts eingetragen sind.
#
# Je Art ZWEI Groessen statt der drei bei den Bueschen. Bei Bewuchs unter
# einem Meter traegt die dritte Stufe nichts mehr bei: Zwischen 35 und
# 55 cm sieht man den Unterschied, zwischen 35 und 45 nicht.
#
# Die Karten zeichnet `tools/blumen-texturen.py`; nichts davon stammt aus
# Valheim.
set -euo pipefail

cd "$(dirname "$0")/.."

command -v blender >/dev/null || {
  echo "Blender fehlt — apt-get install blender" >&2
  exit 1
}

GRUPPE="${1:-alle}"

# name             art            seed  hoehe
HORSTE=$(cat <<'EOF'
Glockenblume1      glockenblume     3    0.35
Glockenblume2      glockenblume    11    0.55
Margerite1         margerite        5    0.40
Margerite2         margerite       13    0.60
Trollblume1        trollblume       7    0.35
Trollblume2        trollblume      17    0.55
Schafgarbe1        schafgarbe       9    0.45
Schafgarbe2        schafgarbe      19    0.70
Wollgras1          wollgras        21    0.35
Wollgras2          wollgras        29    0.50
Brennnessel1       brennnessel     23    0.60
Brennnessel2       brennnessel     31    1.00
Distel1            distel          25    0.60
Distel2            distel          37    1.10
Ampfer1            ampfer          27    0.50
Ampfer2            ampfer          41    0.90
Farn1              farn            33    0.45
Farn2              farn            43    0.75
Seggen1            seggen          35    0.40
Seggen2            seggen          47    0.65
EOF
)

if [ ! -f assets/textures/margerite_karte.png ]; then
  echo "Blumenkarten fehlen — werden gezeichnet"
  python3 tools/blumen-texturen.py | sed 's/^/      /'
fi

anzahl=0
while read -r name art seed hoehe; do
  [ -z "$name" ] && continue
  case "$GRUPPE" in
    alle) ;;
    *) [[ "$art" == "$GRUPPE"* ]] || continue ;;
  esac
  printf '  %-18s %-14s seed %-3s %5s m\n' "$name" "$art" "$seed" "$hoehe"
  blender --background --python tools/blumen-generieren.py -- \
    --art "$art" --name "$name" --seed "$seed" --hoehe "$hoehe" \
    2>/dev/null | grep -E '^FERTIG' | sed 's/^/      /'
  anzahl=$((anzahl + 1))
done <<< "$HORSTE"

echo
echo "$anzahl Modelle in assets/models/ erzeugt."
echo "Registriert sind sie in shared/src/prefabs.ts (HINT_DEFS + EIGENE_MODELLE)."
