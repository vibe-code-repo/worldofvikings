#!/usr/bin/env blender --background --python
"""
Riggt die fuenf Figuren des Furloc-Volkes (kroetenartiges Fischervolk,
Meshy-Modelle) und legt jeder drei Bewegungen an: "idle", "walk", "attack".

    blender --background --python tools/furloc-volk-rig.py -- \\
        --figur Krieger \\
        --glb assets/models/FurlocKrieger-roh.glb \\
        --out assets/models/FurlocKrieger.glb

`--figur` waehlt die MESSTABELLE. Die Quelle ist immer die "-roh"-Datei
und nie das eigene Ergebnis: Das Skript hebt die Figur auf ihre Sohle und
backt Aktionen; ein zweiter Lauf auf das Ergebnis wuerde beides erneut
tun. Gegen das versehentliche zweite Anheben steht unten ein Wachposten
(Erkennungsmerkmal ist der Name der Armature).

── Warum wieder ein handgebautes Rig ────────────────────────────────
Dieselbe Lektion wie bei tools/voelva-rig.py, tools/surtr-rig.py und
tools/furloc-rig.py, hier fuer jede der fuenf Figuren nachgemessen: Die
Meshes zerfallen in 1.660 bis 2.294 ZUSAMMENHANGSKOMPONENTEN auf 12.000
bis 14.000 Vertices — der Generator macht an jeder UV-Naht auf. Blenders
"Automatic Weights" (Bone Heat) braucht eine zusammenhaengende Flaeche und
raet sonst je Insel; genau dort klafft das Modell dann auf.

Der Weg ist deshalb derselbe wie dort: eigene Knochenkette, Gewichte als
STETIGE FUNKTION DER POSITION. Stetig in der Position heisst, dass die an
den Naehten verdoppelten Vertices exakt aufeinanderliegen und darum
identische Gewichte bekommen — die Inseln koennen prinzipbedingt nicht
auseinanderklaffen.

Vier Gelenke je Bein (Huefte, Knie, KNOECHEL, ZEHENBALLEN) und ein
Laufzyklus, der RUECKWAERTS AUS DER KINEMATIK gerechnet wird: Erst wird
die Bahn der Sohle vorgegeben (flach am Boden, mit Koerpertempo nach
hinten), dann loest eine Zweigelenk-IK Huefte und Knie dazu auf.
Fussrutschen ist damit nicht "klein", sondern konstruktionsbedingt null.
Die Herleitung steht ausfuehrlich in tools/furloc-rig.py; hier ist sie
nur noch fuenfmal parametrisiert.

── Wie die Gelenkhoehen gemessen wurden ─────────────────────────────
NICHT aus tools/furloc-rig.py uebernommen: Ein Kind ist kein Haeuptling,
und die fuenf Figuren unterscheiden sich in der Beinlaenge um mehr als
den Faktor zwei (bezogen auf ihre Koerperhoehe). Gemessen wurde an einer
FLAECHENTREUEN Abtastung (700.000 Punkte auf den Dreiecken, nicht die
Vertices — Beine und Fuesse sind grob aufgeloest, eine Vertexscheibe misst
dort Loecher statt Fleisch).

  KNOECHEL — das Minimum der Beinbreite ueber der Sohle, also die
      Gelenktaille (dasselbe Verfahren wie im Kommentarblock von
      tools/surtr-rig.py ueber der Knochenliste). Eine reine Scheibe
      taugt hier NICHT: Drei der fuenf tragen einen Umhang, dessen Saum
      bis auf den Boden reicht, und dann misst die Scheibe Stoff und Bein
      zusammen. Die Beinsaeule wurde deshalb je Scheibe als
      ZUSAMMENHAENGENDER FLECK bestimmt (Flutfuellung auf einem
      2D-Gitter) und von Scheibe zu Scheibe weiterverfolgt.

  ZEHENBALLEN — der Knick im Fussruecken: Bis dorthin ist der Fuss voll
      hoch, davor faellt er zu den Zehen ab. Gemessen unterhalb des
      Knoechels, sonst misst das Hoehenprofil den Unterschenkel mit.

  SCHULTER — die Hoehe der Armachse. Die Arme sind bei allen fuenf nackt
      und waagerecht ausgestreckt; in x-Scheiben jenseits der Rumpfkante
      ist die Achse der Schwerpunkt der Punkte.

  HUEFTE — NICHT MESSBAR. Bei allen fuenf verdeckt Rock, Schurz oder
      Umhang das Becken vollstaendig. Sie wird deshalb aus dem Verhaeltnis
      des bereits im Spiel laufenden FurlocFischer gesetzt
      (Huefte/Schulter = 0,285/0,785 = 0,363) und gegen eine gemessene
      Schranke geprueft: Bis zu der Hoehe, in der die beiden Beinsaeulen
      noch als getrennte Flecken verfolgbar sind, MUSS das Bein Bein sein.
      Das daraus abgeleitete Knie (im Fischer-Verhaeltnis 0,435 zwischen
      Knoechel und Huefte) liegt bei vier der fuenf Figuren unter dieser
      Schranke, beim Schamanen 6 mm darueber — das ist ein Viertel der
      Scheibendicke und damit im Messrauschen. Am Fischer selbst gerechnet
      trifft die Regel sein bestehendes Rig auf 8 mm genau.

── Blickrichtung: gemessen, nicht angenommen ────────────────────────
Die Engine dreht eine laufende Figur mit yaw = atan2(dx, dz)
(shared/worldlayout/routenlauf.ts); im importierten Blender-Raum ist das
-Y (abgelesen an Voelva.glb und Surtr.glb, s. tools/surtr-rig.py).

Alle fuenf schauen bereits nach -y. Belegt zweifach: In einer
orthografischen Ansicht aus -Y (Kamera bei -y, Eulerwinkel (90,0,0)) zeigt
jede ihr GESICHT; und numerisch reicht jeder Fussgrundriss deutlich weiter
nach -y als nach +y (die Zehen zeigen nach vorn). BLICK_DREHUNG bleibt
deshalb 0 — anders als bei Voelva und Surtr, die beide -90 Grad brauchten.
Der Zweig ist trotzdem ausformuliert und steht unter demselben
Wachposten wie das Anheben: Waere er versehentlich gesetzt und liefe das
Skript zweimal, staende das Skelett quer in der Figur.

── Der Ursprung wird ins Modell gebacken ────────────────────────────
Die gelieferten Dateien sind ZENTRIERT. Der Prefab-Ursprung IST im Spiel
die Gelaendehoehe — ohne Korrektur steckte jede Figur bis zur Brust im
Boden. Der Versatz gehoert deshalb ins Modell und nicht in eine
Client-Konstante, die beim naechsten Modellwechsel falsch waere. Alle
Knochenkoordinaten in der Tabelle unten sind darum RELATIV ZUR SOHLE
angegeben (z = 0 ist der Boden) — damit ist die Tabelle unabhaengig
davon, ob die Datei schon angehoben wurde.

Gemessen wird die FUSSSOHLE, nicht der tiefste Punkt der Datei: Bei vier
der fuenf steht die Requisite (Speer, Stab) auf dem Boden und ragt 8 bis
46 mm UNTER die Sohle; bei Haeuptling und Aeltestem haengt zusaetzlich der
Umhangsaum rund 10 mm tiefer als die Fuesse. Die Requisite wird deshalb in
jeder Pose am Schaft angehoben — sonst waere der tiefste Punkt der Figur
nicht die Sohle, sondern das Schaftende, und die Fuesse schwebten. Der
Saum dagegen darf im Gelaende verschwinden; er soll es sogar.
"""

import math
import os
import sys

import bpy
from mathutils import Vector, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


FIGUR = arg('--figur')
GLB = arg('--glb')
OUT = arg('--out')
STAERKE = float(arg('--staerke', '1.0'))
DAUER_IDLE = float(arg('--idle-dauer', '4.0'))
DAUER_ATTACK = float(arg('--attack-dauer', '1.4'))
TEMPO = float(arg('--tempo', '1.5'))        # m/s, ROUTE_DEFAULT_SPEED
FPS_BASIS = 60
MIN_BILDER = 14        # Mindestaufloesung eines Laufzyklus, s. unten
FPS = FPS_BASIS

