# Prüft: ob Licht der reinweißen Außenwelt durch die Fugen zwischen den Modulen dringt (Naht-Rendering).
# Naht-Nachweis fuer das Kit DG_StoneVault.
#
# Frage: Dringt Licht der hellen Aussenwelt durch die Fugen ZWISCHEN den
# Modulen (Wand<->Boden, Wand<->Decke, Innenecke zweier Wandpaneele)?
#
# Aufbau: zwei Zellen, komplett zugestellt, dazwischen ein Torbogen. Die Welt
# ist reines Weiss (Strength 1), im Inneren steht nur eine schwache Punktlampe.
# Der View Transform ist STANDARD — ohne das verzerrt AgX die Helligkeiten und
# die Zaehlung waere nicht vergleichbar. Alles, was von innen weiss erscheint,
# ist ein Loch nach draussen; Stein bleibt weit unter der Schwelle.
#
# Gerendert wird mit CYCLES: EEVEE laesst Umgebungslicht auch in geschlossene
# Raeume, dort waere jede Naht unsichtbar bzw. jede Wand hell.
#
# Der dritte Aufrufteil ist der MODULPRAEFIX (Vorgabe `StoneVault`). Seit
# dem Fels-Stil (04.09.2026) gibt es dasselbe Kit zweimal, und die Frage
# „dichtet der unregelmaessige Blockrand genauso?" beantwortet nur der
# Vergleich BEIDER Zaehlungen — nicht ein zweites, halb abgeschriebenes
# Skript, das nebenbei die Kamera verstellt.
#
# flatpak run org.blender.Blender --factory-startup -b --python render-naht.py -- <glb-ordner> <out.png> [praefix]
import bpy, sys, math
from mathutils import Vector, Euler

a = sys.argv[sys.argv.index("--") + 1:]
ELEM, OUT = a[0], a[1]
PRAEFIX = a[2] if len(a) > 2 else "StoneVault"

bpy.ops.wm.read_factory_settings(use_empty=True)

GRID = 2.0
HALB = GRID / 2
TIEFE = 0.30

# Spiel-Koordinaten (y = Hoehe) -> Blender-Weltkoordinaten (z = Hoehe).
def b(gx, gy, gz):
    return Vector((gx, -gz, gy))


mat = bpy.data.materials.new("Stein")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.45, 0.44, 0.42, 1.0)
bsdf.inputs["Roughness"].default_value = 1.0
if "Specular IOR Level" in bsdf.inputs:
    bsdf.inputs["Specular IOR Level"].default_value = 0.0

quellen = {}


def hole(name):
    if name not in quellen:
        bpy.ops.import_scene.gltf(filepath=f"{ELEM}/{name}.glb")
        o = [x for x in bpy.context.selected_objects if x.type == "MESH"][0]
        o.name = name + "_src"
        o.hide_render = True
        quellen[name] = o
    return quellen[name]


def setze(name, gx, gz, grad=0.0):
    """Modul an Spielposition (gx, 0, gz), Drehung um die Hochachse."""
    src = hole(name)
    o = src.copy()
    o.data = src.data.copy()
    bpy.context.scene.collection.objects.link(o)
    o.hide_render = False
    o.scale = (-1.0, 1.0, 1.0)          # wie Babylons __root__ (vorgespiegelt)
    o.rotation_mode = "XYZ"
    o.rotation_euler = Euler((0.0, 0.0, math.radians(grad)), "XYZ")
    o.location = b(gx, 0.0, gz)
    o.data.materials.clear()
    o.data.materials.append(mat)
    return o


# Wandpaneel: Koerper AUSSERHALB der Zelle, Relief zur Zellmitte.
#   Grundstellung (0 Grad): laeuft in x, Relief nach glTF +z.
RICHT = {"N": (0.0, HALB + TIEFE / 2, 180.0),     # Kante game z=+1
         "S": (0.0, -HALB - TIEFE / 2, 0.0),
         "O": (HALB + TIEFE / 2, 0.0, -90.0),
         "W": (-HALB - TIEFE / 2, 0.0, 90.0)}


def wand(cx, cz, seite):
    dx, dz, grad = RICHT[seite]
    setze(f"{PRAEFIX}Wall", cx + dx, cz + dz, grad)


# ── Aufbau: Zelle A (0,0) und Zelle B (0,-2), Torbogen in der Kopplungsebene ──
setze(f"{PRAEFIX}Cell", 0.0, 0.0)
setze(f"{PRAEFIX}Cell", 0.0, -2.0)
for s in ("N", "O", "W"):
    wand(0.0, 0.0, s)
for s in ("S", "O", "W"):
    wand(0.0, -2.0, s)
setze(f"{PRAEFIX}Arch", 0.0, -1.0, 0.0)     # sitzt IN der Kopplungsebene

# ── Kamera: in Zelle A, Blick in die Nordost-Innenecke ──────────────────────
cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 14.0
cam = bpy.data.objects.new("cam", cam_d)
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
cam.location = b(-0.35, 1.50, -0.75)
ziel = b(1.00, 1.75, 1.00)
cam.rotation_euler = (ziel - cam.location).to_track_quat("-Z", "Y").to_euler()

# Schwache Innenbeleuchtung — der Stein soll sichtbar, aber weit von der
# Weiss-Schwelle entfernt sein.
for p, e in [((0.0, 2.2, 0.0), 30.0), ((0.0, 2.2, -2.0), 25.0)]:
    d = bpy.data.lights.new("innen", "POINT")
    d.energy = e
    d.shadow_soft_size = 0.2
    ob = bpy.data.objects.new("innen", d)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = b(*p)

# Reinweisse Umgebung: JEDES Loch nach draussen leuchtet mit 1,0.
w = bpy.data.worlds.new("w")
bpy.context.scene.world = w
w.use_nodes = True
bg = w.node_tree.nodes["Background"]
bg.inputs[0].default_value = (1.0, 1.0, 1.0, 1.0)
bg.inputs[1].default_value = 1.0

sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = 96
sc.cycles.max_bounces = 3
sc.cycles.use_denoising = False
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.render.resolution_x = 1000
sc.render.resolution_y = 1000
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGB"
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f"NAHT-RENDER OK -> {OUT}")
