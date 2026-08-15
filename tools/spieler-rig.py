#!/usr/bin/env blender --background --python
"""
Riggt den nackten Basis-Wikinger — den Körper, auf dem die
Charaktererstellung und die Rüstungsteile aufsetzen — und legt ihm vier
Bewegungen an: "idle", "gehen", "rennen" und "angriff".

    blender --background --python tools/spieler-rig.py -- \
        --glb assets/models/WikingerBasis-roh.glb \
        --out assets/models/WikingerBasis.glb \
        [--hoehe 1.8] [--gehen 1.4] [--rennen 4.0]

QUELLE ist die Rohdatei aus tools/tripo-generate.mjs, nicht das eigene
Ergebnis: Das Skript backt zum Schluss die Blickdrehung ins Mesh. Ein
zweiter Lauf auf die eigene Ausgabe drehte sie ein zweites Mal; das
Skript bricht deshalb ab, wenn es die Datei schon einmal bearbeitet hat.

════════════════════════════════════════════════════════════════════
 1. Warum die Knochen HEISSEN, wie sie heissen
════════════════════════════════════════════════════════════════════
Die Knochennamen sind hier keine Geschmackssache, sondern eine
SCHNITTSTELLE. Zwei bestehende Stellen im Projekt greifen auf sie zu, und
beide über den Namen:

  client/src/player/AvatarRig.ts  sucht Hip, Spine01, Head, L_Thigh,
      L_Calf, R_Thigh, R_Calf, L_Upperarm, L_Forearm, R_Upperarm,
      R_Forearm — und R_Hand, an den es die Werkzeughand hängt.
  tools/mixamo-to-avatar.mjs      bildet 22 Mixamo-Knochen auf genau
      diese Namen ab und kann damit fertige Mixamo-Clips auf das Modell
      übertragen.

Das ist Tripos Auto-Rig-Namensschema, und `assets/models/PlayerAvatar.glb`
(41 Knochen) trägt es bereits. Ein handgebautes Rig mit eigenen Namen —
wie bei Völva, Surtr und Furloc — wäre für den SPIELER die falsche
Entscheidung: AvatarRig.ts fände keinen einzigen Knochen, die Figur bliebe
in der Bindepose stehen, und sämtliche Mixamo-Clips wären verloren.

Übernommen werden deshalb die 24 Knochen des Kernskeletts. Die 17
Twist-Knochen des Tripo-Rigs (L_ForearmTwist01 …) fallen weg: Sie
verteilen die Verdrehung von Unterarm und Oberschenkel auf mehrere
Segmente, und dafür bräuchte es Constraints, die der glTF-Export ohnehin
nicht mitnimmt. Niemand liest sie.

════════════════════════════════════════════════════════════════════
 2. Warum die Gewichte gerechnet und nicht geheizt werden
════════════════════════════════════════════════════════════════════
Dieselbe Lektion wie in voelva-rig.py, surtr-rig.py und furloc-rig.py,
hier noch einmal nachgemessen: Das Mesh zerfällt in TAUSENDE
Zusammenhangskomponenten (der Generator macht an jeder UV-Naht auf).
Blenders "Automatic Weights" (Bone Heat) braucht eine zusammenhängende
Fläche und rät sonst je Insel; genau dort klafft das Modell dann auf.

Die Gewichte sind deshalb eine STETIGE FUNKTION DER POSITION. Stetig im
Ort heisst: Die an den Nähten verdoppelten Vertices liegen exakt
aufeinander und bekommen identische Gewichte — die Inseln können
prinzipbedingt nicht auseinanderklaffen.

════════════════════════════════════════════════════════════════════
 3. Warum die Knochenpunkte nicht im Skript stehen
════════════════════════════════════════════════════════════════════
Die drei Vorgängerrigs tragen ihre Knochenpunkte als handgemessene
Tabelle. Für eine Figur, die genau einmal entsteht, ist das richtig.

Vom Spielerkörper wird es MEHRERE geben — Mann, Frau, schmal, breit —,
weil die Charaktererstellung sie austauschen soll. Eine Tabelle je Körper
hiesse, für jeden neuen Körper wieder einen halben Tag zu messen; und
sobald jemand das Modell neu generiert, sind alle Zahlen still falsch.
Deshalb misst `tools/spieler-vermessen.py` die Landmarken, und dieses
Skript baut sein Skelett daraus. Dort steht auch, was gemessen und was
aus anthropometrischer Proportion gesetzt wird und warum.

════════════════════════════════════════════════════════════════════
 4. Warum "gehen" und "rennen" eine Wurzelbewegung tragen
════════════════════════════════════════════════════════════════════
Normalerweise wären Laufzyklen ORTSFEST: Der Server schiebt die Figur,
der Zyklus tritt nur auf der Stelle (so machen es Surtr und der Furloc).

Beim Spieler nicht. AvatarRig.messeUndEntferneWurzelbewegung() misst die
im Clip steckende Wegstrecke, ENTFERNT sie und nimmt sie als Bezugstempo
für `speedRatio` — daran hängt, dass die Füsse bei 4,5 statt 1,5 m/s
nicht über den Boden rutschen. Ein Clip mit weniger als 0,2
Modelleinheiten Weg gilt dort als STANDPOSE (`weite < 0.2 → continue`,
danach `wandernd = clips.filter(c => c.tempo > 0.1)`). Ein ortsfester
Gehzyklus landete also im Topf der Ruheposen, und die Figur stünde
still, während sie läuft.

Die Wegstrecke steckt deshalb im Hip-Knochen. Für die Kinematik ändert
das nichts: Der Standfuss steht im Clip still und die Hüfte fährt über
ihn hinweg — statt dass die Hüfte steht und der Fuss nach hinten läuft.
Beides ist derselbe Gang, nur aus einem anderen Bezugssystem gesehen.

ACHTUNG für die NPC-Verwendung: Über EntityManager gespawnt (dynamischer
Pfad, AssetManager.wechsleAnimation) wird die Wurzelbewegung NICHT
entfernt — die Figur liefe dann pro Zyklus aus ihrer eigenen Position
heraus und spränge zurück. Als NPC-Prefab gehört deshalb `animation:
'idle'` gesetzt und keine Route; wer diesen Körper als laufenden NPC
braucht, exportiert eine zweite Datei mit `--ortsfest`.

════════════════════════════════════════════════════════════════════
 5. Der Laufzyklus ist rückwärts gerechnet
════════════════════════════════════════════════════════════════════
Übernommen aus tools/surtr-rig.py und tools/furloc-rig.py, wo das
Verfahren entstanden ist: Nicht Winkel setzen und hoffen, sondern die
Bahn der SOHLE vorgeben (flach am Boden, weltfest) und die Gelenkwinkel
per Zweigelenk-Umkehrkinematik dazu auflösen. Fussrutschen ist damit
nicht "klein", sondern konstruktionsbedingt null.

Vier Gelenke je Bein (Hüfte, Knie, Knöchel, Zehengrundgelenk) sind dafür
die Untergrenze — mit zweien kann die Sohle beim Abrollen nicht flach
bleiben (nachgemessen an Surtrs erstem Gang: 15 cm Bodendurchdringung).
"""

import importlib.util
import math
import os
import sys

import bpy
from mathutils import Vector, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


def flag(name):
    return name in argv


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def pfad(p):
    return p if os.path.isabs(p) else os.path.join(ROOT, p)


GLB = arg('--glb')
OUT = arg('--out')
ZIELHOEHE = float(arg('--hoehe', '1.8'))     # Spielergrösse in Metern
TEMPO_GEHEN = float(arg('--gehen', '1.4'))   # m/s, in "gehen" eingebacken
TEMPO_RENNEN = float(arg('--rennen', '4.0'))  # m/s, in "rennen" eingebacken
DAUER_IDLE = float(arg('--idle-dauer', '6.0'))
DAUER_GEHEN = float(arg('--gehen-dauer', '0.95'))
DAUER_RENNEN = float(arg('--rennen-dauer', '0.72'))
DAUER_ANGRIFF = float(arg('--angriff-dauer', '1.4'))
ORTSFEST = flag('--ortsfest')                # Wurzelbewegung weglassen
FPS = 30
if not GLB:
    raise SystemExit('--glb fehlt')
PFAD = pfad(GLB)
ZIEL = PFAD if not OUT else pfad(OUT)

# ── Das Messwerkzeug als Modul laden ────────────────────────────────
# Ein Import über den Dateinamen, weil `tools/` kein Paket ist und der
# Bindestrich im Namen einen normalen Import ohnehin verböte.
_spec = importlib.util.spec_from_file_location(
    'spieler_vermessen', os.path.join(ROOT, 'tools', 'spieler-vermessen.py'))
vermessen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vermessen)


def glatt(u):
    """smoothstep 0..1"""
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


def abstand_segment(p, a, b):
    ab = b - a
    l2 = ab.length_squared
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, (p - a).dot(ab) / l2))
    return (p - (a + ab * t)).length


# ════════════════════════════════════════════════════════════════════
# Modell laden und in den Arbeitsraum drehen
# ════════════════════════════════════════════════════════════════════
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=PFAD)

meshes = [o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.vertices)]
if not meshes:
    raise SystemExit('keine Mesh-Geometrie gefunden')
mesh = max(meshes, key=lambda o: len(o.data.vertices))

