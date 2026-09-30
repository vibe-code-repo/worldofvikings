/**
 * Wetterdefinitionen je Biom — Daten statt Code (F9).
 *
 * Die Tabellen, aus denen der Wetterwürfel zieht, standen bis heute in
 * `envData.json` (Auszug des Vorbilds) und waren nur für den Client lesbar.
 * Hier stehen sie als eigene Datei (`shared/data/wetter/biome.json`), die
 * der Server liest, prüft und würfelt. Ein Editor kann sie lesen und
 * schreiben, ohne Code zu kennen: Die Datei ist reines JSON, `pruefe…`
 * meldet jeden Fehler als Text.
 *
 * ── Aufbau ────────────────────────────────────────────────────────────
 * `zustaende`: die Wetterzustände, die es gibt. Eine Zeile je Zustand:
 *   `id` (Name in den Biomlisten), `umgebung` (Name der Umgebung, die der
 *   Client darstellt, siehe environment.ts) und `textKey` (Übersetzungs-
 *   schlüssel des Anzeigenamens in shared/data/texte/{de,en}.json).
 * `biome`: je Biom eine Liste `zustaende` mit
 *   `gewicht` (Zug-Gewicht), `fensterMin`/`fensterMax` (wie viele
 *   666-s-Fenster der Zustand hält, ganze Zahlen ab 1), optional
 *   `tageszeit` ({von, bis} als Bruchteil des Tages 0..1, über Mitternacht
 *   erlaubt: von > bis) und die beiden Ashlands-/DeepNorth-Schalter des
 *   Vorbilds.
 *
 * ── Der Würfel ────────────────────────────────────────────────────────
 * Reproduzierbar: Ein „Lauf“ beginnt bei Fenster k, der Zufall ist
 * `XorShiftRandom(k)`, der erste Zug wählt den Zustand (gleicher Ablauf wie
 * `selectWeather`), ein zweiter die Dauer. Sind alle Dauern 1 — so liefert
 * die mitgelieferte Datei — ist jedes Fenster ein Lauf und das Ergebnis
 * BITGLEICH zu `selectWeather`; das prüft `server/test/wetter-server.ts`.
 */

import envData from './envData.json';
import biomeDaten from '../data/wetter/biome.json';
import { findEnvironment, environmentForBiome } from './environment.js';
import { Biome } from './types.js';
import { XorShiftRandom } from './worldgen/Random.js';
import { ENVIRONMENT_DURATION, resolveBiomeBit, weatherPeriod, type WeatherOptions } from './weather.js';

export interface WetterTageszeit {
  /** Bruchteil des Tages 0..1, ab dem der Zustand gezogen werden darf. */
  von: number;
  /** Bruchteil des Tages 0..1, bis (ausschliesslich); `von > bis` reicht über Mitternacht. */
  bis: number;
}

export interface WetterZustandInfo {
  id: string;
  umgebung: string;
  textKey: string;
}

export interface WetterEintrag {
  zustand: string;
  gewicht: number;
  fensterMin: number;
  fensterMax: number;
  tageszeit?: WetterTageszeit;
  ashlandsOverride?: boolean;
  deepnorthOverride?: boolean;
}

export interface WetterBiom {
  /** Name aus `Biome` (Meadows, BlackForest, …). */
  biom: string;
  zustaende: WetterEintrag[];
}

export interface WetterDefinitionen {
  version: 1;
  zustaende: WetterZustandInfo[];
  biome: WetterBiom[];
}

/** Obergrenze für `fensterMax`: 1000 Fenster sind rund 7,7 Tage Weltzeit am Stück. */
export const WETTER_FENSTER_MAX = 1000;

const DAY_LENGTH_SEC = (envData as { timing?: { dayLengthSec?: number } }).timing?.dayLengthSec ?? 1800;

function biomBit(name: string): Biome | null {
  const wert = (Biome as unknown as Record<string, unknown>)[name];
  return typeof wert === 'number' && wert !== Biome.None ? wert : null;
}

