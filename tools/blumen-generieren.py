#!/usr/bin/env blender --background --python
"""
Erzeugt einen Blumen- oder Unkrauthorst als GLB.

    blender --background --python tools/blumen-generieren.py -- \
        --art margerite --name Margerite1 --seed 3 --hoehe 0.5 --ziel assets/models

── Warum das nicht durch busch-generieren.py laeuft ─────────────────
Ein Strauch hat Holz: sichtbare Triebe, die eine eigene Rinde tragen und
deren Verzweigung Sapling ausrechnet. Eine Blume hat keins. Was man von
ihr sieht, ist ein Stengel mit Blatt und Bluete — und der ist auf der
Karte schon gemalt. Sapling darauf anzuwenden hiesse, unsichtbare
Roehren zu bauen und sie dann mit Bildern zu verdecken.

Deshalb hier reine KARTENBUENDEL: je Pflanze ein Viereck, zwei Dreiecke.
Ein Horst aus 22 Karten kostet 44 Dreiecke — ein Dreissigstel des
sparsamsten Busches. Bei Bewuchs, von dem Hunderte herumstehen, ist das
der entscheidende Unterschied.

── Die drei Dinge, die dabei nicht offensichtlich sind ──────────────
1. `--hoehe` meint die Hoehe der PFLANZE, nicht die des Vierecks. Die
   Karte ist quadratisch, aber keine Art fuellt sie ganz aus; wie weit
   sie reicht, wird aus dem Alphakanal gemessen (`kartenfuellung`).
2. Die Normalen bleiben FLAECHENSENKRECHT, obwohl bei Grasbuescheln
   ueblicherweise nach oben gerichtete verwendet werden. Der Grund liegt
   im Client: Babylons glTF-Loader setzt bei `doubleSided` sowohl
   `backFaceCulling = false` als auch `twoSidedLighting = true`
   (glTFLoader.js:1874). Damit wird die Normale auf der Rueckseite
   gespiegelt — aus einer nach oben gerichteten wird eine nach unten
   gerichtete, und die Karte ist von hinten unbeleuchtet. Nach oben zu
   zeigen macht es also SCHLIMMER, nicht besser.
   Flaechensenkrecht plus Spiegelung heisst dagegen: Die Normale zeigt
   immer zum Betrachter, die Karte ist von beiden Seiten gleich hell.
   Das ist auch das Verhalten der vorhandenen Baum- und Buschkarten.
3. Die Karten stehen im GOLDENEN WINKEL um die Hochachse. Bei festen
   Schritten (etwa 60°) sieht man aus bestimmten Richtungen alle Karten
   auf Kante und der Horst verschwindet fast.
"""

import sys
import os
import math
import random

import bpy
from mathutils import Vector

# ── Argumente hinter "--" ────────────────────────────────────────────
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


NAME = arg('--name', 'Margerite1')
SEED = int(arg('--seed', '1'))
HOEHE = float(arg('--hoehe', '0.5'))
ZIEL = arg('--ziel', 'assets/models')
ART = arg('--art', 'margerite')
# Anzahl Karten und Streuradius als Anteil der Hoehe — beide je Art
# vorbelegt, per Argument uebersteuerbar.
KARTEN = arg('--karten')
RADIUS = arg('--radius')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── Arten ────────────────────────────────────────────────────────────
# `karten` ist die Zahl der Vierecke im Horst, `radius` ihr Streukreis
# als Anteil der Pflanzenhoehe, `neigung` die maximale Kippung in Grad.
#
# Die Werte beschreiben, WIE die Art waechst: Margeriten stehen locker
# verteilt, Brennnesseln bilden geschlossene Bestaende, ein Farn setzt
# wenige grosse Wedel.
ARTEN = {
    'glockenblume': {'karten': 14, 'radius': 0.75, 'neigung': 10, 'streuung': 0.30},
    'margerite':    {'karten': 13, 'radius': 0.80, 'neigung': 9,  'streuung': 0.30},
    'trollblume':   {'karten': 11, 'radius': 0.70, 'neigung': 8,  'streuung': 0.28},
    'schafgarbe':   {'karten': 12, 'radius': 0.75, 'neigung': 9,  'streuung': 0.28},
    'wollgras':     {'karten': 16, 'radius': 0.55, 'neigung': 7,  'streuung': 0.25},
    # Unkraut steht dichter und deckt Flaeche — mehr Karten, groesserer
    # Kreis. Die Brennnessel ist der Extremfall: ein geschlossener
    # Bestand, durch den man nicht hindurchsieht.
    'brennnessel':  {'karten': 20, 'radius': 0.62, 'neigung': 8,  'streuung': 0.22},
    'distel':       {'karten': 10, 'radius': 0.48, 'neigung': 8,  'streuung': 0.32},
    'ampfer':       {'karten': 12, 'radius': 0.55, 'neigung': 10, 'streuung': 0.30},
    'farn':         {'karten': 9,  'radius': 0.58, 'neigung': 12, 'streuung': 0.30},
    'seggen':       {'karten': 15, 'radius': 0.60, 'neigung': 8,  'streuung': 0.26},
}

