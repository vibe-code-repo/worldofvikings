#!/usr/bin/env blender --background --python
"""
Erzeugt einen Busch als GLB — prozedurale Geometrie mit den selbst
gezeichneten Karten aus `tools/busch-texturen.py`.

    blender --background --python tools/busch-generieren.py -- \
        --art hasel --name Hasel1 --seed 3 --hoehe 2.4 --ziel assets/models

── Verhaeltnis zu tools/baum-generieren.py ──────────────────────────
Dieselbe Kette (Sapling -> Mesh -> UVs -> GLB), aber ein anderer
Habitus und ein anderes Budget. Kein gemeinsames Modul, weil die
Unterschiede genau dort sitzen, wo bei einer Zusammenlegung eine
Kaskade von Sonderfaellen entstuende: Der Baum hat EINEN Stamm mit
einem Atlasausschnitt je Zweigkarte, der Busch VIELE Triebe und je Art
eine eigene ganze Karte.

── Was einen Busch von einem Baum unterscheidet ─────────────────────
1. Kein Stamm. Ein Busch ist ein Buendel gleichrangiger Ruten aus dem
   Boden — siehe unten, das ist der Kern dieser Datei.
2. Kleines Budget. Buesche stehen in Massen im Unterholz; ein Baum darf
   4.500 Dreiecke kosten, ein Busch nicht mehr als etwa 1.600 — und
   davon soll der groessere Teil auf das Laub entfallen, nicht auf das
   Holz. Ein Busch IST im Wesentlichen Laub.
3. `leafScale` ist eine ABSOLUTE Laenge in Metern, nicht ein Anteil der
   Pflanzenhoehe. Die 0.62 der Fichte ergaeben auf einem 1,2-m-Busch
   eine Karte, die halb so gross ist wie er selbst. Je Art steht der
   Wert deshalb ausgeschrieben im Profil und ist gemessen.

── Warum mehrere Sapling-Laeufe statt `baseSplits` ──────────────────
Der naheliegende Weg ist Saplings eigene Stammgabelung. Gemessen an
einer 2-m-Hasel funktioniert die nicht, und der Grund ist strukturell:
Sapling teilt an SEGMENTGRENZEN. Bei `curveRes[0]` = 4 sitzt die erste
Grenze auf einem Viertel der Hoehe, also 50 cm ueber dem Boden.
Darunter steht ein einzelner Stiel, und weil die Aeste erst an den
geteilten Ruten ansetzen, bleibt der ganze untere Bereich unbelaubt.
Herausgekommen ist ein Baeumchen mit Laubball. `curveRes[0]`
hochzudrehen holt die Grenze naeher an den Boden, kostet aber Segmente
an JEDEM Trieb — an der teuersten Stelle des Budgets.

Deshalb je Trieb ein eigener Sapling-Lauf: ein schlanker verzweigter
Trieb, der ueber seine ganze Laenge Laub traegt. Die Triebe werden um
die Hochachse verteilt, nach aussen geneigt und am Fuss zusammengesetzt.
Das ergibt die Bauform eines Strauchs und nebenbei zwei Dinge, die ueber
`baseSplits` nicht zu haben waren: Die Breite laesst sich ueber die
Neigung direkt einstellen, und jeder Trieb bekommt eine eigene Laenge —
der Umriss wird unregelmaessig statt kugelig.
"""

import sys
import os
import math
import random

import bpy
import addon_utils
from mathutils import Vector, Euler
from mathutils.bvhtree import BVHTree

# ── Argumente hinter "--" ────────────────────────────────────────────
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


