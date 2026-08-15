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
from mathutils.bvhtree import BVHTree

# ── Argumente hinter "--" ────────────────────────────────────────────
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


NAME = arg('--name', 'Fichte1')
SEED = int(arg('--seed', '1'))
HOEHE = float(arg('--hoehe', '12'))
ZIEL = arg('--ziel', 'assets/models')
MAX_DREIECKE = int(arg('--max-dreiecke', '4500'))
ART = arg('--art', 'fichte')
# Faktor auf Ast- und Blattzahl. Sapling erzeugt unabhängig von der Höhe
# gleich viele Äste — eine 3-m-Jungtanne bekäme sonst dasselbe
# Dreiecksbudget wie eine ausgewachsene und wäre im Wald reine
# Verschwendung.
DICHTE = float(arg('--dichte', '1.0'))
# Faktor auf die Blattkartengröße (Vorgabe 1 = unverändert).
#
# Sapling behandelt `leafScale` als ABSOLUTE Länge in Metern, `scale`
# dagegen als Baumhöhe. Ein 22-m-Baum bekäme damit dieselben 62-cm-Karten
# wie eine 12-m-Fichte und stünde licht und kahl da — derselbe Fallstrick
# wie bei den Büschen (`karte` in tools/busch-generieren.py).
#
# BEWUSST ein Parameter mit Vorgabe 1 und keine automatische Kopplung an
# die Höhe: Die bestehenden Bäume sind mit den festen Werten gebaut und in
# shared/src/prefabs.ts mit gemessenem renderScale eingetragen. Eine
# automatische Skalierung würde sie beim nächsten Lauf alle verändern.
# Für einen neuen großen Baum setzt das Rezept den Faktor auf
# Zielhöhe / Referenzhöhe der Art.
KARTENFAKTOR = float(arg('--kartenfaktor', '1.0'))
# Faktor auf die Stammstärke (`ratio`, Vorgabe 1 = unverändert).
#
# Sapling rechnet den Stammradius als `ratio * scale`. Bei der Fichte
# (0.014) ergibt das auf 22 m einen Stamm von 62 cm Durchmesser — im
# Vorbild sind die Stämme eines alten Bestands eher einen Meter dick, und
# genau davon lebt das Bild: Der Stamm ist das dominante Element, nicht
# die Krone. Ein hoher Baum mit dünnem Stamm sieht aus wie eine Stange
# mit Grün obendrauf.
STAMMFAKTOR = float(arg('--stammfaktor', '1.0'))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── Arten ────────────────────────────────────────────────────────────
# Jede Art bringt ihre eigene Originaltextur samt vermessenen UV-Feldern
# und einen Satz Sapling-Parameter mit. Die UV-Rechtecke sind (u0,u1,v0,v1)
# mit v von UNTEN gezählt (Blender/glTF) — das Bild läuft von oben, wer das
# verwechselt, bekommt Rinde ins Laub.
ARTEN = {
    # Gemeine Fichte — schlank, hängende Äste. Textur PineTree_01.png (256²):
    # linke Hälfte drei Zweigkarten, rechte Hälfte Rinde.
    'fichte': {
        'textur': 'assets/textures/PineTree_01.png',
        'zweige': [
            (0.0234, 0.3164, 0.0195, 0.4844),  # groß,   75×119 px
            (0.0273, 0.2188, 0.5156, 0.7773),  # mittel, 49×67 px
            (0.2891, 0.3906, 0.3594, 0.4844),  # klein,  26×32 px
        ],
        'rinde': (0.52, 0.98, 0.0, 1.0),
    },
    # Tanne nach dem Original-Prefab `FirTree`. Textur Pine_tree_texture_d.png
    # (512²): unten DREI ganze Nadelzweige über die volle Höhe, oben links
    # Rinde, oben rechts ein fertiger Wipfel. Deutlich feiner gefiedert als
    # die Kiefernkarten — das ist der Grund, diese Art nicht einfach mit der
    # Fichtentextur zu bauen.
    'tanne': {
        'textur': 'assets/textures/Pine_tree_texture_d.png',
        'zweige': [
            (0.005, 0.350, 0.005, 0.655),   # linker Zweig
            (0.355, 0.675, 0.005, 0.675),   # mittlerer Zweig
            (0.680, 0.995, 0.005, 0.650),   # rechter Zweig
        ],
        # Konservativer Ausschnitt: Die Rinde läuft keilförmig aus, ein zu
        # großes Rechteck zieht den schwarzen Hintergrund in den Stamm.
        'rinde': (0.05, 0.60, 0.78, 0.97),
        # Abweichungen von der Fichten-Basis, abgelesen am gerenderten
        # Original-Prefab: Die Tanne ist GEDRUNGEN (5,4 m hoch bei 3,6 m
        # Breite, Verhältnis 1,5) und trägt ihre Äste fast waagerecht in
        # klaren Etagen — nicht hängend wie die Fichte. Ihr Laub beginnt
        # tief am Stamm und schließt sich zu einer fast undurchsichtigen
        # Krone.
        'sapling': {
            'length': (1.0, 0.36, 0.44, 0.35),   # längere Äste = breiter
            'downAngle': (90, 76, 68, 45),       # waagerecht statt fallend
            'attractUp': (0, -0.08, -0.05, 0),   # kaum Hängen
            'baseSize': 0.13,                    # Äste setzen tief an
            'branches': (0, 58, 15, 0),
            'leaves': 84,
            'leafScale': 0.58,
            'ratio': 0.017,                      # etwas kräftigerer Stamm
            'branchDist': 1.15,
        },
    },
    # ── Birke, hochstämmig ───────────────────────────────────────────
    # Nach Birch1/Birch2: breite RUNDE Krone auf hellem Stamm, im Original
    # aus wenigen grossen Blattkarten gebaut (344 Dreiecke fürs Ganze).
    # `birch_leaf.png` ist EINE Karte über die volle Textur — ein ganzer
    # belaubter Zweig mit weissem Ästchen, 61 % Löcher. Deshalb hier nur ein
    # UV-Feld statt drei, und die Rinde kommt aus einer eigenen Datei.
    #
    # Laubbaum heisst für Sapling: Äste STREBEN NACH OBEN statt zu hängen
    # (attractUp positiv, downAngle klein), der Stamm gabelt sich
    # (baseSplits), und die Krone ist kugelig statt konisch (shape 1).
    'birke': {
        'textur': 'assets/textures/birch_leaf.png',
        'textur_rinde': 'assets/textures/birch_bark.png',
        'zweige': [(0.0, 1.0, 0.0, 1.0)],
        'rinde': (0.0, 1.0, 0.0, 1.0),
        'sapling': {
            'shape': '1',                        # kugelige Krone
            'baseSize': 0.40,                    # hoher freier Stamm
            # KEIN baseSplits: Eine Gabel im unteren Stamm ergibt zwei dünne
            # Stämmchen — das Original hat einen durchgehenden.
            'baseSplits': 0,
            'branches': (0, 34, 16, 0),
            # Kürzere Äste halten die Krone geschlossen. Mit 0.42 stand da
            # ein Gerüst aus langen Ruten mit Laubbüscheln an den Enden.
            'length': (1.0, 0.32, 0.42, 0.35),
            'lengthV': (0.0, 0.26, 0.3, 0.0),
            'downAngle': (90, 58, 46, 45),       # Äste steigen an
            'downAngleV': (0, 28, 24, 10),
            'attractUp': (0, 0.35, 0.28, 0),     # nach oben strebend
            'curve': (0, 12, 18, 0),
            'curveV': (30, 60, 80, 0),
            'segSplits': (0.25, 0.35, 0.2, 0),
            'ratio': 0.010,                      # schlanker Stamm
            'branchDist': 1.0,
            # Das Original baut seine Krone aus wenigen GROSSEN Karten und
            # wirkt trotzdem geschlossen. Weil unsere Karten kleiner sitzen,
            # braucht es mehr davon — 40 ergaben einen durchsichtigen Baum.
            'leaves': 88,
            'leafScale': 0.82,
            'leafScaleV': 0.4,
            'leafangle': -18,
            'leafDownAngle': 38,
        },
    },
    # ── Eiche ────────────────────────────────────────────────────────
    # Die einzige Art mit EIGENEN Texturen: `eiche_leaf.png` und
    # `eiche_bark.png` werden von `tools/eiche-texturen.py` prozedural
    # gezeichnet, nicht aus Valheim gezogen. Beide sind eine ganze Karte,
    # daher wie bei der Birke nur ein UV-Feld.
    #
    # Eine Eiche ist kein hoher schlanker Baum, sondern ein BREITER. Der
    # Habitus lebt von drei Dingen, die hier alle gegen die Fichtenbasis
    # stehen: ein kurzer dicker Stamm (ratio hoch, baseSize niedrig), fast
    # waagerecht abgehende Aeste, die sich erst aussen aufrichten
    # (downAngle gross, attractUp erst auf der zweiten Ebene stark), und
    # kraeftige Krummheit (curveV hoch) — die knorrigen Aeste sind das,
    # woran man eine Eiche auf Entfernung erkennt.
    'eiche': {
        'textur': 'assets/textures/eiche_leaf.png',
        'textur_rinde': 'assets/textures/eiche_bark.png',
        'zweige': [(0.0, 1.0, 0.0, 1.0)],
        'rinde': (0.0, 1.0, 0.0, 1.0),
        'sapling': {
            'shape': '2',                        # halbkugelig: breit, oben flach
            'baseSize': 0.22,                    # Aeste setzen tief an
            'baseSplits': 0,
            'branches': (0, 38, 24, 0),
            # Lange erste Astebene — sie macht die Breite. Mit den 0.32 der
            # Birke bliebe die Krone schmal und der Baum saehe aus wie eine
            # dicke Birke.
            # Breit ja, aber nicht ausufernd: Mit 0.56 und downAngle 80 kam
            # eine Krone von 15,7 m Breite bei 13,2 m Hoehe heraus — breiter
            # als hoch. Valheims eigenes `Oak1` steht bei 6,0 × 9,0 m, also
            # Verhaeltnis 1,5 wie bei den anderen Arten auch. Ein Baum, der
            # im Wald doppelt so viel Platz braucht wie jeder andere, sprengt
            # die Bepflanzungsdichte.
            'length': (1.0, 0.34, 0.42, 0.35),
            'lengthV': (0.0, 0.28, 0.32, 0.0),
            'downAngle': (90, 68, 52, 45),       # ausladend, nicht waagerecht
            'downAngleV': (0, 26, 30, 10),
            # Erst die zweite Ebene strebt nach oben. Das ergibt den typischen
            # Knick: heraus, dann aufwaerts. Massvoll dosiert — mit 0.42 schoss
            # das Geaest ueber den Wipfel hinaus und eine als 8 m bestellte
            # Eiche wurde 11,1 m hoch.
            'attractUp': (0, 0.08, 0.22, 0),
            'curve': (0, 18, 26, 0),
            'curveV': (45, 95, 115, 0),          # knorrig
            'segSplits': (0.30, 0.40, 0.22, 0),
            'splitAngle': (16, 22, 18, 0),
            'ratio': 0.021,                      # kraeftiger Stamm
            'ratioPower': 1.2,
            'branchDist': 0.9,
            # WENIGE GROSSE Karten. Mit 96 kleinen (leafScale 0.70) sah die
            # Krone aus wie Farnwedel: Bei dieser Groesse liest das Auge
            # jede Karte einzeln als gefiederten Wedel statt als Laubmasse.
            # Eichenlaub ist das Gegenteil davon — kompakte Ballen.
            'leaves': 42,
            'leafScale': 1.35,
            # Die gezeichnete Karte ist etwa so breit wie hoch; die 0.85 der
            # Basis wuerden sie schmal quetschen und den Wedeleindruck
            # zurueckbringen.
            'leafScaleX': 1.0,
            'leafScaleV': 0.30,
            'leafangle': -24,
            'leafDownAngle': 46,
        },
    },
}

