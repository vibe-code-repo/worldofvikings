#!/usr/bin/env python3
"""
make-materials.py — die stilisierte Material-Bibliothek fuer Dungeon 2.0 backen.
make-materials.py — bake the stylised material library for dungeon 2.0.

    flatpak run org.blender.Blender --background --factory-startup \\
      --python /home/mike/wov-wt-dungeon2/tools/dungeon2/make-materials.py -- \\
      --seed 20260830 --res 1024 \\
      --out /home/mike/wov-wt-dungeon2/assets/dungeon2/materials

── Was hier entsteht / What this produces ────────────────────────────
Je Material ein Ordner <out>/<name>/ mit
Per material one folder <out>/<name>/ containing

    albedo.png    8 bit sRGB   Basisfarbe / base colour
    normal.png    8 bit        Tangentenraum, OpenGL (+Y oben) / tangent space, OpenGL (+Y up)
    orh.png       8 bit        R=Occlusion  G=Rauheit/roughness  B=Hoehe/height
    mask.png      8 bit        NUR Overlays: Deckungsmaske / overlays only: coverage mask
    material.json             Tag, Metallwert, Kachelmass, Seed / tag, metal value, tile size, seed

ORH statt ORM ist ARCHITECTURE W5: Metallic ist eine KONSTANTE je Layer
(`metallic` in material.json), Height braucht dagegen jeden Texel.
ORH instead of ORM is ARCHITECTURE W5: metallic is a CONSTANT per layer
(`metallic` in material.json), height on the other hand needs every texel.

── Warum EMIT-Bake mit einem Sample / Why an EMIT bake at one sample ──
Ein DIFFUSE- oder NORMAL-Bake ist ein Monte-Carlo-Integral: er rauscht, und
sein Rauschen ist an Cycles' Tile- und Thread-Aufteilung gebunden. Das
Determinismus-Gesetz verlangt aber byte-gleiche Ergebnisse. Ein EMIT-Bake
wertet den Shader an der Texelmitte AUS, ohne zu integrieren — ein Sample
genuegt, das Ergebnis ist exakt und damit reproduzierbar.
A diffuse or normal bake is a Monte-Carlo integral: it is noisy, and its
noise is tied to Cycles' tile and thread split. The determinism law however
demands byte-identical results. An EMIT bake EVALUATES the shader at the
texel centre without integrating — one sample suffices, the result is exact
and therefore reproducible.

Deshalb werden nur ZWEI Groessen gebacken (Farbe, und ein Paket aus
Hoehe/Rauheit/Maske in RGB); Normale und Occlusion werden danach aus der
Hoehenkarte gerechnet — im Wickel-Modus, damit die Kachel nahtlos bleibt.
Therefore only TWO quantities are baked (colour, and a packet of
height/roughness/mask in RGB); normal and occlusion are computed from the
height map afterwards — in wrap-around mode, so the tile stays seamless.

── Warum die 4D-Torusabbildung / Why the 4D torus mapping ────────────
Blenders Rauschen kachelt nicht. Bildet man (u,v) auf einen Torus im
4D-Raum ab — (cos 2πu, sin 2πu, cos 2πv, sin 2πv) — ist jede Funktion
darauf in u UND v periodisch. Das ist der einzige Weg zu einer wirklich
nahtlosen prozeduralen Kachel, und Triplanar wiederholt jede Kachel ueber
zehn Meter Wand: eine Naht waere kein Randfall, sondern die Regel.
Blender's noise does not tile. Mapping (u,v) onto a torus in 4D space —
(cos 2πu, sin 2πu, cos 2πv, sin 2πv) — makes every function on it periodic
in u AND v. That is the only route to a truly seamless procedural tile, and
triplanar repeats every tile across ten metres of wall: a seam would not be
an edge case but the rule.

── Determinismus / Determinism ───────────────────────────────────────
material_seed = seed * 100 + tag  (NICHT die Bearbeitungsreihenfolge!)
Damit liefert ein Lauf mit --only fels dieselben Bytes wie ein Voll-Lauf.
So a run with --only rock produces the same bytes as a full run.
Alle Zufallszahlen kommen aus `_hash32` in DIESER Datei, nicht aus
Pythons `random` und nicht aus Blenders Szenen-Seed.
All random numbers come from `_hash32` in THIS file, not from Python's
`random` and not from Blender's scene seed.

── Leitbild / Guiding image ──────────────────────────────────────────
Barrow: ruhige helle Steinquader, gedaempfte Palette, FLAECHIG.
Kein Fotorealismus. Das Werkzeug dafuer sind ColorRamps mit
Interpolation CONSTANT — sie quantisieren jedes Rauschen in wenige
Farbstufen, und genau das trennt "gemalt" von "gescannt".
Barrow: calm light stone blocks, muted palette, FLAT.
No photorealism. The tool for that is colour ramps with CONSTANT
interpolation — they quantise any noise into a few colour steps, and that
is exactly what separates "painted" from "scanned".
"""

import argparse
import json
import math
import os
import sys

import bpy  # noqa: E402  (nur unter Blender / only under Blender)
import numpy as np  # noqa: E402

TAU = math.pi * 2.0

# ─────────────────────────────────────────────────────────────────────
# Ganzzahliger Hash — dieselbe Rolle wie shared/src/dungeon2/hashing.ts:
# ein reproduzierbarer Zufall ohne Zufallsgenerator.
# Integer hash — same role as shared/src/dungeon2/hashing.ts: a
# reproducible randomness without a random number generator.
# ─────────────────────────────────────────────────────────────────────


def _hash32(a: int, b: int = 0) -> int:
    """SplitMix-artige Mischung, rein ganzzahlig. / SplitMix-like mix, purely integral."""
    x = (a * 0x9E3779B1 + b * 0x85EBCA77) & 0xFFFFFFFF
    x ^= x >> 16
    x = (x * 0x7FEB352D) & 0xFFFFFFFF
    x ^= x >> 15
    x = (x * 0x846CA68B) & 0xFFFFFFFF
    x ^= x >> 16
    return x


def _rand(seed: int, index: int, lo: float = 0.0, hi: float = 1.0) -> float:
    """Ein reproduzierbarer Wert in [lo,hi). / One reproducible value in [lo,hi)."""
    return lo + (hi - lo) * (_hash32(seed, index) / 4294967296.0)


def srgb_to_linear(c):
    """sRGB → linear. Farben werden im Skript als sRGB notiert (so liest man sie),
    Blender rechnet linear. / Colours are written as sRGB in this script (that is how
    one reads them), Blender computes in linear."""
    a = np.asarray(c, dtype=np.float64)
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(a):
    """linear → sRGB, fuer die Albedo-PNG. / linear → sRGB, for the albedo PNG."""
    a = np.clip(np.asarray(a, dtype=np.float64), 0.0, 1.0)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * (a ** (1.0 / 2.4)) - 0.055)