if any(o.type == 'ARMATURE' and o.name.startswith('spieler_rig')
       for o in bpy.data.objects):
    raise SystemExit(
        f'{PFAD} trägt bereits ein spieler_rig und ist damit auf die\n'
        'Engine-Blickrichtung gedreht. Dieses Skript braucht das UNGEDREHTE\n'
        'Rohmodell aus tools/tripo-generate.mjs.')

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


def anwenden(mesh, rot_z=0.0, versatz_z=0.0):
    """Dreht/verschiebt das Mesh und backt es in die Vertexdaten."""
    mesh.rotation_euler[2] += rot_z
    mesh.location.z += versatz_z
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
    mesh.select_set(False)


# ── Erste Messung: nur, um den Arbeitsraum herzustellen ─────────────
# Der ganze Rest dieses Skripts — Knochentabelle, Laufzyklus,
# Umkehrkinematik — rechnet in EINEM festen Raum: Blick nach +X, linke
# Körperseite +Y, Sohle auf z = 0. Das ist derselbe Raum, in dem Surtr
# gerigt wurde, und die dort erprobte Gehmechanik wird unverändert
# übernommen.
#
# Ein generiertes Modell liegt aber beliebig herum. Statt jede Formel mit
# Achsenfallunterscheidungen zu durchsetzen, wird das MESH einmal gedreht
# und danach neu vermessen. Das kostet eine zweite Abtastung (rund zehn
# Sekunden) und spart eine Fehlerquelle, die man sonst in jeder zweiten
# Zeile wieder hätte.
vor = vermessen.vermesse(mesh)
_b, _t, _v = vor['achse_breit'], vor['achse_tief'], vor['blick_tief']
# Wie viele Vierteldrehungen um die Hochachse bringen "vorn" auf +X?
#   tief=x, vorn=+x → 0    tief=x, vorn=-x → 180
#   tief=y, vorn=+y → -90  tief=y, vorn=-y → +90
if _t == 'x':
    schritte = 0 if _v > 0 else 2
else:
    schritte = 3 if _v > 0 else 1
print(f'AUSRICHTUNG: gemessen breit={_b} tief={_t} vorn={"+" if _v > 0 else "-"}{_t}'
      f' → Drehung um {schritte * 90} Grad auf den Arbeitsraum (+X)')
if schritte:
    anwenden(mesh, rot_z=math.radians(90.0 * schritte))

M = vermessen.vermesse(mesh)
assert M['achse_tief'] == 'x' and M['blick_tief'] > 0, 'Ausrichtung misslungen'

# Sohle auf z = 0. Der Prefab-Ursprung IST im Spiel die Geländehöhe —
# liegt die Sohle darüber, schwebt die Figur um genau diese Strecke mal
# localScale.
if abs(M['zmin']) > 1e-4:
    anwenden(mesh, versatz_z=-M['zmin'])
    M = vermessen.vermesse(mesh)

welt = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
H = M['hoehe']
SKALA = ZIELHOEHE / H                       # PrefabDef.localScale
X0, Y0 = M['achse']['x'], M['achse']['y']   # Körperachse

print(f'MODELL {mesh.name}: {len(welt)} Vertices, '
      f'{sum(len(p.vertices) - 2 for p in mesh.data.polygons)} Dreiecke, '
      f'Höhe {H:.4f} → localScale {SKALA:.4f} für {ZIELHOEHE:.2f} m')
vermessen.bericht(M)

# ── Welche gemessene Seite ist links, welche rechts? ────────────────
# Die Figur schaut nach +X, oben ist +Z. Ihre LINKE Seite ist damit +Y
# (Rechte-Hand-Regel: oben × vorn = +z × +x = +y). Dieselbe Konvention
# steht im Kopf von tools/surtr-rig.py.
SEITE = {'L': 'pos', 'R': 'neg'}


def bein(s):
    return M['beine'][SEITE[s]]


def arm(s):
    a = M['arme'][SEITE[s]]
    if a is None:
        raise SystemExit(
            f'Arm {s} nicht gefunden. Das Modell muss die Arme so halten, dass\n'
            'sie über die halbe Höhe FREI neben dem Rumpf stehen (A-Pose).\n'
            'Bei anliegenden Armen gibt es keinen Querschnitt, an dem sich\n'
            'Arm und Rumpf trennen lassen.')
    return a


# ════════════════════════════════════════════════════════════════════
# Das Skelett
# ════════════════════════════════════════════════════════════════════
# (Name, Kopf, Spitze, Eltern, verbunden, Reichweite, Stärke)
#
# Reichweite = Radius, ab dem der Knochen keinen Vertex mehr zieht;
# Stärke    = wie stark er sich innerhalb davon gegen die Nachbarn
#             durchsetzt.
#
# Beide sind ANTEILE DER KÖRPERHÖHE, nicht absolute Zahlen — sonst wären
# sie beim nächsten Körper wieder falsch. Die Reichweiten sind grosszügig
# bemessen: Teuer ist das nicht (der Kern fällt mit (1-u)^3 ab, jenseits
# der halben Reichweite trägt ein Knochen unter zwei Prozent), aber ein zu
# knapper Radius lässt Vertices ohne Knochen zurück, und die fallen dann
# auf den Notnagel "nächster Knochen" — eine harte Kante mitten in der
# Haut.
HUEFTE_Z = M['hueftgelenk_z']
TAILLE_Z = M['taille_z']
SCHULTER_Z = M['schulter_z']
HALS_Z = M['hals_z']
SCHEITEL_Z = M['zmax']
BRUST_Z = (TAILLE_Z + SCHULTER_Z) / 2

# Sohlenlänge — Bezugsmass für die Zehenspitze.
_fl = bein('R')['fuss_tief']


def zehenspitze(s):
    """Vorderster Punkt der Sohle dieses Fusses."""
    d = bein(s)
    return (d['fuss_tief'][1], d['achse_breit'], d['sohle_z'] + H * 0.004)


KNOCHEN = []


def kn(name, kopf, spitze, eltern, verbunden, reichweite, staerke):
    KNOCHEN.append((name, Vector(kopf), Vector(spitze), eltern, verbunden,
                    reichweite * H, staerke))


# ── Wirbelsäule ─────────────────────────────────────────────────────
# `Root` steht auf dem Boden und trägt kein Gewicht. Er ist der Knochen,
# an dem AvatarRig.messeUndEntferneWurzelbewegung() ebenso sucht wie an
# Hip und Pelvis, und er hält das Skelett zusammen, wenn die Hüfte
# animiert wird.
kn('Root', (X0, Y0, 0.0), (X0, Y0, HUEFTE_Z), None, False, 0.0, 0.0)
kn('Hip', (X0, Y0, HUEFTE_Z), (X0, Y0, HUEFTE_Z + H * 0.04), 'Root', False, 0.19, 1.0)
# `Pelvis` zeigt NACH UNTEN und trägt die Oberschenkel. Damit hat das
# Becken einen eigenen Körper: Ohne ihn hinge das Lendentuch allein an
# Hip, und die Oberschenkel zögen ihre Hälfte davon beim Schreiten
# auseinander.
kn('Pelvis', (X0, Y0, HUEFTE_Z), (X0, Y0, HUEFTE_Z - H * 0.06), 'Hip', False, 0.13, 0.9)
kn('Waist', (X0, Y0, HUEFTE_Z + H * 0.04), (X0, Y0, TAILLE_Z), 'Hip', True, 0.17, 1.0)
kn('Spine01', (X0, Y0, TAILLE_Z), (X0, Y0, BRUST_Z), 'Waist', True, 0.18, 1.0)
kn('Spine02', (X0, Y0, BRUST_Z), (X0, Y0, SCHULTER_Z), 'Spine01', True, 0.19, 1.0)
kn('NeckTwist01', (X0, Y0, SCHULTER_Z), (X0, Y0, HALS_Z), 'Spine02', True, 0.07, 1.3)
kn('Head', (X0, Y0, HALS_Z), (X0, Y0, SCHEITEL_Z), 'NeckTwist01', True, 0.15, 1.5)

# ── Arme ────────────────────────────────────────────────────────────
# Die Reichweiten sind hier ENG und die Stärken hoch. Grund: In der
# A-Pose hängt die Hand rund eine Handbreit neben dem Oberschenkel, und
# Arm und gleichseitiges Bein schwingen GEGENLÄUFIG. Wo zwei Knochen
# gegenläufig drehen, entscheidet allein die Breite des Übergangs
# darüber, ob die Haut schert — und zwischen Hand und Schenkel ist für
# einen breiten Übergang kein Platz. Die Hand muss sich deshalb klar
# durchsetzen.
for s in ('L', 'R'):
    a = arm(s)
    # Die Messung liefert (breit, tief, z) — im Arbeitsraum also (y, x, z).
    def p(q):
        return (q[1], q[0], q[2])
    gelenk, ellbogen, handgelenk, spitze = (p(a['gelenk']), p(a['ellbogen']),
                                            p(a['handgelenk']), p(a['spitze']))
    # Schlüsselbein: von der Wirbelsäule zum Schultergelenk. Es ist der
    # Knochen, an dem später Schulterpanzer hängen, und es hält die
    # Schulterkappe beim Armschwung an ihrem Platz.
    kn(f'{s}_Clavicle', (X0, Y0 + (gelenk[1] - Y0) * 0.22, SCHULTER_Z), gelenk,
       'Spine02', False, 0.10, 1.0)
    kn(f'{s}_Upperarm', gelenk, ellbogen, f'{s}_Clavicle', True, 0.075, 1.7)
    kn(f'{s}_Forearm', ellbogen, handgelenk, f'{s}_Upperarm', True, 0.065, 1.9)
    kn(f'{s}_Hand', handgelenk, spitze, f'{s}_Forearm', True, 0.058, 2.3)

