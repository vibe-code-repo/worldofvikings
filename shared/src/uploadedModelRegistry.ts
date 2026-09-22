/**
 * uploadedModelRegistry.ts — Laufzeit-Prefabs aus dem Editor-Upload
 * (Karte „Editor U1 modell-hochladen").
 *
 * ── Das Vorbild ───────────────────────────────────────────────────────
 * Dieselbe Form wie `moduleRegistry.ts` (die Dungeon-Säle, E3–E9): eine
 * Text-Registry neben den Binärdateien, ein `register`-artiger
 * Eintrittspunkt in dieselben Nachschlagewerke, die `PREFAB_DEFS`
 * speisen, ein Laden beim Serverstart und ein `fetch` im Browser vor dem
 * ersten Katalogaufbau. Der Unterschied: Ein hochgeladenes Modell ist
 * kein Raum mit Connectors — es ist ein PLAIN `PrefabDef`, wie jedes
 * Möbelstück auch. Es gibt deshalb keine `RoomDef`, keine Kits, keine
 * Hash-Kollisionsprüfung gegen Räume — nur Name, Datei und Maße.
 *
 * ── Warum eine eigene, KLEINERE Registry und nicht `EIGENE_MODELLE_ALT`
 * in `shared/src/prefabs.ts` ──────────────────────────────────────────
 * Genau das soll diese Karte vermeiden (Auftrag, Abschnitt „Nicht in
 * dieser Karte"): `prefabs.ts` wird gebaut, committet und ausgerollt;
 * ein Upload ist eine LAUFZEIT-Tatsache, die kein Bauen und keinen PR
 * braucht. Zwei getrennte Register bleiben es aus demselben Grund, aus
 * dem `EIGENE_MODELLE_ALT` und `STORE_MODELL_NAMEN` getrennt sind: Wer
 * eine Zeile schreibt (ein Mensch im Quelltext) und wer sie erzeugt
 * (ein Editor-Upload), sind zwei verschiedene Antworten auf „woher kam
 * das?" — WOHIN es beide eintragen (`PREFAB_DEFS`, `EIGENE_MODELLE_SET`),
 * ist trotzdem dieselbe Stelle: Der Rest des Spiels (Spawns,
 * Layout-Prüfung, Katalog) fragt nur EINE Wahrheit, nicht zwei.
 *
 * ── Der Name ist erzwungen, nicht frei ──────────────────────────────
 * Wie beim `Gen_`-Präfix der Dungeon-Module: Der vom Nutzer gewünschte
 * Anzeigename wird auf ein enges Alphabet abgebildet, bevor er ein
 * Dateiname wird (`erzwingeName`). Ist der so entstandene Name schon
 * vergeben, wird ABGELEHNT statt automatisch durchnummeriert — eine
 * zweite `Holzfass2` sähe zufällig aus, wo in Wahrheit zwei verschiedene
 * Uploads unter demselben Namen laufen. „Ein Upload darf nie eine
 * bestehende Datei überschreiben" gilt für die Registry genauso wie für
 * die Platte.
 *
 * ── Keine Nebenwirkung beim Import ───────────────────────────────────
 * Wie `moduleRegistry.ts`: reine Funktionen, kein Registry-Eintrag beim
 * Laden dieser Datei. Das Eintragen ist eine GERUFENE Funktion
 * (`registerUploadedPrefab`), gerufen von `server/src/world/
 * ModelUpload.ts` (Server, beim Start und beim Hochladen im
 * Betriebsdienst-Prozess) und von `client/src/net/
 * UploadedModelRegistryLoad.ts` (Browser, vor dem ersten Katalogaufbau).
 *
 * Sprache: neue Bezeichner englisch, wo sie nicht an einen bestehenden
 * deutschen Namen andocken.
 */
import { PrefabFlag } from './types.js';
import type { Vector3 } from './types.js';
import {
  EIGENE_MODELLE,
  EIGENE_MODELLE_SET,
  PREFABS_BY_NAME,
  PREFAB_DEFS,
  type PrefabDef,
} from './prefabs.js';

