#!/usr/bin/env blender --background --python
"""
Vermisst eine humanoide GLB und liefert die Landmarken, aus denen
`tools/spieler-rig.py` sein Skelett baut.

    blender --background --python tools/spieler-vermessen.py -- \
        --glb assets/models/WikingerBasis-roh.glb [--json /tmp/masse.json]

── Warum das ein eigenes Werkzeug ist ───────────────────────────────
Die bisherigen Rigs (voelva, surtr, furloc) tragen ihre Knochenpunkte als
HANDGEMESSENE TABELLE im Skript. Für eine Figur, die genau einmal
entsteht, ist das richtig: Die Zahlen sind nachprüfbar, und der Kommentar
daneben sagt, wie sie zustande kamen.

Der Spielercharakter ist der erste Fall, in dem das nicht trägt. Von ihm
wird es MEHRERE Körper geben — Mann, Frau, schmal, breit —, weil die
Charaktererstellung sie austauschen soll. Eine Tabelle je Körper hiesse,
für jeden neuen Körper wieder einen halben Tag zu messen; und sobald
jemand das Modell neu generiert, sind sämtliche Zahlen still falsch.

Deshalb wird hier gemessen statt getippt. Das Verfahren ist dasselbe, das
die Kopfkommentare der drei Rigs beschreiben — nur als Code statt als
Protokoll.

── Flächen abtasten, nicht Vertices zählen ──────────────────────────
Abgetastet werden PUNKTE AUF DEN DREIECKEN (flächentreu, siehe
`punktwolke`), nicht die Vertices. Generierte Meshes lösen Knöchel, Zehen
und Finger sehr grob auf; eine Vertex-Scheibe misst dort Löcher und
liefert Breiten, die es nicht gibt. Dieselbe Erfahrung steht im Kopf von
tools/furloc-rig.py.

── Die Mittelsäule ist der Schlüssel ────────────────────────────────
Der erste Anlauf dieses Werkzeugs suchte den Schritt als "oberste
Scheibe, deren Querschnitt in zwei Häufungen zerfällt" — und fand ihn bei
63 % der Körperhöhe statt bei 47 %. Der Grund: In einer A-Pose zerfällt
JEDE Scheibe zwischen Schulter und Hand in DREI Häufungen (Arm, Rumpf,
Arm), und die grösste Lücke davon ist die zwischen Arm und Rumpf.

Alles hier läuft deshalb über die MITTELSÄULE: den zusammenhängenden Lauf
besetzter Fächer, in dem die Körperachse liegt. Rumpf und Beine sind die
Mittelsäule, die Arme sind alles daneben. Damit ist der Schritt wieder das,
was er sein soll — die höchste Stelle, an der die Mittelsäule selbst
aufreisst —, und die Rumpfbreite misst den Rumpf statt der Armspannweite.

── Was gemessen wird und was aus Proportion kommt ───────────────────
GEMESSEN wird alles, was ein klares geometrisches Merkmal hat:

  Sohle / Scheitel   tiefste und höchste besetzte Scheibe
  Blickrichtung      Ferse-zu-Zehen-Vektor des Fussgrundrisses
  Schritt            höchste Scheibe mit Lücke IN der Mittelsäule
  Hüfte / Taille     breiteste bzw. schmalste Mittelsäulen-Scheibe
  Schulter / Hals    breiteste bzw. schmalste Scheibe darüber
  Achsel             höchste Scheibe, in der der Arm noch frei steht
  Beinachse          Schwerpunkt der Beinhälfte
  Knie / Knöchel     Taille des Beinprofils in seinem jeweiligen Band
  Ballen             der Knick im Fussrücken (dort fällt die Fusshöhe
                     sprunghaft ab: dahinter der Spann, davor die Zehen)
  Schultergelenk     Verlängerung der gefitteten ARMACHSE bis auf
                     Achselhöhe plus halbe Armdicke

AUS PROPORTION kommen nur Ellbogen und Handgelenk. Beide sind an einem
generierten Modell KEINE verlässliche Taille — der Unterarm ist dort
kaum dünner als der Oberarm, und eine waagerechte Scheibe schneidet den
schräg hängenden Arm ohnehin oval. Statt ein Minimum im Rauschen zu
suchen, werden sie auf der gemessenen Strecke Schultergelenk →
Fingerspitze nach den anthropometrischen Anteilen (Drillis/Contini)
gesetzt. Der Messwert wird trotzdem gedruckt, als Gegenprobe.

Das ist eine bewusste Grenze: Ein Ellbogen, der zwei Zentimeter neben dem
echten sitzt, fällt niemandem auf. Einer, den das Rauschen zehn
Zentimeter verschiebt, knickt den Arm in der Mitte des Unterarms.

Alle Werte sind EINHEITEN DES MODELLS (Tripo normiert auf Kantenlänge ~1).
"""

