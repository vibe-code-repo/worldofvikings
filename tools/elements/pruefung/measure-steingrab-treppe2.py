# Prüft: dieselbe Treppe zweitmeinend — je z-Probe ALLE nach oben und nach unten zeigenden Flächen getrennt, weil die „höchste Fläche"-Heuristik den Boden verschwieg.
# Zweite Messung: an jeder z-Probe ueber x=0 ALLE nach oben und ALLE nach
# unten zeigenden Flaechen auflisten (baryzentrisch interpoliert). Erst so
# sieht man Boden, Podeste, Lauf und Decke getrennt — die "hoechste
# Flaeche"-Heuristik der ersten Messung hat am unteren Ende die OBERSEITE
# der Decke erwischt und den Boden verschwiegen.
import bpy, sys, collections

GLB = sys.argv[sys.argv.index("--") + 1:][0]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)


def gltf(v):
    return (v.x, v.z, -v.y)


o = [x for x in bpy.data.objects if x.type == "MESH" and not x.name.endswith("_col")][0]
me = o.data
me.calc_loop_triangles()
tris = []
for t in me.loop_triangles:
    g = [gltf(o.matrix_world @ me.vertices[i].co) for i in t.vertices]
    n = t.normal
    tris.append((g, (-n.x, -n.z, n.y)))
print(f"Mesh {o.name}: {len(tris)} tris")


def hoehe_ueber(g, x, z):
    (ax, ay, az), (bx, by, bz), (cx, cy, cz) = g
    det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if abs(det) < 1e-12:
        return None
    u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det
    v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det
    w = 1.0 - u - v
    if min(u, v, w) < -1e-6:
        return None
    return u * ay + v * by + w * cy


def scan(x, z):
    auf, ab = [], []
    for g, n in tris:
        if abs(n[1]) < 0.5:
            continue
        y = hoehe_ueber(g, x, z)
        if y is None:
            continue
        (auf if n[1] > 0 else ab).append(round(y, 3))
    return sorted(set(auf)), sorted(set(ab))


for XP in (0.0, 1.0, 1.6):
    print(f"\n########## Schnitt bei x={XP}")
    for i in range(0, 241):
        z = -6.0 + i * 0.05
        if abs(z * 4 - round(z * 4)) > 1e-6:
            pass
        auf, ab = scan(XP, z)
        if i % 4 == 0 or i in (1, 239):
            print(f"  z={z:+6.2f}  AUF={auf}")
            print(f"           AB ={ab}")
