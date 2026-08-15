#!/usr/bin/env python3
"""
Zeichnet die acht Clutter-Texturen, die `tools/gen-grass-texture.py` nicht
abdeckt — Farn, Strauch, Waldboden, Heideblume, Schilf und Seerose.

    python3 tools/clutter-texturen.py
    python3 tools/clutter-texturen.py --nur waterlilies,vass_texture01
    python3 tools/clutter-texturen.py --ziel assets/textures

── Warum diese acht ─────────────────────────────────────────────────
`ENTRIES` in `client/src/engine/GrassClutter.ts` nennt elf Texturen.
Drei davon (`grass_meadows_gen`, `grass_heath_gen`,
`grass_toon1_yellow_gen`) zeichnet `gen-grass-texture.py`. Die
restlichen acht stammten aus dem AssetRipper-Export und hatten kein
Rezept — auf einem frischen Checkout fehlten sie also, obwohl `assets/`
gitignored ist und damit nichts anderes uebrig bleibt als sie zu
rechnen. Zusammen decken sie den gesamten Bodenbewuchs ausserhalb der
Wiese ab: Waldboden (130 Halme je Patch im Schwarzwald), Heideblumen
(100 in der Ebene), Farn, Schilf und Seerosen.

── Die Konvention, an der alles haengt ──────────────────────────────
Jede Clutter-Textur ist ein VOLLBILD-Billboard:

    v = 1 (unterer Bildrand)  ist der BODEN,
    v = 0 (oberer Bildrand)   ist die SPITZE.

Das ist dieselbe Regel, nach der `gen-grass-texture.py` zeichnet und
nach der `tools/clutter-meshes.py` seine Karten belegt. Sie ist kein
Geschmack, sondern Bedingung fuer den HD-Umschalter: `HD_CLUTTER` in
GrassClutter.ts tauscht die Textur aus, ohne die UVs anzufassen. Die
HD-Vorlagen sind Vollbild-Billboards mit Pflanzen von unten nach oben;
haette eine Textur hier stattdessen ein Sprite-Atlas-Layout, wuerde das
Umschalten sie zerreissen.

── Der Hintergrund ist nicht transparent-schwarz ────────────────────
Er traegt die mittlere Pflanzenfarbe bei Alpha 0. Mipmaps mitteln ueber
RGB *und* Alpha; laege hinter den Blaettern ein schwarzes Nichts, wuerde
der Bewuchs mit der Entfernung nachdunkeln. Derselbe Fallstrick steht in
`gen-grass-texture.py`, `busch-texturen.py` und `eiche-texturen.py`.

── Der Waldboden muss waagerecht kacheln ────────────────────────────
`forestCover` und `forestCoverBrown` setzen in ENTRIES `texRepeatU: 2`,
GrassClutter gibt das als `uScale = 2` auf eine Textur im
WRAP-Adressmodus. `forest_groundcover(_brown)` wird also ueber seinen
eigenen rechten Rand hinaus abgetastet und muss dort nahtlos weitergehen.
`_wiederholt()` zeichnet deshalb jedes Element zusaetzlich um ±Breite
versetzt — was rechts herauslaeuft, kommt links wieder herein. Bei den
uebrigen sechs Texturen ist das nicht noetig (uScale bleibt 1), aber
auch nicht schaedlich.

── Farbwerte ────────────────────────────────────────────────────────
Die mittleren RGB-Werte sind an den Vorgaengerdateien gemessen und hier
absichtlich getroffen. Die zugehoerigen ENTRIES tragen `color: [1,1,1]`
und `terrainTint: false` — was hier gezeichnet wird, erscheint also
ungetoent im Bild, und ein Farbstich waere nirgends mehr zu korrigieren.
Einzige Ausnahme: `waterlilies` laeuft mit `color: 0.618`, die Vorlage
ist deshalb entsprechend heller angelegt.
"""
import argparse
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib.karten import mischen  # noqa: E402

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# UV-Spalten des Buendel-Meshes — muss zu SPALTEN in clutter-meshes.py und
# COLUMNS in gen-grass-texture.py passen (siehe dort).
SPALTEN = [(0.01, 0.37), (0.37, 0.66), (0.66, 0.975)]


# ── Grundgeruest ─────────────────────────────────────────────────────

def _leinwand(b, h, grund):
    """Leeres Bild in der Grundfarbe bei Alpha 0 (siehe Dateikopf)."""
    return Image.new("RGBA", (b, h), tuple(grund) + (0,))


