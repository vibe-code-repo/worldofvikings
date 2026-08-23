#!/usr/bin/env python3
"""
Zeichnet die Textur fuer die Holztruhe — Eichenbohlen und Schmiedeeisen.

    python3 tools/truhe-texturen.py

── Warum EIN Bild und nicht zwei Materialien ────────────────────────
Der Hausstil der per Skript gebauten Modelle ist sparsam: Findling und
Felsplatte tragen je 80 Dreiecke, EINE Textur und EIN benanntes Material
(78 KB je Datei). Die Tripo-Modelle daneben brauchen 3-4 MB und drei
Bilder — das ist die Ausnahme, nicht die Richtschnur.

Zwei Materialien waeren zwei Zeichenaufrufe je Truhe. Auf einer Insel
mit vielen Kisten summiert sich das, und die Engine legt Meshes ohnehin
nach Material zusammen (siehe `verschmelzeNachMaterial()` und die
Baum-Zusammenlegung vom 17.08.2026, die Master 22 -> 11 halbiert hat).
Deshalb liegen Holz und Eisen in EINEM Bild uebereinander:

    obere 3/4   Eichenbohlen, senkrechte Maserung
    unteres 1/4 Schmiedeeisen, dunkel und leicht gehaemmert

Die Geometrie legt ihre UVs entsprechend in die eine oder die andere
Zone (siehe ZONE_HOLZ / ZONE_EISEN in truhe-generieren.py).

── Kacheln ──────────────────────────────────────────────────────────
Die Bohlen laufen senkrecht und wiederholen sich waagerecht. Alle
Rauschfelder kommen deshalb aus `lib/rauschen.py`, das periodisch ist —
sonst zeigt die Truhe an der Kante eine Naht. Senkrecht wird NICHT
gekachelt (jede Bohle laeuft von Deckel zu Boden durch), waagerecht
schon.

── Warum Eiche und nicht Fichte ─────────────────────────────────────
Der Bestand hat beides. Eine Truhe ist Wertarbeit und steht drinnen;
Eiche ist dafuer das Holz, das ein Wikinger genommen haette, und ihre
kraeftigere Maserung liest sich auf kleiner Flaeche besser als das fast
strukturlose Nadelholz. Die Farben unten sind an `Eiche1.glb`
angelehnt, damit Truhe und Baumbestand zusammenpassen.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from rauschen import normiert, oktaven  # noqa: E402

G = 256
#: Trennlinie zwischen Holz (oben) und Eisen (unten), in Bildzeilen.
TRENNUNG = int(G * 0.75)

#: Eichenbohle: warmes Braun, deutlich gemasert.
HOLZ_TIEF = (86, 60, 36)
HOLZ_HELL = (146, 106, 66)
#: Die Fugen zwischen den Bohlen — fast schwarz, damit die Teilung auch
#: aus der Ferne als Bohlen lesbar bleibt und nicht als Farbfleck.
FUGE = (44, 30, 18)
#: Schmiedeeisen: kuehles Dunkelgrau, nicht blank. Blankes Metall wirkt
#: neben mattem Holz sofort wie Kunststoff.
EISEN_TIEF = (46, 46, 50)
EISEN_HELL = (104, 104, 112)


def bohlen(rnd):
    """Senkrechte Bohlen mit Maserung und dunklen Fugen."""
    h = TRENNUNG
    x = np.arange(G)[None, :].repeat(h, 0)
    y = np.arange(h)[:, None].repeat(G, 1)

    # Sechs Bohlen ueber die Breite. Sechs, weil die Truhe rund 0,9 m
    # breit ist und eine Bohle damit 15 cm bekommt — das ist die Breite,
    # in der man Eiche saegt, ohne dass sie sich wirft.
    anzahl = 6
    breite = G / anzahl
    im_brett = (x % breite) / breite

    # Maserung: laengs gestrecktes Rauschen, damit die Fasern der Bohle
    # folgen statt zu wolken.
    faser = normiert(oktaven(h, G, 3, 26, 4, rnd))
    ringe = np.sin(faser * 15.0 + im_brett * 2.0) * 0.5 + 0.5

    # Jede Bohle bekommt einen eigenen Grundton, sonst sieht die Wand aus
    # wie ein einziges Brett mit aufgemalten Linien.
    tonung = np.zeros_like(ringe)
    for i in range(anzahl):
        maske = (x // breite) == i
        tonung[maske] = rnd.uniform(-0.10, 0.10)

    mischung = np.clip(ringe * 0.65 + faser * 0.35 + tonung, 0, 1)
    bild = np.zeros((h, G, 3), np.float64)
    for k in range(3):
        bild[..., k] = HOLZ_TIEF[k] + (HOLZ_HELL[k] - HOLZ_TIEF[k]) * mischung

    # Fugen: schmaler dunkler Streifen an jeder Bohlenkante.
    fugenbreite = 0.055
    fuge = (im_brett < fugenbreite) | (im_brett > 1.0 - fugenbreite)
    for k in range(3):
        bild[..., k] = np.where(fuge, FUGE[k], bild[..., k])

    # Ein paar Astloecher — sie machen aus Brettern gewachsenes Holz.
    for _ in range(7):
        cx, cy = rnd.uniform(0, G), rnd.uniform(0, h)
        r = rnd.uniform(2.5, 5.0)
        d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
        kern = np.clip(1.0 - d / r, 0, 1) ** 1.6
        for k in range(3):
            bild[..., k] = bild[..., k] * (1 - kern * 0.75) + FUGE[k] * kern * 0.75

    return bild


def eisen(rnd):
    """Gehaemmertes Schmiedeeisen fuer Baender, Schloss und Scharniere."""
    h = G - TRENNUNG
    grob = normiert(oktaven(h, G, 5, 5, 3, rnd))
    fein = normiert(oktaven(h, G, 14, 14, 2, rnd))
    # Hammerschlag: grobe Diagonale, damit die Flaeche nicht wie
    # gegossenes Blech wirkt, sondern wie geschmiedet.
    mischung = np.clip(grob * 0.6 + fein * 0.4, 0, 1)
    bild = np.zeros((h, G, 3), np.float64)
    for k in range(3):
        bild[..., k] = EISEN_TIEF[k] + (EISEN_HELL[k] - EISEN_TIEF[k]) * mischung
    return bild


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--seed', type=int, default=7)
    p.add_argument('--ziel', default='assets/textures/truhe_holz.png')
    a = p.parse_args()

    # numpy-Generator, weil lib/rauschen.py rnd.random((y, x)) mit einer
    # Form aufruft — random.Random kann das nicht.
    rnd = np.random.default_rng(a.seed)

    bild = np.zeros((G, G, 3), np.float64)
    bild[:TRENNUNG] = bohlen(rnd)
    bild[TRENNUNG:] = eisen(rnd)

    os.makedirs(os.path.dirname(a.ziel), exist_ok=True)
    Image.fromarray(np.clip(bild, 0, 255).astype(np.uint8)).save(a.ziel)
    print(f'FERTIG {a.ziel} — {G}x{G}, Holz bis Zeile {TRENNUNG}, Eisen darunter')


if __name__ == '__main__':
    main()
