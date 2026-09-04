# Prüft: einen Saal von innen im Vergleich — Kit-Steinmaterial gegen die in der GLB gebackene KI-Textur.
# Ein Saal von INNEN, einmal mit dem Kit-Steinmaterial und einmal mit dem
# Material, das in der GLB steckt (KI-Backung aus run-texture-mesh.sh).
#
# Warum ueberhaupt zwei Bilder: Die Frage aus dem Auftrag ist nicht "sieht die
# KI-Textur gut aus", sondern "ist sie BESSER als das, was heute drauf liegt".
# Das Kit-Material ist ein Laufzeit-Shader (DungeonSteinMaterial, nach der
# Weltnormale); in Blender ist seine ehrlichste Entsprechung eine
# BOX-Projektion derselben Steinkachel — dieselbe Kachel, dieselbe Groesse,
# derselbe Wiederholabstand. Wer die KI gegen ein weisses Standardmaterial
# haelt, gewinnt den Vergleich automatisch und hat nichts gemessen.
#
# Die GLBs sind in x VORGESPIEGELT (Steingrab-Konvention) -> scale.x = -1,
# genau wie Babylons __root__ beim Laden.
#
# flatpak run org.blender.Blender --factory-startup -b --python \
#   render-saal-vergleich.py -- <glb> <out.png> kit|eigen <tex-ordner> \
#   <cam gx,gy,gz> <ziel gx,gy,gz> [lens]
import bpy, sys, math
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
GLB, OUT, MODUS, TEX = a[0], a[1], a[2], a[3]
CAM = [float(v) for v in a[4].split(",")]
ZIEL = [float(v) for v in a[5].split(",")]
LENS = float(a[6]) if len(a) > 6 else 20.0

bpy.ops.wm.read_factory_settings(use_empty=True)


def b(gx, gy, gz):
    """Spiel-Koordinaten (y = Hoehe) -> Blender-Welt (z = Hoehe)."""
    return Vector((gx, -gz, gy))


def kit_material():
    """Die Kit-Kachel als BOX-Projektion — die Blender-Entsprechung des
    normalbasierten DungeonSteinMaterial. Kachelgroesse 2 m wie im Spiel."""
    m = bpy.data.materials.new("KitStein")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    p.inputs["Roughness"].default_value = 0.9
    co = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.5,) * 3
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(f"{TEX}/stein_albedo.png")
    t.projection = "BOX"
    t.projection_blend = 0.2
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = bpy.data.images.load(f"{TEX}/stein_normal.png")
    n.image.colorspace_settings.name = "Non-Color"
    n.projection = "BOX"
    n.projection_blend = 0.2
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(co.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], n.inputs["Vector"])
    nt.links.new(t.outputs["Color"], p.inputs["Base Color"])
    nt.links.new(n.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], p.inputs["Normal"])
    nt.links.new(p.outputs["BSDF"], o.inputs["Surface"])
    return m


vorher = set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=GLB)
neu = [o for o in bpy.context.scene.objects if o not in vorher]
for o in neu:
    if o.parent is None:
        o.scale.x *= -1

# TRELLIS normiert das Mesh auf den Einheitswuerfel — die 8 m des Saals
# kommen als 1,0 zurueck. Fuer den Vergleich wird zurueckskaliert (und der
# Boden wieder auf y = 0 gelegt), sonst vergleicht man nicht zwei Texturen,
# sondern zwei Massstaebe. Fuer eine Integration waere genau das eine
# Nacharbeit, die im Urteil zu nennen ist.
SKALA = 1.0
for arg in a:
    if arg.startswith("--skala="):
        SKALA = float(arg[len("--skala="):])
if SKALA != 1.0:
    for o in neu:
        if o.parent is None:
            o.scale *= SKALA
    bpy.context.view_layer.update()
    unten = min((o.matrix_world @ Vector(e)).z
                for o in neu if o.type == "MESH" for e in o.bound_box)
    for o in neu:
        if o.parent is None:
            o.location.z -= unten - (-0.25)

if MODUS == "kit":
    mat = kit_material()
    for o in neu:
        if o.type != "MESH":
            continue
        o.data.materials.clear()
        o.data.materials.append(mat)

# Objektkoordinaten fuer die BOX-Projektion sind hier keine gute Wahl (der
# Saal ist 12 m gross, "Generated" normiert auf die Bounding-Box) — deshalb
# steht oben `Generated` mit Scale 0.5 und wird hier auf WELTmass gestellt:
# die Kachel soll ueberall gleich gross sein, unabhaengig vom Zuschnitt.
if MODUS == "kit":
    for o in neu:
        if o.type != "MESH":
            continue
        dx = max(o.dimensions.x, o.dimensions.y, o.dimensions.z)
        mp = mat.node_tree.nodes["Mapping"]
        mp.inputs["Scale"].default_value = (dx / 2.0,) * 3

# Punktlicht in Kopfhoehe wie eine Fackel im Grab.
licht = bpy.data.lights.new("Fackel", type="POINT")
licht.energy = 600
licht.shadow_soft_size = 0.4
lo = bpy.data.objects.new("Fackel", licht)
lo.location = b(CAM[0], CAM[1] + 0.6, CAM[2])
bpy.context.scene.collection.objects.link(lo)

cam = bpy.data.cameras.new("Cam")
cam.lens = LENS
co = bpy.data.objects.new("Cam", cam)
co.location = b(*CAM)
bpy.context.scene.collection.objects.link(co)
richtung = b(*ZIEL) - co.location
co.rotation_euler = richtung.to_track_quat("-Z", "Y").to_euler()
bpy.context.scene.camera = co

s = bpy.context.scene
s.render.engine = "CYCLES"
s.cycles.samples = 96
s.render.resolution_x = 1000
s.render.resolution_y = 700
s.render.filepath = OUT
# factory-startup mit use_empty laesst keine Welt zurueck — eine anlegen,
# sonst rendert Cycles gegen None.
if s.world is None:
    s.world = bpy.data.worlds.new("Welt")
s.world.use_nodes = True
s.world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.02, 0.03, 1)
bpy.ops.render.render(write_still=True)
print(f"BILD {OUT} modus={MODUS} glb={GLB}")