def _wiederholt(stift, breite, zeichnen):
    """Ruft `zeichnen` dreimal auf: um -Breite, 0 und +Breite versetzt.

    Damit laeuft jedes Element, das ueber den Bildrand ragt, auf der
    anderen Seite wieder herein — die Textur kachelt waagerecht.
    """
    for versatz in (-breite, 0, breite):
        zeichnen(stift, versatz)


def _abschliessen(bild, grund, weich=0.6):
    """Kante weichzeichnen, RGB der unsichtbaren Flaechen zurueckzwingen.

    Wie `lib.karten.abschliessen`, aber fuer nicht-quadratische Bilder.
    Der Weichzeichner nimmt der Cutout-Kante das Flimmern; danach wird
    ausserhalb der Pflanze wieder die Grundfarbe gesetzt, sonst haette
    der Filter Hintergrund in die Blattraender getragen und genau den
    Mipmap-Fehler zurueckgebracht, den die Grundfarbe verhindern soll.
    """
    weichgezeichnet = bild.filter(ImageFilter.GaussianBlur(weich))
    r, g, b, a = weichgezeichnet.split()
    sichtbar = Image.merge("RGB", (r, g, b))
    grund_bild = Image.new("RGB", bild.size, tuple(grund))
    maske = a.point(lambda v: 255 if v > 8 else 0)
    fertig = Image.composite(sichtbar, grund_bild, maske)
    fertig.putalpha(a)
    return fertig


def _halm(stift, x0, y0, x1, y1, breite, farbe_fuss, farbe_spitze, biegung=0.0,
          stufen=9):
    """Ein sich verjuengender, leicht gebogener Halm als Polygonkette."""
    mx = (x0 + x1) / 2 + biegung
    my = (y0 + y1) / 2
    links, rechts = [], []
    for s in range(stufen + 1):
        t = s / stufen
        cx = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * mx + t ** 2 * x1
        cy = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * my + t ** 2 * y1
        w = max(0.35, breite * (1 - t) ** 0.85)
        links.append((cx - w / 2, cy))
        rechts.append((cx + w / 2, cy))
        if s > 0:
            stift.polygon([links[s - 1], links[s], rechts[s], rechts[s - 1]],
                          fill=tuple(mischen(farbe_fuss, farbe_spitze, t)) + (255,))


def _blatt(stift, x, y, laenge, breite, winkel, farbe, spitzig=0.62):
    """Ein einzelnes lanzettliches Blatt, am Ansatz (x, y) sitzend."""
    punkte = []
    rand = []
    for s in range(9):
        t = s / 8
        # Halbrand: erst breiter werden, dann spitz zulaufen.
        w = breite * math.sin(math.pi * t ** spitzig) * 0.5
        rand.append((w, laenge * t))
    punkte = rand + [(-w, l) for w, l in reversed(rand)]
    c, s_ = math.cos(winkel), math.sin(winkel)
    stift.polygon(
        [(x + px * c - py * s_, y - (px * s_ + py * c)) for px, py in punkte],
        fill=tuple(farbe) + (255,),
    )


# ── Die einzelnen Texturen ───────────────────────────────────────────

def waldboden(b, h, rnd, fuss, spitze, grund, halme=26):
    """Niedriger, dichter Bodenbewuchs — kachelt waagerecht."""
    bild = _leinwand(b, h, grund)
    stift = ImageDraw.Draw(bild)
    for _ in range(halme):
        bx = rnd.uniform(0, b)
        hoehe = rnd.uniform(0.42, 0.92) * h
        neigung = rnd.uniform(-0.42, 0.42) * b * 0.25
        schatten = rnd.uniform(0.78, 1.18)
        f = tuple(min(255, int(c * schatten)) for c in fuss)
        sp = tuple(min(255, int(c * schatten)) for c in spitze)

        def mal(st, versatz, bx=bx, hoehe=hoehe, neigung=neigung, f=f, sp=sp):
            _halm(st, bx + versatz, h - 1, bx + versatz + neigung, h - hoehe,
                  rnd.uniform(1.8, 3.4), f, sp, biegung=neigung * 0.4)

        _wiederholt(stift, b, mal)
    return _abschliessen(bild, grund)


