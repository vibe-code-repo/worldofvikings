# Erzeugt: Höhenkarte, Normal-Map, Albedo und Roughness aus einem gescannten
# Felsmodell (Tripo) — die Vorlage für `felsrelief.py --relief-quelle`.
#
# flatpak run org.blender.Blender --background --factory-startup \
#   --python tools/elements/pipeline/backe-hoehenkarte.py -- <quelle.glb> <ausgabeordner>
#
# ── Warum Blender und nicht trimesh ────────────────────────────────────
# Auf Mikes Maschine ist `trimesh` NICHT installiert (nachgesehen am
# 05.09.2026: `ModuleNotFoundError`), Blender dagegen sicher — und Blender
# bringt neben dem BVH auch den glTF-Leser samt eingebetteter Texturen mit.
# Ein reiner Python-Weg müsste GLB, JPEG und PNG selbst auspacken. Das
# Skript hängt deshalb an `bpy`; alles, was danach kommt (das Lesen der
# Karte in `felsrelief.py`), ist wieder abhängigkeitsfrei.
#
# ── Was hier gemessen und NICHT angenommen wurde (Schritt 2) ───────────
# Gemessen mit BVH-Strahlsonde und zwei Streiflicht-Renderings am
# 05.09.2026 an `~/wov-ai/jobs/rock wall texture 3d model.glb`:
#
#   * 1 Netz `tripo_node_bf43655c`, 48 446 Dreiecke, 40 843 Ecken,
#     Weltmatrix = Einheitsmatrix (kein Objektversatz, keine Skalierung).
#   * Hüllbox in Blender-Achsen: x -48,5936 .. +48,5936 (97,187),
#     y -16,0312 .. +16,0312 (32,062), z 0 .. 98,1555.
#     Die Wand steht also aufrecht: z ist HOCH, x ist BREIT, y ist TIEF.
#     z beginnt bei genau 0 — der Ursprung sitzt an der Unterkante.
#   * BEIDE y-Seiten tragen Relief (das Modell ist eine geschlossene
#     Schale, keine Platte). Die Sonde über 40 × 40 Punkte misst
#     y− Spanne 15,73 / Streuung 2,868 gegen y+ Spanne 13,93 / Streuung
#     2,269; die Renderings (`seite-yminus.png` / `seite-yplus2.png`)
#     zeigen auf y− die tieferen, gerichteten Klüfte. VORDERSEITE = −y.
#     Das war die Stelle, an der Annehmen teuer gewesen wäre: aus den
#     Flächennormalen allein (Y− 12 609 gegen Y+ 12 601 Flächen) wäre die
#     Rückseite genauso plausibel gewesen.
#   * Einheiten: Tripo liefert einheitenlos. 97 × 98 legt cm nahe, aber
#     das ist für uns gleichgültig — die Karte wird auf die Paneelfläche
#     GESTRECKT (s. Schritt 4), es zählt nur das Verhältnis.
#   * Texturen: alle drei 4096², eingebettet — `…_basecolor.jpg` (sRGB),
#     `…_normal.jpg` (Non-Color), `…_rm.png` (Non-Color, glTF-Kanäle:
#     G = Roughness, B = Metallic). Eine UV-Lage `UVMap`.
#
# ── KACHELN STATT STRECKEN (Mass B, 05.09.2026) ────────────────────────
# Bis heute wurde der Scan über die GANZE Vorderseite des Modells gelegt
# und auf 2 × 3,5 m GESTRECKT. Das Modell ist rund 1 × 1 m gross; jeder
# Brocken wurde damit doppelt so breit und dreieinhalbmal so hoch, seine
# TIEFE aber nicht — eine 5 cm breite Kluft wurde 10 cm breit und blieb
# 5 cm tief. Genau das ist Mikes Befund „im Spiel sieht es viel weniger
# grob aus als im Tripo-Viewer": Die Handschrift war da, nur um den
# Faktor 2 bis 3,5 verwaschen.
#
# Deshalb wird jetzt in ORIGINALGRÖSSE gescannt (eine Kachel von 1 × 1 m)
# und die Paneelkarte daraus GEKACHELT: 2 Kacheln nebeneinander, 3,5
# übereinander. Zwei Dinge halten die Wiederholung in Grenzen:
#
#   * Jede Kachel bekommt eine eigene ORIENTIERUNG aus der Diedergruppe
#     des Quadrats (8 Möglichkeiten: spiegeln in x, spiegeln in z,
#     Vierteldrehung). Zwei benachbarte Kacheln tragen nie dieselbe.
#   * Die Kacheln überlappen sich um `KACHEL_NAHT` und werden in der
#     Überlappung ineinander geblendet. Ohne das stünde an jeder
#     Kachelgrenze eine harte Kante im 1-m-Raster — und ein Gitter aus
#     1-m-Kanten wäre schlimmer als der verwaschene Fels.
#
# Ehrlich dazu: Es bleibt EIN Quadratmeter Gestein, zwölfmal gedreht. Was
# die Kachelung liefert, ist der MASSSTAB, nicht mehr Material. Mehr
# Material hiesse ein zweiter Scan.
#
# ── Warum welche Auflösung ─────────────────────────────────────────────
# HÖHENKARTE 512 × 896, 16 Bit — das bleibt, es ist die Paneelfläche bei
# 256 Bildpunkten je Meter. `felsrelief.py` tastet sie auf seinem Raster
# ab (heute 0,0625 m, also 16 Bildpunkte je Rasterschritt). Was 16 Bit
# trägt: 8 Bit auf 18 cm Hub wären 0,7 mm Stufen, und die stehen als
# Terrassen in der schrägen Bruchfläche. Die Auflösung ist billig, die
# Bittiefe nicht.
#
# Der SCAN dagegen ist jetzt quadratisch (512 × 512 Strahlen über die
# Vorderseite des Modells) und damit BILLIGER als die 458 752 von gestern.
# Die Höhenkachel wird daraus auf 256 × 256 heruntergemittelt (das ist
# 1 m bei 256 px/m), die Texturen wie bisher auf 1024² gebracht.
#
# TEXTUREN 1024², 8 Bit. Sie gehen einen völlig anderen Weg: nicht ins
# Netz, sondern triplanar ins Steinmaterial
# (`client/src/engine/DungeonSteinMaterial.ts`). Triplanar heisst
# QUADRATISCH und KACHELBAR — eine Karte in Paneelform (2 × 3,5) wäre
# dort verzerrt. Deshalb sind die Texturen quadratisch und bekommen einen
# Überblendrand, die Höhenkarte dagegen Paneelform ohne Kachelung.
# 1024² ist ausserdem die Grenze, ab der die 4096er-Atlanten dieses
# Rechners nicht mehr in den Speicher passen (Gedächtnis: OOM bei
# parallelen Tripo-Atlanten) — die Quellbilder werden vor dem Lesen
# heruntergerechnet.
#
# ── Warum die Normal-Map aus BEIDEM entsteht ───────────────────────────
# Geometrie ODER Tripo-Karte wären beide falsch:
#   * NUR Geometrie: Die Wand trägt das Höhenfeld bereits als Dreiecke.
#     Eine Normal-Map, die dasselbe noch einmal sagt, verdoppelt die
#     Neigung und macht aus Fels Knetmasse.
#   * NUR Tripo-Karte: Sie ist tangentenbezogen auf die QUELLFLÄCHE. In
#     einer Kluft steht die Quellfläche 60 Grad zur Wandebene; ihre
#     Tangentennormale in unsere Wandebene übernommen zeigt in die
#     falsche Richtung.
# Deshalb: Die Weltnormale am Auftreffpunkt (Flächenrichtung, gestört
# durch die Tripo-Normal-Map) wird in die Wandebene gedreht, und davon
# wird der Anteil ABGEZOGEN, den das Höhenfeld ohnehin schon trägt (sein
# Gradient auf dem 0,125-m-Raster). Übrig bleibt genau das, was unterhalb
# des Rasters liegt — das Korn, das keine Dreiecke kostet.
#
# Bakes a height map, a detail normal map, albedo and roughness from a
# scanned rock model; the height map feeds the rock recipe, the textures
# feed the triplanar stone material.
import math
import os
import sys
import zlib

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ARGS = sys.argv[sys.argv.index("--") + 1:]
if len(ARGS) < 2:
    raise SystemExit("Aufruf: … backe-hoehenkarte.py -- <quelle.glb> <ausgabeordner>")
