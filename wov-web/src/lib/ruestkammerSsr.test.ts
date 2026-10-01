import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CANONICAL_HOME, X_DEFAULT_ADRESSE } from './basisDomains';
import { beendeProzess } from './testhilfen/prozess';

/**
 * Rüstkammer und Ruhmeshalle am AUSGELIEFERTEN Stand: der gebaute Handler von
 * wov-web (`build/handler.js`) gegen einen Attrappen-Spielserver, beide auf
 * Port 0, ein Prozess, kein Browser, kein JavaScript im Client.
 *
 * Das ersetzt die frühere Ohne-JS-Messung (`tools/ohne-js-pruefen.sh`): Die
 * beiden Seiten sind nicht mehr vorgerendert und liegen nicht in `build/` als
 * HTML. Hier steht, was ein Besucher OHNE Skript sieht: Text in `<main>`,
 * Links, ruhige Fehlerzustände, übersetzte Namen, canonical/hreflang.
 *
 * Wie `domain-verdrahtung.test.ts`: Ohne Build wird übersprungen, in der CI
 * (Variable `CI`) ist er Pflicht.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const HANDLER = resolve(HERE, '../../build/handler.js');
const HELFER = resolve(HERE, 'testhilfen/handlerServer.mjs');
const vorhanden = existsSync(HANDLER);
const inDerCi = Boolean(process.env.CI);
const beschreibe = vorhanden || inDerCi ? describe : describe.skip;

/** Die Marker, die niemals in einer Seite stehen dürfen. */
const GEHEIM = ['GEHEIMKONTO-X7', 'geheim-mail@x7.example', 'SPIELERID-X7', 'GEHEIMINVENTAR-X7'];

const AUSSEHEN = { figur: 'wikinger', frisur: 'H_01', haarfarbe: 'braun', augenfarbe: 'blau' };

function eintrag(id: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    klasse: 'krieger',
    aussehen: AUSSEHEN,
    erstellt: 1_700_000_000_000,
    zuletztGespielt: 1_750_000_000_000 + id * 1000,
    kontoname: GEHEIM[0],
    email: GEHEIM[1],
    spielerId: GEHEIM[2],
    position: { x: 4242, y: 4343, z: 4444 },
    inventar: [{ name: GEHEIM[3] }],
    ...extra,
  };
}

function stueck(extra: Record<string, unknown> = {}) {
  return {
    kennung: 'IronwardHelmet',
    name: 'Eisenwacht-Helm',
    seltenheit: 'rare',
    itemStufe: 3,
    qualitaet: 0,
    werte: { armor: 4 },
    symbol: '/assets/sprites/helm.png',
    ...extra,
  };
}

const WERTE = {
  damage: 0,
  armor: 4,
  strength: 0,
  vitality: 0,
  agility: 0,
  lebenMax: 100,
  nahkampfSchaden: 3,
};

function profil(id: number, extra: Record<string, unknown> = {}) {
  return {
    ...eintrag(id, 'Ragnar'),
    ausruestung: { kopf: stueck() },
    waffe: null,
    werte: WERTE,
    ...extra,
  };
}

type Antwort = { status: number; koerper: string };

let modus: (url: URL) => Antwort | 'haengt' = () => ({ status: 500, koerper: '{}' });
const gesehen: string[] = [];
const koepfe: Array<Record<string, string | string[] | undefined>> = [];
let attrappe: http.Server;
let webPort = 0;

const json = (status: number, wert: unknown): Antwort => ({
  status,
  koerper: JSON.stringify(wert),
});
const listeAntwort = (eintraege: unknown[], extra: Record<string, unknown> = {}) =>
  json(200, {
    eintraege,
    seite: 1,
    seitenGroesse: 24,
    gesamt: eintraege.length,
    seiten: 1,
    ...extra,
  });

function frage(
  pfad: string,
): Promise<{ status: number; html: string; main: string; text: string }> {
  return new Promise((fertig) => {
    http
      .get({ host: '127.0.0.1', port: webPort, path: pfad }, (res) => {
        const teile: Buffer[] = [];
        res.on('data', (c: Buffer) => teile.push(c));
        res.on('end', () => {
          const html = Buffer.concat(teile).toString('utf8');
          const main = /<main\b[\s\S]*<\/main>/i.exec(html)?.[0] ?? '';
          const text = main
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          fertig({ status: res.statusCode ?? 0, html, main, text });
        });
      })
      .on('error', () => fertig({ status: -1, html: '', main: '', text: '' }));
  });
}

