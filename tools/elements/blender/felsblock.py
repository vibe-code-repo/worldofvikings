# Erzeugt: die Blocklage der Fels-Frontschicht für `make-stonevault.py --stil fels`.
#
# Reine Arithmetik — dieses Modul kennt WEDER bpy NOCH bmesh. Das ist kein
# Stilwunsch, sondern der Grund, warum es prüfbar ist: `make-stonevault.py`
# läuft nur unter Blender, und was nur unter Blender läuft, misst niemand
# zweimal. So lässt sich die Lage mit blossem `python3` befragen
# (`--dump`), und `tools/elements/pruefung/fels-frontschicht.mjs` hält
# Naht, Hüllbox und Dreiecksbudget fest, bevor das erste GLB entsteht.
#
# ── Was „Fels" hier heisst ──────────────────────────────────────────────
# Der heutige Verband ist ein Backsteinverband: 8 gleich hohe Reihen,
# Ziegel von 0,5 m, halber Versatz, jede Fuge gerade (`make-stonevault.py`,
# `wand()`/`innenwand()`). Der Fels-Stil ersetzt genau diese Frontschicht:
#
#   * REIHEN verschieden hoch (nicht 8 × 0,4375),
#   * BLÖCKE verschieden breit (nicht 0,5),
#   * LAGERFUGEN gebrochen statt waagerecht — eine 2-m-periodische,
#     stückweise lineare Welle,
#   * STOSSFUGEN leicht aus dem Lot (unten und oben verschieden tief
#     eingerückt),
#   * TIEFE je Block gestreut, damit im Streiflicht Kanten stehen.
#
# ── Die drei Zwänge, die die Zahlen festlegen ───────────────────────────
# (1) NAHT. Alle Module stossen im 2-m-Raster aneinander. Deshalb ist das
#     Gitter GLOBAL: es beginnt immer bei -GRID/2 und wiederholt sich alle
#     2 m, und ein Modul SCHNEIDET nur daraus aus. Was an der Kante
#     abgeschnitten wird, setzt der Nachbar exakt fort — genau wie heute
#     die halben Ziegel. Die Welle ist aus demselben Grund periodisch und
#     an den Rasterpunkten stetig.
#
# (2) HÜLLBOX. `DG_RockVault` wird von `DG_StoneVault` ABGELEITET (Konzept
#     Vorhaben 3): gleiche `size`, gleiche Connectors. Also darf kein Block
#     weiter vorstehen als das heutige Ziegelrelief. Die Streuung geht
#     deshalb ausschliesslich nach HINTEN, und mindestens ein Block steht
#     ganz vorn, damit die Box auch nicht schrumpft.
#
# (3) ENDSTREIFEN. Der Nahtschluss vom 03.09.2026 legt an jedes Paneelende
#     einen Streifen, dessen Vorderseite `ECK_TIEFE` = 3 cm HINTER der
#     Ziegelfront liegt. Ein Block, der weiter als 3 cm zurückweicht,
#     verschwände hinter dem Streifen des Nachbarpaneels — und der stünde
#     dann als 6 cm breites Band alle 2 m vor der Wand. Die Rücknahme ist
#     darum auf 2,5 cm gedeckelt. Das ist die eigentliche Grenze der
#     Tiefenstreuung, nicht die 10 cm aus dem Konzept (die gelten der
#     Spielerkapsel und sind hier nie erreicht).
#
# Aufruf als Werkzeug:
#   python3 felsblock.py --dump <lo> <hi> [--seed N] [--reihen K]
#                               [--lage L] [--z0 A] [--z1 B] [--randluft R]
#
# The rock front layer's block lattice — pure arithmetic, no Blender.
import json
import math
import sys

# ── Masse, die mit make-stonevault.py übereinstimmen MÜSSEN ─────────────
GRID = 2.0
HOEHE = 3.5
PROT = 0.06           # Relief-Vorsprung des Ziegelverbands = vorderste Ebene
ECK_TIEFE = 0.03      # Rückversatz der Endstreifen-Vorderseite

SEED = 20260904       # Vorgabe-Seed; `--seed` setzt ihn um

# ── Stellschrauben der Lage ─────────────────────────────────────────────
REIHEN = 7            # statt 8 Ziegelreihen: höhere, ungleiche Lagen
PERIODE = GRID        # das Gitter wiederholt sich alle 2 m (Modulraster)
ANKER = -GRID / 2     # linker Rand der ersten Periode

