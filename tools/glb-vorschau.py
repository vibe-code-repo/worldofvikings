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
# Je Modell eine Zielhöhe in Metern (`--skalen 9,1.75`) — für den Fall, dass
# gerade die GRÖSSENUNTERSCHIEDE das Thema sind. `--normieren` macht das
# Gegenteil: alle gleich hoch, um Formen zu vergleichen.
SKALEN = [float(x) for x in arg('--skalen', '').split(',') if x.strip()]
# Bildnummer der Animation. Frame 1 ist bei einer Idle-Schleife meist die
# RUHEPOSE — dort sieht man nicht, ob die Verformung bei voller Auslenkung
# hält. Genau das ist aber die Frage bei einem frischen Rig.
FRAME = int(arg('--frame', '1'))
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


# Nur WURZELN transformieren: Sapling hängt `leaves` als Kind unter
# `tree`, und der glTF-Import erhält diese Hierarchie. Verschiebt man
# beide, wirkt die Verschiebung auf das Kind doppelt — im ersten
# Vergleichsbild stand der Stamm in der Mitte und sein Laub daneben.
def wurzeln(objs):
    menge = set(objs)
    return [o for o in objs if o.parent not in menge]


if NORMIEREN > 0 or SKALEN:
    for i, objs in enumerate(gruppen):
        mn, mx = masse(objs)
        h = mx.z - mn.z
        if h <= 0:
            continue
        ziel = SKALEN[i] if i < len(SKALEN) else NORMIEREN
        if ziel <= 0:
            continue
        f = ziel / h
        for o in wurzeln(objs):
            o.scale = (o.scale.x * f, o.scale.y * f, o.scale.z * f)
            o.location = o.location * f
        bpy.context.view_layer.update()

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
    for o in wurzeln(objs):
        o.location.x += dx
        o.location.y -= (mn.y + mx.y) / 2
        o.location.z -= mn.z

# ── Boden, damit Schatten und Standlinie lesbar sind ─────────────────
# Der Boden muss die ganze REIHE tragen, nicht nur einen Baum — sonst
# endet er bei mehreren Modellen mitten im Bild.
bpy.ops.mesh.primitive_plane_add(
    size=max(hmax * 6, gesamt + max(breiten) * 4, 40), location=(0, 0, 0)
)
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

# ── Cutout nachrüsten ────────────────────────────────────────────────
# Der glTF-Import setzt CLIP nur, wenn alphaMode MASK im Modell steht. Der
# AssetRipper-Export der Original-Prefabs meldet aber OPAQUE, obwohl die
# Texturen echte Alphakanäle haben — im Spiel repariert das erst die
# Cutout-Erkennung im AssetManager zur Laufzeit.
#
# Ohne dieselbe Reparatur hier rendert Birch1 als Wolke schwarzer Rechtecke,
# und jeder Vergleich gegen ein eigenes Modell wäre wertlos. Kriterium ist
# der Alphakanal des Bildes selbst, nicht das gemeldete Material.
for mat in bpy.data.materials:
    if not mat.use_nodes or mat.blend_method == 'CLIP':
        if mat.use_nodes and mat.blend_method == 'CLIP':
            print(f'CUTOUT-MATERIAL {mat.name} (threshold {mat.alpha_threshold})')
        continue
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if not bsdf:
        continue
    for verb in bsdf.inputs['Base Color'].links:
        bild = getattr(verb.from_node, 'image', None)
        if bild is None or bild.channels < 4 or not bild.depth == 32:
            continue
        mat.node_tree.links.new(verb.from_node.outputs['Alpha'], bsdf.inputs['Alpha'])
        mat.blend_method = 'CLIP'
        mat.shadow_method = 'CLIP'
        mat.alpha_threshold = 0.5
        mat.use_backface_culling = False
        print(f'CUTOUT NACHGERUESTET {mat.name} ({bild.name})')

szene = bpy.context.scene
if FRAME > 1:
    # Importierte Animationen liegen als Actions vor; frame_set wertet sie aus.
    szene.frame_set(FRAME)
    for o in bpy.data.objects:
        o.update_tag()
    bpy.context.view_layer.update()
    print(f'FRAME {FRAME} von {szene.frame_end}')
szene.render.engine = 'CYCLES'
szene.cycles.device = 'CPU'
szene.cycles.samples = 64
# Cutout-Bewuchs braucht viele Transparenz-Durchgaenge. Cycles bricht
# einen Strahl nach `transparent_max_bounces` ab und liefert dort
# SCHWARZ — bei Vorgabe 8 stand mitten in einem Wollgrashorst (16
# Karten) ein schwarzes Rechteck, und es sah aus wie ein Modellfehler.
# Ein Blumenhorst hat bis zu 20 einander ueberlagernde Karten, ein
# belaubter Baum ein Vielfaches davon.
szene.cycles.transparent_max_bounces = 64
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
