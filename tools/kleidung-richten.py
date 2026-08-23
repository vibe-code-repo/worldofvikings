#!/usr/bin/env blender --background --python
"""
Dreht die Flaechen eines Kleidungsstuecks so, dass alle Normalen von der
Haut wegzeigen — gegen durchblitzende Haut.

    blender --background --python tools/kleidung-richten.py -- \
        --koerper assets/models/wikingerin/WikingerinKoerper.glb \
        --teil    assets/models/wikingerin/R_LederShorts.glb

════════════════════════════════════════════════════════════════════
 Das Symptom und was NICHT dahintersteckte
════════════════════════════════════════════════════════════════════
Gemeldet war "an manchen Stellen blitzt die Haut durch, auch im Stand".
Der naheliegende Verdacht — zu wenig Abstand — ist nachgemessen falsch.
In Ruhepose (23.08.2026):

    R_LederBH      kein Vertex im Koerper, naechster Abstand +0,0013
    R_LederShorts  kein Vertex im Koerper, naechster Abstand +0,0024

Zwei weitere Anlaeufe gingen ebenfalls daneben und sind hier notiert,
damit sie niemand wiederholt:

  ABSTAND VERGROESSERN (Shrinkwrap OUTSIDE). Verbesserte die Zahlen
      leicht, machte die SCHLIMMSTE Stelle aber tiefer: −0,0439 →
      −0,0483. Grund: `NEAREST_SURFACEPOINT` schiebt vom naechsten
      Hautpunkt weg, und in Kerben — zwischen den Beinen, unter der
      Brust — zeigt diese Richtung auf die gegenueberliegende
      Koerperseite. Das Herausschieben drueckt die Ecke dort hinein.

  STRAHLENWURF entlang der Flaechennormale. Meldete schon VOR jeder
      Aenderung 30 % Durchstich — unmoeglich. Grund: genau der Fehler,
      den dieses Werkzeug behebt. Bei falsch herum liegenden Flaechen
      zeigt der Strahl in den Koerper und trifft ihn immer.

════════════════════════════════════════════════════════════════════
 Die eigentliche Ursache
════════════════════════════════════════════════════════════════════
Die Meshy-Kleidungsstuecke sind keine geschlossenen Schalen, sondern
lose Flicken: 1.643 von 4.960 Kanten des BH sind offene Raender, bei den
Shorts 4.673 von 7.624. Bei so etwas liegt die Flaechenorientierung
nicht fest, und der Exporter hat sie nicht vereinheitlicht:

    R_LederBH       766 von 2.759 Flaechen (27,8 %) nach innen
    R_LederShorts   752 von 3.525 Flaechen (21,3 %) nach innen

Eine Flaeche mit Normale nach innen wird vom Rueckseiten-Ausschluss
verworfen. Man sieht durch sie hindurch — auf die Haut dahinter. Genau
das Bild, das gemeldet wurde, und es tritt im Stand auf, weil es mit
Bewegung nichts zu tun hat.

════════════════════════════════════════════════════════════════════
 Warum nicht `recalc_face_normals`
════════════════════════════════════════════════════════════════════
Blenders Automatik raet "aussen" aus dem eigenen Volumen des Netzes. Bei
einer OFFENEN Flaeche gibt es kein Volumen, und sie raet falsch — dieser
Fehler hat in diesem Projekt schon einmal eine Tunika nach innen
gestuelpt (s. `nach_aussen()` in spieler-modular-generieren.py).

Hier gibt es eine bessere Referenz: den KOERPER. Kleidung liegt ueberall
dicht an der Haut, also ist "weg vom naechsten Hautpunkt" eindeutig
aussen. Danach wird jede Flaeche einzeln gerichtet — ohne Raten.
"""

import json
import os
import struct
import sys

import bmesh
import bpy
import mathutils

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


KOERPER = arg('--koerper')
TEIL = arg('--teil')
AUS = arg('--aus', TEIL)

if not KOERPER or not TEIL:
    raise SystemExit('--koerper <koerper.glb> --teil <teil.glb> [--aus <datei.glb>]')


