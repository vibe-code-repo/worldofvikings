# Prüft: die Fels-Frontschicht im STREIFLICHT — der Kontaktbogen zu F3.
#
# Warum ein eigenes Skript neben `render-stonevault.py`: Jenes rendert die
# Module in einem freundlichen Dreiviertellicht (Sonne bei 34 Grad Hoehe),
# und genau darin sieht JEDES Relief passabel aus. Die Frage dieses
# Meilensteins ist eine andere — „liest sich die Wand als Fels oder als
# Mauerwerk?" —, und sie entscheidet sich im STREIFLICHT: erst wenn das
# Licht fast parallel zur Wand einfaellt, wirft jede Kante einen Schatten,
# der so lang ist wie ihre Tiefe. Ein Verband zeigt dann waagerechte
# Baender, eine Bruchflaeche zeigt Facetten mit Glanz- und Schattenseite.
#
# Zwei Betriebsarten, beide gegen denselben Vorwurf:
#   --vergleich  drei Paneele nebeneinander, je eins aus einem Ordner
#                (Ziegel / bisher / neu). Das ist der Kontaktbogen.
#   --reihe      VIER Paneele in einer Flucht, Kante an Kante. Nur so
#                sieht man, ob sich das Feld alle 2 m wiederholt und ob
#                die Naht an den Modulgrenzen haelt.
#
# Wie render-stonevault.py wird `scale.x = -1` gesetzt — die Steingrab-GLBs
# sind vorgespiegelt, und Babylons __root__ dreht sie im Spiel zurueck.
#
# flatpak run org.blender.Blender --factory-startup -b --python \
#     render-felsvergleich.py -- <out.png> --vergleich <ordner>:<modul> …
# flatpak run org.blender.Blender --factory-startup -b --python \
#     render-felsvergleich.py -- <out.png> --reihe <ordner>:<modul> …
import bpy
import math
import sys
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
OUT = a[0]
ART = a[1]
STUECKE = [t.split(":", 1) for t in a[2:]]
if ART not in ("--vergleich", "--reihe"):
    raise SystemExit(f"Unbekannte Betriebsart: {ART}")

bpy.ops.wm.read_factory_settings(use_empty=True)

# Ein STUMPFES, ungetextes Grau. Der Kontaktbogen soll die GEOMETRIE
# beurteilen; eine Steintextur darueber beantwortet die Frage „Fels oder
# Mauerwerk?" mit ihrem eigenen Bild und nicht mit dem der Wand.
mat = bpy.data.materials.new("Grau")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.55, 0.53, 0.50, 1.0)
bsdf.inputs["Roughness"].default_value = 0.95

# Abstand der Paneele. Beim Vergleich stehen sie getrennt (man soll sie
# einzeln lesen), in der Reihe stossen sie KANTE AN KANTE (2,0 m) — die
# Naht ist dort der eigentliche Messgegenstand.
SCHRITT = 2.6 if ART == "--vergleich" else 2.0

for i, (ordner, modul) in enumerate(STUECKE):
    bpy.ops.import_scene.gltf(filepath=f"{ordner}/{modul}.glb")
    for o in [x for x in bpy.context.selected_objects if x.type == "MESH"]:
        if o.name.endswith("_col"):
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        o.scale.x = -1.0                       # wie Babylons __root__
        o.location = Vector(((i - (len(STUECKE) - 1) / 2) * SCHRITT, 0, 0))
        o.data.materials.clear()
        o.data.materials.append(mat)

breite = SCHRITT * len(STUECKE)

cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 35
cam = bpy.data.objects.new("cam", cam_d)
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
cam.location = Vector((0.0, -(breite * 0.95 + 1.5), 1.75))
cam.rotation_euler = (Vector((0, 0, 1.75)) - cam.location).to_track_quat("-Z", "Y").to_euler()

# STREIFLICHT: Die Reliefseite schaut im importierten glTF nach blender -y.
# Der Sonnenstrahl faellt mit nur 20 Grad auf diese Flaeche ein — genug, um
# sie zu beleuchten, wenig genug, damit 4 cm Tiefe rund 11 cm Schatten
# werfen. Von links oben, damit Glanz- und Schattenseite auseinanderfallen.
richtung = Vector((0.78, 0.34, -0.53)).normalized()
sun_d = bpy.data.lights.new("s", "SUN")
sun_d.energy = 2.8
sun_d.angle = math.radians(1.0)        # harte Kante, kein weicher Halbschatten
sun = bpy.data.objects.new("s", sun_d)
bpy.context.scene.collection.objects.link(sun)
sun.rotation_euler = richtung.to_track_quat("-Z", "Y").to_euler()

w = bpy.data.worlds.new("w")
bpy.context.scene.world = w
w.use_nodes = True
# Sehr wenig Umgebungslicht: Was im Schatten liegt, soll auch dunkel sein.
w.node_tree.nodes["Background"].inputs[1].default_value = 0.10

sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        sc.render.engine = eng
        break
    except Exception:
        continue
sc.render.resolution_x = int(min(2400, max(1200, 420 * len(STUECKE))))
sc.render.resolution_y = 760
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f"RENDER OK -> {OUT}")
