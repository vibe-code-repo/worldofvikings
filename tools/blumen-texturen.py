#!/usr/bin/env python3
"""
Zeichnet die Karten aller Blumen und Unkraeuter — je Art EIN Bild.

    python3 tools/blumen-texturen.py                  # alle Arten
    python3 tools/blumen-texturen.py --art distel     # nur eine

── Warum nur eine Karte je Art ──────────────────────────────────────
Straeucher brauchen zwei Bilder, weil ihr Holz sichtbar ist und eine
eigene Rinde traegt. Eine Blume hat kein Holz: Was man sieht, ist ein
Stengel mit Blatt und Bluete, und der Stengel ist auf der Karte schon
mitgemalt. `tools/blumen-generieren.py` baut deshalb reine Kartenbuendel
ohne jede Roehrengeometrie — zwei Dreiecke je Pflanze.

── Aufbau ───────────────────────────────────────────────────────────
Wie bei den Buschkarten laeuft der Stiel am UNTEREN Bildrand heraus
(v=0). Dort setzt die Karte auf dem Boden auf; sitzt der Stiel woanders,
schwebt die Pflanze.

Der RGB-Hintergrund traegt die mittlere Blattfarbe bei Alpha 0 — siehe
`tools/lib/karten.py` fuer den Grund (Mipmaps mitteln ueber RGB und
Alpha).

── Warum 96² statt 128² ─────────────────────────────────────────────
Eine Blume ist im Bild noch einmal deutlich kleiner als ein Busch, und
davon stehen Hunderte herum. Gemessen an der Distel — der detailreichsten
Art — traegt 96² alles, was auf zwei Meter Entfernung unterscheidbar
ist. Ausnahme sind die Arten mit gefiederten Blaettern (Schafgarbe,
Farn), die ihre Struktur bei 96² verlieren; sie stehen auf 128².
"""
import argparse
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from karten import (abschliessen, achse, achse_zeichnen,  # noqa: E402
                    gedreht, mischen, umriss)

GROESSE = 96
GROESSE_FEIN = 128        # fuer gefiederte Arten, siehe Kopfkommentar


# ── Blattumrisse ─────────────────────────────────────────────────────

def blatt_lanzett(laenge, breite, rnd, saegung=0.0, zaehne=12):
    """Laengliches Blatt, wahlweise mit gesaegtem Rand.

    Deckt die halbe Artenliste ab: Brennnessel (stark gesaegt), Ampfer
    (glatt und breit), Seggen (schmal und glatt). Der Unterschied ist
    keine eigene Funktion wert, sondern zwei Zahlen.
    """
    schritte = 26
    rand = []
    for i in range(schritte + 1):
        t = i / schritte
        grund = math.sin(math.pi * t ** 0.62) ** 0.45
        stoerung = 1.0 + saegung * math.sin(zaehne * math.pi * t)
        rand.append((0.5 * breite * grund * max(0.05, stoerung), t * laenge))
    return umriss(rand)


def blatt_halm(laenge, breite, rnd):
    """Grashalm: unten am breitesten, laeuft spitz aus, leicht gebogen.

    Die Biegung steckt im Umriss selbst und nicht in einer Drehung —
    ein gerader Halm sieht aus wie ein Zahnstocher, und ein gedrehter
    gerader Halm sieht aus wie ein gekippter Zahnstocher.
    """
    schritte = 20
    bogen = (rnd.random() - 0.5) * 0.55
    rand_r, rand_l = [], []
    for i in range(schritte + 1):
        t = i / schritte
        w = 0.5 * breite * (1.0 - t) ** 0.7
        versatz = bogen * laenge * t * t
        rand_r.append((versatz + w, t * laenge))
        rand_l.append((versatz - w, t * laenge))
    return rand_r + list(reversed(rand_l))


