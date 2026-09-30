/**
 * Validation of kit files and kit instances (editor block C2). DOM-free and free
 * of server/client imports: the converter tools run this through tsx.
 *
 * Two different attitudes on purpose:
 *  - a kit FILE is authored by tools; every violation is a named message and the
 *    file is rejected as a whole (`sanitizeBausatzMitBericht`) — never a silent clamp;
 *  - kit INSTANCES in the world document are clamped and dropped like routes
 *    (`sanitizeBausatzInstanzen`); the write path rejects what the sanitizer
 *    would change (`bausatzInstanzenFehler`, 422).
 */

import { ID_RE } from '../worldlayout/platzierungsId.js';
import { LAYOUT_MAX_EXTENT } from '../worldlayout/types.js';
import {
  BAUSATZ_BOESCHUNG_MAX,
  BAUSATZ_BOESCHUNG_MIN,
  BAUSATZ_DXZ_MAX,
  BAUSATZ_DY_MAX,
  BAUSATZ_EBNUNG_HALB_MAX,
  BAUSATZ_EBNUNG_HALB_MIN,
  BAUSATZ_INSTANZEN_MAX,
  BAUSATZ_SKALA_MAX,
  BAUSATZ_SKALA_MIN,
  BAUSATZ_TEILE_MAX,
  BAUSATZ_VERSION,
  BAUSATZ_WINKEL_MAX,
  type Bausatz,
  type BausatzGruppe,
  type BausatzInstanzDef,
  type BausatzSkala,
  type BausatzTeil,
} from './types.js';

/** Largest circular plinth radius of a part (m); same as `PLATZIERUNG_EINEBNEN_MAX`. */
const EINEBNEN_MAX = 100;
const PREFAB_LAENGE_MAX = 64;
const NAME_LAENGE_MAX = 128;

/** Position values: millimetres, like the world sanitizer. `+ 0` turns -0 into 0. */
export const rundePosition = (v: number): number => Math.round(v * 1000) / 1000 + 0;
/** Angles and scale: 1e-6, like the world sanitizer. */
export const rundeWinkel = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;

const istZahl = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const istObjekt = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const inBereich = (v: unknown, min: number, max: number): v is number => istZahl(v) && v >= min && v <= max;

function schluesselFremd(o: Record<string, unknown>, erlaubt: ReadonlySet<string>): string[] {
  return Object.keys(o).filter((k) => !erlaubt.has(k));
}

// ── Kit file ────────────────────────────────────────────────────────────

const DATEI_SCHLUESSEL = new Set(['bausatzVersion', 'id', 'name', 'grundflaeche', 'ebnung', 'gruppen', 'teile']);
const TEIL_SCHLUESSEL = new Set(['id', 'prefab', 'dx', 'dz', 'dy', 'yaw', 'pitch', 'roll', 'scale', 'einebnen', 'gruppe']);

export interface BausatzOptionen {
  /** The file name without `.json`; the kit id must equal it. */
  erwarteteId?: string;
}

export interface BausatzBericht {
  /** Canonical kit; `null` as soon as `fehler` is not empty. */
  bausatz: Bausatz | null;
  /** Named messages, in reading order. Never silent capping. */
  fehler: string[];
}

function skalaPruefen(roh: unknown): BausatzSkala | null {
  const komponente = (v: unknown): boolean => istZahl(v) && Math.abs(v) >= BAUSATZ_SKALA_MIN && Math.abs(v) <= BAUSATZ_SKALA_MAX;
  if (komponente(roh)) return rundeWinkel(roh as number);
  if (Array.isArray(roh) && roh.length === 3 && roh.every(komponente)) {
    return roh.map((v) => rundeWinkel(v as number)) as [number, number, number];
  }
  return null;
}

/**
 * Checks a raw kit file and returns it in canonical form: rounded (position
 * 1e-3, angle and scale 1e-6), parts and groups sorted by id, fixed key order.
 * Any violation makes the whole file unusable and is named in `fehler`.
 */