if ART not in ARTEN:
    raise SystemExit(f'--art muss eine von {", ".join(ARTEN)} sein')
PROFIL = ARTEN[ART]
TEXTUR = os.path.join(ROOT, f'assets/textures/{ART}_karte.png')
ZIEL_PFAD = os.path.join(ROOT, ZIEL, f'{NAME}.glb')

if not os.path.exists(TEXTUR):
    raise SystemExit(f'Karte fehlt: {TEXTUR}\n'
                     f'  python3 tools/blumen-texturen.py --art {ART}')


def leere_szene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def kartenfuellung(bild):
    """Welchen Anteil der Kartenhoehe die Pflanze tatsaechlich einnimmt.

    Die Karte ist quadratisch, die Pflanze reicht aber nie ganz nach
    oben — bei der Margerite bis 84 %, beim Farn bis 95 %. Ohne diese
    Messung waere `--hoehe` je Art etwas anderes, und `renderScale` in
    prefabs.ts muesste je Modell nachgemessen werden.

    Gelesen wird der Alphakanal von OBEN her: die erste Zeile, in der
    ein Pixel deutlich sichtbar ist. Der Schwellwert liegt bei 128 wie
    der Cutoff des Materials — was das Material wegschneidet, zaehlt
    auch hier nicht.
    """
    b, h = bild.size
    px = bild.pixels[:]          # eine flache RGBA-Liste, Zeile 0 ist UNTEN
    for zeile in range(h - 1, -1, -1):
        basis = zeile * b * 4
        for spalte in range(b):
            if px[basis + spalte * 4 + 3] > 0.5:
                # Zeile h-1 ist oben; Fuellung = Anteil bis dorthin.
                return (zeile + 1) / h
    return 1.0


def material(textur_bild):
    """Cutout-Material auf die Kartentextur.

    Alphakanal an den Alpha-Eingang, Blendmodus CLIP: Der glTF-Exporter
    macht daraus `alphaMode: MASK` mit Cutoff 0.5 — genau das, was der
    AssetManager an Cutout-Bewuchs erwartet, und die Bedingung dafuer,
    dass das Wind-Plugin greift.
    """
    mat = bpy.data.materials.new(f'{ART}_karte')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Metallic'].default_value = 0.0
    if 'Specular' in bsdf.inputs:
        bsdf.inputs['Specular'].default_value = 0.05
    elif 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.05

    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = textur_bild
    tex.interpolation = 'Linear'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    mat.blend_method = 'CLIP'
    mat.alpha_threshold = 0.5
    mat.shadow_method = 'CLIP'
    mat.use_backface_culling = False
    return mat


