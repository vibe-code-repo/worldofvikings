# Erzeugt: die orthografische Frontansicht mehrerer Wandpaneele nebeneinander — zeigt, ob das Ziegelmuster über die Paneelgrenze läuft.
# Nahtlosigkeits-Test: N Wandpaneele nebeneinander, frontal (Ortho-Elevation).
# Zeigt, ob Kanten bündig stoßen und das Ziegelmuster über die Paneelgrenze läuft.
# Front-Blick entlang -Z, Höhe = Y — keine Achsen-Umrechnung nötig.
# flatpak ... --python elevation.py -- <elem> <tex> <out.png> [modul=WandPaneel] [n=3]
import bpy, sys
from mathutils import Vector
a = sys.argv[sys.argv.index("--") + 1:]
ELEM, TEX, OUT = a[0], a[1], a[2]
MOD = a[3] if len(a) > 3 else "WandPaneel"
N = int(a[4]) if len(a) > 4 else 3

bpy.ops.wm.read_factory_settings(use_empty=True)

def material(name, bild, skala):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial"); b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Roughness"].default_value = 0.9
    co = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (skala, skala, skala)
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = bpy.data.images.load(bild); t.projection = "BOX"
    nt.links.new(co.outputs["Object"], mp.inputs["Vector"]); nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"]); nt.links.new(b.outputs["BSDF"], o.inputs["Surface"])
    return m
mat = material("Stein", f"{TEX}/stein_clean.png", 0.5)

bpy.ops.import_scene.gltf(filepath=f"{ELEM}/{MOD}.glb")
src = [x for x in bpy.context.selected_objects if x.type == "MESH"][0]
src.hide_render = True
for i in range(N):
    o = src.copy(); o.data = src.data.copy(); bpy.context.scene.collection.objects.link(o)
    o.hide_render = False; o.location = Vector(((i - (N-1)/2) * 2.0, 0, 0))
    o.data.materials.clear(); o.data.materials.append(mat)

cam_d = bpy.data.cameras.new("cam"); cam_d.type = "ORTHO"; cam_d.ortho_scale = N * 2.0 + 0.6
cam = bpy.data.objects.new("cam", cam_d); bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
cam.location = Vector((0, 1.75, 8)); cam.rotation_euler = (0, 0, 0)  # Blick -Z, oben = +Y

sun_d = bpy.data.lights.new("s", "SUN"); sun_d.energy = 3.0
sun = bpy.data.objects.new("s", sun_d); bpy.context.scene.collection.objects.link(sun)
sun.rotation_euler = (0.5, 0.2, 0.3)
w = bpy.data.worlds.new("w"); bpy.context.scene.world = w
w.use_nodes = True; w.node_tree.nodes["Background"].inputs[1].default_value = 0.5

sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try: sc.render.engine = eng; break
    except Exception: continue
sc.render.resolution_x = 1100; sc.render.resolution_y = 700; sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f"ELEVATION OK -> {OUT} modul={MOD} n={N}")