export function sanitizeBausatzMitBericht(input: unknown, optionen: BausatzOptionen = {}): BausatzBericht {
  const fehler: string[] = [];
  const ab = (): BausatzBericht => ({ bausatz: null, fehler });
  if (!istObjekt(input)) {
    fehler.push('Bausatz ist kein Objekt');
    return ab();
  }
  const d = input;
  if (d.bausatzVersion !== BAUSATZ_VERSION) {
    const v = d.bausatzVersion === undefined ? 'fehlt' : JSON.stringify(d.bausatzVersion);
    fehler.push(
      d.bausatzVersion === undefined
        ? `Bausatz-Version fehlt (kann ${BAUSATZ_VERSION})`
        : `Bausatz-Version ${v} unbekannt (kann ${BAUSATZ_VERSION})`
    );
    return ab(); // the rest of the layout may differ in any way
  }
  for (const k of schluesselFremd(d, DATEI_SCHLUESSEL)) fehler.push(`Bausatz: unbekannter Schlüssel "${k}"`);
  if (typeof d.id !== 'string' || !ID_RE.test(d.id)) fehler.push('Bausatz: id fehlt oder ist keine gültige Kennung');
  else if (optionen.erwarteteId !== undefined && d.id !== optionen.erwarteteId) {
    fehler.push(`Bausatz: id "${d.id}" ist nicht der Dateiname "${optionen.erwarteteId}"`);
  }
  if (typeof d.name !== 'string' || d.name.length === 0 || d.name.length > NAME_LAENGE_MAX) {
    fehler.push(`Bausatz: name fehlt oder ist länger als ${NAME_LAENGE_MAX} Zeichen`);
  }

  let grundflaeche: Bausatz['grundflaeche'] | null = null;
  if (istObjekt(d.grundflaeche) && inBereich(d.grundflaeche.halbX, 0.001, BAUSATZ_DXZ_MAX) && inBereich(d.grundflaeche.halbZ, 0.001, BAUSATZ_DXZ_MAX)) {
    grundflaeche = { halbX: rundePosition(d.grundflaeche.halbX), halbZ: rundePosition(d.grundflaeche.halbZ) };
  } else {
    fehler.push(`Bausatz: grundflaeche {halbX, halbZ} fehlt oder liegt außerhalb 0,001…${BAUSATZ_DXZ_MAX} m`);
  }

  let ebnung: Bausatz['ebnung'];
  if (d.ebnung !== undefined) {
    const e = d.ebnung;
    if (
      istObjekt(e) &&
      inBereich(e.halbX, BAUSATZ_EBNUNG_HALB_MIN, BAUSATZ_EBNUNG_HALB_MAX) &&
      inBereich(e.halbZ, BAUSATZ_EBNUNG_HALB_MIN, BAUSATZ_EBNUNG_HALB_MAX) &&
      inBereich(e.boeschung, BAUSATZ_BOESCHUNG_MIN, BAUSATZ_BOESCHUNG_MAX)
    ) {
      ebnung = { halbX: rundePosition(e.halbX), halbZ: rundePosition(e.halbZ), boeschung: rundePosition(e.boeschung) };
    } else {
      fehler.push(
        `Bausatz: ebnung braucht halbX und halbZ in ${BAUSATZ_EBNUNG_HALB_MIN}…${BAUSATZ_EBNUNG_HALB_MAX} m und boeschung in ${BAUSATZ_BOESCHUNG_MIN}…${BAUSATZ_BOESCHUNG_MAX} m`
      );
    }
  }

  const gruppen: BausatzGruppe[] = [];
  const gruppenIds = new Set<string>();
  if (d.gruppen !== undefined) {
    if (!Array.isArray(d.gruppen)) fehler.push('Bausatz: gruppen ist keine Liste');
    else {
      d.gruppen.forEach((g, i) => {
        if (!istObjekt(g) || typeof g.id !== 'string' || !ID_RE.test(g.id) || typeof g.name !== 'string' || g.name.length === 0 || g.name.length > NAME_LAENGE_MAX) {
          fehler.push(`Bausatz: Gruppe #${i} braucht id (Kennung) und name`);
        } else if (gruppenIds.has(g.id)) fehler.push(`Bausatz: Gruppe "${g.id}" kommt doppelt vor`);
        else {
          gruppenIds.add(g.id);
          gruppen.push({ id: g.id, name: g.name });
        }
      });
    }
  }

  const teile: BausatzTeil[] = [];
  if (!Array.isArray(d.teile)) fehler.push('Bausatz: teile fehlt oder ist keine Liste');
  else if (d.teile.length > BAUSATZ_TEILE_MAX) {
    fehler.push(`Bausatz: ${d.teile.length} Teile — mehr als ${BAUSATZ_TEILE_MAX} nimmt ein Bausatz nicht auf; nichts gekappt`);
  } else {
    const ids = new Set<string>();
    d.teile.forEach((t, i) => {
      const wo = istObjekt(t) && typeof t.id === 'string' && t.id.length <= 64 ? `Teil "${t.id}"` : `Teil #${i}`;
      if (!istObjekt(t)) {
        fehler.push(`Bausatz: ${wo} ist kein Objekt`);
        return;
      }
      const vorher = fehler.length;
      for (const k of schluesselFremd(t, TEIL_SCHLUESSEL)) fehler.push(`Bausatz: ${wo}: unbekannter Schlüssel "${k}"`);
      if (typeof t.id !== 'string' || !ID_RE.test(t.id)) fehler.push(`Bausatz: ${wo}: id fehlt oder ist keine gültige Kennung`);
      else if (ids.has(t.id)) fehler.push(`Bausatz: ${wo}: id kommt doppelt vor`);
      else ids.add(t.id);
      if (typeof t.prefab !== 'string' || t.prefab.length === 0 || t.prefab.length > PREFAB_LAENGE_MAX) fehler.push(`Bausatz: ${wo}: prefab fehlt oder ist zu lang`);
      if (!inBereich(t.dx, -BAUSATZ_DXZ_MAX, BAUSATZ_DXZ_MAX)) fehler.push(`Bausatz: ${wo}: dx außerhalb ±${BAUSATZ_DXZ_MAX} m`);
      if (!inBereich(t.dz, -BAUSATZ_DXZ_MAX, BAUSATZ_DXZ_MAX)) fehler.push(`Bausatz: ${wo}: dz außerhalb ±${BAUSATZ_DXZ_MAX} m`);
      if (t.dy !== undefined && !inBereich(t.dy, -BAUSATZ_DY_MAX, BAUSATZ_DY_MAX)) fehler.push(`Bausatz: ${wo}: dy außerhalb ±${BAUSATZ_DY_MAX} m`);
      if (!inBereich(t.yaw, -BAUSATZ_WINKEL_MAX, BAUSATZ_WINKEL_MAX)) fehler.push(`Bausatz: ${wo}: yaw fehlt oder liegt außerhalb ±2π`);
      for (const w of ['pitch', 'roll'] as const) {
        if (t[w] !== undefined && !inBereich(t[w], -BAUSATZ_WINKEL_MAX, BAUSATZ_WINKEL_MAX)) fehler.push(`Bausatz: ${wo}: ${w} außerhalb ±2π`);
      }
      const skala = skalaPruefen(t.scale);
      if (skala === null) {
        fehler.push(`Bausatz: ${wo}: scale muss eine Zahl oder ein Tripel sein, jede Komponente mit Betrag ${BAUSATZ_SKALA_MIN}…${BAUSATZ_SKALA_MAX} (negativ = gespiegelt, 0 verboten)`);
      }
      if (t.einebnen !== undefined && !inBereich(t.einebnen, 1, EINEBNEN_MAX)) fehler.push(`Bausatz: ${wo}: einebnen außerhalb 1…${EINEBNEN_MAX} m`);
      if (t.gruppe !== undefined && !(typeof t.gruppe === 'string' && gruppenIds.has(t.gruppe))) {
        fehler.push(`Bausatz: ${wo}: gruppe zeigt auf keine vorhandene Gruppe`);
      }
      if (fehler.length > vorher || skala === null) return;
      const teil: BausatzTeil = {
        id: t.id as string,
        prefab: t.prefab as string,
        dx: rundePosition(t.dx as number),
        dz: rundePosition(t.dz as number),
        ...(t.dy !== undefined ? { dy: rundePosition(t.dy as number) } : {}),
        yaw: rundeWinkel(t.yaw as number),
        ...(t.pitch !== undefined && rundeWinkel(t.pitch as number) !== 0 ? { pitch: rundeWinkel(t.pitch as number) } : {}),
        ...(t.roll !== undefined && rundeWinkel(t.roll as number) !== 0 ? { roll: rundeWinkel(t.roll as number) } : {}),
        scale: skala,
        ...(t.einebnen !== undefined ? { einebnen: Math.round((t.einebnen as number) * 10) / 10 } : {}),
        ...(t.gruppe !== undefined ? { gruppe: t.gruppe as string } : {}),
      };
      teile.push(teil);
    });
  }

  if (fehler.length > 0 || grundflaeche === null) return ab();
  const nachId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  gruppen.sort(nachId);
  teile.sort(nachId);
  const bausatz: Bausatz = {
    bausatzVersion: BAUSATZ_VERSION,
    id: d.id as string,
    name: d.name as string,
    grundflaeche,
    ...(ebnung ? { ebnung } : {}),
    ...(gruppen.length > 0 ? { gruppen } : {}),
    teile,
  };
  return { bausatz, fehler };
}

