/**
 * Time limits of the website calls and the half-way flow of "Auf Fahrt
 * gehen" (card W2), against a real HTTP stub on port 0. The calls under test
 * are the real ones from account.ts and losfahren.ts; nothing is mocked but
 * the server they talk to, so a hanging host, a lost answer and a 503 are
 * the same events the browser sees.
 *
 * The 20 s limit is shortened with `setCallTimeoutForTests` (real time, a few
 * hundred ms) instead of fake timers: fake timers do not reach
 * `AbortSignal.timeout` or the sockets of the stub, so they would test the
 * clock and not the call. Case a) still proves the limit is the one that
 * ends the call: without it the call hangs and the guard below reports it.
 */
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Fahrt, Konto, Wunsch } from './losfahren';

type Held = { id: number; name: string; created: number; lastPlayed: number | null };
interface Verhalten {
  nieAntworten?: boolean;
  kopfDannStille?: boolean;
  fremd?: string[];
  playFehler?: number;
  speichernOhneAntwort?: boolean;
  hangErsteAnlage?: boolean;
}
interface Zustand {
  helden: Held[];
  anlegen: number;
  play: number[];
  me: number;
  verhalten: Verhalten;
  naechsteId: number;
}

/** Test limit in ms; the guard gives a call one more second to end. */
const LIMIT = 300;
const GUARD = LIMIT + 1000;

const szenarien = new Map<string, Zustand>();
const zustand = (name: string): Zustand => {
  let z = szenarien.get(name);
  if (!z) {
    z = { helden: [], anlegen: 0, play: [], me: 0, verhalten: {}, naechsteId: 100 };
    szenarien.set(name, z);
  }
  return z;
};

const offen = new Set<ServerResponse>();
let stub: Server;
// Imported only after the stub is up (see beforeAll), hence `let`.
let account: typeof import('./account');
let ablauf: typeof import('./losfahren');

beforeAll(async () => {
  stub = createServer((req, res) => {
    offen.add(res);
    res.on('close', () => offen.delete(res));
    const z = zustand(String(req.headers['x-wov-account'] ?? 'ohne'));
    const v = z.verhalten;
    let body = '';
    req.on('data', (d) => {
      body += d;
    });
    req.on('end', () => {
      const json = (status: number, obj: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const url = req.url ?? '';
      if (v.nieAntworten) return; // connection accepted, never an answer
      if (v.kopfDannStille) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"acc');
        return; // head sent, body stalls
      }
      if (url === '/accounts/login' || url === '/accounts/register') {
        return json(200, { token: 't', account: { id: 1, username: 'x' } });
      }
      if (url === '/accounts/me') {
        z.me++;
        return json(200, { account: { id: 1, username: 'x' }, characters: z.helden });
      }
      if (url === '/accounts/characters' && req.method === 'POST') {
        z.anlegen++;
        const w = JSON.parse(body) as Wunsch;
        const vergeben = (v.fremd ?? []).concat(z.helden.map((h) => h.name));
        if (vergeben.some((n) => n.toLowerCase() === w.name.toLowerCase())) {
          return json(409, { error: 'name-taken' });
        }
        const held = { id: z.naechsteId++, ...w, created: Date.now(), lastPlayed: null };
        if (v.speichernOhneAntwort && z.anlegen === 1) {
          z.helden.push(held); // arrived at the server, the answer is lost
          return;
        }
        if (v.hangErsteAnlage && z.anlegen === 1) return; // not stored, no answer
        z.helden.push(held);
        return json(201, { character: held });
      }
      const m = /^\/accounts\/characters\/(\d+)\/play$/.exec(url);
      if (m) {
        const id = Number(m[1]);
        z.play.push(id);
        const held = z.helden.find((h) => h.id === id);
        if (!held) return json(404, { error: 'unknown' });
        if (v.playFehler && z.play.length <= v.playFehler)
          return json(503, { error: 'server-error' });
        return json(200, { sessionToken: `ticket-${id}`, character: held });
      }
      json(404, { error: 'unknown' });
    });
  });
  await new Promise<void>((ok) => stub.listen(0, '127.0.0.1', ok));
  const port = (stub.address() as AddressInfo).port;
  // account.ts reads the address of the shore from a Vite `define` constant.
  vi.stubGlobal('WOV_DEV_ORIGIN', `http://127.0.0.1:${port}`);
  account = await import('./account');
  ablauf = await import('./losfahren');
  account.setCallTimeoutForTests?.(LIMIT);
});