# ── Beine: VIER Gelenke je Seite ────────────────────────────────────
# Hüfte → Knie → Knöchel → Zehengrundgelenk → Spitze.
#
# Das Zehengelenk ist kein Zierrat: Beim Abstossen richtet sich der Fuss
# um bis zu 20 Grad über den Ballen auf, während die Zehen flach liegen
# bleiben. Ohne dieses Gelenk bohrt sich die Spitze in den Boden
# (nachgemessen an Surtrs erstem Gang: 15 cm im Spielmassstab).
#
# Der Ballen sitzt dicht ÜBER der Sohle, nicht in der Fussmitte: Beim
# Abstoss knicken Fuss und Zeh dort gegeneinander, und die lineare
# Hautmischung zieht die Stelle umso tiefer nach innen, je weiter das
# Gelenk vom Boden weg liegt. Anatomisch ist das Grundgelenk ebenfalls
# sohlennah.
for s in ('L', 'R'):
    d = bein(s)
    yb = d['achse_breit']
    kn(f'{s}_Thigh', (X0, yb, HUEFTE_Z), (d['achse_tief'], yb, d['knie_z']),
       'Pelvis', False, 0.105, 1.2)
    kn(f'{s}_Calf', (d['achse_tief'], yb, d['knie_z']),
       (d['knoechel_tief'], yb, d['knoechel_z']), f'{s}_Thigh', True, 0.082, 1.3)
    kn(f'{s}_Foot', (d['knoechel_tief'], yb, d['knoechel_z']),
       (d['ballen_tief'], yb, d['sohle_z'] + H * 0.018), f'{s}_Calf', True, 0.080, 1.9)
    kn(f'{s}_ToeBase', (d['ballen_tief'], yb, d['sohle_z'] + H * 0.018),
       zehenspitze(s), f'{s}_Foot', True, 0.065, 2.8)

NAMEN = [k[0] for k in KNOCHEN]

# ── Armature bauen ──────────────────────────────────────────────────
arm_data = bpy.data.armatures.new('spieler_rig')
armobj = bpy.data.objects.new('spieler_rig', arm_data)
bpy.context.collection.objects.link(armobj)
bpy.context.view_layer.objects.active = armobj
bpy.ops.object.mode_set(mode='EDIT')
for name, kopf, spitze, eltern, verbunden, _r, _s in KNOCHEN:
    b = arm_data.edit_bones.new(name)
    b.head = kopf
    b.tail = spitze
    if eltern:
        b.parent = arm_data.edit_bones[eltern]
        b.use_connect = bool(verbunden)
bpy.ops.object.mode_set(mode='OBJECT')

SEGMENTE = {n: (k, s) for n, k, s, *_ in KNOCHEN}
REICHWEITE = {n: r for n, _k, _s, _e, _v, r, _st in KNOCHEN}
EINFLUSS = {n: st for n, _k, _s, _e, _v, _r, st in KNOCHEN}

# ── Wo ein Knochen WIEGT, ist nicht, wo er DREHT ────────────────────
# Der Fussknochen läuft vom Knöchel zum Ballen — nach VORN. Die Ferse
# steht dahinter, und über ihr liegt damit gar kein Knochen: Sie ist von
# Fuss und Schienbein gleich weit entfernt und bekäme von beiden je rund
# die Hälfte. Beim Fersenauftritt stehen die beiden aber über zehn Grad
# auseinander, und die lineare Mischung zweier so verschiedener Drehungen
# zieht die Hacke nach INNEN — unter das Gelände.
#
# Der Fuss wiegt deshalb längs seiner SOHLE, von der Ferse bis zum
# Ballen. Gedreht wird weiterhin im Knöchel; nur die Abstandsfunktion
# sieht ein anderes Segment.
for s in ('L', 'R'):
    d = bein(s)
    SEGMENTE[f'{s}_Foot'] = (
        Vector((d['fuss_tief'][0], d['achse_breit'], d['sohle_z'] + H * 0.02)),
        Vector((d['ballen_tief'], d['achse_breit'], d['sohle_z'] + H * 0.018)))

# y-Band, in dem die Sohle eines Fusses liegt — Trennlinie ist die
# Körperachse.
YBAND = {s: ((Y0, bein(s)['fuss_breit'][1] + H * 0.05) if s == 'L'
             else (bein(s)['fuss_breit'][0] - H * 0.05, Y0))
         for s in ('L', 'R')}

# ════════════════════════════════════════════════════════════════════
# Gewichte
# ════════════════════════════════════════════════════════════════════
GEWICHTET = [n for n in NAMEN if EINFLUSS[n] > 0.0]
gruppen = {n: mesh.vertex_groups.new(name=n) for n in NAMEN}


def huelle(p):
    """Kompakter Kern um jedes Knochensegment, auf Summe 1 normiert."""
    roh = []
    for n in GEWICHTET:
        d = abstand_segment(p, *SEGMENTE[n])
        u = d / REICHWEITE[n]
        if u >= 1.0:
            continue
        # Fällt am Rand der Reichweite stetig auf 0 und ist nah am
        # Knochen stark. (1-u)^3 sorgt für den sauberen Nullabschluss.
        roh.append((n, EINFLUSS[n] * (1.0 - u) ** 3 / (u * u + 0.02)))
    if not roh:
        n = min(GEWICHTET, key=lambda k: abstand_segment(p, *SEGMENTE[k]))
        roh = [(n, 1.0)]
    s = sum(w for _n, w in roh)
    return {n: w / s for n, w in roh}


# ── Das Lendentuch ──────────────────────────────────────────────────
# Zwischen Hüftgelenk (0,53 H) und dem sichtbaren Beinspalt (0,36 H) ist
# der Körper EINE Säule: Das Tuch schliesst die Lücke zwischen den
# Schenkeln. Die reine Abstandshülle teilt diese Säule an y = 0 in zwei
# Hälften — und weil beide Beine gegenläufig schwingen, schert das Tuch
# genau dort im Takt auf.
#
# Der Übergang wird deshalb nach UNTEN hin BREITER aufgezogen (dasselbe
# Mittel wie im Rock der Völva, tools/voelva-rig.py): Oben, dicht unter
# der Hüfte, sind die Schenkel wirklich zwei Körper und dürfen sich
# scharf trennen. Am Saum liegt Stoff, der über beiden hängt; dort
# verteilt sich dieselbe Winkeldifferenz über die ganze Tuchbreite,
# statt sie auf eine Naht zu pressen.
#
# Ausdrücklich NICHT Surtrs Lösung (Lendenplatte starr an der Wurzel):
# Die hat dort funktioniert, weil zwischen Platte und Schenkel eine echte
# Lücke von 0,043 klaffte. Hier gibt es keine Lücke — ein starres Tuch
# stünde als Glocke, und der Schenkel liefe beim Schreiten hindurch.
TUCH_OBEN = HUEFTE_Z + H * 0.02
TUCH_UNTEN = M['schritt_z']
TUCH_BREIT_OBEN = H * 0.03      # Breite der Links-Rechts-Blende oben ...
TUCH_BREIT_UNTEN = H * 0.16     # ... und am Saum


def tuch_mischung(p):
    """Anteil, zu dem dieser Punkt der weichen Tuchaufteilung folgt.

    1 im Saumbereich, 0 oberhalb der Hüfte und unterhalb des Beinspalts.
    """
    if p.z > TUCH_OBEN or p.z < TUCH_UNTEN - H * 0.04:
        return 0.0
    oben = 1.0 - glatt((p.z - (TUCH_OBEN - H * 0.06)) / (H * 0.06))
    unten = glatt((p.z - (TUCH_UNTEN - H * 0.04)) / (H * 0.04))
    return oben * unten


def tuch_gewichte(p):
    """Links/rechts weich geblendete Beingewichte im Tuchbereich."""
    t = (p.z - TUCH_UNTEN) / max(1e-6, TUCH_OBEN - TUCH_UNTEN)
    breite = TUCH_BREIT_UNTEN + (TUCH_BREIT_OBEN - TUCH_BREIT_UNTEN) * glatt(t)
    lam = glatt((p.y - (Y0 - breite / 2)) / breite)     # 1 = linke Seite
    # Senkrecht zwischen Becken (oben) und Oberschenkel (unten): Der
    # Bund des Tuchs sitzt auf dem Becken, der Saum hängt am Schenkel.
    ab = glatt((p.z - TUCH_UNTEN) / max(1e-6, TUCH_OBEN - TUCH_UNTEN))
    return {'Pelvis': ab * 0.55,
            'L_Thigh': (1.0 - ab * 0.55) * lam,
            'R_Thigh': (1.0 - ab * 0.55) * (1.0 - lam)}


tuch_voll = tuch_rand = notnagel = 0
for i, p in enumerate(welt):
    w = huelle(p)
    m = tuch_mischung(p)
    if m > 0.001:
        tuch_rand += 1
        if m > 0.75:
            tuch_voll += 1
        tw = tuch_gewichte(p)
        w = {n: (1.0 - m) * w.get(n, 0.0) + m * tw.get(n, 0.0)
             for n in set(w) | set(tw)}
    # glTF hält nur 4 Joints je Vertex — die schwächsten fallen weg, der
    # Rest wird nachnormiert.
    roh = sorted(((n, x) for n, x in w.items() if x > 1e-4), key=lambda q: -q[1])[:4]
    summe = sum(x for _n, x in roh)
    for n, x in roh:
        gruppen[n].add([i], x / summe, 'REPLACE')

