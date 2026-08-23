/**
 * Weltkarte einer Instanz als Bild rendern — die Vorlage für die Webseite.
 *
 * Rechnet die Welt aus `server/data/welten/<instanz>.json` durch dieselbe
 * `createGeo`-Fabrik, die auch Server, Client und der Karten-Worker fahren.
 * Damit zeigt das Bild garantiert die Welt, die der Server wirklich fährt,
 * und nicht eine zweite Nachbildung, die irgendwann auseinanderläuft — genau
 * der Grund, warum `shared/test/geo-map.ts` schon dieselbe Palette benutzt.
 *
 * Ausgabe je Instanz zwei Dateien in <ziel>:
 *   <instanz>.webp   Kartenbild, Norden oben
 *   <instanz>.json   Maßstab, Grenzen, Regionen, Fingerabdruck der Weltdatei
 *
 * Der Fingerabdruck ist der Zweck der JSON-Datei: Der Veröffentlichungslauf
 * (tools/weltkarte-veroeffentlichen.mjs) vergleicht ihn mit der Weltdatei und
 * rendert nur neu, wenn sich wirklich etwas geändert hat. Ein Kartenlauf
 * kostet je nach Weltgröße eine halbe bis mehrere Minuten.
 *
 * Lauf:  npx tsx tools/weltkarte-rendern.ts <dev|live> <ziel-verzeichnis> [breite]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { getStableHash, Biome } from '@wov/shared';
import { createGeo } from '@wov/shared/src/worldgen/factory.js';
import {
  sanitizeWorldLayout,
  layoutBounds,
  BIOME_BY_NAME,
} from '@wov/shared/src/worldlayout/index.js';
import { weltDatei } from '@wov/shared/src/instanz.js';
import type { Instanz } from '@wov/shared/src/instanz.js';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const instanz = (process.argv[2] ?? 'dev') as Instanz;
const zielOrdner = process.argv[3] ?? resolve(WURZEL, 'mess/karten');
const BREITE = Number(process.argv[4] ?? 2048);

if (instanz !== 'dev' && instanz !== 'live') {
  throw new Error(`unbekannte Instanz "${instanz}" — erlaubt sind dev und live`);
}

/**
 * Weltgen-Schalter. Fest verdrahtet statt aus server.yml gelesen: Die vier
 * Werte sind dort seit A14 keine Schalter mehr, sondern Konstanten (siehe die
 * Streichungen in server/data/server.yml), und sie stehen genauso in
 * WovServer.ts und im Karten-Worker. Wer sie dort ändert, muss sie hier
 * ändern — dann zeigt die Karte sonst eine andere Welt als der Server.
 */
const WELTGEN = {
  worldGenVersion: 2,
  disableDistantRivers: false,
  riverAffectsOcean: false,
  ashlandsModernNoise: true,
} as const;

/** Wasserspiegel in Metern — dieselbe Schwelle wie shared/test/geo-map.ts. */
const WASSER = 30;

/** Ozeanrand um die Layout-Bbox, in Metern. Wie client/src/main.ts. */
const OZEANRAND = 2000;

type RGB = readonly [number, number, number];

/**
 * Biome-Farben. Absichtlich hier wiederholt statt aus
 * client/src/ui/worldmap/MapPalette.ts importiert: Dieses Werkzeug läuft in
 * Node und soll nicht am Client-Alias-Pfad des Vite-Builds hängen. Die Werte
 * sind identisch mit MapPalette und shared/test/geo-map.ts — wer eine Farbe
 * ändert, ändert sie an allen drei Stellen, sonst färbt die Webkarte die Welt
 * anders ein als die Karte im Spiel.
 */
const BIOME_FARBE: Record<number, RGB> = {
  [Biome.Meadows]: [104, 148, 76],
  [Biome.Swamp]: [62, 72, 58],
  [Biome.Mountain]: [214, 221, 228],
  [Biome.BlackForest]: [38, 66, 32],
  [Biome.Plains]: [170, 164, 92],
  [Biome.AshLands]: [58, 50, 52],
  [Biome.DeepNorth]: [196, 214, 228],
  [Biome.Ocean]: [44, 84, 130],
  [Biome.Mistlands]: [112, 128, 122],
  [Biome.None]: [255, 0, 255],
};

/** Deutsche Namen für die Legende der Webseite. */
const BIOME_NAME: Record<number, string> = {
  [Biome.Meadows]: 'Wiesen',
  [Biome.BlackForest]: 'Schwarzwald',
  [Biome.Swamp]: 'Sumpf',
  [Biome.Mountain]: 'Berge',
  [Biome.Plains]: 'Ebenen',
  [Biome.Mistlands]: 'Nebelland',
  [Biome.AshLands]: 'Aschelande',
  [Biome.DeepNorth]: 'Hochnord',
  [Biome.Ocean]: 'Meer',
};