import json
import math
import os
import random
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def pfad(p):
    return p if os.path.isabs(p) else os.path.join(ROOT, p)


# 400.000 Punkte: bei 10.000 Dreiecken 40 Punkte je Dreieck. Genug, dass
# ein 1 % hohes Band um eine Beinachse noch dreistellig besetzt ist —
# darunter rauscht die Taillensuche.
PUNKTE = 400_000

# ── Anthropometrie (Drillis & Contini 1966, Anteile der Körperhöhe) ──
# Gebraucht an genau zwei Stellen, und beide Male aus demselben Grund:
# Dort GIBT es kein geometrisches Merkmal zu messen.
#
# 1. Ellbogen und Handgelenk, als Anteil der ARMSTRECKE. An einem
#    generierten Modell ist der Unterarm kaum dünner als der Oberarm, und
#    eine waagerechte Scheibe schneidet den schräg hängenden Arm oval —
#    ein Minimum in diesem Rauschen zu suchen hiesse, den Ellbogen
#    auszuwürfeln. Gemessen werden Schultergelenk und Fingerspitze; die
#    beiden Gelenke dazwischen kommen aus dem Verhältnis.
#      Oberarm 0,186 H, Unterarm 0,146 H, Hand 0,108 H → Summe 0,440 H
# 2. Das HÜFTGELENK. Es liegt bei 0,530 H und damit an dieser Figur unter
#    dem Lendentuch — der sichtbare Beinspalt sitzt am SAUM des Tuchs
#    (gemessen 0,36), nicht im Schritt. Ein Hüftknochen auf Saumhöhe
#    machte aus dem Oberschenkel einen Stummel und liesse das Tuch als
#    starre Glocke stehen. Das ist derselbe Fall wie Surtrs Lendenplatte
#    (tools/surtr-rig.py) — dort wurde er von Hand gemessen, hier wird er
#    aus der Proportion gesetzt und das Tuch bekommt eine eigene Maske.
ANTEIL_OBERARM = 0.186 / 0.440
ANTEIL_UNTERARM = 0.146 / 0.440
ANTEIL_HUEFTGELENK = 0.530
# Zum Gegenrechnen der gemessenen Beingelenke.
ERWARTET_KNIE = 0.285
ERWARTET_KNOECHEL = 0.055


def punktwolke(mesh, n=PUNKTE, seed=1):
    """Flächentreue Punktwolke auf den Dreiecken.

    Flächentreu heisst: Ein Punkt landet in einem Dreieck mit einer
    Wahrscheinlichkeit proportional zu dessen FLÄCHE. Sonst bekämen die
    tausenden winzigen Dreiecke im Gesicht dasselbe Gewicht wie die
    wenigen grossen am Oberschenkel, und jede Breitenmessung am Bein
    stünde auf einer Handvoll Punkte.
    """
    mw = mesh.matrix_world
    mesh.data.calc_loop_triangles()
    ecken, kum = [], []
    s = 0.0
    for t in mesh.data.loop_triangles:
        a, b, c = (mw @ mesh.data.vertices[i].co for i in t.vertices)
        f = (b - a).cross(c - a).length * 0.5
        if f <= 0.0:
            continue
        ecken.append((a, b, c))
        s += f
        kum.append(s)
    kum = [k / s for k in kum]

    rnd = random.Random(seed)
    aus = []
    for _ in range(n):
        u = rnd.random()
        lo, hi = 0, len(kum) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if kum[mid] < u:
                lo = mid + 1
            else:
                hi = mid
        a, b, c = ecken[lo]
        r1, r2 = rnd.random(), rnd.random()
        if r1 + r2 > 1.0:
            r1, r2 = 1.0 - r1, 1.0 - r2
        aus.append(a + (b - a) * r1 + (c - a) * r2)
    return aus


