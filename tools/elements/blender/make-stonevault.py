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
from felsrelief import (fels_gitter, setze_relief_quelle,   # noqa: E402
                        SEED as FELS_SEED)

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
if RELIEF_QUELLE:
    if STIL != "fels":
        raise SystemExit("--relief-quelle gibt es nur zu --stil fels")
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
# ── Reliefdicke: 6 cm in Ziegeln, 9 cm im Fels ──────────────────────────────
# Der Ziegelverband braucht 6 cm — mehr sieht man einem Backstein nicht an.
# Die Fels-Frontschicht braucht MEHR, und zwar aus einem messbaren Grund: Sie
# ist eine unterteilte Flaeche im 0,125-m-Raster. Bei 6 cm Hub betraegt die
# steilste moegliche Flanke atan(0,06/0,125) = 26 Grad — es gibt in so einer
# Wand also gar keine scharfe Bruchkante, egal wie das Feld gerechnet wird.
# Bei 9 cm sind es 36 Grad, und damit stehen Kanten im Streiflicht.
#
# Was dabei NICHT wandert: Die Hüllbox (TIEFE bleibt 0,30) und die
# VORDERKANTE des Reliefs. Dicker wird allein die Reliefschicht, duenner die
# Rueckplatte (0,24 -> 0,21). Die Wandfront liegt in beiden Stilen auf
# +-0,15 bzw. (bei den Innenwaenden) auf +-0,70 — was `stonevault-kantensonde`
# als Durchgangsfenster misst, aendert sich um keinen Millimeter.
#
# Die Grenze nach oben ist die Spielerkapsel: Das Konzept laesst 10 cm zu.
PROT   = 0.09 if STIL == "fels" else 0.06
RUECK  = TIEFE - PROT   # Rueckplattendicke 0,24 bzw. 0,21

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


def aufbereiten(name, bm, materialname):
    """Ein bmesh zum fertigen Objekt machen: aufraeumen, EIN Material,
    in x vorspiegeln. Gibt das Objekt zurueck, exportiert aber nicht."""
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
        # der bmesh-Vorgabewert). Zusaetzlich wird jede Kante ab 14 Grad
        # als SCHARF markiert — die Klueste und die Facettenraender
        # bleiben also Kanten, das Innere einer Bruchflaeche wird glatt.
        # `shade_flat()` unterbliebe sonst; es wuerde die Marken gerade
        # wieder loeschen. Im Ziegel-Stil aendert sich NICHTS.
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.mark_sharp(clear=True)
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.mesh.select_mode(type="EDGE")
        bpy.ops.mesh.edges_select_sharp(sharpness=math.radians(14.0))
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

    # Vorspiegeln: x negieren, Wicklung bleibt -> Mesh wird "innen aussen",
    # genau wie bei allen Steingrab-Modulen. Babylons __root__ dreht es zurueck.
    for v in me.vertices:
        v.co.x = -v.co.x
    return o


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
    """
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

    bpy.ops.export_scene.gltf(filepath=f"{OUT}/{name}.glb",
                              export_format="GLB", use_selection=True)
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
                 rand_luft=None, zeilen=None, niveau_fn=None):
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
    """
    hinten = mitte - sgn * PROT / 2
    kw = {"seed": SEED, "lage": lage, "z0": z0, "z1": z1}
    if rand_luft is not None:
        kw["rand_luft"] = rand_luft
    if zeilen is not None:
        kw["zeilen"] = zeilen
    gitter = fels_gitter(lo, hi, **kw)
    punkte = gitter["punkte"]
    nz = len(punkte)
    nx = len(punkte[0])

    def ecke(entlang, hoch, tiefe):
        if niveau_fn is not None:
            hoch = hoch + niveau_fn(entlang)
        fest = hinten + sgn * tiefe
        return (entlang, fest, hoch) if lauf == "x" else (fest, entlang, hoch)

    vorn = [[bm.verts.new(ecke(*punkte[iz][ix])) for ix in range(nx)]
            for iz in range(nz)]

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
def innenwand(bm, lauf, back, relief, lo=-GRID / 2, hi=GRID / 2, lage=0):
    """lauf: 'x' oder 'y' — Achse, entlang der die Wand laeuft (Blender).
    back/relief: Mitte der Rueckplatte bzw. der Reliefschicht auf der Festachse.
    lage: Feldschluessel der Fels-Frontschicht — er unterscheidet MODUL UND
    WANDSEITE (s. FELD_LAGE). Im Ziegel-Stil bleibt er ohne Wirkung."""
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
        fels_schicht(bm, lauf, relief, -1.0 if back > 0 else 1.0, lo, hi, lage=lage)
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


def ecke():
    """Waende Sued und West, offen nach Nord (+z) und Ost (+x).
    Die Westwand laeuft durch, die Suedwand stoesst stumpf an deren Reliefseite
    -> in der SW-Ecke weder Loch noch doppelte Geometrie."""
    neu()
    bm = bmesh.new()
    boden_decke(bm)
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
RUECK_MITTIG = TIEFE - 2 * PROT               # 0,18


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
    for flanke, (yr, sgn) in enumerate(((-T / 2 + PROT / 2, -1.0),
                                        (T / 2 - PROT / 2, 1.0))):
        pfosten_lage = FELD_LAGE["BogenPfostenNah" if flanke == 0 else "BogenPfostenFern"]
        sturz_lage = FELD_LAGE["BogenSturzNah" if flanke == 0 else "BogenSturzFern"]
        if STIL == "fels":
            # Die Pfostenflanken schneiden aus DEMSELBEN Gitter wie die
            # Wandpaneele — der Bogen sitzt in der Kopplungsebene zwischen
            # zwei Zellen, seine Bloecke muessen mit den anschliessenden
            # Waenden fluchten. Die Laibung bei +-0,6 ist ein innerer
            # Anschlag: dort blendet felsrelief.py NICHT auf das
            # Randniveau, damit neben der Tuer keine Nut steht.
            fels_schicht(bm, "x", yr, sgn, -B / 2, -B / 2 + pf, lage=pfosten_lage)
            fels_schicht(bm, "x", yr, sgn, B / 2 - pf, B / 2, lage=pfosten_lage)
            # Sturzband: eigener Feldschluessel, sonst saesse ueber der Tuer
            # dasselbe Feld wie auf den Pfosten. Zwei Zeilen genuegen — das
            # Band ist 18 cm hoch, ein 12,5-cm-Raster waere darin sinnlos.
            fels_schicht(bm, "x", yr, sgn,
                         -(oeff_b + 0.30) / 2, (oeff_b + 0.30) / 2,
                         lage=sturz_lage, zeilen=2, rand_luft=0.0,
                         z0=kaempfer + r + 0.01, z1=kaempfer + r + 0.19)
            continue
        for s in (-1, 1):
            for i in range(reihen):
                cz = (i + 0.5) * rh
                breite = pf - fuge - (0.10 if i % 2 else 0.0)
                cx = s * (B / 2 - pf / 2) + s * (0.05 if i % 2 else 0.0)
                box(bm, cx, yr, cz, breite, PROT, rh - fuge)
        box(bm, 0, yr, kaempfer + r + 0.10, oeff_b + 0.30, PROT, 0.18)  # Sturzband
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
                         niveau_fn=niveau)
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

unbekannt = NUR - set(BAUER)
if unbekannt:
    raise SystemExit(f"Unbekannte Module: {sorted(unbekannt)}")
for modul, f in BAUER.items():
    if not NUR or modul in NUR:
        f()
print("ALLE STONEVAULT-MODULE FERTIG")