def hexcol(s: str):
    """'#C9BCA2' → linearer RGB-Tupel. / '#C9BCA2' → linear RGB tuple."""
    s = s.lstrip('#')
    v = [int(s[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(float(x) for x in srgb_to_linear(v))


# ─────────────────────────────────────────────────────────────────────
# Kleiner Baukasten fuer Node-Graphen. Ohne ihn wird jede Materialdefinition
# zu dreissig Zeilen Verdrahtung und niemand sieht mehr, was das Material tut.
# A small kit for node graphs. Without it every material definition becomes
# thirty lines of wiring and nobody can see what the material does any more.
# ─────────────────────────────────────────────────────────────────────


class Graph:
    def __init__(self, node_tree):
        self.nt = node_tree
        self._x = 0

    def new(self, idname, **props):
        n = self.nt.nodes.new(idname)
        n.location = (self._x, 0)
        self._x += 180
        for k, v in props.items():
            setattr(n, k, v)
        return n

    # Ein Eingang bekommt entweder eine Verbindung oder einen festen Wert.
    # An input gets either a link or a fixed value.
    def feed(self, socket, value):
        if value is None:
            return
        if hasattr(value, 'is_output'):
            self.nt.links.new(value, socket)
        else:
            socket.default_value = value

    @staticmethod
    def sock(node, name, kind, outputs=False):
        """Sockel per NAME UND TYP suchen, nie per Index: der Mix-Node fuehrt
        'A' dreimal (Float, Vektor, Farbe), und Indizes verschieben sich
        zwischen Blender-Versionen.
        Look sockets up by NAME AND TYPE, never by index: the mix node carries
        'A' three times (float, vector, colour), and indices shift between
        Blender versions."""
        pool = node.outputs if outputs else node.inputs
        for s in pool:
            if s.name == name and s.type == kind:
                return s
        raise KeyError(f'{node.bl_idname}: kein Sockel {name}/{kind} / no socket {name}/{kind}')

    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.new('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.feed(n.inputs[0], a)
        if b is not None:
            self.feed(n.inputs[1], b)
        if c is not None:
            self.feed(n.inputs[2], c)
        return n.outputs[0]

    def vmath(self, op, a, b=None, c=None):
        n = self.new('ShaderNodeVectorMath', operation=op)
        self.feed(n.inputs[0], a)
        if b is not None:
            self.feed(n.inputs[1], b)
        if c is not None:
            self.feed(n.inputs[2], c)
        return n.outputs[0]

    def combine(self, x, y, z):
        n = self.new('ShaderNodeCombineXYZ')
        self.feed(n.inputs[0], x)
        self.feed(n.inputs[1], y)
        self.feed(n.inputs[2], z)
        return n.outputs[0]

    def mixf(self, fac, a, b):
        """Lineare Mischung zweier Skalare. / Linear mix of two scalars."""
        n = self.new('ShaderNodeMix', data_type='FLOAT')
        self.feed(self.sock(n, 'Factor', 'VALUE'), fac)
        floats = [s for s in n.inputs if s.type == 'VALUE' and s.name in ('A', 'B')]
        self.feed(floats[0], a)
        self.feed(floats[1], b)
        return self.sock(n, 'Result', 'VALUE', outputs=True)

    def mixc(self, fac, a, b):
        """Lineare Mischung zweier Farben. / Linear mix of two colours."""
        n = self.new('ShaderNodeMix', data_type='RGBA')
        self.feed(self.sock(n, 'Factor', 'VALUE'), fac)
        cols = [s for s in n.inputs if s.type == 'RGBA' and s.name in ('A', 'B')]
        self.feed(cols[0], (a[0], a[1], a[2], 1.0) if not hasattr(a, 'is_output') else a)
        self.feed(cols[1], (b[0], b[1], b[2], 1.0) if not hasattr(b, 'is_output') else b)
        return self.sock(n, 'Result', 'RGBA', outputs=True)

    def maprange(self, value, fmin, fmax, tmin=0.0, tmax=1.0, smooth=True):
        n = self.new('ShaderNodeMapRange', clamp=True,
                     interpolation_type='SMOOTHSTEP' if smooth else 'LINEAR')
        self.feed(n.inputs['Value'], value)
        self.feed(n.inputs['From Min'], fmin)
        self.feed(n.inputs['From Max'], fmax)
        self.feed(n.inputs['To Min'], tmin)
        self.feed(n.inputs['To Max'], tmax)
        return n.outputs['Result']

    def ramp(self, fac, stops, interpolation='CONSTANT'):
        """ColorRamp. stops = [(pos, '#rrggbb' | float), ...].
        CONSTANT ist die Voreinstellung, weil FLAECHIG das Leitbild ist.
        CONSTANT is the default because FLAT is the guiding image."""
        n = self.new('ShaderNodeValToRGB')
        self.feed(n.inputs['Fac'], fac)
        n.color_ramp.interpolation = interpolation
        el = n.color_ramp.elements
        while len(el) > 1:
            el.remove(el[len(el) - 1])
        for i, (pos, col) in enumerate(stops):
            e = el[0] if i == 0 else el.new(pos)
            e.position = pos
            if isinstance(col, str):
                r, g, b = hexcol(col)
            else:
                r = g = b = float(col)
            e.color = (r, g, b, 1.0)
        return n.outputs['Color']

    def ramp_f(self, fac, stops, interpolation='CONSTANT'):
        """Wie ramp(), aber als Skalar. / Like ramp(), but as a scalar."""
        col = self.ramp(fac, stops, interpolation)
        # Der Ramp gibt Grau aus; ein Kanal genuegt.
        # The ramp outputs grey; one channel suffices.
        n = self.new('ShaderNodeSeparateColor')
        self.feed(n.inputs['Color'], col)
        return n.outputs['Red']


class Coords:
    """Die 4D-Torus-Koordinaten einer Kachel. / The 4D torus coordinates of a tile."""

    def __init__(self, vector, w):
        self.vector = vector
        self.w = w


def torus(g: Graph, u, v, scale_u: float, scale_v: float, seed: int, salt: int) -> Coords:
    """(u,v) → Punkt auf einem 4D-Torus. Jede Rauschfunktion darauf kachelt.
    (u,v) → point on a 4D torus. Every noise function on it tiles."""
    ou = _rand(seed, salt * 7 + 1, -50.0, 50.0)
    ov = _rand(seed, salt * 7 + 2, -50.0, 50.0)
    au = g.math('MULTIPLY', u, TAU)
    av = g.math('MULTIPLY', v, TAU)
    x = g.math('ADD', g.math('MULTIPLY', g.math('COSINE', au), scale_u), ou)
    y = g.math('ADD', g.math('MULTIPLY', g.math('SINE', au), scale_u), ov)
    z = g.math('MULTIPLY', g.math('COSINE', av), scale_v)
    w = g.math('ADD', g.math('MULTIPLY', g.math('SINE', av), scale_v),
               _rand(seed, salt * 7 + 3, -50.0, 50.0))
    return Coords(g.combine(x, y, z), w)


def fbm(g: Graph, c: Coords, scale=1.0, detail=4.0, roughness=0.5, distortion=0.0):
    """Kachelndes Rauschen. / Tiling noise."""
    n = g.new('ShaderNodeTexNoise', noise_dimensions='4D')
    g.feed(n.inputs['Vector'], c.vector)
    g.feed(n.inputs['W'], c.w)
    g.feed(n.inputs['Scale'], scale)
    g.feed(n.inputs['Detail'], detail)
    g.feed(n.inputs['Roughness'], roughness)
    if 'Distortion' in n.inputs:
        g.feed(n.inputs['Distortion'], distortion)
    return n.outputs['Fac']


def spread(g: Graph, x, lo=0.33, hi=0.67):
    """Rauschen auf den vollen Bereich ziehen. OHNE DAS BLEIBT ALLES FLACH:
    Blenders Noise-Fac liegt fast vollstaendig zwischen 0.35 und 0.65, ein
    ColorRamp mit Stuetzstellen bei 0.0/0.4/0.7 sieht davon genau eine Stufe —
    das Ergebnis ist eine einfarbige Flaeche, und der Fehler hat kein Symptom
    ausser 'sieht langweilig aus'.
    Pull noise onto the full range. WITHOUT THIS EVERYTHING STAYS FLAT:
    Blender's noise Fac lies almost entirely between 0.35 and 0.65, a colour
    ramp with stops at 0.0/0.4/0.7 sees exactly one step of that — the result
    is a single-coloured surface, and the mistake has no symptom other than
    'looks boring'."""
    return g.maprange(x, lo, hi, 0.0, 1.0, smooth=False)


def cells(g: Graph, c: Coords, scale=1.0, randomness=1.0, feature='F1',
          out='Distance', smoothness=None):
    """Kachelnde Voronoi-Zellen — Fugen, Bruchflaechen, Flecken.
    Tiling Voronoi cells — joints, fracture faces, patches."""
    n = g.new('ShaderNodeTexVoronoi', voronoi_dimensions='4D', feature=feature)
    g.feed(n.inputs['Vector'], c.vector)
    g.feed(n.inputs['W'], c.w)
    g.feed(n.inputs['Scale'], scale)
    g.feed(n.inputs['Randomness'], randomness)
    if smoothness is not None and 'Smoothness' in n.inputs:
        g.feed(n.inputs['Smoothness'], smoothness)
    return n.outputs[out]


def cellval(g: Graph, c: Coords, scale=1.0, randomness=1.0):
    """Ein je Zelle KONSTANTER Zufallswert. Das ist der Unterschied zwischen
    einer Facette und einem Farbverlauf: `Distance` steigt innerhalb der Zelle
    an, `Color` steht still.
    A per-cell CONSTANT random value. That is the difference between a facet
    and a colour gradient: `Distance` rises within the cell, `Color` stands still."""
    col = cells(g, c, scale=scale, randomness=randomness, out='Color')
    n = g.new('ShaderNodeSeparateColor')
    g.feed(n.inputs['Color'], col)
    return n.outputs['Red']


def white(g: Graph, x, y, z, w):
    """Weisses Rauschen als Zufall je Quader. / White noise as randomness per block."""
    n = g.new('ShaderNodeTexWhiteNoise', noise_dimensions='4D')
    g.feed(n.inputs['Vector'], g.combine(x, y, z))
    g.feed(n.inputs['W'], w)
    return n.outputs['Value']


def grid(g: Graph, u, v, cols: int, rows: int, bond: float, joint: float, seed: int, salt: int):
    """Verband aus Quadern/Platten. Gibt (Flaechenmaske, Zufall je Quader) zurueck.
    Die Zellindizes werden MODULO cols/rows genommen — sonst traegt die Kachel
    an ihrer Naht zwei verschiedene Quader mit derselben Kante.
    Bond of blocks/slabs. Returns (face mask, per-block randomness). The cell
    indices are taken MODULO cols/rows — otherwise the tile carries two
    different blocks at the same edge across its seam."""
    row = g.math('FLOOR', g.math('MULTIPLY', v, float(rows)))
    shift = g.math('WRAP', g.math('MULTIPLY', row, bond), 0.0, 1.0)
    uu = g.math('WRAP', g.math('ADD', g.math('MULTIPLY', u, float(cols)), shift), 0.0, 1.0)
    vv = g.math('WRAP', g.math('MULTIPLY', v, float(rows)), 0.0, 1.0)
    col = g.math('WRAP', g.math('FLOOR', g.math('ADD', g.math('MULTIPLY', u, float(cols)), shift)),
                 0.0, float(cols))
    rnd = white(g, col, row, 0.0, float(_rand(seed, salt, 0.0, 97.0)))
    # Abstand zur naechsten Fuge, weich abgeschnitten.
    # Distance to the nearest joint, softly cut off.
    du = g.math('MINIMUM', uu, g.math('SUBTRACT', 1.0, uu))
    dv = g.math('MINIMUM', vv, g.math('SUBTRACT', 1.0, vv))
    d = g.math('MINIMUM', g.math('DIVIDE', du, float(rows) / float(cols)), dv)
    face = g.maprange(d, 0.0, joint, 0.0, 1.0)
    return face, rnd


# ─────────────────────────────────────────────────────────────────────
# Die Materialien. Jede Funktion liefert (Farbe, Hoehe, Rauheit, Maske).
# Maske ist nur bei Overlays von Belang.
# The materials. Each function returns (colour, height, roughness, mask).
# Mask only matters for overlays.
# ─────────────────────────────────────────────────────────────────────


def m_wall_block(g, u, v, seed):
    """Tag 0 — Wandquader aus hellem Sandstein. Das Leitmaterial des Barrow:
    ruhig, warm gebrochen-weiss, klare rechteckige Fugen.
    Tag 0 — wall blocks of light sandstone. The barrow's leading material:
    calm, warm broken white, clear rectangular joints."""
    face, rnd = grid(g, u, v, cols=4, rows=8, bond=0.5, joint=0.030, seed=seed, salt=1)
    grain = spread(g, fbm(g, torus(g, u, v, 2.6, 2.6, seed, 2),
                          scale=2.0, detail=1.5, roughness=0.45))
    # Quaderton und Koernung addieren sich VOR dem Ramp. Deshalb bekommt jeder
    # Quader eine eigene Grundstufe und trotzdem eine Zeichnung darin — waeren
    # es zwei Ramps, muesste man sie mischen und beide Stufenbilder verwaschen.
    # Block tone and grain add up BEFORE the ramp. So every block gets its own
    # base step and still carries a drawing inside it — with two ramps one
    # would have to blend them and wash out both step images.
    shade = g.math('ADD', g.math('MULTIPLY', rnd, 0.70), g.math('MULTIPLY', grain, 0.30),
                   clamp=True)
    # Vier Farbstufen statt eines Verlaufs — das ist die Stilisierung.
    # Four colour steps instead of a gradient — that is the stylisation.
    tone = g.ramp(shade, [(0.0, '#AA9C82'), (0.26, '#B9AB90'), (0.54, '#C7BAA1'),
                          (0.80, '#D5CAB3')])
    color = g.mixc(g.math('SUBTRACT', 1.0, face), tone, hexcol('#867B6C'))
    h_face = g.math('ADD', g.math('MULTIPLY', rnd, 0.14),
                    g.math('MULTIPLY', grain, 0.10))
    height = g.math('MULTIPLY', face, g.math('ADD', 0.70, h_face))
    rough = g.mixf(face, 0.92, g.ramp_f(grain, [(0.0, 0.82), (0.35, 0.76), (0.70, 0.70)]))
    return color, height, rough, None


def m_rock_raw(g, u, v, seed):
    """Tag 1 — roher Bruchfels. Kuehler und grauer als der Quader; das ist der
    Kontrastanker 'gewachsen gegen bearbeitet'.
    Tag 1 — raw fractured rock. Cooler and greyer than the block; that is the
    contrast anchor 'grown versus worked'."""
    c1 = torus(g, u, v, 1.5, 1.5, seed, 1)
    c2 = torus(g, u, v, 4.0, 4.0, seed, 2)
    # Voronoi-Zellwert als Grundstufe je Facette: `Color` ist je Zelle konstant,
    # `Distance` waere ein Verlauf und damit wieder ein Farbverlauf statt Flaeche.
    # Voronoi cell value as base step per facet: `Color` is constant per cell,
    # `Distance` would be a gradient and thus a colour ramp instead of a face.
    facets = cellval(g, c1, scale=0.85)
    edges = cells(g, c1, scale=0.85, feature='DISTANCE_TO_EDGE', out='Distance')
    rough_n = spread(g, fbm(g, c2, scale=1.6, detail=1.5, roughness=0.55))
    shade = g.math('ADD', g.math('MULTIPLY', facets, 0.72), g.math('MULTIPLY', rough_n, 0.28),
                   clamp=True)
    color = g.ramp(shade, [(0.0, '#6B6F6C'), (0.26, '#7A7E7A'), (0.52, '#888D88'),
                           (0.76, '#979C96')])
    crack = g.maprange(edges, 0.0, 0.035, 0.0, 1.0)
    color = g.mixc(g.math('SUBTRACT', 1.0, crack), color, hexcol('#565A58'))
    height = g.math('MULTIPLY', crack,
                    g.math('ADD', 0.45, g.math('ADD', g.math('MULTIPLY', facets, 0.40),
                                               g.math('MULTIPLY', rough_n, 0.15))))
    rough = g.ramp_f(rough_n, [(0.0, 0.95), (0.35, 0.88), (0.65, 0.82)])
    return color, height, rough, None


def m_floor_slabs(g, u, v, seed):
    """Tag 2 — verlegte Bodenplatten. Groesseres, regelmaessigeres Fugenraster als
    die Wand, dazu flache Trittmulden in der Hoehe.
    Tag 2 — laid floor slabs. Larger, more regular joint grid than the wall,
    plus shallow wear hollows in the height."""
    face, rnd = grid(g, u, v, cols=3, rows=3, bond=0.0, joint=0.026, seed=seed, salt=1)
    grain = spread(g, fbm(g, torus(g, u, v, 2.4, 2.4, seed, 2),
                          scale=1.6, detail=1.5, roughness=0.5))
    wear = spread(g, fbm(g, torus(g, u, v, 1.1, 1.1, seed, 3),
                         scale=1.0, detail=1.0, roughness=0.5), 0.28, 0.72)
    shade = g.math('ADD', g.math('MULTIPLY', rnd, 0.72), g.math('MULTIPLY', grain, 0.28),
                   clamp=True)
    tone = g.ramp(shade, [(0.0, '#A0947F'), (0.26, '#AFA48F'), (0.54, '#BDB29C'),
                          (0.80, '#C9BFAA')])
    # Trittmulden: dunkler, wo die Platte ausgetreten ist. Zwei Stufen genuegen —
    # ein weicher Verlauf waere hier der Fotoscan-Look.
    # Wear hollows: darker where the slab is worn. Two steps suffice — a soft
    # gradient would be the photo-scan look here.
    tone = g.mixc(g.ramp_f(wear, [(0.0, 0.0), (0.62, 0.30)]), tone, hexcol('#8B8272'))
    color = g.mixc(g.math('SUBTRACT', 1.0, face), tone, hexcol('#776E61'))
    height = g.math('MULTIPLY', face,
                    g.math('ADD', 0.70, g.math('SUBTRACT',
                                               g.math('MULTIPLY', rnd, 0.10),
                                               g.math('MULTIPLY', wear, 0.16))))
    rough = g.mixf(face, 0.93, g.ramp_f(wear, [(0.0, 0.86), (0.45, 0.78), (0.75, 0.70)]))
    return color, height, rough, None


def m_earth_sand(g, u, v, seed):
    """Tag 3 — Erde und Sand. Sehr flach in der Hoehe, feinkoernig, keine Fugen.
    Tag 3 — earth and sand. Very flat in height, fine grained, no joints."""
    fine = spread(g, fbm(g, torus(g, u, v, 4.0, 4.0, seed, 1),
                         scale=1.8, detail=2.0, roughness=0.6))
    broad = spread(g, fbm(g, torus(g, u, v, 2.2, 2.2, seed, 2),
                          scale=1.4, detail=1.0, roughness=0.5), 0.30, 0.70)
    pebbles = cells(g, torus(g, u, v, 3.0, 3.0, seed, 3), scale=1.1, out='Distance')
    shade = g.math('ADD', g.math('MULTIPLY', broad, 0.72), g.math('MULTIPLY', fine, 0.28),
                   clamp=True)
    color = g.ramp(shade, [(0.0, '#8F7A5C'), (0.24, '#9F8969'), (0.50, '#AF9877'),
                           (0.76, '#BEA786')])
    stone = g.maprange(pebbles, 0.20, 0.07, 0.0, 1.0)
    color = g.mixc(g.math('MULTIPLY', stone, 0.85), color, hexcol('#8A8378'))
    height = g.math('ADD', g.math('MULTIPLY', fine, 0.30),
                    g.math('ADD', g.math('MULTIPLY', broad, 0.30), g.math('MULTIPLY', stone, 0.40)))
    rough = g.ramp_f(fine, [(0.0, 0.98), (0.5, 0.94)])
    return color, height, rough, None


def m_wood_rune(g, u, v, seed):
    """Tag 4 — dunkles Runenholz. Die Maserung entsteht durch STARK gestreckte
    Torus-Skalen: eng in v, weit in u — daher laufen die Ringe laengs.
    Tag 4 — dark rune wood. The grain comes from HEAVILY stretched torus
    scales: tight in v, wide in u — so the rings run lengthwise."""
    stretched = torus(g, u, v, 0.8, 16.0, seed, 1)
    rings_n = fbm(g, stretched, scale=1.4, detail=4.0, roughness=0.55, distortion=0.8)
    fibre = spread(g, fbm(g, torus(g, u, v, 1.0, 16.0, seed, 2),
                          scale=1.6, detail=1.5, roughness=0.6))
    # Maserung: das Rauschen wird auf sich selbst zurueckgefaltet (WRAP), so
    # entstehen Jahresringe statt Wolken.
    # Grain: the noise is folded back onto itself (WRAP), producing growth rings
    # instead of clouds.
    rings = g.math('WRAP', g.math('MULTIPLY', rings_n, 9.0), 0.0, 1.0)
    color = g.ramp(rings, [(0.0, '#33261C'), (0.22, '#402F24'), (0.48, '#4C392B'),
                           (0.72, '#3B2C21')])
    color = g.mixc(g.ramp_f(fibre, [(0.0, 0.0), (0.62, 0.40)]), color, hexcol('#291E15'))
    # Bretterfugen quer: wenige, breite Spalten. / Cross plank joints: few, wide gaps.
    plank, prnd = grid(g, u, v, cols=1, rows=4, bond=0.0, joint=0.040, seed=seed, salt=3)
    color = g.mixc(g.math('SUBTRACT', 1.0, plank), color, hexcol('#1C150E'))
    color = g.mixc(g.ramp_f(prnd, [(0.0, 0.0), (0.5, 0.35)]), color, hexcol('#523E2E'))
    height = g.math('MULTIPLY', plank,
                    g.math('ADD', 0.55, g.math('ADD', g.math('MULTIPLY', rings, 0.28),
                                               g.math('MULTIPLY', fibre, 0.17))))
    rough = g.ramp_f(rings, [(0.0, 0.88), (0.35, 0.82), (0.70, 0.76)])
    return color, height, rough, None


def m_metal(g, u, v, seed):
    """Tag 5 — Eisenbeschlaege. Das EINZIGE metallische Material; `metallic`
    steht deshalb als Konstante in material.json, nicht als Texturkanal (W5).
    Rost senkt das Metall optisch ab — im Shader ueber die Rauheit, nicht ueber
    einen zweiten Metallwert.
    Tag 5 — iron fittings. The ONLY metallic material; `metallic` therefore
    lives as a constant in material.json, not as a texture channel (W5). Rust
    visually lowers the metal — via roughness in the shader, not via a second
    metal value."""
    hammer = cellval(g, torus(g, u, v, 1.0, 1.0, seed, 1), scale=0.55)
    rust_n = spread(g, fbm(g, torus(g, u, v, 1.1, 1.1, seed, 2),
                           scale=0.9, detail=1.5, roughness=0.6), 0.28, 0.72)
    base = g.ramp(hammer, [(0.0, '#4A4E53'), (0.30, '#525760'), (0.62, '#5A6068'),
                           (0.85, '#646A72')])
    rust = g.maprange(rust_n, 0.60, 0.80, 0.0, 1.0)
    color = g.mixc(rust, base, g.ramp(rust_n, [(0.0, '#5E4A38'), (0.62, '#6B543C'),
                                               (0.86, '#785D41')]))
    height = g.math('ADD', g.math('MULTIPLY', hammer, 0.55),
                    g.math('MULTIPLY', rust, 0.25))
    rough = g.mixf(rust, 0.38, 0.86)
    return color, height, rough, None


def m_moss_overlay(g, u, v, seed):
    """Tag 6 — Moos als Blend-Layer. Nur Albedo/Normal zaehlen; die Maske sagt,
    WO das Moos sitzt, die Hoehenschwelle im Shader sagt, ob es dort erlaubt ist.
    Tag 6 — moss as a blend layer. Only albedo/normal matter; the mask says
    WHERE the moss sits, the height threshold in the shader says whether it is
    allowed there."""
    clump_raw = fbm(g, torus(g, u, v, 2.2, 2.2, seed, 1), scale=1.6, detail=3.0, roughness=0.65)
    clump = spread(g, clump_raw, 0.30, 0.70)
    fuzz = spread(g, fbm(g, torus(g, u, v, 4.0, 4.0, seed, 2),
                         scale=1.8, detail=2.0, roughness=0.7))
    color = g.ramp(g.math('ADD', g.math('MULTIPLY', clump, 0.70),
                          g.math('MULTIPLY', fuzz, 0.30), clamp=True),
                   [(0.0, '#35462A'), (0.28, '#425534'), (0.56, '#506740'),
                    (0.82, '#5F784B')])
    # Die Maske wird auf dem ROHEN Rauschen geschnitten: `spread` verzerrt die
    # Verteilung, und eine Deckungsschwelle soll die Verteilung sehen, die sie
    # meint.
    # The mask is cut on the RAW noise: `spread` distorts the distribution, and
    # a coverage threshold should see the distribution it means.
    mask = g.maprange(clump_raw, 0.44, 0.58, 0.0, 1.0)
    height = g.math('MULTIPLY', mask, g.math('ADD', 0.35, g.math('MULTIPLY', fuzz, 0.65)))
    rough = g.ramp_f(fuzz, [(0.0, 0.96), (0.5, 0.92)])
    return color, height, rough, mask


def m_damp_overlay(g, u, v, seed):
    """Tag 7 — Feuchte. Kein eigenes Albedo im Sinne einer Farbe: die Basisfarbe
    wird nur ABGEDUNKELT, und die Rauheit faellt. Genau das treibt spaeter SSR.
    Tag 7 — damp. No own albedo in the sense of a colour: the base colour is
    only DARKENED and the roughness drops. That is exactly what later drives SSR."""
    seep_raw = fbm(g, torus(g, u, v, 3.0, 7.0, seed, 1), scale=1.6, detail=4.0, roughness=0.6)
    seep = spread(g, seep_raw, 0.30, 0.70)
    ripple = spread(g, fbm(g, torus(g, u, v, 5.0, 5.0, seed, 2),
                           scale=1.8, detail=1.5, roughness=0.5))
    color = g.ramp(seep, [(0.0, '#232625'), (0.30, '#2B2E2D'), (0.60, '#343835'),
                          (0.84, '#3D423E')])
    mask = g.maprange(seep_raw, 0.42, 0.58, 0.0, 1.0)
    height = g.math('MULTIPLY', mask, g.math('ADD', 0.20, g.math('MULTIPLY', ripple, 0.30)))
    rough = g.mixf(mask, 0.70, 0.12)
    return color, height, rough, mask


def m_frost_overlay(g, u, v, seed):
    """Tag 8 — Frost (Theme Eis). Kristallkanten statt Flecken, deshalb Voronoi
    auf Kantenabstand statt Rauschen.
    Tag 8 — frost (ice theme). Crystal edges instead of patches, hence Voronoi
    on edge distance instead of noise."""
    c = torus(g, u, v, 2.2, 2.2, seed, 1)
    edge = cells(g, c, scale=1.0, feature='DISTANCE_TO_EDGE', out='Distance')
    grain = spread(g, fbm(g, torus(g, u, v, 6.0, 6.0, seed, 2),
                          scale=2.0, detail=1.5, roughness=0.6))
    crystal = g.maprange(edge, 0.20, 0.0, 0.0, 1.0)
    color = g.ramp(g.math('ADD', g.math('MULTIPLY', crystal, 0.74),
                          g.math('MULTIPLY', grain, 0.26), clamp=True),
                   [(0.0, '#A8BCC9'), (0.26, '#BCCDD7'), (0.52, '#D0DEE6'),
                    (0.78, '#E6EFF4')])
    mask = g.maprange(g.math('ADD', g.math('MULTIPLY', crystal, 0.65),
                             g.math('MULTIPLY', grain, 0.35), clamp=True),
                      0.32, 0.62, 0.0, 1.0)
    height = g.math('MULTIPLY', mask, g.math('ADD', 0.30, g.math('MULTIPLY', crystal, 0.70)))
    rough = g.mixf(mask, 0.70, 0.30)
    return color, height, rough, mask


def m_soot_overlay(g, u, v, seed):
    """Tag 9 — Russ (Theme Feuer). Weiche, sehr dunkle Schlieren; im Shader mit
    UMGEKEHRTER Hoehenrichtung wie Moos, also oben statt unten.
    Tag 9 — soot (fire theme). Soft, very dark streaks; in the shader with the
    INVERTED height direction compared to moss, i.e. up instead of down."""
    smear_raw = fbm(g, torus(g, u, v, 4.0, 2.0, seed, 1), scale=1.8, detail=5.0, roughness=0.7)
    smear = spread(g, smear_raw, 0.30, 0.70)
    speck = spread(g, fbm(g, torus(g, u, v, 7.0, 7.0, seed, 2),
                          scale=2.0, detail=1.5, roughness=0.6))
    color = g.ramp(g.math('ADD', g.math('MULTIPLY', smear, 0.72),
                          g.math('MULTIPLY', speck, 0.28), clamp=True),
                   [(0.0, '#171410'), (0.28, '#1F1B16'), (0.56, '#28231B'),
                    (0.82, '#332C22')])
    mask = g.maprange(smear_raw, 0.40, 0.58, 0.0, 1.0)
    height = g.math('MULTIPLY', mask, g.math('MULTIPLY', speck, 0.25))
    rough = g.mixf(mask, 0.90, 0.98)
    return color, height, rough, mask


# tag, Ordnername, Anzeigename, Bauer, Metallwert, Kachelmass in Metern, im Basis-Array?
# tag, folder name, display name, builder, metal value, tile size in metres, in base array?
MATERIALS = [
    (0, 'wall-block', 'Wandquader / wall block', m_wall_block, 0.0, 4.0, True),
    (1, 'rock-raw', 'Fels roh / raw rock', m_rock_raw, 0.0, 4.0, True),
    (2, 'floor-slabs', 'Bodenplatten / floor slabs', m_floor_slabs, 0.0, 4.0, True),
    (3, 'earth-sand', 'Erde-Sand / earth-sand', m_earth_sand, 0.0, 4.0, True),
    (4, 'wood-rune', 'Runenholz / rune wood', m_wood_rune, 0.0, 2.0, True),
    (5, 'metal', 'Metall / metal', m_metal, 1.0, 1.0, True),
    (6, 'moss-overlay', 'Moos / moss', m_moss_overlay, 0.0, 2.0, False),
    (7, 'damp-overlay', 'Feuchte / damp', m_damp_overlay, 0.0, 4.0, False),
    (8, 'frost-overlay', 'Frost / frost', m_frost_overlay, 0.0, 2.0, False),
    (9, 'soot-overlay', 'Russ / soot', m_soot_overlay, 0.0, 4.0, False),
]

BY_NAME = {m[1]: m for m in MATERIALS}


# ─────────────────────────────────────────────────────────────────────
# Backen / Baking
# ─────────────────────────────────────────────────────────────────────


def fresh_scene():
    """Leere Szene, Werkseinstellungen, nichts aus dem vorigen Material.
    Empty scene, factory settings, nothing left from the previous material."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 1
    sc.cycles.use_denoising = False
    # Persistente Daten wuerden Zustand zwischen zwei Baeckvorgaengen halten —
    # in aelteren Blender-Fassungen sitzt der Schalter an cycles, in neueren am
    # Render-Zweig. Beide Orte werden bedient, keiner vorausgesetzt.
    # Persistent data would keep state between two bakes — in older Blender
    # versions the switch sits on cycles, in newer ones on the render branch.
    # Both places are served, neither assumed.
    if hasattr(sc.cycles, 'use_persistent_data'):
        sc.cycles.use_persistent_data = False
    if hasattr(sc.render, 'use_persistent_data'):
        sc.render.use_persistent_data = False
    sc.cycles.seed = 0
    # Ohne 'Standard' schiebt das Farbmanagement noch eine Kurve dazwischen.
    # Without 'Standard' the colour management inserts another curve.
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    return sc


def bake_plane(scene, res, build, seed):
    """Baut Ebene + Material, backt Farbe und (Hoehe,Rauheit,Maske) und gibt
    beide als float32-Felder zurueck.
    Builds plane + material, bakes colour and (height,roughness,mask) and
    returns both as float32 arrays."""
    bpy.ops.mesh.primitive_plane_add(size=2.0)
    obj = bpy.context.active_object
    mat = bpy.data.materials.new('bake')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    g = Graph(nt)

    texco = g.new('ShaderNodeTexCoord')
    sep = g.new('ShaderNodeSeparateXYZ')
    nt.links.new(texco.outputs['UV'], sep.inputs['Vector'])
    u, v = sep.outputs['X'], sep.outputs['Y']

    color, height, rough, mask = build(g, u, v, seed)
    if mask is None:
        mask = 0.0

    emit = g.new('ShaderNodeEmission')
    out = g.new('ShaderNodeOutputMaterial')
    nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])

    img_node = g.new('ShaderNodeTexImage')
    obj.data.materials.append(mat)

    def run(source, name):
        img = bpy.data.images.new(name, res, res, alpha=False, float_buffer=True, is_data=True)
        img_node.image = img
        nt.nodes.active = img_node
        # Alte Verbindung am Emissionsfarb-Eingang loesen, neue setzen.
        # Release the old link at the emission colour input, set the new one.
        for link in list(nt.links):
            if link.to_socket == emit.inputs['Color']:
                nt.links.remove(link)
        g.feed(emit.inputs['Color'], source)
        g.feed(emit.inputs['Strength'], 1.0)
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type='EMIT', margin=0, use_clear=True)
        buf = np.empty(res * res * 4, dtype=np.float32)
        img.pixels.foreach_get(buf)
        bpy.data.images.remove(img)
        # Blender legt Zeilen von UNTEN nach oben ab, PNG von oben nach unten.
        # Blender stores rows BOTTOM-up, PNG top-down.
        return buf.reshape(res, res, 4)[::-1, :, :3].copy()

    albedo = run(color, 'bake_albedo')
    packed = run(g.combine(height, rough, mask), 'bake_packed')

    bpy.data.materials.remove(mat)
    return albedo, packed


def normal_from_height(h, strength):
    """Normale aus der Hoehenkarte, mit Wickelrand — eine Kachel ohne Wickelrand
    zeigt an ihrer Naht eine harte Kante, die es in der Hoehe gar nicht gibt.
    OpenGL-Konvention (+Y oben), weil Babylon sie erwartet.
    Normal from the height map, with wrapping — a tile without wrapping shows a
    hard edge at its seam that does not exist in the height at all.
    OpenGL convention (+Y up), because Babylon expects it."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    n = np.stack([-dx * strength, dy * strength, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def occlusion_from_height(h, strength):
    """Occlusion als Mehrskalen-Kavitaet: wo die Hoehe unter ihrem Umfeld liegt,
    faellt Licht schlechter hinein. Reicht fuer eine flaechige Optik voellig und
    ist im Gegensatz zu einem AO-Bake exakt reproduzierbar.
    Occlusion as multi-scale cavity: where the height sits below its
    surroundings, less light reaches in. Entirely sufficient for a flat look
    and, unlike an AO bake, exactly reproducible."""
    acc = np.zeros_like(h)
    for radius, weight in ((2, 0.5), (6, 0.3), (16, 0.2)):
        blur = h.copy()
        for axis in (0, 1):
            k = np.zeros_like(blur)
            for s in range(-radius, radius + 1):
                k += np.roll(blur, s, axis=axis)
            blur = k / (2 * radius + 1)
        acc += weight * np.clip(blur - h, 0.0, 1.0)
    return np.clip(1.0 - acc * strength, 0.0, 1.0)


def to8(a):
    """Nach 8 bit runden. Rundung, nicht Abschneiden — sonst ist jeder Wert
    im Mittel um einen halben Schritt zu dunkel.
    Round to 8 bit. Rounding, not truncation — otherwise every value is half a
    step too dark on average."""
    return np.clip(np.rint(np.asarray(a) * 255.0), 0, 255).astype(np.uint8)


def write_png(path, arr8):
    """PNG ohne Pillow schreiben — Blender bringt kein Pillow mit, und ein
    eigener Schreiber ist ohnehin byte-stabil (keine Bibliotheksversion im Bild).
    Write PNG without Pillow — Blender does not ship Pillow, and an own writer
    is byte-stable anyway (no library version in the picture)."""
    import struct
    import zlib
    h, w = arr8.shape[0], arr8.shape[1]
    ch = 1 if arr8.ndim == 2 else arr8.shape[2]
    ctype = {1: 0, 3: 2, 4: 6}[ch]
    data = arr8.reshape(h, w, ch)
    raw = bytearray()
    for row in range(h):
        raw.append(0)  # Filter 0 (None) — deterministisch / deterministic
        raw += data[row].tobytes()

    def chunk(tag, payload):
        return (struct.pack('>I', len(payload)) + tag + payload
                + struct.pack('>I', zlib.crc32(tag + payload) & 0xFFFFFFFF))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, ctype, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def make_material(spec, seed, res, out_root):
    tag, folder, label, build, metallic, tile_m, in_array = spec
    material_seed = seed * 100 + tag
    print(f'[dungeon2] {tag} {folder}  seed={material_seed}  res={res}', flush=True)

    scene = fresh_scene()
    albedo_lin, packed = bake_plane(scene, res, build, material_seed)

    height = packed[:, :, 0].astype(np.float64)
    rough = packed[:, :, 1].astype(np.float64)
    mask = packed[:, :, 2].astype(np.float64)

    normal = normal_from_height(height, strength=res / 24.0)
    occ = occlusion_from_height(height, strength=1.6)

    d = os.path.join(out_root, folder)
    os.makedirs(d, exist_ok=True)
    write_png(os.path.join(d, 'albedo.png'), to8(linear_to_srgb(albedo_lin)))
    write_png(os.path.join(d, 'normal.png'), to8(normal))
    write_png(os.path.join(d, 'orh.png'),
              to8(np.stack([occ, rough, height], axis=-1)))
    if not in_array:
        write_png(os.path.join(d, 'mask.png'), to8(mask))

    meta = {
        'name': folder,
        'label': label,
        'tag': tag,
        'seed': material_seed,
        'resolution': res,
        # Metallic ist eine Konstante je Layer, kein Texturkanal (ARCHITECTURE W5).
        # Metallic is a constant per layer, not a texture channel (ARCHITECTURE W5).
        'metallic': metallic,
        # Weltmeter je Kachelwiederholung — der Triplanar-Shader braucht das.
        # World metres per tile repeat — the triplanar shader needs this.
        'tileMetres': tile_m,
        # Nur Tags 0..5 liegen im Basis-Array; 6..9 sind Blend-Layer (W5).
        # Only tags 0..5 live in the base array; 6..9 are blend layers (W5).
        'inBaseArray': in_array,
        'maps': ['albedo.png', 'normal.png', 'orh.png'] + ([] if in_array else ['mask.png']),
        'orhChannels': {'r': 'occlusion', 'g': 'roughness', 'b': 'height'},
        'normalConvention': 'opengl-y-up',
    }
    with open(os.path.join(d, 'material.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write('\n')
    return meta


# ─────────────────────────────────────────────────────────────────────
# Kontaktabzug / Contact sheet
# ─────────────────────────────────────────────────────────────────────


def contact_sheet(out_root, dest, samples, width, height):
    """EIN Bild mit allen Materialien auf gefasten Wuerfeln, neutral beleuchtet.
    Kastenprojektion statt UV — das ist derselbe Wurf wie Triplanar im Spiel,
    also zeigt der Abzug, was der Shader spaeter zeigt, und nicht die
    Auswickelung einer Ebene.
    ONE image with all materials on bevelled cubes, neutrally lit. Box
    projection instead of UV — that is the same projection as triplanar in the
    game, so the sheet shows what the shader will show, not the unwrap of a plane."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x = width
    sc.render.resolution_y = height
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'

    world = bpy.data.worlds.new('w')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.16, 0.16, 0.17, 1.0)
    bg.inputs['Strength'].default_value = 1.0

    cols, rows = 5, 2
    step_x, step_y = 3.4, 5.6
    for i, (tag, folder, label, _b, metallic, tile_m, in_array) in enumerate(MATERIALS):
        cx = (i % cols - (cols - 1) / 2.0) * step_x
        cy = -((i // cols) - (rows - 1) / 2.0) * step_y

        bpy.ops.mesh.primitive_cube_add(size=1.7, location=(cx, cy, 0.0))
        cube = bpy.context.active_object
        cube.rotation_euler = (0.0, 0.0, math.radians(22.0))
        bev = cube.modifiers.new('bevel', 'BEVEL')
        bev.width = 0.06
        bev.segments = 3
        # Flach schattiert, nicht glatt: glatte Schattierung ueber die Fase
        # rundet den ganzen Wuerfel, und die ebene Flaeche ist genau das,
        # woran man ein Wandmaterial beurteilt.
        # Flat shaded, not smooth: smooth shading across the bevel rounds the
        # whole cube, and the flat face is exactly what one judges a wall
        # material on.
        bpy.ops.object.shade_flat()

        mat = bpy.data.materials.new(folder)
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        g = Graph(nt)
        bsdf = g.new('ShaderNodeBsdfPrincipled')
        out = g.new('ShaderNodeOutputMaterial')
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        texco = g.new('ShaderNodeTexCoord')

        def tex(fname, non_color):
            node = g.new('ShaderNodeTexImage', projection='BOX', extension='REPEAT')
            node.projection_blend = 0.25
            path = os.path.join(out_root, folder, fname)
            node.image = bpy.data.images.load(path, check_existing=True)
            node.image.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
            nt.links.new(texco.outputs['Object'], node.inputs['Vector'])
            return node

        alb = tex('albedo.png', False)
        nrm = tex('normal.png', True)
        orh = tex('orh.png', True)
        nt.links.new(alb.outputs['Color'], bsdf.inputs['Base Color'])
        sepc = g.new('ShaderNodeSeparateColor')
        nt.links.new(orh.outputs['Color'], sepc.inputs['Color'])
        nt.links.new(sepc.outputs['Green'], bsdf.inputs['Roughness'])
        bsdf.inputs['Metallic'].default_value = metallic
        nmap = g.new('ShaderNodeNormalMap')
        nmap.inputs['Strength'].default_value = 1.0
        nt.links.new(nrm.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
        cube.data.materials.append(mat)

        bpy.ops.object.text_add(location=(cx, cy - 1.55, -0.85))
        txt = bpy.context.active_object
        txt.data.body = f'{tag}  {folder}'
        txt.data.size = 0.30
        txt.data.align_x = 'CENTER'
        # Die Beschriftung liegt flach und wird zur Kamera aufgestellt — sonst
        # steht sie senkrecht in der Szene und verdeckt den naechsten Wuerfel.
        # The label lies flat and is tilted up towards the camera — otherwise it
        # stands upright in the scene and hides the next cube.
        txt.rotation_euler = (math.radians(58.0), 0.0, 0.0)
        tmat = bpy.data.materials.new('label')
        tmat.use_nodes = True
        tnt = tmat.node_tree
        tnt.nodes.clear()
        tg = Graph(tnt)
        em = tg.new('ShaderNodeEmission')
        tout = tg.new('ShaderNodeOutputMaterial')
        em.inputs['Color'].default_value = (0.75, 0.75, 0.72, 1.0)
        tnt.links.new(em.outputs['Emission'], tout.inputs['Surface'])
        txt.data.materials.append(tmat)

    # Neutrale Beleuchtung: ein weiches Hauptlicht, ein schwaches Gegenlicht.
    # Keine Fackelfarbe — der Abzug soll das MATERIAL zeigen, nicht die Stimmung.
    # Neutral lighting: one soft key light, one weak back light. No torch
    # colour — the sheet is to show the MATERIAL, not the mood.
    for loc, energy, size in (((-6.0, -6.0, 9.0), 2600.0, 8.0), ((7.0, 5.0, 6.0), 900.0, 10.0)):
        bpy.ops.object.light_add(type='AREA', location=loc)
        light = bpy.context.active_object
        light.data.energy = energy
        light.data.size = size
        d = np.array([0.0, 0.0, 0.0]) - np.array(loc)
        light.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), -d[2]), 0.0,
                                math.atan2(d[1], d[0]) + math.pi / 2)

    # Orthografisch, nicht perspektivisch: ein Kontaktabzug soll zehn Materialien
    # VERGLEICHBAR zeigen: bei Perspektive ist der Wuerfel in der Mitte groesser
    # als der am Rand, und man vergleicht dann Groessen statt Oberflaechen.
    # Orthographic, not perspective: a contact sheet is to show ten materials
    # COMPARABLY; under perspective the cube in the middle is larger than the one
    # at the edge, and one then compares sizes instead of surfaces.
    bpy.ops.object.camera_add(location=(0.0, -22.0, 15.0))
    cam = bpy.context.active_object
    cam.rotation_euler = (math.radians(56.0), 0.0, 0.0)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 20.0
    sc.camera = cam

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = dest
    bpy.ops.render.render(write_still=True)
    print(f'[dungeon2] Kontaktabzug / contact sheet: {dest}', flush=True)


def main(argv):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--seed', type=int, default=20260830)
    p.add_argument('--res', type=int, default=1024)
    p.add_argument('--out', default='/home/mike/wov-wt-dungeon2/assets/dungeon2/materials')
    p.add_argument('--only', default='', help='Kommaliste von Ordnernamen / comma list of folder names')
    p.add_argument('--contact', default='/home/mike/.cache/wov-tripo-test/dungeon2-materials.png')
    p.add_argument('--contact-samples', type=int, default=96)
    p.add_argument('--contact-size', default='1900x1060')
    p.add_argument('--no-contact', action='store_true')
    p.add_argument('--only-contact', action='store_true',
                   help='nur den Abzug rendern / only render the sheet')
    a = p.parse_args(argv)

    specs = MATERIALS
    if a.only:
        wanted = [s.strip() for s in a.only.split(',') if s.strip()]
        missing = [w for w in wanted if w not in BY_NAME]
        if missing:
            raise SystemExit(f'unbekanntes Material / unknown material: {missing}')
        specs = [BY_NAME[w] for w in wanted]

    if not a.only_contact:
        os.makedirs(a.out, exist_ok=True)
        for spec in specs:
            make_material(spec, a.seed, a.res, a.out)

    if not a.no_contact:
        w, h = (int(x) for x in a.contact_size.split('x'))
        contact_sheet(a.out, a.contact, a.contact_samples, w, h)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(args)
