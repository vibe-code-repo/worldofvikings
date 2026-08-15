#!/usr/bin/env blender --background --python
"""
Uebernimmt das von Meshy automatisch erzeugte Rig des Furloc-Kriegers samt
seiner sieben Bewegungen und macht daraus eine Datei, die der Client
abspielen kann.

    blender --background --python tools/meshy-anim-uebernehmen.py -- \\
        --glb  assets/upload/Meshy_AI_toad_viking_warrior_r_biped/\\
Meshy_AI_toad_viking_warrior_r_biped_Meshy_AI_Meshy_Merged_Animations.glb \\
        --roh  assets/models/FurlocKrieger-roh.glb \\
        --out  assets/models/FurlocKrieger.glb

Quelle ist ausdruecklich die "Merged_Animations"-Datei und nicht die
"Character_output": Beide tragen dasselbe Skelett und dieselben 10.151
Dreiecke, aber die erste enthaelt die Bewegungen, die zweite nur einen
0,03 s langen Klumpen Bindepose.

── Warum ueberhaupt ein Skript und kein Handgriff ───────────────────
An der Meshy-Datei stimmt fuer das Spiel nichts davon von allein:

  1. NAMEN. Der Client schaltet die Animationsgruppe auf den String, den
     der Server in den ZDO-Member `anim` schreibt, und dieser String IST
     der Gruppenname in der GLB (AssetManager.wechsleAnimation). Gebraucht
     werden "idle", "walk" und "attack"; Meshy liefert "Walking",
     "Left_Slash" und fuenf weitere.
     Die Suche ist ein TEILSTRINGVERGLEICH — jeder zusaetzlich behaltene
     Clip darf deshalb weder "idle" noch "walk" noch "attack" im Namen
     tragen, sonst greift der Client bei "attack" womoeglich den
     Sprungangriff ab. Darum heissen die Zugaben `run`, `kick`, `taunt`,
     `combo2` und `combo3` und nicht etwa "Double_Combo_Attack".

  2. IDLE GIBT ES NICHT. Meshy kennt keinen Ruhestand; der naechstbeste
     Clip waere der Spott ("Chest_Pound_Taunt"), und ein NPC, der an
     seiner Route steht und sich pausenlos auf die Brust trommelt, ist
     kein wartender Krieger. Der Leerlauf wird deshalb hier gebaut
     (s. `idle_pose`).

  3. BODEN. Meshys Bewegungen kennen keine Bodenebene. Gemessen an der
     evaluierten Haut sinken die Sohlen im Gehen bis 0,21 Einheiten unter
     z = 0 und im Laufen bis 0,21 — im Spiel waeren das gut zwanzig
     Zentimeter Bein im Gelaende. Schlimmer noch: die Sohle sinkt WAEHREND
     der Standphase weiter ab (linker Fuss von +0,017 auf -0,203), der
     Koerper faehrt also im Verlauf jedes Schrittes in den Boden. Dagegen
     hilft kein fester Versatz, sondern nur ein Hub je Bild
     (s. `hub_und_requisiten`).

  4. SPEER UND SCHILD. Meshy hat die Requisiten mitgeriggt, als waeren sie
     Fleisch: Der Speer haengt zu je 0,5 an RightForeArm und RightHand.
     In der Bindepose (T-Pose, Arm waagerecht) steht er senkrecht mit dem
     Schaftende auf dem Boden — sobald der Arm sinkt, kippt er starr mit
     und faehrt bis 0,37 Einheiten durch das Gelaende; der Schild liegt
     flach im Dreck. Beide bekommen deshalb einen EIGENEN Knochen unter
     der Hand, und ihre Richtung wird je Bild in WELTkoordinaten gefuehrt
     statt aus Armwinkeln zu folgen (dieselbe Lehre wie `setz_richtung`
     in tools/furloc-volk-rig.py).

  5. MATERIAL. Meshy setzt `emissiveFactor` [1,1,1] MIT DER BASECOLOR als
     Emissionskarte — die Figur leuchtet also in voller Eigenfarbe und
     wirkt ausgewaschen. Dazu `metallicFactor` implizit 1,0 (das Feld
     fehlt, und der glTF-Vorgabewert ist 1), `alphaMode BLEND` ohne echte
     Transparenz und `specularColorFactor [2,2,2]`. Die vier anderen
     Furlocs tragen dagegen die von Tripo gebackenen Karten. Das Material
     wird deshalb NICHT repariert, sondern aus der "-roh"-Datei
     UEBERNOMMEN: Deren BaseColor ist bis auf die Aufloesung dasselbe
     Bild (Kachelmittelwerte stimmen auf vier Stellen), sie bringt die
     MetallicRoughness-Karte mit, die Meshy verloren hat, und ihre
     Emissionskarte ist schwarz. Damit sieht der Krieger aus wie seine
     vier Verwandten, und die 4096er-Doppelkarte (2 x 27,3 MB) faellt
     ersatzlos weg.

── Warum "Left_Slash" der Angriff ist ───────────────────────────────
Der Client startet die Gruppe mit `start(true)`, also in SCHLEIFE. Ein
Angriff, dessen letztes Bild nicht zum ersten passt, ist damit kein
Angriff, sondern ein Zucken im Sekundentakt. Gemessen wurde der Abstand
jedes Vertex zwischen erstem und letztem Bild (Mittel ueber die Haut):

    Left_Slash            0,004      Running   0,000
    Chest_Pound_Taunt     0,009      Walking   0,000
    Double_Combo_Attack   1,006
    Triple_Combo_Attack   1,247
    Simple_Kick           1,485

Die beiden Kombos und der Tritt enden eine ganze Koerperlaenge neben
ihrem Anfang (sie drehen sich im Sprung weg) — als Schleife unbrauchbar.
Left_Slash schliesst dagegen praktisch nahtlos, auch in der
Geschwindigkeit (0,0061 am Anfang gegen 0,0052 am Ende). Er ist damit
nicht der schoenste, sondern der einzige schleifenfaehige Angriff.

── Warum der Gang gestaucht wird ────────────────────────────────────
Meshys Zyklus ist ein fertiger Clip mit fester Schrittweite; der Server
schiebt den NPC dagegen mit ROUTE_DEFAULT_SPEED = 1,5 m/s. Passt beides
nicht zusammen, schleift der Standfuss.

Das Eigentempo des Clips wird gemessen und nicht geraten (s.
`messe_tempo`): In jedem Bild zaehlt der Fuss, der sich am staerksten
nach hinten bewegt — das ist der, der gerade traegt —, und die Summe
seiner Rueckwaertswege ueber den Zyklus ist der Weg, den der Koerper in
dieser Zeit machen muss. Gemessen an der fertigen Datei sind das 1,200
Einheiten je Sekunde, bei localScale 1,011 also 1,21 m/s. Die
naheliegende Rechnung "Schrittweite mal Kadenz" kaeme auf 1,45 — sie
zaehlt die Doppelstandphase doppelt (hier 0,30 s von 1,03 s).

Der Clip wird anschliessend so gestaucht, dass sein Eigentempo mal
localScale genau `--tempo` ergibt: 1,033 s werden zu 0,836 s, also 2,39
Schritte je Sekunde. Der ehrliche Gegenweg waere ein `RouteDef.speed`
von 1,21 m/s an der Route des Kriegers; beide Zahlen stehen in der
Ausgabe, und mit `--gang-dehnen nein` bleibt der Clip unangetastet.
ROUTE_DEFAULT_SPEED wird nicht angefasst — der Wert gilt fuer alle NPCs.

── Randbedingungen der Ausgabe ──────────────────────────────────────
export_animation_mode='ACTIONS' schreibt jede Action als eigene
glTF-Animation unter ihrem Action-Namen; export_frame_range muss dabei
AUS sein, sonst schneidet der Szenenbereich der zuletzt gebackenen
Aktion die anderen ab (Lehre aus tools/surtr-rig.py).

Die Blickrichtung wird gemessen, nicht angenommen: Die Engine dreht eine
laufende Figur mit yaw = atan2(dx, dz), im importierten Blender-Raum ist
das -Y. Belegt wird es hier am Knochen `headfront`, den Meshy vom Kopf aus
nach vorn setzt, und an den Zehenknochen.
"""

