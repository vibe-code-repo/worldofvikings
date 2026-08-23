#!/usr/bin/env blender --background --python
"""
Baut ein Sax — das wikingerzeitliche Messer — als Spielmodell.

    blender --background --python tools/messer-erzeugen.py -- \
        --aus assets/models/Messer.glb [--laenge 0.28]

════════════════════════════════════════════════════════════════════
 Warum prozedural und nicht aus Meshy
════════════════════════════════════════════════════════════════════
Ein Messer ist eine Klinge, ein Zwischenstueck und ein Griff — Formen,
die sich in dreissig Zeilen exakt beschreiben lassen. Ein Generator
liefert dafuer ein verschweisstes Netz mit vierstelliger Dreieckszahl,
das man hinterher aufraeumen muss, und trifft die Masse nicht.

Hier stimmen sie per Konstruktion: Ein Sax der Wikingerzeit misst 20 bis
35 cm; gebaut wird auf `--laenge` (Vorgabe 28 cm), Klinge zu Griff etwa
60:40.

════════════════════════════════════════════════════════════════════
 Der Massstab — warum echte Meter
════════════════════════════════════════════════════════════════════
AvatarRig haengt gehaltene Gegenstaende an `handR`, und dort steht:

    this.handR.scaling.setAll(1 / this.modellSkalierung);

Der Halter skaliert das Figurenmodell auf Spielergroesse, der Gegenstand
bringt seine eigene, bereits richtige Groesse mit und darf nicht ein
zweites Mal mitwachsen. Ein Modell in Modelleinheiten (Figur = 1,0) waere
hier also achtzehnmal zu gross.

════════════════════════════════════════════════════════════════════
 Ausrichtung
════════════════════════════════════════════════════════════════════
Der Griff liegt um den URSPRUNG, die Klinge zeigt nach +Y. So braucht
`holdRotation` in itemDefs.ts nur die Faustdrehung und keine
Verschiebung, um den Griff erst in die Hand zu holen — bei der Hacke
steht dort `holdPosition: [0, -0.05, 0.12]`, weil ihr Modell den
Ursprung am Kopf hat.

════════════════════════════════════════════════════════════════════
 Warum der Klingenquerschnitt ein Keil ist und kein Quader
════════════════════════════════════════════════════════════════════
Ein Quader haette zwei sichtbare Kanten statt einer Schneide und saehe
bei jeder Beleuchtung aus wie ein Lineal. Der Keil kostet nichts: Ruecken
und Schneide sind dieselbe Punktreihe, nur mit Dicke null an der
Schneide.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


AUS = arg('--aus', 'assets/models/Messer.glb')
LAENGE = float(arg('--laenge', '0.28'))

L_KLINGE = LAENGE * 0.60
L_GRIFF = LAENGE * 0.36
L_ZWINGE = LAENGE * 0.04
B_KLINGE = 0.030          # Klingenbreite am Ansatz
D_KLINGE = 0.0042         # Ruecken-Dicke
R_GRIFF = 0.0125          # Griffradius in der Mitte

bpy.ops.wm.read_factory_settings(use_empty=True)
bm = bmesh.new()


def achteck(z, radius, stauchung=0.72):
    """Ein Ring aus acht Punkten — Griffe sind nie rund, sondern
    kantig und im Querschnitt oval (liegt besser in der Faust)."""
    return [bm.verts.new((math.cos(a) * radius,
                          z,
                          math.sin(a) * radius * stauchung))
            for a in (math.pi * 2 * i / 8 for i in range(8))]


def bruecke(a, b):
    for i in range(len(a)):
        bm.faces.new((a[i], a[(i + 1) % len(a)], b[(i + 1) % len(b)], b[i]))


# ── Griff: leicht bauchig, damit er nicht wie ein Rohr wirkt ────────
GRIFF_RINGE = 5
ringe = []
for i in range(GRIFF_RINGE):
    t = i / (GRIFF_RINGE - 1)
    y = -L_GRIFF + t * L_GRIFF
    # Bauch in der Mitte, an beiden Enden schmaler
    bauch = 1.0 - 0.22 * abs(t - 0.5) * 2
    ringe.append(achteck(y, R_GRIFF * bauch))
for i in range(GRIFF_RINGE - 1):
    bruecke(ringe[i], ringe[i + 1])
# Knauf schliessen
bmesh.ops.contextual_create(bm, geom=ringe[0])

# ── Zwinge: kurzer, breiterer Ring zwischen Griff und Klinge ────────
zwinge_a = achteck(0.0, R_GRIFF * 1.18)
zwinge_b = achteck(L_ZWINGE, R_GRIFF * 1.05)
bruecke(ringe[-1], zwinge_a)
bruecke(zwinge_a, zwinge_b)

# ── Klinge: Keilquerschnitt, gebrochener Ruecken ────────────────────
#
# Der "broken back" ist das Erkennungszeichen des Sax: Der Ruecken laeuft
# gerade und knickt im letzten Drittel scharf zur Spitze ab, waehrend die
# Schneide durchgehend gerade bleibt.
STATIONEN = 9
KNICK = 0.62                     # ab hier faellt der Ruecken

ruecken_oben, ruecken_unten, schneide = [], [], []
for i in range(STATIONEN):
    t = i / (STATIONEN - 1)
    y = L_ZWINGE + t * L_KLINGE
    if t <= KNICK:
        hoehe = B_KLINGE * (1.0 - 0.06 * t)
    else:
        # linear auf die Spitze zu
        rest = (t - KNICK) / (1.0 - KNICK)
        hoehe = B_KLINGE * (1.0 - 0.06 * KNICK) * (1.0 - rest)
    dicke = D_KLINGE * (1.0 - 0.55 * t) * 0.5
    breite_unten = R_GRIFF * 0.35      # Schneide sitzt leicht unter der Achse
    ruecken_oben.append(bm.verts.new((dicke, y, hoehe - breite_unten)))
    ruecken_unten.append(bm.verts.new((-dicke, y, hoehe - breite_unten)))
    schneide.append(bm.verts.new((0.0, y, -breite_unten)))

for i in range(STATIONEN - 1):
    bm.faces.new((ruecken_oben[i], ruecken_oben[i + 1],
                  ruecken_unten[i + 1], ruecken_unten[i]))       # Ruecken
    bm.faces.new((ruecken_oben[i], schneide[i],
                  schneide[i + 1], ruecken_oben[i + 1]))         # Flanke +
    bm.faces.new((ruecken_unten[i + 1], schneide[i + 1],
                  schneide[i], ruecken_unten[i]))                # Flanke -
# Uebergang Zwinge → Klingenansatz schliessen
bm.faces.new((ruecken_oben[0], ruecken_unten[0], schneide[0]))

bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

netz = bpy.data.meshes.new('Messer')
bm.to_mesh(netz)
bm.free()
obj = bpy.data.objects.new('Messer', netz)
bpy.context.collection.objects.link(obj)

# ── Zwei Materialien: Stahl und Leder ───────────────────────────────
# Reine Basisfarben, keine Textur — bei einem Gegenstand, der in der
# Faust 3 cm gross ist, waere eine 2k-Karte reine Verschwendung.
def material(name, farbe, metall, rauheit):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*farbe, 1.0)
    b.inputs['Metallic'].default_value = metall
    b.inputs['Roughness'].default_value = rauheit
    return m


stahl = material('messer_stahl', (0.62, 0.64, 0.67), 1.0, 0.28)
leder = material('messer_leder', (0.21, 0.13, 0.08), 0.0, 0.72)
netz.materials.append(leder)
netz.materials.append(stahl)
# Alles ab der Zwinge ist Stahl — die Grenze ist die Y-Koordinate.
for p in netz.polygons:
    mitte = sum((netz.vertices[i].co for i in p.vertices), Vector()) / len(p.vertices)
    p.material_index = 1 if mitte.y > L_ZWINGE * 0.5 else 0

for p in netz.polygons:
    p.use_smooth = False        # Ein Messer hat Facetten, keine Rundungen.

P = [v.co for v in netz.vertices]
print('MESSER %d Vertices, %d Flaechen' % (len(netz.vertices), len(netz.polygons)))
print('  Ausdehnung  x %.4f  y %.4f  z %.4f'
      % (max(p.x for p in P) - min(p.x for p in P),
         max(p.y for p in P) - min(p.y for p in P),
         max(p.z for p in P) - min(p.z for p in P)))
print('  Griff von y %.3f bis 0, Klinge bis y %.3f'
      % (-L_GRIFF, L_ZWINGE + L_KLINGE))

bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=AUS, export_format='GLB', use_selection=True,
                          export_yup=True, export_animations=False)
print('GESCHRIEBEN %s — %.1f kB' % (AUS, os.path.getsize(AUS) / 1024))
