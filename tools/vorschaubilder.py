#!/usr/bin/env blender --background --python
"""
Rendert Vorschaubilder für viele GLBs in EINEM Blender-Lauf — Icon-Bild
je Modell für den Spawn-Editor (client/src/editor/SpawnPanel.ts).

    blender --background --python tools/vorschaubilder.py -- \
        --liste /tmp/render-liste.txt --ziel assets/vorschau [--breite 160]

`--liste` ist eine Textdatei, je Zeile `<Name><TAB><Pfad relativ zum
Repo-Wurzel>`, z. B. `Fichte1<TAB>assets/models/Fichte1.glb`. Ausgabe ist
`<ziel>/<Name>.png`.

── Warum EIN Prozess statt einem je Modell ───────────────────────────
Ein `blender --background` startet mit allen Add-ons in unter einer
Sekunde, aber bei 142 Modellen macht selbst das eine halbe Stunde reinen
Prozessstart. Dieses Skript lädt Blender EINMAL und leert die Szene
zwischen den Modellen mit `read_factory_settings(use_empty=True)` — das
ist ein In-Prozess-Reset, kein Neustart.

── Warum Cycles und nicht EEVEE ──────────────────────────────────────
Wie in glb-vorschau.py: EEVEE braucht einen GL-Kontext, der headless auf
einem Server ohne GPU nicht zuverlässig zustandekommt. Cycles rechnet auf
der CPU. Für Icon-Auflösung reichen 24 Samples.

── Kamera ─────────────────────────────────────────────────────────────
Abstand und nicht der Blickwinkel folgt der Hüllbox: Ein 22-m-Baum und
ein 0,3-m-Grasbüschel bekommen denselben Betrachtungswinkel, aber einen
Abstand, der aus dem Hüllboxen-Durchmesser und dem Kamera-Öffnungswinkel
berechnet ist — sonst füllt der Baum das Bild und das Gras verschwindet
als Punkt (oder umgekehrt).

── Modelle ohne Geometrie ─────────────────────────────────────────────
Ein GLB ganz ohne Mesh (z. B. ein bloßes Rig) liefert kein Bild — ein
leeres transparentes PNG wäre nicht von einem Ladefehler zu unterscheiden.
Solche Namen werden übersprungen und am Ende aufgelistet.
"""
import math
import os
import sys
import time

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


LISTE = arg('--liste')
ZIELDIR = arg('--ziel', 'assets/vorschau')
BREITE = int(arg('--breite', '160'))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

if not LISTE:
    raise SystemExit('--liste fehlt')

os.makedirs(os.path.join(ROOT, ZIELDIR) if not os.path.isabs(ZIELDIR) else ZIELDIR, exist_ok=True)
ZIELDIR_ABS = os.path.join(ROOT, ZIELDIR) if not os.path.isabs(ZIELDIR) else ZIELDIR

with open(LISTE, encoding='utf-8') as f:
    eintraege = []
    for zeile in f:
        zeile = zeile.strip()
        if not zeile:
            continue
        name, pfad = zeile.split('\t')
        eintraege.append((name, pfad))


def cutout_reparieren():
    """Wie glb-vorschau.py: AssetRipper-Exporte melden OPAQUE, obwohl die
    Textur einen echten Alphakanal hat. Ohne die Reparatur rendert Laub als
    Wolke schwarzer Rechtecke statt als Lücken."""
    for mat in bpy.data.materials:
        if mat.use_nodes and mat.blend_method == 'CLIP':
            continue
        if not mat.use_nodes:
            continue
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        if not bsdf:
            continue
        for verb in bsdf.inputs['Base Color'].links:
            bild = getattr(verb.from_node, 'image', None)
            if bild is None or bild.channels < 4:
                continue
            mat.node_tree.links.new(verb.from_node.outputs['Alpha'], bsdf.inputs['Alpha'])
            mat.blend_method = 'CLIP'
            mat.shadow_method = 'CLIP'
            mat.alpha_threshold = 0.5
            mat.use_backface_culling = False


def szene_aufbauen():
    """Licht, Welt und Kamera — nach jedem read_factory_settings neu, weil
    der Reset auch diese Datablocks entfernt."""
    welt = bpy.data.worlds.new('welt')
    bpy.context.scene.world = welt
    welt.use_nodes = True
    welt.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.58, 0.68, 1)
    welt.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9

    bpy.ops.object.light_add(type='SUN', location=(0, 0, 5))
    sonne = bpy.context.object
    sonne.data.energy = 3.0
    sonne.data.angle = math.radians(3)
    sonne.rotation_euler = (math.radians(52), 0, math.radians(38))

    # Kaltes Gegenlicht von der anderen Seite, sonst ist die Schattenseite
    # bei einem einzelnen Icon-Bild (keine Bounces von einem Boden) fast
    # schwarz.
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 5))
    fuell = bpy.context.object
    fuell.data.energy = 0.9
    fuell.data.color = (0.75, 0.82, 1.0)
    fuell.rotation_euler = (math.radians(-40), 0, math.radians(-130))

    kam_daten = bpy.data.cameras.new('kam')
    kam_daten.lens = 45
    kam = bpy.data.objects.new('kam', kam_daten)
    bpy.context.collection.objects.link(kam)
    bpy.context.scene.camera = kam
    return kam


