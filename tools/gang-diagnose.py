#!/usr/bin/env blender --background --python
"""
Misst einen Laufzyklus nach: Fussrutschen, Bodenkontakt, Sohlenneigung,
Beinkette, Gewichte.

    blender --background --python tools/gang-diagnose.py -- \
        assets/models/Surtr.glb walk [--tempo 1.5] [--scale 9]

── Wozu ─────────────────────────────────────────────────────────────
"Sieht komisch aus" ist keine Diagnose. Ein Gang hat vier Fehlerquellen,
die man einzeln MESSEN kann, und die Zahlen sagen jedesmal etwas anderes:

* Fussrutschen — der Standfuss muss sich im Koerperraum genau so schnell
  nach hinten bewegen, wie der Server die Figur nach vorn schiebt
  (`--tempo`, Vorgabe ROUTE_DEFAULT_SPEED). Weicht er ab, schlittert er.
* Bodenkontakt — der Prefab-Ursprung liegt auf z = 0. Alles darunter
  steckt im Boden, alles darueber ist Luft unter der Sohle.
* Sohlenneigung — ein Fuss ohne KNOECHELGELENK haengt starr am
  Unterschenkel und kippt in der Standphase mit ihm mit. Die Spanne des
  Winkels in der Standphase ist der direkte Beleg dafuer.
* Gewichte — reicht der Einfluss eines Beinknochens in den anderen Fuss?

Gemessen wird ausschliesslich an der EVALUIERTEN Geometrie (Depsgraph),
nicht an den Knochen: Was der Spieler sieht, ist die Haut.

Die Blickrichtung wird als -y angenommen (Engine-Konvention nach der
Blickdrehung, s. tools/surtr-rig.py).
"""
import sys
import math

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PFAD = argv[0]
AKTION = argv[1] if len(argv) > 1 else 'walk'


def arg(name, default):
    return float(argv[argv.index(name) + 1]) if name in argv else default


TEMPO = arg('--tempo', 1.5)      # m/s, ROUTE_DEFAULT_SPEED
SKALA = arg('--scale', 9.0)      # PrefabDef.localScale
# Ab wann gilt eine Sohle als "am Boden"? 5 cm im SPIELMASSSTAB — das ist
# die Groessenordnung, in der ein Riesenfuss ohnehin im Gras verschwindet,
# und klein genug, dass ein abhebender Fuss nicht mehr mitzaehlt.
BERUEHRUNG = 0.05 / SKALA

bpy.ops.wm.read_factory_settings(use_empty=True)
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=PFAD)
mesh = max([o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.vertices)],
           key=lambda o: len(o.data.vertices))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')

print('=== SKELETT ===')
print(f'{len(arm.data.bones)} Knochen: {[b.name for b in arm.data.bones]}')
for b in arm.data.bones:
    kette = []
    p = b
    while p:
        kette.append(p.name)
        p = p.parent
    print(f'  {b.name:8s} Kopf {tuple(round(x,3) for x in b.head_local)} '
          f'Spitze {tuple(round(x,3) for x in b.tail_local)} '
          f'Laenge {b.length:.3f}  Kette: {" < ".join(kette[1:]) or "(Wurzel)"}')

BEINTEILE = ('bein', 'schien', 'fuss', 'zeh', 'leg', 'foot', 'toe', 'shin')
beine = [b for b in arm.data.bones if any(t in b.name.lower() for t in BEINTEILE)]
print(f'\nBeinknochen: {len(beine)} insgesamt, also {len(beine)//2} je Bein.')
print('Gelenke je Bein = Knochenzahl (Huefte, dann je Uebergang).')
print('  2 (Huefte, Knie)                      — Beinlaenge FEST. Das Becken')
print('                                          muss bei jedem Schritt steigen')
print('                                          ODER der Fuss faehrt durch den')
print('                                          Boden. Und die Sohle kippt mit')
print('                                          jedem Kniebeugen mit.')
print('  3 (+ Knoechel)                        — Sohle kann flach bleiben, Bein')
print('                                          kann sich verkuerzen.')
print('  4 (+ Zehenballen)                     — dazu Abrollen: Fersenauftritt,')
print('                                          flache Sohle, Abstoss ueber die')
print('                                          Zehen.')

