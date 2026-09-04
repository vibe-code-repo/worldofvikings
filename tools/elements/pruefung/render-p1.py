# Prüft: Treppe und Torbogen aus Paket 1 im Rendering, jeweils in zwei Auftritten.
# Pruef-Rendering von Paket 1: StoneVaultStairs und StoneVaultArch.
# Wie render-m3plus.py wird scale.x = -1 gesetzt — die GLBs sind
# vorgespiegelt, und genau das macht Babylons __root__ beim Laden.
#
# Vier Auftritte:
#   Treppe vollstaendig | Treppe ohne Decke (sonst sieht man die Stufen nicht)
#   Torbogen von vorn   | Torbogen von hinten (um 180 Grad gedreht)
# flatpak run org.blender.Blender --factory-startup -b --python render-p1.py -- <elem> <tex> <out>
import bpy, bmesh, sys, math
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
ELEM, TEX, OUT = a[0], a[1], a[2]

bpy.ops.wm.read_factory_settings(use_empty=True)


def material():
    m = bpy.data.materials.new("Stein")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Roughness"].default_value = 0.9
    co = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.5,) * 3
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(f"{TEX}/stein_clean.png")
    t.projection = "BOX"
    nt.links.new(co.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(b.outputs["BSDF"], o.inputs["Surface"])
    return m


def decke_weg_treppe(me):
    """Schraege Decke abnehmen: alles ueber der Treppenlinie + 3,4.
    Treppenlinie im Bauraum: z = 0,875 * (2 - y)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    tot = [f for f in bm.faces
           if all(v.co.z > 0.875 * (2.0 - v.co.y) + 3.4 for v in f.verts)]
    bmesh.ops.delete(bm, geom=tot, context="FACES")
    bm.to_mesh(me)
    bm.free()


def wand_weg(me, seite):
    """Eine Seitenwand abnehmen — nur so sieht man das Stufenprofil von der
    Seite. seite: +1 oder -1 im BAURAUM (x wurde beim Export negiert)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    tot = [f for f in bm.faces
           if all(seite * v.co.x > 0.68 for v in f.verts)]
    bmesh.ops.delete(bm, geom=tot, context="FACES")
    bm.to_mesh(me)
    bm.free()


def hole(name, ort, drehung=0.0, ohne_decke=False, offene_seite=0):
    bpy.ops.import_scene.gltf(filepath=f"{ELEM}/{name}.glb")
    o = [x for x in bpy.context.selected_objects if x.type == "MESH"][0]
    o.data = o.data.copy()
    if ohne_decke:
        decke_weg_treppe(o.data)
    if offene_seite:
        wand_weg(o.data, offene_seite)
    o.scale.x = -1.0                       # wie Babylons __root__
    # ACHTUNG: Der glTF-Import stellt rotation_mode auf QUATERNION. Eine
    # Zuweisung an rotation_euler bliebe dann WIRKUNGSLOS — die gedrehte
    # Ansicht zeigte stillschweigend wieder die Vorderseite.
    o.rotation_mode = "XYZ"
    o.rotation_euler = (0.0, 0.0, drehung)
    o.location = Vector(ort)
    o.data.materials.clear()
    o.data.materials.append(mat)
    return o


mat = material()
# Reihe, von links nach rechts: Treppe vollstaendig | Treppe im Schnitt
# (Decke und die kameraseitige Wand abgenommen) | Torbogen vorn | hinten.
hole("StoneVaultStairs", (-7.6, 0, 0))
hole("StoneVaultStairs", (-2.6, 0, 0), math.pi / 2, ohne_decke=True, offene_seite=1)
hole("StoneVaultArch", (2.6, 0, 0))
hole("StoneVaultArch", (5.0, 0, 0), drehung=math.pi)

cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 35
cam = bpy.data.objects.new("cam", cam_d)
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
ziel = Vector((-1.6, 0.0, 2.4))
cam.location = Vector((-1.6, -19.0, 7.5))
cam.rotation_euler = (ziel - cam.location).to_track_quat("-Z", "Y").to_euler()

sun_d = bpy.data.lights.new("s", "SUN")
sun_d.energy = 3.0
sun = bpy.data.objects.new("s", sun_d)
bpy.context.scene.collection.objects.link(sun)
sun.rotation_euler = (0.55, 0.25, -0.5)

fill_d = bpy.data.lights.new("f", "SUN")
fill_d.energy = 2.2
fill = bpy.data.objects.new("f", fill_d)
bpy.context.scene.collection.objects.link(fill)
fill.rotation_euler = cam.rotation_euler

# Lampen im Treppenlauf: die Innenwaende zeigen zur Mitte und liegen sonst
# vollstaendig im Schatten der gegenueberliegenden Wand.
for p in [(-7.4, 1.0, 1.0), (-7.4, -1.0, 3.8), (-4.2, -0.8, 1.0), (-1.0, -0.8, 4.2),
          (2.6, -1.2, 1.4), (5.0, -1.2, 1.4)]:
    d = bpy.data.lights.new("innen", "POINT")
    d.energy = 260.0
    d.shadow_soft_size = 0.45
    ob = bpy.data.objects.new("innen", d)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(p)

w = bpy.data.worlds.new("w")
bpy.context.scene.world = w
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[1].default_value = 1.4

sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        sc.render.engine = eng
        break
    except Exception:
        continue
sc.render.resolution_x = 1600
sc.render.resolution_y = 1000
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f"RENDER OK -> {OUT}")
