import { describe, expect, it } from 'vitest';
import {
  ANTWORT_MAX,
  adresseVon,
  ladeRecke,
  ladeRuestkammer,
  seiteAus,
  sucheAus,
  weiterleitung,
} from './armoryApi';

// Der Abruf gegen einen Attrappen-`fetch`: kein Netz, keine Spielserver-Instanz.

const BASIS = { basis: 'http://spielserver.invalid' };

const AUSSEHEN = { figur: 'wikinger', frisur: 'H_01', haarfarbe: 'braun', augenfarbe: 'blau' };

function eintrag(id: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    klasse: 'krieger',
    aussehen: AUSSEHEN,
    erstellt: 1_700_000_000_000,
    zuletztGespielt: 1_700_000_100_000,
    ...extra,
  };
}

function liste(eintraege: unknown[], extra: Record<string, unknown> = {}) {
  return { eintraege, seite: 1, seitenGroesse: 24, gesamt: eintraege.length, seiten: 1, ...extra };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Ein Attrappen-`fetch`, der die Aufrufe mitschreibt. */
function attrappe(antwort: (url: string) => Response | Promise<Response>) {
  const aufrufe: string[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    aufrufe.push(url);
    if (init?.signal?.aborted) throw new Error('abgebrochen');
    return antwort(url);
  };
  return { fetch, aufrufe };
}

describe('ladeRuestkammer', () => {
  it('liefert die Liste und ruft die Route mit Seite und Suche', async () => {
    const a = attrappe(() =>
      json(
        liste([eintrag(1, 'Ragnar'), eintrag(2, 'Sigrid')], { seite: 2, seiten: 3, gesamt: 50 }),
      ),
    );
    const r = await ladeRuestkammer(a.fetch, 'ra', 2, BASIS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.eintraege.map((e) => e.name)).toEqual(['Ragnar', 'Sigrid']);
    expect([r.data.seite, r.data.seiten, r.data.gesamt]).toEqual([2, 3, 50]);
    expect(a.aufrufe).toEqual(['http://spielserver.invalid/accounts/armory?seite=2&q=ra']);
  });

  it('ohne Suche steht kein q in der Adresse; die Suche wird kodiert', async () => {
    const a = attrappe(() => json(liste([])));
    await ladeRuestkammer(a.fetch, '', 1, BASIS);
    await ladeRuestkammer(a.fetch, 'Thór & ä', 1, BASIS);
    expect(a.aufrufe[0]).toBe('http://spielserver.invalid/accounts/armory?seite=1');
    expect(a.aufrufe[1]).toBe(
      `http://spielserver.invalid/accounts/armory?seite=1&q=${encodeURIComponent('Thór & ä')}`,
    );
  });

  it('leere Liste ist ein Erfolg mit null Einträgen (ehrlich „noch niemand“)', async () => {
    const r = await ladeRuestkammer(attrappe(() => json(liste([]))).fetch, '', 1, BASIS);
    expect(r).toMatchObject({ ok: true, data: { eintraege: [], gesamt: 0 } });
  });

  it('Spielserver-Fehler (500, 404) kommen als Status zurück, nicht als Wurf', async () => {
    for (const status of [500, 404, 503]) {
      const r = await ladeRuestkammer(
        attrappe(() => json({ error: 'x' }, status)).fetch,
        '',
        1,
        BASIS,
      );
      expect(r).toEqual({ ok: false, status });
    }
  });

  it('Netzfehler ergibt status 0', async () => {
    const r = await ladeRuestkammer(
      async () => {
        throw new Error('ECONNREFUSED');
      },
      '',
      1,
      BASIS,
    );
    expect(r).toEqual({ ok: false, status: 0 });
  });

  it('kaputtes JSON ergibt status 0, kein Wurf', async () => {
    const r = await ladeRuestkammer(
      attrappe(() => new Response('{"eintraege": [', { status: 200 })).fetch,
      '',
      1,
      BASIS,
    );
    expect(r).toEqual({ ok: false, status: 0 });
  });

  it('JSON in falscher Form ergibt status 0', async () => {
    for (const body of [null, 'text', [], { eintraege: 'nein' }, { eintraege: [] }]) {
      const r = await ladeRuestkammer(attrappe(() => json(body)).fetch, '', 1, BASIS);
      expect(r).toEqual({ ok: false, status: 0 });
    }
  });

  it('Zeitlimit: ein hängender Spielserver bricht nach der Frist ab', async () => {
    let abgebrochen = false;
    const haengt = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, nein) => {
        init?.signal?.addEventListener('abort', () => {
          abgebrochen = true;
          nein(new Error('abort'));
        });
      });
    const t0 = Date.now();
    const r = await ladeRuestkammer(haengt, '', 1, { ...BASIS, zeitlimitMs: 40 });
    expect(r).toEqual({ ok: false, status: 0 });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(abgebrochen).toBe(true);
  });

  it('Zeitlimit gilt auch, wenn der Abruf das Signal ignoriert', async () => {
    const taub = () => new Promise<Response>(() => {});
    const r = await ladeRuestkammer(taub, '', 1, { ...BASIS, zeitlimitMs: 40 });
    expect(r).toEqual({ ok: false, status: 0 });
  });

  it('verwirft Einträge ohne Pflichtfelder, behält die guten', async () => {
    const r = await ladeRuestkammer(
      attrappe(() => json(liste([eintrag(1, 'Ragnar'), { id: 2 }, null, eintrag(3, '')]))).fetch,
      '',
      1,
      BASIS,
    );
    expect(r.ok && r.data.eintraege.map((e) => e.id)).toEqual([1]);
  });
});

