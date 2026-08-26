#!/usr/bin/env blender --background --python
"""
Erzeugt Dungeon-Bauteile des Kits `DG_Steingrab` als GLB.

    blender --background --python tools/steingrab-erzeugen.py -- \
        --teil gang --name SteingrabGang --ziel assets/models

── Warum ein Skript und nicht Handarbeit ────────────────────────────
Ein Dungeon-Bauteil ist kein Fels. Was einen Fels ausmacht, ist
Unregelmaessigkeit; was ein Bauteil ausmacht, ist das Gegenteil: Es muss
sich AUFS MILLIMETER ans Raster halten, sonst passt es beim zwanzigsten
Teil nicht mehr zusammen und niemand findet die Ursache. Genau davor
warnt der Kopfkommentar von `shared/src/dungeonRaster.ts`.

Ein Skript trifft 4,000 m. Eine gezogene Kante trifft 3,997 m, und das
faellt erst auf, wenn zwei Raeume um einen Spalt auseinanderstehen.
Deshalb hier dieselbe Bauart wie beim Messer (tools/messer-erzeugen.py):
prozedural, in echten Metern, jede Zahl im Quelltext nachlesbar.

── Der Vertrag, den dieses Skript einhaelt ──────────────────────────
Nachzulesen in `shared/src/eigeneDungeons.ts`, geprueft von
`shared/test/dungeon-raster.ts`:

  * Ursprung auf dem BODEN und mittig in der Grundflaeche.
  * Grundflaeche ein Vielfaches von 4 m.
  * Durchgaenge an den Schmalseiten, auf Bodenhoehe, mittig.

── Wo der Stein sitzt ───────────────────────────────────────────────
Die deklarierte Huellbox (4 x 4 x 8 m) ist das AUSSENMASS. Alles Stein
liegt darin, nichts ragt seitlich hinaus — sonst durchdringen sich die
Waende zweier nebeneinander gesetzter Teile, und man saehe zwei Mauern
im selben Raum. Der lichte Gang ist dadurch schmaler als die Huelle:
4 m minus zweimal Wandstaerke.

Nach unten ragt die Bodenplatte bewusst heraus. Die begehbare Flaeche
MUSS auf y = 0 liegen (dort sitzen die Connectors), und der Stein
darunter muss irgendwo hin. Alle Teile machen das gleich, also stossen
sie sauber aneinander.

── Textur ───────────────────────────────────────────────────────────
Es gibt noch keine. Das Teil traegt eine flache Grundfarbe, so wie die
Frisuren es bis heute tun. Ein Kunstpass kommt, wenn der Startsatz
steht — vorher waere er Arbeit an etwas, das sich noch aendert.
"""

import sys
import os
import math

import bpy
import bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    """Liest `--name wert` aus der Befehlszeile hinter dem `--`."""
    key = f'--{name}'
    if key in argv:
        i = argv.index(key)
        if i + 1 < len(argv):
            return argv[i + 1]
    return default


TEIL = arg('teil', 'gang')
NAME = arg('name', 'SteingrabGang')
ZIEL = arg('ziel', 'assets/models')

# ── Raster und Abmessungen ──────────────────────────────────────────
# RASTER stimmt mit DUNGEON_RASTER_M aus shared/src/dungeonRaster.ts
# ueberein. Wer es hier aendert, aendert es dort mit — sonst meldet die
# Pruefung ein Teil als falsch, das nach diesem Skript richtig ist.
RASTER = 4.0

BREITE = 4.0    # x — Aussenmass, ein Rastervielfaches
HOEHE = 4.0     # z in Blender — Bodenflaeche bis Deckenoberkante
LAENGE = 8.0    # y in Blender — zwei Rastereinheiten