print(f'GEWICHTE: {tuch_voll} Vertices voll in der Tuchmischung, '
      f'{tuch_rand - tuch_voll} im Übergangsrand')

mod = mesh.modifiers.new('Armature', 'ARMATURE')
mod.object = armobj
mesh.parent = armobj

# ════════════════════════════════════════════════════════════════════
# Posieren: Drehungen um WELTACHSEN
# ════════════════════════════════════════════════════════════════════
# bone.matrix_local bildet Knochenraum → Armature-Raum ab; die Armature
# steht auf dem Ursprung, Armature-Raum ist also Weltraum. Damit lässt
# sich eine Weltachse sauber in den lokalen Raum eines Knochens holen —
# ohne Raterei über Bone-Rolls.
HOCH = Vector((0, 0, 1))    # Gierachse (umsehen, Schultern gegen Hüfte)
QUER = Vector((0, 1, 0))    # Seitenachse: Vor-/Zurückschwingen.
#                             +Grad = nach HINTEN (Rechte-Hand-Regel um
#                             +y zieht -z nach -x, und die Figur schaut +x)
VOR = Vector((1, 0, 0))     # Blickachse: seitliches Wiegen, +Grad = nach rechts


def q(pb, achse, grad):
    m = pb.bone.matrix_local.to_3x3()
    a = (m.inverted() @ achse)
    if a.length < 1e-9:
        return Quaternion()
    return Quaternion(a.normalized(), math.radians(grad))


def versatz(pb, vek):
    return pb.bone.matrix_local.to_3x3().inverted() @ vek


bpy.context.view_layer.objects.active = armobj
bpy.ops.object.mode_set(mode='POSE')
for pb in armobj.pose.bones:
    pb.rotation_mode = 'QUATERNION'

szene = bpy.context.scene
szene.render.fps = FPS


def setz(name, *drehungen):
    pb = armobj.pose.bones[name]
    ges = Quaternion()
    for achse, grad in drehungen:
        ges = ges @ q(pb, achse, grad)
    pb.rotation_quaternion = ges


def setz_roh(name, grad):
    """Dreht um QUER. Für die Beinwinkel des Laufzyklus.

    Die sind keine Geschmackswerte, sondern die Lösung einer Gleichung:
    Sie halten die Sohle auf z = 0 und den Standfuss weltfest.
    """
    pb = armobj.pose.bones[name]
    pb.rotation_quaternion = q(pb, QUER, grad)


# ════════════════════════════════════════════════════════════════════
# Rechnen in der Gehebene
# ════════════════════════════════════════════════════════════════════
# Alle Beindrehungen laufen um dieselbe WELTACHSE +y (QUER). Dadurch
# addieren sich die Winkel entlang der Kette einfach auf: Der Weltwinkel
# des Unterschenkels ist der des Oberschenkels plus dessen eigener. Das
# macht die ganze Beinkette in der x-z-Ebene rechenbar, ohne dass Blender
# eine IK-Kette braucht (die der glTF-Export ohnehin nicht mitnähme).
#
# Winkelkonvention wie bei QUER: phi ist die Drehung aus der Senkrechten,
# +phi = nach HINTEN. Ein Einheitsvektor dieser Richtung ist deshalb
# (-sin phi, -cos phi) in (x, z).
def eben(v):
    return (v[0], v[2])


def winkel(x, z):
    return math.atan2(-x, -z)


def dreh(x, z, w):
    c, s = math.cos(w), math.sin(w)
    return (x * c + z * s, -x * s + z * c)


def sohlenhuelle(band, kx, kz):
    """Untere konvexe Hülle eines Fussprofils, relativ zum Knöchel.

    ── Warum die konvexe Hülle und nicht die tiefsten Punkte ─────────
    Nicht jeder tiefe Vertex ist ein Auftrittspunkt. Die Sohle wölbt
    sich an Ferse und Spitze nach oben; ein Punkt, der über der
    Verbindungslinie zweier anderer liegt, kommt beim Kippen nie zuerst
    auf. Genau die Punkte, die aufkommen KÖNNEN, sind die untere
    konvexe Hülle des Fussprofils — und nur sie bestimmen, wie hoch der
    Knöchel stehen muss.

    Monotone Kette nach Andrew: nach x sortieren und alles verwerfen,
    was keine Linksdrehung ergibt.
    """
    ylo, yhi = band
    grenze = H * 0.06
    pkt = sorted({(round(v.x, 4), round(v.z, 4))
                  for v in welt if v.z < grenze and ylo <= v.y <= yhi})
    hu = []
    for p in pkt:
        while len(hu) >= 2:
            (ax, az), (bx, bz) = hu[-2], hu[-1]
            if (bx - ax) * (p[1] - az) - (bz - az) * (p[0] - ax) < 0:
                hu.pop()
            else:
                break
        hu.append(p)
    return [(x - kx, z - kz) for x, z in hu]


def huellen_z(hu, x):
    for (ax, az), (bx, bz) in zip(hu, hu[1:]):
        if ax <= x <= bx:
            t = (x - ax) / (bx - ax) if bx > ax else 0.0
            return az + (bz - az) * t
    return hu[0][1] if x < hu[0][0] else hu[-1][1]


