# Erzeugt: das Höhenfeld der Fels-Frontschicht für `make-stonevault.py --stil fels`.
#
# Reine Arithmetik — dieses Modul kennt WEDER bpy NOCH bmesh. Das ist kein
# Stilwunsch, sondern der Grund, warum es prüfbar ist: `make-stonevault.py`
# läuft nur unter Blender, und was nur unter Blender läuft, misst niemand
# zweimal. So lässt sich das Feld mit blossem `python3` befragen
# (`--dump`), und `tools/elements/pruefung/fels-frontschicht.mjs` hält
# Naht, Hüllbox und Dreiecksbudget fest, bevor das erste GLB entsteht.
#
# ── Vorgeschichte: warum aus Blöcken ein Feld wurde (05.09.2026) ────────
# Der Vorgänger (`felsblock.py`, 04.09.2026) legte QUADER: unterschiedlich
# hohe Reihen, unterschiedlich breite Blöcke, gebrochene Lagerfugen. Der
# Kontaktbogen `~/.cache/wov-f-relief/kontaktbogen-fels.png` hat ihn
# widerlegt — er las sich weiter als Mauerwerk, nur unregelmässigeres:
#
#   * Ein Quader hat eine LOTRECHTE Vorderseite. Egal wie krumm seine
#     Umrisse sind, im Streiflicht steht seine Fläche flach im Licht, und
#     alle Flächen stehen gleich. Fels hat statt dessen BRUCHFLÄCHEN, die
#     verschieden geneigt sind — daher kommt die Glanz-/Schattenseite,
#     die im Bogen gefehlt hat.
#   * Die Tiefenstreuung war auf 2,5 cm gedeckelt (Endstreifen, s. u.),
#     bei 6 cm Reliefdicke also kaum zu sehen.
#   * Reihen bleiben Reihen. Auch mit welliger Lagerfuge lief durch jedes
#     Paneel ein waagerechtes Band.
#
# Deshalb steht hier jetzt kein Blockverband mehr, sondern eine
# UNTERTEILTE FLÄCHE mit deterministischer Verdrängung:
#
#   (a) BRUCHFLÄCHEN — ein 2-m-periodisches Voronoi-Feld (Zellmass 0,4 m).
#       Jede Zelle ist eine EBENE mit eigenem Grundmass und eigener
#       Neigung. Zwei Nachbarflächen treffen sich in einer Kante, nicht in
#       einer Fuge: genau das macht Fels aus.
#   (b) KLÜFTE — entlang der Voronoi-Grenzen (Abstandsdifferenz f2−f1)
#       weicht die Fläche zusätzlich zurück. Das sind die Spalten, in
#       denen der Schatten steht.
#   (c) SCHICHTUNG — ein Bänderfeld, dessen Höhenlinie mit einer
#       2-m-periodischen Welle schräg und wellig durch die Wand läuft
#       (Neigung bis rund 30 Grad). Waagerechte Lagerfugen gibt es
#       dadurch NIRGENDS.
#   (d) FEINES RAUSCHEN — zwei Oktaven Wertrauschen, rund 7 mm, damit
#       auch die einzelne Bruchfläche nicht poliert wirkt.
#
# ── Die vier Zwänge, die die Zahlen festlegen ───────────────────────────
# (1) NAHT. Alle Module stossen im 2-m-Raster aneinander, und ein Modul
#     weiss nicht, wo es steht. Das Feld ist deshalb in x GENAU 2 m
#     periodisch, und das Abtastraster (0,125 m) teilt die 2 m auf.
#     Zusätzlich liegt an jeder MODULGRENZE ein 3-cm-Randstreifen, in dem
#     das Feld auf ein variantenfreies RANDNIVEAU überblendet: dort
#     treffen sich zwei Paneele auf denselben Millimeter, auch wenn sie
#     verschiedene Varianten sind (s. `RockVaultWallB/C`). Der Übergang
#     liest sich als senkrechte Kluft zwischen zwei Felspartien — und ist
#     die einzige Stelle, an der das 2-m-Raster überhaupt sichtbar wird.
#     An einem INNEREN Anschlag (Torbogenlaibung, Anschluss der Südwand
#     im Eckmodul) wird NICHT überblendet: dahinter kommt kein Nachbar,
#     sondern die Flanke eines anderen Bauteils.
#
# (2) HÜLLBOX. `DG_RockVault` wird von `DG_StoneVault` ABGELEITET (Konzept
#     Vorhaben 3): gleiche `size`, gleiche Connectors. Kein Punkt darf
#     weiter vorstehen als das Ziegelrelief (PROT = 6 cm), und mindestens
#     einer muss es tun, sonst SCHRUMPFT die Box. Beides steht hier nicht
#     im Vertrauen auf den Zufall: `_grund()` zwingt in jeder Zellspalte
#     jeder dritten Flächenzeile ein Grundmass unter null auf
#     (`VORDERGRUND`), das die Klemme auf 0 hebt. Zwischen Boden und
#     Decke liegen vier Zeilen — in jeder Spalte steht daher Material
#     ganz vorn.
#
# (3) TIEFE. Der Rückzug ist auf `HUB` = 4,5 cm gedeckelt. Das Konzept
#     erlaubt der Spielerkapsel 10 cm; die engere Grenze ist die
#     Reliefdicke selbst (6 cm bis zur Rückplatte), von der 1,5 cm als
#     Wandstärke stehen bleiben.
#
# (4) ENDSTREIFEN. Der Nahtschluss vom 03.09.2026 legt an jedes Ende des
#     freistehenden Paneels einen Streifen. Seine Vorderseite muss HINTER
#     der tiefsten Stelle der Frontschicht liegen, sonst stünde er in
#     einem geraden Wandlauf alle 2 m als Rippe vor der Wand. Im
#     Fels-Stil ist sie deshalb um `HUB` zurückgesetzt statt um 3 cm
#     (`make-stonevault.py`, `endstreifen()`).
#
# Aufruf als Werkzeug:
#   python3 felsrelief.py --dump <lo> <hi> [--seed N] [--lage L]
#                                [--z0 A] [--z1 B] [--randluft R]
#                                [--relief-quelle <hoehenkarte.png>]
#
# The rock front layer's height field — pure arithmetic, no Blender.
import json
import math
import sys

