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
        # Kennungen sind Zeichenketten ('WL', 'EN'), Indizes sind Zahlen.
        zahlen = [ord(c) for c in k] if isinstance(k, str) else [int(k)]
        for z in zahlen:
            h = (h ^ (z & 0xFFFFFFFF)) * 16777619 & 0xFFFFFFFF
    return (h / 0xFFFFFFFF) * 2.0 - 1.0


def lagenzahl(hoehe=None):
    """
    Wie viele Steinlagen zwischen Boden und Decke passen.

    `hoehe` ist die AUSSENHOEHE des Teils. Die Grabkammer ist hoeher als
    ein Gang, und die Lagen muessen trotzdem ohne Rest aufgehen — eine
    angeschnittene Lage unter der Decke sieht in jedem Raum wie ein
    Fehler aus. Wer hier eine Hoehe uebergibt, hat sie so gewaehlt.
    """
    return int(round(((hoehe if hoehe is not None else HOEHE) - DECKENSTAERKE) / LAGENHOEHE))


def mauerwerk_flaeche(kennung, achse, ebene, richtung, von, bis, teile,
                      kuerzung=None, lage_von=0, lage_bis=None, hoehe=None):
    """
    Behauene Quader im Laeuferverband auf EINE senkrechte Wandflaeche.

    `achse` ist die Achse, auf der die Wandnormale liegt ('x' oder 'y');
    gemauert wird entlang der jeweils anderen. `ebene` ist die Innenflaeche
    der tragenden Wand, `richtung` (+1/-1) zeigt in den Raum hinein.

    Der Verband: Jede zweite Lage ist um einen halben Stein versetzt, und
    jede Lage mischt drei Steinlaengen. An den Enden entstehen dadurch
    halbe Steine — genau wie beim echten Mauern, und wichtig fuers Kit:
    Die Lagen enden IMMER buendig bei `von` und `bis`, sonst ragte ein
    Stein ueber die Kopplungsfuge ins Nachbarteil.

    `kuerzung(lage)` liefert je Lage ein Paar (vorn, hinten), um das die
    Lage an ihren Enden verkuerzt wird. Damit entsteht die Verzahnung an
    einer Innenecke: Mal laeuft die eine Wand durch, mal die andere.
    """
    # `lage_von`/`lage_bis` grenzen die Hoehe ein. Gebraucht wird das von
    # der Tueroeffnung: Unter dem Sturz steht auf der Breite des Durchgangs
    # kein Stein, darueber schon.
    for lage in range(lage_von, lage_bis if lage_bis is not None else lagenzahl(hoehe)):
        z0 = lage * LAGENHOEHE
        kurz_v, kurz_h = kuerzung(lage) if kuerzung else (0.0, 0.0)
        anfang, ende = von + kurz_v, bis - kurz_h
        versatz = (QUADERLAENGE / 2) if lage % 2 else 0.0
        s = anfang - versatz
        stein = 0
        while s < ende - 1e-6:
            stein += 1
            wahl = QUADERLAENGEN[
                int((streuung(kennung, lage, stein, 7) + 1) / 2 * len(QUADERLAENGEN))
                % len(QUADERLAENGEN)
            ]
            a = max(s, anfang)
            b = min(s + wahl, ende)
            laenge = b - a - FUGE
            s = s + wahl
            # Ein Reststueck schmaler als die Fuge waere ein Splitter.
            if laenge < FUGE:
                continue
            vor = VORSPRUNG + TIEFENSTREUUNG * streuung(kennung, lage, stein)
            tiefe = vor + UEBERDECKUNG
            # Mittelpunkt so, dass die Rueckseite IN der Wand steckt und
            # die Vorderseite um `vor` heraussteht.
            quer = ebene + richtung * (tiefe / 2 - UEBERDECKUNG)
            mitte = (quer, (a + b) / 2) if achse == 'x' else ((a + b) / 2, quer)
            groesse = (tiefe, laenge) if achse == 'x' else (laenge, tiefe)
            teile.append(quader(
                f'Quader{kennung}_{lage}_{stein}',
                (mitte[0], mitte[1], z0 + LAGENHOEHE / 2),
                (groesse[0], groesse[1], LAGENHOEHE - FUGE),
            ))


def mauerwerk_boden(bereich, teile):
    """
    Bodenplatten, buendig auf z = 0.

    Sie liegen IM Boden statt darauf: Die begehbare Flaeche muss auf 0
    bleiben (dort sitzen die Connectors), also ist die Oberseite jeder
    Platte 0 und die Fuge eine Rille nach unten. Ein Belag, der obenauf
    liegt, hoebe den Boden um seine Dicke an — und dann stimmt die
    Kopplungshoehe des ganzen Kits nicht mehr.
    """
    x_von, x_bis, y_von, y_bis = bereich
    spalten = max(1, int(round((x_bis - x_von) / QUADERLAENGE)))
    reihen = max(1, int(round((y_bis - y_von) / QUADERLAENGE)))
    breite_platte = (x_bis - x_von) / spalten
    tiefe_platte = (y_bis - y_von) / reihen
    dicke = BELAGSTAERKE + UEBERDECKUNG

    for r in range(reihen):
        for s in range(spalten):
            x0 = x_von + s * breite_platte
            y0 = y_von + r * tiefe_platte
            teile.append(quader(
                f'Platte_{r}_{s}',
                # Oberseite genau auf 0, Unterseite `UEBERDECKUNG` tief in
                # der Bodenplatte darunter.
                (x0 + breite_platte / 2, y0 + tiefe_platte / 2, -dicke / 2),
                (breite_platte - FUGE, tiefe_platte - FUGE, dicke),
            ))


