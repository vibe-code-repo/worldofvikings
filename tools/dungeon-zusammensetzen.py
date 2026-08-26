#!/usr/bin/env blender --background --python
"""
Setzt ein erzeugtes Dungeon-Layout aus den Bauteil-GLBs zusammen und
rendert es von oben.

    blender --background --python tools/dungeon-zusammensetzen.py -- \
        --layout /tmp/layout.json --modelle assets/models \
        --out /tmp/dungeon.png [--innen]

── Wozu ─────────────────────────────────────────────────────────────
Die Rasterpruefung sagt, ob ein EINZELNES Teil das Raster haelt. Sie
sagt nichts darueber, ob zwei Teile aneinander passen — dafuer muesste
sie den Generator kennen. Der Zusammenbau beantwortet genau diese
Frage, und zwar sichtbar: Ein Spalt zwischen zwei Raeumen ist auf einem
Bild von oben nicht zu uebersehen, im Zahlenwerk dagegen schon.

Das ist der „Loopback"-Stresstest aus dem Level Design Book, nur mit
dem Generator als Autor statt der Hand.

── Achsen ───────────────────────────────────────────────────────────
Das Layout steht in SPIELKOORDINATEN (glTF, Y-hoch). Blender ist
Z-hoch, und der glTF-Import dreht die Modelle beim Laden bereits
zurueck. Die Positionen und Drehungen aus dem Layout muessen deshalb
mitgedreht werden:

    Ort:      (x, y, z)          ->  (x, -z, y)
    Drehung:  (qx, qy, qz, qw)   ->  (qw, qx, -qz, qy)

Beides ist dieselbe Achsvertauschung, einmal auf einen Punkt und
einmal auf den Vektorteil eines Quaternions angewandt.
"""

import sys
import os
import json
import math

import bpy
import bmesh
from mathutils import Vector, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    key = f'--{name}'
    if key in argv:
        i = argv.index(key)
        if i + 1 < len(argv):
            return argv[i + 1]
    return default


LAYOUT = arg('layout', '/tmp/layout.json')
MODELLE = arg('modelle', 'assets/models')
OUT = arg('out', '/tmp/dungeon.png')
BREITE = int(arg('breite', '1100'))
INNEN = '--innen' in argv
# Schnitthoehe fuer den Blick von oben: ueber Kopfhoehe, damit die Waende
# noch als Waende zu sehen sind, aber unter der Decke.
SCHNITTHOEHE = float(arg('schnitt', '2.4'))

# Raeume, die sich eine GLB teilen — als "Raumname=Dateiname", mehrere
# durch Komma getrennt:
#
#   --alias SteingrabGangDurch=SteingrabGang
#
# Die Tabelle wird hier NICHT gefuehrt. Ihre Wahrheit steht in
# `MODELL_ALIAS` in `client/src/engine/AssetManager.ts`, und eine zweite
# Fassung daneben liefe beim ersten Eintrag auseinander, den jemand nur an
# einer Stelle nachtraegt. Wer das Werkzeug ruft, gibt sie mit.
#
# Fehlt sie, meldet Blender „Please select a file" und nennt keinen Namen —
# darum steht der Grund hier und nicht im Fehlerprotokoll.
ALIAS = dict(
    paar.split('=', 1) for paar in (arg('alias', '') or '').split(',') if '=' in paar
)

bpy.ops.wm.read_factory_settings(use_empty=True)

with open(LAYOUT, encoding='utf-8') as f:
    raeume = json.load(f)

# Jedes Modell EINMAL laden, danach nur noch Kopien mit gemeinsamen
# Netzdaten. Sechs volle Importe waeren sechsmal dieselbe Geometrie im
# Speicher — und bei einem Dungeon aus 40 Raeumen faellt das auf.
vorlagen = {}


def deckel_abnehmen(netz, hoehe):
    """
    Schneidet alles oberhalb von `hoehe` weg.

    Von oben sieht man sonst genau eine Sache: die Decke. Die Frage ist
    aber, ob die WAENDE zweier Teile buendig stossen — dafuer muss der
    Blick hinein. Geschnitten wird die VORLAGE, nicht jede Kopie: Alle
    Kopien teilen sich diese Netzdaten, ein Schnitt wirkt also fuer den
    ganzen Dungeon und kostet ihn nur einmal.
    """
    bm = bmesh.new()
    bm.from_mesh(netz)
    bmesh.ops.bisect_plane(
        bm,
        geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
        plane_co=(0, 0, hoehe),
        plane_no=(0, 0, 1),
        clear_outer=True,
    )
    bm.to_mesh(netz)
    bm.free()