def spanne(punkte, achse):
    if not punkte:
        return (0.0, 0.0, 0.0)
    w = [getattr(p, achse) for p in punkte]
    return (min(w), max(w), max(w) - min(w))


def mittel(punkte, achse):
    return sum(getattr(p, achse) for p in punkte) / len(punkte) if punkte else 0.0


def _extrem(profil, lo, hi, gross):
    """Höhe des breitesten (gross) bzw. schmalsten Eintrags in [lo, hi].

    Genommen wird der Ort des EXTREMUMS, nicht der erste Über-/
    Unterschreiter einer Schwelle: Eine Schwelle müsste man an den
    Körperbau anpassen, und genau das soll dieses Werkzeug abnehmen.
    """
    kand = [(b, z) for z, b in profil if lo <= z <= hi and b > 0.0]
    if not kand:
        return None
    return (max(kand) if gross else min(kand))[1]


def breiteste(profil, lo, hi):
    return _extrem(profil, lo, hi, True)


def schmalste(profil, lo, hi):
    return _extrem(profil, lo, hi, False)


def gerade(punkte):
    """Ausgleichsgerade y = a + b*z durch (z, y)-Paare (kleinste Quadrate)."""
    n = len(punkte)
    if n < 2:
        return (punkte[0][1] if n else 0.0), 0.0
    sz = sum(z for z, _ in punkte)
    sy = sum(y for _, y in punkte)
    szz = sum(z * z for z, _ in punkte)
    szy = sum(z * y for z, y in punkte)
    nenner = n * szz - sz * sz
    if abs(nenner) < 1e-12:
        return sy / n, 0.0
    b = (n * szy - sz * sy) / nenner
    return (sy - b * sz) / n, b


class Koerper:
    """Eine aufrecht stehende humanoide Punktwolke, scheibenweise lesbar."""

    FAECHER = 48    # Auflösung des Querschnitt-Histogramms

    def __init__(self, wolke):
        self.wolke = wolke
        self.zmin = min(p.z for p in wolke)
        self.zmax = max(p.z for p in wolke)
        self.hoehe = self.zmax - self.zmin
        self.fenster = self.hoehe / 100.0
        self.schritt = self.hoehe / 200.0

        # ── Welche waagerechte Achse ist BREITE, welche TIEFE? ───────
        # Ein Mensch ist auf Brusthöhe deutlich breiter als tief. Das ist
        # ein verlässlicheres Signal als eine Konvention, an die sich der
        # Generator nicht hält.
        oben = self.scheibe(self.zmin + self.hoehe * 0.60, self.hoehe * 0.10)
        _, _, sx = spanne(oben, 'x')
        _, _, sy = spanne(oben, 'y')
        self.breit, self.tief = ('x', 'y') if sx >= sy else ('y', 'x')

        # Vorläufige Körperachse aus dem Rumpfbereich. Sie muss nur gut
        # genug sein, um die Mittelsäule zu FINDEN; danach wird sie aus
        # der Mittelsäule selbst neu bestimmt.
        rumpf = self.scheibe(self.zmin + self.hoehe * 0.55, self.hoehe * 0.10)
        lo, hi, _ = spanne(rumpf, self.breit)
        self.b0 = (lo + hi) / 2
        self.t0 = mittel(rumpf, self.tief)

    # ── Scheiben und Säulen ─────────────────────────────────────────
    def scheibe(self, z, dicke=None, punkte=None):
        d = self.fenster if dicke is None else dicke
        q = self.wolke if punkte is None else punkte
        return [p for p in q if z <= p.z < z + d]

    def laeufe(self, s):
        """Zusammenhängende Läufe besetzter Fächer entlang der Breitenachse.

        Rückgabe je Lauf: (b_lo, b_hi, Punkte). Ein Lauf ist ein Körper,
        der in dieser Scheibe für sich steht — Rumpf, Arm, Bein.
        """
        if len(s) < 20:
            return []
        lo, hi, sp = spanne(s, self.breit)
        if sp <= 0:
            return []
        n = self.FAECHER
        fach = [[] for _ in range(n)]
        for p in s:
            fach[min(n - 1, int((getattr(p, self.breit) - lo) / sp * n))].append(p)
        aus, akt, start = [], [], None
        for i, f in enumerate(fach):
            if f:
                if start is None:
                    start = i
                akt.extend(f)
            elif start is not None:
                aus.append((lo + start / n * sp, lo + i / n * sp, akt))
                akt, start = [], None
        if start is not None:
            aus.append((lo + start / n * sp, hi, akt))
        return aus

    def saeule(self, z, dicke=None):
        """(Mittelsäule, Läufe links, Läufe rechts) einer Scheibe.

        Die Mittelsäule ist der Lauf, der die Körperachse enthält — oder,
        wenn die Achse gerade in einer Lücke liegt (das ist genau der
        Schritt), der ihr nächstliegende.
        """
        lf = self.laeufe(self.scheibe(z, dicke))
        if not lf:
            return None, [], []
        i = min(range(len(lf)),
                key=lambda k: 0.0 if lf[k][0] <= self.b0 <= lf[k][1]
                else min(abs(lf[k][0] - self.b0), abs(lf[k][1] - self.b0)))
        return lf[i], lf[:i], lf[i + 1:]

    def saeulenprofil(self, achse=None):
        """(z, Ausdehnung) der Mittelsäule über die ganze Höhe."""
        a = achse or self.breit
        prof = []
        z = self.zmin
        while z < self.zmax:
            m, _, _ = self.saeule(z)
            if m and len(m[2]) >= 8:
                prof.append((z + self.fenster / 2, spanne(m[2], a)[2]))
            z += self.schritt
        return prof