# ── Die Messtabellen ────────────────────────────────────────────────
# Alle z RELATIV ZUR SOHLE, alle x/y in Dateikoordinaten (die sind schon
# um die Koerperachse zentriert). Herkunft jeder Zahl steht im Kopf.
#
#   hoehe        Koerperhoehe ohne die Requisite (Kontrollwert; weicht die
#                gemessene um mehr als 1 % ab, stammt die GLB aus einer
#                anderen Quelle und das Skript warnt)
#   scale        PrefabDef.localScale, so gewaehlt, dass `hoehe * scale`
#                die gewuenschte Koerpergroesse in Metern ergibt
#   requisite_x  x-Schwelle: links davon Speer/Stab/Schwert, nicht Koerper
#   knoechel_z   gemessene Beintaille
#   knoechel     (x, y) der Beinsaeule auf Knoechelhoehe, je Seite
#   hueft_xy     (x, y) der Beinsaeule, auf Hueftehoehe fortgeschrieben
#   verschmelzung  Hoehe, ab der die beiden Beinsaeulen nicht mehr
#                getrennt verfolgbar sind — die Schranke fuers Knie
#   fuss         (x0, x1, zehe_y, ballen_y, ferse_y) je Seite
#   schulter_z   Hoehe der Armachse
#   rumpf_x      halbe Rumpfbreite auf Schulterhoehe (dort sitzt die
#                Schulter)
#   schulter_y   y der Armachse an der Rumpfkante
#   faust        (x, y, z) je Seite
#   kehle        (z, y_vorn) der Schnauzenunterseite — dort sitzt der
#                Kehlsack, der im Leerlauf pulsiert
#   schaft       (Mitte, Achse, t0, t1) der Requisite (Hauptachse ihrer
#                Punktwolke), Mitte in Dateikoordinaten mit z ueber Sohle
#   schaft_r     (r_unten, r_oben) Radius der Requisite laengs der Achse
#   schild       optional (Mitte, Radius) eines zweiten Anbauteils am
#                +x-Arm
#   arm_senken   Grad, um die der FREIE +x-Arm aus der T-Pose gesenkt wird
#                (Meshy liefert alle fuenf mit waagerecht ausgestreckten
#                Armen; das ist eine Bindepose, keine Haltung)
#   angriff      'stich' (Speer) oder 'schlag' (Stab, Schwert)
FIGUREN = {
    # Krieger: Speer in der -x-Hand, Schildkroetenpanzer-Schild am +x-Arm.
    # Der Speer steht auf dem Boden und ragt 8 mm unter die Sohle.
    'Krieger': dict(
        hoehe=1.2815, scale=1.40, requisite_x=-0.70,
        knoechel_z=0.0904,
        knoechel={'l': (+0.2282, -0.0973), 'r': (-0.2276, -0.0996)},
        hueft_xy={'l': (+0.1800, -0.0960), 'r': (-0.1800, -0.0960)},
        verschmelzung=0.1804,
        fuss={'l': (+0.1656, +0.3706, -0.2915, -0.1720, -0.0100),
              'r': (-0.3725, -0.1739, -0.2927, -0.1730, -0.0110)},
        schulter_z=0.7222, rumpf_x=0.440, schulter_y=+0.030,
        faust={'r': (-0.6600, -0.0450, 0.7052), 'l': (+0.5700, +0.0050, 0.7072)},
        kehle=(0.9268, -0.4056),
        schaft=((-0.7995, -0.0991, 0.7871), (-0.1155, -0.0325, +0.9928), -0.7986, +0.5533),
        schaft_r=(0.050, 0.115),
        schild=((+0.7900, -0.1250, 0.5302), 0.230),
        arm_senken=28.0,          # weniger, sonst schleift der Schild am Bein
        angriff='stich'),

    # Haeuptling: Hoernerhelm, Fellumhang, knorriger Stab in der -x-Hand,
    # der +x-Arm weit ausgestreckt. Der Stab ragt 46 mm unter die Sohle —
    # der groesste Ausreisser der fuenf; sein Umhangsaum weitere 10 mm.
    'Haeuptling': dict(
        hoehe=1.1912, scale=1.47, requisite_x=-0.60,
        knoechel_z=0.0791,
        knoechel={'l': (+0.2587, -0.0676), 'r': (-0.1798, -0.0663)},
        hueft_xy={'l': (+0.2520, -0.1060), 'r': (-0.1710, -0.1060)},
        verschmelzung=0.1751,
        fuss={'l': (+0.1986, +0.3908, -0.2692, -0.1130, +0.0120),
              'r': (-0.3230, -0.1242, -0.2722, -0.1160, +0.0160)},
        schulter_z=0.6442, rumpf_x=0.440, schulter_y=-0.005,
        faust={'r': (-0.5900, -0.0370, 0.6432), 'l': (+0.9000, -0.0380, 0.6772)},
        kehle=(0.8288, -0.3541),
        schaft=((-0.7408, -0.1045, 0.7070), (-0.1593, -0.0799, +0.9840), -0.7600, +0.5062),
        schaft_r=(0.055, 0.120),
        schild=None,
        arm_senken=52.0,
        angriff='schlag'),

    # Kind: Kroetenkind unter einem viel zu grossen Hoernerhelm, Holz-
    # schwert in der -x-Hand. Seine Koerperhoehe wird vom Helm bestimmt,
    # nicht vom Rumpf — deshalb sitzt seine Schulter bei 39 % der Hoehe,
    # waehrend sie bei den vier Erwachsenen bei 51 bis 57 % sitzt. Genau
    # dafuer haengt die Huefte hier an der SCHULTER und nicht an der
    # Koerperhoehe.
    'Kind': dict(
        hoehe=1.7734, scale=0.59, requisite_x=-0.58,
        knoechel_z=0.0958,
        knoechel={'l': (+0.3115, -0.1342), 'r': (-0.2287, -0.1344)},
        hueft_xy={'l': (+0.2372, -0.1420), 'r': (-0.1769, -0.1440)},
        verschmelzung=0.1667,
        fuss={'l': (+0.2299, +0.5357, -0.3697, -0.2260, -0.0040),
              'r': (-0.4537, -0.1470, -0.3702, -0.2260, -0.0040)},
        schulter_z=0.6990, rumpf_x=0.450, schulter_y=+0.010,
        faust={'r': (-0.6000, -0.0900, 0.6990), 'l': (+0.9000, -0.0900, 0.6990)},
        kehle=(0.9753, -0.5177),
        schaft=((-0.7775, -0.1262, 0.9166), (-0.2570, -0.0785, +0.9632), -0.3459, +0.5099),
        schaft_r=(0.070, 0.140),
        schild=None,
        arm_senken=48.0,
        angriff='schlag'),

    # Aeltester: bodenlanger Umhang, Tierschaedelstab. Sein Umhang macht
    # die Beinsaeule dicker als bei den anderen, deshalb sitzt seine
    # gemessene Taille mit 0,118 am hoechsten. Der Stab ragt 45 mm unter
    # die Sohle, sein Umhangsaum 10 mm.
    'Aeltester': dict(
        hoehe=1.3436, scale=1.19, requisite_x=-0.69,
        knoechel_z=0.1175,
        knoechel={'l': (+0.2576, -0.0018), 'r': (-0.2753, -0.0038)},
        hueft_xy={'l': (+0.2233, -0.0420), 'r': (-0.2634, -0.0520)},
        verschmelzung=0.1987,
        fuss={'l': (+0.1809, +0.3974, -0.2530, -0.1000, +0.1550),
              'r': (-0.4159, -0.2043, -0.2526, -0.1000, +0.1550)},
        schulter_z=0.6803, rumpf_x=0.600, schulter_y=+0.060,
        faust={'r': (-0.6600, -0.0260, 0.6983), 'l': (+0.9100, +0.0440, 0.6953)},
        kehle=(0.9361, -0.4202),
        schaft=((-0.7924, -0.1244, 0.8626), (-0.0590, -0.1358, +0.9890), -0.9148, +0.5146),
        schaft_r=(0.075, 0.200),
        schild=None,
        arm_senken=50.0,
        angriff='schlag'),

    # Schamane: Blattkapuze, Stab mit leuchtendem Stein. Der Stab ragt
    # 19 mm unter die Sohle.
    'Schamane': dict(
        hoehe=1.2133, scale=1.34, requisite_x=-0.56,
        knoechel_z=0.0777,
        knoechel={'l': (+0.2871, -0.0383), 'r': (-0.1617, -0.0348)},
        hueft_xy={'l': (+0.2836, -0.0700), 'r': (-0.1530, -0.0690)},
        verschmelzung=0.1383,
        fuss={'l': (+0.2096, +0.4162, -0.2483, -0.1040, +0.0800),
              'r': (-0.3098, -0.0961, -0.2483, -0.1040, +0.0800)},
        schulter_z=0.6350, rumpf_x=0.450, schulter_y=-0.028,
        faust={'r': (-0.5500, -0.0290, 0.6390), 'l': (+0.9000, -0.0300, 0.6460)},
        kehle=(0.7882, -0.4458),
        schaft=((-0.7351, -0.1017, 0.8484), (-0.0810, -0.0717, +0.9941), -0.8693, +0.5067),
        schaft_r=(0.065, 0.160),
        schild=None,
        arm_senken=52.0,
        angriff='schlag'),
}

if not FIGUR or FIGUR not in FIGUREN:
    raise SystemExit(f'--figur fehlt oder unbekannt; erlaubt: {", ".join(FIGUREN)}')
if not GLB:
    raise SystemExit('--glb fehlt')
M = FIGUREN[FIGUR]
SKALA = float(arg('--scale', str(M['scale'])))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PFAD = GLB if os.path.isabs(GLB) else os.path.join(ROOT, GLB)
ZIEL = PFAD if not OUT else (OUT if os.path.isabs(OUT) else os.path.join(ROOT, OUT))
RIGNAME = 'furlocvolk_rig'


def glatt(u):
    """smoothstep 0..1"""
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


def abstand_segment(p, a, b):
    ab = b - a
    l2 = ab.length_squared
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, (p - a).dot(ab) / l2))
    return (p - (a + ab * t)).length


def misch(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(len(a)))


# ── Modell laden ────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=PFAD)

meshes = [o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.vertices)]
if not meshes:
    raise SystemExit('keine Mesh-Geometrie gefunden')
mesh = max(meshes, key=lambda o: len(o.data.vertices))

# Frueheres Rig restlos entfernen — sonst haengen zwei Skelette und alte
# Actions im Export. Die WELTLAGE des Meshes muss dabei erhalten bleiben.
# Zugleich der Wachposten gegen den zweiten Lauf: Traegt die Datei schon
# eine Armature dieses Skripts, wurde sie bereits angehoben (und, falls
# BLICK_DREHUNG je gesetzt wird, auch schon gedreht).
schon_bearbeitet = any(o.type == 'ARMATURE' and o.name.startswith(RIGNAME)
                       for o in bpy.data.objects)
mw = mesh.matrix_world.copy()
for o in list(bpy.data.objects):
    if o.type == 'ARMATURE':
        bpy.data.objects.remove(o, do_unlink=True)
for m in list(mesh.modifiers):
    if m.type == 'ARMATURE':
        mesh.modifiers.remove(m)
mesh.parent = None
mesh.matrix_world = mw
mesh.vertex_groups.clear()
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

welt = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
zmin = min(v.z for v in welt)
zmax = max(v.z for v in welt)

# ── Auf die Sohle stellen ───────────────────────────────────────────
# Auf die FUSSSOHLE, gemessen in den beiden Fussgrundrissen aus der
# Tabelle. Der tiefste Punkt der Datei taugt dafuer nicht, und der tiefste
# Punkt "des Koerpers ohne Requisite" auch nicht — beides wurde probiert
# und beides war falsch:
#
#   * Der tiefste Punkt der Datei ist bei vier von fuenf das Ende von
#     Speer oder Stab. Das gehoert nicht auf den Boden gestellt, sondern
#     in die Hand.
#   * Grenzt man die Requisite nur ueber ihre x-Lage ab, bleibt beim
#     Krieger der schraeg stehende Speerschaft im Fenster und beim
#     Haeuptling und Aeltesten der UMHANGSAUM, der einen Zentimeter tiefer
#     haengt als die Fuesse. Beides hob die Figur um genau diesen Betrag
#     an: an der evaluierten Haut nachgemessen schwebte der Krieger 5 mm
#     ueber dem Gelaende, ohne dass an Rig oder Gang etwas falsch war.
#
# Ein Saum darf ein wenig im Boden verschwinden, ein Fuss darf nicht
# schweben. Deshalb entscheidet die Sohle und nichts sonst.
_fenster = [(f[0], f[1], min(f[2], f[4]), max(f[2], f[4])) for f in M['fuss'].values()]
sohlen = [v.z for v in welt
          for (x0, x1, y0, y1) in _fenster
          if x0 - 0.01 <= v.x <= x1 + 0.01 and y0 - 0.01 <= v.y <= y1 + 0.01]
if not sohlen:
    raise SystemExit('kein Vertex in den Fussgrundrissen der Tabelle gefunden')
