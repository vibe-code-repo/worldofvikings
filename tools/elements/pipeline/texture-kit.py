# Erzeugt: ein kachelndes Stein-PBR-Material auf jedem Netz eines Kit-GLB und exportiert es spieltauglich.
# Legt ein KACHELNDES Stein-PBR-Material auf jedes Mesh eines Kit-GLB und
# exportiert ein spieltaugliches GLB. Kachelung ueber die vorhandenen UVs mit
# einem Mapping-Scale (exportiert als KHR_texture_transform), Wiederholung REPEAT.
#
# flatpak run org.blender.Blender --factory-startup -b --python texture-kit.py \
#   -- <in.glb> <albedo.png> <normal.png> <out.glb> <uvscale>
import bpy, sys
a = sys.argv[sys.argv.index("--")+1:]
IN, ALB, NRM, OUT = a[0], a[1], a[2], a[3]
UVSCALE = float(a[4]) if len(a) > 4 else 3.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]

def bild(pfad, farbraum):
    img = bpy.data.images.load(pfad, check_existing=True)
    img.colorspace_settings.name = farbraum
    return img

ROUGH = float(a[7]) if len(a) > 7 else 0.9   # Rauheit (niedrig = nass/glaenzend)
mat = bpy.data.materials.new("SteinKachel")
mat.use_nodes = True
nt = mat.node_tree; nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputMaterial")
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
bsdf.inputs["Roughness"].default_value = ROUGH
bsdf.inputs["Metallic"].default_value = 0.0
uv = nt.nodes.new("ShaderNodeUVMap")
mapp = nt.nodes.new("ShaderNodeMapping")
mapp.inputs["Scale"].default_value = (UVSCALE, UVSCALE, UVSCALE)
texA = nt.nodes.new("ShaderNodeTexImage"); texA.image = bild(ALB, "sRGB"); texA.extension = "REPEAT"
texN = nt.nodes.new("ShaderNodeTexImage"); texN.image = bild(NRM, "Non-Color"); texN.extension = "REPEAT"
nmap = nt.nodes.new("ShaderNodeNormalMap")
nt.links.new(uv.outputs["UV"], mapp.inputs["Vector"])
nt.links.new(mapp.outputs["Vector"], texA.inputs["Vector"])
nt.links.new(mapp.outputs["Vector"], texN.inputs["Vector"])
nt.links.new(texA.outputs["Color"], bsdf.inputs["Base Color"])
nt.links.new(texN.outputs["Color"], nmap.inputs["Color"])
nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

# Weltweit gleichmaessige UVs per Cube-Projektion, damit die Kachel UEBERALL
# gleich dicht sitzt (Tripo-Atlas-UVs sind ungleichmaessig -> innen fein, aussen
# verschmiert). cube_size bindet UV an Weltmass -> reale Kachelgroesse.
CUBE_M = float(a[5]) if len(a) > 5 else 2.0  # Weltmeter pro UV-Kachel-Einheit
TARGET = int(a[6]) if len(a) > 6 else 0       # Face-Budget je Mesh (0 = keins)
faces = 0
for o in meshes:
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    # Decimation VOR der UV-Projektion, damit die neuen UVs auf der finalen
    # Geometrie sitzen. Collapse-Ratio bringt das Mesh unter das Budget.
    n0 = len(o.data.polygons)
    if TARGET > 0 and n0 > TARGET:
        dec = o.modifiers.new("dec", "DECIMATE")
        dec.decimate_type = "COLLAPSE"
        dec.ratio = TARGET / n0
        bpy.ops.object.modifier_apply(modifier=dec.name)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cube_project(cube_size=CUBE_M, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    o.select_set(False)
    o.data.materials.clear()
    o.data.materials.append(mat)
    faces += len(o.data.polygons)

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB")
print(f"KIT TEX OK -> {OUT} meshes={len(meshes)} faces={faces} uvscale={UVSCALE}")
