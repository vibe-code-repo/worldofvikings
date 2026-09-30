/**
 * Item data at run time: load at start, live watch, receipt (game card G2).
 * Gegenstandsdaten zur Laufzeit: Laden beim Start, Live-Wache, Quittung (Karte G2).
 *
 * ── Channel ──────────────────────────────────────────────────────────
 * File watch after the pattern of `layoutLive.ts`: in the 1-second block of `update()` one `statSync` of the
 * working copy (mtime, size, inode) and of the confirmation file. Only when one of them changed the file is read
 * ONCE and hashed from the same bytes. No `fs.watch`, no port.
 *
 * ── Lock ─────────────────────────────────────────────────────────────
 * The watch reads only under `<working copy>.lock`, the very lock the admin route takes when it writes
 * (`layoutUnterSperre`, one attempt, no waiting: the game tick must never sleep). A held lock means: skip this
 * tick and try again at the next one (the state is not remembered), so a half written state is never read.
 * The backup files `<working copy>.kaputt-<time>` are other files and are never read here.
 *
 * ── What is applied, what is not ─────────────────────────────────────
 *  - broken file (no JSON, too big, wrong head): nothing applied, receipt `abgelehnt`;
 *  - single entries discarded by the sanitiser: nothing applied, receipt `verworfen` with the list (an entry that
 *    is discarded must not count as removed, and the old state stays);
 *  - an entry that is gone from the new state but still held by inventories, chests or saved players: nothing
 *    applied, receipt `bestaetigung-noetig` with `gehalten` ({id: count}). The admin route then leaves a
 *    confirmation file (`gegenstaende.bestaetigen.json`, `{hash, zeit, id}` as `POST /api/welt/bestaetigen`); only
 *    that makes the watch apply the state and remove the copies for good (no "raw stack" is kept);
 *  - after every successful application the applied state goes atomically to `gegenstaende.letzter-guter.json`
 *    (next to the working copy). If the working copy is broken or gone at the NEXT start, that state is loaded
 *    (loud warning, receipt `abgelehnt`): without the data items `Inventory.load` / `unpackContainer` would drop
 *    their stacks silently at the next save;
 *  - the start obeys the same rule: a valid working copy that lacks entries of the last good state is not applied
 *    (last good state loaded and kept); the first tick of the watch counts what is held and asks for the confirmation.
 *    A confirmation covers exactly the hash and the ids of the receipt (more copies of THOSE ids are removed too);
 *    another held id, or a confirmation without a receipt of this run, gives a new receipt and removes nothing;
 *  - otherwise: replace the data items (atomic), re-bind the inventories, send the inventories to all peers.
 * `interneFehler` counts the cases where the sanitiser swallowed an exception of its own
 * (reason `eintrag-ungueltig`, which no JSON input can produce) plus the errors of the watch itself.
 */
import { findItem } from '@wov/shared';
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import {
  MAX_DATEI_BYTES,
  leseGegenstandsDatei,
  schreibeGegenstandsDatei,
  wendeGegenstandsDatenAn,
  type GegenstandsEintrag,
  type VerworfenerEintrag,
} from '@wov/shared/src/items/gegenstandsDaten.js';
import { LayoutGesperrt, layoutHash, layoutUnterSperre } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { gegenstandsLetzterGuterDatei } from '@wov/shared/src/items/gegenstandsArbeitskopie.js';
import { bestaetigenAnfrageNehmen } from '@wov/shared/src/worldlayout/bestaetigenAnfrage.js';

/** Status of a receipt (the form the editor already expects). */
export type GegenstandsStatus = 'angewendet' | 'abgelehnt' | 'verworfen' | 'bestaetigung-noetig';

