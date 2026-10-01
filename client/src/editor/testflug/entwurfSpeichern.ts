/**
 * Publishing the draft of the offline flight, DOM-free: read, sanitise,
 * refuse a draft the sanitiser would silently cut, send. Shared by the plain
 * save button, the route editor and "Speichern & neu starten" (`neustart.ts`),
 * so all three refuse the same way.
 *
 * Entwurf in die Welt speichern, ohne DOM: lesen, bereinigen, einen Entwurf
 * ablehnen, den der Sanitizer still beschneiden würde, senden. Gemeinsam für den
 * einfachen Speichern-Knopf, den Routen-Editor und „Speichern & neu starten“.
 *
 * Why the extra checks (F1, M2): `sanitizeWorldLayout` drops a damaged or
 * oversized `heightDeltas`, a region with a duplicate id, a river or lake with a
 * broken shape, a placement with a broken coordinate … WITHOUT a word. The
 * service would see a valid document and overwrite what the draft meant. So the
 * report is read first, and anything the sanitiser would drop stops the save
 * before anything is sent (nothing is sent, nothing restarts).
 *
 * Warum die Zusatzprüfungen (F1, M2): Der Sanitizer wirft eine beschädigte
 * `heightDeltas`, eine Region mit doppelter id, einen Fluss oder See mit kaputter
 * Form, eine Platzierung mit kaputter Koordinate … STILL weg. Der Dienst sähe ein
 * gültiges Dokument. Darum wird zuerst der Bericht gelesen; was der Sanitizer
 * verwerfen würde, hält das Speichern an, bevor etwas gesendet wird.
 */
import { sanitizeWorldLayoutMitBericht } from '@wov/shared';
import type { SpeicherAntwort } from './TestflugPersistenz';
import { speicherText } from './TestflugPersistenz';
import { t } from '../i18n';

export type HoehenProblem = { reason: 'invalid' | 'limit' | 'inspection-limit'; zonen: number; punkte: number };

/** The collections whose entries the sanitiser can drop (besides `heightDeltas`, which has its own check). */
export const GEPRUEFTE_SAMMLUNGEN = ['continents', 'regions', 'placements', 'rivers', 'lakes', 'routes', 'bausaetze', 'defaultSpawn'] as const;
export type Sammlung = (typeof GEPRUEFTE_SAMMLUNGEN)[number];
/** `keineListe`: the collection is there but not a list (R2); `anzahl` is then 1. */
export type VerworfenTeil = { feld: Sammlung; anzahl: number; keineListe?: true };

export type EntwurfErgebnis =
  | { art: 'kein-entwurf' }
  | { art: 'unbrauchbar' }
  /** The draft in the browser storage cannot be read (broken JSON, storage off). */
  | { art: 'unlesbar'; fehler: string }
  | { art: 'hoehe'; problem: HoehenProblem }
  /** The sanitiser would drop entries (count per collection): nothing was sent. */
  | { art: 'verworfen'; teile: VerworfenTeil[] }
  /** The service answered; `antwort.ok` says whether it took the draft. */
  | { art: 'antwort'; antwort: SpeicherAntwort; leereRouten: number }
  /** The request itself threw (network). */
  | { art: 'ausnahme'; fehler: string };

export interface EntwurfDienste {
  /** The draft as stored; `null` = none. May throw. */
  laden(): object | null;
  /** The stored draft as raw text, if the store has one (a cheap change marker). */
  rohtext?(): string | null;
  speichern(dokument: object): Promise<SpeicherAntwort>;
}

/** Routes of the raw draft with an empty point list: "Neue Route" writes exactly that, before the first point (R1). */
export function leereRoutenZaehlen(roh: object): number {
  const routen = (roh as Record<string, unknown>).routes;
  if (!Array.isArray(routen)) return 0;
  return routen.filter((r) => typeof r === 'object' && r !== null && Array.isArray((r as { points?: unknown }).points) && (r as { points: unknown[] }).points.length === 0).length;
}

/**
 * Entries of the raw draft that the sanitiser dropped. Duplicates it merged into one entry
 * (`zusammengefasst`) are not lost and not counted; neither are routes that fall away only because they have no
 * point yet (`leereRouten`, R1: they are announced, not blocked). `heightDeltas` is handled by `heightProblem`.
 * A collection that is present but not a list counts as damaged (R2).
 */
