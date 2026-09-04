#!/usr/bin/env bash
# Hilfsmittel: fährt die Textur-Pipeline über alle Kit-Elemente und legt spieltaugliche GLBs nach $WOV_ELEMENTE_AUS/out.
# Pipeline: legt allen 1.0-Steingrab-Kit-Elementen das kachelnde Stein-Material
# auf und exportiert spieltaugliche GLBs. Quelle sind die sauberen Kit-GLBs;
# Ergebnis kann der 1.0-Generator by-name aus assets/models nutzen.
#
# ORTE (S2, 04.09.2026): Dieses Skript lag bis zum Umzug unter
# ~/wov-ai/pipeline-1.0 und hatte drei fremde Orte fest verdrahtet — den
# eigenen alten Ordner, ~/wov-wt-tripo-texture und ~/wov-treppe. Jeder davon
# ist ein Ort, den ein zweiter Rechner nicht hat; das Skript wäre dort still
# an "FEHLT" vorbeigelaufen. Jetzt gilt:
#   Eingabe-GLBs   $WOV_MODELLE        (Vorgabe: assets/models DIESES Repos)
#   Quelltexturen  quellen/ daneben    (liegen seit S1 im Repo)
#   Ergebnis       $WOV_ELEMENTE_AUS   (Vorgabe: ~/wov-elemente) — bewusst
#                  AUSSERHALB des Repos: out/ ist Ergebnis, nicht Rezept
#                  (tools/README.md).
#
# Aufruf: ./run-kit.sh [kachel_m] [face_budget]
set -euo pipefail
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WURZEL="$(cd "$HIER/../../.." && pwd)"
MODELLE="${WOV_MODELLE:-$WURZEL/assets/models}"
AUS="${WOV_ELEMENTE_AUS:-$HOME/wov-elemente}/out"
ALB="$HIER/quellen/stein_albedo.png"; NRM="$HIER/quellen/stein_normal.png"
CUBE="${1:-2.0}"
TARGET="${2:-20000}"   # Face-Budget je Element (Decimation)
BL() { flatpak run org.blender.Blender --factory-startup -b --python "$HIER/texture-kit.py" -- "$@"; }

# Kit-Elemente. Alle acht liegen heute unter assets/models — auch
# SteingrabTreppe, das früher aus ~/wov-treppe/aus geholt wurde.
NAMEN=(SteingrabGang SteingrabEcke SteingrabKammer SteingrabKreuzung
       SteingrabTuer SteingrabAbschluss SteingrabEndkappe SteingrabTreppe)

mkdir -p "$AUS"
for name in "${NAMEN[@]}"; do
  src="$MODELLE/$name.glb"
  if [ ! -f "$src" ]; then echo "[kit] FEHLT: $name ($src)"; continue; fi
  echo "[kit] texturiere $name ..."
  BL "$src" "$ALB" "$NRM" "$AUS/$name.glb" 1.0 "$CUBE" "$TARGET" 2>&1 | grep -E "KIT TEX OK|Error" | tail -1
done
echo "[kit] fertig. Ergebnisse in $AUS/"
ls -la "$AUS/"*.glb | awk '{print $5, $9}'