# ── Kiefer ───────────────────────────────────────────────────────────
# Die dritte Nadelart, und sie ist das Gegenteil der Fichte: langer
# ASTFREIER Stamm, die Krone sitzt als Schirm ganz oben. Genau daran
# erkennt man eine Kiefer auf Entfernung, und im Bestand macht sie den
# Unterschied — man sieht zwischen den Stämmen hindurch, aber nicht nach
# oben. Ein Fichtenwald schliesst unten, ein Kiefernwald oben.
#
# Drei Werte tragen den Habitus:
#   baseSize 0.55   — mehr als die halbe Höhe bleibt astfrei
#   attractUp 0.5   — die Äste STEIGEN, statt zu hängen (Fichte: −0.35)
#   length[1] 0.5   — und sie sind lang, damit der Schirm breit wird
ARTEN['kiefer'] = {
    'textur': 'assets/textures/PineTree_01.png',
    'zweige': ARTEN['fichte']['zweige'],
    'rinde': ARTEN['fichte']['rinde'],
    'sapling': {
        'shape': '2',                        # halbkugelig: Schirm statt Kegel
        'baseSize': 0.48,                    # langer freier Stamm
        'baseSplits': 0,
        'branches': (0, 34, 13, 0),
        'length': (1.0, 0.50, 0.42, 0.35),
        'lengthV': (0.0, 0.24, 0.28, 0.0),
        'downAngle': (90, 62, 50, 45),
        'downAngleV': (0, 26, 24, 10),
        'attractUp': (0, 0.50, 0.30, 0),     # Äste steigen zum Schirm
        'curve': (0, 14, 18, 0),
        'curveV': (18, 55, 70, 0),           # gerader Stamm
        'segSplits': (0.06, 0.24, 0.15, 0),
        'ratio': 0.019,                      # kräftiger als die Fichte
        'ratioPower': 1.25,
        'branchDist': 1.0,
        'leaves': 120,
        'leafScale': 0.66,
        'leafScaleX': 0.85,
        'leafangle': -30,
        'leafDownAngle': 46,
    },
}