/** The canonical kit, or `null` if the file is unusable (the reasons: `sanitizeBausatzMitBericht`). */
export function sanitizeBausatz(input: unknown, optionen: BausatzOptionen = {}): Bausatz | null {
  return sanitizeBausatzMitBericht(input, optionen).bausatz;
}

/**
 * The canonical serialisation of a kit file: rounded, parts sorted by id, fixed
 * key order, `JSON.stringify(…, null, 2) + "\n"`. Sanitizer, converter and tests
 * all use this one function. Throws with the named messages if the kit is not valid.
 */
export function bausatzText(datei: unknown): string {
  const bericht = sanitizeBausatzMitBericht(datei);
  if (bericht.bausatz === null) throw new Error(`Bausatz ungültig: ${bericht.fehler.join('; ')}`);
  return JSON.stringify(bericht.bausatz, null, 2) + '\n';
}

// ── Kit instances in the world document ─────────────────────────────────

const INSTANZ_SCHLUESSEL = new Set(['id', 'bausatz', 'x', 'z', 'yaw', 'kennungen']);

function koordinate(v: unknown): number | null {
  if (!istZahl(v) || Math.abs(v) > LAYOUT_MAX_EXTENT) return null;
  return rundePosition(v);
}

/** `belegt` = the values already taken in the document (by earlier instances and by placements). */
function kennungenBereinigen(roh: unknown, belegt: ReadonlySet<string>): Record<string, string> | undefined {
  if (!istObjekt(roh)) return undefined;
  const aus: Record<string, string> = {};
  const hier = new Set<string>();
  for (const teilId of Object.keys(roh).sort()) {
    const wert = roh[teilId];
    if (!ID_RE.test(teilId) || typeof wert !== 'string' || !ID_RE.test(wert) || belegt.has(wert) || hier.has(wert)) continue;
    hier.add(wert);
    aus[teilId] = wert;
  }
  return Object.keys(aus).length > 0 ? aus : undefined;
}

