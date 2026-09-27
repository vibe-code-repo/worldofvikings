/**
 * Validierung untrusted Layout-Dokumente (Editor-Upload, MCP, Disk) — nach
 * dem Muster von sanitizeDungeonDocument: klemmen statt werfen, Unbekanntes
 * verwerfen, nie eine Exception nach außen. Rückgabe null = unbrauchbar.
 *
 * Bewusst nur SYNTAKTISCH: Ob ein kuratierter Vegetations-/Location-/
 * Spawn-Name existiert, entscheidet der Server am Verwendungsort (die
 * Tabellen leben dort und ändern sich unabhängig vom Schema).
 */

import {
  NPC_NAME_MAX,
  NPC_STUFE_MAX,
  NPC_STUFE_MIN,
  istFraktion,
  istNpcRolle,
  istQuestZustand,
  type NpcDef,
} from '../npc.js';
import {
  BIOME_BY_NAME,
  LAYOUT_MAX_EXTENT,
  ROUTE_DEFAULT_SPEED,
  ROUTE_MAX_PAUSE,
  WORLD_LAYOUT_VERSION,
  type Wegpunkt,
  type BiomeName,
  type ContinentDef,
  type RegionDef,
  type RegionShape,
  type PlacementDef,
  type RiverDef,
  type LakeDef,
  type RouteDef,
  type ZoneHeightDelta,
  type WorldLayout,
} from './types.js';
import { gleicherInhalt, ID_RE, merkeZusammengefasst, platzierungenNormalisieren } from './platzierungsId.js';

// Über diese Datei nach außen (index.ts lässt sie ohnehin durch): die Werkzeuge, die eine Platzierung anlegen.
export {
  neuePlatzierungsId,
  platzierungenNormalisieren,
  platzierungsIdBasis,
  zusammengefassteDuplikate,
} from './platzierungsId.js';

const MAX_REGIONS = 512;
const MAX_CONTINENTS = 32;
const MAX_POLYGON_POINTS = 512;
const MAX_KURATIERT = 256;
const MAX_ROUTEN = 256;

function klemm(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function koordinate(v: unknown): number | null {
  // Nur eine ZAHL ist eine Koordinate: `Number(null)` und `Number('')` sind 0
  // und hätten einen Eintrag mit `"x": null` still an den Ursprung gesetzt.
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > LAYOUT_MAX_EXTENT) return null;
  const n = v;
  // Auf Millimeter runden — stabilisiert JSON-Roundtrips und Kompilierung.
  return Math.round(n * 1000) / 1000;
}

function sanitizeShape(input: unknown): RegionShape | null {
  if (typeof input !== 'object' || input === null) return null;
  const s = input as Record<string, unknown>;
  if (s.kind === 'circle') {
    const x = koordinate(s.x);
    const z = koordinate(s.z);
    const radius = klemm(s.radius, 8, 50_000, NaN);
    if (x === null || z === null || !Number.isFinite(radius)) return null;
    return { kind: 'circle', x, z, radius };
  }
  if (s.kind === 'polygon' && Array.isArray(s.points)) {
    if (s.points.length < 3 || s.points.length > MAX_POLYGON_POINTS) return null;
    const points: [number, number][] = [];
    for (const p of s.points) {
      if (!Array.isArray(p) || p.length !== 2) return null;
      const x = koordinate(p[0]);
      const z = koordinate(p[1]);
      if (x === null || z === null) return null;
      points.push([x, z]);
    }
    // Entartete Polygone (Fläche ~0) verwerfen — Schnürsenkel-Formel.
    let flaeche2 = 0;
    for (let i = 0; i < points.length; i++) {
      const [x1, z1] = points[i]!;
      const [x2, z2] = points[(i + 1) % points.length]!;
      flaeche2 += x1 * z2 - x2 * z1;
    }
    if (Math.abs(flaeche2) < 2 * 64) return null; // < 64 m² ist kein Gebiet
    return { kind: 'polygon', points };
  }
  return null;
}

function sanitizeNamen(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: string[] = [];
  for (const n of input) {
    if (typeof n !== 'string' || n.length === 0 || n.length > 64) continue;
    if (!out.includes(n)) out.push(n);
    if (out.length >= MAX_KURATIERT) break;
  }
  return out;
}

/**
 * NPC-Angaben einer Platzierung.
 *
 * Unbekannte Fraktionen/Rollen/Quest-Zustände werden WEGGELASSEN und
 * nicht auf einen Standardwert gezwungen: Fehlt das Feld, greift die
 * Prefab-Vorgabe (`loeseNpcAuf`) — und die ist bei einem Tippfehler mit
 * Sicherheit näher an der Absicht als ein hart gesetztes 'neutral'.
 *
 * Bleibt nichts übrig, kommt `undefined` zurück und das Feld fehlt im
 * Dokument. Das hält den Round-Trip stabil: Ein Eintrag ohne `npc` darf
 * durch den Sanitizer keinen bekommen, sonst wüchse jede Speicherung des
 * Weltdokuments um 158 leere Blöcke.
 */
function sanitizeNpc(input: unknown): NpcDef | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const o = input as Record<string, unknown>;
  const npc: {
    name?: string;
    rolle?: NpcDef['rolle'];
    fraktion?: NpcDef['fraktion'];
    stufe?: number;
    quest?: NpcDef['quest'];
  } = {};
  // Leere Zeichenkette heisst „kein eigener Name" — als Feld gespeichert
  // wäre sie ein Namensschild ohne Text.
  if (typeof o.name === 'string') {
    const name = o.name.trim().slice(0, NPC_NAME_MAX);
    if (name.length > 0) npc.name = name;
  }
  if (istNpcRolle(o.rolle)) npc.rolle = o.rolle;
  if (istFraktion(o.fraktion)) npc.fraktion = o.fraktion;
  if (o.stufe !== undefined) {
    // Anders als bei Fraktion/Rolle wird hier GEKLEMMT: Eine Stufe ist ein
    // Zahlenstrahl, „120" meint erkennbar „so hoch wie es geht". Nur
    // Unsinn (NaN, Text) fällt heraus.
    const stufe = Math.round(klemm(o.stufe, NPC_STUFE_MIN, NPC_STUFE_MAX, NaN));
    if (Number.isFinite(stufe)) npc.stufe = stufe;
  }
  if (istQuestZustand(o.quest)) npc.quest = o.quest;
  return Object.keys(npc).length > 0 ? npc : undefined;
}