def blatt_fieder(laenge, breite, rnd, paare=7):
    """Ein Fiederblatt als GESCHLOSSENER Umriss mit tiefen Einschnitten.

    Fuer Schafgarbe und Farn. Die Alternative — jedes Fiederchen einzeln
    als Polygon — kostet bei 96 Pixeln mehr, als sie einbringt: Die
    Blaettchen waeren zwei Pixel breit und verschwinden im
    Weichzeichner. Ein Umriss mit tiefen Buchten liest sich auf Distanz
    genauso und ist ein Zug statt fuenfzig.
    """
    schritte = paare * 6
    rand = []
    for i in range(schritte + 1):
        t = i / schritte
        grund = math.sin(math.pi * t ** 0.75) ** 0.4
        # Tiefe Einschnitte: Der Sinus geht fast auf null herunter.
        bucht = 0.30 + 0.70 * abs(math.sin(paare * math.pi * t)) ** 0.6
        rand.append((0.5 * breite * grund * bucht, t * laenge))
    return umriss(rand)


# ── Blueten ──────────────────────────────────────────────────────────

def bluete_glocke(stift, x, y, r, profil, rnd):
    """Nickende Glocke — Glockenblume. Haengt nach UNTEN, das ist ihr
    Kennzeichen; eine aufrecht gezeichnete Glocke liest sich als Tulpe."""
    ton = mischen(profil['bluete_dunkel'], profil['bluete_hell'], rnd.random())
    # Als ELLIPSEN, nicht als Polygon: Der erste Entwurf war ein
    # Fuenfeck und las sich bei 96 Pixeln als kleiner Kasten.
    stift.ellipse([x - r * 0.72, y - r * 0.15, x + r * 0.72, y + r * 1.35],
                  fill=ton + (255,))
    # Der Kelchrand unten, etwas dunkler — er gibt der Glocke ihre
    # Oeffnung und damit die Blickrichtung nach unten.
    saum = mischen(ton, profil['bluete_dunkel'], 0.45)
    stift.ellipse([x - r * 0.68, y + r * 0.85, x + r * 0.68, y + r * 1.55],
                  fill=saum + (255,))
    stift.ellipse([x - r * 0.30, y + r * 1.05, x + r * 0.30, y + r * 1.45],
                  fill=mischen(saum, profil['bluete_dunkel'], 0.5) + (255,))


def bluete_strahl(stift, x, y, r, profil, rnd):
    """Zungenblueten um eine Scheibe — Margerite.

    Die Strahlen werden als Ellipsen gezeichnet, nicht als Linien: eine
    Linie hat konstante Breite und ergibt einen Stern, kein Blueten-
    koerbchen.
    """
    ton = profil['bluete_hell']
    n = 9
    dreh = rnd.random() * math.tau
    for k in range(n):
        w = dreh + k * math.tau / n
        sx, sy = x + math.cos(w) * r * 0.62, y + math.sin(w) * r * 0.62
        rr = r * 0.34
        stift.ellipse([sx - rr, sy - rr * 0.62, sx + rr, sy + rr * 0.62],
                      fill=ton + (255,))
    m = r * 0.42
    stift.ellipse([x - m, y - m, x + m, y + m],
                  fill=profil['bluete_dunkel'] + (255,))


def bluete_kugel(stift, x, y, r, profil, rnd):
    """Gefuellte Kugelbluete — Trollblume. Ueberlappende Kreise, nach
    aussen heller: So entsteht Volumen ohne Schattierung."""
    for k in range(7):
        w = rnd.random() * math.tau
        d = r * 0.42 * math.sqrt(rnd.random())
        rr = r * (0.48 + 0.22 * rnd.random())
        ton = mischen(profil['bluete_dunkel'], profil['bluete_hell'],
                      0.3 + 0.7 * (d / max(1e-4, r * 0.42)))
        stift.ellipse([x + math.cos(w) * d - rr, y + math.sin(w) * d - rr,
                       x + math.cos(w) * d + rr, y + math.sin(w) * d + rr],
                      fill=ton + (255,))


