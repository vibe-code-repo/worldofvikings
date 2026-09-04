# Erzeugt: dasselbe M1-Nachweisbild als Übersicht schräg von oben (22 mm, Kamera über dem Gang-Eingang).
# M1-Proof: Zellen-basiertes Snappen der Module. Ein Gang (4 Zellen) + ein
# Seitenraum; die Kante zwischen Gang und Seitenraum ist ein TORBOGEN (Durchgang)
# statt einer Wand. Beweist: Module rasten rasterrein, Öffnung = eigenes Modul.
# flatpak ... --python compose-cells.py -- <elem> <tex> <out.png>
import bpy, sys, math
from mathutils import Vector, Euler

a = sys.argv[sys.argv.index("--") + 1:]
ELEM, TEX, OUT = a[0], a[1], a[2]
GRID = 2.0

bpy.ops.wm.read_factory_settings(use_empty=True)

def lade(name):
    bpy.ops.import_scene.gltf(filepath=f"{ELEM}/{name}.glb")
    o = bpy.context.selected_objects[0]; o.name = name + "_src"; o.hide_render = True
    return o

def material(name, bild, skala):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled"); b.inputs["Roughness"].default_value = 0.9
    co = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (skala, skala, skala)
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = bpy.data.images.load(bild)
    t.projection = "BOX"; t.projection_blend = 0.3
    nt.links.new(co.outputs["Object"], mp.inputs["Vector"]); nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"]); nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    return m

mat_stein = material("Stein", f"{TEX}/stein_clean.png", 0.5)
mat_holz  = material("Holz",  f"{TEX}/stein_decke.png", 0.25)

src = {n: lade(n) for n in ("WandPaneel", "Bodenplatte", "Deckenplatte", "Torbogen")}

def setze(name, pos, rot, mat):
    o = src[name].copy(); o.data = src[name].data.copy()
    bpy.context.scene.collection.objects.link(o); o.hide_render = False
    o.location = Vector(pos); o.rotation_euler = Euler([math.radians(g) for g in rot], "XYZ")
    o.data.materials.clear(); o.data.materials.append(mat)

# Layout: Zellen (ci,cj). Gang entlang +z, Seitenraum links.
ZELLEN = {(0,0),(0,1),(0,2),(0,3),(-1,1)}
BOGEN = ((0,1),"W")   # Kante West von (0,1) = Durchgang zum Seitenraum

RICHT = {  # dir -> (dci,dcj, kanten-offset, rotation(front->welt))
    "W": (-1,0, (-1,0,0), (0,  90,0)),
    "O": ( 1,0, ( 1,0,0), (0, -90,0)),
    "S": (0,-1, (0,0,-1), (0,   0,0)),
    "N": (0, 1, (0,0, 1), (0, 180,0)),
}

for (ci,cj) in ZELLEN:
    bx, bz = ci*GRID, cj*GRID
    setze("Bodenplatte", (bx, 0, bz), (0,0,0), mat_stein)
    setze("Deckenplatte", (bx, 3.5, bz), (180,0,0), mat_holz)
    for d,(dci,dcj,off,rot) in RICHT.items():
        nb = (ci+dci, cj+dcj)
        pos = (bx + off[0]*GRID/2, 0, bz + off[2]*GRID/2)
        if nb not in ZELLEN:
            setze("WandPaneel", pos, rot, mat_stein)           # Aussenwand
        elif (ci,cj,d) == (BOGEN[0][0], BOGEN[0][1], BOGEN[1]):
            setze("Torbogen", pos, rot, mat_stein)             # Durchgang (einmal)
        # sonst: offene Innenkante -> nichts

# Kamera am Gang-Eingang (Zelle (0,0)), Blick +z; Fackel.
cam_d = bpy.data.cameras.new("cam"); cam_d.lens = 22
cam = bpy.data.objects.new("cam", cam_d); bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
cam.location = Vector((7, 7, 4))
dirv = Vector((0, 1.5, 4)) - cam.location
cam.rotation_euler = dirv.to_track_quat("-Z","Y").to_euler()
lamp_d = bpy.data.lights.new("f","POINT"); lamp_d.energy = 550; lamp_d.color = (1.0,0.72,0.42)
lamp = bpy.data.objects.new("f", lamp_d); bpy.context.scene.collection.objects.link(lamp)
lamp.location = Vector((0, 2.2, 3.0))
w = bpy.data.worlds.new("w"); bpy.context.scene.world = w
w.use_nodes = True; w.node_tree.nodes["Background"].inputs[1].default_value = 0.35

sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT","BLENDER_EEVEE","CYCLES"):
    try: sc.render.engine = eng; break
    except Exception: continue
sc.render.resolution_x = 1000; sc.render.resolution_y = 620; sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f"ZELLEN OK -> {OUT}")