akt = next(a for a in bpy.data.actions if AKTION in a.name)
arm.animation_data_create()
arm.animation_data.action = akt
f0, f1 = int(akt.frame_range[0]), int(akt.frame_range[1])
fps = bpy.context.scene.render.fps
dauer = (f1 - f0) / fps
print(f'\n=== AKTION {akt.name}: Frames {f0}..{f1} bei {fps} fps = {dauer:.3f} s ===')

# ── Marker: Zehe und Ferse je Fuss, in der Ruhelage bestimmt ────────
bpy.context.scene.frame_set(f0)
ruhe = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
zmin = min(v.z for v in ruhe)
zmax = max(v.z for v in ruhe)
sohle = [i for i, v in enumerate(ruhe) if v.z < zmin + 0.05 * (zmax - zmin)]
# Nach der Blickdrehung schaut das Modell nach -y; seine Fuesse trennen
# sich entlang x.
mx = sum(ruhe[i].x for i in sohle) / len(sohle)
fuss_a = [i for i in sohle if ruhe[i].x < mx]
fuss_b = [i for i in sohle if ruhe[i].x >= mx]
marker = {}
for name, s in (('A', fuss_a), ('B', fuss_b)):
    # Ferse und Zehe muessen BEIDE auf der Sohle liegen, sonst misst die
    # Neigung zwischen ihnen nichts. Der hinterste Vertex des Fusses ist
    # naemlich nicht die Ferse, sondern die OBERKANTE der Hacke — die
    # steht beim rechten Fuss 3,5 cm hoeher als die Sohle und kann darum
    # nie den Boden beruehren. Kandidaten sind deshalb nur Vertices im
    # untersten Zentimeter DIESES Fusses.
    # Zuerst das vordere bzw. hintere Fuenftel des Fusses nehmen, DANN
    # darin den tiefsten Vertex. Andersherum (erst tief, dann aussen)
    # landet man auf der Oberkante der Hacke, weil die Sohle sich dort
    # nach oben biegt.
    nach_y = sorted(s, key=lambda i: ruhe[i].y)
    k = max(3, len(s) // 5)
    marker[f'Zehe{name}'] = min(nach_y[:k], key=lambda i: ruhe[i].z)   # vorn = -y
    marker[f'Ferse{name}'] = min(nach_y[-k:], key=lambda i: ruhe[i].z)
for k, i in marker.items():
    print(f'Marker {k}: v{i} @ {tuple(round(x,3) for x in ruhe[i])}')


def geometrie(f):
    bpy.context.scene.frame_set(f)
    dgl = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dgl)
    m = ev.to_mesh()
    pkt = {k: mesh.matrix_world @ m.vertices[i].co.copy() for k, i in marker.items()}
    fa = [mesh.matrix_world @ m.vertices[i].co.copy() for i in fuss_a]
    fb = [mesh.matrix_world @ m.vertices[i].co.copy() for i in fuss_b]
    ev.to_mesh_clear()
    return pkt, fa, fb


# ── Fussrutschen ────────────────────────────────────────────────────
# Der Koerper wandert mit TEMPO nach vorn; in Modelleinheiten ist das
# TEMPO/SKALA. Ein Standfuss muss sich im Modellraum GENAU so schnell nach
# hinten bewegen — jede Abweichung ist Rutschen.
# Das Modell schaut nach -y (Blickdrehung), der Koerper wandert also
# nach -y. Ein weltfester Standfuss laeuft im KOERPERRAUM mit +soll nach
# hinten. Abweichungen davon sind Rutschen.
soll = TEMPO / SKALA / fps          # Einheiten je Bild
print(f'\nSollversatz je Bild: {soll:.5f} Einheiten ({soll*SKALA:.3f} m bei {TEMPO} m/s)')
print(f'\n{"f":>4}{"t/T":>6} | {"ZeheA y":>9}{"z":>8}{"dy/Bild":>9}{"Fehler":>8} | '
      f'{"ZeheB y":>9}{"z":>8}{"dy/Bild":>9}{"Fehler":>8} | {"Sohle A":>8}{"Sohle B":>8}')

