#!/usr/bin/env python3
"""
Zeichnet die Texturen aller Buscharten — je Art eine Laubkarte und eine
Rinde.

    python3 tools/busch-texturen.py                 # alle Arten
    python3 tools/busch-texturen.py --art wacholder # nur eine

── Warum diese Datei existiert ──────────────────────────────────────
Wie `tools/eiche-texturen.py`: nichts davon stammt aus Valheim, alles
wird gerechnet. Die Buesche sind damit vollstaendig frei von fremden
Rechten — Geometrie aus Sapling, Bild aus diesem Skript.

── Aufbau der Laubkarte ─────────────────────────────────────────────
Wie bei Birke und Eiche ist es KEIN einzelnes Blatt, sondern ein ganzer
belaubter Zweig, dessen Stiel am UNTEREN Bildrand herauslaeuft. Das ist
Bedingung, nicht Geschmack: `laub_karten_variieren` in
`tools/busch-generieren.py` sucht die Kante am Holz und legt sie auf
v=0 — dort muss der Stiel sitzen, sonst zeigen die gemalten Aestchen
ins Leere.

Der Hintergrund traegt die mittlere Blattfarbe bei Alpha 0 und nicht
transparentes Schwarz. Mipmaps mitteln ueber RGB *und* Alpha; hinter
den Blaettern duerfte also kein Nichts liegen, sonst wird das Laub mit
der Entfernung dunkel. Derselbe Fallstrick steht in
`tools/gen-grass-texture.py` und `tools/eiche-texturen.py`.

── Warum Buesche kleinere Karten bekommen als Baeume ────────────────
128² statt 256². Ein Busch ist im Bild selten hoeher als ein Zehntel
dessen, was ein Baum einnimmt, und er steht in Massen herum. Bei
gleicher Kartengroesse waere fast jede Texel-Zeile verschenkt.

── Aufbau der Rinde ─────────────────────────────────────────────────
Zwei Bauarten, weil sich die Straucher genau darin unterscheiden:
`furche` fuer laengsrissige Rinde (Holunder, Wacholder) und `glatt`
fuer die glatten Straeucher (Hasel, Weide), deren Kennzeichen die
waagerechten Lentizellen sind — die hellen Korkporen, an denen man eine
Haselgerte auf einen Meter erkennt.

Beides kachelt exakt: `uv_auf_rechteck` wiederholt die Rinde ueber die
Trieblaenge (`alt[1] % 1.0`). Auch die Lentizellen laufen deshalb ueber
den Bildrand hinaus auf der anderen Seite wieder herein.
"""
import argparse
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from rauschen import furchen as _furchen, normiert, oktaven  # noqa: E402
from karten import (abschliessen as _abschliessen_lib, achse as _achse_lib,  # noqa: E402
                    achse_zeichnen as _achse_zeichnen_lib, gedreht, mischen,
                    umriss as _umriss)

BLATT_GROESSE = 128
RINDE_GROESSE = 128


# ── Blattumrisse ─────────────────────────────────────────────────────
# Jede Form ist ein Produkt aus Silhouette und Randstoerung, ausgewertet
# ueber t = 0 (Stielansatz) bis 1 (Spitze). Parametrisch statt gemalt,
# damit jedes Blatt eine eigene Form bekommt und kein Stempelmuster
# entsteht — dieselbe Ueberlegung wie beim Eichenblatt.

def blatt_rund(laenge, breite, rnd):
    """Haselblatt: fast kreisrund, kurz zugespitzt, Rand fein gesaegt.

    Der Exponent 0.55 auf t schiebt die breiteste Stelle in die MITTE
    (beim Eichenblatt sitzt sie mit 0.75 im oberen Drittel). `hoch` haelt
    die Blattbasis breit statt sie auf null zulaufen zu lassen — ein
    Haselblatt sitzt herzfoermig am Stiel.
    """
    schritte = 40
    rand = []
    for i in range(schritte + 1):
        t = i / schritte
        grund = math.sin(math.pi * t ** 0.55) ** 0.42
        herz = 1.0 - 0.55 * math.exp(-((t / 0.09) ** 2))
        saege = 1.0 + 0.055 * math.sin(26 * math.pi * t)
        rand.append((0.5 * breite * grund * herz * saege, t * laenge))
    return _umriss(rand)


def blatt_lanzett(laenge, breite, rnd):
    """Weidenblatt: schmal, beidseitig spitz, ganzrandig."""
    schritte = 28
    rand = []
    for i in range(schritte + 1):
        t = i / schritte
        grund = math.sin(math.pi * t) ** 0.34
        rand.append((0.5 * breite * grund, t * laenge))
    return _umriss(rand)


def blatt_eifoermig(laenge, breite, rnd):
    """Einzelnes Fiederblaettchen des Holunders: eifoermig, grob gesaegt."""
    schritte = 26
    rand = []
    for i in range(schritte + 1):
        t = i / schritte
        grund = math.sin(math.pi * t ** 0.68) ** 0.5
        saege = 1.0 + 0.09 * math.sin(14 * math.pi * t)
        rand.append((0.5 * breite * grund * saege, t * laenge))
    return _umriss(rand)