/** `PrefabDef.model` bekommt dieses Präfix — der Ordner, in dem die Datei liegt. */
export const UPLOAD_MODEL_PREFIX = 'hochgeladen/';

/** Der Ordner unter `assets/`, in den hochgeladene Modelle geschrieben werden. */
export const UPLOAD_DIR_NAME = 'hochgeladen';

/** Name der Registry-Datei neben den GLBs. */
export const REGISTRY_DATEI = 'registry.json';
export const REGISTRY_VERSION = 1;

/** Präfix und Muster des erzwungenen Namens — kurz, wie `Gen_`. */
export const NAME_PRAEFIX = 'U_';
export const NAME_MUSTER = /^U_[A-Za-z0-9_]{1,40}$/;

// ── Klemmen (mit Begründung im Bericht) ──────────────────────────────
/** Dateigröße. Ein Betriebsdienst-Prozess hält den ganzen Körper im Speicher. */
export const MAX_BYTES = 20_000_000;
/** Dreiecke des SICHTNETZES (nach LOD-/`_col`-Filterung wie `leseGlb`). */
export const MAX_DREIECKE = 20_000;
export const MAX_MESHES = 64;
export const MAX_MATERIALIEN = 16;
/** Größte einzelne eingebettete Bilddatei (Byte, Proxy für Texturgröße). */
export const MAX_BILD_BYTES = 4_000_000;
/** Eigenes `_col`-Netz darf höchstens so groß sein, sonst Box-Rückfall. */
export const MAX_KOLLISIONSNETZ_DREIECKE = 5_000;
/** Größte Objektausdehnung (m) — ab hier nur ein Hinweis, noch keine Ablehnung. */
export const HUELLBOX_HINWEIS_MAX_M = 500;
/** Kleinste Objektausdehnung (m) — darunter nur ein Hinweis. */
export const HUELLBOX_HINWEIS_MIN_M = 0.01;
/** Ab hier ist die Hüllbox absurd und wird ABGELEHNT. */
export const HUELLBOX_ABLEHNEN_MAX_M = 5_000;
/** Darunter ist die Hüllbox entartet (praktisch kein Netz) und wird ABGELEHNT. */
export const HUELLBOX_ABLEHNEN_MIN_M = 0.0005;

export type Kollisionsart = 'fest' | 'durchlaessig';

/** Ein Eintrag der Upload-Registry — Datei, gemessene Zahlen, Wahl der Kollision. */
export interface UploadedModelEntry {
  /** Erzwungener Name: zugleich Prefabname, Dateiname (ohne `.glb`) und Registry-Schlüssel. */
  readonly name: string;
  /** Der vom Nutzer eingegebene Name, unverändert — nur zur Anzeige. */
  readonly anzeigename: string;
  readonly bytes: number;
  readonly dreiecke: number;
  readonly meshes: number;
  readonly materialien: number;
  readonly bilder: number;
  readonly fehlendeTexturen: boolean;
  readonly breite: number;
  readonly hoehe: number;
  readonly tiefe: number;
  readonly kollisionsart: Kollisionsart;
  readonly hatKollisionsnetz: boolean;
  readonly kollisionsnetzAbgelehnt: boolean;
  readonly hochgeladenVon: string;
  readonly zeitpunkt: string;
}

export interface RegistryDatei {
  readonly version: number;
  readonly modelle: readonly UploadedModelEntry[];
}

export function leereRegistry(): RegistryDatei {
  return { version: REGISTRY_VERSION, modelle: [] };
}

/**
 * Registry-Text lesen — nachsichtig, wie `moduleRegistry.leseRegistryAusText`:
 * Diese Funktion läuft auch im BROWSER gegen eine per `fetch` geholte
 * Antwort, und dort ist ein kaputter Inhalt kein Vorfall, sondern höchstens
 * eine leere Liste.
 */
