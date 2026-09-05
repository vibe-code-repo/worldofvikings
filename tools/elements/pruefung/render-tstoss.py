# Erzeugt: Nahaufnahme des T-Stosses im Fels-Eckmodul (Suedwand stoesst in die Westwand).
#
# Der Befund vom 05.09.2026 lautete: „Es gibt Waende, wo eine Wand in T-Form
# in eine andere Wand endet; dann sieht man das Endstueck in der langen Seite
# der Wand." Genau diese Stelle steht in `make-stonevault.py`, `ecke()`:
#
#     innenwand(bm, "x", W_BACK, W_RELIEF, hi=W_RELIEF - PROT / 2, ...)
#
# `hi` ist die VORDERSTE Ebene der Reliefschicht der Westwand. Im Ziegel-Stil
# ist die Front dort eine EBENE (Quader gleicher Dicke), die Suedwand endet
# also buendig und ihre Stirn ist unsichtbar. Im Fels-Stil ist die Front ein
# Hoehenfeld, das bis HUB (7,5 cm) zurueckweicht — ueberall dort klafft ein
# Spalt, und die Stirnflaeche der Suedwand (Rueckplatte 24 cm + Relief 9 cm,
# ueber die volle Wandhoehe) steht als Rechteck VOR dem Fels.
#
# Dieses Skript zeigt die Stelle: Kamera in der Zelle, Blick in die
# Suedwest-Innenecke, Streiflicht von der offenen Seite, damit die Stirn
# Schatten wirft statt in der Flaeche zu verschwinden.
#
# flatpak run org.blender.Blender --factory-startup -b --python render-tstoss.py -- <glb-ordner> <out.png> [modul]
import bpy, sys, math
from mathutils import Vector, Euler

a = sys.argv[sys.argv.index("--") + 1:]
ELEM, OUT = a[0], a[1]
MODUL = a[2] if len(a) > 2 else "RockVaultCorner"

# Geisterobjekte aus einer offenen Sitzung waeren hier Messfehler
# (Gedaechtnis „Blender factory-startup Wuerfel").
bpy.ops.wm.read_factory_settings(use_empty=True)

# Spiel-/glTF-Koordinaten (y = Hoehe) -> Blender-Welt (z = Hoehe).
def b(gx, gy, gz):
    return Vector((gx, -gz, gy))

bpy.ops.import_scene.gltf(filepath=f"{ELEM}/{MODUL}.glb")
for o in list(bpy.context.scene.objects):
    if o.type == "MESH" and o.name.endswith("_col"):
        bpy.data.objects.remove(o, do_unlink=True)

mat = bpy.data.materials.new("Stein")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.52, 0.50, 0.47, 1.0)
bsdf.inputs["Roughness"].default_value = 0.95
if "Specular IOR Level" in bsdf.inputs:
    bsdf.inputs["Specular IOR Level"].default_value = 0.1
for o in bpy.context.scene.objects:
    if o.type == "MESH":
        o.data.materials.clear()
        o.data.materials.append(mat)

# Streiflicht aus der offenen Zellhaelfte: Es steht auf der Hoehe der Stelle
# und schraeg dazu, damit eine 9 cm vorstehende Stirn einen Schlagschatten
# wirft. Frontal beleuchtet waere sie genau das, was der Befund bestreitet:
# nicht zu sehen.
lampe = bpy.data.lights.new("fackel", type="POINT")
lampe.energy = 220
lampe.color = (1.0, 0.72, 0.45)
lampe.shadow_soft_size = 0.08
lo = bpy.data.objects.new("fackel", lampe)
lo.location = b(0.85, 2.20, 0.85)
bpy.context.scene.collection.objects.link(lo)

welt = bpy.context.scene.world or bpy.data.worlds.new("W")
bpy.context.scene.world = welt
welt.use_nodes = True
welt.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.02, 0.025, 1)
welt.node_tree.nodes["Background"].inputs[1].default_value = 0.05

kam = bpy.data.cameras.new("kam")
kam.lens = 24
ko = bpy.data.objects.new("kam", kam)
bpy.context.scene.collection.objects.link(ko)
bpy.context.scene.camera = ko
auge = b(1.70, 1.70, 1.70)
ziel = b(-0.72, 1.60, -0.72)
ko.location = auge
richtung = ziel - auge
ko.rotation_euler = richtung.to_track_quat("-Z", "Y").to_euler()

s = bpy.context.scene
s.render.engine = "CYCLES"
s.cycles.samples = 96
s.render.resolution_x = 1200
s.render.resolution_y = 900
s.render.filepath = OUT
s.view_settings.view_transform = "Standard"
bpy.ops.render.render(write_still=True)
print(f"T-STOSS OK -> {OUT}")