export interface GegenstandsQuittung {
  status: GegenstandsStatus;
  /** SHA-256 of the bytes of the working copy this receipt is about. */
  hash: string;
  zeit: string;
  /** `bestaetigung-noetig`: how many copies of each removed item are held. */
  gehalten?: Record<string, number>;
  /** `verworfen`: the discarded entries with a reason CODE (`VERWERF_GRUENDE`). */
  verworfen?: Array<{ index: number; id: string | null; grund: string }>;
}

/** The tick takes the lock with ONE attempt (no waiting): a held lock means "skip, try again next tick". */
const GESPERRT_WARTEN_MS = 0;

const standVon = (pfad: string): string | null => {
  try {
    const s = statSync(pfad);
    return `${s.mtimeMs}:${s.size}:${s.ino}`;
  } catch {
    return null;
  }
};

/** Reads the working copy under its lock. `null`: the file is gone. Throws `LayoutGesperrt` if the lock is held. */
function leseUnterSperre(pfad: string, wartenMs: number): { bytes: Buffer | null; groesse: number; stand: string } | null {
  try {
    return layoutUnterSperre(
      pfad,
      () => {
        const s = statSync(pfad);
        // A file far over the limit is never read into memory; the reader would refuse it anyway.
        const bytes = s.size > MAX_DATEI_BYTES * 2 ? null : readFileSync(pfad);
        return { bytes, groesse: s.size, stand: `${s.mtimeMs}:${s.size}:${s.ino}` };
      },
      { sperreWartenMs: wartenMs }
    );
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw fehler;
  }
}

function quittungSchreiben(pfad: string, q: GegenstandsQuittung): void {
  const temp = `${pfad}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(q, null, 2) + '\n');
    renameSync(temp, pfad);
  } catch (fehler) {
    rmSync(temp, { force: true });
    throw fehler;
  }
}

/** Writes the applied state as the last good one (atomic). Never throws: a failure is loud but does not stop the apply. */
function letzterGuterSchreiben(arbeitsDatei: string, eintraege: readonly GegenstandsEintrag[], log: GegenstandsLog): void {
  const ziel = gegenstandsLetzterGuterDatei(arbeitsDatei);
  const temp = `${ziel}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, schreibeGegenstandsDatei(eintraege));
    renameSync(temp, ziel);
  } catch (fehler) {
    rmSync(temp, { force: true });
    log.error(`[Gegenstaende] letzter guter Stand nicht geschrieben: ${(fehler as Error).message}`);
  }
}

/** The last good state, or `null` if there is none or it is not usable (then the empty state applies). */
function letzterGuterLesen(arbeitsDatei: string, log: GegenstandsLog): GegenstandsEintrag[] | null {
  const pfad = gegenstandsLetzterGuterDatei(arbeitsDatei);
  if (standVon(pfad) === null) return null;
  try {
    const lesung = leseGegenstandsDatei(readFileSync(pfad, 'utf-8'));
    if (lesung.dateiFehler || lesung.verworfen.length > 0) {
      log.error(`[Gegenstaende] ${pfad}: letzter guter Stand unbrauchbar (${lesung.dateiFehler ?? `${lesung.verworfen.length} verworfen`}), leerer Stand`);
      return null;
    }
    return lesung.eintraege;
  } catch (fehler) {
    log.error(`[Gegenstaende] ${pfad}: letzter guter Stand nicht lesbar (${(fehler as Error).message}), leerer Stand`);
    return null;
  }
}

export interface LadeErgebnis {
  art: 'fehlt' | 'angewendet' | 'abgelehnt' | 'verworfen' | 'letzter-guter';
  /** The entries that were applied (empty unless `angewendet` or `letzter-guter`). */
  eintraege: GegenstandsEintrag[];
  hash: string | null;
  /** `letzter-guter`: the receipt the watch writes at its start for the (rejected) working copy. */
  startQuittung?: { status: 'abgelehnt'; hash: string };
  /**
   * There was no usable last good state, so the start cannot tell what the working copy lost. The watch then compares
   * the working copy with what is HELD (names without a definition) at its first check, and the last good state is NOT
   * written until that check is through.
   */
  ohneGutenStand?: boolean;
}