export function verworfenePruefen(roh: object, layout: object, zusammengefasst: number, leereRouten = 0): VerworfenTeil[] {
  const r = roh as Record<string, unknown>;
  const l = layout as Record<string, unknown>;
  const teile: VerworfenTeil[] = [];
  for (const feld of GEPRUEFTE_SAMMLUNGEN) {
    if (feld === 'defaultSpawn') {
      if (r[feld] !== undefined && r[feld] !== null && l[feld] === undefined) teile.push({ feld, anzahl: 1 });
      continue;
    }
    const wert = r[feld];
    if (wert !== undefined && wert !== null && !Array.isArray(wert)) {
      teile.push({ feld, anzahl: 1, keineListe: true });
      continue;
    }
    const vorher = Array.isArray(wert) ? wert.length : 0;
    const nachher = Array.isArray(l[feld]) ? (l[feld] as unknown[]).length : 0;
    const anzahl = vorher - nachher - (feld === 'placements' ? zusammengefasst : 0) - (feld === 'routes' ? leereRouten : 0);
    if (anzahl > 0) teile.push({ feld, anzahl });
  }
  return teile;
}

export async function entwurfSpeichern(d: EntwurfDienste): Promise<EntwurfErgebnis> {
  let roh: object | null;
  try {
    roh = d.laden();
  } catch (err) {
    return { art: 'unlesbar', fehler: String(err) };
  }
  if (!roh) return { art: 'kein-entwurf' };
  const bericht = sanitizeWorldLayoutMitBericht(roh as never);
  if (!bericht) return { art: 'unbrauchbar' };
  if (bericht.heightProblem) {
    const p = bericht.heightProblem;
    return { art: 'hoehe', problem: { reason: p.reason, zonen: p.zonen, punkte: p.punkte } };
  }
  const leereRouten = leereRoutenZaehlen(roh);
  const teile = verworfenePruefen(roh, bericht.layout, bericht.zusammengefasst.length, leereRouten);
  if (teile.length > 0) return { art: 'verworfen', teile };
  try {
    return { art: 'antwort', antwort: await d.speichern(bericht.layout), leereRouten };
  } catch (err) {
    return { art: 'ausnahme', fehler: String(err) };
  }
}

export function hoehenGrund(p: HoehenProblem): string {
  if (p.reason === 'limit') return t('testflug.gelaende.hoehe.grund_limit', { zonen: p.zonen, punkte: p.punkte });
  if (p.reason === 'inspection-limit') return t('testflug.gelaende.hoehe.grund_pruefgrenze');
  return t('testflug.gelaende.hoehe.grund_ungueltig');
}

function sammlungName(feld: Sammlung): string {
  switch (feld) {
    case 'continents':
      return t('testflug.gelaende.verworfen.art.continents');
    case 'regions':
      return t('testflug.gelaende.verworfen.art.regions');
    case 'placements':
      return t('testflug.gelaende.verworfen.art.placements');
    case 'rivers':
      return t('testflug.gelaende.verworfen.art.rivers');
    case 'lakes':
      return t('testflug.gelaende.verworfen.art.lakes');
    case 'routes':
      return t('testflug.gelaende.verworfen.art.routes');
    case 'bausaetze':
      return t('testflug.gelaende.verworfen.art.bausaetze');
    case 'defaultSpawn':
      return t('testflug.gelaende.verworfen.art.defaultSpawn');
  }
}

/** „Regionen: 1, Flüsse: 2“ */
export function verworfenText(teile: readonly VerworfenTeil[]): string {
  return teile.map((x) => `${sammlungName(x.feld)}: ${x.keineListe ? t('testflug.gelaende.verworfen.keine_liste') : x.anzahl}`).join(', ');
}

/** The HUD line for the plain save (the outcome of `entwurfSpeichern`, without a restart). */
export function entwurfErgebnisText(e: EntwurfErgebnis): string {
  switch (e.art) {
    case 'kein-entwurf':
      return t('testflug.kein_entwurf_speichern');
    case 'unbrauchbar':
      return t('testflug.entwurf_unbrauchbar');
    case 'unlesbar':
      return t('testflug.neustart.fehler.entwurf_unlesbar', { fehler: e.fehler });
    case 'hoehe':
      return t('testflug.gelaende.hoehe.beschaedigt', { grund: hoehenGrund(e.problem) });
    case 'verworfen':
      return t('testflug.gelaende.verworfen.beschaedigt', { liste: verworfenText(e.teile) });
    case 'antwort':
      return e.leereRouten > 0 ? `${speicherText(e.antwort)} · ${t('testflug.gelaende.leere_route')}` : speicherText(e.antwort);
    case 'ausnahme':
      return t('testflug.speichern_fehlgeschlagen', { fehler: e.fehler });
  }
}
