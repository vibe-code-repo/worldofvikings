/**
 * map_render ohne GPU: Gelände über die Geo-Abfrage und die Farbregel des
 * Editors (`farbe` aus kartenKacheln), Ebenen aus shared/src/weltbau/karte.
 * Das Gelände wird je Bildpunkt (Pixelmitte) abgefragt, das ist bei 1024² so
 * teuer wie 16 Kacheln und bildet jeden Ausschnitt ohne Kachelgrenzen ab.
 *
 * Diese Datei kennt weder MCP noch Netz: `rendereKarte` bekommt ein geladenes
 * Layout und liefert PNG-Bytes samt Kennzahlen. Registriert wird sie in
 * werkzeuge/sehen.ts.
 */
import { createHash } from 'node:crypto';
import {
  Biome,
  WATER_LEVEL,
  createGeo,
  getStableHash,
  layoutBounds,
  type IGeo,
  type PlacementDef,
  type WorldLayout,
} from '@wov/shared';
import { farbe } from '@wov/client/src/ui/worldmap/kartenKacheln.js';
import { forestDensity } from '@wov/client/src/ui/worldmap/MapPalette.js';
import { Leinwand } from '@wov/shared/src/weltbau/zeichnen.js';
import {
  KARTEN_EBENEN,
  KARTEN_EBENEN_VORGABE,
  KARTE_BEFUNDE_KANTE_MAX,
  ansichtAus,
  bildZuWeltX,
  bildZuWeltZ,
  zeichneEbenen,
  type Ansicht,
  type Grundflaeche,
  type KartenBefund,
  type KartenBereich,
  type KartenEbene,
  type KartenObjekt,
} from '@wov/shared/src/weltbau/karte.js';
import { kodierePng } from './png.js';

/**
 * Bringt world_check-Befunde in zeichenbare Form: nur rot/gelb mit endlicher
 * Koordinate. Alles andere (Art „frist“/„hinweis“, Befund ohne Koordinate) wird nicht
 * gezeichnet und nur gezählt — nie ein Absturz.
 */
export function zeichenbareBefunde(roh: readonly unknown[]): { befunde: KartenBefund[]; uebersprungen: number } {
  const befunde: KartenBefund[] = [];
  let uebersprungen = 0;
  for (const b of roh) {
    const o = (typeof b === 'object' && b !== null ? b : {}) as Record<string, unknown>;
    const { schwere, x, z } = o;
    // Art "frist" (Teilbericht) sitzt auf der Bereichsmitte und ist keine Fundstelle: nie zeichnen.
    if (
      o.pruefung !== 'frist' &&
      (schwere === 'rot' || schwere === 'gelb') &&
      typeof x === 'number' &&
      typeof z === 'number' &&
      Number.isFinite(x) &&
      Number.isFinite(z)
    ) {
      befunde.push({ schwere, x, z });
    } else uebersprungen++;
  }
  return { befunde, uebersprungen };
}

/** Harte Laufzeitgrenze für das Geländebild; danach Abbruch mit Meldung. */
export const KARTE_FRIST_MS = 15_000;

export interface KartenAnfrage {
  bereich: KartenBereich;
  pixel?: number;
  ebenen?: readonly string[];
  /** Ergebnis von world_check (nur die Ampel-Punkte), wird nur mit Ebene `befunde` gezeichnet. */
  befunde?: readonly unknown[];
  /** Grundfläche und Festigkeit je Prefab-Name; ohne Angabe zeichnet die Karte Punkte. */
  flaeche?: (prefab: string) => { flaeche: Grundflaeche; fest: boolean } | undefined;
}

export interface KartenErgebnis {
  png: Buffer;
  breite: number;
  hoehe: number;
  ansicht: Ansicht;
  ebenen: KartenEbene[];
  /** Anteil der Bildpunkte, die Wasser sind (Ozean-Biom oder unter dem Pegel), 0..1. */
  wasserAnteil: number;
  objekteGezeichnet: number;
  hinweise: string[];
  ms: number;
  text: string;
}

// Die Geo wird je Dokument-Stand einmal gebaut und gehalten (höchstens eine Instanz).
let geoSchluessel = '';
let geoInstanz: IGeo | null = null;

function geoFuer(layout: WorldLayout): IGeo {
  const schluessel = createHash('sha1').update(JSON.stringify(layout)).digest('hex');
  if (geoInstanz && schluessel === geoSchluessel) return geoInstanz;
  geoInstanz = createGeo({ mode: 'layout', worldSeed: getStableHash(layout.detailSeed), layout });
  geoSchluessel = schluessel;
  return geoInstanz;
}

/** Bereich der ganzen Welt (Bounding-Box aller Regionen mit 5 % Rand, quadratisch). */
export function weltBereich(layout: WorldLayout): KartenBereich {
  const b = layoutBounds(layout);
  const kante = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 1.05;
  const mx = (b.minX + b.maxX) / 2;
  const mz = (b.minZ + b.maxZ) / 2;
  return { minX: mx - kante / 2, minZ: mz - kante / 2, maxX: mx + kante / 2, maxZ: mz + kante / 2 };
}