def farnwedel(b, h, rnd, stiel, blatt_fuss, blatt_spitze, grund):
    """Ein Farnwedel: Mittelrippe mit gefiederten Blaettchen.

    Fuellt das ganze Bild, weil `clutter_fern` in clutter-meshes.py die
    volle Breite abgreift (u 0.02…0.98) und die Karten abwechselnd
    gespiegelt belegt.
    """
    bild = _leinwand(b, h, grund)
    stift = ImageDraw.Draw(bild)
    fuss_x, kopf_x = b * 0.5, b * (0.42 + 0.16 * rnd.random())
    bahn = []
    for i in range(24):
        t = i / 23
        # Leichter Bogen; ein gerader Strich liest sich als Draht.
        x = (1 - t) * fuss_x + t * kopf_x + math.sin(t * math.pi) * b * 0.05
        y = (h - 1) - t * h * 0.94
        bahn.append((x, y))

    # Blaettchen paarweise links und rechts, zur Spitze hin kuerzer.
    for i, (x, y) in enumerate(bahn):
        t = i / (len(bahn) - 1)
        if t < 0.06:
            continue
        if i % 2:
            continue
        laenge = b * 0.34 * math.sin(math.pi * min(1.0, t * 1.05)) ** 0.7
        if laenge < 1.5:
            continue
        breite = laenge * rnd.uniform(0.13, 0.19)
        farbe = mischen(blatt_fuss, blatt_spitze, t * rnd.uniform(0.75, 1.15))
        for seite in (-1, 1):
            # Fiedern zeigen schraeg nach oben-aussen.
            winkel = seite * (math.pi * 0.5 - 0.62 - 0.30 * t)
            _blatt(stift, x, y, laenge * rnd.uniform(0.86, 1.0), breite,
                   winkel, farbe)

    for i in range(len(bahn) - 1):
        t = i / (len(bahn) - 1)
        w = max(0.8, b * 0.028 * (1 - t) ** 0.6)
        (x0, y0), (x1, y1) = bahn[i], bahn[i + 1]
        stift.line([(x0, y0), (x1, y1)], fill=tuple(stiel) + (255,),
                   width=max(1, int(round(w))))
    return _abschliessen(bild, grund)


def strauchkarte(b, h, rnd, holz, blatt_fuss, blatt_spitze, grund, blaetter=70):
    """Kleiner Strauch: ein paar Triebe, darauf ein Blattpolster."""
    bild = _leinwand(b, h, grund)
    stift = ImageDraw.Draw(bild)
    triebe = []
    for _ in range(4):
        x1 = b * rnd.uniform(0.22, 0.78)
        y1 = h * rnd.uniform(0.16, 0.42)
        stift.line([(b * 0.5, h - 1), (x1, y1)], fill=tuple(holz) + (255,),
                   width=max(1, int(b * 0.018)))
        triebe.append((x1, y1))

    for _ in range(blaetter):
        # Blaetter buendeln sich um die Triebenden — das gibt die
        # gedrungene Strauchsilhouette statt einer gleichmaessigen Wolke.
        tx, ty = rnd.choice(triebe)
        x = tx + rnd.gauss(0, b * 0.17)
        y = ty + rnd.gauss(0, h * 0.14) + h * 0.09
        if not (0 < x < b and 0 < y < h):
            continue
        t = 1.0 - y / h
        farbe = mischen(blatt_fuss, blatt_spitze, min(1.0, max(0.0, t)) * rnd.uniform(0.6, 1.2))
        _blatt(stift, x, y, b * rnd.uniform(0.11, 0.20), b * rnd.uniform(0.06, 0.11),
               rnd.uniform(-math.pi, math.pi), farbe)
    return _abschliessen(bild, grund)


def heideblumen(b, h, rnd, stiel_f, blatt_f, bluete_f, bluete_hell, grund,
                stiele=9):
    """Heidekraut-Billboard: Stengel mit roten Bluetenkoepfen."""
    bild = _leinwand(b, h, grund)
    stift = ImageDraw.Draw(bild)
    koepfe = []
    for _ in range(stiele):
        bx = rnd.uniform(b * 0.08, b * 0.92)
        hoehe = rnd.uniform(0.52, 0.94) * h
        kx = bx + rnd.uniform(-0.10, 0.10) * b
        ky = h - hoehe
        _halm(stift, bx, h - 1, kx, ky, rnd.uniform(2.0, 3.4), stiel_f,
              mischen(stiel_f, blatt_f, 0.6), biegung=(kx - bx) * 0.4)
        for _ in range(2):
            _blatt(stift, (bx + kx) / 2 + rnd.uniform(-3, 3),
                   h - hoehe * rnd.uniform(0.25, 0.75),
                   b * rnd.uniform(0.08, 0.14), b * rnd.uniform(0.03, 0.05),
                   rnd.choice([-1, 1]) * rnd.uniform(0.8, 1.5), blatt_f)
        koepfe.append((kx, ky))

    for (kx, ky) in koepfe:
        # Bluetenkopf als Doldentraube: mehrere kleine Kugeln.
        for _ in range(rnd.randint(11, 16)):
            r = b * rnd.uniform(0.026, 0.052)
            px = kx + rnd.gauss(0, b * 0.045)
            py = ky + rnd.gauss(0, b * 0.055)
            f = mischen(bluete_f, bluete_hell, rnd.random())
            stift.ellipse([px - r, py - r, px + r, py + r], fill=tuple(f) + (255,))
    return _abschliessen(bild, grund)