def vorlage(name):
    if name in vorlagen:
        return vorlagen[name]
    datei = ALIAS.get(name, name)
    pfad = os.path.join(MODELLE, f'{datei}.glb')
    if not os.path.exists(pfad):
        raise SystemExit(
            f'{pfad} fehlt. Traegt der Raum "{name}" einen Alias? '
            f'Dann --alias {name}=<Dateiname> mitgeben (siehe MODELL_ALIAS).')
    vorher = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=pfad)
    neu = [o for o in bpy.context.scene.objects if o not in vorher and o.type == 'MESH']
    if not neu:
        raise SystemExit(f'kein Netz in {pfad}')
    obj = neu[0]
    if not INNEN:
        deckel_abnehmen(obj.data, SCHNITTHOEHE)
    obj.hide_render = True
    vorlagen[name] = obj
    return obj


gesetzt = 0
for i, r in enumerate(raeume):
    quelle = vorlage(r['room'])
    kopie = quelle.copy()          # Objekt neu, Netzdaten geteilt
    kopie.hide_render = False
    bpy.context.collection.objects.link(kopie)

    p = r['pos']
    kopie.location = Vector((p['x'], -p['z'], p['y']))

    q = r['rot']
    kopie.rotation_mode = 'QUATERNION'
    kopie.rotation_quaternion = Quaternion((q['w'], q['x'], -q['z'], q['y']))
    kopie.name = f'{r["room"]}_{i}'
    gesetzt += 1

netze = [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render]
ecken = [o.matrix_world @ Vector(e) for o in netze for e in o.bound_box]
mitte = Vector((
    (min(p.x for p in ecken) + max(p.x for p in ecken)) / 2,
    (min(p.y for p in ecken) + max(p.y for p in ecken)) / 2,
    0.0,
))
spanne = max(
    max(p.x for p in ecken) - min(p.x for p in ecken),
    max(p.y for p in ecken) - min(p.y for p in ecken),
)

if INNEN:
    bpy.ops.object.camera_add(location=mitte + Vector((0, 0, 1.7)))
    kam = bpy.context.object
    kam.data.lens = 22
    kam.rotation_euler = (math.radians(85), 0, math.radians(35))
else:
    # Von oben, leicht gekippt: Senkrecht von oben saehe man die Waende
    # gar nicht, und ob zwei Teile buendig stossen, entscheidet sich an
    # der Wand — nicht am Boden.
    hoehe = spanne * 1.6 + 10
    bpy.ops.object.camera_add(location=mitte + Vector((-spanne * 0.5, -spanne * 0.85, hoehe)))
    kam = bpy.context.object
    kam.data.lens = 30
    ziel = mitte + Vector((0, 0, 1.5))
    kam.rotation_euler = (ziel - kam.location).to_track_quat('-Z', 'Y').to_euler()

bpy.context.scene.camera = kam

bpy.ops.object.light_add(type='SUN', location=mitte + Vector((0, 0, 30)))
sonne = bpy.context.object
sonne.data.energy = 3.2
sonne.rotation_euler = (math.radians(46), 0, math.radians(38))

bpy.ops.object.light_add(type='AREA', location=mitte + Vector((0, 0, 12)))
fuell = bpy.context.object
fuell.data.energy = 900
fuell.data.size = spanne
fuell.data.color = (0.85, 0.9, 1.0)

szene = bpy.context.scene
szene.render.engine = 'CYCLES'
szene.cycles.samples = 64
szene.cycles.use_denoising = True
szene.render.resolution_x = BREITE
szene.render.resolution_y = int(BREITE * 0.66)
szene.render.filepath = OUT
szene.render.image_settings.file_format = 'PNG'
szene.render.film_transparent = False
szene.view_settings.look = 'AgX - Base Contrast'

bpy.ops.render.render(write_still=True)

dreiecke = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in netze)
print(f'\nZUSAMMENBAU {OUT} — {gesetzt} Raeume aus {len(vorlagen)} Bauteilen, '
      f'{dreiecke} Dreiecke, Ausdehnung {spanne:.1f} m')