afterAll(async () => {
  for (const r of offen) r.destroy();
  await new Promise((ok) => stub.close(ok));
  vi.unstubAllGlobals();
});

/** Runs `fn`; if it has not ended after `grenze` ms it counts as hanging. */
async function messe<T>(fn: () => Promise<T>, grenze: number) {
  const t0 = performance.now();
  let ende: ReturnType<typeof setTimeout> | undefined;
  const stopp = new Promise<{ haengt: true }>((ok) => {
    ende = setTimeout(() => ok({ haengt: true }), grenze);
  });
  const lauf = fn().then(
    (wert) => ({ wert }),
    (fehler: unknown) => ({ fehler }),
  );
  const r = (await Promise.race([lauf, stopp])) as {
    wert?: T;
    fehler?: unknown;
    haengt?: true;
  };
  clearTimeout(ende);
  return { ...r, ms: Math.round(performance.now() - t0) };
}

const schluessel = (r: { fehler?: unknown; haengt?: true }): string | null =>
  (r.fehler as { key?: string } | undefined)?.key ??
  (r.haengt ? 'HAENGT' : r.fehler ? String(r.fehler) : null);

const wunsch = (name = 'Ragnar'): Wunsch => ({
  name,
  figure: 'wikinger',
  hairstyle: 'H_04',
  hairColor: 'blond',
  eyeColor: 'blau',
  classId: 'krieger',
  top: '',
  legs: '',
});

/** The flow of the page: real calls of account.ts, real `fahreLos`. */
function baueAblauf(
  token: string,
  gestade = 'dev',
): (w: Wunsch) => Promise<{ sessionToken: string }> {
  const konto: Konto = {
    createCharacter: (w) => account.createCharacter('dev', token, w),
    characters: () => account.me('dev', token),
    play: (id) => account.play('dev', token, id),
  };
  const fahrt: Fahrt = ablauf.neueFahrt();
  return (w) => ablauf.fahreLos(konto, fahrt, w, gestade);
}

describe.concurrent('a) Zeitlimit', () => {
  const einzeln: [string, () => Promise<unknown>][] = [
    ['login', () => account.login('dev', 'x', 'passwort1')],
    ['register', () => account.register('dev', 'x', 'x@example.org', 'passwort1')],
    ['createCharacter', () => account.createCharacter('dev', 'a', wunsch())],
    ['play', () => account.play('dev', 'a', 1)],
    ['me', () => account.me('dev', 'a')],
    ['deleteCharacter', () => account.deleteCharacter('dev', 'a', 1)],
  ];
  // login/register send no token: their scenario is `ohne`.
  zustand('ohne').verhalten.nieAntworten = true;
  zustand('a').verhalten.nieAntworten = true;
  for (const [name, aufruf] of einzeln) {
    it(`${name} ohne Antwort endet mit ApiError('timeout') binnen Limit + 1 s`, async () => {
      const m = await messe(aufruf, GUARD);
      expect(schluessel(m)).toBe('timeout');
      expect(m.ms).toBeGreaterThanOrEqual(LIMIT - 50);
      expect(m.ms).toBeLessThanOrEqual(GUARD);
    });
  }

  it("Antwortkopf gesendet, Rumpf haengt: 'timeout', kein stiller Erfolg", async () => {
    zustand('ak').verhalten.kopfDannStille = true;
    const m = await messe(() => account.me('dev', 'ak'), GUARD);
    expect(schluessel(m)).toBe('timeout');
    expect(m.ms).toBeLessThanOrEqual(GUARD);
  });

  it('shoreStatus behaelt seine 4 s (Signal mit 4000 ms angefordert)', async () => {
    // A real 4 s wait would eat the time budget of the suite; the witness is
    // the limit the call asks its signal for, and it must be the 4 s and
    // not the default. The abort itself is proven by the cases above.
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const fetchAlt = globalThis.fetch;
    vi.stubGlobal('fetch', async () => new Response('{"players":1,"slots":2}'));
    try {
      const s = await account.shoreStatus('dev');
      expect(s).toEqual({ players: 1, slots: 2 });
      expect(spy).toHaveBeenCalledWith(4000);
    } finally {
      spy.mockRestore();
      vi.stubGlobal('fetch', fetchAlt);
    }
  });
});