SOHLE = min(sohlen)
koerper = [v for v in welt if v.x > M['requisite_x']]
HOEHE = max(v.z for v in koerper) - SOHLE
ZOFF = -SOHLE
# Wie weit steht die Requisite unter der Sohle? Nur ihre eigenen Vertices
# zaehlen — ein Umhangsaum ist kein Schaft und wird nicht angehoben.
_req = [v.z for v in welt if v.x <= M['requisite_x']]
SCHAFT_UNTER_SOHLE = max(0.0, SOHLE - min(_req)) if _req else 0.0
SAUM_UNTER_SOHLE = max(0.0, SOHLE - min(v.z for v in koerper))
H = M['hoehe']
if abs(HOEHE - H) > 0.01 * H:
    print(f'WARNUNG: gemessene Koerperhoehe {HOEHE:.4f} weicht von der Tabelle '
          f'({H:.4f}) ab — stammt die GLB noch aus derselben Quelle?')
print(f'MODELL {FIGUR}: {len(welt)} Vertices, '
      f'{sum(len(p.vertices) - 2 for p in mesh.data.polygons)} Dreiecke, '
      f'Koerperhoehe {HOEHE:.4f} (Tabelle {H:.4f}), Gesamthoehe {zmax - zmin:.4f}')
print(f'SOHLE: Fuesse z={SOHLE:+.4f}, tiefster Punkt der Datei z={zmin:+.4f} '
      f'-> Hoehenversatz {ZOFF:+.4f}; Requisite steht {SCHAFT_UNTER_SOHLE:.4f} '
      f'({SCHAFT_UNTER_SOHLE * SKALA * 100:.1f} cm im Spiel) unter der Sohle, '
      f'Saum/Rest {SAUM_UNTER_SOHLE:.4f} ({SAUM_UNTER_SOHLE * SKALA * 100:.1f} cm)')
if schon_bearbeitet:
    print(f'HINWEIS: Datei traegt schon ein {RIGNAME} — sie wurde bereits '
          f'bearbeitet; die Knochentabelle ist sohlenrelativ, das ist '
          f'ungefaehrlich, aber die Quelle sollte die "-roh"-Datei sein.')

mesh.location.z += ZOFF
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
mesh.select_set(False)
welt = [mesh.matrix_world @ v.co for v in mesh.data.vertices]

# ── Aus den Messwerten das Skelett ableiten ─────────────────────────
# Huefte und Knie sind nicht messbar (Rock, Schurz und Umhang verdecken
# das Becken vollstaendig). Sie folgen aus den beiden Verhaeltnissen, die
# am bereits laufenden FurlocFischer abgelesen wurden:
#   Huefte / Schulter = 0,285 / 0,785 = 0,363
#   Knie zwischen Knoechel und Huefte bei 0,435
# Beide werden gegen die GEMESSENE Schranke geprueft: Bis zu der Hoehe, in
# der die beiden Beinsaeulen noch getrennt verfolgbar sind, ist das Bein
# nachweislich Bein — das Knie darf nicht darueber liegen.
HUEFT_ANTEIL = 0.363
KNIE_ANTEIL = 0.435
SCHULTER_Z = M['schulter_z']
HUEFT_Z = HUEFT_ANTEIL * SCHULTER_Z
KNOECHEL_Z = M['knoechel_z']
KNIE_Z = KNOECHEL_Z + KNIE_ANTEIL * (HUEFT_Z - KNOECHEL_Z)
BEIN_LAENGE = HUEFT_Z - KNOECHEL_Z
print(f'BEIN: Knoechel {KNOECHEL_Z:.4f} (gemessene Taille), Knie {KNIE_Z:.4f}, '
      f'Huefte {HUEFT_Z:.4f} ueber der Sohle; Beinlaenge {BEIN_LAENGE:.4f} '
      f'({BEIN_LAENGE * SKALA * 100:.1f} cm im Spiel)')
if KNIE_Z > M['verschmelzung'] + 0.010 * H:
    print(f'WARNUNG: abgeleitetes Knie {KNIE_Z:.4f} liegt ueber der gemessenen '
          f'Schranke {M["verschmelzung"]:.4f} — dort ist das Bein nicht mehr '
          f'als eigene Saeule nachweisbar')
else:
    print(f'BEIN: Knie liegt unter der gemessenen Schranke '
          f'{M["verschmelzung"]:.4f} (dort verschmelzen die Beinsaeulen) — '
          f'widerspruchsfrei')

BALLEN_Z = 0.006 * H         # dicht ueber der Sohle: Beim Abstoss knicken
ZEHE_Z = 0.004 * H           # Fuss und Zeh dort um 19 Grad gegeneinander,
#                              und die lineare Hautmischung zieht die Stelle
#                              umso tiefer nach innen, je weiter das Gelenk
#                              vom Boden weg liegt (Lehre aus surtr-rig.py).

X0 = 0.5 * (M['hueft_xy']['l'][0] + M['hueft_xy']['r'][0])
Y0 = 0.5 * (M['hueft_xy']['l'][1] + M['hueft_xy']['r'][1])

# Rumpfkette. Die Uebergaenge sind die am Fischer gemessenen Anteile der
# Koerperhoehe; die Schulter ist gemessen, die Kopfspitze liegt bei 55 %
# des Wegs von der Schulter zum Scheitel (Fischer: 1,141 gegen gemessene
# 1,155).
BAUCH_Z = HUEFT_Z + 0.465 * (0.409 * H - HUEFT_Z)
BRUST_Z = 0.409 * H
KOPF_Z = SCHULTER_Z + 0.55 * (H - SCHULTER_Z)
KEHLE_Z, KEHLE_Y = M['kehle']

R = lambda f: f * H          # Reichweiten skalieren mit der Figur
KN = []                      # (Name, Kopf, Spitze, Eltern, verbunden, Reichweite)
KN += [
    ('wurzel', (X0, Y0, HUEFT_Z), (X0, Y0, BAUCH_Z), None, False, R(0.42)),
    ('bauch', (X0, Y0, BAUCH_Z), (X0, Y0, BRUST_Z), 'wurzel', True, R(0.42)),
    ('brust', (X0, Y0, BRUST_Z), (X0, Y0, SCHULTER_Z), 'bauch', True, R(0.42)),
    ('kopf', (X0, Y0, SCHULTER_Z), (X0, 0.25 * KEHLE_Y, KOPF_Z), 'brust', True, R(0.42)),
    # Kehlsack: die Vorwoelbung der Schnauzenunterseite bekommt einen
    # eigenen Knochen, der im Leerlauf PULSIERT (Skalierung, nicht
    # Drehung) — eine Kroete atmet nicht gleichmaessig, sie pumpt.
    ('kehle', (X0, 0.31 * KEHLE_Y, KEHLE_Z), (X0, 0.79 * KEHLE_Y, KEHLE_Z - 0.015 * H),
     'kopf', False, R(0.112)),
]
for s, vz in (('r', -1.0), ('l', +1.0)):
    sch = (vz * M['rumpf_x'], M['schulter_y'], SCHULTER_Z)
    fa = M['faust'][s]
    ell = misch(sch, fa, 0.5)
    KN += [
        (f'arm_{s}', sch, ell, 'brust', False, R(0.14)),
        (f'hand_{s}', ell, fa, f'arm_{s}', True, R(0.14)),
    ]
for s in ('l', 'r'):
    kx, ky = M['knoechel'][s]
    hx, hy = M['hueft_xy'][s]
    nx, ny = misch((kx, ky), (hx, hy), KNIE_ANTEIL)
    _x0, _x1, zehe_y, ballen_y, _ferse_y = M['fuss'][s]
    fx = 0.5 * (_x0 + _x1)
    # Die Reichweite von Fuss und Zehen ist groesser, als die Knochen lang
    # sind. Das ist Absicht: Der Fuss ist breit, seine Aussenecke liegt weit
    # neben der Knochenachse. Mit einer Reichweite in Knochenlaenge fiele
    # die vordere Aussenecke aus der Zehenhuelle heraus, bliebe beim
    # Abrollen starr am Fuss haengen und tauchte unter den Boden.
    KN += [
        (f'oberbein_{s}', (hx, hy, HUEFT_Z), (nx, ny, KNIE_Z), 'wurzel', False, R(0.155)),
        (f'unterbein_{s}', (nx, ny, KNIE_Z), (kx, ky, KNOECHEL_Z),
         f'oberbein_{s}', True, R(0.140)),
        (f'fuss_{s}', (kx, ky, KNOECHEL_Z), (fx, ballen_y, BALLEN_Z),
         f'unterbein_{s}', True, R(0.170)),
        (f'fusszehen_{s}', (fx, ballen_y, BALLEN_Z), (fx, zehe_y, ZEHE_Z),
         f'fuss_{s}', True, R(0.170)),
    ]

# Requisite: Der Knochen liegt AUF DER GEMESSENEN SCHAFTACHSE, sein Kopf
# im Griff (dem Punkt der Achse, der der Faust am naechsten liegt), seine
# Spitze am oberen Ende.
#
# Auf der Achse und nicht von der Faust zur Spitze: `setz_richtung` dreht
# den Knochen so, dass er in eine vorgegebene Weltrichtung zeigt — das ist
# nur dann die Richtung der WAFFE, wenn Knochen und Waffe parallel sind.
# Die Faust sitzt aber ein bis zwei Zentimeter neben der Achse, und ueber
# die ganze Schaftlaenge waeren daraus mehrere Grad Schielen geworden.
SCHAFT_MITTE = Vector(M['schaft'][0])
SCHAFT_ACHSE = Vector(M['schaft'][1]).normalized()
SCHAFT_T = (M['schaft'][2], M['schaft'][3])
SCHAFT_A = SCHAFT_MITTE + SCHAFT_ACHSE * SCHAFT_T[0]
SCHAFT_B = SCHAFT_MITTE + SCHAFT_ACHSE * SCHAFT_T[1]
GRIFF = SCHAFT_MITTE + SCHAFT_ACHSE * (Vector(M['faust']['r']) - SCHAFT_MITTE).dot(SCHAFT_ACHSE)
KN.append(('requisite', tuple(GRIFF), tuple(SCHAFT_B), 'hand_r', False, 0.0))
if M['schild']:
    KN.append(('schild', M['faust']['l'], M['schild'][0], 'hand_l', False, 0.0))

# gang-diagnose.py zaehlt die Gelenke je Bein ueber die Teilstrings
# "bein", "fuss", "zeh", "schien", "leg", "foot", "toe", "shin". Die
# Beinknochen heissen deshalb bewusst oberbein/unterbein/fuss/fusszehen —
# und KEIN anderer Knochen darf einen dieser Teilstrings tragen, sonst
# meldet die Diagnose mehr Gelenke, als es gibt.
_verboten = ('bein', 'schien', 'fuss', 'zeh', 'leg', 'foot', 'toe', 'shin')
for _n, *_ in KN:
    if _n.startswith(('oberbein', 'unterbein', 'fuss')):
        continue
    if any(t in _n.lower() for t in _verboten):
        raise SystemExit(f'Knochenname "{_n}" kollidiert mit gang-diagnose.py')