/** Der gebaute Handler läuft in einem eigenen Node-Prozess: Vite soll das Paket nicht neu übersetzen. */
let kind: ChildProcess | undefined;

beforeAll(async () => {
  if (!vorhanden) return;
  attrappe = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    gesehen.push(`${url.pathname}${url.search}`);
    koepfe.push(req.headers);
    const a = modus(url);
    if (a === 'haengt') return;
    res.writeHead(a.status, { 'content-type': 'application/json' });
    res.end(a.koerper);
  });
  await new Promise<void>((r) => attrappe.listen(0, '127.0.0.1', r));
  const spielPort = (attrappe.address() as AddressInfo).port;

  kind = spawn(process.execPath, [HELFER, HANDLER], {
    env: { ...process.env, WOV_GAME_API: `http://127.0.0.1:${spielPort}` },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  webPort = await new Promise<number>((fertig, nein) => {
    let puffer = '';
    kind?.stdout?.on('data', (c: Buffer) => {
      puffer += c.toString();
      const m = /PORT (\d+)/.exec(puffer);
      if (m) fertig(Number(m[1]));
    });
    kind?.on('exit', () => nein(new Error('Handler-Prozess beendet')));
  });
}, 30000);

afterAll(async () => {
  if (!vorhanden) return;
  // Endet auch, wenn das Kind schon tot ist oder das Beenden ignoriert.
  await beendeProzess(kind, 5000);
  attrappe.closeAllConnections();
  await new Promise((r) => attrappe.close(r));
}, 15000);

