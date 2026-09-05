# Prüft: eine Stelle aus dem Spiel, in Blender nachgebaut — jedes Pixel über der Schwelle ist ein Loch, nicht ein Lichteffekt.
# Baut eine STELLE AUS DEM SPIEL in Blender nach und rendert sie.
#
# Warum: Ein Befund im Spielbild ("da faellt Licht durch") laesst sich am
# Bildschirm nicht vermessen — man sieht die Fuge, aber nicht, welche zwei
# Koerper sie bilden. Hier wird dieselbe Modulmenge aus demselben Layout in
# denselben Posen aufgebaut, mit reinweisser Aussenwelt: Jedes Pixel ueber der
# Schwelle ist ein Loch nach draussen (zaehle-naht.py zaehlt sie).
#
# Die Posen kommen als JSON aus dem Rastergenerator (tools/_scratch/szene-json.ts):
#   [{"name": "StoneVaultCell", "x": 0, "y": 0, "z": -1, "yaw": 180}, ...]
# `yaw` ist die Gierung des Spiels in Grad (Drehung um die Hochachse).
#
# Aufruf:
#   flatpak run org.blender.Blender --factory-startup -b --python render-szene.py -- \
#       <glb-ordner> <szene.json> <out.png> <cam gx,gy,gz> <ziel gx,gy,gz> [lens] [--nur name,...]
import bpy, sys, math, json
from mathutils import Vector, Euler

a = sys.argv[sys.argv.index("--") + 1:]
ELEM, JSONPFAD, OUT = a[0], a[1], a[2]
CAM = [float(v) for v in a[3].split(",")]
ZIEL = [float(v) for v in a[4].split(",")]
LENS = float(a[5]) if len(a) > 5 and not a[5].startswith("--") else 20.0
NUR = None
for arg in a:
    if arg.startswith("--nur="):
        NUR = set(arg[len("--nur="):].split(","))
# --dach=cx,cz,breite: senkrechte Aufsicht (orthografisch) auf das DACH.
# Statt eines Himmels ueber dem Grab leuchtet dann eine Platte UNTER ihm: Jedes
# helle Pixel der Aufsicht ist ein Loch, durch das man von unten nach oben
# sehen kann — und seine Bildkoordinate sagt, WO es liegt (Umrechnung im Kopf
# der Ausgabe). Das ist die Messung, die ein Innenbild nicht liefert: es zeigt,
# DASS Licht faellt, nicht durch welche Fuge.
DACH = None
for arg in a:
    if arg.startswith("--dach="):
        DACH = [float(v) for v in arg[len("--dach="):].split(",")]
HIMMEL = False
for arg in a:
    if arg == "--himmel":
        HIMMEL = True
LAMPE = 40.0
for arg in a:
    if arg.startswith("--lampe="):
        LAMPE = float(arg[len("--lampe="):])
AUS = set()
for arg in a:
    if arg.startswith("--ohne="):
        AUS = set(arg[len("--ohne="):].split(","))

bpy.ops.wm.read_factory_settings(use_empty=True)

# Der Eingangsraum teilt sich die GLB mit der Zelle (MODELL_ALIAS im Client) —
# in BEIDEN Kits: Die Fels-Ableitung DG_RockVault (F4) erbt die Rollentrennung,
# aber `make-stonevault.py --stil fels` baut fuer den Eingang so wenig eine
# eigene Datei wie der Ziegelstil. Ohne die zweite Zeile bricht der Import
# genau an dem einen Modul ab, das im Ursprung steht.
ALIAS = {"StoneVaultEntry": "StoneVaultCell", "RockVaultEntry": "RockVaultCell"}


def b(gx, gy, gz):
    """Spiel-Koordinaten (y = Hoehe) -> Blender-Welt (z = Hoehe)."""
    return Vector((gx, -gz, gy))


mat = bpy.data.materials.new("Stein")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
# SCHATTENRISS: Bei einer Loch-Zaehlung ist jeder beleuchtete Stein ein
# Stoerfaktor — er kann selbst hell werden und die Schwelle reissen. Mit
# schwarzem, matt-diffusem Stein ist HELL gleichbedeutend mit „Blick ins
# Freie", und die Zaehlung haengt an keiner Lampe und an keiner Normalen.
SCHWARZ = "--schwarz" in a or DACH is not None
bsdf.inputs["Base Color"].default_value = (
    (0.0, 0.0, 0.0, 1.0) if SCHWARZ else (0.45, 0.44, 0.42, 1.0))
bsdf.inputs["Roughness"].default_value = 1.0
if "Specular IOR Level" in bsdf.inputs:
    bsdf.inputs["Specular IOR Level"].default_value = 0.0

quellen = {}


