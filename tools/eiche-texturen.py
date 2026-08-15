#!/usr/bin/env python3
"""
Erzeugt die beiden Texturen der Eiche — Laubkarte und Rinde.

    python3 tools/eiche-texturen.py [--ziel assets/textures]

── Warum diese Datei existiert ──────────────────────────────────────
Alle bisherigen Baumtexturen stammen aus Valheim, mit AssetRipper aus
den Unity-Bundles gezogen. Die Eiche kommt ohne solches Material aus:
Beide Karten werden hier prozedural gezeichnet und sind damit frei von
fremden Rechten. Der Rest der Kette bleibt unveraendert — die Bilder
haben denselben Aufbau, den `tools/baum-generieren.py` erwartet.

── Aufbau der Laubkarte ─────────────────────────────────────────────
Wie `birch_leaf.png` ist es KEIN einzelnes Blatt, sondern ein ganzer
belaubter Zweig, dessen Stiel am UNTEREN Bildrand herauslaeuft. Das ist
Bedingung, nicht Geschmack: `laub_karten_variieren` sucht die Kante am
Holz und legt sie auf v=0 — dort muss der Stiel sitzen, sonst zeigen die
gemalten Aestchen ins Leere.

Die Blattform ist parametrisch statt gemalt. Ein Eichenblatt ist ueber
seine Laenge unterschiedlich breit (breiteste Stelle im oberen Drittel)
und traegt gerundete Lappen; beides laesst sich als Produkt zweier
Funktionen schreiben, und nur so bekommt jedes Blatt eine eigene Form,
ohne dass ein Stempelmuster entsteht.

── Warum der Hintergrund nicht transparent-schwarz ist ──────────────
Derselbe Fallstrick wie bei `gen-grass-texture.py`: Mipmaps mitteln ueber
RGB *und* Alpha. Liegt hinter den Blaettern schwarzes Nichts, mischt sich
das Laub mit zunehmender Entfernung dunkel. Deshalb traegt die ganze
Flaeche die mittlere Blattfarbe, sichtbar wird sie nur ueber Alpha.

── Aufbau der Rinde ─────────────────────────────────────────────────
Eichenrinde ist grob laengsrissig. Gezeichnet wird sie aus periodischem
Wertrauschen, in y stark gestreckt, damit die Furchen senkrecht laufen.
Periodisch ist wesentlich: `uv_auf_rechteck` kachelt die Rinde ueber die
Stammlaenge (`alt[1] % 1.0`), eine nicht kachelnde Textur zeigt dort
einen Ring.
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

BLATT_GROESSE = 256
RINDE_GROESSE = 256

# Sommerliches Eichenlaub: satt und eher dunkel, mit gelbgruenen Spitzen.
BLATT_DUNKEL = (46, 74, 34)
BLATT_HELL = (122, 156, 68)
STIEL_FARBE = (94, 78, 56)

# Eichenrinde: graubraun, Furchen deutlich dunkler als die Rippen.
RINDE_TIEF = (46, 38, 31)
RINDE_HOCH = (137, 124, 106)


# ── Laubkarte ────────────────────────────────────────────────────────

def eichenblatt(laenge, breite, lappen, rnd):
    """Umriss eines Eichenblatts als Punktliste um die eigene Achse.

    Zwei Faktoren: `grund` gibt die Silhouette (schmal am Stiel, breiteste
    Stelle im oberen Drittel), `lappung` legt die Rundlappen darueber. Der
    Exponent 0.75 auf t verschiebt die breiteste Stelle nach oben — mit
    einem reinen Sinus saesse sie in der Mitte und das Blatt saehe aus wie
    ein Weidenblatt.
    """
    schritte = 44
    rand = []
    for i in range(schritte + 1):
        t = i / schritte
        grund = math.sin(math.pi * t ** 0.75) ** 0.65
        lappung = 1.0 + 0.34 * math.sin(lappen * math.pi * t - math.pi / 2)
        w = 0.5 * breite * grund * max(0.05, lappung)
        rand.append((w, t * laenge))
    return [(x, y) for x, y in rand] + [(-x, y) for x, y in reversed(rand)]


def gedreht(punkte, winkel, ox, oy):
    """Winkel 0 zeigt nach oben, positiver Winkel dreht nach rechts.

    Das Vorzeichen vor `y * s` muss zu der Spitzenrechnung in
    `blatt_setzen` passen (`x + sin*laenge`). Stand hier `- y * s`,
    zeigte das Blattpolygon nach der einen und die Mittelrippe nach der
    anderen Seite; wo das Laub luftig ist, blieben freie Rippen als
    duenne Striche stehen. Aufgefallen ist es an den Buschkarten
    (`tools/busch-texturen.py`), die dieselbe Funktion benutzen.
    """
    s, c = math.sin(winkel), math.cos(winkel)
    return [(ox + x * c + y * s, oy + x * s - y * c) for x, y in punkte]


def mischen(a, b, t):
    return tuple(int(round(a[k] + (b[k] - a[k]) * t)) for k in range(3))


def laubkarte(seed):
    rnd = random.Random(seed)
    G = BLATT_GROESSE
    grund = mischen(BLATT_DUNKEL, BLATT_HELL, 0.5)
    bild = Image.new('RGBA', (G, G), grund + (0,))
    stift = ImageDraw.Draw(bild)

    # ── Zweiggeruest ────────────────────────────────────────────────
    # Der Stiel tritt UNTEN aus dem Bild (y=G) und laeuft nach oben. Ein
    # leichter Bogen genuegt; ein gerader Strich liest sich als Draht.
    fuss_x = G * 0.5
    kopf_x = G * (0.42 + 0.16 * rnd.random())
    achse = []
    for i in range(21):
        t = i / 20
        x = fuss_x + (kopf_x - fuss_x) * t + math.sin(t * math.pi) * G * 0.05
        y = G * (1.0 - 0.86 * t)
        achse.append((x, y))
    for i in range(len(achse) - 1):
        t = i / (len(achse) - 1)
        stift.line([achse[i], achse[i + 1]],
                   fill=STIEL_FARBE + (255,),
                   width=max(1, int(round(G * 0.020 * (1 - 0.65 * t)))))

    # Seitenaestchen — sie tragen die aeusseren Blattgruppen und machen
    # aus einem Stiel mit Blaettern einen Zweig. Sie bleiben KURZ: Beim
    # ersten Versuch ragten sie als duenne Striche ueber das Laub hinaus
    # und lasen sich als Spiesse, nicht als Zweig.
    aeste = []
    for anteil, seite in ((0.30, -1), (0.52, 1), (0.72, -1)):
        idx = int(anteil * (len(achse) - 1))
        ax, ay = achse[idx]
        laenge = G * (0.13 + 0.05 * rnd.random())
        winkel = seite * (0.55 + 0.35 * rnd.random())
        ex = ax + math.sin(winkel) * laenge
        ey = ay - math.cos(winkel) * laenge * 0.75
        stift.line([(ax, ay), (ex, ey)], fill=STIEL_FARBE + (255,),
                   width=max(1, int(round(G * 0.011))))
        aeste.append(((ax, ay), (ex, ey)))

    # ── Blaetter ────────────────────────────────────────────────────
    def blatt_setzen(x, y, richtung, groesse):
        laenge = G * groesse
        breite = laenge * (0.52 + 0.12 * rnd.random())
        form = eichenblatt(laenge, breite, rnd.choice((5, 7, 7, 9)), rnd)
        umriss = gedreht(form, richtung, x, y)
        # Blattfarbe streuen: ohne Streuung liest sich die Krone im Spiel
        # als eine einzige Flaeche statt als viele Blaetter.
        farbe = mischen(BLATT_DUNKEL, BLATT_HELL, rnd.random() ** 1.4)
        stift.polygon(umriss, fill=farbe + (255,))
        # Mittelrippe etwas dunkler — sie gibt dem Blatt bei kleiner
        # Darstellung ueberhaupt erst eine Richtung.
        spitze = (x + math.sin(richtung) * laenge * 0.92,
                  y - math.cos(richtung) * laenge * 0.92)
        stift.line([(x, y), spitze], fill=mischen(farbe, BLATT_DUNKEL, 0.55) + (255,),
                   width=max(1, int(round(G * 0.006))))

    # Wechselstaendig am Hauptstiel. Die Karte darf ruhig dicht sein — das
    # Original der Birke kommt auf 70 % Alpha, ein zu luftiger Zweig laesst
    # die ganze Krone durchsichtig wirken.
    for i in range(3, len(achse) - 1):
        if rnd.random() < 0.30:
            continue
        x, y = achse[i]
        seite = 1 if i % 2 == 0 else -1
        blatt_setzen(x, y, seite * (0.85 + 0.5 * rnd.random()),
                     0.32 + 0.13 * rnd.random())

    # An den Seitenaestchen ein Buendel, das bis ueber die Spitze reicht —
    # sonst schaut das nackte Aestchen unter dem Laub hervor.
    for (ax, ay), (ex, ey) in aeste:
        for k in range(3):
            t = 0.55 + 0.30 * k
            x = ax + (ex - ax) * t
            y = ay + (ey - ay) * t
            richtung = math.atan2(ex - ax, ay - ey) + (k - 1) * 0.65
            blatt_setzen(x, y, richtung, 0.27 + 0.10 * rnd.random())

    # Ein paar Blaetter an die Spitze, sonst wirkt der Zweig geköpft.
    for k in range(3):
        x, y = achse[-1]
        blatt_setzen(x + (k - 1) * G * 0.06, y + G * 0.04,
                     (k - 1) * 0.8, 0.28 + 0.07 * rnd.random())

    # Kanten leicht weichzeichnen: harte Polygonkanten flimmern im Spiel,
    # weil das Cutout genau an dieser Kante entscheidet.
    weich = bild.filter(ImageFilter.GaussianBlur(0.6))
    r, g, b, a = weich.split()
    # RGB der unsichtbaren Flaechen auf die Grundfarbe zwingen — der
    # Weichzeichner haette sonst wieder Hintergrund in die Raender getragen.
    grund_bild = Image.new('RGB', (G, G), grund)
    sichtbar = Image.merge('RGB', (r, g, b))
    maske = a.point(lambda v: 255 if v > 8 else 0)
    fertig = Image.composite(sichtbar, grund_bild, maske)
    return Image.merge('RGBA', fertig.split() + (a,))


# ── Rinde ────────────────────────────────────────────────────────────

def rindenkarte(seed):
    """Grob laengsrissige Eichenrinde, exakt kachelnd."""
    G = RINDE_GROESSE
    rnd = np.random.default_rng(seed)

    # In y viel weniger Zellen als in x: dadurch werden die Strukturen
    # senkrecht langgezogen — genau der Charakter einer Laengsrissrinde.
    def furchen(zellen_y, zellen_x, stufen, schaerfe):
        return _furchen(G, G, zellen_y, zellen_x, stufen, schaerfe, rnd)

    # Zwei Furchensysteme verschiedener Breite, per Minimum verrechnet:
    # So bleibt JEDE Furche erhalten. Ein Mittelwert wuerde sie gegenseitig
    # auffuellen und wieder alles verwaschen.
    muster = np.minimum(furchen(2, 9, 3, 0.42), furchen(3, 19, 3, 0.55))

    # Feine Koernung auf den Rippen, damit sie nicht wie lackiert wirken.
    muster = np.clip(muster * (0.80 + 0.20 * oktaven(G, G, 12, 44, 2, rnd)), 0, 1)

    # Schmale Querrisse — eine reine Senkrechtstruktur liest sich als
    # Kabelstrang. Ebenfalls als Minimum, damit die Risse durchschneiden.
    riss = np.clip(np.abs(oktaven(G, G, 26, 4, 2, rnd) - 0.5) * 2.0, 0, 1) ** 0.30
    muster = np.minimum(muster, 0.30 + 0.70 * riss)

    muster = normiert(muster)
    tief = np.array(RINDE_TIEF, dtype=float)
    hoch = np.array(RINDE_HOCH, dtype=float)
    rgb = tief[None, None, :] + (hoch - tief)[None, None, :] * muster[..., None]

    bild = np.zeros((G, G, 4), dtype=np.uint8)
    bild[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    bild[..., 3] = 255          # Rinde ist deckend, kein Cutout
    return Image.fromarray(bild, 'RGBA')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--ziel', default='assets/textures')
    p.add_argument('--seed', type=int, default=5)
    args = p.parse_args()

    wurzel = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ziel = os.path.join(wurzel, args.ziel)
    os.makedirs(ziel, exist_ok=True)

    for name, bild in (('eiche_leaf.png', laubkarte(args.seed)),
                       ('eiche_bark.png', rindenkarte(args.seed))):
        pfad = os.path.join(ziel, name)
        bild.save(pfad)
        a = np.array(bild)[..., 3]
        print(f'FERTIG {pfad} — {bild.size[0]}x{bild.size[1]}, '
              f'{100.0 * (a < 128).mean():.0f} % Alpha-Loecher')


main()