class Gangwerk:
    """Ein Bein als Kette Hüfte–Knie–Knöchel–Zeh, in der Gehebene.

    Kennt seine Ruhewinkel und -längen und rechnet daraus, welche
    Gelenkdrehungen den Knöchel an einen gewünschten Punkt und die Sohle
    in eine gewünschte Neigung bringen.
    """

    def __init__(self, s, takt):
        self.s = s
        self.takt = takt
        d = bein(s)
        p = {n: (k, sp) for n, k, sp, *_ in KNOCHEN}
        self.huefte = eben(p[f'{s}_Thigh'][0])
        d1 = p[f'{s}_Thigh'][1] - p[f'{s}_Thigh'][0]
        d2 = p[f'{s}_Calf'][1] - p[f'{s}_Calf'][0]
        self.l1 = Vector(eben(d1)).length
        self.l2 = Vector(eben(d2)).length
        self.phi1 = winkel(*eben(d1))
        self.phi2 = winkel(*eben(d2))
        kx, kz = eben(p[f'{s}_Foot'][0])
        self.huelle = sohlenhuelle(YBAND[s], kx, kz)
        self.ferse = self.huelle[0]
        self.spitze = self.huelle[-1]
        # Der Ballen ist der gemessene Knick im Fussrücken. Er ist KEIN
        # Eckpunkt der Hülle — eine gewölbte Sohle hat dort keine Kante —,
        # also wird seine Höhe auf der Hülle interpoliert. Nur so liegt
        # der Drehpunkt beim Abstoss wirklich auf der Sohle.
        bx = d['ballen_tief'] - kx
        self.ballen = (bx, huellen_z(self.huelle, bx))
        self.reichweite = self.l1 + self.l2
        self.stand = self._standbahn()

    def neigungen(self, s):
        """Sohlen- und Zehenwinkel in der Standphase (s läuft 0..1).

        Fersenauftritt, flache Sohle, Abstoss über den Ballen. Beim
        Abstoss bleibt der ZEHENWINKEL bei null: Die Zehen liegen flach,
        während der Fuss sich über sie aufrichtet. Genau dafür gibt es
        das Zehengelenk.
        """
        t = self.takt
        if s < t['roll_ferse']:
            sig = math.radians(t['neig_auf']) * (1.0 - glatt(s / t['roll_ferse']))
            return sig, sig
        if s < t['roll_ballen']:
            return 0.0, 0.0
        u = (s - t['roll_ballen']) / (1.0 - t['roll_ballen'])
        return math.radians(t['neig_ab']) * glatt(u), 0.0

    def sohle_z(self, sigma, tau):
        """Tiefster Sohlenpunkt relativ zum Knöchel.

        Alles hinter dem Ballen hängt am Fussknochen, alles davor am
        Zeh — und der dreht beim Abstoss GEGEN den Fuss. Wer die Zehen
        mit sigma statt mit tau dreht, misst einen Boden, den es nicht
        gibt.
        """
        b = dreh(*self.ballen, sigma)
        tief = 1.0
        for p in self.huelle:
            if p[0] <= self.ballen[0]:
                tief = min(tief, dreh(*p, sigma)[1])
            else:
                d = dreh(p[0] - self.ballen[0], p[1] - self.ballen[1], tau)
                tief = min(tief, b[1] + d[1])
        return tief

    def _standbahn(self):
        """Die Standphase, aus der ABROLLBEDINGUNG integriert.

        Statt einen Drehpunkt festzulegen und zu hoffen, dass er auf dem
        Boden liegt, wird gerechnet, was Abrollen physikalisch heisst:
        Der momentane Berührpunkt steht STILL. Für einen Körper, der um
        die Achse +y dreht, folgt daraus unmittelbar

            d(Knöchel_x) = d(Zehwinkel) * Ballenhöhe
                         + d(Sohlenwinkel) * (Knöchelhöhe - Ballenhöhe)

        Dazu kommt der Vorschub. Was hier herauskommt, KANN nicht
        rutschen, gleich wie die Sohle geformt ist.
        """
        t = self.takt
        n = 240
        bahn = [(0.0, 0.0)] * (n + 1)
        x = 0.0
        sig, ta = self.neigungen(0.0)
        z = -self.sohle_z(sig, ta)
        bahn[0] = (x, z)
        for i in range(1, n + 1):
            s = i / n
            sig2, ta2 = self.neigungen(s)
            z2 = -self.sohle_z(sig2, ta2)
            zb = (z + dreh(*self.ballen, sig)[1] + z2 + dreh(*self.ballen, sig2)[1]) / 2
            zk = (z + z2) / 2
            x += (ta2 - ta) * zb + (sig2 - sig) * (zk - zb) - t['weg'] * t['stand'] / n
            bahn[i] = (x, z2)
            sig, ta, z = sig2, ta2, z2
        # Den Standweg mittig unter die Hüfte schieben, sonst schleppt
        # das Bein hinterher.
        mitte = (min(p[0] for p in bahn) + max(p[0] for p in bahn)) / 2
        return [(p[0] - mitte, p[1]) for p in bahn]

    def bahn(self, u):
        """(x, z, sigma, tau) des Knöchels zur Zyklusphase u (0..1).

        u = 0 ist der Fersenauftritt. Die Standphase kommt fertig aus
        `_standbahn`; hier bleibt die Schwungphase, die den Fuss nur
        wieder nach vorn bringen und ihm dabei Luft lassen muss.
        """
        t = self.takt
        if u < t['stand']:
            w = u / t['stand'] * (len(self.stand) - 1)
            i = min(len(self.stand) - 2, int(w))
            f = w - i
            x = self.stand[i][0] + (self.stand[i + 1][0] - self.stand[i][0]) * f
            z = self.stand[i][1] + (self.stand[i + 1][1] - self.stand[i][1]) * f
            sigma, tau = self.neigungen(u / t['stand'])
            return x, z + BODENSPIEL[self.s], sigma, tau

        s = (u - t['stand']) / (1.0 - t['stand'])
        # 15 % linear beigemischt: Eine reine Smoothstep-Rampe steht an
        # beiden Enden still, während der Standfuss mit voller Fahrt
        # läuft — das liest sich als Stocken.
        x = self.stand[-1][0] + (self.stand[0][0] - self.stand[-1][0]) * (
            0.15 * s + 0.85 * glatt(s))
        sigma = math.radians(
            t['neig_ab'] + (t['neig_schwung'] - t['neig_ab']) * glatt(min(1.0, s / 0.30))
            + (t['neig_auf'] - t['neig_schwung']) * glatt(max(0.0, (s - 0.70) / 0.30)))
        tau = sigma * glatt(min(1.0, s / 0.20))
        # Der Knöchel sitzt so hoch, dass der TIEFSTE Sohlenpunkt gerade
        # den Boden berührt, plus Freigang. Eine Bodendurchdringung ist
        # damit rechnerisch ausgeschlossen, nicht nur hoffentlich
        # vermieden. Steiler Anfang (Exponent unter 1), nicht Sinus: Ein
        # Fuss löst sich beim Abstoss ruckartig vom Boden.
        z = -self.sohle_z(sigma, tau) + t['freigang'] * math.sin(math.pi * s) ** 0.55
        return x, z + BODENSPIEL[self.s], sigma, tau

    def loese(self, huefte, ziel):
        """Welt-Drehwinkel für Ober- und Unterschenkel (Bogenmass).

        Zweigliedrige Umkehrkinematik in der Ebene. Das Knie zeigt nach
        VORN — deshalb phi = psi - alpha; mit dem anderen Vorzeichen
        knickte das Bein wie bei einem Vogel.
        """
        tx = ziel[0] - huefte[0]
        tz = ziel[1] - huefte[1]
        r = math.hypot(tx, tz)
        # Nie ganz durchgestreckt: Bei r = l1+l2 ist die Kniekehle steif,
        # und jeder Rundungsfehler lässt den Fuss durch den Boden
        # springen. 0,5 % Rest-Beugung kosten optisch nichts.
        r = max(abs(self.l1 - self.l2) + H * 0.004,
                min(self.reichweite * 0.995, r))
        psi = winkel(tx, tz)
        cos_a = (r * r + self.l1 * self.l1 - self.l2 * self.l2) / (2 * r * self.l1)
        alpha = math.acos(max(-1.0, min(1.0, cos_a)))
        w1 = psi - alpha
        kx = huefte[0] - math.sin(w1) * self.l1
        kz = huefte[1] - math.cos(w1) * self.l1
        w2 = winkel(ziel[0] - kx, ziel[1] - kz)
        return w1 - self.phi1, w2 - self.phi2


# Wie hoch der ganze Zyklus über dem Gelände liegt. Steht nach dem ersten
# Backen NICHT auf null: Die Bahn rechnet mit der Sohle als starrem
# Körper, die Haut wird aber linear zwischen zwei Knochen gemischt und
# knickt an Knöchel und Ballen um ein paar Millimeter nach innen. Diese
# Millimeter werden am fertig gebackenen Mesh GEMESSEN und der Zyklus
# danach einmal angehoben — genauer, als sie zu schätzen.
BODENSPIEL = {'L': 0.0, 'R': 0.0}


def takt(tempo, dauer, stand, freigang, becken_tief, becken_hub,
         neig_auf, neig_ab, neig_schwung):
    """Alle Zahlen eines Gangs an einer Stelle.

    `weg` ist der Zyklusweg in MODELLMASS: Läuft die Figur mit `tempo`
    und braucht `dauer` für zwei Schritte, ist der Zyklusweg genau
    tempo * dauer, geteilt durch localScale. Jede andere Zahl heisst
    Rutschen.
    """
    return {'tempo': tempo, 'dauer': dauer, 'weg': tempo / SKALA * dauer,
            'stand': stand, 'freigang': freigang * H,
            'becken_tief': becken_tief * H, 'becken_hub': becken_hub * H,
            'neig_auf': neig_auf, 'neig_ab': neig_ab, 'neig_schwung': neig_schwung,
            'roll_ferse': 0.18, 'roll_ballen': 0.65}


# Die BECKENSENKUNG steht in beiden Takten auf 0 — sie wird nicht
# eingestellt, sondern in `noetige_beckensenkung()` aus Bahn und
# Beinlänge gerechnet und dort eingesetzt. Dort steht auch, warum: Bei
# dieser Figur ist das aufrechte Standbein zu 99,3 % durchgestreckt, es
# gibt schlicht keinen Wert, den man hier sinnvoll raten könnte.
#
# ── Gehen ───────────────────────────────────────────────────────────
# Standphase 60 % (echter Gang: 58-62 %), Fersenauftritt, Abstoss über
# den Ballen.
TAKT_GEHEN = takt(TEMPO_GEHEN, DAUER_GEHEN, 0.60, 0.030, 0.0, 0.010,
                  -13.0, 20.0, -8.0)
# ── Rennen ──────────────────────────────────────────────────────────
# Standphase 36 %: Unter 50 % sind beide Füsse zeitweise in der Luft —
# das ist der Unterschied zwischen Gehen und Laufen, und er fällt hier
# von selbst heraus statt eigens gebaut zu werden. Der Fuss setzt
# flacher auf (Mittelfuss statt Ferse) und stösst kräftiger ab.
TAKT_RENNEN = takt(TEMPO_RENNEN, DAUER_RENNEN, 0.36, 0.060, 0.0, 0.018,
                   -6.0, 26.0, -14.0)

BEINE = {}
PRUEF = {}


def gangwerk(t):
    global BEINE, PRUEF
    BEINE = {s: Gangwerk(s, t) for s in ('L', 'R')}
    PRUEF = {s: (0.0, 0.0) for s in ('L', 'R')}
    return BEINE


def stelle_bein(g, ziel, sigma, tau, messen=True):
    """Dreht die vier Gelenke, bis Knöchel und Sohle wirklich sitzen.

    Die Umkehrkinematik nimmt an, dass sich die Weltwinkel entlang der
    Kette einfach addieren. Das stimmt exakt, solange alles um QUER
    dreht — das Becken dreht aber zusätzlich um HOCH und VOR, und daran
    hängt die Hüfte. Statt diesen Rest abzuschätzen, wird er GEMESSEN:
    Nach jedem Versuch liest die Schleife die tatsächliche Knöchellage
    aus der ausgewerteten Pose und verschiebt das Ziel um den Fehler.
    Drei Durchgänge bringen den Restfehler unter einen Zehntelmillimeter.
    """
    s = g.s
    korr = (0.0, 0.0)
    ist = (0.0, 0.0)
    rest = 0.0
    # Bis zu acht Durchgänge mit Abbruch, sobald es sitzt. Drei feste
    # Durchgänge genügten nicht: Im ersten Durchgang eines Bildes ist die
    # Hüftmatrix noch die des VORIGEN Bildes (das Pose-Update läuft erst
    # mit `view_layer.update()` weiter unten), und wer als erstes Bein
    # gelöst wird, startet deshalb mit einem veralteten Bezugspunkt. Das
    # war exakt der gemessene Unterschied: Das zuletzt gelöste Bein traf
    # auf 0,00 mm, das zuerst gelöste um 228 mm daneben.
    for _ in range(8):
        huefte = eben(armobj.pose.bones[f'{s}_Thigh'].matrix.translation)
        w1, w2 = g.loese(huefte, (ziel[0] + korr[0], ziel[1] + korr[1]))
        setz_roh(f'{s}_Thigh', math.degrees(w1))
        setz_roh(f'{s}_Calf', math.degrees(w2 - w1))
        setz_roh(f'{s}_Foot', math.degrees(sigma - w2))
        setz_roh(f'{s}_ToeBase', math.degrees(tau - sigma))
        bpy.context.view_layer.update()
        ist = eben(armobj.pose.bones[f'{s}_Foot'].matrix.translation)
        rest = math.hypot(ziel[0] - ist[0], ziel[1] - ist[1])
        if rest < 1e-5:
            break
        korr = (korr[0] + ziel[0] - ist[0], korr[1] + ziel[1] - ist[1])
    if not messen:
        return
    huefte = eben(armobj.pose.bones[f'{s}_Thigh'].matrix.translation)
    streck = math.hypot(ziel[0] - huefte[0], ziel[1] - huefte[1]) / g.reichweite
    PRUEF[s] = (max(PRUEF[s][0], streck), max(PRUEF[s][1], rest))