describe('ladeRecke', () => {
  const PROFIL = {
    ...eintrag(7, 'Ragnar'),
    ausruestung: {
      kopf: {
        kennung: 'IronwardHelmet',
        name: 'Eisenwacht-Helm',
        textKey: 'inhalt.item.ironward_helm',
        seltenheit: 'rare',
        itemStufe: 3,
        qualitaet: 2,
        werte: { armor: 4 },
        symbol: '/assets/sprites/helm.png',
      },
    },
    waffe: null,
    werte: {
      damage: 0,
      armor: 4,
      strength: 0,
      vitality: 0,
      agility: 0,
      lebenMax: 100,
      nahkampfSchaden: 5,
    },
  };

  it('liefert das Profil und ruft die Route mit der Id', async () => {
    const a = attrappe(() => json(PROFIL));
    const r = await ladeRecke(a.fetch, 7, BASIS);
    expect(a.aufrufe).toEqual(['http://spielserver.invalid/accounts/armory/7']);
    expect(r.ok && r.data.ausruestung.kopf?.symbol).toBe('/assets/sprites/helm.png');
  });

  it('404 bleibt 404 (gibt es nicht), nicht status 0', async () => {
    const r = await ladeRecke(attrappe(() => json({ error: 'unknown' }, 404)).fetch, 9, BASIS);
    expect(r).toEqual({ ok: false, status: 404 });
  });

  it('kaputtes JSON und fehlende Pflichtfelder ergeben status 0', async () => {
    expect(
      await ladeRecke(attrappe(() => new Response('<html>', { status: 200 })).fetch, 7, BASIS),
    ).toEqual({ ok: false, status: 0 });
    expect(await ladeRecke(attrappe(() => json({ id: 7 })).fetch, 7, BASIS)).toEqual({
      ok: false,
      status: 0,
    });
  });

  it('Zeitlimit beim Profil', async () => {
    const r = await ladeRecke(() => new Promise<Response>(() => {}), 7, {
      ...BASIS,
      zeitlimitMs: 30,
    });
    expect(r).toEqual({ ok: false, status: 0 });
  });
});

describe('B7: Größe der Antwort', () => {
  it('eine zu große Antwort gilt als Fehler des Spielservers (status 0)', async () => {
    const gross = JSON.stringify(liste([eintrag(1, 'x'.repeat(ANTWORT_MAX))]));
    const r = await ladeRuestkammer(
      attrappe(() => new Response(gross, { status: 200 })).fetch,
      '',
      1,
      BASIS,
    );
    expect(r).toEqual({ ok: false, status: 0 });
  });
  it('eine Antwort darunter geht durch', async () => {
    const r = await ladeRuestkammer(
      attrappe(() => json(liste([eintrag(1, 'Ragnar')]))).fetch,
      '',
      1,
      BASIS,
    );
    expect(r.ok).toBe(true);
  });
});

describe('Adressteile', () => {
  it('seiteAus: Müll wird zu 1, Dezimal wird abgeschnitten', () => {
    expect(seiteAus(null)).toBe(1);
    expect(seiteAus('abc')).toBe(1);
    expect(seiteAus('-4')).toBe(1);
    expect(seiteAus('0')).toBe(1);
    expect(seiteAus('3.9')).toBe(3);
    expect(seiteAus('Infinity')).toBe(1);
    expect(seiteAus('99999999999')).toBe(1_000_000);
  });

  it('sucheAus: getrimmt und auf 32 Zeichen gekürzt (nach Zeichen, nicht Bytes)', () => {
    expect(sucheAus(null)).toBe('');
    expect(sucheAus('  Ragnar  ')).toBe('Ragnar');
    expect(Array.from(sucheAus('ä'.repeat(50))).length).toBe(32);
  });
});

describe('Besucheradresse als X-Forwarded-For', () => {
  /** Ein `fetch`, der die Köpfe mitschreibt. */
  function kopfAttrappe() {
    const koepfe: Array<Record<string, string>> = [];
    const fetch = async (_url: string, init?: RequestInit): Promise<Response> => {
      koepfe.push({ ...(init?.headers as Record<string, string>) });
      return json(liste([]));
    };
    return { fetch, koepfe };
  }

  it('Liste und Profil geben die Adresse des Besuchers mit', async () => {
    const a = kopfAttrappe();
    await ladeRuestkammer(a.fetch, '', 1, { ...BASIS, besucher: '203.0.113.7' });
    await ladeRecke(a.fetch, 7, { ...BASIS, besucher: '2001:db8::1' });
    expect(a.koepfe[0]['x-forwarded-for']).toBe('203.0.113.7');
    expect(a.koepfe[1]['x-forwarded-for']).toBe('2001:db8::1');
  });

  it('ohne Adresse oder mit Sonderzeichen geht kein Kopf mit', async () => {
    const a = kopfAttrappe();
    await ladeRuestkammer(a.fetch, '', 1, BASIS);
    await ladeRuestkammer(a.fetch, '', 1, { ...BASIS, besucher: '1.2.3.4, 5.6.7.8' });
    await ladeRuestkammer(a.fetch, '', 1, { ...BASIS, besucher: '1.2.3.4\r\nx: y' });
    for (const k of a.koepfe) expect(k).not.toHaveProperty('x-forwarded-for');
    expect(weiterleitung(undefined)).toEqual({});
    expect(weiterleitung('')).toEqual({});
  });

  it('adresseVon: wirft der Adapter, gibt es keine Adresse', () => {
    expect(adresseVon(() => '10.0.0.1')).toBe('10.0.0.1');
    expect(
      adresseVon(() => {
        throw new Error('keine Adresse');
      }),
    ).toBeUndefined();
  });
});
