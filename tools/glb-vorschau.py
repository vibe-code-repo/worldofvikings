#!/usr/bin/env blender --background --python
"""
Rendert ein GLB als Vorschaubild — das Auge auf ein Modell, ohne den
Client starten zu müssen.

    blender --background --python tools/glb-vorschau.py -- \
        --glb assets/models/Fichte1.glb --out /tmp/fichte.png [--breite 900]

Mehrere Modelle nebeneinander (zum Vergleichen):

    ... -- --glb a.glb,b.glb,c.glb --out /tmp/vergleich.png

── Warum Cycles und nicht EEVEE ─────────────────────────────────────
EEVEE braucht einen GL-Kontext, der headless auf einem Server ohne
GPU nicht zuverlässig zustande kommt. Cycles rechnet auf der CPU und
liefert bei 24 Samples in wenigen Sekunden ein Bild, das für die Frage
"trägt die Silhouette?" völlig ausreicht.

Wichtig für Laub: Der glTF-Import setzt `blend_method` auf CLIP, wenn
das Material alphaMode MASK trägt — nur dann sind die Nadellücken im
Bild auch wirklich Lücken und nicht schwarze Rechtecke.
"""

import sys
import os
import math

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


GLBS = [g.strip() for g in arg('--glb', '').split(',') if g.strip()]
OUT = arg('--out', '/tmp/vorschau.png')
BREITE = int(arg('--breite', '900'))
# Tripo normiert seine Modelle auf Kantenlänge 1, die Original-Prefabs
# stehen in Metern. Ohne Normierung vergleicht man Größen statt Formen.
NORMIEREN = float(arg('--normieren', '0'))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

if not GLBS:
    raise SystemExit('--glb fehlt')

bpy.ops.wm.read_factory_settings(use_empty=True)

# ── Modelle laden und nebeneinander stellen ──────────────────────────
gruppen = []
for pfad in GLBS:
    voll = pfad if os.path.isabs(pfad) else os.path.join(ROOT, pfad)
    vorher = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=voll)
    neu = [o for o in bpy.data.objects if o not in vorher and o.type == 'MESH']
    gruppen.append(neu)

# Höhe des höchsten Modells bestimmt den Kameraabstand.
def masse(objs):
    ecken = [o.matrix_world @ Vector(e) for o in objs for e in o.bound_box]
    if not ecken:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    mn = Vector((min(c.x for c in ecken), min(c.y for c in ecken), min(c.z for c in ecken)))
    mx = Vector((max(c.x for c in ecken), max(c.y for c in ecken), max(c.z for c in ecken)))
    return mn, mx


hoehen = []
breiten = []
for objs in gruppen:
    mn, mx = masse(objs)
    hoehen.append(mx.z - mn.z)
    breiten.append(max(mx.x - mn.x, mx.y - mn.y))

hmax = max(hoehen) or 1.0
abstand_x = max(breiten) * 1.35 + 0.5

# nebeneinander auf der X-Achse zentrieren, Füße auf z=0
gesamt = abstand_x * (len(gruppen) - 1)
for i, objs in enumerate(gruppen):
    mn, mx = masse(objs)
    dx = -gesamt / 2 + i * abstand_x - (mn.x + mx.x) / 2
    for o in objs:
        o.location.x += dx
        o.location.y -= (mn.y + mx.y) / 2
        o.location.z -= mn.z

# ── Boden, damit Schatten und Standlinie lesbar sind ─────────────────
bpy.ops.mesh.primitive_plane_add(size=max(hmax * 6, 40), location=(0, 0, 0))
boden = bpy.context.object
bm = bpy.data.materials.new('boden')
bm.use_nodes = True
bm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.20, 0.22, 0.18, 1)
bm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0
boden.data.materials.append(bm)

# ── Licht: Sonne schräg von vorn plus kühles Himmelslicht ────────────
bpy.ops.object.light_add(type='SUN', location=(hmax, -hmax * 1.5, hmax * 2))
sonne = bpy.context.object
sonne.data.energy = 3.2
sonne.data.angle = math.radians(2)
sonne.data.color = (1.0, 0.93, 0.82)
sonne.rotation_euler = (math.radians(54), 0, math.radians(34))

welt = bpy.data.worlds.new('welt')
bpy.context.scene.world = welt
welt.use_nodes = True
welt.node_tree.nodes['Background'].inputs['Color'].default_value = (0.34, 0.45, 0.58, 1)
welt.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.7

# ── Kamera: leicht erhöht, Blick auf die Mitte ───────────────────────
spanne = max(gesamt + max(breiten), hmax)
dist = spanne * 1.5 + hmax * 0.6
bpy.ops.object.camera_add(location=(0, -dist, hmax * 0.55))
kam = bpy.context.object
kam.data.lens = 55
ziel = Vector((0, 0, hmax * 0.45))
richtung = ziel - kam.location
kam.rotation_euler = richtung.to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = kam

# ── Cutout sicherstellen ─────────────────────────────────────────────
# Der glTF-Import setzt CLIP nur, wenn alphaMode MASK im Modell steht.
# Wo eine Textur einen echten Alphakanal hat, aber OPAQUE gemeldet wurde,
# bliebe das Laub ein volles Rechteck — deshalb hier melden statt raten.
for mat in bpy.data.materials:
    if mat.use_nodes and mat.blend_method == 'CLIP':
        print(f'CUTOUT-MATERIAL {mat.name} (threshold {mat.alpha_threshold})')

szene = bpy.context.scene
szene.render.engine = 'CYCLES'
szene.cycles.device = 'CPU'
szene.cycles.samples = 64
# Der Ubuntu-Build bringt keinen OpenImageDenoiser mit ("Build without
# OpenImageDenoiser") — statt zu entrauschen also einfach mehr Samples.
szene.cycles.use_denoising = False
szene.render.resolution_x = BREITE
szene.render.resolution_y = int(BREITE * 0.75)
szene.render.image_settings.file_format = 'PNG'
szene.render.filepath = OUT

for objs in gruppen:
    for o in objs:
        n = sum(len(p.vertices) - 2 for p in o.data.polygons)
        print(f'OBJEKT {o.name}: {n} Dreiecke, Material '
              f'{[m.name for m in o.data.materials]}')

bpy.ops.render.render(write_still=True)
print(f'BILD {OUT}')
