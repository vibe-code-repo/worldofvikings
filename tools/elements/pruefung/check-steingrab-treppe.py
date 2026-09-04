# Prüft: SteingrabTreppe.glb nach dem Umbau — zwei Netze, unveränderte Hüllbox, Laufprofil des `_col` und die Steigung.
# Nachweis fuer SteingrabTreppe.glb nach dem Umbau: zwei Meshes, BBox des
# sichtbaren Meshes unveraendert, Signed Volume weiter negativ, Laufprofil
# des `_col` (Richtung + groesster Sprung), Steigung.
#
# Achsen wie ueberall im Kit: gltf_x = blender_x, gltf_y = blender_z,
# gltf_z = -blender_y. Normalen negiert (x-Vorspiegelung, s. check-p1.py).
#
# flatpak run org.blender.Blender --factory-startup -b --python <dies> -- <glb>
import bpy, sys, math, collections

GLB = sys.argv[sys.argv.index("--") + 1:][0]
LAUF, HOEHE, GRENZE = 12.0, 8.0, 40.0
MAX_SPRUNG = 0.10          # Havok-Kapsel: keine Setzstufe ueber ~9 cm
SOLL_SICHTBAR = (-2, 2, -0.3, 12, -6, 6)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)


def gltf(v):
    return (v.x, v.z, -v.y)


objekte = [x for x in bpy.data.objects if x.type == "MESH"]
kol = [x for x in objekte if x.name.endswith("_col")]
print(f"Meshes: {len(objekte)} {[x.name for x in objekte]} -> "
      f"{'OK (Soll 2)' if len(objekte) == 2 else 'ABWEICHUNG'}")
print(f"Kollisionsnetz: {'OK' if len(kol) == 1 else 'FEHLT'}")

