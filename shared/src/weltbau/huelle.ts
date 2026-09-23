/**
 * huelle.ts — Hüllbox und „fest oder durchlässig“ eines Prefabs, gemeinsame
 * Grundlage der Weltprüfung (world_check, area_describe) und der Werkzeuge,
 * die Maße brauchen.
 *
 * Quellen in dieser Reihenfolge (die tatsächlich benutzte steht in
 * `Huelle.quelle`):
 *   1. `zusatz`     — vom Aufrufer eingehängte Auflösung (z. B. Asset-Manifest);
 *   2. Store        — Kollisionskiste, sonst Hüllbox des Katalogeintrags
 *                     (Dateiraum → Weltraum über `boundsNachWeltraum`);
 *   3. Upload       — Maße und Kollisionsart aus der Upload-Registry.
 * Findet keine Quelle etwas, ist das Prefab NICHT prüfbar (`null`): es wird
 * kein Kasten erfunden.
 *
 * Nicht enthalten: die Kollisionsform des Servers (`KollisionsFormen`) — sie
 * braucht die GLB-Dateien und liegt im Server-Paket; wer sie hat, hängt sie
 * über `zusatz` ein.
 *
 * Bounding box and solid/passable flag of a prefab — the shared basis of the
 * world check. No source found → not checkable (`null`), never an invented box.
 */
import { PREFABS_BY_NAME } from '../prefabs.js';
import { STORE_KATALOG_NACH_PREFAB } from '../storeKatalogDaten.js';
import { storeKollision } from '../storeKollisionDaten.js';
import { boundsNachWeltraum, type StoreBounds } from '../storeKatalog.js';
import { istFesterKoerper } from '../kollision/festeKoerper.js';
import { uploadedModelEntry } from '../uploadedModelRegistry.js';
import { HAUS_MIN_HOEHE, HAUS_MIN_KANTE } from './grenzen.js';

export type HuellenQuelle = 'extern' | 'store-kollisionskiste' | 'store-huelle' | 'upload';

/** Hülle im lokalen Weltraum (x bereits gespiegelt), unskaliert, Ursprung = Bodenkontakt. */
export interface Huelle {
  fest: boolean;
  mitteX: number;
  mitteZ: number;
  halbX: number;
  halbZ: number;
  minY: number;
  maxY: number;
  /** Katalog-Gruppe „Gebäude“: Bausatzteile dürfen ineinandergreifen. */
  gebaeude: boolean;
  quelle: HuellenQuelle;
}

export type HuellenAufloeser = (prefab: string) => Huelle | null;

/** Namen von Objekten, die absichtlich am oder im Wasser stehen (P2 meldet dort nur einen Hinweis). */
export const WASSERBAU_NAMEN = /dock|steg|pier|boat|bridge|bruecke/i;

function ausBounds(b: StoreBounds, fest: boolean, gebaeude: boolean, quelle: HuellenQuelle): Huelle {
  return {
    fest,
    mitteX: (b.min[0] + b.max[0]) / 2,
    mitteZ: (b.min[2] + b.max[2]) / 2,
    halbX: (b.max[0] - b.min[0]) / 2,
    halbZ: (b.max[2] - b.min[2]) / 2,
    minY: b.min[1],
    maxY: b.max[1],
    gebaeude,
    quelle,
  };
}

function ausStore(prefab: string): Huelle | null {
  const eintrag = STORE_KATALOG_NACH_PREFAB.get(prefab);
  if (eintrag === undefined) return null;
  const kollision = storeKollision(prefab);
  const kiste = kollision?.art === 'box' ? kollision.box : undefined;
  const bounds = kiste ?? eintrag.bounds;
  if (bounds === undefined) return null;
  const fest = istFesterKoerper(PREFABS_BY_NAME.get(prefab), prefab);
  return ausBounds(
    boundsNachWeltraum(bounds),
    fest,
    eintrag.gruppe === 'Gebäude',
    kiste !== undefined ? 'store-kollisionskiste' : 'store-huelle'
  );
}

function ausUpload(prefab: string): Huelle | null {
  const u = uploadedModelEntry(prefab);
  if (u === undefined) return null;
  return {
    fest: u.kollisionsart === 'fest',
    mitteX: 0,
    mitteZ: 0,
    halbX: u.breite / 2,
    halbZ: u.tiefe / 2,
    minY: 0,
    maxY: u.hoehe,
    gebaeude: false,
    quelle: 'upload',
  };
}

/** Die Standardauflösung (mit Zwischenspeicher); `zusatz` hat Vorrang. */
export function huellenAufloeser(zusatz?: HuellenAufloeser): HuellenAufloeser {
  const cache = new Map<string, Huelle | null>();
  return (prefab) => {
    const bekannt = cache.get(prefab);
    if (bekannt !== undefined || cache.has(prefab)) return bekannt ?? null;
    const h = zusatz?.(prefab) ?? ausStore(prefab) ?? ausUpload(prefab);
    cache.set(prefab, h);
    return h;
  };
}

/**
 * Ein „Haus“: fester Körper mit mindestens 3 × 3 m Grundfläche und 2,5 m Höhe
 * (Grenzen in grenzen.ts). Store-Modelle zählen nur in der Katalog-Gruppe
 * „Gebäude“ — sonst wäre jeder große Fels ein Haus ohne Tür. Uploads und
 * eingehängte Hüllen (`extern`) haben keine Gruppe und zählen nach Maß.
 */
export function istHaus(h: Huelle, skala = 1): boolean {
  return (
    h.fest &&
    (h.gebaeude || h.quelle === 'upload' || h.quelle === 'extern') &&
    h.halbX * 2 * skala >= HAUS_MIN_KANTE &&
    h.halbZ * 2 * skala >= HAUS_MIN_KANTE &&
    (h.maxY - h.minY) * skala >= HAUS_MIN_HOEHE
  );
}