def blatt_schuppe(laenge, breite, rnd):
    """Winziges Schuppenblatt — Heidekraut, Ginster.

    Kaum mehr als ein Strich mit Breite. Bei diesen Arten traegt nicht
    das Laub den Eindruck, sondern die Bluete und die Rute; das Blatt
    muss nur verhindern, dass die Rute nackt wirkt.
    """
    schritte = 10
    rand = []
    for i in range(schritte + 1):
        t = i / schritte
        rand.append((0.5 * breite * math.sin(math.pi * t) ** 0.5, t * laenge))
    return _umriss(rand)


def blatt_dorn(laenge, breite, rnd):
    """Brombeerblaettchen: laenglich, sehr grob gezaehnt, spitz."""
    schritte = 30
    rand = []
    for i in range(schritte + 1):
        t = i / schritte
        grund = math.sin(math.pi * t ** 0.62) ** 0.55
        saege = 1.0 + 0.16 * math.sin(11 * math.pi * t)
        rand.append((0.5 * breite * grund * max(0.05, saege), t * laenge))
    return _umriss(rand)


# ── Arten ────────────────────────────────────────────────────────────
# `laub` waehlt die Zeichenroutine der Karte, alles andere sind deren
# Stellschrauben. Die Farben sind entsaettigt gehalten — ein Busch steht
# im Wald neben Fichten, und gesaettigtes Gruen springt dort heraus.
ARTEN = {
    # Hasel: der Waldrandstrauch schlechthin. Grosse runde Blaetter,
    # frisches Gruen, glatte graubraune Rinde mit hellen Lentizellen.
    'hasel': {
        'laub': 'wechsel',
        'blatt': blatt_rund,
        'dunkel': (52, 78, 40),
        'hell': (130, 162, 76),
        'stiel': (98, 84, 60),
        # Kleiner als es der Art entspraeche: Ein Haselblatt ist gross,
        # aber bei 0.30 der Kartenhoehe schnitt der Bildrand die oberen
        # und seitlichen Blaetter gerade ab — auf einer Cutout-Karte
        # steht so eine Kante spaeter als Lineal im Laub.
        'blattgroesse': (0.25, 0.10),   # Anteil der Kartenhoehe, + Streuung
        'schlankheit': (0.86, 0.10),    # Breite/Laenge
        'luecken': 0.22,                # Anteil uebersprungener Ansatzstellen
        'rinde_art': 'glatt',
        'rinde_tief': (74, 62, 50),
        'rinde_hoch': (146, 132, 114),
        'lentizellen': (188, 176, 156),
    },
    # Wacholder: kein Laub, sondern Nadeln in Dreierquirlen. Blaugruen
    # mit dem hellen Streifen auf der Nadeloberseite, der die Art auf
    # Entfernung aufhellt. Rinde faserig rotbraun.
    'wacholder': {
        'laub': 'nadeln',
        'dunkel': (38, 62, 52),
        'hell': (108, 140, 118),
        'stiel': (86, 62, 48),
        'rinde_art': 'furche',
        'rinde_tief': (58, 38, 30),
        'rinde_hoch': (132, 96, 74),
        'faser': True,                  # Laengsfasern statt Rautenfurchen
    },
    # Weide: Ufergestruepp aus langen Ruten mit schmalen Blaettern. Die
    # Unterseite ist silbrig — im Wind kippen die Blaetter und der ganze
    # Strauch wird hell. Auf einer Karte laesst sich das nur andeuten,
    # indem ein Teil der Blaetter in der hellen Farbe steht.
    'weide': {
        'laub': 'wechsel',
        'blatt': blatt_lanzett,
        'dunkel': (58, 82, 56),
        'hell': (156, 172, 142),
        'stiel': (110, 108, 78),
        # Ein Weidenblatt ist LANG UND SCHMAL — beim ersten Versuch stand
        # es bei Breite/Laenge 0.22 und sah trotzdem nach Olive aus, weil
        # die Streuung ein Viertel der Blaetter darueber hob. Jetzt bleibt
        # keines breiter als ein Fuenftel seiner Laenge.
        'blattgroesse': (0.34, 0.10),
        'schlankheit': (0.21, 0.025),
        'luecken': 0.10,                # dicht besetzte Rute
        'silber': 0.30,                 # Anteil Blaetter in Silberton
        'rinde_art': 'glatt',
        'rinde_tief': (72, 76, 54),
        'rinde_hoch': (138, 140, 112),
        'lentizellen': (172, 172, 148),
    },
    # Holunder: gefiederte Blaetter — fuenf bis sieben Blaettchen an einer
    # Achse — und schwarze Beerendolden. Der einzige Busch mit Fruechten;
    # sie sind der Farbakzent im sonst gruenen Unterholz.
    'holunder': {
        'laub': 'fieder',
        'blatt': blatt_eifoermig,
        'dunkel': (44, 68, 42),
        'hell': (104, 138, 70),
        'stiel': (108, 96, 70),
        # Grosse Blaettchen an kurzer Spindel. Mit 0.20 und bis zu drei
        # Paaren war die Spindel laenger als die Blaettchen sie decken
        # konnten, und die Karte zeigte lange nackte Striche — dieselbe
        # Spiess-Falle wie bei den Seitenaesten der Eiche.
        'blattgroesse': (0.28, 0.05),
        'schlankheit': (0.46, 0.06),
        'fiederpaare': (2, 2),
        'beeren': (26, 22, 34),         # fast schwarz mit Blaustich
        'beeren_glanz': (96, 88, 116),
        'rinde_art': 'furche',
        'rinde_tief': (62, 54, 44),
        'rinde_hoch': (148, 138, 120),
    },
    # Brombeere: niedriges Dornengestruepp, dunkles derbes Laub, rote
    # Ranken. Die Stacheln sind zu klein fuer die Geometrie und stehen
    # deshalb auf der Karte — auf dem gemalten Aestchen, nicht auf dem
    # echten Holz.
    'brombeere': {
        'laub': 'wechsel',
        'blatt': blatt_dorn,
        'dunkel': (34, 56, 34),
        'hell': (92, 120, 62),
        'stiel': (122, 74, 62),         # roetliche Ranke
        'blattgroesse': (0.30, 0.10),
        'schlankheit': (0.52, 0.08),
        'luecken': 0.26,
        'stacheln': True,
        'beeren': (38, 26, 40),
        'beeren_glanz': (118, 84, 108),
        'beeren_dolden': 1,
        'rinde_art': 'glatt',
        'rinde_tief': (78, 52, 44),
        'rinde_hoch': (134, 96, 82),
        'lentizellen': (150, 122, 104),
    },
    # ── Zweite Staffel ───────────────────────────────────────────────
    # Heidekraut: der Zwergstrauch der offenen Heide. Winzige
    # Schuppenblaetter, und der ganze Eindruck haengt an der violetten
    # Bluete — ein Heidefeld ist im August lila, nicht gruen.
    'heidekraut': {
        'laub': 'aehre',
        'blatt': blatt_schuppe,
        'dunkel': (48, 62, 42),
        'hell': (96, 112, 72),
        'stiel': (92, 76, 58),
        'blattgroesse': (0.075, 0.030),
        'schlankheit': (0.30, 0.06),
        'ruten': 4,
        'bluete_dunkel': (118, 52, 108),
        'bluete_hell': (198, 130, 190),
        'bluete_ab': 0.35,
        'bluetendichte': 4,
        'rinde_art': 'furche',
        'rinde_tief': (58, 44, 34),
        'rinde_hoch': (118, 98, 78),
        'faser': True,
    },
    # Ginster: fast blattlos — die gruenen Ruten uebernehmen die
    # Photosynthese. Deshalb steht hier ein GRUENER Rindenton, der bei
    # keiner anderen Art vorkommt, und leuchtend gelbe Blueten.
    'ginster': {
        'laub': 'aehre',
        'blatt': blatt_schuppe,
        'dunkel': (54, 82, 46),
        'hell': (104, 136, 72),
        'stiel': (78, 106, 54),         # gruene Rute statt braunem Stiel
        'blattgroesse': (0.090, 0.035),
        'schlankheit': (0.24, 0.05),
        'ruten': 3,
        'bluete_dunkel': (196, 148, 24),
        'bluete_hell': (248, 214, 76),
        'bluete_ab': 0.30,
        'bluetendichte': 3,
        'rinde_art': 'glatt',
        'rinde_tief': (62, 82, 46),
        'rinde_hoch': (118, 142, 86),
        'lentizellen': (150, 168, 112),
    },
    # Schlehe: dorniger Schwarzdorn. Dunkles kleines Laub, fast schwarze
    # Rinde und blau bereifte Fruechte, die EINZELN in den Blattachseln
    # sitzen — daran unterscheidet man sie vom Holunder.
    'schlehe': {
        'laub': 'wechsel',
        'blatt': blatt_eifoermig,
        'dunkel': (36, 54, 34),
        'hell': (86, 108, 58),
        'stiel': (64, 52, 46),
        'blattgroesse': (0.20, 0.07),
        'schlankheit': (0.52, 0.08),
        'luecken': 0.20,
        'stacheln': True,
        'beeren': (62, 72, 112),        # blau bereift, nicht schwarz
        'beeren_glanz': (146, 158, 196),
        'beeren_einzeln': 0.45,
        'beerengroesse': 0.036,
        'rinde_art': 'furche',
        'rinde_tief': (38, 32, 28),     # Schwarzdorn heisst so
        'rinde_hoch': (96, 84, 72),
    },
    # Hartriegel: der Farbtupfer im winterlichen Unterholz — blutrote
    # Zweige. Das Laub ist unauffaellig, die RINDE ist das Kennzeichen,
    # und sie ist die einzige rote im ganzen Satz.
    'hartriegel': {
        'laub': 'wechsel',
        'blatt': blatt_eifoermig,
        'dunkel': (48, 70, 44),
        'hell': (118, 140, 76),
        'stiel': (146, 62, 48),         # rote Zweige
        'blattgroesse': (0.26, 0.09),
        'schlankheit': (0.58, 0.08),
        'luecken': 0.18,
        'rinde_art': 'glatt',
        'rinde_tief': (108, 44, 36),
        'rinde_hoch': (172, 86, 66),
        'lentizellen': (198, 132, 108),
    },
    # Heidelbeere: der niedrige Zwergstrauch des Nadelwaldbodens. Kleine
    # frischgruene Blaetter, blaue Beeren einzeln darunter — und als
    # einzige Art gruene statt brauner Triebe.
    'heidelbeere': {
        'laub': 'wechsel',
        'blatt': blatt_eifoermig,
        'dunkel': (52, 84, 44),
        'hell': (114, 152, 76),
        'stiel': (86, 116, 58),         # gruene kantige Triebe
        'blattgroesse': (0.19, 0.06),
        'schlankheit': (0.60, 0.08),
        'luecken': 0.16,
        'beeren': (44, 54, 92),
        'beeren_glanz': (122, 136, 178),
        'beeren_einzeln': 0.50,
        'beerengroesse': 0.028,
        'rinde_art': 'glatt',
        'rinde_tief': (72, 92, 52),
        'rinde_hoch': (126, 148, 92),
        'lentizellen': (156, 172, 118),
    },
}