# Dichte Variante: gleiche Art, aber Laub bis tief herunter und mehr davon.
# Als eigenes Profil statt als Schalter, weil sich fünf Werte ändern.
ARTEN['birke_dicht'] = {
    **ARTEN['birke'],
    'sapling': {
        **ARTEN['birke']['sapling'],
        'baseSize': 0.18,        # Laub beginnt tief — kaum freier Stamm
        'branches': (0, 48, 20, 0),
        'leaves': 110,
        'attractUp': (0, 0.22, 0.2, 0),
        'length': (1.0, 0.36, 0.44, 0.35),
    },
}

if ART not in ARTEN:
    raise SystemExit(f'--art muss eine von {", ".join(ARTEN)} sein')
PROFIL = ARTEN[ART]
TEXTUR_PFAD = os.path.join(ROOT, arg('--textur', PROFIL['textur']))
# Nadelbäume tragen Laub und Rinde in EINEM Atlas, die Birke hat dafür zwei
# getrennte Dateien (birch_leaf.png / birch_bark.png). Fehlt der Eintrag,
# kommt beides wie bisher aus derselben Textur.
TEXTUR_RINDE = os.path.join(ROOT, PROFIL.get('textur_rinde', PROFIL['textur']))
ZIEL_PFAD = os.path.join(ROOT, ZIEL, f'{NAME}.glb')
ZWEIGE = PROFIL['zweige']
RINDE = PROFIL['rinde']