for o in objekte:
    me = o.data
    me.calc_loop_triangles()
    nur_kol = o.name.endswith("_col")
    pts = [gltf(o.matrix_world @ v.co) for v in me.vertices]
    mi = [min(p[i] for p in pts) for i in range(3)]
    ma = [max(p[i] for p in pts) for i in range(3)]
    vol = 0.0
    for t in me.loop_triangles:
        a, b, c = (o.matrix_world @ me.vertices[i].co for i in t.vertices)
        vol += a.dot(b.cross(c)) / 6.0
    print(f"\n=== {o.name}{' (nur Kollision)' if nur_kol else ''}")
    print(f"  GLTF-BBOX x=[{mi[0]:.4f},{ma[0]:.4f}] y=[{mi[1]:.4f},{ma[1]:.4f}] "
          f"z=[{mi[2]:.4f},{ma[2]:.4f}]")
    if not nur_kol:
        s = SOLL_SICHTBAR
        ok = all(abs(mi[i] - s[2 * i]) < 1e-4 and abs(ma[i] - s[2 * i + 1]) < 1e-4
                 for i in range(3))
        print(f"  Soll (unveraendert) x=[{s[0]},{s[1]}] y=[{s[2]},{s[3]}] "
              f"z=[{s[4]},{s[5]}] -> {'OK' if ok else 'ABWEICHUNG'}")
    print(f"  signed_volume={vol:.4f} -> "
          f"{'OK (vorgespiegelt)' if vol < 0 else 'FEHLER (nicht gespiegelt)'}")
    print(f"  verts={len(me.vertices)} faces={len(me.polygons)} "
          f"materialslots={len(me.materials)} "
          f"{[m.name if m else None for m in me.materials]}")
    for m in me.materials:
        if m and m.node_tree:
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image:
                    print(f"    TEXTUR {n.image.name} {tuple(n.image.size)} "
                          f"{len(n.image.packed_file.data) if n.image.packed_file else 0} B")

    tris = []
    for t in me.loop_triangles:
        g = [gltf(o.matrix_world @ me.vertices[i].co) for i in t.vertices]
        n = t.normal
        tris.append((g, (-n.x, -n.z, n.y)))

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

    # Laufprofil: hoechste aufwaerts zeigende Flaeche unter der Decke.
    # Deckel eine halbe Stufe ueber der ERWARTETEN Linie, sonst gewinnt am
    # unteren Ende die Oberseite der Decke.
    steig = HOEHE / LAUF
    aufwaerts = 0.75 if nur_kol else 0.9
    lauf = []
    for i in range(121):
        z = -6.0 + i * 0.1
        deckel = steig * (z + 6.0) + 0.5
        best = None
        for g, n in tris:
            if n[1] < aufwaerts:
                continue
            y = hoehe_ueber(g, 0.0, z)
            if y is not None and y <= deckel and (best is None or y > best):
                best = y
        lauf.append((round(z, 2), best))
    print(f"  Laufflaeche ueber x=0 (Soll {steig:.4f}*(z+6)):")
    for i in range(0, 121, 12):
        print("    " + "  ".join(f"{z:+.1f}:{('%.3f' % y) if y is not None else 'LOCH'}"
                                 for z, y in lauf[i:i + 12]))
    loecher = [z for z, y in lauf if y is None]
    print(f"  Loecher: {len(loecher)} {loecher if loecher else ''} -> "
          f"{'OK' if not loecher else 'LUECKE'}")
    gem = [(z, y) for z, y in lauf if y is not None]
    if len(gem) >= 2:
        spr = [round(lauf[i + 1][1] - lauf[i][1], 4) for i in range(len(lauf) - 1)
               if lauf[i][1] is not None and lauf[i + 1][1] is not None]
        gr = "MAX %.4f" % max(spr)
        grenze = MAX_SPRUNG if nur_kol else 0.45
        print(f"  groesster Sprung benachbarter z-Proben: {gr} -> "
              f"{'OK' if max(spr) <= grenze + 1e-4 else 'ZU HOCH'} (Grenze {grenze})")
        dz = gem[-1][0] - gem[0][0]
        dy = gem[-1][1] - gem[0][1]
        grad = math.degrees(math.atan2(dy, dz))
        print(f"  RICHTUNG: y({gem[0][0]:+.1f})={gem[0][1]:.3f} -> "
              f"y({gem[-1][0]:+.1f})={gem[-1][1]:.3f}  -> steigt nach "
              f"{'+z' if dy > 0 else '-z'} -> "
              f"{'OK (Definition: unten z=-6 y=0, oben z=+6 y=8)' if dy > 0 else 'FALSCH'}")
        rampe = math.degrees(math.atan2(HOEHE, LAUF))
        print(f"  Steigung: {dy:.3f} m auf {dz:.3f} m = {grad:.2f} Grad; "
              f"Kit {HOEHE} auf {LAUF} = {rampe:.2f} Grad (Grenze {GRENZE}) -> "
              f"{'OK' if max(grad, rampe) < GRENZE else 'ZU STEIL'}")
        if nur_kol:
            abw = max(abs(y - steig * (z + 6.0)) for z, y in gem)
            print(f"  groesste Abweichung von der Connector-Geraden: {abw:.4f} -> "
                  f"{'OK' if abw < 1e-3 else 'ABWEICHUNG'}")

    # Kopfraum
    deck = collections.defaultdict(list)
    for g, n in tris:
        # Schwelle bewusst flach: die Kollisionsdecke ist SCHRAEG, ihre
        # Normale hat nur -cos(33,69) = -0,832. Mit -0,9 fiele genau die
        # Platte heraus, die hier nachgewiesen werden soll.
        if n[1] > -0.5:
            continue
        c = [sum(p[k] for p in g) / 3 for k in range(3)]
        if abs(c[0]) > 1.0 or c[1] < steig * (c[2] + 6.0) + 1.0:
            continue
        deck[round(c[2])].append(c[1])
    print("  Deckenunterseite (z -> y, Kopfraum ueber der Linie):")
    print("    " + "  ".join(f"{z:+.0f}:{min(deck[z]):.2f}(+{min(deck[z]) - steig * (z + 6.0):.2f})"
                             for z in sorted(deck)))
