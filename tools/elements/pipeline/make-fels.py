#!/usr/bin/env python3
# Erzeugt: das kachelbare Fels-Texturpaar stein_fels.png + stein_fels_normal.png (1024², prozedural).
#
# ── Warum prozedural und nicht aus der KI-Kette ──────────────────────
# Das Konzept lässt die lokale KI ausdrücklich nur als REFERENZ zu. Eine
# KI-Kachel ist nicht periodisch: sie hat vier Ränder, die zufällig
# aussehen, aber nicht zusammenpassen — an der Wand wird daraus ein
# Gitternetz aus Nähten. Hier wird der Zufall dagegen auf einem TORUS
# gewürfelt: jede Rauschebene ist von Haus aus periodisch, und die
# Zellabstände werden mit umlaufender Differenz gemessen. Die Kachelung
# ist damit keine Nachbearbeitung (kein Spiegeln, kein Überblenden),
# sondern eine Eigenschaft der Konstruktion.
#
# ── Warum geneigte Ebenen und kein Fugennetz ─────────────────────────
# Der Torus wird in Zellen zerlegt (Voronoi), aber die Zellen werden
# NICHT dunkel umrandet. Jede bekommt eine eigene geneigte EBENE, und die
# Kante entsteht von selbst als Sprung in der Normalen. Der Unterschied
# ist der ganze Unterschied zwischen Fels und getrocknetem Schlamm: Eine
# Gesteinsfläche zeigt ihre Bruchstücke dadurch, dass jedes das Licht
# anders zurückwirft — nicht durch Striche zwischen ihnen. Drei frühere
# Fassungen dieser Datei haben es mit Fugen versucht, in jeder Dosierung,
# und alle drei sahen nach Trockenriss aus.
#
# Aus demselben Grund tragen die Facetten das Bild im HÖHENFELD und fast
# nichts im Albedo: Granit ist ziemlich einfarbig, was man sieht, ist
# Licht auf Geometrie. Ein Albedo, das die Bruchstücke einfärbt, wird zum
# Kieselmosaik.
#
# ── Warum die Zellgrenzen verzerrt und verschmolzen werden ───────────
# Unverzerrt sind Voronoi-Kanten glatte Kurven, und ein ungestörtes
# Gitter hat lauter gleich grosse Zellen — beides liest das Auge als
# Pflaster. Ein periodisches Verzerrungsfeld macht die Kanten zackig, und
# das Verschmelzen benachbarter Zellen (eine übernimmt die Ebene der
# anderen) erzeugt die breite Grössenverteilung, die Bruch von Muster
# unterscheidet. Beides bleibt kachelbar: Das Verzerrungsfeld ist selbst
# periodisch, und verschmolzen wird auf dem umlaufenden Zellgitter.
#
# ── Warum die Normal-Karte hier mitentsteht ──────────────────────────
# `make-normal.py` leitet aus der Helligkeit ab und rechnet die Ränder
# mit Null — an der Kachelnaht entstünde eine flache Linie. Hier liegt
# das Höhenfeld ohnehin vor (das Albedo ist daraus GEFÄRBT, nicht
# umgekehrt), und die Ableitung läuft mit `np.roll` um den Torus. Das
# ist dieselbe Kodierung wie in `make-normal.py`, nur ohne die zwei
# Fehler, die man an der Wand sieht statt in der Datei.
#
# Aufruf:
#   python3 tools/elements/pipeline/make-fels.py <albedo_out.png> [seed]
# Die Normal-Karte entsteht per Konvention daneben: <albedo>_normal.png
# (dieselbe Konvention, die `normalPfadZu()` im Shader ableitet).
#
# Generates the tileable rock texture pair, procedurally on a torus.

import sys
import numpy as np
from PIL import Image

N = 1024  # wie alle Bestandstexturen (stein_clean/…: 1024²)

AUS = sys.argv[1] if len(sys.argv) > 1 else "stein_fels.png"
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 20260904
AUS_NORMAL = AUS[:-4] + "_normal.png" if AUS.endswith(".png") else AUS + "_normal.png"