/**
 * Alte Biomnamen auf die heutigen abbilden.
 *
 * `meadows` heisst seit 08/2026 `grassland` (siehe BiomeName). Ein
 * Weltdokument ist die Arbeit des Nutzers und darf durch eine
 * Umbenennung nicht unlesbar werden — deshalb wird der alte Name hier
 * still angenommen und auf den neuen umgeschrieben. Beim naechsten
 * Speichern steht der neue drin; wer eine alte Datei behaelt, verliert
 * nichts.
 *
 * Die Tabelle bleibt bestehen, auch wenn irgendwann kein Dokument mehr
 * `meadows` enthaelt: Sie kostet nichts und ist die einzige Stelle, an
 * der man spaeter nachsehen kann, wie ein Biom frueher hiess.
 */
const ALTE_BIOMNAMEN: ReadonlyMap<string, BiomeName> = new Map([['meadows', 'grassland']]);

function biomNameMigrieren(input: unknown): BiomeName | null {
  if (typeof input !== 'string') return null;
  const neu = ALTE_BIOMNAMEN.get(input);
  if (neu) return neu;
  return BIOME_BY_NAME.has(input as BiomeName) ? (input as BiomeName) : null;
}

function sanitizeRegion(input: unknown, bekannteIds: Set<string>): RegionDef | null {
  if (typeof input !== 'object' || input === null) return null;
  const r = input as Record<string, unknown>;
  if (typeof r.id !== 'string' || !ID_RE.test(r.id) || bekannteIds.has(r.id)) return null;
  const biome = biomNameMigrieren(r.biome);
  if (biome === null) return null;
  const shape = sanitizeShape(r.shape);
  if (!shape) return null;
  const region: RegionDef = {
    id: r.id,
    biome,
    shape,
    edgeFalloff: klemm(r.edgeFalloff, 16, 5000, 300),
  };
  if (typeof r.continentId === 'string' && ID_RE.test(r.continentId)) {
    region.continentId = r.continentId;
  }
  if (r.baseLevel !== undefined) region.baseLevel = klemm(r.baseLevel, 0.03, 0.6, 0.22);
  if (r.heightScale !== undefined) region.heightScale = klemm(r.heightScale, 0, 4, 1);
  if (r.tier !== undefined) region.tier = Math.round(klemm(r.tier, 0, 5, 0));
  if (r.forestDensity !== undefined) region.forestDensity = klemm(r.forestDensity, 0, 2, 1);
  if (r.bewuchsDichte !== undefined) region.bewuchsDichte = klemm(r.bewuchsDichte, 0.1, 4, 1);
  if (r.waldKoernung !== undefined) region.waldKoernung = klemm(r.waldKoernung, 0.2, 3, 1);
  if (r.abstandFaktor !== undefined) region.abstandFaktor = klemm(r.abstandFaktor, 0.3, 2, 1);
  if (r.nester !== undefined) region.nester = klemm(r.nester, 0, 1, 0);
  if (r.nesterKoernung !== undefined) region.nesterKoernung = klemm(r.nesterKoernung, 0.2, 3, 1);
  const vegetation = sanitizeNamen(r.vegetation);
  if (vegetation) region.vegetation = vegetation;
  const locations = sanitizeNamen(r.locations);
  if (locations) region.locations = locations;
  const spawns = sanitizeNamen(r.spawns);
  if (spawns) region.spawns = spawns;
  return region;
}

/** Das geprüfte Dokument samt dem, was der Sanitizer dabei zusammengelegt hat. */
export interface SanitizeBericht {
  layout: WorldLayout;
  /**
   * Eine Zeile je exaktem Duplikat, das er zu einem Eintrag zusammengefasst hat
   * (`Prefab @(x, z)`). Zusammengefasst ist nicht verworfen: Es geht kein Objekt
   * verloren. Wer roh gegen gültig zählt (Schreibweg, Boot), zieht diese Zahl ab.
   * Sie wird ausdrücklich zurückgegeben und hängt an keinem Objekt, das beim
   * Kopieren des Layouts verloren gehen könnte.
   */
  zusammengefasst: readonly string[];
}

/**
 * Clamps every raw placement entry on its own (prefab, x/z, scale 0.2–5,
 * einebnen 1–100, id, route, npc; the first 2000 only) and drops bad ones.
 * NO duplicate folding and no ids: that step is quadratic per prefab
 * (`platzierungenNormalisieren`). `sanitizeWorldLayout` continues from here;
 * a caller that only needs the per-entry values (the scatter preview: same
 * entry, same clear circle) stops here.
 * Klemmt jeden Eintrag einzeln, ohne Duplikat-Falten und Ids.
 */
export function platzierungenEinzeln(roh: unknown): PlacementDef[] {
  const roheEintraege: PlacementDef[] = [];
  if (Array.isArray(roh)) {
    for (const p of roh.slice(0, 2000)) {
      if (typeof p !== 'object' || p === null) continue;
      const o = p as Record<string, unknown>;
      if (typeof o.prefab !== 'string' || o.prefab.length === 0 || o.prefab.length > 64) continue;
      const x = koordinate(o.x);
      const z = koordinate(o.z);
      if (x === null || z === null) continue;
      const eintrag: PlacementDef = { prefab: o.prefab, x, z };
      // Eine ungültige `id` wird nicht verworfen, sondern unten abgeleitet: Der Eintrag selbst ist in Ordnung, nur
      // seine Adresse fehlt. Der Schreibweg lässt sie nicht bis hierher durch (`platzierungenFehler`: feld `id`).
      if (typeof o.id === 'string' && ID_RE.test(o.id)) eintrag.id = o.id;
      // Nur die SCHREIBWEISE prüfen, nicht die Existenz der Route: Ob es
      // sie gibt, meldet pruefeLayout — wie bei `continentId` an der
      // Region hängt die Auflösung am Verwendungsort, nicht am Schema.
      if (typeof o.route === 'string' && ID_RE.test(o.route)) eintrag.route = o.route;
      if (o.yaw !== undefined) eintrag.yaw = klemm(o.yaw, -Math.PI * 2, Math.PI * 2, 0);
      if (o.scale !== undefined) eintrag.scale = klemm(o.scale, 0.2, 5, 1);
      if (o.einebnen !== undefined) {
        // Wie beim Kreis-Radius: Unsinn verwerfen statt auf einen Wert zu
        // klemmen — ein erfundener Sockel wäre schlimmer als keiner.
        const r = klemm(o.einebnen, 1, PLATZIERUNG_EINEBNEN_MAX, NaN);
        if (Number.isFinite(r)) eintrag.einebnen = Math.round(r * 10) / 10;
      }
      const npc = sanitizeNpc(o.npc);
      if (npc) eintrag.npc = npc;
      roheEintraege.push(eintrag);
    }
  }
  return roheEintraege;
}