REIHE_MIN, REIHE_MAX = 0.74, 1.26   # Faktor auf die mittlere Reihenhöhe
BLOECKE_MIN, BLOECKE_MAX = 4, 5     # Blöcke je Periode und Reihe
BREITE_MIN, BREITE_MAX = 0.78, 1.22  # Faktor auf die mittlere Blockbreite

# Fugenbreite: HALBE Fuge je Blockkante, zwei Kanten treffen sich also zu
# 1,6 .. 4,4 cm. Der erste Lauf stand bei 1,0 .. 3,0 (= 2 .. 6 cm) — im
# Kontaktbogen lasen sich die Bloecke dadurch wie lose verlegte Platten
# statt wie gesetztes Mauerwerk, weil zwischen ihnen ueberall die 6 cm
# tiefer liegende Rueckplatte im Schatten stand.
FUGE_MIN, FUGE_MAX = 0.008, 0.022   # halbe Fuge je Blockkante
WELLE = 0.030         # Amplitude der gebrochenen Lagerfuge
WELLE_KNOTEN = 8      # Stützstellen je Periode -> alle 0,25 m
RAND_LUFT = 0.010     # Abstand der untersten/obersten Fuge zu Boden/Decke

# Rücknahme der Blocktiefe: 0 (ganz vorn) bis RUECKNAHME (siehe Zwang 3).
RUECKNAHME = ECK_TIEFE - 0.005      # 0,025
MINDEST = 0.05        # Splitter darunter wirft schon der Ziegelverband weg
EPSILON = 1e-9

# ── Das Sicherheitsband um die Periodengrenze ───────────────────────────
# Die Modulgrenzen liegen auf den Periodengrenzen (ANKER + m·2 m). Eine
# Stossfuge DICHT DANEBEN ist die eine Stelle, an der der Nahtschluss
# wirklich reisst, und zwar so:
#
#   Liegt die Fuge 4 cm vor der Grenze, bleibt dem einen Modul ein 4 cm
#   breites Reststück. Das fällt unter MINDEST und wird verworfen — im
#   Nachbarmodul steht der Block aber vollständig. Ergebnis: alle 2 m
#   eine 4 cm breite Kerbe, in der die Rückplatte durchsieht. Genau das
#   hat der erste Lauf dieses Moduls gezeigt (5 Reststücke an der einen,
#   7 an der anderen Kante), und genau dagegen ist
#   `pruefung/fels-frontschicht.mjs` geschrieben.
#
# Deshalb: Eine Fuge, die näher als SCHNAPP an eine Periodengrenze fällt,
# wird EXAKT auf sie gesetzt. Dann teilen sich die beiden Module dort
# eine gewöhnliche Fuge statt eines zerschnittenen Blocks. Alle übrigen
# Fugen liegen danach mindestens SCHNAPP von der Grenze entfernt, also
# bleibt jedem Reststück mehr als MINDEST.
SCHNAPP = MINDEST + FUGE_MAX + 0.01  # 0,09

# Im selben Band stehen die Stossfugen lotrecht: eine schräge Fuge quer
# über die Schnittebene hätte ihr unteres Ende im einen und ihr oberes im
# anderen Modul. Nach dem Schnappen liegt dort ohnehin nur noch die
# Grenze selbst — das Band ist die Zusage, nicht die Ausnahme.
LOT_BAND = SCHNAPP


