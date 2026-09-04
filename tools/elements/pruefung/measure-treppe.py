# Prüft: SteingrabTreppe.glb auf glTF-Hüllbox, signiertes Volumen, Flächen und Höhenprofil.
# Misst SteingrabTreppe.glb headless: glTF-BBox, Signed Volume, Faces und
# das Hoehenprofil (wo liegen die beiden Ebenen, wie hoch ist eine Stufe).
# flatpak run org.blender.Blender --factory-startup -b --python measure-treppe.py -- <glb>
import bpy, sys

GLB = sys.argv[sys.argv.index("--") + 1:][0]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)


def gltf(v):
    return (v.x, v.z, -v.y)


for o in [x for x in bpy.data.objects if x.type == "MESH"]:
    me = o.data
    pts = [gltf(o.matrix_world @ v.co) for v in me.vertices]
    mi = [min(p[i] for p in pts) for i in range(3)]
    ma = [max(p[i] for p in pts) for i in range(3)]
    me.calc_loop_triangles()
    vol = 0.0
    for t in me.loop_triangles:
        a, b, c = (o.matrix_world @ me.vertices[i].co for i in t.vertices)
        vol += a.dot(b.cross(c)) / 6.0
    print(f"=== {o.name}")
    print(f"  GLTF-BBOX x=[{mi[0]:.4f},{ma[0]:.4f}] y=[{mi[1]:.4f},{ma[1]:.4f}] "
          f"z=[{mi[2]:.4f},{ma[2]:.4f}]")
    print(f"  signed_volume={vol:.4f}  verts={len(me.vertices)} faces={len(me.polygons)}")
    print(f"  materialslots={len(me.materials)}")

    # Hoehenprofil: fuer z-Scheiben von 0,5 m die begehbare Oberflaeche —
    # hoechste nach OBEN zeigende Flaeche unterhalb von y = 6 in Zellmitte.
    import collections
    prof = collections.defaultdict(list)
    for t in me.loop_triangles:
        vs = [o.matrix_world @ me.vertices[i].co for i in t.vertices]
        g = [gltf(v) for v in vs]
        # Normale in glTF-Achsen
        # Normale in glTF-Achsen, Wicklung gedreht: die GLBs sind in x
        # vorgespiegelt, im Import zeigen alle Normalen nach INNEN. Ohne das
        # Minus misst man die Unterseiten der Stufen statt der Trittflaechen.
        n = t.normal
        ng = (-n.x, -n.z, n.y)
        if ng[1] < 0.7:
            continue
        cx = sum(p[0] for p in g) / 3
        cy = sum(p[1] for p in g) / 3
        cz = sum(p[2] for p in g) / 3
        if abs(cx) > 0.9:
            continue
        prof[round(cz * 2) / 2].append(cy)
    print("  Oben zeigende Flaechen (z-Scheibe -> y-Werte, |x|<0.9):")
    for z in sorted(prof):
        ys = sorted(set(round(y, 3) for y in prof[z]))
        print(f"    z={z:+6.1f}  y={ys}")

    # y-Histogramm aller Vertices
    hist = collections.Counter(round(p[1], 3) for p in pts)
    print(f"  y-Werte (Top 30): {sorted(hist.items())[:30]}")