const hex = (c: RGB): string =>
  '#' + c.map((k) => k.toString(16).padStart(2, '0')).join('');

const TIEFSEE: RGB = [22, 46, 78];
const UFER: RGB = [70, 130, 175];
const FLUSS: RGB = [140, 205, 235];

const klemm = (w: number, a = 0, b = 1): number => (w < a ? a : w > b ? b : w);
const misch = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Wasserfarbe nach Tiefe: je flacher, desto heller Richtung Ufer. */
const wasserfarbe = (hoehe: number): RGB => misch(TIEFSEE, UFER, klemm((hoehe - 5) / 25));

/**
 * Landfarbe: Biom-Grundton, mit der Höhe aufgehellt, und dunkler wo Wald
 * steht. Der Waldanteil ist derselbe Faktor, den auch die Karte im Spiel
 * für ihre Baumsignaturen benutzt (MapPalette.forestDensity) — hier
 * allerdings nur als Tönung, weil einzelne Baumsymbole bei 20 m je
 * Bildpunkt ohnehin zu Matsch würden.
 */
function landfarbe(biome: number, hoehe: number, wald: number): RGB {
  const grund = BIOME_FARBE[biome] ?? BIOME_FARBE[Biome.None];
  const f = 0.74 + 0.26 * klemm((hoehe - WASSER) / 110, -0.5, 1);
  const hell: RGB = [
    Math.min(255, Math.round(grund[0] * f)),
    Math.min(255, Math.round(grund[1] * f)),
    Math.min(255, Math.round(grund[2] * f)),
  ];
  return wald <= 0 ? hell : misch(hell, [Math.round(hell[0] * 0.72), Math.round(hell[1] * 0.8), Math.round(hell[2] * 0.7)], wald);
}

/**
 * Übergang Wasser → Land über eine Spanne von 4 m statt einer harten
 * Schwelle.
 *
 * Ohne diese Weichzeichnung flimmert der Sumpf: Sein Gelände liegt fast genau
 * auf der Wasserlinie, und ein Vergleich `hoehe < WASSER` kippt dort von
 * Bildpunkt zu Bildpunkt zwischen Blau und Grün — auf der Karte ein
 * Rauschteppich statt einer Marsch. Nebenbei werden alle Küsten weicher.
 */
const UEBERGANG = 4;
function faerben(biome: number, hoehe: number, wald: number): RGB {
  if (biome === Biome.Ocean) return wasserfarbe(hoehe);
  const t = klemm((hoehe - (WASSER - UEBERGANG / 2)) / UEBERGANG);
  if (t <= 0) return wasserfarbe(hoehe);
  if (t >= 1) return landfarbe(biome, hoehe, wald);
  return misch(wasserfarbe(hoehe), landfarbe(biome, hoehe, wald), t);
}

/**
 * Schummerung: Hänge, die nach Nordwesten zeigen, werden heller, die
 * Gegenseite dunkler. Ohne sie ist ein Gebirge nur eine weiße Fläche — mit
 * ihr liest man Täler und Grate. Der Faktor bleibt bewusst zahm (±18 %),
 * sonst kippt die Karte ins Reliefbild und die Biome sind nicht mehr
 * unterscheidbar.
 */
function schummern(c: RGB, dhx: number, dhz: number): RGB {
  const n = klemm(0.5 + (dhx + dhz) * 0.06, 0, 1);
  const f = 0.82 + 0.36 * n;
  return [
    Math.min(255, Math.round(c[0] * f)),
    Math.min(255, Math.round(c[1] * f)),
    Math.min(255, Math.round(c[2] * f)),
  ];
}

// ── Welt laden ──────────────────────────────────────────────────────────

const weltPfad = weltDatei(WURZEL, instanz);
const roh = readFileSync(weltPfad, 'utf-8');
const layout = sanitizeWorldLayout(JSON.parse(roh) as unknown);
if (!layout) throw new Error(`${weltPfad}: kein gültiges WorldLayout-Dokument`);

const fingerabdruck = createHash('sha256').update(roh).digest('hex').slice(0, 16);

/**
 * Kartenausschnitt: quadratisch um die MITTE DER BBOX, nicht um den
 * Ursprung.
 *
 * Das Spiel rechnet anders (client/src/main.ts: halb = größter Betrag einer
 * Bbox-Ecke + Ozeanrand, also immer um 0/0 zentriert), weil seine Karte eine
 * Scheibe um den Spieler ist. Für eine Webseite ist das die falsche Wahl: Die
 * Dev-Welt liegt komplett im Quadranten unten links, ein um den Ursprung
 * zentriertes Bild wäre zu zwei Dritteln leeres Meer. Hier wird deshalb der
 * Inhalt gerahmt.
 *
 * Der Betrachter auf der Webseite rechnet Weltkoordinaten aus `grenzen` der
 * Beschreibungsdatei zurück — er hängt nicht an dieser Formel.
 */
