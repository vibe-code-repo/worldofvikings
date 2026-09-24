/**
 * katalog.ts — Suche im Katalog der setzbaren Prefabs (catalog_search).
 *
 * Drei Quellen, in dieser Rangfolge bei doppelten Namen:
 *   store  — `STORE_KATALOG` (art `modell`, `platzierbar !== false`, mit `prefabName`);
 *   eigen  — eigene Modelle (`EIGENE_MODELLE_SET` ∩ `PREFABS_BY_NAME`), Maße aus dem Manifest;
 *   upload — die Upload-Registry (Maße und Kollisionsart aus dem Eintrag).
 * `name` eines Treffers ist GENAU der Prefab-Name, den ops_apply annimmt.
 *
 * Maße und „fest“ kommen aus `huelle.ts` (dieselbe Hülle wie in der
 * Weltprüfung); fehlt jede Quelle, steht `huelleQuelle: 'keine'` und kein
 * erfundenes Maß da. Die Funktionen sind rein: Manifest und Upload-Liste
 * kommen vom Aufrufer. Die Registrierung der Uploads in `PREFABS_BY_NAME`
 * ist Sache des Werkzeugs (`applyUploadedModelRegistry`).
 *
 * Search over the catalogue of placeable prefabs; pure, sources injected.
 */
import { PREFABS_BY_NAME, EIGENE_MODELLE_SET } from '../prefabs.js';
import { STORE_KATALOG } from '../storeKatalogDaten.js';
import { boundsNachWeltraum } from '../storeKatalog.js';
import { istFesterKoerper } from '../kollision/festeKoerper.js';
import { FOLIAGE } from '../vegetation.js';
import { FEATURES } from '../features.js';
import { BIOME_BY_NAME, type BiomeName } from '../worldlayout/types.js';
import type { UploadedModelEntry } from '../uploadedModelRegistry.js';
import { huellenAufloeser, type Huelle, type HuellenAufloeser } from './huelle.js';
import type { ManifestModell } from './manifest.js';

export type KatalogQuelle = 'store' | 'eigen' | 'upload';
export type MassQuelle = 'store-kollisionskiste' | 'store-huelle' | 'manifest' | 'upload' | 'keine';

export interface KatalogEintrag {
  name: string;
  quelle: KatalogQuelle;
  gruppe?: string;
  untergruppe?: string;
  breite: number | null;
  tiefe: number | null;
  hoehe: number | null;
  huelleQuelle: MassQuelle;
  fest: boolean;
  dreiecke?: number;
  biome?: BiomeName[];
  platzierbar: boolean;
}

export interface KatalogAbfrage {
  text?: string;
  gruppe?: string;
  untergruppe?: string;
  fest?: boolean;
  breiteMin?: number;
  breiteMax?: number;
  hoeheMax?: number;
  biom?: string;
  quelle?: readonly KatalogQuelle[];
  limit?: number;
  start?: number;
}

export interface KatalogAntwort {
  gesamt: number;
  start: number;
  treffer: KatalogEintrag[];
}

export class KatalogFehler extends Error {}

export const KATALOG_LIMIT_MAX = 50;
export const KATALOG_LIMIT_VORGABE = 20;

/** Klein, ohne Umlaute und Akzente (ä→ae, ö→oe, ü→ue, ß→ss), damit „faesser“ und „Fässer“ dasselbe sind. */
export function normalisiere(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Bitmaske → Biomnamen (Reihenfolge wie `BIOME_BY_NAME`). */
function biomeVonMaske(maske: number): BiomeName[] {
  const aus: BiomeName[] = [];
  for (const [name, bit] of BIOME_BY_NAME) if ((maske & (bit as number)) !== 0) aus.push(name);
  return aus;
}

/** Prefab-Name → Biome, in denen ihn die Vegetation bzw. die Orte erzeugen. */
function biomeIndex(): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of FOLIAGE) m.set(f.prefabName, (m.get(f.prefabName) ?? 0) | f.biome);
  for (const f of FEATURES) m.set(f.name, (m.get(f.name) ?? 0) | f.biome);
  return m;
}

export interface KatalogQuellen {
  /** `assets/manifest.json` gelesen (leseManifest); fehlt es, haben eigene Modelle keine Maße. */
  manifest?: ReadonlyMap<string, ManifestModell>;
  /** Die Einträge der Upload-Registry. */
  uploads?: readonly UploadedModelEntry[];
}

