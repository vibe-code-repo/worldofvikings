"""
Wo sitzt die Oeffnung eines Bauteils WIRKLICH — in Spielkoordinaten?

Nicht in Blender, nicht in der Absicht des Erzeugerskripts, sondern in der
exportierten GLB. Werkzeug und Kit teilen dieselbe Annahme darueber, was
`export_yup` mit den Achsen macht; stimmt sie nicht, stimmen beide
gleichlautend nicht, und der Zusammenbau sieht trotzdem richtig aus.
Diese Messung fragt die Datei.

    blender --background --factory-startup --python oeffnung-messen.py -- \
        --glb .../SteingrabEndkappe.glb --hoehe 4

Verfahren: An jeder der vier senkrechten Huellflaechen wird gezaehlt, wie
viel Dreiecksflaeche in einer duennen Scheibe davor liegt, und zwar nur auf
Kopfhoehe (0,5 bis 3,0 m). Eine zugemauerte Seite traegt dort Wand; eine
offene traegt fast nichts.
"""
import sys
import os

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    key = f'--{name}'
    if key in argv:
        i = argv.index(key)
        if i + 1 < len(argv):
            return argv[i + 1]
    return default


GLB = arg('glb')
UNTEN, OBEN = 0.5, 3.0      # Kopfhoehe, in Spiel-y
SCHEIBE = 0.45              # Tiefe der Scheibe vor der Huellflaeche

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

# Blender ist Z-hoch, die importierte Datei steht wieder in Blender-Achsen.
# Zurueck nach glTF (Y-hoch): (bx, by, bz) -> (bx, bz, -by).
#
# Und dann die x-SPIEGELUNG. Sie ist der Grund, warum diese Datei ueberhaupt
# existiert: Der Client legt beim Laden einen `__root__`-Knoten mit
# Determinante -1 ueber jedes Modell (gemessen in
# `mess/babylon-orientierung.ts`), die Positionen aus dem ZDO bleiben
# dagegen unveraendert. Eigene Bauteile werden deshalb seitenverkehrt
# gesetzt, wenn sie nicht schon gespiegelt exportiert wurden — s.
# `steingrab-erzeugen.py`, `in_spielachsen_spiegeln`.
#
# Hier wird also in SPIELACHSEN gemessen, nicht in Dateiachsen. Nur so
# stehen die Seiten, die dieses Werkzeug meldet, in derselben Sprache wie
# die Connectors in `shared/src/eigeneDungeons.ts`.
def nach_spiel(p):
    return Vector((-p.x, p.z, -p.y))


dreiecke = []
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH':
        continue
    tiefe = bpy.context.evaluated_depsgraph_get()
    netz = obj.evaluated_get(tiefe).to_mesh()
    netz.calc_loop_triangles()
    for t in netz.loop_triangles:
        ecken = [nach_spiel(obj.matrix_world @ netz.vertices[i].co) for i in t.vertices]
        mitte = (ecken[0] + ecken[1] + ecken[2]) / 3
        flaeche = (ecken[1] - ecken[0]).cross(ecken[2] - ecken[0]).length / 2
        dreiecke.append((mitte, flaeche))
    obj.evaluated_get(tiefe).to_mesh_clear()

xs = [m.x for m, _ in dreiecke]
ys = [m.y for m, _ in dreiecke]
zs = [m.z for m, _ in dreiecke]
print(f'\n{os.path.basename(GLB)} — {len(dreiecke)} Dreiecke')
print(f'  Huelle in Spielkoordinaten: '
      f'x {min(xs):+.2f}…{max(xs):+.2f}  y {min(ys):+.2f}…{max(ys):+.2f}  z {min(zs):+.2f}…{max(zs):+.2f}')

seiten = {
    '+x (Ost)':  ('x', max(xs)),
    '-x (West)': ('x', min(xs)),
    '+z (Sued im Spiel)': ('z', max(zs)),
    '-z (Nord im Spiel)': ('z', min(zs)),
}

print(f'  Wandflaeche in einer {SCHEIBE:.2f} m tiefen Scheibe, Hoehe {UNTEN}…{OBEN} m:')
werte = {}
for name, (achse, ebene) in seiten.items():
    summe = 0.0
    for mitte, flaeche in dreiecke:
        if not (UNTEN <= mitte.y <= OBEN):
            continue
        wert = mitte.x if achse == 'x' else mitte.z
        if abs(wert - ebene) <= SCHEIBE:
            summe += flaeche
    werte[name] = summe

groesste = max(werte.values()) or 1.0
for name, summe in werte.items():
    anteil = summe / groesste
    urteil = 'OFFEN' if anteil < 0.25 else 'zu'
    print(f'    {name:22s} {summe:8.2f} m²  ({anteil * 100:5.1f} %)  {urteil}')