const b = layoutBounds(layout);
const mitteX = (b.minX + b.maxX) / 2;
const mitteZ = (b.minZ + b.maxZ) / 2;
const halb = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + OZEANRAND;
const span = halb * 2;
const meterProPunkt = span / BREITE;
const linksX = mitteX - halb;
const obenZ = mitteZ + halb;

console.log(
  `[Karte] ${instanz}: "${layout.name}" · ${layout.regions.length} Regionen · ` +
    `${(span / 1000).toFixed(1)} km Kante · ${BREITE}px (${meterProPunkt.toFixed(1)} m/px)`
);

const geo = createGeo({
  mode: 'layout',
  worldSeed: getStableHash(layout.detailSeed),
  layout: JSON.parse(roh) as unknown,
  settings: { ...WELTGEN },
});

// ── Rastern ─────────────────────────────────────────────────────────────

/*
  Zwei Durchgänge. Der erste tastet die Welt ab, der zweite färbt. Getrennt,
  weil die Schummerung die Höhe der NACHBARN braucht — in einem Durchgang
  müsste jeder Punkt drei- bis fünfmal abgetastet werden, und eine Abtastung
  ist der teure Teil (mehrere fBm-Oktaven je Punkt).
*/
const hoehen = new Float32Array(BREITE * BREITE);
const biome = new Uint16Array(BREITE * BREITE);
const waelder = new Float32Array(BREITE * BREITE);
const t0 = Date.now();

/** Waldanteil 0…1 — Schwelle und Kurve wie MapPalette.forestDensity. */
const FOREST_THRESHOLD = 1.15;
const waldAnteil = (faktor: number): number => klemm((FOREST_THRESHOLD - faktor) / 0.45);

for (let zeile = 0; zeile < BREITE; zeile++) {
  // Norden oben: die oberste Bildzeile ist das größte z.
  const wz = obenZ - (zeile + 0.5) * meterProPunkt;
  for (let spalte = 0; spalte < BREITE; spalte++) {
    const wx = linksX + (spalte + 0.5) * meterProPunkt;
    const i = zeile * BREITE + spalte;
    biome[i] = geo.getBiome(wx, wz);
    hoehen[i] = geo.getHeight(wx, wz);
    waelder[i] = hoehen[i] < WASSER ? 0 : waldAnteil(geo.getForestFactor(wx, wz));
  }
  if ((zeile & 255) === 0) {
    process.stdout.write(`\r[Karte] abgetastet ${((zeile / BREITE) * 100).toFixed(0)} %   `);
  }
}
process.stdout.write(`\r[Karte] abgetastet in ${((Date.now() - t0) / 1000).toFixed(1)} s   \n`);

const bild = Buffer.alloc(BREITE * BREITE * 3);
for (let zeile = 0; zeile < BREITE; zeile++) {
  for (let spalte = 0; spalte < BREITE; spalte++) {
    const i = zeile * BREITE + spalte;
    const h = hoehen[i];
    let c = faerben(biome[i], h, waelder[i]);
    // Schummerung nur an Land — auf dem Wasser wäre sie Rauschen.
    if (h >= WASSER && spalte > 0 && zeile > 0) {
      c = schummern(c, h - hoehen[i - 1], h - hoehen[i - BREITE]);
    }
    const p = i * 3;
    bild[p] = c[0];
    bild[p + 1] = c[1];
    bild[p + 2] = c[2];
  }
}

// ── Flüsse ──────────────────────────────────────────────────────────────

/**
 * Das Flussnetz von GeoManager deckt die klassische Radialwelt ab. In einer
 * Layout-Welt liegt der größte Teil davon im offenen Ozean, wo er nichts
 * verloren hat — deshalb werden nur Punkte gezeichnet, die tatsächlich auf
 * Land liegen. Ohne diese Prüfung zöge die Karte helle Fäden quer durchs Meer.
 */
function punkt(x: number, z: number): [number, number] {
  return [(x - linksX) / meterProPunkt, (obenZ - z) / meterProPunkt];
}
function mischen(px: number, py: number, c: RGB, a: number): void {
  if (px < 0 || py < 0 || px >= BREITE || py >= BREITE) return;
  const i = (py * BREITE + px) * 3;
  bild[i] = Math.round(bild[i] * (1 - a) + c[0] * a);
  bild[i + 1] = Math.round(bild[i + 1] * (1 - a) + c[1] * a);
  bild[i + 2] = Math.round(bild[i + 2] * (1 - a) + c[2] * a);
}

