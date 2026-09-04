#!/usr/bin/env python3
# Erzeugt: SteingrabTreppe.glb neu — gedreht und um ein `_col`-Netz ergänzt, ohne Blender direkt auf der GLB.
# Baut SteingrabTreppe.glb um, OHNE Blender — direkt auf der GLB:
#
#   1. Das sichtbare Mesh wird um 180 Grad um die Hochachse gedreht
#      (x -> -x, z -> -z, Positionen UND Normalen). Grund: das Tripo-Modell
#      steigt nach -z, die Definition in shared/src/eigeneDungeons.ts hat den
#      unteren Connector bei z=-6 (y=0) und den oberen bei z=+6 (y=8), steigt
#      also nach +z. Der Client spiegelt nur x (Babylons __root__), z bleibt.
#      Eine 180-Grad-Drehung hat Determinante +1: Wicklung und damit das
#      negative Signed Volume der Vorspiegelung bleiben erhalten.
#
#   2. Ein zweites Mesh `SteingrabTreppe_col` mit eigenem Material
#      `Kollision` kommt dazu (Konvention s. client/src/engine/AssetManager.ts):
#      unsichtbar, kein Schatten, ERSETZT die Kollision des ganzen Prefabs.
#      Die Havok-Kapsel (r 0,4, Steigungsgrenze 40 Grad) nimmt keine
#      Setzstufe ueber ~9 cm; die 0,4er Stufen des Bildes sind fuer sie Waende.
#
# WARUM DIREKT AUF DER GLB und nicht ueber Blender: der glTF-Exporter kodiert
# die eingebetteten PNGs neu. Hier bleiben BIN-Chunk, bufferViews 4 und 5
# (stein_normal, stein_albedo) und die TEXCOORDs Byte fuer Byte unangetastet;
# angehaengt wird nur das neue Kollisionsnetz.
#
# python3 make-steingrab-treppe-col.py <ein.glb> <aus.glb>
import json
import struct
import sys

# ── Messwerte des Originals (measure-steingrab-treppe*.py) ─────────────────
# Durchgehender Lauf ueber die vollen 12 m, KEINE Podeste: 20 Trittflaechen
# y = 0,4 … 8,0 in 0,4-Schritten, je 0,6 m tief. Die Ruecklkante der Stufe n
# liegt (im gedrehten Endstand) bei z = -6 + 0,6n auf y = 0,4n — also exakt
# auf der Geraden durch die beiden Connectors.
LAUF_Z = 6.0            # Enden bei z = -LAUF_Z .. +LAUF_Z (bleiben OFFEN)
HOEHE = 8.0             # Hoehensprung unten -> oben
STEIG = HOEHE / (2 * LAUF_Z)     # 0,6667 -> 33,69 Grad
INNEN = 1.675           # gemessenes Innenmass: davor ist nichts, dahinter Wand
AUSSEN = 2.0            # Aussenkante der Huelle
RAMPE_D = 0.30          # Dicke der Rampe nach unten (Boden am unteren Ende)
KOPF = 3.60             # gemessene lichte Hoehe Trittflaeche -> Deckenunterkante
DECKE_D = 0.40          # Dicke der Deckenplatte nach oben
WAND_Y0, WAND_Y1 = -0.40, 12.10   # Waende ueber die volle Huellenhoehe


def rampe(z):
    """Oberkante der Kollisionsrampe: die Gerade durch beide Connectors.
    Sie trifft die Ruecklkante JEDER Trittflaeche auf den Millimeter und
    liegt sonst bis zu einer Stufenhoehe darunter — die Figur sinkt also
    leicht in die Stufe ein, statt ueber ihr zu schweben."""
    return STEIG * (z + LAUF_Z)