def mauerwerk_decke(bereich, quer, teile, hoehe=None):
    """
    Deckenbalken — Platten, die auf den Waenden aufliegen.

    `quer` sagt, in welcher Richtung die Balken liegen: 'x' heisst, sie
    spannen ueber x und reihen sich entlang y. Ein Steingrab wird ueber
    die KURZE Spannweite gedeckt, und nebenbei laufen die Fugen dadurch
    quer zur Laufrichtung — der Gang wirkt kuerzer statt endlos.
    """
    x_von, x_bis, y_von, y_bis = bereich
    unterkante = (hoehe if hoehe is not None else HOEHE) - DECKENSTAERKE
    laengs = (y_von, y_bis) if quer == 'x' else (x_von, x_bis)
    reihen = max(1, int(round((laengs[1] - laengs[0]) / QUADERLAENGE)))
    schritt = (laengs[1] - laengs[0]) / reihen

    for r in range(reihen):
        p0 = laengs[0] + r * schritt
        vor = VORSPRUNG + TIEFENSTREUUNG * streuung(9, r)
        dicke = vor + UEBERDECKUNG
        mitte_z = unterkante - dicke / 2 + UEBERDECKUNG
        if quer == 'x':
            mitte = ((x_von + x_bis) / 2, p0 + schritt / 2)
            groesse = (x_bis - x_von, schritt - FUGE)
        else:
            mitte = (p0 + schritt / 2, (y_von + y_bis) / 2)
            groesse = (schritt - FUGE, y_bis - y_von)
        teile.append(quader(
            f'Balken{quer}_{r}',
            (mitte[0], mitte[1], mitte_z),
            (groesse[0], groesse[1], dicke),
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

    bereich = (-innen_x, innen_x, -LAENGE / 2, LAENGE / 2)
    mauerwerk_flaeche('WL', 'x', -innen_x, +1, -LAENGE / 2, LAENGE / 2, teile)
    mauerwerk_flaeche('WR', 'x', +innen_x, -1, -LAENGE / 2, LAENGE / 2, teile)
    mauerwerk_boden(bereich, teile)
    mauerwerk_decke(bereich, 'x', teile)

    return teile, {
        'soll_x': BREITE,
        'soll_y': LAENGE,
        'lichte_breite': 2 * (innen_x - VORSPRUNG),
        'oeffnungen': f'y = {-LAENGE / 2:+.3f} und {LAENGE / 2:+.3f}',
    }


def baue_ecke():
    """
    Die Vierteldrehung: 4 x 4 m Grundflaeche, zwei Oeffnungen auf
    ANEINANDERGRENZENDEN Seiten.

    ── Wo die Oeffnungen liegen ─────────────────────────────────────
    Offen sind Sued (y = -2) und Ost (x = +2), Wand steht auf Nord und
    West. Beim Export nach Y-hoch wird aus Blenders -y ein +z, aus x
    bleibt x — im Spiel liegen die Durchgaenge also auf +z und +x. So
    stehen sie auch in `eigeneDungeons.ts`; wer eines von beiden aendert,
    muss das andere mitaendern, sonst koppelt der Editor an eine Wand.

    ── Die Verzahnung in der Innenecke ──────────────────────────────
    Hier entscheidet sich, ob der Verband um 90° herum aufgeht. Zwei
    Waende, die beide bis zur Ecke durchlaufen, stossen dort in einer
    durchgehenden senkrechten Fuge zusammen — das ist genau die Fuge,
    an der echtes Mauerwerk reisst, und man sieht es sofort.

    Deshalb wechseln sich die Lagen ab: In der einen laeuft die
    Westwand bis in die Ecke und die Nordwand setzt davor an, in der
    naechsten umgekehrt. Der Wechsel kostet ein `kuerzung`-Paar je Wand
    und ist der ganze Unterschied zwischen Mauerwerk und Tapete.
    """
    halb = BREITE / 2
    innen = halb - WANDSTAERKE
    lichte_hoehe = HOEHE - DECKENSTAERKE

    teile = [
        quader('Boden',
               (0, 0, -(BELAGSTAERKE + BODENSTAERKE) / 2),
               (BREITE, BREITE, BODENSTAERKE - BELAGSTAERKE)),
        # Westwand: laeuft ueber die volle Tiefe durch.
        quader('WandWest',
               (-(halb - WANDSTAERKE / 2), 0, lichte_hoehe / 2),
               (WANDSTAERKE, BREITE, lichte_hoehe)),
        # Nordwand: setzt an der Westwand an, damit sich die tragenden
        # Koerper nicht ueberschneiden.
        quader('WandNord',
               ((-halb + WANDSTAERKE + halb) / 2, halb - WANDSTAERKE / 2, lichte_hoehe / 2),
               (BREITE - WANDSTAERKE, WANDSTAERKE, lichte_hoehe)),
        quader('Decke', (0, 0, HOEHE - DECKENSTAERKE / 2),
               (BREITE, BREITE, DECKENSTAERKE)),
    ]

    # Abwechselnd laeuft die eine oder die andere Wand in die Ecke.
    # `VORSPRUNG` ist genau die Dicke, um die der Nachbar zuruecktritt —
    # so stossen die Steine an der sichtbaren Vorderkante zusammen.
    def kuerzung_west(lage):
        return (0.0, 0.0 if lage % 2 == 0 else VORSPRUNG)

    def kuerzung_nord(lage):
        return (VORSPRUNG if lage % 2 == 0 else 0.0, 0.0)

    bereich = (-innen, halb, -halb, innen)
    mauerwerk_flaeche('EW', 'x', -innen, +1, -halb, innen, teile,
                      kuerzung=kuerzung_west)
    mauerwerk_flaeche('EN', 'y', +innen, -1, -innen, halb, teile,
                      kuerzung=kuerzung_nord)
    mauerwerk_boden(bereich, teile)
    # Balken laengs x, also gereiht entlang y: Sie liegen auf der Nordwand
    # auf und ueberspannen die Oeffnung nach Sueden.
    mauerwerk_decke(bereich, 'x', teile)

    return teile, {
        'soll_x': BREITE,
        'soll_y': BREITE,
        'lichte_breite': innen + halb - VORSPRUNG,
        'oeffnungen': f'y = {-halb:+.3f} (Sued) und x = {halb:+.3f} (Ost)',
    }


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


def baue_endkappe():
    """
    Der Abschluss: 4 x 4 m, EIN Durchgang, drei geschlossene Seiten.

    ── Warum sie das dringendste Teil nach der Ecke ist ──────────────
    Ohne sie endet jeder erzeugte Dungeon dort, wo dem Generator die
    Anschlussmoeglichkeiten ausgehen — in einem offenen Loch ins
    Nichts. Der Generator kennt dafuer eigens das Flag `endCap` und
    setzt solche Teile bevorzugt auf uebrig gebliebene Connectors;
    `attachRoom` laesst sie sogar ohne Ueberschneidungspruefung zu,
    weil sie per Entwurf nur verschliessen.

    Offen ist Sued (y = -2), also im Spiel +z — dieselbe Richtung wie
    der erste Durchgang der Ecke, damit beide gleich koppeln.

    Zwei Innenecken statt einer: Der Verband muss hier zweimal um die
    Ecke, und die Verzahnung wechselt an beiden Seiten gegenlaeufig zur
    Rueckwand — laeuft die Rueckwand durch, treten beide Seitenwaende
    zurueck, und in der naechsten Lage umgekehrt.
    """
    halb = BREITE / 2
    innen = halb - WANDSTAERKE
    lichte_hoehe = HOEHE - DECKENSTAERKE

    teile = [
        quader('Boden', (0, 0, -(BELAGSTAERKE + BODENSTAERKE) / 2),
               (BREITE, BREITE, BODENSTAERKE - BELAGSTAERKE)),
        quader('WandNord', (0, halb - WANDSTAERKE / 2, lichte_hoehe / 2),
               (BREITE, WANDSTAERKE, lichte_hoehe)),
        quader('WandWest', (-(halb - WANDSTAERKE / 2), -WANDSTAERKE / 2, lichte_hoehe / 2),
               (WANDSTAERKE, BREITE - WANDSTAERKE, lichte_hoehe)),
        quader('WandOst', (halb - WANDSTAERKE / 2, -WANDSTAERKE / 2, lichte_hoehe / 2),
               (WANDSTAERKE, BREITE - WANDSTAERKE, lichte_hoehe)),
        quader('Decke', (0, 0, HOEHE - DECKENSTAERKE / 2),
               (BREITE, BREITE, DECKENSTAERKE)),
    ]

    def kuerzung_seite(lage):
        return (0.0, 0.0 if lage % 2 == 0 else VORSPRUNG)

    def kuerzung_rueck(lage):
        k = VORSPRUNG if lage % 2 == 0 else 0.0
        return (k, k)

    mauerwerk_flaeche('KW', 'x', -innen, +1, -halb, innen, teile,
                      kuerzung=kuerzung_seite)
    mauerwerk_flaeche('KO', 'x', +innen, -1, -halb, innen, teile,
                      kuerzung=kuerzung_seite)
    mauerwerk_flaeche('KN', 'y', +innen, -1, -innen, innen, teile,
                      kuerzung=kuerzung_rueck)
    bereich = (-innen, innen, -halb, innen)
    mauerwerk_boden(bereich, teile)
    mauerwerk_decke(bereich, 'x', teile)

    return teile, {
        'soll_x': BREITE,
        'soll_y': BREITE,
        'lichte_breite': 2 * (innen - VORSPRUNG),
        'oeffnungen': f'y = {-halb:+.3f} (Sued), sonst geschlossen',
    }


def baue_kreuzung():
    """
    Die Vierwegkreuzung: 8 x 8 m, vier Durchgaenge, einer je Seite.

    ── Warum 8 x 8 und nicht 4 x 4 ──────────────────────────────────
    Bei 4 x 4 waeren alle vier Seiten offen, und stehen bliebe von den
    Waenden nichts als vier Pfosten von 25 x 25 cm, auf denen eine
    Steindecke liegt. Das ist keine Frage des Geschmacks: Stein baut so
    nicht, und man sieht einem 25-cm-Pfosten an, dass er 3,6 m Decke
    nicht traegt. Mit zwei Rastereinheiten bleibt neben jedem Durchgang
    ein gutes Stueck Wand stehen, und die Kreuzung liest sich als
    Kammer mit vier Ausgaengen statt als Loch mit vier Loechern.

    ── Warum die Oeffnungen 3,50 m breit sind und nicht 4,00 m ──────
    Sie sind genau so breit wie der LICHTE Gang. Damit trifft die
    Innenflaeche der Gangwand auf die Kante der Oeffnung, und der
    Uebergang ist fugenlos. Bei 4,00 m staende der Gang mit seinen
    Waenden 25 cm im Nichts.
    """
    aussen = 8.0
    halb = aussen / 2
    innen = halb - WANDSTAERKE
    # Halbe lichte Weite eines Gangs — so weit reicht die Oeffnung.
    oeffnung = BREITE / 2 - WANDSTAERKE
    lichte_hoehe = HOEHE - DECKENSTAERKE

    teile = [
        quader('Boden', (0, 0, -(BELAGSTAERKE + BODENSTAERKE) / 2),
               (aussen, aussen, BODENSTAERKE - BELAGSTAERKE)),
        quader('Decke', (0, 0, HOEHE - DECKENSTAERKE / 2),
               (aussen, aussen, DECKENSTAERKE)),
    ]

    # Acht Wandstuecke: je Seite zwei, links und rechts der Oeffnung.
    laenge_stueck = halb - oeffnung
    mitte_stueck = (oeffnung + halb) / 2
    for vorzeichen in (-1, +1):
        for seite in (-1, +1):
            teile.append(quader(
                f'WandNS{vorzeichen}{seite}',
                (seite * mitte_stueck, vorzeichen * (halb - WANDSTAERKE / 2), lichte_hoehe / 2),
                (laenge_stueck, WANDSTAERKE, lichte_hoehe)))
            teile.append(quader(
                f'WandOW{vorzeichen}{seite}',
                (vorzeichen * (halb - WANDSTAERKE / 2), seite * mitte_stueck, lichte_hoehe / 2),
                (WANDSTAERKE, laenge_stueck, lichte_hoehe)))

    # Mauerwerk auf die acht Innenflaechen. Die Verzahnung sitzt an den
    # vier Aussenecken; die Enden AN DER OEFFNUNG bleiben unverkuerzt,
    # dort stoesst kein zweite Wand an, sondern der Nachbargang.
    def kuerzung_zur_ecke(lage):
        return (0.0, 0.0 if lage % 2 == 0 else VORSPRUNG)

    def kuerzung_von_ecke(lage):
        return (VORSPRUNG if lage % 2 == 0 else 0.0, 0.0)

    for vorzeichen in (-1, +1):
        richtung = -vorzeichen
        ebene = vorzeichen * innen
        # Nord-/Suedwand: laeuft entlang x, zwei Stuecke.
        mauerwerk_flaeche(f'ZN{vorzeichen}', 'y', ebene, richtung, -halb, -oeffnung,
                          teile, kuerzung=kuerzung_von_ecke)
        mauerwerk_flaeche(f'ZS{vorzeichen}', 'y', ebene, richtung, oeffnung, halb,
                          teile, kuerzung=kuerzung_zur_ecke)
        # Ost-/Westwand: laeuft entlang y.
        mauerwerk_flaeche(f'ZW{vorzeichen}', 'x', ebene, richtung, -halb, -oeffnung,
                          teile, kuerzung=kuerzung_zur_ecke)
        mauerwerk_flaeche(f'ZO{vorzeichen}', 'x', ebene, richtung, oeffnung, halb,
                          teile, kuerzung=kuerzung_von_ecke)

    bereich = (-halb, halb, -halb, halb)
    mauerwerk_boden(bereich, teile)
    mauerwerk_decke(bereich, 'x', teile)

    return teile, {
        'soll_x': aussen,
        'soll_y': aussen,
        'lichte_breite': 2 * (innen - VORSPRUNG),
        'oeffnungen': f'je Seite eine, {2 * oeffnung:.2f} m breit, bei ±{halb:.0f} m',
    }


def baue_kammer():
    """
    Die Grabkammer: 8 x 12 m, drei Durchgaenge, und HOEHER als alles
    andere im Kit.

    ── Warum sie hoeher ist, und warum genau 6,40 m ─────────────────
    Ein Raum, der so hoch ist wie der Gang davor, ist kein Raum, sondern
    ein breiter Gang. Die Hoehe macht den Unterschied — man tritt aus
    3,60 m in 6,00 m lichte Hoehe, und das merkt man ohne ein einziges
    Ausstattungsstueck.

    6,40 ist nicht gerundet: 6,40 minus 0,40 Decke sind 6,00 m lichte
    Hoehe, und die gehen ohne Rest in zehn Steinlagen zu 0,60 m auf.
    Dieselbe Regel wie beim Gang, nur mit anderer Zahl.

    ── Die Oeffnungen bleiben auf Ganghoehe ─────────────────────────
    3,50 x 3,60 m, also genau der Querschnitt eines Gangs. Ueber jeder
    Oeffnung stehen dadurch 2,40 m Wand — das Bogenfeld, das den
    Hoehensprung ueberhaupt erst sichtbar macht. Waeren die Oeffnungen
    so hoch wie die Kammer, liefe die Decke des Gangs ins Leere.

    ── Warum keine Ausstattung ──────────────────────────────────────
    Kein Podest, keine Nische, kein Sarkophag. Das Level Design Book
    warnt vor Varianten, bevor die Grundteile stehen — und die
    Ausstattung ist die naechste Etappe des Plans: Deko wird im Spiel
    gesetzt und landet im Dungeon-Dokument. Ein eingebautes Podest waere
    genau der Gegenstand, den man dort nie wieder verschieben kann.

    ── Beifang, der spaeter wichtig wird ────────────────────────────
    `roomOverlapsLayout` rechnet mit `pos ± size/2`, behandelt den
    Ursprung also als MITTE. Unsere Teile haben ihn auf dem BODEN. Bei
    lauter gleich hohen Teilen faellt das nicht auf; die Kammer ist das
    erste, bei dem es auffallen KOENNTE. Folgenlos bleibt es, weil alle
    Teile auf einer Ebene stehen — wer aber Ebenen einfuehrt (Treppe),
    stolpert genau hier zuerst.
    """
    breite = 8.0
    tiefe = 12.0
    hoehe = 6.4
    halb_x, halb_y = breite / 2, tiefe / 2
    innen_x, innen_y = halb_x - WANDSTAERKE, halb_y - WANDSTAERKE
    lichte_hoehe = hoehe - DECKENSTAERKE
    # Halbe lichte Weite eines Gangs — so breit ist jede Oeffnung.
    oeffnung = BREITE / 2 - WANDSTAERKE
    # Ganghoehe in Lagen: 3,60 m sind sechs Lagen.
    lagen_oeffnung = int(round((HOEHE - DECKENSTAERKE) / LAGENHOEHE))
    feld_hoehe = lichte_hoehe - lagen_oeffnung * LAGENHOEHE

    teile = [
        quader('Boden', (0, 0, -(BELAGSTAERKE + BODENSTAERKE) / 2),
               (breite, tiefe, BODENSTAERKE - BELAGSTAERKE)),
        quader('Decke', (0, 0, hoehe - DECKENSTAERKE / 2),
               (breite, tiefe, DECKENSTAERKE)),
        # Westwand ohne Oeffnung: laeuft durch.
        quader('WandWest', (-(halb_x - WANDSTAERKE / 2), 0, lichte_hoehe / 2),
               (WANDSTAERKE, tiefe, lichte_hoehe)),
    ]

    # Drei Seiten mit Oeffnung: Sued (y = -6), Nord (y = +6), Ost (x = +4).
    # Je Seite zwei Wandstuecke daneben und ein Bogenfeld darueber.
    for seite, achse in ((-1, 'y'), (+1, 'y'), (+1, 'x')):
        laengs_halb = halb_x if achse == 'y' else halb_y
        quer_halb = halb_y if achse == 'y' else halb_x
        rest = laengs_halb - oeffnung
        mitte_rest = (oeffnung + laengs_halb) / 2
        quer_mitte = seite * (quer_halb - WANDSTAERKE / 2)

        for vz in (-1, +1):
            ort = ((vz * mitte_rest, quer_mitte) if achse == 'y'
                   else (quer_mitte, vz * mitte_rest))
            gr = (rest, WANDSTAERKE) if achse == 'y' else (WANDSTAERKE, rest)
            teile.append(quader(f'Wand{achse}{seite}{vz}',
                                (ort[0], ort[1], lichte_hoehe / 2),
                                (gr[0], gr[1], lichte_hoehe)))

        ort = (0.0, quer_mitte) if achse == 'y' else (quer_mitte, 0.0)
        gr = ((2 * oeffnung, WANDSTAERKE) if achse == 'y'
              else (WANDSTAERKE, 2 * oeffnung))
        teile.append(quader(f'Bogenfeld{achse}{seite}',
                            (ort[0], ort[1], lichte_hoehe - feld_hoehe / 2),
                            (gr[0], gr[1], feld_hoehe)))

    # ── Mauerwerk ───────────────────────────────────────────────────
    # Westwand durchgehend. Die drei anderen Seiten je zweimal ueber die
    # volle Hoehe und einmal nur im Bogenfeld — dort, wo unten die
    # Oeffnung sitzt.
    mauerwerk_flaeche('KaW', 'x', -innen_x, +1, -halb_y, halb_y, teile, hoehe=hoehe)
    mauerwerk_flaeche('KaO1', 'x', +innen_x, -1, -halb_y, -oeffnung, teile, hoehe=hoehe)
    mauerwerk_flaeche('KaO2', 'x', +innen_x, -1, oeffnung, halb_y, teile, hoehe=hoehe)
    mauerwerk_flaeche('KaO3', 'x', +innen_x, -1, -oeffnung, oeffnung, teile,
                      lage_von=lagen_oeffnung, hoehe=hoehe)
    for seite, kennung in ((-1, 'KaS'), (+1, 'KaN')):
        ebene, richtung = seite * innen_y, -seite
        mauerwerk_flaeche(f'{kennung}1', 'y', ebene, richtung, -halb_x, -oeffnung,
                          teile, hoehe=hoehe)
        mauerwerk_flaeche(f'{kennung}2', 'y', ebene, richtung, oeffnung, halb_x,
                          teile, hoehe=hoehe)
        mauerwerk_flaeche(f'{kennung}3', 'y', ebene, richtung, -oeffnung, oeffnung,
                          teile, lage_von=lagen_oeffnung, hoehe=hoehe)

    bereich = (-halb_x, halb_x, -halb_y, halb_y)
    mauerwerk_boden(bereich, teile)
    mauerwerk_decke(bereich, 'x', teile, hoehe=hoehe)

    return teile, {
        'soll_x': breite,
        'soll_y': tiefe,
        'lichte_breite': 2 * (innen_x - VORSPRUNG),
        'oeffnungen': (f'Sued/Nord bei y = ±{halb_y:.0f}, Ost bei x = +{halb_x:.0f}, '
                       f'je {2 * oeffnung:.2f} x {lagen_oeffnung * LAGENHOEHE:.2f} m'),
        'hoehe': hoehe,
    }


def baue_abschluss():
    """
    Die zugemauerte Sackgasse — ein Abschluss, der nur verschliesst.

    ── Warum es sie neben der Endkappe geben MUSS ────────────────────
    Der Generator nimmt Abschlussteile vom Ueberschneidungstest aus
    (`dungeonGenerator.ts`, `roomOverlapsLayout`: `if (room.endCap &&
    !settings.endcapsCollision) return false`) und setzt notfalls
    sogar ohne jede Pruefung — ein ueberlappender Abschluss schlaegt
    ein offenes Loch ins Nichts. In der Vorlage ist das harmlos, weil
    Abschluesse dort duenne Verschlussstuecke sind.

    `SteingrabEndkappe` ist keins: Sie ist eine 4 x 4 x 4 m grosse
    Grabnische. Gemessen ueber 40 Seeds steckte damit fast die HAELFTE
    aller Endkappen (268 von 553) im Stein eines Nachbarn — 340
    Ueberschneidungen, wo ohne Abschluesse null waren. Dieses Teil ist
    die Ausweichmoeglichkeit, die dem Kit gefehlt hat: Wo die Nische
    nicht hinpasst, wird zugemauert.

    ── Masse ────────────────────────────────────────────────────────
    Die Wand fuellt den GANZEN Querschnitt, nicht nur den lichten Gang:
    4 m breit, von der Bodenplattenunterkante (-0,30) bis zur
    Deckenoberkante (4,00). Der Nachbarraum endet mit Boden UND Decke
    an der Kopplungsebene; blieben die 0,30 unten und die 0,40 oben
    offen, sahe man von schraeg unten bzw. durch die Decke ins Nichts.

    Tief ist sie 0,25 m — dieselbe Wandstaerke wie ueberall im Kit, und
    duenn genug, dass sie in den Platz passt, der uebrig ist. Genau das
    ist ihr Zweck.

    Mauerwerk nur auf EINER Seite: Die andere zeigt in den Fels. Der
    Betrachter steht im Nachbarraum, also auf +y in Blender (das ist im
    Spiel -z, die Richtung, in die der Connector zeigt).
    """
    halb = BREITE / 2
    dicke = WANDSTAERKE
    halbe_dicke = dicke / 2
    lichte_hoehe = HOEHE - DECKENSTAERKE

    # Der Kern ist DUENNER als die zugesagte Tiefe, und zwar um genau das,
    # was das Mauerwerk davor auftraegt (VORSPRUNG plus die Streuung nach
    # oben). Sonst staende der Verband vor der Huelle — und die Huelle ist
    # die Zusage, innerhalb derer alles Stein zu liegen hat. Bei allen
    # anderen Teilen faellt das nicht auf, weil deren Waende weit innerhalb
    # der Huelle stehen; hier IST die Wand die Huelle.
    auftrag = VORSPRUNG + TIEFENSTREUUNG
    kern_tiefe = dicke - auftrag
    kern_mitte_y = -halbe_dicke + kern_tiefe / 2
    sichtflaeche = -halbe_dicke + kern_tiefe

    # Ein Block ueber den vollen Querschnitt. Unterkante auf
    # -BODENSTAERKE, Oberkante auf HOEHE — deckungsgleich mit dem, was
    # der Nachbarraum an der Kopplungsebene zeigt.
    unten = -BODENSTAERKE
    teile = [
        quader('Kern', (0, kern_mitte_y, (unten + HOEHE) / 2),
               (BREITE, kern_tiefe, HOEHE - unten)),
    ]

    # Sichtseite verblenden — nur ueber die lichte Hoehe, darueber liegt
    # die Decke des Nachbarn davor und darunter sein Boden.
    mauerwerk_flaeche('AB', 'y', sichtflaeche, +1, -halb, halb, teile)

    return teile, {
        'soll_x': BREITE,
        'soll_y': dicke,
        'lichte_breite': 0.0,
        'oeffnungen': 'keine — verschliesst den Querschnitt',
        # Die Tiefe ist mit Absicht KEIN Rastervielfaches: Ein Abschluss
        # kachelt nicht, er stopft ein Loch. `dungeonRaster.ts` kennt
        # dieselbe Ausnahme (Regel `grundflaeche-raster`), und sie ist
        # dort an `endCap` UND an genau einen Connector gebunden — damit
        # sie nicht zum Freibrief fuer duenne Raeume wird.
        'duenne_achse': 'y',
        'hinweis_lichte_weite': f'geschlossen, {lichte_hoehe:.2f} m hoch verblendet',
    }


def baue_tuer():
    """
    Die Tueroeffnung — und das einzige Teil, das KEIN Raum ist.

    ── Warum sie anders funktioniert als alles bisherige ─────────────
    Raeume setzt der Generator an Connectors. Tueren setzt er IN sie:
    `placeDoors` schreibt `pos: connection.pos, rot: connection.rot`,
    also genau in die Kopplungsebene zwischen zwei Raeumen, auf
    Bodenhoehe und mit der Blickrichtung des Connectors. Der Ursprung
    dieses Teils gehoert deshalb in die Mitte des Durchgangs auf y = 0,
    und die Wand steht in der Ebene x/z — duenn in Blenders y, weil aus
    -y beim Export das +z des Connectors wird.

    Es steht folglich nicht in `rooms`, sondern in `doorTypes` des Kits.
    Solange das leer war, konnte kein erzeugter Dungeon eine Tuer haben.

    ── Die Masse kommen aus dem Durchgang, nicht aus dem Geschmack ───
    Der Durchgang ist 3,50 m breit (Huelle 4 m minus zwei Waende) und
    3,60 m hoch (bis zur Deckenunterkante). Genau das fuellt die
    Tuerwand aus — sie schliesst den Querschnitt und laesst in der
    Mitte eine Oeffnung von 1,60 x 2,40 m. Die 2,40 m sind vier
    Steinlagen, keine gerundete Zahl: Der Sturz liegt dadurch auf einer
    Lagenfuge und nicht mitten in einem Stein.

    ── Der Sturz ist EIN Stein ──────────────────────────────────────
    Ueber der Oeffnung liegt kein Verband, sondern ein durchgehender
    Block von Wange zu Wange. So traegt ein Steingrab eine Oeffnung —
    und ein Verband, der ueber 1,60 m frei spannt, waere gelogen.
    """
    durchgang = BREITE - 2 * WANDSTAERKE          # 3,50 m
    hoehe = HOEHE - DECKENSTAERKE                 # 3,60 m
    halb = durchgang / 2
    oeffnung_halb = 0.80                          # 1,60 m lichte Breite
    sturz_lage = 4                                # 4 x 0,60 m = 2,40 m
    sturz_z = sturz_lage * LAGENHOEHE
    dicke = 0.30                                  # halb in jedem Nachbarraum
    halbe_dicke = dicke / 2

    teile = [
        # Tragende Wangen und das Feld ueber der Oeffnung.
        quader('WangeLinks',
               (-(halb + oeffnung_halb) / 2, 0, hoehe / 2),
               (halb - oeffnung_halb, dicke, hoehe)),
        quader('WangeRechts',
               ((halb + oeffnung_halb) / 2, 0, hoehe / 2),
               (halb - oeffnung_halb, dicke, hoehe)),
        quader('Feld',
               (0, 0, (sturz_z + hoehe) / 2),
               (2 * oeffnung_halb, dicke, hoehe - sturz_z)),
    ]

    # Mauerwerk auf BEIDE Seiten: Eine Tuer wird von vorn und von hinten
    # gesehen, und die Rueckseite ist der Nachbarraum.
    for seite in (-1, +1):
        ebene = seite * halbe_dicke
        richtung = seite
        kennung = f'T{"V" if seite > 0 else "H"}'
        # Wangen ueber die volle Hoehe.
        mauerwerk_flaeche(f'{kennung}L', 'y', ebene, richtung, -halb, -oeffnung_halb, teile)
        mauerwerk_flaeche(f'{kennung}R', 'y', ebene, richtung, oeffnung_halb, halb, teile)
        # Ueber dem Sturz weiter im Verband, aber erst ab der Lage darueber.
        mauerwerk_flaeche(f'{kennung}O', 'y', ebene, richtung, -halb, halb, teile,
                          lage_von=sturz_lage + 1)
        # Der Sturz selbst: ein Stein von Wange zu Wange.
        vor = VORSPRUNG + UEBERDECKUNG
        teile.append(quader(
            f'Sturz{kennung}',
            (0, ebene + richtung * (vor / 2 - UEBERDECKUNG / 2), sturz_z + LAGENHOEHE / 2),
            (2 * halb - FUGE, vor, LAGENHOEHE - FUGE),
        ))

    return teile, {
        'soll_x': durchgang,
        'soll_y': dicke,
        'lichte_breite': 2 * oeffnung_halb,
        'oeffnungen': f'{2 * oeffnung_halb:.2f} x {sturz_z:.2f} m Durchgang, Sturz auf {sturz_z:.2f} m',
        'raster_pruefen': False,
    }


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

    bauer = {'gang': baue_gang, 'ecke': baue_ecke, 'endkappe': baue_endkappe,
             'kreuzung': baue_kreuzung, 'tuer': baue_tuer,
             'kammer': baue_kammer, 'abschluss': baue_abschluss}.get(TEIL)
    if bauer is None:
        raise SystemExit(f'Unbekanntes Teil: {TEIL} (bekannt: gang, ecke, endkappe, '
                         f'kreuzung, tuer, kammer, abschluss)')

    teile, angaben = bauer()
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
    soll_x, soll_y = angaben['soll_x'], angaben['soll_y']
    print()
    print(f'FERTIG {ziel_pfad} — {dreiecke} Dreiecke, {groesse:.3f} MB')
    print(f'  Aussenmass  x {masse["x"][0]:+.3f} … {masse["x"][1]:+.3f}  '
          f'({masse["x"][1] - masse["x"][0]:.3f} m, Soll {soll_x:.3f})')
    if angaben.get('raster_pruefen', True):
        print(f'  Tiefe       y {masse["y"][0]:+.3f} … {masse["y"][1]:+.3f}  '
              f'({masse["y"][1] - masse["y"][0]:.3f} m, Soll {soll_y:.3f})')
    else:
        # Bei der Tuer ist `soll_y` der KERN. Das Mauerwerk steht beidseits
        # davor, die gemessene Tiefe ist deshalb groesser — kein Fehler,
        # sondern der Verband. Ein "Soll" danebenzuschreiben, das die
        # Messung nie trifft, waere eine Zeile, die jeder Leser einmal
        # nachrechnet und dann kuenftig ueberliest.
        print(f'  Tiefe       y {masse["y"][0]:+.3f} … {masse["y"][1]:+.3f}  '
              f'({masse["y"][1] - masse["y"][0]:.3f} m — Kern {soll_y:.2f} m '
              f'plus Mauerwerk beidseits)')
    print(f'  Hoehe       z {masse["z"][0]:+.3f} … {masse["z"][1]:+.3f}  '
          f'(Bodenflaeche auf 0, Decke auf {angaben.get("hoehe", HOEHE):.3f})')
    if angaben.get('hinweis_lichte_weite'):
        print(f'  lichte Weite: {angaben["hinweis_lichte_weite"]}')
    else:
        print(f'  lichte Weite: {angaben["lichte_breite"]:.3f} m, '
              f'{angaben.get("hoehe", HOEHE) - DECKENSTAERKE:.3f} m hoch')
    print(f'  Durchgaenge:  {angaben["oeffnungen"]}, offen')

    # Rasterprobe an der eigenen Ausgabe: Jedes Aussenmass MUSS ein
    # Vielfaches von RASTER sein. Faellt das hier durch, faellt es sonst
    # erst in `shared/test/dungeon-raster.ts` auf — nach dem Kopieren,
    # nach dem Eintragen, drei Schritte zu spaet.
    #
    # Nicht fuer die Tuer: Sie ist kein Raum, sondern steht IN der Fuge
    # zwischen zweien. Ihre Masse kommen aus dem Durchgang (3,50 x 3,60 m),
    # und das ist mit Absicht kein Rastervielfaches — das Raster gilt fuer
    # Huellboxen von Raeumen, und `dungeonRaster.ts` prueft auch nur die.
    if not angaben.get('raster_pruefen', True):
        print('  Raster:       entfaellt — Tuer ist kein Raum, sondern sitzt in der Fuge')
        return

    # Eine Achse darf duenner als das Raster sein — aber nur bei einem
    # Abschluss, und das Mass wird trotzdem auf den Zentelmillimeter
    # geprueft. Ohne die zweite Haelfte waere die Ausnahme ein Loch, durch
    # das jedes ungenaue Teil passt.
    duenn = angaben.get('duenne_achse')
    for achse, soll in (('x', soll_x), ('y', soll_y)):
        gemessen = masse[achse][1] - masse[achse][0]
        if achse == duenn:
            # Obergrenze statt Sollmass: Wie weit der aeusserste Stein
            # vorsteht, entscheidet die Streuung im Verband. Zugesagt ist,
            # dass NICHTS ueber die Huelle hinausragt. Die untere Schranke
            # steht daneben, damit ein versehentlich auf 5 cm geratener
            # Kern nicht als "passt ja rein" durchgeht.
            if gemessen > soll + 0.0005:
                raise SystemExit(
                    f'RASTERFEHLER {achse}: {gemessen:.4f} m ragen ueber die '
                    f'zugesagte Huelle von {soll:.4f} m hinaus')
            if gemessen < soll / 2:
                raise SystemExit(
                    f'RASTERFEHLER {achse}: {gemessen:.4f} m sind weniger als die '
                    f'Haelfte der zugesagten {soll:.4f} m — stimmt der Kern?')
            continue
        if abs(gemessen - soll) > 0.0005:
            raise SystemExit(
                f'RASTERFEHLER {achse}: {gemessen:.4f} m gemessen, {soll:.4f} m erwartet')
        if abs(soll % RASTER) > 0.0005:
            raise SystemExit(
                f'RASTERFEHLER {achse}: {soll:.4f} m ist kein Vielfaches von {RASTER} m')
    if duenn:
        anderes = soll_y if duenn == 'x' else soll_x
        print(f'  Raster:       {anderes:.0f} m im Raster, {duenn} = '
              f'{(soll_x if duenn == "x" else soll_y):.2f} m als Verschluss — ok')
    else:
        print(f'  Raster:       {soll_x:.0f} x {soll_y:.0f} m, Vielfaches von {RASTER:.0f} m — ok')


main()