beschreibe('Rüstkammer ohne JavaScript (gebauter Stand)', () => {
  it('Vorbedingung: in der CI liegt der Build vor', () => {
    if (inDerCi) expect(vorhanden).toBe(true);
  });

  it('Liste: Text, Namen, Profil-Links, Zähler; nichts Geheimes in HTML und __data.json', async () => {
    modus = () => listeAntwort([eintrag(1, 'Ragnar'), eintrag(2, 'Sigrid')]);
    const r = await frage('/de/ruestkammer');
    expect(r.status).toBe(200);
    // Die gewöhnliche Liste bleibt im Index.
    expect(r.html).not.toContain('content="noindex"');
    expect(r.text.length).toBeGreaterThan(150);
    expect(r.text).toContain('Ragnar');
    expect(r.text).toContain('Sigrid');
    expect(r.text).toContain('2 Recken');
    expect(r.main).toContain('?reck=1');
    const daten = await frage('/de/ruestkammer/__data.json');
    for (const m of GEHEIM) {
      expect(r.html).not.toContain(m);
      expect(daten.html).not.toContain(m);
    }
    expect(r.html + daten.html).not.toMatch(/4242|4343|4444/);
  });

  it('Zähler im Singular und auf Englisch', async () => {
    modus = () => listeAntwort([eintrag(1, 'Ragnar')]);
    expect((await frage('/de/ruestkammer')).text).toContain('1 Recke');
    expect((await frage('/de/ruestkammer')).text).not.toContain('1 Recken');
    expect((await frage('/en/armory')).text).toContain('1 hero');
    expect((await frage('/en/armory')).text).not.toContain('1 heroes');
  });

  it('der Besucher wird als X-Forwarded-For an den Spielserver weitergegeben (Liste, Profil, Ruhmeshalle)', async () => {
    modus = (u) =>
      u.pathname === '/accounts/armory'
        ? listeAntwort([eintrag(1, 'Ragnar')])
        : json(200, profil(1));
    for (const pfad of ['/de/ruestkammer', '/de/ruestkammer?reck=1', '/de/ruhmeshalle']) {
      koepfe.length = 0;
      await frage(pfad);
      expect(koepfe.length, pfad).toBe(1);
      // Der Test-Besucher kommt von Loopback; der Adapter meldet dessen Adresse.
      expect(String(koepfe[0]['x-forwarded-for']), pfad).toMatch(
        /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/,
      );
    }
  });

  it('Suche und Seite kommen unverändert beim Spielserver an; Müll wird zu Seite 1', async () => {
    modus = () => listeAntwort([eintrag(1, 'Sigrid')], { seite: 2, seiten: 3, gesamt: 60 });
    gesehen.length = 0;
    const r = await frage('/de/ruestkammer?q=Sig&seite=2');
    expect(gesehen).toEqual(['/accounts/armory?seite=2&q=Sig']);
    expect(r.main).toMatch(/value="Sig"/);
    expect(r.main).toContain('rel="prev"');
    expect(r.main).toContain('rel="next"');
    gesehen.length = 0;
    await frage('/de/ruestkammer?seite=abc');
    expect(gesehen).toEqual(['/accounts/armory?seite=1']);
  });

  it('B2: Charakter ohne Klasse und mit leerer Haarfarbe stehen in Liste, Zähler und Profil', async () => {
    const leer = eintrag(2, 'Klassenlos', { klasse: '' });
    const alt = eintrag(3, 'Altbestand', { aussehen: { ...AUSSEHEN, haarfarbe: '' } });
    modus = (u) =>
      u.pathname === '/accounts/armory'
        ? listeAntwort([eintrag(1, 'Ragnar'), leer, alt])
        : json(
            200,
            profil(Number(u.pathname.split('/').pop()), {
              klasse: '',
              aussehen: { ...AUSSEHEN, haarfarbe: '' },
            }),
          );
    const r = await frage('/de/ruestkammer');
    expect(r.text).toContain('Klassenlos');
    expect(r.text).toContain('Altbestand');
    expect(r.text).toContain('3 Recken');
    expect((r.main.match(/\?reck=\d/g) ?? []).length).toBe(3);
    for (const id of [2, 3]) {
      const p = await frage(`/de/ruestkammer?reck=${id}`);
      expect(p.status).toBe(200);
      expect(p.text).not.toContain('antwortet nicht');
      expect(p.text).toContain('Eisenwacht-Helm');
    }
  });

  it('B4: die Klasse steht übersetzt da, auch auf Englisch; unbekannte bleibt Kennung', async () => {
    modus = (u) =>
      u.pathname === '/accounts/armory'
        ? listeAntwort([eintrag(1, 'Ragnar'), eintrag(2, 'Seltsam', { klasse: 'zauberer' })])
        : json(200, profil(1));
    const de = await frage('/de/ruestkammer');
    expect(de.text).toContain('Krieger');
    expect(de.text).toContain('zauberer');
    expect((await frage('/en/armory')).text).toContain('Warrior');
    expect((await frage('/en/armory')).text).not.toMatch(/\bkrieger\b/);
    expect((await frage('/de/ruestkammer?reck=1')).text).toContain('Krieger');
    expect((await frage('/en/armory?reck=1')).text).toContain('Warrior');
  });

  it('Profil: Ausrüstung mit Symbol, Ersatztext-Glyphe, ohne Inline-Handler', async () => {
    modus = () =>
      json(200, profil(7, { waffe: stueck({ kennung: 'Sax', name: 'Sax', symbol: null }) }));
    const r = await frage('/de/ruestkammer?reck=7');
    expect(r.status).toBe(200);
    expect(r.text).toContain('Eisenwacht-Helm');
    expect(r.text.length).toBeGreaterThan(300);
    const bild = /<img[^>]*src="\/assets\/sprites\/helm\.png"[^>]*>/.exec(r.main)?.[0] ?? '';
    expect(bild).toMatch(/alt="[^"]+"/);
    expect(bild).not.toMatch(/alt=""/);
    expect(r.html).not.toMatch(/\bonerror=|\bonload=/);
    // Die Waffe ohne Symbol: die Glyphe steht im Text.
    expect(r.main).toContain('⚔');
  });

  it('HTML wird nie roh ausgegeben: Name, Profiltext, Stück, Fertigkeit', async () => {
    const boese = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    modus = (u) =>
      u.pathname === '/accounts/armory'
        ? listeAntwort([eintrag(1, boese)])
        : json(
            200,
            profil(1, {
              name: boese,
              profil: boese,
              ausruestung: { kopf: stueck({ name: boese }) },
              stufe: 1,
              fertigkeiten: [{ name: boese, stufe: 5 }],
            }),
          );
    for (const pfad of ['/de/ruestkammer', '/de/ruestkammer?reck=1', '/de/ruhmeshalle']) {
      const r = await frage(pfad);
      expect(r.status).toBe(200);
      expect(r.main).not.toContain('<img src=x');
      expect(r.main).not.toContain('<script>alert');
      expect(r.main).toContain('&lt;');
    }
  });

  it('optionale Felder: ohne sie steht nichts davon da, mit ihnen auch die 0', async () => {
    modus = () => json(200, profil(7));
    const ohne = await frage('/de/ruestkammer?reck=7');
    for (const w of ['Tode', 'Erfahrung', 'Spielzeit', 'Fertigkeiten'])
      expect(ohne.text).not.toContain(w);
    modus = () => json(200, profil(7, { tode: 0, stufe: 5, spielzeitMinuten: 125 }));
    const mit = await frage('/de/ruestkammer?reck=7');
    expect(mit.main).toMatch(/<b[^>]*>0<\/b>\s*<span[^>]*>Tode/);
    expect(mit.text).toContain('2 h 5 min');
  });

  it('Kopfdaten des Profils: canonical, og:url und hreflang tragen ?reck=', async () => {
    modus = () => json(200, profil(7));
    const r = await frage('/de/ruestkammer?reck=7');
    expect(r.html).toContain(
      `<link rel="canonical" href="${CANONICAL_HOME.de}/de/ruestkammer?reck=7"`,
    );
    expect(r.html).toMatch(/<meta property="og:url" content="[^"]*\/de\/ruestkammer\?reck=7"/);
    expect(r.html).toMatch(/hreflang="en" href="[^"]*\/en\/armory\?reck=7"/);
  });

  it('404: unbekannte, gelöschte und ungültige Ids; übersetzter Text mit Rückweg', async () => {
    modus = () => json(404, { error: 'unknown' });
    const r = await frage('/de/ruestkammer?reck=99');
    expect(r.status).toBe(404);
    expect(r.text).toContain('nicht in der Kammer');
    expect(r.main).toContain('href="/de/ruestkammer"');
    expect(r.text).not.toContain('unknown-character');
    // Die Fehlerseite gehört nicht in den Index.
    expect(r.html).toMatch(/<meta name="robots" content="noindex"/);
    expect((await frage('/en/armory?reck=99')).text).toContain('not in the armory');
    for (const muell of ['abc', '0', '-1', '1.5', '1e3']) {
      expect((await frage(`/de/ruestkammer?reck=${muell}`)).status).toBe(404);
    }
  });

  it('stummer Spielserver (500, kaputtes JSON, falsche Form): 200 mit ruhigem Text, nie 500', async () => {
    for (const m of [
      () => json(500, {}),
      () => ({ status: 200, koerper: '{"eintraege": [' }),
      () => json(200, { falsch: true }),
    ]) {
      modus = m;
      for (const pfad of ['/de/ruestkammer', '/de/ruestkammer?reck=1', '/de/ruhmeshalle']) {
        const r = await frage(pfad);
        expect(r.status, pfad).toBe(200);
        expect(r.text).toMatch(/verschlossen|verhängt/);
        // Auch der Ausfall zeigt nur einen Hinweis und gehört nicht in den Index.
        expect(r.html, pfad).toMatch(/<meta name="robots" content="noindex"/);
      }
    }
  });

  it('503 (Kammer wird vorbereitet) und 429 (Drossel): ehrlicher Hinweis, kein 500, kein „noch niemand“', async () => {
    const faelle: Array<[number, RegExp]> = [
      [503, /vorbereitet/],
      [429, /Zu viele Anfragen/],
    ];
    for (const [status, text] of faelle) {
      modus = () => json(status, { error: status === 503 ? 'warming-up' : 'rate-limited' });
      for (const pfad of ['/de/ruestkammer', '/de/ruestkammer?reck=1', '/de/ruhmeshalle']) {
        const r = await frage(pfad);
        expect(r.status, `${status} ${pfad}`).toBe(200);
        expect(r.text, `${status} ${pfad}`).toMatch(text);
        expect(r.text).not.toMatch(/noch niemand|Noch niemand|verschlossen|verhängt/);
        // Eine vorübergehende Hinweisseite gehört nicht in den Index.
        expect(r.html, `${status} ${pfad}`).toMatch(/<meta name="robots" content="noindex"/);
      }
      expect((await frage('/en/armory')).text).toMatch(
        status === 503 ? /prepared/ : /Too many requests/,
      );
    }
  });

  it('hängender Spielserver: nach dem Zeitlimit ruhiger Text', async () => {
    modus = () => 'haengt';
    const t0 = Date.now();
    const r = await frage('/de/ruestkammer');
    expect(r.status).toBe(200);
    expect(r.text).toContain('verschlossen');
    expect(Date.now() - t0).toBeLessThan(9000);
  }, 20000);

  it('leere Kammer: ehrlich „noch niemand“, bei Suche „kein Recke dieses Namens“', async () => {
    modus = () => listeAntwort([]);
    expect((await frage('/de/ruestkammer')).text).toContain('noch niemand');
    expect((await frage('/de/ruestkammer?q=zzz')).text).toContain('Kein Recke dieses Namens');
  });

  it('B7: eine Riesenliste wird gekappt (Karten und Größe)', async () => {
    const viele = Array.from({ length: 5000 }, (_, i) => eintrag(i + 1, `Recke${i + 1}`));
    modus = () => listeAntwort(viele, { gesamt: 5000, seiten: 209 });
    const r = await frage('/de/ruestkammer');
    expect((r.main.match(/\?reck=\d+/g) ?? []).length).toBeLessThanOrEqual(100);
    expect(r.html.length).toBeLessThan(400_000);
  });
});