NAME = arg('--name', 'Hasel1')
SEED = int(arg('--seed', '1'))
HOEHE = float(arg('--hoehe', '2.0'))
ZIEL = arg('--ziel', 'assets/models')
MAX_DREIECKE = int(arg('--max-dreiecke', '1600'))
ART = arg('--art', 'hasel')
# Faktor auf Trieb-, Ast- und Blattzahl. Ein kniehoher Jungbusch bekaeme
# sonst dasselbe Budget wie ein ausgewachsener.
DICHTE = float(arg('--dichte', '1.0'))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── Arten ────────────────────────────────────────────────────────────
# Je Art der Aufbau des Triebbuendels und die Abweichungen von der
# gemeinsamen Triebbasis (siehe `sapling_trieb`).
#
# `neigung` in Grad von der Senkrechten ist die wichtigste Stellschraube
# des Habitus: Aus denselben Trieben wird damit ein aufrechter Strauch
# (klein) oder ein flaches Polster (gross). Sie kostet Hoehe, denn ein
# geneigter Trieb reicht nur cos(neigung) hoch — `trieblaenge()` rechnet
# das heraus, damit `--hoehe` weiter die Hoehe des BUSCHES meint.
ARTEN = {
    # Hasel: aufrechter Trichter aus langen Ruten. Der klassische
    # Waldrandstrauch und der hoechste hier, bis gut drei Meter.
    'hasel': {
        'triebe': (5, 7),
        'neigung': (10, 22),
        'fuss': 0.05,            # Streuung der Fusspunkte, Anteil der Hoehe
        'kuerzung': 0.25,        # bis hierher duerfen einzelne Triebe kuerzer sein
        'karte': 0.22,           # Kartenlaenge als Anteil der Buschhoehe
        'sapling': {
            'branches': (0, 7, 0, 0),
            'length': (1.0, 0.30, 0.3, 0.3),
            'downAngle': (90, 58, 45, 45),
            'attractUp': (0, 0.30, 0, 0),
            'curveV': (35, 70, 0, 0),
            # Freie Rutenbasis statt eines Stammes: Die Hasel ist ein
            # Stockausschlag-Vielstaemmer — sie bildet keinen Stamm, aber
            # bei drei Metern sieht man unten die nackten Ruten. Mit dem
            # Basiswert 0.06 reichte das Laub bis auf den Boden und der
            # Strauch las sich als Laubball.
            'baseSize': 0.18,
            'ratio': 0.013,
            'leaves': 10,
            'leafScaleX': 0.95,
        },
    },
    # Wacholder: niedrig und breit, dicht bis zum Boden. Der Habitus ist
    # das Gegenteil der Hasel — kaum Hoehe, viel Flaeche.
    'wacholder': {
        'triebe': (6, 8),
        'neigung': (38, 58),
        'fuss': 0.06,
        'kuerzung': 0.30,
        'karte': 0.26,
        'sapling': {
            'branches': (0, 8, 0, 0),
            'length': (1.0, 0.34, 0.3, 0.3),
            'downAngle': (90, 70, 45, 45),
            'attractUp': (0, -0.10, 0, 0),
            'curveV': (45, 80, 0, 0),
            'ratio': 0.016,
            'leaves': 14,         # dicht — der Umriss traegt hier alles
            'leafScaleX': 0.80,
            'leafDownAngle': 62,
        },
    },
    # Weide: Ufergestruepp aus langen, fast unverzweigten Ruten. Deshalb
    # viele Triebe, wenig Verzweigung, steile Stellung.
    'weide': {
        'triebe': (6, 9),
        'neigung': (6, 16),
        'fuss': 0.04,
        'kuerzung': 0.30,
        'karte': 0.19,
        'sapling': {
            'branches': (0, 8, 0, 0),     # Ruten bleiben schlank
            'length': (1.0, 0.22, 0.3, 0.3),
            'downAngle': (90, 48, 45, 45),
            # 0.45 zog alle Aeste an die Triebspitze und liess unten
            # einen freien Stamm stehen — das Ergebnis war ein Baeumchen.
            'attractUp': (0, 0.26, 0, 0),
            'curveV': (25, 55, 0, 0),
            'baseSize': 0.16,             # Ruten unten frei, wie bei der Hasel
            'ratio': 0.010,               # duenne Ruten
            'leaves': 9,
            'leafScaleX': 0.90,
            'leafDownAngle': 40,
        },
    },
    # Holunder: wenige kraeftige Triebe, oben schirmartig ausladend. Der
    # groesste Busch nach der Hasel und der einzige mit Fruechten.
    #
    # Die einzige Art mit STAMM. Ein Holunder waechst nicht als
    # Rutenbuendel aus dem Boden, sondern bildet einen kurzen kraeftigen
    # Stamm, aus dem sich erst in Kniehoehe die Triebe verzweigen. Die
    # Staerken sind bewusst gestaffelt — Stamm rund 9 cm Radius am
    # groessten Exemplar, Triebe knapp 4 cm: Ohne den Unterschied liest
    # sich der Stamm als vierter gleichrangiger Trieb statt als Stamm.
    'holunder': {
        'triebe': (4, 6),
        'neigung': (14, 28),
        'fuss': 0.05,
        'kuerzung': 0.20,
        'karte': 0.21,
        # Der Stamm muss HOEHER sein, als er wirken soll: Die Laubkarten
        # haengen ueber den Stammkopf herab (bei Holunder2 sind sie einen
        # halben Meter lang). Mit 0.22 der Hoehe war er komplett verdeckt
        # und nur an der Bodenluecke zu erahnen.
        'stamm': {'anteil': 0.36, 'radius': 0.040},   # beides Anteil der Hoehe
        'sapling': {
            'branches': (0, 7, 0, 0),
            'length': (1.0, 0.40, 0.3, 0.3),
            'downAngle': (90, 64, 45, 45),
            'attractUp': (0, 0.22, 0, 0),
            'curveV': (40, 85, 0, 0),
            # Die Triebe bleiben unten ein Stueck frei, damit das Laub
            # nicht direkt am Stammkopf ansetzt und ihn zuhaengt. Zusammen
            # mit der Stammhoehe beginnt die Krone dadurch erst auf gut
            # der halben Hoehe — das ist der Wuchs eines Holunders.
            'baseSize': 0.24,
            # Karten weniger weit herabklappen (Basis 50°): Bei einer
            # halbmeterlangen Fiederkarte entscheidet dieser Winkel
            # darueber, wie tief die Krone haengt.
            'leafDownAngle': 34,
            'ratio': 0.014,               # deutlich duenner als der Stamm
            'leaves': 8,                  # grosse Fiederkarten, wenige davon
            'leafScaleX': 1.0,
        },
    },
    # Brombeere: niedriges Dickicht aus ueberhaengenden Ranken. Der
    # einzige Busch mit NEGATIVEM `attractUp` — die Ranken wachsen heraus
    # und fallen zum Boden zurueck. Genau das macht das Undurchdringliche.
    'brombeere': {
        'triebe': (6, 8),
        # 76° liess die Ranken fast waagerecht liegen: Was herauskam,
        # war kein Dickicht, sondern verstreute Blattbueschel ueber
        # dem Boden.
        'neigung': (44, 64),
        'fuss': 0.06,
        'kuerzung': 0.35,
        'karte': 0.30,
        'sapling': {
            'branches': (0, 6, 0, 0),
            'length': (1.0, 0.42, 0.3, 0.3),
            'downAngle': (90, 84, 45, 45),
            'attractUp': (0, -0.45, 0, 0),
            'curve': (26, -30, 0, 0),     # Ranke biegt sich zurueck
            'curveV': (55, 90, 0, 0),
            'ratio': 0.010,
            'leaves': 9,
            'leafScaleX': 0.95,
            'leafDownAngle': 58,
            # Die Ranke lebt von ihrer Biegung, deshalb als einzige Art
            # zwei Segmente je Ast statt einem.
            'curveRes': (3, 2, 1, 1),
        },
    },

    # ── Zweite Staffel ───────────────────────────────────────────────
    # Heidekraut: Zwergstrauch der offenen Heide, kniehoch und dicht.
    # Viele kurze aufrechte Ruten, kaum verzweigt — was man sieht, sind
    # die Bluetenaehren.
    'heidekraut': {
        'triebe': (9, 13),
        'neigung': (16, 38),
        'fuss': 0.10,            # breiter Fuss: ein Polster, kein Buendel
        'kuerzung': 0.35,
        'karte': 0.34,
        'sapling': {
            'branches': (0, 5, 0, 0),
            'length': (1.0, 0.24, 0.3, 0.3),
            'downAngle': (90, 42, 45, 45),
            'attractUp': (0, 0.40, 0, 0),
            'curveV': (30, 55, 0, 0),
            'ratio': 0.020,      # bei 40 cm Hoehe sind das 8 mm Trieb
            'leaves': 8,
            'leafScaleX': 0.85,
            # 30° liess die schmalen Aehrenkarten radial abstehen — das
            # Polster wirkte borstig statt buschig.
            'leafDownAngle': 45,
        },
    },
    # Ginster: aufrechte Rutenbuesche, fast blattlos und im Sommer
    # leuchtend gelb. Der steilste Wuchs im ganzen Satz — Ginsterruten
    # stehen wie ein Besen.
    'ginster': {
        'triebe': (7, 10),
        'neigung': (5, 16),
        'fuss': 0.05,
        'kuerzung': 0.28,
        'karte': 0.24,
        'sapling': {
            'branches': (0, 6, 0, 0),
            'length': (1.0, 0.20, 0.3, 0.3),
            'downAngle': (90, 34, 45, 45),   # Aeste liegen an der Rute an
            'attractUp': (0, 0.55, 0, 0),
            'curveV': (18, 40, 0, 0),        # gerade, nicht knorrig
            'ratio': 0.009,
            'leaves': 9,
            'leafScaleX': 0.85,
            'leafDownAngle': 26,
        },
    },
    # Schlehe: sparriges Dorndickicht. Sie waechst aus Wurzelauslaeufern
    # und bildet deshalb KEINEN Stamm, sondern viele Triebe nebeneinander
    # — anders als der Holunder. Weit auseinanderstehende Aeste, viel
    # Durchblick: "sparrig" ist genau das Gegenteil von "dicht".
    'schlehe': {
        'triebe': (6, 9),
        # Sparrig ja, ausufernd nein: Mit (22,44) und 78° Astwinkel stand
        # Schlehe3 bei 6,0 m Breite auf 3,4 m Hoehe und haette im Wald den
        # Platz von zwei Baeumen gebraucht.
        'neigung': (14, 28),
        'fuss': 0.09,            # Auslaeufer: die Triebe stehen auseinander
        'kuerzung': 0.28,
        'karte': 0.20,
        'sapling': {
            'branches': (0, 8, 0, 0),
            'length': (1.0, 0.28, 0.3, 0.3),
            'downAngle': (90, 72, 45, 45),   # weit abstehend
            'downAngleV': (0, 40, 0, 0),
            'attractUp': (0, 0.05, 0, 0),
            'curveV': (50, 95, 0, 0),
            'baseSize': 0.14,
            'ratio': 0.012,
            'leaves': 9,
            'leafScaleX': 0.95,
        },
    },
    # Hartriegel: aufrechte Ruten, oben ausladend. Das Kennzeichen ist
    # die blutrote Rinde, und die sieht man nur, wenn die Ruten unten
    # frei bleiben — deshalb ein hohes `baseSize`.
    'hartriegel': {
        'triebe': (6, 9),
        'neigung': (11, 24),
        'fuss': 0.05,
        'kuerzung': 0.25,
        'karte': 0.22,
        'sapling': {
            'branches': (0, 7, 0, 0),
            'length': (1.0, 0.32, 0.3, 0.3),
            'downAngle': (90, 56, 45, 45),
            'attractUp': (0, 0.32, 0, 0),
            'curveV': (30, 65, 0, 0),
            'baseSize': 0.26,    # rote Ruten zeigen, nicht zudecken
            'ratio': 0.012,
            'leaves': 10,
            'leafScaleX': 0.95,
        },
    },
    # Heidelbeere: der Zwergstrauch des Nadelwaldbodens. Wie das
    # Heidekraut kniehoch, aber lockerer und mit groesseren Blaettern —
    # und sie deckt Flaeche, statt Polster zu bilden.
    'heidelbeere': {
        'triebe': (7, 10),
        'neigung': (20, 42),
        'fuss': 0.12,
        'kuerzung': 0.35,
        'karte': 0.32,
        'sapling': {
            'branches': (0, 6, 0, 0),
            'length': (1.0, 0.30, 0.3, 0.3),
            'downAngle': (90, 50, 45, 45),
            'attractUp': (0, 0.25, 0, 0),
            'curveV': (35, 60, 0, 0),
            'ratio': 0.016,
            'leaves': 8,
            'leafScaleX': 0.90,
            'leafDownAngle': 42,
        },
    },
}