function instanzEinzeln(roh: unknown, belegt: ReadonlySet<string> = new Set()): BausatzInstanzDef | null {
  if (!istObjekt(roh)) return null;
  if (typeof roh.id !== 'string' || !ID_RE.test(roh.id) || typeof roh.bausatz !== 'string' || !ID_RE.test(roh.bausatz)) return null;
  const x = koordinate(roh.x);
  const z = koordinate(roh.z);
  if (x === null || z === null) return null;
  const yaw = roh.yaw === undefined ? 0 : rundeWinkel(Math.min(BAUSATZ_WINKEL_MAX, Math.max(-BAUSATZ_WINKEL_MAX, Number.isFinite(Number(roh.yaw)) ? Number(roh.yaw) : 0)));
  const kennungen = kennungenBereinigen(roh.kennungen, belegt);
  return { id: roh.id, bausatz: roh.bausatz, x, z, ...(yaw !== 0 ? { yaw } : {}), ...(kennungen ? { kennungen } : {}) };
}

/**
 * Clamps and drops raw instances like routes: a bad entry disappears, the first
 * of two entries with the same id stays, at most `BAUSATZ_INSTANZEN_MAX` are read.
 * A `kennungen` value that equals a placement id (`platzierungsIds`) or was given
 * to an earlier instance is dropped (the write path rejects it instead).
 * Sorted by id, so writing the list twice gives the same bytes.
 */
