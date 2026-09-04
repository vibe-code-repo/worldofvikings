# Erzeugt: die Innenansicht eines aus Rohlingen gesetzten Korridors — der Beweis, dass ein Raum aus Elementen entsteht.
# Setzt einen Korridor aus den ROHLINGEN zusammen (Wandpaneel, Boden-, Decken-
# platte) auf 2-m-Raster und rendert die Innenansicht. Beweis: Raum aus Elementen.
# flatpak run org.blender.Blender --factory-startup -b --python compose-corridor.py -- <elem-ordner> <tex-ordner> <out.png> [segmente]
import bpy, sys, math
from mathutils import Vector, Euler

a = sys.argv[sys.argv.index("--") + 1:]
ELEM, TEX, OUT = a[0], a[1], a[2]
N = int(a[3]) if len(a) > 3 else 5

bpy.ops.wm.read_factory_settings(use_empty=True)

def lade(name):
    bpy.ops.import_scene.gltf(filepath=f"{ELEM}/{name}.glb")
    o = bpy.context.selected_objects[0]
    o.name = name + "_src"
    o.hide_render = True
    return o

def material(name, bild, skala):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.9
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapp = nt.nodes.new("ShaderNodeMapping"); mapp.inputs["Scale"].default_value = (skala, skala, skala)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(bild); tex.projection = "BOX"; tex.projection_blend = 0.3
    nt.links.new(coord.outputs["Object"], mapp.inputs["Vector"])
    nt.links.new(mapp.outputs["Vector"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m

mat_stein = material("Stein", f"{TEX}/stein_clean.png", 0.5)
mat_holz  = material("Holz",  f"{TEX}/stein_decke.png", 0.25)

wand = lade("WandPaneel"); boden = lade("Bodenplatte"); decke = lade("Deckenplatte")

def setze(src, pos, rot_grad, mat):
    o = src.copy(); o.data = src.data.copy()
    bpy.context.scene.collection.objects.link(o)
    o.hide_render = False
    o.location = Vector(pos)
    o.rotation_euler = Euler([math.radians(g) for g in rot_grad], "XYZ")
    o.data.materials.clear(); o.data.materials.append(mat)
    return o

HX = 2.0   # halbe Korridorbreite (Wände bei x=±2)
H = 3.5    # Höhe
for i in range(N):
    z = 1.0 + 2.0 * i
    setze(wand,  (-HX, 0, z),  (0,  90, 0), mat_stein)  # linke Wand, Front nach +x
    setze(wand,  ( HX, 0, z),  (0, -90, 0), mat_stein)  # rechte Wand, Front nach -x
    setze(boden, (-1, 0, z), (0, 0, 0), mat_stein)
    setze(boden, ( 1, 0, z), (0, 0, 0), mat_stein)
    setze(decke, (-1, H, z), (180, 0, 0), mat_holz)     # Decke, Oberseite nach unten
    setze(decke, ( 1, H, z), (180, 0, 0), mat_holz)

# Kamera in Kopfhöhe am Anfang, Fackellicht.
cam_d = bpy.data.cameras.new("cam"); cam_d.lens = 24
cam = bpy.data.objects.new("cam", cam_d); bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
cam.location = Vector((0, 1.7, 0.4))
dirv = Vector((0, 1.5, 2*N)) - cam.location
cam.rotation_euler = dirv.to_track_quat("-Z", "Y").to_euler()

lamp_d = bpy.data.lights.new("f", "POINT"); lamp_d.energy = 500; lamp_d.color = (1.0, 0.72, 0.42)
lamp = bpy.data.objects.new("f", lamp_d); bpy.context.scene.collection.objects.link(lamp)
lamp.location = Vector((0, 2.2, 2.5))
world = bpy.data.worlds.new("w"); bpy.context.scene.world = world
world.use_nodes = True; world.node_tree.nodes["Background"].inputs[1].default_value = 0.09

sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try: sc.render.engine = eng; break
    except Exception: continue
sc.render.resolution_x = 1000; sc.render.resolution_y = 620
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f"KORRIDOR OK -> {OUT} segmente={N}")