function ausHuelle(h: Huelle | null): { breite: number; tiefe: number; hoehe: number } | null {
  return h ? { breite: h.halbX * 2, tiefe: h.halbZ * 2, hoehe: h.maxY - h.minY } : null;
}

const runde = (n: number | null): number | null => (n === null ? null : Math.round(n * 1e4) / 1e4);

/** Baut die Liste aller setzbaren Prefabs; einmal je Prozess genügt (≈ 1000 Einträge). */
export function baueKatalog(quellen: KatalogQuellen = {}): KatalogEintrag[] {
  const manifest = quellen.manifest ?? new Map<string, ManifestModell>();
  const biome = biomeIndex();
  const gesehen = new Set<string>();
  const liste: KatalogEintrag[] = [];

  // Eigene Modelle mit Manifest-Maßen als Hülle (Dateiraum → Weltraum: x gespiegelt), Rang 1 im Auflöser —
  // aber nur für Namen, die der Store nicht selbst führt.
  const storeNamen = new Set<string>();
  for (const e of STORE_KATALOG) if (e.prefabName !== undefined) storeNamen.add(e.prefabName);
  const zusatz: HuellenAufloeser = (name) => {
    const m = manifest.get(name);
    if (m === undefined || m.huelle === undefined || storeNamen.has(name)) return null;
    const b = boundsNachWeltraum({ min: m.huelle.min, max: m.huelle.max });
    return {
      fest: istFesterKoerper(PREFABS_BY_NAME.get(name), name),
      mitteX: (b.min[0] + b.max[0]) / 2,
      mitteZ: (b.min[2] + b.max[2]) / 2,
      halbX: (b.max[0] - b.min[0]) / 2,
      halbZ: (b.max[2] - b.min[2]) / 2,
      minY: b.min[1],
      maxY: b.max[1],
      gebaeude: false,
      quelle: 'extern',
    };
  };
  const huelle = huellenAufloeser(zusatz);

  for (const e of STORE_KATALOG) {
    if (e.art !== 'modell' || e.platzierbar === false || e.prefabName === undefined) continue;
    if (!PREFABS_BY_NAME.has(e.prefabName) || gesehen.has(e.prefabName)) continue;
    gesehen.add(e.prefabName);
    const h = huelle(e.prefabName);
    const mass = ausHuelle(h);
    const b = biome.get(e.prefabName);
    liste.push({
      name: e.prefabName,
      quelle: 'store',
      gruppe: e.gruppe,
      untergruppe: e.untergruppe,
      breite: runde(mass?.breite ?? null),
      tiefe: runde(mass?.tiefe ?? null),
      hoehe: runde(mass?.hoehe ?? null),
      huelleQuelle: h === null ? 'keine' : (h.quelle as MassQuelle),
      fest: h?.fest ?? istFesterKoerper(PREFABS_BY_NAME.get(e.prefabName), e.prefabName),
      ...(b ? { biome: biomeVonMaske(b) } : {}),
      platzierbar: true,
    });
  }

  const uploads = quellen.uploads ?? [];
  const uploadNamen = new Set(uploads.map((u) => u.name));
  for (const name of EIGENE_MODELLE_SET) {
    if (gesehen.has(name) || uploadNamen.has(name) || !PREFABS_BY_NAME.has(name)) continue;
    gesehen.add(name);
    const h = huelle(name);
    const m = manifest.get(name);
    const b = biome.get(name);
    liste.push({
      name,
      quelle: 'eigen',
      breite: runde(m?.breite ?? null),
      tiefe: runde(m?.tiefe ?? null),
      hoehe: runde(m?.hoehe ?? null),
      huelleQuelle: m === undefined ? 'keine' : 'manifest',
      fest: h?.fest ?? istFesterKoerper(PREFABS_BY_NAME.get(name), name),
      ...(m?.dreiecke !== undefined ? { dreiecke: m.dreiecke } : {}),
      ...(b ? { biome: biomeVonMaske(b) } : {}),
      platzierbar: true,
    });
  }

  for (const u of uploads) {
    if (gesehen.has(u.name)) continue;
    gesehen.add(u.name);
    liste.push({
      name: u.name,
      quelle: 'upload',
      gruppe: 'Hochgeladen',
      untergruppe: u.anzeigename,
      breite: runde(u.breite),
      tiefe: runde(u.tiefe),
      hoehe: runde(u.hoehe),
      huelleQuelle: 'upload',
      fest: u.kollisionsart === 'fest',
      dreiecke: u.dreiecke,
      platzierbar: true,
    });
  }

  liste.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return liste;
}