/** Gelände in die Leinwand malen; liefert den Wasseranteil. */
function gelaendeMalen(geo: IGeo, a: Ansicht, l: Leinwand, start: number): number {
  const d = l.daten;
  let wasser = 0;
  for (let j = 0; j < a.hoehe; j++) {
    if (performance.now() - start > KARTE_FRIST_MS) {
      throw new Error(`Zeitgrenze ${KARTE_FRIST_MS} ms überschritten: bereich verkleinern oder pixel senken.`);
    }
    const wz = bildZuWeltZ(a, j + 0.5);
    for (let i = 0; i < a.breite; i++) {
      const wx = bildZuWeltX(a, i + 0.5);
      const biome = geo.getBiome(wx, wz);
      const h = geo.getBiomeHeight(biome, wx, wz).height;
      const wald = forestDensity(geo.getForestFactor(wx, wz));
      const o = (j * a.breite + i) * 4;
      const nass = biome === Biome.Ocean || h < WATER_LEVEL;
      if (nass) wasser++;
      farbe(biome, h, nass ? 0 : wald, d, o);
      d[o + 3] = 255;
    }
  }
  return wasser / (a.breite * a.hoehe);
}

function objekteFuer(
  platzierungen: readonly PlacementDef[],
  a: Ansicht,
  flaeche: KartenAnfrage['flaeche']
): KartenObjekt[] {
  const x1 = a.x0 + a.breite * a.meterProPx;
  const z1 = a.z0 + a.hoehe * a.meterProPx;
  const aussen = 200; // Rand in Metern: große Grundflächen ragen herein
  const out: KartenObjekt[] = [];
  for (const p of platzierungen) {
    if (p.x < a.x0 - aussen || p.x > x1 + aussen || p.z < a.z0 - aussen || p.z > z1 + aussen) continue;
    const f = flaeche?.(p.prefab);
    const s = p.scale ?? 1;
    const skaliert: Grundflaeche | undefined = f
      ? f.flaeche.art === 'rechteck'
        ? { art: 'rechteck', halbX: f.flaeche.halbX * s, halbZ: f.flaeche.halbZ * s }
        : { art: 'kreis', radius: f.flaeche.radius * s }
      : undefined;
    out.push({ id: p.id, x: p.x, z: p.z, yaw: p.yaw, flaeche: skaliert, fest: f?.fest });
  }
  return out;
}

export function rendereKarte(layout: WorldLayout, anfrage: KartenAnfrage): KartenErgebnis {
  const start = performance.now();
  const pixel = anfrage.pixel ?? 512;
  const a = ansichtAus(anfrage.bereich, pixel);
  const hinweise: string[] = [];

  const gewuenscht = anfrage.ebenen && anfrage.ebenen.length > 0 ? anfrage.ebenen : KARTEN_EBENEN_VORGABE;
  const unbekannt = gewuenscht.filter((e) => !(KARTEN_EBENEN as readonly string[]).includes(e));
  if (unbekannt.length > 0) {
    throw new Error(`unbekannte Ebene(n): ${unbekannt.join(', ')}. Erlaubt: ${KARTEN_EBENEN.join(', ')}.`);
  }
  const ebenen = new Set(gewuenscht as KartenEbene[]);

  const kante = Math.max(a.breite, a.hoehe) * a.meterProPx;
  if (ebenen.has('befunde') && kante > KARTE_BEFUNDE_KANTE_MAX) {
    ebenen.delete('befunde');
    hinweise.push(`Ebene befunde weggelassen: Bereich ${Math.round(kante)} m > ${KARTE_BEFUNDE_KANTE_MAX} m (world_check-Grenze).`);
  }
  if (ebenen.has('befunde') && !anfrage.befunde) {
    hinweise.push('Ebene befunde ohne Befunde-Eingabe: nichts zu zeichnen (erst world_check aufrufen).');
  }

  const zb = anfrage.befunde ? zeichenbareBefunde(anfrage.befunde) : undefined;
  if (ebenen.has('befunde') && zb && zb.uebersprungen > 0) {
    hinweise.push(`${zb.uebersprungen} Befund(e) ohne Farbe/Koordinate nicht gezeichnet.`);
  }

  const l = new Leinwand(a.breite, a.hoehe);
  let wasserAnteil = 0;
  if (ebenen.has('gelaende')) {
    wasserAnteil = gelaendeMalen(geoFuer(layout), a, l, start);
  } else {
    for (let i = 0; i < l.daten.length; i += 4) {
      l.daten[i] = l.daten[i + 1] = l.daten[i + 2] = 40;
      l.daten[i + 3] = 255;
    }
  }

  const objekte = ebenen.has('platzierungen') ? objekteFuer(layout.placements ?? [], a, anfrage.flaeche) : [];
  zeichneEbenen(l, a, ebenen, {
    objekte,
    routen: layout.routes,
    regionen: layout.regions,
    fluesse: layout.rivers,
    seen: layout.lakes,
    befunde: zb?.befunde,
  });

  const png = kodierePng(a.breite, a.hoehe, l.daten);
  const ms = Math.round(performance.now() - start);
  const eck = `(${Math.round(a.x0)}, ${Math.round(a.z0)})`;
  const text =
    `map_render: ${a.breite}×${a.hoehe} px, ${a.meterProPx.toFixed(2)} m/px, oben links ${eck}, ` +
    `Ebenen ${[...ebenen].join('+')}, ${objekte.length} Objekte, ${png.length} Bytes, ${ms} ms. ` +
    'Achsen: x nach rechts, z nach unten. Legende: dunkel = fester Körper, hell = durchlässig, orange = Route, ' +
    'rot/gelb Kreuz = Befund, blau = Fluss/See.' +
    (hinweise.length > 0 ? `\nHinweise: ${hinweise.join(' ')}` : '');
  return { png, breite: a.breite, hoehe: a.hoehe, ansicht: a, ebenen: [...ebenen], wasserAnteil, objekteGezeichnet: objekte.length, hinweise, ms, text };
}
