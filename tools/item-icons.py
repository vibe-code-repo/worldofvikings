#!/usr/bin/env python3
"""
Die 25 Item-Icons fuer Hotbar, Inventar und Bautafel — eigene, gezeichnete.

    python3 tools/item-icons.py [--nur hammer,hoe,…] [--blatt]

── Warum ────────────────────────────────────────────────────────────
`Hotbar.ts` und `PieceSelection.ts` laden `/assets/sprites/<icon>.png`;
die Namen stehen in `shared/src/items/itemDefs.ts` als `icon:`. Fehlen
sie, zeigt die Hotbar den abgeschnittenen Item-Namen ("Ha", "Fe", "Ge").

── Vorgaben ─────────────────────────────────────────────────────────
64x64 RGBA mit Transparenz, so wie die bisherigen. Gezeichnet wird
vierfach ueberabgetastet und am Ende verkleinert — direkt auf 64 Pixel
gemalt werden Schraegen und Rundungen treppig.

── Stil ─────────────────────────────────────────────────────────────
Flaechige Formen mit dunklem Rand, Licht von oben links: eine hellere
Kante oben/links, ein dunklerer Bereich unten/rechts. Das ist bewusst
schlicht — ein Icon ist 64 Pixel gross und liegt hinter einem Rahmen;
Details unter drei Pixeln verschwinden ohnehin. Wichtiger ist, dass die
UMRISSE der Gegenstaende sich auf einen Blick unterscheiden: Beil,
Hammer, Hacke und Spitzhacke haben deshalb bewusst verschiedene
Kopfformen und Stielwinkel.

Die Palette haelt sich an das Material, nicht an die Vorlage: Holz
braun, Stein grau, Feuerstein blaugrau, Bronze warm, Beeren nach Art.
"""
import argparse
import os

from PIL import Image, ImageDraw

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIEL = os.path.join(WURZEL, "assets/sprites")
KANTE = 64
UEBER = 4                      # Ueberabtastung
N = KANTE * UEBER

# ── Palette ──────────────────────────────────────────────────────────
RAND = (26, 20, 14, 255)
HOLZ = (122, 84, 48, 255)
HOLZ_HELL = (156, 112, 68, 255)
HOLZ_DUNKEL = (86, 58, 32, 255)
STEIN = (128, 126, 120, 255)
STEIN_HELL = (166, 164, 156, 255)
STEIN_DUNKEL = (92, 90, 86, 255)
FEUERSTEIN = (96, 104, 112, 255)
FEUERSTEIN_HELL = (140, 150, 160, 255)
BRONZE = (176, 118, 58, 255)
BRONZE_HELL = (214, 158, 86, 255)
GEWEIH = (198, 178, 142, 255)
GEWEIH_HELL = (224, 208, 178, 255)
FLEISCH = (168, 62, 58, 255)
FLEISCH_HELL = (206, 96, 88, 255)
GEBRATEN = (132, 78, 40, 255)
GRUEN = (86, 132, 52, 255)
GRUEN_HELL = (124, 170, 78, 255)
GOLD = (204, 164, 62, 255)
GOLD_HELL = (238, 206, 110, 255)
BERNSTEIN = (206, 138, 44, 220)
HARZ = (222, 192, 96, 230)


def leinwand():
    b = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    return b, ImageDraw.Draw(b)


def s(v):
    """64er-Koordinate -> Ueberabtastung."""
    return v * UEBER


