# Prüft: die Module aus Paket 1 (StoneVaultStairs, StoneVaultArch) in glTF-Achsen.
# Prueft die Module aus Paket 1: StoneVaultStairs (neu) und StoneVaultArch
# (beidseitiges Relief). Gemessen wird in glTF-Achsen — der Import dreht
# Y-up nach Z-up: gltf_x = blender_x, gltf_y = blender_z, gltf_z = -blender_y.
#
# flatpak run org.blender.Blender --factory-startup -b --python check-p1.py -- <ordner> [modul ...]
import bpy, sys, collections, math

# Masse der Treppe, gespiegelt aus make-stonevault.py. Wer dort ZELLEN_LAUF
# aendert, zieht es hier nach — die Sollwerte unten haengen daran.
TREPPE_LAUF = 6.0                     # z-Ausdehnung der Treppe: -3 .. +3
TREPPE_HOEHE = 3.5                    # Hoehensprung Sued -> Nord
TREPPE_STUFE = 0.25                   # groesster erlaubter Sprung im Profil
# Steigungsgrenze der Figur, s. client/src/player/PlayerController.ts
# (STEIGUNGS_GRENZE_GRAD, dort `maxSlopeCosine`). Steiler rutscht sie ab —
# daran ist die erste Fassung mit 4 m Lauf (41,2 Grad) gescheitert.
STEIGUNGS_GRENZE_GRAD = 40.0

a = sys.argv[sys.argv.index("--") + 1:]
ORD = a[0]
NUR = a[1:] or ["StoneVaultStairs", "StoneVaultArch"]

# Modul -> Soll-BBox in glTF-Achsen (xmin, xmax, ymin, ymax, zmin, zmax).
# Gemeint ist immer das SICHTBARE Mesh; das Kollisionsnetz (`_col`) hat seine
# eigene Huelle und wird unten getrennt gemessen.
SOLL = {
    "StoneVaultStairs": (-1, 1, -0.25, 7.25, -3, 3),
    # Nahtschluss 03.09.2026: Pfosten und Sturz stecken jetzt in Boden- und
    # Deckenplatte (y -0,24 .. 3,74 statt 0 .. 3,5); Grundflaeche unveraendert.
    # Warum nicht glatt -0,25/3,75? Der Bogen sitzt IN der Kopplungsebene, also
    # mitten zwischen zwei Zellplatten. Ein Deckel exakt auf deren Aussenflaeche
    # waere koplanar -> Flimmern von oben/unten. EINSTICH = 1 cm haelt ihn
    # innerhalb der Platte; abzudichten ist ohnehin die Fuge bei y=0 / y=3,5.
    "StoneVaultArch":   (-1, 1, -0.24, 3.74, -0.15, 0.15),
}

# Module, die ein reines Kollisionsnetz `<name>_col` mitbringen MUESSEN
# (Konvention s. make-stonevault.py `fertig()` und
# client/src/engine/AssetManager.ts). Zwei Meshes und zwei Materialslots
# sind hier also SOLL, nicht Befund: fehlt das Netz, ist die Treppe im
# Spiel nicht begehbar — und das sieht man dem Rendering nicht an.
MIT_KOLLISIONSNETZ = {"StoneVaultStairs"}
# Soll-Huelle des Kollisionsnetzes: volle Zellbreite, Rampe 0,3 unter der
# Treppenlinie (y=-0,3 an der Suedkante), oben die Decke bei 7,25.
SOLL_COL = {
    "StoneVaultStairs": (-1, 1, -0.30, 7.25, -3, 3),
}


def gltf(v):
    return (v.x, v.z, -v.y)