/** Größter Sockelradius `einebnen` in m: Sanitizer, Server-Klemme, Schreibweg und Testflug halten dieselbe Grenze. */
export const PLATZIERUNG_EINEBNEN_MAX = 100;

/** Ein Zahltext, den `Number()` unzweideutig liest: Dezimalzahl mit Vorzeichen und Exponent, kein Hex, kein `Infinity`, kein Leerstring. */
const ZAHLTEXT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Ist der Wert eine Zahl in [min, max], oder ein Zahltext, der eindeutig eine solche Zahl ist? `"3"` ist die Zahl 3
 * (der Sanitizer liest es genau so): kein Tippfehler. `"abc"`, `""`, `true`, `[]` und `99` (bei Höchstwert 5,
 * geklemmt) sind es.
 */
function zahlInBereich(v: unknown, min: number, max: number): boolean {
  const n = typeof v === 'number' ? v : typeof v === 'string' && ZAHLTEXT_RE.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isFinite(n) && n >= min && n <= max;
}

/** Die Schlüssel einer Platzierung und ihres npc-Blocks. Alles andere streicht der Sanitizer still (Schlüssel-Tippfehler `Yaw`). */
const PLATZIERUNG_SCHLUESSEL: ReadonlySet<string> = new Set(['id', 'prefab', 'x', 'z', 'yaw', 'scale', 'einebnen', 'route', 'npc']);
const NPC_SCHLUESSEL: ReadonlySet<string> = new Set(['name', 'rolle', 'fraktion', 'stufe', 'quest']);

/**
 * Welche vom Nutzer GESETZTEN Felder eines rohen Eintrags hat `platzierungenEinzeln` geklemmt, gekürzt oder
 * gestrichen (Roheintrag ≠ bereinigter Eintrag)? Etwa `yaw: "abc"` (wird 0), `scale: 99` (wird 5), `scale: null`
 * (wird 0,2), `route: "Nord Weg"` (fällt weg), `npc: "x"`, `npc: []`, `npc.rolle: "typo"`, ein `npc.name` über 32
 * Zeichen (wird gekürzt) und jeder unbekannte Schlüssel (`Yaw`, `scael`, `npc.Rolle`: fällt weg, gälte als fehlend).
 *
 * Nicht dabei, weil eindeutig und ohne Bedeutungsänderung:
 *  - Zahltexte (`scale: "3"`), Rundung (Millimeter bei x/z, 0,1 bei `einebnen`, ganze Stufe)
 *  - `null` bei `yaw`, `route`, `npc`, `npc.name/rolle/fraktion/quest`: gilt wie ein fehlendes Feld. Bei `scale`,
 *    `einebnen` und `npc.stufe` NICHT: Dort macht der Sanitizer aus `null` die Zahl 0 und klemmt sie (`scale` 0,2).
 *  - `prefab`: ein falsches Prefab ist ein anderer, gültiger Eintrag (kein Klemmen); ein unbekanntes Prefab meldet
 *    der Abgleich als `unbekannt`.
 *  - eine FEHLENDE id (wird abgeleitet). Eine gesetzte, aber ungültige id zählt (Feld `id`).
 *
 * Gilt nur für Einträge, die der Sanitizer NICHT verworfen hat (die zählen als verworfen: `platzierungenFehler`).
 */
export function geklemmteFelder(roh: unknown): string[] {
  const felder: string[] = [];
  if (typeof roh !== 'object' || roh === null) return felder;
  const o = roh as Record<string, unknown>;
  const gesetzt = (v: unknown): boolean => v !== undefined && v !== null;
  /** Gesetzt UND nicht in [min, max] lesbar; `null` zählt hier mit (Sanitizer: `Number(null)` = 0). */
  const zahlFalsch = (v: unknown, min: number, max: number): boolean => v !== undefined && (v === null || !zahlInBereich(v, min, max));
  for (const k of Object.keys(o)) if (!PLATZIERUNG_SCHLUESSEL.has(k)) felder.push(k);
  // Eine GESETZTE, aber ungültige id (Großbuchstabe, Leerzeichen, Umlaut, Zahl, null, über 64 Zeichen) würde still neu
  // abgeleitet: ein gefällter Baum würde belebt, ein stehender live gelöscht und neu gespawnt. Fehlt die id ganz, ist
  // das erlaubt (Altdokumente ohne ids).
  if (o.id !== undefined && !(typeof o.id === 'string' && ID_RE.test(o.id))) felder.push('id');
  if (gesetzt(o.yaw) && !zahlInBereich(o.yaw, -Math.PI * 2, Math.PI * 2)) felder.push('yaw');
  if (zahlFalsch(o.scale, 0.2, 5)) felder.push('scale');
  if (zahlFalsch(o.einebnen, 1, PLATZIERUNG_EINEBNEN_MAX)) felder.push('einebnen');
  if (gesetzt(o.route) && !(typeof o.route === 'string' && ID_RE.test(o.route))) felder.push('route');
  if (gesetzt(o.npc)) {
    if (typeof o.npc !== 'object' || Array.isArray(o.npc)) felder.push('npc');
    else {
      const n = o.npc as Record<string, unknown>;
      if (Object.keys(n).length === 0) felder.push('npc');
      for (const k of Object.keys(n)) if (!NPC_SCHLUESSEL.has(k)) felder.push(`npc.${k}`);
      if (gesetzt(n.name) && (typeof n.name !== 'string' || n.name.trim().length > NPC_NAME_MAX)) felder.push('npc.name');
      if (gesetzt(n.rolle) && !istNpcRolle(n.rolle)) felder.push('npc.rolle');
      if (gesetzt(n.fraktion) && !istFraktion(n.fraktion)) felder.push('npc.fraktion');
      if (zahlFalsch(n.stufe, NPC_STUFE_MIN, NPC_STUFE_MAX)) felder.push('npc.stufe');
      if (gesetzt(n.quest) && !istQuestZustand(n.quest)) felder.push('npc.quest');
    }
  }
  return felder;
}

/** Ein Befund am ROHEN Eintrag: welche Platzierung (`id`, sonst `#<Stelle>`), welches Feld, welcher Wert (gekürzt). */
export interface PlatzierungsFehler {
  id: string;
  feld: string;
  wert: unknown;
}