describe.concurrent('b) Anlage ok, play 503, nochmal', () => {
  it('zweiter Klick nimmt dieselbe Id, anderer Name legt neu an', async () => {
    const z = zustand('b');
    z.verhalten.playFehler = 1;
    const los = baueAblauf('b');
    const e1 = await messe(() => los(wunsch()), 5000);
    const e2 = await messe(() => los(wunsch()), 5000);
    expect(schluessel(e1)).toBe('server-error');
    expect(e2.wert?.sessionToken).toBe('ticket-100');
    expect(z.anlegen).toBe(1);
    expect(z.play).toEqual([100, 100]);
    const e3 = await messe(() => los(wunsch('Bjorn')), 5000);
    expect(e3.wert?.sessionToken).toBe('ticket-101');
    expect(z.anlegen).toBe(2);
  });
});

describe.concurrent('c) Anlage kam an, Antwort ging verloren', () => {
  it('zweiter Versuch findet den eigenen Recken, kein name-taken', async () => {
    const z = zustand('c');
    z.verhalten.speichernOhneAntwort = true;
    const los = baueAblauf('c');
    const e1 = await messe(() => los(wunsch()), GUARD + 2000);
    expect(schluessel(e1)).toBe('timeout');
    expect(e1.ms).toBeLessThanOrEqual(GUARD);
    const e2 = await messe(() => los(wunsch()), 5000);
    expect(e2.fehler).toBeUndefined();
    expect(e2.wert?.sessionToken).toBe('ticket-100');
    expect(z.helden).toHaveLength(1);
    expect(z.me).toBe(1);
    expect(z.play).toEqual([100]);
  });
});

describe.concurrent('d) fremder Name bleibt fremd', () => {
  it('d) frischer Versuch, Name gehoert einem anderen Konto: name-taken, kein play', async () => {
    const z = zustand('d1');
    z.verhalten.fremd = ['Ragnar'];
    const r = await messe(() => baueAblauf('d1')(wunsch()), 5000);
    expect(schluessel(r)).toBe('name-taken');
    expect(z.play).toHaveLength(0);
  });

  it('d2) nach Zeitablauf Name inzwischen fremd: Konto abgefragt, kein eigener, name-taken', async () => {
    const z = zustand('d2');
    z.verhalten.hangErsteAnlage = true;
    const los = baueAblauf('d2');
    const a = await messe(() => los(wunsch()), GUARD + 2000);
    z.verhalten.fremd = ['Ragnar'];
    const b = await messe(() => los(wunsch()), 5000);
    expect(schluessel(a)).toBe('timeout');
    expect(schluessel(b)).toBe('name-taken');
    expect(z.me).toBe(1);
    expect(z.play).toHaveLength(0);
  });

  it('d3) gleichnamiger Recke ohne unklaren Versuch wird nicht still uebernommen', async () => {
    const z = zustand('d3');
    z.helden.push({ id: 7, ...wunsch(), created: 1, lastPlayed: null });
    const r = await messe(() => baueAblauf('d3')(wunsch()), 5000);
    expect(schluessel(r)).toBe('name-taken');
    expect(z.play).toHaveLength(0);
  });

  it('d4) unklarer Versuch, eigener Recke mit ANDEREM Namen, Wunschname fremd: name-taken, play 0', async () => {
    const z = zustand('d4');
    z.verhalten.hangErsteAnlage = true;
    const los = baueAblauf('d4');
    const a = await messe(() => los(wunsch()), GUARD + 2000);
    z.helden.push({ id: 7, ...wunsch('Sven'), created: 1, lastPlayed: null });
    z.verhalten.fremd = ['Ragnar'];
    const b = await messe(() => los(wunsch()), 5000);
    expect(schluessel(a)).toBe('timeout');
    expect(schluessel(b)).toBe('name-taken');
    expect(z.play).toHaveLength(0);
    expect(z.me).toBe(1);
  });
});