# Zielwerte, an den Bestandstexturen gemessen (stein_clean: Mittel 0.376,
# Streuung 0.087, nahezu neutrales Grau mit einem Hauch Wärme). Der Fels
# soll neben ihnen stehen können, ohne dass die Wand die Helligkeit
# wechselt, sobald jemand die Textur umschaltet.
ZIEL_MITTEL = 0.375
ZIEL_STREUUNG = 0.090




# ─────────────────────────────────────────────────────────────────────
# Rauschen auf dem Torus
# ─────────────────────────────────────────────────────────────────────


def gitter():
    """Die UV-Koordinaten aller Bildpunkte, einmal, in [0,1)."""
    a = (np.arange(N, dtype=np.float32) + 0.5) / N
    y, x = np.meshgrid(a, a, indexing="ij")
    return y, x


def abtasten(lat, uy, ux):
    """
    Ein periodisches Zufallsgitter an BELIEBIGEN Koordinaten abtasten.

    Zwei Dinge stecken darin, die beide gebraucht werden:
      * Die Nachbarindizes laufen per Modulo um — deshalb schliesst sich
        jedes daraus gebaute Feld über die Kachelgrenze.
      * Die Koordinaten sind FELDER, keine Achsen. Nur so lässt sich das
        Rauschen verzerren (domain warp): man reicht ein verbogenes
        Koordinatenfeld herein statt eines geraden.

    Interpoliert wird quintisch (6t⁵−15t⁴+10t³) statt mit Smoothstep.
    Grund: Smoothstep hat an den Gitterlinien einen Sprung in der zweiten
    Ableitung. In der Textur sieht man davon nichts, in der daraus
    abgeleiteten NORMAL-KARTE aber ein feines, regelmässiges Gitter —
    genau das Artefakt, das die dritte Fassung dieser Datei zeigte.
    """
    res = lat.shape[0]
    ky = (uy % 1.0) * res
    kx = (ux % 1.0) * res
    iy0 = np.floor(ky).astype(np.int32) % res
    ix0 = np.floor(kx).astype(np.int32) % res
    iy1 = (iy0 + 1) % res
    ix1 = (ix0 + 1) % res
    fy = (ky - np.floor(ky)).astype(np.float32)
    fx = (kx - np.floor(kx)).astype(np.float32)
    wy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    wx = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    v00 = lat[iy0, ix0]
    v01 = lat[iy0, ix1]
    v10 = lat[iy1, ix0]
    v11 = lat[iy1, ix1]
    return (v00 * (1 - wx) + v01 * wx) * (1 - wy) + (v10 * (1 - wx) + v11 * wx) * wy


def lage(res, rng, uy, ux):
    """
    Eine Rauschlage. Der Zufallsversatz der Abtastung ist wichtig: ohne
    ihn liegen alle Oktaven phasengleich auf demselben Gitter, und die
    Summe zeigt ein sichtbares Karo. Ein Versatz auf dem Torus ändert an
    der Periodizität nichts.
    """
    lat = rng.random((res, res), dtype=np.float32)
    return abtasten(lat, uy + rng.random(), ux + rng.random())


def fbm(res0, oktaven, rng, uy, ux, persistenz=0.5):
    """
    Summenrauschen. Die Persistenz sagt, wieviel jede feinere Lage noch
    beiträgt: 0,5 ergibt weiche Wolken, 0,62 ein Feld, das auf JEDER
    Vergrösserungsstufe Struktur hat — und genau das unterscheidet ein
    Gesteinsfoto von einer Wolkentextur.
    """
    summe = np.zeros((N, N), dtype=np.float32)
    gewicht = 0.0
    for k in range(oktaven):
        a = persistenz**k
        summe += a * lage(res0 * 2**k, rng, uy, ux)
        gewicht += a
    return summe / gewicht