export interface GegenstandsLog {
  log(text: string): void;
  warn(text: string): void;
  error(text: string): void;
}

/**
 * Start: read the working copy and apply it (main.ts, after the upload registry, before `createWovServer`).
 * A missing file is the empty state, not an error. A broken file or a file with discarded entries is NOT applied
 * (loud warning); the code items run on. The read takes the lock (at most 5 s); if it is held the state is
 * left empty and the watch applies the file with its first tick.
 */
export function ladeGegenstandsDatei(pfad: string, log: GegenstandsLog = console): LadeErgebnis {
  const r = ladeArbeitsDatei(pfad, log);
  if (r.art === 'angewendet') {
    // A valid file that lacks entries of the last good state is a removal, and a removal needs the confirmation
    // (the start cannot know what is held). So: keep the last good state, do NOT overwrite it, apply nothing of the
    // file; the watch counts what is held with its first tick and receipts `bestaetigung-noetig` or applies.
    const guter = letzterGuterLesen(pfad, log);
    if (guter !== null) {
      const neueIds = new Set(r.eintraege.map((e) => e.id));
      const fehlend = guter.map((e) => e.id).filter((id) => !neueIds.has(id));
      if (fehlend.length > 0) {
        try {
          wendeGegenstandsDatenAn(guter);
          log.warn(`[Gegenstaende] Arbeitsdatei nimmt ${fehlend.length} Eintrag/Eintraege weg (${fehlend.slice(0, 10).join(', ')}): LETZTER GUTER STAND geladen, die Wache prueft den Besitz und verlangt ggf. Bestaetigung`);
          return { art: 'letzter-guter', eintraege: guter, hash: r.hash };
        } catch (fehler) {
          log.error(`[Gegenstaende] letzter guter Stand nicht anwendbar (${(fehler as Error).message}), Arbeitsdatei wird angewendet`);
        }
      }
    }
    if (guter === null) {
      // No usable last good state (missing, 0 byte, broken): the file cannot be checked against it. The watch checks
      // it against what is held and writes the last good state only after that; until then a restart repeats this path.
      log.warn(`[Gegenstaende] kein brauchbarer letzter guter Stand: die Wache vergleicht die Arbeitsdatei mit dem Besitz, der letzte gute Stand wird erst danach geschrieben`);
      return { ...r, ohneGutenStand: true };
    }
    letzterGuterSchreiben(pfad, r.eintraege, log);
    return r;
  }
  if (r.art === 'verworfen') return fallbackLetzterGuter(pfad, r, log);
  if (r.art === 'abgelehnt' || (r.art === 'fehlt' && standVon(gegenstandsLetzterGuterDatei(pfad)) !== null)) return fallbackLetzterGuter(pfad, r, log);
  // Neither the working copy nor a last good state: a first start, or both files were lost. Data items held in saves
  // cannot be told apart from removed ones, so they stay kept until the watch has checked them (a first start holds
  // none: the watch writes the last good state with its first tick and the switch goes off again).
  if (r.art === 'fehlt') return { ...r, ohneGutenStand: true };
  return r;
}

/** The working copy is broken, rejected or gone: load the last good state if there is one. */
function fallbackLetzterGuter(pfad: string, r: LadeErgebnis, log: GegenstandsLog): LadeErgebnis {
  const guter = letzterGuterLesen(pfad, log);
  // Also a missing working copy: the last good state exists but is unusable (this function runs for `fehlt` only
  // then), so the held data items must stay kept until the watch has checked them.
  if (guter === null) return { ...r, ohneGutenStand: true };
  try {
    wendeGegenstandsDatenAn(guter);
  } catch (fehler) {
    log.error(`[Gegenstaende] letzter guter Stand nicht anwendbar (${(fehler as Error).message}), leerer Stand`);
    return r;
  }
  log.error(`[Gegenstaende] Arbeitsdatei ${r.art === 'fehlt' ? 'fehlt' : 'abgelehnt'}: LETZTER GUTER STAND geladen (${guter.length} Datenitem(s)), Quittung abgelehnt`);
  return { art: 'letzter-guter', eintraege: guter, hash: r.hash, startQuittung: { status: 'abgelehnt', hash: r.hash ?? '' } };
}

