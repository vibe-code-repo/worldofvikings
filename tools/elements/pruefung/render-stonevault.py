# Prüft: die StoneVault-Module nebeneinander im Rendering.
# Pruef-Rendering der drei StoneVault-Module nebeneinander.
# Die GLBs sind in x VORGESPIEGELT (Steingrab-Konvention). Damit das Bild zeigt,
# was der Client zeigt, wird hier scale.x = -1 gesetzt — genau das macht Babylons
# __root__ beim Laden. Dadurch stehen auch die Normalen wieder nach aussen.
import bpy, sys, math
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
ELEM, TEX, OUT = a[0], a[1], a[2]
MODULE = ["StoneVaultCell", "StoneVaultWall", "StoneVaultArch"]

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


mat = material()

STEP = 3.2
for i, name in enumerate(MODULE):
    bpy.ops.import_scene.gltf(filepath=f"{ELEM}/{name}.glb")
    o = [x for x in bpy.context.selected_objects if x.type == "MESH"][0]
    o.scale.x = -1.0                       # wie Babylons __root__
    o.location = Vector(((i - (len(MODULE) - 1) / 2) * STEP, 0, 0))
    o.data.materials.clear()
    o.data.materials.append(mat)

cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 35
cam = bpy.data.objects.new("cam", cam_d)
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
cam.location = Vector((-4.5, -11.0, 4.2))
cam.rotation_euler = (Vector((0, 0, 1.7)) - cam.location).to_track_quat("-Z", "Y").to_euler()

sun_d = bpy.data.lights.new("s", "SUN")
sun_d.energy = 3.2
sun = bpy.data.objects.new("s", sun_d)
bpy.context.scene.collection.objects.link(sun)
sun.rotation_euler = (0.6, 0.2, -0.4)
w = bpy.data.worlds.new("w")
bpy.context.scene.world = w
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[1].default_value = 0.45

sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        sc.render.engine = eng
        break
    except Exception:
        continue
sc.render.resolution_x = 1400
sc.render.resolution_y = 620
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f"RENDER OK -> {OUT}")