/** Ein Wert für die Meldung: Zahlen, Wahrheitswerte und null bleiben, Texte und Verschachteltes werden auf 80 Zeichen gekürzt. */
function wertKurz(v: unknown): unknown {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  if (v === undefined) return null;
  let text: string | undefined;
  try {
    text = JSON.stringify(v);
  } catch {
    text = undefined;
  }
  return text === undefined ? String(typeof v) : text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/**
 * Was am ROHEN Platzierungs-Array (vor dem Sanitizer) verworfen oder verändert würde: ein Eintrag, den
 * `platzierungenEinzeln` streicht (kein Objekt, `prefab` fehlt oder ist leer / über 64 Zeichen, `x` oder `z`
 * keine endliche Zahl im Weltrahmen), und jedes Feld aus `geklemmteFelder`. Nur die ersten 2000 Einträge (mehr nimmt
 * der Sanitizer nicht; die Obergrenze meldet der Schreibweg vorher). Leer heißt: der Sanitizer ändert nichts außer
 * Rundung, Zahltexten, Sortierung und dem Zusammenlegen exakter Duplikate.
 *
 * Kein Array (fehlt, `null`, Text) liefert eine leere Liste: Das prüft `listenPruefen` des Schreibwegs.
 */
export function platzierungenFehler(roh: unknown): PlatzierungsFehler[] {
  const fehler: PlatzierungsFehler[] = [];
  if (!Array.isArray(roh)) return fehler;
  roh.slice(0, 2000).forEach((p, i) => {
    const id = typeof p === 'object' && p !== null && typeof (p as { id?: unknown }).id === 'string' && (p as { id: string }).id.length <= 64 ? (p as { id: string }).id : `#${i}`;
    if (typeof p !== 'object' || p === null || Array.isArray(p)) {
      fehler.push({ id, feld: 'eintrag', wert: wertKurz(p) });
      return;
    }
    const o = p as Record<string, unknown>;
    if (typeof o.prefab !== 'string' || o.prefab.length === 0 || o.prefab.length > 64) fehler.push({ id, feld: 'prefab', wert: wertKurz(o.prefab) });
    if (koordinate(o.x) === null) fehler.push({ id, feld: 'x', wert: wertKurz(o.x) });
    if (koordinate(o.z) === null) fehler.push({ id, feld: 'z', wert: wertKurz(o.z) });
    for (const feld of geklemmteFelder(o)) {
      const teile = feld.split('.');
      let wert: unknown = o;
      for (const t of teile) wert = typeof wert === 'object' && wert !== null ? (wert as Record<string, unknown>)[t] : undefined;
      fehler.push({ id, feld, wert: wertKurz(wert) });
    }
  });
  fehler.push(...doppelteIds(roh.slice(0, 2000)));
  return fehler;
}

/**
 * Dieselbe gültige id mehrfach mit VERSCHIEDENEM Inhalt: `platzierungenNormalisieren` behielte den ersten Eintrag und
 * leitete dem zweiten eine neue id ab. Steht die Kopie vor dem Original, verlöre das Original seine Adresse
 * (ein gefällter Baum würde belebt, ein stehender verschoben). Exakte Duplikate (gleiche id, gleicher Inhalt) faltet
 * der Sanitizer weiter still zusammen. Eine Meldung je id (`wert: "doppelt"`).
 */
function doppelteIds(roh: readonly unknown[]): PlatzierungsFehler[] {
  const erste = new Map<string, PlacementDef>();
  const gemeldet = new Set<string>();
  const fehler: PlatzierungsFehler[] = [];
  for (const p of roh) {
    if (typeof p !== 'object' || p === null || Array.isArray(p)) continue;
    const id = (p as { id?: unknown }).id;
    if (typeof id !== 'string' || !ID_RE.test(id)) continue;
    const e = platzierungenEinzeln([p])[0];
    if (!e) continue; // verworfen: zählt dort
    const vorher = erste.get(id);
    if (!vorher) erste.set(id, e);
    else if (!gemeldet.has(id) && !gleicherInhalt(vorher, e)) {
      gemeldet.add(id);
      fehler.push({ id, feld: 'id', wert: 'doppelt' });
    }
  }
  return fehler;
}

/** Die Liste als Satz für Editor, KI und Log: `t9 yaw="abc"`, höchstens `max` Stück, der Rest als Zahl. */
export function platzierungenFehlerText(liste: readonly PlatzierungsFehler[], max = 20): string {
  const teile = liste.slice(0, max).map((f) => `${f.id} ${f.feld}=${JSON.stringify(f.wert)}`);
  return teile.join(', ') + (liste.length > max ? ` … (+${liste.length - max})` : '');
}

// ── Handkorrektur der Geländehöhe (heightDeltas, Editor-Pinsel T2+) ─────
//
// N1 (Angriffsbefund B2): Eine Zone hat EIGENE 64×64 Rasterpunkte (0…4095),
// nicht 65×65 — die geteilte Randzeile/-spalte (`rx`/`ry` = 64) gehört immer
// der Nachbarzone (`rx`/`ry` = 0 dort), s. `types.ts` und
// `RegionGeo.zoneUndIndex`.
//
// N2 (Orchestrator-Formatentscheidung, Angriffsbefund N6): Punkte werden je
// Zone nach Rasterzeile `ry` (0…63) gruppiert (`ZoneHeightDelta.r`, je
// Zeile EIN String `"ry|i|d"` — s. `types.ts`, warum ein String statt des
// Tripels `[ry,"i","d"]`: 533 B statt 400 B bei einem 3-m-Strich). Ein
// geänderter Punkt ändert nur den String EINER Zeile, nicht die ganze
// Zone — kleiner Diff bei einer vollen Zone.

/** Größter Zeilen-/Spaltenindex einer Zone: 64×64 − 1, je Achse also 0…63. */
export const HOEHENKORREKTUR_ZEILE_MAX = 63;
/** Höchstens so viele Zeilen (verschiedene `ry`) je Zone — mehr gibt es bei 64 Zeilen nicht. */
const HOEHENKORREKTUR_ZEILEN_JE_ZONE_MAX = 64;
/** Größtes erlaubtes Delta in Zentimetern (±100 m). */
export const HOEHENKORREKTUR_DELTA_MAX_CM = 10_000;
/** Zonen-Koordinate: klein genug für `LAYOUT_MAX_EXTENT` (40 km / 64 m ≈ 625), reichlich Marge. */
const HOEHENZONE_MAX = 2048;
/**
 * Sicherheitsnetz beim LESEN, unabhängig vom 422-Schreibweg-Deckel
 * (`HOEHENKORREKTUR_ZONEN_GRENZE`, `layoutDatei.ts` — dieselbe Zahl, aber
 * `sanitize.ts` darf `layoutDatei.ts` nicht importieren, s. dessen
 * Kopfkommentar: `node:fs` geht sonst in den Client-Bundle). Analog zu
 * `roh.slice(0, 2000)` bei Platzierungen: Der Sanitizer kappt beim Lesen
 * standardmäßig (Parameter `deckel`, s. `sanitizeHeightDeltas`), der
 * Schreibweg weist ein Überschreiten zusätzlich mit 422 ab, statt still zu
 * kappen (Angriffsbefund B3) — AUSSER ein vertrauenswürdiger interner
 * Schreiber (PATCH auf eine andere Sammlung, `weltOps.ts`) reicht
 * `heightDeltas` unverändert durch (Angriffsbefund N1, „nicht aussperren“):
 * dann gilt `deckel=false`, und der Rasterinhalt bleibt vollständig erhalten.
 */
const MAX_HOEHENZONEN_LESEN = 4096;
/**
 * Wie viele ROHE Zonen `hoehenkorrekturFehler` höchstens einzeln prüft — viel
 * mehr als `MAX_HOEHENZONEN_LESEN`, weil diese Funktion Fehler auch dann noch
 * melden muss, wenn der Schreibweg die Zonengrenze bewusst ignoriert
 * (`deckel=false`, s. o.); die Zahl bleibt trotzdem endlich (Angriffsbefund
 * N1: „hoehenkorrekturFehler prüft nur die ersten 4096 Einträge“ war der Fund).
 */
const MAX_HOEHENZONEN_PRUEFEN = 65_536;
/**
 * Zeichenlänge, ab der eine `i`/`d`-Liste EINER ZEILE ohne weitere Prüfung
 * verworfen wird — ein billiger Schutz vor dem teuren `split(',')`. Eine
 * Zeile hat höchstens 64 Werte zu höchstens 6 Zeichen (`-10000`); 2000 Zeichen
 * lassen reichlich Luft.
 */
const HOEHENKORREKTUR_ZEICHEN_MAX = 2000;
/** Mehr rohe Zahlen je ZEILE prüft der Parser nicht (der gültige Höchstwert ist 64; Marge gegen Duplikate/Müll). */
const HOEHENKORREKTUR_ROHZAHLEN_JE_ZEILE_MAX = 128;
/** Kanonische Ganzzahl-Textform: optionales `-`, keine führende Null außer der `0` selbst, keine Leerzeichen/Exponent. */
const GANZZAHL_TEXT_RE = /^-?(0|[1-9]\d*)$/;

/** Ganzzahl in [min, max], sonst `null` — Unsinn (Text, NaN, Bruch, außerhalb) wird verworfen, nicht geklemmt. */
function ganzzahlInBereich(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) return null;
  return v < min || v > max ? null : v;
}