function ladeArbeitsDatei(pfad: string, log: GegenstandsLog): LadeErgebnis {
  let gelesen: ReturnType<typeof leseUnterSperre>;
  try {
    gelesen = standVon(pfad) === null ? null : leseUnterSperre(pfad, 5000);
  } catch (fehler) {
    log.warn(`[Gegenstaende] Arbeitsdatei gesperrt (${(fehler as Error).message}): Start ohne die Datei, die Wache holt es nach`);
    return { art: 'abgelehnt', eintraege: [], hash: null };
  }
  if (!gelesen) return { art: 'fehlt', eintraege: [], hash: null };
  if (!gelesen.bytes) {
    log.error(`[Gegenstaende] ${pfad}: Datei zu gross (${gelesen.groesse} Byte), nichts angewendet`);
    return { art: 'abgelehnt', eintraege: [], hash: null };
  }
  const hash = layoutHash(gelesen.bytes);
  const lesung = leseGegenstandsDatei(gelesen.bytes.toString('utf-8'));
  if (lesung.dateiFehler) {
    log.error(`[Gegenstaende] ${pfad}: Datei unbrauchbar (${lesung.dateiFehler}), NICHTS angewendet. Der Code-Bestand laeuft weiter.`);
    return { art: 'abgelehnt', eintraege: [], hash };
  }
  if (lesung.verworfen.length > 0) {
    log.error(`[Gegenstaende] ${pfad}: ${lesung.verworfen.length} Eintrag/Eintraege verworfen (${beschreibe(lesung.verworfen)}), NICHTS angewendet.`);
    return { art: 'verworfen', eintraege: [], hash };
  }
  try {
    wendeGegenstandsDatenAn(lesung.eintraege);
  } catch (fehler) {
    log.error(`[Gegenstaende] ${pfad}: Anwenden gescheitert (${(fehler as Error).message}), NICHTS angewendet.`);
    return { art: 'abgelehnt', eintraege: [], hash };
  }
  log.log(`[Gegenstaende] ${lesung.eintraege.length} Datenitem(s) geladen`);
  return { art: 'angewendet', eintraege: lesung.eintraege, hash };
}

const beschreibe = (verworfen: readonly VerworfenerEintrag[]): string =>
  verworfen.slice(0, 10).map((v) => `#${v.index}${v.id ? ` ${v.id}` : ''}: ${v.grund}`).join(', ') + (verworfen.length > 10 ? ` … (+${verworfen.length - 10})` : '');

export interface GegenstandsWacheAbhaengigkeiten {
  /** The working copy (`gegenstandsArbeitsDatei`). */
  readonly pfad: string;
  readonly quittungsPfad: string;
  /** Where the admin route leaves the confirmation request. */
  readonly bestaetigenPfad: string;
  /** The state the start applied (`ladeGegenstandsDatei`); empty if nothing was applied. */
  readonly angewendet?: readonly GegenstandsEintrag[];
  /** The start had no usable last good state (`LadeErgebnis.ohneGutenStand`). */
  readonly ohneGutenStand?: boolean;
  /** Names that are held but unknown (no definition, not in `istBekannt`): copies in inventories, saved players, chests. */
  readonly unbekanntGehalten?: (istBekannt: (name: string) => boolean) => Record<string, number>;
  /** Keep unknown stacks raw when a player or chest is loaded (on while `ohneGutenStand` is open). */
  readonly verwahren?: (an: boolean) => void;
  /** Start fell back to the last good state: the receipt for the rejected working copy (written at once). */
  readonly startQuittung?: { status: 'abgelehnt'; hash: string };
  /** A save is running: do not apply now. */
  readonly speichertGerade?: () => boolean;
  /** How many copies of each of these ids do inventories, chests and saved players hold? Only ids with more than 0. */
  readonly gehalten: (ids: ReadonlySet<string>) => Record<string, number>;
  /** Remove all copies of these ids for good (after the new state is applied). */
  readonly entfernen: (ids: ReadonlySet<string>) => void;
  /** Re-bind all inventories to the new definitions and send them to the peers. */
  readonly neuBinden: () => void;
  readonly log?: GegenstandsLog;
}

