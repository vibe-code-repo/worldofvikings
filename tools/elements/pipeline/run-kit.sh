#!/usr/bin/env bash
# Hilfsmittel: fährt die Textur-Pipeline über alle Kit-Elemente und legt spieltaugliche GLBs nach out/.
# Pipeline: legt allen 1.0-Steingrab-Kit-Elementen das kachelnde Stein-Material
# auf und exportiert spieltaugliche GLBs nach out/. Quelle sind die sauberen
# Kit-GLBs; Ergebnis kann der 1.0-Generator by-name aus assets/models nutzen.
#
# Aufruf: ./run-kit.sh [kachel_m]     (Default 2.0 Weltmeter je Kachel)
set -euo pipefail
P="$HOME/wov-ai/pipeline-1.0"
ALB="$P/stein_albedo.png"; NRM="$P/stein_normal.png"
CUBE="${1:-2.0}"
TARGET="${2:-20000}"   # Face-Budget je Element (Decimation)
BL() { flatpak run org.blender.Blender --factory-startup -b --python "$P/texture-kit.py" -- "$@"; }

# Kit-Elemente: Name -> Quell-GLB.
KIT_DIR="$HOME/wov-wt-tripo-texture/assets/models"
declare -A SRC=(
  [SteingrabGang]="$KIT_DIR/SteingrabGang.glb"
  [SteingrabEcke]="$KIT_DIR/SteingrabEcke.glb"
  [SteingrabKammer]="$KIT_DIR/SteingrabKammer.glb"
  [SteingrabKreuzung]="$KIT_DIR/SteingrabKreuzung.glb"
  [SteingrabTuer]="$KIT_DIR/SteingrabTuer.glb"
  [SteingrabAbschluss]="$KIT_DIR/SteingrabAbschluss.glb"
  [SteingrabEndkappe]="$KIT_DIR/SteingrabEndkappe.glb"
  [SteingrabTreppe]="$HOME/wov-treppe/aus/SteingrabTreppe.glb"
)

mkdir -p "$P/out"
for name in "${!SRC[@]}"; do
  src="${SRC[$name]}"
  if [ ! -f "$src" ]; then echo "[kit] FEHLT: $name ($src)"; continue; fi
  echo "[kit] texturiere $name ..."
  BL "$src" "$ALB" "$NRM" "$P/out/$name.glb" 1.0 "$CUBE" "$TARGET" 2>&1 | grep -E "KIT TEX OK|Error" | tail -1
done
echo "[kit] fertig. Ergebnisse in $P/out/"
ls -la "$P/out/"*.glb | awk '{print $5, $9}'
