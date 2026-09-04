# Erzeugt: das Innenbild mehrerer aneinandergesetzter Gang-Segmente aus Spielersicht.
# Mehrere Gang-Segmente aneinandersetzen und von INNEN rendern (Spielersicht).
# flatpak run ... --python assemble-corridor.py -- <gang.glb> <out.png> [anzahl]
import bpy, sys, math
from mathutils import Vector
a = sys.argv[sys.argv.index("--")+1:]
GLB, OUT = a[0], a[1]
N = int(a[2]) if len(a) > 2 else 4

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
segs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
# Bounding box + laengste horizontale Achse = Gang-Richtung.
mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
for o in segs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c); mn = Vector(map(min,mn,w)); mx = Vector(map(max,mx,w))
dim = mx - mn
axis = 0 if dim.x >= dim.y else 1   # X oder Y ist die Laengsachse
laenge = dim[axis]
center = (mn + mx)/2

# N-1 Kopien entlang der Achse.
originals = list(segs)
for i in range(1, N):
    for o in originals:
        c = o.copy(); c.data = o.data; bpy.context.scene.collection.objects.link(c)
        off = Vector((0,0,0)); off[axis] = laenge * i
        c.location = o.location + off

# Kamera in Kopfhoehe am Anfang, Blick die Achse entlang.
cam_data = bpy.data.cameras.new("cam"); cam_data.lens = 24
cam = bpy.data.objects.new("cam", cam_data); bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
boden = mn.z
pos = center.copy(); pos[axis] = mn[axis] + laenge*0.15; pos.z = boden + 1.7
cam.location = pos
look = center.copy(); look[axis] = mn[axis] + laenge*N; look.z = boden + 1.5
dirv = look - cam.location
cam.rotation_euler = dirv.to_track_quat("-Z","Y").to_euler()

# Warmes Fackellicht-artiges Punktlicht + schwaches Weltlicht.
lamp_d = bpy.data.lights.new("p","POINT"); lamp_d.energy = 400; lamp_d.color = (1.0,0.7,0.4)
lamp = bpy.data.objects.new("p", lamp_d); bpy.context.scene.collection.objects.link(lamp)
lp = pos.copy(); lp[axis] += laenge*0.6; lp.z = boden + 2.0; lamp.location = lp
world = bpy.data.worlds.new("w"); bpy.context.scene.world = world
world.use_nodes = True; world.node_tree.nodes["Background"].inputs[1].default_value = 0.08

sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT","BLENDER_EEVEE","CYCLES"):
    try: sc.render.engine = eng; break
    except Exception: continue
sc.render.resolution_x = 1000; sc.render.resolution_y = 620
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f"CORRIDOR OK -> {OUT} segs={N} laenge={laenge:.2f} achse={'XY'[axis]}")
