/**
 * Reset the world to zero, the editor's side (Editor K4.0). DOM-free, with the
 * `fetch` handed in, so the parts that decide something are testable without a
 * window (client/test/welt-zuruecksetzen.ts). The dialog is
 * `WeltZuruecksetzenDialog.ts`; the button and the wiring sit in `editorMain.ts`.
 *
 * ── What the operations service does (admin/src/routen/weltZuruecksetzen.ts) ──
 * GET  /api/welt-zuruecksetzen  the numbers: what would go.
 * POST /api/welt-zuruecksetzen  `{ bestaetigung, seed, konten }`: back up, stop
 *      the server, MOVE the save (and with `konten` the accounts) aside, write
 *      a minimal world document, start the server. Nothing is deleted; `live`
 *      is refused; the confirmation must be the instance name, exactly.
 *
 * ── What the editor has to do afterwards ─────────────────────────────
 * The answer carries the new document and its hash. `nachZuruecksetzen` puts
 * the editor on that state, in an order that is not arbitrary:
 *   1. the draft becomes the new document (the `localStorage` draft, source
 *      'server': draft and server are one); the editor sets it like any
 *      replacement (import, server state: a step first, then the assignment);
 *   2. the undo and redo stacks go, including the step of 1: there is no
 *      earlier state to go back to (the old world is on the server's disk,
 *      named in the message), and a Ctrl+Z that brought the old draft back
 *      would let the next save overwrite the reset;
 *   3. only when the draft really stands in the storage, the BASE moves to the
 *      new hash. Without it the next save answers 409 (old base) or 428 (none).
 *      When the storage refused the draft ('voll') or another tab wrote
 *      meanwhile ('fremd'), the base stays: it belongs to the draft in the
 *      storage, and that is not this one.
 */
import { sanitizeWorldLayout, type WorldLayout } from '@wov/shared';
import { entwurfImSpeicher, type SpeicherGrund } from './entwurfsSpeicher';

export const RESET_PFAD = '/api/welt-zuruecksetzen';

export type SeedWahl = 'behalten' | 'neu';

/** The numbers the service collects (same shape as `ResetZahlen` in admin/src/routen/weltZuruecksetzen.ts). */
export interface ResetZahlen {
  weltdokument: {
    name: string;
    detailSeed: string;
    platzierungen: number;
    regionen: number;
    fluesse: number;
    seen: number;
    routen: number;
    kontinente: number;
    hash: string;
  } | null;
  spielstand: { datei: string; bytes: number; zdos: number | null; geaendert: string } | null;
  konten: { konten: number; charaktere: number } | null;
}

export type ResetVorschau =
  | { erreichbar: true; instanz: string; erlaubt: boolean; grund: string | null; testweltAktiv: boolean; zahlen: ResetZahlen }
  | { erreichbar: false; grund: string };

/** GET: what would go. Never throws. */
export async function holeVorschau(fetchFn: typeof fetch = fetch): Promise<ResetVorschau> {
  let antwort: Response;
  try {
    antwort = await fetchFn(RESET_PFAD);
  } catch (fehler) {
    return { erreichbar: false, grund: `Betriebsdienst nicht erreichbar: ${String(fehler)}` };
  }
  let d: Record<string, unknown> = {};
  try {
    d = JSON.parse(await antwort.text()) as Record<string, unknown>;
  } catch {
    /* not JSON: decided by the status below */
  }
  if (!antwort.ok) {
    const text = typeof d.message === 'string' ? d.message : typeof d.fehler === 'string' ? d.fehler : `HTTP ${antwort.status}`;
    return { erreichbar: false, grund: `Zahlen nicht lesbar: ${text}` };
  }
  const zahlen = d.zahlen as ResetZahlen | undefined;
  if (typeof d.instanz !== 'string' || typeof d.erlaubt !== 'boolean' || !zahlen || typeof zahlen !== 'object') {
    return { erreichbar: false, grund: 'Zahlen nicht lesbar: unerwartete Antwort des Betriebsdienstes' };
  }
  return {
    erreichbar: true,
    instanz: d.instanz,
    erlaubt: d.erlaubt,
    grund: typeof d.grund === 'string' ? d.grund : null,
    testweltAktiv: d.testweltAktiv === true,
    zahlen,
  };
}