if ART not in ARTEN:
    raise SystemExit(f'--art muss eine von {", ".join(ARTEN)} sein')
PROFIL = ARTEN[ART]
TEXTUR_LAUB = os.path.join(ROOT, f'assets/textures/{ART}_leaf.png')
TEXTUR_RINDE = os.path.join(ROOT, f'assets/textures/{ART}_bark.png')
ZIEL_PFAD = os.path.join(ROOT, ZIEL, f'{NAME}.glb')

for pfad in (TEXTUR_LAUB, TEXTUR_RINDE):
    if not os.path.exists(pfad):
        raise SystemExit(f'Textur fehlt: {pfad}\n'
                         f'  python3 tools/busch-texturen.py --art {ART}')


def leere_szene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def sapling_trieb(seed, laenge, dichte):
    """Ein EINZELNER Trieb: schlanke Rute mit Seitenaesten und Laub.

    Kein `baseSplits` — die Vielstaemmigkeit entsteht im Aufrufer durch
    mehrere solcher Triebe. Was hier zaehlt, ist, dass der Trieb ueber
    SEINE GANZE LAENGE Laub traegt: `baseSize` klein und `shape` '3'
    (zylindrisch, alle Aeste gleich lang). Mit Saplings konischer
    Grundform '0' saesse das Laub oben und der Busch haette wieder eine
    Krone.

    `curveRes` steht am unteren Anschlag. Ein Trieb ist duenn und wird
    vom Laub verdeckt; jedes zusaetzliche Segment kostet hier das
    Fuenffache dessen, was es bei einem Baum kostet, weil es sich ueber
    alle Triebe multipliziert.
    """
    werte = dict(
        do_update=True,
        chooseSet='0',
        bevel=True,
        prune=False,
        showLeaves=True,
        useArm=False,
        seed=seed,
        handleType='0',
        resU=1,
        bevelRes=0,
        levels=2,
        shape='3',            # zylindrisch: Laub ueber die ganze Laenge
        baseSize=0.06,        # Aeste fast vom Fuss an
        baseSplits=0,
        # Der teuerste Posten im ganzen Modell. Jedes Segment ist eine
        # Roehre aus vier Quads (acht Dreiecke), und es multipliziert
        # sich ueber Aeste MAL Triebe: Mit `curveRes` (4,2,…) und 11
        # Aesten kostete das Holz 1.472 Dreiecke, das Laub nur 710 — bei
        # einer Pflanze, die fast nur aus Laub besteht. Drei Segmente am
        # Trieb, zwei am Ast sind das Wenigste, mit dem eine Rute noch
        # gebogen aussieht.
        curveRes=(3, 1, 1, 1),
        segSplits=(0.12, 0, 0, 0),
        splitAngle=(20, 0, 0, 0),
        splitAngleV=(8, 0, 0, 0),
        length=(1.0, 0.30, 0.3, 0.3),
        lengthV=(0.0, 0.32, 0.0, 0.0),
        branches=(0, 7, 0, 0),
        curve=(16, 12, 0, 0),
        curveV=(40, 75, 0, 0),
        downAngle=(90, 58, 45, 45),
        downAngleV=(0, 34, 0, 0),
        rotate=(99.5, 137.5, 137.5, 137.5),
        rotateV=(28, 18, 0, 0),
        attractUp=(0, 0.25, 0, 0),
        branchDist=1.0,
        scale=laenge,
        scaleV=0.0,           # Streuung macht der Aufrufer, damit sie messbar bleibt
        ratio=0.013,
        ratioPower=1.2,
        # ── Laub ────────────────────────────────────────────────────
        # `leaves` ist die Zahl je Ast der letzten Ebene, NICHT je
        # Pflanze. Bei 11 Aesten und 6 Blaettern sind das 66 Karten am
        # Trieb und rund 350 am ganzen Busch — der erste Entwurf stand
        # mit `leaves` 40 bei 865 Karten und dem dreifachen Budget.
        leaves=9,
        leafScale=0.28,
        leafScaleX=0.95,
        leafShape='rect',
        leafDist='6',
        bend=0.0,
        leafangle=-26,
        # Ohne Streuung haengt an jedem Ast dieselbe Karte in derselben
        # Groesse und Drehung. Bei einem Busch faellt das staerker auf
        # als bei einem Baum, weil man ihm naeher kommt.
        leafScaleV=0.35,
        leafRotate=137.5,
        leafRotateV=60.0,
        leafDownAngle=50,
        leafDownAngleV=36,
    )
    werte.update(PROFIL.get('sapling', {}))
    # Die Kartengroesse haengt an der bestellten Hoehe, nicht an der
    # Trieblaenge: `karte` ist ihr Anteil daran. Absolut angegeben
    # muesste der Wert je Groessenstufe nachgezogen werden, und ein
    # 60-cm-Setzling bekaeme dieselbe 50-cm-Karte wie der ausgewachsene
    # Strauch. Der Bezug auf HOEHE und nicht auf `laenge` ist wichtig —
    # `laenge` aendert sich im Korrekturlauf (siehe `main`), die Karten
    # sollen aber gleich gross bleiben.
    werte['leafScale'] = PROFIL['karte'] * HOEHE
    if dichte != 1.0:
        # ── Warum die Dichte hier GEDAEMPFT eingeht ──────────────────
        # Sie greift an vier Stellen: Triebzahl (in `buendel`), Astzahl,
        # Blattzahl je Ast und Kartengroesse. Voll durchgeschlagen
        # multiplizieren die sich — bei `--dichte 0.55` blieben von 70
        # Karten je Trieb noch 24, also ein Drittel. Herausgekommen sind
        # kahle Ruten mit Blattbuescheln an den Enden; Wacholder1 sah
        # aus wie ein Spinnengeruest.
        #
        # Ein Jungbusch hat WENIGER TRIEBE als ein alter, aber seine
        # Triebe sind genauso dicht belaubt. Deshalb geht die Dichte nur
        # in die Astzahl nennenswert ein; Blattzahl und Kartengroesse
        # folgen ihr nur gedaempft.
        b = werte['branches']
        werte['branches'] = (0, max(4, round(b[1] * (0.7 + 0.3 * dichte))),
                             b[2], b[3])
        # Ein kleiner Busch traegt trotzdem etwas kleinere Karten — sonst
        # haengt an einer 60-cm-Jungpflanze dieselbe Karte wie am
        # ausgewachsenen Strauch.
        werte['leafScale'] *= 0.8 + 0.2 * dichte
    bpy.ops.curve.tree_add(**werte)
    return bpy.data.objects['tree'], bpy.data.objects.get('leaves')


