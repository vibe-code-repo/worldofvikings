/**
 * "Speichern & neu starten" of the terrain tab, DOM-free: save the draft, and
 * ONLY if that worked ask the operations service for a restart, then wait until
 * the game service runs again. `fetch`, the clock and the sleep are injected.
 *
 * Gelände-Reiter „Speichern & neu starten“, ohne DOM: Entwurf speichern, NUR bei
 * Erfolg beim Betriebsdienst einen Neustart anfordern, dann warten, bis der
 * Spielserver wieder läuft. `fetch`, Uhr und Schlaf kommen von außen.
 *
 * Decision (Z3): a held-back deletion (`loeschsperre` / `bestaetigung-noetig`)
 * does NOT stop the restart. Terrain is not affected, and the hold survives the
 * restart (the lock file), so nothing is lost; the final text only says that
 * the deletions stay until they are confirmed in the map editor.
 * Entscheid (Z3): Eine zurückgehaltene Löschung hält den Neustart NICHT an.
 * Gelände ist nicht betroffen, die Sperre überlebt den Neustart (Sperrdatei);
 * der Schlusstext nennt nur, dass die Löschungen bis zur Bestätigung im
 * Karteneditor stehen bleiben.
 */
import { serverStatusAnzeige, type DienstZustand } from '../serverSteuerung';
import { entwurfSpeichern, hoehenGrund, verworfenText, type EntwurfDienste, type HoehenProblem, type VerworfenTeil } from './entwurfSpeichern';
import { t } from '../i18n';

/** Same limits as the map editor's `dienstAbwarten`: stable for 6 s, give up after 60 s. */
export const STABIL_MS = 6_000;
export const LIMIT_MS = 60_000;
/** Hard cap on the polls, so a clock that jumps cannot keep the button locked (N2). */
export const MAX_ABFRAGEN = Math.ceil(LIMIT_MS / 1_500) * 2;
export const TAKT_MS = 1_500;

export type NeustartPhase = 'speichert' | 'startet-neu' | 'laeuft-wieder' | 'fehler';

export type NeustartFehler =
  | { grund: 'kein-entwurf' }
  | { grund: 'unbrauchbar' }
  | { grund: 'hoehe'; problem: HoehenProblem }
  | { grund: 'verworfen'; teile: VerworfenTeil[] }
  | { grund: 'entwurf'; fehler: string }
  | { grund: 'speichern'; message: string }
  | { grund: 'aktion-laeuft' }
  | { grund: 'neustart'; message: string }
  | { grund: 'zeitlimit'; sekunden: number }
  | { grund: 'netz'; fehler: string };

export type NeustartStatus =
  | { phase: 'speichert' }
  /** `unklar`: the answer to the restart request is missing (network, 504); the state is being checked. */
  | { phase: 'startet-neu'; sekunden: number; unklar?: boolean }
  | {
      phase: 'laeuft-wieder';
      sekunden: number;
      loeschsperre: number;
      /** The text of the service's save answer (a warning like 202 `abgelehnt` is in it). */
      meldung: string;
      /** Routes without a point that were left out of the save (not an error). */
      leereRouten: number;
      /** The restart itself was never confirmed; the service merely runs. */
      unklar: boolean;
      /** The draft changed while the run went on: those changes are not on the server. */
      striche: boolean;
    }
  | ({ phase: 'fehler' } & NeustartFehler);

/** What of `fetch` is used (a real `Response` fits). */
export type Holen = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The real `fetch` (kept here so the flight module itself never calls `fetch`, see `testflug-modul.ts`). */
export const echtesHolen: Holen = (url, init) => fetch(url, init);

/** A monotone clock in ms: a jump of the wall clock must not lock the button or give negative seconds. */
export const monotoneUhr = (): number => performance.now();

export interface NeustartDienste {
  entwurf: EntwurfDienste;
  holen: Holen;
  jetzt(): number;
  schlafe(ms: number): Promise<void>;
  /** Called on every change of the state (also each poll, with the seconds). */
  status(s: NeustartStatus): void;
}