QUELLE, ZIEL = ARGS[0], ARGS[1]

# ── Gemessene Vorgaben (s. Kopf, Schritt 2) ────────────────────────────
# Sie stehen hier als ZAHLEN und nicht als Vermutung; `--auto` ersetzt sie
# durch die Messung an einem anderen Modell.
FRONT = -1.0          # Vorderseite: Blender −y
BREIT_ACHSE = 0       # x
HOCH_ACHSE = 2        # z
AUTO = "--auto" in ARGS

# ── Zielmasse ──────────────────────────────────────────────────────────
PANEEL_B, PANEEL_H = 2.0, 3.5   # Wandpaneel des Kits
KARTE_B, KARTE_H = 512, 896     # 512/2,0 = 256 px/m, 896/3,5 = 256 px/m
TEX = 1024
SCAN = 512                      # Strahlen je Achse über die Vorderseite
KACHEL_M = 1.0                  # Kantenlänge einer Kachel in Metern
KACHEL = 256                    # ... in Bildpunkten (= 256 px/m)
KACHEL_NAHT = 20                # Überlappung zweier Kacheln, in Bildpunkten
                                # (rund 8 cm — schmal genug, dass die
                                # Überblendung als Kluft liest, breit genug,
                                # dass keine Kante stehen bleibt)