import math
import os
import sys

import bpy
from mathutils import Vector, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def pfad(p):
    return p if os.path.isabs(p) else os.path.join(ROOT, p)


GLB = pfad(arg('--glb', 'assets/upload/Meshy_AI_toad_viking_warrior_r_biped/'
               'Meshy_AI_toad_viking_warrior_r_biped_Meshy_AI_Meshy_Merged_Animations.glb'))
ROH = pfad(arg('--roh', 'assets/models/FurlocKrieger-roh.glb'))
OUT = pfad(arg('--out', 'assets/models/FurlocKrieger.glb'))
TEMPO = float(arg('--tempo', '1.5'))          # m/s, ROUTE_DEFAULT_SPEED
ZIELHOEHE = float(arg('--zielhoehe', '1.794'))  # m, Koerperhoehe des Handrigs
DAUER_IDLE = float(arg('--idle-dauer', '4.0'))
FPS = int(arg('--fps', '30'))
# Wird der Gang gestaucht? Ohne `--gang-dehnen nein` behaelt der Clip seine
# eigene Dauer, und der Fuss rutscht um die Differenz.
GANG_ANPASSEN = arg('--gang-dehnen', 'ja') != 'nein'

# ── Wie die Requisiten gefunden werden ──────────────────────────────
# Nicht neu vermessen: Speer- und Schildmasse stehen seit tools/furloc-
# volk-rig.py in der Messtabelle des Kriegers, sohlenrelativ und in den
# Koordinaten der "-roh"-Datei. Die Meshy-Datei ist dieselbe Geometrie,
# nur AEHNLICH TRANSFORMIERT: gemessen an den drei Bounding-Box-Kanten
# derselbe Faktor 1,3869 in x, y und z, dazu eine Hebung, die die Sohle
# auf z = 0,0045 legt. Damit laesst sich jede Zahl der Tabelle mit einer
# Zeile heruebernehmen — und die Probe stimmt: das Schaftende der Tabelle
# landet auf (-0,981; -0,101; -0,004), und genau dort liegen in der
# Meshy-Datei die tiefsten Speer-Vertices.
F_MESHY = 1.3869
Z_SOHLE_ROH = 0.0045
SCHAFT_MITTE_T = (-0.7995, -0.0991, 0.7871)
SCHAFT_ACHSE = Vector((-0.1155, -0.0325, +0.9928)).normalized()
SCHAFT_T = (-0.7986, +0.5533)
SCHAFT_R = (0.050, 0.115)
SCHILD_MITTE_T = (+0.7900, -0.1250, 0.5302)
SCHILD_R = 0.230
FAUST_T = {'r': (-0.6600, -0.0450, 0.7052), 'l': (+0.5700, +0.0050, 0.7072)}


def nach_meshy(p):
    return Vector((F_MESHY * p[0], F_MESHY * p[1], F_MESHY * p[2] + Z_SOHLE_ROH))


# ── Namensplan ──────────────────────────────────────────────────────
# Reihenfolge ist Absicht: `wechsleAnimation` nimmt den ERSTEN Treffer
# eines Teilstrings, also stehen die drei Pflichtnamen vorn.
UMBENENNUNG = [
    ('Walking', 'walk'),
    ('Left_Slash', 'attack'),
    ('Running', 'run'),
    ('Simple_Kick', 'kick'),
    ('Chest_Pound_Taunt', 'taunt'),
    ('Double_Combo_Attack', 'combo2'),
    ('Triple_Combo_Attack', 'combo3'),
]
REIHENFOLGE = ['idle', 'walk', 'attack', 'run', 'kick', 'taunt', 'combo2', 'combo3']
for _n in REIHENFOLGE:
    for _v in ('idle', 'walk', 'attack'):
        if _v in _n and _n != _v:
            raise SystemExit(f'Clipname "{_n}" enthaelt "{_v}" — der Client '
                             f'wuerde ihn faelschlich greifen')

BEIN_KNOCHEN = ('LeftFoot', 'LeftToeBase', 'RightFoot', 'RightToeBase')
REQUISITE = 'requisite'
SCHILD = 'schild'


def glatt(u):
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


def abstand_segment(p, a, b):
    ab = b - a
    l2 = ab.length_squared
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, (p - a).dot(ab) / l2))
    return (p - (a + ab * t)).length