# ════════════════════════════════════════════════════════════════════
# Die vier Bewegungen
# ════════════════════════════════════════════════════════════════════
def idle_pose(p):
    """Stehen, atmen, Gewicht verlagern.

    Sparsam dosiert und mit VERSCHIEDENEN Frequenzen: Läuft alles im
    selben Takt, liest das Auge es als Maschine. Der Kopf sieht sich
    deshalb doppelt so schnell um wie der Körper wiegt, und das Atmen
    läuft wieder anders.
    """
    s, c = math.sin(p), math.cos(p)
    s2 = math.sin(p * 2)
    w = armobj.pose.bones['Hip']
    w.location = versatz(w, Vector((0.0, 0.0025 * H * s, 0.0030 * H * s2)))
    setz('Hip', (VOR, 0.9 * s))
    setz('Waist', (VOR, 0.6 * s), (QUER, -0.8 * s2))
    setz('Spine01', (QUER, -0.7 * s2), (VOR, 0.6 * s), (HOCH, -0.8 * s))
    setz('Spine02', (QUER, -0.9 * s2), (VOR, 0.7 * s), (HOCH, -1.0 * s))
    setz('NeckTwist01', (QUER, 0.8 * math.sin(p * 2 + 0.4)))
    setz('Head', (HOCH, 4.0 * math.sin(p * 2 + 0.7)), (QUER, 1.8 * math.sin(p * 3 + 1.9)))
    for s_, vz in (('L', +1.0), ('R', -1.0)):
        setz(f'{s_}_Clavicle', (QUER, 0.8 * s2))
        setz(f'{s_}_Upperarm', (QUER, 1.6 * s * vz), (VOR, -1.0 * s * vz))
        setz(f'{s_}_Forearm', (QUER, 2.2 * math.sin(p + 0.5) * vz))
        setz(f'{s_}_Hand', (QUER, 1.4 * c * vz))
    # Die Beine tragen nur; sie verlagern das Gewicht, sie gehen nicht.
    # Die GEGENDREHUNG im Knöchel ist wichtig: Ohne sie kippt die Sohle
    # mit dem Bein mit, und schon ein halbes Grad hebt die Zehe über eine
    # Sohlenlänge messbar vom Boden.
    for s_, vz in (('L', +1.0), ('R', -1.0)):
        setz(f'{s_}_Thigh', (QUER, 0.5 * s * vz), (VOR, 0.4 * s))
        setz(f'{s_}_Foot', (QUER, -0.5 * s * vz))


def mach_gang(t):
    """Baut die Posefunktion für einen Gang mit dem Takt `t`."""

    def pose(p):
        u_r = (p / math.tau) % 1.0
        u_l = (u_r + 0.5) % 1.0
        s, c = math.sin(p), math.cos(p)
        renn = 1.0 if t['stand'] < 0.5 else 0.0

        # ── Rumpf zuerst ────────────────────────────────────────────
        # Die Beine rechnen gleich mit der TATSÄCHLICHEN Hüftlage, die
        # von Beckenhub und -drehung abhängt. Also muss der Rumpf vorher
        # stehen.
        hub = t['becken_tief'] + t['becken_hub'] * math.cos(math.tau * 2 * (u_r - 0.30))
        w = armobj.pose.bones['Hip']
        # ── Die Wurzelbewegung ──────────────────────────────────────
        # Der Zyklusweg wandert in den Hip-Knochen (siehe Kopfabschnitt
        # 4). Um den halben Weg zurückversetzt, damit die Figur um ihre
        # eigene Mitte pendelt statt aus ihr herauszulaufen.
        weg = 0.0 if ORTSFEST else t['weg'] * (u_r - 0.5)
        w.location = versatz(w, Vector((weg, 0.010 * H * s, hub)))
        setz('Hip', (HOCH, (3.0 + 2.0 * renn) * s), (VOR, -2.5 * s))
        # Vorlage des Rumpfs. Beim Rennen deutlich stärker: Wer
        # beschleunigt, lehnt sich in die Bewegung (-Grad um QUER = vorn).
        setz('Waist', (HOCH, -1.5 * s), (QUER, -3.0 - 9.0 * renn), (VOR, 1.2 * s))
        setz('Spine01', (HOCH, -2.5 * s), (QUER, -2.0 - 5.0 * renn), (VOR, 1.2 * s))
        setz('Spine02', (HOCH, -(4.0 + 3.0 * renn) * s),
             (QUER, -2.0 - 4.0 * renn - 1.8 * math.cos(p * 2)), (VOR, 1.4 * s))
        # Der Kopf bleibt WAAGERECHT, egal wie stark der Rumpf vorliegt:
        # Ein Läufer sieht nach vorn, nicht auf seine Füsse. Deshalb die
        # Gegendrehung um die Summe der Rumpfvorlage.
        setz('NeckTwist01', (QUER, 3.0 + 8.0 * renn))
        setz('Head', (HOCH, 2.0 * s), (QUER, 3.0 + 10.0 * renn + 1.2 * math.cos(p * 2)))

        # ── Arme gegenläufig zum gleichseitigen Bein ────────────────
        # Beim Rennen ist der Ellbogen dauerhaft gebeugt (rund 80 Grad)
        # und schwingt um diese Ruhelage — das ist der auffälligste
        # Unterschied zum Gehen, auffälliger als jeder Beinwinkel.
        for s_, phase, vz in (('L', p, +1.0), ('R', p + math.pi, -1.0)):
            sw = math.sin(phase)
            setz(f'{s_}_Clavicle', (QUER, -2.0 * sw), (HOCH, -2.0 * sw * vz))
            setz(f'{s_}_Upperarm',
                 (QUER, -(14.0 + 16.0 * renn) * sw),
                 (VOR, (3.0 + 6.0 * renn) * vz))
            setz(f'{s_}_Forearm',
                 (QUER, -(8.0 + 55.0 * renn) - (7.0 + 22.0 * renn) * math.sin(phase - 0.5)))
            setz(f'{s_}_Hand', (QUER, -6.0 * math.sin(phase - 0.8)))

        # ── und dann die Beine auf ihre Bahn ────────────────────────
        # ZWEIMAL durch beide Beine. Das erste Bein einer Runde löst
        # gegen eine Hüftmatrix, die noch aus dem vorigen Bild stammt —
        # Blender wertet die Pose erst mit `view_layer.update()` neu aus,
        # und das passiert zum ersten Mal INNERHALB von `stelle_bein`.
        # Nach der ersten Runde steht der Rumpf wirklich, und die zweite
        # Runde rechnet für beide Beine auf demselben Stand.
        #
        # Nachgemessen: Ohne die zweite Runde traf das zuerst gelöste
        # Bein um 43 mm daneben (Spielmassstab), das zuletzt gelöste um
        # 0,00 mm.
        for runde, (s_, u) in enumerate([('R', u_r), ('L', u_l),
                                         ('R', u_r), ('L', u_l)]):
            g = BEINE[s_]
            zx, zz, sigma, tau = g.bahn(u)
            # Bei Wurzelbewegung steht der Standfuss im CLIP still und
            # die Hüfte fährt über ihn hinweg. Das Ziel wandert deshalb
            # um genau denselben Weg mit, den die Hüfte zurücklegt.
            stelle_bein(g, (zx + weg, zz), sigma, tau, messen=runde >= 2)

    return pose


# ── Angriff: einhändiger Hieb mit der rechten Hand ──────────────────
# Der nackte Körper trägt keine Waffe; die hängt später an R_Hand
# (AvatarRig.handR). Der Clip muss deshalb einen SCHWUNG zeigen, der mit
# und ohne Waffe funktioniert: ausholen über die rechte Schulter,
# diagonal nach vorn-unten durchziehen, nachfedern, aufrichten.
#
# Der Bogen kommt aus DREI Gelenken (Rumpf, Schulter, Ellbogen) statt aus
# einem. Eine Hülle verträgt keine 160 Grad an einer Schulter — die
# Schulterkappe kollabiert dann zur Tüte.
#
# Zeitplan (Phase 0..1):
#   0,00-0,12  Ruhe      — der Clip beginnt und endet in der Standhaltung
#   0,12-0,40  Ausholen  — Faust hinter die rechte Schulter, Gewicht zurück
#   0,40-0,58  Schlag    — der ganze Oberkörper dreht nach vorn-links
#   0,58-0,76  Treffer   — kurzes Nachfedern, kein sauberes Anhalten
#   0,76-1,00  Zurück    — aufrichten in die Ruhehaltung
def _rampe(p, a, b):
    return glatt((p - a) / (b - a)) if b > a else (1.0 if p >= b else 0.0)