/**
 * `i`/`d` (je Zeile) in eine Zahlenliste zerlegen — `null` heißt STRUKTURELL
 * ungültig (kein String, zu lang, zu viele Teile, oder mindestens ein Teil
 * ist keine kanonische Ganzzahl-Textform). Ein leerer String ergibt eine
 * leere Liste (eine Zeile ohne Punkte ist unten ohnehin ausgeschlossen).
 */
function parseZahlenListe(v: unknown): number[] | null {
  if (typeof v !== 'string') return null;
  if (v.length === 0) return [];
  if (v.length > HOEHENKORREKTUR_ZEICHEN_MAX) return null;
  const teile = v.split(',');
  if (teile.length > HOEHENKORREKTUR_ROHZAHLEN_JE_ZEILE_MAX) return null;
  const out: number[] = [];
  for (const t of teile) {
    if (!GANZZAHL_TEXT_RE.test(t)) return null;
    out.push(Number(t));
  }
  return out;
}

/**
 * Eine Zeile `"ry|i|d"` in ihre drei Teile zerlegen — `null` heißt
 * STRUKTURELL ungültig (kein String, oder nicht GENAU zwei `|`-Trenner:
 * `i`/`d` selbst enthalten nie `|`, nur Kommas, also ist ein dritter
 * Trenner immer Müll, kein Wert mit `|` darin).
 */
function zeileTeilen(v: unknown): [string, string, string] | null {
  if (typeof v !== 'string') return null;
  const teile = v.split('|');
  if (teile.length !== 3) return null;
  return [teile[0]!, teile[1]!, teile[2]!];
}

/**
 * `WorldLayout.heightDeltas` aus dem rohen Dokument: pro Zone ein gültiger
 * Zonenschlüssel (`zx`/`zz` ganzzahlig, nicht doppelt), `r` als Liste von
 * Zeilen-Strings `"ry|i|d"` (`ry` 0…63, nicht doppelt; `i`/`d` gleich lange
 * komma-getrennte Ganzzahllisten, Werte `rx` 0…63). Ungültige EINZELNE
 * Punkte (Spalte außerhalb, doppelt, Delta außerhalb ±10 000) verwirft er,
 * ohne die ganze Zeile zu verlieren; **Delta 0 fällt IMMER weg** (N2-
 * Formatentscheidung: ein Punkt ohne Höhenwirkung ist keine Korrektur — er
 * zählt sonst in die Grenzen, erzeugt eine Zeile im Editor-Vergleich und
 * einen Fehlalarm dort). Bleibt eine Zeile ohne gültigen Punkt, entfällt sie;
 * bleibt eine Zone ohne gültige Zeile, entfällt sie ganz. Ist `r`/eine Zeile
 * STRUKTURELL kaputt (kein Array, kein String, nicht genau drei `|`-Teile,
 * `i`/`d` unterschiedliche Länge), entfällt die betroffene Zeile bzw. Zone
 * (kein teilweises Lesen einer korrupten Liste). Ergebnis stabil sortiert
 * (Zone nach `zx`,`zz`, Zeile nach `ry`, Punkte nach `rx`), damit kleine
 * Änderungen kleine Diffs ergeben (git-freundlich, wie bei Platzierungen).
 *
 * `deckel` (Vorgabe `true`) kappt die Zonenzahl beim Lesen auf
 * `MAX_HOEHENZONEN_LESEN` — der normale Weg für jeden Leser. `deckel=false`
 * lässt jede STRUKTURELL gültige Zone durch, unabhängig von der Zahl:
 * NUR für einen Schreiber, der `heightDeltas` nachweislich unverändert
 * durchreicht (PATCH auf eine andere Sammlung, `weltOps.ts`,
 * Angriffsbefund N1 „nicht aussperren“) — ein solcher Schreibvorgang darf
 * eine bereits vorhandene, größere Korrektur nicht stillschweigend kürzen.
 * Die Obergrenze für die GESAMTE Punktzahl (`HOEHENKORREKTUR_PUNKTE_GRENZE`,
 * `layoutDatei.ts`) prüft ohnehin nicht diese Funktion, sondern der
 * Schreibweg VOR dem Sanitizer.
 */