szene = bpy.context.scene
szene.render.engine = 'CYCLES'
szene.cycles.device = 'CPU'
szene.cycles.samples = 24
szene.cycles.use_denoising = False
szene.cycles.transparent_max_bounces = 64
szene.render.film_transparent = True
szene.render.resolution_x = BREITE
szene.render.resolution_y = BREITE
szene.render.image_settings.file_format = 'PNG'
szene.render.image_settings.color_mode = 'RGBA'
szene.render.image_settings.compression = 90

erzeugt = []
ohne_geometrie = []
fehler = []
t_start = time.time()

for name, relpfad in eintraege:
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    szene = bpy.context.scene
    szene.render.engine = 'CYCLES'
    szene.cycles.device = 'CPU'
    szene.cycles.samples = 24
    szene.cycles.use_denoising = False
    szene.cycles.transparent_max_bounces = 64
    szene.render.film_transparent = True
    szene.render.resolution_x = BREITE
    szene.render.resolution_y = BREITE
    szene.render.image_settings.file_format = 'PNG'
    szene.render.image_settings.color_mode = 'RGBA'
    szene.render.image_settings.compression = 90

    voll = os.path.join(ROOT, relpfad)
    if not os.path.isfile(voll):
        print(f'FEHLT {name}: {relpfad} existiert nicht')
        fehler.append(name)
        continue
    try:
        bpy.ops.import_scene.gltf(filepath=voll)
    except Exception as exc:  # noqa: BLE001 — Import darf den Lauf nicht abbrechen
        print(f'IMPORT-FEHLER {name}: {exc}')
        fehler.append(name)
        continue

    objekte = [o for o in bpy.context.scene.objects if o.type == 'MESH' and len(o.data.vertices) > 0]
    if not objekte:
        print(f'OHNE GEOMETRIE: {name} ({relpfad}) — kein Bild erzeugt')
        ohne_geometrie.append(name)
        continue

    cutout_reparieren()

    ecken = [o.matrix_world @ Vector(e) for o in objekte for e in o.bound_box]
    mn = Vector((min(p.x for p in ecken), min(p.y for p in ecken), min(p.z for p in ecken)))
    mx = Vector((max(p.x for p in ecken), max(p.y for p in ecken), max(p.z for p in ecken)))
    mitte = (mn + mx) / 2
    durchmesser = max((mx - mn).length, 0.05)

    kam = szene_aufbauen()

    # Fester Blickwinkel (3/4 von schräg oben) für ein einheitliches
    # Icon-Set, aber Abstand aus der Hüllbox — das ist der Teil, der sich
    # je Modell ändern MUSS: ein 22-m-Baum und ein 0,3-m-Gras dürfen nicht
    # denselben Kameraabstand bekommen.
    fov = kam.data.angle  # horizontales Sichtfeld in Radiant
    abstand = (durchmesser / 2) / math.sin(fov / 2) * 1.25
    azimut = math.radians(35)
    elevation = math.radians(28)
    richtung = Vector((
        math.sin(azimut) * math.cos(elevation),
        -math.cos(azimut) * math.cos(elevation),
        math.sin(elevation),
    ))
    kam.location = mitte + richtung * abstand
    blick = mitte - kam.location
    kam.rotation_euler = blick.to_track_quat('-Z', 'Y').to_euler()

    ziel = os.path.join(ZIELDIR_ABS, f'{name}.png')
    szene.render.filepath = ziel
    bpy.ops.render.render(write_still=True)
    dt = time.time() - t0
    erzeugt.append(name)
    print(f'BILD {name}: {dt:.2f}s -> {ziel}')

gesamt = time.time() - t_start
print('----')
print(f'FERTIG: {len(erzeugt)} Bilder in {gesamt:.1f}s ({gesamt / max(len(eintraege), 1):.2f}s/Modell)')
if ohne_geometrie:
    print(f'OHNE GEOMETRIE ({len(ohne_geometrie)}): ' + ', '.join(ohne_geometrie))
if fehler:
    print(f'FEHLER ({len(fehler)}): ' + ', '.join(fehler))