KETTE_ARM = {'r': ('arm_r', 'hand_r'), 'l': ('arm_l', 'hand_l')}
KETTE_BEIN = {s: (f'oberbein_{s}', f'unterbein_{s}', f'fuss_{s}', f'fusszehen_{s}')
              for s in ('r', 'l')}

# ── Armature ────────────────────────────────────────────────────────
arm_data = bpy.data.armatures.new(RIGNAME)
arm = bpy.data.objects.new(RIGNAME, arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for name, kopf, spitze, eltern, verbunden, _r in KN:
    b = arm_data.edit_bones.new(name)
    b.head = Vector(kopf)
    b.tail = Vector(spitze)
    if eltern:
        b.parent = arm_data.edit_bones[eltern]
        b.use_connect = bool(verbunden)
bpy.ops.object.mode_set(mode='OBJECT')

SEGMENTE = {n: (Vector(k), Vector(s)) for n, k, s, *_ in KN}
REICHWEITE = {n: r for n, _k, _s, _e, _v, r in KN}
ELTERN = {n: e for n, _k, _s, e, _v, _r in KN}
ALLE = [n for n, *_ in KN]

# ── Gewichte ────────────────────────────────────────────────────────
# Diese Figuren sind FAESSER: Der Rumpf ist fast so breit wie hoch. Eine
# reine Abstandshuelle um die Rumpfkette taugt dafuer nicht — die Huelle
# muesste weiter reichen als der halbe Koerper, und dann zoege die Schulter
# die Bauchflanke und der Helm den Arm. Deshalb drei getrennte
# Zustaendigkeiten, alle stetig im ORT:
#
#   1. MASKEN fuer die Anbauteile (Requisite, Schild). Sie liegen raeumlich
#      getrennt vom Koerper und duerfen nichts vom Nachbarn abbekommen.
#   2. GLIEDMASSEN: je Kette ein Naehe-Mass. Innerhalb der Kette
#      entscheidet die uebliche Huelle, welcher Knochen zieht.
#   3. RUMPF: was uebrig bleibt, wird allein ueber die HOEHE verteilt.
#      Ein Fass hat keine Taille, an der man den Abstand messen koennte;
#      die Hoehe ist das einzige verlaessliche Mass. Helm, Umhang und
#      Fellkragen bleiben so am Rumpf, statt an den Gliedmassen zu haengen.
gruppen = {n: mesh.vertex_groups.new(name=n) for n in ALLE}
R_UNTEN, R_OBEN = M['schaft_r']


def kette_naehe(p, kette, innen, aussen):
    """1 innerhalb `innen` um die Kette, 0 ab `aussen`, weich dazwischen."""
    d = min(abstand_segment(p, *SEGMENTE[n]) for n in kette)
    return 1.0 - glatt((d - innen) / (aussen - innen))


def requisite_maske(p):
    """1 in Speer/Stab/Schwert, 0 daneben.

    Der Radius folgt dem gemessenen Querschnitt laengs der Schaftachse:
    unten ein glatter Schaft, oben Klinge, Schaedel oder Stein samt
    Bindung. Weit genug muss er oben sein, weil der Rumpf dort keine
    Konkurrenz hat — ohne Maske faende die Spitze auf Helmhoehe den KOPF
    als naechsten Knochen und flatterte beim Umsehen mit.

    Die FAUST wird ausdruecklich ausgenommen: Sie gehoert an die Hand,
    nicht an den Schaft, sonst kippte sie beim Zuschlagen mit der Waffe
    um. Der kurze Schaftabschnitt, der dabei mit ausgenommen wird, liegt
    im Drehpunkt der Requisite — dort bewegen Hand und Schaft sich ohnehin
    gleich."""
    t = (p - SCHAFT_MITTE).dot(SCHAFT_ACHSE)
    if not (SCHAFT_T[0] - 0.05 <= t <= SCHAFT_T[1] + 0.05):
        return 0.0
    d = abstand_segment(p, SCHAFT_A, SCHAFT_B)
    voll = R_UNTEN + (R_OBEN - R_UNTEN) * glatt((t - 0.02) / 0.24)
    null = voll * 1.30 + 0.012
    m = 1.0 - glatt((d - voll) / (null - voll))
    return m * (1.0 - kette_naehe(p, KETTE_ARM['r'], 0.059 * H, 0.101 * H))


SCHILD_M = Vector(M['schild'][0]) if M['schild'] else None
SCHILD_R = M['schild'][1] if M['schild'] else 0.0


def schild_maske(p):
    """1 im Schild am +x-Arm, 0 daneben.

    Ohne Maske faende sein unteres Drittel gar keinen Knochen in
    Reichweite (der naechste ist das Ende des +x-Arms, ueber einen halben
    Koerper entfernt) und fiele auf den Notnagel "naechster Knochen"
    zurueck — eine harte Kante mitten im Panzer. Er haengt am Unterarm,
    also an hand_l; der Arm selbst wird ausgenommen, sonst waere er
    festgenagelt."""
    if SCHILD_M is None:
        return 0.0
    d = (p - SCHILD_M).length
    m = 1.0 - glatt((d - SCHILD_R) / (SCHILD_R * 0.35))
    if m <= 0.0:
        return 0.0
    return m * (1.0 - kette_naehe(p, KETTE_ARM['l'], 0.06 * H, 0.10 * H))


def rumpf_hoehe(z):
    """Rumpfgewichte allein aus der Hoehe — stetig, ohne Abstandsmass.

    Die Uebergaenge liegen bei den am FurlocFischer gemessenen Anteilen
    der Koerperhoehe (0,220 / 0,346 / 0,583) mit den dortigen Breiten."""
    t1 = glatt((z - 0.220 * H) / (0.105 * H))      # wurzel -> bauch
    t2 = glatt((z - 0.346 * H) / (0.133 * H))      # bauch  -> brust
    t3 = glatt((z - 0.583 * H) / (0.133 * H))      # brust  -> kopf
    return {'wurzel': 1 - t1, 'bauch': t1 * (1 - t2),
            'brust': t2 * (1 - t3), 'kopf': t3}


def huelle(p, kette):
    """Verteilung innerhalb einer Kette: kompakter Kern je Segment."""
    roh = []
    for n in kette:
        d = abstand_segment(p, *SEGMENTE[n])
        u = d / REICHWEITE[n]
        if u >= 1.0:
            continue
        roh.append((n, (1.0 - u) ** 3 / (u * u + 0.02)))
    if not roh:
        n = min(kette, key=lambda k: abstand_segment(p, *SEGMENTE[k]))
        roh = [(n, 1.0)]
    s = sum(w for _n, w in roh)
    return {n: w / s for n, w in roh}


def gewichte(p):
    w = {}
    m_rq = requisite_maske(p)
    m_sd = schild_maske(p) * (1.0 - m_rq)
    if m_rq > 0.0:
        w['requisite'] = m_rq
    if m_sd > 0.0:
        w['schild'] = m_sd
    rest = max(0.0, 1.0 - m_rq - m_sd)
    if rest <= 1e-4:
        return w

    # Gliedmassen. Der Deckel ueber z verhindert, dass die Arme in Helm
    # oder Kapuze greifen (sie liegen dicht ueber der Schulter und waeren
    # sonst in Reichweite) und die Beine in den Rocksaum.
    arm_deckel = 1.0 - glatt((p.z - (SCHULTER_Z + 0.063 * H)) / (0.084 * H))
    bein_deckel = 1.0 - glatt((p.z - (HUEFT_Z + 0.021 * H)) / (0.070 * H))
    # Unter dem Knoechel greift das Bein WEITER. Der Fuss ist breit und
    # spreizt nach aussen; seine Aussenkante liegt weit vom Fussknochen
    # entfernt und faende sonst zu einem Drittel den Rumpf — eine
    # Fussecke, die beim Auftreten stehen bleibt, waehrend der Rest des
    # Fusses geht.
    unter_knoechel = 1.0 - glatt((p.z - KNOECHEL_Z) / (0.038 * H))
    bein_innen = 0.085 * H + 0.080 * H * unter_knoechel
    bein_aussen = 0.150 * H + 0.080 * H * unter_knoechel
    anteile = [
        (KETTE_ARM['r'], kette_naehe(p, KETTE_ARM['r'], 0.070 * H, 0.147 * H) * arm_deckel),
        (KETTE_ARM['l'], kette_naehe(p, KETTE_ARM['l'], 0.070 * H, 0.147 * H) * arm_deckel),
        (KETTE_BEIN['r'], kette_naehe(p, KETTE_BEIN['r'], bein_innen, bein_aussen) * bein_deckel),
        (KETTE_BEIN['l'], kette_naehe(p, KETTE_BEIN['l'], bein_innen, bein_aussen) * bein_deckel),
    ]
    summe = sum(a for _k, a in anteile)
    if summe > 1.0:
        anteile = [(k, a / summe) for k, a in anteile]
        summe = 1.0
    for kette, a in anteile:
        if a <= 1e-4:
            continue
        teil = huelle(p, kette)
        if kette in (KETTE_BEIN['r'], KETTE_BEIN['l']):
            # Unterhalb des Knoechels gehoert ALLES dem Fuss.
            #
            # Ohne diese Regel bekommt die FERSE den Unterschenkel: Sie
            # liegt hinter dem Knoechel, der Fussknochen zeigt aber nach
            # vorn — beide Knochen sind damit gleich weit weg, und der
            # laengere Unterschenkel mit seiner groesseren Reichweite
            # gewinnt. Die Folge waere eine Ferse, die beim Fersenauftritt
            # in den Boden sinkt, obwohl der Knoechel richtig steht.
            f = unter_knoechel
            if f > 1e-4:
                nur_fuss = huelle(p, kette[2:])
                teil = {n: (1 - f) * teil.get(n, 0.0) + f * nur_fuss.get(n, 0.0)
                        for n in set(teil) | set(nur_fuss)}
        for n, x in teil.items():
            w[n] = w.get(n, 0.0) + rest * a * x

    kern = rest * (1.0 - summe)
    if kern > 1e-4:
        rh = rumpf_hoehe(p.z)
        kehle = 0.85 * (1.0 - glatt(
            (abstand_segment(p, *SEGMENTE['kehle']) - 0.049 * H) / (0.063 * H)))
        for n, x in rh.items():
            if n == 'kopf' and kehle > 0.0:
                w['kehle'] = w.get('kehle', 0.0) + kern * x * kehle
                x *= (1.0 - kehle)
            w[n] = w.get(n, 0.0) + kern * x
    return w


zaehler = {'requisite': 0, 'schild': 0}
for i, p in enumerate(welt):
    if requisite_maske(p) > 0.9:
        zaehler['requisite'] += 1
    if schild_maske(p) > 0.9:
        zaehler['schild'] += 1
    w = gewichte(p)
    # glTF haelt nur 4 Joints je Vertex — die schwaechsten fallen weg, der
    # Rest wird nachnormiert.
    roh = sorted(((n, x) for n, x in w.items() if x > 1e-4), key=lambda t: -t[1])[:4]
    s = sum(x for _n, x in roh) or 1.0
    for n, x in roh:
        gruppen[n].add([i], x / s, 'REPLACE')

print(f'GEWICHTE: {zaehler["requisite"]} Vertices voll an der Requisite, '
      f'{zaehler["schild"]} voll am Schild, Rest ueber Gliedmassen-Naehe '
      f'und Rumpfhoehe')

mod = mesh.modifiers.new('Armature', 'ARMATURE')
mod.object = arm
mesh.parent = arm

# ── Posieren: Drehungen um WELTACHSEN ───────────────────────────────
# bone.matrix_local bildet Knochenraum -> Armature-Raum ab; die Armature
# steht auf dem Ursprung, Armature-Raum ist also Weltraum. Damit laesst
# sich eine Weltdrehung sauber in den lokalen Raum eines Knochens holen —
# ohne Raterei ueber Bone-Rolls.
HOCH = Vector((0, 0, 1))       # Gierachse: umsehen, Schultern gegen Huefte
QUER = Vector((1, 0, 0))       # Seitenachse. +Grad kippt +z nach -y, also
#                                nach VORN; ein nach unten zeigender
#                                Beinknochen schwingt damit nach HINTEN.
VOR = Vector((0, -1, 0))       # Blickachse: seitliches Wiegen

WELTDREHUNG = {}


def _welt_zu_knochen(pb, qwelt):
    m = pb.bone.matrix_local.to_3x3()
    return (m.inverted() @ qwelt.to_matrix() @ m).to_quaternion()


def setz(name, *drehungen):
    """Setzt einen Knochen ueber Drehungen um WELTACHSEN."""
    ges = Quaternion()
    for achse, grad in drehungen:
        ges = ges @ Quaternion(achse.normalized(), math.radians(grad * STAERKE))
    WELTDREHUNG[name] = ges
    arm.pose.bones[name].rotation_quaternion = _welt_zu_knochen(
        arm.pose.bones[name], ges)


def kettendrehung(name):
    """Weltdrehung der ELTERNKETTE ueber `name` (Wurzel zuerst)."""
    kette = []
    e = ELTERN[name]
    while e:
        kette.append(e)
        e = ELTERN[e]
    q = Quaternion()
    for n in reversed(kette):
        q = q @ WELTDREHUNG.get(n, Quaternion())
    return q


def setz_richtung(name, ziel):
    """Dreht einen Knochen so, dass er in WELTKOORDINATEN nach `ziel` zeigt.

    Fuer die Requisite ist das der entscheidende Unterschied zu einem
    Winkel: Beim Zustechen muss die SCHAFTRICHTUNG feststehen, egal was
    Rumpf, Schulter und Handgelenk gerade tun. Wer stattdessen Winkel
    stapelt, bekommt eine Richtung, die von fuenf Gelenken abhaengt — und
    genau dann schert der Stich seitlich aus."""
    kopf, spitze = SEGMENTE[name]
    ruhe = (spitze - kopf).normalized()
    eltern = kettendrehung(name)
    w = eltern.inverted() @ ruhe.rotation_difference(Vector(ziel).normalized())
    WELTDREHUNG[name] = w
    arm.pose.bones[name].rotation_quaternion = _welt_zu_knochen(
        arm.pose.bones[name], w)


def versatz(pb, vek):
    return pb.bone.matrix_local.to_3x3().inverted() @ Vector(vek)


def schiebe(name, vek):
    """Verschiebt einen Knochen um `vek` in WELTKOORDINATEN.

    Die Drehung der Elternkette wird herausgerechnet. Fuer den Stoss ist
    das wesentlich: Wenn Rumpf und Schulter schon gedreht sind, laege eine
    im Knochenraum gemessene Verschiebung nicht mehr in Schaftrichtung —
    und genau das waere der seitlich ausscherende Stich. Voraussetzung ist,
    dass die Eltern in derselben Pose VORHER gesetzt wurden."""
    pb = arm.pose.bones[name]
    lokal = kettendrehung(name).inverted() @ (Vector(vek) * STAERKE)
    pb.location = versatz(pb, lokal)


bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'

szene = bpy.context.scene
# Die endgueltige Bildrate wird erst im Gang-Abschnitt festgelegt (sie
# haengt an der Zykluslaenge); hier steht nur der Ausgangswert.
szene.render.fps = FPS


def aktion(name, dauer, pose_fn, schleife=True):
    """Backt eine Aktion.

    Bei `schleife` ist der letzte Frame die Kopie des ersten und die Phase
    laeuft von 0 bis 1 ueber `frames` Schritte — dann schliesst der Zyklus
    im Client ohne Sprung. Sonst laeuft die Phase ueber die volle Laenge.

    Geschluesselt werden Drehung UND Verschiebung ALLER Knochen sowie die
    Skalierung des Kehlsacks. Die Verschiebung braucht nicht nur die
    Wurzel: Die Beine bekommen ihre Laenge aus der IK und die Requisite
    rutscht am Schaft hoch."""
    frames = int(round(dauer * FPS))
    arm.animation_data_create()
    akt = bpy.data.actions.new(name)
    akt.use_fake_user = True
    arm.animation_data.action = akt
    szene.frame_start = 1
    szene.frame_end = frames + 1
    for f in range(1, frames + 2):
        phase = ((f - 1) % frames) / frames if schleife else (f - 1) / frames
        szene.frame_set(f)
        WELTDREHUNG.clear()
        for pb in arm.pose.bones:
            pb.rotation_quaternion = Quaternion()
            pb.location = (0.0, 0.0, 0.0)
            pb.scale = (1.0, 1.0, 1.0)
        pose_fn(phase)
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=f)
            pb.keyframe_insert('location', frame=f)
        arm.pose.bones['kehle'].keyframe_insert('scale', frame=f)
    for fc in akt.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
    akt.name = name
    print(f'AKTION {name}: {frames + 1} Frames ({dauer:.3f} s bei {FPS} fps), '
          f'{len(akt.fcurves)} F-Kurven')
    return akt


