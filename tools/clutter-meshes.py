#!/usr/bin/env python3
"""
Erzeugt die sechs Clutter-Meshes fuer `client/src/engine/GrassClutter.ts`.

    python3 tools/clutter-meshes.py                    # alle sechs
    python3 tools/clutter-meshes.py --nur clutter_lily # nur eines
    python3 tools/clutter-meshes.py --ziel assets/models

── Warum das Werkzeug ueberhaupt gebraucht wird ─────────────────────
`assets/` ist vollstaendig gitignored. Was dort liegt und kein Rezept
unter `tools/` hat, ist auf einem frischen Checkout schlicht weg — und
genau das war der Fall: Die sechs GLBs, die `MESH_FILES` in
GrassClutter.ts auflistet, stammten aus dem AssetRipper-Export und
hatten nie einen Erzeuger. Ergebnis war ein 404 auf
`clutter_default.glb` und damit gar kein Bodenbewuchs mehr, denn
GrassClutter.load() bricht beim ersten fehlenden Mesh komplett ab
(`throw new Error(...)` in der Ladeschleife) — ein einziges fehlendes
GLB kostet also die gesamte Vegetation im Nahbereich, nicht nur die
eine Art.

── Warum reines Python und nicht Blender ────────────────────────────
Alle anderen Modell-Werkzeuge des Projekts laufen unter Blender
(`baum-generieren.py`, `busch-generieren.py`, …). Hier waere das der
schlechtere Weg, aus drei Gruenden:

1. Es geht um Karten, nicht um Geometrie. Ein Grasbueschel sind sechs
   gekruemmte Vierecksstreifen mit exakt vorgegebenen UVs. Blender
   braucht dafuer keinen einzigen seiner Modellierschritte.
2. Der glTF-Exporter darf Vertices zusammenlegen und nach Material und
   UV-Naht neu sortieren. Genau die UV-Belegung ist hier aber die
   empfindliche Groesse (siehe naechster Abschnitt) — sie soll Bit fuer
   Bit das sein, was hier steht, und nicht das, was ein Exporter daraus
   macht.
3. Der Container laesst sich direkt schreiben und damit auch direkt
   garantieren. Das Projekt hatte schon einmal GLBs, bei denen
   `buffers[0].byteLength` nicht zur Laenge des BIN-Chunks passte
   (Docs/06-Roadmap.md, „AssetRipper-GLBs"; dafuer existiert bis heute
   `tools/fix-glb-buffer-length.mjs`). `glb_schreiben()` unten leitet
   beide Zahlen aus derselben Variablen ab, der Fehler ist damit
   strukturell ausgeschlossen.

── Die UV-Belegung ist Vertrag, nicht Geschmack ─────────────────────
`tools/gen-grass-texture.py` zeichnet die Gras-Atlanten in DREI
senkrechte Spalten (u 0.01–0.37, 0.37–0.66, 0.66–0.975), jede ueber die
volle Bildhoehe. Die Karten hier greifen dieselben Spalten ab, reihum.
Umgekehrt gilt genauso: Wer die Spalten in einem der beiden Werkzeuge
verschiebt, muss das andere mitziehen.

Die zweite Haelfte des Vertrags ist die Laufrichtung von v:

    v = 1  ist der BODEN,  v = 0  ist die SPITZE.

Das ist die Konvention aller Clutter-Karten des Projekts — der beiden
Gras-Atlanten wie der acht Texturen aus `clutter-texturen.py`; alle
sind Vollbild-Billboards mit Pflanzen von unten nach oben. Deshalb
duerfen die Karten hier auch keine Sprite-Atlas-Kacheln abgreifen:
Senkrechte Streifen ueber die volle Bildhoehe sind der einzige
Zuschnitt, der zu einem Vollbild-Billboard passt.

Ein frueherer Versuch, die 128er-Originalmaske aus Valheim mit diesen
Meshes zu benutzen, scheiterte genau daran (siehe MEADOWS_TINT in
GrassClutter.ts, 2026-07-29: „die Halme zerfielen zu eckigen
Schollen"). Der Kommentar dort schliesst mit „Dafuer braucht es die zum
Original passende Clutter-Geometrie" — das ist diese Datei, nur
andersherum geloest: Nicht die Geometrie folgt einer fremden Textur,
sondern Geometrie und Textur stammen jetzt beide von uns und teilen
sich eine dokumentierte Konvention.

── Warum die Abmessungen des Originals eingehalten werden ───────────
Die Bounding-Boxen (siehe PROFILE) sind auf die Masse der frueheren
Valheim-GLBs gelegt. Das ist keine Nachahmung um ihrer selbst willen,
sondern Ruecksicht auf getunte Zahlen: `ENTRIES` in GrassClutter.ts
traegt je Eintrag ein `prefabScale` und `scaleMin/scaleMax`, und
`topY` (der hoechste Vertex) geht in die Normierung des Windwedelns
ein. Andere Rohmasse haetten jeden dieser Werte entwertet. Mit den
gehaltenen Massen ergibt sich unveraendert:

    meadowsGrass       0.25 × 2.0 × (1.0…2.3)  =  0.50…1.15 m hoch
    meadowsGrassShort  0.25 × 1.2 × (1.0…2.0)  =  0.30…0.60 m
    heathGrass         0.25 × 3.5 × (0.7…1.5)  =  0.61…1.31 m
    forestCover        0.29 × 2.2 × 1.0        =  0.64 m
    vass               1.41 × 1.0 × (1.0…1.3)  =  1.41…1.83 m

── Warum die Normalen flaechensenkrecht sind ────────────────────────
Dieselbe Begruendung wie in `tools/blumen-generieren.py`: Babylon
spiegelt bei zweiseitiger Beleuchtung die Normale auf der Rueckseite
(GrassClutter setzt `twoSidedLighting = true` und
`backFaceCulling = false`). Eine nach OBEN gerichtete Normale wird
dadurch von hinten zu einer nach unten gerichteten, und die Karte ist
von einer Seite unbeleuchtet. Flaechensenkrecht plus Spiegelung heisst
dagegen: Die Normale zeigt immer zum Betrachter.

Fuer `clutter_default`, `grasscross` und `clutter_plane` ist das
ohnehin gleichgueltig — `pinUpNormals` in ENTRIES ueberschreibt die
Normale im Fragment-Shader mit (0,1,0) (ClutterWindPlugin,
CUSTOM_FRAGMENT_BEFORE_LIGHTS). Fuer Farn, Schilf und Seerose steht
das Flag aber auf false, dort werden die Normalen hier wirklich
benutzt.
"""
import argparse
import json
import math
import os
import random
import struct

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── Der UV-Vertrag mit tools/gen-grass-texture.py ────────────────────
# Drei senkrechte Spalten. Kleine Raender, damit die bilineare Filterung
# am Spaltenrand nicht den Nachbarhalm mit hereinzieht.
SPALTEN = [(0.01, 0.37), (0.37, 0.66), (0.66, 0.975)]
# v = 1 Boden, v = 0 Spitze. Nicht ganz bis an den Bildrand: die
# aeusserste Texelreihe wird beim Erzeugen der Mipmaps mit dem
# Wiederholungsrand gemischt.
V_BODEN = 0.992
V_SPITZE = 0.032