# ── Laden ───────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

# Meshy legt der Szene eine leere Icosphere bei (42 Vertices, kein
# Material, keine Armature) — Rest seines Vorschau-Aufbaus. Sie waere im
# Spiel eine unsichtbare Kugel um die Figur.
for o in list(bpy.data.objects):
    if o.type == 'MESH' and len(o.data.vertices) < 200:
        print(f'VERWORFEN: {o.name} ({len(o.data.vertices)} Vertices, keine Figur)')
        bpy.data.objects.remove(o, do_unlink=True)

mesh = max([o for o in bpy.data.objects if o.type == 'MESH'],
           key=lambda o: len(o.data.vertices))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
szene = bpy.context.scene
szene.render.fps = FPS
arm.animation_data_create()

MW = mesh.matrix_world.copy()
ruhe = [MW @ v.co for v in mesh.data.vertices]
print(f'MODELL: {len(ruhe)} Vertices, '
      f'{sum(len(p.vertices) - 2 for p in mesh.data.polygons)} Dreiecke, '
      f'{len(arm.data.bones)} Knochen, {len(bpy.data.actions)} Bewegungen')

# ── Blickrichtung: gemessen ─────────────────────────────────────────
# Meshy setzt `headfront` vom Kopf aus in Blickrichtung und `*ToeBase`
# vom Knoechel aus in Zehenrichtung. Beide muessen nach -y zeigen.
_kopf = arm.data.bones['Head'].head_local
_vorn = arm.data.bones['headfront'].head_local
_blick = (_vorn - _kopf)
_zehen = sum(((arm.data.bones[b + 'ToeBase'].head_local
               - arm.data.bones[b + 'Foot'].head_local).y for b in ('Left', 'Right')), 0.0)
print(f'BLICK: headfront liegt {_blick.y:+.1f} in y vor dem Kopf, die Zehen '
      f'{_zehen:+.1f} vor den Knoecheln — die Figur schaut nach '
      f'{"-y (Engine-Konvention, keine Drehung noetig)" if _blick.y < 0 and _zehen < 0 else "?? PRUEFEN"}')
if _blick.y >= 0 or _zehen >= 0:
    raise SystemExit('Blickrichtung ist nicht -y; die Drehung muesste hier '
                     'ergaenzt werden (s. BLICK_DREHUNG in furloc-volk-rig.py)')

# ── Requisiten aus der Haut schneiden ───────────────────────────────
SCHAFT_MITTE = nach_meshy(SCHAFT_MITTE_T)
SCHAFT_A = SCHAFT_MITTE + SCHAFT_ACHSE * (SCHAFT_T[0] * F_MESHY)
SCHAFT_B = SCHAFT_MITTE + SCHAFT_ACHSE * (SCHAFT_T[1] * F_MESHY)
SCHILD_MITTE = nach_meshy(SCHILD_MITTE_T)
FAUST = {s: nach_meshy(p) for s, p in FAUST_T.items()}
R_UNTEN, R_OBEN = (r * F_MESHY for r in SCHAFT_R)
R_SCHILD = SCHILD_R * F_MESHY

_arm_r = (arm.data.bones['RightArm'].head_local * 0.01,
          arm.data.bones['RightHand'].head_local * 0.01)
_arm_l = (arm.data.bones['LeftArm'].head_local * 0.01,
          arm.data.bones['LeftHand'].head_local * 0.01)


def ist_speer(p):
    """Zylinder um die gemessene Schaftachse, die FAUST ausgenommen,
    das BEIWERK am Griff dagegen eingeschlossen.

    Die Faust muss heraus: Die Finger des Kriegers liegen am Schaft und
    faenden sich sonst im Speer wieder — die Umgewichtung risse ihm die
    Hand vom Handgelenk. Der kurze Schaftabschnitt, der dabei mit
    ausfaellt, liegt im Drehpunkt der Waffe; dort bewegen Hand und Schaft
    sich ohnehin gleich.

    Das Beiwerk muss hinein, und das ist eine Lehre aus dem Bild: Um den
    Griff sind Riemen und ein haengender Anhaenger gewickelt, die bis 0,42
    Einheiten neben der Achse stehen und deshalb aus dem Schaftzylinder
    herausfallen. Solange der Speer nur GEDREHT wurde, fiel das nicht auf
    (sie sitzen im Drehpunkt); sobald er durch die Faust GESCHOBEN wird,
    blieben sie stehen — im Bild hing ein zweiter, halber Schaft in der
    Luft. Sie sind am Schaft festgebunden und gehoeren an den Schaft."""
    t = (p - SCHAFT_MITTE).dot(SCHAFT_ACHSE)
    d = abstand_segment(p, SCHAFT_A, SCHAFT_B)
    if SCHAFT_T[0] * F_MESHY - 0.07 <= t <= SCHAFT_T[1] * F_MESHY + 0.07:
        voll = R_UNTEN + (R_OBEN - R_UNTEN) * glatt((t - 0.028) / 0.333)
        if d <= voll * 1.35 + 0.017:
            return abstand_segment(p, *_arm_r) > 0.105
    if -0.35 <= t <= 0.30 and d <= 0.47:
        return abstand_segment(p, *_arm_r) > 0.16
    return False


def ist_schild(p):
    """Kugel um die gemessene Schildmitte, der Unterarm ausgenommen."""
    if (p - SCHILD_MITTE).length > R_SCHILD * 1.32:
        return False
    return abstand_segment(p, *_arm_l) > 0.105


speer = [i for i, v in enumerate(ruhe) if ist_speer(v)]
schild = [i for i, v in enumerate(ruhe) if ist_schild(v) and not ist_speer(v)]
print(f'REQUISITEN: {len(speer)} Vertices im Speer, {len(schild)} im Schild')
if not speer or not schild:
    raise SystemExit('Speer- oder Schildmaske leer — passt die Messtabelle noch?')