/** Nur klein und ohne Akzente (ä→a): „Bäume“ enthält so auch „baum“. */
function ohneAkzente(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Wie gut passt `eintrag` zu den Suchwörtern? Größer = besser; 0 = kein Treffer. */
function wertung(eintrag: KatalogEintrag, worte: readonly string[]): number {
  const name = normalisiere(eintrag.name);
  const gr = `${eintrag.gruppe ?? ''} ${eintrag.untergruppe ?? ''}`;
  // Beide Schreibweisen: „baeume“ und „baume“ treffen „Bäume“.
  const rest = `${normalisiere(gr)} ${ohneAkzente(gr)}`;
  let punkte = 0;
  for (const w of worte) {
    if (name === w) punkte += 100;
    else if (name.startsWith(w)) punkte += 30;
    else if (name.includes(w)) punkte += 10;
    else if (rest.includes(w)) punkte += 3;
    else return 0;
  }
  return punkte;
}

/** Sucht im Katalog. Wirft `KatalogFehler` bei ungültiger Abfrage (unbekanntes Biom, Grenzen). */
export function sucheKatalog(katalog: readonly KatalogEintrag[], a: KatalogAbfrage): KatalogAntwort {
  let biom: BiomeName | undefined;
  if (a.biom !== undefined) {
    if (!BIOME_BY_NAME.has(a.biom as BiomeName)) {
      throw new KatalogFehler(`Unbekanntes Biom "${a.biom}". Gültig: ${[...BIOME_BY_NAME.keys()].join(', ')}.`);
    }
    biom = a.biom as BiomeName;
  }
  const limit = a.limit ?? KATALOG_LIMIT_VORGABE;
  if (!Number.isInteger(limit) || limit < 1 || limit > KATALOG_LIMIT_MAX) {
    throw new KatalogFehler(`limit muss eine ganze Zahl von 1 bis ${KATALOG_LIMIT_MAX} sein.`);
  }
  const start = a.start ?? 0;
  if (!Number.isInteger(start) || start < 0) throw new KatalogFehler('start muss eine ganze Zahl ≥ 0 sein.');

  const worte = normalisiere(a.text ?? '').split(/\s+/).filter((w) => w !== '');
  const gruppe = a.gruppe !== undefined ? normalisiere(a.gruppe) : undefined;
  const untergruppe = a.untergruppe !== undefined ? normalisiere(a.untergruppe) : undefined;

  const treffer: Array<{ e: KatalogEintrag; punkte: number }> = [];
  for (const e of katalog) {
    if (a.quelle !== undefined && !a.quelle.includes(e.quelle)) continue;
    if (a.fest !== undefined && e.fest !== a.fest) continue;
    if (gruppe !== undefined && !normalisiere(e.gruppe ?? '').includes(gruppe)) continue;
    if (untergruppe !== undefined && !normalisiere(e.untergruppe ?? '').includes(untergruppe)) continue;
    // Ein Maßfilter schließt Einträge ohne Maß aus: „unbekannt“ ist keine Zusage.
    if (a.breiteMin !== undefined && !(e.breite !== null && e.breite >= a.breiteMin)) continue;
    if (a.breiteMax !== undefined && !(e.breite !== null && e.breite <= a.breiteMax)) continue;
    if (a.hoeheMax !== undefined && !(e.hoehe !== null && e.hoehe <= a.hoeheMax)) continue;
    if (biom !== undefined && !(e.biome?.includes(biom) ?? false)) continue;
    const punkte = worte.length === 0 ? 1 : wertung(e, worte);
    if (punkte === 0) continue;
    treffer.push({ e, punkte });
  }
  // Stabil: erst Wertung, dann Name (der Katalog ist schon nach Name sortiert).
  treffer.sort((x, y) => y.punkte - x.punkte);
  return { gesamt: treffer.length, start, treffer: treffer.slice(start, start + limit).map((t) => t.e) };
}