# ── GLB schreiben ────────────────────────────────────────────────────

def _pad4(daten, fuell=b"\x00"):
    """Auf ein Vielfaches von 4 auffuellen — glTF verlangt das fuer jeden
    Chunk und fuer jede bufferView-Ausrichtung."""
    rest = (-len(daten)) % 4
    return daten + fuell * rest


def glb_schreiben(pfad, name, pos, nor, uv, idx):
    """Schreibt eine GLB mit genau einem Mesh aus einem Primitive.

    `buffers[0].byteLength` und die Laenge des BIN-Chunks kommen aus
    DERSELBEN Variablen (`bin_roh`) — siehe Dateikopf, das ist der Fehler,
    der das Projekt schon einmal getroffen hat.
    """
    n_v = len(pos)
    kurz = n_v < 65536  # UNSIGNED_SHORT reicht

    b_pos = b"".join(struct.pack("<3f", *p) for p in pos)
    b_nor = b"".join(struct.pack("<3f", *n) for n in nor)
    b_uv = b"".join(struct.pack("<2f", *t) for t in uv)
    b_idx = b"".join(struct.pack("<H" if kurz else "<I", i) for i in idx)

    teile, versaetze, laenge = [], [], 0
    for roh in (b_pos, b_nor, b_uv, b_idx):
        versaetze.append(laenge)
        gefuellt = _pad4(roh)
        teile.append(gefuellt)
        laenge += len(gefuellt)
    bin_roh = b"".join(teile)

    p_min = [min(p[k] for p in pos) for k in range(3)]
    p_max = [max(p[k] for p in pos) for k in range(3)]

    gltf = {
        "asset": {"version": "2.0", "generator": "worldofvikings tools/clutter-meshes.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [{
            "name": name,
            "primitives": [{
                "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
                "indices": 3,
                "material": 0,
                "mode": 4,
            }],
        }],
        # Das Material ist nur fuer Vorschauwerkzeuge (glb-vorschau.py) da.
        # GrassClutter liest ausschliesslich positions/normals/uvs/indices
        # und baut sein StandardMaterial selbst.
        "materials": [{
            "name": name + "_mat",
            "doubleSided": True,
            "alphaMode": "MASK",
            "alphaCutoff": 0.5,
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.45, 0.62, 0.28, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 1.0,
            },
        }],
        "buffers": [{"byteLength": len(bin_roh)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": versaetze[0], "byteLength": len(b_pos), "target": 34962},
            {"buffer": 0, "byteOffset": versaetze[1], "byteLength": len(b_nor), "target": 34962},
            {"buffer": 0, "byteOffset": versaetze[2], "byteLength": len(b_uv), "target": 34962},
            {"buffer": 0, "byteOffset": versaetze[3], "byteLength": len(b_idx), "target": 34963},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": n_v, "type": "VEC3",
             "min": p_min, "max": p_max},
            {"bufferView": 1, "componentType": 5126, "count": n_v, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": n_v, "type": "VEC2"},
            {"bufferView": 3, "componentType": 5123 if kurz else 5125,
             "count": len(idx), "type": "SCALAR"},
        ],
    }

    json_roh = _pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    gesamt = 12 + 8 + len(json_roh) + 8 + len(bin_roh)
    with open(pfad, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, gesamt))
        f.write(struct.pack("<II", len(json_roh), 0x4E4F534A))
        f.write(json_roh)
        f.write(struct.pack("<II", len(bin_roh), 0x004E4942))
        f.write(bin_roh)
    return gesamt


