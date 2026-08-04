#!/usr/bin/env blender --background --python
"""
Erzeugt einen Nadelbaum als GLB — prozedurale Geometrie mit den
Original-Nadelkarten von Valheim.

    blender --background --python tools/baum-generieren.py -- \
        --name Fichte1 --seed 3 --hoehe 12 --ziel assets/models

── Warum nicht weiter mit Tripo ─────────────────────────────────────
Gemessen an drei erzeugten Bäumen: Tripo baut Laub als geschlossenen
Volumenkörper. Der Umriss ist dadurch ein glatter Kegel ohne Durchblick,
und die UV-Karte zerfällt in hunderte winzige Ast-Inseln, auf denen kein
zusammenhängendes Muster entsteht — die 4096er-Textur des letzten Baumes
ist ein Farbfleckenteppich. Tripos eigener Foliage-Leitfaden empfiehlt
für Laub ausdrücklich "simple planes, crosses ... with a good alpha
texture" statt generierter Volumengeometrie.

Genau das macht dieses Skript: Die Verzweigung kommt prozedural von
Sapling, das Laub sind flache Karten mit der freigestellten
Original-Nadeltextur (37 % echte Alpha-Löcher). Ergebnis ist die Bauart,
die der Rest der Engine erwartet — Cutout-Laub, das der vorhandene
Wind-Shader ohne Sonderweg bewegt.

── Der Atlas ────────────────────────────────────────────────────────
`PineTree_01.png` ist 256², linke Hälfte Zweigkarten, rechte Hälfte
Rinde. Die drei Zweige wurden über eine Zusammenhangsanalyse des
Alphakanals vermessen (siehe ZWEIGE) — von Hand abgelesene UVs schneiden
sonst Nadelspitzen ab.
"""

import sys
import os
import math
import random

import bpy
import addon_utils
from mathutils import Vector

# ── Argumente hinter "--" ────────────────────────────────────────────
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


NAME = arg('--name', 'Fichte1')
SEED = int(arg('--seed', '1'))
HOEHE = float(arg('--hoehe', '12'))
ZIEL = arg('--ziel', 'assets/models')
MAX_DREIECKE = int(arg('--max-dreiecke', '4000'))
TEXTUR = arg('--textur', 'assets/textures/PineTree_01.png')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEXTUR_PFAD = os.path.join(ROOT, TEXTUR)
ZIEL_PFAD = os.path.join(ROOT, ZIEL, f'{NAME}.glb')

# Gemessene UV-Rechtecke der drei Zweigkarten (u0, u1, v0, v1).
# v ist bereits von unten gezählt (Blender/glTF), das Bild läuft von oben.
ZWEIGE = [
    (0.0234, 0.3164, 0.0195, 0.4844),  # groß,  75×119 px
    (0.0273, 0.2188, 0.5156, 0.7773),  # mittel, 49×67 px
    (0.2891, 0.3906, 0.3594, 0.4844),  # klein,  26×32 px
]
# Rinde: rechte Atlashälfte. Etwas Rand lassen, damit das Filtern der
# Mipmaps keine Zweigreste über die Naht zieht.
RINDE = (0.52, 0.98)


def leere_szene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def sapling_baum():
    """Ruft Sapling mit Fichten-Parametern auf.

    Die Werte sind an einer Gemeinen Fichte orientiert: durchgehender
    gerader Stamm, Äste in Quirlen, nach unten hängende Spitzen. `shape 0`
    ist Saplings konische Grundform, `downAngle` über 90° lässt die Äste
    fallen statt abzustehen.
    """
    addon_utils.enable('add_curve_sapling', default_set=False)
    bpy.ops.curve.tree_add(
        do_update=True,
        chooseSet='0',
        bevel=True,           # Stamm/Äste als Röhren, nicht als Striche
        prune=False,
        showLeaves=True,
        useArm=False,
        seed=SEED,
        handleType='0',
        # ── Auflösung: der ganze Unterschied zwischen 42.000 und 3.000 ──
        # Der erste Lauf kam auf 40.992 Dreiecke allein für das Holz.
        # Schuld waren nicht die Bevel-Röhren (bevelRes ist schon 0),
        # sondern resU=4 — vier Unterteilungen je Kurvensegment, multipliziert
        # über alle Äste — und die dritte Verzweigungsebene: 32 × 14 × 6 sind
        # 2.688 Ästchen, jedes eine eigene Röhre.
        #
        # Zwei Ebenen genügen, weil den optischen Eindruck ohnehin die
        # Nadelkarten tragen. Was an Ästchen fehlt, sieht man im Spiel nicht;
        # was an Dreiecken fehlt, merkt jeder Wald.
        resU=1,
        bevelRes=0,
        levels=2,
        shape='0',            # konisch — die Grundform einer Fichte
        length=(1.0, 0.30, 0.42, 0.35),
        lengthV=(0.0, 0.12, 0.2, 0.0),
        branches=(0, 38, 11, 0),
        curveRes=(5, 3, 2, 1),
        curve=(0, -18, -22, 0),
        curveV=(18, 40, 60, 0),
        downAngle=(90, 105, 78, 45),
        downAngleV=(0, 22, 18, 10),
        rotate=(99.5, 137.5, 137.5, 137.5),
        rotateV=(15, 0, 0, 0),
        scale=HOEHE,
        scaleV=HOEHE * 0.1,
        ratio=0.014,
        ratioPower=1.3,
        baseSize=0.18,        # ab wo am Stamm Äste ansetzen
        baseSplits=0,
        segSplits=(0.1, 0.2, 0.1, 0),
        splitAngle=(12, 16, 14, 0),
        # Laub: GROSSE Karten statt vieler kleiner Blätter — eine Karte
        # trägt einen kompletten Nadelzweig, so wie im Original.
        #
        # Die Menge ist der Hebel für den ganzen Eindruck: Mit 9 Karten je
        # Ast (erster Versuch, 110 Stück insgesamt) stand da ein kahler
        # Jungbaum, durch den man hindurchsah. Ein Blatt kostet 2 Dreiecke —
        # bei einem Holzanteil von rund 900 ist reichlich Luft zum Budget.
        leaves=34,
        leafScale=0.5,
        leafScaleX=0.9,
        leafShape='rect',
        leafDist='6',
        bend=0.0,
        leafangle=-38,
    )


