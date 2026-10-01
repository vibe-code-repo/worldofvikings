// @vitest-environment jsdom
/**
 * Die echten Komponenten (`ReckenVorschau.svelte`, `Reckenprofil.svelte`) im
 * jsdom. Ersetzt sind nur `$app/state`, das Vorschau-Bündel (Attrappe in
 * `testhilfen/fake-vorschau.ts`), `fetch` und der WebGL-Kontext.
 * Vorbild: die Proben des Angriffs auf PR #188.
 */
import { readFileSync } from 'node:fs';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planFuerRecke } from './reckenVorschauKern';
import ProfilHuelle from './testhilfen/ProfilHuelle.svelte';
import VorschauHuelle from './testhilfen/VorschauHuelle.svelte';

interface FakeInstanz {
  rufe: string[];
  entsorgt: number;
  nachEntsorgen: string[];
  leinwand: HTMLCanvasElement;
}
interface Fake {
  instanzen: FakeInstanz[];
  importe: number;
  wirftBei: Set<string>;
  verzoegerung: number;
}
const global = globalThis as unknown as {
  __fake?: Fake;
  __fakeWirft?: boolean;
  __halte?: boolean;
  IntersectionObserver?: unknown;
};
global.__fake ??= { instanzen: [], importe: 0, wirftBei: new Set(), verzoegerung: 1 };
const fake = () => global.__fake as Fake;

const daten = JSON.parse(readFileSync('static/assets/appearance.json', 'utf8'));
const recke = {
  id: 'r1',
  name: 'Probe',
  beiname: 'b',
  sippe: 's',
  welt: 'w',
  stufe: 1,
  tode: 0,
  spielzeit_stunden: 1,
  zuletzt_gesehen: '2026-09-30T10:00:00Z',
  erschaffen: '2026-09-01T10:00:00Z',
  werte: { leben: 1, ausdauer: 1, eitr: 1, traglast: 1 },
  fertigkeiten: [],
  bosse: [],
  biome: [],
  trophaeen: [],
  ausruestung: {},
};
const mann = {
  klasse: 'krieger',
  figur: 'wikinger',
  frisur: 'H_04+B_02',
  haarfarbe: daten.hairColors[0].id,
  augenfarbe: daten.eyeColors[0].id,
};
const frau = {
  klasse: 'druide',
  figur: 'wikingerin',
  frisur: 'H_07',
  haarfarbe: daten.hairColors[1].id,
  augenfarbe: daten.eyeColors[1].id,
};
const ironward = daten.equipmentSets[0].parts.map((t: { itemId: string }) => ({
  kennung: t.itemId,
}));

const ruhe = (ms = 60) => new Promise<void>((r) => setTimeout(r, ms));
let abrufe: string[] = [];
let haltFetch: null | { los: () => void } = null;
let ablehnungen: unknown[] = [];
const merkeAblehnung = (e: unknown) => ablehnungen.push(e);
let webgl = true;
let aufgehaengt: ReturnType<typeof mount>[] = [];

beforeEach(() => {
  abrufe = [];
  haltFetch = null;
  ablehnungen = [];
  webgl = true;
  aufgehaengt = [];
  const f = fake();
  f.instanzen = [];
  f.wirftBei = new Set();
  f.verzoegerung = 1;
  process.on('unhandledRejection', merkeAblehnung);
  HTMLCanvasElement.prototype.getContext = (() =>
    webgl ? { getExtension: () => null } : null) as never;
  globalThis.requestAnimationFrame ??= ((f: FrameRequestCallback) =>
    setTimeout(() => f(0), 0)) as never;
  globalThis.fetch = (async (url: string) => {
    abrufe.push(String(url));
    if (String(url).includes('appearance.json') && haltFetch === null && global.__halte) {
      await new Promise<void>((los) => {
        haltFetch = { los };
      });
    }
    return { ok: true, status: 200, json: async () => structuredClone(daten) };
  }) as never;
  global.__halte = false;
  global.__fakeWirft = false;
  delete global.IntersectionObserver;
  document.body.innerHTML = '';
});
afterEach(async () => {
  for (const k of aufgehaengt) await unmount(k);
  await ruhe(20);
  process.off('unhandledRejection', merkeAblehnung);
});

