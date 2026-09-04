# Prüft: die vier neuen StoneVault-Zellvarianten nach dem Export — Hüllbox, signiertes Volumen, Netz- und Materialzahl, Flächen, Reliefrichtung.
# Prueft die vier neuen StoneVault-Zellvarianten nach dem Export:
# Bounding-Box (glTF-Achsen), Signed Volume, Mesh-/Materialzahl, Faces,
# und die Relief-Richtung der Innenwaende ueber den Vertex-Schwerpunkt.
#
# glTF-Import nach Blender: gltf_x = blender_x, gltf_y = blender_z, gltf_z = -blender_y
# flatpak run org.blender.Blender --factory-startup -b --python check-m3plus.py -- <ordner>
import bpy, sys

ORD = sys.argv[sys.argv.index("--") + 1:][0]

# name -> (erwartete glTF-BBox, Liste der Innenwaende)
# Innenwand: (Beschriftung, Achse 'x'|'z', slab_lo, slab_hi, erwartete Reliefseite,
#             Zusatzfilter (Achse, lo, hi) — blendet die jeweils andere Wand aus)
PLAN = {
    # Das freistehende Paneel seit dem Nahtschluss (03.09.2026):
    #   y -0,25 .. 3,75 statt 0 .. 3,5 — die Wand steckt in Boden- und
    #     Deckenplatte, sonst laufen die Bodenfugen unter ihr ins Freie.
    #   x +-1,06 statt +-1,00 — die Endstreifen gegen die offene Innenecke.
    #   z bleibt -0,15 .. 0,15 (Wandtiefe unveraendert).
    "StoneVaultWall": ((-1.06, 1.06, -0.25, 3.75, -0.15, 0.15), [
        ("Relief", "z", -0.15, 0.15, "Relief auf +z", None),
    ]),
    "StoneVaultCorridor": ((-1, 1, -0.25, 3.75, -1, 1), [
        ("Ost-Wand",  "x",  0.7,  1.0, "innen = kleineres x", None),
        ("West-Wand", "x", -1.0, -0.7, "innen = groesseres x", None),
    ]),
    "StoneVaultCorner": ((-1, 1, -0.25, 3.75, -1, 1), [
        ("West-Wand", "x", -1.0, -0.7, "innen = groesseres x", ("z", -0.69, 1.01)),
        ("Sued-Wand", "z", -1.0, -0.7, "innen = groesseres z", ("x", -0.69, 1.01)),
    ]),
    "StoneVaultJunction": ((-1, 1, -0.25, 3.75, -1, 1), [
        ("West-Wand", "x", -1.0, -0.7, "innen = groesseres x", None),
    ]),
    "StoneVaultHall": ((-2, 2, -0.25, 3.75, -2, 2), []),
}


def gltf(v):
    """Blender-Weltkoordinate -> glTF-Koordinate."""
    return (v.x, v.z, -v.y)


for name, (bbox, waende) in PLAN.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f"{ORD}/{name}.glb")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    print(f"=== {name}")
    print(f"  meshes={len(meshes)}")
    for o in meshes:
        me = o.data
        pts = [gltf(o.matrix_world @ v.co) for v in me.vertices]
        mi = [min(p[i] for p in pts) for i in range(3)]
        ma = [max(p[i] for p in pts) for i in range(3)]
        me.calc_loop_triangles()
        vol = 0.0
        for t in me.loop_triangles:
            a, b, c = (o.matrix_world @ me.vertices[i].co for i in t.vertices)
            vol += a.dot(b.cross(c)) / 6.0
        soll = (f"x=[{bbox[0]},{bbox[1]}] y=[{bbox[2]},{bbox[3]}] z=[{bbox[4]},{bbox[5]}]")
        ist = (f"x=[{mi[0]:.4f},{ma[0]:.4f}] y=[{mi[1]:.4f},{ma[1]:.4f}] "
               f"z=[{mi[2]:.4f},{ma[2]:.4f}]")
        ok = all(abs(mi[i] - bbox[2 * i]) < 1e-4 and abs(ma[i] - bbox[2 * i + 1]) < 1e-4
                 for i in range(3))
        print(f"  GLTF-BBOX ist  {ist}")
        print(f"  GLTF-BBOX soll {soll}   -> {'OK' if ok else 'ABWEICHUNG'}")
        print(f"  signed_volume={vol:.4f} -> {'OK (vorgespiegelt)' if vol < 0 else 'FEHLER (nicht gespiegelt)'}")
        print(f"  faces={len(me.polygons)} tris={len(me.loop_triangles)} "
              f"-> {'OK' if len(me.polygons) < 3000 else 'ZU VIELE'}")
        print(f"  materialslots={len(me.materials)} {[m.name if m else None for m in me.materials]}")

        # NAHTSCHLUSS: Es muss Geometrie UNTER dem Boden (y<0) und UEBER der
        # Deckenunterseite (y>3,5) geben — sonst endet die Wand wieder auf der
        # Fugenoberkante und das Aussenlicht faellt durch. Bei Cell/Hall sind
        # das die Platten selbst, bei den Wandmodulen Sockel und Haube.
        unten = [p for p in pts if p[1] < -1e-4]
        oben = [p for p in pts if p[1] > 3.5 + 1e-4]
        print(f"  Nahtschluss: {len(unten)} verts unter y=0 (min {min(p[1] for p in unten):.3f}), "
              f"{len(oben)} verts ueber y=3,5 (max {max(p[1] for p in oben):.3f})"
              if unten and oben else "  Nahtschluss: FEHLT (Wand endet auf 0 / 3,5)")

        for label, achse, lo, hi, erwartung, zusatz in waende:
            k = 0 if achse == "x" else 2

            def drin(p):
                if not (lo - 1e-3 <= p[k] <= hi + 1e-3):
                    return False
                if zusatz:
                    k2 = 0 if zusatz[0] == "x" else 2
                    if not (zusatz[1] <= p[k2] <= zusatz[2]):
                        return False
                return True

            mitte = (lo + hi) / 2
            # Nur Ziegel der Reliefschicht: Boden (y<=0) und Decke (y>=3,5)
            # liegen ausserhalb von 0,02 < y < 3,48.
            band = [p for p in pts if drin(p) and 0.02 < p[1] < 3.48]
            alle = [p for p in pts if drin(p)]
            if not band:
                print(f"  {label}: KEINE Reliefverts gefunden")
                continue
            s = sum(p[k] for p in band) / len(band)
            smin = min(p[k] for p in alle)
            smax = max(p[k] for p in alle)
            innen = (s < mitte) if lo > 0 else (s > mitte)
            print(f"  {label}: slab {achse}=[{smin:.4f},{smax:.4f}] mitte={mitte:.2f} "
                  f"schwerpunkt_relief_{achse}={s:.4f} ({len(band)} verts) "
                  f"[{erwartung}] -> {'OK' if innen else 'FALSCHE RICHTUNG'}")