def leere_szene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def sapling_baum():
    """Ruft Sapling auf: gemeinsame Basis, dann die Abweichungen der Art.

    Die Basis ist an einer Gemeinen Fichte orientiert — durchgehender
    gerader Stamm, konische Krone, hängende Astspitzen. `shape 0` ist
    Saplings konische Grundform, `downAngle` über 90° lässt die Äste
    fallen statt abzustehen.

    Was die Tanne davon abweichen lässt, steht in ARTEN['tanne']['sapling'].
    """
    addon_utils.enable('add_curve_sapling', default_set=False)
    werte = dict(
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
        # Kürzere Äste (0.26 statt 0.35) halten die Krone kompakt. Lange
        # Äste mit gleich viel Laub ergeben eine lichte Krone, durch die
        # man hindurchsieht — im Vergleich gegen Pinetree_01 war genau das
        # der auffälligste Unterschied.
        length=(1.0, 0.26, 0.40, 0.35),
        # ── Unregelmäßigkeit ────────────────────────────────────────────
        # Der erste brauchbare Baum wirkte "sehr gleichmäßig". Grund: Die
        # Variationsparameter standen fast alle auf ihren Vorgaben, und die
        # sind bei Sapling 0 — jeder Ast bekam denselben Winkel, dieselbe
        # Länge, dieselbe Krümmung. Erst diese Streuungen machen aus einem
        # Bauplan einen gewachsenen Baum.
        lengthV=(0.0, 0.22, 0.25, 0.0),
        branches=(0, 52, 13, 0),
        curveRes=(5, 3, 2, 1),
        curve=(0, -18, -22, 0),
        curveV=(25, 55, 70, 0),
        downAngle=(90, 105, 78, 45),
        downAngleV=(0, 32, 26, 10),
        rotate=(99.5, 137.5, 137.5, 137.5),
        rotateV=(28, 14, 0, 0),
        # Äste hängen nach unten statt waagerecht abzustehen — bei einer
        # Fichte ist das der Unterschied zwischen Flaschenbürste und Baum.
        attractUp=(0, -0.35, -0.25, 0),
        # Astdichte nach oben verlagern: unten stehen wenige lange, oben
        # viele kurze Äste. Verstärkt die konische Form.
        branchDist=1.35,
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
        leaves=74,
        leafScale=0.62,
        leafScaleX=0.85,
        leafShape='rect',
        leafDist='6',
        bend=0.0,
        leafangle=-38,
        # Auch das Laub streuen. leafScaleV und leafRotateV stehen bei
        # Sapling auf 0 — ohne sie hängt an jedem Ast dieselbe Karte in
        # derselben Größe und Drehung, was aus der Ferne als Raster liest.
        leafScaleV=0.35,
        leafRotate=137.5,
        leafRotateV=55.0,
        leafDownAngle=52,
        leafDownAngleV=34,
    )
    werte.update(PROFIL.get('sapling', {}))
    if KARTENFAKTOR != 1.0:
        werte['leafScale'] = werte['leafScale'] * KARTENFAKTOR
    if STAMMFAKTOR != 1.0:
        werte['ratio'] = werte['ratio'] * STAMMFAKTOR
    if DICHTE != 1.0:
        b = werte['branches']
        werte['branches'] = (0, max(6, round(b[1] * DICHTE)), max(3, round(b[2] * DICHTE)), b[3])
        werte['leaves'] = max(10, round(werte['leaves'] * DICHTE))
    bpy.ops.curve.tree_add(**werte)