def gelenke(pfad):
    """Gelenkliste einer GLB — die Teile werden im Spiel an das Skelett des
    Koerpers gebunden, und das geht nur bei gleicher Reihenfolge."""
    with open(pfad, 'rb') as f:
        roh = f.read()
    o, g = 12, None
    while o < len(roh):
        laenge = struct.unpack_from('<I', roh, o)[0]
        typ = struct.unpack_from('<I', roh, o + 4)[0]
        if typ == 0x4E4F534A:
            g = json.loads(roh[o + 8:o + 8 + laenge].decode('utf-8'))
        o += 8 + laenge + ((4 - (laenge % 4)) % 4)
    if not g or not g.get('skins'):
        return None
    return [g['nodes'][i].get('name') for i in g['skins'][0]['joints']]


gelenke_vorher = gelenke(TEIL)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=KOERPER)
armobj = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
armobj.data.pose_position = 'REST'
koerper = max((o for o in bpy.data.objects
               if o.type == 'MESH' and len(o.vertex_groups) > 0),
              key=lambda o: len(o.data.vertices))

vorher = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=TEIL)
teil_objekte = [o for o in bpy.data.objects if o not in vorher]
teil = max((o for o in teil_objekte
            if o.type == 'MESH' and len(o.vertex_groups) > 0),
           key=lambda o: len(o.data.polygons))
teil_arm = next((o for o in teil_objekte if o.type == 'ARMATURE'), None)
if teil_arm:
    teil_arm.data.pose_position = 'REST'
bpy.context.view_layer.update()

hilfs = koerper.to_mesh()
bvh = mathutils.bvhtree.BVHTree.FromPolygons(
    [v.co.copy() for v in hilfs.vertices],
    [list(p.vertices) for p in hilfs.polygons])
koerper.to_mesh_clear()
inv = koerper.matrix_world.inverted()


def zaehle(mesh_obj):
    """Wie viele Flaechen zeigen nach innen?"""
    mw = mesh_obj.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    innen = 0
    gesamt = 0
    for f in mesh_obj.data.polygons:
        loc, _, _, _ = bvh.find_nearest(inv @ (mw @ f.center))
        if loc is None:
            continue
        gesamt += 1
        weg = ((inv @ (mw @ f.center)) - loc).normalized()
        if (nm @ f.normal).normalized().dot(weg) < 0:
            innen += 1
    return innen, gesamt


innen_vor, gesamt = zaehle(teil)
print('TEIL %s — %d Flaechen' % (os.path.basename(TEIL), len(teil.data.polygons)))
print('VORHER  %d von %d nach innen (%.1f %%)'
      % (innen_vor, gesamt, 100 * innen_vor / max(1, gesamt)))

# ── Richten: jede Flaeche einzeln, gegen den Koerper als Referenz ───
bm = bmesh.new()
bm.from_mesh(teil.data)
bm.faces.ensure_lookup_table()
mw = teil.matrix_world
nm = mw.to_3x3().inverted().transposed()
gedreht = 0
for f in bm.faces:
    mitte = mw @ f.calc_center_median()
    loc, _, _, _ = bvh.find_nearest(inv @ mitte)
    if loc is None:
        continue
    weg = ((inv @ mitte) - loc).normalized()
    if (nm @ f.normal).normalized().dot(weg) < 0:
        f.normal_flip()
        gedreht += 1
bm.to_mesh(teil.data)
bm.free()
teil.data.update()
print('GEDREHT %d Flaechen' % gedreht)

innen_nach, _ = zaehle(teil)
print('NACHHER %d von %d nach innen (%.1f %%)'
      % (innen_nach, gesamt, 100 * innen_nach / max(1, gesamt)))

bpy.ops.object.select_all(action='DESELECT')
for o in teil_objekte:
    if o.name in bpy.data.objects:
        o.select_set(True)
bpy.context.view_layer.objects.active = teil_arm or teil
bpy.ops.export_scene.gltf(filepath=AUS, export_format='GLB', use_selection=True,
                          export_yup=True, export_animations=False, export_skins=True)

if gelenke(AUS) != gelenke_vorher:
    raise SystemExit('FEHLER: Gelenkliste hat sich geaendert — das Teil haenge '
                     'im Spiel am falschen Knochen. Datei nicht verwenden.')
print('GESCHRIEBEN %s — %.2f MB, Gelenkliste unveraendert'
      % (AUS, os.path.getsize(AUS) / 1048576))