def bluete_korb(stift, x, y, r, profil, rnd):
    """Distelkopf: stachliger Korb unten, Schopf aus Roehrenblueten oben."""
    korb = profil.get('korb', (78, 92, 62))
    stift.polygon([(x - r * 0.7, y + r * 0.9), (x + r * 0.7, y + r * 0.9),
                   (x + r * 0.55, y - r * 0.15), (x - r * 0.55, y - r * 0.15)],
                  fill=korb + (255,))
    # Huellblaetter als kleine Spitzen am Korbrand
    for k in range(5):
        sx = x - r * 0.6 + k * r * 0.3
        stift.polygon([(sx, y + r * 0.85), (sx + r * 0.16, y + r * 0.4),
                       (sx + r * 0.3, y + r * 0.85)],
                      fill=mischen(korb, (40, 52, 34), 0.5) + (255,))
    for _ in range(14):
        w = -math.pi / 2 + (rnd.random() - 0.5) * 1.5
        lg = r * (0.75 + 0.5 * rnd.random())
        ton = mischen(profil['bluete_dunkel'], profil['bluete_hell'], rnd.random())
        stift.line([(x, y - r * 0.1),
                    (x + math.cos(w) * lg, y - r * 0.1 + math.sin(w) * lg)],
                   fill=ton + (255,), width=max(1, int(r * 0.16)))


def bluete_dolde(stift, x, y, r, profil, rnd):
    """Schirmdolde — Schafgarbe. Strahlen von einem Punkt, an jedem Ende
    ein Blueten-Tupfen. Der Schirm ist FLACH; woelbt man ihn, wird eine
    Kugel daraus und die Art ist nicht mehr erkennbar."""
    stiel = profil['stiel']
    for k in range(11):
        w = -math.pi + k * math.pi / 10
        ex, ey = x + math.cos(w) * r, y + math.sin(w) * r * 0.42
        stift.line([(x, y + r * 0.30), (ex, ey)], fill=stiel + (255,), width=1)
        rr = r * (0.17 + 0.07 * rnd.random())
        ton = mischen(profil['bluete_dunkel'], profil['bluete_hell'], rnd.random())
        stift.ellipse([ex - rr, ey - rr * 0.8, ex + rr, ey + rr * 0.8],
                      fill=ton + (255,))


def bluete_schopf(stift, x, y, r, profil, rnd):
    """Wollschopf — Wollgras. Ein Buendel feiner heller Haare; gemalt als
    viele kurze Striche, weil eine gefuellte Flaeche wie Watte aussaehe
    und nicht wie Haar."""
    # Erst ein weicher Kern, dann die Haare darueber. Nur Striche vom
    # Mittelpunkt aus ergaben einen Stern, keinen Schopf.
    kern = mischen(profil['bluete_dunkel'], profil['bluete_hell'], 0.5)
    stift.ellipse([x - r * 0.52, y - r * 0.42, x + r * 0.52, y + r * 0.62],
                  fill=kern + (255,))
    for _ in range(34):
        w = rnd.random() * math.tau
        ab = r * 0.35 * rnd.random()
        lg = r * (0.35 + 0.55 * rnd.random())
        sx, sy = x + math.cos(w) * ab, y + math.sin(w) * ab
        ton = mischen(profil['bluete_dunkel'], profil['bluete_hell'], rnd.random())
        stift.line([(sx, sy), (sx + math.cos(w) * lg * 0.7, sy + math.sin(w) * lg)],
                   fill=ton + (255,), width=1)


def bluete_rispe(stift, x, y, r, profil, rnd):
    """Aufrechte Rispe — Ampfer, Seggen. Kleine Tupfen dicht an einer
    senkrechten Achse, nach oben auslaufend."""
    hoehe = r * 3.2
    for i in range(20):
        t = i / 19
        by = y - hoehe * t
        breite = r * 0.75 * (1.0 - t * 0.75)
        for _ in range(2):
            bx = x + (rnd.random() - 0.5) * 2 * breite
            rr = r * (0.14 + 0.09 * rnd.random())
            ton = mischen(profil['bluete_dunkel'], profil['bluete_hell'],
                          rnd.random())
            stift.ellipse([bx - rr, by - rr, bx + rr, by + rr], fill=ton + (255,))


