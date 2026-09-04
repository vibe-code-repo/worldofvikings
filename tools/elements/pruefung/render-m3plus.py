# Prüft: die vier neuen Zellvarianten im Rendering — zweite Reihe ohne Decke, scale.x = -1 wie Babylons `__root__`.
# Pruef-Rendering der vier neuen StoneVault-Zellvarianten.
# Die GLBs sind in x VORGESPIEGELT (Steingrab-Konvention). Damit das Bild zeigt,
# was der Client zeigt, wird scale.x = -1 gesetzt — genau das macht Babylons
# __root__ beim Laden. Dadurch stehen auch die Normalen wieder nach aussen.
#
# Zwei Reihen: hinten die Module vollstaendig, vorne dieselben Module OHNE
# Deckenplatte — nur so sind die Innenwaende von schraeg oben sichtbar.
import bpy, bmesh, sys
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
ELEM, TEX, OUT = a[0], a[1], a[2]

# (Name, x-Mitte) — Hall ist 4 m breit, deshalb mehr Platz rechts
MODULE = [("StoneVaultCorridor", -6.6), ("StoneVaultCorner", -3.9),
          ("StoneVaultJunction", -1.2), ("StoneVaultHall", 2.4)]

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


def decke_weg(me):
    """Alle Faces loeschen, die komplett auf/ueber der Deckenunterkante liegen."""
    bm = bmesh.new()
    bm.from_mesh(me)
    tot = [f for f in bm.faces if all(v.co.z > 3.4999 for v in f.verts)]
    bmesh.ops.delete(bm, geom=tot, context="FACES")
    bm.to_mesh(me)
    bm.free()


mat = material()
for name, cx in MODULE:
    for reihe, (cy, ohne_decke) in enumerate([(5.2, False), (-5.2, True)]):
        bpy.ops.import_scene.gltf(filepath=f"{ELEM}/{name}.glb")
        o = [x for x in bpy.context.selected_objects if x.type == "MESH"][0]
        o.name = f"{name}_{reihe}"
        o.data = o.data.copy()
        if ohne_decke:
            decke_weg(o.data)
        o.scale.x = -1.0                       # wie Babylons __root__
        o.location = Vector((cx, cy, 0))
        o.data.materials.clear()
        o.data.materials.append(mat)

cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 32
cam = bpy.data.objects.new("cam", cam_d)
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
ziel = Vector((-1.6, 0.0, 1.0))
cam.location = Vector((-1.6, -19.0, 15.5))
cam.rotation_euler = (ziel - cam.location).to_track_quat("-Z", "Y").to_euler()

# Sonne fuer die Plastik des Reliefs, dazu ein Fuelllicht aus Kamerarichtung —
# ohne das bleiben die nach innen zeigenden Ziegel schwarz.
sun_d = bpy.data.lights.new("s", "SUN")
sun_d.energy = 3.0
sun = bpy.data.objects.new("s", sun_d)
bpy.context.scene.collection.objects.link(sun)
sun.rotation_euler = (0.55, 0.25, -0.5)

fill_d = bpy.data.lights.new("f", "SUN")
fill_d.energy = 1.8
fill = bpy.data.objects.new("f", fill_d)
bpy.context.scene.collection.objects.link(fill)
fill.rotation_euler = cam.rotation_euler

# Je eine Lampe IN der offenen Zelle: die Innenwaende zeigen zur Zellmitte und
# werden von der jeweils gegenueberliegenden Wand komplett abgeschattet.
for _, cx in MODULE:
    d = bpy.data.lights.new("innen", "POINT")
    d.energy = 320.0
    d.shadow_soft_size = 0.45
    p = bpy.data.objects.new("innen", d)
    bpy.context.scene.collection.objects.link(p)
    p.location = Vector((cx, -5.2, 1.7))

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