def facetten(uy, ux, zellen, rng, neigung=0.55, versatz=0.30):
    """
    Bruchflächen: der Torus wird in Zellen zerlegt, und JEDE Zelle bekommt
    eine eigene geneigte EBENE statt eines Wertes.

    Das ist der Kern dieser Textur, und er ist teuer erkauft. Drei
    Fassungen haben Zellrauschen als dunkles Fugennetz eingesetzt (die
    Fuge zwischen den Zellen dunkel färben) — jede sah nach getrocknetem
    Schlamm aus. Der Fehler war nicht die Dosierung, sondern die Idee:
    Eine Gesteinsfläche zeigt ihre Bruchstücke nicht durch STRICHE
    zwischen ihnen, sondern dadurch, dass jedes Stück das Licht anders
    zurückwirft. Also bekommt hier jede Zelle eine Neigung, und die
    Kanten entstehen von selbst — als Sprung in der Normalen, dort wo
    zwei Ebenen aneinanderstossen.

    Zurück kommen (Höhe, Zellwert, Kantennähe F2−F1). Die Abstände
    laufen mit umlaufender Differenz um den Torus, sonst hätte die
    Kachel an ihren Rändern Zellen ohne Nachbarn — und genau dort die
    sichtbare Naht.
    """
    gy, gx = np.meshgrid(np.arange(zellen), np.arange(zellen), indexing="ij")
    jitter = rng.random((zellen, zellen, 2), dtype=np.float32)
    pty = ((gy + jitter[..., 0]) / zellen).ravel()
    ptx = ((gx + jitter[..., 1]) / zellen).ravel()
    n = pty.size
    # Die Neigung ist nicht gleichverteilt: `**1.6` drückt die meisten
    # Zellen nach flach und lässt einzelne kräftig kippen. Gleich stark
    # geneigte Zellen ergeben ein gleichmässiges Kantennetz, und ein
    # gleichmässiges Netz liest das Auge wieder als Pflaster.
    staerke = (rng.random(n).astype(np.float32) ** 1.6)
    ta = (rng.random(n).astype(np.float32) * 2 - 1) * neigung * staerke
    tb = (rng.random(n).astype(np.float32) * 2 - 1) * neigung * staerke
    tc = (rng.random(n).astype(np.float32) * 2 - 1) * versatz
    wert = rng.random(n).astype(np.float32)

    # Nachbarzellen VERSCHMELZEN: Übernimmt eine Zelle die Ebene ihres
    # Nachbarn, verschwindet die Kante zwischen beiden, und aus zwei
    # gleich grossen Stücken wird ein grösseres. Zweimal angewandt
    # entsteht eine breite Grössenverteilung — genau das, was ein
    # ungestörtes Voronoi-Gitter nicht hat: dort ist JEDE Zelle etwa
    # gleich gross, und die Kanten bilden ein Netz statt einer
    # Bruchfläche.
    feld = np.arange(n).reshape(zellen, zellen)
    achse = np.arange(zellen)
    for _ in range(2):
        vy = rng.integers(-1, 2, (zellen, zellen))
        vx = rng.integers(-1, 2, (zellen, zellen))
        nachbar = feld[(achse[:, None] + vy) % zellen, (achse[None, :] + vx) % zellen].ravel()
        gleich = rng.random(n) < 0.45
        ta = np.where(gleich, ta[nachbar], ta)
        tb = np.where(gleich, tb[nachbar], tb)
        tc = np.where(gleich, tc[nachbar], tc)

    f1 = np.full((N, N), 9.0, dtype=np.float32)
    f2 = np.full((N, N), 9.0, dtype=np.float32)
    hoehe = np.zeros((N, N), dtype=np.float32)
    zellwert = np.zeros((N, N), dtype=np.float32)
    for i in range(n):
        dy = uy - pty[i]
        dx = ux - ptx[i]
        dy -= np.round(dy)
        dx -= np.round(dx)
        d = np.sqrt(dy * dy + dx * dx, dtype=np.float32)
        naeher = d < f1
        f2 = np.where(naeher, f1, np.minimum(f2, d))
        hoehe = np.where(naeher, tc[i] + ta[i] * dy * zellen + tb[i] * dx * zellen, hoehe)
        zellwert = np.where(naeher, wert[i], zellwert)
        f1 = np.where(naeher, d, f1)
    return hoehe, zellwert, f2 - f1