export class GegenstandsWache {
  private letzterStand: string | null = null;
  private letzterAnfrageStand: string | null = null;
  private angewendet: readonly GegenstandsEintrag[];
  private angewendetJson: string;
  /** Start without a usable last good state and the check against the held names is still open. */
  private ohneGutenStand: boolean;
  /** The last receipt `bestaetigung-noetig`: a confirmation covers exactly this hash and these ids (plus more copies of them). */
  private quittiert: { hash: string; ids: ReadonlySet<string> } | null = null;
  /** Sanitiser exceptions swallowed as `eintrag-ungueltig`, plus errors of the watch itself. */
  interneFehler = 0;

  constructor(private readonly d: GegenstandsWacheAbhaengigkeiten) {
    this.angewendet = d.angewendet ?? [];
    this.angewendetJson = JSON.stringify(this.angewendet);
    this.ohneGutenStand = d.ohneGutenStand === true;
    if (this.ohneGutenStand) d.verwahren?.(true);
    // The receipt and a confirmation of the previous run do not apply to this one.
    for (const p of [d.quittungsPfad, d.bestaetigenPfad]) {
      try {
        rmSync(p, { force: true });
      } catch (fehler) {
        this.log.error(`[Gegenstaende] ${p} nicht entfernt: ${(fehler as Error).message}`);
      }
    }
    if (d.startQuittung) this.quittiere(d.startQuittung.status, d.startQuittung.hash);
  }

  private get log(): GegenstandsLog {
    return this.d.log ?? console;
  }

  /** Call in the 1-second block. Never throws. */
  tick(): void {
    try {
      this.pruefe();
    } catch (fehler) {
      this.interneFehler++;
      this.log.error(`[Gegenstaende] Wache: ${(fehler as Error).stack ?? (fehler as Error).message}`);
    }
  }