def sapling_stamm(seed, laenge, radius):
    """Der kurze Stamm unter dem Triebbuendel — nackt, ohne Laub.

    Bewusst wieder ein Sapling-Lauf und kein Zylinder: So durchlaeuft er
    dieselbe Material- und UV-Kette wie das uebrige Holz, bekommt
    Saplings Verjuengung nach oben und eine leichte Kruemmung. Ein
    gerader Zylinder liest sich als Rohr.

    `ratio` ist bei Sapling der Radius im Verhaeltnis zur Laenge —
    deshalb wird hier zurueckgerechnet, damit im Profil eine echte
    Staerke in Metern stehen kann und nicht eine Zahl, die sich mit
    jeder Groessenstufe verschiebt.
    """
    bpy.ops.curve.tree_add(
        do_update=True, chooseSet='0', bevel=True, prune=False,
        showLeaves=False, useArm=False, seed=seed, handleType='0',
        resU=1, bevelRes=0, levels=1,
        shape='4',
        baseSize=1.0,             # keine Aeste — das Buendel sitzt obenauf
        baseSplits=0,
        branches=(0, 0, 0, 0),
        curveRes=(3, 1, 1, 1),
        segSplits=(0, 0, 0, 0),
        curve=(0, 0, 0, 0),
        curveV=(28, 0, 0, 0),     # leicht krumm, wie gewachsen
        scale=laenge, scaleV=0.0,
        ratio=max(1e-4, radius / max(1e-4, laenge)),
        ratioPower=1.1,
    )
    return bpy.data.objects['tree']