def verwischt(a, runden=1):
    """
    Kastenweichzeichner, `runden` mal — mit `np.roll`, also UM DEN TORUS.
    Ein Weichzeichner mit Randbehandlung hätte ausgerechnet an der
    Kachelnaht einen anderen Wert und wäre dort sichtbar.
    """
    for _ in range(runden):
        s = np.zeros_like(a)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                s += np.roll(np.roll(a, dy, axis=0), dx, axis=1)
        a = s / 9.0
    return a


def glaetten(x, a, b):
    """Smoothstep von a nach b — beschneidet und rundet in einem Schritt."""
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ─────────────────────────────────────────────────────────────────────
# Der Fels
# ─────────────────────────────────────────────────────────────────────

rng = np.random.default_rng(SEED)
py, px = gitter()

# ── Verzerrung: gerade Koordinaten ergeben geordnetes Rauschen ────────
# Schwach und feingliedrig. Eine frühere Fassung verzerrte dreimal so
# stark und aus einem groben Feld — daraus wurden lange, geschwungene
# Grate, die nach Marmor aussahen. Fels bricht kurz; die Verzerrung darf
# die Struktur nur anrauhen.
wy = (fbm(9, 3, rng, py, px) - 0.5) * 2
wx = (fbm(9, 3, rng, py, px) - 0.5) * 2
qy = py + 0.026 * wy
qx = px + 0.026 * wx

# ── Bruchflächen: zwei Grössen geneigter Ebenen ──────────────────────
# Kachel = 2 m Wand (`kachelM` steht im Steinkit auf 2). Damit sind
# 9 Zellen ≈ 22 cm (Platten, die man aus fünf Metern sieht) und
# 26 Zellen ≈ 8 cm (Abplatzungen darauf).
platten, platte_wert, _ = facetten(qy, qx, 9, rng, neigung=0.62, versatz=0.07)
splitter, splitter_wert, _ = facetten(qy, qx, 26, rng, neigung=0.44, versatz=0.05)

# ── Rauheit auf den Flächen ──────────────────────────────────────────
# Summenrauschen mit hoher Persistenz: res 8 über sieben Lagen deckt
# 25 cm bis 4 mm ab. Es liefert die Körnung, NICHT die Form — die kommt
# von den Ebenen. Bei Persistenz 0,5 wären es Wolken, bei 0,66 ist es
# Gestein.
#
# KEIN Gratrauschen im Bild: Das Rezept ist für Gebirge gemacht und legt
# geschlossene Kammlinien an; auf Texturgrösse werden daraus Würmer —
# eine Fassung sah nach Marmor aus, eine nach Hirnkoralle. Die Funktion
# bleibt oben stehen, weil sie erklärt, WARUM sie hier nicht taugt.
traeger = fbm(18, 6, rng, qy, qx, persistenz=0.62)
korn = fbm(220, 3, rng, py, px)      # Feinkorn
grus = lage(768, rng, py, px)        # Griess auf Bildpunktebene

# ── Klüfte: Höhenlinien eines eigenen Feldes, unterbrochen ───────────
# Wo ein Rauschfeld seinen Mittelwert kreuzt, verläuft eine LINIE — lang,
# gekrümmt, verzweigt und ohne jede Regelmässigkeit. Genau so sitzen
# Risse im Gestein, und anders als Zellgrenzen umschliessen sie nichts.
# Schmal, unterbrochen (ein feines Feld hebt die Linie stellenweise über
# die Schwelle, so wie ein Riss ausläuft und wieder aufreisst) und
# selten — die Maske lässt etwa ein Drittel der Fläche zu.
linienfeld = fbm(11, 5, rng, qy, qx, persistenz=0.58)
bruch = lage(110, rng, py, px)
kluft = 1.0 - glaetten(np.abs(linienfeld - 0.5) + 0.009 * bruch, 0.0, 0.011)
kluft_maske = glaetten(fbm(4, 2, rng, py, px), 0.56, 0.92)