TIEFE_MAX = 0.18                # Relieftiefe: PROT im Fels-Stil
RAND_M = 0.03                   # Randstreifen auf Nullniveau (Nahtregel)
UEBERBLEND_M = 0.09             # Breite der Überblendung hinter dem Rand


def lade():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=QUELLE)
    netze = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if len(netze) != 1:
        raise SystemExit(f"Erwartet genau ein Netz, gefunden {len(netze)}")
    return netze[0]


def bild_als_feld(name_teil, groesse=TEX):
    """Ein eingebettetes Bild als (groesse, groesse, 4)-Feld.

    Erst herunterrechnen, dann lesen: `img.pixels` eines 4096ers sind
    268 MB als Fliesskommafeld, und drei davon nebeneinander haben diesen
    Rechner schon zum OOM gebracht (Gedächtnis).
    """
    treffer = [i for i in bpy.data.images if name_teil in i.name]
    if not treffer:
        return None
    img = treffer[0]
    if img.size[0] != groesse or img.size[1] != groesse:
        img.scale(groesse, groesse)
    feld = np.empty(groesse * groesse * 4, dtype=np.float32)
    img.pixels.foreach_get(feld)
    # Blender legt Bilder von UNTEN nach oben ab; die UV-Koordinate tut
    # dasselbe, also bleibt die Reihenfolge, wie sie ist.
    return feld.reshape(groesse, groesse, 4)


def uv_am_treffer(netz, tri_index, ort, tri_ecken, uv_ecken):
    """Baryzentrische UV im getroffenen Dreieck."""
    a, b, c = tri_ecken[tri_index]
    ua, ub, uc = uv_ecken[tri_index]
    v0, v1, v2 = b - a, c - a, ort - a
    d00 = v0.dot(v0); d01 = v0.dot(v1); d11 = v1.dot(v1)
    d20 = v2.dot(v0); d21 = v2.dot(v1)
    nen = d00 * d11 - d01 * d01
    if abs(nen) < 1e-12:
        return ua
    v = (d11 * d20 - d01 * d21) / nen
    w = (d00 * d21 - d01 * d20) / nen
    u = 1.0 - v - w
    return ua * u + ub * v + uc * w