BLUETEN = {
    'glocke': bluete_glocke, 'strahl': bluete_strahl, 'kugel': bluete_kugel,
    'korb': bluete_korb, 'dolde': bluete_dolde, 'schopf': bluete_schopf,
    'rispe': bluete_rispe,
}


# ── Arten ────────────────────────────────────────────────────────────
# `bau` waehlt die Zeichenroutine der Karte. Die Farben sind an
# nordischen Wiesen- und Waldarten orientiert und bewusst entsaettigt:
# Eine Blume soll auffallen, weil sie eine andere Farbe hat als das Gras,
# nicht weil sie leuchtet.
ARTEN = {
    # ── Blumen ───────────────────────────────────────────────────────
    'glockenblume': {
        'bau': 'stiel', 'bluete': 'glocke', 'fein': False,
        'dunkel': (48, 76, 44), 'hell': (98, 130, 66), 'stiel': (86, 108, 58),
        'bluete_dunkel': (74, 66, 152), 'bluete_hell': (146, 140, 220),
        'stiele': (3, 5), 'blueten': (2, 4), 'bluetengroesse': 0.085,
        'blatt': ('lanzett', 0.16, 0.20),   # Form, Laenge, Breite/Laenge
        'blattzahl': 4,
    },
    'margerite': {
        'bau': 'stiel', 'bluete': 'strahl', 'fein': False,
        'dunkel': (52, 80, 46), 'hell': (104, 136, 70), 'stiel': (92, 116, 60),
        'bluete_dunkel': (206, 178, 52), 'bluete_hell': (244, 244, 232),
        'stiele': (3, 5), 'blueten': (1, 1), 'bluetengroesse': 0.11,
        'blatt': ('lanzett', 0.20, 0.16),
        'blattzahl': 5,
    },
    'trollblume': {
        'bau': 'stiel', 'bluete': 'kugel', 'fein': False,
        'dunkel': (44, 74, 42), 'hell': (94, 126, 64), 'stiel': (82, 106, 54),
        'bluete_dunkel': (198, 150, 26), 'bluete_hell': (250, 216, 86),
        'stiele': (2, 4), 'blueten': (1, 1), 'bluetengroesse': 0.105,
        'blatt': ('fieder', 0.22, 0.62),
        'blattzahl': 4,
    },
    'schafgarbe': {
        'bau': 'stiel', 'bluete': 'dolde', 'fein': True,
        'dunkel': (56, 78, 46), 'hell': (108, 128, 70), 'stiel': (98, 112, 62),
        'bluete_dunkel': (214, 214, 196), 'bluete_hell': (250, 250, 244),
        'stiele': (3, 4), 'blueten': (1, 1), 'bluetengroesse': 0.115,
        'blatt': ('fieder', 0.26, 0.26),
        'blattzahl': 5,
    },
    'wollgras': {
        'bau': 'halme', 'bluete': 'schopf', 'fein': False,
        'dunkel': (74, 92, 52), 'hell': (132, 148, 84), 'stiel': (110, 126, 68),
        'bluete_dunkel': (224, 222, 208), 'bluete_hell': (252, 252, 248),
        'halme': (7, 10), 'bluetengroesse': 0.10, 'bluetenanteil': 0.55,
    },
    # ── Unkraut ──────────────────────────────────────────────────────
    'brennnessel': {
        'bau': 'blattstiel', 'bluete': None, 'fein': False,
        'dunkel': (32, 60, 30), 'hell': (76, 108, 48), 'stiel': (66, 92, 44),
        'stiele': (3, 5),
        # 0.28 fuellte bei 96 Pixeln das halbe Bild mit einem Blatt.
        'blatt': ('saege', 0.19, 0.52),
        'blattzahl': 8, 'gegenstaendig': True,
    },
    'distel': {
        'bau': 'stiel', 'bluete': 'korb', 'fein': False,
        'dunkel': (58, 78, 52), 'hell': (112, 132, 86), 'stiel': (96, 112, 72),
        'bluete_dunkel': (114, 62, 132), 'bluete_hell': (192, 138, 208),
        'korb': (80, 94, 64),
        'stiele': (3, 4), 'blueten': (1, 2), 'bluetengroesse': 0.10,
        'blatt': ('saege', 0.22, 0.34),
        'blattzahl': 5, 'stachelblatt': True,
    },
    'ampfer': {
        'bau': 'blattstiel', 'bluete': 'rispe', 'fein': False,
        'dunkel': (54, 78, 40), 'hell': (112, 138, 62), 'stiel': (128, 84, 52),
        'bluete_dunkel': (128, 58, 40), 'bluete_hell': (186, 108, 74),
        'stiele': (2, 3), 'bluetengroesse': 0.055,
        'blatt': ('lanzett', 0.34, 0.30),
        'blattzahl': 6,
    },
    'farn': {
        'bau': 'wedel', 'bluete': None, 'fein': True,
        'dunkel': (38, 66, 36), 'hell': (92, 124, 56), 'stiel': (84, 100, 48),
        'wedel': (4, 6),
    },
    'seggen': {
        'bau': 'halme', 'bluete': 'rispe', 'fein': False,
        'dunkel': (66, 86, 44), 'hell': (128, 146, 76), 'stiel': (110, 128, 64),
        'bluete_dunkel': (94, 84, 52), 'bluete_hell': (156, 142, 96),
        'halme': (9, 13), 'bluetengroesse': 0.038, 'bluetenanteil': 0.30,
    },
}