function profil(start: unknown, stuecke?: unknown) {
  const steuer = {} as { setze: (a: unknown, r?: unknown) => void; zeige: (z: boolean) => void };
  const k = mount(ProfilHuelle, {
    target: document.body,
    props: { recke, start, stuecke, steuer },
  });
  aufgehaengt.push(k);
  flushSync();
  return steuer;
}
type VorschauSteuer = {
  aktiv: (a: boolean) => void;
  daten: () => unknown;
  fertig: () => boolean;
  hinweis: () => string | null;
  beiDaten: number;
};
function vorschau(plan: (d: never) => unknown) {
  const steuer = {} as VorschauSteuer;
  const k = mount(VorschauHuelle, { target: document.body, props: { plan, steuer } });
  aufgehaengt.push(k);
  flushSync();
  return steuer;
}
const leinwand = () => document.querySelector('canvas') as HTMLCanvasElement | null;
const bereit = () => leinwand()?.classList.contains('bereit') ?? false;
const koerperRufe = (i = 0) => fake().instanzen[i].rufe.filter((r) => r.startsWith('koerper:'));
const hinweis = () => document.querySelector('.buehne-hinweis')?.textContent ?? '';
const rueckfallSichtbar = () =>
  !document.querySelector('.figur-rueckfall')?.classList.contains('weg');
const knoepfe = () =>
  [...document.querySelectorAll('.buehne-werkzeug button')] as HTMLButtonElement[];

describe('Profil: Laden', () => {
  it('lädt die Figur beim Öffnen genau einmal und blinkt nicht', async () => {
    const klassen: boolean[] = [];
    profil(mann, ironward);
    const beob = new MutationObserver(() => {
      const b = bereit();
      if (klassen.at(-1) !== b) klassen.push(b);
    });
    beob.observe(leinwand() as HTMLCanvasElement, { attributes: true, attributeFilter: ['class'] });
    await ruhe(200);
    beob.disconnect();
    expect(fake().instanzen.length).toBe(1);
    expect(koerperRufe()).toEqual(['koerper:wikinger/WikingerKoerper']);
    expect(klassen).toEqual([true]);
    expect(bereit()).toBe(true);
  });

  it('Lazy: vor der Sichtbarkeit weder appearance.json noch Bündel; danach beides', async () => {
    let melde!: (e: { isIntersecting: boolean }[]) => void;
    global.IntersectionObserver = class {
      constructor(r: typeof melde) {
        melde = r;
      }
      observe() {}
      disconnect() {}
    };
    const vorher = fake().importe;
    profil(mann);
    await ruhe(80);
    expect(abrufe).toEqual([]);
    expect(fake().importe).toBe(vorher);
    expect(fake().instanzen.length).toBe(0);
    melde([{ isIntersecting: true }]);
    await ruhe(150);
    expect(abrufe.some((u) => u.includes('appearance.json'))).toBe(true);
    expect(fake().instanzen.length).toBe(1);
    expect(bereit()).toBe(true);
  });

  it('ohne aussehen wird nichts geladen und keine Leinwand gebaut', async () => {
    profil(undefined);
    await ruhe(80);
    expect(leinwand()).toBe(null);
    expect(abrufe).toEqual([]);
    expect(document.querySelectorAll('.stage button').length).toBe(0);
  });

  it('reicht die angelegten Stücke an die Figur weiter', async () => {
    profil(mann, ironward);
    await ruhe(200);
    const plaetze = fake().instanzen[0].rufe.filter((r) => r.startsWith('setze:klassenruestung-'));
    expect(plaetze.filter((r) => !r.endsWith('=null')).length).toBe(7);
    expect(plaetze).toContain('setze:klassenruestung-0=ironward/IronwardHelmet');
  });

  it('Stücke mit `name` statt `kennung` legen nichts an', async () => {
    profil(
      mann,
      ironward.map((s: { kennung: string }) => ({ name: s.kennung })),
    );
    await ruhe(200);
    const plaetze = fake().instanzen[0].rufe.filter((r) => r.startsWith('setze:klassenruestung-'));
    expect(plaetze.every((r) => r.endsWith('=null'))).toBe(true);
  });
});