# ── Laubkarten ───────────────────────────────────────────────────────

def _seitenaeste(stift, achse, farbe, G, rnd, anteile, laenge=0.15):
    """Kurze Seitentriebe. KURZ ist wesentlich — bei der Eiche ragten sie
    beim ersten Versuch als duenne Striche ueber das Laub hinaus und
    lasen sich als Spiesse."""
    aeste = []
    for anteil, seite in anteile:
        idx = int(anteil * (len(achse) - 1))
        ax, ay = achse[idx]
        lg = G * (laenge + 0.05 * rnd.random())
        winkel = seite * (0.55 + 0.35 * rnd.random())
        ex = ax + math.sin(winkel) * lg
        ey = ay - math.cos(winkel) * lg * 0.75
        stift.line([(ax, ay), (ex, ey)], fill=farbe + (255,),
                   width=max(1, int(round(G * 0.011))))
        aeste.append(((ax, ay), (ex, ey)))
    return aeste


def _blatt_stift(stift, profil, G, rnd):
    """Liefert eine Funktion, die ein einzelnes Blatt setzt."""
    form = profil['blatt']
    dunkel, hell = profil['dunkel'], profil['hell']
    schlank_m, schlank_v = profil['schlankheit']
    silber = profil.get('silber', 0.0)

    def setzen(x, y, richtung, groesse):
        laenge = G * groesse
        breite = laenge * (schlank_m + schlank_v * (rnd.random() * 2 - 1))
        umriss = gedreht(form(laenge, breite, rnd), richtung, x, y)
        if silber and rnd.random() < silber:
            # Die gekippte Blattunterseite: heller als jeder Oberseitenton,
            # aber nicht weiss. Mit (232,234,222) sassen leuchtende Flecken
            # in der Karte, die im Wald wie Lichtloecher lesen.
            farbe = mischen(hell, (196, 204, 184), 0.35 + 0.3 * rnd.random())
        else:
            farbe = mischen(dunkel, hell, rnd.random() ** 1.4)
        stift.polygon(umriss, fill=farbe + (255,))
        # Mittelrippe: gibt dem Blatt bei kleiner Darstellung ueberhaupt
        # erst eine Richtung.
        spitze = (x + math.sin(richtung) * laenge * 0.92,
                  y - math.cos(richtung) * laenge * 0.92)
        stift.line([(x, y), spitze], fill=mischen(farbe, dunkel, 0.5) + (255,),
                   width=max(1, int(round(G * 0.008))))
    return setzen