# ── Beinkinematik ───────────────────────────────────────────────────
# Die Laengen sind die Projektionen in die Schrittebene (y,z); der
# seitliche Versatz der Beine bleibt starr und stoert die Rechnung nicht.
def _laenge(a, b):
    return math.hypot(a[1] - b[1], a[2] - b[2])


_bn = {n: (k, s) for n, k, s, *_ in KN}
OBER = _laenge(*_bn['oberbein_r'])
UNTER = _laenge(*_bn['unterbein_r'])
HUEFT_UEBER_KNOECHEL = HUEFT_Z - KNOECHEL_Z
Y_KNOECHEL_RUHE = M['knoechel']['r'][1] - M['hueft_xy']['r'][1]
# Sohlenpunkte im Fussraum, gemessen vom Knoechel aus. Die z-Werte sind
# ausdruecklich die der SOHLENHAUT (0 = Boden), nicht die der
# Knochenspitzen: Beim Abrollen dreht der Fuss um den Punkt, der den Boden
# beruehrt, und das ist die Haut.
_fr = M['fuss']['r']
FERSE_LOK = (_fr[4] - M['knoechel']['r'][1], -KNOECHEL_Z)
BALLEN_LOK = (_fr[3] - M['knoechel']['r'][1], -KNOECHEL_Z)


def bein_ik(dy, dz, hub):
    """Loest Huefte und Knie zu einem Knoechelort auf.

    dy/dz: Versatz des Knoechels gegen die Ruhelage.
    hub:   Versatz der HUEFTE (Beckensenkung, negativ = tiefer).
    Rueckgabe: (Oberschenkelwinkel, Kniebeugung, Schienbeinwinkel) in Grad,
    jeweils gegen die Senkrechte, + = nach HINTEN.

    Es wird ausdruecklich der Ast mit dem Knie NACH VORN genommen
    (theta = phi - alpha). Die Ruhelage liegt haarscharf auf dem anderen
    Ast; einmal falsch gewaehlt, knickt das Bein beim ersten Schritt nach
    hinten durch."""
    Y = Y_KNOECHEL_RUHE + dy
    Z = HUEFT_UEBER_KNOECHEL + hub - dz
    L = min(math.hypot(Y, Z), (OBER + UNTER) * 0.998)
    L = max(L, abs(OBER - UNTER) + 1e-4)
    phi = math.atan2(Y, Z)
    ca = (OBER * OBER + L * L - UNTER * UNTER) / (2 * OBER * L)
    cb = (UNTER * UNTER + L * L - OBER * OBER) / (2 * UNTER * L)
    alpha = math.acos(max(-1.0, min(1.0, ca)))
    beta = math.acos(max(-1.0, min(1.0, cb)))
    ober = phi - alpha
    schien = phi + beta
    return math.degrees(ober), math.degrees(schien - ober), math.degrees(schien)


# Die RUHEWINKEL des Modells, aus der Knochentabelle gerechnet. Sie sind
# NICHT dasselbe wie die Loesung der IK fuer die Ruhelage: Die Modelle
# stehen mit praktisch durchgedruecktem Knie, die IK waehlt den Ast mit dem
# Knie nach vorn. Wer die Gelenkwinkel gegen die IK-Ruhelage verrechnet
# statt gegen die MODELL-Ruhelage, verschiebt jedes Bein um diese
# Differenz — die Sohle staende dann unter dem Boden, obwohl die IK stimmt.
def _modellwinkel(kopf, spitze):
    return math.degrees(math.atan2(spitze[1] - kopf[1], kopf[2] - spitze[2]))


OBER_MODELL = _modellwinkel(*_bn['oberbein_r'])
SCHIEN_MODELL = _modellwinkel(*_bn['unterbein_r'])
KNIE_MODELL = SCHIEN_MODELL - OBER_MODELL
print(f'BEIN: Oberschenkel {OBER:.4f}, Schienbein {UNTER:.4f}; Modell-Ruhewinkel '
      f'{OBER_MODELL:+.2f} / {SCHIEN_MODELL:+.2f} Grad; IK-Ruheloesung '
      f'{bein_ik(0.0, 0.0, 0.0)[0]:+.2f} / {bein_ik(0.0, 0.0, 0.0)[2]:+.2f} Grad')


def pivot_versatz(lok, grad):
    """Wohin muss der Knoechel, damit `lok` beim Neigen liegen bleibt?

    Beim Fersenauftritt dreht der Fuss um die FERSE, beim Abstossen um den
    BALLEN. In beiden Faellen steht der Drehpunkt still und der Knoechel
    wandert — genau dieser Versatz macht den Unterschied zwischen einer
    Sohle, die abrollt, und einer, die ueber den Boden schleift."""
    r = math.radians(grad)
    s, c = math.sin(r), math.cos(r)
    y2 = lok[0] * c - lok[1] * s
    z2 = lok[0] * s + lok[1] * c
    return lok[0] - y2, lok[1] - z2