# ── Quader/Prismen ─────────────────────────────────────────────────────────
# Ein Koerper ist ein Prisma ueber dem Grundriss [x0,x1] x [z0,z1] mit einer
# Unter- und einer Oberkante, die beide nur von z abhaengen (also eben sind).
def prisma(x0, x1, z0, z1, unten, oben):
    """Liefert (verts, faces) mit NACH AUSSEN zeigender Wicklung."""
    p = {}
    for ix, x in ((0, x0), (1, x1)):
        for iz, z in ((0, z0), (1, z1)):
            p[(ix, 0, iz)] = (x, unten(z), z)
            p[(ix, 1, iz)] = (x, oben(z), z)
    # Je Seite die vier Ecken; die Reihenfolge wird unten gegen die
    # Soll-Aussenrichtung geprueft und noetigenfalls gedreht.
    seiten = [
        ([(1, 0, 0), (1, 0, 1), (1, 1, 1), (1, 1, 0)], (1, 0, 0)),    # +x
        ([(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)], (-1, 0, 0)),   # -x
        ([(0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1)], (0, 1, 0)),    # oben
        ([(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)], (0, -1, 0)),   # unten
        ([(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)], (0, 0, 1)),    # +z
        ([(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)], (0, 0, -1)),   # -z
    ]
    verts, faces = [], []
    for ecken, soll in seiten:
        q = [p[k] for k in ecken]
        u = [q[1][i] - q[0][i] for i in range(3)]
        v = [q[2][i] - q[0][i] for i in range(3)]
        n = (u[1] * v[2] - u[2] * v[1],
             u[2] * v[0] - u[0] * v[2],
             u[0] * v[1] - u[1] * v[0])
        if sum(n[i] * soll[i] for i in range(3)) < 0:
            q = q[::-1]
            n = tuple(-c for c in n)
        L = max((sum(c * c for c in n)) ** 0.5, 1e-12)
        n = tuple(c / L for c in n)
        b = len(verts)
        verts += [(pt, n) for pt in q]
        faces += [(b, b + 1, b + 2), (b, b + 2, b + 3)]
    return verts, faces


def bau_kollision():
    """Die vier Koerper des Kollisionsnetzes."""
    koerper = []
    # Rampe: Oberflaeche exakt auf der Connector-Geraden, 0,3 dick nach unten.
    # Am unteren Ende ist ihre Unterseite bei y=-0,3 — dieselbe Lage wie die
    # Unterseite der ersten Stufe im Bild: das ist der Boden.
    koerper.append(prisma(-INNEN, INNEN, -LAUF_Z, LAUF_Z,
                          lambda z: rampe(z) - RAMPE_D, rampe))
    # Decke: dieselbe Schraege, 3,6 ueber der Rampe (gemessener Kopfraum).
    koerper.append(prisma(-INNEN, INNEN, -LAUF_Z, LAUF_Z,
                          lambda z: rampe(z) + KOPF,
                          lambda z: rampe(z) + KOPF + DECKE_D))
    # Seitenwaende: am gemessenen Innenmass, ueber die volle Huellenhoehe.
    for s in (-1, 1):
        a, b = sorted((s * INNEN, s * AUSSEN))
        koerper.append(prisma(a, b, -LAUF_Z, LAUF_Z,
                              lambda z: WAND_Y0, lambda z: WAND_Y1))
    verts, faces = [], []
    for v, f in koerper:
        b = len(verts)
        verts += v
        faces += [(x + b, y + b, z + b) for x, y, z in f]
    # Die Kit-GLBs sind in x VORGESPIEGELT, ohne die Wicklung zu drehen: im
    # Import zeigen alle Normalen nach INNEN, das Signed Volume ist negativ
    # (Pruefung in check-p1.py). Das Kollisionsnetz muss dieselbe Konvention
    # tragen, sonst faellt es aus der Reihe — also Wicklung drehen und
    # Normalen negieren.
    verts = [(p, tuple(-c for c in n)) for p, n in verts]
    faces = [(a, c, b) for a, b, c in faces]
    return verts, faces


# ── GLB lesen ──────────────────────────────────────────────────────────────
EIN, AUS = sys.argv[1], sys.argv[2]
d = open(EIN, "rb").read()
magic, ver, gesamt = struct.unpack_from("<III", d, 0)
assert magic == 0x46546C67 and ver == 2, "kein glTF-2-Binary"
off, chunks = 12, []
while off < gesamt:
    cl, ct = struct.unpack_from("<II", d, off)
    chunks.append([ct, off + 8, cl])
    off += 8 + cl
(jt, jo, jl), (bt, bo, bl) = chunks[0], chunks[1]
assert jt == 0x4E4F534A and bt == 0x004E4942
j = json.loads(d[jo:jo + jl].decode("utf-8"))
BIN = bytearray(d[bo:bo + bl])