# ── Das Höhenfeld — in METERN, nicht in Geschmackszahlen ─────────────
# Eine Fassung dieser Datei summierte einheitenlose Gewichte und rechnete
# die Steigung erst am Ende mit einem Faktor „3.0" um. Das Ergebnis war
# eine Wand, deren Bruchflächen rechnerisch da und optisch nicht da
# waren: Bei 6 mm Gesamttiefe neigt sich eine 22-cm-Platte um zwei
# Prozent, und zwei Prozent sieht niemand. Also stehen hier Meter.
#
# Grössenordnungen: Eine Platte von 22 cm, die sich um 8° neigt, hebt
# sich an ihrem Rand um rund 3 cm. Das ist der Wert unten — und er bleibt
# deutlich unter den 10 cm, die das Konzept für GEOMETRIE als Obergrenze
# nennt (eine Normal-Karte kostet ohnehin keine Kollisionsfläche, aber
# eine Wand, die tiefer aussieht als sie ist, verrät sich an der Kante).
KACHEL_M = 2.0        # Weltbreite einer Kachel (`kachelM` im Steinkit)
METER_JE_PUNKT = KACHEL_M / N   # ≈ 1,95 mm

# Die Bruchflächen bekommen ihre Kanten ANGEFAST. Ungefast ist der
# Übergang zwischen zwei Ebenen ein Sprung über einen einzigen
# Bildpunkt — die Ableitung wird dort riesig, und die Normal-Karte zeigt
# ein schwarz-weisses Drahtgitter statt beleuchteter Flächen. Vier Runden
# Kastenweichzeichner sind rund 4 mm Fase; so bricht auch echter Stein.
platten = verwischt(platten, 6)
splitter = verwischt(splitter, 4)

hoehe_m = (
    0.030 * platten                    # Bruchflächen, handtellergross
    + 0.011 * splitter                 # Abplatzungen darauf
    + 0.016 * (traeger - 0.5)          # Rauheit auf den Flächen
    + 0.0026 * (korn - 0.5)            # Feinkorn
    + 0.0008 * (grus - 0.5)            # Griess
    - 0.0045 * kluft * kluft_maske     # Klüfte
)

# Für das Albedo und die Prüfsonden wird dasselbe Feld auf [0,1]
# gestreckt — die Meter bleiben für die Ableitung.
hoehe = (hoehe_m - hoehe_m.min()) / (hoehe_m.max() - hoehe_m.min())
hoehe = hoehe.astype(np.float32)

# ── Albedo: die Höhe eingefärbt, nicht ein zweites Rauschen ───────────
# Wer die Farbe getrennt würfelt, bekommt Flecken, die nichts mit dem
# Relief zu tun haben — im Streiflicht sieht man den Widerspruch sofort.
# WICHTIG: nicht `hoehe`. Eine Fassung hat das Albedo direkt aus dem
# Höhenfeld gefärbt, und dann trug jede Bruchfläche ihre eigene
# Helligkeit — das Ergebnis war ein Mosaik aus Kieseln. Echter Granit hat
# eine ziemlich EINHEITLICHE Farbe; was man sieht, ist Licht auf
# Geometrie. Die Facetten gehören deshalb fast ganz in die Normal-Karte
# und nur zu einem Zehntel ins Albedo.
lum = (
    0.62 * traeger
    + 0.26 * korn
    + 0.05 * (grus - 0.5)
)
# Hohlkehlen-Verschattung: die Höhe MINUS ihre eigene Unschärfe ist
# negativ in jeder Vertiefung und positiv auf jedem Buckel. Das ist der
# billige Verwandte einer Umgebungsverdeckung — und es ist der Grund,
# warum ein Gesteinsfoto auch OHNE Licht schon plastisch wirkt: Die
# Vertiefungen sind dort wirklich dunkler eingefärbt, nicht nur
# schattiert. Ohne diesen Anteil ist das Albedo eine Wolke.
lum += 1.10 * (hoehe - verwischt(hoehe, 8))
lum -= 0.05 * kluft * kluft_maske                # Verschattung im Spalt
# KEINE Umrisslinie entlang der Plattenkanten. Eine Fassung hatte sie,
# und damit war das Pflaster zurück: Sobald die Stücke im ALBEDO
# umrandet sind, liest das Auge Fugen — ganz gleich, wie fein die Linie
# ist. Die Kante darf nur im Licht entstehen, also über die Normal-Karte.
lum += 0.09 * glaetten(korn * grus, 0.58, 0.92)   # helle Kristallflecken
lum -= 0.10 * glaetten(traeger * korn, 0.32, 0.72)  # dunkle Einschlüsse
lum += 0.04 * (platte_wert - 0.5) + 0.03 * (splitter_wert - 0.5)  # Stück für Stück leicht anders