# ── Laufzyklus: erst die Sohle, dann das Bein ───────────────────────
# Standphasenanteil und Fusswinkel sind Gestaltung, die SCHRITTWEITE ist
# es nicht. Sie folgt aus der Beinlaenge: Der Knoechel kann sich hoechstens
# so weit von der Huefte entfernen, wie das gestreckte Bein lang ist. Bei
# 90 % davon als GANZEM Ausschlag bleibt genug Reserve, dass das Becken
# nicht bis an den Anschlag absacken muss.
STAND = 0.58            # Anteil der Standphase am Zyklus
FERSE_ANT = 0.10        # Anteil der Standphase mit Fersendrehung
BALLEN_ANT = 0.78       # ab hier rollt der Fuss ueber den Ballen ab
NEIG_FERSE = 6.0        # Grad Zehe HOCH beim Aufsetzen
NEIG_BALLEN = 19.0      # Grad Zehe RUNTER beim Abstossen
SCHWUNG_HUB = 0.30 * BEIN_LAENGE    # wie hoch der Knoechel im Schwung steigt

# Der Sollweg der Sohle je Standphase. Aus ihm folgt die Zyklusdauer, denn
# eine stehende Sohle MUSS sich im Koerperraum genau so schnell nach hinten
# bewegen, wie der Server die Figur nach vorn schiebt:
#     Sohlenweg / (Standanteil * Zyklusdauer) = TEMPO / SKALA
# Die Rundung auf ganze Bilder wird in die Schrittweite zurueckgerechnet,
# damit auch nach der Rundung KEIN Rest bleibt.
SCHRITT_WUNSCH = 0.90 * BEIN_LAENGE
_v = TEMPO / SKALA                       # Modelleinheiten je Sekunde
_dauer_roh = SCHRITT_WUNSCH / (STAND * _v)
# ── Die Bildrate haengt an der Zykluslaenge ─────────────────────────
# Diese Figuren haben SEHR kurze Beine, und daraus folgt zwingend ein sehr
# kurzer Zyklus (Schrittweite mal Kadenz muss 1,5 m/s ergeben). Beim Kind
# sind das 0,10 s — bei 60 fps also SECHS Bilder fuer einen ganzen Schritt,
# und davon anderthalb fuer die Standphase.
#
# Das ist nicht bloss unschoen, es ist messbar falsch: Der Client
# interpoliert zwischen den Bildern LINEAR IN DEN GELENKWINKELN, waehrend
# die Standphase eine lineare Bewegung der SOHLE verlangt. Je weiter die
# Stuetzstellen auseinanderliegen, desto weiter laeuft das eine vom anderen
# weg. Nachgemessen rutschte das Kind mit sechs Bildern im Mittel
# 0,75 m/s, die vier Erwachsenen mit 13 bis 15 Bildern nur 0,23 bis
# 0,35 m/s.
#
# Deshalb bekommt jede Figur so viele Bilder je Sekunde, dass ihr Zyklus
# mindestens MIN_BILDER Stuetzstellen hat. Teuer ist das nicht: Die
# Animationsdaten sind ein Bruchteil der Texturen.
FPS = FPS_BASIS
while round(_dauer_roh * FPS) < MIN_BILDER:
    FPS += FPS_BASIS
szene.render.fps = FPS
FRAMES_WALK = max(4, int(round(_dauer_roh * FPS)))
DAUER_WALK = FRAMES_WALK / FPS
SCHRITT = STAND * _v * DAUER_WALK
print(f'GANG: Tempo {TEMPO} m/s bei localScale {SKALA} = {_v:.4f} Einheiten/s. '
      f'Sohlenweg je Standphase {SCHRITT:.4f} Einheiten ({SCHRITT * SKALA:.3f} m), '
      f'Standanteil {STAND:.2f} -> Zyklus {DAUER_WALK:.4f} s ({FRAMES_WALK} Bilder), '
      f'{2 / DAUER_WALK:.2f} Schritte/s')

_DY_AB, _DZ_AB = pivot_versatz(BALLEN_LOK, NEIG_BALLEN)
_DY_AUF, _DZ_AUF = pivot_versatz(FERSE_LOK, -NEIG_FERSE)
STAND_ENDE = (SCHRITT / 2 + _DY_AB, _DZ_AB, NEIG_BALLEN, -NEIG_BALLEN)
STAND_ANFANG = (-SCHRITT / 2 + _DY_AUF, _DZ_AUF, -NEIG_FERSE, 0.0)


def fuss_bahn(tau):
    """Knoechelversatz, Sohlenneigung, Zehenwinkel und Standflagge.

    Standphase: Der BODENPUNKT (Ferse, dann ganze Sohle, dann Ballen)
    wandert streng linear mit `SCHRITT` je Standphase nach hinten — genau
    mit Koerpertempo. Das ist die Bedingung fuer null Rutschen, und sie ist
    hier nicht angenaehert, sondern eingebaut."""
    if tau < STAND:
        u = tau / STAND
        dy = -SCHRITT / 2 + SCHRITT * u
        dz = 0.0
        neig = 0.0
        zeh = 0.0
        if u < FERSE_ANT:
            neig = -NEIG_FERSE * (1.0 - u / FERSE_ANT)
            vy, vz = pivot_versatz(FERSE_LOK, neig)
            dy += vy
            dz += vz
        elif u > BALLEN_ANT:
            neig = NEIG_BALLEN * glatt((u - BALLEN_ANT) / (1.0 - BALLEN_ANT))
            vy, vz = pivot_versatz(BALLEN_LOK, neig)
            dy += vy
            dz += vz
            # Die Zehen bleiben flach am Boden liegen, waehrend die Ferse
            # steigt. Ohne dieses Gelenk bohrte sich die Zehenspitze beim
            # Abstossen in den Boden.
            zeh = -neig
        return dy, dz, neig, zeh, 1.0

    v = (tau - STAND) / (1.0 - STAND)
    w = glatt(v)
    dy = STAND_ENDE[0] + (STAND_ANFANG[0] - STAND_ENDE[0]) * w
    dz = (STAND_ENDE[1] + (STAND_ANFANG[1] - STAND_ENDE[1]) * w
          + SCHWUNG_HUB * math.sin(math.pi * v) ** 0.9)
    neig = STAND_ENDE[2] + (STAND_ANFANG[2] - STAND_ENDE[2]) * glatt((v - 0.05) / 0.55)
    zeh = STAND_ENDE[3] * (1.0 - glatt(v / 0.35))
    return dy, dz, neig, zeh, 0.0


def beckenhub(tau_r, tau_l):
    """Wie tief muss das Becken, damit das Standbein den Boden erreicht?

    Das Bein ist in der Ruhelage praktisch gestreckt. Es kann also nicht
    laenger werden — schwingt es aus, MUSS das Becken sinken. Genau das ist
    der Kompassgang: hoch in der Einzelstuetze, tief in der
    Doppelstuetze. Die Rechnung nimmt je Bild das TIEFERE der beiden
    Standbeine."""
    huebe = []
    for tau in (tau_r, tau_l):
        if tau % 1.0 < STAND:
            dy, dz, _n, _t, _s = fuss_bahn(tau % 1.0)
            Y = Y_KNOECHEL_RUHE + dy
            rest = (OBER + UNTER) ** 2 * 0.996 - Y * Y
            huebe.append(math.sqrt(max(1e-6, rest)) + dz - HUEFT_UEBER_KNOECHEL)
    return min(huebe) if huebe else 0.0


HUEFT_HALB = 0.5 * abs(M['hueft_xy']['l'][0] - M['hueft_xy']['r'][0])


def bein_setzen(seite, dy, dz, neig, zeh, hub_seite,
                rumpf_quer=0.0, rumpf_vor=0.0, rumpf_gier=0.0):
    """Traegt eine Knoechelvorgabe in die vier Gelenke ein.

    `rumpf_quer` und `rumpf_vor` sind die Drehungen, die die WURZEL in
    dieser Pose schon mitbringt. Sie werden herausgerechnet, denn die IK
    rechnet mit einer aufrechten Huefte: Neigt sich das Becken nach vorn,
    wandert der Knoechel sonst mit, und beim seitlichen Wiegen kippt die
    Sohle mit dem Becken.

    `rumpf_gier` ebenso: Die Hueftpfannen sitzen neben der Koerperachse,
    eine Beckendrehung schiebt jede Pfanne in Laufrichtung. Ohne Korrektur
    schoebe das den Standfuss im Schritttakt vor und zurueck."""
    x_rel = SEGMENTE[f'oberbein_{seite}'][0].x - SEGMENTE['wurzel'][0].x
    dy = dy - x_rel * math.sin(math.radians(rumpf_gier))
    ober, knie, schien = bein_ik(dy, dz, hub_seite)
    setz(f'oberbein_{seite}', (QUER, ober - OBER_MODELL - rumpf_quer), (VOR, -rumpf_vor))
    setz(f'unterbein_{seite}', (QUER, knie - KNIE_MODELL))
    # Der Fuss bekommt die Drehung der Kette abgezogen: Was uebrig bleibt,
    # ist genau die SOHLENNEIGUNG in der Welt. Ohne diese Verrechnung
    # kippte die Sohle mit dem Unterschenkel mit.
    setz(f'fuss_{seite}', (QUER, neig - (schien - SCHIEN_MODELL)))
    setz(f'fusszehen_{seite}', (QUER, zeh))


# ── Die Requisite steht auf dem Boden, aber nie darunter ────────────
# Bei vier von fuenf liegt das Schaftende unter der Sohle. In der Ruhe
# wird die Requisite um genau diesen Betrag plus etwas Luft angehoben —
# dann ist der tiefste Punkt der Figur die SOHLE und nicht das Schaftende.
# Beim Gehen wird sie hoeher getragen: Ein Schaft, der auf Bodenhoehe
# mitwandert, pfluegt sonst durchs Gelaende.
# Die Zugabe ist nachgemessen und nicht geschaetzt: Auch ein ruhiger Arm
# bewegt den Griff im Leerlauf um rund einen Zentimeter, und das Schaftende
# haengt einen halben Meter darunter.
REQ_RUHE = SCHAFT_UNTER_SOHLE + 0.045 * H
REQ_GANG = SCHAFT_UNTER_SOHLE + 0.105 * H
REQ_RUHE_RICHTUNG = (SEGMENTE['requisite'][1] - SEGMENTE['requisite'][0]).normalized()