export function sanitizeHeightDeltas(input: unknown, deckel = true): ZoneHeightDelta[] {
  if (!Array.isArray(input)) return [];
  const gesehen = new Set<string>();
  const zonen: ZoneHeightDelta[] = [];
  for (const roh of deckel ? input.slice(0, MAX_HOEHENZONEN_LESEN) : input) {
    if (typeof roh !== 'object' || roh === null) continue;
    const o = roh as Record<string, unknown>;
    const zx = ganzzahlInBereich(o.zx, -HOEHENZONE_MAX, HOEHENZONE_MAX);
    const zz = ganzzahlInBereich(o.zz, -HOEHENZONE_MAX, HOEHENZONE_MAX);
    if (zx === null || zz === null) continue;
    const schluessel = `${zx},${zz}`;
    if (gesehen.has(schluessel)) continue; // doppelter Zonenschlüssel: der zweite Eintrag entfällt
    if (!Array.isArray(o.r)) continue;
    const ryGesehen = new Set<number>();
    const zeilen: [number, string][] = [];
    for (const zeile of o.r.slice(0, HOEHENKORREKTUR_ZEILEN_JE_ZONE_MAX)) {
      const teile = zeileTeilen(zeile);
      if (teile === null || !GANZZAHL_TEXT_RE.test(teile[0])) continue;
      const ry = ganzzahlInBereich(Number(teile[0]), 0, HOEHENKORREKTUR_ZEILE_MAX);
      if (ry === null || ryGesehen.has(ry)) continue; // ry ungültig/doppelt: die Zeile entfällt
      const roheRx = parseZahlenListe(teile[1]);
      const roheDeltas = parseZahlenListe(teile[2]);
      if (roheRx === null || roheDeltas === null || roheRx.length !== roheDeltas.length) continue;
      const rxGesehen = new Set<number>();
      const punkte: [number, number][] = [];
      for (let k = 0; k < roheRx.length; k++) {
        const rx = roheRx[k]!;
        const delta = roheDeltas[k]!;
        if (rx < 0 || rx > HOEHENKORREKTUR_ZEILE_MAX) continue;
        if (delta === 0) continue; // N2: delta 0 hat keine Wirkung und faellt weg
        if (delta < -HOEHENKORREKTUR_DELTA_MAX_CM || delta > HOEHENKORREKTUR_DELTA_MAX_CM) continue;
        if (rxGesehen.has(rx)) continue; // doppeltes rx: der zweite Punkt entfällt
        rxGesehen.add(rx);
        punkte.push([rx, delta]);
      }
      if (punkte.length === 0) continue; // keine gültigen Punkte übrig: die Zeile entfällt
      punkte.sort((a, b) => a[0] - b[0]);
      ryGesehen.add(ry);
      const i = punkte.map((p) => p[0]).join(',');
      const d = punkte.map((p) => p[1]).join(',');
      zeilen.push([ry, `${ry}|${i}|${d}`]);
    }
    if (zeilen.length === 0) continue; // keine gültige Zeile übrig: die Zone entfällt ganz
    zeilen.sort((a, b) => a[0] - b[0]);
    gesehen.add(schluessel);
    zonen.push({ zx, zz, r: zeilen.map((z) => z[1]) });
  }
  zonen.sort((a, b) => a.zx - b.zx || a.zz - b.zz);
  return zonen;
}

/** Ein Befund am ROHEN `heightDeltas`-Eintrag: welche Zone (`zx,zz`, sonst `#<Stelle>`), welches Feld, welcher Wert. */
export interface HoehenkorrekturFehler {
  zone: string;
  feld: string;
  wert: unknown;
}

/**
 * Was am ROHEN `heightDeltas`-Wert (vor dem Sanitizer) verworfen würde: das
 * Feld ist GESETZT, aber kein Array (kaputt, nicht leer — Angriffsbefund N1,
 * dritter Punkt: `heightDeltas: "kaputt"` muss ungültig sein, nicht als
 * „leer“ durchgehen); sonst je Zone ein falscher/doppelter Zonenschlüssel,
 * `r` kein Array, eine Zeile, die kein String mit GENAU drei `|`-Teilen
 * `"ry|i|d"` ist, `ry` kein kanonischer Ganzzahltext oder außerhalb 0…63
 * oder doppelt, `i`/`d` unterschiedlich lang, ein Wert `rx` außerhalb 0…63
 * oder doppelt, ein Delta außerhalb
 * ±10 000 cm. Analog zu `platzierungenFehler`: Der Schreibweg hält mit
 * einem gemeldeten Fund die ganze Datei zurück (422 mit dieser Liste),
 * statt gemischte gültige/ungültige Punkte teilweise zu speichern
 * (Angriffsbefunde B1/B4/N1). `delta 0` ist KEIN Fund (gültig, fällt beim
 * Sanitizer nur lautlos weg, N2).
 */
