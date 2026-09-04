# Prüft: das Dach einer nachgebauten Szene per senkrechtem Strahl je Rasterpunkt — Höhe des ersten Treffers statt Helligkeit.
# Sucht LOECHER IM DACH einer nachgebauten Spielszene — ohne Rendern.
#
# Warum nicht rendern: Ein Bild beantwortet „ist da ein Loch" nur ueber
# Helligkeit, und Helligkeit haengt an Lampe, Material, Rauschen und Normalen.
# Hier faellt das alles weg: Von hoch oben faellt je Rasterpunkt EIN Strahl
# senkrecht nach unten, und die Antwort ist die Hoehe des ersten Treffers.
#   * Treffer bei 3,75 (Deckenoberkante) -> dicht.
#   * Treffer tiefer / gar kein Treffer   -> von dort faellt Tageslicht ein.
#
# Aufruf:
#   flatpak run org.blender.Blender --background --factory-startup \
#     --python dach-sonde.py -- <glb-ordner> <szene.json> <x0> <x1> <z0> <z1> <schritt>
import bpy, sys, math, json
from mathutils import Vector, Euler

a = sys.argv[sys.argv.index("--") + 1:]
ELEM, JSONPFAD = a[0], a[1]
X0, X1, Z0, Z1, SCHRITT = (float(v) for v in a[2:7])
# Ab welcher Hoehe ein Treffer als „Dach" gilt (Deckenoberkante 3,75).
DACH_MIN = float(a[7]) if len(a) > 7 else 3.7

bpy.ops.wm.read_factory_settings(use_empty=True)
ALIAS = {"StoneVaultEntry": "StoneVaultCell"}
quellen = {}


def b(gx, gy, gz):
    return Vector((gx, -gz, gy))


def hole(name):
    datei = ALIAS.get(name, name)
    if datei not in quellen:
        bpy.ops.import_scene.gltf(filepath=f"{ELEM}/{datei}.glb")
        eingelesen = list(bpy.context.selected_objects)
        sicht = [x for x in eingelesen
                 if x.type == "MESH" and not x.name.endswith("_col")]
        # Die importierten Originale muessen AUS DER SZENE — nur verstecken
        # genuegt nicht: `scene.ray_cast` faende sie sonst als Geisterkoerper
        # in ihrer Importpose am Ursprung wieder (und meldete dort ein Dach,
        # wo keins ist).
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

bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()

nx = int(round((X1 - X0) / SCHRITT))
nz = int(round((Z1 - Z0) / SCHRITT))
loecher = 0
karte = []
for iz in range(nz):
    gz = Z0 + (iz + 0.5) * SCHRITT
    zeile = ""
    for ix in range(nx):
        gx = X0 + (ix + 0.5) * SCHRITT
        treffer, ort, _, _, obj, _ = bpy.context.scene.ray_cast(
            dg, b(gx, 50.0, gz), Vector((0.0, 0.0, -1.0)))
        hoehe = ort.z if treffer else -999.0
        if hoehe >= DACH_MIN:
            zeile += "."
        else:
            loecher += 1
            zeile += "#" if not treffer else ("o" if hoehe > 0.0 else "x")
        print(f"PUNKT {gx:+.3f} {gz:+.3f} {hoehe:+.4f} "
              f"{obj.name if treffer else '-'} "
              f"{tuple(round(v, 2) for v in obj.location) if treffer else ''}")
    karte.append((gz, zeile))

print(f"\nKARTE  x {X0} .. {X1}, Schritt {SCHRITT}  "
      f"('.' Dach >= {DACH_MIN}, 'o' tiefer, 'x' unter 0, '#' nichts)")
for gz, zeile in karte:
    print(f"z{gz:+7.3f} {zeile}")
print(f"\n{nx*nz} Punkte, {loecher} ohne dichtes Dach.")