beschreibe('Ruhmeshalle ohne JavaScript (gebauter Stand)', () => {
  it('fragt nur Seite 1, zeigt Tafel „Zuletzt aktiv“, Links und den ehrlichen Hinweis', async () => {
    modus = () => listeAntwort([eintrag(1, 'Ragnar'), eintrag(2, 'Sigrid')]);
    gesehen.length = 0;
    const r = await frage('/de/ruhmeshalle');
    expect(gesehen).toEqual(['/accounts/armory?seite=1']);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Zuletzt aktiv');
    expect(r.text).toContain('Weitere Tafeln folgen');
    expect(r.text.length).toBeGreaterThan(300);
    expect(r.main).toContain('/de/ruestkammer?reck=2');
    expect(r.text.indexOf('Sigrid')).toBeLessThan(r.text.indexOf('Ragnar'));
    for (const m of GEHEIM) expect(r.html).not.toContain(m);
    const en = await frage('/en/hall-of-fame');
    expect(en.main).toContain('/en/armory?reck=2');
  });

  it('leer: „Noch niemand eingetragen“; Riesenliste: höchstens 24 Zeilen', async () => {
    modus = () => listeAntwort([]);
    expect((await frage('/de/ruhmeshalle')).text).toContain('Noch niemand eingetragen');
    modus = () => listeAntwort(Array.from({ length: 1000 }, (_, i) => eintrag(i + 1, `R${i + 1}`)));
    const r = await frage('/de/ruhmeshalle');
    const zeilen = (r.main.match(/<tr[\s>]/g) ?? []).length;
    expect(zeilen).toBeGreaterThan(10);
    expect(zeilen).toBeLessThanOrEqual(24 + 1);
  });
});

