# Prüft: ob an einer Modulnaht eine Stirnfläche VOR der Nachbarwand steht (Stoß-Rendering).
# Baut ein LAYOUT aus dem Rastergenerator (dungeons/<id>.json) in Blender nach
# und rendert einzelne Stellen im STREIFLICHT.
#
# Warum ein eigenes Skript neben render-szene.py: Dort ist die Welt reinweiss
# und der Stein schwarz — das ist die Naht-ZAEHLUNG (Licht durch Fugen). Hier
# geht es um die entgegengesetzte Frage: Steht an einer Naht MATERIAL VOR der
# Nachbarwand? Das sieht man nur bei streifendem Licht auf grauem Stein, und
# man sieht es nur, wenn der View Transform STANDARD ist — AgX zieht genau die
# flachen Schattenkanten glatt, um die es geht.
#
# Die Posen kommen aus der Layout-JSON des Servers (rooms + doors, Quaternion
# um die Hochachse). `yaw` wird daraus gerechnet, damit dieselbe Datei
# gerendert wird, die im Spiel steht — nicht eine nachgebaute Absicht.
#
# flatpak run org.blender.Blender --factory-startup -b --python render-stoss.py -- \
#     <glb-ordner> <layout.json> <out-ordner> \
#     --blick=name,cx,cy,cz,zx,zy,zz[,lx,ly,lz[,kraft]] [--blick=...] [--proben=N]
# Kamera-/Ziel-/Lampenkoordinaten sind SPIELKOORDINATEN (y = Hoehe).
import bpy, sys, math, json, os
from mathutils import Vector, Euler

a = sys.argv[sys.argv.index("--") + 1:]
ELEM, JSONPFAD, OUT = a[0], a[1], a[2]
PROBEN = 96
PRAEFIX = None
BLICKE = []
for arg in a[3:]:
    if arg.startswith("--blick="):
        f = arg[len("--blick="):].split(",")
        BLICKE.append((f[0], [float(v) for v in f[1:4]], [float(v) for v in f[4:7]],
                       [float(v) for v in f[7:10]] if len(f) > 9 else None,
                       float(f[10]) if len(f) > 10 else 120.0))
    elif arg.startswith("--proben="):
        PROBEN = int(arg[len("--proben="):])
    elif arg.startswith("--praefix="):
        # Dasselbe Layout im ANDEREN Stil: die Frage „liegt es am Fels?"
        # beantwortet nur derselbe Blick auf dieselbe Stelle mit den
        # Ziegel-GLBs. `RockVaultWallB/C` gibt es dort nicht — der
        # Ziegelstil hat genau ein Paneel (s. make-stonevault.py).
        PRAEFIX = arg[len("--praefix="):]

bpy.ops.wm.read_factory_settings(use_empty=True)
# Der Eingangsraum teilt sich die GLB mit der Zelle (MODELL_ALIAS im Client).
ALIAS = {"StoneVaultEntry": "StoneVaultCell", "RockVaultEntry": "RockVaultCell"}


def b(gx, gy, gz):
    """Spiel-Koordinaten (y = Hoehe) -> Blender-Welt (z = Hoehe)."""
    return Vector((gx, -gz, gy))


mat = bpy.data.materials.new("Stein")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.52, 0.51, 0.48, 1.0)
bsdf.inputs["Roughness"].default_value = 1.0
if "Specular IOR Level" in bsdf.inputs:
    bsdf.inputs["Specular IOR Level"].default_value = 0.0

quellen = {}


def hole(name):
    if PRAEFIX and name.startswith("RockVault"):
        name = PRAEFIX + name[len("RockVault"):]
        if name.startswith("StoneVaultWall") and name != "StoneVaultWall":
            name = "StoneVaultWall"
    datei = ALIAS.get(name, name)
    if datei not in quellen:
        bpy.ops.import_scene.gltf(filepath=f"{ELEM}/{datei}.glb")
        ein = list(bpy.context.selected_objects)
        # `_col`-Netze zeichnet das Spiel nicht — hier auch nicht; versteckt
        # werden ALLE Importlinge, sonst steht das Kollisionsnetz der Treppe
        # als Geisterkoerper in seiner Importpose am Ursprung.
        quellen[datei] = [x for x in ein
                          if x.type == "MESH" and not x.name.endswith("_col")]
        for o in ein:
            o.hide_render = True
    return quellen[datei]


def setze(name, gx, gy, gz, grad):
    for src in hole(name):
        o = src.copy()
        o.data = src.data.copy()
        bpy.context.scene.collection.objects.link(o)
        o.hide_render = False
        o.scale = (-1.0, 1.0, 1.0)      # Babylons __root__ (Geometrie vorgespiegelt)
        o.rotation_mode = "XYZ"
        o.rotation_euler = Euler((0.0, 0.0, math.radians(grad)), "XYZ")
        o.location = b(gx, gy, gz)
        o.data.materials.clear()
        o.data.materials.append(mat)


def yaw(r):
    """Gierung in Grad aus dem Quaternion des Layouts (Drehung um die Hochachse)."""
    return math.degrees(2.0 * math.atan2(r["y"], r["w"]))


lay = json.load(open(JSONPFAD))["layout"]
for r in lay["rooms"]:
    setze(r["room"], r["pos"]["x"], r["pos"]["y"], r["pos"]["z"], yaw(r["rot"]))
for t in lay.get("doors", []):
    setze(t["prefabName"], t["pos"]["x"], t["pos"]["y"], t["pos"]["z"], yaw(t["rot"]))
print(f"LAYOUT {len(lay['rooms'])} Raeume, {len(lay.get('doors', []))} Tueren")

sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = PROBEN
sc.render.resolution_x, sc.render.resolution_y = 1100, 700
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w")
sc.world = w
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[1].default_value = 0.0

cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 24.0
cam = bpy.data.objects.new("cam", cam_d)
sc.collection.objects.link(cam)
sc.camera = cam
lampe_d = bpy.data.lights.new("streif", "POINT")
lampe_d.energy = 120.0
lampe_d.shadow_soft_size = 0.03    # harte Schatten: eine weiche Lampe malt die Stufe weg
lampe = bpy.data.objects.new("streif", lampe_d)
sc.collection.objects.link(lampe)

os.makedirs(OUT, exist_ok=True)
for name, c, z, l, kraft in BLICKE:
    cam.location = b(*c)
    cam.rotation_euler = (b(*z) - cam.location).to_track_quat("-Z", "Y").to_euler()
    lampe.location = b(*(l if l else c))
    lampe_d.energy = kraft
    sc.render.filepath = f"{OUT}/{name}.png"
    bpy.ops.render.render(write_still=True)
    print(f"BLICK OK -> {OUT}/{name}.png")