# ── Zwei Knochen dazu ───────────────────────────────────────────────
# Der Knochen liegt AUF DER SCHAFTACHSE, sein Kopf im Griff (dem Punkt
# der Achse, der der Faust am naechsten liegt). Nicht von der Faust zur
# Spitze: `setz_richtung` dreht den Knochen in eine Weltrichtung, und das
# ist nur dann die Richtung der WAFFE, wenn Knochen und Waffe parallel
# sind. Die Faust sitzt aber zwei Zentimeter neben der Achse.
GRIFF = SCHAFT_MITTE + SCHAFT_ACHSE * (FAUST['r'] - SCHAFT_MITTE).dot(SCHAFT_ACHSE)
SCHAFT_UNTER_GRIFF = (GRIFF - SCHAFT_A).length
SCHAFT_UEBER_GRIFF = (SCHAFT_B - GRIFF).length
SCHILD_ARM = (SCHILD_MITTE - FAUST['l']).length

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for name, kopf, spitze, eltern in (
        (REQUISITE, GRIFF, SCHAFT_B, 'RightHand'),
        (SCHILD, FAUST['l'], SCHILD_MITTE, 'LeftHand')):
    b = arm.data.edit_bones.new(name)
    # Die Armature steht auf Faktor 0,01 (Meshy rechnet in Zentimetern);
    # Knochenkoordinaten sind Armature-Raum, die Messtabelle Weltraum.
    b.head = Vector(kopf) * 100.0
    b.tail = Vector(spitze) * 100.0
    b.parent = arm.data.edit_bones[eltern]
    b.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
print(f'REQUISITEN: Griff bei {tuple(round(x, 3) for x in GRIFF)}, Schaft '
      f'{SCHAFT_UNTER_GRIFF:.3f} darunter und {SCHAFT_UEBER_GRIFF:.3f} darueber; '
      f'Schildmitte {SCHILD_ARM:.3f} von der Faust')

g_req = mesh.vertex_groups.new(name=REQUISITE)
g_sch = mesh.vertex_groups.new(name=SCHILD)
for gruppe, idx in ((g_req, speer), (g_sch, schild)):
    for g in mesh.vertex_groups:
        if g not in (g_req, g_sch):
            g.remove(idx)
    gruppe.add(idx, 1.0, 'REPLACE')

# ── Auf die Sohle stellen ───────────────────────────────────────────
# Der Prefab-Ursprung IST im Spiel die Gelaendehoehe. Gemessen wird die
# FUSSSOHLE und nicht der tiefste Punkt der Datei — der ist das
# Speerende, und ein Speer gehoert nicht auf den Boden gestellt, sondern
# in die Hand (dieselbe Falle wie in tools/furloc-volk-rig.py).
gname = [g.name for g in mesh.vertex_groups]


def haupt(i):
    g = sorted(mesh.data.vertices[i].groups, key=lambda g: -g.weight)
    return gname[g[0].group] if g else '-'


sohle_idx = [i for i in range(len(ruhe)) if haupt(i) in BEIN_KNOCHEN]
koerper_idx = [i for i in range(len(ruhe)) if i not in set(speer) | set(schild)]
SOHLE = min(ruhe[i].z for i in sohle_idx)
HOEHE = max(ruhe[i].z for i in koerper_idx) - SOHLE
SPITZE = max(ruhe[i].z for i in speer) - SOHLE
SKALA = round(ZIELHOEHE / HOEHE, 3)
print(f'MASSE: Sohle bei z={SOHLE:+.4f}, Koerperhoehe {HOEHE:.4f}, '
      f'Speerspitze {SPITZE:.4f} ueber der Sohle')
print(f'MASSE: localScale {SKALA} ergibt {HOEHE * SKALA:.3f} m Koerper und '
      f'{SPITZE * SKALA:.3f} m bis zur Speerspitze (Ziel {ZIELHOEHE:.3f} m)')

arm.location.z -= SOHLE
bpy.context.view_layer.update()
MW = mesh.matrix_world.copy()
ruhe = [MW @ v.co for v in mesh.data.vertices]

# ── Werkzeug: Haut auswerten ────────────────────────────────────────
def haut():
    dgl = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dgl)
    m = ev.to_mesh()
    out = [MW @ m.vertices[i].co.copy() for i in range(len(m.vertices))]
    ev.to_mesh_clear()
    return out


# ── Werkzeug: Knochen in eine WELTRICHTUNG drehen ───────────────────
# Der Knochen zeigt in seinem Ruhezustand entlang seiner eigenen y-Achse.
# Gesucht ist die Basisdrehung, die ihn — MIT der schon gesetzten
# Elternkette — in eine vorgegebene Weltrichtung bringt. Der Trick ist,
# die Elternkette einmal ohne eigene Basis auszuwerten: dann ist die
# gesuchte Drehung ein einfacher Richtungsvergleich im Knochenraum.
def basis_fuer_richtung(pb, ziel):
    eltern = pb.parent.matrix @ (pb.parent.bone.matrix_local.inverted()
                                 @ pb.bone.matrix_local)
    r0 = eltern.to_3x3()
    lokal = r0.inverted() @ Vector(ziel).normalized()
    return Vector((0.0, 1.0, 0.0)).rotation_difference(lokal.normalized())


# Wohin der Speer zeigen soll. Waagerecht nach vorn-aussen, aber so steil
# aufgerichtet, wie die Griffhoehe es zulaesst: Steht die Hand hoch (in
# der Bindepose auf Schulterhoehe), steht der Speer senkrecht wie in der
# gelieferten Datei; sinkt sie, kippt er nach vorn, statt das Schaftende
# durch den Boden zu treiben. So ist die Regel STETIG in der Handhoehe
# und kann in keinem Bild springen.
SPEER_VORN = Vector((-0.30, -0.95, 0.0)).normalized()
SCHILD_VORN = Vector((+0.86, -0.42, 0.0)).normalized()


# Wie steil der Speer im Idealfall steht und wie weit die Faust dafuer am
# Schaft wandern darf. Ohne das Wandern gaebe es die steile Haltung gar
# nicht: Meshys Schulter sitzt auf 1,145, der Griff liegt in der
# Bindepose in der SCHAFTMITTE, und darunter haengen 0,97 Einheiten
# Schaft — ein senkrechter Speer braucht also einen Griff auf 1,12, und
# den erreicht der Arm nur waagerecht ausgestreckt. Wer einen Speer
# aufrecht traegt, fasst ihn deshalb WEITER UNTEN an; genau das tut auch
# das Handrig (`schiebe('requisite', ...)` in tools/furloc-volk-rig.py).
SPEER_STEIL = math.radians(78.0)
SCHAFT_SCHUB = 0.45


