# Prüft: SteingrabTreppe.glb auf alles, was das `_col`-Netz braucht — Trittprofil, Podeste, Innenmaß, Deckenunterkante und die Steigrichtung.
# Misst SteingrabTreppe.glb headless und liefert alles, was das
# `_col`-Netz braucht: Trittflaechen-Profil y(z) in der Mitte, Podeste,
# Innenmass der Seitenwaende, Deckenunterkante, Boden am unteren Ende,
# und vor allem die RICHTUNG (steigt das Modell nach +z oder -z?).
#
# Achsen: der glTF-Import dreht Y-up nach Z-up.
#   gltf_x = blender_x, gltf_y = blender_z, gltf_z = -blender_y
#
# FALLE: Die GLBs sind in x VORGESPIEGELT, ohne die Wicklung zu drehen —
# im Import zeigen deshalb ALLE Normalen nach INNEN. Ohne das Negieren
# misst man die Unterseiten der Stufen statt der Trittflaechen.
#
# flatpak run org.blender.Blender --factory-startup -b --python <dies> -- <glb>
import bpy, sys, collections, math

GLB = sys.argv[sys.argv.index("--") + 1:][0]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)


def gltf(v):
    return (v.x, v.z, -v.y)


for o in [x for x in bpy.data.objects if x.type == "MESH"]:
    me = o.data
    me.calc_loop_triangles()
    pts = [gltf(o.matrix_world @ v.co) for v in me.vertices]
    mi = [min(p[i] for p in pts) for i in range(3)]
    ma = [max(p[i] for p in pts) for i in range(3)]
    vol = 0.0
    for t in me.loop_triangles:
        a, b, c = (o.matrix_world @ me.vertices[i].co for i in t.vertices)
        vol += a.dot(b.cross(c)) / 6.0
    print(f"=== {o.name}")
    print(f"  GLTF-BBOX x=[{mi[0]:.4f},{ma[0]:.4f}] y=[{mi[1]:.4f},{ma[1]:.4f}] "
          f"z=[{mi[2]:.4f},{ma[2]:.4f}]")
    print(f"  signed_volume={vol:.4f}  verts={len(me.vertices)} "
          f"faces={len(me.polygons)} tris={len(me.loop_triangles)}")
    print(f"  materialslots={len(me.materials)} {[m.name if m else None for m in me.materials]}")
    for m in me.materials:
        if not m or not m.node_tree:
            continue
        for n in m.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                img = n.image
                print(f"    TEXTUR {img.name} size={tuple(img.size)} "
                      f"packed={img.packed_file is not None} "
                      f"bytes={len(img.packed_file.data) if img.packed_file else 0} "
                      f"fileformat={img.file_format}")

    def ngl(t):
        n = t.normal
        return (-n.x, -n.z, n.y)      # glTF-Achsen, Wicklung gedreht

    def schwer(t):
        g = [gltf(o.matrix_world @ me.vertices[i] .co) for i in t.vertices]
        return tuple(sum(p[k] for p in g) / 3 for k in range(3))

    tris = []
    for t in me.loop_triangles:
        g = [gltf(o.matrix_world @ me.vertices[i].co) for i in t.vertices]
        tris.append((g, ngl(t), tuple(sum(p[k] for p in g) / 3 for k in range(3))))

    # ── 1. Trittflaechen-Profil: waagerecht nach oben, in der Mitte |x|<0.6
    tritt = collections.defaultdict(list)
    for g, n, c in tris:
        if n[1] < 0.9:
            continue
        if abs(c[0]) > 0.6 or c[1] > 9.5:
            continue
        tritt[round(c[1], 3)].append(round(c[2], 3))
    hoehen = sorted(tritt)
    print(f"  --- Trittflaechen (waagerecht, |x|<0.6): {len(hoehen)} Niveaus")
    for y in hoehen:
        zs = sorted(tritt[y])
        print(f"    y={y:+7.3f}  n={len(zs):3d}  z={zs[0]:+7.3f}..{zs[-1]:+7.3f}"
              f"  zmitte={sum(zs)/len(zs):+7.3f}")
    if len(hoehen) >= 2:
        d = sorted(set(round(hoehen[i+1]-hoehen[i], 4) for i in range(len(hoehen)-1)))
        print(f"    Stufenhoehen: {d}")

    # ── 2. RICHTUNG: Korrelation y gegen z ueber die Trittflaechen
    if len(hoehen) >= 2:
        paare = [(sum(tritt[y]) / len(tritt[y]), y) for y in hoehen]
        z0, y0 = paare[0]
        z1, y1 = paare[-1]
        print(f"  --- RICHTUNG: unterste Trittflaeche y={y0:.3f} bei z~{z0:+.3f}, "
              f"oberste y={y1:.3f} bei z~{z1:+.3f}")
        print(f"      -> Modell steigt nach {'+z' if z1 > z0 else '-z'}")

    # ── 3. Laufprofil baryzentrisch ueber x=0, alle 0,1 m in z
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

    aufwaerts = 0.75 if o.name.endswith("_col") else 0.9
    lauf = []
    for i in range(121):
        z = -6.0 + i * 0.1
        best = None
        for g, n, c in tris:
            if n[1] < aufwaerts:
                continue
            y = hoehe_ueber(g, 0.0, z)
            if y is not None and y <= 9.0 and (best is None or y > best):
                best = y
        lauf.append((round(z, 2), best))
    print("  --- Laufflaeche ueber x=0 (z -> hoechste aufwaerts-Flaeche <= 9):")
    for i in range(0, 121, 10):
        chunk = lauf[i:i+10]
        print("    " + "  ".join(
            f"{z:+.1f}:{('%.3f' % y) if y is not None else 'LOCH'}" for z, y in chunk))
    spr = [round(lauf[i+1][1] - lauf[i][1], 4) for i in range(len(lauf)-1)
           if lauf[i][1] is not None and lauf[i+1][1] is not None]
    if spr:
        print(f"    groesster Sprung: {max(spr):.3f}  kleinster: {min(spr):.3f}")
    loecher = [z for z, y in lauf if y is None]
    print(f"    Loecher: {len(loecher)} {loecher[:20]}")

    # ── 4. Seitenwaende: Innenmass. x-Histogramm senkrechter Flaechen
    print("  --- Senkrechte Flaechen mit Normale in +-x (Wandinnenseiten):")
    wand = collections.defaultdict(lambda: [9e9, -9e9, 9e9, -9e9])
    for g, n, c in tris:
        if abs(n[0]) < 0.9:
            continue
        k = (round(c[0], 2), "n->+x" if n[0] > 0 else "n->-x")
        e = wand[k]
        e[0] = min(e[0], min(p[1] for p in g)); e[1] = max(e[1], max(p[1] for p in g))
        e[2] = min(e[2], min(p[2] for p in g)); e[3] = max(e[3], max(p[2] for p in g))
    for k in sorted(wand):
        e = wand[k]
        print(f"    x={k[0]:+6.2f} {k[1]}  y={e[0]:+7.2f}..{e[1]:+7.2f}  z={e[2]:+7.2f}..{e[3]:+7.2f}")

    # ── 5. Alle x-Werte der Vertices, Histogramm grob
    hx = collections.Counter(round(p[0], 2) for p in pts)
    print(f"  --- x-Histogramm (Top 20): {hx.most_common(20)}")

    # ── 6. Decke: nach UNTEN zeigende Flaechen ueber y=3
    deck = collections.defaultdict(list)
    for g, n, c in tris:
        if n[1] > -0.9:
            continue
        if c[1] < 2.0 or abs(c[0]) > 1.5:
            continue
        deck[round(c[2] * 2) / 2].append(c[1])
    print("  --- Deckenunterseite (z-Scheibe 0,5 -> y min..max, |x|<1.5, y>2):")
    for z in sorted(deck):
        print(f"    z={z:+6.1f}  y={min(deck[z]):7.3f}..{max(deck[z]):7.3f}  n={len(deck[z])}")

    # ── 7. Boden am unteren Ende und y-Histogramm
    hy = collections.Counter(round(p[1], 2) for p in pts)
    print(f"  --- y-Histogramm (sortiert, erste 25): {sorted(hy.items())[:25]}")
    print(f"  --- y-Histogramm (sortiert, letzte 15): {sorted(hy.items())[-15:]}")
    hz = collections.Counter(round(p[2], 2) for p in pts)
    print(f"  --- z-Histogramm (erste 10): {sorted(hz.items())[:10]}")
    print(f"  --- z-Histogramm (letzte 10): {sorted(hz.items())[-10:]}")
