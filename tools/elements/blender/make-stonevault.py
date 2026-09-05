# Erzeugt: die Module des Kits DG_StoneVault als GLB — Zelle, Wand, Bogen, Korridor, Ecke, Abzweig, Treppe und die fünf Säle.
# Baut die game-ready Module des Kits "DG_StoneVault".
#   StoneVaultCell.glb     — Boden- + Deckenplatte einer Zelle (2x2, Decke bei 3,5 m)
#   StoneVaultWall.glb     — Wandpaneel 2 x 3,5 x 0,3 mit versetztem Ziegelrelief
#   StoneVaultArch.glb     — Torbogen 2 x 3,5 x 0,3 mit mittiger Bogenoeffnung
#   StoneVaultCorridor.glb — Zelle mit Innenwand Ost + West (offen: Nord/Sued)
#   StoneVaultCorner.glb   — Zelle mit Innenwand Sued + West (offen: Nord/Ost)
#   StoneVaultJunction.glb — Zelle mit Innenwand West (offen: Nord/Ost/Sued)
#   StoneVaultHall.glb     — Boden + Decke 4x4 ohne Waende
#   StoneVaultHallLarge.glb— Saal 6x6 (3x3 Zellen) mit vier Stuetzpfeilern
#   StoneVaultHallLong.glb — Saal 4x8 (2x4 Zellen) mit drei Stuetzpfeilern
#   StoneVaultHallGrand.glb— Saal 8x8 (4x4 Zellen), Pfeilerraster 4 m
#   StoneVaultHallVast.glb — Saal 12x12 (6x6 Zellen), Pfeilerraster 4 m
#   StoneVaultStairs.glb   — Treppenzelle 2 x 6, steigt von y=0 auf y=3,5 (30,3 Grad)
#
# ACHTUNG Achsen: gebaut wird in Blender-Z-up (Hoehe = Blender Z). Der glTF-Export
# dreht auf Y-up: gltf_x = blender_x, gltf_y = blender_z, gltf_z = -blender_y.
# make-elements.py baut die Hoehe auf Blender Y — die dortigen GLBs liegen im
# glTF also auf der Seite. Hier NICHT uebernommen, sondern nach SteingrabGang.glb
# gerichtet (dort: Hoehe auf Blender Z, Bodenoberkante z=0).
#
# ACHTUNG Spiegelung: alle Steingrab-Module haben negatives Signed Volume, also
# in x vorgespiegelte Geometrie ohne Winding-Flip. Der Client dreht das ueber
# Babylons __root__ (scale.x = -1) wieder gerade. Deshalb wird hier am Ende jedes
# Moduls x negiert, ohne die Flaechenwicklung anzufassen.
#
# ── STIL (04.09.2026): dasselbe Kit, zwei Frontschichten ───────────────────
# `--stil ziegel` (Vorgabe) baut den bisherigen Backsteinverband und schreibt
# StoneVault*.glb. `--stil fels` tauscht AUSSCHLIESSLICH die Frontschicht von
# `innenwand()`, `wand()`, `bogen()` und der Treppe gegen ein verdraengtes
# HOEHENFELD (tools/elements/blender/felsrelief.py) und schreibt
# RockVault*.glb.
#
# ── 05.09.2026: aus Bloecken wird eine Flaeche ─────────────────────────────
# Die erste Fels-Fassung setzte unregelmaessige QUADER. Der Kontaktbogen hat
# sie widerlegt — sie las sich weiter als Mauerwerk. Seither steht dort eine
# unterteilte Flaeche (Raster 0,125 m) mit Voronoi-Bruchflaechen, Klueften,
# schraeger Schichtung und feinem Rauschen; die Begruendung im Einzelnen
# steht im Kopf von felsrelief.py.
#
# Zwei Folgen davon stehen HIER:
#   * Der Randstreifen des Feldes muss VOR den 3 cm des `endstreifen()`
#     bleiben, sonst klafft in der Innenecke ein Schlitz (s. dort).
#   * `--stil fels` baut ZWEI zusaetzliche Wandpaneele (RockVaultWallB/C)
#     mit derselben Huellbox und denselben Connectors, aber anderem Feld.
#     Der Rasterpfad waehlt unter ihnen je Kante (dungeonRasterGenerator S7),
#     und damit endet die 2-m-Wiederholung des einen Paneels.
#
# ── 05.09.2026: der Torbogen laeuft an die Wandflucht heran ────────────────
# Seither ist `--stil fels` nicht mehr NUR eine andere Frontschicht: Am
# Torbogen wandert auch der KERN. Sein Pfostenende nahm 15,4 cm Vorstand vor
# der Nachbarwand ein und zeigte sie als glatte Platte — die Begruendung, die
# Messung und die Zahlen stehen ueber `bogen()` bei `TAPER_LAENGE`. Der
# Ziegelzweig bleibt Zeichen fuer Zeichen, was er war.
#
# Was dabei NICHT wandert — und warum:
#   * Rueckplatte, Sockel, Haube und die Endstreifen: sie sind der
#     Nahtschluss vom 03.09.2026. Wer sie anfasst, oeffnet die Fugen wieder,
#     gegen die sie gebaut sind.
#   * Boden und Decke (`boden_decke`): der Boden ist die Kollisionsflaeche und
#     traegt 16 Quader je Zelle. Ein Fels-Boden waere eine Vervielfachung der
#     Havok-Last ohne Bildgewinn.
#   * Pfeiler und Saele: sie tragen ueberhaupt keine Frontschicht. Die fuenf
#     Saele sind im Fels-Stil deshalb Zeichen fuer Zeichen dieselbe Geometrie
#     — sie werden trotzdem mitgebaut, weil ein abgeleitetes Kit alle zwoelf
#     Module braucht.
#
# Die Hüllbox bleibt in beiden Stilen gleich: `DG_RockVault` wird von
# `DG_StoneVault` ABGELEITET (gleiche size, gleiche Connectors), also darf
# kein Punkt der Fels-Flaeche weiter vorstehen als das Ziegelrelief. Der
# Rueckzug geht nur nach hinten; die Begruendung steht in felsrelief.py.
#
# flatpak run org.blender.Blender --factory-startup -b --python make-stonevault.py -- <out-ordner> [--stil fels] [--seed N] [--relief-quelle <hoehenkarte.png>] [modul ...]
# Ohne Modulnamen werden ALLE gebaut; mit Namen nur die genannten (die bereits
# ausgelieferten Module lassen sich so unangetastet lassen). Modulnamen duerfen
# mit StoneVault... ODER RockVault... genannt werden.
import bpy, bmesh, sys, math, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import felsnetz                                            # noqa: E402
from felsrelief import (an_periodengrenze, fels_gitter,    # noqa: E402
                        setze_relief_quelle, RAND_LUFT as FELS_RANDLUFT,
                        RASTER as FELS_RASTER, SEED as FELS_SEED)

ARGS = sys.argv[sys.argv.index("--") + 1:]

# Flags aus der Argumentliste schaelen, damit der Rest bleibt, was er war:
# Ausgabeordner plus Modulnamen.
STIL = "ziegel"
SEED = FELS_SEED
RELIEF_QUELLE = None
_rest = []
_i = 0
while _i < len(ARGS):
    if ARGS[_i] == "--stil":
        STIL = ARGS[_i + 1]
        _i += 2
    elif ARGS[_i] == "--seed":
        SEED = int(ARGS[_i + 1])
        _i += 2
    elif ARGS[_i] == "--relief-quelle":
        # Die gebackene Hoehenkarte statt des Voronoi-Feldes. Der Schalter
        # wirkt AUSSCHLIESSLICH auf die Frontschicht (felsrelief.py); die
        # Rueckplatte, der Nahtschluss und jeder Quader bleiben, was sie
        # sind — deshalb kann `--stil ziegel` ihn gar nicht brauchen.
        RELIEF_QUELLE = ARGS[_i + 1]
        _i += 2
    else:
        _rest.append(ARGS[_i])
        _i += 1
if STIL not in ("ziegel", "fels"):
    raise SystemExit(f"Unbekannter Stil: {STIL} (erlaubt: ziegel, fels)")
# ── Drei Quellen fuer EINEN Schalter (05.09.2026, Weg 2) ───────────────────
# `--relief-quelle` nimmt jetzt zweierlei, und die DATEIENDUNG entscheidet:
#   *.png  -> Quelle `heightmap`: die aus dem Scan gebackene Hoehenkarte
#             wird auf das 6,25-cm-Raster gelegt (felsrelief.py).
#   *.glb  -> Quelle `mesh`: das gescannte NETZ SELBST wird die sichtbare
#             Flaeche (felsnetz.py). Der Kontaktbogen
#             `kontaktbogen-tripo-vs-wand.png` hat gezeigt, warum es die
#             dritte Quelle braucht — ein Gitter kann keine Rundung
#             darstellen, die feiner ist als seine Masche.
# Ohne den Schalter bleibt es bei `voronoi`, dem Feld ohne Datei; nur damit
# laufen `fels-frontschicht.mjs` und der Kit-Neubau ohne Bilddaten.
NETZ_QUELLE = False
if RELIEF_QUELLE:
    if STIL != "fels":
        raise SystemExit("--relief-quelle gibt es nur zu --stil fels")
    if felsnetz.ist_netzquelle(RELIEF_QUELLE):
        NETZ_QUELLE = True
        felsnetz.setze_netz_quelle(RELIEF_QUELLE)
        print(f"NETZQUELLE {RELIEF_QUELLE}")
    else:
        setze_relief_quelle(RELIEF_QUELLE)
        print(f"RELIEFQUELLE {RELIEF_QUELLE}")
ARGS = _rest
OUT = ARGS[0]

PRAEFIX = "RockVault" if STIL == "fels" else "StoneVault"


def ausgabename(name):
    """Der Dateiname des Moduls im gewaehlten Stil.

    Die Bauteilnamen im Skript bleiben StoneVault* — sie benennen die
    GEOMETRIE, und die Hallen sind in beiden Stilen dieselbe. Erst beim
    Ablegen entscheidet der Stil ueber den Namen, weil daran der
    Prefab-Hash haengt (shared/src/dungeons.ts: `getStableHash(name)`).
    """
    return PRAEFIX + name[len("StoneVault"):]


# Modulnamen duerfen in beiden Schreibweisen genannt werden — wer im
# Fels-Lauf "RockVaultWall" tippt, meint dasselbe Bauteil.
NUR = {("StoneVault" + n[len("RockVault"):]) if n.startswith("RockVault") else n
       for n in ARGS[1:]}

GRID   = 2.0     # Rastermass / Zellbreite
HOEHE  = 3.5     # Raumhoehe: Bodenoberkante bis Deckenunterkante
DICKE  = 0.25    # Plattendicke — wie SteingrabGang (Boden reicht bis z = -0,2493)
TIEFE  = 0.30    # Wand-/Bogentiefe, mittig um den Ursprung: -0,15 .. +0,15
# ── Reliefdicke: 6 cm in Ziegeln, 18 cm im Fels ─────────────────────────────
# Der Ziegelverband braucht 6 cm — mehr sieht man einem Backstein nicht an.
# Die Fels-Frontschicht braucht MEHR, und zwar aus einem messbaren Grund: Sie
# ist eine unterteilte Flaeche. Bei 6 cm Hub betraegt die steilste moegliche
# Flanke auf dem 0,125-m-Raster atan(0,06/0,125) = 26 Grad — es gibt in so
# einer Wand also gar keine scharfe Bruchkante, egal wie das Feld gerechnet
# wird.
#
# Bis zum 05.09.2026 standen hier 9 cm, und die Zahl kam nicht aus dem
# Gestein, sondern aus der SPIELERKAPSEL: Das sichtbare Netz war zugleich
# die Kollisionsform, jede tiefere Kluft also eine Falle. Mikes Befund vom
# selben Tag lautete, die Wand im Spiel sei viel weniger grob als das
# Tripo-Modell (dort rund 16 cm Spanne auf 1 m Wand) — und die 9-cm-Klemme
# war der groesste Einzelposten daran.
#
# Deshalb bekommt jedes Fels-Wandmodul seit heute ein `_col`-Netz (s.
# `kollisionsnetz()` und `fertig()`): eine GLATTE Flaeche auf der
# Wandflucht. Die Kapsel gleitet daran entlang und sieht das Relief nicht
# mehr; wie tief die Kluefte dahinter stehen, ist ihr gleichgueltig. Damit
# ist die Reliefdicke nur noch durch die Wand selbst begrenzt:
#
#   Wandtiefe 30 cm = 18 cm Relief + 12 cm Rueckplatte.
#
# Was dabei NICHT wandert: Die Hüllbox (TIEFE bleibt 0,30) und die
# VORDERKANTE des Reliefs. Dicker wird allein die Reliefschicht, duenner die
# Rueckplatte (0,24 -> 0,12). Die Wandfront liegt in beiden Stilen auf
# +-0,15 bzw. (bei den Innenwaenden) auf +-0,70 — was `stonevault-kantensonde`
# als Durchgangsfenster misst, aendert sich um keinen Millimeter.
PROT   = 0.18 if STIL == "fels" else 0.06
RUECK  = TIEFE - PROT   # Rueckplattendicke 0,24 bzw. 0,12

