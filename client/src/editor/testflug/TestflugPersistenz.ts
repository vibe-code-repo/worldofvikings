/**
 * Persistence seam of the offline flight ("Testflug", `?offline=1&layout=editor`).
 *
 * The flight edits ONE working document — the draft that `editor.html` also
 * edits. Everything the flight does to it (place, drag, delete, NPC fields)
 * goes through this interface, so a later online mode can swap the storage
 * without touching the flight itself. Two implementations:
 * `LocalStoragePersistenz` (working copy in the browser, publish via POST) and
 * `OpsPersistenz` (every change also goes to the service as a PATCH).
 * The flight changes the draft by `vorgang()`: one operation per gesture,
 * addressed by `id` (see `TestflugAktionen`).
 *
 * Trennstelle des Testflugs: Alles, was er am Entwurf ändert, läuft durch
 * diese Schnittstelle, als Vorgang je Geste, adressiert über `id`.
 */
import type { NpcDef } from '@wov/shared';
import { invertiere, verschmelze, type Vorgang } from '@wov/shared/src/worldlayout/ops.js';

/**
 * Ein Eintrag des Entwurfs — dieselben Felder wie PlacementDef, aber
 * beschreibbar: Der Entwurf im localStorage IST das Arbeitsdokument.
 */
export type EntwurfEintrag = {
  /** The id of the placement (`frischePlatzierungsId`); the test flight gives every new one its own. */
  id?: string;
  prefab: string;
  x: number;
  z: number;
  yaw?: number;
  scale?: number;
  einebnen?: number;
  npc?: NpcDef;
};

/** The draft as stored: `placements` may be missing in a fresh document. */
export type EntwurfDokument = {
  placements?: EntwurfEintrag[];
  [weiteresFeld: string]: unknown;
};

/** Answer of the publish endpoint (`POST /api/worldlayout`). */
export type SpeicherAntwort = { ok: boolean; message: string };

export interface TestflugPersistenz {
  /**
   * Reads the working draft. `null` when there is none; throws when the
   * stored text cannot be parsed (callers decide whether that is fatal).
   */
  laden(): EntwurfDokument | null;
  /**
   * Optional: the stored draft as raw text (no parsing). Callers use it as a
   * cheap change marker — equal text, equal draft.
   */
  rohtext?(): string | null;
  /**
   * Writes the CHANGED working draft back, whole. The store underneath and the
   * Vorgang code use it; the flight itself changes the draft by `vorgang()`.
   */
  aendern(dokument: EntwurfDokument): void;
  /** Publishes a sanitised draft to the server file. */
  speichern(dokument: object): Promise<SpeicherAntwort>;
  /**
   * Changes the draft by ONE operation (`shared/src/worldlayout/ops.ts`),
   * addressed by `id`. It is applied to the local draft at once (all or
   * nothing); the outcome of the remote side, if there is one, is the
   * `antwort`. `zwischen`: one frame of a drag — applied, but only counted and
   * sent as ONE Vorgang when `abschliessen()` is called.
   *
   * Ändert den Entwurf um EINEN Vorgang, adressiert über `id`. Lokal sofort
   * angewendet (ganz oder gar nicht); `zwischen` = ein Bild eines Ziehens:
   * angewendet, aber erst mit `abschliessen()` als EIN Vorgang gezählt/gesendet.
   */
  vorgang(vorgang: Vorgang, zwischen?: boolean): VorgangErgebnis;
  /** Closes a drag: the frames since the last close become ONE Vorgang. `null` when there was nothing to close. */
  abschliessen(): Promise<VorgangAntwort> | null;
  /** The Vorgaenge that were counted (sent), oldest first; the last 200. */
  protokoll(): readonly Vorgang[];
  /** `true` while frames of a drag wait for `abschliessen()`. */
  ziehOffen?(): boolean;
  /**
   * Where the answer of a drag goes that was closed INSIDE the persistence
   * (a new gesture, a delete, a set began before the drop). Without it that
   * answer would be lost.
   */
  aufInternenAbschluss?: (antwort: Promise<VorgangAntwort>) => void;
}

/** What the remote side said (or the local store: `angewendet` with an empty text). */
export type VorgangAntwort =
  /** 200: applied. */
  | { art: 'angewendet'; message: string }
  /** 202: written to the file, but not applied to the running world; `grund` says why (`server-aus`, `geo`, `abgelehnt`). */
  | { art: 'nur-geschrieben'; grund: string; message: string }
  /** 409: the objects `ids` are no longer as the writer saw them; nothing was written. `zurueckgenommen`: the local draft was put back; `verworfen`: how many gestures were put back with it (the refused one and every later one). */
  | { art: 'konflikt'; ids: string[]; message: string; zurueckgenommen: boolean; verworfen?: number }
  /** Anything else (422, 503); nothing was written. */
  | { art: 'fehler'; message: string; zurueckgenommen: boolean; verworfen?: number }
  /**
   * Unknown: the request may have been applied (no answer after sending, 204,
   * any other 2xx). The draft is NOT put back; the flight asks for a reload and
   * takes no further Vorgang until then.
   */
  | { art: 'unklar'; message: string };