def _beerendolde(stift, x, y, r, profil, rnd, anzahl=14):
    """Eine Dolde aus kleinen Kugeln, von oben nach unten gezeichnet.

    Der Glanzpunkt sitzt oben links und ist der einzige Grund, warum die
    Beeren bei 128 Pixeln nicht als Loecher gelesen werden.
    """
    beere, glanz = profil['beeren'], profil['beeren_glanz']
    for _ in range(anzahl):
        w = rnd.random() * math.tau
        d = r * math.sqrt(rnd.random())
        bx, by = x + math.cos(w) * d, y + math.sin(w) * d * 0.75
        rr = r * (0.20 + 0.10 * rnd.random())
        stift.ellipse([bx - rr, by - rr, bx + rr, by + rr], fill=beere + (255,))
        stift.ellipse([bx - rr * 0.4, by - rr * 0.5,
                       bx + rr * 0.1, by - rr * 0.05], fill=glanz + (255,))


def _einzelbeeren(stift, punkte, profil, rnd, wahrscheinlichkeit, groesse):
    """Beeren, die EINZELN am Trieb sitzen — Schlehe, Heidelbeere.

    Anders als `_beerendolde`: Nicht jede Art traegt ihre Fruechte in
    Trauben. Eine Schlehe sitzt einzeln in der Blattachsel, und genau
    daran erkennt man sie von der Dolde des Holunders.

    Der Reif auf der Schlehe ist der Grund fuer den zweiten, helleren
    Kreis: Ohne ihn wird die Frucht bei 128 Pixeln als Loch gelesen.
    """
    beere, glanz = profil['beeren'], profil['beeren_glanz']
    for k, (x, y) in enumerate(punkte):
        if rnd.random() > wahrscheinlichkeit:
            continue
        # SEITLICH versetzt, abwechselnd links und rechts. Direkt auf der
        # Triebachse gesetzt ueberlappen sich die Fruechte zu einem
        # senkrechten blauen Balken — die Karte sah aus wie eine
        # Perlenkette, nicht wie ein Fruchtstand.
        r = groesse * (0.8 + 0.4 * rnd.random())
        seite = 1 if k % 2 == 0 else -1
        bx = x + seite * groesse * (1.6 + 1.4 * rnd.random())
        by = y + groesse * (0.4 + 0.8 * rnd.random())
        stift.ellipse([bx - r, by - r, bx + r, by + r], fill=beere + (255,))
        stift.ellipse([bx - r * 0.55, by - r * 0.65,
                       bx - r * 0.05, by - r * 0.15], fill=glanz + (255,))