for name in NUR:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f"{ORD}/{name}.glb")
    print(f"=== {name}")
    objekte = [x for x in bpy.data.objects if x.type == "MESH"]
    kollnetze = [x for x in objekte if x.name.endswith("_col")]
    if name in MIT_KOLLISIONSNETZ:
        print(f"  Meshes: {len(objekte)} {[x.name for x in objekte]} -> "
              f"{'OK (Soll 2: sichtbar + _col)' if len(objekte) == 2 else 'ABWEICHUNG (Soll 2)'}")
        print(f"  Kollisionsnetz `{name}_col`: "
              f"{'OK' if len(kollnetze) == 1 else 'FEHLT — Treppe waere unbegehbar'}")
    for o in objekte:
        me = o.data
        nur_kollision = o.name.endswith("_col")
        pts = [gltf(o.matrix_world @ v.co) for v in me.vertices]
        mi = [min(p[i] for p in pts) for i in range(3)]
        ma = [max(p[i] for p in pts) for i in range(3)]
        me.calc_loop_triangles()
        vol = 0.0
        for t in me.loop_triangles:
            p, q, r = (o.matrix_world @ me.vertices[i].co for i in t.vertices)
            vol += p.dot(q.cross(r)) / 6.0
        b = SOLL_COL.get(name) if nur_kollision else SOLL.get(name)
        ist = (f"x=[{mi[0]:.4f},{ma[0]:.4f}] y=[{mi[1]:.4f},{ma[1]:.4f}] "
               f"z=[{mi[2]:.4f},{ma[2]:.4f}]")
        print(f"  -- {o.name}{' (nur Kollision)' if nur_kollision else ''}")
        print(f"  GLTF-BBOX ist  {ist}")
        if b:
            ok = all(abs(mi[i] - b[2 * i]) < 1e-4 and abs(ma[i] - b[2 * i + 1]) < 1e-4
                     for i in range(3))
            print(f"  GLTF-BBOX soll x=[{b[0]},{b[1]}] y=[{b[2]},{b[3]}] z=[{b[4]},{b[5]}]"
                  f"   -> {'OK' if ok else 'ABWEICHUNG'}")
        print(f"  signed_volume={vol:.4f} -> "
              f"{'OK (vorgespiegelt)' if vol < 0 else 'FEHLER (nicht gespiegelt)'}")
        print(f"  verts={len(me.vertices)} faces={len(me.polygons)} "
              f"tris={len(me.loop_triangles)} -> {'OK' if len(me.polygons) < 4000 else 'ZU VIELE'}")
        print(f"  materialslots={len(me.materials)} "
              f"{[m.name if m else None for m in me.materials]}")

        if name == "StoneVaultArch":
            # Relief-Belege: Vertices in den beiden aeusseren z-Schalen.
            for label, lo, hi in [("Relief +z", 0.09 - 1e-4, 0.15 + 1e-4),
                                  ("Relief -z", -0.15 - 1e-4, -0.09 + 1e-4)]:
                sel = [p for p in pts if lo <= p[2] <= hi]
                aussen = [p for p in sel if abs(abs(p[2]) - 0.15) < 1e-4]
                if not sel:
                    print(f"  {label}: KEINE Verts")
                    continue
                s = sum(p[2] for p in sel) / len(sel)
                print(f"  {label}: {len(sel)} verts, schwerpunkt_z={s:+.4f}, "
                      f"davon {len(aussen)} auf der Aussenflaeche |z|=0,15 -> "
                      f"{'OK' if aussen else 'FEHLT'}")

        if name == "StoneVaultStairs":
            # ACHTUNG Normalenrichtung: Die GLBs sind in x VORGESPIEGELT, ohne
            # die Wicklung zu drehen — im Import zeigen deshalb ALLE Normalen
            # nach innen. Was der Client zeigt (Babylons __root__, scale.x=-1),
            # hat die umgekehrte Normale. Deshalb wird hier negiert; ohne das
            # misst man die Unterseiten der Stufen statt der Trittflaechen.
            def norm_render(t):
                n = t.normal
                return (-n.x, -n.z, n.y)     # glTF-Achsen, Wicklung gedreht

            def schwer(t):
                g = [gltf(o.matrix_world @ me.vertices[i].co) for i in t.vertices]
                return tuple(sum(p[k] for p in g) / 3 for k in range(3))

            # Stufen misst nur das SICHTBARE Mesh — das Kollisionsnetz ist
            # absichtlich stufenlos (eine Rampe durch die Trittkanten), seine
            # "Niveaus" waeren hier nichts als Rauschen. Das Laufprofil
            # darunter laeuft dagegen fuer BEIDE: dort ist die Rampe der
            # eigentliche Pruefgegenstand.
            if not nur_kollision:
                tritt = collections.defaultdict(set)
                for t in me.loop_triangles:
                    if norm_render(t)[1] < 0.9:
                        continue
                    cx, cy, cz = schwer(t)
                    if abs(cx) > 0.6 or cy > TREPPE_HOEHE + 0.5:
                        continue          # nur die Laufflaeche, nicht die Decke
                    tritt[round(cy, 3)].add(round(cz, 3))
                hoehen = sorted(tritt)
                print(f"  Trittflaechen (y -> z-Mitten), {len(hoehen)} Niveaus:")
                for y in hoehen:
                    print(f"    y={y:+7.3f}  z={sorted(tritt[y])}")
                if len(hoehen) >= 2:
                    d = [round(hoehen[i + 1] - hoehen[i], 4) for i in range(len(hoehen) - 1)]
                    print(f"  Stufenhoehen: {sorted(set(d))}  (Soll {TREPPE_STUFE})")
                print(f"  oberste Trittflaeche y={hoehen[-1] if hoehen else None} "
                      f"(Soll {TREPPE_HOEHE}), unterste y={hoehen[0] if hoehen else None} "
                      f"(Soll {TREPPE_STUFE})")

            # Begehbar? Die hoechste Trittflaeche an jeder z-Stelle muss der
            # Treppenlinie STEIG*(z+LAUF/2) folgen und darf nie mehr als eine
            # Stufenhoehe ueber der vorigen liegen.
            steig = TREPPE_HOEHE / TREPPE_LAUF
            # Wie steil darf eine Flaeche sein und noch als "begehbar nach
            # oben" zaehlen? Die Trittflaechen des sichtbaren Meshes sind
            # waagerecht (Normale 1,0), die Kollisionsrampe steigt mit
            # 30,26 Grad — ihre Normale hat nur cos(30,26) = 0,864. Mit dem
            # 0,9-Filter des sichtbaren Meshes waere die Rampe unsichtbar und
            # das Profil ein einziges LOCH.
            aufwaerts = 0.75 if nur_kollision else 0.9
            proben = int(round(TREPPE_LAUF / 0.1)) + 1

            # Hoehe der Flaeche GENAU ueber (x=0, z), baryzentrisch aus dem
            # Dreieck interpoliert — nicht der Schwerpunkt.
            #
            # Der Schwerpunkt genuegte, solange jede Trittflaeche ein eigenes
            # kleines Dreieckspaar war. Die Kollisionsrampe ist EIN Prisma
            # ueber den ganzen Lauf: ihr Schwerpunkt liegt bei y=2,33, und das
            # Profil meldete ueber die volle Laenge dieselbe Hoehe — eine
            # Treppe, die als waagerechte Ebene durchgeht. Fuer die
            # waagerechten Trittflaechen aendert die Interpolation nichts.
            def hoehe_ueber(t, z):
                g = [gltf(o.matrix_world @ me.vertices[i2].co) for i2 in t.vertices]
                (ax, ay, az), (bx, by, bz), (cx2, cy2, cz2) = g
                # Baryzentrik in der Grundrissebene (x, z)
                det = (bz - cz2) * (ax - cx2) + (cx2 - bx) * (az - cz2)
                if abs(det) < 1e-12:
                    return None            # senkrecht projiziert entartet
                u = ((bz - cz2) * (0.0 - cx2) + (cx2 - bx) * (z - cz2)) / det
                v = ((cz2 - az) * (0.0 - cx2) + (ax - cx2) * (z - cz2)) / det
                w = 1.0 - u - v
                if min(u, v, w) < -1e-6:
                    return None            # Punkt liegt ausserhalb
                return u * ay + v * by + w * cy2

            lauf = []
            for i in range(proben):
                z = -TREPPE_LAUF / 2 + i * 0.1
                best = None
                for t in me.loop_triangles:
                    if norm_render(t)[1] < aufwaerts:
                        continue
                    y = hoehe_ueber(t, z)
                    # Deckel eine halbe Stufenhoehe ueber der ERWARTETEN
                    # Treppenlinie an dieser Stelle, nicht ueber der
                    # Gesamthoehe: Am unteren Ende liegt die Deckenoberseite
                    # (3,75) sonst unter dem alten Deckel von 4,0 und
                    # gewaenne gegen die Rampe (0,29). Ein LOCH faellt
                    # weiterhin auf — gesucht wird ja nach unten offen.
                    deckel = steig * (z + TREPPE_LAUF / 2) + 0.5
                    if y is not None and y <= deckel and (best is None or y > best):
                        best = y
                lauf.append((round(z, 2), best))
            print(f"  Laufflaeche (z -> hoechste Trittflaeche, "
                  f"Soll ~{steig:.4f}*(z+{TREPPE_LAUF / 2})):")
            print("    " + "  ".join(f"{z:+.1f}:{('%.3f' % y) if y is not None else 'LOCH'}"
                                     for z, y in lauf))
            loecher = [z for z, y in lauf if y is None]
            print(f"  Loecher im Profil: {len(loecher)} {loecher if loecher else ''} "
                  f"-> {'OK' if not loecher else 'LUECKE'}")
            spr = [round(lauf[i + 1][1] - lauf[i][1], 4)
                   for i in range(len(lauf) - 1)
                   if lauf[i][1] is not None and lauf[i + 1][1] is not None]
            print(f"  groesster Sprung zwischen benachbarten z-Proben: {max(spr):.3f} "
                  f"-> {'OK' if max(spr) <= TREPPE_STUFE + 1e-4 else 'ZU HOCH'}")

            # Steigungswinkel AUS DEM PROFIL, nicht aus den Sollwerten: erste
            # und letzte gemessene Trittflaeche, waagerechter Abstand dazwischen.
            # So faellt auf, wenn die Geometrie den Sprung anders verteilt als
            # gedacht — die Sollrechnung wuerde das nie verraten.
            gemessen = [(z, y) for z, y in lauf if y is not None]
            if len(gemessen) >= 2:
                dz = gemessen[-1][0] - gemessen[0][0]
                dy = gemessen[-1][1] - gemessen[0][1]
                grad = math.degrees(math.atan2(dy, dz))
                # Der Profilwinkel misst von der ERSTEN zur LETZTEN Trittflaeche
                # und laesst die halbe Stufe an beiden Enden weg — er liegt
                # deshalb etwas unter dem Rampenwinkel der Kit-Hoehe. Beide
                # muessen unter der Grenze bleiben; der Rampenwinkel ist der
                # strengere und der, den der Kit-Waechter nachrechnet.
                rampe = math.degrees(math.atan2(TREPPE_HOEHE, TREPPE_LAUF))
                print(f"  Steigung gemessen: {dy:.3f} m auf {dz:.3f} m = {grad:.2f} Grad; "
                      f"Rampe (Kit: {TREPPE_HOEHE} auf {TREPPE_LAUF}) = {rampe:.2f} Grad "
                      f"(Grenze {STEIGUNGS_GRENZE_GRAD}) -> "
                      f"{'OK' if max(grad, rampe) < STEIGUNGS_GRENZE_GRAD else 'ZU STEIL — Figur rutscht ab'}")

            # Kopfraum: Deckenunterseite ueber der Treppe
            deck = collections.defaultdict(list)
            for t in me.loop_triangles:
                if norm_render(t)[1] > -0.9:
                    continue
                cx, cy, cz = schwer(t)
                if cy < 3.0:
                    continue
                deck[round(cz, 1)].append(cy)
            print("  Deckenunterseite (z -> y):")
            for z in sorted(deck):
                print(f"    z={z:+5.1f} y={min(deck[z]):.3f}..{max(deck[z]):.3f}")