def angriff_pose(p):
    aus = _rampe(p, 0.12, 0.40) * (1.0 - _rampe(p, 0.40, 0.58))
    schlag = _rampe(p, 0.40, 0.58) * (1.0 - _rampe(p, 0.76, 1.00))
    federn = (math.sin((p - 0.58) * math.tau * 2.4) * math.exp(-(p - 0.58) * 9.0)
              if 0.58 <= p < 0.92 else 0.0)

    w = armobj.pose.bones['Hip']
    # Gewicht zurück beim Ausholen, Ausfall nach vorn beim Schlag.
    # AUSDRÜCKLICH ohne Absacken: Die Beine können nicht kürzer werden,
    # ein tieferes Becken zöge die Füsse mit unter das Gelände.
    w.location = versatz(w, Vector((0.030 * H * schlag - 0.014 * H * aus, 0.0,
                                    -0.012 * H * schlag)))
    # ── Der Schwung kommt aus dem RUMPF, nicht aus der Schulter ─────
    # Erster Anlauf: 70 Grad am Oberarm beim Ausholen. Gerendert (sechs
    # Bilder über den Clip) verschwand der rechte Arm dabei IM Brustkorb
    # und die Schulterkappe stülpte sich um — die Hülle verträgt an einem
    # Gelenk keine 70 Grad, weil Deltamuskel und Brust dort eine
    # gemeinsame Fläche sind und die Gewichte über wenige Zentimeter
    # kippen.
    #
    # Ein echter Hieb kommt ohnehin aus der Rumpfdrehung; die Schulter
    # führt nur. Die 68 Grad Drehung verteilen sich deshalb auf VIER
    # Wirbel — 17 Grad je Gelenk, das trägt jede Hülle —, und der Oberarm
    # bleibt unter 40. Dieselbe Überlegung steht im Kopf von
    # tools/surtr-rig.py ("Rumpf, Schulter, Ellbogen und Klinge teilen
    # sich den Weg").
    setz('Hip', (QUER, 5.0 * aus - 4.0 * schlag), (HOCH, -14.0 * aus + 12.0 * schlag))
    setz('Waist', (QUER, 6.0 * aus - 6.0 * schlag + 2.0 * federn),
         (HOCH, -16.0 * aus + 14.0 * schlag))
    setz('Spine01', (QUER, 7.0 * aus - 7.0 * schlag + 2.0 * federn),
         (HOCH, -18.0 * aus + 16.0 * schlag))
    setz('Spine02', (QUER, 8.0 * aus - 9.0 * schlag + 3.0 * federn),
         (HOCH, -20.0 * aus + 18.0 * schlag), (VOR, -4.0 * aus + 3.0 * schlag))
    # Der Kopf dreht GEGEN den Rumpf und bleibt damit auf dem Ziel:
    # Wer zuschlägt, sieht hin. Ohne die Gegendrehung risse der Blick beim
    # Ausholen um 68 Grad zur Seite.
    setz('NeckTwist01', (QUER, -2.0 * aus - 3.0 * schlag),
         (HOCH, 12.0 * aus - 10.0 * schlag))
    setz('Head', (QUER, -3.0 * aus - 6.0 * schlag),
         (HOCH, 14.0 * aus - 12.0 * schlag))

    # ── Schlagarm ───────────────────────────────────────────────────
    # +QUER = nach hinten/oben, -VOR = vom Körper WEG (für den rechten
    # Arm; +VOR zöge ihn in den eigenen Brustkorb). Das negative VOR ist
    # nicht Zierde, sondern der Grund, warum der Arm beim Ausholen neben
    # dem Rumpf bleibt statt hindurchzugehen.
    setz('R_Clavicle', (QUER, -8.0 * aus + 6.0 * schlag),
         (HOCH, -10.0 * aus - 6.0 * schlag))
    setz('R_Upperarm', (QUER, 36.0 * aus - 24.0 * schlag + 3.0 * federn),
         (VOR, -26.0 * aus - 16.0 * schlag), (HOCH, 10.0 * aus - 20.0 * schlag))
    # Der Ellbogen darf beugen, so viel er will — ein Scharnier hat keine
    # gemeinsame Fläche mit dem Rumpf. Ausholen mit gefaltetem Arm hinter
    # der Schulter, Durchziehen mit fast gestrecktem.
    setz('R_Forearm', (QUER, -75.0 * aus - 18.0 * schlag + 6.0 * federn))
    setz('R_Hand', (QUER, -10.0 * aus + 12.0 * schlag))
    # Der freie Arm balanciert gegen: beim Ausholen nach vorn, beim
    # Schlag nach hinten. Ohne ihn kippt die Figur optisch aus dem Bild.
    setz('L_Clavicle', (QUER, 5.0 * aus - 7.0 * schlag))
    setz('L_Upperarm', (QUER, -18.0 * aus + 24.0 * schlag),
         (VOR, 16.0 * aus + 10.0 * schlag))
    setz('L_Forearm', (QUER, -25.0 - 10.0 * aus + 8.0 * schlag))

    # Ausfallschritt: das rechte Bein stemmt hinten, das linke nimmt vorn
    # den Stoss auf. Der Fuss bekommt die SUMME der Beinwinkel mit
    # umgekehrtem Vorzeichen — damit bleibt die Sohle waagerecht, statt
    # mit dem Schienbein wegzukippen. Nur die Ferse des hinteren Beins
    # darf sich beim Durchschlagen lösen; wer sich in den Boden stemmt,
    # steht am Ende auf dem Ballen.
    r_ober = 8.0 * aus + 5.0 * schlag
    r_unter = -4.0 * aus + 8.0 * schlag
    l_ober = -4.0 * aus - 10.0 * schlag
    l_unter = 6.0 * aus + 12.0 * schlag
    setz('R_Thigh', (QUER, r_ober))
    setz('R_Calf', (QUER, r_unter))
    setz('R_Foot', (QUER, -(r_ober + r_unter) + 9.0 * schlag))
    setz('R_ToeBase', (QUER, -9.0 * schlag))
    setz('L_Thigh', (QUER, l_ober))
    setz('L_Calf', (QUER, l_unter))
    setz('L_Foot', (QUER, -(l_ober + l_unter)))


# ════════════════════════════════════════════════════════════════════
# Backen
# ════════════════════════════════════════════════════════════════════
def aktion(name, dauer, pose_fn, schleife=True):
    """Backt eine Aktion.

    Bei `schleife` ist der letzte Frame die Kopie des ersten und die
    Phase läuft von 0 bis tau — dann schliesst der Zyklus im Client ohne
    Sprung. Sonst läuft die Phase von 0 bis 1 über die volle Länge.
    """
    frames = int(round(dauer * FPS))
    armobj.animation_data_create()
    akt = bpy.data.actions.new(name)
    akt.use_fake_user = True
    armobj.animation_data.action = akt
    szene.frame_start = 1
    szene.frame_end = frames + 1
    for f in range(1, frames + 2):
        phase = (((f - 1) % frames) / frames * math.tau if schleife
                 else (f - 1) / frames)
        szene.frame_set(f)
        for pb in armobj.pose.bones:
            pb.rotation_quaternion = Quaternion()
            pb.location = (0.0, 0.0, 0.0)
        pose_fn(phase)
        for pb in armobj.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=f)
        armobj.pose.bones['Hip'].keyframe_insert('location', frame=f)
    for fc in akt.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
    akt.name = name
    print(f'AKTION {name}: {frames + 1} Frames ({dauer:.2f} s), '
          f'{len(akt.fcurves)} F-Kurven')
    return akt


def tiefste_sohle(nur_flach, t):
    """Tiefster Punkt der VERFORMTEN Sohle, JE FUSS, über den Zyklus.

    Je Fuss, nicht gemeinsam: Die beiden Füsse knicken unterschiedlich
    stark ein. Wer beide um den schlechteren Wert anhebt, lässt den
    besseren schweben.

    `nur_flach` beschränkt die Messung auf den Abschnitt, in dem die
    Sohle flach aufliegen SOLL. Nur der wird ausgeregelt: Beim
    Fersenauftritt und beim Abstoss knickt die Haut an Knöchel und Ballen
    unvermeidlich ein paar Millimeter nach innen, und diese kurzen
    Spitzen mit einem dauerhaften Anheben zu erschlagen hiesse, die Figur
    den ganzen Schritt lang schweben zu lassen.
    """
    grenze = H * 0.06
    idx = {s: [i for i, v in enumerate(welt)
               if v.z < grenze and YBAND[s][0] <= v.y <= YBAND[s][1]]
           for s in ('L', 'R')}
    tief = {s: 1.0 for s in ('L', 'R')}
    n = szene.frame_end - szene.frame_start
    for f in range(szene.frame_start, szene.frame_end + 1):
        szene.frame_set(f)
        ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        m = ev.to_mesh()
        u_r = (f - szene.frame_start) / n
        for s, ii in idx.items():
            u = u_r if s == 'R' else (u_r + 0.5) % 1.0
            if nur_flach and not (t['roll_ferse'] * t['stand'] <= u
                                  < t['roll_ballen'] * t['stand']):
                continue
            tief[s] = min(tief[s], min(m.vertices[i].co.z for i in ii))
        ev.to_mesh_clear()
    return tief