# ── Der Torbogen kann nicht 18 cm nehmen ────────────────────────────────────
# Er traegt sein Relief auf BEIDEN Flanken (er sitzt in der Kopplungsebene
# zwischen zwei Zellen, s. `bogen()`). Zweimal 18 cm sind 36 und damit mehr
# als seine ganze Tiefe. 13 cm je Flanke lassen 4 cm Mittelplatte stehen —
# duenn, aber es ist eine Platte MITTEN im Koerper, die niemand sieht und
# die nichts traegt ausser sich selbst. Das Feld nimmt die Zahl ueber
# `prot=`/`hub=` entgegen (felsrelief.py), sie steht also nur hier.
BOGEN_PROT = 0.13 if STIL == "fels" else PROT
BOGEN_HUB  = BOGEN_PROT - 0.015   # dieselbe Wandstaerke-Reserve wie HUB

# ── NAHTSCHLUSS (03.09.2026) ────────────────────────────────────────────────
# Befund im Spiel: an den Kanten Wand<->Boden, Wand<->Decke und in den
# Innenecken zweier Wandpaneele fielen helle Zacken/Linien ins Bild — Licht der
# hellen Aussenwelt durch die Fugen ZWISCHEN den Modulen.
#
#   (a) Die Bodenplatte endet an der Zellkante (+-1,0), das endCap-Paneel steht
#       AUSSERHALB davon (Kante .. Kante+0,3) und begann bei y=0. Jede
#       Steinplattenfuge (0,03 tief) lief also unter der Wandunterkante ins
#       Freie -> helle Zacken im 0,5-m-Raster. Oben dasselbe als Haarlinie
#       (Wandoberkante 3,5 = Deckenunterkante 3,5, nur Kante an Kante).
#   (b) Zwei endCap-Paneele in einer Innenecke lassen eine 6-cm-Saeule offen:
#       Paneel A deckt x -1..1 bei z 1,00..1,30, Paneel B z -1..1 bei
#       x 1,00..1,30 — das Quadrat x/z 1,00..1,06 fuellt keins von beiden.
#
# Fix: Wandkoerper reichen unten in die Bodenplatte (bis WAND_UNTEN) und oben
# in die Deckenplatte (bis WAND_OBEN) hinein — dann steht vor jeder Fuge
# Material statt Luft. Dazu bekommt das Paneel an beiden Enden einen
# Endstreifen (s. `endstreifen()`).
WAND_UNTEN = -DICKE            # -0,25: Unterkante der Bodenplatte
WAND_OBEN  = HOEHE + DICKE     #  3,75: Oberkante der Deckenplatte
WAND_H     = WAND_OBEN - WAND_UNTEN          # 4,00
WAND_CZ    = (WAND_UNTEN + WAND_OBEN) / 2    # 1,75
SOCKEL_H   = -WAND_UNTEN                     # 0,25 unter dem Boden
SOCKEL_CZ  = WAND_UNTEN / 2                  # -0,125
HAUBE_CZ   = HOEHE + DICKE / 2               #  3,625

# Diese Masse gelten fuer das freistehende Paneel: es steht NEBEN Boden- und
# Deckenplatte (ausserhalb der Zelle), seine Deckel bei -0,25/3,75 liegen mit
# deren Kanten in EINER Ebene, ueberlappen sie aber nicht -> kein Z-Fighting.
#
# Waende INNERHALB der Zelle (Innenwaende, Torbogenpfosten, Treppenwaende)
# stecken dagegen mitten in den Platten. Ein Deckel exakt auf -0,25/3,75 laege
# dort koplanar AUF der Plattenflaeche — von oben/unten flimmernd. Sie enden
# deshalb 1 cm INNERHALB der Platte; fuer die Dichtheit ist das gleichwertig,
# denn abzudichten ist die Fuge bei y=0 bzw. y=3,5.
EINSTICH   = 0.01
I_UNTEN    = WAND_UNTEN + EINSTICH           # -0,24
I_OBEN     = WAND_OBEN - EINSTICH            #  3,74
I_H        = I_OBEN - I_UNTEN                #  3,98
I_CZ       = (I_UNTEN + I_OBEN) / 2          #  1,75
I_SOCKEL_H = -I_UNTEN                        #  0,24
I_SOCKEL_CZ = I_UNTEN / 2                    # -0,12
I_HAUBE_H  = I_OBEN - HOEHE                  #  0,24
I_HAUBE_CZ = (HOEHE + I_OBEN) / 2            #  3,62

# Endstreifen des Paneels (b): 6 cm breit ueber die Paneelkante hinaus, aber
# nur bis 3 cm VOR die Ziegelfront. In einem geraden Wandlauf verschwindet er
# damit hinter den Ziegeln des Nachbarpaneels (keine koplanaren Flaechen, kein
# Flackern); in der Innenecke schliesst er die Saeule bis auf eine 3-cm-Nut,
# die wie eine Moertelfuge aussieht und nach aussen dicht ist.
ECK_TIEFE  = 0.03              # Rueckversatz der Streifen-Vorderseite
# Dieselben 3 cm gelten im Fels-Stil, und sie sind dort die STRENGERE
# Zahl: Sie legen fest, wie weit die Frontschicht am Modulrand
# zurueckweichen darf. Reicht sie tiefer, klafft in der Innenecke ein
# Schlitz zwischen Streifen und Fels (gemessen: 2353 helle Pixel im
# Naht-Rendering). Deshalb steht in felsrelief.py `RAND_NIVEAU` +
# `RAND_STREUUNG` <= 3 cm, und deshalb steht die Begruendung an BEIDEN
# Stellen — die Zahl ist eine Absprache zwischen zwei Dateien.
#
# Die BREITE des Streifens bleibt in beiden Stilen 6 cm. Sie stand frueher
# als `PROT` in `endstreifen()` — mit der stilabhaengigen Reliefdicke waere
# daraus im Fels 9 cm geworden, und die Huellbox des Paneels waere von
# +-1,06 auf +-1,09 gewachsen. `DG_RockVault` ist ein ABGELEITETES Kit; es
# darf keine andere `size` haben als sein Stamm.
ECK_BREITE = 0.06

# Innenwaende der Zellvarianten liegen INNERHALB der 2x2-Zelle, buendig an der
# Zellkante: Aussenflaeche auf +-1,0, Reliefseite zur Zellmitte hin.
#   Rueckplatte  +-(1,0 .. 0,76)  -> Mitte +-0,88
#   Reliefschicht +-(0,76 .. 0,70) -> Mitte +-0,73
W_BACK   = GRID / 2 - RUECK / 2          # 0,88
W_RELIEF = GRID / 2 - RUECK - PROT / 2   # 0,73

# ACHSEN-SPICKZETTEL (Bauraum Blender -> ausgelieferter glTF, inkl. Vorspiegeln):
#   gltf_x = -blender_x     gltf_y = blender_z     gltf_z = -blender_y
# Also: Zellrichtung Ost (gltf +x) = blender -x, Nord (gltf +z) = blender -y,
# Sued (gltf -z) = blender +y, West (gltf -x) = blender +x.


def neu():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# Flaechen eines Sechsflaechners ueber acht Ecken in der Reihenfolge
# (x aussen, y mitte, z innen). Die Wicklung richtet spaeter
# normals_make_consistent, deshalb genuegt EINE Liste fuer Box und Keil.
QUADS = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1),
         (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]


