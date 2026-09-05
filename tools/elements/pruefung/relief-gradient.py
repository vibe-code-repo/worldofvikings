# Prüft: wie grob die Fels-Frontschicht wirklich ist — Reliefspanne und Neigungshistogramm des Höhenfeldes.
#
#   python3 tools/elements/pruefung/relief-gradient.py [--relief-quelle <hoehenkarte.png>]
#
# ── Warum es diese Zahl braucht ────────────────────────────────────────
# Mikes Befund vom 05.09.2026 lautete: „Die Wand im Spiel sieht viel
# weniger grob aus als mein Tripo-Modell." Das ist ein Urteil über zwei
# Bilder, und beide waren nicht nebeneinander. Vier Massnahmen sollten es
# beheben — ohne eine Zahl wäre danach niemand klüger gewesen, ob sie
# gewirkt haben oder ob sich nur die Beleuchtung geändert hat.
#
# Gemessen wird deshalb das FELD, nicht das Bild, und zwar zweierlei:
#
#   SPANNE  — der Abstand zwischen dem vordersten und dem hintersten
#             Punkt eines Wandpaneels. Das ist die Grösse, die Mike
#             genannt hat („rund 16 cm auf 1 m").
#   NEIGUNG — der Winkel jeder Gitterkante gegen die Wandebene, als
#             Histogramm. Er ist die eigentliche Auskunft: Eine Wand kann
#             16 cm Spanne haben und trotzdem eine sanfte Düne sein, wenn
#             sich die 16 cm über 2 m verteilen. Was ein Fels hat, sind
#             STEILE Kanten auf kurzer Strecke.
#
# Gemessen wird über acht Feldschlüssel (die drei Wandvarianten, beide
# Korridorseiten, Ecke, Abzweig) — ein einzelner Schlüssel wäre eine
# Stichprobe von einem Paneel.
#
# Gemessene Stände (jeweils mit `--relief-quelle`, der Tripo-Karte):
#
#   | Stand                       | Spanne  | Neigung ø | ≥ 20° |
#   |-----------------------------|---------|-----------|-------|
#   | vor Mass A (9 cm, 12,5 cm)  |  7,5 cm |    4,4°   |  0,9 % |
#   | A: Kollision getrennt       | 16,5 cm |    9,8°   | 13,9 % |
#   | B: gekachelt statt gestreckt| 16,5 cm |   11,7°   | 21,7 % |
#   | C: Raster 6,25 cm           | 16,5 cm |   16,3°   | 34,6 % |
#
# Measures how coarse the rock front layer actually is: relief span and a
# histogram of facet slopes over eight field keys.
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'blender'))
import felsrelief as F  # noqa: E402

# Die Feldschlüssel der senkrechten Wandflächen (make-stonevault.py,
# FELD_LAGE). Treppe und Torbogen bleiben draussen: Ihre Ausschnitte sind
# anders gross, und ein Mittelwert über verschieden grosse Flächen wäre
# eine Zahl, die von der Reihenfolge abhängt.
SCHLUESSEL = (10, 11, 12, 20, 21, 22, 23, 24)


def main(argv):
    if '--relief-quelle' in argv:
        F.setze_relief_quelle(argv[argv.index('--relief-quelle') + 1])

    winkel = []
    tiefen = []
    for lage in SCHLUESSEL:
        punkte = F.fels_gitter(-1.0, 1.0, lage=lage)['punkte']
        nz, nx = len(punkte), len(punkte[0])
        for iz in range(nz):
            for ix in range(nx):
                x, z, t = punkte[iz][ix]
                tiefen.append(t)
                for jz, jx in ((iz, ix + 1), (iz + 1, ix)):
                    if jz >= nz or jx >= nx:
                        continue
                    x2, z2, t2 = punkte[jz][jx]
                    d = math.hypot(x2 - x, z2 - z)
                    if d > 1e-6:
                        winkel.append(math.degrees(math.atan(abs(t2 - t) / d)))

    winkel.sort()
    n = len(winkel)
    anteil = lambda g: 100.0 * sum(1 for w in winkel if w >= g) / n  # noqa: E731
    print(f'Quelle {F.QUELLE}, Raster {F.RASTER} m, {len(SCHLUESSEL)} Feldschlüssel, '
          f'{n} Gitterkanten')
    print(f'SPANNE  {max(tiefen) - min(tiefen):.4f} m '
          f'(vorn {max(tiefen):.4f}, hinten {min(tiefen):.4f})')
    print(f'NEIGUNG mittel {sum(winkel) / n:.1f}°  median {winkel[n // 2]:.1f}°  '
          f'p90 {winkel[int(0.9 * n)]:.1f}°  max {winkel[-1]:.1f}°')
    for a, b in zip((0, 10, 20, 30, 40, 50), (10, 20, 30, 40, 50, 90)):
        c = sum(1 for w in winkel if a <= w < b)
        print(f'  {a:2d}–{b:2d}°: {100.0 * c / n:5.1f} %')
    print(f'ANTEIL  ≥ 20°: {anteil(20):.1f} %   ≥ 30°: {anteil(30):.1f} %')


main(sys.argv[1:])