def trieblaenge(hoehe, neigung_grad):
    """Wie lang ein Trieb sein muss, damit der Busch `hoehe` hoch wird.

    Ein um 50° geneigter Trieb reicht nur auf 64 % seiner Laenge hinauf.
    Ohne diese Umrechnung waere ein Wacholder ein Drittel niedriger als
    bestellt, und `--hoehe` haette je Art eine andere Bedeutung.
    """
    return hoehe / max(0.25, math.cos(math.radians(neigung_grad)))


def buendel(rnd, zielhoehe):
    """Baut das Triebbuendel und liefert (Holzobjekte, Laubobjekte).

    Die Triebe stehen im goldenen Winkel um die Hochachse — gleichmaessig
    verteilte Richtungen ohne das Raster, das feste Schritte erzeugen.
    Geneigt wird um die X-Achse und danach um Z gedreht; Blender wendet
    bei Euler 'XYZ' erst X an, die Neigung zeigt also radial nach aussen.

    Verschoben wird NUR das Holz. `leaves` haengt als Kind daran und
    folgt; wuerde man beide setzen, zaehlte der Versatz beim Laub doppelt
    und es staende neben dem Busch.

    `zielhoehe` ist die Groesse, mit der die TRIEBE gerechnet werden —
    beim zweiten Lauf ist das nicht mehr die bestellte Hoehe, siehe
    `main`. Die Kartengroesse haengt bewusst nicht daran, sondern an
    HOEHE: Die Karten sollen im zweiten Lauf genauso gross sein wie im
    ersten, sonst wuerde die Korrektur sie mitschrumpfen.
    """
    anzahl_min, anzahl_max = PROFIL['triebe']
    # Die Dichte greift VOR ALLEM hier. Ein Jungbusch hat weniger Ruten
    # als ein alter, aber jede einzelne ist genauso dicht belaubt —
    # deshalb voll durchgeschlagen bei der Triebzahl und nur gedaempft
    # bei Ast- und Blattzahl (siehe `sapling_trieb`). Andersherum
    # herum probiert ergab es beide Male etwas Falsches: voll auf allen
    # Ebenen kahle Ruten, gedaempft auf allen Ebenen einen 0,7-m-Busch,
    # der so viele Dreiecke kostete wie der 1,8-m-Busch derselben Art.
    anzahl = max(3, round(rnd.randint(anzahl_min, anzahl_max) * DICHTE))
    neig_min, neig_max = PROFIL['neigung']
    kuerzung = PROFIL['kuerzung']

    holz, laub = [], []

    # ── Der Stamm, sofern die Art einen hat ─────────────────────────
    # Nicht jeder Strauch waechst als reines Rutenbuendel aus dem Boden.
    # Ein Holunder bildet einen kurzen kraeftigen Stamm, aus dem sich
    # erst in Kniehoehe die Triebe verzweigen — ohne ihn sieht er aus
    # wie ein Haufen gleich dicker Gerten.
    #
    # Der Stamm ist selbst ein Sapling-Lauf, nur ohne Aeste und ohne
    # Laub: Damit laeuft er durch dieselbe Material- und UV-Kette wie
    # alles andere Holz, statt als Sonderfall daneben zu stehen. Er
    # kostet drei Segmente, also 24 Dreiecke.
    stamm = PROFIL.get('stamm')
    stammhoehe = stamm['anteil'] * zielhoehe if stamm else 0.0
    if stamm:
        s = sapling_stamm(SEED * 977, stammhoehe, stamm['radius'] * zielhoehe)
        s.name = 'stamm'
        holz.append(s)

    for i in range(anzahl):
        neigung = neig_min + (neig_max - neig_min) * rnd.random()
        # Die Laenge streut nach UNTEN: Der laengste Trieb bestimmt die
        # Hoehe, und die soll die bestellte bleiben. Was der Stamm schon
        # an Hoehe beitraegt, muss der Trieb nicht mehr aufbringen.
        laenge = (trieblaenge(zielhoehe - stammhoehe, neigung)
                  * (1.0 - kuerzung * rnd.random()))
        t, l = sapling_trieb(SEED * 131 + i * 17, laenge, DICHTE)

        drehung = i * 2.399963 + rnd.random() * 0.5     # goldener Winkel
        t.rotation_euler = Euler((math.radians(neigung), 0.0, drehung), 'XYZ')
        # Mit Stamm entspringen die Triebe seinem KOPF, nicht dem Boden,
        # und sie ruecken dabei enger zusammen: Sie kommen aus einer
        # Astgabel von ein paar Zentimetern Durchmesser, nicht aus einer
        # Wurzelscheibe. Ohne die Verengung stuenden sie neben dem Stamm
        # statt auf ihm.
        streuung = PROFIL['fuss'] * (0.35 if stamm else 1.0)
        r = streuung * zielhoehe * math.sqrt(rnd.random())
        t.location = Vector((math.cos(drehung) * r, math.sin(drehung) * r,
                             stammhoehe))

        # Umbenennen, sonst greift der naechste Lauf ueber den Namen
        # 'tree' auf dieses Objekt zu.
        t.name = f'trieb_{i}'
        if l is not None:
            l.name = f'trieblaub_{i}'
            laub.append(l)
        holz.append(t)
    return holz, laub


