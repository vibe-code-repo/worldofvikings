# Erzeugt: die Fels-Frontschicht AUS DEM GESCANNTEN NETZ (Quelle `mesh`).
#
# ── Warum es dieses Modul gibt (05.09.2026, Weg 2) ──────────────────────
# `felsrelief.py` macht aus dem Tripo-Scan eine HÖHENKARTE und legt sie auf
# ein regelmässiges Gitter (6,25 cm). Der Kontaktbogen
# `tools/elements/out/kontaktbogen-tripo-vs-wand.png` hat gezeigt, was
# dabei verlorengeht: Links steht das Tripo-Modell — rundliche, ineinander
# übergehende Brocken. Rechts unsere Wand — harte, gleich grosse Facetten
# wie zersplittertes Glas, dazu die Kachelwiederholung im Metertakt.
#
# Drei Ursachen, jede einzeln nachweisbar:
#   (a) Ein Höhenfeld auf einem Gitter kann nur so fein sein wie das
#       Gitter. 6,25 cm sind gröber als jede Rundung des Scans.
#   (b) Die Karte wird zum Minimum gezogen und mit einer Unschärfemaske
#       geschärft — beides HOLT KANTEN ZURÜCK, die die Abtastung gekostet
#       hat. Aus rundem Fels wird dabei kantiger Fels.
#   (c) `aufbereiten()` markierte jede Kante ab 14 Grad als scharf. Damit
#       ist jede Rasterzelle eine eigene Facette mit eigener Glanzseite.
#
# Weg 2 umgeht alle drei: Die sichtbare Fläche IST das Netz des Scans,
# nur beschnitten, verschmolzen und auf das Dreiecksbudget reduziert.
# Was dabei aus dem Rezept bleibt, ist der RAHMEN — Rückplatte, Sockel,
# Haube, Endstreifen, Nahtregel, `_col`, Cavity —; er hängt nicht daran,
# WIE die Frontschicht entsteht.
#
# ── Der Ablauf in einem Satz je Schritt ────────────────────────────────
#  1. Quelle laden (GLB), Doppelecken verschmelzen — erst danach ist der
#     Scan ein geschlossener Körper (glTF liefert 40 843 Ecken für 24 225
#     echte; ohne Verschmelzen zählt Blender 29 642 Randkanten, und ein
#     Boolescher Schnitt darauf ist Glücksspiel).
#  2. Vorderseite bestimmen (−y, nachgemessen, s. `_lade_quelle`), auf
#     Weltmass bringen: EINE Tripo-Kachel = 1,00 m breit.
#  3. Kacheln streuen: Raster mit Überlappung, je Kachel eine andere
#     Lage aus der Diedergruppe, ein Versatz und eine Skalierung ±10 %.
#     Keine zwei Kacheln liegen gleich — das ist die Antwort auf die
#     sichtbare 1-m-Wiederholung.
#  4. RANDREGEL: die äusseren 3 cm auf das variantenfreie Randniveau
#     ziehen, über weitere 12 cm einblenden. Das geschieht VOR dem
#     Schnitt, an den Ecken des Netzes — deshalb liegt die Schnittkante
#     hinterher auf einer GERADEN, und zwei Nachbarpaneele treffen sich
#     dort auf denselben Millimeter, gleich welche Variante sie sind.
#  5. EIN Boolescher Schnitt (INTERSECT, exakt, mit Selbstverschneidung)
#     gegen die Paneelbox verschmilzt die überlappenden Kacheln UND
#     beschneidet auf die Paneelfläche und die Reliefdicke. Ein Schnitt
#     statt N Vereinigungen — der exakte Löser kann beides zugleich.
#  6. Dezimieren auf das Budget (Kollaps, Dreiecke).
#  7. Cavity aus der Krümmung des NETZES (dieselben Radien und Faktoren
#     wie `felsrelief._cavity`, nur ohne Gitter: Nachbarn im Umkreis).
#
# Alles in PARAMETERRAUM: (entlang, hoch, tiefe). `make-stonevault.py`
# bildet daraus die Weltlage ab — dieselbe Abbildung, die das Höhenfeld
# benutzt, samt `niveau_fn` (Treppe) und `tiefen_fn` (Torbogen).
#
# The rock front layer built from the scanned mesh itself, not from a
# height map baked off it.
import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from felsrelief import (CAVITY_BEZUG1, CAVITY_BEZUG2, CAVITY_G1,  # noqa: E402
                        CAVITY_MAX, CAVITY_MIN, CAVITY_NEUTRAL,
                        CAVITY_R1, CAVITY_R2, RAND_NIVEAU, RAND_STREUUNG,
                        _glatt, _welle_z, _zufall)