export interface ResetEingabe {
  bestaetigung: string;
  seed: SeedWahl;
  konten: boolean;
}

export type ResetErgebnis =
  | {
      art: 'ok';
      message: string;
      kennung: string;
      hash: string;
      dokument: WorldLayout;
      /** Names of the two copies made before the swap (`null`: nothing to copy). */
      sicherung: { spielstand: string | null; weltdokument: string | null };
      /** Names of the files that were moved aside. */
      beiseite: string[];
      zahlen: ResetZahlen | null;
      /**
       * The world was reset but the server did not come back (`start-fehlgeschlagen`): the answer still carries the new
       * document and hash, so the editor moves on to it, and this text says what is left to do by hand.
       */
      warnung: string | null;
    }
  | { art: 'fehler'; status: number; message: string; zurueckgerollt: boolean | null }
  /** The answer did not arrive or could not be read: whether the reset happened is unknown. */
  | { art: 'unbekannt'; message: string };

/** POST: do it. Never throws. */
export async function weltZuruecksetzen(eingabe: ResetEingabe, fetchFn: typeof fetch = fetch): Promise<ResetErgebnis> {
  let antwort: Response;
  try {
    antwort = await fetchFn(RESET_PFAD, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bestaetigung: eingabe.bestaetigung, seed: eingabe.seed, konten: eingabe.konten }),
    });
  } catch (fehler) {
    return {
      art: 'unbekannt',
      message: `Keine Antwort vom Betriebsdienst (${String(fehler)}) — ob die Welt zurückgesetzt wurde, ist unbekannt. Serverkonsole und Weltdatei prüfen, bevor du es noch einmal versuchst.`,
    };
  }
  let d: Record<string, unknown> = {};
  let lesbar = true;
  try {
    d = JSON.parse(await antwort.text()) as Record<string, unknown>;
  } catch {
    lesbar = false;
  }
  const text = typeof d.message === 'string' ? d.message : typeof d.fehler === 'string' ? d.fehler : `HTTP ${antwort.status}`;
  const startFehlgeschlagen = d.fehler === 'start-fehlgeschlagen';
  if ((!antwort.ok || d.ok === false) && !startFehlgeschlagen) {
    // A 5xx without a readable body may have happened halfway (the proxy timed out while the service worked).
    if (!lesbar && antwort.status >= 500) {
      return { art: 'unbekannt', message: `Der Betriebsdienst antwortete mit HTTP ${antwort.status} ohne lesbare Meldung — ob die Welt zurückgesetzt wurde, ist unbekannt. Serverkonsole und Weltdatei prüfen.` };
    }
    return { art: 'fehler', status: antwort.status, message: text, zurueckgerollt: typeof d.zurueckgerollt === 'boolean' ? d.zurueckgerollt : null };
  }
  const dokument = sanitizeWorldLayout(d.dokument);
  if (!dokument || typeof d.hash !== 'string' || d.hash === '') {
    return {
      art: 'unbekannt',
      message: 'Der Betriebsdienst meldet Erfolg, aber ohne lesbares Weltdokument oder Stand — Editor neu laden und die Welt neu holen.',
    };
  }
  const sicherung = (d.sicherung ?? {}) as { spielstand?: unknown; weltdokument?: unknown };
  return {
    art: 'ok',
    message: typeof d.message === 'string' ? d.message : 'Welt zurückgesetzt.',
    kennung: typeof d.kennung === 'string' ? d.kennung : '',
    hash: d.hash,
    dokument,
    sicherung: {
      spielstand: typeof sicherung.spielstand === 'string' ? sicherung.spielstand : null,
      weltdokument: typeof sicherung.weltdokument === 'string' ? sicherung.weltdokument : null,
    },
    beiseite: Array.isArray(d.beiseite) ? d.beiseite.filter((n): n is string => typeof n === 'string') : [],
    zahlen: (d.vorher as ResetZahlen | undefined) ?? null,
    warnung: startFehlgeschlagen ? text : null,
  };
}