export function hoehenkorrekturFehler(roh: unknown): HoehenkorrekturFehler[] {
  const fehler: HoehenkorrekturFehler[] = [];
  if (roh === undefined || roh === null) return fehler; // Feld fehlt: das ist gültig leer, kein Fund.
  if (!Array.isArray(roh)) {
    fehler.push({ zone: '—', feld: 'heightDeltas', wert: wertKurz(roh) });
    return fehler;
  }
  const gesehenZonen = new Set<string>();
  roh.slice(0, MAX_HOEHENZONEN_PRUEFEN).forEach((z, i) => {
    if (typeof z !== 'object' || z === null || Array.isArray(z)) {
      fehler.push({ zone: `#${i}`, feld: 'eintrag', wert: wertKurz(z) });
      return;
    }
    const o = z as Record<string, unknown>;
    const zx = ganzzahlInBereich(o.zx, -HOEHENZONE_MAX, HOEHENZONE_MAX);
    const zz = ganzzahlInBereich(o.zz, -HOEHENZONE_MAX, HOEHENZONE_MAX);
    const zone = zx !== null && zz !== null ? `${zx},${zz}` : `#${i}`;
    if (zx === null) fehler.push({ zone, feld: 'zx', wert: wertKurz(o.zx) });
    if (zz === null) fehler.push({ zone, feld: 'zz', wert: wertKurz(o.zz) });
    if (zx !== null && zz !== null) {
      if (gesehenZonen.has(zone)) fehler.push({ zone, feld: 'zone', wert: 'doppelt' });
      else gesehenZonen.add(zone);
    }
    if (!Array.isArray(o.r)) {
      fehler.push({ zone, feld: 'r', wert: wertKurz(o.r) });
      return;
    }
    if (o.r.length > HOEHENKORREKTUR_ZEILEN_JE_ZONE_MAX) {
      fehler.push({ zone, feld: 'r', wert: `${o.r.length} Zeilen` });
    }
    const ryGesehen = new Set<number>();
    (o.r as unknown[]).slice(0, HOEHENKORREKTUR_ZEILEN_JE_ZONE_MAX + 1).forEach((zeile, j) => {
      const teile = zeileTeilen(zeile);
      if (teile === null) {
        fehler.push({ zone, feld: `r[${j}]`, wert: wertKurz(zeile) });
        return;
      }
      const ry = GANZZAHL_TEXT_RE.test(teile[0]) ? ganzzahlInBereich(Number(teile[0]), 0, HOEHENKORREKTUR_ZEILE_MAX) : null;
      if (ry === null) fehler.push({ zone, feld: `r[${j}].ry`, wert: wertKurz(teile[0]) });
      else if (ryGesehen.has(ry)) fehler.push({ zone, feld: `r[${j}].ry`, wert: 'doppelt' });
      else ryGesehen.add(ry);
      const roheRx = parseZahlenListe(teile[1]);
      const roheDeltas = parseZahlenListe(teile[2]);
      if (roheRx === null) {
        fehler.push({ zone, feld: `r[${j}].i`, wert: wertKurz(teile[1]) });
        return;
      }
      if (roheDeltas === null) {
        fehler.push({ zone, feld: `r[${j}].d`, wert: wertKurz(teile[2]) });
        return;
      }
      if (roheRx.length !== roheDeltas.length) {
        fehler.push({ zone, feld: `r[${j}].laenge`, wert: `i=${roheRx.length} d=${roheDeltas.length}` });
        return;
      }
      const rxGesehen = new Set<number>();
      for (let k = 0; k < roheRx.length; k++) {
        const rx = roheRx[k]!;
        const delta = roheDeltas[k]!;
        if (rx < 0 || rx > HOEHENKORREKTUR_ZEILE_MAX) fehler.push({ zone, feld: `r[${j}].rx`, wert: rx });
        else if (rxGesehen.has(rx)) fehler.push({ zone, feld: `r[${j}].rx`, wert: 'doppelt' });
        else rxGesehen.add(rx);
        if (delta < -HOEHENKORREKTUR_DELTA_MAX_CM || delta > HOEHENKORREKTUR_DELTA_MAX_CM) fehler.push({ zone, feld: `r[${j}].delta`, wert: delta });
      }
    });
  });
  return fehler;
}

/** Die Liste als Satz für Editor, KI und Log — analog `platzierungenFehlerText`. */
export function hoehenkorrekturFehlerText(liste: readonly HoehenkorrekturFehler[], max = 20): string {
  const teile = liste.slice(0, max).map((f) => `${f.zone} ${f.feld}=${JSON.stringify(f.wert)}`);
  return teile.join(', ') + (liste.length > max ? ` … (+${liste.length - max})` : '');
}

/**
 * Gesamtzahl der rohen Zonen bzw. Punkte (Summe über alle `r`-Zeilen), ohne
 * den Sanitizer zu bemühen — für die 422-Obergrenzen in `layoutDatei.ts`
 * (und, wenn dort `heightDeltasGrenzeIgnorieren` NICHT gesetzt ist, auch
 * für PATCH/die Live-Wache), VOR jeder teureren Prüfung. `roh.length` ist
 * O(1); bei absichtlich sehr vielen (Müll-)Einträgen wird gar nicht erst
 * gezählt, sondern sofort "eindeutig zu viele" gemeldet (Schutz gegen eine
 * Zählschleife über Millionen Einträge).
 */
export function hoehenkorrekturZaehlen(roh: unknown): { zonen: number; punkte: number } {
  if (!Array.isArray(roh)) return { zonen: 0, punkte: 0 };
  const zonen = roh.length;
  if (zonen > MAX_HOEHENZONEN_LESEN * 4) return { zonen, punkte: Number.POSITIVE_INFINITY };
  let punkte = 0;
  for (const z of roh) {
    if (typeof z !== 'object' || z === null || Array.isArray(z)) continue;
    const r = (z as Record<string, unknown>).r;
    if (!Array.isArray(r)) continue;
    for (const zeile of r) {
      const teile = zeileTeilen(zeile);
      if (teile === null) continue;
      const i = teile[1];
      if (i.length === 0) continue;
      // Nur billig zaehlen (Kommas + 1), nicht voll parsen — reicht fuer die Obergrenze.
      punkte += i.length > HOEHENKORREKTUR_ZEICHEN_MAX ? Number.POSITIVE_INFINITY : i.split(',').length;
    }
  }
  return { zonen, punkte };
}

/** Optionen für `sanitizeWorldLayout(MitBericht)` — heute nur die Handkorrektur betroffen. */
export interface SanitizeOptionen {
  /**
   * `heightDeltas` ohne Zonen-Deckel lesen (`sanitizeHeightDeltas(…, false)`) — NUR für einen
   * Schreiber, der das Feld nachweislich unverändert durchreicht (PATCH auf eine andere
   * Sammlung, `weltOps.ts`, Angriffsbefund N1 „nicht aussperren“). Ohne diese Option gilt der
   * normale Deckel (`MAX_HOEHENZONEN_LESEN`) wie für jeden anderen Leser.
   */
  heightDeltasOhneDeckel?: boolean;
}

export function sanitizeWorldLayout(input: unknown, optionen?: SanitizeOptionen): WorldLayout | null {
  return sanitizeWorldLayoutMitBericht(input, optionen)?.layout ?? null;
}

