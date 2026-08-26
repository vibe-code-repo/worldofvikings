#!/usr/bin/env blender --background --python
"""
Erzeugt Dungeon-Bauteile des Kits `DG_Steingrab` als GLB.

    blender --background --python tools/steingrab-erzeugen.py -- \
        --teil gang --name SteingrabGang --ziel assets/models

── Warum ein Skript und nicht Handarbeit ────────────────────────────
Ein Dungeon-Bauteil ist kein Fels. Was einen Fels ausmacht, ist
Unregelmaessigkeit; was ein Bauteil ausmacht, ist das Gegenteil: Es muss
sich AUFS MILLIMETER ans Raster halten, sonst passt es beim zwanzigsten
Teil nicht mehr zusammen und niemand findet die Ursache. Genau davor
warnt der Kopfkommentar von `shared/src/dungeonRaster.ts`.

Ein Skript trifft 4,000 m. Eine gezogene Kante trifft 3,997 m, und das
faellt erst auf, wenn zwei Raeume um einen Spalt auseinanderstehen.
Deshalb hier dieselbe Bauart wie beim Messer (tools/messer-erzeugen.py):
prozedural, in echten Metern, jede Zahl im Quelltext nachlesbar.

── Der Vertrag, den dieses Skript einhaelt ──────────────────────────
Nachzulesen in `shared/src/eigeneDungeons.ts`, geprueft von
`shared/test/dungeon-raster.ts`:

  * Ursprung auf dem BODEN und mittig in der Grundflaeche.
  * Grundflaeche ein Vielfaches von 4 m.
  * Durchgaenge an den Schmalseiten, auf Bodenhoehe, mittig.

── Wo der Stein sitzt ───────────────────────────────────────────────
Die deklarierte Huellbox (4 x 4 x 8 m) ist das AUSSENMASS. Alles Stein
liegt darin, nichts ragt seitlich hinaus — sonst durchdringen sich die
Waende zweier nebeneinander gesetzter Teile, und man saehe zwei Mauern
im selben Raum. Der lichte Gang ist dadurch schmaler als die Huelle:
4 m minus zweimal Wandstaerke.

Nach unten ragt die Bodenplatte bewusst heraus. Die begehbare Flaeche
MUSS auf y = 0 liegen (dort sitzen die Connectors), und der Stein
darunter muss irgendwo hin. Alle Teile machen das gleich, also stossen
sie sauber aneinander.

── Textur ───────────────────────────────────────────────────────────
Es gibt noch keine. Das Teil traegt eine flache Grundfarbe, so wie die
Frisuren es bis heute tun. Ein Kunstpass kommt, wenn der Startsatz
steht — vorher waere er Arbeit an etwas, das sich noch aendert.
"""

import sys
import os
import math

import bpy
import bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    """Liest `--name wert` aus der Befehlszeile hinter dem `--`."""
    key = f'--{name}'
    if key in argv:
        i = argv.index(key)
        if i + 1 < len(argv):
            return argv[i + 1]
    return default


TEIL = arg('teil', 'gang')
NAME = arg('name', 'SteingrabGang')
ZIEL = arg('ziel', 'assets/models')

# ── Raster und Abmessungen ──────────────────────────────────────────
# RASTER stimmt mit DUNGEON_RASTER_M aus shared/src/dungeonRaster.ts
# ueberein. Wer es hier aendert, aendert es dort mit — sonst meldet die
# Pruefung ein Teil als falsch, das nach diesem Skript richtig ist.
RASTER = 4.0

BREITE = 4.0    # x — Aussenmass, ein Rastervielfaches
HOEHE = 4.0     # z in Blender — Bodenflaeche bis Deckenoberkante
LAENGE = 8.0    # y in Blender — zwei Rastereinheiten

WANDSTAERKE = 0.25
BODENSTAERKE = 0.30
DECKENSTAERKE = 0.30

# Farbe: kalter, leicht gruenstichiger Grauton. Nicht neutralgrau —
# das wirkt unter dem warmen Fackellicht des Spiels wie Beton.
STEINFARBE = (0.34, 0.35, 0.33, 1.0)