describe('Profil: Lebenszyklus', () => {
  it('Verlassen entsorgt die Engine; danach kein Aufruf mehr an ihr', async () => {
    const s = profil(mann, ironward);
    await ruhe(200);
    s.zeige(false);
    flushSync();
    await ruhe(50);
    expect(fake().instanzen.length).toBe(1);
    expect(fake().instanzen[0].entsorgt).toBe(1);
    expect(fake().instanzen[0].nachEntsorgen).toEqual([]);
  });

  it('Profilwechsel nutzt dieselbe Engine und endet auf der letzten Wahl', async () => {
    const s = profil(mann, ironward);
    await ruhe(200);
    fake().verzoegerung = 5;
    s.setze(frau, []);
    flushSync();
    s.setze(mann, ironward);
    flushSync();
    s.setze(frau, []);
    flushSync();
    await ruhe(400);
    expect(fake().instanzen.length).toBe(1);
    expect(fake().instanzen[0].entsorgt).toBe(0);
    expect(koerperRufe().at(-1)).toBe('koerper:wikingerin/WikingerinKoerper');
    const letzte7 = fake()
      .instanzen[0].rufe.filter((r) => r.startsWith('setze:klassenruestung-'))
      .slice(-7);
    expect(letzte7.every((r) => r.endsWith('=null'))).toBe(true);
    expect(
      fake()
        .instanzen[0].rufe.filter((r) => r.startsWith('waffe:'))
        .at(-1),
    ).toBe('waffe:stab');
    expect(bereit()).toBe(true);
    expect(ablehnungen).toEqual([]);
  });

  it('schnelles Auf/Zu (6x): jede Engine wird entsorgt, höchstens eine lebt', async () => {
    fake().verzoegerung = 4;
    const s = profil(mann, ironward);
    let maxLebend = 0;
    for (let i = 0; i < 6; i++) {
      await ruhe(i % 2 ? 3 : 25);
      s.zeige(false);
      flushSync();
      await ruhe(i % 3 ? 2 : 15);
      s.zeige(true);
      flushSync();
      maxLebend = Math.max(maxLebend, fake().instanzen.filter((v) => !v.entsorgt).length);
    }
    await ruhe(300);
    maxLebend = Math.max(maxLebend, fake().instanzen.filter((v) => !v.entsorgt).length);
    expect(maxLebend).toBeLessThanOrEqual(1);
    s.zeige(false);
    flushSync();
    await ruhe(100);
    expect(fake().instanzen.every((v) => v.entsorgt === 1)).toBe(true);
    expect(
      fake().instanzen.flatMap((v) =>
        v.nachEntsorgen.filter((r) => !r.startsWith('setze:') && !r.startsWith('waffe:')),
      ),
    ).toEqual([]);
    expect(ablehnungen).toEqual([]);
  });

  it('Verlassen, während appearance.json noch lädt: es entsteht keine Engine', async () => {
    global.__halte = true;
    const s = profil(mann);
    await ruhe(30);
    expect(haltFetch).not.toBe(null);
    s.zeige(false);
    flushSync();
    (haltFetch as unknown as { los: () => void }).los();
    await ruhe(100);
    expect(fake().instanzen.length).toBe(0);
  });
});