# ── Der freie Arm gehoert herunter ──────────────────────────────────
# Meshy liefert alle fuenf mit WAAGERECHT AUSGESTRECKTEN Armen. Das ist
# eine Bindepose und keine Haltung: Eine Figur, die mit ausgebreiteten
# Armen durch die Gegend laeuft, liest sich als Vogelscheuche. Der Arm mit
# der Requisite muss oben bleiben (er haelt den Schaft auf Schulterhoehe),
# der andere wird in JEDER Pose um `arm_senken` gesenkt.
#
# Um die BLICKACHSE gedreht, nicht um die Seitenachse: Der Arm zeigt nach
# +x, und nur eine Drehung um y bewegt ihn in der Ebene x-z nach unten.
# Positive Grad um VOR = (0,-1,0) heben ihn, negative senken ihn.
SENKEN = float(arg('--arm-senken', str(M['arm_senken'])))


# ── idle: stehen, atmen, Kehlsack pulsieren ─────────────────────────
# Klein dosiert. Die Figuren sind gedrungen; grosse Winkel lesen sich
# sofort als Wackeln. Der Kehlsack traegt den kroetenhaften Zug: Er bleibt
# lange ruhig und blaeht sich dann zweimal kurz auf.
def idle_pose(p):
    t = p * math.tau
    s, c = math.sin(t), math.cos(t)
    s2 = math.sin(t * 2)

    # Beide Fuesse stehen. Das Becken wiegt und atmet; die IK haelt die
    # Sohlen dabei auf dem Boden — ohne sie schoebe die Figur die Fuesse
    # bei jedem Atemzug in den Boden.
    hub = 0.004 * H * s2
    seit = 0.005 * H * s
    setz('wurzel', (VOR, 0.5 * s), (HOCH, 0.9 * math.sin(t + 0.4)))
    schiebe('wurzel', (seit, 0.0, hub))
    for seite, vz in (('r', -1.0), ('l', 1.0)):
        bein_setzen(seite, 0.0, 0.0, 0.0, 0.0,
                    hub + vz * HUEFT_HALB * math.sin(math.radians(0.5 * s)),
                    rumpf_vor=0.5 * s, rumpf_gier=0.9 * math.sin(t + 0.4))

    setz('bauch', (VOR, 0.4 * s), (QUER, 0.7 * s2))
    setz('brust', (QUER, 1.2 * s2), (VOR, 0.4 * s), (HOCH, -1.1 * s))
    setz('kopf', (HOCH, 3.4 * math.sin(t * 2 + 0.7)), (QUER, -1.8 * math.sin(t * 3 + 1.9)))

    puls = max(0.0, math.sin(t * 2 - 0.6)) ** 6
    b = 1.0 + 0.16 * puls * STAERKE
    arm.pose.bones['kehle'].scale = (b, 1.0 + 0.07 * puls * STAERKE, b)

    # Requisitenarm: der Schaft STEHT auf dem Boden, der Arm atmet nur mit.
    # Die Winkel sind bewusst winzig — ein Grad an der Schulter ist am
    # entfernten Schaftende schon anderthalb Zentimeter.
    setz('arm_r', (QUER, 0.5 * s), (VOR, -0.4 * s))
    setz('hand_r', (QUER, 0.6 * math.sin(t + 0.5)))
    # Die Schaftrichtung wird in WELTkoordinaten gehalten statt aus
    # Armwinkeln zusammengesetzt: Sonst kippt der aufgestellte Stab mit
    # jedem Atemzug mit, und sein Ende bohrt sich in den Boden.
    setz_richtung('requisite', REQ_RUHE_RICHTUNG + Vector((0.004 * c, 0.004 * s, 0.0)))
    schiebe('requisite', (0.0, 0.0, REQ_RUHE))
    # Freier Arm: haengt waagerecht und wippt.
    setz('arm_l', (VOR, -SENKEN + 2.2 * s - 1.5), (QUER, -1.6 * s))
    setz('hand_l', (VOR, 0.25 * SENKEN + 3.0 * math.sin(t + 0.6)), (QUER, -2.0 * s))
    if M['schild']:
        setz('schild', (QUER, 1.5 * s), (HOCH, 1.0 * c))


# ── walk: watschelnder Gang ─────────────────────────────────────────
# Die Beine kommen vollstaendig aus fuss_bahn() + bein_ik(); hier stehen
# nur noch Rumpf, Arme und das Watscheln.
#
# Das Watscheln ist eine seitliche BECKENROLLE. Sie hebt die Huefte des
# Schwungbeins an — genau deshalb geht sie in die IK ein (hub_seite), sonst
# schoebe sie das Standbein durch den Boden.
def walk_pose(p):
    tau_r = p
    tau_l = (p + 0.5) % 1.0
    hub = beckenhub(tau_r, tau_l)
    # Die Rolle senkt den Umhangsaum um Saumradius * sin(rolle); drei Grad
    # sind bei 0,4 Saumradius zwei Zentimeter und damit vertretbar.
    rolle = 3.0 * math.sin(p * math.tau)          # Grad, + = rechts tiefer
    gier = 4.5 * math.sin(p * math.tau)

    setz('wurzel', (VOR, rolle), (HOCH, gier))
    schiebe('wurzel', (0.010 * H * math.sin(p * math.tau), 0.0, hub))
    for seite, vz in (('r', -1.0), ('l', 1.0)):
        tau = tau_r if seite == 'r' else tau_l
        dy, dz, neig, zeh, _st = fuss_bahn(tau)
        bein_setzen(seite, dy, dz, neig, zeh,
                    hub + vz * HUEFT_HALB * math.sin(math.radians(rolle)),
                    rumpf_vor=rolle, rumpf_gier=gier)

    setz('bauch', (QUER, 2.5), (HOCH, -2.0 * math.sin(p * math.tau)),
         (VOR, -1.5 * math.sin(p * math.tau)))
    setz('brust', (QUER, 2.0 + 2.2 * math.cos(p * math.tau * 2)),
         (HOCH, -4.5 * math.sin(p * math.tau)), (VOR, -1.2 * math.sin(p * math.tau)))
    setz('kopf', (QUER, -3.0 - 2.0 * math.cos(p * math.tau * 2)),
         (HOCH, 2.5 * math.sin(p * math.tau)))
    arm.pose.bones['kehle'].scale = (1.0 + 0.04 * math.cos(p * math.tau * 2), 1.0,
                                     1.0 + 0.04 * math.cos(p * math.tau * 2))

    schwung = math.sin(p * math.tau)
    setz('arm_r', (QUER, -9.0 * schwung), (VOR, -3.0 * schwung))
    setz('hand_r', (QUER, -5.0 * math.sin(p * math.tau - 0.4)))
    setz('requisite', (QUER, 4.0 * schwung), (VOR, 2.5 * math.cos(p * math.tau)))
    schiebe('requisite', (0.0, 0.0, REQ_GANG))
    setz('arm_l', (VOR, -SENKEN + 3.5 * schwung - 2.0), (QUER, 11.0 * schwung))
    setz('hand_l', (VOR, 0.25 * SENKEN), (QUER, 6.0 * math.sin(p * math.tau - 0.5)))
    if M['schild']:
        setz('schild', (QUER, -3.0 * schwung))


# ── attack ──────────────────────────────────────────────────────────
# Zwei Bauarten, weil die Waffen zwei verschiedene sind:
#
# STICH (Krieger, Speer): Kein Schlag, ein Stich. Der Unterschied ist nicht
# die Heftigkeit, sondern die Bahn — beim Stich bewegt sich die Waffe in
# ihrer eigenen LAENGSRICHTUNG. Deshalb ist der Stoss hier eine reine
# VERSCHIEBUNG: Beim Ausholen dreht sich der Speer in die Zielrichtung
# (setz_richtung, Weltkoordinaten), waehrend des Stosses steht JEDE Drehung
# still, und Becken und Arm verschieben sich laengs genau dieser Richtung.
# Die Spitze kann dabei gar nicht anders, als auf der Schaftgeraden zu
# bleiben.
#
# SCHLAG (Haeuptling, Aeltester, Schamane, Kind): Stab und Holzschwert
# stechen nicht, sie treffen mit dem oberen Ende. Die Waffe wird ueber die
# Schulter gerissen und nach vorn-unten geschlagen; die Bahn ist ein Bogen
# um die Schulter, und der Schlagpunkt ist das Schaftende.
#
# Zielhoehe: Alle fuenf sind kleiner als ein erwachsener Mensch. Stich und
# Schlag gehen deshalb SCHRAEG NACH OBEN bzw. enden auf Brusthoehe.
STOSS_RICHTUNG = Vector((-0.10, -0.985, 0.14)).normalized()
STOSS_BECKEN = 0.08 * H
STOSS_ARM = 0.13 * H
# Hocke und Rueckverlagerung sind bewusst klein, und das BECKEN NEIGT SICH
# IN KEINER ANGRIFFSPOSE. Der Grund ist gemessen: Haeuptling und Aeltester
# tragen einen bodenlangen Umhang, dessen Saum am Becken haengt und rund
# 0,4 Einheiten seitlich davon liegt. Neun Grad Beckenneigung senken diesen
# Saum um 0,4 * sin(9 Grad) = 6 cm; zusammen mit der Hocke tauchte er in
# der ersten Fassung 12 cm ins Gelaende (an der evaluierten Haut
# nachgemessen). Die Neigung sitzt deshalb in BAUCH und BRUST, die
# ueberhalb des Saums liegen; das Becken macht nur noch Gier (Drehung um
# die Hochachse, die den Saum ueberhaupt nicht hebt oder senkt) und die
# Verschiebung.
HOCK = 0.012 * H
ZURUECK = 0.025 * H

ZEIT = {'ruhe': (0.00, 0.08), 'aushol': (0.08, 0.36),
        'stoss': (0.36, 0.60), 'treffer': (0.60, 0.72), 'zurueck': (0.72, 1.00)}


def _rampe(p, a, b):
    """0 vor a, 1 nach b, weich dazwischen."""
    return glatt((p - a) / (b - a)) if b > a else (1.0 if p >= b else 0.0)


def _beine_ausfall(aus, stoss, root, gier=0.0):
    """Ausfallschritt: linker Fuss vorn, rechter hinten.

    Beim Stoss kommt die hintere Ferse hoch und der Fuss rollt ueber den
    BALLEN ab — dieselbe Mechanik wie im Gang, und der einzige Weg, den
    Ausfall zu machen, ohne dass die Beinlaenge nicht mehr reicht."""
    for seite, vz in (('r', -1.0), ('l', 1.0)):
        vorn = 0.35 * BEIN_LAENGE * aus * (-vz)
        neig = 24.0 * stoss if seite == 'r' else -4.0 * stoss
        if seite == 'r':
            vy, vz2 = pivot_versatz(BALLEN_LOK, neig)
        else:
            vy, vz2 = pivot_versatz(FERSE_LOK, neig)
        bein_setzen(seite, vorn + vy - root.y, vz2, neig,
                    -neig if seite == 'r' else 0.0,
                    root.z + vz * HUEFT_HALB * math.sin(math.radians(2.5 * aus)),
                    rumpf_gier=gier)