describe.concurrent('e) play mit endgueltiger Absage', () => {
  it('Gedaechtnis faellt, der dritte Klick legt neu an', async () => {
    const z = zustand('e');
    z.verhalten.playFehler = 1;
    const los = baueAblauf('e');
    const e1 = await messe(() => los(wunsch()), 5000);
    z.helden.length = 0; // the hero is deleted elsewhere
    const e2 = await messe(() => los(wunsch()), 5000);
    const e3 = await messe(() => los(wunsch()), 5000);
    expect(schluessel(e1)).toBe('server-error');
    expect(schluessel(e2)).toBe('unknown');
    expect(e3.wert?.sessionToken).toBe('ticket-101');
    expect(z.anlegen).toBe(2);
    expect(z.play).toEqual([100, 100, 101]);
  });
});

describe.concurrent('f) Gestade gehoert in den Schluessel', () => {
  it('gleiche Id an einem anderen Gestade ist ein anderer Recke', async () => {
    const za = zustand('fa');
    za.verhalten.playFehler = 1;
    const zb = zustand('fb');
    zb.helden.push({ id: 100, ...wunsch('Alter Sigurd'), created: 1, lastPlayed: null });
    zb.naechsteId = 101;
    let token = 'fa';
    const konto: Konto = {
      createCharacter: (w) => account.createCharacter('dev', token, w),
      characters: () => account.me('dev', token),
      play: (id) => account.play('dev', token, id),
    };
    const fahrt: Fahrt = ablauf.neueFahrt();
    const k1 = await messe(() => ablauf.fahreLos(konto, fahrt, wunsch(), 'dev'), 5000);
    token = 'fb'; // other shore, other account: id 100 there is somebody else
    const k2 = await messe(() => ablauf.fahreLos(konto, fahrt, wunsch(), 'live'), 5000);
    expect(schluessel(k1)).toBe('server-error');
    expect(k2.wert?.sessionToken).toBe('ticket-101');
    expect(zb.anlegen).toBe(1);
    expect(zb.play).not.toContain(100);
  });
});

// After the concurrent cases, because it changes a global object.
describe('a2) Browser ohne AbortSignal.timeout', () => {
  it('Aufrufe gelingen, Haenger enden trotzdem', async () => {
    const signal = AbortSignal as { timeout?: unknown };
    const original = signal.timeout;
    delete signal.timeout;
    try {
      expect(typeof signal.timeout).not.toBe('function');
      zustand('ohne').verhalten.nieAntworten = false; // left over from a)
      zustand('a2h').verhalten.nieAntworten = true;
      zustand('a2k').verhalten.kopfDannStille = true;
      const l = await messe(() => account.login('dev', 'x', 'passwort1'), 5000);
      const m = await messe(() => account.me('dev', 'a2'), 5000);
      expect(l.wert?.token).toBe('t');
      expect(Array.isArray(m.wert?.characters)).toBe(true);
      const [h, k] = await Promise.all([
        messe(() => account.me('dev', 'a2h'), GUARD),
        messe(() => account.me('dev', 'a2k'), GUARD),
      ]);
      expect(schluessel(h)).toBe('timeout');
      expect(h.ms).toBeLessThanOrEqual(GUARD);
      expect(schluessel(k)).toBe('timeout');
      expect(k.ms).toBeLessThanOrEqual(GUARD);
    } finally {
      signal.timeout = original;
    }
  });
});