let flussPunkte = 0;
for (const kette of geo.riverPointMap.values()) {
  for (const p of kette) {
    if (geo.getHeight(p.px, p.py) < WASSER) continue;
    const [cx, cy] = punkt(p.px, p.py);
    const r = Math.max(0.6, (p.w * 0.55) / meterProPunkt);
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        if (Math.hypot(dx, dy) <= r) mischen(Math.round(cx) + dx, Math.round(cy) + dy, FLUSS, 0.65);
      }
    }
    flussPunkte++;
  }
}
console.log(`[Karte] ${flussPunkte} Flusspunkte auf Land gezeichnet`);

// ── Schreiben ───────────────────────────────────────────────────────────

mkdirSync(zielOrdner, { recursive: true });

const bildDatei = join(zielOrdner, `${instanz}.webp`);

/**
 * Regionen als Marken für den Betrachter. Nur Mittelpunkt und Biom — die
 * genaue Form gehört ins Bild, nicht in die Beschreibungsdatei; sie wäre bei
 * Polygonen schnell größer als die Karte selbst.
 */
const regionen = layout.regions.map((r) => {
  /*
    `id` ist ein Arbeitsname aus dem Editor ("insel-10") und taugt nicht als
    Beschriftung auf einer Seite für Besucher. Deshalb wandert der deutsche
    Biomname mit — den zeigt die Karte an, die id bleibt für Fehlersuche und
    Verlinkung dabei.
  */
  const bit = BIOME_BY_NAME.get(r.biome);
  const gemeinsam = {
    id: r.id,
    biome: r.biome,
    name: bit === undefined ? r.biome : (BIOME_NAME[bit] ?? r.biome),
  };
  const s = r.shape;
  if (s.kind === 'circle') return { ...gemeinsam, x: s.x, z: s.z, radius: s.radius };
  let sx = 0;
  let sz = 0;
  for (const [px, pz] of s.points) {
    sx += px;
    sz += pz;
  }
  const n = Math.max(1, s.points.length);
  return { ...gemeinsam, x: sx / n, z: sz / n, radius: null };
});

/**
 * Legende: nur die Biome, die in dieser Welt wirklich vorkommen — plus Meer,
 * das keine Region ist, aber jede Karte füllt. Eine feste Liste aller acht
 * Biome würde auf der Webseite Landschaften versprechen, die es hier nicht
 * gibt.
 */
const vorhanden = new Set(layout.regions.map((r) => r.biome));
const legende = [...vorhanden]
  .map((name) => BIOME_BY_NAME.get(name))
  .filter((bit): bit is Biome => bit !== undefined)
  .map((bit) => ({ bit, name: BIOME_NAME[bit] ?? String(bit), farbe: hex(BIOME_FARBE[bit]) }));
legende.push({ bit: Biome.Ocean, name: BIOME_NAME[Biome.Ocean], farbe: hex(BIOME_FARBE[Biome.Ocean]) });

const beschreibung = {
  instanz,
  name: layout.name,
  detailSeed: layout.detailSeed,
  fingerabdruck,
  gerendert: new Date().toISOString(),
  bild: `${instanz}.webp`,
  breite: BREITE,
  spanneMeter: span,
  meterProPunkt,
  /** Weltkoordinaten der Bildecken: links/oben und rechts/unten. */
  grenzen: { minX: linksX, maxZ: obenZ, maxX: linksX + span, minZ: obenZ - span },
  bbox: b,
  kontinente: layout.continents.map((k) => ({
    id: k.id,
    name: k.name,
    faction: k.faction ?? null,
    spawn: k.spawn ?? null,
  })),
  regionen,
  legende,
};

writeFileSync(join(zielOrdner, `${instanz}.json`), JSON.stringify(beschreibung, null, 2));
console.log(`[Karte] geschrieben: ${join(zielOrdner, `${instanz}.json`)}`);

/*
  Kein top-level await: tools/ wird von tsx als CJS übersetzt (die Wurzel-
  package.json hat kein "type": "module"), und dort ist es ein Syntaxfehler.
  Deshalb die Kette am Ende statt eines await weiter oben.
*/
sharp(bild, { raw: { width: BREITE, height: BREITE, channels: 3 } })
  .webp({ quality: 90, effort: 5 })
  .toFile(bildDatei)
  .then((info) => {
    console.log(`[Karte] geschrieben: ${bildDatei} (${(info.size / 1024).toFixed(0)} KB)`);
  })
  .catch((fehler: unknown) => {
    console.error('[Karte] Bild konnte nicht geschrieben werden:', fehler);
    process.exit(1);
  });
