/**
 * Item mask (Editor card EG2): the client of `GET/PUT /api/gegenstaende` and `GET /api/gegenstaende/quittung`
 * (Editor card EG1). DOM-free; `fetch` and the base address are parameters so a test can talk to the real
 * operations service.
 * Gegenstands-Maske (EG2): Client der Betriebsdienst-Route. DOM-frei, `fetch` und Basisadresse sind Parameter.
 *
 * Call pattern as the other editor calls (`/api/server`, `/api/modell-hochladen`): a relative path, no token in
 * the code; the proxy in front (Vite / nginx) adds `x-wov-token`. A test passes its own `kopf`.
 *
 * The protection of the route is kept here:
 *  - `If-Match: "<hash>"` on every PUT (the hash of the last GET); 412 comes back as `veraltet` with the current hash.
 *  - The PUT body is always the canonical text (`schreibeGegenstandsDatei`), never something the mask assembled.
 *  - 409 (`brauchtBestaetigung`, `alter-stand-kaputt`) is returned as `bestaetigung`; `speichernMitBestaetigung`
 *    sends the confirmed PUT (`?bestaetigt=1`) ONLY when the caller's `frage` answers yes.
 *  - What the server answers is never trusted blindly: the document of a GET is sanitised again with
 *    `leseGegenstandsDatei` on the raw text.
 */
import {
  GegenstandsSchreibFehler,
  leseGegenstandsDatei,
  schreibeGegenstandsDatei,
  type DateiFehler,
  type GegenstandsEintrag,
  type VerworfenerEintrag,
} from '@wov/shared/src/items/gegenstandsDaten.js';
import type { BestaetigungInfo } from './texte';

export interface ApiOptionen {
  /** Base address, '' = the page's own origin. */
  basis?: string;
  /** Extra request headers (the proxy adds the token in the browser; a test sets `x-wov-token`). */
  kopf?: Record<string, string>;
  fetcher?: typeof fetch;
}

const PFAD = '/api/gegenstaende';

/** The document as the server holds it, sanitised again here. */
export interface Stand {
  text: string;
  hash: string;
  quelle: 'repo' | 'arbeit' | string;
  /** Set when the working copy as a whole is unusable; then `eintraege` is empty. */
  dateiFehler: DateiFehler | null;
  eintraege: GegenstandsEintrag[];
  /** Entries of the file the reader discards (hand-edited): they vanish with the next save. */
  verworfen: VerworfenerEintrag[];
}

/** An answer that is none of the expected ones: the HTTP status and the route's `fehler` code (null if it sent none). */
export interface FehlerErgebnis {
  art: 'fehler';
  status: number;
  fehler: string | null;
}
export interface NetzErgebnis {
  art: 'netz';
}

export type LadeErgebnis = { art: 'ok'; stand: Stand } | FehlerErgebnis | NetzErgebnis;

export interface SpeicherErfolg {
  art: 'ok';
  hash: string;
  eintraege: number;
  entfernt: string[];
  entferntOhneId: string[];
}
export interface Veraltet {
  art: 'veraltet';
  hash: string;
}
export interface BrauchtBestaetigung {
  art: 'bestaetigung';
  info: BestaetigungInfo;
  hash: string;
}
export interface Verworfen {
  art: 'verworfen';
  verworfen: Array<{ index: number; id: string | null; grund: string }>;
}
export interface Gesperrt {
  art: 'gesperrt';
  /** Seconds the route asks to wait (`Retry-After`), 2 if it sent none. */
  retryAfter: number;
}

export type SpeicherErgebnis = SpeicherErfolg | Veraltet | BrauchtBestaetigung | Verworfen | Gesperrt | FehlerErgebnis | NetzErgebnis;

export type QuittungErgebnis =
  | { art: 'ok'; quittung: { status: string; [feld: string]: unknown } }
  | FehlerErgebnis
  | NetzErgebnis;

interface Roh {
  status: number;
  daten: Record<string, unknown>;
  retryAfter: string | null;
}

const istObjekt = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const textOderNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const textListe = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

async function senden(o: ApiOptionen, methode: 'GET' | 'PUT', pfad: string, extra: { body?: string; hash?: string } = {}): Promise<Roh | null> {
  const kopf: Record<string, string> = { ...(o.kopf ?? {}) };
  if (extra.body !== undefined) kopf['Content-Type'] = 'application/json';
  if (extra.hash !== undefined) kopf['If-Match'] = `"${extra.hash}"`;
  let antwort: Response;
  let roh: string;
  try {
    antwort = await (o.fetcher ?? fetch)(`${o.basis ?? ''}${pfad}`, {
      method: methode,
      headers: kopf,
      cache: 'no-store',
      ...(extra.body === undefined ? {} : { body: extra.body }),
    });
    roh = await antwort.text();
  } catch {
    return null;
  }
  let daten: Record<string, unknown> = {};
  try {
    const j: unknown = JSON.parse(roh);
    if (istObjekt(j)) daten = j;
  } catch {
    /* not JSON (a proxy page): the status alone decides */
  }
  return { status: antwort.status, daten, retryAfter: antwort.headers.get('retry-after') };
}

const fehlerVon = (r: Roh): FehlerErgebnis => ({ art: 'fehler', status: r.status, fehler: textOderNull(r.daten.fehler) });