def schilf(b, h, rnd, halm_f, spitze_f, kolben_f, grund):
    """Schilf in den drei UV-Spalten von SPALTEN — hohe, schmale Halme."""
    bild = _leinwand(b, h, grund)
    stift = ImageDraw.Draw(bild)
    for (u0, u1) in SPALTEN:
        x0, x1 = u0 * b, u1 * b
        kolben = []
        for _ in range(13):
            bx = rnd.uniform(x0 + 2, x1 - 2)
            hoehe = rnd.uniform(0.62, 0.98) * h
            kx = bx + rnd.uniform(-0.22, 0.22) * (x1 - x0)
            ky = h - hoehe
            schatten = rnd.uniform(0.82, 1.15)
            f = tuple(min(255, int(c * schatten)) for c in halm_f)
            sp = tuple(min(255, int(c * schatten)) for c in spitze_f)
            _halm(stift, bx, h - 1, kx, ky, rnd.uniform(2.4, 4.6), f, sp,
                  biegung=(kx - bx) * 0.45)
            if rnd.random() < 0.55:
                kolben.append((kx, ky, hoehe))
        # Rohrkolben: der braune Zylinder am oberen Ende. Er traegt den
        # Grossteil des gemessenen Braunanteils der Vorlage.
        for (kx, ky, hoehe) in kolben:
            laenge = hoehe * rnd.uniform(0.13, 0.20)
            dicke = b * rnd.uniform(0.020, 0.032)
            stift.rounded_rectangle(
                [kx - dicke, ky, kx + dicke, ky + laenge],
                radius=dicke, fill=tuple(kolben_f) + (255,))
    return _abschliessen(bild, grund)


def seerosenblatt(b, h, rnd, blatt_f, blatt_dunkel, grund):
    """Ein rundes Seerosenblatt mit dem typischen Keil-Einschnitt."""
    bild = _leinwand(b, h, grund)
    stift = ImageDraw.Draw(bild)
    cx, cy, r = b * 0.5, h * 0.5, min(b, h) * 0.47

    # Umriss als Polygon, damit der Keil sauber ausgespart bleibt: der
    # Sektor zwischen den beiden Keilkanten wird schlicht ausgelassen.
    keil = math.radians(30)
    punkte = []
    schritte = 96
    for i in range(schritte + 1):
        a = keil / 2 + (math.tau - keil) * i / schritte
        # Leichte Unrundheit — ein exakter Kreis liest sich als Scheibe.
        rr = r * (1.0 + 0.035 * math.sin(a * 5 + 0.7))
        punkte.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    punkte.append((cx, cy))
    stift.polygon(punkte, fill=tuple(blatt_f) + (255,))

    # Radiale Adern vom Einschnittpunkt aus.
    for i in range(13):
        a = keil / 2 + (math.tau - keil) * (i + 0.5) / 13
        # Erst ab einem Drittel des Radius: Alle Adern bis in den
        # Mittelpunkt zu ziehen ergab eine Tortengrafik statt eines Blattes.
        stift.line([(cx + math.cos(a) * r * 0.30, cy + math.sin(a) * r * 0.30),
                    (cx + math.cos(a) * r * 0.93, cy + math.sin(a) * r * 0.93)],
                   fill=tuple(blatt_dunkel) + (200,), width=1)
    return _abschliessen(bild, grund, weich=0.8)


# ── Rezepte ──────────────────────────────────────────────────────────
#
# `mittel` ist der an der Vorgaengerdatei gemessene Durchschnitt der
# sichtbaren Pixel — die Zahl, die das Biom-Erscheinungsbild traegt.