def _bluetenaehre(stift, achse, profil, rnd, G, von=0.45):
    """Endstaendige Bluetenaehre — Heidekraut, Ginster.

    Kleine Farbtupfen entlang des oberen Triebstuecks, jeder mit einem
    helleren Kern. Zwei Toene, weil eine Aehre aus offenen und noch
    geschlossenen Blueten besteht; ein einziger Ton liest sich als
    gemalter Streifen.
    """
    hell, dunkel = profil['bluete_hell'], profil['bluete_dunkel']
    start = int(von * (len(achse) - 1))
    for i in range(start, len(achse)):
        x, y = achse[i]
        for _ in range(profil.get('bluetendichte', 3)):
            bx = x + (rnd.random() - 0.5) * G * 0.085
            by = y + (rnd.random() - 0.5) * G * 0.055
            r = G * (0.017 + 0.013 * rnd.random())
            ton = mischen(dunkel, hell, rnd.random())
            stift.ellipse([bx - r, by - r, bx + r, by + r], fill=ton + (255,))
            stift.ellipse([bx - r * 0.35, by - r * 0.35,
                           bx + r * 0.25, by + r * 0.25],
                          fill=mischen(ton, (255, 250, 230), 0.45) + (255,))


def laubkarte_aehre(profil, seed):
    """Rutenkarte mit Blueten — Heidekraut, Ginster.

    Diese beiden Arten leben nicht vom Laub: Heidekraut traegt
    schuppenfoermige Blaettchen von wenigen Millimetern, Ginster ist fast
    blattlos und betreibt Photosynthese ueber die gruenen Ruten. Was man
    von ihnen sieht, ist die Bluete. Die Karte ist deshalb umgekehrt
    aufgebaut wie die anderen — dichte schmale Triebe, kleines Laub, und
    oben die Farbe.
    """
    rnd = random.Random(seed)
    G = BLATT_GROESSE
    grund = mischen(profil['dunkel'], profil['hell'], 0.5)
    bild = Image.new('RGBA', (G, G), grund + (0,))
    stift = ImageDraw.Draw(bild)

    setzen = _blatt_stift(stift, profil, G, rnd)
    gr_m, gr_v = profil['blattgroesse']

    # Mehrere aufrechte Ruten nebeneinander statt eines Zweiges: Bei
    # einem einzelnen Trieb bliebe die Karte fast leer, weil weder
    # Blaetter noch Blueten Flaeche machen.
    ruten = profil.get('ruten', 3)
    for k in range(ruten):
        versatz = (k - (ruten - 1) / 2) * G * 0.19
        achse = [(x + versatz + math.sin(k * 2.1) * G * 0.03, y)
                 for x, y in _achse_lib(G, rnd, bogen=0.045, hoehe=0.84)]
        _achse_zeichnen_lib(stift, achse, profil['stiel'], G,
                        staerke=0.012, verjuengung=0.5)
        for i in range(1, len(achse)):
            x, y = achse[i]
            for seite in (-1, 1):
                if rnd.random() < 0.35:
                    continue
                setzen(x, y, seite * (1.0 + 0.4 * rnd.random()),
                       gr_m + gr_v * rnd.random())
        _bluetenaehre(stift, achse, profil, rnd, G,
                      von=profil.get('bluete_ab', 0.45))

    return _abschliessen_lib(bild, grund, G)