# ── Randregel ──────────────────────────────────────────────────────────
# RAND_FLACH ist der Streifen, der GENAU auf dem Randniveau liegt;
# RAND_BLEND die Strecke, über die von dort auf den freien Fels
# eingeblendet wird. Die 3 cm sind keine freie Wahl: Der `endstreifen()`
# des Paneels reicht bis 3 cm hinter die Vorderkante (make-stonevault.py,
# `ECK_TIEFE`), und ein Rand, der TIEFER läge, öffnete in der Innenecke
# zweier Paneele einen Schlitz — der Naht-Zähler hat davon am 05.09.2026
# genau 2353 helle Pixel gemeldet. Deshalb steht `RAND_NIVEAU` (1,8 cm
# Rückzug) auch hier und wird aus `felsrelief.py` geholt statt neu
# geschrieben: Es ist EINE Absprache, nicht zwei Zahlen.
# RAND_FLACH ist mit ABSICHT klein. Die naheliegenden 3 cm sind gemessen
# schlecht: In der Vierer-Flucht (`out/reihe-netz.png`, erste Fassung)
# stand an jeder Modulgrenze ein 6 cm breites, glattes, senkrechtes Band
# — im Streiflicht heller als alles daneben, und damit genau die
# „senkrechte Falte alle 2 m", gegen die dieser Weg angetreten ist.
# 1 cm reicht für die Zusage (zwei Nachbarpaneele treffen sich auf dem
# Millimeter) und ist schmaler als jede Kluft des Gesteins; die
# eigentliche Arbeit macht die lange Überblendung, und die liest sich als
# Mulde statt als Kante.
RAND_FLACH = 0.03
RAND_BLEND = 0.09
# ── Warum die Überblendung ATMET ───────────────────────────────────────
# Eine Überblendung von gleicher Breite zieht am Modulrand ein Band von
# gleicher Breite — und im Streiflicht ist ein glattes Band heller als
# der Fels daneben. In der Vierer-Flucht stand deshalb alle 2 m ein
# senkrechter Pfeiler, egal ob die Blende 12 oder 14 cm mass; genau die
# „senkrechte Falte", gegen die dieser Weg angetreten ist.
# Das Höhenfeld löst das über ein WELLENDES Randniveau. Auf einem Netz
# ist das gemessen gescheitert (41 offene Kanten nach dem Dezimieren,
# 21 % der Dreiecke beim Flicken verloren): Ein Gitter verkraftet einen
# Zentimeter Sprung, eine Dreiecksfläche faltet sich.
# Hier wellt statt dessen die BREITE. Das Randniveau bleibt eine Ebene —
# die Naht bleibt damit auf den Millimeter exakt und die Fläche
# faltungsfrei —, aber die Linie, an der der Fels beginnt, läuft
# krumm durch die Wand und liest sich als Kluft statt als Pfeiler.
RAND_BLEND_WELLE = 0.50     # ±50 % Breite (4,5 .. 13,5 cm)
RAND_BLEND_LAENGE = 0.7     # Wellenlänge der Breite, in Metern
# Die Absprache mit `make-stonevault.py` (`ECK_TIEFE`) in einer Zeile,
# die rot wird statt in einem Kommentar, den niemand liest.
assert RAND_NIVEAU + RAND_STREUUNG <= 0.03 + 1e-12, \
    "Randniveau tiefer als der Endstreifen — die Innenecke klafft"


# Wieviel Fels über das Paneel hinaus gebaut wird, bevor geschnitten wird.
# Muss grösser sein als RAND_FLACH + RAND_BLEND, sonst griffe die
# Randregel in eine Kante, an der gar kein Netz mehr steht.
UEBERSTAND = 0.30

# ── Kachelung ──────────────────────────────────────────────────────────
# KACHEL_BREITE ist die Weltbreite EINER Tripo-Kachel. 1,00 m ist die
# Vermessung des Scans (97,19 Tripo-Einheiten breit), nicht ein
# Wunschmass: Wer den Scan streckt, macht aus einer 5-cm-Kluft eine
# 10-cm-Delle — genau der Fehler, den Mass B am 05.09.2026 behoben hat.
# ── 1,70 m, und die Zahl ist erkauft (Kontaktbogen 05.09.2026) ─────────
# Der Scan ist 97,19 Tripo-Einheiten = 1,00 m breit; naheliegend wäre also
# 1,00 m. Der Kontaktbogen widerlegt das: Bei 1,00 m braucht ein Paneel
# rund zwanzig Kacheln, und beim Dreiecksbudget von 615 je Quadratmeter
# bleiben von jedem Brocken drei Dreiecke übrig — die Wand las sich als
# zersplittertes Papier, schlechter als das Höhenfeld, das sie ablösen
# sollte. Gemessen wurden 1,00 / 1,40 / 1,70 / 2,00 m; ab 1,70 stehen
# runde Brocken mit Klüften dazwischen, bei 2,00 werden sie weich.
#
# Der Preis steht hier, damit ihn niemand suchen muss: Bei 1,70 m ist die
# Reliefspanne des Scans 23,2 cm, die Wand kann aber nur 16,5 cm tragen
# (`hub`) — der Fels ist also auf 71 % seiner eigenen Tiefe gestaucht.
# Wer die Kachel kleiner macht, bekommt die Tiefe zurück und verliert die
# Form; wer sie grösser macht, umgekehrt.
KACHEL_BREITE = 1.70
# Überlappung: die Kacheln stehen dichter, als sie breit sind, und der
# Boolesche Schnitt verschmilzt sie. Eine Fuge Kante an Kante wäre eine
# GERADE quer durch den Fels; ein Durchdringen ist eine Bruchkante.
KACHEL_SCHRITT = 0.80
KACHEL_JITTER = 0.16      # Versatz je Kachel, in Vielfachen des Schrittes
KACHEL_SKALA = 0.10       # Skalierung je Kachel, ±10 %
# Tiefenstaffelung: Jede Kachel steht um bis zu KACHEL_STAFFEL·hub weiter
# hinten als die vorderste. Ohne sie liegen zwei ueberlappende Kacheln in
# derselben Tiefe, ihre Flaechen kreuzen sich unter einem flachen Winkel
# — und der Boolesche Schnitt macht daraus duenne FAHNEN. Mit ihr
# gewinnt in jeder Ueberlappung meist EINE Kachel, und die Kreuzung
# liegt tief in einer Kluft, wo sie sich als Bruchkante liest.
KACHEL_STAFFEL = 0.30

# Dreiecke je Quadratmeter Wandfläche. 615 ist das, was das
# 6,25-cm-Raster des Höhenfeldes liefert (4170 Dreiecke auf 6,96 m²) —
# die Zahl ist also nicht neu gewählt, sondern übernommen, damit der
# Vergleich mit der alten Wand einer über GLEICHE Kosten ist.
DICHTE = 615.0
# Die Treppe bekommt ein Viertel davon, aus demselben Grund, aus dem sie
# beim Höhenfeld ein doppelt so grobes Raster bekam (make-stonevault.py,
# `TREPPE_RASTER`): Ihre beiden Wände messen zusammen 42 m², und man
# bleibt auf einer Treppe nicht stehen.
DICHTE_TREPPE = 155.0

# Wie fein die QUELLE je Kachel sein muss. Mehr als das Sechsfache des
# Endbudgets bringt nichts — es wird ohnehin wegdezimiert —, weniger
# nimmt dem Booleschen Schnitt die Form. Die Grenzen sind gemessen: unter
# 900 Dreiecken verliert der Scan seine Rundungen, über 4000 dauert der
# Schnitt je Paneel länger als eine Minute.
QUELLE_MIN, QUELLE_MAX = 900, 4000

# Durchgänge der Glättung nach dem Verschmelzen (s. `_glaette`). 0 lässt
# die Messerkanten stehen, 2 macht aus dem Fels eine Düne — im
# Kontaktbogen beides nachgesehen. 1 nimmt die Fahnen und lässt die
# Klüfte.
GLAETTUNG = 1

