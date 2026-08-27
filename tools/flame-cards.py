#!/usr/bin/env blender --background --python
"""
Put flame cards into a model — or write them out as a model of their own.

    blender --background --factory-startup --python tools/flame-cards.py -- \
        --glb assets/models/CryptWallTorch.glb \
        --texture assets/textures/flame.png \
        --at 0,0.30,-0.34 --size 0.34,0.55 --cut-above 0.24 \
        --out assets/models/CryptWallTorch.glb

    ... --only-cards --out assets/models/Flamme.glb   (standalone prefab)

── Why cards and not a modelled flame ───────────────────────────────
A generated flame is a solid lump with soft edges. Fire has neither: it
is read by edges that tear off and dissolve, and by a silhouette that
changes several times a second. Two crossed planes with a scrolling
sprite atlas deliver both for six triangles; a modelled flame delivers
neither for three hundred.

That is also how the games this project takes after do it.

── The convention this establishes ──────────────────────────────────
The cards carry a material named `Flamme`. The client recognises that
name and gives it the fire treatment — additive, unlit, and stepping
through the atlas (`FlammenPlugin`). Nothing else has to be wired up:
whatever model carries a `Flamme` material burns, be it a wall torch, a
campfire or a brazier.

── Axes ─────────────────────────────────────────────────────────────
`--at` and `--size` are given in GAME coordinates (glTF, y up), because
that is the frame everyone reads the model in. The mirror along x that
every own model needs (see `steingrab-erzeugen.py`) is applied here as
well, so cards inserted into an already mirrored model stay put.
"""

import sys
import os

import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    key = f'--{name}'
    if key in argv:
        i = argv.index(key)
        if i + 1 < len(argv):
            return argv[i + 1]
    return default


def zahlen(text, anzahl):
    werte = [float(v) for v in text.split(',')]
    if len(werte) != anzahl:
        raise SystemExit(f'--{anzahl} Zahlen erwartet, "{text}" bekommen')
    return werte


GLB = arg('glb')
OUT = arg('out', GLB)
TEXTUR = arg('texture', 'assets/textures/flame.png')
AT = zahlen(arg('at', '0,0,0'), 3)
SIZE = zahlen(arg('size', '0.3,0.5'), 2)
CUT_ABOVE = arg('cut-above')
ONLY_CARDS = '--only-cards' in argv
MATERIAL = arg('material', 'Flamme')

if not ONLY_CARDS and not GLB:
    raise SystemExit('usage: --glb <file> --at x,y,z --size b,h [--cut-above y] [--out f]')

bpy.ops.wm.read_factory_settings(use_empty=True)

traeger = None
if not ONLY_CARDS:
    bpy.ops.import_scene.gltf(filepath=GLB)
    netze = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not netze:
        raise SystemExit(f'kein Netz in {GLB}')
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in netze:
        o.select_set(True)
    bpy.context.view_layer.objects.active = netze[0]
    if len(netze) > 1:
        bpy.ops.object.join()
    traeger = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    if CUT_ABOVE is not None:
        # Die modellierte Flamme entfernen. Sie sitzt oben, und "oben" ist
        # in Blender +z. Ohne das steckt die Karte in einem orangen Klumpen
        # und man sieht von beidem nichts Rechtes.
        grenze = float(CUT_ABOVE)
        import bmesh

        bm = bmesh.new()
        bm.from_mesh(traeger.data)
        weg = [v for v in bm.verts if v.co.z > grenze]
        bmesh.ops.delete(bm, geom=weg, context='VERTS')
        bm.to_mesh(traeger.data)
        bm.free()
        print(f'ueber z={grenze:.3f} entfernt: {len(weg)} Vertices')

# ── Material ─────────────────────────────────────────────────────────
mat = bpy.data.materials.new(MATERIAL)
mat.use_nodes = True
mat.blend_method = 'BLEND'
knoten = mat.node_tree.nodes
verbindungen = mat.node_tree.links
bsdf = knoten['Principled BSDF']

bild = knoten.new('ShaderNodeTexImage')
if not os.path.exists(TEXTUR):
    raise SystemExit(f'Textur fehlt: {TEXTUR} (tools/flame-texture.py erzeugt sie)')
bild.image = bpy.data.images.load(os.path.abspath(TEXTUR))
bild.image.pack()
bild.interpolation = 'Linear'

# Emissiv, nicht diffus: Eine Flamme empfaengt kein Licht, sie gibt welches.
verbindungen.new(bild.outputs['Color'], bsdf.inputs['Emission Color'])
verbindungen.new(bild.outputs['Alpha'], bsdf.inputs['Alpha'])
bsdf.inputs['Emission Strength'].default_value = 1.0
bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
bsdf.inputs['Metallic'].default_value = 0.0
bsdf.inputs['Roughness'].default_value = 1.0

# ── Karten ───────────────────────────────────────────────────────────
# Zwei gekreuzte Flaechen. Drei waeren runder, kosten aber die Haelfte mehr
# Fuellrate fuer einen Unterschied, den man bei einer 30-cm-Flamme nicht
# sieht — bei einem Lagerfeuer kann man `--kreuze 3` nachruesten.
#
# UV deckt die VOLLE Kachel 0..1 ab. Die Auswahl der Atlas-Kachel macht
# allein der Client ueber `uScale`/`uOffset` der Textur — Babylon rechnet
# `u' = u * uScale + uOffset`, und wer die UVs hier schon auf ein Viertel
# legt, bekommt am Ende ein Sechzehntel: fast nur leeren Rand, und die
# Flamme ist unsichtbar.
breite, hoehe = SIZE
gx, gy, gz = AT
# Spiel -> Blender: (x, y, z) -> (x, -z, y). Und die x-Spiegelung, die
# jedes eigene Modell braucht.
bx, by, bz = -gx, -gz, gy

karten = []
for i, winkel in enumerate((0.0, 90.0)):
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(bx, by, bz + hoehe / 2))
    karte = bpy.context.active_object
    karte.name = f'{MATERIAL}Karte{i}'
    # Die Flaeche liegt nach `primitive_plane_add` in XY. Ihre HOEHE ist
    # also y, nicht z — z ist die Flaechennormale und laesst sich an einer
    # flachen Flaeche nicht skalieren. Der erste Anlauf stand hier auf
    # (breite, 1.0, hoehe) und ergab Karten von einem Meter Hoehe: Die
    # Flamme hing weit ueber und unter der Fackel.
    karte.scale = (breite, hoehe, 1.0)
    karte.rotation_euler = (1.5707963267948966, 0.0, winkel * 3.141592653589793 / 180.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    karte.data.materials.clear()
    karte.data.materials.append(mat)
    karten.append(karte)

for o in bpy.context.selected_objects:
    o.select_set(False)

if ONLY_CARDS:
    ziel = karten
else:
    ziel = [traeger] + karten

for o in ziel:
    o.select_set(True)
bpy.context.view_layer.objects.active = ziel[0]

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_yup=True,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_materials='EXPORT',
    export_image_format='AUTO',
)

print(f'\nWRITTEN {OUT} — {len(karten)} Karten, Material "{MATERIAL}", '
      f'{os.path.getsize(OUT) / 1e6:.2f} MB')