def speer_haltung(griff_z, freiraum=0.15):
    """(Weltrichtung, Schub am Schaft) fuer eine gegebene Griffhoehe.

    Erst wird versucht, den Schaft durch die Faust hochzuschieben, bis er
    steil stehen kann; reicht der erlaubte Schub nicht, kippt der Speer
    nach vorn. Beides ist STETIG in der Griffhoehe — eine Fallunter-
    scheidung wuerde im Zyklus springen."""
    platz = max(0.0, griff_z - freiraum)
    steil = math.sin(SPEER_STEIL)
    schub = max(0.0, min(SCHAFT_SCHUB, SCHAFT_UNTER_GRIFF - platz / steil))
    unten = SCHAFT_UNTER_GRIFF - schub
    s = max(0.0, min(steil, platz / max(1e-6, unten)))
    richtung = (SPEER_VORN * math.sqrt(max(0.0, 1.0 - s * s))
                + Vector((0, 0, s))).normalized()
    return richtung, schub


def schild_richtung(faust_z, freiraum=0.14):
    """Der Schild haengt aussen am Unterarm; sein Rand darf nicht in den
    Boden. Gefuehrt wird die Achse Faust -> Schildmitte: nach aussen und
    so weit gesenkt, wie die Mitte noch einen Schildradius Luft hat."""
    tief = max(-1.0, min(0.0, (faust_z - R_SCHILD - freiraum) / max(1e-6, SCHILD_ARM)))
    return (SCHILD_VORN * math.sqrt(max(0.0, 1.0 - tief * tief))
            + Vector((0, 0, tief))).normalized()


# ── Backen ──────────────────────────────────────────────────────────
KNOCHEN = [b.name for b in arm.data.bones]
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'


def schreibe_aktion(name, bilder):
    """Legt eine Action aus fertigen Posen an.

    `bilder` ist eine Liste je Bild: {Knochenname: (loc, quat)}. Skalen
    werden nicht geschluesselt — Meshys Quelle haelt sie durchweg auf 1,
    und jede ungenutzte Kurve landet sonst als eigener glTF-Sampler in
    der Datei."""
    akt = bpy.data.actions.new(name)
    akt.use_fake_user = True
    arm.animation_data.action = akt
    szene.frame_start = 1
    szene.frame_end = len(bilder)
    for f, pose in enumerate(bilder, start=1):
        for n, (loc, quat) in pose.items():
            pb = arm.pose.bones[n]
            pb.location = loc
            pb.rotation_quaternion = quat
            pb.keyframe_insert('location', frame=f)
            pb.keyframe_insert('rotation_quaternion', frame=f)
    for fc in akt.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
    return akt


# Wie weit darf etwas anderes als die Sohle im Boden verschwinden? Der
# Lendenschurz haengt bis dicht ueber den Boden und SOLL im Gras
# untergehen (dieselbe Abwaegung wie beim Umhangsaum in
# tools/furloc-volk-rig.py) — ein Knie darf es nicht.
SAUM_SPIEL = 0.05


def hub_und_requisiten(bilder):
    """Zweiter Durchgang ueber fertige Posen: Bodenhub und Requisiten.

    Getrennt vom ersten, weil beides die evaluierte HAUT braucht — und
    die gibt es erst, wenn die Pose in einer Action steht. Der Hub hebt
    nie ab: `max(0, ...)` laesst einen Sprung Sprung sein und zieht nur
    heraus, was im Boden steckt. Waehrend eines Sprungs kostet das
    nichts — dann steht ohnehin nichts auf dem Boden, an dem das Auge
    ein Schweben messen koennte."""
    akt = schreibe_aktion('_probe', bilder)
    hub, griff, faust = [], [], []
    for f in range(1, len(bilder) + 1):
        szene.frame_set(f)
        w = haut()
        hub.append(max(0.0,
                       -min(w[i].z for i in sohle_idx),
                       -min(w[i].z for i in koerper_idx) - SAUM_SPIEL))
        griff.append((arm.matrix_world @ arm.pose.bones[REQUISITE].matrix).translation.z)
        faust.append((arm.matrix_world @ arm.pose.bones[SCHILD].matrix).translation.z)
    bpy.data.actions.remove(akt)
    return hub, griff, faust


HUEFT_BASIS = arm.pose.bones['Hips'].bone.matrix_local.to_3x3().inverted()


def mit_hub(pose, dz):
    """Hebt die ganze Figur um dz (Weltmass), indem der Wurzelknochen
    verschoben wird. Die Verschiebung wird in seinen Ruheraum gedreht —
    `pose.matrix = matrix_local @ T @ R @ S`, also verschiebt ein Delta
    im lokalen Raum die Figur um `matrix_local * delta`, unabhaengig von
    Drehung und Skalierung."""
    loc, quat = pose['Hips']
    return dict(pose, Hips=(loc + HUEFT_BASIS @ Vector((0.0, 0.0, dz * 100.0)), quat))