# ── 1. Sichtbares Mesh drehen: 180 Grad um Y = x und z negieren ────────────
sicht_mesh = j["meshes"][0]
prim = sicht_mesh["primitives"][0]
gedreht = []
for attr in ("POSITION", "NORMAL"):
    ai = prim["attributes"][attr]
    acc = j["accessors"][ai]
    bv = j["bufferViews"][acc["bufferView"]]
    assert acc["componentType"] == 5126 and acc["type"] == "VEC3"
    assert "byteStride" not in bv, "gepackt erwartet"
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    n = acc["count"]
    werte = list(struct.unpack_from(f"<{n * 3}f", BIN, base))
    for i in range(n):
        werte[3 * i] = -werte[3 * i]          # x
        werte[3 * i + 2] = -werte[3 * i + 2]  # z
    struct.pack_into(f"<{n * 3}f", BIN, base, *werte)
    if "min" in acc:
        xs = werte[0::3]; ys = werte[1::3]; zs = werte[2::3]
        acc["min"] = [min(xs), min(ys), min(zs)]
        acc["max"] = [max(xs), max(ys), max(zs)]
    gedreht.append((attr, n))
print(f"gedreht: {gedreht}, neue POSITION-Huelle "
      f"min={j['accessors'][prim['attributes']['POSITION']]['min']} "
      f"max={j['accessors'][prim['attributes']['POSITION']]['max']}")

# ── 2. Kollisionsnetz anhaengen ────────────────────────────────────────────
verts, faces = bau_kollision()
assert len(verts) < 65536
pos = b"".join(struct.pack("<3f", *p) for p, _ in verts)
nrm = b"".join(struct.pack("<3f", *n) for _, n in verts)
idx = b"".join(struct.pack("<3H", *f) for f in faces)
while len(BIN) % 4:
    BIN += b"\0"

def anhaengen(daten, ziel):
    while len(BIN) % 4:
        BIN.extend(b"\0")
    o = len(BIN)
    BIN.extend(daten)
    j["bufferViews"].append({"buffer": 0, "byteOffset": o,
                             "byteLength": len(daten), "target": ziel})
    return len(j["bufferViews"]) - 1

bv_pos = anhaengen(pos, 34962)
bv_nrm = anhaengen(nrm, 34962)
bv_idx = anhaengen(idx, 34963)
xs = [p[0] for p, _ in verts]; ys = [p[1] for p, _ in verts]; zs = [p[2] for p, _ in verts]
j["accessors"].append({"bufferView": bv_pos, "componentType": 5126,
                       "count": len(verts), "type": "VEC3",
                       "min": [min(xs), min(ys), min(zs)],
                       "max": [max(xs), max(ys), max(zs)]})
a_pos = len(j["accessors"]) - 1
j["accessors"].append({"bufferView": bv_nrm, "componentType": 5126,
                       "count": len(verts), "type": "VEC3"})
a_nrm = len(j["accessors"]) - 1
j["accessors"].append({"bufferView": bv_idx, "componentType": 5123,
                       "count": len(faces) * 3, "type": "SCALAR"})
a_idx = len(j["accessors"]) - 1

j["materials"].append({
    "name": "Kollision", "doubleSided": False,
    "pbrMetallicRoughness": {"baseColorFactor": [0.9, 0.15, 0.15, 1.0],
                             "metallicFactor": 0.0, "roughnessFactor": 1.0}})
m_koll = len(j["materials"]) - 1
j["meshes"].append({"name": "SteingrabTreppe_col",
                    "primitives": [{"attributes": {"POSITION": a_pos,
                                                   "NORMAL": a_nrm},
                                    "indices": a_idx, "material": m_koll}]})
j["nodes"].append({"mesh": len(j["meshes"]) - 1, "name": "SteingrabTreppe_col"})
j["scenes"][0]["nodes"].append(len(j["nodes"]) - 1)
j["buffers"][0]["byteLength"] = len(BIN)

# ── 3. GLB schreiben ───────────────────────────────────────────────────────
js = json.dumps(j, separators=(",", ":")).encode("utf-8")
js += b" " * (-len(js) % 4)
BIN.extend(b"\0" * (-len(BIN) % 4))
kopf = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(BIN))
with open(AUS, "wb") as f:
    f.write(kopf)
    f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack("<II", len(BIN), 0x004E4942)); f.write(bytes(BIN))
print(f"geschrieben {AUS}: {12 + 8 + len(js) + 8 + len(BIN)} Bytes, "
      f"Kollisionsnetz {len(verts)} verts / {len(faces)} tris, "
      f"BIN {bl} -> {len(BIN)} (+{len(BIN) - bl})")