# Nachschärfen: die Interpolation des Rauschens ist weich, echtes Gestein
# ist es nicht. Der Unschärfeabzug (Unsharp Mask) läuft mit `np.roll` um
# den Torus — sonst hätte ausgerechnet die Kachelnaht einen weichen Rand.
lum = lum + 0.85 * (lum - verwischt(lum))

lum = (lum - lum.mean()) / lum.std() * ZIEL_STREUUNG + ZIEL_MITTEL
lum = np.clip(lum, 0.02, 0.96).astype(np.float32)

# Farbstich: Granitgrau mit einem Hauch Wärme, gebunden an die grobe
# Struktur. Die Faktoren bleiben dicht an 1 — Fels ist grau, und ein
# bunter Fels wäre im Fackellicht sofort als Textur zu erkennen.
warm = (fbm(5, 2, rng, py, px) - 0.5) * 0.11 + (platte_wert - 0.5) * 0.07
rgb = np.stack(
    [
        lum * (1.024 + warm * 0.5),
        lum * (1.000),
        lum * (0.970 - warm * 0.5),
    ],
    axis=-1,
)
rgb = np.clip(rgb, 0.0, 1.0)
Image.fromarray((rgb * 255 + 0.5).astype(np.uint8), "RGB").save(AUS)

# ── Normal-Karte aus DEMSELBEN Höhenfeld, umlaufend abgeleitet ────────
# Zwei Dinge, die `make-normal.py` anders macht und die man an der Wand
# sieht statt in der Datei:
#   * Die Ableitung läuft mit `np.roll` um den Torus. Dort bleiben die
#     Ränder null — an der Kachelnaht entstünde eine flache Linie.
#   * Die Steigung wird in METERN gerechnet, nicht in Bildpunkten:
#     Steigung = Δh[m] / Δx[m]. Damit ist die Stärke keine Geschmacks-
#     zahl mehr, sondern folgt aus der Relieftiefe oben.
gx = (np.roll(hoehe_m, -1, axis=1) - np.roll(hoehe_m, 1, axis=1)) * 0.5 / METER_JE_PUNKT
gy = (np.roll(hoehe_m, -1, axis=0) - np.roll(hoehe_m, 1, axis=0)) * 0.5 / METER_JE_PUNKT
nx = -gx
ny = -gy
nz = np.ones_like(hoehe_m)
laenge = np.sqrt(nx * nx + ny * ny + nz * nz)
nx, ny, nz = nx / laenge, ny / laenge, nz / laenge
nrm = np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5], axis=-1)
Image.fromarray((nrm * 255 + 0.5).astype(np.uint8), "RGB").save(AUS_NORMAL)

print(f"FELS OK -> {AUS}  (Mittel {float(rgb.mean()):.3f}, Streuung {float(lum.std()):.3f})")
print(f"FELS OK -> {AUS_NORMAL}  (mittlere Neigung {float(np.hypot(nx, ny).mean()):.3f})")