def laubkarte_wechsel(profil, seed):
    """Wechselstaendig beblaetterter Zweig — Hasel, Weide, Brombeere."""
    rnd = random.Random(seed)
    G = BLATT_GROESSE
    grund = mischen(profil['dunkel'], profil['hell'], 0.5)
    bild = Image.new('RGBA', (G, G), grund + (0,))
    stift = ImageDraw.Draw(bild)

    # 0.80 statt der 0.88 der Eiche: Die Buschkarten sind halb so gross,
    # ein Blatt nimmt darauf anteilig mehr Platz ein. Reicht die Achse
    # hoeher, schneidet der Bildrand die Spitzenblaetter gerade ab — und
    # eine gerade Kante ist auf einer Cutout-Karte sofort zu sehen.
    achse = _achse_lib(G, rnd, hoehe=0.80)
    _achse_zeichnen_lib(stift, achse, profil['stiel'], G)
    aeste = _seitenaeste(stift, achse, profil['stiel'], G, rnd,
                         ((0.30, -1), (0.55, 1), (0.76, -1)))

    if profil.get('stacheln'):
        # Stacheln auf die Ranke, bevor das Laub kommt — sie sitzen am
        # Holz, nicht obenauf.
        for i in range(2, len(achse) - 1, 2):
            x, y = achse[i]
            seite = 1 if i % 4 == 0 else -1
            stift.polygon([(x, y),
                           (x + seite * G * 0.035, y + G * 0.030),
                           (x + seite * G * 0.006, y + G * 0.012)],
                          fill=profil['stiel'] + (255,))

    setzen = _blatt_stift(stift, profil, G, rnd)
    gr_m, gr_v = profil['blattgroesse']
    luecken = profil['luecken']

    for i in range(3, len(achse) - 1):
        if rnd.random() < luecken:
            continue
        x, y = achse[i]
        seite = 1 if i % 2 == 0 else -1
        setzen(x, y, seite * (0.80 + 0.55 * rnd.random()), gr_m + gr_v * rnd.random())

    # An jedem Seitenaestchen ein Buendel bis ueber die Spitze, sonst
    # schaut das nackte Aestchen unter dem Laub hervor.
    for (ax, ay), (ex, ey) in aeste:
        for k in range(3):
            t = 0.55 + 0.30 * k
            x, y = ax + (ex - ax) * t, ay + (ey - ay) * t
            richtung = math.atan2(ex - ax, ay - ey) + (k - 1) * 0.6
            setzen(x, y, richtung, (gr_m + gr_v * rnd.random()) * 0.85)

    # Spitze besetzen — sonst wirkt der Zweig gekoepft.
    for k in range(3):
        x, y = achse[-1]
        setzen(x + (k - 1) * G * 0.06, y + G * 0.04, (k - 1) * 0.8,
               (gr_m + gr_v * rnd.random()) * 0.9)

    if profil.get('beeren_einzeln'):
        # In den Blattachseln entlang des ganzen Triebs, nicht in einer
        # Traube am Ende — das ist der Unterschied zwischen einer Schlehe
        # und einem Holunder.
        _einzelbeeren(stift, achse[2:], profil, rnd,
                      profil['beeren_einzeln'], G * profil.get('beerengroesse', 0.030))
    elif profil.get('beeren'):
        for _ in range(profil.get('beeren_dolden', 1)):
            (ax, ay), (ex, ey) = aeste[rnd.randrange(len(aeste))]
            _beerendolde(stift, ex, ey, G * 0.075, profil, rnd, anzahl=9)

    return _abschliessen_lib(bild, grund, G)