RUECK_EINSTICH = 0.002    # wie in make-stonevault.py: Deckel 2 mm in der Platte
EPSILON = 1e-9

_QUELLE = None            # (verts, faces) im Kachelraum, einmal aufbereitet
_QUELLE_PFAD = None


def ist_netzquelle(pfad):
    """Ist `pfad` eine Netzquelle (GLB) und keine Höhenkarte (PNG)?"""
    return bool(pfad) and os.path.splitext(pfad)[1].lower() in (".glb", ".gltf")


def setze_netz_quelle(pfad):
    global _QUELLE_PFAD, _QUELLE
    _QUELLE_PFAD = pfad
    _QUELLE = None


# ── Aufbereitung der Quelle ────────────────────────────────────────────
def _lade_quelle(quelle_budget):
    """Den Scan als (verts, faces) im KACHELRAUM liefern.

    Kachelraum: e (breit) 0..KACHEL_BREITE, h (hoch) 0..H, n (Tiefe)
    0..1, wobei n = 1 die Vorderkante ist und n = 0 der tiefste Punkt der
    VORDERSEITE. Die Rückseite des Scans läuft ins Negative weiter — sie
    wird nicht abgeschnitten, weil die Paneelbox sie ohnehin kappt, und
    ein Schnitt weniger ist ein Fehler weniger.

    VORDERSEITE = −y. Nachgemessen am 05.09.2026 und hier noch einmal
    geprüft (`_pruefe_vorderseite`), weil die Flächenzählung beider
    Seiten mit 12 609 zu 12 601 praktisch gleich ist: Der Scan ist eine
    Platte mit Relief auf BEIDEN Seiten, und wer sich auf die Zählung
    verlässt, baut mit der falschen.
    """
    global _QUELLE
    if _QUELLE is not None and _QUELLE[0] == quelle_budget:
        return _QUELLE[1]
    if not _QUELLE_PFAD:
        raise SystemExit("felsnetz: keine Netzquelle gesetzt")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=_QUELLE_PFAD)
    netze = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not netze:
        raise SystemExit(f"felsnetz: kein Netz in {_QUELLE_PFAD}")
    bpy.ops.object.select_all(action="DESELECT")
    for o in netze:
        o.select_set(True)
    bpy.context.view_layer.objects.active = netze[0]
    if len(netze) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Doppelecken verschmelzen — s. Kopf, Schritt 1.
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    offen = len([e for e in bm.edges if len(e.link_faces) != 2])
    if offen:
        raise SystemExit(f"felsnetz: Quelle ist offen ({offen} Randkanten) — "
                         "ein Boolescher Schnitt darauf ist nicht verlässlich")
    bm.to_mesh(o.data)
    bm.free()

    # Dezimieren, BEVOR gekachelt wird: der Boolesche Schnitt sieht sonst
    # das Zwanzigfache an Dreiecken, und weggerechnet wird es hinterher
    # ohnehin.
    _dezimiere(o, quelle_budget)

    me = o.data
    xs = [v.co.x for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    x0, x1 = min(xs), max(xs)
    z0, z1 = min(zs), max(zs)
    s = KACHEL_BREITE / (x1 - x0)          # eine Kachel = 1,00 m breit

    _pruefe_vorderseite(me)

    # Tiefenbezug: Die VORDERSEITE ist −y. `n` = 1 an der Vorderkante,
    # 0 am tiefsten Punkt der Vorderseite. Beide Enden sind Perzentile
    # und nicht Minimum/Maximum: Ein einzelner Zacken würde sonst die
    # ganze Wand um seinen Betrag nach hinten schieben.
    vorne = sorted(v.co.y for v in me.vertices if v.normal.y < -0.25)
    if len(vorne) < 100:
        raise SystemExit("felsnetz: zu wenig Vorderseite gefunden")
    y_vorn = vorne[max(0, int(0.02 * len(vorne)))]
    y_hinten = vorne[min(len(vorne) - 1, int(0.98 * len(vorne)))]
    spanne = y_hinten - y_vorn

    verts = [(round((v.co.x - x0) * s, 7),
              round((v.co.z - z0) * s, 7),
              round((y_hinten - v.co.y) / spanne, 7)) for v in me.vertices]
    faces = [tuple(p.vertices) for p in me.polygons]
    hoehe = (z1 - z0) * s
    _QUELLE = (quelle_budget, (verts, faces, hoehe))
    print(f"NETZQUELLE {os.path.basename(_QUELLE_PFAD)}: "
          f"{len(faces)} Dreiecke, Kachel {KACHEL_BREITE:.2f} x {hoehe:.3f} m, "
          f"Reliefspanne {spanne * s * 100:.1f} cm")
    return _QUELLE[1]


def _pruefe_vorderseite(me):
    """Sicherstellen, dass −y wirklich die tiefere Seite ist.

    Die Flächenzählung entscheidet es NICHT (beide Seiten tragen Relief).
    Was entscheidet, ist die SPANNE: Die Vorderseite eines Felsbrockens
    ist zerklüfteter als seine Sägefläche. Gemessen am 05.09.2026 mit
    einer Strahlsonde: 15,73 gegen 13,93. Hier noch einmal aus dem Netz
    selbst, damit ein neuer Scan nicht still verkehrt herum eingebaut
    wird.
    """
    minus = [v.co.y for v in me.vertices if v.normal.y < -0.25]
    plus = [v.co.y for v in me.vertices if v.normal.y > 0.25]
    if len(minus) < 50 or len(plus) < 50:
        return
    sm = (max(minus) - min(minus))
    sp = (max(plus) - min(plus))
    if sm < sp:
        raise SystemExit(
            f"felsnetz: −y ist NICHT die zerklüftetere Seite "
            f"({sm:.2f} gegen {sp:.2f}) — die Quelle liegt verkehrt herum. "
            "Vor dem Bauen nachmessen, nicht die Achse raten.")


def _dezimiere(o, budget):
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if tris <= budget:
        return tris
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    # Vor dem Kollaps aufraeumen: Nulldreiecke und Doppelecken sind es,
    # an denen er den Koerper aufreisst. Gemessen ohne diesen Schritt:
    # je nach Kachelmass 0 bis 6 offene Kanten NACH dem Dezimieren, und
    # keine davon liess sich hinterher noch schliessen.
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.mesh.dissolve_degenerate(threshold=1e-5)
    bpy.ops.mesh.quads_convert_to_tris()
    bpy.ops.object.mode_set(mode="OBJECT")
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if tris <= budget:
        return tris
    m = o.modifiers.new("dez", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.use_collapse_triangulate = True
    m.ratio = max(0.001, budget / float(tris))
    bpy.ops.object.modifier_apply(modifier=m.name)
    return sum(len(p.vertices) - 2 for p in o.data.polygons)



def _glaette(o, e0, e1, h0, h1, rand_lo, rand_hi, seed):
    """Die Schnittgrate des Verschmelzens abrunden.

    Wo zwei Kacheln sich flach durchdringen, hinterlaesst der Boolesche
    Schnitt eine MESSERKANTE — im ersten Kontaktbogen dieses Weges stand
    die Wand deshalb voller duenner Fahnen. Ein gebrochener Fels hat
    Kanten, aber keine Fahnen.

    Geglaettet wird nur im FREIEN FELD: Ecken im Randstreifen bleiben,
    wo sie sind, sonst zoege die Glaettung das Randniveau krumm und die
    Naht waere hin.
    """
    if GLAETTUNG <= 0:
        return
    bm = bmesh.new()
    bm.from_mesh(o.data)
    frei = [v for v in bm.verts
            if _randfaktor(v.co.x, v.co.y, e0, e1, h0, h1,
                           rand_lo, rand_hi, seed) >= 1.0]
    for _ in range(GLAETTUNG):
        bmesh.ops.smooth_vert(bm, verts=frei, factor=0.5,
                              use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(o.data)
    bm.free()


def _randklemme(o, e0, e1, h0, h1, prot, hub, rand_lo, rand_hi, seed):
    """Den flachen Randstreifen NACH dem Dezimieren wieder exakt legen.

    `_randregel` setzt ihn exakt auf das Randniveau — aber danach wird
    geglättet und dezimiert, und beides bewegt Ecken. Ein Kollaps
    verschmilzt eine Ecke aus dem Streifen mit einer von aussen und legt
    die neue dazwischen; die Glättung schiebt eine Ecke von aussen in
    den Streifen hinein. Gemessen an den drei Wandpaneelen: bis zu
    4,1 mm vor dem Niveau — wenig, aber die Naht ist eine Zusage auf den
    Millimeter, und ein Paneel, das 4 mm vorsteht, steht 4 mm im
    Nachbarn.

    Diese Klemme kostet nichts (sie legt Ecken nur zurück, sie fügt
    keine hinzu) und macht die Zusage vom Ablauf unabhängig.
    """
    boden = prot - hub - 0.01
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for v in bm.verts:
        if _randfaktor(v.co.x, v.co.y, e0, e1, h0, h1,
                       rand_lo, rand_hi, seed) > 0.0:
            continue
        if v.co.z >= boden:
            v.co.z = prot - RAND_NIVEAU
    bm.to_mesh(o.data)
    bm.free()


def _kappe(bm, achse, wert, seite):
    """Alles jenseits der Ebene `achse = wert` abschneiden und zudecken.

    `seite` +1 schneidet weg, was GRÖSSER ist, −1, was kleiner ist. Der
    Körper bleibt geschlossen, weil die Schnittfläche gefüllt wird —
    `bisect_plane` allein liesse ein offenes Rohr zurück.
    """
    n = [0.0, 0.0, 0.0]
    n[achse] = float(seite)
    p = [0.0, 0.0, 0.0]
    p[achse] = wert
    ergebnis = bmesh.ops.bisect_plane(
        bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
        plane_co=p, plane_no=n, clear_outer=True, use_snap_center=False)
    kanten = [g for g in ergebnis["geom_cut"] if isinstance(g, bmesh.types.BMEdge)]
    if kanten:
        bmesh.ops.holes_fill(bm, edges=kanten, sides=0)
    offen = [e for e in bm.edges if len(e.link_faces) < 2]
    if offen:
        bmesh.ops.holes_fill(bm, edges=offen, sides=0)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])


def _objekt(name, bm):
    """Ein bmesh in ein Szenenobjekt legen (und das bmesh freigeben)."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def _kasten(name, e0, e1, h0, h1, t0, t1):
    """Ein achsenparalleler Quader als Szenenobjekt."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = e0 + (v.co.x + 0.5) * (e1 - e0)
        v.co.y = h0 + (v.co.y + 0.5) * (h1 - h0)
        v.co.z = t0 + (v.co.z + 0.5) * (t1 - t0)
    return _objekt(name, bm)


def _schnitt(o, ko, selbst=False):
    """`o` mit `ko` verschneiden (exakter Löser), `ko` danach entfernen.

    `selbst=True` löst zugleich die SELBSTdurchdringungen von `o` auf —
    das ist der Schritt, der aus den überlappenden Kacheln EINEN Fels
    macht. Ein Schnitt statt N Vereinigungen: der exakte Löser kann
    beides in einem Durchgang, und jede zusätzliche Boolesche Operation
    ist eine zusätzliche Gelegenheit zu scheitern.
    """
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    m = o.modifiers.new("schnitt", "BOOLEAN")
    m.operation = "INTERSECT"
    m.solver = "EXACT"
    m.use_self = selbst
    m.use_hole_tolerant = True
    m.object = ko
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(ko, do_unlink=True)


def _offene(o):
    """Zahl der Randkanten (weniger als zwei Flächen) — 0 heisst dicht."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    n = len([e for e in bm.edges if len(e.link_faces) < 2])
    bm.free()
    return n


def _verdichte(o):
    """Doppelecken und Nulldreiecke mit 0,1 mm Abstand wegraeumen.

    Dieselbe Schwelle, die `make-stonevault.py` beim Zusammenbau
    benutzt — s. Aufrufstelle.
    """
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-4, edges=bm.edges)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    # ── DOPPELFLAECHEN, und warum sie hier sterben muessen ─────────────
    # Zwei Flaechen ueber DENSELBEN drei Ecken sind eine Lasche ohne
    # Volumen — der exakte Loeser laesst sie dort zurueck, wo zwei
    # Felsbrocken sich beruehren. In `bmesh` ist das harmlos; im
    # Zusammenbau nicht: `bm.faces.new` wirft dort ValueError, die
    # zweite Flaeche faellt weg, und ihre drei Kanten stehen danach mit
    # nur EINER Flaeche da. Genau so kamen 13 offene Kanten in eine
    # Datei, die hier als dicht gemessen worden war.
    # Beide Flaechen der Lasche fallen weg, nicht eine — eine allein
    # zurueckzulassen hiesse, das Loch selbst zu bauen.
    bm.verts.index_update()
    gesehen = {}
    lasche = set()
    for f in bm.faces:
        k = tuple(sorted(v.index for v in f.verts))
        if k in gesehen:
            lasche.add(f)
            lasche.add(gesehen[k])
        else:
            gesehen[k] = f
    if lasche:
        bmesh.ops.delete(bm, geom=list(lasche), context="FACES")
    bm.to_mesh(o.data)
    bm.free()


def _flicke(o):
    """Was das Dezimieren aufreisst, wieder dicht machen.

    Der Boolesche Schnitt liefert einen dichten Koerper (nachgezaehlt:
    0 Randkanten). Der Kantenkollaps oeffnet ihn an zwei Sorten Stellen:

      * DRAHTKANTEN, an denen gar keine Flaeche mehr haengt (beide
        Nachbardreiecke sind weggefallen). Sie werden geloescht, nicht
        gefuellt — sie sind kein Loch, sondern Ballast.
      * echte RANDSCHLEIFEN, fast immer dort, wo zwei Felsbrocken sich
        beruehren und eine Kante DREI Flaechen traegt. `holes_fill`
        findet dort keinen Ring, den es ueberspannen koennte.

    Deshalb wird um jede offene Stelle ein SAUM aus zwei Flaechenringen
    weggenommen. Das entfernt die Beruehrung mit, das Loch wird groesser
    und dabei zu einer gewoehnlichen Schleife — und die laesst sich
    fuellen. Kostet ein paar Dutzend Dreiecke.

    Alles in `bmesh` und nicht mit den Editier-Werkzeugen: `mesh.delete`
    im Kantenmodus nimmt die angrenzenden Flaechen mit, und aus zwei
    offenen Kanten wurden so gemessene 51.
    """
    for _ in range(6):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        # Erst die ENTARTUNGEN weg. Die zwei letzten offenen Kanten, die
        # sich am Wandpaneel gegen jede Fuellung gewehrt haben, waren eine
        # NULLLANGE Kante und eine 0,4 mm lange daneben — ein Dreieck ohne
        # Flaeche in der Paneelecke. Fuellen kann man das nicht, nur
        # verschmelzen. 0,1 mm ist an einer Wand aus 6-cm-Dreiecken
        # nichts, an einer Nullkante alles.
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bmesh.ops.dissolve_degenerate(bm, dist=1e-4, edges=bm.edges)
        draht = [e for e in bm.edges if not e.link_faces]
        if draht:
            bmesh.ops.delete(bm, geom=draht, context="EDGES")
        einzeln = [v for v in bm.verts if not v.link_edges]
        if einzeln:
            bmesh.ops.delete(bm, geom=einzeln, context="VERTS")
        rand = [e for e in bm.edges if len(e.link_faces) == 1]
        if not rand:
            bm.to_mesh(o.data)
            bm.free()
            return 0
        saum = set()
        for e in rand:
            saum.update(e.link_faces)
        for f in list(saum):
            for v in f.verts:
                saum.update(v.link_faces)
        bmesh.ops.delete(bm, geom=list(saum), context="FACES")
        einzeln = [v for v in bm.verts if not v.link_edges]
        if einzeln:
            bmesh.ops.delete(bm, geom=einzeln, context="VERTS")
        offen = [e for e in bm.edges if len(e.link_faces) == 1]
        if offen:
            bmesh.ops.holes_fill(bm, edges=offen, sides=0)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
        bm.to_mesh(o.data)
        bm.free()
    return _offene(o)


# ── Kachellagen ────────────────────────────────────────────────────────
def _lagen(seed, lage, spalte, zeile):
    """Diedergruppe + Versatz + Skalierung EINER Kachel.

    Rückgabe: (spiegel_e, spiegel_h, tauschen, versatz_e, versatz_h,
    skala). `tauschen` dreht die Kachel um 90 Grad — bei einem
    Felsblock ist das erlaubt und verdoppelt die Zahl der Lagen. Der
    Schlüssel geht über `lage` (Modul und Wandseite, s. FELD_LAGE) UND
    über die Kachelstelle: Zwei Kacheln desselben Paneels liegen damit
    nie gleich, und zwei Paneele tragen andere Folgen.
    """
    def z(kanal):
        return _zufall(seed, lage, kanal, spalte, zeile)
    return (z(301) < 0.5, z(307) < 0.5, z(311) < 0.5,
            (z(313) - 0.5) * 2.0 * KACHEL_JITTER,
            (z(317) - 0.5) * 2.0 * KACHEL_JITTER,
            1.0 + (z(331) - 0.5) * 2.0 * KACHEL_SKALA,
            z(337) * KACHEL_STAFFEL)


def _kachelfeld(bm, quelle, e0, e1, h0, h1, prot, hub, seed, lage):
    """Die überlappenden Kacheln als EIN bmesh (noch unverschmolzen)."""
    verts, faces, kh = quelle
    schritt_e = KACHEL_BREITE * KACHEL_SCHRITT
    schritt_h = kh * KACHEL_SCHRITT
    ne = max(1, int(math.ceil((e1 - e0) / schritt_e)) + 1)
    nh = max(1, int(math.ceil((h1 - h0) / schritt_h)) + 1)
    # `n` = 1 ist die Vorderkante (tiefe = prot), `n` = 0 der tiefste
    # Punkt der Vorderseite (tiefe = prot − hub). Die Rückseite des
    # Scans läuft mit demselben Faktor ins Negative; die Paneelbox kappt
    # sie.
    for sz in range(nh):
        for sx in range(ne):
            sp_e, sp_h, tausch, ve, vh, skala, staffel = _lagen(seed, lage, sx, sz)
            ce = e0 + (sx - 0.5) * schritt_e + ve * schritt_e
            ch = h0 + (sz - 0.5) * schritt_h + vh * schritt_h
            neue = []
            for (a, b, n) in verts:
                ee = KACHEL_BREITE - a if sp_e else a
                hh = kh - b if sp_h else b
                if tausch:
                    ee, hh = hh * (KACHEL_BREITE / kh), ee * (kh / KACHEL_BREITE)
                neue.append(bm.verts.new((ce + ee * skala, ch + hh * skala,
                                          prot - hub * (1.0 - n) * skala
                                          - staffel * hub)))
            bm.verts.ensure_lookup_table()
            # Spiegeln kehrt die Wicklung um. Genau EIN Spiegel dreht sie,
            # zwei drehen sie zurück — `normals_make_consistent` läuft erst
            # viel später, der Boolesche Schnitt braucht sie JETZT richtig.
            dreh = (sp_e != sp_h) != tausch
            for f in faces:
                idx = tuple(reversed(f)) if dreh else f
                try:
                    bm.faces.new([neue[i] for i in idx])
                except ValueError:
                    pass


# ── Randregel ──────────────────────────────────────────────────────────
def _blendbreite(e, h, seed):
    """Die Breite der Überblendung an dieser Stelle (s. RAND_BLEND_WELLE).

    Sie hängt NICHT von `lage` ab — zwei beliebige Varianten bekommen
    dieselbe Linie, und wo sie sich treffen, steht ohnehin das
    variantenfreie Randniveau.
    """
    w = _welle_z(seed, 0, 163, h + e, RAND_BLEND_LAENGE)
    return RAND_BLEND * (1.0 + RAND_BLEND_WELLE * w)


def _randfaktor(e, h, e0, e1, h0, h1, rand_lo, rand_hi, seed):
    """0 am Rand (dort gilt das Randniveau), 1 im freien Feld.

    `rand_lo`/`rand_hi` sagen, ob an der jeweiligen e-Kante ein NACHBAR
    steht. An einem inneren Anschlag (Torbogenlaibung, Anschluss der
    Südwand im Eckmodul) wird NICHT eingeblendet — dort kommt kein
    Nachbarpaneel, sondern die Flanke eines anderen Bauteils, und eine
    Nut neben der Tür wäre eine Kerbe ohne Anlass.
    """
    ds = []
    if rand_lo:
        ds.append(e - e0)
    if rand_hi:
        ds.append(e1 - e)
    ds.append(h - h0)          # Boden- und Deckenplatte: immer einblenden
    ds.append(h1 - h)
    d = min(ds)
    if d <= RAND_FLACH:
        return 0.0
    return _glatt(min(1.0, (d - RAND_FLACH) / _blendbreite(e, h, seed)))


def _randregel(bm, e0, e1, h0, h1, prot, hub, rand_lo, rand_hi, seed):
    """Die Ecken zum Rand hin auf das Randniveau ziehen.

    VOR dem Schnitt, und deshalb liegt die spätere Schnittkante auf einer
    Geraden: Am Rand ist der Faktor 0, dort steht JEDE Ecke auf
    `niveau` — gleich welche Variante, gleich welches Modul. Zwei
    Nachbarpaneele treffen sich damit exakt.

    Unter `boden` wird nur noch VERSCHOBEN und nicht mehr skaliert. Sonst
    zöge die Regel die Rückseite des Scans mit auf das Randniveau, der
    Körper fiele am Rand zu einer Fläche zusammen — und ein Boolescher
    Schnitt gegen eine Fläche ohne Volumen ist kein Schnitt, sondern ein
    Absturz.
    """
    boden = prot - hub - 0.01
    for v in bm.verts:
        g = _randfaktor(v.co.x, v.co.y, e0, e1, h0, h1, rand_lo, rand_hi, seed)
        if g >= 1.0:
            continue
        # Das Randniveau ist EINE Zahl und keine Welle. Der Versuch, es
        # wie im Höhenfeld wellen zu lassen (`felsrelief._rand_niveau`,
        # ±1,2 cm), ist gemessen gescheitert: Auf einem Gitter ist ein
        # Zentimeter Sprung folgenlos, auf einem Netz faltet sich die
        # Fläche. 41 offene Kanten nach dem Dezimieren, und das Flicken
        # kostete 21 % der Dreiecke — im Kontaktbogen standen danach
        # grosse glatte Felder. Gegen das sichtbare Band am Modulrand
        # hilft statt dessen RAND_FLACH (s. dort).
        niveau = prot - RAND_NIVEAU
        t = v.co.z
        if t >= boden:
            v.co.z = niveau + (t - niveau) * g
        else:
            v.co.z = (niveau + (boden - niveau) * g) - (boden - t)


# ── Cavity aus der Krümmung des Netzes ─────────────────────────────────
def _cavity(verts, e0, e1, h0, h1, prot, hub, rand_lo, rand_hi, seed):
    """Verschattungsfaktor je Ecke — dieselbe Rechnung wie im Höhenfeld.

    Dort werden zwei RINGE des Rasters gemittelt (`felsrelief._cavity`),
    hier zwei UMKREISE: Ein Netz hat keine Rasternachbarn. Die Radien,
    die Gewichte, die Bezugstiefen und die Kennlinie sind dieselben
    Zahlen — was die alte Wand an Verschattung trug, trägt die neue
    auch, sonst wäre der Vergleich der beiden keiner.

    Nachbarn werden in einem Gitter aus Fächern gesucht (Kantenlänge =
    grosser Radius). Ohne das wären es bei 20 000 Ecken 400 Millionen
    Abstände; so sind es rund 40 je Ecke.
    """
    r1 = CAVITY_R1 * 0.0625
    r2 = CAVITY_R2 * 0.0625
    b1 = CAVITY_BEZUG1 * 0.0625
    b2 = CAVITY_BEZUG2 * 0.0625
    fach = r2
    eimer = {}
    for i, (e, h, t) in enumerate(verts):
        eimer.setdefault((int(e // fach), int(h // fach)), []).append(i)

    aus = []
    for i, (e, h, t) in enumerate(verts):
        s1 = n1 = 0.0
        s2 = n2 = 0.0
        ce, ch = int(e // fach), int(h // fach)
        for de in (-1, 0, 1):
            for dh in (-1, 0, 1):
                for j in eimer.get((ce + de, ch + dh), ()):
                    if j == i:
                        continue
                    je, jh, jt = verts[j]
                    d2 = (je - e) ** 2 + (jh - h) ** 2
                    if d2 > r2 * r2:
                        continue
                    s2 += jt
                    n2 += 1
                    if d2 <= r1 * r1:
                        s1 += jt
                        n1 += 1
        k1 = ((s1 / n1) - t) / b1 if n1 else 0.0
        k2 = ((s2 / n2) - t) / b2 if n2 else 0.0
        k = CAVITY_G1 * k1 + (1.0 - CAVITY_G1) * k2
        k = min(1.0, max(-1.0, k))
        if k >= 0.0:
            f = CAVITY_NEUTRAL - (CAVITY_NEUTRAL - CAVITY_MIN) * _glatt(k)
        else:
            f = CAVITY_NEUTRAL + (CAVITY_MAX - CAVITY_NEUTRAL) * _glatt(-k)
        # Am Modulrand auf 1,0 ausblenden — wie im Höhenfeld. Sonst stünde
        # dort ein dunkler Streifen, in BEIDEN angrenzenden Paneelen: die
        # Naht wäre geometrisch dicht und als Schatten trotzdem sichtbar.
        g = _randfaktor(e, h, e0, e1, h0, h1, rand_lo, rand_hi, seed)
        aus.append(round(1.0 + (f - 1.0) * _glatt(g), 6))
    return aus


# ── Der Aufruf, den make-stonevault.py macht ───────────────────────────
def frontschicht(lo, hi, z0, z1, prot, hub, seed, lage,
                 rand_lo, rand_hi, dichte=DICHTE):
    """Die Frontschicht als (verts, faces, cavity) im Parameterraum.

    verts: (entlang, hoch, tiefe) — `tiefe` ist der Vorsprung vor der
           Rückebene, 0 .. prot, genau wie beim Höhenfeld.
    faces: Ecken-Indizes (Dreiecke und Vierecke).
    cavity: ein Faktor je Ecke.

    Der Körper ist GESCHLOSSEN (der Boolesche Schnitt gegen eine Box
    liefert nichts anderes) — dieselbe Zusage, die `fels_schicht` beim
    Höhenfeld von Hand herstellt: `normals_make_consistent(inside=False)`
    richtet die Wicklung an einer offenen Haut nach einer Heuristik, an
    einem Körper nach seinem Innen.
    """
    flaeche = max(1e-3, (hi - lo) * (z1 - z0))
    budget = max(120, int(round(flaeche * dichte)))
    kachel_flaeche = KACHEL_BREITE * KACHEL_BREITE
    n_kacheln = max(1.0, flaeche / (kachel_flaeche * KACHEL_SCHRITT ** 2))
    q_budget = int(min(QUELLE_MAX, max(QUELLE_MIN, 6.0 * budget / n_kacheln)))
    quelle = _lade_quelle(q_budget)

    e0, e1, h0, h1 = lo, hi, z0, z1
    bm = bmesh.new()
    _kachelfeld(bm, quelle, e0 - UEBERSTAND, e1 + UEBERSTAND,
                h0 - UEBERSTAND, h1 + UEBERSTAND, prot, hub, seed, lage)
    _randregel(bm, e0, e1, h0, h1, prot, hub, rand_lo, rand_hi, seed)

    # ── Zwei Schnitte, und das Dezimieren dazwischen ───────────────────
    # Der erste Schnitt VERSCHMILZT die überlappenden Kacheln (`selbst`)
    # und nimmt grob zurecht; dann wird dezimiert; der zweite Schnitt
    # legt die Paneelfläche fest.
    #
    # Warum in dieser Reihenfolge und nicht in der naheliegenden
    # (schneiden, dann dezimieren): Der Kantenkollaps öffnet den Körper.
    # Gemessen am Wandpaneel: 0 Randkanten nach dem Schnitt, 4 nach dem
    # Dezimieren — und alle vier lagen AM RAND, wo der Fels auf 3 cm
    # Breite exakt auf dem Randniveau liegt und die Paneelbox exakt
    # dort schneidet. So viele zusammenfallende Flächen sind für einen
    # Kollaps eine Einladung zu Splittern. Weder `fill_holes` noch ein
    # zweiter Schnitt haben sie zuverlässig geschlossen.
    # Steht das Dezimieren VOR dem massgeblichen Schnitt, kommt die
    # ausgelieferte Fläche direkt aus dem exakten Löser — und der gibt
    # keine offenen Kanten aus.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    o = _objekt("kacheln", bm)
    _schnitt(o, _kasten("grob", e0 - UEBERSTAND, e1 + UEBERSTAND,
                        h0 - UEBERSTAND, h1 + UEBERSTAND,
                        -RUECK_EINSTICH, prot), selbst=True)
    vor = _offene(o)

    # Dezimiert wird auf das Budget der PANEELFLÄCHE, obwohl noch der
    # Überstand dranhängt — und das ist kein Versehen: Der Überstand ist
    # durch die Randregel eine FLACHE Platte auf dem Randniveau, und
    # eine flache Platte kostet den Kollaps fast nichts. Gemessen am
    # Wandpaneel: 6548 Dreiecke vor dem Zuschnitt, 6454 danach — der
    # Zuschnitt nimmt 1,5 %, nicht die 34 % Flächenanteil.
    _glaette(o, e0, e1, h0, h1, rand_lo, rand_hi, seed)
    _dezimiere(o, budget)
    nach = _offene(o)
    vor_flicken = sum(len(p.vertices) - 2 for p in o.data.polygons)
    _flicke(o)
    # ── Wache gegen stilles Wegflicken ────────────────────────────────
    # `_flicke` nimmt um jede offene Stelle einen Saum weg. Bei ein paar
    # Splittern kostet das ein Dutzend Dreiecke; bei einem strukturellen
    # Fehler frisst es das halbe Paneel — und was herauskommt, ist kein
    # Fels mehr, sondern eine geflickte Plane. Genau so ist ein Riss im
    # Randniveau einmal durchgerutscht: 188 offene Kanten, danach 1936
    # statt 4280 Dreiecken, und im Kontaktbogen standen grosse glatte
    # Felder. Gezaehlt wird deshalb nicht die Zahl der Loecher, sondern
    # der SCHADEN — das ist die Groesse, auf die es ankommt.
    danach = sum(len(p.vertices) - 2 for p in o.data.polygons)
    verlust = 1.0 - danach / max(1, vor_flicken)
    if verlust > 0.12:
        raise SystemExit(
            f"felsnetz: Frontschicht lage {lage} — das Flicken hat "
            f"{verlust * 100:.0f} % der Dreiecke gekostet ({vor_flicken} -> "
            f"{danach}, {nach} offene Kanten). Das ist kein Splitter, das "
            "ist ein Riss: die Ursache suchen, nicht flicken.")
    _randklemme(o, e0, e1, h0, h1, prot, hub, rand_lo, rand_hi, seed)

    # ── Zuschnitt auf die Paneelfläche: SECHS EBENENSCHNITTE ──────────
    # Und nicht ein zweiter Boolescher Schnitt. Der Unterschied ist
    # gemessen: Derselbe Zuschnitt als Boolescher Schnitt gegen die
    # Paneelbox lieferte am dezimierten Netz 38 Dreiecke statt 4300 —
    # der exakte Löser steigt aus, wenn er auf ein Netz trifft, das
    # gerade ein Kantenkollaps hinter sich hat. Ein Ebenenschnitt kann
    # das nicht: Er teilt Dreiecke und füllt die Schnittfläche, mehr
    # nicht.
    #
    # Die vordere Ebene (t = prot) ist zugleich die Zusage an die
    # Hüllbox: Was weiter vorsteht, wird abgeschnitten, und die
    # Schnittflächen liegen dann EXAKT auf der Wandflucht — im Rezept
    # die erzwungenen Vorderflächen (`felsrelief._grund`). Fehlt dieser
    # Block, wächst die Hüllbox des Paneels von ±1,06 auf ±1,30, und
    # `DG_RockVault` ist kein abgeleitetes Kit mehr; `fels-kollision.mjs`
    # meldet es als erstes.
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for achse, wert, seite in ((0, e0, -1), (0, e1, 1),
                               (1, h0, -1), (1, h1, 1),
                               (2, -RUECK_EINSTICH, -1), (2, prot, 1)):
        _kappe(bm, achse, wert, seite)
    bm.to_mesh(o.data)
    bm.free()
    # Auch der Ebenenschnitt kann eine Schleife hinterlassen, die er
    # nicht füllen kann — wenn sie durch eine Berührungskante läuft.
    _flicke(o)
    # Und NOCH einmal die Klemme, jetzt auf den Ecken, die der Schnitt
    # selbst erzeugt hat. Sie entstehen durch Interpolation entlang einer
    # Kante, und wenn deren fernes Ende ausserhalb des Streifens liegt,
    # trägt der neue Punkt einen Teil von dessen Tiefe mit: An
    # `RockVaultWallC` gemessen 4,1 mm vor dem Niveau. Nach dem Schnitt
    # liegt die Ecke exakt auf der Modulgrenze — dort ist die Klemme
    # zugleich die Nahtzusage.
    _randklemme(o, e0, e1, h0, h1, prot, hub, rand_lo, rand_hi, seed)

    # ── Denselben Abstand verschmelzen wie `aufbereiten` ───────────────
    # `make-stonevault.py` laesst nach dem Zusammenbau ein
    # `remove_doubles(1e-4)` ueber das ganze Modul laufen. Was DORT
    # zusammenfaellt, kann eine Splitterflaeche kollabieren lassen — und
    # die ausgelieferte GLB waere offen, obwohl hier alles dicht war
    # (gemessen: 0 offene Kanten in `felsnetz`, 13 in der Datei).
    # Deshalb wird hier mit DEMSELBEN Abstand verschmolzen und danach
    # noch einmal geflickt: Was diese Funktion verlaesst, ueberlebt den
    # Zusammenbau.
    _verdichte(o)
    _flicke(o)
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)

    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    # ── Warum hier noch geflickt wird ──────────────────────────────────
    # Der Boolesche Schnitt liefert einen geschlossenen Koerper (`vor`
    # zaehlt es nach). Das DEZIMIEREN kann ihn wieder oeffnen: Ein
    # Kantenkollaps an einer Stelle, an der drei Flaechen fast in einer
    # Ebene liegen, laesst gelegentlich ein Dreieck ohne Nachbarn zurueck.
    # Gemessen am ersten Wandpaneel: 0 offene Kanten vor dem Dezimieren.
    # Ein Loch in der Frontschicht ist im Spiel ein Blick ins Nichts,
    # deshalb werden die Randschleifen geschlossen statt gemeldet.
    #
    # NICHT geflickt werden Kanten mit MEHR als zwei Flaechen. Der exakte
    # Loeser hinterlaesst sie dort, wo zwei Felsbrocken sich genau
    # beruehren (gemessen: 15 Stueck am Wandpaneel). Das ist kein Loch,
    # sondern eine Beruehrung — der Koerper bleibt dicht, und wer sie
    # aufloest, zerschneidet Flaechen ohne Anlass.
    #
    # Drahtkanten (gar keine Flaeche) und einzelne Ecken sind kein Loch,
    # aber Ballast — und der Auszaehler unten meldete sie als eines.
    # `mesh.select_non_manifold(use_wire=True)` bekommt sie in Blender 5.2
    # nicht zu fassen, `bmesh` schon. Weil an ihnen keine Flaeche haengt,
    # kann ihr Loeschen auch nichts aufreissen.
    draht = [e for e in bm.edges if not e.link_faces]
    if draht:
        bmesh.ops.delete(bm, geom=draht, context="EDGES")
    einzeln = [v for v in bm.verts if not v.link_edges]
    if einzeln:
        bmesh.ops.delete(bm, geom=einzeln, context="VERTS")
    offen = len([e for e in bm.edges if len(e.link_faces) < 2])
    verts = [(v.co.x, v.co.y, v.co.z) for v in bm.verts]
    bm.verts.ensure_lookup_table()
    for i, v in enumerate(bm.verts):
        v.index = i
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free()
    print(f"FRONTSCHICHT lage {lage} {e1 - e0:.2f} x {h1 - h0:.2f} m: "
          f"{tris} Dreiecke (Budget {budget}), {len(verts)} Ecken, "
          f"offene Kanten {vor} vor / {nach} nach dem Dezimieren / "
          f"{offen} am Ende")
    if offen:
        raise SystemExit(f"felsnetz: Frontschicht lage {lage} ist offen "
                         f"({offen} Kanten) — der Schnitt hat ein Loch "
                         "hinterlassen")
    cav = _cavity(verts, e0, e1, h0, h1, prot, hub, rand_lo, rand_hi, seed)
    return verts, faces, cav