# ── Masse, die mit make-stonevault.py übereinstimmen MÜSSEN ─────────────
GRID = 2.0
HOEHE = 3.5
PROT = 0.09           # Reliefdicke: Rückplattenfront .. Vorderkante
                      # (im Fels-Stil; make-stonevault.py setzt dieselben 0,09)

SEED = 20260905       # Vorgabe-Seed; `--seed` setzt ihn um

# ── Abtastung ───────────────────────────────────────────────────────────
# RASTER teilt GRID auf (2,0 / 0,125 = 16). Das ist die Nahtbedingung in
# Zahlen: Die Stützstelle x = +1 des einen Paneels IST die Stützstelle
# x = -1 des Nachbarn. Ein Raster, das die 2 m nicht teilt, verschöbe die
# Punkte gegeneinander, und die Naht bekäme eine Treppe.
RASTER = 0.125        # Konzept F3: 0,10 .. 0,15 m
ZEILEN = 24           # Zeilen über die Wandhöhe -> rund 0,145 m

# ── Warum die Stützstellen VERZOGEN werden ──────────────────────────────
# Ein Höhenfeld auf einem achsenparallelen Gitter hat achsenparallele
# Kanten. Jede Bruchkante, die es zeigt, läuft deshalb entweder waagerecht
# oder senkrecht, und das Auge liest daraus eine TREPPE — im dritten
# Kontaktbogen vom 05.09.2026 sah die Wand aus wie ein Stapel Stufen.
# Fels bricht diagonal.
#
# Deshalb wird jede INNERE Stützstelle in der Wandebene ausgelenkt (bis
# VERZUG · RASTER). Das Gitter bleibt topologisch ein Gitter — dieselben
# Vierecke, dieselbe Dreieckszahl —, aber seine Kanten stehen schief.
# Der RAND bleibt unverzogen: dort muss die Stützstelle des einen Moduls
# auf der des Nachbarn liegen, sonst klafft die Naht.
VERZUG = 0.36
PERIODE = GRID
ANKER = -GRID / 2

# ── Tiefen ──────────────────────────────────────────────────────────────
HUB = 0.075           # maximaler Rückzug (s. Zwang 3)
VORDERGRUND = -0.060  # Grundmass der erzwungenen Vorderflächen (s. Zwang 2)
VORDER_TAKT = 3       # jede dritte Flächenzeile je Spalte steht ganz vorn
GRUND_MIN, GRUND_MAX = -0.004, 0.036

# ── Bruchflächen ────────────────────────────────────────────────────────
# ZWEI Oktaven, und beide Zellmasse teilen die Periode (2,0 / 0,5 = 4,
# 2,0 / 0,25 = 8): grosse Platten, in die kleinere Abplatzungen gesetzt
# sind. Eine einzelne Oktave ergibt entweder eine Wand aus lauter gleich
# grossen Brocken oder eine aus lauter Krümeln.
#
# Die ZELLMASSE haben eine Untergrenze, die nichts mit dem Bild zu tun
# hat: Ein Merkmal, das schmaler ist als zwei Rasterschritte (0,25 m),
# wird von der Abtastung nicht getroffen, sondern ALIASIERT — aus einer
# feinen Struktur wird ein Pixelrauschen. Der erste Lauf dieses Moduls
# ist genau daran gescheitert (Kluftbreite 4,5 cm, Rauschwellenlänge
# 0,17 m bei 0,125/0,145 m Raster): Der Kontaktbogen zeigte kein Gestein,
# sondern ein Schachbrett aus Grautönen.
ZELLE = 1.0           # Voronoi-Zellmass der groben Oktave; NX je Periode
NX = int(round(PERIODE / ZELLE))   # 2
ZELLE2 = 0.5          # feine Oktave
NX2 = int(round(PERIODE / ZELLE2))  # 4
FEIN_ANTEIL = 0.45    # Gewicht der feinen Oktave
JITTER = 0.85         # Auslenkung des Keims innerhalb seiner Zelle
NEIGUNG_MIN, NEIGUNG_MAX = 0.020, 0.090  # Gefälle je Meter

# ── Klüfte ──────────────────────────────────────────────────────────────
# KLUFT_BREITE ist die Abstandsdifferenz f2−f1, ab der die Kluft ausläuft;
# sie entspricht ungefähr der BREITE der Kluft in Metern. Sie muss über
# zwei Rasterschritte reichen, sonst fällt sie durch die Abtastung (s. o.).
KLUFT_TIEFE = 0.030
KLUFT_BREITE = 0.30

