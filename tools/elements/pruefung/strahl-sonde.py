# Prüft: einzelne Bildpunkte eines Szenen-Renders — welcher Körper dort steht, an welchem Punkt und wie weit die Nachbarpunkte entfernt sind.
# Fragt EINZELNE BILDPUNKTE eines Szenen-Renders: Was steht dort, und wo?
#
# Warum: Ein Silhouettenbild (render-szene.py --schwarz) sagt, DASS an einer
# Stelle ein Loch ist. Welche zwei Koerper es bilden, sagt es nicht. Hier wird
# durch denselben Bildpunkt derselbe Strahl geschickt wie beim Rendern — nur
# dass er meldet, welches Objekt er trifft, an welchem Punkt, und wie weit die
# Nachbarpunkte danebenliegen.
#
# Aufruf (Kamera/Ziel/Lens/Aufloesung wie beim Render):
#   flatpak run org.blender.Blender --background --factory-startup \
#     --python strahl-sonde.py -- <glb-ordner> <szene.json> <cam> <ziel> <lens> \
#         <breite> <hoehe> px,py [px,py ...]
import bpy, sys, math, json
from mathutils import Vector, Euler

a = sys.argv[sys.argv.index("--") + 1:]
ELEM, JSONPFAD = a[0], a[1]
CAM = [float(v) for v in a[2].split(",")]
ZIEL = [float(v) for v in a[3].split(",")]
LENS = float(a[4])
BREITE, HOEHE = int(a[5]), int(a[6])
PIXEL = [tuple(int(v) for v in p.split(",")) for p in a[7:]]
SENSOR = 36.0

bpy.ops.wm.read_factory_settings(use_empty=True)
ALIAS = {"StoneVaultEntry": "StoneVaultCell"}
quellen = {}


def b(gx, gy, gz):
    return Vector((gx, -gz, gy))


def spiel(v):
    """Blender-Welt zurueck in Spiel-Koordinaten."""
    return (v.x, v.z, -v.y)


def hole(name):
    datei = ALIAS.get(name, name)
    if datei not in quellen:
        bpy.ops.import_scene.gltf(filepath=f"{ELEM}/{datei}.glb")
        eingelesen = list(bpy.context.selected_objects)
        sicht = [x for x in eingelesen
                 if x.type == "MESH" and not x.name.endswith("_col")]
        for o in eingelesen:
            bpy.context.scene.collection.objects.unlink(o)
        quellen[datei] = sicht
    return quellen[datei]


for t in json.load(open(JSONPFAD)):
    for src in hole(t["name"]):
        o = src.copy()
        o.data = src.data
        bpy.context.scene.collection.objects.link(o)
        o.scale = (-1.0, 1.0, 1.0)
        o.rotation_mode = "XYZ"
        o.rotation_euler = Euler((0.0, 0.0, math.radians(t.get("yaw", 0.0))), "XYZ")
        o.location = b(t["x"], t.get("y", 0.0), t["z"])
        o["teil"] = f"{t['name']} @ {t['x']},{t.get('y', 0.0)},{t['z']} yaw {t.get('yaw', 0.0)}"

bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()

# Kamerabasis wie Blender sie baut: -Z ist die Blickachse, +Y oben.
augen = b(*CAM)
blick = (b(*ZIEL) - augen).normalized()
rechts = blick.cross(Vector((0.0, 0.0, 1.0))).normalized()
oben = rechts.cross(blick).normalized()
# Blender passt den Sensor an die LANGE Bildkante an.
halb = (SENSOR / 2) / LENS

for px, py in PIXEL:
    sx = (px + 0.5 - BREITE / 2) / (BREITE / 2) * halb
    sy = (HOEHE / 2 - py - 0.5) / (BREITE / 2) * halb
    richtung = (blick + rechts * sx + oben * sy).normalized()
    treffer, ort, normale, _, obj, _ = bpy.context.scene.ray_cast(dg, augen, richtung)
    if not treffer:
        print(f"PIXEL {px},{py}: KEIN TREFFER (Loch)")
        continue
    gx, gy, gz = spiel(ort)
    n = spiel(normale)
    print(f"PIXEL {px},{py}: {obj.get('teil', obj.name)}  "
          f"Punkt ({gx:+.4f}, {gy:+.4f}, {gz:+.4f})  "
          f"Normale ({n[0]:+.2f}, {n[1]:+.2f}, {n[2]:+.2f})  "
          f"Abstand {(ort - augen).length:.3f} m")