def leere_szene():
    """Startet von einer leeren Szene, egal was die Vorlage mitbringt."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1.0


def quader(name, mitte, groesse):
    """Ein achsparalleler Quader aus Mittelpunkt und Kantenlaengen."""
    netz = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, netz)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(groesse), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(mitte), verts=bm.verts)
    bm.to_mesh(netz)
    bm.free()
    return obj


def baue_gang():
    """
    Bodenplatte, zwei Waende, Decke. Die Schmalseiten bleiben OFFEN —
    dort koppeln die Nachbarteile, eine Wand davor waere eine Sackgasse.
    """
    halbe_breite = BREITE / 2
    innen_x = halbe_breite - WANDSTAERKE

    teile = [
        # Boden: volle Aussenbreite, Oberkante auf z = 0.
        quader('Boden', (0, 0, -BODENSTAERKE / 2), (BREITE, LAENGE, BODENSTAERKE)),
        # Zwei Waende, INNEN an der Huelle, vom Boden bis unter die Decke.
        quader('WandLinks',
               (-(halbe_breite - WANDSTAERKE / 2), 0, (HOEHE - DECKENSTAERKE) / 2),
               (WANDSTAERKE, LAENGE, HOEHE - DECKENSTAERKE)),
        quader('WandRechts',
               (halbe_breite - WANDSTAERKE / 2, 0, (HOEHE - DECKENSTAERKE) / 2),
               (WANDSTAERKE, LAENGE, HOEHE - DECKENSTAERKE)),
        # Decke: Oberkante genau auf Huellhoehe.
        quader('Decke', (0, 0, HOEHE - DECKENSTAERKE / 2), (BREITE, LAENGE, DECKENSTAERKE)),
    ]
    return teile, innen_x


def vereinen(teile, name):
    """Alles zu einem Objekt — ein Bauteil ist ein Prefab, nicht vier."""
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in teile:
        o.select_set(True)
    bpy.context.view_layer.objects.active = teile[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    return obj


def material_setzen(obj):
    """
    Ein Material, flache Grundfarbe.

    Rauheit hoch, Metallanteil null: Stein spiegelt nicht. Der Name ist
    deutsch wie bei allen eigenen Modellen und traegt `platzhalter`, weil
    genau das gemeint ist — er soll auffallen, wenn er in einem Jahr
    immer noch da ist.
    """
    mat = bpy.data.materials.new('stein_platzhalter')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = STEINFARBE
    bsdf.inputs['Roughness'].default_value = 0.92
    bsdf.inputs['Metallic'].default_value = 0.0
    obj.data.materials.append(mat)


def kanten_brechen(obj, weite=0.02):
    """
    Eine schmale Fase auf jede Kante.

    Zwei Gruende, beide sichtbar: Eine perfekt scharfe Kante fangt kein
    Licht und verschwindet in der Schattierung — mit Fase zeichnet sie
    sich ab. Und sie nimmt dem Teil das Wuerfelhafte, ohne dass ein
    einziges Mass sich aendert.
    """
    mod = obj.modifiers.new('Fase', 'BEVEL')
    mod.width = weite
    mod.segments = 1
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(30)


def messen(obj):
    """
    Nachmessen statt annehmen.

    Die Zahlen im Kopf dieses Skripts sind die ABSICHT. Was zaehlt, ist
    das Ergebnis nach Modifikatoren — deshalb wird die ausgewertete Fassung
    gemessen und ausgegeben, damit ein Fehler hier auffaellt und nicht
    erst in der Rasterpruefung drei Schritte spaeter.
    """
    tiefe = bpy.context.evaluated_depsgraph_get()
    ausgewertet = obj.evaluated_get(tiefe)
    netz = ausgewertet.to_mesh()
    ecken = [ausgewertet.matrix_world @ v.co for v in netz.vertices]
    masse = {
        'x': (min(p.x for p in ecken), max(p.x for p in ecken)),
        'y': (min(p.y for p in ecken), max(p.y for p in ecken)),
        'z': (min(p.z for p in ecken), max(p.z for p in ecken)),
    }
    dreiecke = sum(len(p.vertices) - 2 for p in netz.polygons)
    ausgewertet.to_mesh_clear()
    return masse, dreiecke


def main():
    leere_szene()

    if TEIL != 'gang':
        raise SystemExit(f'Unbekanntes Teil: {TEIL} (bisher nur "gang")')

    teile, innen_x = baue_gang()
    obj = vereinen(teile, NAME)
    material_setzen(obj)
    kanten_brechen(obj)

    masse, dreiecke = messen(obj)

    ziel_pfad = os.path.join(ZIEL, f'{NAME}.glb')
    os.makedirs(ZIEL, exist_ok=True)

    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    # export_yup: Blender ist Z-hoch, glTF ist Y-hoch. Ohne diese Zeile
    # laege der Gang auf der Seite. Dieselben Flags wie bei allen anderen
    # Werkzeugen des Projekts.
    bpy.ops.export_scene.gltf(
        filepath=ziel_pfad,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
    )

    groesse = os.path.getsize(ziel_pfad) / 1e6
    print()
    print(f'FERTIG {ziel_pfad} — {dreiecke} Dreiecke, {groesse:.3f} MB')
    print(f'  Aussenmass  x {masse["x"][0]:+.3f} … {masse["x"][1]:+.3f}  '
          f'({masse["x"][1] - masse["x"][0]:.3f} m, Soll {BREITE:.3f})')
    print(f'  Laenge      y {masse["y"][0]:+.3f} … {masse["y"][1]:+.3f}  '
          f'({masse["y"][1] - masse["y"][0]:.3f} m, Soll {LAENGE:.3f})')
    print(f'  Hoehe       z {masse["z"][0]:+.3f} … {masse["z"][1]:+.3f}  '
          f'(Bodenflaeche auf 0, Decke auf {HOEHE:.3f})')
    print(f'  lichter Gang: {2 * innen_x:.3f} m breit, '
          f'{HOEHE - DECKENSTAERKE:.3f} m hoch')
    print(f'  Durchgaenge:  y = {-LAENGE / 2:+.3f} und {LAENGE / 2:+.3f}, offen')


main()