WANDSTAERKE = 0.25
BODENSTAERKE = 0.30
# 0,40 m ist keine runde Zahl aus Bequemlichkeit, sondern damit die lichte
# Hoehe 3,60 m betraegt — und die geht ohne Rest in sechs Steinlagen zu je
# 0,60 m auf. Eine angeschnittene Lage unter der Decke sieht aus wie ein
# Fehler, und zwar in jedem einzelnen Raum des Kits.
DECKENSTAERKE = 0.40

# ── Mauerwerk ───────────────────────────────────────────────────────
# Behauene Quader im Laeuferverband: jede zweite Lage um einen halben
# Stein versetzt, damit die Stossfugen nicht uebereinander durchlaufen.
# So mauert man wirklich, und man sieht sofort, wenn es fehlt.
LAGENHOEHE = 0.60
QUADERLAENGE = 1.00
# Die Fuge ist der SPALT zwischen zwei Steinen. Sie entsteht dadurch,
# dass jeder Quader um diesen Betrag kleiner ist als sein Rasterfeld —
# nicht durch eine eingeschnittene Rille. Deshalb liegt der Stein vor der
# Wand und die Fuge zeigt die Wandflaeche dahinter.
FUGE = 0.035
# Wie weit die Quader vor der tragenden Flaeche stehen. Klein genug, dass
# der lichte Gang breit bleibt, gross genug, dass die Fuge unter
# Fackellicht einen Schatten wirft.
VORSPRUNG = 0.05
# Jeder Stein steht ein wenig anders vor. Behauen heisst nicht geschliffen.
#
# Beim ersten Lauf standen hier 0,012 m, und das Ergebnis las sich wie
# gefliest: Bei gleicher Tiefe UND gleicher Laenge wirkt eine Wand
# industriell, egal wie gut die Fuge sitzt.
TIEFENSTREUUNG = 0.025
# Aus diesen Laengen wird je Lage gemischt. Ein Steinmetz haut, was der
# Block hergibt — gleich lange Steine ueber acht Meter gibt es nur, wo
# eine Maschine schneidet.
QUADERLAENGEN = (1.2, 1.0, 0.8)
# Dicke der Bodenplatten. Sie liegen IN einer Vertiefung, nicht auf dem
# Boden — siehe `mauerwerk_boden`.
BELAGSTAERKE = 0.06
# Jeder Quader steckt um diesen Betrag IN der tragenden Flaeche.
#
# Ohne das lägen zwei Flächen exakt in derselben Ebene, und die Grafikkarte
# hat dann keine Regel, welche vorne ist: Beim ersten Lauf war der ganze
# Boden schwarz. Ein Zentimeter Ueberdeckung kostet kein Dreieck und
# beendet die Frage.
UEBERDECKUNG = 0.01

# Farbe: kalter, leicht gruenstichiger Grauton. Nicht neutralgrau —
# das wirkt unter dem warmen Fackellicht des Spiels wie Beton.
STEINFARBE = (0.34, 0.35, 0.33, 1.0)