def _rezepte():
    return {
        "forest_groundcover": dict(
            groesse=(128, 128), seed=101, mittel=(70, 82, 44),
            bau=lambda b, h, r: waldboden(b, h, r, (44, 56, 26), (96, 112, 58),
                                          (70, 82, 44)),
        ),
        "forest_groundcover_brown": dict(
            groesse=(128, 128), seed=103, mittel=(92, 81, 50),
            bau=lambda b, h, r: waldboden(b, h, r, (62, 50, 28), (124, 110, 70),
                                          (92, 81, 50)),
        ),
        "autumn_ormbunke_green": dict(
            groesse=(128, 128), seed=107, mittel=(88, 120, 62),
            bau=lambda b, h, r: farnwedel(b, h, r, (74, 92, 44), (60, 96, 40),
                                          (122, 150, 78), (88, 120, 62)),
        ),
        "autumn_ormbunke_swamp": dict(
            groesse=(128, 128), seed=109, mittel=(120, 117, 61),
            bau=lambda b, h, r: farnwedel(b, h, r, (104, 96, 46), (96, 96, 44),
                                          (156, 148, 82), (120, 117, 61)),
        ),
        # 1:2, weil das Kreuz-Billboard mit prefabScale [0.3, 1.0, 0.3]
        # rund 0.6 m breit und 1.0 m hoch im Bild steht.
        "clutter_shrub": dict(
            groesse=(64, 128), seed=113, mittel=(81, 109, 51),
            bau=lambda b, h, r: strauchkarte(b, h, r, (62, 50, 34), (58, 84, 34),
                                             (116, 146, 68), (81, 109, 51)),
        ),
        "grass_heath_redflower": dict(
            groesse=(128, 128), seed=127, mittel=(166, 96, 75),
            bau=lambda b, h, r: heideblumen(b, h, r, (108, 104, 56), (96, 112, 52),
                                            (168, 62, 54), (214, 126, 118),
                                            (166, 96, 75)),
        ),
        "vass_texture01": dict(
            groesse=(128, 128), seed=131, mittel=(105, 64, 23),
            bau=lambda b, h, r: schilf(b, h, r, (96, 84, 34), (140, 128, 60),
                                       (104, 58, 20), (105, 64, 23)),
        ),
        # Heller angelegt: der Eintrag `lilies` rechnet mit color 0.618.
        "waterlilies": dict(
            groesse=(128, 128), seed=137, mittel=(142, 177, 88),
            bau=lambda b, h, r: seerosenblatt(b, h, r, (146, 182, 90),
                                              (104, 138, 62), (142, 177, 88)),
        ),
    }


def main():
    p = argparse.ArgumentParser(description="Zeichnet die Clutter-Texturen.")
    p.add_argument("--ziel", default="assets/textures")
    p.add_argument("--nur", default=None, help="Kommaliste einzelner Namen.")
    a = p.parse_args()

    ziel = a.ziel if os.path.isabs(a.ziel) else os.path.join(WURZEL, a.ziel)
    os.makedirs(ziel, exist_ok=True)

    rezepte = _rezepte()
    namen = [n.strip() for n in a.nur.split(",")] if a.nur else list(rezepte)
    for name in namen:
        if name not in rezepte:
            raise SystemExit(f"unbekannt: {name} (bekannt: {', '.join(rezepte)})")
        rez = rezepte[name]
        b, h = rez["groesse"]
        # Feste Saat je Textur — Projektregel: Werkzeuge sind reproduzierbar.
        bild = rez["bau"](b, h, random.Random(rez["seed"]))
        pfad = os.path.join(ziel, name + ".png")
        bild.save(pfad)

        # Gegenprobe: Deckung und mittlere Farbe der sichtbaren Pixel.
        px = bild.load()
        summe, zahl = [0, 0, 0], 0
        for y in range(h):
            for x in range(b):
                r_, g_, b_, al = px[x, y]
                if al > 128:
                    summe[0] += r_; summe[1] += g_; summe[2] += b_; zahl += 1
        m = [s // max(zahl, 1) for s in summe]
        soll = rez["mittel"]
        print(f"{name + '.png':28} {b}x{h}  Deckung {100 * zahl / (b * h):5.1f}%  "
              f"Mittel ({m[0]:3},{m[1]:3},{m[2]:3})  Ziel ({soll[0]:3},{soll[1]:3},{soll[2]:3})")


if __name__ == "__main__":
    main()
