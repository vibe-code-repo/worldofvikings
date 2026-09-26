/**
 * Kontoverwaltung (W3), Browserseite: die Formularprüfungen und die fünf
 * Aufrufe aus `account.ts` gegen einen echten HTTP-Stub auf Port 0. Geprüft
 * wird, was tatsächlich über die Leitung geht: Pfad, Methode, Kopfzeile mit
 * dem Token und der Körper, und wie ein Fehlerschlüssel des Servers beim
 * Aufrufer ankommt.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { de } from './i18n/de';
import { en } from './i18n/en';
import {
  emailPruefen,
  loeschenBereit,
  PROFILTEXT_MAX,
  passwortWechselPruefen,
  profilLaenge,
  profilZuLang,
} from './kontoverwaltung';

// Erst nach dem Start des Stubs geladen (`WOV_DEV_ORIGIN` wird beim Laden gelesen).
let account: typeof import('./account');
let stubServer: Server;
const gesehen: Eingang[] = [];
let antwort: { status: number; body: unknown } = { status: 200, body: {} };
const shore = 'dev' as const;

interface Eingang {
  method: string;
  url: string;
  token: string | undefined;
  body: unknown;
}

function lesen(req: IncomingMessage): Promise<unknown> {
  return new Promise((ok) => {
    let roh = '';
    req.on('data', (c) => {
      roh += c;
    });
    req.on('end', () => {
      try {
        ok(roh ? JSON.parse(roh) : undefined);
      } catch {
        ok(undefined);
      }
    });
  });
}

beforeAll(async () => {
  stubServer = createServer(async (req, res) => {
    const body = await lesen(req);
    const t = req.headers['x-wov-account'];
    gesehen.push({
      method: req.method ?? '',
      url: req.url ?? '',
      token: typeof t === 'string' ? t : undefined,
      body,
    });
    res.writeHead(antwort.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(antwort.body));
  });
  await new Promise<void>((ok) => stubServer.listen(0, '127.0.0.1', ok));
  const { port } = stubServer.address() as AddressInfo;
  vi.stubGlobal('WOV_DEV_ORIGIN', `http://127.0.0.1:${port}`);
  account = await import('./account');
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((ok) => stubServer.close(() => ok()));
});

describe('Formularprüfungen', () => {
  it('zählt Graphem-Cluster, nicht Code-Einheiten', () => {
    expect(profilLaenge('abc')).toBe(3);
    expect(profilLaenge('é')).toBe(1);
    expect(profilLaenge('\u{1F44D}\u{1F3FD}')).toBe(1);
    expect('\u{1F600}'.length).toBe(2);
    expect(profilLaenge('\u{1F600}')).toBe(1);
  });

  it('erlaubt genau 300, lehnt 301 ab', () => {
    expect(profilZuLang('x'.repeat(PROFILTEXT_MAX))).toBe(false);
    expect(profilZuLang('x'.repeat(PROFILTEXT_MAX + 1))).toBe(true);
    expect(profilZuLang('\u{1F600}'.repeat(PROFILTEXT_MAX))).toBe(false);
  });

  it('Passwortwechsel: erste Beanstandung gewinnt', () => {
    expect(passwortWechselPruefen({ current: '', next: 'langgenug1', repeat: 'langgenug1' })).toBe(
      'account.manage.error.current_required',
    );
    expect(passwortWechselPruefen({ current: 'a', next: 'kurz', repeat: 'kurz' })).toBe(
      'account.error.password_too_short',
    );
    expect(
      passwortWechselPruefen({ current: 'a', next: 'x'.repeat(201), repeat: 'x'.repeat(201) }),
    ).toBe('account.error.password_too_short');
    expect(passwortWechselPruefen({ current: 'a', next: 'langgenug1', repeat: 'langgenug2' })).toBe(
      'account.manage.error.password_mismatch',
    );
    expect(passwortWechselPruefen({ current: 'a', next: 'langgenug1', repeat: 'langgenug1' })).toBe(
      null,
    );
  });

  it('E-Mail: lose Prüfung wie beim Server', () => {
    expect(emailPruefen('a@b.de')).toBe(null);
    expect(emailPruefen(' a@b.de ')).toBe(null);
    expect(emailPruefen('kaputt')).toBe('account.error.email_invalid');
    expect(emailPruefen('a@b')).toBe('account.error.email_invalid');
    expect(emailPruefen(`${'x'.repeat(250)}@b.de`)).toBe('account.error.email_invalid');
  });

  it('Löschen: Passwort und eigener Name, Groß-/Kleinschreibung egal', () => {
    expect(loeschenBereit('Mike', 'geheim123', 'mike')).toBe(true);
    expect(loeschenBereit('Mike', 'geheim123', ' MIKE ')).toBe(true);
    expect(loeschenBereit('Mike', '', 'Mike')).toBe(false);
    expect(loeschenBereit('Mike', 'geheim123', 'Mik')).toBe(false);
    expect(loeschenBereit('Mike', 'geheim123', '')).toBe(false);
  });
});

describe('Fehlerschlüssel', () => {
  it('jeder neue Serverschlüssel hat einen Katalogeintrag in beiden Sprachen', () => {
    for (const key of [
      'password-wrong',
      'standard-account',
      'confirm-mismatch',
      'conflict',
      'profile-invalid',
      'reason-invalid',
      'too-many-attempts',
    ]) {
      const k = account.errorMessageKey(key);
      expect(k, key).not.toBe('account.error.unexpected');
      expect(k in de, `de:${k}`).toBe(true);
      expect(k in en, `en:${k}`).toBe(true);
    }
  });
});

describe('Aufrufe gegen einen Stub', () => {
  it('setProfile schickt Pfad, Token und Text', async () => {
    gesehen.length = 0;
    antwort = { status: 200, body: { profile: 'Skaldin' } };
    await expect(account.setProfile(shore, 'T1', 'Skaldin')).resolves.toEqual({
      profile: 'Skaldin',
    });
    expect(gesehen).toEqual([
      { method: 'POST', url: '/accounts/profile', token: 'T1', body: { text: 'Skaldin' } },
    ]);
  });

  it('changeEmail und changePassword schicken das aktuelle Passwort mit', async () => {
    gesehen.length = 0;
    antwort = { status: 200, body: { account: { username: 'a', email: 'n@b.de' } } };
    await account.changeEmail(shore, 'T2', 'alt', 'n@b.de');
    antwort = { status: 200, body: { token: 'NEU' } };
    await expect(account.changePassword(shore, 'T2', 'alt', 'neuneuneu')).resolves.toEqual({
      token: 'NEU',
    });
    expect(gesehen.map((g) => [g.url, g.body])).toEqual([
      ['/accounts/email', { currentPassword: 'alt', email: 'n@b.de' }],
      ['/accounts/password', { currentPassword: 'alt', newPassword: 'neuneuneu' }],
    ]);
    expect(gesehen.every((g) => g.method === 'POST' && g.token === 'T2')).toBe(true);
  });

  it('deleteAccount schickt Passwort und Bestätigung, nicht das Passwort im Pfad', async () => {
    gesehen.length = 0;
    antwort = { status: 200, body: { ok: true } };
    await account.deleteAccount(shore, 'T3', 'geheim', 'Mike');
    expect(gesehen).toEqual([
      {
        method: 'POST',
        url: '/accounts/delete',
        token: 'T3',
        body: { password: 'geheim', confirm: 'Mike' },
      },
    ]);
    expect(gesehen[0].url).not.toContain('geheim');
  });

  it('reportProfile meldet den Recken mit Grund', async () => {
    gesehen.length = 0;
    antwort = { status: 201, body: { ok: true } };
    await account.reportProfile(shore, 'T4', 42, 'Beleidigung');
    expect(gesehen).toEqual([
      {
        method: 'POST',
        url: '/accounts/characters/42/report',
        token: 'T4',
        body: { reason: 'Beleidigung' },
      },
    ]);
  });

  it.each([
    [401, 'password-wrong'],
    [403, 'standard-account'],
    [429, 'too-many-attempts'],
    [409, 'conflict'],
    [400, 'confirm-mismatch'],
    [400, 'profile-invalid'],
  ])('Serverfehler %i %s kommt als ApiError mit demselben Schlüssel an', async (status, key) => {
    antwort = { status, body: { error: key } };
    const fehler = await account.deleteAccount(shore, 'T', 'x', 'y').catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(account.ApiError);
    expect((fehler as InstanceType<typeof account.ApiError>).key).toBe(key);
  });
});