def attack_stich(p):
    aus = _rampe(p, *ZEIT['aushol']) * (1.0 - _rampe(p, *ZEIT['zurueck']))
    stoss = _rampe(p, *ZEIT['stoss']) * (1.0 - _rampe(p, 0.74, 0.92))
    # Nachfedern nach dem Treffer: gedaempfte Schwingung, ausdruecklich NUR
    # entlang der Schaftrichtung — quer waere sie ein Wackeln der Waffe.
    federn = (math.sin((p - 0.60) * math.tau * 2.4) * math.exp(-(p - 0.60) * 11.0)
              if 0.60 <= p < 0.90 else 0.0)
    weg = STOSS_BECKEN * stoss + 0.008 * H * federn

    root = (Vector((0.0, ZURUECK, -HOCK)) * aus) + STOSS_RICHTUNG * weg
    # ── Warum in dieser Kette KEIN `stoss`-Term steht ────────────────
    # Die Spitze sitzt am Ende der Kette Wurzel-Bauch-Brust-Arm-Hand-
    # Requisite. `setz_richtung` haelt zwar die Schaftrichtung fest, aber
    # der GRIFF wandert mit jeder Drehung dieser Kette. Bewegt er sich quer
    # zum Schaft, wandert die Spitze mit — und der Stich schert aus.
    # Waehrend des Stosses steht die Kette deshalb STILL; ihre einzige
    # Bewegung ist die Verschiebung laengs STOSS_RICHTUNG.
    setz('wurzel', (HOCH, -9.0 * aus))
    schiebe('wurzel', root)
    _beine_ausfall(aus, stoss, root, gier=-9.0 * aus)

    setz('bauch', (QUER, 10.0 * aus), (HOCH, -8.0 * aus), (VOR, 2.5 * aus))
    setz('brust', (QUER, -9.0 * aus), (HOCH, -14.0 * aus), (VOR, 5.0 * aus))
    setz('kopf', (QUER, 8.0 * aus + 6.0 * stoss + 2.0 * federn),
         (HOCH, 10.0 * aus - 14.0 * stoss))
    arm.pose.bones['kehle'].scale = (1.0 + 0.20 * aus * (1 - stoss), 1.0,
                                     1.0 + 0.20 * aus * (1 - stoss))

    setz('arm_r', (VOR, -42.0 * aus), (QUER, -26.0 * aus), (HOCH, -12.0 * aus))
    setz('hand_r', (VOR, -14.0 * aus), (QUER, -10.0 * aus))
    setz_richtung('requisite', REQ_RUHE_RICHTUNG.slerp(STOSS_RICHTUNG, aus))
    schiebe('requisite', (0.0, 0.0, REQ_RUHE * (1.0 - aus)))
    schiebe('arm_r', STOSS_RICHTUNG * (STOSS_ARM * stoss + 0.014 * H * federn)
            - Vector((0.0, 0.04 * H, 0.0)) * aus)

    setz('arm_l', (VOR, -SENKEN + 10.0 * aus - 6.0 * stoss), (QUER, 16.0 * aus - 20.0 * stoss))
    setz('hand_l', (VOR, 0.25 * SENKEN), (QUER, 10.0 * aus - 8.0 * stoss))
    if M['schild']:
        # Der Schild kommt beim Ausholen hoch und deckt beim Stoss die
        # Flanke — er ist der Grund, warum der Krieger ueberhaupt einhaendig
        # stechen kann.
        setz('schild', (QUER, -20.0 * aus + 8.0 * stoss), (HOCH, 12.0 * aus))


# Der Schlag: Ausholen ueber die Schulter, dann ein Bogen nach vorn-unten.
# Die Zielrichtung ist die, in die der Schaft am Treffpunkt zeigt.
SCHLAG_AUSHOL = Vector((-0.10, +0.62, +0.78)).normalized()   # ueber der Schulter
SCHLAG_TREFFER = Vector((-0.16, -0.86, +0.48)).normalized()  # nach vorn-oben


def attack_schlag(p):
    aus = _rampe(p, 0.06, 0.34) * (1.0 - _rampe(p, 0.70, 1.00))
    schlag = _rampe(p, 0.34, 0.56) * (1.0 - _rampe(p, 0.72, 0.94))
    federn = (math.sin((p - 0.56) * math.tau * 2.6) * math.exp(-(p - 0.56) * 12.0)
              if 0.56 <= p < 0.90 else 0.0)

    # Becken: erst zurueck und in die Hocke, dann mit dem Schlag nach vorn.
    root = Vector((0.0, ZURUECK * aus - 0.9 * ZURUECK * schlag,
                   -HOCK * aus - 0.35 * HOCK * schlag))
    setz('wurzel', (HOCH, 11.0 * aus - 16.0 * schlag))
    schiebe('wurzel', root)
    _beine_ausfall(aus, schlag, root, gier=11.0 * aus - 16.0 * schlag)

    setz('bauch', (QUER, -10.0 * aus + 19.0 * schlag), (HOCH, 9.0 * aus - 13.0 * schlag),
         (VOR, -2.0 * aus))
    setz('brust', (QUER, -12.0 * aus + 20.0 * schlag),
         (HOCH, 15.0 * aus - 24.0 * schlag), (VOR, -4.0 * aus + 5.0 * schlag))
    setz('kopf', (QUER, 6.0 * aus + 4.0 * schlag + 2.0 * federn),
         (HOCH, -12.0 * aus + 16.0 * schlag))
    arm.pose.bones['kehle'].scale = (1.0 + 0.18 * aus * (1 - schlag), 1.0,
                                     1.0 + 0.18 * aus * (1 - schlag))

    # Der Arm reisst die Waffe ueber die Schulter und schlaegt sie nach
    # vorn. Die Waffenrichtung wird dabei in WELTkoordinaten gefuehrt und
    # nicht aus Armwinkeln zusammengesetzt — sonst haengt der Treffpunkt an
    # fuenf Gelenken und wandert bei jeder Aenderung an Rumpf oder Schulter.
    setz('arm_r', (VOR, -52.0 * aus + 74.0 * schlag), (QUER, -20.0 * aus + 34.0 * schlag),
         (HOCH, -8.0 * aus + 14.0 * schlag))
    setz('hand_r', (VOR, -18.0 * aus + 26.0 * schlag), (QUER, -8.0 * aus))
    ziel = REQ_RUHE_RICHTUNG.slerp(SCHLAG_AUSHOL, aus).slerp(SCHLAG_TREFFER, schlag)
    setz_richtung('requisite', ziel)
    schiebe('requisite', (0.0, 0.0, REQ_RUHE * (1.0 - aus) + 0.02 * H * federn))

    setz('arm_l', (VOR, -SENKEN + 12.0 * aus - 8.0 * schlag), (QUER, 20.0 * aus - 26.0 * schlag))
    setz('hand_l', (VOR, 0.25 * SENKEN), (QUER, 12.0 * aus - 10.0 * schlag))


aktion('idle', DAUER_IDLE, idle_pose)
aktion('walk', DAUER_WALK, walk_pose)
aktion('attack', DAUER_ATTACK,
       attack_stich if M['angriff'] == 'stich' else attack_schlag, schleife=False)

# ── Gegenprobe an der EVALUIERTEN Haut, nicht an den Knochen ────────
# Was der Spieler sieht, ist die Haut. Der tiefste Punkt je Bild
# entscheidet, ob das Rig taugt: alles unter 0 steckt im Gelaende.
szene.frame_set(1)
bpy.ops.object.mode_set(mode='OBJECT')


def probe(name):
    akt = bpy.data.actions[name]
    arm.animation_data.action = akt
    f0, f1 = int(akt.frame_range[0]), int(akt.frame_range[1])
    tiefst = []
    for f in range(f0, f1 + 1):
        szene.frame_set(f)
        dgl = bpy.context.evaluated_depsgraph_get()
        ev = mesh.evaluated_get(dgl)
        m = ev.to_mesh()
        tiefst.append(min((mesh.matrix_world @ v.co).z for v in m.vertices))
        ev.to_mesh_clear()
    print(f'PROBE {name}: tiefster Punkt {min(tiefst):+.4f} .. {max(tiefst):+.4f} '
          f'({min(tiefst) * SKALA * 100:+.1f} cm im Spiel), Bild 1 bei {tiefst[0]:+.5f}')


for _n in ('idle', 'walk', 'attack'):
    probe(_n)

szene.frame_set(1)
arm.animation_data.action = bpy.data.actions['idle']
szene.frame_set(1)

# ── Blickrichtung ───────────────────────────────────────────────────
# Gemessen, nicht beurteilt (Herleitung im Kopfkommentar): Alle fuenf
# blicken bereits nach -y, wie Voelva und Surtr nach ihrer Korrektur. Es
# bleibt trotzdem eine benannte Konstante mit ausformuliertem Zweig — beim
# naechsten Modell aus derselben Quelle ist die Frage sofort wieder da.
# Der Zweig steht unter demselben Wachposten wie das Anheben: Waere er
# gesetzt und liefe das Skript zweimal ueber dieselbe Datei, staende das
# Skelett quer in der Figur.
BLICK_DREHUNG = 0.0
if BLICK_DREHUNG and not schon_bearbeitet:
    for o in (arm, mesh):
        o.rotation_euler = (o.rotation_euler[0], o.rotation_euler[1],
                            o.rotation_euler[2] + BLICK_DREHUNG)
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
elif BLICK_DREHUNG:
    print('HINWEIS: Blickdrehung uebersprungen — die Datei wurde schon gedreht')
print(f'BLICK: Drehung um die Hochachse {math.degrees(BLICK_DREHUNG):+.1f} Grad '
      f'(Modell schaut bereits nach -y)')

# ── Export ──────────────────────────────────────────────────────────
# export_animation_mode='ACTIONS' schreibt JEDE Action als eigene
# glTF-Animation unter ihrem Action-Namen; export_frame_range muss dabei
# AUS sein, sonst schneidet der Szenenbereich der zuletzt gebackenen
# Aktion die anderen ab. Die Namen "idle", "walk" und "attack" sind
# zugleich die Werte, die der Server in den ZDO-Member `anim` schreibt —
# jede Abweichung heisst, dass der Client nicht umschaltet.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=ZIEL,
    export_format='GLB',
    use_selection=True,
    export_yup=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_frame_range=False,
    export_skins=True,
    export_materials='EXPORT',
    export_image_format='AUTO',
)
print(f'FERTIG {ZIEL} — {len(KN)} Knochen, Aktionen "idle", "walk" und '
      f'"attack", {os.path.getsize(ZIEL) / 1e6:.2f} MB; Koerperhoehe '
      f'{HOEHE * SKALA:.3f} m bei localScale {SKALA}')