  private pruefe(): void {
    const stand = standVon(this.d.pfad);
    if (stand === null) {
      // Gone for a moment (rename, maintenance): do nothing. Only the start without any file asks something of the watch.
      if (this.ohneGutenStand) this.ohneDatei();
      return;
    }
    const anfrageStand = standVon(this.d.bestaetigenPfad);
    const neueAnfrage = anfrageStand !== null && anfrageStand !== this.letzterAnfrageStand;
    if (stand === this.letzterStand && !neueAnfrage) {
      this.letzterAnfrageStand = anfrageStand;
      return;
    }
    if (this.d.speichertGerade?.()) return; // a save has priority; the next tick sees it all again

    let gelesen: ReturnType<typeof leseUnterSperre>;
    try {
      gelesen = leseUnterSperre(this.d.pfad, GESPERRT_WARTEN_MS);
    } catch (fehler) {
      if (fehler instanceof LayoutGesperrt) return; // a writer holds the lock: skip, nothing remembered
      throw fehler;
    }
    if (!gelesen) return;
    this.letzterStand = gelesen.stand;
    this.letzterAnfrageStand = anfrageStand;

    // The request is consumed whenever it changed, whether or not it fits this state (a request for an
    // overtaken state must not stay and meet a LATER one).
    let bestaetigterHash: string | null = null;
    if (neueAnfrage) {
      const r = bestaetigenAnfrageNehmen(this.d.bestaetigenPfad);
      if (r.art === 'ungueltig') this.log.warn(`[Gegenstaende] Bestaetigung ungueltig (${r.grund}), verbraucht, nichts bestaetigt`);
      else if (r.art === 'gueltig') bestaetigterHash = r.anfrage.hash;
    }

    if (!gelesen.bytes) {
      this.log.error(`[Gegenstaende] Arbeitsdatei zu gross (${gelesen.groesse} Byte), nichts angewendet`);
      this.quittiere('abgelehnt', `zu-gross:${gelesen.groesse}`);
      return;
    }
    const hash = layoutHash(gelesen.bytes);
    if (bestaetigterHash !== null && bestaetigterHash !== hash) {
      this.log.warn(`[Gegenstaende] Bestaetigung fuer einen ueberholten Stand (${bestaetigterHash.slice(0, 12)}, jetzt ${hash.slice(0, 12)}), nichts bestaetigt`);
    }
    const bestaetigt = bestaetigterHash === hash;
    const lesung = leseGegenstandsDatei(gelesen.bytes.toString('utf-8'));
    if (lesung.dateiFehler) {
      this.log.error(`[Gegenstaende] Arbeitsdatei unbrauchbar (${lesung.dateiFehler}), nichts angewendet, der alte Stand bleibt`);
      this.quittiere('abgelehnt', hash);
      return;
    }
    for (const v of lesung.verworfen) {
      if (v.grund !== 'eintrag-ungueltig') continue;
      this.interneFehler++;
      this.log.error(`[Gegenstaende] INTERNER FEHLER im Sanitizer: Eintrag #${v.index}${v.id ? ` (${v.id})` : ''} als eintrag-ungueltig verworfen, das kann aus JSON nicht entstehen`);
    }
    if (lesung.verworfen.length > 0) {
      this.log.warn(`[Gegenstaende] ${lesung.verworfen.length} Eintrag/Eintraege verworfen (${beschreibe(lesung.verworfen)}), nichts angewendet, der alte Stand bleibt`);
      this.quittiere('verworfen', hash, { verworfen: lesung.verworfen.map((v) => ({ index: v.index, id: v.id, grund: v.grund })) });
      return;
    }
    if (this.ohneGutenStand) {
      // Start without a last good state: what is held under a name that neither a definition nor this file knows is
      // a removal nobody can see, so it needs the confirmation like any other. The copies stay (kept raw) until then.
      const neu = new Set(lesung.eintraege.map((e) => e.id));
      const unbekannt = this.d.unbekanntGehalten?.((name) => neu.has(name) || findItem(name) !== undefined) ?? {};
      const ids = Object.keys(unbekannt);
      if (ids.length > 0) {
        const q = this.quittiert;
        const gedeckt = bestaetigt && q !== null && q.hash === hash && ids.every((id) => q.ids.has(id));
        if (!gedeckt) {
          this.log.warn(`[Gegenstaende] Bestaetigung noetig (kein letzter guter Stand), nichts entfernt: ${Object.entries(unbekannt).map(([id, n]) => `${n}x ${id}`).join(', ')} gehalten, in der Datei unbekannt`);
          this.quittiert = { hash, ids: new Set(ids) };
          this.quittiere('bestaetigung-noetig', hash, { gehalten: unbekannt });
          return;
        }
        this.d.entfernen(new Set(ids));
      }
      this.ohneGutenStand = false;
      this.quittiert = null;
      this.d.verwahren?.(false);
      if (JSON.stringify(lesung.eintraege) === this.angewendetJson) {
        letzterGuterSchreiben(this.d.pfad, lesung.eintraege, this.log);
        this.quittiere('angewendet', hash);
        return;
      }
    }
    if (JSON.stringify(lesung.eintraege) === this.angewendetJson) {
      this.quittiere('angewendet', hash); // nothing to do (also a re-formatted file)
      return;
    }

    const neueIds = new Set(lesung.eintraege.map((e) => e.id));
    const entfernt = new Set(this.angewendet.map((e) => e.id).filter((id) => !neueIds.has(id)));
    let gehalten: Record<string, number> = {};
    if (entfernt.size > 0) {
      gehalten = this.d.gehalten(entfernt);
      const ids = Object.keys(gehalten);
      if (ids.length > 0) {
        // The confirmation covers only what the receipt showed: the same hash and only ids that stood in it.
        // A further removed id that is held now, or a confirmation without a receipt of this run, is a new receipt.
        const q = this.quittiert;
        const gedeckt = bestaetigt && q !== null && q.hash === hash && ids.every((id) => q.ids.has(id));
        if (!gedeckt) {
          this.log.warn(`[Gegenstaende] Bestaetigung noetig, nichts angewendet: ${Object.entries(gehalten).map(([id, n]) => `${n}x ${id}`).join(', ')} noch im Besitz`);
          this.quittiert = { hash, ids: new Set(ids) };
          this.quittiere('bestaetigung-noetig', hash, { gehalten });
          return;
        }
      }
    }
    try {
      wendeGegenstandsDatenAn(lesung.eintraege);
    } catch (fehler) {
      this.interneFehler++;
      this.log.error(`[Gegenstaende] Anwenden gescheitert (${(fehler as Error).message}), der alte Stand bleibt`);
      this.quittiere('abgelehnt', hash);
      return;
    }
    if (entfernt.size > 0) this.d.entfernen(entfernt);
    this.angewendet = lesung.eintraege;
    this.quittiert = null;
    this.angewendetJson = JSON.stringify(lesung.eintraege);
    letzterGuterSchreiben(this.d.pfad, lesung.eintraege, this.log);
    this.d.neuBinden();
    this.log.log(`[Gegenstaende] angewendet: ${lesung.eintraege.length} Datenitem(s)${entfernt.size > 0 ? `, ${entfernt.size} entfernt` : ''}`);
    this.quittiere('angewendet', hash);
  }