def noetige_beckensenkung(t):
    """Wie tief das Becken sinken MUSS, damit das Bein den Schritt schafft.

    ── Warum das gerechnet und nicht eingestellt wird ────────────────
    Beim Menschen ist das Standbein aufrecht fast durchgestreckt: Bei
    dieser Figur misst die Beinkette 0,4631 in der Gehebene, und die
    Hüfte steht 0,4598 über dem Knöchel — 99,3 % davon. Es ist also
    praktisch KEINE Reserve da. Jeder Schritt, der den Fuss aus der
    Senkrechten heraus auf dem Boden hält, verlangt deshalb ein tieferes
    Becken; sonst reisst die Umkehrkinematik am Anschlag und der Fuss
    rutscht.

    Beim ersten Lauf mit einem von Hand gesetzten Wert (-0,020) war das
    Bein zu 106,5 % gestreckt und der Standfuss um 236 mm im
    Spielmassstab daneben — der Gang eines Modells, das über den Boden
    schlittert.

    Gerechnet wird exakt statt abgeschätzt: `_standbahn` liefert die
    fertige Knöchelbahn (x, z). Für jeden ihrer Punkte gibt es eine
    höchste Hüftlage, bei der die Kette gerade noch hinreicht —

        hueft_z <= z + sqrt((f * R)^2 - (x - X0)^2)

    — und das Minimum darüber ist die Hüfthöhe, die der ganze Zyklus
    zulässt. `f = 0,985` lässt 1,5 % Restbeugung im Knie: Ein exakt
    durchgestrecktes Bein hat eine steife Kniekehle, und jeder
    Rundungsfehler lässt den Fuss dann durch den Boden springen.
    """
    noetig = 1e9
    for g in BEINE.values():
        rmax = g.reichweite * 0.985
        for x, z in g.stand:
            dx = abs(x - X0)
            if dx >= rmax:
                # Der Schritt ist selbst mit ganz flachem Becken zu weit.
                return None
            noetig = min(noetig, z + math.sqrt(rmax * rmax - dx * dx) - HUEFTE_Z)
    # Das Becken WIPPT zusätzlich um `becken_hub` (zweimal je Zyklus, das
    # ist das Auf und Ab des Gangs). Für die Reichweite zählt der höchste
    # Punkt dieses Wippens, nicht sein Mittelwert.
    return min(0.0, noetig - t['becken_hub'])


def backe_gang(name, t, dauer):
    """Backt einen Gang und regelt ihn danach auf den Boden aus."""
    for s in BODENSPIEL:
        BODENSPIEL[s] = 0.0
    gangwerk(t)
    # ── Beckensenkung: gerechnet, dann erst gebacken ────────────────
    # Die Bahn hängt nicht von der Beckenhöhe ab (sie folgt aus dem
    # Abrollen und dem Vorschub), die Beckenhöhe aber von der Bahn.
    # Deshalb erst die Bahn bauen, dann die Senkung daraus rechnen.
    noetig = noetige_beckensenkung(t)
    if noetig is None:
        raise SystemExit(
            f'{name}: Der Zyklusweg {t["weg"] * SKALA:.2f} m ist für ein '
            f'{BEINE["L"].reichweite * SKALA:.2f} m langes Bein zu weit — '
            'das Becken müsste unter den Knöchel sinken.\n'
            f'Entweder --{name} senken (langsamer) oder --{name}-dauer erhöhen '
            '(längerer Zyklus, gleiches Tempo, kürzere Schritte).')
    # Etwas TIEFER als nötig: Auf den Zehntelmillimeter gerechnet stünde
    # das Bein im Zyklusmaximum genau am Anschlag, und die 1,5 %
    # Restbeugung wären dort aufgebraucht. Zwei Millimeter Modellmass
    # (knapp vier im Spiel) kosten nichts und halten das Knie weich.
    t['becken_tief'] = min(t['becken_tief'], noetig - H * 0.002)
    print(f'{name.upper()}: Becken sinkt {-t["becken_tief"]:.4f} '
          f'({-t["becken_tief"] * SKALA * 100:.1f} cm) — gerechnet aus Bahn und '
          f'Beinlänge, nicht eingestellt')
    for s, g in BEINE.items():
        print(f'BEIN {s}: Oberschenkel {g.l1:.4f} + Unterschenkel {g.l2:.4f} '
              f'= {g.reichweite:.4f} in der Gehebene ({g.reichweite * SKALA:.2f} m), '
              f'Knöchel {-g.sohle_z(0.0, 0.0):.4f} über der Sohle, '
              f'Sohle {g.spitze[0] - g.ferse[0]:.4f} lang, Ballen bei '
              f'{(g.ballen[0] - g.ferse[0]) / (g.spitze[0] - g.ferse[0]) * 100:.0f} %')
    print(f'{name.upper()}: {t["weg"]:.4f} Zyklusweg = {t["weg"] * SKALA:.2f} m in '
          f'{dauer:.2f} s bei {t["tempo"]} m/s, also {t["weg"] * SKALA / 2:.2f} m je '
          f'Schritt; Standphase {t["stand"] * 100:.0f} %, Doppelstand '
          f'{(2 * t["stand"] - 1) * 100:.0f} %')
    pose = mach_gang(t)
    aktion(name, dauer, pose)
    flach = tiefste_sohle(True, t)
    if any(abs(v) > 0.0002 for v in flach.values()):
        # Nachbacken mit ausgeregeltem Zyklus. Ein Durchgang genügt: Die
        # Verformung hängt an den Gelenkwinkeln, und die ändern sich
        # durch ein paar Millimeter Höhe praktisch nicht.
        for s, v in flach.items():
            BODENSPIEL[s] = -v
        bpy.data.actions.remove(bpy.data.actions[name])
        aktion(name, dauer, pose)
        flach = tiefste_sohle(True, t)
    alles = tiefste_sohle(False, t)
    print(f'{name.upper()}: Ausgleich ' +
          ', '.join(f'{s} {v:+.4f}' for s, v in BODENSPIEL.items()) +
          ' — flache Sohle jetzt ' +
          ', '.join(f'{s} {v:+.4f} ({v * SKALA * 100:+.1f} cm)'
                    for s, v in flach.items()))
    print(f'{name.upper()}: tiefster Punkt über den GANZEN Zyklus ' +
          ', '.join(f'{s} {v:+.4f} ({v * SKALA * 100:+.1f} cm)'
                    for s, v in alles.items()))
    for s, (streck, rest) in PRUEF.items():
        print(f'{name.upper()} {s}: Bein höchstens zu {streck * 100:.1f} % gestreckt, '
              f'Knöchel-Restfehler {rest * SKALA * 1000:.2f} mm im Spielmassstab')
        if streck > 0.995:
            print('  ⚠ Das Bein stösst an seine Streckgrenze — der Zyklus ist zu '
                  'lang für dieses Bein. `--gehen-dauer` erhöhen oder `--gehen` '
                  'senken, sonst rutscht der Fuss.')


aktion('idle', DAUER_IDLE, idle_pose)
backe_gang('gehen', TAKT_GEHEN, DAUER_GEHEN)
backe_gang('rennen', TAKT_RENNEN, DAUER_RENNEN)
aktion('angriff', DAUER_ANGRIFF, angriff_pose, schleife=False)

# Ruhepose für den Export-Rest
szene.frame_set(1)
bpy.ops.object.mode_set(mode='OBJECT')

# ── Blickrichtung auf die Engine-Konvention drehen ──────────────────
# Die Engine dreht eine laufende Figur um die Hochachse mit
# yaw = atan2(dx, dz) (shared/worldlayout/routenlauf.ts) — vorn ist also
# die +Z-Achse des Babylon-Raums. AvatarRig.ts setzt dasselbe voraus
# ("model forward is +Z", halter.rotation.y = 0).
#
# Welche Blender-Achse das ist, wurde NICHT hergeleitet, sondern an den
# Modellen abgelesen, die im Spiel nachweislich richtig herum laufen
# (npc_1_walk.glb, Voelva.glb, Surtr.glb): Alle schauen im importierten
# Blender-Raum nach -Y. Die Figur steht hier im Arbeitsraum auf +X; von
# +X nach -Y sind es -90 Grad um die HOCHACHSE Z.
#
# Um Z, nicht um Y: Y ist hier waagerecht, eine Drehung darum legt die
# Figur schlicht um.
BLICK_DREHUNG = math.radians(-90.0)
for o in (armobj, mesh):
    o.rotation_euler = (o.rotation_euler[0], o.rotation_euler[1],
                        o.rotation_euler[2] + BLICK_DREHUNG)
bpy.ops.object.select_all(action='DESELECT')
armobj.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = armobj
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

# ── Export ──────────────────────────────────────────────────────────
# export_animation_mode='ACTIONS' schreibt JEDE Action als eigene
# glTF-Animation unter ihrem Action-Namen; export_frame_range muss dabei
# AUS sein, sonst schneidet der Szenenbereich der zuletzt gebackenen
# Aktion die anderen ab.
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
print(f'FERTIG {ZIEL} — {len(KNOCHEN)} Knochen, Aktionen "idle", "gehen", '
      f'"rennen" und "angriff", {os.path.getsize(ZIEL) / 1e6:.2f} MB')
print(f'PREFAB: localScale {SKALA:.4f} für {ZIELHOEHE:.2f} m Körperhöhe')