# Schichtung
LAGE_HOEHE = 0.80     # Banddicke senkrecht zur Schichtung
LAGE_WELLE1 = 0.18    # Auslenkung der Bandhöhenlinie (2-m-periodisch)
LAGE_WELLE2 = 0.07
LAGE_STREUUNG = 0.014  # Tiefenversatz je Band
LAGE_FUGE = 0.120     # Breite der Bandfuge (>= ein Rasterschritt!)
LAGE_FUGE_TIEFE = 0.018

# Feines Rauschen — Wellenlängen weit über dem Raster (s. o.)
RAUSCH = 0.006
RAUSCH_X = 0.50
RAUSCH_Z = 0.60

# ── Randstreifen an der Modulgrenze ─────────────────────────────────────
# RAND ist die Breite des Überblendstreifens, RAND_NIVEAU sein mittlerer
# Rückzug. Beide Werte hängen NICHT von der Variante ab — das ist ihr
# ganzer Zweck: `RockVaultWall`, `...B` und `...C` treffen sich an der
# Modulgrenze auf denselben Wert und lassen sich deshalb beliebig mischen.
# RAND ist mit Absicht GRÖSSER als ein Rasterschritt (0,125 m). Bei 3 cm
# lag die Überblendung ganz in der Randspalte, und der Sprung auf den
# Innenwert geschah in EINER Zelle — im Kontaktbogen stand deshalb an
# jeder Modulgrenze eine helle Schräge. Über 1,6 Rasterschritte verteilt
# sie sich auf zwei Zellen und liest sich als Kluft statt als Kante.
# RAND_NIVEAU liegt in der MITTE des Hubs, nicht an seinem tiefen Ende:
# Je näher der Randwert am mittleren Innenwert liegt, desto weniger hat
# die Überblendung überhaupt zu überbrücken.
RAND = 0.20
# Das Randniveau liegt DICHT AN DER VORDERKANTE (0,6 .. 3,0 cm Rückzug),
# und dafür gibt es einen gemessenen Grund: Der Endstreifen des Paneels
# (`endstreifen()` in make-stonevault.py) reicht bis 3 cm hinter die
# Vorderkante. Läge das Randniveau tiefer, klaffte in der Innenecke
# zweier Paneele ein Schlitz zwischen Streifen und Fels — der Naht-Zähler
# hat davon am 05.09.2026 genau 2353 helle Pixel gemeldet, bei 4 cm
# Randniveau. Bleibt der Rand vor den 3 cm, ist die Ecke dicht (0 Pixel,
# wie im Ziegelstil), und der Streifen steht im geraden Wandlauf nirgends
# vor dem Fels des Nachbarpaneels.
RAND_NIVEAU = 0.018
RAND_STREUUNG = 0.012
RAND_LUFT = 0.010     # Abstand der Schicht zu Boden- und Deckenplatte

EPSILON = 1e-9

# ── ZWEITE QUELLE: eine gebackene Höhenkarte (05.09.2026) ──────────────
# Alles über dieser Zeile beschreibt die Quelle `voronoi` — ein Feld, das
# sich der Rechner ausdenkt. Darunter steht die Quelle `heightmap`: ein
# Feld, das GEMESSEN wurde, an einem Fels.
#
# Warum beide bleiben: `voronoi` braucht keine Datei und ist damit die
# Quelle, mit der `fels-frontschicht.mjs` und der Kit-Neubau ohne
# Bilddaten laufen. `heightmap` trägt die Handschrift eines wirklichen
# Gesteins — was kein Rauschgenerator liefert, sind die LANGEN,
# durchlaufenden Klüfte und die Tatsache, dass Bruchflächen sich um
# gemeinsame Kanten gruppieren statt gleichverteilt zu streuen.
#
# Was die Karte NICHT mitbringt und deshalb hier bleibt:
#   * Die Naht. Die Karte ist genau eine Periode (2 m) breit und endet
#     links wie rechts auf ihrem neutralen Niveau (s. `backe-hoehenkarte.py`,
#     Abschnitt „Wohin der Rand blendet"). Der eigentliche Nahtschluss
#     bleibt aber das variantenfreie `_rand_niveau` dieses Moduls — sonst
#     hinge die Dichtheit der Innenecke an einer Bilddatei.
#   * Das 0,125-m-Raster. Die Karte hat 256 Bildpunkte je Meter, das
#     Netz 8 Stützstellen. Abgetastet wird BILINEAR und zusätzlich über
#     ein Kreuz von 5 Punkten gemittelt (`_karte_wert`): ein einzelner
#     Bildpunkt je Stützstelle würde aus einer 4-cm-Kluft eine
#     Zufallszahl machen (Aliasing — derselbe Fehler, an dem die erste
#     Voronoi-Fassung gescheitert ist).
#   * Die Varianten. Die Karte ist EINE Wand. `lage` verschiebt sie
#     zyklisch in x, versetzt sie in z und spiegelt sie bei ungeradem
#     Schlüssel — dadurch tragen Korridor Ost/West und die drei
#     Wandvarianten verschiedene Ausschnitte desselben Gesteins.
#
# A second source: a baked height map instead of procedural noise.
QUELLE = "voronoi"
_KARTE = None          # (breite, hoehe, werte[0..1]) — einmal geladen


