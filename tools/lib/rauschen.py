"""
Periodisches Wertrauschen fuer prozedurale Texturen.

    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
    from rauschen import oktaven

── Warum periodisch ─────────────────────────────────────────────────
Die Texturen dieses Projekts werden gekachelt: `uv_auf_rechteck` in
`tools/baum-generieren.py` wiederholt die Rinde ueber die Stammlaenge
(`alt[1] % 1.0`), und Mauerwerk kachelt ohnehin. Gewoehnliches Rauschen
zeigt an der Nahtstelle einen sichtbaren Ring bzw. eine Fuge. Das Gitter
wird deshalb per Modulo geschlossen: rechte Kante passt an linke, untere
an obere.
"""
import numpy as np


def wertrauschen(hoehe, breite, zellen_y, zellen_x, rnd):
    """Ein Rauschfeld ueber ein geschlossenes Gitter — kachelt exakt.

    Interpoliert wird mit einer Smoothstep-Kurve; lineare Interpolation
    laesst die Gitterlinien als Rautenmuster stehen.
    """
    gitter = rnd.random((zellen_y, zellen_x))

    y = np.linspace(0, zellen_y, hoehe, endpoint=False)
    x = np.linspace(0, zellen_x, breite, endpoint=False)
    y0, x0 = np.floor(y).astype(int), np.floor(x).astype(int)
    fy, fx = y - y0, x - x0
    sy = (fy * fy * (3 - 2 * fy))[:, None]
    sx = (fx * fx * (3 - 2 * fx))[None, :]

    y0m, x0m = y0 % zellen_y, x0 % zellen_x
    y1m, x1m = (y0 + 1) % zellen_y, (x0 + 1) % zellen_x

    oben = gitter[np.ix_(y0m, x0m)] * (1 - sx) + gitter[np.ix_(y0m, x1m)] * sx
    unten = gitter[np.ix_(y1m, x0m)] * (1 - sx) + gitter[np.ix_(y1m, x1m)] * sx
    return oben * (1 - sy) + unten * sy


def oktaven(hoehe, breite, zellen_y, zellen_x, stufen, rnd):
    """Mehrere Rauschstufen aufaddiert — grobe Form plus feine Struktur."""
    summe = np.zeros((hoehe, breite))
    gewicht = 0.0
    for k in range(stufen):
        f = 2 ** k
        a = 0.5 ** k
        summe += a * wertrauschen(hoehe, breite,
                                  max(2, zellen_y * f), max(2, zellen_x * f), rnd)
        gewicht += a
    return summe / gewicht


def furchen(hoehe, breite, zellen_y, zellen_x, stufen, schaerfe, rnd):
    """Schmale dunkle Taeler, breite helle Ruecken (ridged noise).

    Der Abstand zur Hoehenlinie 0,5 ist auf der Linie null und steigt zu
    beiden Seiten. Ein Exponent UNTER eins laesst ihn steil ansteigen —
    dadurch bleibt die Furche schmal und der Ruecken breit. Ueber eins
    entsteht ein weicher Wolkenlook, der wie Stoff aussieht statt wie
    Rinde oder Fels.
    """
    n = oktaven(hoehe, breite, zellen_y, zellen_x, stufen, rnd)
    return np.clip(np.abs(n - 0.5) * 2.0, 0.0, 1.0) ** schaerfe


def normiert(feld):
    """Auf 0..1 spreizen. np.ptp statt feld.ptp() — in numpy 2 entfallen."""
    tief = feld.min()
    spanne = float(np.ptp(feld))
    return (feld - tief) / max(1e-6, spanne)