/** GET /api/gegenstaende: the document and its hash (the `If-Match` of the next PUT). */
export async function ladeStand(o: ApiOptionen = {}): Promise<LadeErgebnis> {
  const r = await senden(o, 'GET', PFAD);
  if (r === null) return { art: 'netz' };
  if (r.status !== 200 || typeof r.daten.text !== 'string' || typeof r.daten.hash !== 'string' || r.daten.hash === '') return fehlerVon(r);
  const lesung = leseGegenstandsDatei(r.daten.text);
  return {
    art: 'ok',
    stand: {
      text: r.daten.text,
      hash: r.daten.hash,
      quelle: typeof r.daten.quelle === 'string' ? r.daten.quelle : 'arbeit',
      dateiFehler: lesung.dateiFehler,
      eintraege: lesung.eintraege,
      verworfen: lesung.verworfen,
    },
  };
}

/**
 * PUT of a document text. `bestaetigt` sends `?bestaetigt=1`. Public for the test that must provoke the
 * route's refusals (a mask never sends a broken text itself).
 */
export async function speichereText(o: ApiOptionen, text: string, hash: string, bestaetigt = false): Promise<SpeicherErgebnis> {
  const r = await senden(o, 'PUT', `${PFAD}${bestaetigt ? '?bestaetigt=1' : ''}`, { body: text, hash });
  if (r === null) return { art: 'netz' };
  const d = r.daten;
  if (r.status === 200 && d.ok === true && typeof d.hash === 'string') {
    return { art: 'ok', hash: d.hash, eintraege: typeof d.eintraege === 'number' ? d.eintraege : 0, entfernt: textListe(d.entfernt), entferntOhneId: textListe(d.entferntOhneId) };
  }
  if (r.status === 412) return { art: 'veraltet', hash: typeof d.hash === 'string' ? d.hash : '' };
  if (r.status === 409 && d.brauchtBestaetigung === true) {
    const hashJetzt = typeof d.hash === 'string' ? d.hash : hash;
    if (d.fehler === 'alter-stand-kaputt') {
      return { art: 'bestaetigung', hash: hashJetzt, info: { art: 'alter-stand-kaputt', entfernt: [], entferntOhneId: [], dateiFehler: textOderNull(d.dateiFehler) } };
    }
    return { art: 'bestaetigung', hash: hashJetzt, info: { art: 'entfernen', entfernt: textListe(d.entfernt), entferntOhneId: textListe(d.entferntOhneId) } };
  }
  if (r.status === 422 && d.fehler === 'eintraege-verworfen' && Array.isArray(d.verworfen)) {
    const liste: Verworfen['verworfen'] = [];
    for (const v of d.verworfen) {
      if (istObjekt(v) && typeof v.grund === 'string') {
        liste.push({ index: typeof v.index === 'number' ? v.index : -1, id: textOderNull(v.id), grund: v.grund });
      }
    }
    return { art: 'verworfen', verworfen: liste };
  }
  if (r.status === 503) {
    const n = Number(r.retryAfter);
    return { art: 'gesperrt', retryAfter: Number.isFinite(n) && n > 0 ? n : 2 };
  }
  return fehlerVon(r);
}

/** The canonical text of a list, or the route's refusal as a result (more than 500 entries, more than 1 MB). */
export function textVon(eintraege: readonly GegenstandsEintrag[]): { text: string } | FehlerErgebnis {
  try {
    return { text: schreibeGegenstandsDatei(eintraege) };
  } catch (fehler) {
    if (fehler instanceof GegenstandsSchreibFehler) return { art: 'fehler', status: 0, fehler: fehler.code };
    throw fehler;
  }
}

/** PUT of a list (canonical text). */
export async function speichere(o: ApiOptionen, eintraege: readonly GegenstandsEintrag[], hash: string, bestaetigt = false): Promise<SpeicherErgebnis> {
  const t = textVon(eintraege);
  if ('art' in t) return t;
  return speichereText(o, t.text, hash, bestaetigt);
}

export type SpeicherAblauf = SpeicherErgebnis | { art: 'abgebrochen'; info: BestaetigungInfo };

/**
 * Saves; on 409 asks `frage(info)` and sends the confirmed PUT only if it answers `true`. Without a yes nothing
 * is sent a second time (`abgebrochen`). The confirmed PUT uses the same `If-Match`: if the file changed while the
 * dialog was open, it is a 412 and nothing is removed.
 */
export async function speichernMitBestaetigung(
  o: ApiOptionen,
  eintraege: readonly GegenstandsEintrag[],
  hash: string,
  frage: (info: BestaetigungInfo) => Promise<boolean>
): Promise<SpeicherAblauf> {
  const erst = await speichere(o, eintraege, hash);
  if (erst.art !== 'bestaetigung') return erst;
  if (!(await frage(erst.info))) return { art: 'abgebrochen', info: erst.info };
  return speichere(o, eintraege, hash, true);
}

/** GET /api/gegenstaende/quittung: the receipt of the game server's watch, today mostly `keine`. */
export async function ladeQuittung(o: ApiOptionen = {}): Promise<QuittungErgebnis> {
  const r = await senden(o, 'GET', `${PFAD}/quittung`);
  if (r === null) return { art: 'netz' };
  if (r.status !== 200 || typeof r.daten.status !== 'string') return fehlerVon(r);
  const { ok: _ok, ...rest } = r.daten;
  void _ok;
  return { art: 'ok', quittung: { ...rest, status: r.daten.status } };
}
