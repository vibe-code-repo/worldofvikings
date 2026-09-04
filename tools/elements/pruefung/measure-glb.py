# Prüft: Hüllbox und Ursprung aller Objekte eines GLB (headless).
# Misst Bounding-Box und Ursprung aller Objekte eines GLB (headless).
# flatpak run org.blender.Blender --factory-startup -b --python measure-glb.py -- <a.glb> [<b.glb> ...]
#
# Neben dem Lesebericht schreibt das Skript je Netz EINE maschinenlesbare Zeile:
#   KENNZAHL <datei.glb> <objekt> tris=<n> verts=<n> mat=<name[,name]>
#            volumen=<n> ursprung=<x,y,z> bbox=<x0,y0,z0,x1,y1,z1>
# Warum eine zweite Ausgabeform: Der Lesebericht ist fuer Augen gemacht
# (Materialnamen, Elternschaft, Rundungen je Zeile). Ein Vergleich ZWEIER
# Baustaende braucht dagegen feste Felder, stabil formatiert und ohne Suchen
# im Fliesstext — sonst vergleicht der Vergleicher Textumbrueche.
# Der Verbraucher ist `kit-neubau.mjs`.
#
# Warum ausgerechnet diese sechs Felder — jedes faengt etwas, das die
# anderen durchlassen:
#   tris/verts  Netzgroesse.
#   mat         Materialslots. Die Steingrab-Module tragen KEINE Bilder im
#               GLB (das Steinmaterial setzt der Client zur Laufzeit), der
#               Slotname ist also die einzige Materialaussage, die die Datei
#               ueberhaupt macht — und `Kollision` vs. `StoneVaultStone`
#               entscheidet, ob ein Netz sichtbar ist.
#   volumen     Signiertes Volumen, wie `check-mirror.py`. Es ist das einzige
#               Feld, das die x-Vorspiegelung sieht: die Steingrab-Module sind
#               weitgehend x-symmetrisch, eine verlorene Negation aendert
#               weder Dreieckszahl noch Huellbox noch Ursprung. Gemessen in
#               Blender-Achsen; die Y-up-Drehung ist eine echte Drehung und
#               laesst das Vorzeichen unberuehrt.
#   ursprung    Pivot — verschiebt sich lautlos, wenn jemand `origin_set` setzt.
#   bbox        Ausmasse und Lage.
#
# Alle Koordinaten der KENNZAHL-Zeile stehen in glTF-Koordinaten (Y-up), also
# in dem System, in dem das Spiel das Modul sieht — nicht in Blenders Z-up.
# tris zaehlt Dreiecke, nicht Polygone: glTF liefert zwar bereits
# triangulierte Netze, aber ein spaeteres Quad-Netz wuerde die Zahl sonst
# still halbieren.
import bpy, sys, os
from mathutils import Vector


def gltf(v):
    """Blender Z-up -> glTF Y-up (gltf_x = bx, gltf_y = bz, gltf_z = -by)."""
    return (v.x, v.z, -v.y)


def zahlen(werte):
    # `+ 0.0` macht aus -0.0 eine 0.0. Ohne das meldet die y-Negation eines
    # Nullwertes "-0.0000" und ein Textvergleich zweier gleicher Bauten wird
    # rot, weil eine Seite zufaellig -0.0 und die andere 0.0 gerechnet hat.
    return ",".join(f"{v + 0.0:.4f}" for v in werte)


def signiertes_volumen(o):
    """Wie check-mirror.py: Summe der Tetraeder-Volumina ueber alle Dreiecke.
    Negativ = in x gespiegelt ohne Winding-Flip (so liegen alle Module vor)."""
    me = o.data
    me.calc_loop_triangles()
    vol = 0.0
    for t in me.loop_triangles:
        a, b, c = (o.matrix_world @ me.vertices[i].co for i in t.vertices)
        vol += a.dot(b.cross(c)) / 6.0
    return vol

pfade = sys.argv[sys.argv.index("--") + 1:]
for pfad in pfade:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=pfad)
    print(f"=== {pfad}")
    gmin = Vector((1e9,)*3); gmax = Vector((-1e9,)*3)
    for o in bpy.data.objects:
        print(f"  OBJ {o.name} type={o.type} loc={tuple(round(v,4) for v in o.location)} "
              f"rot={tuple(round(v,4) for v in o.rotation_euler)} scale={tuple(round(v,4) for v in o.scale)} "
              f"parent={o.parent.name if o.parent else None}")
        if o.type != "MESH":
            continue
        mats = [m.name if m else None for m in o.data.materials]
        print(f"      verts={len(o.data.vertices)} faces={len(o.data.polygons)} mats={mats}")
        # Ein Netz ohne Ecken haette omin=1e9 und omax=-1e9 — als Huellbox
        # gemeldet waere das eine Zahl, die wie eine Messung aussieht. Lieber
        # laut daneben stehen als still falsch.
        if not o.data.vertices:
            print(f"KENNZAHL {os.path.basename(pfad)} {o.name} tris=0 verts=0 "
                  f"mat={','.join(str(m) for m in mats) or '-'} volumen=LEER "
                  f"ursprung={zahlen(gltf(o.location))} bbox=LEER")
            continue
        omin = Vector((1e9,)*3); omax = Vector((-1e9,)*3)
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            for i in range(3):
                gmin[i] = min(gmin[i], w[i]); gmax[i] = max(gmax[i], w[i])
                omin[i] = min(omin[i], w[i]); omax[i] = max(omax[i], w[i])
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        # Ecken der Huellbox in glTF-Achsen sortieren: die y-Negation dreht
        # min und max um, ein blosses Umschreiben der Reihenfolge waere falsch.
        a, b = gltf(omin), gltf(omax)
        huelle = [min(a[i], b[i]) for i in range(3)] + [max(a[i], b[i]) for i in range(3)]
        print(f"KENNZAHL {os.path.basename(pfad)} {o.name} tris={tris} "
              f"verts={len(o.data.vertices)} "
              f"mat={','.join(str(m) for m in mats) or '-'} "
              f"volumen={signiertes_volumen(o) + 0.0:.4f} "
              f"ursprung={zahlen(gltf(o.location))} "
              f"bbox={zahlen(huelle)}")
    # Blender ist Z-up; glTF-Import wandelt Y-up -> Z-up: glTF y = Blender z, glTF z = -Blender y
    print(f"  BLENDER-BBOX min={tuple(round(v,4) for v in gmin)} max={tuple(round(v,4) for v in gmax)}")
    print(f"  GLTF-BBOX (Y-up) x=[{gmin.x:.4f},{gmax.x:.4f}] y=[{gmin.z:.4f},{gmax.z:.4f}] z=[{-gmax.y:.4f},{-gmin.y:.4f}]")