def vermesse(mesh):
    """Alle Landmarken einer aufrecht stehenden humanoiden Figur."""
    k = Koerper(punktwolke(mesh))
    b, t, h = k.breit, k.tief, k.hoehe
    m = {'hoehe': h, 'zmin': k.zmin, 'zmax': k.zmax, 'achse_breit': b, 'achse_tief': t}

    prof_saeule = k.saeulenprofil()
    m['profil_saeule'] = prof_saeule

    # ── Der Schritt: wo die Mittelsäule aufreisst ───────────────────
    # Von oben nach unten, erster Treffer. Verlangt wird eine Lücke, die
    # die Körperachse ÜBERSPANNT — sonst wäre auch der Spalt zwischen Arm
    # und Rumpf ein Treffer (genau daran ist der erste Anlauf gescheitert,
    # siehe Kopfkommentar).
    schritt_z = schritt_grenze = None
    z = k.zmin + h * 0.60
    while z > k.zmin + h * 0.20:
        lf = k.laeufe(k.scheibe(z))
        # Lücken, deren Mitte nah an der Körperachse liegt
        kand = [((a[1] + c[0]) / 2, a[1], c[0]) for a, c in zip(lf, lf[1:])
                if abs((a[1] + c[0]) / 2 - k.b0) < h * 0.05]
        if kand:
            g = min(kand, key=lambda q: abs(q[0] - k.b0))
            schritt_z, schritt_grenze = z + k.fenster / 2, g[0]
            break
        z -= k.schritt
    if schritt_z is None:
        raise SystemExit(
            'Kein Beinspalt gefunden — die Figur hat unterhalb der Hüfte keine\n'
            'getrennten Beine (bodenlanges Gewand?). Dieses Werkzeug misst nur\n'
            'zweibeinige Körper; für eine Kutte siehe tools/voelva-rig.py.')
    m['schritt_z'] = schritt_z
    m['schritt_grenze'] = schritt_grenze

    # ── Rumpf ───────────────────────────────────────────────────────
    # Alle vier über die Mittelsäule, also OHNE die Arme.
    huefte_z = breiteste(prof_saeule, schritt_z, schritt_z + h * 0.10)
    schulter_z = breiteste(prof_saeule, k.zmin + h * 0.72, k.zmin + h * 0.88)
    taille_z = schmalste(prof_saeule, huefte_z + h * 0.02, schulter_z - h * 0.08)
    hals_z = schmalste(prof_saeule, schulter_z + h * 0.005, schulter_z + h * 0.10)
    m.update(huefte_z=huefte_z, taille_z=taille_z, schulter_z=schulter_z, hals_z=hals_z)
    m['schulterbreite'] = dict(prof_saeule).get(
        min((abs(z - schulter_z), z) for z, _ in prof_saeule)[1], 0.0)

    # Körperachse endgültig: Mitte der Mittelsäule zwischen Hüfte und
    # Schulter. Erst hier, weil erst jetzt feststeht, wo das ist.
    achse_b, achse_t, n = 0.0, 0.0, 0
    z = huefte_z
    while z < schulter_z:
        mm, _, _ = k.saeule(z)
        if mm:
            lo, hi, _ = spanne(mm[2], b)
            achse_b += (lo + hi) / 2
            achse_t += mittel(mm[2], t)
            n += 1
        z += k.schritt
    m['achse'] = {b: achse_b / max(1, n), t: achse_t / max(1, n)}

    # ── Beine ───────────────────────────────────────────────────────
    # 'neg'/'pos' nach dem Vorzeichen der Breitenachse. Welche Seite der
    # FIGUR das ist, entscheidet sich erst mit der Blickrichtung.
    beine = {}
    for seite, waehle in (
            ('neg', lambda p: getattr(p, b) < schritt_grenze),
            ('pos', lambda p: getattr(p, b) >= schritt_grenze)):
        bein = [p for p in k.wolke if p.z < schritt_z and waehle(p)]
        achse_bein = mittel([p for p in bein
                             if k.zmin + h * 0.25 <= p.z < k.zmin + h * 0.40], b)
        # Enger Streifen um die Beinachse: sonst misst eine tiefe Scheibe
        # den ganzen (schräg stehenden) Fuss statt den Knöchel.
        nah = [p for p in bein if abs(getattr(p, b) - achse_bein) < h * 0.08]
        prof = []
        z = k.zmin
        while z < schritt_z:
            s = [p for p in nah if z <= p.z < z + k.fenster]
            if len(s) >= 8:
                prof.append((z + k.fenster / 2, spanne(s, t)[2]))
            z += k.schritt
        knie_z = schmalste(prof, k.zmin + h * 0.20, k.zmin + h * 0.34)
        # ── Knöchel: UNTERKANTE der schmalen Stelle, nicht ihr Minimum ──
        # Das Minimum des Beinprofils liegt an der schmalsten Stelle der
        # Wade — gemessen 10 % der Körperhöhe, also gut 18 cm über dem
        # Boden. Dort ist kein Gelenk, dort ist Schienbein.
        #
        # Das Gelenk sitzt darunter, an der Stelle, an der das Profil
        # wieder aufgeht: Ab dort misst die Scheibe den FUSS (18 % der
        # Höhe lang) und nicht mehr den Unterschenkel. Genommen wird
        # deshalb die tiefste Scheibe, die noch schmal ist — 25 % über dem
        # Minimum ist der Rand, ab dem der Spann eindeutig mitzählt.
        eng = schmalste(prof, k.zmin + h * 0.02, k.zmin + h * 0.16)
        eng_w = dict(prof).get(eng, 0.0)
        knoechel_z = eng
        for z_p, w_p in sorted(prof):
            if z_p > eng:
                break
            if w_p <= eng_w * 1.25:
                knoechel_z = z_p
                break

        # ── Ballen: der Knick im Fussrücken ─────────────────────────
        # Dahinter ist der Fuss so hoch wie der Spann, davor nur noch so
        # hoch wie die Zehen. Gesucht ist der grösste Höhenabfall längs
        # der Tiefenachse — in BEIDE Richtungen, weil die Blickrichtung
        # an dieser Stelle noch nicht feststeht.
        fuss = [p for p in bein if p.z < k.zmin + h * 0.09]
        t_lo, t_hi, t_sp = spanne(fuss, t)
        nf = 20
        hoehen = []
        for i in range(nf):
            teil = [p for p in fuss
                    if t_lo + t_sp * i / nf <= getattr(p, t) < t_lo + t_sp * (i + 1) / nf]
            hoehen.append(max((p.z for p in teil), default=k.zmin) - k.zmin)
        # Wo genau der Knick sitzt, hängt an der Blickrichtung — und die
        # steht erst nach diesem Block fest. Hier wird nur das Höhenprofil
        # aufbewahrt; `ballen_tief` fällt weiter unten.
        vor = max(range(nf - 1), key=lambda i: hoehen[i] - hoehen[i + 1])
        rueck = max(range(nf - 1), key=lambda i: hoehen[i + 1] - hoehen[i])
        zehen = +1 if (hoehen[vor] - hoehen[vor + 1]
                       >= hoehen[rueck + 1] - hoehen[rueck]) else -1

        beine[seite] = {
            'fussprofil': (t_lo, t_sp, hoehen),
            'achse_breit': achse_bein,
            'achse_tief': mittel([p for p in bein if k.zmin + h * 0.25 <= p.z
                                  < k.zmin + h * 0.40], t),
            'knie_z': knie_z,
            'knoechel_z': knoechel_z,
            'knoechel_tief': mittel([p for p in nah if knoechel_z - k.fenster <= p.z
                                     < knoechel_z + k.fenster], t),
            'sohle_z': min((p.z for p in fuss), default=k.zmin),
            'fuss_tief': (t_lo, t_hi),
            'fuss_breit': spanne(fuss, b)[:2],
            'zehen_richtung': zehen,
        }
    m['beine'] = beine

    # ── Blickrichtung: der Fuss ist vor dem Knöchel länger als hinter ──
    # "Blickrichtung MESSEN statt ansehen" steht im Kopf von
    # tools/furloc-rig.py, und die Völva ist zweimal daran gescheitert,
    # dass jemand hingesehen hat. Gemessen wird hier der Fussgrundriss
    # gegen den KNÖCHEL: Vom Knöchel bis zur Zehenspitze ist es weiter als
    # vom Knöchel bis zur Ferse — bei jedem Wirbeltier, das auf Sohlen
    # geht, und unabhängig davon, wie gut die Zehen modelliert sind.
    #
    # Der zuerst benutzte Knick im Fussrücken (`zehen_richtung`) taugt
    # dafür nicht: Er ist ein Höhenunterschied von wenigen Millimetern und
    # kippt bei einem grob aufgelösten Fuss. Er bleibt trotzdem im
    # Ergebnis, weil das Rig den BALLEN daraus nimmt — dort ist er nur
    # eine Position auf einer bereits bekannten Achse, keine Entscheidung.
    stimmen = 0
    for d in beine.values():
        kn = d['knoechel_tief']
        stimmen += (d['fuss_tief'][1] - kn) - (kn - d['fuss_tief'][0])
    m['blick_tief'] = 1 if stimmen > 0 else -1
    # Gegenprobe über den Knick im Fussrücken. Weichen beide voneinander
    # ab, ist das eine Warnung wert — nicht mehr, denn der Knick ist das
    # schwächere Merkmal.
    knick = sum(d['zehen_richtung'] for d in beine.values())
    m['blick_knick'] = 1 if knick > 0 else -1

    # ── Hüftgelenk: gesetzt, nicht gemessen (siehe ANTEIL_HUEFTGELENK) ──
    m['hueftgelenk_z'] = k.zmin + h * ANTEIL_HUEFTGELENK

    # ── Der Ballen, jetzt mit bekannter Blickrichtung ───────────────
    # Der Knick im Fussrücken: dahinter der Spann, davor nur noch die
    # Zehen. Gesucht wird der grösste Höhenabfall NACH VORN — vorher war
    # die Suchrichtung offen, und an einem grob aufgelösten Fuss gewann
    # dann gern der Absatz hinten.
    #
    # Beim Menschen liegt der Ballen auf 70 bis 75 % der Sohlenlänge. Ein
    # Ergebnis ausserhalb von 50..90 % ist Rauschen und wird durch 73 %
    # ersetzt — lieber eine bekannte Näherung als ein gemessener Unsinn.
    for d in beine.values():
        t_lo, t_sp, hoehen = d.pop('fussprofil')
        nf = len(hoehen)
        if m['blick_tief'] > 0:
            i = max(range(nf - 1), key=lambda j: hoehen[j] - hoehen[j + 1])
            anteil = (i + 1) / nf
        else:
            i = max(range(nf - 1), key=lambda j: hoehen[j + 1] - hoehen[j])
            anteil = 1.0 - i / nf
        if not 0.50 <= anteil <= 0.90:
            print(f'  ⚠ Ballen bei {anteil * 100:.0f} % der Sohlenlänge gemessen — '
                  'unplausibel, ersetzt durch 73 %.')
            anteil = 0.73
        d['ballen_anteil'] = anteil
        d['ballen_tief'] = (t_lo + t_sp * anteil if m['blick_tief'] > 0
                            else t_lo + t_sp * (1.0 - anteil))

    # ── Arme ────────────────────────────────────────────────────────
    # Ein Arm ist ein Lauf NEBEN der Mittelsäule. Verfolgt wird sein
    # Schwerpunkt von der Fingerspitze bis zur Achsel; durch diese Spur
    # wird eine Gerade gelegt und bis auf Schulterhöhe verlängert.
    spuren = {'neg': [], 'pos': []}
    achsel = {'neg': None, 'pos': None}
    dicke = {'neg': [], 'pos': []}
    z = k.zmin
    while z < schulter_z + h * 0.03:
        mm, links, rechts = k.saeule(z)
        for seite, lf in (('neg', links), ('pos', rechts)):
            if not lf:
                continue
            # Der äusserste Lauf ist der Arm (bei mehreren Läufen auf
            # einer Seite — etwa Hand neben Oberschenkel — der aussen).
            lauf = lf[0] if seite == 'neg' else lf[-1]
            if len(lauf[2]) < 8:
                continue
            # ── Und er muss weit genug aussen liegen ────────────────
            # Unterhalb des Schritts ist das ZWEITE BEIN ein Lauf neben
            # der Mittelsäule. Ohne diese Schranke wanderte die Armspur
            # dort ins Bein und die "Armlänge" kam auf 78 % der
            # Körperhöhe (gemessen im ersten Anlauf) statt auf 44 %.
            #
            # Die Schranke ist ein Drittel der Schulterbreite: Die
            # Beinachsen liegen bei 14 % davon, die Armachse bei 76 %.
            if abs(mittel(lauf[2], b) - k.b0) < m['schulterbreite'] * 0.33:
                continue
            zm = z + k.fenster / 2
            spuren[seite].append((zm, mittel(lauf[2], b), mittel(lauf[2], t)))
            dicke[seite].append(spanne(lauf[2], t)[2])
            if achsel[seite] is None or zm > achsel[seite]:
                achsel[seite] = zm
        z += k.schritt

    arme = {}
    for seite in ('neg', 'pos'):
        spur = spuren[seite]
        if len(spur) < 8:
            arme[seite] = None
            continue
        finger_z = min(s[0] for s in spur)
        # Gerade durch die MITTLEREN zwei Dritteln der Spur: Hand und
        # Achsel ziehen die Enden aus der Flucht (die Hand ist breiter
        # als der Unterarm, die Achsel verschmilzt schon mit dem Rumpf).
        kern = [s for s in spur
                if finger_z + (achsel[seite] - finger_z) * 0.15 <= s[0]
                <= finger_z + (achsel[seite] - finger_z) * 0.85]
        ab, mb = gerade([(s[0], s[1]) for s in kern])
        at, mt = gerade([(s[0], s[2]) for s in kern])
        armdicke = sorted(dicke[seite])[len(dicke[seite]) // 2]
        # Schultergelenk: eine halbe Armdicke über der Achsel, auf der
        # verlängerten Armachse. Höher wäre der Knochen, tiefer die
        # Achselhöhle.
        gelenk_z = achsel[seite] + armdicke * 0.5
        gelenk = (ab + mb * gelenk_z, at + mt * gelenk_z, gelenk_z)
        # Fingerspitze auf derselben Geraden — der gemessene Punkt selbst
        # ist der tiefste Vertex der Hand und liegt seitlich daneben.
        spitze = (ab + mb * finger_z, at + mt * finger_z, finger_z)
        laenge = math.dist(gelenk, spitze)

        def auf_arm(anteil, g=gelenk, s=spitze):
            return tuple(g[i] + (s[i] - g[i]) * anteil for i in range(3))

        arme[seite] = {
            'gelenk': gelenk,
            'spitze': spitze,
            'achsel_z': achsel[seite],
            'dicke': armdicke,
            'laenge': laenge,
            'ellbogen': auf_arm(ANTEIL_OBERARM),
            'handgelenk': auf_arm(ANTEIL_OBERARM + ANTEIL_UNTERARM),
        }
    m['arme'] = arme
    return m


def bericht(m):
    b, t, h = m['achse_breit'], m['achse_tief'], m['hoehe']
    v = '+' if m['blick_tief'] > 0 else '-'
    print(f'FIGUR: Höhe {h:.4f}  Sohle z={m["zmin"]:.4f}  Scheitel z={m["zmax"]:.4f}')
    print(f'ACHSEN: breit={b}  tief={t}  vorn={v}{t}  '
          f'Körperachse {b}={m["achse"][b]:+.4f} {t}={m["achse"][t]:+.4f}')
    print(f'RUMPF: Schritt {_a(m["schritt_z"], h)}  Hüfte(breit) {_a(m["huefte_z"], h)}  '
          f'Taille {_a(m["taille_z"], h)}  Schulter {_a(m["schulter_z"], h)} '
          f'(breit {m["schulterbreite"]:.4f})  Hals {_a(m["hals_z"], h)}')
    print(f'HÜFTGELENK: z={m["hueftgelenk_z"]:.4f} (gesetzt auf '
          f'{ANTEIL_HUEFTGELENK * 100:.0f} % der Höhe, nicht gemessen — '
          f'der Schritt liegt unter dem Lendentuch)')
    if m['blick_tief'] != m['blick_knick']:
        print('  ⚠ Fussgrundriss und Knick im Fussrücken zeigen in '
              'GEGENRICHTUNGEN. Genommen wird der Grundriss.')
    for s, d in m['beine'].items():
        print(f'BEIN {s}: Achse {b}={d["achse_breit"]:+.4f} {t}={d["achse_tief"]:+.4f}  '
              f'Knie {_a(d["knie_z"], h)}  Knöchel {_a(d["knoechel_z"], h)}  '
              f'Sohle z={d["sohle_z"]:.4f}  Fuss {t} {d["fuss_tief"][0]:+.3f}..'
              f'{d["fuss_tief"][1]:+.3f} (Knöchel {t}={d["knoechel_tief"]:+.3f})  '
              f'Ballen {t}={d["ballen_tief"]:+.4f} ({d["ballen_anteil"] * 100:.0f} %)')
        # Gegenprobe gegen die Anthropometrie — ein Knie bei 12 % der
        # Körperhöhe wäre ein Messfehler, kein Körperbau.
        for name, ist, soll in (('Knie', d['knie_z'], ERWARTET_KNIE),
                                ('Knöchel', d['knoechel_z'], ERWARTET_KNOECHEL)):
            if ist is None or abs((ist - m['zmin']) / h - soll) > 0.06:
                print(f'  ⚠ {name} bei {(ist - m["zmin"]) / h * 100:.1f} % der Höhe — '
                      f'erwartet wären rund {soll * 100:.0f} %. Messung prüfen.')
    for s, d in m['arme'].items():
        if d is None:
            print(f'ARM {s}: NICHT GEFUNDEN — liegt der Arm am Körper an?')
            continue
        print(f'ARM {s}: Gelenk ({d["gelenk"][0]:+.3f} {d["gelenk"][1]:+.3f} '
              f'{d["gelenk"][2]:.3f})  Ellbogen z={d["ellbogen"][2]:.3f}  '
              f'Handgelenk z={d["handgelenk"][2]:.3f}  '
              f'Spitze z={d["spitze"][2]:.3f}  Länge {d["laenge"]:.3f} '
              f'({d["laenge"] / h * 100:.0f} % der Höhe, erwartet 44 %)  '
              f'Dicke {d["dicke"]:.3f}  Achsel z={d["achsel_z"]:.3f}')


def _a(z, h):
    return '—' if z is None else f'z={z:.4f}'


def lade(glb):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=pfad(glb))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.vertices)]
    if not meshes:
        raise SystemExit('keine Mesh-Geometrie gefunden')
    return max(meshes, key=lambda o: len(o.data.vertices))


if __name__ == '__main__':
    GLB = arg('--glb')
    if not GLB:
        raise SystemExit('--glb fehlt')
    mesh = lade(GLB)
    print(f'MESH {mesh.name}: {len(mesh.data.vertices)} Vertices, '
          f'{sum(len(p.vertices) - 2 for p in mesh.data.polygons)} Dreiecke')
    masse = vermesse(mesh)
    bericht(masse)
    if arg('--json'):
        schlank = {kk: vv for kk, vv in masse.items() if kk != 'profil_saeule'}
        with open(pfad(arg('--json')), 'w') as f:
            json.dump(schlank, f, indent=2)
        print(f'GESCHRIEBEN {pfad(arg("--json"))}')
