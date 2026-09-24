/**
 * diff.ts — Unterschied zweier WorldLayout-Dokumente (world_diff).
 *
 * Vergleich je Sammlung über die `id`, in kanonischer Form (Schlüssel
 * sortiert, damit die Feldreihenfolge nichts ausmacht). „verschoben“ ist eine
 * Platzierung, bei der sich NUR `x`, `z` oder `yaw` geändert haben; sie zählt
 * nicht zusätzlich als „geändert“. „Geo“ heißt: das Gelände ändert sich
 * (Regionen, Flüsse, Seen, Kontinente, oder `einebnen` einer Platzierung) —
 * das wirkt erst nach einem Neustart des Spielservers.
 *
 * Difference of two WorldLayout documents: per-collection compare by id.
 */
import type { WorldLayout } from '../worldlayout/types.js';
import { DIFF_EINTRAEGE_MAX } from './grenzen.js';

export type Sammlung = 'placements' | 'regions' | 'routes' | 'rivers' | 'lakes' | 'continents' | 'defaultSpawn';
export type DiffArt = 'neu' | 'geaendert' | 'entfernt' | 'verschoben';

export interface DiffEintrag {
  sammlung: Sammlung;
  id: string;
  art: DiffArt;
  /** Bei `geaendert`: die Namen der geänderten Felder. */
  felder?: string[];
  /** Bei `verschoben`. */
  von?: { x: number; z: number; yaw: number };
  nach?: { x: number; z: number; yaw: number };
}

export interface DiffZaehler {
  neu: number;
  geaendert: number;
  entfernt: number;
  verschoben: number;
}

export interface DiffErgebnis {
  zaehler: DiffZaehler;
  /** Ändert der Unterschied das Gelände (Wirkung erst nach Neustart)? */
  geo: boolean;
  je: Record<Sammlung, DiffZaehler>;
  eintraege: DiffEintrag[];
  /** Wie viele Einträge wegen der Ausgabegrenze fehlen. */
  ausgelassen: number;
  text: string;
}

const SAMMLUNGEN: readonly Exclude<Sammlung, 'defaultSpawn'>[] = [
  'placements',
  'regions',
  'routes',
  'rivers',
  'lakes',
  'continents',
];
const GEO_SAMMLUNGEN: ReadonlySet<Sammlung> = new Set<Sammlung>(['regions', 'rivers', 'lakes', 'continents']);
const BEWEGUNG = new Set(['x', 'z', 'yaw']);

/** JSON mit sortierten Schlüsseln; `undefined`-Felder fallen weg wie beim Speichern. */
function kanonisch(wert: unknown): string {
  if (wert === null || typeof wert !== 'object') return JSON.stringify(wert) ?? 'null';
  if (Array.isArray(wert)) return `[${wert.map(kanonisch).join(',')}]`;
  const o = wert as Record<string, unknown>;
  const teile: string[] = [];
  for (const k of Object.keys(o).sort()) {
    if (o[k] === undefined) continue;
    teile.push(`${JSON.stringify(k)}:${kanonisch(o[k])}`);
  }
  return `{${teile.join(',')}}`;
}

const leer = (): DiffZaehler => ({ neu: 0, geaendert: 0, entfernt: 0, verschoben: 0 });

function feldUnterschiede(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const namen = new Set([...Object.keys(a), ...Object.keys(b)]);
  const aus: string[] = [];
  for (const k of [...namen].sort()) {
    if (kanonisch(a[k]) !== kanonisch(b[k])) aus.push(k);
  }
  return aus;
}

const bewegung = (p: Record<string, unknown>): { x: number; z: number; yaw: number } => ({
  x: Number(p.x ?? 0),
  z: Number(p.z ?? 0),
  yaw: Number(p.yaw ?? 0),
});