/** Local result of `vorgang`: refused (nothing changed) or applied, with the answer still to come. */
export type VorgangErgebnis =
  | { ok: true; antwort: Promise<VorgangAntwort> }
  | { ok: false; ids: string[]; message: string };

const gleichWert = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => gleichWert((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};

/**
 * Applies a Vorgang to the RAW draft: the entries keep their order and their
 * own key order (no sanitizer: the draft is stored byte for byte as the flight
 * always wrote it). An op stands when the entry with that id equals `vorher`
 * (`setze`: the id must be free). All ops or none; the draft is only touched
 * when all stand. `wende` of ops.ts is the SERVER's rule, this is the same
 * rule on the unsanitised draft.
 */
export function wendeAufEntwurf(
  dokument: EntwurfDokument,
  vorgang: Vorgang
): { ok: true } | { ok: false; ids: string[]; message: string } {
  const liste = [...(dokument.placements ?? [])];
  const konflikte: string[] = [];
  for (const op of vorgang.ops) {
    if (op.sammlung !== 'placements') {
      konflikte.push(op.id);
      continue;
    }
    const pos = liste.findIndex((e) => e.id === op.id);
    if (op.art === 'setze') {
      if (pos >= 0) konflikte.push(op.id);
      else {
        const neu = structuredClone(op.nachher) as unknown as EntwurfEintrag;
        // Only the undo of a delete names a place; a new entry goes to the end.
        if (op.nach !== undefined && op.index !== undefined) liste.splice(Math.min(op.index, liste.length), 0, neu);
        else liste.push(neu);
      }
      continue;
    }
    if (pos < 0 || !gleichWert(liste[pos], op.vorher)) {
      konflikte.push(op.id);
      continue;
    }
    if (op.art === 'aendere') liste[pos] = structuredClone(op.nachher) as unknown as EntwurfEintrag;
    else liste.splice(pos, 1);
  }
  if (konflikte.length > 0) {
    const ids = [...new Set(konflikte)];
    return { ok: false, ids, message: `Konflikt bei ${ids.join(', ')} — nichts geändert` };
  }
  dokument.placements = liste;
  return { ok: true };
}

const ZURUECK = (a: { zurueckgenommen: boolean; verworfen?: number }): string => {
  if (!a.zurueckgenommen) return ' — Entwurf NICHT zurückgesetzt, bitte neu laden';
  const n = a.verworfen ?? 1;
  return n > 1 ? ` (Entwurf zurückgesetzt, ${n} Gesten verworfen)` : ' (Entwurf zurückgesetzt)';
};

/** The line for the HUD; `null` = nothing to say (local store, or an empty text). */
export function antwortText(a: VorgangAntwort): string | null {
  switch (a.art) {
    case 'angewendet':
      return a.message === '' ? null : a.message;
    case 'nur-geschrieben':
      return `Geschrieben, aber nicht angewendet (${a.grund})${a.message ? `: ${a.message}` : ''}`;
    case 'konflikt':
      return `Konflikt bei ${a.ids.join(', ')} — nichts geändert${ZURUECK(a)}`;
    case 'fehler':
      return `${a.message}${ZURUECK(a)}`;
    case 'unklar':
      return `Unklar — bitte neu laden: ${a.message}`;
  }
}

/** A drag that ends where it started changes nothing: no Vorgang. */
const ohneWirkung = (v: Vorgang): boolean =>
  v.ops.length > 0 && v.ops.every((op) => op.art === 'aendere' && gleichWert(op.vorher, op.nachher));

const PROTOKOLL_MAX = 200;

/**
 * The Vorgang half of a persistence, on top of a plain draft store.
 * `senden` is the remote side (`OpsPersistenz`); without it the draft is the
 * only place and every Vorgang is `angewendet` at once. Vorgaenge are sent
 * one after the other in the order they were made (each one rests on the
 * result of the last). A refusal (409, error) puts the local draft back with
 * the inverse Vorgang.
 *
 * Der Vorgangs-Teil einer Persistenz auf einem einfachen Entwurfsspeicher.
 * Ohne `senden` ist der Entwurf der einzige Ort. Eine Ablehnung (409, Fehler)
 * setzt den lokalen Entwurf mit dem Umkehr-Vorgang zurück.
 */
export function mitVorgaengen(
  speicher: Pick<TestflugPersistenz, 'laden' | 'rohtext' | 'aendern' | 'speichern'>,
  senden?: (vorgang: Vorgang) => Promise<VorgangAntwort>
): TestflugPersistenz {
  const protokoll: Vorgang[] = [];
  let offen: Vorgang | null = null;
  /** Applied locally, not answered yet, oldest first; `[0]` is the one in flight. */
  const wartend: Array<{ v: Vorgang; erledigt: (a: VorgangAntwort) => void }> = [];
  let laeuft = false;
  /** After an answer that left it unknown whether the server has a Vorgang: nothing more until a reload. */
  let unklar = false;
  const UNKLAR_TEXT = 'Stand unklar — bitte neu laden';

  const lokal = (v: Vorgang): { ok: true } | { ok: false; ids: string[]; message: string } => {
    const dok = speicher.laden();
    if (!dok) return { ok: false, ids: [], message: 'Kein Entwurf' };
    const r = wendeAufEntwurf(dok, v);
    if (r.ok) speicher.aendern(dok);
    return r;
  };

  /** A refusal: put back the refused Vorgang and every later one (and the open drag), newest first. */
  const lehneAb = (a: VorgangAntwort & { art: 'konflikt' | 'fehler' }): void => {
    const verworfene = wartend.splice(0);
    const mitZiehen = offen !== null;
    let alleZurueck = true;
    if (offen) {
      alleZurueck = lokal(invertiere(offen)).ok && alleZurueck;
      offen = null;
    }
    for (let i = verworfene.length - 1; i >= 0; i--) alleZurueck = lokal(invertiere(verworfene[i]!.v)).ok && alleZurueck;
    const anzahl = verworfene.length + (mitZiehen ? 1 : 0);
    // The later ones first, so that the line of the refused one (with the count) is the one left on the HUD.
    for (const w of verworfene.slice(1)) {
      w.erledigt({ art: 'fehler', message: 'Verworfen, weil ein früherer Vorgang abgelehnt wurde', zurueckgenommen: alleZurueck, verworfen: anzahl });
    }
    verworfene[0]!.erledigt({ ...a, zurueckgenommen: alleZurueck, verworfen: anzahl });
  };
  const gibtAuf = (a: VorgangAntwort & { art: 'unklar' }): void => {
    unklar = true;
    const rest = wartend.splice(0);
    for (const [i, w] of rest.entries()) w.erledigt(i === 0 ? a : { art: 'unklar', message: 'nicht gesendet, weil ein früherer Vorgang unklar blieb' });
  };
  const pumpe = (): void => {
    if (laeuft || wartend.length === 0 || !senden) return;
    laeuft = true;
    const kopf = wartend[0]!;
    senden(kopf.v).then(
      (a) => a,
      (fehler: unknown): VorgangAntwort => ({ art: 'unklar', message: `Senden ohne Antwort: ${String(fehler)}` })
    ).then((a) => {
      laeuft = false;
      if (a.art === 'konflikt' || a.art === 'fehler') lehneAb(a);
      else if (a.art === 'unklar') gibtAuf(a);
      else {
        wartend.shift();
        kopf.erledigt(a);
      }
      pumpe();
    });
  };
  const abschicken = (v: Vorgang): Promise<VorgangAntwort> => {
    protokoll.push(v);
    if (protokoll.length > PROTOKOLL_MAX) protokoll.shift();
    if (!senden) return Promise.resolve({ art: 'angewendet', message: '' });
    if (unklar) return Promise.resolve({ art: 'unklar', message: 'nicht gesendet, der Stand ist unklar' });
    return new Promise<VorgangAntwort>((erledigt) => {
      wartend.push({ v, erledigt });
      pumpe();
    });
  };
  const schliesse = (): Promise<VorgangAntwort> | null => {
    if (!offen) return null;
    const v = offen;
    offen = null;
    return ohneWirkung(v) ? null : abschicken(v);
  };

  const ergebnis: TestflugPersistenz = {
    laden: speicher.laden,
    ...(speicher.rohtext ? { rohtext: speicher.rohtext } : {}),
    aendern: speicher.aendern,
    speichern: speicher.speichern,
    vorgang: (v, zwischen = false) => {
      if (unklar) return { ok: false, ids: [], message: UNKLAR_TEXT };
      // A frame of ANOTHER object, or any other gesture, ends the open drag first: never two gestures in one Vorgang.
      if (offen && (!zwischen || !gleicheObjekte(offen, v))) {
        const antwort = schliesse();
        if (antwort) ergebnis.aufInternenAbschluss?.(antwort);
      }
      const r = lokal(v);
      if (!r.ok) return r;
      if (zwischen) {
        offen = offen ? verschmelze(offen, v) : v;
        return { ok: true, antwort: Promise.resolve({ art: 'angewendet', message: '' }) };
      }
      return { ok: true, antwort: abschicken(v) };
    },
    abschliessen: schliesse,
    protokoll: () => protokoll,
    ziehOffen: () => offen !== null,
  };
  return ergebnis;
}

const gleicheObjekte = (a: Vorgang, b: Vorgang): boolean => {
  const schluessel = (v: Vorgang): string => [...new Set(v.ops.map((o) => `${o.sammlung}/${o.id}`))].sort().join('|');
  return schluessel(a) === schluessel(b);
};