def box(bm, cx, cy, cz, sx, sy, sz):
    """Achsenparallele Box mittig (cx,cy,cz), Kantenlaengen (sx,sy,sz)."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    verts = [bm.verts.new((cx + dx * hx, cy + dy * hy, cz + dz * hz))
             for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)]
    bm.verts.ensure_lookup_table()
    for a, b, c, d in QUADS:
        bm.faces.new((verts[a], verts[b], verts[c], verts[d]))


def tapered_post(bm, x0, x1, t0, t1, cy, cz, sz):
    """Prisma ueber [x0, x1], dessen TIEFE (y) von t0 auf t1 laeuft.

    Das Gegenstueck zu `box()` fuer die einzige Stelle, an der ein Bauteil
    nicht quaderfoermig sein darf: das Aussenende des Torbogenpfostens
    (s. `bogen()`, nur `--stil fels`). Eckenreihenfolge wie in `box()`
    (x aussen, y mitte, z innen), damit dieselbe `QUADS`-Liste passt.
    """
    # Aufsteigend in x, egal wie herum der Aufrufer die Enden nennt: Die
    # Wicklung von `QUADS` haengt an der Reihenfolge, ein vertauschtes Paar
    # baut das Prisma also spiegelverkehrt. `normals_make_consistent` in
    # `aufbereiten()` richtet das an einem GESCHLOSSENEN Koerper wieder
    # (nachgemessen: dasselbe signierte Volumen mit und ohne Tausch) — die
    # Zeile kostet nichts und nimmt der naechsten Aenderung die Falle ab.
    if x0 > x1:
        x0, x1, t0, t1 = x1, x0, t1, t0
    verts = []
    for x, t in ((x0, t0), (x1, t1)):
        for dy in (-1, 1):
            for dz in (-1, 1):
                verts.append(bm.verts.new((x, cy + dy * t / 2,
                                           cz + dz * sz / 2)))
    bm.verts.ensure_lookup_table()
    for a, b, c, d in QUADS:
        bm.faces.new((verts[a], verts[b], verts[c], verts[d]))


# Name der Farbschicht, unter dem die Verschattung ins GLB geht. Er steht
# hier UND in `pruefung/fels-cavity.mjs`; im Spiel zaehlt nur, dass es
# COLOR_0 ist (Babylon liest den Namen nicht).
CAVITY_SCHICHT = "Cavity"
SCHARF_WINKEL = 40.0 if NETZ_QUELLE else 14.0


def aufbereiten(name, bm, materialname):
    """Ein bmesh zum fertigen Objekt machen: aufraeumen, EIN Material,
    in x vorspiegeln. Gibt das Objekt zurueck, exportiert aber nicht."""
    # Verschattung: alles, was `fels_schicht` NICHT gesetzt hat, auf Weiss.
    # Die Alphastelle traegt die Auskunft — sie ist 0, solange niemand
    # geschrieben hat, und 1, wo eine Verschattung steht. Ohne diesen
    # Durchgang stuenden Rueckplatte, Sockel und Deckel auf Schwarz.
    farbe = bm.verts.layers.float_color.get(CAVITY_SCHICHT)
    if farbe is not None:
        for v in bm.verts:
            if v[farbe][3] < 0.5:
                v[farbe] = (1.0, 1.0, 1.0, 1.0)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-4)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    if STIL == "fels":
        # ── Warum die Fels-Frontschicht WEICH schattiert wird ──────────
        # Sie ist eine unterteilte Flaeche im 0,125-m-Raster. Flach
        # schattiert bekommt jedes Viereck seine eigene Normale, und im
        # Streiflicht liest sich die Wand dann als SCHACHBRETT aus
        # Grautoenen — der zweite Kontaktbogen vom 05.09.2026 zeigt das
        # deutlicher als jede Beschreibung. Fels hat aber nicht alle 12 cm
        # eine Kante, sondern grosse Bruchflaechen mit scharfen Raendern.
        #
        # Genau das stellt diese Stelle her: Die Flaechenvierecke der
        # Frontschicht sind bei ihrer Erzeugung als `smooth` gesetzt
        # (fels_schicht), Schuerze, Deckel und alle Quader nicht (das ist
        # der bmesh-Vorgabewert). Zusaetzlich wird jede Kante ab
        # SCHARF_WINKEL als scharf markiert — die Kluefte und die
        # Facettenraender bleiben also Kanten, das Innere einer
        # Bruchflaeche wird glatt. `shade_flat()` unterbliebe sonst; es
        # wuerde die Marken gerade wieder loeschen. Im Ziegel-Stil
        # aendert sich NICHTS.
        #
        # ── 14 Grad beim Hoehenfeld, 40 beim Netz (05.09.2026, Weg 2) ──
        # Beim Gitter mussten die 14 Grad sein: Ein Hoehenfeld auf einem
        # 6,25-cm-Raster hat KEINE Kanten ausser denen zwischen zwei
        # Rasterzellen, und ohne Marke waere die ganze Wand eine weiche
        # Delle. Der Preis stand im Kontaktbogen — jede Rasterzelle
        # bekam ihre eigene Glanzseite, und die Wand las sich als
        # zersplittertes Glas.
        # Das gescannte Netz bringt seine Kanten selbst mit; dort trennt
        # 40 Grad die echte Bruchkante vom Facettenrand der Dezimierung.
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.mark_sharp(clear=True)
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.mesh.select_mode(type="EDGE")
        bpy.ops.mesh.edges_select_sharp(sharpness=math.radians(SCHARF_WINKEL))
        bpy.ops.mesh.mark_sharp()
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.object.mode_set(mode="OBJECT")
    if STIL != "fels":
        bpy.ops.object.shade_flat()

    # Ein Materialslot. Der Name ist beliebig: im Spiel ersetzt ihn
    # DungeonSteinMaterial anhand der Weltnormale.
    mat = bpy.data.materials.new(materialname)
    mat.use_nodes = True
    me.materials.append(mat)

    # Die Farbschicht muss AKTIV sein, sonst nimmt der glTF-Ausgang sie
    # nicht mit (`export_vertex_color='ACTIVE'`, s. `fertig()`).
    if me.color_attributes and CAVITY_SCHICHT in me.color_attributes:
        me.color_attributes.active_color = me.color_attributes[CAVITY_SCHICHT]
        me.color_attributes.render_color_index = \
            me.color_attributes.find(CAVITY_SCHICHT)

    # Vorspiegeln: x negieren, Wicklung bleibt -> Mesh wird "innen aussen",
    # genau wie bei allen Steingrab-Modulen. Babylons __root__ dreht es zurueck.
    for v in me.vertices:
        v.co.x = -v.co.x
    return o


# ── Kollisionslauf: dasselbe Modul noch einmal, nur glatt ───────────────────
# Mass (A) vom 05.09.2026. Ein `_col`-Netz ERSETZT die Kollision des ganzen
# Prefabs (s. `fertig()`) — es muss also ALLES abdecken, woran die Figur
# heute anstoesst: Boden, Decke, Rueckplatten, Pfosten, Sturz. Genau
# deshalb wird es nicht von Hand modelliert, sondern das Modul wird ein
# ZWEITES MAL gebaut, mit einem einzigen Unterschied: `fels_schicht()`
# legt einen glatten Quader statt des Hoehenfeldes (s. dort).
#
# Warum nicht ein paar Quader von Hand: Die Kollision, die heute steht, IST
# das sichtbare Netz. Wer sie durch eine Handskizze ersetzt, ersetzt sie
# durch etwas, das an einer Stelle anders ist, die niemand aufgeschrieben
# hat — die Bodenfugen, der Einstich in die Deckenplatte, der Sockel unter
# dem Paneel. Der zweite Bau kann diesen Fehler gar nicht machen: Er
# durchlaeuft dieselben Zeilen.
#
# Der Preis sind ein paar hundert Dreiecke je Modul (Boden und Decke als
# 4x4-Platten). Sie sind billiger als die 2300, die Havok bis heute
# angefasst hat.
KOLL_MODUS = False        # baut gerade den Kollisionslauf?
_KOLL_BM = None           # sein bmesh, vom Kollisionslauf abgelegt
_KOLL_BEREIT = None       # dasselbe bmesh, vom Bildlauf abgeholt


def baue(modul, f):
    """Ein Modul bauen — im Fels-Stil zweimal, wenn es Fels-Frontschicht traegt.

    Erst der Kollisionslauf (er legt sein bmesh in `_KOLL_BEREIT` ab und
    exportiert nichts), dann der Bildlauf, dessen `fertig()` das abgelegte
    Netz als `<Name>_col` mitnimmt.

    Die Treppe steht NICHT in `KOLL_MODULE`: sie bringt ihr eigenes,
    handgeschriebenes Kollisionsnetz mit (`treppe_kollision()`), und das
    ist mehr als eine glatte Wand — es legt die Rampe unter die Stufen.
    """
    global KOLL_MODUS, _KOLL_BEREIT
    _KOLL_BEREIT = None
    if STIL == "fels" and modul in KOLL_MODULE:
        KOLL_MODUS = True
        try:
            f()
        finally:
            KOLL_MODUS = False
        _KOLL_BEREIT = _KOLL_BM
    f()
    _KOLL_BEREIT = None


def fertig(name, bm, koll=None):
    """Modul ablegen. `koll` ist ein optionales zweites bmesh: das reine
    KOLLISIONSNETZ, das als Mesh `<name>_col` mit dem Material `Kollision`
    in DIESELBE GLB wandert.

    KONVENTION `_col` (03.09.2026, s. client/src/engine/AssetManager.ts):
    Ein Mesh, dessen Name auf `_col` endet, wird im Spiel NICHT gezeichnet,
    wirft keinen Schatten, bekommt kein Steinmaterial — und ERSETZT die
    Kollision des ganzen Prefabs. Die sichtbare Geometrie kollidiert dann
    gar nicht mehr.

    Der Grund steht an der Treppe: Die Spielerkapsel hat 0,4 m Radius, an
    einer 0,25-m-Setzstufe liegt die Kontaktnormale bei rund 68 Grad — weit
    ueber der Steigungsgrenze von 40. Aus den gerenderten Stufen gebacken
    ist die Treppe unbegehbar; das `_col`-Netz legt die glatte Rampe unter.

    Seit dem 05.09.2026 haben auch die Fels-WANDMODULE eins — dort aus
    demselben Grund in umgekehrter Richtung: nicht weil das sichtbare Netz
    zu steil ist, sondern weil es zu TIEF sein soll. Es kommt aus dem
    Kollisionslauf (s. `baue()`) und wird hier abgeholt.
    """
    global _KOLL_BM
    if KOLL_MODUS:
        # Kollisionslauf: nichts anlegen, nichts ausgeben — nur das Netz
        # merken. `neu()` des Bildlaufs raeumt gleich die ganze Szene ab,
        # ein bmesh haengt aber an keiner Szene und ueberlebt das.
        _KOLL_BM = bm
        return
    if koll is None and _KOLL_BEREIT is not None:
        koll = _KOLL_BEREIT
    name = ausgabename(name)
    o = aufbereiten(name, bm, "StoneVaultStone")
    ausgabe = [o]
    if koll is not None:
        c = aufbereiten(f"{name}_col", koll, "Kollision")
        ausgabe.append(c)

    bpy.ops.object.select_all(action="DESELECT")
    for x in ausgabe:
        x.select_set(True)
    bpy.context.view_layer.objects.active = ausgabe[0]

    # `export_vertex_color`: Die Vorgabe ist 'MATERIAL' — die Schicht kaeme
    # dann nur mit, wenn das Material sie liest, und unsere Materialien
    # sind blosse Platzhalter (das Steinmaterial setzt der Client). Im
    # Ziegel-Stil bleibt die Vorgabe stehen, damit die zwoelf
    # ausgelieferten GLB byte-gleich bleiben — dort gibt es auch keine
    # Schicht.
    zusatz = {}
    if STIL == "fels":
        zusatz = {"export_vertex_color": "ACTIVE", "export_all_vertex_colors": False}
    bpy.ops.export_scene.gltf(filepath=f"{OUT}/{name}.glb",
                              export_format="GLB", use_selection=True,
                              **zusatz)
    for x in ausgabe:
        print(f"MODUL OK -> {name}.glb  mesh {x.name} "
              f"verts {len(x.data.vertices)} faces {len(x.data.polygons)}")


# ── Zelle: Bodenplatte (Oberkante z=0) + Deckenplatte (Unterkante z=3,5) ─────
# Boden als 4x4-Steinplatten mit Fugen auf einer durchgehenden Traegerplatte,
# damit die Fugen keine Loecher sind. Aussenmass bleibt exakt 2,0 x 2,0.
def boden_decke(bm, GX=GRID, GZ=None):
    """Boden- und Deckenplatte einer GX x GZ grossen Grundflaeche (GZ = GX,
    wenn nur ein Mass genannt ist).
    Kachelmass bleibt 0,5 -> das Plattenmuster laeuft ueber Zellgrenzen durch.

    Die beiden Masse sind seit der Hallen-Vorlage GETRENNT: Ein einziges G
    haette jede rechteckige Halle (2x4) zu einem Sonderfall gemacht, und ein
    Sonderfall je Groesse ist genau das, was die Vorlage abschaffen soll."""
    if GZ is None:
        GZ = GX
    HX, HZ = GX / 2, GZ / 2
    # Traegerplatte unten, volle Flaeche -> haelt das Aussenmass und schliesst
    # die Fugen
    box(bm, 0, 0, -DICKE + 0.05 / 2, GX, GZ, 0.05)
    # Platten von z = -0,20 bis z = 0
    kachel, fuge = GRID / 4, 0.03
    nx = int(round(GX / kachel))
    nz = int(round(GZ / kachel))
    for ix in range(nx):
        for iy in range(nz):
            cx = -HX + (ix + 0.5) * kachel
            cy = -HZ + (iy + 0.5) * kachel
            box(bm, cx, cy, -(DICKE - 0.05) / 2,
                kachel - fuge, kachel - fuge, DICKE - 0.05)
    # Deckenplatte: Unterseite exakt bei z = HOEHE, volle Flaeche
    box(bm, 0, 0, HOEHE + DICKE / 2, GX, GZ, DICKE)


def zelle():
    neu()
    bm = bmesh.new()
    boden_decke(bm)
    fertig("StoneVaultCell", bm)


# ── Fels-Frontschicht (--stil fels) ─────────────────────────────────────────
# Setzt das Hoehenfeld aus felsrelief.py als verdraengte Flaeche ins bmesh.
#
# Der Koerper ist eine geschlossene Schale: vorn das Feld auf dem globalen
# Raster (0,125 m), ringsum ein Schuerzenstreifen nach hinten und hinten ein
# Deckel. Warum geschlossen und nicht als offene Haut auf der Rueckplatte:
#   * `normals_make_consistent(inside=False)` richtet die Wicklung an einer
#     offenen Haut nach einer Heuristik. Ein geschlossener Koerper hat ein
#     Innen — die Richtung ist dann keine Vermutung mehr.
#   * Der Deckel liegt RUECK_EINSTICH tief IN der Rueckplatte statt auf ihr.
#     Koplanare Flaechen flimmern; 2 mm darin sieht niemand.
# Der Ring traegt beides, Schuerze und Deckel, also entstehen die hinteren
# Ecken nur einmal — `remove_doubles` haette sie sonst zu verschmelzen.
RUECK_EINSTICH = 0.002


def fels_schicht(bm, lauf, mitte, sgn, lo, hi, lage=0, z0=0.0, z1=HOEHE,
                 rand_luft=None, zeilen=None, niveau_fn=None,
                 tiefen_fn=None, bezug=0.0, prot=None, hub=None,
                 raster=None):
    """`mitte` ist die Mitte der HEUTIGEN Reliefschicht auf der Festachse,
    `sgn` zeigt nach vorn (zur Raumseite). Daraus folgt die Rueckebene der
    Schicht — vor ihr steht jeder Punkt um seine eigene Tiefe.

    `lage` ist der Zweitschluessel des Feldes: er unterscheidet MODUL und
    WANDSEITE. Zwei Waende desselben Moduls tragen damit verschiedenen Fels,
    und ein Korridor sieht nach links nicht aus wie nach rechts. Die
    MODULGRENZE bleibt davon unberuehrt — dort blendet felsrelief.py auf ein
    variantenfreies Randniveau (s. dort, Zwang 1).

    `niveau_fn` hebt die Flaeche auf eine Steigung (Treppe): sie wird je
    STUETZSTELLE ausgewertet, die Flaeche folgt der Treppenlinie also, statt
    als waagerechte Platte aus ihr herauszuragen.

    `tiefen_fn` ist das Gegenstueck fuer die TIEFE: ein Faktor 0..1 je
    STUETZSTELLE, mit dem der Abstand der Schicht zur Ebene `bezug` auf der
    Festachse skaliert wird. 1 laesst alles, wie es ist — ohne den Parameter
    aendert sich an keinem Modul ein Punkt.

    Warum der Faktor auf den ABSTAND ZU `bezug` geht und nicht bloss auf den
    Vorsprung `tiefe`: Bei einer Rueckplatte wuerde ein Faktor auf `tiefe`
    die Schicht nur flach druecken — sie legte sich auf die Rueckebene, und
    die stuende immer noch da, wo sie stand. Am Torbogen ist genau das der
    Fall (Rueckebene 2 cm vor der Koerpermitte, s. `bogen()`); zurueck muss
    die ganze Flanke, nicht nur ihr Relief.

    `prot`/`hub` setzen Reliefdicke und Hub um (Vorgabe: die Zahlen dieses
    Moduls). Nur der Torbogen ruft damit — er traegt Relief auf BEIDEN
    Flanken und hat deshalb je Flanke weniger Tiefe (s. `BOGEN_PROT`).

    Im KOLLISIONSLAUF (`KOLL_MODUS`, s. `baue()`) entsteht hier statt des
    Hoehenfeldes EIN QUADER, dessen Vorderseite genau auf der Wandflucht
    liegt. Das ist Mass (A) vom 05.09.2026 in einer Anweisung: Die Kapsel
    gleitet an einer glatten Ebene entlang, das Relief steht rein optisch
    dahinter — und darf deshalb 18 statt 9 cm tief sein.
    """
    if prot is None:
        prot = PROT
    if KOLL_MODUS:
        # Glatte Kollisionsflaeche: von der Rueckebene bis zur Vorderkante,
        # ueber die VOLLE Hoehe (z0..z1 ohne `rand_luft` — die 1 cm Luft
        # des Bildes braucht die Kollision nicht, und eine Fuge darin waere
        # eine Stelle, an der die Kapsel haengen bleibt).
        mitte_lauf = (lo + hi) / 2
        laenge = hi - lo
        cz = (z0 + z1) / 2
        hoch = z1 - z0
        if niveau_fn is not None:
            cz += niveau_fn(mitte_lauf)
        if lauf == "x":
            box(bm, mitte_lauf, mitte, cz, laenge, prot, hoch)
        else:
            box(bm, mitte, mitte_lauf, cz, prot, laenge, hoch)
        return
    hinten = mitte - sgn * prot / 2

    def ecke(entlang, hoch, tiefe):
        if niveau_fn is not None:
            hoch = hoch + niveau_fn(entlang)
        fest = hinten + sgn * tiefe
        if tiefen_fn is not None:
            fest = bezug + (fest - bezug) * tiefen_fn(entlang)
        return (entlang, fest, hoch) if lauf == "x" else (fest, entlang, hoch)

    if NETZ_QUELLE:
        # ── Quelle `mesh`: das gescannte Netz IST die Flaeche ──────────
        # Alles Uebrige dieser Funktion bleibt, wie es war — dieselbe
        # Abbildung `ecke()` (samt Treppensteigung und Torbogen-Ruecknahme),
        # dieselbe Farbschicht, dieselbe weiche Schattierung. Was sich
        # aendert, ist allein, WOHER die Ecken kommen: nicht aus einem
        # Gitter, sondern aus dem Scan (felsnetz.py).
        #
        # `dichte` folgt dem Raster, mit dem das Hoehenfeld an derselben
        # Stelle rechnen wuerde: Die Treppe ruft mit dem doppelt so groben
        # TREPPE_RASTER, also mit einem Viertel der Dreiecke je
        # Quadratmeter. So steht die Zahl nicht zweimal da.
        _r = FELS_RASTER if raster is None else raster
        _luft = FELS_RANDLUFT if rand_luft is None else rand_luft
        _hub = (prot - 0.015) if hub is None else hub
        verts, faces, cav = felsnetz.frontschicht(
            lo, hi, z0 + _luft, z1 - _luft, prot, _hub, SEED, lage,
            an_periodengrenze(lo), an_periodengrenze(hi),
            dichte=felsnetz.DICHTE * (FELS_RASTER / _r) ** 2)
        farbe = (bm.verts.layers.float_color.get(CAVITY_SCHICHT)
                 or bm.verts.layers.float_color.new(CAVITY_SCHICHT))
        neu_v = []
        for i, (e, h, t) in enumerate(verts):
            v = bm.verts.new(ecke(e, h, t))
            c = cav[i]
            v[farbe] = (c, c, c, 1.0)
            neu_v.append(v)
        bm.verts.ensure_lookup_table()
        for f in faces:
            try:
                flaeche = bm.faces.new([neu_v[i] for i in f])
            except ValueError:
                # Zwei deckungsgleiche Flaechen — der Boolesche Loeser
                # laesst sie dort zurueck, wo zwei Felsbrocken sich genau
                # beruehren. Die zweite bringt kein Bild und faellt weg.
                continue
            flaeche.smooth = True
        return

    kw = {"seed": SEED, "lage": lage, "z0": z0, "z1": z1,
          "prot": prot, "hub": hub, "raster": raster}
    if rand_luft is not None:
        kw["rand_luft"] = rand_luft
    if zeilen is not None:
        kw["zeilen"] = zeilen
    gitter = fels_gitter(lo, hi, **kw)
    punkte = gitter["punkte"]
    cavity = gitter["cavity"]
    nz = len(punkte)
    nx = len(punkte[0])
    # ── Die Verschattung als Farbschicht (Mass D, 05.09.2026) ──────────
    # Sie wandert als COLOR_0 in die GLB und wird im Spiel multiplikativ
    # aufs Albedo gelegt (client/src/engine/DungeonSteinMaterial.ts). Der
    # Grund steht in `felsrelief.py`, `_cavity`: In der Krypta gibt es kein
    # gerichtetes Licht, an dem sich das Relief zeigen koennte — die
    # Verschattung muss deshalb in der Form stecken, nicht im Licht.
    #
    # Die Schicht wird HIER angelegt, nicht in `aufbereiten`: Nur diese
    # Funktion weiss, welche Ecken zur Frontschicht gehoeren. Alle anderen
    # (Rueckplatte, Sockel, Deckel, Ziegel) bleiben auf dem Vorgabewert
    # und werden in `aufbereiten` auf Weiss gezogen — die Alphastelle ist
    # dabei das Erkennungszeichen: 0 heisst "nie gesetzt".
    farbe = (bm.verts.layers.float_color.get(CAVITY_SCHICHT)
             or bm.verts.layers.float_color.new(CAVITY_SCHICHT))

    vorn = []
    for iz in range(nz):
        zeile = []
        for ix in range(nx):
            v = bm.verts.new(ecke(*punkte[iz][ix]))
            c = cavity[iz][ix]
            v[farbe] = (c, c, c, 1.0)
            zeile.append(v)
        vorn.append(zeile)

    # Der Ring: nur die Randstuetzstellen bekommen einen hinteren Zwilling.
    ring = {}

    def hinter(ix, iz):
        if (ix, iz) not in ring:
            x, z, _ = punkte[iz][ix]
            ring[(ix, iz)] = bm.verts.new(ecke(x, z, -RUECK_EINSTICH))
        return ring[(ix, iz)]

    bm.verts.ensure_lookup_table()

    # Vorderflaeche. WEICH schattiert (s. `aufbereiten`): das Innere einer
    # Bruchflaeche soll eine Flaeche sein, keine Treppe aus Rasterzellen.
    for iz in range(nz - 1):
        for ix in range(nx - 1):
            f = bm.faces.new((vorn[iz][ix], vorn[iz][ix + 1],
                              vorn[iz + 1][ix + 1], vorn[iz + 1][ix]))
            f.smooth = True

    # Schuerze: je Randkante ein Viereck nach hinten. Die vier Laeufe geben
    # zugleich den Ring in Umlaufrichtung, aus dem der Deckel entsteht.
    umlauf = ([(ix, 0) for ix in range(nx)]
              + [(nx - 1, iz) for iz in range(1, nz)]
              + [(ix, nz - 1) for ix in range(nx - 2, -1, -1)]
              + [(0, iz) for iz in range(nz - 2, 0, -1)])
    for k in range(len(umlauf)):
        a = umlauf[k]
        b = umlauf[(k + 1) % len(umlauf)]
        bm.faces.new((vorn[a[1]][a[0]], hinter(a[0], a[1]),
                      hinter(b[0], b[1]), vorn[b[1]][b[0]]))
    bm.verts.ensure_lookup_table()
    bm.faces.new([hinter(ix, iz) for (ix, iz) in umlauf])


# ── Innenwand einer Zellvariante ────────────────────────────────────────────
# Gleiche Ziegel-Parametrik wie das freistehende Wandpaneel (0,5-Ziegel, halber
# Versatz, 8 Reihen): die Kachelung wird IMMER ab -GRID/2 aufgebaut und danach
# auf [lo, hi] beschnitten. So bleibt die Phase erhalten und das Muster laeuft
# an der Zellgrenze in die Nachbarzelle weiter.
def innenwand(bm, lauf, back, relief, lo=-GRID / 2, hi=GRID / 2, lage=0,
              ohne_front=False):
    """lauf: 'x' oder 'y' — Achse, entlang der die Wand laeuft (Blender).
    back/relief: Mitte der Rueckplatte bzw. der Reliefschicht auf der Festachse.
    lage: Feldschluessel der Fels-Frontschicht — er unterscheidet MODUL UND
    WANDSEITE (s. FELD_LAGE). Im Ziegel-Stil bleibt er ohne Wirkung.

    `ohne_front` baut nur den RAHMEN (Rueckplatte, Sockel, Haube). Das
    Eckmodul braucht das: Dort werden die beiden Frontschichten nicht
    nebeneinander gelegt, sondern zu EINER Haut vereinigt (s. `ecke()`)."""
    def platte(mitte_lauf, laenge, fest, tiefe, cz, hoehe):
        if lauf == "x":
            box(bm, mitte_lauf, fest, cz, laenge, tiefe, hoehe)
        else:
            box(bm, fest, mitte_lauf, cz, tiefe, laenge, hoehe)

    # Rueckplatte, auf [lo, hi] beschnitten. Seit dem Nahtschluss reicht sie
    # von -0,25 bis 3,75, steckt also in Boden- und Deckenplatte.
    platte((lo + hi) / 2, hi - lo, back, RUECK, I_CZ, I_H)

    # Sockel und Haube ueber die volle Wandtiefe (Rueckplatte + Relief,
    # +-0,70 .. +-1,00). Unter dem Boden und ueber der Decke unsichtbar,
    # schliessen aber die Steinplattenfugen bzw. die Haarlinie an der Decke.
    sgn = 1.0 if back > 0 else -1.0
    aussen = back + sgn * RUECK / 2                  # +-1,00
    innen = relief - sgn * PROT / 2                  # +-0,70
    voll_mitte, voll_tiefe = (aussen + innen) / 2, abs(aussen - innen)
    platte((lo + hi) / 2, hi - lo, voll_mitte, voll_tiefe, I_SOCKEL_CZ, I_SOCKEL_H)
    platte((lo + hi) / 2, hi - lo, voll_mitte, voll_tiefe, I_HAUBE_CZ, I_HAUBE_H)

    if STIL == "fels":
        # Die Reliefschicht liegt hier zur Zellmitte hin: `relief` ist ihre
        # Mitte, `sgn` zeigt von der Rueckplatte weg.
        if not ohne_front:
            fels_schicht(bm, lauf, relief, -1.0 if back > 0 else 1.0,
                         lo, hi, lage=lage)
        return

    bw, fuge = 0.5, 0.02
    reihen = 8
    rh = HOEHE / reihen                      # 0,4375
    for r in range(reihen):
        cz = (r + 0.5) * rh
        versatz = (bw / 2) if (r % 2) else 0.0
        x = -GRID / 2 - versatz
        while x < GRID / 2 - 1e-4:
            bx0 = max(x, lo)
            bx1 = min(x + bw, hi)
            w = bx1 - bx0 - fuge
            if w > 0.05:
                platte((bx0 + bx1) / 2, w, relief, PROT, cz, rh - fuge)
            x += bw


# ── Feldschluessel der Fels-Frontschicht ────────────────────────────────────
# Der Befund vom 05.09.2026 lautete: „die Blockanordnung wiederholt sich alle
# 2 m". Ein Modul weiss nicht, wo es steht — sein Feld MUSS in x 2 m periodisch
# sein, sonst reisst die Naht. Gegen die Wiederholung hilft deshalb nur
# VERSCHIEDENHEIT: Jede Wandflaeche des Kits bekommt hier ihren eigenen
# Schluessel. Zwei Waende desselben Korridors tragen damit anderen Fels, und
# die drei Paneelvarianten (A/B/C) sind drei verschiedene Felsen in derselben
# Huellbox.
#
# Die Zahlen selbst sind beliebig, nur verschieden muessen sie sein. Sie
# stehen als TAFEL und nicht verstreut an den Aufrufen, damit ein zweiter
# Blick sofort sieht, dass keine zweimal vergeben ist — eine doppelte Zahl
# hiesse: dieselbe Wand zweimal, und genau davon soll es weniger geben.
FELD_LAGE = {
    "WandA": 10, "WandB": 11, "WandC": 12,
    "KorridorOst": 20, "KorridorWest": 21,
    "EckeWest": 22, "EckeSued": 23,
    "KreuzungWest": 24,
    "TreppeOst": 30, "TreppeWest": 31,
    "BogenPfostenNah": 40, "BogenPfostenFern": 41,
    "BogenSturzNah": 42, "BogenSturzFern": 43,
}


# ── Zellvarianten mit Innenwaenden ──────────────────────────────────────────
# Ost = blender -x, West = blender +x, Sued = blender +y, Nord = blender -y.
def korridor():
    """Waende Ost und West, offen nach Nord (+z) und Sued (-z)."""
    neu()
    bm = bmesh.new()
    boden_decke(bm)
    innenwand(bm, "y", -W_BACK, -W_RELIEF, lage=FELD_LAGE["KorridorOst"])
    innenwand(bm, "y",  W_BACK,  W_RELIEF, lage=FELD_LAGE["KorridorWest"])
    fertig("StoneVaultCorridor", bm)


# ── Die Innenecke: EINE Haut statt zweier (05.09.2026) ─────────────────────
# BEFUND (Mike, Spielbild aus `rock-probe`): „Wo zwei Waende aufeinander-
# stossen, verlaeuft auch das Relief ineinander — das sieht merkwuerdig aus."
#
# Gemessen ist es NICHT eine Durchdringung (0 von 1440 Strahlproben finden
# Material der anstossenden Wand jenseits der Flucht der durchlaufenden; das
# ganze Layout `rock-probe` hat ueber alle 55 Modulpaare kein einziges
# Schnittvolumen ausser 0,74 l am Torbogen). Es ist das GEGENTEIL — ein
# SCHLITZ:
#
#   Die Suedwand endete bei x = 0,70. Das ist die Ebene der GROESSTEN
#   Vorstands der Westwand. Deren Flaeche liegt im Mittel aber 7,3 cm
#   dahinter (Median 7,9, p90 12,0, Maximum 15,4 cm — gemessen an der
#   ausgelieferten `RockVaultCorner.glb`). Also endete der Fels der Suedwand
#   in einer rasierglatten senkrechten Ebene, und dahinter zog sich die
#   Westwand ueber die volle Raumhoehe zurueck: eine 3,5 m hohe Kerbe, die
#   kein Gestein je macht. Das Auge liest sie als „die beiden Reliefs
#   ueberlagern sich", weil an ihr zwei Felsfelder ohne Uebergang
#   aneinanderstossen.
#
# Was hier dagegen steht: Die Suedwand laeuft mit ihrer Frontschicht bis in
# die Rueckplatte der Westwand hinein (ECK_FRONT_HI), und beide Haeute
# werden zu EINEM Koerper VEREINIGT. Danach ist die sichtbare Flaeche die
# aeussere Huelle beider — der Fels biegt um die Ecke, nichts steht vor
# etwas anderem, und es gibt keine Ebene mehr, an der er abreisst.
#
# Warum eine Vereinigung und keine Gehrung: Eine 45-Grad-Ebene wuerde die
# beiden Felder auf einer Linie zusammenfuehren, auf der sie verschieden
# tief stehen — aus dem Schlitz wuerde eine Stufe von derselben
# Groessenordnung. Nur die Huelle beider kennt an jeder Stelle beide
# Tiefen.
#
# Warum das der GENERATOR nicht merkt: Das Eckmodul traegt seine Ecke in
# sich. Huellbox, Ursprung, Connectoren und `gridEdges` bleiben, wie sie
# waren; `DG_RockVault` bleibt ein abgeleitetes Kit, und `DG_StoneVault`
# wird von keiner Zeile hier beruehrt (der ganze Zweig haengt an
# STIL == "fels").
#
# Warum nur das Eckmodul: Von den drei Innenecken des Kits ist es die
# einzige mit dem Fehler. Zwei Versiegelungspaneele treffen sich mit beiden
# Raendern auf dem Randniveau und ergeben eine saubere Kante; ein Paneel
# gegen die Innenwand eines Korridors ebenso (beides gerendert und
# nachgesehen, `~/wov-ai/innenecke/vorher/I-paneelecke.png` und
# `H-korridor-ecke.png`). Nur im Eckmodul stossen zwei FREIE Felsfelder
# aufeinander, weil dort kein Modulrand zwischen ihnen liegt.
VEREINIGUNG_GRAD = 1.5         # Winkelgrenze des begrenzten Aufloesers
                               # nach der Vereinigung (s. `vereinige_front`)
ECK_FRONT_HI = W_BACK          # 0,94: mitten in der Rueckplatte der Westwand
                               # — kein Deckel liegt dort koplanar auf einer
                               # sichtbaren Flaeche, und `an_periodengrenze`
                               # ist dort falsch, die Randregel greift also
                               # nicht (kein Randstreifen mitten im Fels).


def vereinige_front(bm, a, b):
    """Zwei Frontschichten (bmesh) zu EINEM Koerper vereinigen und in `bm`
    ablegen. Boolescher UNION, exakter Loeser.

    Beide Eingaben sind geschlossene Koerper — `felsnetz.frontschicht`
    bricht sonst ab —, und nur an geschlossenen Koerpern ist eine
    Vereinigung definiert.

    Die Verschattung (`CAVITY_SCHICHT`) reist als Eckenattribut mit; der
    exakte Loeser interpoliert sie an den neuen Ecken der Schnittlinie.
    `fels-cavity.mjs` misst am Ende, ob sie noch streut — wer diese Zeile
    kaputtmacht, sieht es dort und nicht erst im Spiel.
    """
    def objekt(name, quelle):
        me = bpy.data.meshes.new(name)
        quelle.to_mesh(me)
        quelle.free()
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        return o

    oa, ob = objekt("frontA", a), objekt("frontB", b)
    bpy.ops.object.select_all(action="DESELECT")
    oa.select_set(True)
    bpy.context.view_layer.objects.active = oa
    m = oa.modifiers.new("vereinigen", "BOOLEAN")
    m.operation = "UNION"
    m.solver = "EXACT"
    m.object = ob
    bpy.ops.object.modifier_apply(modifier=m.name)

    tmp = bmesh.new()
    tmp.from_mesh(oa.data)
    # ── Aufraeumen nach dem Loeser ────────────────────────────────────────
    # Die Schnittlinie zweier rauher Flaechen ist lang, und der exakte
    # Loeser legt an ihr einen Faecher aus sehr duennen Dreiecken an.
    # Gemessen ohne diesen Block: 11 736 Dreiecke aus 4124 + 3710, und die
    # Splitterzahl des Moduls stieg von 327 auf 1140. Der begrenzte
    # Aufloeser nimmt genau die Kanten weg, die zwischen fast
    # gleichgerichteten Flaechen liegen — die Form bleibt, der Faecher
    # geht.
    bmesh.ops.dissolve_degenerate(tmp, dist=1e-5, edges=tmp.edges[:])
    bmesh.ops.dissolve_limit(tmp, angle_limit=math.radians(VEREINIGUNG_GRAD),
                             verts=tmp.verts[:], edges=tmp.edges[:],
                             delimit={"NORMAL"})
    bmesh.ops.triangulate(tmp, faces=[f for f in tmp.faces if len(f.verts) > 4])
    quelle_farbe = tmp.verts.layers.float_color.get(CAVITY_SCHICHT)
    ziel_farbe = (bm.verts.layers.float_color.get(CAVITY_SCHICHT)
                  or bm.verts.layers.float_color.new(CAVITY_SCHICHT))
    tmp.verts.ensure_lookup_table()
    for i, v in enumerate(tmp.verts):
        v.index = i
    neue = []
    for v in tmp.verts:
        w = bm.verts.new((v.co.x, v.co.y, v.co.z))
        if quelle_farbe is not None:
            c = v[quelle_farbe]
            # ── Die Alphaspalte wieder auf 1 ──────────────────────────────
            # An den Ecken der Schnittlinie mischt der Loeser die
            # Eckenfarbe mit dem Vorgabewert (0,0,0,0) des zweiten
            # Koerpers. Gemessen am ersten Bau: Alpha bis herunter auf
            # 0,8066 — und `fels-cavity.mjs` schlaegt darauf rot, zu
            # Recht: Babylons glTF-Lader schliesst aus einer Alphaspalte
            # unter 1, dass das Netz Eckentransparenz traegt, und schoebe
            # das GANZE Fels-Kit in den Alpha-Blend-Pfad.
            # Weil die Mischung linear ist, steckt in RGB derselbe Faktor;
            # das Teilen durch Alpha holt die gebackene Verschattung
            # zurueck, statt sie bloss abzuschneiden.
            a = c[3]
            if a > 0.05:
                w[ziel_farbe] = (min(1.0, c[0] / a), min(1.0, c[1] / a),
                                 min(1.0, c[2] / a), 1.0)
            else:
                w[ziel_farbe] = (1.0, 1.0, 1.0, 1.0)
        neue.append(w)
    bm.verts.ensure_lookup_table()
    offen = 0
    for f in tmp.faces:
        try:
            g = bm.faces.new([neue[v.index] for v in f.verts])
        except ValueError:
            # Wie beim einfachen Fall: zwei deckungsgleiche Flaechen, die
            # der Loeser dort stehen laesst, wo sich zwei Brocken genau
            # beruehren. Die zweite bringt kein Bild.
            offen += 1
            continue
        g.smooth = f.smooth
    tris = sum(len(f.verts) - 2 for f in tmp.faces)
    tmp.free()
    for o in (oa, ob):
        bpy.data.objects.remove(o, do_unlink=True)
    print(f"INNENECKE vereinigt: {tris} Dreiecke, {offen} deckungsgleiche "
          f"Flaechen weggelassen")


def ecke():
    """Waende Sued und West, offen nach Nord (+z) und Ost (+x).
    Die Westwand laeuft durch, die Suedwand stoesst an deren Reliefseite.

    Im Ziegel-Stil stoesst sie stumpf bei x = 0,70 an (unveraendert seit
    dem 03.09.2026: in der SW-Ecke weder Loch noch doppelte Geometrie).
    Im Fels-Stil laeuft ihre Frontschicht bis in die Rueckplatte hinein und
    wird mit der der Westwand VEREINIGT — s. den Block ueber ECK_FRONT_HI.
    """
    neu()
    bm = bmesh.new()
    boden_decke(bm)
    if STIL == "fels" and not KOLL_MODUS:
        # Rahmen beider Waende wie gehabt — Rueckplatte, Sockel und Haube
        # der Suedwand enden weiter bei x = 0,70, nur die HAUT laeuft durch.
        innenwand(bm, "y", W_BACK, W_RELIEF, lage=FELD_LAGE["EckeWest"],
                  ohne_front=True)
        innenwand(bm, "x", W_BACK, W_RELIEF, hi=W_RELIEF - PROT / 2,
                  lage=FELD_LAGE["EckeSued"], ohne_front=True)
        west, sued = bmesh.new(), bmesh.new()
        fels_schicht(west, "y", W_RELIEF, -1.0, -GRID / 2, GRID / 2,
                     lage=FELD_LAGE["EckeWest"])
        fels_schicht(sued, "x", W_RELIEF, -1.0, -GRID / 2, ECK_FRONT_HI,
                     lage=FELD_LAGE["EckeSued"])
        vereinige_front(bm, west, sued)
        fertig("StoneVaultCorner", bm)
        return
    innenwand(bm, "y", W_BACK, W_RELIEF, lage=FELD_LAGE["EckeWest"])   # West, volle Laenge
    innenwand(bm, "x", W_BACK, W_RELIEF, hi=W_RELIEF - PROT / 2,
              lage=FELD_LAGE["EckeSued"])                          # Sued, bis x=0,70
    fertig("StoneVaultCorner", bm)


def kreuzung():
    """Nur Wand West, offen nach Nord, Ost und Sued."""
    neu()
    bm = bmesh.new()
    boden_decke(bm)
    innenwand(bm, "y", W_BACK, W_RELIEF, lage=FELD_LAGE["KreuzungWest"])
    fertig("StoneVaultJunction", bm)


# ── Hallen-Vorlage: Boden + Decke ueber cells_x x cells_z Zellen ───────────
# EINE Funktion fuer alle Saele des Kits. Bis zum 04.09.2026 gab es nur die
# 2x2-Halle als eigene Funktion; mit zwei weiteren Groessen waeren daraus drei
# fast gleiche Funktionen geworden, die beim naechsten Nahtschluss einzeln
# nachzuziehen sind. Die Vorlage haelt Boden, Decke und Nahtschluss an EINER
# Stelle und laesst nur Zellzahl und Namen wandern.
#
# ── Warum ab 4 m Spannweite Pfeiler stehen ─────────────────────────────────
# Die Deckenplatte ist 0,25 dick und traegt sich als Bauteil ohne Statik
# beliebig weit — das Auge nicht: Ein 6 x 6 m grosser Saal mit frei
# schwebender Steindecke liest sich als Halle aus Pappe. Ab einer Spannweite
# ueber 4 m (also ab drei Zellen in einer Achse) stehen deshalb Pfeiler auf
# den INNEREN Zellecken. Die Stelle ist nicht willkuerlich: Die Durchgaenge
# liegen auf den Zellkanten-MITTEN, ein Pfeiler auf einer Zellecke steht also
# nie in einem Weg. 3x3 ergibt vier Pfeiler (x,z je -1 und +1), 2x4 drei in
# der Mittelachse (x = 0; z = -2, 0, +2).
#
# Kollision: Die Halle hat KEIN `_col`-Netz (s. `fertig()`), ihr sichtbares
# Netz IST die Kollisionsform. Die Pfeiler stehen im selben bmesh und
# kollidieren damit von selbst — eine eigene Kollisionskonvention brauchen sie
# nicht.
PFEILER_AB = 4.0        # Spannweite in Metern, ab der Pfeiler stehen
PFEILER_B = 0.50        # Schaft, quadratisch
PFEILER_FUSS = 0.70     # Fuss und Kaempfer, etwas breiter als der Schaft
PFEILER_FUSS_H = 0.25   # Hoehe von Fuss bzw. Kaempfer


def pillar(bm, cx, cy):
    """Ein Stuetzpfeiler auf (cx, cy). Er steckt oben und unten in den Platten
    (I_UNTEN/I_OBEN) — derselbe Nahtschluss wie bei den Innenwaenden, damit an
    Boden und Decke keine koplanaren Flaechen entstehen."""
    box(bm, cx, cy, I_CZ, PFEILER_B, PFEILER_B, I_H)
    box(bm, cx, cy, (I_UNTEN + PFEILER_FUSS_H) / 2,
        PFEILER_FUSS, PFEILER_FUSS, PFEILER_FUSS_H - I_UNTEN)
    box(bm, cx, cy, (HOEHE - PFEILER_FUSS_H + I_OBEN) / 2,
        PFEILER_FUSS, PFEILER_FUSS, I_OBEN - HOEHE + PFEILER_FUSS_H)


def pillar_positions(cells_x, cells_z, raster=GRID):
    """Die inneren Zellecken im Abstand `raster` — leer, solange beide
    Spannweiten <= PFEILER_AB.

    `raster` ist der Abstand ZWISCHEN zwei Pfeilerreihen, gemessen vom Rand
    her, und muss ein Vielfaches von GRID sein (sonst stuenden die Pfeiler
    nicht auf Zellecken, sondern in den Durchgaengen auf den Kantenmitten).

    Vorgabe GRID: jede innere Zellecke traegt einen Pfeiler. Das ist die
    Regel der drei Saele vom 04.09.2026 (Hall 2x2, HallLarge 3x3,
    HallLong 2x4) und bleibt fuer sie unveraendert — bei 6 bzw. 8 m
    Spannweite sind zwei bzw. drei Reihen genau richtig.

    Ab 8 m Spannweite ist sie es nicht mehr: Eine Pfeilerreihe alle 2 m
    ergaebe im 12 x 12 m grossen Saal 25 Pfeiler, also einen Wald statt
    eines Saals — und der Saal ist ja gerade dafuer da, dass es EINMAL
    weit ist. Die grossen Saele bekommen deshalb `raster=4`: freie
    Spannweite hoechstens 4 m (dasselbe Mass, ab dem ueberhaupt ein
    Pfeiler noetig wird), 8 x 8 m traegt einen einzigen Pfeiler in der
    Mitte, 12 x 12 m derer vier."""
    schritt = int(round(raster / GRID))
    if schritt < 1 or abs(schritt * GRID - raster) > 1e-6:
        raise ValueError(f"Pfeilerraster {raster} ist kein Vielfaches von {GRID}")
    sx, sz = cells_x * GRID, cells_z * GRID
    if max(sx, sz) <= PFEILER_AB + 1e-6:
        return []
    xs = [i * GRID - sx / 2 for i in range(schritt, cells_x, schritt)]
    zs = [i * GRID - sz / 2 for i in range(schritt, cells_z, schritt)]
    return [(x, z) for x in xs for z in zs]


def hall_module(cells_x, cells_z, name, pillars=None, raster=GRID):
    """Ein Saal aus cells_x x cells_z Zellen: Boden + Decke, keine Waende,
    Pivot Bodenmitte. `pillars` ueberschreibt die Pfeilerstellen (Liste von
    (x, z)); ohne Angabe entscheidet `pillar_positions` mit `raster`."""
    neu()
    bm = bmesh.new()
    boden_decke(bm, cells_x * GRID, cells_z * GRID)
    stellen = pillar_positions(cells_x, cells_z, raster) if pillars is None else pillars
    for cx, cy in stellen:
        pillar(bm, cx, cy)
    fertig(name, bm)
    print(f"HALLE {name}: {cells_x}x{cells_z} Zellen "
          f"({cells_x * GRID} x {cells_z * GRID} m), {len(stellen)} Pfeiler")


def halle():
    """Boden + Decke 4x4, keine Waende, Pivot Bodenmitte."""
    hall_module(2, 2, "StoneVaultHall")


def halle_gross():
    """3x3 Zellen = 6 x 6 m, vier Pfeiler auf den inneren Zellecken."""
    hall_module(3, 3, "StoneVaultHallLarge")


def halle_lang():
    """2x4 Zellen = 4 x 8 m, drei Pfeiler in der Mittelachse."""
    hall_module(2, 4, "StoneVaultHallLong")


# ── Die beiden grossen Saele (04.09.2026) ───────────────────────────────────
# Sie kosten keine neue Geometrie, nur zwei Zeilen an der Vorlage — genau
# das war der Zweck von `hall_module`. Neu ist allein das Pfeilerraster
# (s. `pillar_positions`): ab 8 m Spannweite steht nicht mehr auf jeder
# inneren Zellecke ein Pfeiler, sondern alle 4 m einer.
def halle_grand():
    """4x4 Zellen = 8 x 8 m, EIN Pfeiler in der Mitte (Raster 4 m)."""
    hall_module(4, 4, "StoneVaultHallGrand", raster=4.0)


def halle_vast():
    """6x6 Zellen = 12 x 12 m, vier Pfeiler auf (+-2, +-2) (Raster 4 m)."""
    hall_module(6, 6, "StoneVaultHallVast", raster=4.0)


# ── Wandpaneel: bündige Rueckplatte + kachelbares versetztes Ziegelrelief ────
# Ziegel 0,5 breit mit halbem Versatz teilen 2 m sauber; an der Paneelkante
# geteilte Ziegel ergeben mit dem Nachbarpaneel wieder ganze -> nahtlos.
# Relief zeigt im glTF nach +z, also in Blender nach -y.
def endstreifen(bm, B):
    """Die beiden Endstreifen des Paneels gegen die offene Innenecke (b).

    Je Ende ein Quader von der Paneelkante 6 cm nach AUSSEN (glTF x
    1,00..1,06 bzw. -1,06..-1,00), in der Tiefe von der Rueckseite bis 3 cm
    hinter die Ziegelfront (glTF z -0,15 .. +0,12), ueber die volle
    Wandhoehe. Damit ist die Rueckplatte zugleich auf x +-1,06 verlaengert.

    Warum nicht bis zur Ziegelfront (0,15)? Dann laege der Streifen in einem
    geraden Wandlauf koplanar auf der Ziegelfront des Nachbarpaneels ->
    Z-Fighting. 3 cm dahinter liegt er im Fugenschatten.
    """
    ty = -TIEFE / 2 + ECK_TIEFE           # -0,12 (glTF z +0,12)
    tiefe = TIEFE / 2 - ty               # 0,27
    for s in (-1, 1):
        box(bm, s * (B / 2 + ECK_BREITE / 2), (ty + TIEFE / 2) / 2, WAND_CZ,
            ECK_BREITE, tiefe, WAND_H)


def wand(variante=""):
    """Das freistehende Wandpaneel (endCap).

    `variante` ist "" (das Paneel des Kits), "B" oder "C". Die drei sind
    Zeichen fuer Zeichen dieselbe Geometrie BIS AUF den Feldschluessel der
    Frontschicht: gleiche Huellbox, gleicher Ursprung, gleicher Connector —
    nur anderer Fels. Genau deshalb darf der Rasterpfad je Kante unter ihnen
    waehlen, ohne dass sich am Grundriss etwas aendert
    (shared/src/dungeonRasterGenerator.ts, S7).

    Im Ziegel-Stil gibt es nur "": `DG_StoneVault` behaelt sein eines
    Paneel, und damit bleiben seine GLBs und die Golden-Staende Byte fuer
    Byte, was sie waren.
    """
    neu()
    bm = bmesh.new()
    B = GRID
    # Rueckplatte: blender y von -0,15+PROT .. +0,15  (glTF z -0,15 .. +0,09).
    # Hoehe seit dem Nahtschluss -0,25 .. 3,75 statt 0 .. 3,5.
    box(bm, 0, TIEFE / 2 - RUECK / 2, WAND_CZ, B, RUECK, WAND_H)
    # Sockel und Haube ueber die VOLLE Tiefe (0,30): sie stehen unter dem
    # Boden bzw. ueber der Decke und sind damit unsichtbar — aber sie decken
    # auch die Reliefschicht ab, unter der sonst die Bodenfugen ins Freie
    # laufen wuerden.
    box(bm, 0, 0, SOCKEL_CZ, B, TIEFE, SOCKEL_H)
    box(bm, 0, 0, HAUBE_CZ,  B, TIEFE, DICKE)
    endstreifen(bm, B)
    ycz = -TIEFE / 2 + PROT / 2              # Reliefmitte auf der Reliefseite
    if STIL == "fels":
        fels_schicht(bm, "x", ycz, -1.0, -B / 2, B / 2,
                     lage=FELD_LAGE["Wand" + (variante or "A")])
        fertig("StoneVaultWall" + variante, bm)
        return
    bw, fuge = 0.5, 0.02
    reihen = 8
    rh = HOEHE / reihen                      # 0,4375
    for r in range(reihen):
        cz = (r + 0.5) * rh
        versatz = (bw / 2) if (r % 2) else 0.0
        x = -B / 2 - versatz
        while x < B / 2 - 1e-4:
            bx0 = max(x, -B / 2)
            bx1 = min(x + bw, B / 2)
            w = bx1 - bx0 - fuge
            if w > 0.05:
                box(bm, (bx0 + bx1) / 2, ycz, cz, w, PROT, rh - fuge)
            x += bw
    fertig("StoneVaultWall", bm)


# ── Torbogen: 2 x 3,5 x 0,3, mittige Oeffnung 1,2 breit x 2,4 hoch mit Bogen ──
# Kaempferhoehe 1,8, darueber Halbkreis r=0,6 bis Scheitel 2,4.
#
# BEIDSEITIG seit 03.09.2026: `placeDoors` setzt den Bogen in die Kopplungsebene
# ZWISCHEN zwei Zellen — von beiden Seiten sieht ihn ein Spieler. Die alte
# Fassung trug ihr Relief nur auf +z und zeigte nach hinten eine glatte Platte.
# Deshalb liegt die Rueckplatte jetzt MITTIG (0,18 dick, y -0,09 .. +0,09) und
# traegt auf beiden Flanken eine Reliefschicht von 0,06.
# Die Gesamttiefe bleibt exakt 0,3 (0,06 + 0,18 + 0,06) und damit auch die
# Bounding-Box — der Dateiname bleibt gleich, also auch der Prefab-Hash.
RUECK_MITTIG = TIEFE - 2 * BOGEN_PROT         # 0,18 (Ziegel) bzw. 0,04 (Fels)

# ── 05.09.2026: das Aussenende der Pfosten laeuft an die Wandflucht heran ───
# BEFUND (gemessen im Layout `rock-probe`, Halle(9,-2) Suedflucht z=-4 und
# Westflucht x=7): In einer Wandflucht aus Versiegelungspaneelen steht der
# Torbogen 15,4 cm VOR dem Fels der Nachbarwand, und was man sieht, ist seine
# STIRNFLAECHE an der Modulgrenze — eine glatte Platte 0,30 m tief, 3,5 m
# hoch, in einer Wand, die sonst ueberall gebrochener Fels ist.
#
# Die Ursache ist eine Ebenen-Verwechslung, und sie steckt nicht im Bogen:
# `sealPose` (shared/src/dungeonRasterGenerator.ts) setzt das PANEEL so, dass
# seine Front GENAU auf der Zellkante liegt und sein Koerper ausserhalb steht.
# Der Torbogen dagegen sitzt MITTIG auf der Kopplungsebene (er wird von beiden
# Zellen gesehen, `ycb = 0`), seine Flanken also 15 cm im Raum. Beide haben
# fuer sich recht; nebeneinander ergeben sie eine Stufe.
#
# Was hier dagegen steht: Die aeusseren `TAPER_LAENGE` des Pfostens laufen auf
# `TAPER_REST` ihrer Tiefe zurueck. Aus der Stufe wird eine Schraege von rund
# 26 Grad, aus 15,4 cm Vorstand werden rund 4 cm — die Groessenordnung, die
# der Nahtschluss ohnehin zulaesst (`ECK_TIEFE` = 3 cm).
#
# Warum das die Laibung nicht beruehrt: Der Rueckzug beginnt erst bei
# |x| = 0,75, also AUSSERHALB des Sturzbandes (+-0,75) und weit ausserhalb
# der Oeffnung (+-0,60). Das Durchgangsfenster, das
# `stonevault-kantensonde` misst, aendert sich um keinen Millimeter.
#
# Warum es auf der anderen Seite nichts verdirbt: Grenzt an den Bogen statt
# eines Paneels die INNENWAND eines Moduls (Korridor, Ecke, Abzweig), dann
# liegt deren Koerper auf |x| = 0,70..1,00 — genau ueber dem zurueckgenommenen
# Stueck. Dort steckt der Pfostenrand IM Nachbarn und war noch nie zu sehen.
#
# Warum NUR im Fels-Stil: `DG_StoneVault` ist ausgeliefert, seine zwoelf GLB
# sind Golden-Staende (`server/test/golden-kits.ts`, `kit-neubau.mjs`). Die
# Stufe gibt es dort auch (dann exakt 15,0 cm, weil beide Fronten Ebenen
# sind) — sie ist dort aber eine Kante zwischen zwei glatten Ziegelwaenden
# und kein Fremdkoerper in einer Felswand. Wer sie im Ziegelkit auch
# beheben will, baut damit ein neues Kit, nicht dieses.
TAPER_LAENGE = 0.25     # Laenge des Rueckzugs, vom Modulrand nach innen
TAPER_REST = 0.20       # Resttiefe am Modulrand, als Anteil der vollen Flanke
# Warum sich Quader und Keil UEBERLAPPEN, statt Kante an Kante zu stossen:
# Bei genau anstossenden Enden verschmilzt `remove_doubles` die vier Ecken,
# und mitten im Material bleiben ZWEI deckungsgleiche Vierecke stehen. Sie
# sind zwar nie zu sehen, aber `normals_make_consistent` muss an ihnen raten,
# und das signierte Volumen (die Zahl, an der `check-mirror.py` haengt) zaehlt
# sie doppelt: gemessen -1,2508 statt der zu erwartenden -1,03. Zwei
# Zentimeter Ueberlappung sind dieselbe Bauweise wie ueberall sonst in dieser
# Datei — Koerper durchdringen einander, sie beruehren sich nicht.
TAPER_STOSS = 0.02      # Ueberlappung Quader/Keil


def taper_faktor(x):
    """Der Tiefenfaktor des Pfostens an der Stelle x (Bauraum Blender).

    1 bis |x| = GRID/2 - TAPER_LAENGE, dann weich auf TAPER_REST am
    Modulrand. WEICH (smoothstep) und nicht linear, weil eine geknickte
    Flanke im Streiflicht genau die helle Linie zeichnet, gegen die der
    Rueckzug gebaut ist.
    """
    d = (abs(x) - (GRID / 2 - TAPER_LAENGE)) / TAPER_LAENGE
    d = min(1.0, max(0.0, d))
    return 1.0 - (1.0 - TAPER_REST) * d * d * (3.0 - 2.0 * d)


def bogen():
    neu()
    bm = bmesh.new()
    B, T = GRID, TIEFE
    oeff_b, kaempfer = 1.2, 1.8
    r = oeff_b / 2                            # 0,6 -> Scheitel bei 2,4
    pf = (B - oeff_b) / 2                     # Pfostenbreite 0,4 je Seite
    ycb = 0.0                                 # Koerpermitte: mittig statt buendig
    RM = RUECK_MITTIG
    # Pfosten links/rechts, volle Hoehe (Nahtschluss: -0,25 .. 3,75)
    if STIL == "fels":
        # Im Fels-Stil in zwei Stuecken: das innere bleibt der Quader von
        # frueher, das aeussere laeuft auf die Wandflucht zurueck (s.
        # TAPER_LAENGE). Der Kern folgt DEMSELBEN Faktor wie die
        # Frontschicht, sonst stuende er hinterher vor ihr.
        innen = pf - TAPER_LAENGE + TAPER_STOSS         # 0,17
        for s in (-1, 1):
            box(bm, s * (B / 2 - pf + innen / 2), ycb, I_CZ, innen, RM, I_H)
            tapered_post(bm, s * (B / 2 - TAPER_LAENGE), s * B / 2,
                         RM, RM * TAPER_REST, ycb, I_CZ, I_H)
    else:
        box(bm, -B / 2 + pf / 2, ycb, I_CZ, pf, RM, I_H)
        box(bm,  B / 2 - pf / 2, ycb, I_CZ, pf, RM, I_H)
    # Sockel NUR unter den Pfosten (die Oeffnung muss offen bleiben) und
    # Haube ueber die volle Breite — ueber y=3,5 ist der Bogen ohnehin
    # durchgehend Mauerwerk. Beide ueber die volle Tiefe 0,30.
    box(bm, -B / 2 + pf / 2, ycb, I_SOCKEL_CZ, pf, T, I_SOCKEL_H)
    box(bm,  B / 2 - pf / 2, ycb, I_SOCKEL_CZ, pf, T, I_SOCKEL_H)
    box(bm, 0, ycb, I_HAUBE_CZ, B, T, I_HAUBE_H)
    # Mauerwerk ueber der Oeffnung: Scheiben folgen der Bogenkontur
    scheiben = 26
    sb = oeff_b / scheiben
    for i in range(scheiben):
        cx = -r + (i + 0.5) * sb
        h = kaempfer + math.sqrt(max(r * r - cx * cx, 0.0))
        box(bm, cx, ycb, (h + I_OBEN) / 2, sb, RM, I_OBEN - h)
    # Reliefschicht: Ziegel auf den Pfosten, Sturzband ueber dem Scheitel.
    # Zweimal — einmal je Flanke (glTF z = +0,12 und -0,12).
    reihen, fuge = 8, 0.02
    rh = HOEHE / reihen
    BP = BOGEN_PROT
    for flanke, (yr, sgn) in enumerate(((-T / 2 + BP / 2, -1.0),
                                        (T / 2 - BP / 2, 1.0))):
        pfosten_lage = FELD_LAGE["BogenPfostenNah" if flanke == 0 else "BogenPfostenFern"]
        sturz_lage = FELD_LAGE["BogenSturzNah" if flanke == 0 else "BogenSturzFern"]
        if STIL == "fels":
            # Die Pfostenflanken schneiden aus DEMSELBEN Gitter wie die
            # Wandpaneele — der Bogen sitzt in der Kopplungsebene zwischen
            # zwei Zellen, seine Bloecke muessen mit den anschliessenden
            # Waenden fluchten. Die Laibung bei +-0,6 ist ein innerer
            # Anschlag: dort blendet felsrelief.py NICHT auf das
            # Randniveau, damit neben der Tuer keine Nut steht.
            # `tiefen_fn`/`bezug`: die Flanke wird zum Modulrand hin auf die
            # Koerpermitte zu zurueckgenommen (s. TAPER_LAENGE ueber
            # `bogen()`). Ohne diese beiden Argumente ist es der Aufruf von
            # gestern — der Ziegelzweig unten sieht sie nie.
            fels_schicht(bm, "x", yr, sgn, -B / 2, -B / 2 + pf, lage=pfosten_lage,
                         tiefen_fn=taper_faktor, bezug=ycb,
                         prot=BP, hub=BOGEN_HUB)
            fels_schicht(bm, "x", yr, sgn, B / 2 - pf, B / 2, lage=pfosten_lage,
                         tiefen_fn=taper_faktor, bezug=ycb,
                         prot=BP, hub=BOGEN_HUB)
            # Sturzband: eigener Feldschluessel, sonst saesse ueber der Tuer
            # dasselbe Feld wie auf den Pfosten. Zwei Zeilen genuegen — das
            # Band ist 18 cm hoch, ein 12,5-cm-Raster waere darin sinnlos.
            fels_schicht(bm, "x", yr, sgn,
                         -(oeff_b + 0.30) / 2, (oeff_b + 0.30) / 2,
                         lage=sturz_lage, zeilen=2, rand_luft=0.0,
                         z0=kaempfer + r + 0.01, z1=kaempfer + r + 0.19,
                         prot=BP, hub=BOGEN_HUB)
            continue
        for s in (-1, 1):
            for i in range(reihen):
                cz = (i + 0.5) * rh
                breite = pf - fuge - (0.10 if i % 2 else 0.0)
                cx = s * (B / 2 - pf / 2) + s * (0.05 if i % 2 else 0.0)
                box(bm, cx, yr, cz, breite, PROT, rh - fuge)
        box(bm, 0, yr, kaempfer + r + 0.10, oeff_b + 0.30, BP, 0.18)  # Sturzband
    fertig("StoneVaultArch", bm)


# ── Treppe: 2 (x) x LAUF (z), steigt von y=0 (Sued) auf y=3,5 (Nord) ────────
# Das erste Modul des Kits, das zwei Ebenen verbindet — gebaut nach dem
# Vorbild `SteingrabTreppe`: Der obere Connector sitzt auf dem NIVEAU des
# oberen Bodens (dort y=8, hier y=3,5), und `size.y` umfasst Steigung PLUS
# Kopfraum (dort 8+4=12, hier 3,5+3,5=7). Mit `roomBodyFromFloor` liegt die
# Huelle damit von y=0 bis y=7 — Boden unten, Decke ueber dem oberen Ende.
#
# 14 Stufen zu 0,25 Steigung, Auftritt LAUF/14. Die Sued-KANTE (glTF
# z=-LAUF/2) liegt auf y=0, die erste Trittflaeche also auf 0,25; die letzte
# auf 3,5 und reicht bis zur Nord-Kante (glTF z=+LAUF/2). Damit passt jedes
# Ende ohne Stufe an eine normale Zelle.
#
# ── ZELLEN_LAUF: Warum drei Zellen und nicht zwei ──────────────────────────
# Die Steigung der Treppe darf `STEIGUNGS_GRENZE_GRAD` = 40 Grad nicht
# erreichen — so viel laesst der Charaktercontroller der Figur zu
# (client/src/player/PlayerController.ts, dort `maxSlopeCosine`). Darueber
# traegt die Flaeche die Figur nicht mehr, sie rutscht ab.
#
# Die erste Fassung (3.9.2026) lief ueber ZWEI Zellen: 3,5 m auf 4 m Lauf
# = 41,2 Grad. Einen Grad zu steil — im Rendering nicht zu sehen, im Spiel
# nicht zu begehen. Mit DREI Zellen sind es 3,5 m auf 6 m = 30,3 Grad
# (`SteingrabTreppe` hat zum Vergleich 33,7 Grad und funktioniert).
#
# Wer hier weiterdreht: Der Winkel ist atan(HOEHE / LAUF) in Grad, und die
# Kit-Werte in shared/src/eigeneDungeons.ts (size.z, Connector-z) muessen
# mitwandern. shared/test/dungeon-raster.ts rechnet beides gegen die Grenze.
# ── Warum die Treppe ein GRÖBERES Raster bekommt (Mass C, 05.09.2026) ──────
# Ihr Lauf ist 6 m lang und ihre Wände sind 3,5 m hoch — auf dem
# 6,25-cm-Raster der Wandpaneele wären das 96 x 56 Felder JE Wand, also rund
# 21 500 Dreiecke für ein einziges Modul. Die Treppe ist dabei das Bauteil,
# an dem man am wenigsten stehenbleibt: Man geht sie hinauf.
#
# 12,5 cm teilen die 2 m weiterhin (Nahtbedingung), und die ZEILEN bleiben
# dieselben 56 wie überall. Das ist die Bedingung, auf die es ankommt: Wo
# eine Treppenwand an eine Zellwand stösst, treffen sich zwei senkrechte
# Kanten, und deren Stützstellen liegen auf den Zeilen — nicht auf dem
# Laufraster.
TREPPE_RASTER = 0.125

ZELLEN_LAUF = 3                     # Zellen, die die Treppe in z belegt
STUFEN = 14
STUFE_H = HOEHE / STUFEN            # 0,25 Steigung
LAUF = ZELLEN_LAUF * GRID           # 6 m Grundflaeche in Laufrichtung
STUFE_T = LAUF / STUFEN             # 0,428571 Auftritt
STEIG = HOEHE / LAUF                # 0,583333 Hoehe je Meter Lauf
WINKEL = math.degrees(math.atan(STEIG))   # 30,26 Grad — muss < 40 bleiben


def niveau(by):
    """Treppenlinie: Hoehe (blender z) an der Stelle by (blender y).
    by=+LAUF/2 ist die Sued-Kante (0), by=-LAUF/2 die Nord-Kante (3,5)."""
    return (LAUF / 2 - by) * STEIG


def keil(bm, x0, x1, y0, y1, unten, oben):
    """Prisma, dessen Unter- und Oberseite der Treppensteigung folgen:
    z = niveau(y) + unten bzw. niveau(y) + oben. Eckenreihenfolge wie box()."""
    verts = []
    for x in (x0, x1):
        for y in (y0, y1):
            n = niveau(y)
            for d in (unten, oben):
                verts.append(bm.verts.new((x, y, n + d)))
    bm.verts.ensure_lookup_table()
    for a, b, c, d in QUADS:
        bm.faces.new((verts[a], verts[b], verts[c], verts[d]))


def treppe():
    neu()
    bm = bmesh.new()
    H = LAUF / 2                                  # 2,0
    # Stufenbloecke. Jeder reicht 0,5 nach unten, also zwei Steigungen: unter
    # der Trittflaeche bleiben ueberall mindestens 0,25 Material — dieselbe
    # Plattendicke wie beim Zellboden. Der unterste Block endet bei y=-0,25.
    for i in range(STUFEN):
        oben = (i + 1) * STUFE_H                  # Trittflaeche
        cy = H - (i + 0.5) * STUFE_T              # Sued (+y) nach Nord (-y)
        box(bm, 0, cy, oben - STUFE_H, GRID, STUFE_T, 2 * STUFE_H)

    # Decke: schraege Platte parallel zur Treppe, Unterseite auf Niveau+3,5.
    # An der Sued-Kante also 3,5 (wie in jeder Zelle), an der Nord-Kante 7,0.
    keil(bm, -GRID / 2, GRID / 2, -H, H, HOEHE, HOEHE + DICKE)

    # Seitliche Innenwaende wie beim Korridor (glTF x 0,7 .. 1,0), Relief nach
    # innen. Die Rueckplatte ist ein Keil: Unterkante 0,25 unter der
    # Treppenlinie (steckt also in den Stufen), Oberkante an der Decke.
    # NAHTSCHLUSS: Frueher endete der Keil exakt auf HOEHE — genau auf der
    # Deckenunterseite, Kante an Kante, mit derselben Haarlinie wie in den
    # Zellen. Jetzt steckt er IN der Deckenplatte, bleibt aber EINSTICH unter
    # deren Oberseite, damit dort keine koplanaren Flaechen entstehen.
    for s in (-1, 1):
        keil(bm, s * W_BACK - RUECK / 2, s * W_BACK + RUECK / 2, -H, H,
             -DICKE, HOEHE + DICKE - EINSTICH)

    # Ziegelrelief. Die Ziegel sind so breit wie ein Auftritt und steigen mit
    # der Treppe — jede Schar versetzt sich um eine halbe Ziegelbreite, wie im
    # senkrechten Wandpaneel. Achsenparallele Kaesten, deren Mitte auf der
    # Treppenlinie sitzt: die Lagerfugen laufen als Staffel mit, statt die
    # schraege Wand mit einem waagerechten Verband zu zerschneiden.
    reihen, fuge = 8, 0.02
    rh = HOEHE / reihen                           # 0,4375
    if STIL == "fels":
        # Dieselbe Frontschicht wie in den Waenden, nur auf die Steigung
        # gehoben: `niveau` wird je ECKE ausgewertet, die Bloecke folgen der
        # Treppenlinie also als Keile.
        #
        # Warum die Treppe ueberhaupt mitkommt, obwohl das Konzept nur
        # innenwand/wand/bogen nennt: Ihre Seitenwaende tragen dieselbe
        # Ziegelschicht wie der Korridor. Bliebe sie im Fels-Kit stehen,
        # waere `DG_RockVault` ein Fels-Grab mit einer gemauerten Treppe —
        # und das faellt im Spiel als erstes auf. Stufen, Decke, Rueckplatte
        # und das `_col`-Netz bleiben unangetastet.
        #
        # Der Lauf ist 6 m = drei Perioden des Gitters: die Bloecke fluchten
        # mit denen der anschliessenden Zellwaende.
        for s in (-1, 1):
            fels_schicht(bm, "y", s * W_RELIEF, -float(s), -H, H,
                         lage=FELD_LAGE["TreppeOst" if s < 0 else "TreppeWest"],
                         niveau_fn=niveau, raster=TREPPE_RASTER)
        fertig("StoneVaultStairs", bm, treppe_kollision())
        return
    for s in (-1, 1):
        for r in range(reihen):
            versatz = (STUFE_T / 2) if (r % 2) else 0.0
            y = -H - versatz
            while y < H - 1e-4:
                y0 = max(y, -H)
                y1 = min(y + STUFE_T, H)
                laenge = y1 - y0 - fuge
                if laenge > 0.05:
                    cy = (y0 + y1) / 2
                    cz = niveau(cy) + (r + 0.5) * rh
                    box(bm, s * W_RELIEF, cy, cz, PROT, laenge, rh - fuge)
                y += STUFE_T
    fertig("StoneVaultStairs", bm, treppe_kollision())


# ── Kollisionsnetz der Treppe (`StoneVaultStairs_col`) ──────────────────────
# Warum die Treppe eins braucht (Konvention s. `fertig()` und
# client/src/engine/AssetManager.ts): Der PhysicsCharacterController der Figur
# ist eine Kapsel mit 0,4 m Radius. An einer 0,25-m-Setzstufe beruehrt sie die
# Kante bei acos((0,4-0,25)/0,4) = 68 Grad — die Steigungsgrenze liegt bei 40.
# Die Figur bleibt also an der ERSTEN Stufe stehen, obwohl die Treppe als
# Ganzes nur 30,3 Grad steigt. Gemessen mit tools/pw-stonevault-walk.mjs.
#
# Das Netz besteht deshalb aus wenigen Quadern — der Rampe unter den
# Trittkanten und dem, was sonst noch begrenzt:
#   * Rampe: Oberflaeche EXAKT durch die Trittkanten. `niveau(y)` trifft die
#     Nordkante jeder Trittflaeche auf den Millimeter (Nachweis: niveau bei
#     y = H-(i+1)*STUFE_T ist (i+1)*STUFE_T*STEIG = (i+1)*0,25 = die
#     Trittflaechenhoehe). Dicke 0,3 nach unten, volle Innenbreite 1,4.
#   * Seitenwaende: die Innenflaeche der sichtbaren Waende liegt bei |x|=0,70,
#     die Aussenflaeche bei 1,0 — als Quader entlang der Steigung.
#   * Decke: dieselbe schraege Platte wie im Bild, damit man oben nicht
#     durch sie hindurchspringt.
def treppe_kollision():
    bm = bmesh.new()
    H = LAUF / 2
    INNEN, AUSSEN, RAMPE_D = 0.70, 1.00, 0.30
    keil(bm, -INNEN, INNEN, -H, H, -RAMPE_D, 0.0)          # Rampe
    for s in (-1, 1):
        x0, x1 = sorted((s * INNEN, s * AUSSEN))
        keil(bm, x0, x1, -H, H, -DICKE, HOEHE)             # Seitenwand
    keil(bm, -GRID / 2, GRID / 2, -H, H, HOEHE, HOEHE + DICKE)   # Decke
    return bm


BAUER = {
    "StoneVaultCell": zelle,
    "StoneVaultWall": wand,
    "StoneVaultArch": bogen,
    "StoneVaultCorridor": korridor,
    "StoneVaultCorner": ecke,
    "StoneVaultJunction": kreuzung,
    "StoneVaultHall": halle,
    "StoneVaultHallLarge": halle_gross,
    "StoneVaultHallLong": halle_lang,
    "StoneVaultHallGrand": halle_grand,
    "StoneVaultHallVast": halle_vast,
    "StoneVaultStairs": treppe,
}
# Die zwei Zusatzpaneele gibt es NUR im Fels-Stil (s. `wand()`): im
# Ziegel-Stil wuerde jede zusaetzliche Datei den Neubau-Pruefer und die
# Golden-Staende von `DG_StoneVault` bewegen, und beide sollen sich nicht
# ruehren.
if STIL == "fels":
    BAUER["StoneVaultWallB"] = lambda: wand("B")
    BAUER["StoneVaultWallC"] = lambda: wand("C")

# Die Module mit Fels-Frontschicht — genau sie bekommen ein `_col`-Netz aus
# dem Kollisionslauf (s. `baue()`). Zelle und Saele tragen keine Wand, die
# Treppe bringt ihr eigenes Netz mit.
KOLL_MODULE = {
    "StoneVaultWall", "StoneVaultWallB", "StoneVaultWallC",
    "StoneVaultCorridor", "StoneVaultCorner", "StoneVaultJunction",
    "StoneVaultArch",
}
if STIL == "fels" and not KOLL_MODULE <= set(BAUER):
    raise SystemExit(f"KOLL_MODULE nennt Unbekanntes: {sorted(KOLL_MODULE - set(BAUER))}")

unbekannt = NUR - set(BAUER)
if unbekannt:
    raise SystemExit(f"Unbekannte Module: {sorted(unbekannt)}")
for modul, f in BAUER.items():
    if not NUR or modul in NUR:
        baue(modul, f)
print("ALLE STONEVAULT-MODULE FERTIG")