def _png_grau(pfad):
    """Ein Graustufen-PNG (8 oder 16 Bit) als (w, h, Liste in [0,1]).

    Von Hand, mit `zlib` und sonst nichts. Der Grund ist derselbe wie im
    Kopf: Dieses Modul wird von `python3` OHNE Umgebung aufgerufen (der
    Prüfer `fels-frontschicht.mjs`) UND von Blender. Eine Abhängigkeit
    auf Pillow oder numpy hiesse, dass eines der beiden Enden das Feld
    nicht mehr nachrechnen kann — und ein Höhenfeld, das nur eine Seite
    kennt, ist genau das, was `kit-neubau.mjs` verhindern soll.
    """
    import struct
    import zlib as _zlib
    with open(pfad, "rb") as f:
        roh = f.read()
    if roh[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"Keine PNG-Datei: {pfad}")
    pos = 8
    breite = hoehe = tiefe = farbtyp = None
    daten = bytearray()
    while pos + 8 <= len(roh):
        laenge = struct.unpack(">I", roh[pos:pos + 4])[0]
        typ = roh[pos + 4:pos + 8]
        inhalt = roh[pos + 8:pos + 8 + laenge]
        pos += 12 + laenge
        if typ == b"IHDR":
            breite, hoehe, tiefe, farbtyp = struct.unpack(">IIBB", inhalt[:10])
            if inhalt[10:13] != b"\x00\x00\x00":
                raise SystemExit("PNG: nur Filter 0 und ohne Interlace")
        elif typ == b"IDAT":
            daten += inhalt
        elif typ == b"IEND":
            break
    if farbtyp != 0 or tiefe not in (8, 16):
        raise SystemExit(f"PNG: erwartet Graustufe 8/16 Bit, ist Typ {farbtyp}/{tiefe}")
    puffer = _zlib.decompress(bytes(daten))
    bpp = tiefe // 8
    schritt = breite * bpp
    werte = []
    vor = bytearray(schritt)
    o = 0
    for _ in range(hoehe):
        filt = puffer[o]
        o += 1
        zeile = bytearray(puffer[o:o + schritt])
        o += schritt
        # Die fünf PNG-Filter — `backe-hoehenkarte.py` schreibt nur 0,
        # aber eine Karte aus einem Malprogramm bringt die anderen mit.
        if filt == 1:
            for i in range(bpp, schritt):
                zeile[i] = (zeile[i] + zeile[i - bpp]) & 0xFF
        elif filt == 2:
            for i in range(schritt):
                zeile[i] = (zeile[i] + vor[i]) & 0xFF
        elif filt == 3:
            for i in range(schritt):
                a = zeile[i - bpp] if i >= bpp else 0
                zeile[i] = (zeile[i] + ((a + vor[i]) >> 1)) & 0xFF
        elif filt == 4:
            for i in range(schritt):
                a = zeile[i - bpp] if i >= bpp else 0
                b = vor[i]
                c = vor[i - bpp] if i >= bpp else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                zeile[i] = (zeile[i] + pr) & 0xFF
        elif filt != 0:
            raise SystemExit(f"PNG: unbekannter Filter {filt}")
        vor = zeile
        if bpp == 1:
            werte.extend(v / 255.0 for v in zeile)
        else:
            werte.extend(((zeile[i] << 8) | zeile[i + 1]) / 65535.0
                         for i in range(0, schritt, 2))
    return breite, hoehe, werte


def setze_relief_quelle(pfad):
    """Schaltet auf die Quelle `heightmap` um; `None` schaltet zurück."""
    global QUELLE, _KARTE
    if not pfad:
        QUELLE, _KARTE = "voronoi", None
        return
    _KARTE = _png_grau(pfad)
    QUELLE = "heightmap"


def _karte_punkt(u, v):
    """Bilinear, u zyklisch (2-m-Periode), v geklemmt."""
    w, h, werte = _KARTE
    fx = (u % 1.0) * w - 0.5
    fy = min(max(v, 0.0), 1.0) * (h - 1)
    x0 = int(math.floor(fx))
    y0 = int(math.floor(fy))
    tx, ty = fx - x0, fy - y0
    y0 = min(max(y0, 0), h - 2)
    ty = min(max(fy - y0, 0.0), 1.0)

    def px(x, y):
        # Die Karte liegt von UNTEN nach oben (Blender-Bildordnung), die
        # Wand ebenfalls: z = 0 ist ihre Unterkante.
        return werte[y * w + (x % w)]

    a = px(x0, y0) * (1 - tx) + px(x0 + 1, y0) * tx
    b = px(x0, y0 + 1) * (1 - tx) + px(x0 + 1, y0 + 1) * tx
    return a * (1 - ty) + b * ty


# Mittelungskreuz: ein halber Rasterschritt (6,25 cm) nach jeder Seite.
# Ohne ihn trifft eine Stützstelle eine 4-cm-Kluft entweder ganz oder gar
# nicht, und aus derselben Wand würde bei minimal anderem Ausschnitt ein
# anderes Relief.
_KREUZ = ((0.0, 0.0, 0.36), (-0.5, 0.0, 0.16), (0.5, 0.0, 0.16),
          (0.0, -0.5, 0.16), (0.0, 0.5, 0.16))