/** Vergleicht `alt` mit `neu` (beide bereits sanitisiert). Reine Funktion. */
export function diffLayouts(alt: WorldLayout, neu: WorldLayout): DiffErgebnis {
  const je: Record<Sammlung, DiffZaehler> = {
    placements: leer(),
    regions: leer(),
    routes: leer(),
    rivers: leer(),
    lakes: leer(),
    continents: leer(),
    defaultSpawn: leer(),
  };
  const alle: DiffEintrag[] = [];
  let geo = false;

  for (const sammlung of SAMMLUNGEN) {
    const a = new Map<string, Record<string, unknown>>();
    const b = new Map<string, Record<string, unknown>>();
    for (const e of ((alt[sammlung] ?? []) as ReadonlyArray<{ id?: string }>)) a.set(String(e.id), e as never);
    for (const e of ((neu[sammlung] ?? []) as ReadonlyArray<{ id?: string }>)) b.set(String(e.id), e as never);
    const z = je[sammlung];
    const ids = [...new Set([...a.keys(), ...b.keys()])].sort();
    for (const id of ids) {
      const ea = a.get(id);
      const eb = b.get(id);
      if (ea === undefined && eb !== undefined) {
        z.neu++;
        alle.push({ sammlung, id, art: 'neu' });
        if (GEO_SAMMLUNGEN.has(sammlung) || (sammlung === 'placements' && Number(eb.einebnen ?? 0) > 0)) geo = true;
      } else if (ea !== undefined && eb === undefined) {
        z.entfernt++;
        alle.push({ sammlung, id, art: 'entfernt' });
        if (GEO_SAMMLUNGEN.has(sammlung) || (sammlung === 'placements' && Number(ea.einebnen ?? 0) > 0)) geo = true;
      } else if (ea !== undefined && eb !== undefined && kanonisch(ea) !== kanonisch(eb)) {
        const felder = feldUnterschiede(ea, eb);
        if (GEO_SAMMLUNGEN.has(sammlung) || (sammlung === 'placements' && felder.includes('einebnen'))) geo = true;
        if (sammlung === 'placements' && felder.every((f) => BEWEGUNG.has(f))) {
          z.verschoben++;
          alle.push({ sammlung, id, art: 'verschoben', von: bewegung(ea), nach: bewegung(eb) });
        } else {
          z.geaendert++;
          alle.push({ sammlung, id, art: 'geaendert', felder });
        }
      }
    }
  }

  if (kanonisch(alt.defaultSpawn) !== kanonisch(neu.defaultSpawn)) {
    je.defaultSpawn.geaendert++;
    alle.push({ sammlung: 'defaultSpawn', id: 'defaultSpawn', art: 'geaendert' });
  }

  const zaehler = leer();
  for (const z of Object.values(je)) {
    zaehler.neu += z.neu;
    zaehler.geaendert += z.geaendert;
    zaehler.entfernt += z.entfernt;
    zaehler.verschoben += z.verschoben;
  }

  const eintraege = alle.slice(0, DIFF_EINTRAEGE_MAX);
  return {
    zaehler,
    geo,
    je,
    eintraege,
    ausgelassen: alle.length - eintraege.length,
    text: diffText(je, zaehler, geo),
  };
}

const NAMEN: Record<Sammlung, [string, string]> = {
  placements: ['Objekt', 'Objekte'],
  regions: ['Region', 'Regionen'],
  routes: ['Route', 'Routen'],
  rivers: ['Fluss', 'Flüsse'],
  lakes: ['See', 'Seen'],
  continents: ['Kontinent', 'Kontinente'],
  defaultSpawn: ['Startpunkt', 'Startpunkte'],
};

function diffText(je: Record<Sammlung, DiffZaehler>, zaehler: DiffZaehler, geo: boolean): string {
  if (zaehler.neu + zaehler.geaendert + zaehler.entfernt + zaehler.verschoben === 0) return 'Keine Änderungen.';
  const teile: string[] = [];
  for (const s of Object.keys(je) as Sammlung[]) {
    const z = je[s];
    const [ein, mehr] = NAMEN[s];
    const n = (k: number): string => (k === 1 ? ein : mehr);
    if (z.neu > 0) teile.push(`+${z.neu} ${n(z.neu)}`);
    if (z.entfernt > 0) teile.push(`−${z.entfernt} ${n(z.entfernt)}`);
    if (z.verschoben > 0) teile.push(`${z.verschoben} verschoben`);
    if (z.geaendert > 0) teile.push(`${z.geaendert} ${n(z.geaendert)} geändert`);
  }
  return teile.join(', ') + (geo ? ' (Geo, wirkt nach Neustart)' : '');
}
