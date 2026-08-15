"""
Geteilte Bausteine fuer prozedurale Pflanzenkarten.

    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
    from karten import mischen, gedreht, umriss, achse, abschliessen

Benutzt von `tools/busch-texturen.py` (Straeucher) und
`tools/blumen-texturen.py` (Blumen und Unkraut). Beide zeichnen dasselbe
Grundbild — eine ganze Pflanze oder einen Zweig, deren Stiel am UNTEREN
Bildrand herauslaeuft — und unterscheiden sich erst in dem, was oben
darauf sitzt.

── Die zwei Regeln, die hier eingebacken sind ───────────────────────
1. Der Stiel muss bei v=0 austreten. Die Generatoren suchen im Modell
   die Kante am Holz und legen sie dorthin; sitzt der Stiel woanders,
   zeigen die gemalten Aestchen ins Leere.
2. Der RGB-Hintergrund traegt die mittlere Pflanzenfarbe bei Alpha 0,
   nicht transparentes Schwarz. Mipmaps mitteln ueber RGB *und* Alpha —
   hinter den Blaettern darf kein Nichts liegen, sonst wird der Bewuchs
   mit der Entfernung dunkel. Derselbe Fallstrick steht in
   `tools/gen-grass-texture.py`.
"""
import math

from PIL import Image, ImageDraw, ImageFilter  # noqa: F401  (Draw fuer Aufrufer)


def mischen(a, b, t):
    """Farbe zwischen a und b, t von 0 bis 1."""
    return tuple(int(round(a[k] + (b[k] - a[k]) * t)) for k in range(3))


def gedreht(punkte, winkel, ox, oy):
    """Dreht einen Umriss um seinen Ansatzpunkt.

    Das y der Bildkoordinaten laeuft nach UNTEN, die Blattlaenge im
    Umriss nach oben — daher das Minus. Winkel 0 heisst: Blatt zeigt
    senkrecht nach oben, positiver Winkel dreht nach rechts.

    ── Das Vorzeichen ist nicht beliebig ────────────────────────────
    Es muss zu der Spitzenrechnung der Aufrufer passen
    (`x + sin(winkel) * laenge`). Stand hier `- y * s`, zeigte das
    Blattpolygon nach der einen und die Mittelrippe nach der anderen
    Seite; wo das Laub luftig ist, blieben freie Rippen als duenne
    Striche stehen. Genau so lag es in `tools/eiche-texturen.py`, bis es
    an den Buschkarten auffiel.
    """
    s, c = math.sin(winkel), math.cos(winkel)
    return [(ox + x * c + y * s, oy + x * s - y * c) for x, y in punkte]


def umriss(halbrand):
    """Halber Rand -> geschlossenes Polygon (rechts hoch, links runter)."""
    return halbrand + [(-x, y) for x, y in reversed(halbrand)]


def achse(G, rnd, bogen=0.05, hoehe=0.88, punkte=21):
    """Der Stiel, der unten aus dem Bild laeuft (y=G) und nach oben zieht.

    Ein gerader Strich liest sich als Draht, deshalb der leichte Bogen.
    """
    fuss_x = G * 0.5
    kopf_x = G * (0.40 + 0.20 * rnd.random())
    bahn = []
    for i in range(punkte):
        t = i / (punkte - 1)
        x = fuss_x + (kopf_x - fuss_x) * t + math.sin(t * math.pi) * G * bogen
        bahn.append((x, G * (1.0 - hoehe * t)))
    return bahn


def achse_zeichnen(stift, bahn, farbe, G, staerke=0.020, verjuengung=0.65):
    """Zeichnet einen Stiel, der nach oben duenner wird."""
    for i in range(len(bahn) - 1):
        t = i / (len(bahn) - 1)
        stift.line([bahn[i], bahn[i + 1]], fill=farbe + (255,),
                   width=max(1, int(round(G * staerke * (1 - verjuengung * t)))))


def abschliessen(bild, grund, G, weichzeichnung=0.5):
    """Kanten weichzeichnen, RGB der unsichtbaren Flaechen festhalten.

    Der Weichzeichner nimmt der Cutout-Kante das Flimmern. Danach werden
    die durchsichtigen Bereiche wieder auf die Grundfarbe gezwungen —
    sonst haette der Filter Hintergrund in die Blattraender getragen und
    genau den Mipmap-Fehler zurueckgebracht, den die Grundfarbe
    verhindern soll.
    """
    weich = bild.filter(ImageFilter.GaussianBlur(weichzeichnung))
    r, g, b, a = weich.split()
    grund_bild = Image.new('RGB', (G, G), grund)
    sichtbar = Image.merge('RGB', (r, g, b))
    maske = a.point(lambda v: 255 if v > 8 else 0)
    fertig = Image.composite(sichtbar, grund_bild, maske)
    return Image.merge('RGBA', fertig.split() + (a,))