# ── Spreizung: warum die Karte NICHT roh in den Hub geht ────────────────
# Der Mittelungskreuz kostet Kontrast — das ist sein Zweck, aber es hat
# einen Preis. Über ein volles Paneel gemessen (200 x 120 Punkte,
# 05.09.2026) liegen die gemittelten Werte zwischen 0,331 und 0,953,
# während die rohe Karte 0,129 .. 0,994 ausschöpft. Roh übernommen
# stünde die tiefste Stelle der Wand bei 4,7 cm Rückzug statt bei 7,5 —
# von 9 cm Reliefdicke wären zwei Drittel ungenutzt, und die steilste
# Flanke bliebe unter 21 Grad. Die Spreizung holt den Bereich zurück,
# den die Abtastung gekostet hat, und NICHT mehr: sie ist an gemessenen
# Grenzen festgemacht, nicht an einem Geschmacksfaktor.
KARTE_LO, KARTE_HI = 0.175, 0.987

# ── Warum das Kreuz nicht nur MITTELT ──────────────────────────────────
# Der erste Kontaktbogen mit der Karte (05.09.2026,
# `kontaktbogen-tripo.png`) hat den reinen Mittelwert widerlegt: Die Wand
# las sich als verwitterte Düne, nicht als Fels — weiche Wellen ohne eine
# einzige harte Kante, neben dem Voronoi-Paneel deutlich flauer.
#
# Der Grund ist arithmetisch, nicht ästhetisch: Eine Kluft der Karte ist
# 3 bis 6 cm breit, die Stützstellen stehen 12,5 cm auseinander. Ein
# Mittelwert über ein 12,5-cm-Kreuz verteilt eine 4-cm-Kluft auf die
# ganze Zelle — aus 6 cm Tiefe werden 2, und die Kante wird zur Rampe.
# Genau das ist der Unterschied zwischen „gefiltert" und „verloren".
#
# Deshalb wird der Mittelwert zum TIEFSTEN Wert des Kreuzes hin gezogen.
# Eine Kluft, die IRGENDWO in der Zelle liegt, zieht die Stützstelle mit
# nach hinten, statt sich wegzumitteln; eine ebene Fläche bleibt eben,
# weil dort Mittelwert und Minimum zusammenfallen. Das Aliasing, gegen
# das das Kreuz ursprünglich steht, kommt dadurch NICHT zurück: Das
# Minimum über eine feste Umgebung ändert sich bei einer kleinen
# Verschiebung des Abtastpunktes stetig, ein Einzelwert springt.
KREUZ_MIN = 0.6

# ── Und warum zusätzlich GESCHÄRFT wird ────────────────────────────────
# Auch mit dem Minimum blieb die Wand im zweiten Kontaktbogen weich. Der
# Grund liegt nicht an der Karte, sondern am Abstand der Stützstellen:
# Die Karte trägt 256 Bildpunkte je Meter, das Netz acht. Was zwischen
# zwei Stützstellen liegt, ist für die Geometrie nicht vorhanden — und
# die Vorderfläche ist WEICH schattiert (`make-stonevault.py`,
# `fels_schicht`), sodass benachbarte Zellen ohne Knick ineinander
# übergehen. Beim Voronoi-Feld entstanden die harten Kanten aus
# SPRÜNGEN zwischen Nachbarzellen; ein tiefpassgefiltertes Bild hat
# solche Sprünge nicht mehr.
#
# Die Schärfung holt sie zurück, und zwar genau dort, wo im Bild eine
# Kante steht: Vom nahen Wert (Kreuz über ±0,5 Rasterschritte) wird der
# ferne (Kreuz über ±1,75) abgezogen und die Differenz aufgeschlagen —
# eine Unschärfemaske. Auf einer ebenen Partie sind beide gleich und es
# passiert nichts; an einer Kluft ist der nahe Wert tiefer als der ferne,
# und die Kluft wird tiefer statt breiter. Das ist dieselbe Rechnung, mit
# der ein Bildbearbeiter Kanten zurückholt, die eine Verkleinerung
# gekostet hat.
SCHAERFE = 1.0
_KREUZ_FERN = ((0.0, 0.0, 0.20),
               (-1.75, 0.0, 0.20), (1.75, 0.0, 0.20),
               (0.0, -1.75, 0.20), (0.0, 1.75, 0.20))


def _karte_wert(x, z, lage):
    """Der Kartenwert (1 = ganz vorn) an der Wandstelle (x, z).

    `lage` wählt den AUSSCHNITT: zyklischer Versatz in x (bleibt damit
    2-m-periodisch, s. Zwang 1), Versatz in z und Spiegelung. Die drei
    Wandvarianten und die beiden Korridorseiten tragen so verschiedenen
    Fels aus derselben Karte.
    """
    versatz_u = _zufall(SEED, lage, 211) 
    versatz_v = (_zufall(SEED, lage, 223) - 0.5) * 0.5
    spiegel = -1.0 if (lage % 2) else 1.0
    def kreuz(kreuzliste):
        summe = 0.0
        tiefster = 1.0
        for du, dv, g in kreuzliste:
            xx = x + du * RASTER
            zz = z + dv * RASTER
            u = spiegel * (xx - ANKER) / PERIODE + versatz_u
            v = (zz + versatz_v * HOEHE) / HOEHE
            w = _karte_punkt(u, v)
            summe += g * w
            tiefster = min(tiefster, w)
        return summe, tiefster

    nah, tiefster = kreuz(_KREUZ)
    nah += KREUZ_MIN * (tiefster - nah)
    fern, _ = kreuz(_KREUZ_FERN)
    roh = nah + SCHAERFE * (nah - fern)
    t = (roh - KARTE_LO) / (KARTE_HI - KARTE_LO)
    return min(1.0, max(0.0, t))