export function leseRegistryAusText(text: string): RegistryDatei {
  try {
    const roh = JSON.parse(text) as { version?: unknown; modelle?: unknown };
    if (!Array.isArray(roh.modelle)) return leereRegistry();
    return { version: typeof roh.version === 'number' ? roh.version : REGISTRY_VERSION, modelle: roh.modelle as UploadedModelEntry[] };
  } catch {
    return leereRegistry();
  }
}

/**
 * Strukturprüfung EINES Registry-Eintrags — die Grenze zwischen „Textdatei,
 * die ein Mensch kaputt machen kann" und „wird als Prefab eingetragen".
 * Gibt `null` zurück, wenn alles stimmt, sonst den Grund.
 */
export function pruefeRegistryEintrag(m: UploadedModelEntry): string | null {
  if (typeof m.name !== 'string' || !NAME_MUSTER.test(m.name)) {
    return `Name '${String(m.name)}' passt nicht auf ${NAME_MUSTER}`;
  }
  if (typeof m.anzeigename !== 'string' || m.anzeigename.length === 0) {
    return `'${m.name}': kein Anzeigename`;
  }
  for (const feld of ['bytes', 'dreiecke', 'meshes', 'materialien', 'bilder', 'breite', 'hoehe', 'tiefe'] as const) {
    const wert = m[feld];
    if (typeof wert !== 'number' || !Number.isFinite(wert) || wert < 0) {
      return `'${m.name}': Feld '${feld}' ist keine gültige Zahl (${String(wert)})`;
    }
  }
  if (m.kollisionsart !== 'fest' && m.kollisionsart !== 'durchlaessig') {
    return `'${m.name}': Kollisionsart '${String(m.kollisionsart)}' unbekannt`;
  }
  return null;
}

/** Prefabname eines Uploads — auch der Schlüssel in PREFABS_BY_NAME. */
export function prefabNameVon(m: Pick<UploadedModelEntry, 'name'>): string {
  return m.name;
}

/** Der Registry-Eintrag als `PrefabDef` — analog zu `roomPrefabDef` in `prefabs.ts`. */
export function uploadedPrefabDef(m: UploadedModelEntry): PrefabDef {
  const ONE: Vector3 = { x: 1, y: 1, z: 1 };
  return {
    name: m.name,
    // PERSISTENT wie die Store-Prefabs (`tools/store-prefabs.mjs`): „es
    // steht da, und das ist alles" — Verhalten bekommt ein Upload nicht.
    flags: PrefabFlag.PERSISTENT,
    localScale: ONE,
    sprite: null,
    renderScale: { w: Math.max(1, m.breite), h: Math.max(1, m.hoehe) },
    model: `${UPLOAD_MODEL_PREFIX}${m.name}`,
  };
}

/** name -> Eintrag, für Kollisionsableitung und Editor-Anzeige. */
const UPLOADED_BY_NAME = new Map<string, UploadedModelEntry>();

/** Der Registry-Eintrag eines registrierten Uploads — oder `undefined`. */
export function uploadedModelEntry(name: string): UploadedModelEntry | undefined {
  return UPLOADED_BY_NAME.get(name);
}

/** Alle registrierten Uploads, in Registrierreihenfolge. */
export function uploadedModelEntries(): readonly UploadedModelEntry[] {
  return [...UPLOADED_BY_NAME.values()];
}

/**
 * Einen Upload in die geteilten Nachschlagewerke eintragen.
 *
 * Dieselben zwei Prüfungen wie `moduleRegistry.registerModule`, auf das
 * hier Nötige verengt: der Name (Registry-intern UND `PREFABS_BY_NAME`,
 * denn ein Upload teilt sich den Namensraum mit jedem anderen Prefab)
 * und danach nichts mehr, das scheitern kann.
 */
export function registerUploadedPrefab(m: UploadedModelEntry): void {
  if (UPLOADED_BY_NAME.has(m.name)) {
    throw new Error(`registerUploadedPrefab: '${m.name}' ist bereits registriert.`);
  }
  if (PREFABS_BY_NAME.has(m.name)) {
    throw new Error(
      `registerUploadedPrefab: Der Name '${m.name}' ist schon von einem anderen Prefab vergeben.`
    );
  }

  const prefab = uploadedPrefabDef(m);
  UPLOADED_BY_NAME.set(m.name, m);
  PREFAB_DEFS.push(prefab);
  (PREFABS_BY_NAME as Map<string, PrefabDef>).set(m.name, prefab);
  (EIGENE_MODELLE as string[]).push(m.name);
  (EIGENE_MODELLE_SET as Set<string>).add(m.name);
}