def fertig_stellen(name, bilder, freiraum_speer=0.15):
    """Bodenhub und Requisitenrichtung einrechnen und die Action anlegen."""
    hub, griff, faust = hub_und_requisiten(bilder)
    fertig = []
    for k, pose in enumerate(bilder):
        p = mit_hub(pose, hub[k])
        fertig.append(p)
    akt = schreibe_aktion(name, fertig)
    # Die Requisitenrichtung braucht die Elternkette IM ANGEHOBENEN
    # Zustand — deshalb erst jetzt, auf der schon geschriebenen Action.
    #
    #
    # Was die Regel NICHT abfaengt: Am Griff haengen Riemen und ein
    # Anhaenger bis 0,47 Einheiten neben der Achse, und um welchen Winkel
    # die um den Schaft gerollt sind, entscheidet die Hand — nicht diese
    # Richtungsfuehrung, die nur die Schaftachse setzt. Wo die Hand tief
    # steht und der Anhaenger nach unten zeigt, streift er den Boden,
    # obwohl der Schaft frei steht. In den acht Clips passiert das nur in
    # `combo2` und `combo3` (den Sprungangriffen, in denen die Faust
    # ohnehin bis auf den Boden geht) mit 14 bzw. 21 cm; ein groesserer
    # Freiraum hilft dagegen NACHWEISLICH nicht, weil er nur die
    # Schaftneigung flacher stellt und den Anhaenger dabei gar nicht
    # bewegt. Das waere ein eigener Knochen im Anhaenger wert, sobald die
    # beiden Clips wirklich gespielt werden.
    for f in range(1, len(fertig) + 1):
        szene.frame_set(f)
        ziel, schub = speer_haltung(griff[f - 1] + hub[f - 1], freiraum_speer)
        for bone, ziel_b, schub_b in (
                (REQUISITE, ziel, schub),
                (SCHILD, schild_richtung(faust[f - 1] + hub[f - 1]), 0.0)):
            pb = arm.pose.bones[bone]
            q = basis_fuer_richtung(pb, ziel_b)
            pb.rotation_quaternion = q
            # Der Schub laeuft laengs der GEDREHTEN Knochenachse. Ein
            # `location` im Ruheraum taete es nicht: Blender rechnet
            # `matrix_local @ T @ R`, die Verschiebung liegt also VOR der
            # Drehung — ein (0, schub, 0) schoebe den Speer entlang seiner
            # Ruhelage statt entlang seiner jetzigen Richtung.
            pb.location = q @ Vector((0.0, schub_b * 100.0, 0.0))
            pb.keyframe_insert('rotation_quaternion', frame=f)
            pb.keyframe_insert('location', frame=f)
    return akt, hub


def abtasten(quelle, n):
    """Liest eine Meshy-Action an n+1 gleichverteilten Stellen aus.

    Gleichverteilt und nicht bildweise: Meshys Zyklen enden auf krummen
    Bildern (Walking bei 24,8 von 24 fps), und genau dieses letzte Bild
    ist die Wiederholung des ersten. Wer ganzzahlig abtastet, verliert
    den Zyklusschluss."""
    arm.animation_data.action = quelle
    f0, f1 = quelle.frame_range
    bilder = []
    for k in range(n + 1):
        f = f0 + (f1 - f0) * k / n
        szene.frame_set(int(f), subframe=f - int(f))
        pose = {pb.name: (pb.location.copy(), pb.rotation_quaternion.copy())
                for pb in arm.pose.bones}
        # Die beiden neuen Knochen kennt Meshys Action nicht; ihre
        # Posewerte stehen deshalb noch da, wo der ZULETZT gebackene Clip
        # sie hinterlassen hat. Unzurueckgesetzt misst `hub_und_requisiten`
        # die Griffhoehe am Speer des Vorgaengerclips — und die
        # Speerhaltung waere um dessen Schub daneben.
        for n_r in (REQUISITE, SCHILD):
            pose[n_r] = (Vector((0.0, 0.0, 0.0)), Quaternion())
        bilder.append(pose)
    return bilder


def messe_tempo(akt, dauer):
    """Eigentempo eines Laufzyklus, gemessen an der evaluierten Haut.

    Gemessen wird an der FERTIGEN, schon angehobenen Aktion. An der
    Rohfassung ginge es nicht: Meshys Sohle sinkt WAEHREND der Standphase
    weiter ab (von +0,017 auf -0,203), ein Schwellwert ueber dem tiefsten
    Punkt des Zyklus erwischt dort nur die letzten Bilder — gemessen
    wurden so 8 bis 19 % Standphase statt der wirklichen 60 bis 70.

    In jedem Bild zaehlt der Fuss, der sich am staerksten nach HINTEN
    bewegt (+y, denn die Figur schaut nach -y) — das ist der, der gerade
    traegt. Sein Rueckwaertsweg ist der Weg, den der Koerper in dieser
    Zeit nach vorn machen MUSS, damit er stehen bleibt. Die Summe ueber
    den Zyklus ist der Zyklusweg.

    Warum nicht "wer Bodenkontakt hat": Meshys Schwungfuss hebt kaum ab
    (an der tiefsten Stelle des Zyklus liegen beide Sohlen 7 cm
    auseinander), ein Hoehenschwellwert erklaert deshalb beide Fuesse
    gleichzeitig fuer stehend und mittelt den vorschwingenden gegen den
    tragenden weg — gemessen kam dabei ein NEGATIVES Eigentempo heraus.
    Und warum nicht "Schrittweite mal Kadenz": das zaehlt die
    Doppelstandphase doppelt (hier 0,30 s von 1,03 s)."""
    KONTAKT = 0.045
    arm.animation_data.action = akt
    f0, f1 = int(akt.frame_range[0]), int(akt.frame_range[1])
    fuesse = {'R': [i for i in sohle_idx if ruhe[i].x < 0],
              'L': [i for i in sohle_idx if ruhe[i].x >= 0]}
    spur = {s: [] for s in fuesse}
    for f in range(f0, f1 + 1):
        szene.frame_set(f)
        w = haut()
        for s, idx in fuesse.items():
            spur[s].append((min(w[i].z for i in idx),
                            sum(w[i].y for i in idx) / len(idx)))
    n = f1 - f0
    weg = sum(max(spur[s][k][1] - spur[s][k - 1][1] for s in spur)
              for k in range(1, n + 1))
    stand = {s: sum(1 for z, _y in sp if z <= KONTAKT) / (n + 1)
             for s, sp in spur.items()}
    return weg / dauer, stand


# ── Die uebernommenen Clips ─────────────────────────────────────────
QUELLE = {q: next(a for a in bpy.data.actions if a.name.startswith(q))
          for q, _z in UMBENENNUNG}
DAUER = {q: (a.frame_range[1] - a.frame_range[0]) / 24.0 for q, a in QUELLE.items()}

def backe(quelle, dauer, name):
    n = max(6, int(round(dauer * FPS)))
    return fertig_stellen(name, abtasten(quelle, n))


# Erst das Eigentempo des Gangs messen — daraus folgt seine neue Dauer.
# Gemessen wird am schon angehobenen Zyklus, s. `messe_tempo`.
_probe, _ = backe(QUELLE['Walking'], DAUER['Walking'], '_gangprobe')
V_CLIP, STAND = messe_tempo(_probe, DAUER['Walking'])
bpy.data.actions.remove(_probe)
V_SPIEL = V_CLIP * SKALA
print(f'\n=== GANG ===')
print(f'Meshys Zyklus dauert {DAUER["Walking"]:.4f} s; Standphase '
      + ', '.join(f'{s} {v * 100:.0f} %' for s, v in sorted(STAND.items())))