def _zufall(*teile):
    """Deterministischer Wert in [0,1) aus ganzen Zahlen.

    Nicht `random`: dessen Folge ist zwischen Python-Fassungen nicht
    zugesichert, und ein Relief, das sich beim Interpreter-Update
    verschiebt, wäre kein Kit, sondern eine Überraschung. Hier steht
    stattdessen ein FNV-1a mit anschliessender Streuung — 64 Bit,
    ganzzahlig, überall gleich.
    """
    h = 0xCBF29CE484222325
    for t in teile:
        v = (int(t) + 0x9E3779B97F4A7C15) & 0xFFFFFFFFFFFFFFFF
        for _ in range(8):
            h = ((h ^ (v & 0xFF)) * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
            v >>= 8
    h ^= h >> 33
    h = (h * 0xFF51AFD7ED558CCD) & 0xFFFFFFFFFFFFFFFF
    h ^= h >> 33
    return (h >> 11) / float(1 << 53)


def _spanne(u, a, b):
    return a + (b - a) * u


def _glatt(t):
    """Glättung 3t²−2t³ — der Übergang ohne Knick."""
    return t * t * (3.0 - 2.0 * t)


def _keim(seed, lage, kanal, zellmass, nx, i, j):
    """Der Voronoi-Keim der Zelle (i, j) in Weltmassen.

    `i` geht MODULO NX in den Hash ein — daher die 2-m-Periodizität in x
    und damit die Naht (Zwang 1). `j` läuft frei, die Wandhöhe ist nicht
    periodisch.
    """
    ip = i % nx
    ux = _zufall(seed, lage, kanal, 101, ip, j)
    uz = _zufall(seed, lage, kanal, 103, ip, j)
    x = ANKER + (i + 0.5 + JITTER * (ux - 0.5)) * zellmass
    z = (j + 0.5 + JITTER * (uz - 0.5)) * zellmass
    return x, z


def _grund(seed, lage, kanal, nx, i, j):
    """Grundmass einer Bruchfläche — negativ bei jeder dritten.

    Warum erzwungen und nicht gewürfelt: Die Hüllbox von `DG_RockVault`
    muss der von `DG_StoneVault` gleichen (Zwang 2). Also MUSS in jedem
    Modul Material ganz vorn stehen. Mit `((i mod NX) + 2j) mod 3 == 0`
    ist das keine Wahrscheinlichkeit, sondern eine Zusage: In jeder
    Zellspalte trägt jede dritte Zeile eine Fläche, deren Grundmass so
    weit unter null liegt, dass die Klemme sie auf 0 hebt — auch nach
    Schichtung, Rauschen und Neigung (zusammen höchstens 4,7 cm).
    Zwischen Boden und Decke liegen bei 1 m Zellmass VIER Flächenzeilen,
    also trägt jede Zellspalte mindestens eine solche Fläche — und der
    schmalste Ausschnitt, den das Kit braucht (die Torbogenlaibung, 0,4 m
    breit), ebenfalls.
    """
    ip = i % nx
    if kanal == 1 and (ip + 2 * j) % VORDER_TAKT == 0:
        return VORDERGRUND
    return _spanne(_zufall(seed, lage, kanal, 107, ip, j), GRUND_MIN, GRUND_MAX)


def _neigung(seed, lage, kanal, nx, i, j):
    """Gefällevektor der Bruchfläche — die Quelle der Glanz-/Schattenseite.

    Ohne ihn wäre jede Fläche parallel zur Wand, und im Streiflicht stünden
    alle gleich hell. Die Neigung ist das, was der Kontaktbogen vom
    04.09.2026 vermisst hat: „das Relief hat keine Richtung".
    """
    ip = i % nx
    winkel = _zufall(seed, lage, kanal, 109, ip, j) * 2.0 * math.pi
    stark = _spanne(_zufall(seed, lage, kanal, 113, ip, j), NEIGUNG_MIN, NEIGUNG_MAX)
    return stark * math.cos(winkel), stark * math.sin(winkel)


def _oktave(seed, lage, kanal, zellmass, nx, x, z):
    """Eine Voronoi-Oktave: (Ebenenwert der Bruchfläche, Kluftmass f2−f1)."""
    i0 = int(math.floor((x - ANKER) / zellmass))
    j0 = int(math.floor(z / zellmass))
    f1 = f2 = 1e9
    treffer = None
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            i, j = i0 + di, j0 + dj
            kx, kz = _keim(seed, lage, kanal, zellmass, nx, i, j)
            d = math.hypot(x - kx, z - kz)
            if d < f1:
                f2 = f1
                f1 = d
                treffer = (i, j, kx, kz)
            elif d < f2:
                f2 = d
    i, j, kx, kz = treffer
    gx, gz = _neigung(seed, lage, kanal, nx, i, j)
    return _grund(seed, lage, kanal, nx, i, j) + gx * (x - kx) + gz * (z - kz), f2 - f1


def _bruch(seed, lage, x, z):
    """Beide Oktaven zusammen: (Rückzug, engstes Kluftmass).

    Die grobe Oktave trägt die Zusage aus Zwang 2 (`VORDERGRUND`), die
    feine wird ihr mit `FEIN_ANTEIL` zugemischt und um ihren Mittelwert
    zentriert — sonst höbe sie die ganze Wand an und die erzwungene
    Vorderfläche stünde nicht mehr ganz vorn.
    """
    grob, k1 = _oktave(seed, lage, 1, ZELLE, NX, x, z)
    fein, k2 = _oktave(seed, lage, 2, ZELLE2, NX2, x, z)
    mitte = (GRUND_MIN + GRUND_MAX) / 2
    return grob + FEIN_ANTEIL * (fein - mitte), min(k1, k2 * 2.0)


def _welle(seed, lage, kanal, x, wellenlaenge):
    """2-m-periodisches Wertrauschen entlang x, glatt interpoliert.

    Die Wellenlänge wird auf einen Teiler der Periode gerundet — ein
    Rauschen, das die 2 m nicht teilt, springt an der Modulgrenze.
    """
    n = max(2, int(round(PERIODE / wellenlaenge)))
    t = (x - ANKER) / PERIODE * n
    k = math.floor(t)
    f = _glatt(t - k)
    a = _zufall(seed, lage, kanal, k % n)
    b = _zufall(seed, lage, kanal, (k + 1) % n)
    return (a + (b - a) * f) * 2.0 - 1.0


def _welle_z(seed, lage, kanal, z, wellenlaenge):
    """Dasselbe entlang z — hier ohne Periodizität, z ist begrenzt."""
    t = z / wellenlaenge
    k = math.floor(t)
    f = _glatt(t - k)
    a = _zufall(seed, lage, kanal, k)
    b = _zufall(seed, lage, kanal, k + 1)
    return (a + (b - a) * f) * 2.0 - 1.0


def _schichtung(seed, lage, x, z):
    """Rückzug aus der Schichtung: Bandversatz plus Bandfuge.

    Die Höhenlinie eines Bandes ist `z + Welle(x)` — sie läuft also
    schräg und wellig durch die Wand. Genau daran scheitert der Vorwurf
    „Blockreihen mit geraden Lagerfugen": eine waagerechte Fuge kommt in
    diesem Feld nicht vor.
    """
    u = (z
         + LAGE_WELLE1 * math.sin(2.0 * math.pi * (x - ANKER) / PERIODE)
         + LAGE_WELLE2 * math.sin(4.0 * math.pi * (x - ANKER) / PERIODE + 1.1))
    band = math.floor(u / LAGE_HOEHE)
    versatz = _zufall(seed, lage, 127, band) * LAGE_STREUUNG
    d = u - band * LAGE_HOEHE                     # Abstand zur unteren Fuge
    d = min(d, LAGE_HOEHE - d)
    fuge = 0.0
    if d < LAGE_FUGE:
        fuge = LAGE_FUGE_TIEFE * (1.0 - d / LAGE_FUGE) ** 2
    return versatz + fuge


def _rand_niveau(seed, x, z, an_x_rand):
    """Das variantenfreie Randniveau (s. Zwang 1).

    Es hängt AUSDRÜCKLICH nicht von `lage` ab und ist in x 2 m periodisch
    — deshalb passt der Rand von `RockVaultWallB` auf den von
    `RockVaultWall`, und deshalb trifft x = +1 des einen Paneels x = -1
    des anderen.
    """
    if an_x_rand:
        n = _welle_z(seed, 0, 131, z, 0.5)
    else:
        n = _welle(seed, 0, 137, x, 0.5)
    return RAND_NIVEAU + RAND_STREUUNG * n


def rueckzug(x, z, seed=SEED, lage=0):
    """Der Rückzug (0 .. HUB) an der Stelle (x, z) — OHNE Randstreifen."""
    if QUELLE == "heightmap":
        # 1 = ganz vorn (Rückzug 0), 0 = ganz hinten (Rückzug HUB). Die
        # Klemme auf HUB ist damit die Skala selbst, und die Relieftiefe
        # bleibt ohne weiteres Zutun zwischen 1,5 und 9 cm.
        return HUB * (1.0 - _karte_wert(x, z, lage))
    ebene, kluft = _bruch(seed, lage, x, z)
    roh = ebene + _schichtung(seed, lage, x, z)
    if kluft < KLUFT_BREITE:
        roh += KLUFT_TIEFE * (1.0 - kluft / KLUFT_BREITE) ** 1.5
    roh += RAUSCH * (0.55 * _welle(seed, lage, 139, x, RAUSCH_X)
                     + 0.45 * _welle_z(seed, lage, 149, z, RAUSCH_Z))
    return min(HUB, max(0.0, roh))


def _stuetzstellen(lo, hi):
    """Die x-Stützstellen: das GLOBALE Raster, auf [lo, hi] beschnitten.

    Global heisst: die Punkte liegen auf ANKER + k·RASTER, unabhängig
    davon, wo das Paneel anfängt. Nur so trifft die Kante des einen
    Moduls die des anderen.
    """
    k0 = int(math.ceil((lo - ANKER) / RASTER - 1e-6))
    k1 = int(math.floor((hi - ANKER) / RASTER + 1e-6))
    xs = [lo]
    for k in range(k0, k1 + 1):
        x = ANKER + k * RASTER
        if x > lo + 1e-6 and x < hi - 1e-6:
            xs.append(x)
    xs.append(hi)
    return xs


def an_periodengrenze(x):
    """Sitzt x auf einer Modulgrenze (= Periodengrenze des Rasters)?

    Daran hängt, ob der Randstreifen greift:
      * Modulgrenze (z. B. ±1,0): Der Nachbar setzt die Wand fort — hier
        wird auf das variantenfreie Randniveau überblendet.
      * Innerer Anschlag (Torbogenlaibung bei ±0,6, Anschluss der Südwand
        im Eckmodul bei 0,70): Dahinter kommt kein Nachbar, sondern die
        Flanke eines anderen Bauteils. Ein Randstreifen wäre dort eine
        Kerbe neben der Tür.
    """
    d = (x - ANKER) % PERIODE
    return min(d, PERIODE - d) < 1e-9


def fels_gitter(lo, hi, seed=SEED, lage=0, z0=0.0, z1=HOEHE,
                rand_luft=RAND_LUFT, zeilen=None):
    """Das Höhenfeld der Frontschicht zwischen lo und hi.

    Rückgabe:
      xs      — die NOMINALEN x-Stützstellen (aufsteigend, xs[0] = lo,
                xs[-1] = hi). Sie sind das Raster, an dem die Naht hängt.
      zs      — die nominalen z-Stützstellen (gleichmässig).
      punkte  — punkte[iz][ix] = [x, z, tiefe]: die WIRKLICHE Lage der
                Stützstelle (innen verzogen, s. VERZUG) und ihr Vorsprung
                vor der Rückplatte, 0 < tiefe <= PROT.
      tiefe   — dieselben Vorsprünge als eigenes Feld, für die Prüfung.
      randx   — (bool, bool): wird an lo bzw. hi überblendet?
    """
    zu = z0 + rand_luft
    zo = z1 - rand_luft
    if zeilen is None:
        zeilen = max(2, int(round((zo - zu) / (HOEHE / ZEILEN))))
    xs = _stuetzstellen(lo, hi)
    zs = [zu + (zo - zu) * k / zeilen for k in range(zeilen + 1)]
    zs[-1] = zo
    rand_lo = an_periodengrenze(lo)
    rand_hi = an_periodengrenze(hi)

    nx, nz = len(xs), len(zs)
    punkte = []
    tiefe = []
    for iz, z0_ in enumerate(zs):
        zeile = []
        tiefen = []
        for ix, x0_ in enumerate(xs):
            # Verzug nur im Inneren; der Rand bleibt auf dem Raster liegen
            # (s. VERZUG). Der Schlüssel ist die GLOBALE Rasterspalte, nicht
            # ix — sonst verzöge dasselbe Feld sich je nach Ausschnitt anders.
            x, z = x0_, z0_
            if 0 < ix < nx - 1 and 0 < iz < nz - 1:
                k = int(round((x0_ - ANKER) / RASTER))
                x += VERZUG * RASTER * (_zufall(seed, lage, 151, k % (2 * NX2), iz) * 2.0 - 1.0)
                z += VERZUG * (zs[1] - zs[0]) * (
                    _zufall(seed, lage, 157, k % (2 * NX2), iz) * 2.0 - 1.0)
            # Abstand zu den Rändern: oben und unten wird IMMER überblendet
            # (dort steht die Boden- bzw. Deckenplatte, kein Nachbarpaneel).
            tz = min(1.0, max(0.0, min(z - zu, zo - z) / RAND))
            dx = []
            if rand_lo:
                dx.append(x - lo)
            if rand_hi:
                dx.append(hi - x)
            tx = min(1.0, max(0.0, min(dx) / RAND)) if dx else 1.0
            t = min(tx, tz)
            r = rueckzug(x, z, seed=seed, lage=lage)
            if t < 1.0:
                niveau = _rand_niveau(seed, x, z, tx <= tz)
                r = niveau + (r - niveau) * _glatt(t)
            zeile.append([round(x, 9), round(z, 9), round(PROT - r, 9)])
            tiefen.append(round(PROT - r, 9))
        punkte.append(zeile)
        tiefe.append(tiefen)
    return {
        "xs": [round(v, 9) for v in xs],
        "zs": [round(v, 9) for v in zs],
        "punkte": punkte,
        "tiefe": tiefe,
        "randx": [rand_lo, rand_hi],
    }


def _dump(argv):
    lo, hi = float(argv[0]), float(argv[1])
    opt = {"--seed": SEED, "--lage": 0, "--z0": 0.0, "--z1": HOEHE,
           "--randluft": RAND_LUFT, "--zeilen": -1}
    i = 2
    while i < len(argv):
        if argv[i] == "--relief-quelle":
            setze_relief_quelle(argv[i + 1])
        else:
            opt[argv[i]] = float(argv[i + 1])
        i += 2
    zeilen = int(opt["--zeilen"])
    g = fels_gitter(lo, hi, seed=int(opt["--seed"]), lage=int(opt["--lage"]),
                    z0=opt["--z0"], z1=opt["--z1"], rand_luft=opt["--randluft"],
                    zeilen=None if zeilen < 0 else zeilen)
    g.update({"seed": int(opt["--seed"]), "lage": int(opt["--lage"]),
              "lo": lo, "hi": hi, "prot": PROT, "hub": HUB,
              "raster": RASTER, "rand": RAND, "quelle": QUELLE})
    print(json.dumps(g))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--dump":
        _dump(sys.argv[2:])
    else:
        raise SystemExit("Aufruf: python3 felsrelief.py --dump <lo> <hi> "
                         "[--seed N] [--relief-quelle <png>] …")