export function sanitizeBausatzInstanzen(roh: unknown, platzierungsIds: ReadonlySet<string> = new Set()): BausatzInstanzDef[] {
  if (!Array.isArray(roh)) return [];
  const aus: BausatzInstanzDef[] = [];
  const ids = new Set<string>();
  const belegt = new Set(platzierungsIds);
  for (const e of roh.slice(0, BAUSATZ_INSTANZEN_MAX)) {
    const i = instanzEinzeln(e, belegt);
    if (i === null || ids.has(i.id)) continue;
    ids.add(i.id);
    for (const w of Object.values(i.kennungen ?? {})) belegt.add(w);
    aus.push(i);
  }
  return aus.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** One finding on a RAW instance: which instance (`id`, else `#<index>`), which field, which value (shortened). */
export interface BausatzInstanzFehler {
  id: string;
  feld: string;
  wert: unknown;
}

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
  return text === undefined ? typeof v : text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/**
 * What the sanitizer would drop or change on the RAW `bausaetze` list, for the
 * write path (422 with `fehlerhaft`, nothing saved):
 *  - `eintrag`: instance is not an object;
 *  - `id` / `bausatz`: missing or not an `ID_RE` id;
 *  - `x` / `z`: not a number inside the world frame;
 *  - `schluessel`: unknown key;
 *  - `id` = `doppelt`: the same id twice with different content;
 *  - `kennungen`: not an object, a value that is no `ID_RE` id, a value equal to
 *    an id in `platzierungsIds` (the placement ids of the same document), or a value given twice
 *    (in one instance or across instances).
 * An unknown KIT is not among them: that is a finding of `pruefeLayout`, so the
 * document stays writable on a machine without that kit file.
 * Only the first `BAUSATZ_INSTANZEN_MAX` entries are looked at; more is a separate
 * rejection (`LayoutZuVieleBausaetze`).
 */
export function bausatzInstanzenFehler(roh: unknown, platzierungsIds: ReadonlySet<string> = new Set()): BausatzInstanzFehler[] {
  const fehler: BausatzInstanzFehler[] = [];
  if (!Array.isArray(roh)) return fehler;
  const erste = new Map<string, string>();
  const gemeldet = new Set<string>();
  const vergebenGlobal = new Set<string>(); // kennungen values over ALL instances: one address, one part
  roh.slice(0, BAUSATZ_INSTANZEN_MAX).forEach((e, i) => {
    const id = istObjekt(e) && typeof e.id === 'string' && e.id.length <= 64 ? e.id : `#${i}`;
    if (!istObjekt(e)) {
      fehler.push({ id, feld: 'eintrag', wert: wertKurz(e) });
      return;
    }
    const wiederholt = typeof e.id === 'string' && erste.has(e.id); // a repeat of an earlier id: its kennungen are not counted again
    if (typeof e.id !== 'string' || !ID_RE.test(e.id)) fehler.push({ id, feld: 'id', wert: wertKurz(e.id) });
    if (typeof e.bausatz !== 'string' || !ID_RE.test(e.bausatz)) fehler.push({ id, feld: 'bausatz', wert: wertKurz(e.bausatz) });
    if (koordinate(e.x) === null) fehler.push({ id, feld: 'x', wert: wertKurz(e.x) });
    if (koordinate(e.z) === null) fehler.push({ id, feld: 'z', wert: wertKurz(e.z) });
    for (const k of schluesselFremd(e, INSTANZ_SCHLUESSEL)) fehler.push({ id, feld: 'schluessel', wert: k });
    if (e.kennungen !== undefined) {
      if (!istObjekt(e.kennungen)) fehler.push({ id, feld: 'kennungen', wert: wertKurz(e.kennungen) });
      else {
        for (const teilId of Object.keys(e.kennungen).sort()) {
          const wert = e.kennungen[teilId];
          if (typeof wert !== 'string' || !ID_RE.test(wert)) fehler.push({ id, feld: 'kennungen', wert: `${teilId}: ${JSON.stringify(wertKurz(wert))}` });
          else if (platzierungsIds.has(wert)) fehler.push({ id, feld: 'kennungen', wert: `${teilId}: ${wert} (Platzierungs-id)` });
          else if (!wiederholt && vergebenGlobal.has(wert)) fehler.push({ id, feld: 'kennungen', wert: `${teilId}: ${wert} (doppelt)` });
          if (typeof wert === 'string' && !wiederholt) vergebenGlobal.add(wert);
        }
      }
    }
    if (typeof e.id === 'string' && ID_RE.test(e.id)) {
      const einzeln = instanzEinzeln(e);
      if (einzeln) {
        const text = JSON.stringify(einzeln);
        const vorher = erste.get(e.id);
        if (vorher === undefined) erste.set(e.id, text);
        else if (vorher !== text && !gemeldet.has(e.id)) {
          gemeldet.add(e.id);
          fehler.push({ id: e.id, feld: 'id', wert: 'doppelt' });
        }
      }
    }
  });
  return fehler;
}

/** The findings as one sentence: `dorf x="abc"`, at most `max`, the rest as a number. */
export function bausatzInstanzenFehlerText(liste: readonly BausatzInstanzFehler[], max = 20): string {
  const teile = liste.slice(0, max).map((f) => `${f.id} ${f.feld}=${JSON.stringify(f.wert)}`);
  return teile.join(', ') + (liste.length > max ? ` … (+${liste.length - max})` : '');
}