# ── Karten-Bauteil ───────────────────────────────────────────────────

def karte(pos, nor, uv, idx, *, wurzel, azimut, hoehe, reichweite, bogen,
          breite_fuss, breite_spitze, segmente, u0, u1, schaerfe=0.85):
    """Haengt einen gekruemmten Vierecksstreifen ("Halm", "Wedel") an.

    Die Mittellinie ist ein KREISBOGEN, kein Polynom: Der Halm startet
    senkrecht und neigt sich ueber seine Laenge um `bogen`. Das ist die
    Form, die ein biegsamer Halm unter seinem Eigengewicht wirklich
    annimmt, und sie hat den praktischen Vorteil, mit einem einzigen
    Winkel steuerbar zu sein — ueber 90 Grad hinaus faellt die Spitze von
    selbst wieder nach unten, was den Unterschied zwischen `clutter_default`
    (aufrecht) und `grasscross` (haengend) ausmacht.

    Der Einheitsbogen wird danach auf `hoehe` und `reichweite` gestreckt.
    Die Streckung ist bewusst anisotrop: Sie erlaubt, Wuchshoehe und
    Ausladung unabhaengig zu treffen, ohne den Winkel nachzujustieren.
    Die Normalen werden deshalb AUS DER GESTRECKTEN Geometrie gerechnet
    und nicht aus dem Bogen — sonst stuenden sie schief.
    """
    ax, ay, az = wurzel
    aus = (math.cos(azimut), 0.0, math.sin(azimut))          # Ausbreitungsrichtung
    quer = (-math.sin(azimut), 0.0, math.cos(azimut))        # Breitenrichtung

    # Einheitsbogen (Radius 1) abtasten und auf 1 normieren, damit `hoehe`
    # und `reichweite` echte Meter sind.
    roh = []
    for s in range(segmente + 1):
        t = s / segmente
        w = bogen * t
        roh.append((1.0 - math.cos(w), math.sin(w)))         # (quer zur Achse, hoch)
    h_max = max(p[1] for p in roh) or 1.0
    r_max = max(p[0] for p in roh) or 1.0

    mitte = []
    for (r, h) in roh:
        mitte.append((
            ax + aus[0] * (r / r_max) * reichweite,
            ay + (h / h_max) * hoehe,
            az + aus[2] * (r / r_max) * reichweite,
        ))

    basis = len(pos)
    for s in range(segmente + 1):
        t = s / segmente
        # Verjuengung: (1-t)^schaerfe laeuft spitz aus, ohne dass der
        # letzte Abschnitt zur Nadel entartet.
        b = (breite_fuss * (1.0 - t) ** schaerfe + breite_spitze * t) * 0.5
        c = mitte[s]
        # Tangente aus der GESTRECKTEN Mittellinie (zentrale Differenz).
        vor = mitte[max(s - 1, 0)]
        nach = mitte[min(s + 1, segmente)]
        tg = (nach[0] - vor[0], nach[1] - vor[1], nach[2] - vor[2])
        # Normale = quer × Tangente
        nx = quer[1] * tg[2] - quer[2] * tg[1]
        ny = quer[2] * tg[0] - quer[0] * tg[2]
        nz = quer[0] * tg[1] - quer[1] * tg[0]
        ln = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
        nx, ny, nz = nx / ln, ny / ln, nz / ln

        v = V_BODEN + (V_SPITZE - V_BODEN) * t
        for seite in (-1, 1):
            pos.append((c[0] + quer[0] * b * seite, c[1], c[2] + quer[2] * b * seite))
            nor.append((nx, ny, nz))
            uv.append((u0 if seite < 0 else u1, v))

    for s in range(segmente):
        a = basis + s * 2
        idx.extend([a, a + 1, a + 3, a, a + 3, a + 2])


