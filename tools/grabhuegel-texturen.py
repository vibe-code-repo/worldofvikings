#!/usr/bin/env python3
"""
Erzeugt die Texturen des Grabhuegels — Stein, Grassode und Holz.

    python3 tools/grabhuegel-texturen.py [--ziel assets/textures]

── Warum prozedural ─────────────────────────────────────────────────
Wie bei der Eiche (`tools/eiche-texturen.py`): kein gerippten Material,
alles gezeichnet. Der Unterschied ist, dass der Stein sich hier nicht
frei erfinden darf — er soll neben der `WikingerStatue` und dem
`Steinkreis` stehen koennen, ohne dass der Bruch auffaellt.

── Woher die Steinfarben kommen ─────────────────────────────────────
Nicht geraten, sondern am Atlas des TRIPO-MENHIRS gemessen
(`assets/models/GrabMenhir.glb`, eingebettete BaseColor) — die Kranz-
und Portalsteine sollen aus EINEM Bruch stammen:

    Stein  RGB(113, 110, 96)  Helligkeit 64 / 109 / 144 (10./50./90. Perzentil)
    Moos   RGB(95, 96, 62)    stark bewachsen (am Menhir ~40-70 % je Seite)

Fruehere Fassungen massen erst den Steinkreis (62/85/115, 8 % Moos),
dann die Wikingerstatue (57/105/149, 2 % Flechte). Seit die Tripo-
Menhire den Kranz stellen, ist DEREN Oberflaeche die Referenz — der
prozedurale Stein von Portal, Vorbau und Findlingen darf sich davon
nicht abheben.

Deshalb wird der Atlas NICHT ausgeschnitten, sondern nachgezeichnet:
gleiche Farbstatistik, aber kachelbar und ohne Fransen.

── Warum Moos in die Fugen faellt ───────────────────────────────────
Moos waechst dort, wo Wasser steht — in Rissen und Vertiefungen, nicht
auf den Kuppen. Das Moosfeld wird deshalb aus demselben Rauschen
abgeleitet, das die Risse zeichnet, statt unabhaengig gestreut zu
werden. Zufaellig verteiltes Moos liest sich als Schimmel.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from rauschen import furchen, normiert, oktaven  # noqa: E402

G = 256

# An der Wikingerstatue gemessen — siehe Kopf.
STEIN_DUNKEL = (58, 56, 49)
STEIN_HELL = (166, 162, 142)
MOOS = (95, 96, 62)
MOOS_ANTEIL = 0.34


# Verwittertes Eichenholz fuer Schiff und Innenausbau — vergraut, nicht frisch.
HOLZ_DUNKEL = (52, 40, 28)
HOLZ_HELL = (124, 101, 72)


def einfaerben(muster, dunkel, hell):
    a = np.array(dunkel, dtype=float)
    b = np.array(hell, dtype=float)
    return a[None, None, :] + (b - a)[None, None, :] * muster[..., None]


def als_bild(rgb, alpha=255):
    bild = np.zeros((rgb.shape[0], rgb.shape[1], 4), dtype=np.uint8)
    bild[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    bild[..., 3] = alpha
    return Image.fromarray(bild, 'RGBA')


def auf_perzentile(rgb, p10, p90):
    """Streckt die Helligkeit so, dass die gemessenen Perzentile getroffen werden.

    Das Nachzeichnen trifft den Charakter, aber selten den Tonwert — der
    erste Versuch lag bei RGB(77,76,62) statt (94,92,77) und wirkte neben
    dem Steinkreis stumpf. Statt an Konstanten zu drehen, wird hier direkt
    auf die Messung abgebildet: 10. und 90. Perzentil der Helligkeit auf
    die Werte des Originals, der Farbton bleibt.
    """
    hell = rgb.mean(axis=2)
    ist10, ist90 = np.percentile(hell, [10, 90])
    faktor = (p90 - p10) / max(1e-6, ist90 - ist10)
    ziel = (hell - ist10) * faktor + p10
    return np.clip(rgb * (ziel / np.maximum(hell, 1e-6))[..., None], 0, 255)


def stein(seed):
    """Hellgrauer Granit in der Oberflaeche der Wikingerstatue."""
    rnd = np.random.default_rng(seed)

    # Grobe Fleckigkeit des Gesteins plus KRISTALLKOERNUNG. Die feine Stufe
    # wird mit einer Potenz zugespitzt: Granit besteht aus einzelnen
    # hellen Kristallen, ein weiches Rauschen ergibt dagegen Beton.
    grob = oktaven(G, G, 4, 4, 4, rnd)
    korn = oktaven(G, G, 40, 40, 2, rnd)
    kristall = np.clip((korn - 0.45) / 0.55, 0, 1) ** 1.6
    muster = normiert(0.62 * grob + 0.38 * kristall)

    # Risse: schmal und dunkel, in zwei Groessen.
    riss = np.minimum(furchen(G, G, 5, 5, 3, 0.32, rnd),
                      furchen(G, G, 11, 11, 2, 0.40, rnd))
    muster = np.clip(muster * (0.30 + 0.70 * riss), 0, 1)

    rgb = auf_perzentile(einfaerben(muster, STEIN_DUNKEL, STEIN_HELL), 64.0, 144.0)

    # Flechte in FLAECHEN, nicht in Linien. Der erste Versuch leitete die
    # Feuchte direkt aus dem Rissfeld ab — dessen Tiefpunkte sind aber die
    # Risslinien selbst, und das Moos wuchs als duenne Faeden genau darauf.
    # Traegt wird es jetzt von einem grobkoernigen eigenen Feld; die Risse
    # verschieben nur noch, wo innerhalb eines Flecks es dichter sitzt.
    feuchte = normiert(0.78 * oktaven(G, G, 7, 7, 3, rnd) + 0.22 * (1.0 - riss))
    schwelle = np.quantile(feuchte, 1.0 - MOOS_ANTEIL)
    # Weicher Uebergang statt harter Maske: eine scharfe Kante zeichnet
    # sichtbare Umrisse um jeden Moosfleck.
    deckung = np.clip((feuchte - schwelle) / 0.10, 0, 1)[..., None]
    moos = np.array(MOOS, dtype=float)[None, None, :] * (0.75 + 0.5 * muster[..., None])
    return als_bild(rgb * (1 - deckung) + moos * deckung)


def grassode(_seed):
    """Die ECHTE Meadows-Bodentextur, nicht nachgezeichnet.

    Der Huegel steht auf Meadows-Wiese; jede selbst gezeichnete Sode
    bricht an der Kante zum Terrain sichtbar ab (die dunklen Flecken des
    ersten Wurfs bildeten zudem ein deutliches Wiederholmuster). Das
    Terrain zieht seine Oberflaeche aus `terrain_d_array.png` — einem
    256×4096-Stack aus 16 Kacheln, Ebene 0 ist das Meadows-Gras
    (TILE.Grass, client/src/engine/TerrainSplat.ts:71). Genau diese
    Kachel wird hier ausgeschnitten; damit traegt die Kuppel dieselbe
    Textur wie der Boden, auf dem sie steht, und kachelt wie das
    Original.
    """
    wurzel = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    stack = Image.open(os.path.join(wurzel, 'assets/textures/terrain_d_array.png'))
    return stack.crop((0, 0, 256, 256)).convert('RGBA')


def holz(seed):
    """Verwitterte Bohlen — laengs gemasert, mit dunklen Fugen."""
    rnd = np.random.default_rng(seed)

    # Maserung: in x stark gestreckt, damit sie laengs der Bohle laeuft.
    maser = furchen(G, G, 3, 40, 3, 0.5, rnd)
    korn = oktaven(G, G, 8, 90, 2, rnd)
    muster = normiert(0.72 * maser + 0.28 * korn)

    # Bohlenfugen: feste waagerechte Linien. Sie MUESSEN ein Teiler von G
    # sein, sonst zerschneidet die Kachelgrenze die letzte Bohle.
    bohlen = 6
    y = np.arange(G)[:, None]
    abstand = np.minimum(y % (G // bohlen), (G // bohlen) - y % (G // bohlen))
    fuge = np.clip(abstand / 2.5, 0, 1)
    muster = muster * (0.30 + 0.70 * fuge)

    return als_bild(einfaerben(muster, HOLZ_DUNKEL, HOLZ_HELL))


# ── Wikinger-Farben ──────────────────────────────────────────────────
# Pigmente der Zeit: Krapprot, Ocker, Knochenweiss, Waidblau. Kein reines
# Signalrot — die Farben waren mineralisch/pflanzlich und immer gedeckt.
KRAPPROT = (146, 46, 36)
OCKER = (190, 148, 62)
WEISS = (214, 204, 180)
WAIDBLAU = (58, 82, 112)
EISEN = (70, 68, 66)


def schild_atlas(seed):
    """2×2-Atlas bemalter Rundschilde plus Holzrueckseite.

    Quadranten: 0 = Viertel rot/weiss, 1 = Ringe rot/ocker,
    2 = Sektoren blau/weiss, 3 = Holzrueckseite mit Griffbrett.
    Jeder Schild bekommt Eisenbuckel und Nietenring — das sind die
    Details, die eine bemalte Scheibe erst als Schild lesen lassen.
    """
    from PIL import ImageDraw
    import math as m
    rnd = np.random.default_rng(seed)
    A = 512
    Q = A // 2
    bild = Image.new('RGBA', (A, A), (40, 34, 28, 255))
    d = ImageDraw.Draw(bild)

    def buckel(cx, cy):
        d.ellipse([cx - 26, cy - 26, cx + 26, cy + 26], fill=EISEN + (255,))
        d.ellipse([cx - 26, cy - 26, cx + 12, cy + 12], fill=(96, 94, 92, 255))
        for k in range(12):
            w = 2 * m.pi * k / 12
            nx, ny = cx + 104 * m.cos(w), cy + 104 * m.sin(w)
            d.ellipse([nx - 4, ny - 4, nx + 4, ny + 4], fill=EISEN + (255,))

    def kreis(cx, cy, r, farbe):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=farbe + (255,))

    # Q0: Viertel rot/weiss
    cx, cy = Q // 2, Q // 2
    kreis(cx, cy, 118, KRAPPROT)
    for start in (0, 180):
        d.pieslice([cx - 118, cy - 118, cx + 118, cy + 118],
                   start + 90, start + 180, fill=WEISS + (255,))
    buckel(cx, cy)

    # Q1: Ringe rot/ocker/weiss
    cx, cy = Q + Q // 2, Q // 2
    for r, f in ((118, KRAPPROT), (92, OCKER), (64, WEISS), (40, KRAPPROT)):
        kreis(cx, cy, r, f)
    buckel(cx, cy)

    # Q2: acht Sektoren blau/weiss
    cx, cy = Q // 2, Q + Q // 2
    kreis(cx, cy, 118, WAIDBLAU)
    for k in range(4):
        d.pieslice([cx - 118, cy - 118, cx + 118, cy + 118],
                   k * 90 + 22, k * 90 + 67, fill=WEISS + (255,))
    buckel(cx, cy)

    # Q3: Holzrueckseite — Planken quer plus Griffbrett
    x0, y0 = Q, Q
    holzbild = holz(seed + 9).resize((Q, Q))
    bild.paste(holzbild, (x0, y0))
    cx, cy = Q + Q // 2, Q + Q // 2
    d.rectangle([cx - 14, cy - 110, cx + 14, cy + 110], fill=(58, 44, 30, 255))
    d.ellipse([cx - 22, cy - 22, cx + 22, cy + 22], fill=(46, 36, 26, 255))

    # Leichte Abnutzung ueber alles: dunkle Kratzspuren im Anstrich
    a = np.array(bild).astype(float)
    wear = oktaven(A, A, 24, 24, 2, rnd)
    a[..., :3] *= (0.86 + 0.14 * wear)[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')


def segel(seed):
    """Gerefftes Wollsegel: senkrechte Bahnen Krapprot/Naturweiss."""
    rnd = np.random.default_rng(seed)
    web = oktaven(G, G, 48, 12, 2, rnd)          # Gewebe, in y gestreckt
    x = np.arange(G)[None, :]
    # Auf volle Hoehe ausrollen — als (1, G)-Zeile bleibt das Produkt
    # unten sonst einzeilig und die Zuweisung platzt.
    bahn = np.repeat(((x // (G // 8)) % 2).astype(float), G, axis=0)
    rot = np.array(KRAPPROT, dtype=float)
    hell = np.array(WEISS, dtype=float)
    rgb = rot[None, None, :] * bahn[..., None] + hell[None, None, :] * (1 - bahn[..., None])
    rgb *= (0.82 + 0.18 * web)[..., None]
    return als_bild(rgb)


# Aeltere Futhark-Runen als Strichlisten (x0,y0,x1,y1 in 0..1 der Zelle).
RUNEN = [
    [(0.5, 0, 0.5, 1), (0.5, 0.15, 0.9, 0.45), (0.5, 0.45, 0.9, 0.75)],   # F
    [(0.3, 0, 0.3, 1), (0.3, 0, 0.75, 0.55)],                              # U
    [(0.5, 0, 0.5, 1), (0.5, 0.2, 0.85, 0.5), (0.85, 0.5, 0.5, 0.8)],      # Th
    [(0.35, 0, 0.35, 1), (0.35, 0.1, 0.8, 0.4), (0.35, 0.4, 0.8, 0.7)],    # A
    [(0.3, 1, 0.3, 0), (0.3, 0, 0.7, 0.5), (0.7, 0.5, 0.85, 1)],           # R
    [(0.7, 0.1, 0.3, 0.5), (0.3, 0.5, 0.7, 0.9)],                          # K
    [(0.2, 0.2, 0.8, 0.8), (0.2, 0.8, 0.8, 0.2)],                          # G
    [(0.3, 0, 0.3, 1), (0.7, 0, 0.7, 1), (0.3, 0.25, 0.7, 0.55)],          # H
    [(0.5, 0, 0.5, 1)],                                                    # I
    [(0.5, 0, 0.5, 1), (0.5, 0.35, 0.8, 0.1), (0.5, 0.35, 0.8, 0.6)],      # Y
    [(0.3, 0.9, 0.5, 0.1), (0.5, 0.1, 0.7, 0.9)],                          # L
    [(0.25, 1, 0.25, 0), (0.25, 0, 0.75, 0.6), (0.75, 0.6, 0.75, 1)],      # N
]


def stein_runen(seed):
    """Steinflaeche mit eingemeisselten Runenbaendern — das Relief der
    grossen Portal- und Bautasteine.

    Der Meisselschlag entsteht aus zwei versetzten Kopien jedes Strichs:
    dunkel die Rille, direkt darunter ein heller Saum, wo das Licht die
    untere Schnittkante trifft. Ohne den Saum sieht die Ritzung gemalt
    aus statt gehauen.
    """
    from PIL import ImageDraw
    rnd = np.random.default_rng(seed)
    basis = stein(seed)
    d = ImageDraw.Draw(basis)
    zufall = np.random.default_rng(seed + 3)

    for band_y in (52, 150):
        hoehe = 44
        zellen = 9
        breite = G // zellen
        # Bandlinien oben und unten — die Einfassung der Runenzeile
        for y in (band_y - 6, band_y + hoehe + 6):
            d.line([(0, y + 1), (G, y + 1)], fill=(196, 192, 182, 255), width=2)
            d.line([(0, y), (G, y)], fill=(38, 36, 33, 255), width=3)
        for z in range(zellen):
            rune = RUNEN[int(zufall.integers(0, len(RUNEN)))]
            x0 = z * breite + 6
            for (a, b, c, e) in rune:
                p1 = (x0 + a * (breite - 12), band_y + b * hoehe)
                p2 = (x0 + c * (breite - 12), band_y + e * hoehe)
                d.line([(p1[0], p1[1] + 2), (p2[0], p2[1] + 2)],
                       fill=(198, 194, 184, 255), width=3)
                d.line([p1, p2], fill=(36, 34, 31, 255), width=4)
    return basis


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--ziel', default='assets/textures')
    p.add_argument('--seed', type=int, default=17)
    args = p.parse_args()

    wurzel = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ziel = os.path.join(wurzel, args.ziel)
    os.makedirs(ziel, exist_ok=True)

    for name, bild in (('grab_stein.png', stein(args.seed)),
                       ('grab_sode.png', grassode(args.seed + 1)),
                       ('grab_holz.png', holz(args.seed + 2)),
                       ('grab_schild.png', schild_atlas(args.seed + 3)),
                       ('grab_segel.png', segel(args.seed + 4)),
                       ('grab_stein_runen.png', stein_runen(args.seed + 5))):
        pfad = os.path.join(ziel, name)
        bild.save(pfad)
        a = np.array(bild)[..., :3].reshape(-1, 3)
        print(f'FERTIG {pfad} — {bild.size[0]}x{bild.size[1]}, '
              f'mittlere Farbe RGB{tuple(a.mean(axis=0).round().astype(int))}')


main()