print(f'Der Standfuss wandert dabei mit {V_CLIP:.4f} Einheiten/s nach hinten. '
      f'Bei localScale {SKALA} sind das {V_SPIEL:.3f} m/s Eigentempo.')
print(f'Der Server schiebt mit {TEMPO:.2f} m/s. Die beiden ehrlichen Wege:')
print(f'  (a) RouteDef.speed an seiner Route auf {V_SPIEL:.2f} m/s setzen '
      f'(Zyklus bleibt {DAUER["Walking"]:.3f} s)')
print(f'  (b) den Clip auf {DAUER["Walking"] * V_SPIEL / TEMPO:.3f} s stauchen '
      f'(Faktor {V_SPIEL / TEMPO:.3f}, Kadenz {2 * TEMPO / (DAUER["Walking"] * V_SPIEL):.2f} Schritte/s)')

ZIEL_DAUER = dict(DAUER)
if GANG_ANPASSEN:
    ZIEL_DAUER['Walking'] = DAUER['Walking'] * V_SPIEL / TEMPO
    print(f'GEWAEHLT: (b) — ROUTE_DEFAULT_SPEED gilt fuer alle NPCs und die '
          f'Route liegt in server/data/worldlayout.json.')
else:
    print('GEWAEHLT: (a) — der Clip behaelt seine Dauer.')

gebacken = {}
for q, ziel in UMBENENNUNG:
    akt, hub = backe(QUELLE[q], ZIEL_DAUER[q], ziel)
    gebacken[ziel] = akt
    print(f'CLIP {ziel:8s} <- {q:20s} {ZIEL_DAUER[q]:.3f} s, '
          f'{int(akt.frame_range[1])} Bilder, '
          f'Bodenhub {min(hub):.3f}..{max(hub):.3f}')
V_ENDE, STAND_ENDE = messe_tempo(gebacken['walk'], ZIEL_DAUER['Walking'])
print(f'NACHGEMESSEN am fertigen Zyklus: {V_ENDE * SKALA:.3f} m/s Eigentempo '
      f'(Ziel {TEMPO if GANG_ANPASSEN else V_SPIEL:.3f}), Standphase '
      + ', '.join(f'{s} {v * 100:.0f} %' for s, v in sorted(STAND_ENDE.items())))

for a in list(bpy.data.actions):
    if a.name not in REIHENFOLGE:
        bpy.data.actions.remove(a)


# ── idle: aus der Bindepose gebaut ──────────────────────────────────
# Meshys Bindepose ist eine T-Pose: Arme waagerecht ausgestreckt. Das ist
# eine Rigging-Hilfe, keine Haltung — der Leerlauf muss die Arme also
# erst senken. Danach liegt darueber ein Atmen aus MEHREREN Frequenzen:
# Ein einziger Sinus auf allen Gliedern liest sich als Maschine, weil
# jedes Gelenk im selben Takt umkehrt. Kopf und Haende laufen deshalb auf
# eigenen Vielfachen und mit eigener Phase (Lehre aus tools/surtr-rig.py).
#
# Die Beine bleiben nahezu stehen: Sie tragen nur, sie gehen nicht. Was
# sie bekommen, ist eine GEGENDREHUNG im Knoechel — ohne sie kippte die
# Sohle mit dem Unterschenkel mit, und bei 0,3 Einheiten Sohlenlaenge
# heben schon 0,6 Grad die Zehe sichtbar vom Boden.
HOCH = Vector((0, 0, 1))       # Gierachse: umsehen
QUER = Vector((1, 0, 0))       # Seitenachse: nicken, vor/zurueck
VOR = Vector((0, -1, 0))       # Blickachse: seitliches Wiegen


def welt_zu_knochen(pb, qwelt):
    m = pb.bone.matrix_local.to_3x3()
    return (m.inverted() @ qwelt.to_matrix() @ m).to_quaternion()


def drehung(*achsen):
    q = Quaternion()
    for achse, grad in achsen:
        q = q @ Quaternion(achse.normalized(), math.radians(grad))
    return q


# Wie weit die Arme aus der T-Pose sinken. Der Speerarm bleibt hoeher als
# der Schildarm: Er traegt die Waffe, und je tiefer der Griff sitzt, desto
# flacher muss der Speer liegen (s. `speer_richtung`).
SENKEN_SPEER = 46.0
SENKEN_SCHILD = 58.0


def idle_pose(p):
    """p laeuft von 0 bis 1 ueber einen Atemzyklus."""
    w = p * math.tau
    s, c = math.sin(w), math.cos(w)
    s2 = math.sin(w * 2)
    pose = {}

    def setz(name, *achsen):
        pb = arm.pose.bones[name]
        pose[name] = (Vector((0, 0, 0)), welt_zu_knochen(pb, drehung(*achsen)))

    # Becken: zwei Atemzuege je Runde, dazu ein langsames Wiegen.
    pose['Hips'] = (HUEFT_BASIS @ Vector((0.0, 0.6 * s, 0.55 * s2)),
                    welt_zu_knochen(arm.pose.bones['Hips'],
                                    drehung((VOR, 0.9 * s), (HOCH, 0.7 * c))))
    setz('Spine02', (VOR, 0.7 * s), (QUER, -0.8 * s2))
    setz('Spine01', (VOR, 0.6 * s), (QUER, -1.0 * s2))
    setz('Spine', (QUER, -1.3 * s2), (VOR, 0.5 * s), (HOCH, -1.1 * s))
    setz('neck', (QUER, 1.1 * math.sin(w * 2 + 1.1)))
    setz('Head', (HOCH, 3.4 * math.sin(w * 2 + 0.7)),
         (QUER, 1.5 * math.sin(w * 3 + 1.9)))
    # Arme: Senken plus ein Pendeln, das dem Atem eine halbe Phase
    # hinterherlaeuft — Schultern heben sich vor den Haenden.
    setz('RightShoulder', (VOR, +6.0 + 1.4 * s))
    setz('RightArm', (VOR, +SENKEN_SPEER + 2.2 * s), (QUER, -6.0 + 1.6 * s2))
    setz('RightForeArm', (VOR, +14.0 + 2.6 * math.sin(w + 0.5)), (HOCH, -8.0))
    setz('LeftShoulder', (VOR, -6.0 - 1.4 * s))
    setz('LeftArm', (VOR, -SENKEN_SCHILD - 2.0 * s), (QUER, -5.0 + 1.5 * s2))
    setz('LeftForeArm', (VOR, -16.0 - 2.4 * math.sin(w + 0.6)), (HOCH, +9.0))
    setz('RightUpLeg', (QUER, 0.6 * s), (VOR, 0.4 * s))
    setz('RightFoot', (QUER, -0.6 * s))
    setz('LeftUpLeg', (QUER, -0.6 * s), (VOR, 0.4 * s))
    setz('LeftFoot', (QUER, 0.6 * s))
    for pb in arm.pose.bones:
        pose.setdefault(pb.name, (Vector((0, 0, 0)), Quaternion()))
    return pose


