#!/usr/bin/env python3
"""
Die neun Bodentexturen des Terrains — eigene, gerechnete statt gerippte.

    python3 tools/terrain-texturen.py [--nur splat|noise|normal]

── Warum ────────────────────────────────────────────────────────────
`TerrainSplat.ts` war der letzte grosse Block, der ohne Valheim-Material
nicht rendert: ohne `terrain_d_array.png` hat das Terrain keine Albedo
und der Boden bleibt schwarz. Diese neun Dateien sind damit dieselbe
Uebung wie `eiche-texturen.py` fuer die Eiche, nur fuer den Untergrund.

── Was erzeugt wird (Masse sind vom Shader vorgegeben) ──────────────
  terrain_d_array.png    256x4096 RGBA — 16 Tiles a 256x256, gestapelt
  TerrainVarietyNoise.png  512x512 RGB — drei unabhaengige Rauschkanaele
  terraintile_n_0.png      256x256 RGBA — Normal, weich
  terraintile_n_1.png      256x256 RGBA — Normal, mittel
  forest_n.png             256x256 RGBA — Normal, Waldboden
  cultivated_n.png         256x256 RGBA — Normal, umgegraben
  gouacherock_big_n.png    256x256 RGBA — Normal, Fels und Lava
  paved_n.png              256x256 RGBA — Normal, gepflastert
  snow_normal.png            64x64 RGBA — Normal, Schnee

── Drei Vorgaben, die NICHT frei waehlbar sind ──────────────────────
1. Die Tile-Reihenfolge steht in `TerrainSplat.ts` als `TILE`-Enum und
   wird ueber `BIOME_TILE` angesteuert. Wer hier umsortiert, verschiebt
   die Biome.
2. Die Kanalmittel des Variety-Noise sind im Shader als
   `VAR_MITTE_GROB/MITTEL/FEIN` = 0.456 / 0.312 / 0.497 fest verdrahtet
   (`TerrainSplat.ts`, "Farbvariation ueber mehrere Skalen"). Jede
   Oktave zieht ihren Kanal und subtrahiert genau diesen Wert, um auf
   null zu zentrieren. Trifft die Textur die Mittel nicht, kippt die
   Helligkeit des gesamten Bodens. Deshalb werden die Kanaele am Ende
   exakt auf Mittel und Streuung normiert.
3. Alle Tiles werden mit `fract(uv)` gekachelt — das Rauschen muss also
   periodisch sein. `lib/rauschen.py` schliesst das Gitter per Modulo;
   gewoehnliches Rauschen zeigt hier eine Naht als sichtbares Gitter im
   Gelaende.

Der Alphakanal des Splat-Arrays wird vom Shader nie gesampelt (im
Original steckte dort vermutlich die Glanzstaerke) und bleibt auf 1.

Die Grundfarben sind an den Mittelwerten der bisherigen Tiles
ausgerichtet — Gras gruen, Asche fast schwarz, Sand hell. Das ist die
Palette, auf die Biom-Blend, Nebel und Beleuchtung eingestellt sind;
eine voellig andere Tonlage wuerde die ganze Farbstimmung verschieben.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from rauschen import furchen, normiert, oktaven, wertrauschen  # noqa: E402

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIEL = os.path.join(WURZEL, "assets/textures")
KANTE = 256

# Reihenfolge = TILE-Enum in client/src/engine/TerrainSplat.ts.
TILES = [
    "Grass", "Forest", "Dirt", "Cleared", "Rock", "Cliff", "LavaEmber", "Ash",
    "Heath", "Sand", "SwampMud", "Moss", "Paved", "SwampDark", "Basalt", "LavaCrust",
]


def mische(feld, dunkel, hell):
    """Ein 0..1-Feld auf eine Farbrampe legen."""
    d = np.array(dunkel, dtype=np.float32)
    h = np.array(hell, dtype=np.float32)
    return d[None, None, :] + feld[..., None] * (h - d)[None, None, :]


def koerner(rnd, staerke=0.05, n=KANTE):
    """Feines Pixelkorn — bricht die Weichheit des Wertrauschens auf."""
    return (rnd.random((n, n)) - 0.5) * staerke


def zellen(rnd, anzahl, n=KANTE):
    """Periodische Zellstruktur (Abstand zum naechsten Streupunkt).

    Fuer Pflaster und Basalt: die Punkte werden mit ihren acht
    Nachbarkopien verglichen, damit die Zellen ueber die Kachelgrenze
    hinweg zusammenpassen.
    """
    pkt = rnd.random((anzahl, 2))
    y, x = np.meshgrid(np.linspace(0, 1, n, endpoint=False),
                       np.linspace(0, 1, n, endpoint=False), indexing="ij")
    d1 = np.full((n, n), 9.0)
    d2 = np.full((n, n), 9.0)
    for dy in (-1.0, 0.0, 1.0):
        for dx in (-1.0, 0.0, 1.0):
            for py, px in pkt:
                d = np.hypot(y - (py + dy), x - (px + dx))
                naeher = d < d1
                d2 = np.where(naeher, d1, np.minimum(d2, d))
                d1 = np.where(naeher, d, d1)
    return d1, d2


# ── Die sechzehn Tiles ───────────────────────────────────────────────
# Jede Funktion liefert ein (256,256,3)-Array in 0..1.

def t_gras(rnd):
    grob = oktaven(KANTE, KANTE, 4, 4, 4, rnd)
    fein = oktaven(KANTE, KANTE, 24, 24, 2, rnd)
    f = np.clip(0.55 * grob + 0.45 * fein + koerner(rnd, 0.10), 0, 1)
    rgb = mische(f, (0.20, 0.30, 0.14), (0.44, 0.57, 0.34))
    # Vereinzelte truebe Bueschel, damit die Flaeche nicht wie Filz wirkt.
    trocken = np.clip(oktaven(KANTE, KANTE, 3, 3, 3, rnd) - 0.62, 0, 1) * 2.4
    return np.clip(rgb + trocken[..., None] * np.array([0.16, 0.10, 0.02]), 0, 1)


def t_wald(rnd):
    boden = oktaven(KANTE, KANTE, 5, 5, 4, rnd)
    laub = furchen(KANTE, KANTE, 14, 14, 2, 0.7, rnd)
    f = np.clip(0.6 * boden + 0.4 * laub + koerner(rnd, 0.08), 0, 1)
    rgb = mische(f, (0.22, 0.20, 0.10), (0.52, 0.52, 0.30))
    nadeln = np.clip(oktaven(KANTE, KANTE, 30, 30, 1, rnd) - 0.7, 0, 1) * 3.0
    return np.clip(rgb - nadeln[..., None] * np.array([0.10, 0.10, 0.06]), 0, 1)


def t_erde(rnd):
    f = np.clip(oktaven(KANTE, KANTE, 8, 8, 4, rnd) + koerner(rnd, 0.13), 0, 1)
    rgb = mische(f, (0.26, 0.23, 0.10), (0.54, 0.50, 0.26))
    steine = np.clip(oktaven(KANTE, KANTE, 20, 20, 2, rnd) - 0.72, 0, 1) * 3.5
    return np.clip(rgb + steine[..., None] * np.array([0.14, 0.13, 0.11]), 0, 1)


def t_gerodet(rnd):
    """Umgegrabene Erde: flache Furchen in einer Richtung."""
    x = np.linspace(0, 2 * np.pi * 9, KANTE, endpoint=False)[None, :]
    riefen = 0.5 + 0.5 * np.sin(x + 5.0 * oktaven(KANTE, KANTE, 4, 4, 3, rnd) * np.pi)
    f = np.clip(0.78 * oktaven(KANTE, KANTE, 7, 7, 4, rnd) + 0.22 * riefen
                + koerner(rnd, 0.10), 0, 1)
    return np.clip(mische(f, (0.22, 0.19, 0.10), (0.46, 0.41, 0.26)), 0, 1)


def t_fels(rnd, hell=False):
    riss = furchen(KANTE, KANTE, 5, 5, 4, 0.55, rnd)
    korn = oktaven(KANTE, KANTE, 16, 16, 3, rnd)
    f = np.clip(0.65 * riss + 0.35 * korn + koerner(rnd, 0.07), 0, 1)
    d, h = ((0.22, 0.22, 0.21), (0.40, 0.40, 0.38)) if not hell else \
           ((0.25, 0.25, 0.24), (0.46, 0.46, 0.43))
    return np.clip(mische(f, d, h), 0, 1)


def t_klippe(rnd):
    """Fels mit Schichtung — waagerechte Baender wie anstehendes Gestein."""
    y = np.linspace(0, 2 * np.pi * 6, KANTE, endpoint=False)[:, None]
    band = 0.5 + 0.5 * np.sin(y + 5.5 * oktaven(KANTE, KANTE, 3, 3, 3, rnd) * np.pi)
    riss = furchen(KANTE, KANTE, 6, 6, 4, 0.5, rnd)
    f = np.clip(0.22 * band + 0.62 * riss + 0.16 * oktaven(KANTE, KANTE, 18, 18, 3, rnd)
                + koerner(rnd, 0.08), 0, 1)
    return np.clip(mische(f, (0.24, 0.24, 0.22), (0.46, 0.46, 0.43)), 0, 1)


def t_glut(rnd):
    """Tile 6 ist die GLUTFARBE, nicht das Rissmuster.

    Im Original liegt das Kanalmittel bei genau (1.00, 0.50, 0.00) — eine
    praktisch einheitliche Orangeflaeche. Das Muster kommt aus Tile 15
    (Graustufenmaske), der Shader blendet beides zusammen. Wer hier ein
    Rissmuster hineinmalt, bekommt es doppelt und die Lava wird stumpf.
    Deshalb nur eine leichte Temperaturschwankung auf voller Saettigung.
    """
    warm = oktaven(KANTE, KANTE, 6, 6, 3, rnd)
    r = np.clip(0.94 + 0.10 * warm, 0, 1)
    g = np.clip(0.38 + 0.24 * warm, 0, 1)
    b = np.clip(0.02 * warm, 0, 1)
    return np.stack([r, g, b], axis=-1)


def t_asche(rnd):
    f = np.clip(oktaven(KANTE, KANTE, 12, 12, 4, rnd) + koerner(rnd, 0.06), 0, 1)
    return np.clip(mische(f, (0.06, 0.07, 0.08), (0.17, 0.18, 0.19)), 0, 1)


def t_heide(rnd):
    grob = oktaven(KANTE, KANTE, 4, 4, 4, rnd)
    halme = oktaven(KANTE, KANTE, 26, 26, 2, rnd)
    f = np.clip(0.6 * grob + 0.4 * halme + koerner(rnd, 0.09), 0, 1)
    return np.clip(mische(f, (0.36, 0.33, 0.18), (0.66, 0.61, 0.40)), 0, 1)


def t_sand(rnd):
    """Sand: feines Korn plus flache Rippel."""
    x = np.linspace(0, 2 * np.pi * 7, KANTE, endpoint=False)[None, :]
    # 5 Perioden * Faktor 0.4 = genau 2 volle Wellen ueber die Kachelhoehe.
    # Mit den urspruenglichen 3 Perioden waren es 1.2 — die Rippel trafen
    # sich an der Oberkante nicht mehr und hinterliessen eine Naht.
    y = np.linspace(0, 2 * np.pi * 5, KANTE, endpoint=False)[:, None]
    # Die Verzerrung muss STAERKER sein als die Wellenlaenge, sonst bleibt
    # ein regelmaessiges Streifenmuster stehen ("Cord" statt Sand).
    rippel = 0.5 + 0.5 * np.sin(x + y * 0.4 + 6.0 * oktaven(KANTE, KANTE, 3, 3, 3, rnd) * np.pi)
    f = np.clip(0.16 * rippel + 0.84 * oktaven(KANTE, KANTE, 9, 9, 4, rnd)
                + koerner(rnd, 0.11), 0, 1)
    return np.clip(mische(f, (0.62, 0.49, 0.34), (0.86, 0.71, 0.54)), 0, 1)


def t_schlamm(rnd):
    nass = oktaven(KANTE, KANTE, 5, 5, 4, rnd)
    f = np.clip(nass + koerner(rnd, 0.07), 0, 1)
    rgb = mische(f, (0.13, 0.11, 0.04), (0.32, 0.28, 0.13))
    # Dunkle Pfuetzen — der Sumpf soll fleckig wirken, nicht gleichmaessig.
    pfuetze = np.clip(oktaven(KANTE, KANTE, 3, 3, 2, rnd) - 0.55, 0, 1) * 2.2
    return np.clip(rgb * (1 - 0.45 * pfuetze[..., None]), 0, 1)


def t_moos(rnd):
    polster = oktaven(KANTE, KANTE, 7, 7, 4, rnd)
    fein = oktaven(KANTE, KANTE, 28, 28, 2, rnd)
    f = np.clip(0.6 * polster + 0.4 * fein + koerner(rnd, 0.09), 0, 1)
    return np.clip(mische(f, (0.33, 0.42, 0.14), (0.62, 0.73, 0.35)), 0, 1)


def t_pflaster(rnd):
    """Gesetzte Steine mit Fugen — Zellstruktur, jede Zelle eigener Ton."""
    d1, d2 = zellen(rnd, 26)
    fuge = np.clip((d2 - d1) * 12.0, 0, 1)          # 0 in der Fuge, 1 im Stein
    ton = normiert(oktaven(KANTE, KANTE, 26, 26, 1, rnd))
    stein = 0.45 + 0.4 * ton + 0.2 * oktaven(KANTE, KANTE, 18, 18, 3, rnd)
    f = np.clip(stein * (0.35 + 0.65 * fuge) + koerner(rnd, 0.05), 0, 1)
    return np.clip(mische(f, (0.20, 0.19, 0.18), (0.50, 0.48, 0.45)), 0, 1)


def t_sumpf_dunkel(rnd):
    f = np.clip(oktaven(KANTE, KANTE, 9, 9, 4, rnd) + koerner(rnd, 0.06), 0, 1)
    return np.clip(mische(f, (0.15, 0.16, 0.16), (0.32, 0.33, 0.33)), 0, 1)


def t_basalt(rnd):
    """Basalt: kantige Saeulen statt runder Koerner."""
    d1, d2 = zellen(rnd, 30)
    fuge = np.clip((d2 - d1) * 16.0, 0, 1)
    f = np.clip(0.25 + 0.5 * fuge + 0.35 * oktaven(KANTE, KANTE, 14, 14, 3, rnd)
                + koerner(rnd, 0.05), 0, 1)
    return np.clip(mische(f, (0.08, 0.08, 0.08), (0.23, 0.23, 0.23)), 0, 1)


def t_lavakruste(rnd):
    """Tile 15 ist die GRAUSTUFEN-Emissionsmaske (s. TerrainSplat-Kopf):
    hell = glueht. Deshalb bewusst kein Farbverlauf, sondern ein Riss-
    netz in Grau, das der Shader als Emission liest."""
    d1, d2 = zellen(rnd, 18)
    # Schmale Risse auf dunklem Grund: Zielmittel ~0.29 wie bisher. Ein
    # helleres Netz laesst die Ashlands flaechig gluehen statt in Adern.
    riss = np.clip(1.0 - (d2 - d1) * 11.0, 0, 1) ** 2.0
    flimmer = 0.10 * oktaven(KANTE, KANTE, 12, 12, 3, rnd)
    g = np.clip(riss * 0.72 + flimmer + 0.03, 0, 1)
    return np.repeat(g[..., None], 3, axis=-1)


TILE_FUNKTIONEN = {
    "Grass": t_gras, "Forest": t_wald, "Dirt": t_erde, "Cleared": t_gerodet,
    "Rock": lambda r: t_fels(r, False), "Cliff": t_klippe, "LavaEmber": t_glut,
    "Ash": t_asche, "Heath": t_heide, "Sand": t_sand, "SwampMud": t_schlamm,
    "Moss": t_moos, "Paved": t_pflaster, "SwampDark": t_sumpf_dunkel,
    "Basalt": t_basalt, "LavaCrust": t_lavakruste,
}


def baue_splat(rnd):
    stapel = np.zeros((KANTE * 16, KANTE, 4), dtype=np.float32)
    for i, name in enumerate(TILES):
        rgb = TILE_FUNKTIONEN[name](rnd)
        stapel[i * KANTE:(i + 1) * KANTE, :, :3] = rgb
        m = rgb.reshape(-1, 3).mean(axis=0)
        print(f"  Tile {i:2d} {name:10s} Mittel=({m[0]:.2f},{m[1]:.2f},{m[2]:.2f})")
    stapel[..., 3] = 1.0                      # Alpha wird nie gesampelt
    return stapel


def baue_variety(rnd):
    """512x512, drei Kanaele — Mittel und Streuung exakt wie im Shader.

    Der Shader subtrahiert je Oktave ein festes Kanalmittel. Deshalb wird
    hier nicht nur normiert, sondern auf Zielmittel und Zielstreuung
    gezogen; sonst verschiebt sich die Grundhelligkeit des Bodens.
    """
    n = 512
    ziel = [(0.456, 0.147, 6), (0.312, 0.138, 5), (0.497, 0.125, 7)]
    aus = np.zeros((n, n, 3), dtype=np.float32)
    for k, (mittel, sigma, zellen_n) in enumerate(ziel):
        f = oktaven(n, n, zellen_n, zellen_n, 4, rnd)
        f = (f - f.mean()) / max(1e-6, f.std()) * sigma + mittel
        aus[..., k] = np.clip(f, 0, 1)
        print(f"  Kanal {'rgb'[k]}: Mittel {aus[...,k].mean():.3f} "
              f"(Ziel {mittel})  Streuung {aus[...,k].std():.3f} (Ziel {sigma})")
    return aus


def normal_aus_hoehe(hoehe, staerke):
    """Hoehenfeld -> Normal-Map (XY in RG, Z in B), bereits entpackt.

    Die Ableitung laeuft ueber np.roll, damit sie an der Kachelgrenze
    genauso rechnet wie in der Mitte — sonst hat jede Normal-Map einen
    hellen Rahmen.
    """
    dx = (np.roll(hoehe, -1, axis=1) - np.roll(hoehe, 1, axis=1)) * staerke
    dy = (np.roll(hoehe, -1, axis=0) - np.roll(hoehe, 1, axis=0)) * staerke
    n = np.stack([-dx, -dy, np.ones_like(hoehe)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


NORMALEN = {
    # name: (Kante, Hoehenfeld-Rezept, Staerke) — Staerke so gewaehlt,
    # dass der Blaukanal ungefaehr dem bisherigen Mittel entspricht
    # (weich ~0.99, mittel ~0.88, gepflastert ~0.97, umgegraben ~0.96).
    "terraintile_n_0": (256, "weich", 3.5),
    "terraintile_n_1": (256, "grob", 30.0),
    "forest_n": (256, "waldboden", 4.0),
    "cultivated_n": (256, "furchen", 3.0),
    "gouacherock_big_n": (256, "fels", 3.0),
    "paved_n": (256, "pflaster", 3.4),
    "snow_normal": (64, "weich", 1.6),
}


def hoehenfeld(rezept, n, rnd):
    if rezept == "weich":
        return oktaven(n, n, 8, 8, 3, rnd)
    if rezept == "grob":
        return 0.6 * oktaven(n, n, 6, 6, 4, rnd) + 0.4 * furchen(n, n, 10, 10, 3, 0.7, rnd)
    if rezept == "waldboden":
        return 0.5 * oktaven(n, n, 7, 7, 4, rnd) + 0.5 * furchen(n, n, 14, 14, 2, 0.8, rnd)
    if rezept == "furchen":
        x = np.linspace(0, 2 * np.pi * 9, n, endpoint=False)[None, :]
        return 0.5 + 0.5 * np.sin(x + 1.4 * oktaven(n, n, 4, 4, 2, rnd) * np.pi)
    if rezept == "fels":
        return furchen(n, n, 5, 5, 4, 0.55, rnd)
    if rezept == "pflaster":
        d1, d2 = zellen(rnd, 26, n)
        return np.clip((d2 - d1) * 12.0, 0, 1)
    raise ValueError(rezept)


def schreibe(pfad, feld):
    bild = Image.fromarray((np.clip(feld, 0, 1) * 255).round().astype(np.uint8))
    bild.save(pfad)
    print(f"  -> {os.path.relpath(pfad, WURZEL)}  {bild.size[0]}x{bild.size[1]} {bild.mode}")


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--nur", choices=["splat", "noise", "normal"],
                   help="nur eine Gruppe erzeugen")
    p.add_argument("--seed", type=int, default=20260813,
                   help="Zufallssaat — gleicher Wert, gleiche Texturen")
    args = p.parse_args()
    os.makedirs(ZIEL, exist_ok=True)

    if args.nur in (None, "splat"):
        print("terrain_d_array.png — 16 Tiles:")
        rnd = np.random.default_rng(args.seed)
        stapel = baue_splat(rnd)
        rgba = (np.clip(stapel, 0, 1) * 255).round().astype(np.uint8)
        Image.fromarray(rgba, mode="RGBA").save(os.path.join(ZIEL, "terrain_d_array.png"))
        print(f"  -> assets/textures/terrain_d_array.png  {KANTE}x{KANTE*16} RGBA")

    if args.nur in (None, "noise"):
        print("TerrainVarietyNoise.png:")
        rnd = np.random.default_rng(args.seed + 1)
        schreibe(os.path.join(ZIEL, "TerrainVarietyNoise.png"), baue_variety(rnd))

    if args.nur in (None, "normal"):
        print("Normal-Maps:")
        for i, (name, (n, rezept, staerke)) in enumerate(NORMALEN.items()):
            rnd = np.random.default_rng(args.seed + 10 + i)
            nrm = normal_aus_hoehe(hoehenfeld(rezept, n, rnd), staerke)
            rgba = np.concatenate([nrm, np.ones((n, n, 1), dtype=np.float32)], axis=-1)
            print(f"  {name:20s} Blaukanal-Mittel {nrm[...,2].mean():.3f}")
            schreibe(os.path.join(ZIEL, f"{name}.png"), rgba)


if __name__ == "__main__":
    main()