export type WetterPruefung = { ok: true; defs: WetterDefinitionen } | { ok: false; fehler: string[] };

function istObjekt(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Prüft eine Definitionsdatei und liefert sie in fester Form zurück. Jeder
 * Fehler kommt als eigener Satz mit Pfad in die Liste, damit eine Maske ihn
 * an der Stelle anzeigen kann; es wird nichts stillschweigend korrigiert.
 */
export function pruefeWetterDefinitionen(roh: unknown): WetterPruefung {
  const fehler: string[] = [];
  if (!istObjekt(roh)) return { ok: false, fehler: ['Die Wetterdefinition ist kein Objekt'] };
  if (roh.version !== 1) fehler.push(`version: 1 erwartet, gefunden ${JSON.stringify(roh.version)}`);

  const zustaende: WetterZustandInfo[] = [];
  const ids = new Set<string>();
  if (!Array.isArray(roh.zustaende)) fehler.push('zustaende: Liste erwartet');
  else {
    roh.zustaende.forEach((z: unknown, i: number) => {
      const wo = `zustaende[${i}]`;
      if (!istObjekt(z)) return void fehler.push(`${wo}: Objekt erwartet`);
      const { id, umgebung, textKey } = z;
      if (typeof id !== 'string' || id === '') return void fehler.push(`${wo}.id: Text erwartet`);
      if (ids.has(id)) fehler.push(`${wo}.id: "${id}" kommt doppelt vor`);
      ids.add(id);
      if (typeof umgebung !== 'string' || !findEnvironment(umgebung)) {
        fehler.push(`${wo}.umgebung: unbekannte Umgebung ${JSON.stringify(umgebung)}`);
      }
      if (typeof textKey !== 'string' || textKey === '')
        fehler.push(`${wo}.textKey: Übersetzungsschlüssel erwartet`);
      if (typeof umgebung === 'string' && typeof textKey === 'string')
        zustaende.push({ id, umgebung, textKey });
    });
  }

  const biome: WetterBiom[] = [];
  const gesehen = new Set<string>();
  if (!Array.isArray(roh.biome)) fehler.push('biome: Liste erwartet');
  else {
    roh.biome.forEach((b: unknown, i: number) => {
      const wo = `biome[${i}]`;
      if (!istObjekt(b)) return void fehler.push(`${wo}: Objekt erwartet`);
      const name = b.biom;
      if (typeof name !== 'string' || biomBit(name) === null) {
        return void fehler.push(`${wo}.biom: unbekanntes Biom ${JSON.stringify(name)}`);
      }
      if (gesehen.has(name)) fehler.push(`${wo}.biom: "${name}" kommt doppelt vor`);
      gesehen.add(name);
      if (!Array.isArray(b.zustaende) || b.zustaende.length === 0) {
        return void fehler.push(`${wo}.zustaende: nicht-leere Liste erwartet`);
      }
      const eintraege: WetterEintrag[] = [];
      let gesamt = 0;
      b.zustaende.forEach((e: unknown, j: number) => {
        const ew = `${wo}.zustaende[${j}]`;
        if (!istObjekt(e)) return void fehler.push(`${ew}: Objekt erwartet`);
        if (typeof e.zustand !== 'string' || !ids.has(e.zustand)) {
          return void fehler.push(`${ew}.zustand: ${JSON.stringify(e.zustand)} steht nicht unter zustaende`);
        }
        const gewicht = e.gewicht;
        if (typeof gewicht !== 'number' || !Number.isFinite(gewicht) || gewicht < 0) {
          return void fehler.push(`${ew}.gewicht: Zahl >= 0 erwartet`);
        }
        const min = e.fensterMin ?? 1;
        const max = e.fensterMax ?? min;
        if (
          !Number.isInteger(min) ||
          !Number.isInteger(max) ||
          (min as number) < 1 ||
          (max as number) > WETTER_FENSTER_MAX ||
          (min as number) > (max as number)
        ) {
          return void fehler.push(
            `${ew}: fensterMin/fensterMax müssen ganze Zahlen 1 <= min <= max <= ${WETTER_FENSTER_MAX} sein`,
          );
        }
        const eintrag: WetterEintrag = {
          zustand: e.zustand,
          gewicht,
          fensterMin: min as number,
          fensterMax: max as number,
        };
        if (e.tageszeit !== undefined) {
          const t = e.tageszeit;
          if (
            !istObjekt(t) ||
            typeof t.von !== 'number' ||
            typeof t.bis !== 'number' ||
            !(t.von >= 0 && t.von <= 1 && t.bis >= 0 && t.bis <= 1) ||
            t.von === t.bis
          ) {
            return void fehler.push(`${ew}.tageszeit: {von, bis} mit Werten 0..1, von != bis erwartet`);
          }
          eintrag.tageszeit = { von: t.von, bis: t.bis };
        }
        if (e.ashlandsOverride === true) eintrag.ashlandsOverride = true;
        if (e.deepnorthOverride === true) eintrag.deepnorthOverride = true;
        if (!eintrag.ashlandsOverride && !eintrag.deepnorthOverride) gesamt += gewicht;
        eintraege.push(eintrag);
      });
      if (gesamt <= 0) fehler.push(`${wo}.zustaende: die Gewichte der ziehbaren Zustände ergeben 0`);
      biome.push({ biom: name, zustaende: eintraege });
    });
  }
  return fehler.length > 0 ? { ok: false, fehler } : { ok: true, defs: { version: 1, zustaende, biome } };
}

/** Die mitgelieferten Definitionen — die heutigen Tabellen 1:1. */
export const STANDARD_WETTER_DEFINITIONEN: WetterDefinitionen = (() => {
  const p = pruefeWetterDefinitionen(biomeDaten);
  if (!p.ok) throw new Error(`shared/data/wetter/biome.json ist ungueltig: ${p.fehler.join('; ')}`);
  return p.defs;
})();

/** Ergebnis eines Zugs. */
export interface WetterErgebnis {
  /** Zustands-Id (Schlüssel in `zustaende`). */
  zustand: string;
  /** Umgebung, die der Client darstellt. */
  umgebung: string;
  /** Wetterfenster der Weltzeit (`weatherPeriod`). */
  fenster: number;
}

function imTageszeitFenster(t: WetterTageszeit | undefined, timeSec: number): boolean {
  if (!t) return true;
  const tag = (((timeSec % DAY_LENGTH_SEC) + DAY_LENGTH_SEC) % DAY_LENGTH_SEC) / DAY_LENGTH_SEC;
  return t.von < t.bis ? tag >= t.von && tag < t.bis : tag >= t.von || tag < t.bis;
}

interface Lauf {
  /** Erstes Fenster des Laufs und die Zahl seiner Fenster. */
  start: number;
  laenge: number;
  zustand: string | null;
}

/**
 * Zieht das Wetter je Biom und Fenster aus den Definitionen. Zustandslos im
 * Ergebnis (gleiche Eingabe, gleiche Antwort), der Speicher hält nur bereits
 * berechnete Läufe.
 */
export class WetterWuerfel {
  private readonly biome = new Map<Biome, WetterEintrag[]>();
  private readonly infos = new Map<string, WetterZustandInfo>();
  /** Läufe je Biom, aufsteigend, lückenlos ab Fenster 0 (nur für Biome mit Dauer > 1). */
  private readonly laeufe = new Map<Biome, Lauf[]>();

  constructor(readonly defs: WetterDefinitionen = STANDARD_WETTER_DEFINITIONEN) {
    for (const z of defs.zustaende) this.infos.set(z.id, z);
    for (const b of defs.biome) {
      const bit = biomBit(b.biom);
      if (bit !== null) this.biome.set(bit, b.zustaende);
    }
  }

  info(id: string): WetterZustandInfo | undefined {
    return this.infos.get(id);
  }

  /** Alle Zustands-Ids, für Admin-Befehl und Editor. */
  zustandsIds(): string[] {
    return this.defs.zustaende.map((z) => z.id);
  }

  private zieheLauf(eintraege: readonly WetterEintrag[], start: number): Lauf {
    const rng = new XorShiftRandom(start | 0);
    const startSec = start * ENVIRONMENT_DURATION;
    const kandidaten = eintraege.filter((e) => imTageszeitFenster(e.tageszeit, startSec));
    let total = 0;
    for (const e of kandidaten) if (!e.ashlandsOverride && !e.deepnorthOverride) total += e.gewicht;
    let gewaehlt: WetterEintrag | null = null;
    if (total > 0) {
      const roll = rng.rangeFloat(0, total);
      let acc = 0;
      for (const e of kandidaten) {
        if (e.ashlandsOverride || e.deepnorthOverride) continue;
        acc += e.gewicht;
        if (acc >= roll) {
          gewaehlt = e;
          break;
        }
      }
      if (!gewaehlt) {
        const letzter = kandidaten[kandidaten.length - 1];
        gewaehlt = letzter.ashlandsOverride || letzter.deepnorthOverride ? null : letzter;
      }
    }
    let laenge = 1;
    if (gewaehlt && gewaehlt.fensterMax > gewaehlt.fensterMin) {
      laenge =
        gewaehlt.fensterMin + Math.floor(rng.nextFloat() * (gewaehlt.fensterMax - gewaehlt.fensterMin + 1));
    } else if (gewaehlt) {
      laenge = gewaehlt.fensterMin;
    }
    return { start, laenge, zustand: gewaehlt?.zustand ?? null };
  }

  /** Lauf, der das Fenster `n` enthält. */
  private laufBei(bit: Biome, eintraege: readonly WetterEintrag[], n: number): Lauf {
    // Läufe beginnen bei Fenster 0; vor der Weltzeit 0 gibt es keine, jedes Fenster ist ein eigener Lauf.
    if (n < 0 || eintraege.every((e) => e.fensterMin === 1 && e.fensterMax === 1)) return this.zieheLauf(eintraege, n);
    let liste = this.laeufe.get(bit);
    if (!liste) this.laeufe.set(bit, (liste = []));
    let naechster = liste.length > 0 ? liste[liste.length - 1].start + liste[liste.length - 1].laenge : 0;
    while (naechster <= n) {
      const lauf = this.zieheLauf(eintraege, naechster);
      liste.push(lauf);
      naechster += lauf.laenge;
    }
    let lo = 0;
    let hi = liste.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (liste[mid].start <= n) lo = mid;
      else hi = mid - 1;
    }
    return liste[lo];
  }

  /**
   * Das Wetter eines Bioms zur Weltzeit. Ohne Eintrag für das Biom (oder
   * ohne ziehbaren Zustand) gilt wie bisher die Standard-Umgebung des Bioms.
   */
  wetterFuer(biome: Biome, timeSec: number, opts: WeatherOptions = {}): WetterErgebnis {
    const fenster = weatherPeriod(timeSec);
    const bit = resolveBiomeBit(biome);
    const eintraege = bit === null ? undefined : this.biome.get(bit);
    let zustand: string | null = null;
    if (bit !== null && eintraege && eintraege.length > 0) {
      zustand = this.laufBei(bit, eintraege, fenster).zustand;
      // Die Ashlands-/DeepNorth-Einträge ersetzen den Zug, wenn der Spieler dort ist.
      for (const e of eintraege) {
        if (e.ashlandsOverride && opts.ashlands) zustand = e.zustand;
        if (e.deepnorthOverride && opts.deepnorth) zustand = e.zustand;
      }
    }
    const info = zustand === null ? undefined : this.infos.get(zustand);
    if (info) return { zustand: info.id, umgebung: info.umgebung, fenster };
    const standard = environmentForBiome(biome);
    return { zustand: standard.name, umgebung: standard.name, fenster };
  }
}

/** Übersetzungsschlüssel des Anzeigenamens, oder `null` bei einer Umgebung ohne Zustandseintrag. */
export function wetterTextKey(defs: WetterDefinitionen, id: string): string | null {
  return defs.zustaende.find((z) => z.id === id)?.textKey ?? null;
}
