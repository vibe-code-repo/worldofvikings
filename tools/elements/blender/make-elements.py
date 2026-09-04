# Erzeugt: die Rohlinge der ersten Element-Bibliothek (WandPaneel, Bodenplatte, Deckenplatte) als GLB.
# Parametrischer Generator der ersten Dungeon-ROHLINGE (Element-Bibliothek):
#   WandPaneel  — 2.0 x 3.5 m, 0.3 tief, mit versetztem Blockrelief (Fugen)
#   Bodenplatte — 2.0 x 2.0 m, 0.3 dick, leichte Kantenfase
#   Deckenplatte— 2.0 x 2.0 m, 0.3 dick
# Rastergenau (2 m), einmateriell, Front-/Oberseiten mit korrekter Normale.
# flatpak run org.blender.Blender --factory-startup -b --python make-elements.py -- <out-ordner>
import bpy, bmesh, sys
from mathutils import Vector

OUT = sys.argv[sys.argv.index("--") + 1:][0]

def neu():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def box(bm, cx, cy, cz, sx, sy, sz):
    """Achsenparallele Box mittig (cx,cy,cz), Kantenlängen (sx,sy,sz)."""
    hx, hy, hz = sx/2, sy/2, sz/2
    verts = [bm.verts.new((cx+dx*hx, cy+dy*hy, cz+dz*hz))
             for dx in (-1,1) for dy in (-1,1) for dz in (-1,1)]
    bm.verts.ensure_lookup_table()
    # 8 Ecken -> 6 Quads
    idx = [(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)]
    for a,b,c,d in idx:
        bm.faces.new((verts[a],verts[b],verts[c],verts[d]))

def speichere(name):
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.ops.object.shade_flat()
    bpy.ops.export_scene.gltf(filepath=f"{OUT}/{name}.glb", export_format="GLB", use_selection=True)
    print(f"ELEMENT OK -> {name}.glb  verts {len(o.data.vertices)} faces {len(o.data.polygons)}")

# ── WandPaneel: bündige Rückplatte + KACHELBARE versetzte Blöcke ─────────────
# Ziegel 0,5 m breit, halber Versatz (0,25) -> teilt 2 m sauber; an der Kante
# geteilte Ziegel ergeben mit dem Nachbarpaneel wieder ganze -> NAHTLOS.
def wandpaneel():
    neu()
    me = bpy.data.meshes.new("WandPaneel"); bm = bmesh.new()
    B, H = 2.0, 3.5
    box(bm, 0, H/2, -0.05, B, H, 0.10)           # Rückplatte, bündig, z -0.10..0
    bw, rh, fuge, prot = 0.5, 0.4375, 0.02, 0.06  # Ziegel 0,5 x 0,4375, flach vorne
    n = round(H / rh)                             # 8 Reihen
    for r in range(n):
        cy = (r + 0.5) * rh
        versatz = (bw / 2) if (r % 2) else 0.0
        x = -B/2 - versatz
        while x < B/2 - 1e-4:
            bx0 = max(x, -B/2); bx1 = min(x + bw, B/2)
            w = bx1 - bx0 - fuge
            if w > 0.05:
                box(bm, (bx0 + bx1) / 2, cy, prot/2, w, rh - fuge, prot)
            x += bw
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new("WandPaneel", me); bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.remove_doubles(threshold=1e-4)
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode="OBJECT")
    speichere("WandPaneel")

# ── WandFlach: glatte Wandvariante (bündig) ──────────────────────────────────
def wandflach():
    neu()
    me = bpy.data.meshes.new("WandFlach"); bm = bmesh.new()
    box(bm, 0, 3.5/2, 0, 2.0, 3.5, 0.15)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new("WandFlach", me); bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    speichere("WandFlach")

# ── Eckpfeiler: vertikaler Pfosten an einer Zellecke ─────────────────────────
def eckpfeiler():
    neu()
    me = bpy.data.meshes.new("Eckpfeiler"); bm = bmesh.new()
    box(bm, 0, 3.5/2, 0, 0.36, 3.5, 0.36)        # Schaft
    box(bm, 0, 0.12, 0, 0.46, 0.24, 0.46)        # Basis
    box(bm, 0, 3.5 - 0.12, 0, 0.46, 0.24, 0.46)  # Kapitell
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new("Eckpfeiler", me); bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.remove_doubles(threshold=1e-4)
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode="OBJECT")
    speichere("Eckpfeiler")

# ── Treppe: Stufenlauf über eine Zelle (2 m Lauf, ~2,1 m Anstieg) ────────────
def treppe():
    neu()
    me = bpy.data.meshes.new("Treppe"); bm = bmesh.new()
    stufen, breite = 7, 2.0
    lauf, anstieg = 2.0 / stufen, 0.30
    for i in range(stufen):
        top = (i + 1) * anstieg
        cz = -1.0 + (i + 0.5) * lauf        # Lauf entlang Z, Start bei z=-1
        box(bm, 0, top/2, cz, breite, top, lauf)   # massiv bis zur Stufenoberkante
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new("Treppe", me); bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.remove_doubles(threshold=1e-4)
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode="OBJECT")
    speichere("Treppe")

# ── Boden-/Deckenplatte: Slab 2x2x0.3, Oberseite +Y, leichte Kantenfase ──────
def platte(name):
    neu()
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    box(bm, 0, -0.15, 0, 2.0, 0.3, 2.0)  # Oberseite bei y=0
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.bevel(offset=0.02, segments=1)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    speichere(name)

# ── Torbogen: Durchgangs-Modul (2x3.5x0.3), mittig offen (Pfosten + Sturz) ────
def torbogen():
    neu()
    me = bpy.data.meshes.new("Torbogen"); bm = bmesh.new()
    B, H, T = 2.0, 3.5, 0.3
    oeff_b, oeff_h = 1.3, 2.5          # Öffnung
    pf = (B - oeff_b) / 2              # Pfostenbreite je Seite = 0.35
    # Linker/rechter Pfosten (volle Höhe)
    box(bm, -B/2 + pf/2, H/2, 0, pf, H, T)
    box(bm,  B/2 - pf/2, H/2, 0, pf, H, T)
    # Sturz oben über der Öffnung, plus ein leichter Stufenbogen (2 Stufen)
    box(bm, 0, (oeff_h + H)/2, 0, oeff_b, H - oeff_h, T)
    box(bm, 0, oeff_h - 0.06, 0, oeff_b - 0.30, 0.16, T)   # innere Bogen-Andeutung
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new("Torbogen", me); bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.remove_doubles(threshold=1e-4)
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode="OBJECT")
    speichere("Torbogen")

wandpaneel()
wandflach()
eckpfeiler()
treppe()
platte("Bodenplatte")
platte("Deckenplatte")
torbogen()
print("ALLE ELEMENTE FERTIG")