def quad_flach(pos, nor, uv, idx, *, mitte, halb, drehung, y):
    """Waagerechtes Viereck (Seerosenblatt) mit voller UV-Belegung.

    Volle 0..1-UV, weil `waterlilies.png` ein Vollbild-Billboard ist
    (ein Blatt, formatfuellend) — eine Atlas-Kachel wuerde dort brechen.
    """
    c, s = math.cos(drehung), math.sin(drehung)
    ecken = [(-halb, -halb), (halb, -halb), (halb, halb), (-halb, halb)]
    basis = len(pos)
    for (ex, ez), (u, v) in zip(ecken, [(0, 1), (1, 1), (1, 0), (0, 0)]):
        pos.append((mitte[0] + ex * c - ez * s, y, mitte[2] + ex * s + ez * c))
        nor.append((0.0, 1.0, 0.0))
        uv.append((float(u), float(v)))
    idx.extend([basis, basis + 1, basis + 2, basis, basis + 2, basis + 3])


def quad_senkrecht(pos, nor, uv, idx, *, azimut, breite, hoehe, y0=0.0):
    """Senkrechtes Viereck durch die Mitte — der Baustein des Kreuz-Billboards."""
    dx, dz = math.cos(azimut), math.sin(azimut)
    nx, nz = -math.sin(azimut), math.cos(azimut)
    h = breite * 0.5
    basis = len(pos)
    for (sx, sy), (u, v) in zip(
        [(-1, 0), (1, 0), (1, 1), (-1, 1)], [(0, 1), (1, 1), (1, 0), (0, 0)]
    ):
        pos.append((dx * h * sx, y0 + hoehe * sy, dz * h * sx))
        nor.append((nx, 0.0, nz))
        uv.append((float(u), float(v)))
    idx.extend([basis, basis + 1, basis + 2, basis, basis + 2, basis + 3])


