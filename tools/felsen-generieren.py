#!/usr/bin/env blender --background --python
"""
Erzeugt einen Felsen als GLB — verformte Kugel, Low-Poly, Textur aus
`tools/felsen-texturen.py`.

    blender --background --python tools/felsen-generieren.py -- \
        --art findling --name Findling1 --seed 3 --hoehe 2.4 --ziel assets/models

── Warum nicht Sapling ──────────────────────────────────────────────
Ein Fels hat keine Verzweigung. Was ihn ausmacht, ist eine geschlossene
Oberflaeche mit unregelmaessiger Form — also eine Kugel, die von
Rauschen verbeult wird. Das ist eine andere Bauart als Baum und Busch
und deshalb ein eigenes Werkzeug.

── Die drei Griffe, die einen Fels ausmachen ────────────────────────
1. VERFORMUNG in zwei Stufen. Grobes Rauschen gibt die Grundform (ist es
   ein rundlicher Findling oder ein kantiger Block?), feines die
   Oberflaeche. Nur eine Stufe ergibt entweder eine Kartoffel oder eine
   Golfballstruktur.
2. STAUCHUNG in der Hoehe. Ein Findling ist breiter als hoch; ohne das
   liegt eine Kugel in der Landschaft.
3. VERSENKEN. Der Pivot sitzt NICHT am tiefsten Punkt, sondern ein
   Stueck darueber — ein Fels steckt im Boden, er liegt nicht darauf.
   Das ist der Unterschied zwischen "Stein in der Landschaft" und
   "Stein auf der Landschaft", und man sieht ihn sofort.

── Kantigkeit ───────────────────────────────────────────────────────
`--kantig` schaltet von weichen auf flache Normalen um. Granit
verwittert rundlich, Basalt bricht kantig — dieselbe Geometrie wirkt je
nach Schattierung wie zwei verschiedene Gesteine.
"""

import sys
import os
import math
import random

import bpy
import bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


NAME = arg('--name', 'Findling1')
SEED = int(arg('--seed', '1'))
HOEHE = float(arg('--hoehe', '2.0'))
ZIEL = arg('--ziel', 'assets/models')
ART = arg('--art', 'findling')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── Arten ────────────────────────────────────────────────────────────
# `stauchung` ist Hoehe/Breite: 0.5 = doppelt so breit wie hoch.
# `grob`/`fein` sind die Amplituden der beiden Rauschstufen, jeweils als
# Anteil des Radius. `unterteilung` steuert die Dreieckszahl (2 = 320,
# 3 = 1280 Dreiecke bei einer Ikosphaere).
ARTEN = {
    # Der Findling: rundlich, breiter als hoch, moosiger Granit. Der
    # Regelfall in einer nordischen Landschaft.
    'findling': {
        'textur': 'granit_fels',
        'stauchung': 0.62,
        'grob': 0.22,
        'fein': 0.07,
        'unterteilung': 2,
        'kantig': False,
        'versenken': 0.18,      # Anteil der Hoehe, der im Boden steckt
    },
    # Felsblock: kantig gebrochener Basalt, fast wuerfelig. Wenig
    # Feinrauschen, dafuer flache Normalen — die Facetten sollen stehen.
    'block': {
        'textur': 'basalt_fels',
        'stauchung': 0.85,
        'grob': 0.38,
        'fein': 0.05,
        # Stufe 2 statt 1: Eine Ikosphaere der Stufe 1 ist ein Ikosaeder,
        # und 20 gleich grosse Flaechen lesen sich als geometrischer
        # Koerper. Erst mit 80 Flaechen und kraeftigerem Grobrauschen
        # entsteht ein gebrochener Block.
        'unterteilung': 2,
        'kantig': True,
        'versenken': 0.14,
    },
    # Felsnadel: hoch und schlank, ragt aus dem Hang. Der einzige Fels,
    # der HOEHER als breit ist.
    'nadel': {
        'textur': 'basalt_fels',
        'stauchung': 2.4,
        'grob': 0.24,
        'fein': 0.05,
        'unterteilung': 2,
        'kantig': True,
        'versenken': 0.22,
    },
    # Felsplatte: flach und breit, liegt im Gelaende. Genau die Bauart,
    # die im Vorbild als moosiger Buckel aus der Wiese schaut.
    'platte': {
        'textur': 'granit_fels',
        'stauchung': 0.34,
        'grob': 0.26,
        'fein': 0.06,
        'unterteilung': 2,
        'kantig': False,
        'versenken': 0.30,      # steckt tief — es ist ein Buckel
    },
    # Sandsteinbank: geschichtet, breit, mittelhoch.
    'bank': {
        'textur': 'sandstein_fels',
        'stauchung': 0.55,
        'grob': 0.20,
        'fein': 0.05,
        'unterteilung': 2,
        'kantig': True,
        'versenken': 0.20,
    },
}

if ART not in ARTEN:
    raise SystemExit(f'--art muss eine von {", ".join(ARTEN)} sein')
PROFIL = ARTEN[ART]
TEXTUR = os.path.join(ROOT, f'assets/textures/{PROFIL["textur"]}.png')
ZIEL_PFAD = os.path.join(ROOT, ZIEL, f'{NAME}.glb')