vor = None
werte = []
for f in range(f0, f1 + 1):
    pkt, fa, fb = geometrie(f)
    if vor is not None:
        dA = pkt['ZeheA'].y - vor['ZeheA'].y
        dB = pkt['ZeheB'].y - vor['ZeheB'].y
    else:
        dA = dB = 0.0
    # Neigung der Sohle: Winkel Ferse->Zehe gegen die Waagerechte
    nA = math.degrees(math.atan2(pkt['ZeheA'].z - pkt['FerseA'].z,
                                 abs(pkt['ZeheA'].y - pkt['FerseA'].y) or 1e-6))
    nB = math.degrees(math.atan2(pkt['ZeheB'].z - pkt['FerseB'].z,
                                 abs(pkt['ZeheB'].y - pkt['FerseB'].y) or 1e-6))
    werte.append((f, pkt, dA, dB, nA, nB, min(v.z for v in fa), min(v.z for v in fb)))
    vor = pkt

for f, pkt, dA, dB, nA, nB, zA, zB in werte[::max(1, (f1 - f0) // 18)]:
    t = (f - f0) / (f1 - f0)
    print(f'{f:4d}{t:6.2f} | {pkt["ZeheA"].y:9.3f}{zA:8.3f}{dA:9.5f}{dA - soll:8.5f} | '
          f'{pkt["ZeheB"].y:9.3f}{zB:8.3f}{dB:9.5f}{dB - soll:8.5f} | {nA:8.1f}{nB:8.1f}')

print('\n=== KENNZAHLEN ===')
for idx, name in ((2, 'Fuss A'), (3, 'Fuss B')):
    d = [w[idx] for w in werte[1:]]
    spanne = max(d) - min(d)
    # Standphase = Bilder, in denen der Fuss am tiefsten Punkt ist
    zi = 6 if idx == 2 else 7
    zs = [w[zi] for w in werte]
    zg = min(zs) + 0.012
    stand = [i for i, w in enumerate(werte) if w[zi] <= zg]
    rutsch = [abs(werte[i][idx] - soll) for i in stand if i > 0]
    print(f'{name}: Vorwaerts-Schrittweite {max(w[1]["Zehe" + name[-1]].y for w in werte) - min(w[1]["Zehe" + name[-1]].y for w in werte):.4f} '
          f'Einheiten = {(max(w[1]["Zehe" + name[-1]].y for w in werte) - min(w[1]["Zehe" + name[-1]].y for w in werte)) * SKALA:.2f} m')
    print(f'  Standphase: {len(stand)} von {len(werte)} Bildern ({len(stand)/len(werte)*100:.0f} %)')
    if rutsch:
        print(f'  Rutschen in der Standphase: im Mittel {sum(rutsch)/len(rutsch)*SKALA*fps:.2f} m/s, '
              f'maximal {max(rutsch)*SKALA*fps:.2f} m/s  (0 waere perfekt, '
              f'{TEMPO:.1f} m/s hiesse "Fuss steht still im Koerperraum")')
    print(f'  Fusshoehe: min {min(zs):.4f} ({min(zs)*SKALA:+.2f} m), '
          f'max {max(zs):.4f} ({max(zs)*SKALA:+.2f} m)')
    n = [w[4 if idx == 2 else 5] for w in werte]
    print(f'  Sohlenneigung: {min(n):+.1f} .. {max(n):+.1f} Grad, Spanne {max(n)-min(n):.1f} Grad '
          f'(ein flach abrollender Fuss bleibt in der Standphase nahe 0)')
    ns = [n[i] for i in stand]
    if ns:
        print(f'    davon in der Standphase: {min(ns):+.1f} .. {max(ns):+.1f} Grad')
    v = [w[idx] * SKALA * fps for w in werte[1:]]
    print(f'  Fussgeschwindigkeit im Koerperraum: {min(v):+.2f} .. {max(v):+.2f} m/s '
          f'(Sollwert waere in der Standphase konstant {TEMPO:+.2f})')

    # ── Der Wert, den der Spieler sieht: RUTSCHWEG ──────────────────
    # Nicht die Momentangeschwindigkeit, sondern der Weg, den die Sohle
    # ueber den Boden schleift, waehrend sie stehen sollte. `dy - soll`
    # IST schon die Weltverschiebung je Bild (der Koerper wandert mit
    # soll nach -y, ein weltfester Fuss also mit +soll im Koerperraum),
    # also ist die Summe der Betraege der geschliffene Weg.
    #
    # Die Standphase wird dafuer ENGER gefasst als oben: Bodenkontakt
    # heisst hier, dass die Sohle hoechstens BERUEHRUNG ueber dem Gelaende
    # steht. Die 0,012 Modelleinheiten oben sind 11 cm im Spiel und zaehlen
    # den schon abhebenden Fuss mit; dessen Vorwaertsfahrt ist kein
    # Rutschen, sondern Schwungphase.
    kontakt = [i for i, w in enumerate(werte) if w[zi] <= BERUEHRUNG]
    weg = sum(abs(werte[i][idx] - soll) for i in kontakt if i > 0) * SKALA
    print(f'  BODENKONTAKT (Sohle <= {BERUEHRUNG * SKALA * 100:.0f} cm ueber Gelaende): '
          f'{len(kontakt)} von {len(werte)} Bildern '
          f'({len(kontakt)/len(werte)*100:.0f} %)')
    print(f'  RUTSCHWEG darin: {weg * 100:.1f} cm ueber den ganzen Zyklus '
          f'(0 waere perfekt)')
    # Flach aufliegend = Ferse UND Zehe am Boden. Nur dann muss die Sohle
    # waagerecht sein; beim Fersenauftritt und beim Abstoss ueber den
    # Ballen ist eine schraege Sohle richtig und gewollt.
    # "Am Boden" heisst fuer Ferse und Zehe nicht z = 0: Die Stiefelsohle
    # biegt sich an beiden Enden nach oben, die Ferse liegt in der
    # Ruhelage schon 1 bis 2 cm hoeher als der tiefste Punkt des Fusses.
    # Gemessen wird deshalb gegen die RUHEHOEHE des jeweiligen Vertex.
    tief_ruhe = min(ruhe[i].z for i in s)
    z_ferse = [w[1][f'Ferse{name[-1]}'].z for w in werte]
    z_zehe = [w[1][f'Zehe{name[-1]}'].z for w in werte]
    gf = ruhe[marker[f'Ferse{name[-1]}']].z - tief_ruhe + BERUEHRUNG
    gz = ruhe[marker[f'Zehe{name[-1]}']].z - tief_ruhe + BERUEHRUNG
    flach = [i for i in kontakt if z_ferse[i] <= gf and z_zehe[i] <= gz]
    if flach:
        nf = [n[i] for i in flach]
        print(f'  Sohle flach aufliegend in {len(flach)} Bildern '
              f'({len(flach)/len(werte)*100:.0f} %), Neigung darin '
              f'{min(nf):+.1f} .. {max(nf):+.1f} Grad')
    else:
        print('  Sohle liegt in KEINEM Bild flach auf (weder Ferse noch Zehe '
              'gleichzeitig am Boden) — der Fuss kippt nur, er rollt nicht ab')

# ── Gewichte: reicht ein Bein in den anderen Fuss? ──────────────────
print('\n=== GEWICHTE AN DEN FUESSEN ===')
gname = [g.name for g in mesh.vertex_groups]
for name, s in (('Fuss A (Modell -x)', fuss_a), ('Fuss B (Modell +x)', fuss_b)):
    summe = {}
    for i in s:
        for g in mesh.data.vertices[i].groups:
            summe[gname[g.group]] = summe.get(gname[g.group], 0.0) + g.weight
    ges = sum(summe.values()) or 1.0
    top = sorted(summe.items(), key=lambda t: -t[1])[:6]
    print(f'{name}: {len(s)} Vertices — ' +
          ', '.join(f'{k} {v/ges*100:.1f} %' for k, v in top))