def entkoppeln(kinder):
    """Loest die Laubkarten von ihren Trieben, unter Erhalt der Weltlage.

    Muss VOR jedem `join` geschehen, und das ist kein Stilfrage: `join`
    loescht die verbundenen Objekte. Haengt das Laub in dem Moment noch
    an einem dieser Triebe, verliert es sein Elternobjekt und mit ihm
    dessen Neigung und Versatz — die Karten springen an eine andere
    Stelle. Beim ersten Lauf kam so ein als 2,6 m bestellter Holunder
    mit 4,2 m gemessener Hoehe heraus.
    """
    for o in kinder:
        if o.parent is None:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')


def zusammenfuehren(objekte, name):
    """Kurven zu Meshes, dann alles zu EINEM Objekt."""
    if not objekte:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objekte:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        if o.type == 'CURVE':
            bpy.ops.object.convert(target='MESH')
        o.select_set(False)

    bpy.ops.object.select_all(action='DESELECT')
    for o in objekte:
        o.select_set(True)
    ziel = objekte[0]
    bpy.context.view_layer.objects.active = ziel
    if len(objekte) > 1:
        bpy.ops.object.join()
    # Transformationen einbacken: Die UV-Suche gleich danach rechnet mit
    # Weltkoordinaten, und der Export soll keine Objektmatrix mitschleppen.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ziel.name = name
    return ziel


