# Hilfsmittel: baut Moos-, Frost- und Nass-Variante des Steingrab-Gangs in einem Zug.
#
# ORTE (S2, 04.09.2026): vorher waren Quelle (~/wov-wt-tripo-texture), Ziel
# (~/wov-wt-dungeon2) und Texturordner (~/wov-ai/pipeline-1.0) fest verdrahtet
# — drei Orte, von denen zwei Arbeitsbäume anderer Aufgaben sind. Ein Skript,
# das in einen FREMDEN Arbeitsbaum schreibt, ist kein Rezept, sondern ein
# Übergriff. Quelle und Ziel sind jetzt assets/models DIESES Repos.
# Anders als run-kit.sh schreibt dieses Skript bewusst NACH assets/models: die
# drei Varianten sind ausgelieferte Modelle mit Manifest-Eintrag, kein
# Zwischenergebnis.
set -e
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WURZEL="$(cd "$HIER/../../.." && pwd)"
MODELLE="${WOV_MODELLE:-$WURZEL/assets/models}"
SRC="$MODELLE/SteingrabGang.glb"; DST="$MODELLE"; N="$HIER/quellen/stein_normal.png"
BL(){ flatpak run org.blender.Blender --factory-startup -b --python "$HIER/texture-kit.py" -- "$@"; }
# name albedo roughness
BL "$SRC" "$HIER/quellen/stein_moos_albedo.png"  "$N" "$DST/SteingrabGang_moos.glb"   1.0 2.0 20000 0.9  2>&1 | grep -E "KIT TEX OK|Error"|tail -1
BL "$SRC" "$HIER/quellen/stein_wet_albedo.png"   "$N" "$DST/SteingrabGang_feucht.glb" 1.0 2.0 20000 0.30 2>&1 | grep -E "KIT TEX OK|Error"|tail -1
BL "$SRC" "$HIER/quellen/stein_frost_albedo.png" "$N" "$DST/SteingrabGang_frost.glb"  1.0 2.0 20000 0.85 2>&1 | grep -E "KIT TEX OK|Error"|tail -1
echo DONE
