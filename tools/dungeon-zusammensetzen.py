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

Dazu kommt eine SPIEGELUNG der x-Achse je Bauteil. Sie ist keine
Achsvertauschung, sondern eine Nachbildung des Clients: Babylon laedt
GLBs in eine linkshaendige Szene und legt dafuer einen `__root__`-Knoten
mit Determinante -1 darueber (nachgerechnet in
`mess/babylon-orientierung.ts`), waehrend die Positionen aus dem ZDO
unveraendert bleiben. Wer hier ohne diese Spiegelung rendert, bekommt ein
schoenes Bild von etwas, das im Spiel anders steht — und genau das ist am
26./27.08.2026 passiert.
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
    geladen = json.load(f)
# Aeltere Ablagen sind eine blosse Raumliste; neuere tragen {rooms, doors}.
raeume = geladen['rooms'] if isinstance(geladen, dict) else geladen
tueren = geladen.get('doors', []) if isinstance(geladen, dict) else []

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
    # x spiegeln — genau das, was der Client tut, und deshalb das, was
    # dieses Bild zeigen muss. Sonst sagt der Zusammenbau „passt" ueber
    # eine Anordnung, die im Spiel nicht so aussieht. Begruendung und
    # Messung in `steingrab-erzeugen.py`, `in_spielachsen_spiegeln`.
    kopie.scale = Vector((-1.0, 1.0, 1.0))
    kopie.name = f'{r["room"]}_{i}'
    gesetzt += 1

# Tueren sitzen NICHT an einem Connector, sondern IN ihm: Der Generator
# schreibt ihnen `connection.pos` und `connection.rot`, also die
# Kopplungsebene zwischen zwei Raeumen. Genau deshalb gehoeren sie in
# dieses Bild — steht eine Tuer quer, ist das Modell in der falschen
# Ebene gebaut, und im Zahlenwerk sieht man davon nichts.
gesetzte_tueren = 0
for i, t in enumerate(tueren):
    quelle = vorlage(t['prefabName'])
    kopie = quelle.copy()
    kopie.hide_render = False
    bpy.context.collection.objects.link(kopie)
    p = t['pos']
    kopie.location = Vector((p['x'], -p['z'], p['y']))
    q = t['rot']
    kopie.rotation_mode = 'QUATERNION'
    kopie.rotation_quaternion = Quaternion((q['w'], q['x'], -q['z'], q['y']))
    # x spiegeln — genau das, was der Client tut, und deshalb das, was
    # dieses Bild zeigen muss. Sonst sagt der Zusammenbau „passt" ueber
    # eine Anordnung, die im Spiel nicht so aussieht. Begruendung und
    # Messung in `steingrab-erzeugen.py`, `in_spielachsen_spiegeln`.
    kopie.scale = Vector((-1.0, 1.0, 1.0))
    kopie.name = f'{t["prefabName"]}_{i}'
    gesetzte_tueren += 1

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
    # Augenhoehe der Figur, Blick die laengste Achse hinunter. `--stand`
    # und `--blick` setzen beides von aussen ("x,y,z") — die automatische
    # Wahl trifft bei einem geraden Gang, aber nicht bei einer Kammer am
    # Ende eines Gangs, wo es darauf ankommt, aus WELCHER Richtung man
    # hineinsieht.
    def punkt(text, vorgabe):
        if not text:
            return vorgabe
        a, b, c = (float(v) for v in text.split(','))
        return Vector((a, b, c))

    laengs_x = (max(p.x for p in ecken) - min(p.x for p in ecken)) >= \
               (max(p.y for p in ecken) - min(p.y for p in ecken))
    anfang = (min(p.x for p in ecken) if laengs_x else min(p.y for p in ecken)) + 1.2
    stand = punkt(arg('stand'),
                  Vector((anfang, mitte.y, 1.7)) if laengs_x
                  else Vector((mitte.x, anfang, 1.7)))
    ziel = punkt(arg('blick'),
                 Vector((mitte.x * 2, mitte.y, 1.55)) if laengs_x
                 else Vector((mitte.x, mitte.y * 2, 1.55)))
    bpy.ops.object.camera_add(location=stand)
    kam = bpy.context.object
    kam.data.lens = 22
    kam.rotation_euler = (ziel - stand).to_track_quat('-Z', 'Y').to_euler()

    # Eine Fackel, denn drinnen ist drinnen: Sonne und Flaechenlicht
    # stehen ueber der Decke und kommen nicht herein. Der erste Lauf
    # dieses Zweigs lieferte ein vollstaendig schwarzes Bild.
    bpy.ops.object.light_add(type='POINT', location=stand + Vector((0, 0, 0.4)))
    fackel = bpy.context.object
    fackel.data.energy = 600
    fackel.data.color = (1.0, 0.72, 0.42)
    fackel.data.shadow_soft_size = 0.3
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
print(f'\nZUSAMMENBAU {OUT} — {gesetzt} Raeume und {gesetzte_tueren} Tuer(en) '
      f'aus {len(vorlagen)} Bauteilen, {dreiecke} Dreiecke, '
      f'Ausdehnung {spanne:.1f} m')