BLATTFORMEN = {
    'lanzett': lambda lg, br, rnd: blatt_lanzett(lg, br, rnd),
    'saege': lambda lg, br, rnd: blatt_lanzett(lg, br, rnd, saegung=0.22, zaehne=16),
    'fieder': lambda lg, br, rnd: blatt_fieder(lg, br, rnd),
}


# ── Kartenbau ────────────────────────────────────────────────────────

def _blatt_setzen(stift, profil, G, rnd, x, y, richtung, laenge_anteil):
    form, _lg, schlank = profil['blatt']
    laenge = G * laenge_anteil
    breite = laenge * schlank
    farbe = mischen(profil['dunkel'], profil['hell'], rnd.random() ** 1.3)
    stift.polygon(gedreht(BLATTFORMEN[form](laenge, breite, rnd), richtung, x, y),
                  fill=farbe + (255,))
    spitze = (x + math.sin(richtung) * laenge * 0.9,
              y - math.cos(richtung) * laenge * 0.9)
    stift.line([(x, y), spitze],
               fill=mischen(farbe, profil['dunkel'], 0.5) + (255,), width=1)


def karte_stiel(profil, seed, G):
    """Aufrechte Stengel mit Blaettern unten und Bluete obenauf.

    Der Regelfall: Glockenblume, Margerite, Trollblume, Schafgarbe,
    Distel. Mehrere Stengel je Karte, weil eine einzelne Blume auf einer
    Karte im Spiel als schwebender Strich liest — Blumen stehen in
    Gruppen.
    """
    rnd = random.Random(seed)
    grund = mischen(profil['dunkel'], profil['hell'], 0.5)
    bild = Image.new('RGBA', (G, G), grund + (0,))
    stift = ImageDraw.Draw(bild)

    anzahl = rnd.randint(*profil['stiele'])
    bl_min, bl_max = profil.get('blueten', (1, 1))
    for k in range(anzahl):
        versatz = (k - (anzahl - 1) / 2) * G * (0.26 / max(1, anzahl - 1) * 2)
        bahn = [(x + versatz, y) for x, y in
                achse(G, rnd, bogen=0.05, hoehe=0.62 + 0.24 * rnd.random())]
        achse_zeichnen(stift, bahn, profil['stiel'], G,
                       staerke=0.016, verjuengung=0.4)

        # Blaetter sitzen im UNTEREN Drittel. Bei diesen Arten steht die
        # Bluete auf einem weitgehend nackten Stengel — das ist der
        # Unterschied zu einem Kraut.
        for i in range(1, max(2, len(bahn) // 3)):
            if rnd.random() < 0.35:
                continue
            x, y = bahn[i]
            seite = 1 if i % 2 == 0 else -1
            _blatt_setzen(stift, profil, G, rnd, x, y,
                          seite * (1.0 + 0.35 * rnd.random()),
                          profil['blatt'][1] * (0.75 + 0.5 * rnd.random()))

        zeichner = BLUETEN[profil['bluete']]
        r = G * profil['bluetengroesse']
        for b in range(rnd.randint(bl_min, bl_max)):
            bx, by = bahn[-1 - b * 2] if b * 2 < len(bahn) else bahn[-1]
            zeichner(stift, bx, by, r * (0.85 + 0.3 * rnd.random()), profil, rnd)

    return abschliessen(bild, grund, G)


def karte_blattstiel(profil, seed, G):
    """Beblaetterter Stengel ohne nackten Abschnitt — Brennnessel, Ampfer.

    Der Gegenentwurf zu `karte_stiel`: Ein Kraut traegt Blaetter ueber
    die ganze Hoehe. Bei der Brennnessel stehen sie GEGENSTAENDIG, also
    paarweise auf gleicher Hoehe — daran erkennt man sie.
    """
    rnd = random.Random(seed)
    grund = mischen(profil['dunkel'], profil['hell'], 0.5)
    bild = Image.new('RGBA', (G, G), grund + (0,))
    stift = ImageDraw.Draw(bild)

    anzahl = rnd.randint(*profil['stiele'])
    for k in range(anzahl):
        versatz = (k - (anzahl - 1) / 2) * G * 0.17
        bahn = [(x + versatz, y) for x, y in
                achse(G, rnd, bogen=0.035, hoehe=0.66 + 0.22 * rnd.random())]
        achse_zeichnen(stift, bahn, profil['stiel'], G,
                       staerke=0.018, verjuengung=0.45)

        schritt = max(1, (len(bahn) - 2) // profil['blattzahl'])
        for i in range(2, len(bahn) - 1, schritt):
            x, y = bahn[i]
            seiten = (-1, 1) if profil.get('gegenstaendig') else \
                     ((1,) if (i // schritt) % 2 == 0 else (-1,))
            for seite in seiten:
                _blatt_setzen(stift, profil, G, rnd, x, y,
                              seite * (1.15 + 0.3 * rnd.random()),
                              profil['blatt'][1] * (0.8 + 0.4 * rnd.random()))

        if profil['bluete']:
            BLUETEN[profil['bluete']](stift, bahn[-1][0], bahn[-1][1],
                                      G * profil['bluetengroesse'], profil, rnd)

    return abschliessen(bild, grund, G)


def karte_halme(profil, seed, G):
    """Grashorst — Wollgras, Seggen. Halme aus einem Punkt, nach aussen
    gebogen; ein Teil traegt oben einen Fruchtstand."""
    rnd = random.Random(seed)
    grund = mischen(profil['dunkel'], profil['hell'], 0.5)
    bild = Image.new('RGBA', (G, G), grund + (0,))
    stift = ImageDraw.Draw(bild)

    anzahl = rnd.randint(*profil['halme'])
    fuss_y = G * 0.99
    for k in range(anzahl):
        fuss_x = G * (0.5 + (rnd.random() - 0.5) * 0.22)
        laenge = G * (0.55 + 0.40 * rnd.random())
        breite = G * (0.026 + 0.018 * rnd.random())
        # Halme faechern nach aussen: Die Neigung waechst mit dem Abstand
        # von der Mitte, sonst steht der Horst da wie ein Besenstiel.
        neigung = (fuss_x / G - 0.5) * 2.2 + (rnd.random() - 0.5) * 0.5
        farbe = mischen(profil['dunkel'], profil['hell'], rnd.random() ** 1.2)
        stift.polygon(gedreht(blatt_halm(laenge, breite, rnd), neigung,
                              fuss_x, fuss_y), fill=farbe + (255,))

        if profil['bluete'] and rnd.random() < profil['bluetenanteil']:
            sx = fuss_x + math.sin(neigung) * laenge * 0.95
            sy = fuss_y - math.cos(neigung) * laenge * 0.95
            BLUETEN[profil['bluete']](stift, sx, sy,
                                      G * profil['bluetengroesse'], profil, rnd)

    return abschliessen(bild, grund, G)


def karte_wedel(profil, seed, G):
    """Farnwedel — mehrere aus einem Punkt, nach aussen gebogen.

    Der Wedel ist EIN Fiederumriss, kein Stiel mit Blaettchen: Bei 128
    Pixeln waeren die einzelnen Fiedern zwei Pixel breit und
    verschwaenden im Weichzeichner (siehe `blatt_fieder`).
    """
    rnd = random.Random(seed)
    grund = mischen(profil['dunkel'], profil['hell'], 0.5)
    bild = Image.new('RGBA', (G, G), grund + (0,))
    stift = ImageDraw.Draw(bild)

    anzahl = rnd.randint(*profil['wedel'])
    fuss_y = G * 0.99
    for k in range(anzahl):
        fuss_x = G * (0.5 + (rnd.random() - 0.5) * 0.20)
        laenge = G * (0.60 + 0.32 * rnd.random())
        breite = laenge * (0.30 + 0.10 * rnd.random())
        neigung = (fuss_x / G - 0.5) * 2.4 + (rnd.random() - 0.5) * 0.6
        farbe = mischen(profil['dunkel'], profil['hell'], rnd.random() ** 1.3)
        stift.polygon(gedreht(blatt_fieder(laenge, breite, rnd, paare=8),
                              neigung, fuss_x, fuss_y), fill=farbe + (255,))
        # Mittelrippe: gibt dem Wedel eine Richtung, sonst ist er ein Fleck
        spitze = (fuss_x + math.sin(neigung) * laenge * 0.92,
                  fuss_y - math.cos(neigung) * laenge * 0.92)
        stift.line([(fuss_x, fuss_y), spitze],
                   fill=mischen(farbe, profil['dunkel'], 0.5) + (255,), width=1)

    return abschliessen(bild, grund, G)


KARTEN = {
    'stiel': karte_stiel, 'blattstiel': karte_blattstiel,
    'halme': karte_halme, 'wedel': karte_wedel,
}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--ziel', default='assets/textures')
    p.add_argument('--art', default='alle', choices=['alle'] + list(ARTEN))
    p.add_argument('--seed', type=int, default=11)
    args = p.parse_args()

    wurzel = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ziel = os.path.join(wurzel, args.ziel)
    os.makedirs(ziel, exist_ok=True)

    arten = list(ARTEN) if args.art == 'alle' else [args.art]
    for i, name in enumerate(arten):
        profil = ARTEN[name]
        G = GROESSE_FEIN if profil.get('fein') else GROESSE
        bild = KARTEN[profil['bau']](profil, args.seed + i * 17, G)
        pfad = os.path.join(ziel, f'{name}_karte.png')
        bild.save(pfad)
        a = np.array(bild)[..., 3]
        print(f'FERTIG {pfad} — {G}x{G}, {100.0 * (a < 128).mean():.0f} % Alpha-Loecher')


if __name__ == '__main__':
    main()