def hole(name):
    datei = ALIAS.get(name, name)
    if datei not in quellen:
        bpy.ops.import_scene.gltf(filepath=f"{ELEM}/{datei}.glb")
        # `_col`-Netze zeichnet das Spiel nicht — hier auch nicht.
        eingelesen = list(bpy.context.selected_objects)
        sicht = [x for x in eingelesen
                 if x.type == "MESH" and not x.name.endswith("_col")]
        # ALLE Importlinge verstecken, auch die `_col`-Netze: sonst steht das
        # Kollisionsnetz der Treppe als Geisterkoerper in seiner Importpose am
        # Ursprung und legt sich als schraeges Dach ueber die halbe Szene.
        for o in eingelesen:
            o.hide_render = True
        quellen[datei] = sicht
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


teile = json.load(open(JSONPFAD))
gesetzt = 0
for t in teile:
    if NUR is not None and t["name"] not in NUR:
        continue
    if t["name"] in AUS:
        continue
    setze(t["name"], t["x"], t.get("y", 0.0), t["z"], t.get("yaw", 0.0))
    gesetzt += 1

cam_d = bpy.data.cameras.new("cam")
cam_d.lens = LENS
if DACH is not None:
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = DACH[2]
cam = bpy.data.objects.new("cam", cam_d)
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
if DACH is not None:
    CAM = [DACH[0], 30.0, DACH[1]]
    ZIEL = [DACH[0], 0.0, DACH[1]]
cam.location = b(*CAM)
ziel = b(*ZIEL)
cam.rotation_euler = (ziel - cam.location).to_track_quat("-Z", "Y").to_euler()

if DACH is not None:
    # Leuchtplatte UNTER dem Grab; die Welt bleibt schwarz.
    bpy.ops.mesh.primitive_plane_add(size=400.0, location=(0.0, 0.0, -20.0))
    unten = bpy.context.active_object
    um = bpy.data.materials.new("Unterlicht")
    um.use_nodes = True
    unt = um.node_tree
    uem = unt.nodes.new("ShaderNodeEmission")
    uem.inputs[1].default_value = 40.0
    unt.links.new(uem.outputs[0], unt.nodes["Material Output"].inputs[0])
    unten.data.materials.append(um)
    LAMPE = 0.0

# Schwache Innenlampe an der Kamera: der Stein soll sichtbar bleiben, aber weit
# unter der Weiss-Schwelle von zaehle-naht.py.
d = bpy.data.lights.new("innen", "POINT")
d.energy = LAMPE
d.shadow_soft_size = 0.2
ob = bpy.data.objects.new("innen", d)
bpy.context.scene.collection.objects.link(ob)
ob.location = cam.location

w = bpy.data.worlds.new("w")
bpy.context.scene.world = w
w.use_nodes = True
bg = w.node_tree.nodes["Background"]
if HIMMEL or DACH is not None:
    # NUR OBEN hell. Warum: Im Spiel liegt das Grab IM Gelaende — die einzige
    # Lichtquelle ist der Himmel ueber der Decke, nicht eine Kugel aus Weiss um
    # das Modell herum. Mit reinweisser Umgebung leuchtet jede Aussenflaeche,
    # und die eine Fuge, um die es geht, verschwindet im Flutlicht.
    # Deshalb: Welt schwarz, dafuer eine grosse leuchtende Platte hoch oben.
    # Ein Strahl, der aus dem Inneren nach OBEN entkommt, trifft sie und wird
    # weiss; ein waagerechter Strahl (z. B. durch den Eingang) nicht.
    bg.inputs[0].default_value = (0.0, 0.0, 0.0, 1.0)
    bg.inputs[1].default_value = 0.0
    if DACH is not None:
        himmel = None
    else:
        bpy.ops.mesh.primitive_plane_add(size=400.0, location=(0.0, 0.0, 40.0))
        himmel = bpy.context.active_object
    hm = bpy.data.materials.new("Himmel")
    hm.use_nodes = True
    nt = hm.node_tree
    if himmel is not None:
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs[1].default_value = 6.0
        nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs[0])
        himmel.data.materials.append(hm)
else:
    bg.inputs[0].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs[1].default_value = 1.0

sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = int(__import__("os").environ.get("SAMPLES", "64"))
sc.cycles.max_bounces = int(__import__("os").environ.get("BOUNCES", "0" if DACH is not None else "3"))
sc.cycles.use_denoising = False
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.render.resolution_x = int(__import__("os").environ.get("BREITE", "1000"))
sc.render.resolution_y = int(__import__("os").environ.get("HOEHE", "1000"))
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGB"
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f"SZENE-RENDER OK ({gesetzt} Teile) -> {OUT}")