  /**
   * Start without working copy and without last good state, and the file is still missing: there is nothing to apply,
   * so only what is held under an unknown name matters. Nothing held: the state is settled and the last good state is
   * written (a first start). Something held: its loss needs the confirmation; the file is what the operator creates.
   */
  private ohneDatei(): void {
    if (this.d.speichertGerade?.()) return;
    const unbekannt = this.d.unbekanntGehalten?.((name) => findItem(name) !== undefined) ?? {};
    const ids = Object.keys(unbekannt);
    if (ids.length > 0) {
      const hash = layoutHash(Buffer.alloc(0));
      if (this.quittiert?.hash === hash && ids.every((id) => this.quittiert!.ids.has(id))) return; // receipt stands
      this.log.warn(`[Gegenstaende] Bestaetigung noetig (keine Arbeitsdatei, kein letzter guter Stand), nichts entfernt: ${Object.entries(unbekannt).map(([id, n]) => `${n}x ${id}`).join(', ')} gehalten`);
      this.quittiert = { hash, ids: new Set(ids) };
      this.quittiere('bestaetigung-noetig', hash, { gehalten: unbekannt });
      return;
    }
    this.ohneGutenStand = false;
    this.quittiert = null;
    this.d.verwahren?.(false);
    letzterGuterSchreiben(this.d.pfad, this.angewendet, this.log);
  }

  private quittiere(status: GegenstandsStatus, hash: string, zusatz: { gehalten?: Record<string, number>; verworfen?: GegenstandsQuittung['verworfen'] } = {}): void {
    const q: GegenstandsQuittung = { status, hash, zeit: new Date().toISOString(), ...zusatz };
    try {
      quittungSchreiben(this.d.quittungsPfad, q);
    } catch (fehler) {
      this.log.error(`[Gegenstaende] Quittung nicht geschrieben: ${(fehler as Error).message}`);
    }
  }
}