beschreibe('canonical und hreflang der vier Adressen (gebauter Stand)', () => {
  const ADRESSEN = [
    { pfad: '/de/ruestkammer', sprache: 'de' as const, andere: '/en/armory' },
    { pfad: '/en/armory', sprache: 'en' as const, andere: '/de/ruestkammer' },
    { pfad: '/de/ruhmeshalle', sprache: 'de' as const, andere: '/en/hall-of-fame' },
    { pfad: '/en/hall-of-fame', sprache: 'en' as const, andere: '/de/ruhmeshalle' },
  ];
  for (const a of ADRESSEN) {
    it(`${a.pfad}`, async () => {
      modus = () => listeAntwort([eintrag(1, 'Ragnar')]);
      const r = await frage(a.pfad);
      expect(r.status).toBe(200);
      expect(r.html).toContain(
        `<link rel="canonical" href="${CANONICAL_HOME[a.sprache]}${a.pfad}"`,
      );
      const anderSprache = a.sprache === 'de' ? 'en' : 'de';
      expect(r.html).toContain(
        `hreflang="${anderSprache}" href="${CANONICAL_HOME[anderSprache]}${a.andere}"`,
      );
      expect(r.html).toContain(
        `hreflang="${a.sprache}" href="${CANONICAL_HOME[a.sprache]}${a.pfad}"`,
      );
      expect(r.html).toContain(`hreflang="x-default" href="${X_DEFAULT_ADRESSE}"`);
    });
  }
});
