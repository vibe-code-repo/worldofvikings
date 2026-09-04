# Erzeugt: dasselbe M1-Nachweisbild als orthografischen Grundriss von oben — das Raster ist nur dort nachmessbar.
# M1-Proof: Zellen-basiertes Snappen der Module. Ein Gang (4 Zellen) + Seitenraum;
# die Kante zwischen Gang und Seitenraum ist ein TORBOGEN (Durchgang) statt Wand.
#
# WICHTIG: Elemente + Platzierung sind Y-UP (Höhe=Y, Boden=X/Z-Ebene) — die
# Spiel-/Babylon-Konvention. Blender ist Z-up; für den Render hängt daher die
# GESAMTE Geometrie unter einem um +90° X gekippten Eltern-Knoten. Kamera/Licht
# stehen in Blender-Z-up und werden mit yup() aus Y-up-Absichten umgerechnet.
# flatpak ... --python compose-cells.py -- <elem> <tex> <out.png> [dach=1]
import bpy, sys, math
from mathutils import Vector, Euler

a = sys.argv[sys.argv.index("--") + 1:]
ELEM, TEX, OUT = a[0], a[1], a[2]
DACH = (len(a) < 4) or (a[3] != "0")
GRID = 2.0

bpy.ops.wm.read_factory_settings(use_empty=True)

# Y-up -> Blender-Z-up (nur Render): (x,y,z)_yup -> (x,-z,y)_welt
def yup(x, y, z): return Vector((x, -z, y))

welt = bpy.data.objects.new("welt", None)
bpy.context.scene.collection.objects.link(welt)
welt.rotation_euler = Euler((math.radians(90), 0, 0), "XYZ")

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

def lade(name):
    bpy.ops.import_scene.gltf(filepath=f"{ELEM}/{name}.glb")
    o = [x for x in bpy.context.selected_objects if x.type == "MESH"][0]
    o.name = name + "_src"; o.hide_render = True; return o
src = {n: lade(n) for n in ("WandPaneel", "Bodenplatte", "Deckenplatte", "Torbogen")}

def setze(name, pos, rot, mat):
    o = src[name].copy(); o.data = src[name].data.copy()
    bpy.context.scene.collection.objects.link(o); o.hide_render = False
    o.parent = welt
    o.location = Vector(pos); o.rotation_euler = Euler([math.radians(g) for g in rot], "XYZ")
    o.data.materials.clear(); o.data.materials.append(mat)

# Layout (Y-up: X/Z = Grundriss, Y = Höhe). Gang entlang +z, Seitenraum links.
ZELLEN = {(0,0),(0,1),(0,2),(0,3),(-1,1)}
BOGEN = ((0,1), "W")
RICHT = {
    "W": (-1,0, (-1,0,0), (0,  90,0)),
    "O": ( 1,0, ( 1,0,0), (0, -90,0)),
    "S": (0,-1, (0,0,-1), (0,   0,0)),
    "N": (0, 1, (0,0, 1), (0, 180,0)),
}
for (ci,cj) in ZELLEN:
    bx, bz = ci*GRID, cj*GRID
    setze("Bodenplatte", (bx, 0, bz), (0,0,0), mat_stein)
    if DACH:
        setze("Deckenplatte", (bx, 3.5, bz), (180,0,0), mat_holz)
    for d,(dci,dcj,off,rot) in RICHT.items():
        nb = (ci+dci, cj+dcj)
        pos = (bx + off[0]*GRID/2, 0, bz + off[2]*GRID/2)
        if nb not in ZELLEN:
            setze("WandPaneel", pos, rot, mat_stein)
        elif (ci,cj,d) == (BOGEN[0][0], BOGEN[0][1], BOGEN[1]):
            setze("Torbogen", pos, rot, mat_stein)

# Kamera + Fackeln in Blender-Z-up (aus Y-up-Absicht via yup()).
cam_d = bpy.data.cameras.new("cam"); cam_d.type = "ORTHO"; cam_d.ortho_scale = 11.0
cam = bpy.data.objects.new("cam", cam_d); bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
cam.location = Vector((-0.4, -2.8, 25.0))
cam.rotation_euler = (0.0, 0.0, 0.0)

def fackel(x,y,z,e=380):
    d = bpy.data.lights.new("f","POINT"); d.energy = e; d.color=(1.0,0.72,0.42)
    o = bpy.data.objects.new("f", d); bpy.context.scene.collection.objects.link(o); o.location = yup(x,y,z)
fackel(0,2.2,1.5); fackel(0,2.2,4.0); fackel(-2,2,2, 300); fackel(0,1.8,-0.5, 130)

w = bpy.data.worlds.new("w"); bpy.context.scene.world = w
w.use_nodes = True; w.node_tree.nodes["Background"].inputs[1].default_value = 0.55

sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT","BLENDER_EEVEE","CYCLES"):
    try: sc.render.engine = eng; break
    except Exception: continue
sc.render.resolution_x = 760; sc.render.resolution_y = 900; sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f"ZELLEN OK -> {OUT} (dach={DACH})")