if not os.path.exists(TEXTUR):
    raise SystemExit(f'Textur fehlt: {TEXTUR}\n  python3 tools/felsen-texturen.py')


def leere_szene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def rauschwert(rnd_offsets, x, y, z, frequenz):
    """Summe dreier Sinus-Wellen je Achse — ein billiges, glattes Feld.

    Blenders `noise` waere feiner, braeuchte aber je Aufruf einen
    Modulimport und liefert nicht reproduzierbar dasselbe ueber
    Blender-Versionen. Drei phasenverschobene Sinus reichen fuer eine
    Beule vollkommen und sind vollstaendig deterministisch.
    """
    ox, oy, oz = rnd_offsets
    return (
        math.sin(x * frequenz + ox)
        * math.sin(y * frequenz * 1.13 + oy)
        * math.sin(z * frequenz * 0.87 + oz)
    )


def fels(rnd):
    """Ikosphaere, zweistufig verbeult und in der Hoehe gestaucht."""
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=PROFIL['unterteilung'], radius=1.0, location=(0, 0, 0)
    )
    obj = bpy.context.object
    obj.name = NAME

    grob_off = [rnd.uniform(0, 10) for _ in range(3)]
    fein_off = [rnd.uniform(0, 10) for _ in range(3)]

    me = obj.data
    for v in me.vertices:
        p = v.co.copy()
        # Zwei Stufen: grob gibt die Form, fein die Oberflaeche.
        g = rauschwert(grob_off, p.x, p.y, p.z, 1.7)
        f = rauschwert(fein_off, p.x, p.y, p.z, 5.3)
        faktor = 1.0 + PROFIL['grob'] * g + PROFIL['fein'] * f
        v.co = p * faktor

    # Stauchung: Ein Findling ist breiter als hoch.
    for v in me.vertices:
        v.co.z *= PROFIL['stauchung']

    return obj


def uv_kugel(obj):
    """Kugelprojektion — fuer einen Fels genau richtig.

    Sie verzerrt an den Polen, aber ein Gestein hat kein Muster, dessen
    Verzerrung auffiele; die Alternative (Smart UV Project) erzeugt
    Inseln mit sichtbaren Naehten quer ueber die Oberflaeche.
    """
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(obj.data)
    for f in bm.faces:
        f.select = True
    bpy.ops.uv.sphere_project(direction='ALIGN_TO_OBJECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    # Mehrfach wiederholen: Eine 256er-Textur ueber einen 4-m-Fels
    # gezogen ergibt 6 cm je Texel — die Koernung verschwaende.
    uv = obj.data.uv_layers.active
    if uv:
        for d in uv.data:
            d.uv = (d.uv[0] * 2.0, d.uv[1] * 2.0)


def material():
    mat = bpy.data.materials.new(f'{ART}_fels')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.92
    bsdf.inputs['Metallic'].default_value = 0.0
    if 'Specular' in bsdf.inputs:
        bsdf.inputs['Specular'].default_value = 0.08
    elif 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.08
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(TEXTUR, check_existing=True)
    tex.interpolation = 'Linear'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


def main():
    rnd = random.Random(SEED)
    leere_szene()

    obj = fels(rnd)
    uv_kugel(obj)
    obj.data.materials.append(material())

    # Schattierung: rundlich verwittert oder kantig gebrochen.
    bpy.context.view_layer.objects.active = obj
    if PROFIL['kantig']:
        bpy.ops.object.shade_flat()
    else:
        bpy.ops.object.shade_smooth()

    # Auf die bestellte Hoehe bringen — die Verformung hat sie verschoben.
    ecken = [obj.matrix_world @ Vector(e) for e in obj.bound_box]
    ist = max(p.z for p in ecken) - min(p.z for p in ecken)
    if ist > 1e-4:
        f = HOEHE / ist
        obj.scale = (f, f, f)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # ── Pivot: der Fels STECKT im Boden ─────────────────────────────
    # Nicht der tiefste Punkt kommt auf z=0, sondern ein Stueck darueber.
    # Ein Stein, der exakt aufsitzt, sieht aus wie hingelegt; einer, der
    # ein Fuenftel im Boden steckt, sieht aus wie gewachsen.
    ecken = [obj.matrix_world @ Vector(e) for e in obj.bound_box]
    tiefster = min(p.z for p in ecken)
    hoehe_ist = max(p.z for p in ecken) - tiefster
    obj.location.z -= tiefster + hoehe_ist * PROFIL['versenken']

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
    ecken = [obj.matrix_world @ Vector(e) for e in obj.bound_box]
    breite = max(
        max(p.x for p in ecken) - min(p.x for p in ecken),
        max(p.y for p in ecken) - min(p.y for p in ecken),
    )
    sichtbar = max(p.z for p in ecken)
    dreiecke = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    grosse = os.path.getsize(ZIEL_PFAD) / 1e6
    print(f'FERTIG {ZIEL_PFAD} — {dreiecke} Dreiecke, {grosse:.2f} MB, '
          f'renderScale {breite:.1f} x {sichtbar:.1f} m (ueber Grund)')


main()