# ── Profile ──────────────────────────────────────────────────────────
#
# `hoehe`/`tiefe`/`radius` sind die Zielmasse der Bounding-Box in Metern
# und stammen aus den Massen der frueheren GLBs (siehe Dateikopf).
# `tiefe` ist der Betrag, um den die Halme UNTER dem Ursprung ansetzen:
# Sie wachsen aus dem Boden heraus, statt auf ihm aufzusitzen — auf
# geneigtem Gelaende schliesst das die Luecke zwischen Halmfuss und Grund.

PROFILE = {
    # Wiesen-, Heide- und Kurzgras. Sechs Halme, drei Abschnitte:
    # ergibt 48 Vertices und 36 Dreiecke — dasselbe Budget wie die
    # Vorgaengerdatei.
    "clutter_default": dict(
        art="buendel", halme=6, segmente=3, hoehe=0.249, tiefe=0.029, radius=0.56,
        bogen=100.0, breite_fuss=0.30, breite_spitze=0.05, streu=0.11, seed=7,
    ),
    # "droopy": gleiche Anlage, aber tiefer angesetzt und staerker
    # gebogen — der Bodenbewuchs von Schwarzwald und Sumpf haengt.
    "grasscross": dict(
        art="buendel", halme=6, segmente=3, hoehe=0.291, tiefe=0.160, radius=0.56,
        bogen=125.0, breite_fuss=0.34, breite_spitze=0.06, streu=0.11, seed=11,
    ),
    # Kreuz-Billboard fuer Strauch und Heideblume: zwei senkrechte
    # Vierecke ueber Kreuz, 8 Vertices, 4 Dreiecke, volle UV.
    "clutter_plane": dict(art="kreuz", hoehe=1.0, halb=1.0),
    # Farn: acht Wedel, die sich weit ausladend ueberbiegen.
    "clutter_fern": dict(
        art="buendel", halme=8, segmente=9, hoehe=0.881, tiefe=0.110, radius=1.48,
        bogen=118.0, breite_fuss=0.62, breite_spitze=0.10, streu=0.06, seed=23,
        # Volle Bildbreite statt einer Spalte: `clutter-texturen.py` malt
        # EINEN Wedel, der die Karte ausfuellt: Die Fiedern reichen bis
        # etwa u 0.16 und 0.84. Ein schmalerer Ausschnitt (das frueher
        # hier stehende 0.318…0.706) haette sie beidseitig abgeschnitten
        # und nur die Mittelrippe stehen gelassen.
        #
        # Der zweite Eintrag ist derselbe Bereich RUECKWAERTS. Weil u0 und
        # u1 in karte() einfach den beiden Kartenseiten zugewiesen werden,
        # spiegelt das den Wedel — die acht Wedel wechseln sich damit ab,
        # statt achtmal dasselbe Bild zu zeigen.
        spalten=[(0.02, 0.98), (0.98, 0.02)], schaerfe=0.55,
    ),
    # Schilf: hohe, schmale, fast gerade Halme, tief im Grund verankert.
    "clutter_vass": dict(
        art="buendel", halme=20, segmente=5, hoehe=1.406, tiefe=0.633, radius=0.86,
        bogen=52.0, breite_fuss=0.17, breite_spitze=0.02, streu=0.18, seed=31,
        schaerfe=1.10,
    ),
    # Seerosen: flach schwimmende Blaetter.
    #
    # BEWUSSTE Abweichung von der Vorgaengerdatei: Die hatte Stengel bis
    # y = -2.51 hinunter. Die entfallen hier ersatzlos. Der Eintrag
    # `lilies` traegt `schwimmt: true` — ClutterWindPlugin hebt und senkt
    # das Blatt mit der Welle, waehrend der Grund liegen bleibt. Ein
    # starrer Stengel wuerde diese Bewegung mitmachen und sich dabei aus
    # dem Boden ziehen. Zu sehen ist er ohnehin nie: Er stuende unter
    # einer blickdichten Wasseroberflaeche (siehe den `schwimmt`-Kommentar
    # in GrassClutter.ts). 12 statt 32 Dreiecke bei 40 Instanzen je Patch.
    "clutter_lily": dict(art="seerose", blaetter=6, radius=0.70, blatt=0.92, seed=41),
}