def leere_szene():
    """Startet von einer leeren Szene, egal was die Vorlage mitbringt."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1.0


def quader(name, mitte, groesse):
    """Ein achsparalleler Quader aus Mittelpunkt und Kantenlaengen."""
    netz = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, netz)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(groesse), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(mitte), verts=bm.verts)
    bm.to_mesh(netz)
    bm.free()
    return obj


def streuung(*schluessel):
    """
    Eine Zahl zwischen -1 und 1, die allein von den Ganzzahlen abhaengt.

    KEIN `random`: Zwei Laeufe desselben Skripts muessen dieselbe Datei
    ergeben, sonst ist jede Wiederholung ein neuer Export mit neuem
    Pruefsumme — und man kann nicht mehr sehen, ob sich wirklich etwas
    geaendert hat. Der Hash ist die uebliche Streuung ueber drei grosse
    Primzahlen.
    """
    h = 2166136261
    for k in schluessel:
        h = (h ^ (int(k) & 0xFFFFFFFF)) * 16777619 & 0xFFFFFFFF
    return (h / 0xFFFFFFFF) * 2.0 - 1.0


def mauerwerk_wand(seite, teile):
    """
    Behauene Quader im Laeuferverband auf EINE Wandinnenseite.

    Der Verband: Jede zweite Lage ist um einen halben Stein versetzt. An
    den Enden entstehen dadurch halbe Steine — genau wie beim echten
    Mauern, und wichtig fuers Kit: Die Lagen enden buendig bei y = ±4,
    damit die Fugen zweier aneinandergesetzter Gaenge durchlaufen und
    kein Stein ueber die Kopplungsfuge hinausragt.
    """
    lagen = int(round((HOEHE - DECKENSTAERKE) / LAGENHOEHE))
    innen = BREITE / 2 - WANDSTAERKE
    # Vorzeichen: -1 ist die linke Wand, +1 die rechte. Die Quader stehen
    # zur Gangmitte hin vor, also entgegen der Wandnormalen.
    richtung = -seite

    for lage in range(lagen):
        z0 = lage * LAGENHOEHE
        versatz = (QUADERLAENGE / 2) if lage % 2 else 0.0
        # Von der linken Kante durchgehen und an y = ±LAENGE/2 abschneiden.
        # Die Lage endet dadurch IMMER buendig, auch wenn die Steine
        # unterschiedlich lang sind — sonst ragte einer ueber die
        # Kopplungsfuge zum Nachbarteil hinaus.
        y = -LAENGE / 2 - versatz
        stein = 0
        while y < LAENGE / 2 - 1e-6:
            stein += 1
            wahl = QUADERLAENGEN[
                int((streuung(seite, lage, stein, 7) + 1) / 2 * len(QUADERLAENGEN))
                % len(QUADERLAENGEN)
            ]
            y0 = max(y, -LAENGE / 2)
            y1 = min(y + wahl, LAENGE / 2)
            laenge = y1 - y0 - FUGE
            y = y + wahl
            # Ein Reststueck schmaler als die Fuge waere ein Splitter.
            if laenge < FUGE:
                continue
            vor = VORSPRUNG + TIEFENSTREUUNG * streuung(seite, lage, stein)
            tiefe = vor + UEBERDECKUNG
            # Mittelpunkt so, dass die Rueckseite IN der Wand steckt und
            # die Vorderseite um `vor` heraussteht.
            mitte_x = seite * innen + richtung * (tiefe / 2 - UEBERDECKUNG)
            teile.append(quader(
                f'Quader{seite}_{lage}_{stein}',
                (mitte_x, (y0 + y1) / 2, z0 + LAGENHOEHE / 2),
                (tiefe, laenge, LAGENHOEHE - FUGE),
            ))


def mauerwerk_boden(teile):
    """
    Bodenplatten, buendig auf z = 0.

    Sie liegen IM Boden statt darauf: Die begehbare Flaeche muss auf 0
    bleiben (dort sitzen die Connectors), also ist die Oberseite jeder
    Platte 0 und die Fuge eine Rille nach unten. Ein Belag, der obenauf
    liegt, hoebe den Boden um seine Dicke an — und dann stimmt die
    Kopplungshoehe des ganzen Kits nicht mehr.
    """
    innen = BREITE / 2 - WANDSTAERKE
    spalten = max(1, int(round((2 * innen) / QUADERLAENGE)))
    reihen = int(round(LAENGE / QUADERLAENGE))
    breite_platte = (2 * innen) / spalten
    dicke = BELAGSTAERKE + UEBERDECKUNG

    for r in range(reihen):
        for s in range(spalten):
            x0 = -innen + s * breite_platte
            y0 = -LAENGE / 2 + r * QUADERLAENGE
            teile.append(quader(
                f'Platte_{r}_{s}',
                # Oberseite genau auf 0, Unterseite `UEBERDECKUNG` tief in
                # der Bodenplatte darunter.
                (x0 + breite_platte / 2, y0 + QUADERLAENGE / 2, -dicke / 2),
                (breite_platte - FUGE, QUADERLAENGE - FUGE, dicke),
            ))


def mauerwerk_decke(teile):
    """
    Deckenbalken quer zum Gang — Platten, die auf beiden Waenden aufliegen.

    Quer und nicht laengs, weil ein Steingrab so gedeckt wird: Die
    Spannweite ist die kurze Richtung. Nebenbei laufen die Fugen dadurch
    quer zur Laufrichtung und der Gang wirkt kuerzer statt endlos.
    """
    unterkante = HOEHE - DECKENSTAERKE
    reihen = int(round(LAENGE / QUADERLAENGE))
    for r in range(reihen):
        y0 = -LAENGE / 2 + r * QUADERLAENGE
        vor = VORSPRUNG + TIEFENSTREUUNG * streuung(9, r)
        dicke = vor + UEBERDECKUNG
        teile.append(quader(
            f'Balken_{r}',
            (0, y0 + QUADERLAENGE / 2, unterkante - dicke / 2 + UEBERDECKUNG),
            (BREITE - 2 * WANDSTAERKE, QUADERLAENGE - FUGE, dicke),
        ))


def baue_gang():
    """
    Bodenplatte, zwei Waende, Decke — und darauf das Mauerwerk. Die
    Schmalseiten bleiben OFFEN: Dort koppeln die Nachbarteile, eine Wand
    davor waere eine Sackgasse.

    Die glatten Platten bleiben als TRAGENDE Schicht darunter stehen. Sie
    sind der Koerper, an dem die Huellmasse haengen, und sie schliessen
    die Fugen nach hinten — ohne sie saehe man zwischen den Quadern
    hindurch ins Freie.
    """
    halbe_breite = BREITE / 2
    innen_x = halbe_breite - WANDSTAERKE

    teile = [
        # Boden: volle Aussenbreite. Seine Oberkante liegt UM DIE
        # BELAGSTAERKE TIEFER als 0 — die Platten darauf bringen die
        # begehbare Flaeche wieder auf 0, und die Fuge zwischen ihnen
        # zeigt diese Flaeche hier als Rille.
        quader('Boden',
               (0, 0, -(BELAGSTAERKE + BODENSTAERKE) / 2),
               (BREITE, LAENGE, BODENSTAERKE - BELAGSTAERKE)),
        # Zwei Waende, INNEN an der Huelle, vom Boden bis unter die Decke.
        quader('WandLinks',
               (-(halbe_breite - WANDSTAERKE / 2), 0, (HOEHE - DECKENSTAERKE) / 2),
               (WANDSTAERKE, LAENGE, HOEHE - DECKENSTAERKE)),
        quader('WandRechts',
               (halbe_breite - WANDSTAERKE / 2, 0, (HOEHE - DECKENSTAERKE) / 2),
               (WANDSTAERKE, LAENGE, HOEHE - DECKENSTAERKE)),
        # Decke: Oberkante genau auf Huellhoehe.
        quader('Decke', (0, 0, HOEHE - DECKENSTAERKE / 2), (BREITE, LAENGE, DECKENSTAERKE)),
    ]

    mauerwerk_wand(-1, teile)
    mauerwerk_wand(+1, teile)
    mauerwerk_boden(teile)
    mauerwerk_decke(teile)

    return teile, innen_x - VORSPRUNG


def vereinen(teile, name):
    """Alles zu einem Objekt — ein Bauteil ist ein Prefab, nicht vier."""
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in teile:
        o.select_set(True)
    bpy.context.view_layer.objects.active = teile[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    return obj


def material_setzen(obj):
    """
    Ein Material, flache Grundfarbe.

    Rauheit hoch, Metallanteil null: Stein spiegelt nicht. Der Name ist
    deutsch wie bei allen eigenen Modellen und traegt `platzhalter`, weil
    genau das gemeint ist — er soll auffallen, wenn er in einem Jahr
    immer noch da ist.
    """
    mat = bpy.data.materials.new('stein_platzhalter')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = STEINFARBE
    bsdf.inputs['Roughness'].default_value = 0.92
    bsdf.inputs['Metallic'].default_value = 0.0
    obj.data.materials.append(mat)


def kanten_brechen(obj, weite=0.02):
    """
    Eine schmale Fase auf jede Kante.

    Zwei Gruende, beide sichtbar: Eine perfekt scharfe Kante fangt kein
    Licht und verschwindet in der Schattierung — mit Fase zeichnet sie
    sich ab. Und sie nimmt dem Teil das Wuerfelhafte, ohne dass ein
    einziges Mass sich aendert.
    """
    mod = obj.modifiers.new('Fase', 'BEVEL')
    mod.width = weite
    mod.segments = 1
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(30)


def messen(obj):
    """
    Nachmessen statt annehmen.

    Die Zahlen im Kopf dieses Skripts sind die ABSICHT. Was zaehlt, ist
    das Ergebnis nach Modifikatoren — deshalb wird die ausgewertete Fassung
    gemessen und ausgegeben, damit ein Fehler hier auffaellt und nicht
    erst in der Rasterpruefung drei Schritte spaeter.
    """
    tiefe = bpy.context.evaluated_depsgraph_get()
    ausgewertet = obj.evaluated_get(tiefe)
    netz = ausgewertet.to_mesh()
    ecken = [ausgewertet.matrix_world @ v.co for v in netz.vertices]
    masse = {
        'x': (min(p.x for p in ecken), max(p.x for p in ecken)),
        'y': (min(p.y for p in ecken), max(p.y for p in ecken)),
        'z': (min(p.z for p in ecken), max(p.z for p in ecken)),
    }
    dreiecke = sum(len(p.vertices) - 2 for p in netz.polygons)
    ausgewertet.to_mesh_clear()
    return masse, dreiecke


def main():
    leere_szene()

    if TEIL != 'gang':
        raise SystemExit(f'Unbekanntes Teil: {TEIL} (bisher nur "gang")')

    teile, innen_x = baue_gang()
    obj = vereinen(teile, NAME)
    material_setzen(obj)
    kanten_brechen(obj)

    masse, dreiecke = messen(obj)

    ziel_pfad = os.path.join(ZIEL, f'{NAME}.glb')
    os.makedirs(ZIEL, exist_ok=True)

    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    # export_yup: Blender ist Z-hoch, glTF ist Y-hoch. Ohne diese Zeile
    # laege der Gang auf der Seite. Dieselben Flags wie bei allen anderen
    # Werkzeugen des Projekts.
    bpy.ops.export_scene.gltf(
        filepath=ziel_pfad,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
    )

    groesse = os.path.getsize(ziel_pfad) / 1e6
    print()
    print(f'FERTIG {ziel_pfad} — {dreiecke} Dreiecke, {groesse:.3f} MB')
    print(f'  Aussenmass  x {masse["x"][0]:+.3f} … {masse["x"][1]:+.3f}  '
          f'({masse["x"][1] - masse["x"][0]:.3f} m, Soll {BREITE:.3f})')
    print(f'  Laenge      y {masse["y"][0]:+.3f} … {masse["y"][1]:+.3f}  '
          f'({masse["y"][1] - masse["y"][0]:.3f} m, Soll {LAENGE:.3f})')
    print(f'  Hoehe       z {masse["z"][0]:+.3f} … {masse["z"][1]:+.3f}  '
          f'(Bodenflaeche auf 0, Decke auf {HOEHE:.3f})')
    print(f'  lichter Gang: {2 * innen_x:.3f} m breit, '
          f'{HOEHE - DECKENSTAERKE:.3f} m hoch')
    print(f'  Durchgaenge:  y = {-LAENGE / 2:+.3f} und {LAENGE / 2:+.3f}, offen')


main()