def zu_mesh(obj):
    """Kurve → Mesh, damit UVs und Export funktionieren."""
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if obj.type == 'CURVE':
        bpy.ops.object.convert(target='MESH')
    return bpy.context.view_layer.objects.active


def material(name, cutout, textur=None):
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
    tex.image = bpy.data.images.load(textur or TEXTUR_PFAD, check_existing=True)
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
            # Rinde: die vorhandenen UVs in das Feld hineinskalieren, statt
            # sie zu ersetzen — so kachelt die Struktur weiter über die
            # Stammlänge, bleibt aber innerhalb des Rindenausschnitts. Bei
            # der Tanne liegt der nur im oberen Fünftel des Atlas; ohne die
            # v-Begrenzung landete das halbe Nadelfeld auf dem Stamm.
            for li in ecken:
                alt = uv.data[li].uv
                uv.data[li].uv = (
                    u0 + (alt[0] % 1.0) * (u1 - u0),
                    v0 + (alt[1] % 1.0) * (v1 - v0),
                )


def laub_karten_variieren(laub_obj, holz_obj, rnd):
    """Verteilt die Zweigkarten über die Laubflächen — Stiel zum Ast.

    Alle Karten gleich zu belegen erzeugt ein sichtbares Wiederholmuster —
    im Original sind es drei verschiedene Zweige, und genau die stehen im
    Atlas bereit.

    ── Warum die Ansatzkante gesucht wird ───────────────────────────────
    Die Karten tragen kein einzelnes Blatt, sondern einen ganzen Zweig
    samt aufgemaltem Ästchen, das am unteren Bildrand herausläuft (v=0).
    Damit das Bild den echten Ast fortsetzt, muss die v=0-Kante am Holz
    sitzen.

    Die UVs nach der Eckreihenfolge zu vergeben — wie es hier zuerst
    stand — setzt voraus, dass Saplings Viereck immer an der Ansatzkante
    beginnt. Das tut es nicht: Die Reihenfolge hängt daran, wie die Karte
    gedreht wurde, und Sapling dreht kräftig (leafRotate 137,5° mit ±55°
    Streuung, leafDownAngle 52° mit ±34°). Gemessen an der Birke landete
    v=0 dadurch nur bei 72 % der Karten an der richtigen Kante; bei gut
    einem Viertel zeigte der gemalte Stiel nach außen ins Leere.

    Deshalb wird die Ansatzkante hier aus der Geometrie bestimmt: die
    Kante, deren beide Ecken dem Holz am nächsten liegen. Das ist die
    einzige Stelle, an der Bild und Geometrie voneinander wissen.
    """
    mesh = laub_obj.data
    # BVH über das Holz in Weltkoordinaten — das Laub hängt als Kind am
    # Stamm, seine lokalen Koordinaten sind also NICHT dieselben.
    bvh = BVHTree.FromPolygons(
        [tuple(holz_obj.matrix_world @ v.co) for v in holz_obj.data.vertices],
        [list(p.vertices) for p in holz_obj.data.polygons],
    )
    lm = laub_obj.matrix_world

    uv = mesh.uv_layers.active or mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        ecken = list(poly.loop_indices)
        if len(ecken) != 4:
            continue
        u0, u1, v0, v1 = ZWEIGE[rnd.randrange(len(ZWEIGE))]
        # Spiegeln halbiert die Wiederholung nochmal. Es kippt nur u, der
        # Stiel bleibt also unten — sonst wäre die Kantensuche umsonst.
        gespiegelt = rnd.random() < 0.5

        abstand = []
        for li in ecken:
            ort = lm @ mesh.vertices[mesh.loops[li].vertex_index].co
            _ort, _norm, _idx, d = bvh.find_nearest(ort)
            abstand.append(d if d is not None else float('inf'))
        # Die Ecken zyklisch so drehen, dass die Ansatzkante vorn steht.
        # Zyklisch, damit die Umlaufrichtung erhalten bleibt — sonst kippt
        # die Karte spiegelverkehrt.
        start = min(range(4), key=lambda k: abstand[k] + abstand[(k + 1) % 4])
        gedreht = ecken[start:] + ecken[:start]

        for k, li in enumerate(gedreht):
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
    baum.data.materials.append(material('rinde', cutout=False, textur=TEXTUR_RINDE))
    uv_auf_rechteck(baum.data, RINDE[0], RINDE[1], RINDE[2], RINDE[3], pro_flaeche=False)

    if laub is not None:
        laub.data.materials.clear()
        laub.data.materials.append(material('nadeln', cutout=True))
        laub_karten_variieren(laub, baum, rnd)

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
