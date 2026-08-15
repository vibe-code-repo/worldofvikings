#!/usr/bin/env python3
"""
Zeichnet die Gesteinstexturen fuer die Felsen — drei Arten, alle gerechnet.

    python3 tools/felsen-texturen.py               # alle
    python3 tools/felsen-texturen.py --art basalt  # eine

── Warum eigene und nicht `grab_stein.png` ──────────────────────────
`tools/grabhuegel-texturen.py` erzeugt bereits einen prozeduralen Granit,
und der taugt auch fuer Felsen. Was ihm fehlt, ist Abwechslung: Ein
Findling, ein Basaltblock und eine Sandsteinbank sehen verschieden aus,
und wenn dreissig Felsen in einer Landschaft dieselbe Oberflaeche tragen,
liest das Auge sie als dasselbe Objekt in verschiedenen Groessen.

Die drei Arten unterscheiden sich in genau drei Dingen, und alle drei
haben eine Entsprechung im Gestein:

    Granit     kristallige Koernung, helle Sprenkel, viel Moos
    Basalt     feinkoernig und dunkel, scharfe Kanten, wenig Moos
    Sandstein  waagerechte SCHICHTUNG, warm, kaum Moos

── Kacheln ──────────────────────────────────────────────────────────
`felsen-generieren.py` legt die Textur ueber eine Kugelprojektion und
wiederholt sie mehrfach. Alle Felder kommen deshalb aus dem periodischen
Rauschen von `lib/rauschen.py` — eine nicht kachelnde Textur zeigt am
Fels eine senkrechte Naht.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from rauschen import furchen, normiert, oktaven  # noqa: E402

G = 256

ARTEN = {
    # Granit: der Findling der Nordlandschaft. Helle Kristalle in
    # dunklerer Grundmasse, verwittert und moosig.
    'granit': {
        'tief': (74, 72, 70),
        'hell': (168, 165, 158),
        'kristall': 0.38,      # Anteil der zugespitzten Feinkoernung
        'risse': (5, 11),      # Zellzahlen der beiden Rissysteme
        'schichtung': 0.0,
        'moos': 0.30,
        'moosfarbe': (74, 96, 52),
    },
    # Basalt: erstarrte Lava, feinkoernig und fast schwarz. Die Risse
    # sind das Auffaelligste — Basalt bricht kantig.
    'basalt': {
        'tief': (34, 34, 38),
        'hell': (96, 96, 104),
        'kristall': 0.12,
        'risse': (4, 9),
        'schichtung': 0.0,
        'moos': 0.10,
        'moosfarbe': (58, 78, 46),
    },
    # Sandstein: waagerecht geschichtet, warm getoent. Die Schichtung
    # ist der ganze Charakter der Art.
    'sandstein': {
        'tief': (118, 92, 66),
        'hell': (198, 172, 134),
        'kristall': 0.10,
        'risse': (3, 8),
        'schichtung': 0.55,    # Anteil der waagerechten Baenderung
        'moos': 0.08,
        'moosfarbe': (86, 96, 56),
    },
}


def einfaerben(muster, tief, hell):
    t = np.array(tief, dtype=float)
    h = np.array(hell, dtype=float)
    return t[None, None, :] + (h - t)[None, None, :] * muster[..., None]


def gestein(profil, seed):
    rnd = np.random.default_rng(seed)

    # Grobe Fleckigkeit plus zugespitzte Feinkoernung. Der Exponent macht
    # aus weichem Rauschen einzelne helle Kristalle — ohne ihn sieht jedes
    # Gestein aus wie Beton.
    grob = oktaven(G, G, 4, 4, 4, rnd)
    korn = oktaven(G, G, 40, 40, 2, rnd)
    kristall = np.clip((korn - 0.45) / 0.55, 0, 1) ** 1.6
    k = profil['kristall']
    muster = normiert((1.0 - k) * grob + k * kristall)

    # Waagerechte Schichtung — nur der Sandstein hat sie. In y viele
    # Zellen, in x fast keine: daraus werden Baender statt Flecken.
    if profil['schichtung'] > 0:
        baender = oktaven(G, G, 26, 2, 3, rnd)
        muster = normiert(
            (1 - profil['schichtung']) * muster + profil['schichtung'] * baender
        )

    # Risse in zwei Groessen, per MINIMUM verrechnet, damit jede erhalten
    # bleibt — ein Mittelwert fuellte sie gegenseitig auf.
    z1, z2 = profil['risse']
    riss = np.minimum(
        furchen(G, G, z1, z1, 3, 0.32, rnd),
        furchen(G, G, z2, z2, 2, 0.40, rnd),
    )
    muster = np.clip(muster * (0.30 + 0.70 * riss), 0, 1)

    rgb = einfaerben(muster, profil['tief'], profil['hell'])

    # Moos in FLAECHEN, nicht in Linien. Wuerde man die Feuchte direkt aus
    # dem Rissfeld ableiten, waechst es als duenne Faeden auf den Rissen —
    # derselbe Fehler steht in grabhuegel-texturen.py dokumentiert.
    anteil = profil['moos']
    if anteil > 0:
        feuchte = normiert(0.78 * oktaven(G, G, 7, 7, 3, rnd) + 0.22 * (1.0 - riss))
        schwelle = float(np.quantile(feuchte, 1.0 - anteil))
        # Weicher Uebergang: eine harte Maske zeichnet sichtbare Umrisse.
        deckung = np.clip((feuchte - schwelle) / 0.10, 0, 1)[..., None]
        moos = np.array(profil['moosfarbe'], dtype=float)[None, None, :] * (
            0.75 + 0.5 * muster[..., None]
        )
        rgb = rgb * (1 - deckung) + moos * deckung

    bild = np.zeros((G, G, 4), dtype=np.uint8)
    bild[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    bild[..., 3] = 255      # Fels ist deckend, kein Cutout
    return Image.fromarray(bild, 'RGBA')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--ziel', default='assets/textures')
    p.add_argument('--art', default='alle', choices=['alle'] + list(ARTEN))
    p.add_argument('--seed', type=int, default=17)
    args = p.parse_args()

    wurzel = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ziel = os.path.join(wurzel, args.ziel)
    os.makedirs(ziel, exist_ok=True)

    for i, name in enumerate(list(ARTEN) if args.art == 'alle' else [args.art]):
        bild = gestein(ARTEN[name], args.seed + i * 23)
        pfad = os.path.join(ziel, f'{name}_fels.png')
        bild.save(pfad)
        print(f'FERTIG {pfad} — {G}x{G}')


if __name__ == '__main__':
    main()