async function jsonOderLeer(r: { json(): Promise<unknown> }): Promise<Record<string, unknown>> {
  try {
    const j = await r.json();
    return typeof j === 'object' && j !== null ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** `GET /api/server`: the service state, `null` when it cannot be read (the service is restarting). */
async function dienstZustand(holen: Holen): Promise<DienstZustand | null> {
  try {
    const r = await holen('/api/server');
    if (!r.ok) return null;
    const j = await jsonOderLeer(r);
    const z = j.zustand;
    return typeof z === 'object' && z !== null ? (z as DienstZustand) : null;
  } catch {
    return null;
  }
}

/** Connected players for the confirmation; `null` when the service gives no number. */
export async function spielerLesen(holen: Holen): Promise<number | null> {
  try {
    const r = await holen('/api/server');
    if (!r.ok) return null;
    const n = (await jsonOderLeer(r)).spieler;
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export interface NeustartLauf {
  /** `true` from the click until the end; the button is locked meanwhile. */
  laeuft(): boolean;
  /** `null`: ignored, because a run is already going (double click). */
  starten(): Promise<NeustartStatus | null>;
}

export function neustartLauf(d: NeustartDienste): NeustartLauf {
  let laeuft = false;
  const melde = (s: NeustartStatus): NeustartStatus => {
    d.status(s);
    return s;
  };
  const fehler = (f: NeustartFehler): NeustartStatus => melde({ phase: 'fehler', ...f });

  async function ablauf(): Promise<NeustartStatus> {
    melde({ phase: 'speichert' });
    // R6: the storage may throw on a read; that is a message, not a run stuck on "Speichere …".
    let rohVorher: string | null;
    try {
      rohVorher = d.entwurf.rohtext?.() ?? null;
    } catch (err) {
      return fehler({ grund: 'entwurf', fehler: String(err) });
    }
    const e = await entwurfSpeichern(d.entwurf);
    if (e.art === 'kein-entwurf') return fehler({ grund: 'kein-entwurf' });
    if (e.art === 'unbrauchbar') return fehler({ grund: 'unbrauchbar' });
    if (e.art === 'unlesbar') return fehler({ grund: 'entwurf', fehler: e.fehler });
    if (e.art === 'hoehe') return fehler({ grund: 'hoehe', problem: e.problem });
    if (e.art === 'verworfen') return fehler({ grund: 'verworfen', teile: e.teile });
    if (e.art === 'ausnahme') return fehler({ grund: 'netz', fehler: e.fehler });
    if (!e.antwort.ok) return fehler({ grund: 'speichern', message: e.antwort.message });
    const loeschsperre = e.antwort.loeschsperre ?? 0;
    const leereRouten = e.leereRouten;
    // R7: after a restart "written, not applied (geo)" is outdated and reads like a contradiction; a warning
    // about objects (`abgelehnt`, …) stays.
    const meldung = e.antwort.grund === 'geo' || e.antwort.grund === 'server-aus' ? '' : e.antwort.message;

    melde({ phase: 'startet-neu', sekunden: 0 });
    // No answer (network, gateway timeout) does not mean "no restart": the service answers only after `systemctl`.
    let unklar = false;
    try {
      const r = await d.holen('/api/server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aktion: 'neustart' }),
      });
      if (r.status === 409) return fehler({ grund: 'aktion-laeuft' });
      if (r.status === 502 || r.status === 504) unklar = true;
      else if (!r.ok) {
        const j = await jsonOderLeer(r);
        const grund = typeof j.message === 'string' ? j.message : typeof j.fehler === 'string' ? j.fehler : `HTTP ${r.status}`;
        return fehler({ grund: 'neustart', message: grund });
      }
    } catch {
      unklar = true;
    }

    // The time limit starts AFTER the answer to the restart request (as in the map editor).
    const start = d.jetzt();
    let stabilSeit: number | null = null;
    for (let abfragen = 0; ; abfragen++) {
      const jetzt = d.jetzt();
      const anzeige = serverStatusAnzeige(await dienstZustand(d.holen));
      const sek = Math.max(0, Math.round((jetzt - start) / 1000));
      if (anzeige.art === 'laeuft') {
        stabilSeit ??= jetzt;
        // `systemctl restart` returns before the world stands: hold on a moment.
        if (d.jetzt() - stabilSeit > STABIL_MS) {
          // R6: unreadable storage now: whether strokes came in meanwhile is unknown, so the note applies.
          let striche: boolean;
          try {
            const rohNachher = d.entwurf.rohtext?.() ?? null;
            striche = rohVorher !== null && rohNachher !== rohVorher;
          } catch {
            striche = rohVorher !== null;
          }
          return melde({ phase: 'laeuft-wieder', sekunden: sek, loeschsperre, meldung, leereRouten, unklar, striche });
        }
      } else {
        stabilSeit = null;
      }
      if (d.jetzt() - start > LIMIT_MS || abfragen >= MAX_ABFRAGEN) {
        return fehler({ grund: 'zeitlimit', sekunden: Math.max(0, Math.round((d.jetzt() - start) / 1000)) });
      }
      melde({ phase: 'startet-neu', sekunden: sek, ...(unklar ? { unklar: true } : {}) });
      await d.schlafe(TAKT_MS);
    }
  }

  return {
    laeuft: () => laeuft,
    async starten() {
      if (laeuft) return null;
      laeuft = true;
      try {
        return await ablauf();
      } catch (err) {
        // Whatever throws unexpectedly: the line must not stay on "Speichere …".
        return fehler({ grund: 'netz', fehler: String(err) });
      } finally {
        laeuft = false;
      }
    },
  };
}

/** The text of a state for the panel line. */
export function neustartText(s: NeustartStatus): string {
  switch (s.phase) {
    case 'speichert':
      return t('testflug.neustart.status.speichert');
    case 'startet-neu':
      return s.unklar
        ? t('testflug.neustart.status.startet_neu_unklar', { sekunden: s.sekunden })
        : t('testflug.neustart.status.startet_neu', { sekunden: s.sekunden });
    case 'laeuft-wieder': {
      const teile = [
        s.unklar ? t('testflug.neustart.status.laeuft_unklar', { sekunden: s.sekunden }) : t('testflug.neustart.status.laeuft_wieder', { sekunden: s.sekunden }),
      ];
      if (s.meldung !== '') teile.push(t('testflug.neustart.status.meldung', { message: s.meldung }));
      if (s.leereRouten > 0) teile.push(t('testflug.gelaende.leere_route'));
      if (s.loeschsperre > 0) teile.push(t('testflug.neustart.status.loeschsperre', { count: s.loeschsperre }));
      if (s.striche) teile.push(t('testflug.neustart.status.striche'));
      return teile.join(' ');
    }
    case 'fehler':
      switch (s.grund) {
        case 'kein-entwurf':
          return t('testflug.kein_entwurf_speichern');
        case 'unbrauchbar':
          return t('testflug.entwurf_unbrauchbar');
        case 'hoehe':
          return t('testflug.gelaende.hoehe.beschaedigt', { grund: hoehenGrund(s.problem) });
        case 'verworfen':
          return t('testflug.gelaende.verworfen.beschaedigt', { liste: verworfenText(s.teile) });
        case 'entwurf':
          return t('testflug.neustart.fehler.entwurf_unlesbar', { fehler: s.fehler });
        case 'speichern':
          return t('testflug.neustart.fehler.speichern', { message: s.message });
        case 'aktion-laeuft':
          return t('testflug.neustart.fehler.aktion_laeuft');
        case 'neustart':
          return t('testflug.neustart.fehler.neustart', { grund: s.message });
        case 'zeitlimit':
          return t('testflug.neustart.fehler.zeitlimit', { sekunden: s.sekunden });
        case 'netz':
          return t('testflug.neustart.fehler.netz', { fehler: s.fehler });
      }
  }
}