def _zufall(*teile):
    """Deterministischer Wert in [0,1) aus ganzen Zahlen.

    Nicht `random`: dessen Folge ist zwischen Python-Fassungen nicht
    zugesichert, und eine Blocklage, die sich beim Interpreter-Update
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


def reihen_grenzen(seed, reihen, z0, z1, rand_luft):
    """Die Höhen der Lagerfugen — GLOBAL, also in jedem Modul gleich.

    Warum global: Zwei Paneele in einem geraden Wandlauf stossen
    aneinander. Hätte jedes seine eigenen Reihenhöhen, liefe an jeder
    Modulgrenze ein Sprung durch alle Lagerfugen — das auffälligste
    2-m-Muster, das man bauen kann.
    """
    roh = [_spanne(_zufall(seed, 11, r), REIHE_MIN, REIHE_MAX) for r in range(reihen)]
    summe = sum(roh)
    hoch = z1 - z0
    grenzen = [z0]
    for h in roh:
        grenzen.append(grenzen[-1] + h * hoch / summe)
    grenzen[-1] = z1
    # Boden und Decke bleiben WAAGERECHT und behalten ihre Luft: unten
    # sonst eine koplanare Fläche auf der Bodenplatte, oben die Haarlinie
    # an der Decke, die der Nahtschluss gerade geschlossen hat.
    grenzen[0] = z0 + rand_luft
    grenzen[-1] = z1 - rand_luft
    return grenzen


def _welle(seed, lage, r, x):
    """Die gebrochene Lagerfuge: stückweise linear über ein festes
    0,25-m-Gitter, 2 m periodisch.

    Periodisch UND an den Stützstellen stetig — deshalb liefert sie an
    x = +1 (Kante des einen Moduls) denselben Wert wie an x = -1 (Kante
    des Nachbarn). Ohne diese Eigenschaft klafft die Naht.
    """
    t = (x - ANKER) / PERIODE * WELLE_KNOTEN
    i = math.floor(t)
    f = t - i
    a = _zufall(seed, 21, lage, r, i % WELLE_KNOTEN) * 2.0 - 1.0
    b = _zufall(seed, 21, lage, r, (i + 1) % WELLE_KNOTEN) * 2.0 - 1.0
    return (a + (b - a) * f) * WELLE


def _kante_z(grenzen, seed, lage, r, x, reihen):
    """Höhe der r-ten Lagerfuge an der Stelle x."""
    if r == 0 or r == reihen:
        return grenzen[r]
    return grenzen[r] + _welle(seed, lage, r, x)


def _schnitte(seed, lage, r):
    """Die Stossfugen EINER Periode als Abstände vom Periodenanfang.

    Gibt (positionen, anzahl) zurück; positionen[0] = 0, positionen[-1] =
    PERIODE. Die Phase verschiebt den Anfang, damit nicht in jeder Reihe
    eine Fuge auf derselben Stelle sitzt.
    """
    n = BLOECKE_MIN + int(_zufall(seed, 31, lage, r) * (BLOECKE_MAX - BLOECKE_MIN + 1))
    n = min(n, BLOECKE_MAX)
    roh = [_spanne(_zufall(seed, 41, lage, r, j), BREITE_MIN, BREITE_MAX) for j in range(n)]
    summe = sum(roh)
    pos = [0.0]
    for w in roh:
        pos.append(pos[-1] + w * PERIODE / summe)
    pos[-1] = PERIODE
    phase = _zufall(seed, 51, lage, r) * PERIODE
    return [p + phase for p in pos], n


def _fuge(seed, lage, r, j, teil):
    """Ein Fugenmass am Gitterblock (r, j) — HALBE Fuge, je Blockkante eins.

    `teil` unterscheidet die sechs Kanten eines Blocks: 0/1 links unten
    und oben, 2/3 rechts unten und oben, 4/5 unten und oben. Sie haengen
    am GITTER, nicht an der Stelle — deshalb bekommen die zwei Haelften
    eines an der Modulgrenze zerschnittenen Blocks dieselben Masse.
    """
    return _spanne(_zufall(seed, 61, lage, r, j, teil), FUGE_MIN, FUGE_MAX)


def _lotrecht(x):
    """Liegt die Stossfuge im Sicherheitsband um eine Periodengrenze?"""
    d = (x - ANKER) % PERIODE
    return min(d, PERIODE - d) < LOT_BAND


def _schnappen(x):
    """Eine Fuge dicht an einer Periodengrenze auf diese setzen (s. SCHNAPP)."""
    d = (x - ANKER) / PERIODE
    nah = round(d)
    grenze = ANKER + nah * PERIODE
    return grenze if abs(x - grenze) < SCHNAPP else x


def an_periodengrenze(x):
    """Sitzt x auf einer Modulgrenze (= Periodengrenze des Gitters)?

    Das unterscheidet die beiden Arten von Klemmen, und daran hängt, ob
    die Schicht dort AUFHÖREN oder BIS ZUM ANSCHLAG reichen soll:

      * Modulgrenze (±1,0): Hier hört das Modul auf, und der Nachbar
        setzt den Block fort. Eine Fuge davor wäre der Fehler.
      * Innerer Anschlag (Torbogen-Laibung bei ±0,6, Anschluss der
        Suedwand im Eckmodul bei 0,70): Dahinter kommt kein Nachbar,
        sondern die Flanke eines anderen Bauteils. Endete die Schicht
        dort ein paar Zentimeter früher, sähe man an der Türlaibung in
        die Fuge — deshalb wird der letzte Block bis an den Anschlag
        gezogen (s. `_dehnen`).
    """
    d = (x - ANKER) % PERIODE
    return min(d, PERIODE - d) < 1e-9


def _dehnen(reihe, lo, hi, dehn_lo, dehn_hi, grenzen, seed, lage, r, reihen):
    """Den äussersten Block einer Reihe bis an einen INNEREN Anschlag ziehen.

    Warum überhaupt: An einem inneren Anschlag darf keine Fuge stehen —
    dahinter kommt kein Nachbarblock, der sie schliesst, sondern die
    Flanke eines anderen Bauteils. Das trifft zwei Stellen: die Laibung
    des Torbogens (dort sähe man sonst in eine Kerbe neben der Tür) und
    den Anschluss der Suedwand an die Westwand im Eckmodul.

    An einer MODULGRENZE geschieht das ausdrücklich nicht — dort ist die
    Fuge richtig, weil der Nachbar den Block fortsetzt.
    """
    if not reihe:
        return reihe
    reihe.sort(key=lambda b: b["xu"][0])
    for b, seite, ziel, ziehen in ((reihe[0], 0, lo, dehn_lo),
                                   (reihe[-1], 1, hi, dehn_hi)):
        if not ziehen:
            continue
        b["xu"][seite] = ziel
        b["xo"][seite] = ziel
        # Die Höhen wandern mit: sie sind an ihrer x-Stelle abgelesen, und
        # die hat sich gerade verschoben. Ohne das bliebe der Block an
        # der neuen Kante auf der alten Höhe stehen — eine Stufe genau
        # dort, wo die Schicht dicht sein soll.
        b["zu"][seite] = _kante_z(grenzen, seed, lage, r, ziel, reihen) + b["_fu"]
        b["zo"][seite] = _kante_z(grenzen, seed, lage, r + 1, ziel, reihen) - b["_fo"]
        if r == 0:
            b["zu"][seite] = grenzen[0]
        if r == reihen - 1:
            b["zo"][seite] = grenzen[reihen]
    for b in reihe:
        del b["_fu"], b["_fo"]
    return reihe


def fels_bloecke(lo, hi, seed=SEED, reihen=REIHEN, lage=0,
                 z0=0.0, z1=HOEHE, rand_luft=RAND_LUFT):
    """Die Blöcke der Fels-Frontschicht zwischen lo und hi.

    Jeder Block ist ein Sechsflächner mit lotrechter Vorder- und
    Rückseite, aber vier verschiedenen Ecken in der Wandebene:
      xu = (links unten, rechts unten)   zu = Höhen an diesen beiden x
      xo = (links oben,  rechts oben)    zo = Höhen an diesen beiden x
      tiefe = Vorsprung vor der Rückplatte (0 < tiefe <= PROT)
    """
    grenzen = reihen_grenzen(seed, reihen, z0, z1, rand_luft)
    bloecke = []
    # Perioden, die [lo, hi] überhaupt berühren können — eine Reserve nach
    # jeder Seite, weil die Phase den Anfang verschiebt.
    m0 = int(math.floor((lo - ANKER) / PERIODE)) - 1
    m1 = int(math.ceil((hi - ANKER) / PERIODE)) + 1
    dehn_lo = not an_periodengrenze(lo)
    dehn_hi = not an_periodengrenze(hi)
    for r in range(reihen):
        reihe = []
        pos, n = _schnitte(seed, lage, r)
        for m in range(m0, m1 + 1):
            basis = ANKER + m * PERIODE
            for j in range(n):
                links = _schnappen(basis + pos[j])
                rechts = _schnappen(basis + pos[j + 1])
                if rechts < lo - EPSILON or links > hi + EPSILON:
                    continue
                # Fugen. An einer Stossfuge im Sicherheitsband steht sie
                # lotrecht (siehe LOT_BAND), sonst darf sie kippen.
                fl_u = _fuge(seed, lage, r, j, 0)
                fl_o = fl_u if _lotrecht(links) else _fuge(seed, lage, r, j, 1)
                fr_u = _fuge(seed, lage, r, (j + 1) % n, 2)
                fr_o = fr_u if _lotrecht(rechts) else _fuge(seed, lage, r, (j + 1) % n, 3)

                xu0, xu1 = links + fl_u, rechts - fr_u
                xo0, xo1 = links + fl_o, rechts - fr_o
                # Klemmen auf das Modul. Der Schnitt ist eine SENKRECHTE
                # Ebene — genau deshalb trifft das Reststück drüben.
                xu0, xo0 = max(xu0, lo), max(xo0, lo)
                xu1, xo1 = min(xu1, hi), min(xo1, hi)
                if xu1 - xu0 < MINDEST or xo1 - xo0 < MINDEST:
                    continue

                zu0 = _kante_z(grenzen, seed, lage, r, xu0, reihen) + _fuge(seed, lage, r, j, 4)
                zu1 = _kante_z(grenzen, seed, lage, r, xu1, reihen) + _fuge(seed, lage, r, j, 4)
                zo0 = _kante_z(grenzen, seed, lage, r + 1, xo0, reihen) - _fuge(seed, lage, r, j, 5)
                zo1 = _kante_z(grenzen, seed, lage, r + 1, xo1, reihen) - _fuge(seed, lage, r, j, 5)
                # Die äusserste Reihe bleibt an ihrer waagerechten Fuge
                # kleben: dort ist `_kante_z` schon wellenfrei, die Fuge
                # käme nur als zweite Luft dazu.
                if r == 0:
                    zu0 = zu1 = grenzen[0]
                if r == reihen - 1:
                    zo0 = zo1 = grenzen[reihen]
                if min(zo0 - zu0, zo1 - zu1) < MINDEST:
                    continue

                # Tiefe: nur nach hinten, und die Stufe hängt am GITTER-
                # block (r, j), nicht an der Position — sonst hätten die
                # zwei Hälften eines abgeschnittenen Blocks verschiedene
                # Tiefe, und die Naht bekäme eine Stufe.
                stufe = _zufall(seed, 71, lage, r, j)
                tiefe = PROT - RUECKNAHME * stufe
                reihe.append({
                    "_fu": _fuge(seed, lage, r, j, 4),
                    "_fo": _fuge(seed, lage, r, j, 5),
                    "r": r,
                    "xu": [xu0, xu1],
                    "xo": [xo0, xo1],
                    "zu": [zu0, zu1],
                    "zo": [zo0, zo1],
                    "tiefe": tiefe,
                })
        bloecke.extend(_dehnen(reihe, lo, hi, dehn_lo, dehn_hi,
                               grenzen, seed, lage, r, reihen))
    for b in bloecke:
        for k in ("xu", "xo", "zu", "zo"):
            b[k] = [round(v, 9) for v in b[k]]
        b["tiefe"] = round(b["tiefe"], 9)
    # Mindestens EIN Block steht ganz vorn, sonst schrumpft die Hüllbox.
    if bloecke:
        vorderster = max(bloecke, key=lambda b: b["tiefe"])
        vorderster["tiefe"] = PROT
    bloecke.sort(key=lambda b: (b["r"], b["xu"][0]))
    return bloecke


def _dump(argv):
    lo, hi = float(argv[0]), float(argv[1])
    opt = {"--seed": SEED, "--reihen": REIHEN, "--lage": 0,
           "--z0": 0.0, "--z1": HOEHE, "--randluft": RAND_LUFT}
    i = 2
    while i < len(argv):
        opt[argv[i]] = float(argv[i + 1])
        i += 2
    bloecke = fels_bloecke(lo, hi, seed=int(opt["--seed"]), reihen=int(opt["--reihen"]),
                           lage=int(opt["--lage"]), z0=opt["--z0"], z1=opt["--z1"],
                           rand_luft=opt["--randluft"])
    print(json.dumps({
        "seed": int(opt["--seed"]),
        "reihen": int(opt["--reihen"]),
        "lo": lo, "hi": hi,
        "prot": PROT,
        "ruecknahme": RUECKNAHME,
        "bloecke": bloecke,
    }))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--dump":
        _dump(sys.argv[2:])
    else:
        raise SystemExit("Aufruf: python3 felsblock.py --dump <lo> <hi> [--seed N] …")