def hole(feld, uv):
    """Nächster Nachbar im Feld — die Quelle ist 4096², wir lesen 1024²;
    eine bilineare Filterung fügte nichts hinzu, was die Skalierung nicht
    schon gemittelt hätte."""
    n = feld.shape[0]
    x = int(uv[0] * n) % n
    y = int(uv[1] * n) % n
    return feld[y, x]


def schreibe_png(pfad, feld, bits=8):
    """PNG ohne Fremdbibliothek — Graustufe (2D) oder RGB (3D).

    Warum von Hand: Blenders `save_render` kann nur, was ein
    Bilddatenblock kann, und ein 16-Bit-Graustufen-PNG gehört nicht dazu
    (es würde RGBA daraus machen). `felsrelief.py` liest die Karte später
    ebenso ohne Fremdbibliothek — beide Enden bleiben so nachrechenbar.
    """
    feld = np.clip(feld, 0.0, 1.0)
    if feld.ndim == 2:
        farbtyp, kanaele = 0, 1
        daten = feld[:, :, None]
    else:
        farbtyp, kanaele = 2, 3
        daten = feld[:, :, :3]
    h, w = daten.shape[0], daten.shape[1]
    if bits == 16:
        roh = (daten * 65535.0 + 0.5).astype('>u2')
    else:
        roh = (daten * 255.0 + 0.5).astype(np.uint8)
    zeilen = roh.reshape(h, w * kanaele).tobytes()
    schritt = w * kanaele * (2 if bits == 16 else 1)
    puffer = bytearray()
    for y in range(h):
        puffer.append(0)                                  # Filter 0 (None)
        puffer += zeilen[y * schritt:(y + 1) * schritt]

    def block(typ, inhalt):
        return (len(inhalt).to_bytes(4, 'big') + typ + inhalt
                + zlib.crc32(typ + inhalt).to_bytes(4, 'big'))

    ihdr = (w.to_bytes(4, 'big') + h.to_bytes(4, 'big')
            + bytes([bits, farbtyp, 0, 0, 0]))
    with open(pfad, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(block(b'IHDR', ihdr))
        f.write(block(b'IDAT', zlib.compress(bytes(puffer), 9)))
        f.write(block(b'IEND', b''))


def ueberblende_kachelrand(feld, breite):
    """Macht ein Feld kachelbar: die Ränder werden über `breite` Punkte
    mit dem gespiegelten gegenüberliegenden Rand verschmolzen.

    Nur für die QUADRATISCHEN Texturen — die Höhenkarte wird nicht
    gekachelt, sie bekommt statt dessen den Randstreifen aus Schritt 4.
    """
    n = feld.shape[0]
    t = np.linspace(0.0, 1.0, breite)[:, None]
    t = t * t * (3.0 - 2.0 * t)
    for _ in range(2):                       # einmal je Achse
        kopf = feld[:breite].copy()
        fuss = feld[-breite:].copy()
        if feld.ndim == 3:
            tt = t[:, :, None]
        else:
            tt = t
        feld[:breite] = kopf * tt + fuss[::-1] * (1.0 - tt)
        feld[-breite:] = feld[:breite][::-1]
        feld = np.swapaxes(feld, 0, 1).copy()
    return feld


# ── Die acht Lagen einer quadratischen Kachel ──────────────────────────
# Die Diedergruppe des Quadrats: Spiegeln in x, Spiegeln in z, Drehen um
# 90 Grad — acht Möglichkeiten, dieselbe Kachel hinzulegen. Sie sind der
# einzige Vorrat an Verschiedenheit, den EIN Scan hergibt.
#
# Warum kein zyklischer VERSATZ dazu: Die Kachel ist nicht in sich
# kachelbar (sie ist ein Ausschnitt aus einem Fels, keine Textur). Ein
# Versatz legte deshalb mitten in die Kachel eine Kante — und zwar eine,
# die keine Überblendung auffängt, weil sie nicht an der Kachelgrenze
# liegt. Drehen und Spiegeln lassen die Kachel dagegen unversehrt.
def _lage(kachel, k):
    a = kachel
    if k & 1:
        a = a[:, ::-1]
    if k & 2:
        a = a[::-1, :]
    if k & 4:
        a = a.T
    return np.ascontiguousarray(a)


def _rampe(n, u):
    """Fensterfunktion einer Kachelspur: über `u` Punkte auf, über `u` ab.

    Zwei benachbarte Kacheln überlappen sich um genau `u`; dort ist die
    eine Rampe `t` und die andere `1-t`, die Summe also 1. An den beiden
    Enden der Spur fehlt der Partner — deshalb wird am Ende durch die
    aufsummierten Gewichte GETEILT statt sich auf die Summe zu verlassen.
    """
    w = np.ones(n, dtype=np.float32)
    t = np.linspace(0.0, 1.0, u + 2, dtype=np.float32)[1:-1]
    t = t * t * (3.0 - 2.0 * t)
    w[:u] = t
    w[n - u:] = t[::-1]
    return w


def kachel_zu_paneel(scan):
    """Aus dem quadratischen Scan die Paneelkarte 512 × 896 kacheln.

    Der Scan hat SCAN × SCAN Punkte und deckt EINEN Quadratmeter Fels
    (Mass B, s. Kopf). Er wird zuerst auf KACHEL × KACHEL gemittelt — das
    ist dieselbe Bildpunktdichte wie die Paneelkarte (256 px/m), und
    gemittelt statt gepickt, weil ein herausgegriffener Bildpunkt aus
    einer 3-cm-Kluft eine Zufallszahl macht.

    Dann werden die Kacheln mit Überlappung `KACHEL_NAHT` und je eigener
    Lage nebeneinandergelegt; in der Überlappung blenden sie ineinander.
    """
    f = SCAN // KACHEL
    kachel = scan[: KACHEL * f, : KACHEL * f].reshape(KACHEL, f, KACHEL, f).mean(axis=(1, 3))
    kachel = kachel.astype(np.float32)

    u = KACHEL_NAHT
    schritt = KACHEL - u
    nx = max(1, -(-(KARTE_B - u) // schritt))
    nz = max(1, -(-(KARTE_H - u) // schritt))
    breit = (nx - 1) * schritt + KACHEL
    hoch = (nz - 1) * schritt + KACHEL
    summe = np.zeros((hoch, breit), dtype=np.float32)
    gewicht = np.zeros((hoch, breit), dtype=np.float32)
    fenster = _rampe(KACHEL, u)[:, None] * _rampe(KACHEL, u)[None, :]
    for jz in range(nz):
        for jx in range(nx):
            # Die Lage haengt nur an (jx, jz) — kein Zufallsgenerator, damit
            # ein zweiter Backlauf dieselbe Karte legt. Der Sprung um 3 in x
            # und 5 in z sorgt dafuer, dass weder waagerechte noch senkrechte
            # Nachbarn und auch nicht die uebernaechsten dieselbe Lage tragen.
            k = (3 * jx + 5 * jz) % 8
            z0, x0 = jz * schritt, jx * schritt
            summe[z0:z0 + KACHEL, x0:x0 + KACHEL] += _lage(kachel, k) * fenster
            gewicht[z0:z0 + KACHEL, x0:x0 + KACHEL] += fenster
    paneel = summe / np.maximum(gewicht, 1e-6)
    print(f"KACHELN {nx} x {nz} a {KACHEL_M:.1f} m, Naht {u} Punkte "
          f"({u / KACHEL * KACHEL_M * 100:.0f} cm), Rohflaeche {breit}x{hoch}")
    return paneel[:KARTE_H, :KARTE_B]


def main():
    netz = lade()
    netz.data.calc_loop_triangles()
    mw = netz.matrix_world
    ecken = [mw @ v.co for v in netz.data.vertices]
    tri_ecken, tri_uv, tri_norm = [], [], []
    uvl = netz.data.uv_layers.active.data
    for t in netz.data.loop_triangles:
        tri_ecken.append(tuple(ecken[i] for i in t.vertices))
        tri_uv.append(tuple(Vector(uvl[l].uv) for l in t.loops))
        tri_norm.append(mw.to_3x3() @ t.normal)

    mn = Vector((min(p.x for p in ecken), min(p.y for p in ecken),
                 min(p.z for p in ecken)))
    mx = Vector((max(p.x for p in ecken), max(p.y for p in ecken),
                 max(p.z for p in ecken)))
    print(f"HUELLBOX {[round(v,4) for v in mn]} .. {[round(v,4) for v in mx]}")

    bvh = BVHTree.FromPolygons([tuple(v) for v in ecken],
                               [list(t.vertices) for t in netz.data.loop_triangles],
                               all_triangles=True)

    basis = bild_als_feld("basecolor")
    normal = bild_als_feld("normal")
    rm = bild_als_feld("_rm")
    if basis is None:
        raise SystemExit("Keine Basecolor-Textur im GLB gefunden")

    # ── Der Raster-Scan ────────────────────────────────────────────────
    # Ein Punkt je Bildpunkt der HÖHENKARTE; die Texturen entstehen aus
    # demselben Scan (quadratisch nachgerechnet, s. u.), damit Farbe und
    # Form garantiert derselben Stelle des Gesteins entstammen.
    nb = nh = SCAN
    start_y = mn.y - 1.0 if FRONT < 0 else mx.y + 1.0
    richtung = Vector((0.0, 1.0 if FRONT < 0 else -1.0, 0.0))
    weite = (mx.y - mn.y) + 2.0

    tiefe = np.zeros((nh, nb), dtype=np.float32)
    alb = np.zeros((nh, nb, 3), dtype=np.float32)
    rau = np.zeros((nh, nb), dtype=np.float32)
    nrm = np.zeros((nh, nb, 3), dtype=np.float32)
    fehl = 0
    for iz in range(nh):
        z = mn.z + (mx.z - mn.z) * (iz + 0.5) / nh
        for ix in range(nb):
            x = mn.x + (mx.x - mn.x) * (ix + 0.5) / nb
            ort, nrml, idx, dist = bvh.ray_cast(
                Vector((x, start_y, z)), richtung, weite)
            if ort is None:
                fehl += 1
                tiefe[iz, ix] = 0.0
                alb[iz, ix] = (0.5, 0.5, 0.5)
                rau[iz, ix] = 0.8
                nrm[iz, ix] = (0.0, 0.0, 1.0)
                continue
            tiefe[iz, ix] = dist
            uv = uv_am_treffer(netz, idx, ort, tri_ecken, tri_uv)
            alb[iz, ix] = hole(basis, uv)[:3]
            rau[iz, ix] = hole(rm, uv)[1] if rm is not None else 0.8
            # Weltnormale = Flächenrichtung, gestört durch die Tripo-Karte.
            fn = tri_norm[idx].normalized()
            if normal is not None:
                tn = hole(normal, uv)[:3] * 2.0 - 1.0
                # Tangentenrahmen der Wandebene (x = breit, z = hoch):
                # Die Störung wird IN DER WANDEBENE angesetzt, nicht in der
                # Tangente der Quellfläche — genau das ist die Drehung aus
                # dem Kopf.
                stoer = Vector((float(tn[0]), 0.0, float(tn[1]))) * 0.6
                fn = (fn + stoer).normalized()
            # Kartenachsen: X = Paneelbreite, Y = Paneelhoehe, Z = aus der
            # Wand heraus. Die Vorderseite ist -y, also zeigt +Z der Karte
            # auf -y der Welt: FRONT * fn.y.
            nrm[iz, ix] = (fn.x, fn.z, FRONT * fn.y)
        if iz % 64 == 0:
            print(f"  Zeile {iz}/{nh}")
    print(f"STRAHLEN fehl={fehl} von {nb*nh}")

    # ── Höhe: Auftrefftiefe -> Vorsprung in [0,1] ──────────────────────
    gueltig = tiefe > 0
    d0, d1 = float(tiefe[gueltig].min()), float(tiefe[gueltig].max())
    hoehe = np.where(gueltig, 1.0 - (tiefe - d0) / max(1e-6, d1 - d0), 0.0)
    print(f"TIEFE roh {d0:.3f} .. {d1:.3f} Einheiten "
          f"(Spanne {(d1-d0):.3f} = {(d1-d0)/(mx.x-mn.x)*KACHEL_M*100:.1f} cm "
          f"auf {KACHEL_M:.0f} m Kachelbreite, also in Originalgroesse)")

    # ── Schritt 4a: aus der Kachel die Paneelkarte legen ───────────────
    hoehe_kachel = hoehe
    hoehe = kachel_zu_paneel(hoehe)
    nb, nh = KARTE_B, KARTE_H

    # ── Schritt 4b: Randstreifen und Überblendung ──────────────────────
    # Die Karte ist die Vorlage EINES Paneels von 2 × 3,5 m. `felsrelief.py`
    # setzt den eigentlichen Nahtschluss (Randniveau, 0,125-m-Raster); was
    # die Karte beisteuert, ist ein Rand, der schon in der Vorlage auf
    # NULL liegt — sonst müsste die Überblendung dort einen Sprung von bis
    # zu 9 cm auffangen.
    px_x = KARTE_B / PANEEL_B
    px_z = KARTE_H / PANEEL_H
    maske = np.ones((nh, nb), dtype=np.float32)
    for achse, px, n in ((1, px_x, nb), (0, px_z, nh)):
        r = max(1, int(round(RAND_M * px)))
        u = max(1, int(round(UEBERBLEND_M * px)))
        prof = np.ones(n, dtype=np.float32)
        prof[:r] = 0.0
        prof[n - r:] = 0.0
        t = np.linspace(0.0, 1.0, u + 2)[1:-1]
        t = t * t * (3.0 - 2.0 * t)
        prof[r:r + u] = t
        prof[n - r - u:n - r] = t[::-1]
        maske *= prof[None, :] if achse == 1 else prof[:, None]
    # ── Wohin der Rand blendet: auf das NEUTRALE Niveau, nicht auf 0 ────
    # Naheliegend waere 0 gewesen — "Randstreifen auf Nullniveau". In
    # dieser Karte bedeutet 0 aber nicht "keine Verdraengung", sondern
    # "ganz hinten": am Modulrand staende dann eine 9 cm tiefe Rinne, und
    # zwar GENAU da, wo `felsrelief.py` seinerseits auf sein
    # variantenfreies Randniveau ueberblendet (dort RAND_NIVEAU = 1,8 cm
    # Rueckzug, dicht an der Vorderkante — sonst klafft die Innenecke
    # zwischen Endstreifen und Fels, gemessen am 05.09.2026 mit 2353
    # hellen Pixeln). Zwei Randregeln, die gegeneinander arbeiten, ergeben
    # eine Kerbe. Der Rand der Karte geht deshalb auf ihren MITTELWERT —
    # die Flaeche ohne Merkmal —, und den Nahtschluss macht allein das
    # Rezept.
    #
    # Nebenwirkung, die wir brauchen: links und rechts endet die Karte auf
    # DEMSELBEN Wert. Damit passt ihre linke Kante auf ihre rechte, und
    # `felsrelief.py` darf sie in x mit Versatz umlaufen lassen, ohne dass
    # an der Modulgrenze ein Sprung entsteht.
    neutral = float(hoehe[maske > 0.999].mean()) if (maske > 0.999).any() else 0.5
    hoehe = neutral + (hoehe - neutral) * maske
    print(f"RAND neutral={neutral:.4f} streifen={RAND_M*100:.0f} cm "
          f"ueberblendung={UEBERBLEND_M*100:.0f} cm")

    # Tiefe klemmen: der Hub ist 9 cm, mehr nimmt die Spielerkapsel nicht
    # (Gedächtnis `wov-kollisionsnetz-col`). Die Karte trägt 0..1 und
    # bedeutet 0..TIEFE_MAX — die Klemme ist damit die Skala selbst.
    print(f"KARTE hoehe {KARTE_B}x{KARTE_H} 16 Bit, entspricht "
          f"{PANEEL_B} x {PANEEL_H} m bei {TIEFE_MAX*100:.0f} cm Hub")

    os.makedirs(ZIEL, exist_ok=True)
    schreibe_png(os.path.join(ZIEL, "rock-wall-01-hoehe.png"), hoehe, bits=16)

    # ── Texturen: quadratisch, kachelbar ───────────────────────────────
    # Aus demselben Scan, aber auf 1024² umgetastet: die Höhenkarte ist in
    # z 1,75-mal feiner beprobt als in x (896 auf 3,5 m gegen 512 auf 2 m
    # — beide 256 px/m), das Verhältnis der Quelle ist dagegen quadratisch.
    def quadrat(feld):
        zi = (np.arange(TEX) * (SCAN / TEX)).astype(int)
        xi = (np.arange(TEX) * (SCAN / TEX)).astype(int)
        return feld[zi][:, xi]

    alb_q = ueberblende_kachelrand(quadrat(alb).copy(), TEX // 12)
    rau_q = ueberblende_kachelrand(quadrat(rau).copy(), TEX // 12)
    nrm_q = quadrat(nrm).copy()

    # Detail-Normale: Gradient des Höhenfeldes abziehen — den trägt das
    # Netz schon. Gerechnet wird auf der KACHEL, nicht auf der
    # Paneelkarte: Die Textur ist quadratisch und deckt einen
    # Quadratmeter, das Höhenfeld hier also ebenfalls.
    h_q = quadrat(hoehe_kachel).astype(np.float32)
    gx = np.gradient(h_q, axis=1) * (TEX / KACHEL_M) * TIEFE_MAX
    gz = np.gradient(h_q, axis=0) * (TEX / KACHEL_M) * TIEFE_MAX
    # Die Normale steht der Steigung ENTGEGEN: bei nach rechts steigender
    # Hoehe kippt sie nach links. Deshalb minus.
    nrm_q[:, :, 0] -= gx
    nrm_q[:, :, 1] -= gz
    laenge = np.sqrt((nrm_q ** 2).sum(axis=2, keepdims=True))
    nrm_q = nrm_q / np.maximum(laenge, 1e-6)
    nrm_q = ueberblende_kachelrand(nrm_q, TEX // 12)
    laenge = np.sqrt((nrm_q ** 2).sum(axis=2, keepdims=True))
    nrm_q = nrm_q / np.maximum(laenge, 1e-6)
    neigung = np.degrees(np.arccos(np.clip(nrm_q[:, :, 2], -1, 1)))
    print(f"NORMALE mittlere Neigung {neigung.mean():.1f} Grad, "
          f"90-Perzentil {np.percentile(neigung, 90):.1f} Grad")

    # Blender liefert die Bildpunkte einer sRGB-Textur LINEAR. Ungewandelt
    # geschrieben waere die Wand im Spiel deutlich zu dunkel — der Shader
    # ruft `toLinearSpace` noch einmal (DungeonSteinMaterial.ts:239).
    srgb = np.where(alb_q <= 0.0031308, alb_q * 12.92,
                    1.055 * np.power(np.clip(alb_q, 0, None), 1 / 2.4) - 0.055)
    schreibe_png(os.path.join(ZIEL, "stein_tripo_rock.png"), srgb, bits=8)
    schreibe_png(os.path.join(ZIEL, "stein_tripo_rock_normal.png"),
                 nrm_q * 0.5 + 0.5, bits=8)
    schreibe_png(os.path.join(ZIEL, "rock-wall-01-roughness.png"), rau_q, bits=8)
    print("FERTIG", ZIEL)


main()