describe('Profil: Rückfall', () => {
  it('ohne WebGL: Silhouette, kein Bündel, keine wirkungslosen Knöpfe, der Vorlese-Text nennt den Grund', async () => {
    webgl = false;
    const vorher = fake().importe;
    profil(mann, ironward);
    await ruhe(150);
    expect(fake().importe).toBe(vorher);
    expect(fake().instanzen.length).toBe(0);
    expect(rueckfallSichtbar()).toBe(true);
    expect(document.querySelector('.figur-rueckfall svg[role="img"]')).not.toBe(null);
    expect(knoepfe().length).toBe(0);
    expect(hinweis()).toContain('WebGL');
    expect(leinwand()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('beim Laden (Silhouette steht noch): keine Knöpfe; erst die fertige Figur bekommt sie', async () => {
    fake().verzoegerung = 30;
    profil(mann);
    await ruhe(40);
    expect(knoepfe().length).toBe(0);
    expect(hinweis()).toContain('geladen');
    await ruhe(600);
    expect(bereit()).toBe(true);
    expect(knoepfe().length).toBe(4);
    expect(rueckfallSichtbar()).toBe(false);
  });

  it('ein unpassendes Rüstungsteil lässt nur dieses Teil weg, die Figur steht (k134)', async () => {
    fake().wirftBei.add('ironward/IronwardHelmet');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    profil(mann, ironward);
    await ruhe(300);
    expect(bereit()).toBe(true);
    expect(rueckfallSichtbar()).toBe(false);
    const rufe = fake().instanzen[0].rufe;
    expect(rufe).toContain('setze:klassenruestung-0=null'); // der Helm-Platz wurde geleert
    expect(rufe.filter((r) => /^setze:klassenruestung-[1-6]=\w/.test(r)).length).toBe(6);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('Körper nicht ladbar: Fehler sichtbar, Silhouette bleibt, Engine entsorgt; ein anderes Profil startet neu', async () => {
    fake().wirftBei.add('wikinger/WikingerKoerper');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = profil(mann, ironward);
    await ruhe(300);
    expect(bereit()).toBe(false);
    expect(rueckfallSichtbar()).toBe(true);
    expect(hinweis()).toContain('Figur nicht geladen');
    expect(fake().instanzen[0].entsorgt).toBe(1);
    expect(knoepfe().length).toBe(0);
    s.setze(frau, []);
    flushSync();
    await ruhe(300);
    expect(fake().instanzen.length).toBe(2);
    expect(bereit()).toBe(true);
    expect(rueckfallSichtbar()).toBe(false);
    expect(ablehnungen).toEqual([]);
    warn.mockRestore();
  });

  it('kaputte Profildaten (frisur null, ausruestung kaputt) werfen nicht, die Figur fällt auf Vorgaben', async () => {
    profil({ ...mann, frisur: null, haarfarbe: undefined }, 'kaputt');
    await ruhe(200);
    expect(ablehnungen).toEqual([]);
    expect(bereit()).toBe(true);
  });
});

describe('Bedienung im festen Rahmen', () => {
  it('senkrechtes Wischen scrollt die Seite (touch-action pan-y), das Mausrad erreicht die Leinwand nicht', async () => {
    profil(mann);
    await ruhe(200);
    const flaeche = leinwand() as HTMLCanvasElement;
    expect(flaeche.style.touchAction).toBe('pan-y');
    let erreicht = 0;
    flaeche.addEventListener('wheel', (e) => {
      erreicht += 1;
      e.preventDefault();
    });
    const rad = new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true });
    flaeche.dispatchEvent(rad);
    expect(erreicht).toBe(0);
    expect(rad.defaultPrevented).toBe(false);
  });

  it('die Leinwand hat einen Namen, die Drehknöpfe unterscheiden sich, Tastatur dreht', async () => {
    profil(mann);
    await ruhe(200);
    const flaeche = leinwand() as HTMLCanvasElement;
    expect(flaeche.getAttribute('role')).toBe('img');
    expect(flaeche.getAttribute('aria-label')).toBe('Dreidimensionale Figur des Recken');
    expect(flaeche.getAttribute('aria-hidden')).toBe('false');
    const k = knoepfe();
    expect(k.slice(0, 3).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Figur nach links drehen',
      'Blick zurücksetzen',
      'Figur nach rechts drehen',
    ]);
    k[0].click();
    expect(fake().instanzen[0].rufe.at(-1)).toBe('drehe:-0.35');
  });
});

describe('ReckenVorschau mit bind:daten und bind:fertig (Form der Erstellen-Seite)', () => {
  it('aktiv fällt, während appearance.json lädt, und kommt zurück: beiDaten wird gerufen', async () => {
    global.__halte = true;
    const steuer = vorschau((d) => planFuerRecke(d, mann));
    await ruhe(30);
    steuer.aktiv(false);
    flushSync();
    (haltFetch as unknown as { los: () => void }).los();
    await ruhe(50);
    expect(steuer.daten()).toBe(null); // der beendete Lauf setzt `daten` nicht
    global.__halte = false;
    steuer.aktiv(true);
    flushSync();
    await ruhe(200);
    expect(steuer.beiDaten).toBe(1);
    expect(fake().instanzen.length).toBe(1);
  });

  it('Abbau setzt fertig zurück', async () => {
    const steuer = vorschau((d) => planFuerRecke(d, mann));
    await ruhe(200);
    expect(steuer.fertig()).toBe(true);
    steuer.aktiv(false);
    flushSync();
    await ruhe(30);
    expect(steuer.fertig()).toBe(false);
    expect(fake().instanzen[0].entsorgt).toBe(1);
  });

  it('Modulfehler (Konstruktor wirft) steht in der Konsole und als Hinweis', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.__fakeWirft = true;
    const steuer = vorschau((d) => planFuerRecke(d, mann));
    await ruhe(150);
    expect(steuer.hinweis()).toContain('Vorschau-Modul nicht ladbar');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('Erstellen-Form ohne Rückfall: Knöpfe stehen schon beim Laden, wie vorher', async () => {
    fake().verzoegerung = 30;
    vorschau((d) => planFuerRecke(d, mann));
    await ruhe(40);
    expect(knoepfe().length).toBe(4);
    expect(hinweis()).toContain('Figur wird geladen');
  });
});