/** The confirmation gate: the typed text must be the instance name, character for character (no trimming, no case folding). */
export function bestaetigungPasst(eingabe: string, instanz: string | null): boolean {
  return instanz !== null && instanz !== '' && eingabe === instanz;
}

/**
 * The state of the dialog, without the DOM. The button is free only while
 * `eingabe` is exactly the instance name; editing the text again takes it away.
 * The switches do not touch that.
 */
export class ResetDialogZustand {
  seed: SeedWahl = 'behalten';
  konten = false;
  eingabe = '';
  constructor(readonly instanz: string) {}
  freigegeben(): boolean {
    return bestaetigungPasst(this.eingabe, this.instanz);
  }
  /** What the dialog resolves with; `null` while the gate is shut (a click on a disabled button must not get through). */
  ergebnis(): ResetEingabe | null {
    return this.freigegeben() ? { bestaetigung: this.eingabe, seed: this.seed, konten: this.konten } : null;
  }
}

/** 12345 → "12.345" (independent of the machine's locale). */
export function zahlText(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 5 400 000 → "5,1 MB". */
export function groesseText(bytes: number): string {
  if (bytes < 1024) return `${bytes} Byte`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

const mehrzahl = (n: number, einzahl: string, mehr: string): string => `${zahlText(n)} ${n === 1 ? einzahl : mehr}`;

/** What goes, in whole sentences with the real numbers. `entwurf`: the browser's draft, counted by the editor itself. */
export function verschwindetSaetze(z: ResetZahlen, opt: { konten: boolean; entwurf: { platzierungen: number; regionen: number } }): string[] {
  const s: string[] = [];
  const w = z.weltdokument;
  if (w) {
    const teile = [
      mehrzahl(w.platzierungen, 'Platzierung', 'Platzierungen'),
      mehrzahl(w.regionen, 'Region', 'Regionen'),
      mehrzahl(w.fluesse, 'Fluss', 'Flüsse'),
      mehrzahl(w.seen, 'See', 'Seen'),
      mehrzahl(w.routen, 'Route', 'Routen'),
      mehrzahl(w.kontinente, 'Kontinent', 'Kontinente'),
    ].filter((t) => !t.startsWith('0 '));
    s.push(teile.length > 0 ? `Das Weltdokument „${w.name}“ wird leer: ${teile.join(', ')}.` : `Das Weltdokument „${w.name}“ ist schon leer.`);
  } else {
    s.push('Das Weltdokument war nicht lesbar oder fehlte; es wird durch ein leeres ersetzt.');
  }
  if (z.spielstand) {
    s.push(
      `Der Spielstand (${groesseText(z.spielstand.bytes)}${z.spielstand.zdos === null ? '' : `, ${mehrzahl(z.spielstand.zdos, 'Objekt', 'Objekte')}`}) — gebaute Häuser, Vegetation, Fortschritt — wird beiseitegelegt; der Server erzeugt die Welt neu.`
    );
  } else {
    s.push('Einen Spielstand gibt es nicht; der Server erzeugt die Welt neu.');
  }
  if (opt.konten) {
    s.push(
      z.konten
        ? `${mehrzahl(z.konten.konten, 'Konto', 'Konten')} mit ${mehrzahl(z.konten.charaktere, 'Charakter', 'Charakteren')} werden beiseitegelegt; niemand kann sich danach anmelden, bis neue Konten angelegt sind.`
        : 'Konten und Charaktere: es gibt keine Kontendatenbank.'
    );
  }
  s.push(
    `Dein Entwurf im Browser (${mehrzahl(opt.entwurf.platzierungen, 'Platzierung', 'Platzierungen')}, ${mehrzahl(opt.entwurf.regionen, 'Region', 'Regionen')}) wird ebenfalls geleert, der Rückgängig-Stapel auch.`
  );
  s.push('Alle Spieler fliegen raus: der Spielserver wird dafür gestoppt und neu gestartet.');
  return s;
}

/** What stays. */
export function bleibtSaetze(z: ResetZahlen, opt: { konten: boolean; seed: SeedWahl }): string[] {
  const s: string[] = [];
  if (!opt.konten) {
    s.push(
      z.konten
        ? `Spielerkonten und Charaktere (${mehrzahl(z.konten.konten, 'Konto', 'Konten')}, ${mehrzahl(z.konten.charaktere, 'Charakter', 'Charaktere')}) — jeder kann sich weiter anmelden.`
        : 'Spielerkonten und Charaktere.'
    );
  }
  s.push('Dungeons und Module, das Forum und die Adminliste.');
  const seed = z.weltdokument?.detailSeed;
  s.push(
    opt.seed === 'behalten'
      ? `Der Gelände-Seed${seed ? ` („${seed}“)` : ''}: dieselben Hügel, Wälder und Küstenformen, sobald du wieder Regionen zeichnest.`
      : 'Der Gelände-Seed wird neu gewürfelt: Hügel, Wälder und Küstenformen fallen später anders aus.'
  );
  return s;
}

export const NICHTS_GELOESCHT =
  'Nichts wird gelöscht: Spielstand, Weltdokument und (auf Wunsch) Konten werden gesichert bzw. unter einem Namen mit Zeitstempel beiseitegelegt. ' +
  'Wie man sie zurückholt, steht in Docs/10-Weltbau-Layout-und-Editor.md.';

/** The parts of the editor `nachZuruecksetzen` reaches into. Each is one line in editorMain.ts. */
export interface NachbereitungHost {
  /**
   * Make `dokument` the editor's document: a step first (replacement), then set it, drop the selection and any
   * half-finished tool, write the draft (source 'server') and redraw. Returns why the draft may not stand in the storage
   * (`speichereEntwurf`).
   */
  ersetzeStand(dokument: WorldLayout): SpeicherGrund;
  /** Forget the undo and redo stacks (runs AFTER `ersetzeStand`, so the step it made goes too). */
  verlaufLeeren(): void;
  /** Remember the server state the editor now shows (the save button's dot compares against it). */
  serverStandMerken(dokument: WorldLayout): void;
  /** The base of the draft moves to this hash. */
  basisSetzen(hash: string): void;
}

export interface NachbereitungErgebnis {
  grund: SpeicherGrund;
  /** The base was moved (the draft stands in the storage). */
  basisGesetzt: boolean;
}

export function nachZuruecksetzen(ergebnis: Extract<ResetErgebnis, { art: 'ok' }>, host: NachbereitungHost): NachbereitungErgebnis {
  host.serverStandMerken(ergebnis.dokument);
  // Ersetzen zuerst (der Editor legt dabei wie bei jedem Ersetzen einen Schritt an), leeren danach: Am Ende ist der Verlauf leer.
  const grund = host.ersetzeStand(ergebnis.dokument);
  host.verlaufLeeren();
  const basisGesetzt = entwurfImSpeicher(grund);
  if (basisGesetzt) host.basisSetzen(ergebnis.hash);
  return { grund, basisGesetzt };
}

/** The message after a successful reset: the two copies and the moved files, by name. */
export function erfolgsMeldung(e: Extract<ResetErgebnis, { art: 'ok' }>, n: NachbereitungErgebnis): string {
  const teile = [
    'Welt zurückgesetzt.',
    e.sicherung.spielstand ? `Sicherung Spielstand: ${e.sicherung.spielstand}.` : null,
    e.sicherung.weltdokument ? `Sicherung Weltdokument: ${e.sicherung.weltdokument} (im Ordner der Spielstände).` : null,
    e.beiseite.length > 0 ? `Beiseite gelegt: ${e.beiseite.join(', ')}.` : null,
  ].filter((t): t is string => t !== null);
  if (e.warnung) teile.push(`ACHTUNG: ${e.warnung}`);
  if (!n.basisGesetzt) {
    teile.push('ACHTUNG: Der leere Entwurf konnte nicht im Browser gespeichert werden (Speicher voll oder ein anderer Tab hat geschrieben) — vor dem nächsten Speichern den Serverstand neu laden.');
  }
  return teile.join(' ');
}