def laubkarte_fieder(profil, seed):
    """Gefiedertes Blatt — Holunder. Statt einzelner Blaetter sitzen an
    der Achse ganze Fiederblaetter aus 5 bis 7 Blaettchen."""
    rnd = random.Random(seed)
    G = BLATT_GROESSE
    grund = mischen(profil['dunkel'], profil['hell'], 0.5)
    bild = Image.new('RGBA', (G, G), grund + (0,))
    stift = ImageDraw.Draw(bild)

    achse = _achse_lib(G, rnd, bogen=0.035, hoehe=0.78)
    _achse_zeichnen_lib(stift, achse, profil['stiel'], G, staerke=0.024)
    setzen = _blatt_stift(stift, profil, G, rnd)
    gr_m, gr_v = profil['blattgroesse']
    paar_min, paar_max = profil['fiederpaare']

    def fiederblatt(x, y, richtung, groesse):
        """Eine Blattachse mit gegenstaendigen Blaettchen und Endblaettchen."""
        paare = rnd.randint(paar_min, paar_max)
        # Die Spindel muss KUERZER sein als die Blaettchen sie decken:
        # zwei Paare sitzen bei einem und zwei Dritteln, das Endblaettchen
        # ragt darueber hinaus. Mit dem Faktor 1.3+0.5*paare stand das
        # letzte Drittel nackt im Bild.
        # Die Spindel bleibt KUERZER als ein Blaettchen lang ist, sonst
        # steht zwischen den Ansatzstellen nacktes Stielstueck im Bild.
        # Das war beim ersten Versuch der auffaelligste Fehler der Karte.
        spindel = G * groesse * (0.35 + 0.35 * paare)
        ex = x + math.sin(richtung) * spindel
        ey = y - math.cos(richtung) * spindel
        stift.line([(x, y), (ex, ey)], fill=profil['stiel'] + (255,),
                   width=max(1, int(round(G * 0.006))))
        for k in range(paare):
            t = (k + 1) / (paare + 1)
            px, py = x + (ex - x) * t, y + (ey - y) * t
            for seite in (-1, 1):
                # Flacher abgespreizt (0.62 statt 0.85 rad): steil
                # abstehende Blaettchen lassen die Spindel frei.
                setzen(px, py, richtung + seite * (0.62 + 0.22 * rnd.random()),
                       groesse * (0.85 + 0.25 * rnd.random()))
        setzen(ex, ey, richtung, groesse * 1.1)

    for i in range(3, len(achse) - 1, 5):
        x, y = achse[i]
        seite = 1 if (i // 5) % 2 == 0 else -1
        fiederblatt(x, y, seite * (0.75 + 0.35 * rnd.random()),
                    gr_m + gr_v * rnd.random())
    fiederblatt(*achse[-1], 0.0, gr_m)

    # Die Dolde sitzt am Ende des Triebs, wie in der Natur — und dort
    # faellt sie vor dem Laub auf.
    ax, ay = achse[-1]
    _beerendolde(stift, ax + G * 0.02, ay - G * 0.02, G * 0.115, profil, rnd,
                 anzahl=22)
    return _abschliessen_lib(bild, grund, G)


def laubkarte_nadeln(profil, seed):
    """Nadelzweig — Wacholder. Dreierquirle kurzer, steifer Nadeln.

    Die Nadeln werden als schmale Dreiecke gezeichnet, nicht als Linien:
    eine Linie hat ueber ihre ganze Laenge dieselbe Breite und liest sich
    als Borste; eine Wacholdernadel ist am Ansatz breit und laeuft spitz
    aus. Der helle Streifen auf der Oberseite ist das Kennzeichen der Art.
    """
    rnd = random.Random(seed)
    G = BLATT_GROESSE
    grund = mischen(profil['dunkel'], profil['hell'], 0.5)
    bild = Image.new('RGBA', (G, G), grund + (0,))
    stift = ImageDraw.Draw(bild)

    haupt = _achse_lib(G, rnd, bogen=0.03, hoehe=0.90)
    _achse_zeichnen_lib(stift, haupt, profil['stiel'], G, staerke=0.016)

    zweige = [haupt]
    # Lange, flach abstehende Seitenzweige. Mit 0.20 Laenge und 30° vom
    # Stamm nutzte die Karte nur ein Drittel ihrer Breite — bei 75 %
    # Alpha-Loechern ist das die Haelfte der Textur verschenkt.
    for anteil, seite in ((0.18, -1), (0.38, 1), (0.56, -1), (0.74, 1)):
        idx = int(anteil * (len(haupt) - 1))
        ax, ay = haupt[idx]
        lg = G * (0.30 + 0.13 * rnd.random())
        winkel = seite * (0.80 + 0.30 * rnd.random())
        ex = ax + math.sin(winkel) * lg
        ey = ay - math.cos(winkel) * lg
        stift.line([(ax, ay), (ex, ey)], fill=profil['stiel'] + (255,),
                   width=max(1, int(round(G * 0.010))))
        zweige.append([(ax + (ex - ax) * t / 8, ay + (ey - ay) * t / 8)
                       for t in range(9)])

    def nadel(x, y, richtung, laenge):
        breite = laenge * 0.17
        spitze = (x + math.sin(richtung) * laenge, y - math.cos(richtung) * laenge)
        quer = (math.cos(richtung) * breite, math.sin(richtung) * breite)
        farbe = mischen(profil['dunkel'], profil['hell'], rnd.random() ** 1.2)
        stift.polygon([(x + quer[0], y + quer[1]), spitze,
                       (x - quer[0], y - quer[1])], fill=farbe + (255,))
        # Heller Mittelstreifen. Ohne ihn wird die Krone eine dunkle
        # Masse — bei Wacholder ist gerade die Aufhellung charakteristisch.
        stift.line([(x, y), (x + (spitze[0] - x) * 0.8,
                             y + (spitze[1] - y) * 0.8)],
                   fill=mischen(farbe, (206, 216, 204), 0.55) + (255,),
                   width=1)

    for zweig in zweige:
        laenge_ab = 1.0 if zweig is haupt else 0.78
        for i in range(1, len(zweig)):
            x, y = zweig[i]
            vx, vy = x - zweig[i - 1][0], y - zweig[i - 1][1]
            achswinkel = math.atan2(vx, -vy)
            # Dreierquirl: drei Nadeln je Ansatzstelle, gegeneinander
            # verdreht. Von der Seite gesehen ergibt das den stachligen
            # Umriss, an dem man Wacholder erkennt.
            for k in range(3):
                ab = (k - 1) * (0.95 + 0.25 * rnd.random())
                nadel(x, y, achswinkel + ab,
                      G * laenge_ab * (0.115 + 0.045 * rnd.random()))

    return _abschliessen_lib(bild, grund, G)


LAUBKARTEN = {
    'wechsel': laubkarte_wechsel,
    'fieder': laubkarte_fieder,
    'nadeln': laubkarte_nadeln,
    'aehre': laubkarte_aehre,
}


# ── Rinde ────────────────────────────────────────────────────────────

def rinde_furche(profil, seed):
    """Laengsrissige Rinde — Holunder (korkig), Wacholder (faserig).

    In y wenige Zellen, in x viele: dadurch werden die Strukturen
    senkrecht langgezogen. Zwei Furchensysteme werden per MINIMUM
    verrechnet, damit jede Furche erhalten bleibt — ein Mittelwert wuerde
    sie gegenseitig auffuellen und alles verwaschen.
    """
    G = RINDE_GROESSE
    rnd = np.random.default_rng(seed)
    faser = profil.get('faser', False)

    def f(zy, zx, stufen, schaerfe):
        return _furchen(G, G, zy, zx, stufen, schaerfe, rnd)

    if faser:
        # Wacholder blaettert in langen schmalen Streifen ab: sehr viele
        # Zellen in x, sehr wenige in y, und eine scharfe Kennlinie.
        muster = np.minimum(f(1, 14, 3, 0.30), f(2, 26, 2, 0.45))
    else:
        muster = np.minimum(f(2, 8, 3, 0.45), f(3, 16, 3, 0.55))

    muster = np.clip(muster * (0.82 + 0.18 * oktaven(G, G, 10, 34, 2, rnd)), 0, 1)
    if not faser:
        # Querrisse: eine reine Senkrechtstruktur liest sich als
        # Kabelstrang. Als Minimum, damit die Risse durchschneiden.
        riss = np.clip(np.abs(oktaven(G, G, 22, 4, 2, rnd) - 0.5) * 2.0, 0, 1) ** 0.32
        muster = np.minimum(muster, 0.32 + 0.68 * riss)
    return _einfaerben(normiert(muster), profil)


def rinde_glatt(profil, seed):
    """Glatte Rinde mit waagerechten Lentizellen — Hasel, Weide.

    Der Grund ist weiches Rauschen ohne Furchen. Darauf liegen die hellen
    Korkporen als kurze waagerechte Striche. Sie werden per Modulo ueber
    den rechten Rand hinaus fortgesetzt, damit die Textur weiter kachelt —
    ein Strich, der am Rand abbricht, ergibt beim Wiederholen eine Naht.
    """
    G = RINDE_GROESSE
    rnd = np.random.default_rng(seed)

    muster = normiert(oktaven(G, G, 6, 4, 3, rnd))
    muster = 0.42 + 0.58 * muster            # flacher Kontrast: glatt
    # Ein Hauch senkrechter Struktur, damit der Trieb eine Richtung hat.
    muster *= 0.90 + 0.10 * oktaven(G, G, 2, 12, 2, rnd)
    bild = _einfaerben(normiert(muster) * 0.85 + 0.15, profil)

    stift = ImageDraw.Draw(bild)
    farbe = profil['lentizellen']
    # Gestreut, nicht gereiht: Bei einem Strich je Zeile las sich die
    # Rinde als Linienraster. Die Poren sitzen zwar waagerecht, aber
    # unregelmaessig verteilt — deshalb drei Anlaeufe je Zeilenband mit
    # voller Streuung in y.
    anzahl = 70
    for k in range(anzahl):
        y = rnd.random() * G
        x = rnd.random() * G
        laenge = G * (0.05 + 0.09 * rnd.random())
        dicke = max(1, int(round(G * (0.008 + 0.008 * rnd.random()))))
        t = float(rnd.random())
        ton = mischen(profil['rinde_hoch'], farbe, 0.5 + 0.5 * t)
        # Zweimal zeichnen, einmal um G versetzt: was rechts hinauslaeuft,
        # kommt links wieder herein.
        for versatz in (0.0, -G):
            stift.line([(x + versatz, y), (x + versatz + laenge, y)],
                       fill=ton + (255,), width=dicke)
    return bild


def _einfaerben(muster, profil):
    G = muster.shape[0]
    tief = np.array(profil['rinde_tief'], dtype=float)
    hoch = np.array(profil['rinde_hoch'], dtype=float)
    rgb = tief[None, None, :] + (hoch - tief)[None, None, :] * muster[..., None]
    bild = np.zeros((G, G, 4), dtype=np.uint8)
    bild[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    bild[..., 3] = 255              # Rinde ist deckend, kein Cutout
    return Image.fromarray(bild, 'RGBA')


RINDEN = {'furche': rinde_furche, 'glatt': rinde_glatt}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--ziel', default='assets/textures')
    p.add_argument('--art', default='alle', choices=['alle'] + list(ARTEN))
    p.add_argument('--seed', type=int, default=7)
    args = p.parse_args()

    wurzel = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ziel = os.path.join(wurzel, args.ziel)
    os.makedirs(ziel, exist_ok=True)

    arten = list(ARTEN) if args.art == 'alle' else [args.art]
    for i, name in enumerate(arten):
        profil = ARTEN[name]
        laub = LAUBKARTEN[profil['laub']](profil, args.seed + i * 13)
        rinde = RINDEN[profil['rinde_art']](profil, args.seed + i * 29)
        for datei, bild in ((f'{name}_leaf.png', laub), (f'{name}_bark.png', rinde)):
            pfad = os.path.join(ziel, datei)
            bild.save(pfad)
            a = np.array(bild)[..., 3]
            print(f'FERTIG {pfad} — {bild.size[0]}x{bild.size[1]}, '
                  f'{100.0 * (a < 128).mean():.0f} % Alpha-Loecher')


main()