def baue(name, prof, rnd):
    pos, nor, uv, idx = [], [], [], []

    if prof["art"] == "kreuz":
        for az in (0.0, math.pi / 2):
            quad_senkrecht(pos, nor, uv, idx, azimut=az,
                           breite=prof["halb"] * 2, hoehe=prof["hoehe"])

    elif prof["art"] == "seerose":
        # Goldener Winkel, damit die Blaetter sich nicht zu Reihen ordnen.
        gold = math.pi * (3.0 - math.sqrt(5.0))
        for i in range(prof["blaetter"]):
            a = i * gold
            r = prof["radius"] * math.sqrt((i + 0.5) / prof["blaetter"])
            quad_flach(
                pos, nor, uv, idx,
                mitte=(math.cos(a) * r, 0.0, math.sin(a) * r),
                halb=prof["blatt"] * 0.5 * rnd.uniform(0.78, 1.0),
                drehung=rnd.uniform(0, math.tau),
                # Winzige Hoehenstaffelung: Ohne sie liegen die Blaetter
                # exakt koplanar und stanzen sich gegenseitig im Tiefenpuffer
                # aus (Z-Fighting als Flimmern auf der Wasserflaeche).
                y=i * 0.008,
            )

    else:  # "buendel"
        gold = math.pi * (3.0 - math.sqrt(5.0))
        spalten = prof.get("spalten", SPALTEN)
        for i in range(prof["halme"]):
            # Goldener Winkel statt gleicher Schritte: Bei festen
            # Abstaenden sieht man das Bueschel aus bestimmten Richtungen
            # geschlossen auf Kante — dieselbe Ueberlegung wie in
            # tools/blumen-generieren.py.
            az = i * gold + rnd.uniform(-0.25, 0.25)
            u0, u1 = spalten[i % len(spalten)]
            streu = prof["streu"]
            karte(
                pos, nor, uv, idx,
                wurzel=(rnd.uniform(-streu, streu), -prof["tiefe"], rnd.uniform(-streu, streu)),
                azimut=az,
                hoehe=(prof["hoehe"] + prof["tiefe"]) * rnd.uniform(0.82, 1.0),
                reichweite=prof["radius"] * rnd.uniform(0.72, 1.0),
                bogen=math.radians(prof["bogen"]) * rnd.uniform(0.85, 1.15),
                breite_fuss=prof["breite_fuss"] * rnd.uniform(0.85, 1.15),
                breite_spitze=prof["breite_spitze"],
                segmente=prof["segmente"],
                u0=u0, u1=u1,
                schaerfe=prof.get("schaerfe", 0.85),
            )

    return pos, nor, uv, idx


def main():
    p = argparse.ArgumentParser(description="Baut die sechs Clutter-Meshes.")
    p.add_argument("--ziel", default="assets/models")
    p.add_argument("--nur", default=None,
                   help="Nur dieses Mesh bauen (Dateiname ohne .glb).")
    a = p.parse_args()

    ziel = a.ziel if os.path.isabs(a.ziel) else os.path.join(WURZEL, a.ziel)
    os.makedirs(ziel, exist_ok=True)

    namen = [a.nur] if a.nur else list(PROFILE)
    for name in namen:
        if name not in PROFILE:
            raise SystemExit(f"unbekanntes Mesh: {name} (bekannt: {', '.join(PROFILE)})")
        prof = PROFILE[name]
        # Feste Saat je Mesh — reproduzierbar, wie es die Projektregel
        # fuer Werkzeuge verlangt.
        rnd = random.Random(prof.get("seed", 1))
        pos, nor, uv, idx = baue(name, prof, rnd)
        pfad = os.path.join(ziel, name + ".glb")
        gesamt = glb_schreiben(pfad, name, pos, nor, uv, idx)
        mx = [max(q[k] for q in pos) for k in range(3)]
        mn = [min(q[k] for q in pos) for k in range(3)]
        print(f"{name + '.glb':22} {len(pos):5} Vertices  {len(idx)//3:5} Dreiecke  "
              f"{gesamt:7} B  "
              f"Groesse [{mx[0]-mn[0]:.3f}, {mx[1]-mn[1]:.3f}, {mx[2]-mn[2]:.3f}] "
              f"y {mn[1]:+.3f}…{mx[1]:+.3f}")


if __name__ == "__main__":
    main()