def horst(rnd, kartenhoehe):
    """Baut das Kartenbuendel und liefert das fertige Mesh-Objekt.

    Jede Karte ist ein aufrecht stehendes Viereck mit der Unterkante auf
    z=0. Gedreht wird um die Hochachse (goldener Winkel), gekippt um die
    eigene Querachse — eine Blume steht selten senkrecht.
    """
    anzahl = int(KARTEN) if KARTEN else PROFIL['karten']
    radius_anteil = float(RADIUS) if RADIUS else PROFIL['radius']
    neigung_max = math.radians(PROFIL['neigung'])
    streuung = PROFIL['streuung']

    ecken, flaechen, uvs = [], [], []
    for i in range(anzahl):
        # Groessenstreuung: Ohne sie steht der Horst da wie gestanzt.
        # Sie geht nach UNTEN, wie die Trieblaenge bei den Bueschen — so
        # bleibt die groesste Pflanze genau `--hoehe` hoch. Symmetrisch
        # gestreut war ein als 40 cm bestellter Margeritenhorst 50 cm.
        f = 1.0 - streuung * rnd.random()
        halb = kartenhoehe * f * 0.5
        hoch = kartenhoehe * f

        drehung = i * 2.399963 + rnd.random() * 0.6      # goldener Winkel
        kippen = (rnd.random() * 2 - 1) * neigung_max
        r = radius_anteil * HOEHE * math.sqrt(rnd.random())
        mx, my = math.cos(drehung + 1.1) * r, math.sin(drehung + 1.1) * r

        # Kartenebene: `quer` liegt waagerecht, `auf` ist die gekippte
        # Hochachse. Gekippt wird um `quer`, damit die Karte zur Seite
        # neigt und nicht um sich selbst rollt.
        quer = Vector((math.cos(drehung), math.sin(drehung), 0.0))
        auf = Vector((-math.sin(drehung) * math.sin(kippen),
                      math.cos(drehung) * math.sin(kippen),
                      math.cos(kippen)))
        fuss = Vector((mx, my, 0.0))

        basis = len(ecken)
        ecken.extend([
            fuss - quer * halb,
            fuss + quer * halb,
            fuss + quer * halb + auf * hoch,
            fuss - quer * halb + auf * hoch,
        ])
        flaechen.append((basis, basis + 1, basis + 2, basis + 3))
        # Jede zweite Karte gespiegelt: halbiert die erkennbare
        # Wiederholung, ohne den Stiel von der Unterkante zu nehmen —
        # gekippt wird nur u.
        if rnd.random() < 0.5:
            uvs.extend([(1.0, 0.0), (0.0, 0.0), (0.0, 1.0), (1.0, 1.0)])
        else:
            uvs.extend([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])

    mesh = bpy.data.meshes.new(f'{NAME}_mesh')
    mesh.from_pydata([tuple(e) for e in ecken], [], flaechen)
    mesh.update()

    uv = mesh.uv_layers.new(name='UVMap')
    for schleife in mesh.loops:
        uv.data[schleife.index].uv = uvs[schleife.index]

    obj = bpy.data.objects.new(NAME, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def main():
    rnd = random.Random(SEED)
    leere_szene()

    bild = bpy.data.images.load(TEXTUR, check_existing=True)
    fuellung = kartenfuellung(bild)
    # Das Viereck muss hoeher sein als die Pflanze, weil oben Luft ist.
    kartenhoehe = HOEHE / max(0.2, fuellung)

    obj = horst(rnd, kartenhoehe)
    obj.data.materials.append(material(bild))

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    ecken = [obj.matrix_world @ Vector(e) for e in obj.bound_box]
    breite = max(max(p.x for p in ecken) - min(p.x for p in ecken),
                 max(p.y for p in ecken) - min(p.y for p in ecken))
    # Die gemessene Hoehe ist die des VIERECKS; die Pflanze darin reicht
    # nur bis `fuellung`. Fuer renderScale zaehlt die Pflanze.
    hoehe = (max(p.z for p in ecken) - min(p.z for p in ecken)) * fuellung

    os.makedirs(os.path.dirname(ZIEL_PFAD), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=ZIEL_PFAD,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
    )
    dreiecke = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    grosse = os.path.getsize(ZIEL_PFAD) / 1e6
    print(f'GEOMETRIE {len(obj.data.polygons)} Karten, Fuellung {fuellung:.0%}')
    print(f'FERTIG {ZIEL_PFAD} — {dreiecke} Dreiecke, {grosse:.2f} MB, '
          f'renderScale {breite:.1f} x {hoehe:.1f} m')


main()