def poly(d, punkte, farbe, rand=RAND, breite=3):
    d.polygon([(s(x), s(y)) for x, y in punkte], fill=farbe,
              outline=rand, width=breite * UEBER // 2)


def kreis(d, cx, cy, r, farbe, rand=RAND, breite=3):
    d.ellipse([s(cx - r), s(cy - r), s(cx + r), s(cy + r)], fill=farbe,
              outline=rand, width=breite * UEBER // 2)


def balken(d, x0, y0, x1, y1, dicke, farbe, rand=RAND):
    """Stiel/Schaft: dicke Linie mit Rand."""
    d.line([(s(x0), s(y0)), (s(x1), s(y1))], fill=rand,
           width=int((dicke + 2.5) * UEBER), joint="curve")
    d.line([(s(x0), s(y0)), (s(x1), s(y1))], fill=farbe,
           width=int(dicke * UEBER), joint="curve")


def glanz(d, punkte, farbe):
    """Lichtkante ohne eigenen Rand — liegt auf der Form."""
    d.polygon([(s(x), s(y)) for x, y in punkte], fill=farbe)


# ── Werkzeuge (Stiel + Kopf) ─────────────────────────────────────────

def i_hammer(d):
    balken(d, 22, 54, 40, 18, 5, HOLZ)
    poly(d, [(30, 20), (52, 12), (56, 22), (34, 30)], STEIN)
    glanz(d, [(32, 21), (51, 14), (52, 17), (33, 24)], STEIN_HELL)


def i_axe_flint(d):
    balken(d, 22, 54, 38, 16, 4.5, HOLZ)
    poly(d, [(34, 14), (52, 20), (46, 36), (32, 28)], FEUERSTEIN)
    glanz(d, [(35, 17), (49, 22), (46, 28), (34, 23)], FEUERSTEIN_HELL)


def i_hoe(d):
    balken(d, 20, 54, 42, 16, 4, HOLZ)
    poly(d, [(34, 14), (54, 14), (54, 24), (44, 24), (38, 20), (34, 20)], STEIN)
    glanz(d, [(36, 16), (52, 16), (52, 19), (36, 19)], STEIN_HELL)


def i_cultivator_bronze(d):
    """Kultivator: breiter Querbalken mit drei langen Zinken nach unten —
    die Zinken muessen lang genug sein, um bei 64 px als Zinken zu lesen."""
    balken(d, 18, 56, 34, 24, 4, HOLZ)
    poly(d, [(16, 20), (54, 20), (54, 29), (16, 29)], BRONZE)
    glanz(d, [(18, 22), (52, 22), (52, 25), (18, 25)], BRONZE_HELL)
    for zx in (20, 32, 44):
        poly(d, [(zx, 29), (zx + 7, 29), (zx + 4, 46)], BRONZE)


def i_pickaxe_antler(d):
    """Spitzhacke: kraeftiger Doppelkopf mit deutlicher Kruemmung — der
    duenne Winkel von vorher las sich als Bumerang."""
    balken(d, 24, 56, 34, 22, 5, HOLZ)
    poly(d, [(8, 34), (20, 18), (34, 14), (48, 18), (60, 34),
             (52, 36), (42, 24), (34, 21), (26, 24), (16, 36)], GEWEIH)
    glanz(d, [(14, 32), (22, 21), (34, 17), (46, 21), (54, 32),
              (50, 33), (42, 22), (34, 20), (26, 22), (18, 33)], GEWEIH_HELL)


def i_club(d):
    """Keule: duenner Griff, dicker Kopf — der Groessenunterschied ist das
    Erkennungsmerkmal gegen Hammer und Beil."""
    balken(d, 20, 56, 32, 38, 5, HOLZ_DUNKEL)
    poly(d, [(26, 42), (36, 14), (52, 12), (56, 26), (44, 44)], HOLZ)
    glanz(d, [(31, 39), (38, 18), (48, 17), (49, 26), (40, 39)], HOLZ_HELL)
    for (x, y) in ((38, 20), (46, 18), (44, 30), (36, 32)):
        kreis(d, x, y, 3, HOLZ_DUNKEL, rand=None, breite=0)


# ── Rohstoffe ────────────────────────────────────────────────────────

def i_wood(d):
    for (x, y) in ((14, 34), (30, 26), (26, 44)):
        poly(d, [(x, y), (x + 26, y - 6), (x + 26, y + 8), (x, y + 14)], HOLZ)
        d.ellipse([s(x - 5), s(y), s(x + 5), s(y + 14)], fill=HOLZ_HELL,
                  outline=RAND, width=2 * UEBER)
        d.ellipse([s(x - 2), s(y + 4), s(x + 2), s(y + 10)], fill=HOLZ_DUNKEL)


def i_stone(d):
    poly(d, [(10, 44), (20, 28), (36, 26), (44, 42), (30, 52), (16, 50)], STEIN)
    glanz(d, [(16, 42), (22, 31), (34, 30), (38, 40), (28, 46)], STEIN_HELL)
    poly(d, [(38, 30), (50, 24), (56, 34), (46, 42)], STEIN_DUNKEL)


def i_flint(d):
    poly(d, [(14, 42), (26, 20), (44, 26), (48, 44), (30, 52)], FEUERSTEIN)
    glanz(d, [(20, 40), (27, 25), (40, 29), (34, 42)], FEUERSTEIN_HELL)
    d.line([(s(27), s(25)), (s(34), s(42))], fill=(60, 68, 78, 255), width=2 * UEBER)


def i_resin(d):
    kreis(d, 32, 36, 15, HARZ)
    glanz(d, [(24, 30), (32, 25), (38, 30), (30, 35)], (250, 232, 160, 220))


def i_amber(d):
    poly(d, [(32, 12), (48, 28), (40, 52), (24, 52), (16, 28)], BERNSTEIN)
    glanz(d, [(30, 18), (40, 28), (34, 40), (26, 30)], (240, 190, 96, 220))


def i_coins(d):
    for (x, y) in ((22, 44), (34, 40), (28, 30)):
        kreis(d, x, y, 11, GOLD)
        glanz(d, [(x - 6, y - 3), (x - 2, y - 7), (x + 4, y - 4), (x - 1, y - 1)], GOLD_HELL)


# ── Pflanzen und Beeren ──────────────────────────────────────────────

def _beeren(d, farbe, hell, punkte):
    for (x, y, r) in punkte:
        kreis(d, x, y, r, farbe)
        glanz(d, [(x - r * 0.5, y - r * 0.3), (x - r * 0.1, y - r * 0.7),
                  (x + r * 0.3, y - r * 0.3), (x - r * 0.2, y)], hell)


def i_blueberries(d):
    _beeren(d, (66, 84, 148, 255), (110, 132, 200, 255),
            [(24, 40, 10), (40, 38, 9), (32, 50, 9)])
    poly(d, [(30, 24), (36, 20), (38, 28), (32, 30)], GRUEN)


def i_raspberry(d):
    _beeren(d, (176, 48, 68, 255), (222, 96, 112, 255),
            [(26, 42, 8), (38, 40, 8), (32, 32, 8), (32, 50, 8)])
    poly(d, [(28, 24), (36, 22), (34, 30), (28, 30)], GRUEN)


def i_carrot(d):
    poly(d, [(28, 22), (38, 24), (34, 54), (30, 54)], (206, 118, 42, 255))
    glanz(d, [(30, 26), (34, 27), (32, 48)], (232, 152, 74, 255))
    for dx in (-6, 0, 6):
        poly(d, [(32 + dx, 22), (34 + dx, 10), (37 + dx, 22)], GRUEN)


def i_dandelion(d):
    balken(d, 32, 54, 32, 30, 3, GRUEN)
    kreis(d, 32, 24, 11, GOLD)
    for a in range(8):
        import math
        w = a * math.pi / 4
        poly(d, [(32, 24), (32 + 15 * math.cos(w), 24 + 15 * math.sin(w)),
                 (32 + 12 * math.cos(w + 0.4), 24 + 12 * math.sin(w + 0.4))], GOLD_HELL)


def i_mushroom(d):
    poly(d, [(26, 36), (38, 36), (36, 54), (28, 54)], (226, 214, 190, 255))
    d.pieslice([s(14), s(16), s(50), s(46)], 180, 360,
               fill=(176, 54, 46, 255), outline=RAND, width=2 * UEBER)
    for (x, y, r) in ((24, 28, 4), (36, 26, 3), (30, 22, 3)):
        kreis(d, x, y, r, (238, 232, 222, 255), rand=None, breite=0)


def i_thistle(d):
    balken(d, 32, 56, 32, 34, 3, (72, 108, 60, 255))
    kreis(d, 32, 28, 12, (118, 86, 158, 255))
    for a in range(10):
        import math
        w = a * math.pi / 5
        d.line([(s(32), s(28)), (s(32 + 17 * math.cos(w)), s(28 + 17 * math.sin(w)))],
               fill=(150, 118, 196, 255), width=2 * UEBER)


# ── Fleisch und Innereien ────────────────────────────────────────────

def i_raw_meat(d):
    """Fleisch am Knochen: der herausstehende Knochen macht aus einer roten
    Flaeche erst ein Stueck Fleisch."""
    balken(d, 40, 48, 54, 56, 5, (236, 230, 214, 255))
    kreis(d, 54, 56, 5, (236, 230, 214, 255))
    poly(d, [(12, 32), (26, 18), (42, 24), (46, 42), (30, 50), (16, 44)], FLEISCH)
    glanz(d, [(18, 32), (27, 23), (38, 28), (40, 40), (28, 44), (20, 40)], FLEISCH_HELL)
    for (x, y) in ((24, 30), (32, 36)):
        d.line([(s(x), s(y)), (s(x + 7), s(y + 3))], fill=(214, 128, 120, 255),
               width=2 * UEBER)


def i_necktail(d):
    poly(d, [(14, 44), (24, 26), (40, 22), (52, 32), (44, 46), (26, 50)], FLEISCH)
    glanz(d, [(20, 42), (27, 30), (38, 27), (44, 34), (38, 42)], FLEISCH_HELL)


def i_necktailgrilled(d):
    poly(d, [(14, 44), (24, 26), (40, 22), (52, 32), (44, 46), (26, 50)], GEBRATEN)
    glanz(d, [(20, 42), (27, 30), (38, 27), (44, 34), (38, 42)], (172, 110, 58, 255))
    for y in (30, 38):
        d.line([(s(20), s(y)), (s(46), s(y - 3))], fill=(70, 40, 20, 255), width=2 * UEBER)


def i_entrails(d):
    """Innereien: eine geschlungene Wurst statt konzentrischer Boegen —
    die Boegen lasen sich als abstraktes Zeichen, nicht als Gedaerm."""
    import math
    bahn = []
    for t in range(0, 361, 6):
        w = math.radians(t)
        r = 15 + 5 * math.sin(3 * w)
        bahn.append((s(32 + r * math.cos(w)), s(32 + r * 0.8 * math.sin(w))))
    d.line(bahn, fill=RAND, width=11 * UEBER, joint="curve")
    d.line(bahn, fill=(190, 96, 108, 255), width=8 * UEBER, joint="curve")
    d.line([(x, y - 2 * UEBER) for x, y in bahn[::2]],
           fill=(224, 140, 148, 255), width=2 * UEBER, joint="curve")


# ── Trophaeen ────────────────────────────────────────────────────────

def _geweih(d, x, hoch):
    poly(d, [(x, 42), (x - 2, 24), (x + 3, 24), (x + 2, 42)], GEWEIH)
    for (dx, dy) in ((-8, -8), (-11, 2), (8, -8), (11, 2)):
        if (dx < 0) == (x < 32) or hoch:
            d.line([(s(x), s(28)), (s(x + dx), s(24 + dy))], fill=GEWEIH, width=4 * UEBER)


def i_TrophyDeer(d):
    poly(d, [(24, 36), (40, 36), (38, 54), (26, 54)], (140, 96, 58, 255))
    glanz(d, [(27, 38), (36, 38), (35, 50), (28, 50)], (176, 128, 80, 255))
    _geweih(d, 26, False)
    _geweih(d, 38, False)


def i_TrophyEikthyr(d):
    poly(d, [(22, 34), (42, 34), (39, 56), (25, 56)], (108, 76, 48, 255))
    glanz(d, [(26, 36), (38, 36), (36, 52), (28, 52)], (146, 108, 68, 255))
    _geweih(d, 24, True)
    _geweih(d, 40, True)
    kreis(d, 32, 20, 5, (120, 200, 220, 220), rand=None, breite=0)


def i_HardAntler(d):
    poly(d, [(20, 50), (26, 22), (32, 22), (28, 50)], GEWEIH)
    glanz(d, [(23, 46), (27, 26), (30, 26), (26, 46)], GEWEIH_HELL)
    for (x0, y0, x1, y1) in ((27, 30, 42, 22), (27, 38, 44, 34), (28, 24, 38, 12)):
        d.line([(s(x0), s(y0)), (s(x1), s(y1))], fill=GEWEIH, width=5 * UEBER)


def i_cultivate_ground(d):
    """Bestellter Boden — Icon des Kultivator-Bauteils.

    KEIN Gegenstands-Icon: `cultivate_ground` steht in `PieceTable.ts`,
    nicht in `itemDefs.ts`, und wird von `PieceSelection.ts` aus
    demselben Ordner `/assets/sprites/` geladen wie die Item-Icons. Die
    beiden anderen Bauteil-Icons (`hoe`, `stone`) fallen mit
    Gegenstands-Icons zusammen und waren deshalb schon abgedeckt —
    dieses eine fehlte als einziges und hatte kein Rezept.

    Motiv: aufgeworfene Ackerkrume mit Furchen und zwei Keimlingen.
    """
    # Erdscholle: oben gerundet, unten breit aufsitzend.
    poly(d, [(12, 44), (18, 34), (32, 30), (46, 34), (52, 44), (52, 54), (12, 54)],
         (94, 66, 42, 255))
    glanz(d, [(18, 40), (32, 35), (46, 40), (46, 45), (18, 45)], (124, 90, 58, 255))
    # Furchen — waagerecht, wie vom Kultivator gezogen.
    for y in (46, 50):
        d.line([(s(16), s(y)), (s(48), s(y))], fill=(66, 46, 28, 255), width=2 * UEBER)
    # Keimlinge: Stengel mit zwei Keimblaettern.
    for x in (25, 39):
        d.line([(s(x), s(34)), (s(x), s(18))], fill=GRUEN, width=3 * UEBER)
        poly(d, [(x, 22), (x - 8, 17), (x - 2, 13)], GRUEN_HELL)
        poly(d, [(x, 22), (x + 8, 17), (x + 2, 13)], GRUEN)


ICONS = {
    "cultivate_ground": i_cultivate_ground,
    "hammer": i_hammer, "axe_flint": i_axe_flint, "hoe": i_hoe,
    "cultivator_bronze": i_cultivator_bronze, "pickaxe_antler": i_pickaxe_antler,
    "club": i_club, "wood": i_wood, "stone": i_stone, "flint": i_flint,
    "resin": i_resin, "amber": i_amber, "coins": i_coins,
    "blueberries": i_blueberries, "raspberry": i_raspberry, "carrot": i_carrot,
    "dandelion": i_dandelion, "mushroom": i_mushroom, "thistle": i_thistle,
    "raw_meat": i_raw_meat, "necktail": i_necktail,
    "necktailgrilled": i_necktailgrilled, "entrails": i_entrails,
    "TrophyDeer": i_TrophyDeer, "TrophyEikthyr": i_TrophyEikthyr,
    "HardAntler": i_HardAntler,
}


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--nur", help="kommagetrennte Liste von Icon-Namen")
    p.add_argument("--blatt", action="store_true",
                   help="zusaetzlich eine Uebersicht nach out/icons.png legen")
    args = p.parse_args()
    os.makedirs(ZIEL, exist_ok=True)
    namen = args.nur.split(",") if args.nur else sorted(ICONS)

    fertig = []
    for name in namen:
        if name not in ICONS:
            print(f"  unbekannt: {name}")
            continue
        bild, d = leinwand()
        ICONS[name](d)
        klein = bild.resize((KANTE, KANTE), Image.LANCZOS)
        klein.save(os.path.join(ZIEL, f"{name}.png"))
        deckung = (klein.split()[3].point(lambda v: 255 if v > 16 else 0)
                   .convert("L").getdata())
        anteil = sum(1 for v in deckung if v) / (KANTE * KANTE)
        print(f"  {name:20s} 64x64 RGBA  Deckung {anteil*100:.0f}%")
        fertig.append((name, klein))

    if args.blatt and fertig:
        spalten = 5
        zeilen = (len(fertig) + spalten - 1) // spalten
        blatt = Image.new("RGBA", (spalten * 72, zeilen * 72), (32, 30, 28, 255))
        for i, (_, b) in enumerate(fertig):
            blatt.alpha_composite(b, ((i % spalten) * 72 + 4, (i // spalten) * 72 + 4))
        out = os.path.join(WURZEL, "out")
        os.makedirs(out, exist_ok=True)
        blatt.save(os.path.join(out, "icons.png"))
        print(f"  Uebersicht -> out/icons.png")


if __name__ == "__main__":
    main()