def zu_mesh(obj):
    """Kurve → Mesh, damit UVs und Export funktionieren."""
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if obj.type == 'CURVE':
        bpy.ops.object.convert(target='MESH')
    return bpy.context.view_layer.objects.active


def material(name, cutout):
    """Principled-Material auf die Atlastextur.

    Für das Laub wird der Alphakanal an den Alpha-Eingang gelegt und der
    Blendmodus auf CLIP gestellt; der glTF-Exporter macht daraus
    `alphaMode: MASK` mit Cutoff — genau das, was der AssetManager an
    Cutout-Laub erwartet, ohne dass er raten muss.
    """
    mat = bpy.data.materials.new(name)
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
    tex.image = bpy.data.images.load(TEXTUR_PFAD, check_existing=True)
    tex.interpolation = 'Linear'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])

    if cutout:
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        mat.blend_method = 'CLIP'
        mat.alpha_threshold = 0.5
        mat.shadow_method = 'CLIP'
        mat.use_backface_culling = False
    return mat


def uv_auf_rechteck(mesh, u0, u1, v0, v1, pro_flaeche):
    """Legt die UVs jeder Fläche auf ein Rechteck des Atlas.

    pro_flaeche=True: jede Fläche bekommt das volle Rechteck (Laubkarten).
    Sonst wird nur linear in den Bereich skaliert (Rinde), damit die
    Rindenstruktur über die Stammlänge kachelt statt sich zu stauchen.
    """
    uv = mesh.uv_layers.active or mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        ecken = list(poly.loop_indices)
        if pro_flaeche and len(ecken) == 4:
            # Reihenfolge der Ecken beibehalten, damit die Karte nicht kippt
            for k, li in enumerate(ecken):
                su, sv = [(0, 0), (1, 0), (1, 1), (0, 1)][k]
                uv.data[li].uv = (u0 + su * (u1 - u0), v0 + sv * (v1 - v0))
        else:
            for li in ecken:
                alt = uv.data[li].uv
                uv.data[li].uv = (u0 + (alt[0] % 1.0) * (u1 - u0), alt[1])


def laub_karten_variieren(mesh, rnd):
    """Verteilt die drei Zweigkarten über die Laubflächen.

    Alle Karten gleich zu belegen erzeugt ein sichtbares Wiederholmuster —
    im Original sind es drei verschiedene Zweige, und genau die stehen im
    Atlas bereit.
    """
    uv = mesh.uv_layers.active or mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        u0, u1, v0, v1 = ZWEIGE[rnd.randrange(len(ZWEIGE))]
        gespiegelt = rnd.random() < 0.5   # halbiert die Wiederholung nochmal
        ecken = list(poly.loop_indices)
        if len(ecken) != 4:
            continue
        for k, li in enumerate(ecken):
            su, sv = [(0, 0), (1, 0), (1, 1), (0, 1)][k]
            if gespiegelt:
                su = 1.0 - su
            uv.data[li].uv = (u0 + su * (u1 - u0), v0 + sv * (v1 - v0))


def dreiecke(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def main():
    rnd = random.Random(SEED)
    leere_szene()
    sapling_baum()

    baum = bpy.data.objects.get('tree')
    laub = bpy.data.objects.get('leaves')
    if baum is None:
        raise SystemExit('Sapling hat kein Objekt "tree" erzeugt')

    baum = zu_mesh(baum)
    baum.data.materials.append(material('rinde', cutout=False))
    uv_auf_rechteck(baum.data, RINDE[0], RINDE[1], 0.0, 1.0, pro_flaeche=False)

    if laub is not None:
        laub.data.materials.clear()
        laub.data.materials.append(material('nadeln', cutout=True))
        laub_karten_variieren(laub.data, rnd)

    print(f'GEOMETRIE Stamm/Äste {dreiecke(baum)} Dreiecke, '
          f'Laub {dreiecke(laub) if laub else 0} Dreiecke')

    # Pivot auf den Stammfuß: Objekte sitzen an ihrer ZDO-Position auf.
    bpy.ops.object.select_all(action='DESELECT')
    for o in (baum, laub):
        if o:
            o.select_set(True)
    bpy.context.view_layer.objects.active = baum
    tiefster = min((o.matrix_world @ Vector(e)).z
                   for o in (baum, laub) if o
                   for e in o.bound_box)
    for o in (baum, laub):
        if o:
            o.location.z -= tiefster

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
    grosse = os.path.getsize(ZIEL_PFAD) / 1e6
    gesamt = dreiecke(baum) + (dreiecke(laub) if laub else 0)
    print(f'FERTIG {ZIEL_PFAD} — {gesamt} Dreiecke, {grosse:.2f} MB')
    if gesamt > MAX_DREIECKE:
        print(f'HINWEIS über Budget ({MAX_DREIECKE}) — branches/leaves senken')


main()