def material(name, cutout, textur):
    """Principled-Material auf die Karte.

    Fuer das Laub liegt der Alphakanal am Alpha-Eingang und der
    Blendmodus auf CLIP; der glTF-Exporter macht daraus `alphaMode:
    MASK` mit Cutoff — genau das, was der AssetManager an Cutout-Laub
    erwartet, ohne dass er raten muss.
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
    tex.image = bpy.data.images.load(textur, check_existing=True)
    tex.interpolation = 'Linear'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])

    if cutout:
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        mat.blend_method = 'CLIP'
        mat.alpha_threshold = 0.5
        mat.shadow_method = 'CLIP'
        mat.use_backface_culling = False
    return mat


def uv_rinde(mesh):
    """Rinde ueber die Trieblaenge kacheln lassen.

    Die vorhandenen UVs bleiben erhalten und werden nur in den
    Einheitsbereich geholt — die Buschtexturen sind ganze Bilder, es gibt
    keinen Atlasausschnitt zu treffen. Wichtig ist allein, dass die
    Struktur ueber die Laenge WEITERLAEUFT statt sich zu stauchen;
    deshalb kacheln die Rindenkarten exakt.
    """
    uv = mesh.uv_layers.active or mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            alt = uv.data[li].uv
            uv.data[li].uv = (alt[0] % 1.0, alt[1] % 1.0)


def laub_karten_variieren(laub_obj, holz_obj, rnd):
    """Legt jede Laubflaeche auf die ganze Karte — Stiel zum Holz.

    Die Karte traegt kein einzelnes Blatt, sondern einen ganzen
    belaubten Zweig, dessen Stiel am unteren Bildrand herauslaeuft (v=0).
    Damit das Bild den echten Trieb fortsetzt, muss die v=0-Kante am Holz
    sitzen.

    Die UVs nach der Eckreihenfolge zu vergeben, setzt voraus, dass
    Saplings Viereck immer an der Ansatzkante beginnt. Das tut es nicht:
    Die Reihenfolge haengt daran, wie die Karte gedreht wurde, und
    Sapling dreht kraeftig (leafRotate 137,5° mit ±60° Streuung). An den
    Birken landete v=0 dadurch nur bei 72 % der Karten richtig; bei
    einem Viertel zeigte der gemalte Stiel nach aussen ins Leere.

    Deshalb wird die Ansatzkante aus der Geometrie bestimmt: die Kante,
    deren beide Ecken dem Holz am naechsten liegen. Das ist die einzige
    Stelle, an der Bild und Geometrie voneinander wissen.

    Anders als bei den Nadelbaeumen gibt es nur EIN Atlasfeld, weil die
    Karte das ganze Bild ist. Die Variation kommt deshalb allein aus dem
    Spiegeln — es halbiert die erkennbare Wiederholung, ohne den Stiel
    von der Ansatzkante zu nehmen (gespiegelt wird nur u).
    """
    mesh = laub_obj.data
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
        gespiegelt = rnd.random() < 0.5

        abstand = []
        for li in ecken:
            ort = lm @ mesh.vertices[mesh.loops[li].vertex_index].co
            _ort, _norm, _idx, d = bvh.find_nearest(ort)
            abstand.append(d if d is not None else float('inf'))
        # Zyklisch drehen, damit die Umlaufrichtung erhalten bleibt —
        # sonst kippt die Karte spiegelverkehrt.
        start = min(range(4), key=lambda k: abstand[k] + abstand[(k + 1) % 4])
        gedreht = ecken[start:] + ecken[:start]

        for k, li in enumerate(gedreht):
            su, sv = [(0, 0), (1, 0), (1, 1), (0, 1)][k]
            if gespiegelt:
                su = 1.0 - su
            uv.data[li].uv = (su, sv)


def dreiecke(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def masse(objekte):
    """Breite (groessere Grundflaechenachse) und Hoehe in Metern.

    Beides wird gebraucht, um in `shared/src/prefabs.ts` das
    `renderScale` einzutragen — und dort soll nichts geraten sein.
    """
    ecken = [o.matrix_world @ Vector(e) for o in objekte if o for e in o.bound_box]
    bx = max(p.x for p in ecken) - min(p.x for p in ecken)
    by = max(p.y for p in ecken) - min(p.y for p in ecken)
    bz = max(p.z for p in ecken) - min(p.z for p in ecken)
    return max(bx, by), bz


def einmal_bauen(zielhoehe):
    """Ein vollstaendiger Buendellauf; liefert (Holz, Laub, Triebzahl)."""
    leere_szene()
    addon_utils.enable('add_curve_sapling', default_set=False)
    rnd = random.Random(SEED)
    holz_teile, laub_teile = buendel(rnd, zielhoehe)
    entkoppeln(laub_teile)          # zwingend vor dem ersten join
    holz = zusammenfuehren(holz_teile, 'busch')
    laub = zusammenfuehren(laub_teile, 'buschlaub')
    return holz, laub, len(holz_teile), rnd


def hoehe_bei(trieblaenge):
    """Baut probeweise und misst die Gesamthoehe."""
    h, l, _n, _r = einmal_bauen(trieblaenge)
    return masse((h, l))[1]


def main():
    # ── Zwei Messlaeufe, dann der echte ──────────────────────────────
    # Saplings `scale` sagt, wie lang der TRIEB wird, nicht wie hoch die
    # Pflanze am Ende steht. Gemessen lagen die fuenf Arten zwischen
    # 27 % und 100 % ueber der Bestellung — eine als 0,9 m bestellte
    # Brombeere stand bei 1,8 m.
    #
    # Das fertige Modell nachtraeglich zu stauchen waere der kuerzere
    # Weg, hat aber zwei Haken: Es schrumpft die Laubkarten mit (der
    # Busch wird licht, weil die Karten nicht mehr zur Pflanze passen)
    # und staucht die Rinden-UVs.
    #
    # Warum ein Messlauf nicht genuegt: Die Hoehe ist NICHT proportional
    # zur Trieblaenge. Die Laubkarten behalten ihre Groesse, wenn die
    # Triebe schrumpfen, und tragen einen festen Sockel bei — beim
    # Wacholder gemessene 0,94 m, weil eine Karte oben wie unten ueber
    # die Astspitze hinausragt. Mit einer rein multiplikativen Korrektur
    # blieb er deshalb bei 1,6 m statt 1,2 m stehen.
    #
    # Zwei Messungen legen die Gerade `hoehe = a * trieblaenge + sockel`
    # fest; der dritte Lauf trifft. Kostet die dreifache Rechenzeit — bei
    # anderthalb Sekunden je Lauf der guenstigste Teil des Handels.
    z1 = HOEHE
    h1 = hoehe_bei(z1)
    z2 = max(0.15 * HOEHE, HOEHE * HOEHE / h1) if h1 > 1e-4 else HOEHE * 0.7
    h2 = hoehe_bei(z2)

    steigung = (h1 - h2) / (z1 - z2) if abs(z1 - z2) > 1e-6 else 1.0
    if steigung > 0.15:
        sockel = h1 - steigung * z1
        z3 = max(0.08 * HOEHE, (HOEHE - sockel) / steigung)
    else:
        # Fast waagerecht heisst: Die Hoehe haengt kaum an der
        # Trieblaenge, sie kommt fast ganz aus den Karten. Dann ist die
        # Kartengroesse (`karte` im Profil) zu gross fuer diese Hoehe —
        # gerechnet wird nicht weiter, aber der Hinweis muss sichtbar
        # sein, sonst sucht man den Fehler spaeter in der Geometrie.
        print(f'HINWEIS Hoehe haengt kaum an der Trieblaenge '
              f'(Steigung {steigung:.2f}) — "karte" fuer {HOEHE} m zu gross')
        z3 = z2

    holz, laub, triebzahl, rnd = einmal_bauen(z3)

    holz.data.materials.clear()
    holz.data.materials.append(material('rinde', cutout=False, textur=TEXTUR_RINDE))
    uv_rinde(holz.data)

    if laub is not None:
        laub.data.materials.clear()
        laub.data.materials.append(material('laub', cutout=True, textur=TEXTUR_LAUB))
        laub_karten_variieren(laub, holz, rnd)

    # Pivot auf den Fuss: Objekte sitzen an ihrer ZDO-Position auf.
    bpy.ops.object.select_all(action='DESELECT')
    for o in (holz, laub):
        if o:
            o.select_set(True)
    bpy.context.view_layer.objects.active = holz
    tiefster = min((o.matrix_world @ Vector(e)).z
                   for o in (holz, laub) if o
                   for e in o.bound_box)
    for o in (holz, laub):
        if o:
            o.location.z -= tiefster

    breite, hoehe = masse((holz, laub))
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
    gesamt = dreiecke(holz) + (dreiecke(laub) if laub else 0)
    grosse = os.path.getsize(ZIEL_PFAD) / 1e6
    karten = (dreiecke(laub) // 2) if laub else 0
    print(f'GEOMETRIE {triebzahl} Triebe, Holz {dreiecke(holz)}, '
          f'Laub {dreiecke(laub) if laub else 0} Dreiecke ({karten} Karten)')
    # Die beiden Masse gehoeren so in prefabs.ts — deshalb in einer Zeile
    # und in der Reihenfolge, in der `def(...)` sie erwartet.
    print(f'FERTIG {ZIEL_PFAD} — {gesamt} Dreiecke, {grosse:.2f} MB, '
          f'renderScale {breite:.1f} x {hoehe:.1f} m')
    if gesamt > MAX_DREIECKE:
        print(f'HINWEIS ueber Budget ({MAX_DREIECKE}) — branches/leaves senken')


main()
