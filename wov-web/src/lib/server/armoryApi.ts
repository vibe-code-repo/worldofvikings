/**
 * Zugriff auf die Rüstkammer des Spielservers — serverseitig.
 *
 * Gleiches Muster wie `forumApi.ts`: derselbe Spielserver (127.0.0.1:2467 oder
 * `WOV_GAME_API`), kein Umweg über den öffentlichen Proxy, nichts über
 * `/api/`. Neu gegenüber dem Forum ist das Zeitlimit: Die Rüstkammer ist eine
 * Übersichtsseite, und ein hängender Spielserver soll sie nicht aufhängen,
 * sondern den ruhigen Fehlerzustand auslösen.
 *
 * Das Ergebnis hält „gibt es nicht“ (404) und „Spielserver antwortet nicht“
 * (Netzfehler, Zeitlimit, kaputtes JSON, falsche Form: status 0) auseinander.
 * Die Antwort läuft durch die Normalisierer aus `recken.ts`; was dort nicht
 * auf der Positivliste steht, kommt nicht durch.
 *
 * Server-side access to the armory routes of the game server, with a time
 * limit and a result that keeps "not found" and "game server down" apart.
 */

import { normalisiereListe, normalisiereRecke, type Recke, type ReckenListe } from '../recken';
import type { Ergebnis } from './forumApi';

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** Zeitlimit je Abruf in ms. Länger als der Spielserver je braucht, kürzer als ein Besucher wartet. */
export const ZEITLIMIT_MS = 4000;

/** Größte Antwort in Zeichen, die wir lesen; darüber gilt der Spielserver als fehlerhaft. */
export const ANTWORT_MAX = 2 * 1024 * 1024;

/** Den Körper lesen, aber nie mehr als ANTWORT_MAX Zeichen im Speicher halten. */
async function liesBegrenzt(res: Response): Promise<string> {
  const laenge = Number(res.headers.get('content-length') ?? '0');
  if (laenge > ANTWORT_MAX) throw new Error('zu gross');
  if (!res.body) {
    const text = await res.text();
    if (text.length > ANTWORT_MAX) throw new Error('zu gross');
    return text;
  }
  const leser = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length > ANTWORT_MAX) {
      await leser.cancel();
      throw new Error('zu gross');
    }
  }
  return text + decoder.decode();
}

/** Längster Suchbegriff, den der Server annimmt (Armory.ts: ARMORY_SUCHE_MAX). */
const SUCHE_MAX = 32;

/** Eine Besucheradresse, wie sie in `X-Forwarded-For` stehen darf (IPv4/IPv6, keine Sonderzeichen). */
const ADRESSE_MUSTER = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * Der Kopf, der die Adresse des Besuchers an den Spielserver weitergibt.
 * Der Abruf läuft über Loopback; ohne den Kopf teilten sich alle Besucher
 * eine Herkunft und damit eine Drossel. Fehlt die Adresse oder sieht sie
 * seltsam aus, geht kein Kopf mit.
 */
export function weiterleitung(besucher: string | undefined): Record<string, string> {
  return besucher && ADRESSE_MUSTER.test(besucher) ? { 'x-forwarded-for': besucher } : {};
}

/** Die Adresse des Besuchers aus dem Adapter; der Adapter wirft, wenn er keine kennt. */
export function adresseVon(getClientAddress: () => string): string | undefined {
  try {
    return getClientAddress();
  } catch {
    return undefined;
  }
}

export interface AbrufOptionen {
  /** Adresse des Besuchers (`event.getClientAddress()`), wird als `X-Forwarded-For` mitgegeben. */
  besucher?: string;
  /** Basisadresse; Vorgabe `WOV_GAME_API` bzw. der lokale Spielserver. */
  basis?: string;
  zeitlimitMs?: number;
}

function basisAdresse(opt: AbrufOptionen): string {
  return opt.basis ?? process.env.WOV_GAME_API ?? 'http://127.0.0.1:2467';
}

async function hole(fetch: Fetcher, pfad: string, opt: AbrufOptionen): Promise<Ergebnis<unknown>> {
  const regler = new AbortController();
  let uhr: ReturnType<typeof setTimeout> | undefined;
  const limit = opt.zeitlimitMs ?? ZEITLIMIT_MS;
  try {
    const abgelaufen = new Promise<never>((_, nein) => {
      uhr = setTimeout(() => {
        regler.abort();
        nein(new Error('zeitlimit'));
      }, limit);
    });
    const antwort = await Promise.race([
      (async () => {
        const res = await fetch(`${basisAdresse(opt)}${pfad}`, {
          headers: { accept: 'application/json', ...weiterleitung(opt.besucher) },
          signal: regler.signal,
        });
        if (!res.ok) return { ok: false, status: res.status } as const;
        return { ok: true, data: JSON.parse(await liesBegrenzt(res)) as unknown } as const;
      })(),
      abgelaufen,
    ]);
    return antwort;
  } catch {
    // Netzfehler, Zeitlimit oder kein gültiges JSON: kein HTTP-Code, status 0.
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(uhr);
  }
}

/** `?q=` auf die Länge begrenzen, die der Server versteht. */
export function sucheAus(roh: string | null): string {
  return Array.from((roh ?? '').trim())
    .slice(0, SUCHE_MAX)
    .join('');
}

/** `?seite=` als ganze Zahl >= 1; Müll wird zu 1. */
export function seiteAus(roh: string | null): number {
  const n = Number(roh ?? '1');
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 1_000_000) : 1;
}

export async function ladeRuestkammer(
  fetch: Fetcher,
  q: string,
  seite: number,
  opt: AbrufOptionen = {},
): Promise<Ergebnis<ReckenListe>> {
  const suche = q === '' ? '' : `&q=${encodeURIComponent(q)}`;
  const r = await hole(fetch, `/accounts/armory?seite=${seite}${suche}`, opt);
  if (!r.ok) return r;
  const liste = normalisiereListe(r.data);
  // Eine Antwort ohne Listenform ist ein Vertragsbruch, kein „leer“.
  return liste ? { ok: true, data: liste } : { ok: false, status: 0 };
}

export async function ladeRecke(
  fetch: Fetcher,
  id: number,
  opt: AbrufOptionen = {},
): Promise<Ergebnis<Recke>> {
  const r = await hole(fetch, `/accounts/armory/${id}`, opt);
  if (!r.ok) return r;
  const recke = normalisiereRecke(r.data);
  return recke ? { ok: true, data: recke } : { ok: false, status: 0 };
}