N_IDLE = int(round(DAUER_IDLE * FPS))
bilder = [idle_pose((k % N_IDLE) / N_IDLE) for k in range(N_IDLE + 1)]
akt, hub = fertig_stellen('idle', bilder)
gebacken['idle'] = akt
print(f'CLIP idle     <- Bindepose + Atem   {DAUER_IDLE:.3f} s, {N_IDLE + 1} Bilder, '
      f'Bodenhub {min(hub):.3f}..{max(hub):.3f}')

# ── Gegenprobe an der evaluierten Haut ──────────────────────────────
print('\n=== PROBE (tiefster Punkt je Teil, ueber den ganzen Clip) ===')
for name in REIHENFOLGE:
    akt = gebacken[name]
    arm.animation_data.action = akt
    f0, f1 = int(akt.frame_range[0]), int(akt.frame_range[1])
    tief = {'Sohle': 1e9, 'Koerper': 1e9, 'Speer': 1e9, 'Schild': 1e9}
    for f in range(f0, f1 + 1):
        szene.frame_set(f)
        w = haut()
        tief['Sohle'] = min(tief['Sohle'], min(w[i].z for i in sohle_idx))
        tief['Koerper'] = min(tief['Koerper'], min(w[i].z for i in koerper_idx))
        tief['Speer'] = min(tief['Speer'], min(w[i].z for i in speer))
        tief['Schild'] = min(tief['Schild'], min(w[i].z for i in schild))
    print(f'{name:8s} ' + '  '.join(
        f'{k} {v:+.4f} ({v * SKALA * 100:+.1f} cm)' for k, v in tief.items()))

# ── Material aus der "-roh"-Datei ───────────────────────────────────
# Herleitung im Kopfkommentar. Uebernommen werden BaseColor und
# MetallicRoughness; die Emissionskarte der roh-Datei ist schwarz und
# waere nur Ballast.
vorher = set(bpy.data.objects), set(bpy.data.images)
bpy.ops.import_scene.gltf(filepath=ROH)
neu = [o for o in bpy.data.objects if o not in vorher[0]]
roh_bilder = {i.name: i for i in bpy.data.images if i not in vorher[1]}
BASIS = next(i for n, i in roh_bilder.items() if 'BaseColor' in n)
MERO = next((i for n, i in roh_bilder.items() if 'MetallicRoughness' in n), None)
print(f'\nMATERIAL: aus {os.path.basename(ROH)} uebernommen — BaseColor '
      f'{BASIS.size[0]}x{BASIS.size[1]}'
      + (f', MetallicRoughness {MERO.size[0]}x{MERO.size[1]}' if MERO else '')
      + '; die Emissionskarte der roh-Datei ist schwarz und faellt weg')

mat = mesh.data.materials[0]
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
for n in [n for n in nt.nodes if n.type in ('TEX_IMAGE', 'SEPARATE_COLOR')]:
    nt.nodes.remove(n)
tex = nt.nodes.new('ShaderNodeTexImage')
tex.image = BASIS
BASIS.colorspace_settings.name = 'sRGB'
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
if MERO:
    # glTF packt Rauheit nach G und Metall nach B. Der Umweg ueber
    # "Separate Color" ist genau die Zerlegung, die der glTF-Export
    # wiedererkennt und als metallicRoughnessTexture zurueckschreibt.
    mr = nt.nodes.new('ShaderNodeTexImage')
    mr.image = MERO
    MERO.colorspace_settings.name = 'Non-Color'
    trenn = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(mr.outputs['Color'], trenn.inputs['Color'])
    nt.links.new(trenn.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(trenn.outputs['Blue'], bsdf.inputs['Metallic'])
else:
    bsdf.inputs['Metallic'].default_value = 0.0
# alphaMode OPAQUE: Der Alphakanal der Meshy-Karte hat 306 von 16,8 Mio
# Texeln unter 0,99 — es gibt nichts Durchsichtiges zu sortieren, und
# BLEND kostet eine Sortierung je Bild.
bsdf.inputs['Alpha'].default_value = 1.0
bsdf.inputs['Emission Strength'].default_value = 0.0
bsdf.inputs['Emission Color'].default_value = (0.0, 0.0, 0.0, 1.0)
bsdf.inputs['Specular Tint'].default_value = (1.0, 1.0, 1.0, 1.0)
bsdf.inputs['Specular IOR Level'].default_value = 0.5
mat.blend_method = 'OPAQUE'
mat.use_backface_culling = False
for o in neu:
    bpy.data.objects.remove(o, do_unlink=True)
for img in list(bpy.data.images):
    if img.users == 0:
        bpy.data.images.remove(img)
print('MATERIAL: emissive aus, alphaMode OPAQUE, Specular Tint 1,0, '
      'doubleSided bleibt (die Blattfransen brauchen es)')

# ── Export ──────────────────────────────────────────────────────────
szene.frame_set(1)
arm.animation_data.action = gebacken['idle']
szene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(
    filepath=OUT,
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
print(f'\nFERTIG {OUT} — {os.path.getsize(OUT) / 1e6:.2f} MB, '
      f'{len(REIHENFOLGE)} Clips ({", ".join(REIHENFOLGE)}), '
      f'{len(arm.data.bones)} Knochen; Koerperhoehe {HOEHE * SKALA:.3f} m bei '
      f'localScale {SKALA}')