/** Die Rückseite — ein registrierter Upload aus allen Karten nehmen. */
export function unregisterUploadedPrefab(name: string): void {
  if (!UPLOADED_BY_NAME.has(name)) {
    throw new Error(`unregisterUploadedPrefab: '${name}' ist nicht registriert.`);
  }
  UPLOADED_BY_NAME.delete(name);
  const iPrefab = PREFAB_DEFS.findIndex((p) => p.name === name);
  if (iPrefab >= 0) PREFAB_DEFS.splice(iPrefab, 1);
  (PREFABS_BY_NAME as Map<string, PrefabDef>).delete(name);
  const iEigen = (EIGENE_MODELLE as string[]).indexOf(name);
  if (iEigen >= 0) (EIGENE_MODELLE as string[]).splice(iEigen, 1);
  (EIGENE_MODELLE_SET as Set<string>).delete(name);
}

export interface AnwendungsErgebnis {
  readonly geladen: number;
  /** Einträge, die NICHT registriert wurden — mit Grund. */
  readonly meldungen: string[];
}

/**
 * Den Stand einer gelesenen Registry-Datei auf die Nachschlagewerke
 * anwenden — Diff aus AUSTRAGEN (was nicht mehr in der Datei steht)
 * und EINTRAGEN (was neu ist). Läuft im Server beim Start (einmalig)
 * UND im Betriebsdienst je Anfrage (Abgleich, wie `moduleAbgleichen`
 * in `admin/src/main.ts` es für Dungeon-Module schon tut) UND im
 * Browser vor dem ersten Katalogaufbau.
 */
export function applyUploadedModelRegistry(datei: RegistryDatei): AnwendungsErgebnis {
  const meldungen: string[] = [];
  const sollen = new Set(datei.modelle.map((m) => m.name));
  for (const name of [...UPLOADED_BY_NAME.keys()]) {
    if (!sollen.has(name)) unregisterUploadedPrefab(name);
  }
  let geladen = 0;
  for (const m of datei.modelle) {
    if (UPLOADED_BY_NAME.has(m.name)) {
      geladen++;
      continue;
    }
    const grund = pruefeRegistryEintrag(m);
    if (grund) {
      meldungen.push(`'${String(m.name)}' abgelehnt: ${grund}`);
      continue;
    }
    try {
      registerUploadedPrefab(m);
      geladen++;
    } catch (e) {
      meldungen.push((e as Error).message);
    }
  }
  return { geladen, meldungen };
}

/**
 * Den gewünschten Anzeigenamen auf einen zulässigen Dateinamen abbilden.
 *
 * Nur `[A-Za-z0-9_]` bleibt stehen, alles andere wird zu `_`; führende/
 * folgende `_` fallen weg, die Länge wird gedeckelt. `null` heisst: nach
 * dem Sieben blieb nichts Brauchbares übrig (z. B. nur Satzzeichen oder
 * nur Pfadanteile wie „../../etc").
 */
export function erzwingeName(gewuenscht: string): string | null {
  // Pfadanteile sind eine ABLEHNUNG, kein Sanitierungsfall: Ein sanierter
  // Rest von '../../etc/passwd' wäre technisch harmlos (nie ein '/' im
  // Ergebnis), sagt dem Absender aber nicht, dass sein Name ein Pfad war
  // — und genau das ist die Eingabe, die eine verständliche Ablehnung statt
  // einer stillen Umdeutung verdient.
  if (gewuenscht.includes('/') || gewuenscht.includes('\\') || gewuenscht.includes('..')) {
    return null;
  }
  const kern = gewuenscht
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (kern.length === 0) return null;
  return `${NAME_PRAEFIX}${kern}`;
}