export function sanitizeWorldLayoutMitBericht(input: unknown, optionen: SanitizeOptionen = {}): SanitizeBericht | null {
  if (typeof input !== 'object' || input === null) return null;
  const d = input as Record<string, unknown>;
  if (d.version !== WORLD_LAYOUT_VERSION) return null;
  if (typeof d.name !== 'string' || d.name.length === 0 || d.name.length > 128) return null;
  const detailSeed =
    typeof d.detailSeed === 'string' && d.detailSeed.length > 0 && d.detailSeed.length <= 64
      ? d.detailSeed
      : 'wov';

  const continents: ContinentDef[] = [];
  if (Array.isArray(d.continents)) {
    const ids = new Set<string>();
    for (const c of d.continents.slice(0, MAX_CONTINENTS)) {
      if (typeof c !== 'object' || c === null) continue;
      const k = c as Record<string, unknown>;
      if (typeof k.id !== 'string' || !ID_RE.test(k.id) || ids.has(k.id)) continue;
      if (typeof k.name !== 'string' || k.name.length === 0 || k.name.length > 128) continue;
      ids.add(k.id);
      const kontinent: ContinentDef = { id: k.id, name: k.name };
      if (k.faction === 'saxon' || k.faction === 'viking' || k.faction === 'neutral') {
        kontinent.faction = k.faction;
      }
      if (Array.isArray(k.spawn) && k.spawn.length === 2) {
        const sx = koordinate(k.spawn[0]);
        const sz = koordinate(k.spawn[1]);
        if (sx !== null && sz !== null) kontinent.spawn = [sx, sz];
      }
      continents.push(kontinent);
    }
  }

  const regions: RegionDef[] = [];
  if (Array.isArray(d.regions)) {
    const ids = new Set<string>();
    for (const r of d.regions.slice(0, MAX_REGIONS)) {
      const region = sanitizeRegion(r, ids);
      if (!region) continue;
      ids.add(region.id);
      regions.push(region);
    }
  }

  const roheEintraege = platzierungenEinzeln(d.placements);
  // Exakte Duplikate zusammenfassen, jedem Eintrag eine eindeutige `id` geben,
  // nach `id` sortieren (platzierungsId.ts).
  const { placements, zusammengefasst } = platzierungenNormalisieren(roheEintraege);

  const rivers: RiverDef[] = [];
  if (Array.isArray(d.rivers)) {
    const ids = new Set<string>();
    for (const r of d.rivers.slice(0, 256)) {
      if (typeof r !== 'object' || r === null) continue;
      const o = r as Record<string, unknown>;
      // Eine doppelte ID verwirft den zweiten Eintrag (wie bei Regionen und
      // Routen): Zwei Flüsse mit einer Adresse wären für jede Operation
      // uneindeutig. Das Zählen der verworfenen Einträge (layoutDatei) meldet es.
      if (typeof o.id !== 'string' || !ID_RE.test(o.id) || ids.has(o.id)) continue;
      if (!Array.isArray(o.points) || o.points.length < 2 || o.points.length > MAX_POLYGON_POINTS) continue;
      const points: [number, number][] = [];
      let ok = true;
      for (const p of o.points) {
        if (!Array.isArray(p) || p.length !== 2) { ok = false; break; }
        const x = koordinate(p[0]);
        const z = koordinate(p[1]);
        if (x === null || z === null) { ok = false; break; }
        points.push([x, z]);
      }
      if (!ok) continue;
      ids.add(o.id);
      const fluss: RiverDef = { id: o.id, points, width: klemm(o.width, 4, 400, 30) };
      if (o.depth !== undefined) fluss.depth = klemm(o.depth, 1, 60, 6);
      rivers.push(fluss);
    }
  }

  const lakes: LakeDef[] = [];
  if (Array.isArray(d.lakes)) {
    const ids = new Set<string>();
    for (const l of d.lakes.slice(0, 256)) {
      if (typeof l !== 'object' || l === null) continue;
      const o = l as Record<string, unknown>;
      if (typeof o.id !== 'string' || !ID_RE.test(o.id) || ids.has(o.id)) continue;
      const x = koordinate(o.x);
      const z = koordinate(o.z);
      if (x === null || z === null) continue;
      ids.add(o.id);
      const see: LakeDef = { id: o.id, x, z, radius: klemm(o.radius, 8, 5000, 200) };
      if (o.depth !== undefined) see.depth = klemm(o.depth, 1, 60, 8);
      lakes.push(see);
    }
  }

  const routes: RouteDef[] = [];
  if (Array.isArray(d.routes)) {
    const ids = new Set<string>();
    for (const r of d.routes.slice(0, MAX_ROUTEN)) {
      if (typeof r !== 'object' || r === null) continue;
      const o = r as Record<string, unknown>;
      if (typeof o.id !== 'string' || !ID_RE.test(o.id) || ids.has(o.id)) continue;
      if (!Array.isArray(o.points) || o.points.length < 1 || o.points.length > MAX_POLYGON_POINTS) continue;
      // Zwei Formen, eine Bedeutung: [x, z] läuft durch, [x, z, pause]
      // wartet dort. Das dritte Element ist die einzige Abweichung vom
      // alten Format — bestehende Dokumente kommen unverändert durch, und
      // ein Punkt ohne Pause wird auch wieder OHNE drittes Element
      // geschrieben (stabiler Round-Trip).
      const points: Wegpunkt[] = [];
      let ok = true;
      for (const p of o.points) {
        if (!Array.isArray(p) || p.length < 2 || p.length > 3) { ok = false; break; }
        const x = koordinate(p[0]);
        const z = koordinate(p[1]);
        if (x === null || z === null) { ok = false; break; }
        // Unsinn (NaN, negativ, Text) heißt „keine Pause": Ein Punkt, an
        // dem der NPC nicht wartet, ist die harmlose Annahme — dafür die
        // ganze Route zu verwerfen wäre unverhältnismäßig.
        const pause = p.length === 3 ? klemm(p[2], 0, ROUTE_MAX_PAUSE, 0) : 0;
        points.push(pause > 0 ? [x, z, Math.round(pause * 1000) / 1000] : [x, z]);
      }
      if (!ok) continue;
      ids.add(o.id);
      // Unbekannter Modus → 'loop': Eine Runde ist die harmlosere Annahme,
      // der NPC bleibt in jedem Fall auf seinen Wegpunkten.
      const route: RouteDef = { id: o.id, points, mode: o.mode === 'pingpong' ? 'pingpong' : 'loop' };
      // Obergrenze 10 m/s: schneller als ein sprintender Spieler wäre keine
      // Route mehr, sondern ein Teleport zwischen den Sync-Takten.
      if (o.speed !== undefined) route.speed = klemm(o.speed, 0.2, 10, ROUTE_DEFAULT_SPEED);
      routes.push(route);
    }
  }

  let defaultSpawn: readonly [number, number] | undefined;
  if (Array.isArray(d.defaultSpawn) && d.defaultSpawn.length === 2) {
    const sx = koordinate(d.defaultSpawn[0]);
    const sz = koordinate(d.defaultSpawn[1]);
    if (sx !== null && sz !== null) defaultSpawn = [sx, sz];
  }

  const heightDeltas = sanitizeHeightDeltas(d.heightDeltas, !optionen.heightDeltasOhneDeckel);

  const layout: WorldLayout = {
    version: WORLD_LAYOUT_VERSION,
    name: d.name,
    detailSeed,
    continents,
    regions,
    ...(placements.length > 0 ? { placements } : {}),
    ...(defaultSpawn ? { defaultSpawn } : {}),
    ...(rivers.length > 0 ? { rivers } : {}),
    ...(lakes.length > 0 ? { lakes } : {}),
    ...(routes.length > 0 ? { routes } : {}),
    ...(heightDeltas.length > 0 ? { heightDeltas } : {}),
  };
  merkeZusammengefasst(layout, zusammengefasst);
  return { layout, zusammengefasst };
}
