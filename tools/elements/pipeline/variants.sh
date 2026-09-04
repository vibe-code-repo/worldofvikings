# Hilfsmittel: baut Moos-, Frost- und Nass-Variante des Steingrab-Gangs in einem Zug.
set -e
P="$HOME/wov-ai/pipeline-1.0"; SRC="$HOME/wov-wt-tripo-texture/assets/models/SteingrabGang.glb"
DST="$HOME/wov-wt-dungeon2/assets/models"; N="$P/stein_normal.png"
BL(){ flatpak run org.blender.Blender --factory-startup -b --python "$P/texture-kit.py" -- "$@"; }
# name albedo roughness
BL "$SRC" "$P/stein_moos_albedo.png"  "$N" "$DST/SteingrabGang_moos.glb"   1.0 2.0 20000 0.9  2>&1 | grep -E "KIT TEX OK|Error"|tail -1
BL "$SRC" "$P/stein_wet_albedo.png"   "$N" "$DST/SteingrabGang_feucht.glb" 1.0 2.0 20000 0.30 2>&1 | grep -E "KIT TEX OK|Error"|tail -1
BL "$SRC" "$P/stein_frost_albedo.png" "$N" "$DST/SteingrabGang_frost.glb"  1.0 2.0 20000 0.85 2>&1 | grep -E "KIT TEX OK|Error"|tail -1
echo DONE
