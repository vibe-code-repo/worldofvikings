import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type AussehenDaten,
  type BuendelModul,
  baueLadePlan,
  type FigurAussehen,
  type FigurFehler,
  FigurSteuerung,
  type KopfZustand,
  type LadePlan,
  planFuerRecke,
  RUESTUNGS_PLAETZE,
  ruestungAusStuecken,
  ruestungsPlaetze,
  type SichtbarkeitsFabrik,
  ueberwacheSichtbarkeit,
  type VorschauApi,
  waffeFuerKlasse,
  zerlegeFrisur,
} from './reckenVorschauKern';

const HIER = dirname(fileURLToPath(import.meta.url));
const quelle = (datei: string) => readFileSync(join(HIER, datei), 'utf8');

const DATEN: AussehenDaten = {
  folder: 'wikinger',
  body: 'WikingerKoerper',
  figures: [
    { id: 'wikinger', name: 'Wikinger', model: 'wikinger/WikingerKoerper' },
    { id: 'wikingerin', name: 'Wikingerin', model: 'wikingerin/WikingerinKoerper' },
  ],
  hairstyles: [
    { id: 'H_01', name: 'a', file: 'H_01' },
    { id: 'H_02', name: 'b', file: 'H_02' },
    { id: 'H_04', name: 'c', file: 'H_04' },
  ],
  beards: [{ id: 'B_02', name: 'x', file: 'B_02' }],
  eyebrows: [
    { id: 'AM_01', name: 'e', file: 'AM_01', figure: 'wikinger' },
    { id: 'AF_01', name: 'f', file: 'AF_01', figure: 'wikingerin' },
  ],
  hairColors: [
    { id: 'rabenschwarz', name: 'r', hex: '#1A1613' },
    { id: 'dunkelbraun', name: 'd', hex: '#2E2018' },
  ],
  eyeColors: [{ id: 'fjordblau', name: 'f', hex: '#49667E' }],
  equipment: [],
  defaultFigure: 'wikingerin',
  defaultBeard: 'B_02',
  defaultEyebrows: { wikinger: 'AM_01', wikingerin: 'AF_01' },
  equipmentSets: [
    {
      id: 'ironward',
      figure: 'wikinger',
      parts: [
        {
          itemId: 'IronwardHelmet',
          model: 'ironward/IronwardHelmet.glb',
          regions: ['Head'],
          appearanceSlot: 'kopf',
        },
        {
          itemId: 'IronwardCuirass',
          model: 'ironward/IronwardCuirass.glb',
          regions: ['Torso'],
          appearanceSlot: 'oberkoerper',
        },
      ],
    },
    {
      id: 'plainhide_female',
      figure: 'wikingerin',
      parts: [
        {
          itemId: 'plainhide_female_vest',
          model: 'plainhide/plainhide_female_vest.glb',
          regions: ['Torso'],
          appearanceSlot: 'oberkoerper',
        },
      ],
    },
  ] as unknown as AussehenDaten['equipmentSets'],
};

const MANN: FigurAussehen = {
  klasse: 'krieger',
  figur: 'wikinger',
  frisur: 'H_04+B_02+AM_01',
  haarfarbe: 'dunkelbraun',
  augenfarbe: 'fjordblau',
};

describe('Ladeplan', () => {
  it('zerlegt die Drahtform der Frisur', () => {
    expect(zerlegeFrisur(DATEN, 'H_04+B_02+AM_01')).toEqual({
      frisur: 'H_04',
      bart: 'B_02',
      augenbraue: 'AM_01',
    });
    expect(zerlegeFrisur(DATEN, 'H_02')).toEqual({ frisur: 'H_02', bart: '', augenbraue: '' });
  });

  it('macht aus dem Aussehen Dateien und Farben', () => {
    const plan = planFuerRecke(DATEN, MANN);
    expect(plan).toEqual({
      klasse: 'krieger',
      koerper: 'wikinger/WikingerKoerper',
      waffe: 'schwert',
      frisur: 'wikinger/H_04',
      bart: 'wikinger/B_02',
      augenbraue: 'wikinger/AM_01',
      haarton: '#2E2018',
      augenfarbe: 'fjordblau',
      ruestung: Array(RUESTUNGS_PLAETZE).fill(null),
    });
  });

  it('Wikingerin: kein Bart, eigener Körper, eigene Vorgabe-Braue', () => {
    const plan = planFuerRecke(DATEN, {
      ...MANN,
      figur: 'wikingerin',
      frisur: 'H_02',
      klasse: 'seherin',
    });
    expect(plan.koerper).toBe('wikingerin/WikingerinKoerper');
    expect(plan.bart).toBeNull();
    expect(plan.augenbraue).toBe('wikinger/AF_01');
    expect(plan.waffe).toBeNull();
  });

  it('H_01 wird beim Wikinger durch die erste andere Frisur ersetzt', () => {
    const plan = planFuerRecke(DATEN, { ...MANN, frisur: 'H_01' });
    expect(plan.frisur).toBe('wikinger/H_02');
  });

  it('unbekannte Figur fällt auf die Vorgabe zurück', () => {
    expect(planFuerRecke(DATEN, { ...MANN, figur: 'zwerg' }).koerper).toBe(
      'wikingerin/WikingerinKoerper',
    );
  });

  it('Waffe nur für Krieger und Druide', () => {
    expect(waffeFuerKlasse('krieger')).toBe('schwert');
    expect(waffeFuerKlasse('druide')).toBe('stab');
    expect(waffeFuerKlasse('hexer')).toBeNull();
  });

  it('angelegte Rüstung: nur Stücke der eigenen Figur, je Körperplatz eines', () => {
    const teile = ruestungAusStuecken(DATEN, 'wikinger', [
      { kennung: 'IronwardCuirass' },
      { kennung: 'IronwardHelmet' },
      { kennung: 'plainhide_female_vest' },
      { kennung: 'SwordBronze' },
    ]);
    expect(teile.map((t) => t.datei)).toEqual([
      'ironward/IronwardCuirass',
      'ironward/IronwardHelmet',
    ]);
    const plan = planFuerRecke(DATEN, MANN, [{ kennung: 'IronwardHelmet' }]);
    expect(plan.ruestung.slice(0, 2)).toEqual(['ironward/IronwardHelmet', null]);
    expect(plan.ruestung).toHaveLength(RUESTUNGS_PLAETZE);
    expect(ruestungAusStuecken(DATEN, 'wikinger', undefined)).toEqual([]);
    expect(ruestungAusStuecken(DATEN, 'wikinger', [{ kennung: 'Unbekannt' }])).toEqual([]);
  });

  it('ausgeblendeter Helm wird zu null, die übrigen Plätze bleiben', () => {
    const teile = ruestungAusStuecken(DATEN, 'wikinger', [
      { kennung: 'IronwardHelmet' },
      { kennung: 'IronwardCuirass' },
    ]);
    expect(ruestungsPlaetze(teile, false)[0]).toBe('ironward/IronwardHelmet');
    expect(ruestungsPlaetze(teile, true)[0]).toBeNull();
    expect(ruestungsPlaetze(teile, true)[1]).toBe('ironward/IronwardCuirass');
  });
});

/* ------------------------------------------------------------ Steuerung */

class Attrappe implements VorschauApi {
  aufrufe: string[] = [];
  nachEntsorgen: string[] = [];
  entsorgt = 0;
  wirftBei = new Set<string>();
  /** Läuft vor `ladeKoerper`; ein Test hält damit einen Ladevorgang an. */
  vorKoerper: (() => Promise<void>) | null = null;
  beiKopfZustand: ((z: KopfZustand) => void) | null = null;
  zoomeKopf() {}
  async setzeWurzel(url: string) {
    this.merke(`wurzel ${url}`);
  }
  async ladeKoerper(pfad: string) {
    this.merke(`koerper ${pfad}`);
    await this.vorKoerper?.();
    return true;
  }
  async setzeWaffe(art: string | null) {
    this.merke(`waffe ${art}`);
  }
  async setze(slot: string, datei: string | null) {
    this.merke(`setze ${slot} ${datei}`);
    if (datei && this.wirftBei.has(datei)) throw new Error(`Incompatible armor skeleton: ${datei}`);
  }
  private merke(aufruf: string) {
    this.aufrufe.push(aufruf);
    if (this.entsorgt) this.nachEntsorgen.push(aufruf);
  }
  setzeHaarfarbe(hex: string) {
    this.aufrufe.push(`haar ${hex}`);
  }
  setzeAugenfarbe(id: string) {
    this.aufrufe.push(`auge ${id}`);
  }
  drehe() {}
  blickZurueck() {}
  dispose() {
    this.entsorgt += 1;
  }
}

function aufbau(
  opt: {
    webgl?: boolean;
    buendelFehler?: boolean;
    buendelWarte?: Promise<void>;
    beiBilder?: () => void;
  } = {},
) {
  const engines: Attrappe[] = [];
  const meldungen: string[] = [];
  const fehler: (FigurFehler | null)[] = [];
  let buendelGeladen = 0;
  const steuerung = new FigurSteuerung(
    {
      hatWebGL: () => opt.webgl ?? true,
      ladeBuendel: async () => {
        buendelGeladen += 1;
        await opt.buendelWarte;
        if (opt.buendelFehler) throw new Error('kein Bündel');
        class Gebaut extends Attrappe {
          constructor() {
            super();
            engines.push(this);
          }
        }
        return { Vorschau: Gebaut } as unknown as BuendelModul;
      },
      warteBilder: async () => {
        meldungen.push('bilder');
        opt.beiBilder?.();
      },
    },
    { beiFertig: (f) => meldungen.push(`fertig ${f}`), beiFehler: (f) => fehler.push(f) },
  );
  return { steuerung, engines, meldungen, fehler, geladen: () => buendelGeladen };
}

const LEINWAND = {} as HTMLCanvasElement;
const planKrieger = () => planFuerRecke(DATEN, MANN, [{ kennung: 'IronwardHelmet' }]);

describe('FigurSteuerung', () => {
  it('lädt in der Reihenfolge der Charaktererstellung', async () => {
    const { steuerung, engines, meldungen } = aufbau();
    expect(await steuerung.starte(LEINWAND)).toBe(true);
    expect(await steuerung.ladeAlles(planKrieger)).toBe(true);
    expect(engines).toHaveLength(1);
    expect(engines[0].aufrufe).toEqual([
      'wurzel /assets/models/',
      'koerper wikinger/WikingerKoerper',
      'waffe schwert',
      'setze frisur wikinger/H_04',
      'setze bart wikinger/B_02',
      'setze augenbraue wikinger/AM_01',
      'haar #2E2018',
      'auge fjordblau',
      'setze klassenruestung-0 ironward/IronwardHelmet',
      'setze klassenruestung-1 null',
      'setze klassenruestung-2 null',
      'setze klassenruestung-3 null',
      'setze klassenruestung-4 null',
      'setze klassenruestung-5 null',
      'setze klassenruestung-6 null',
      'waffe schwert',
    ]);
    expect(meldungen).toEqual(['fertig false', 'bilder', 'fertig true']);
  });

  it('Rückfall: ohne WebGL wird weder ein Bündel geladen noch eine Engine gebaut', async () => {
    const { steuerung, engines, fehler, geladen } = aufbau({ webgl: false });
    expect(await steuerung.starte(LEINWAND)).toBe(false);
    expect(fehler).toEqual([{ art: 'kein-webgl' }]);
    expect(geladen()).toBe(0);
    expect(engines).toHaveLength(0);
    expect(await steuerung.ladeAlles(planKrieger)).toBe(false);
  });

  it('Rückfall: ein nicht ladbares Bündel wird gemeldet, nicht geworfen', async () => {
    const { steuerung, engines, fehler } = aufbau({ buendelFehler: true });
    expect(await steuerung.starte(LEINWAND)).toBe(false);
    expect(fehler[0]?.art).toBe('buendel');
    expect(engines).toHaveLength(0);
  });

  it('Abbau: dispose entsorgt die Engine genau einmal', async () => {
    const { steuerung, engines } = aufbau();
    await steuerung.starte(LEINWAND);
    steuerung.dispose();
    steuerung.dispose();
    expect(engines[0].entsorgt).toBe(1);
    expect(steuerung.vorschau).toBeNull();
  });

  it('Abbau während das Bündel lädt: es entsteht keine hängende Engine', async () => {
    let frei!: () => void;
    const warte = new Promise<void>((r) => {
      frei = r;
    });
    const { steuerung, engines } = aufbau({ buendelWarte: warte });
    const start = steuerung.starte(LEINWAND);
    steuerung.dispose();
    frei();
    expect(await start).toBe(false);
    expect(engines).toHaveLength(0);
    expect(await steuerung.starte(LEINWAND)).toBe(false);
  });

  it('Abbau während des Ladens: der Lauf endet ohne Fehlermeldung und ohne „fertig“', async () => {
    const { steuerung, meldungen, fehler } = aufbau();
    await steuerung.starte(LEINWAND);
    const lauf = steuerung.ladeAlles(planKrieger);
    steuerung.dispose();
    expect(await lauf).toBe(false);
    expect(meldungen).not.toContain('fertig true');
    expect(fehler.filter(Boolean)).toEqual([]);
  });

  it('ein neuerer Ladevorgang gewinnt gegen einen älteren', async () => {
    const { steuerung, meldungen } = aufbau();
    await steuerung.starte(LEINWAND);
    const erster = steuerung.ladeAlles(planKrieger);
    const zweiter = steuerung.ladeAlles(planKrieger);
    expect(await erster).toBe(false);
    expect(await zweiter).toBe(true);
    expect(meldungen.filter((m) => m === 'fertig true')).toHaveLength(1);
  });

  it('Klassenwechsel mitten im Laden: Waffe wird nachgezogen, bis sie zur Klasse passt', async () => {
    let klasse = 'krieger';
    let bilder = 0;
    const { steuerung, engines } = aufbau({
      // Die Wahl ändert sich, während die Figur auf gezeichnete Bilder wartet.
      beiBilder: () => {
        if (++bilder === 1) klasse = 'druide';
      },
    });
    await steuerung.starte(LEINWAND);
    const plan = (): LadePlan => baueLadePlan(DATEN, { ...MANN, klasse });
    expect(await steuerung.ladeAlles(plan)).toBe(true);
    expect(bilder).toBe(2);
    const waffen = engines[0].aufrufe.filter((a) => a.startsWith('waffe'));
    expect(waffen.at(-1)).toBe('waffe stab');
  });
});

describe('Lazy-Load', () => {
  class FakeBeobachter {
    static alle: FakeBeobachter[] = [];
    getrennt = false;
    ziele: unknown[] = [];
    constructor(public rueckruf: (e: { isIntersecting: boolean }[]) => void) {
      FakeBeobachter.alle.push(this);
    }
    observe(z: unknown) {
      this.ziele.push(z);
    }
    disconnect() {
      this.getrennt = true;
    }
  }

  it('meldet erst, wenn das Element in die Nähe kommt, und nur einmal', () => {
    FakeBeobachter.alle = [];
    let n = 0;
    ueberwacheSichtbarkeit(
      {} as Element,
      () => n++,
      FakeBeobachter as unknown as SichtbarkeitsFabrik,
    );
    const b = FakeBeobachter.alle[0];
    expect(n).toBe(0);
    b.rueckruf([{ isIntersecting: false }]);
    expect(n).toBe(0);
    b.rueckruf([{ isIntersecting: true }]);
    expect(n).toBe(1);
    expect(b.getrennt).toBe(true);
  });

  it('die Abmeldung trennt den Beobachter', () => {
    FakeBeobachter.alle = [];
    const aus = ueberwacheSichtbarkeit(
      {} as Element,
      () => {},
      FakeBeobachter as unknown as SichtbarkeitsFabrik,
    );
    aus();
    expect(FakeBeobachter.alle[0].getrennt).toBe(true);
  });

  it('ohne IntersectionObserver gilt die Bühne sofort als sichtbar', () => {
    let n = 0;
    ueberwacheSichtbarkeit({} as Element, () => n++, undefined);
    // Node hat keinen IntersectionObserver: der Standardweg ist derselbe Rückfall.
    expect(n).toBe(1);
  });
});

describe('Verdrahtung der Oberfläche', () => {
  it('Reckenprofil lädt die Figur lazy, mit Silhouette als Rückfall', () => {
    const q = quelle('Reckenprofil.svelte');
    expect(q).toMatch(/<ReckenVorschau\s+lazy\b/);
    expect(q).toContain('{#snippet rueckfall()}{@render silhouette()}{/snippet}');
    // Seit R2 trägt jeder Recke ein Aussehen: kein `{#if aussehen}` mehr, die Figur bekommt Aussehen und Stücke.
    expect(q).toContain('planFuerRecke(daten, aussehen, stuecke)');
  });

  it('ReckenVorschau entsorgt die Engine beim Abbau und wartet bei lazy auf die Sichtbarkeit', () => {
    const q = quelle('ReckenVorschau.svelte');
    expect(q).toContain('eigene.dispose()');
    expect(q).toMatch(/if \(!aktiv \|\| !sichtbar \|\| !leinwand\) return;/);
    expect(q).toMatch(/if \(!lazy\) \{\s*sichtbar = true;/);
    expect(q).toContain('ueberwacheSichtbarkeit(wurzel');
  });

  it('die Erstellen-Seite benutzt dieselbe Komponente und baut keine eigene Engine mehr', () => {
    const q = quelle('../routes/[lang=lang]/erstellen/+page.svelte');
    expect(q).toContain('<ReckenVorschau');
    expect(q).not.toContain('vorschau.js');
    expect(q).not.toContain('<canvas');
  });

  it('das Bündel steht nur im Kern, nie als statischer Import', () => {
    expect(quelle('ReckenVorschau.svelte')).toMatch(
      /import\(\/\* @vite-ignore \*\/ BUENDEL_PFAD\)/,
    );
    expect(quelle('reckenVorschauKern.ts')).not.toMatch(/from ['"][^'"]*vorschau(\.js)?['"]/);
  });
});

describe('Nachbesserung N1: Rüstungszuordnung', () => {
  const alle = (kennungen: string[]) => kennungen.map((kennung) => ({ kennung }));

  it('der Typ verlangt `kennung`: ein Stück mit `name` legt nichts an und ist ein Typfehler', () => {
    // @ts-expect-error `name` ist der Anzeigename des Endpunkts, nicht die Zuordnung
    const mitName = ruestungAusStuecken(DATEN, 'wikinger', [{ name: 'IronwardHelmet' }]);
    expect(mitName).toEqual([]);
    expect(ruestungAusStuecken(DATEN, 'wikinger', alle(['IronwardHelmet']))).toHaveLength(1);
  });

  it('Groß-/Kleinschreibung der Kennung zählt nicht', () => {
    expect(ruestungAusStuecken(DATEN, 'wikinger', alle(['ironwardhelmet']))).toHaveLength(1);
  });

  it('bei zwei Stücken auf einem Platz gewinnt das später genannte', () => {
    const daten = {
      ...DATEN,
      equipmentSets: [
        ...(DATEN.equipmentSets ?? []),
        {
          id: 'zwei',
          figure: 'wikinger',
          parts: [
            {
              itemId: 'ZweiHelm',
              model: 'zwei/ZweiHelm.glb',
              regions: ['Head'],
              appearanceSlot: 'kopf',
            },
          ],
        },
      ],
    } as unknown as AussehenDaten;
    const a = ruestungAusStuecken(daten, 'wikinger', alle(['IronwardHelmet', 'ZweiHelm']));
    const b = ruestungAusStuecken(daten, 'wikinger', alle(['ZweiHelm', 'IronwardHelmet']));
    expect(a.map((t) => t.datei)).toEqual(['zwei/ZweiHelm']);
    expect(b.map((t) => t.datei)).toEqual(['ironward/IronwardHelmet']);
  });

  it('ein Set ohne Figurangabe passt zu jedem Körper, den canWearArmor erlaubt', () => {
    const daten = {
      ...DATEN,
      equipmentSets: [
        {
          id: 'frei',
          parts: [
            {
              itemId: 'FreiHelm',
              model: 'frei/FreiHelm.glb',
              regions: ['Head'],
              appearanceSlot: 'kopf',
            },
          ],
        },
      ],
    } as unknown as AussehenDaten;
    expect(ruestungAusStuecken(daten, 'wikinger', alle(['FreiHelm']))).toHaveLength(1);
    expect(ruestungAusStuecken(daten, 'wikingerin', alle(['FreiHelm']))).toHaveLength(1);
  });

  it('ein Stück der anderen Figur bleibt draußen', () => {
    expect(ruestungAusStuecken(DATEN, 'wikingerin', alle(['IronwardHelmet']))).toEqual([]);
  });
});

describe('Nachbesserung N1: kaputte Daten', () => {
  it('planFuerRecke wirft nicht bei fehlenden oder falsch typisierten Feldern', () => {
    const kaputt = {
      klasse: null,
      figur: 3,
      frisur: null,
      haarfarbe: undefined,
      augenfarbe: {},
    } as unknown as FigurAussehen;
    expect(() => planFuerRecke(DATEN, kaputt, 'x' as never)).not.toThrow();
    expect(planFuerRecke(DATEN, kaputt).koerper).toBe('wikingerin/WikingerinKoerper');
  });

  it('wirft der Plan, meldet ladeAlles den Fehler (ohne Körperadresse) und lehnt nicht ab', async () => {
    const { steuerung, fehler } = aufbau();
    await steuerung.starte(LEINWAND);
    const wirft = (): LadePlan => {
      throw new Error('Plan kaputt');
    };
    expect(await steuerung.ladeAlles(wirft)).toBe(false);
    const f = fehler.at(-1);
    expect(f?.art).toBe('laden');
    expect(f && 'url' in f ? f.url : 'x').toBe('');
  });

  it('scheitert der Körper, nennt der Fehler dessen Adresse', async () => {
    const { steuerung, engines, fehler } = aufbau();
    await steuerung.starte(LEINWAND);
    engines[0].vorKoerper = async () => {
      throw new Error('404');
    };
    expect(await steuerung.ladeAlles(planKrieger)).toBe(false);
    const f = fehler.at(-1);
    expect(f && 'url' in f ? f.url : '').toBe('/assets/models/wikinger/WikingerKoerper.glb');
  });
});

describe('Nachbesserung N1: ein unpassendes Rüstungsteil (k134)', () => {
  const voll = DATEN.equipmentSets?.[0]?.parts.map((p) => ({ kennung: p.itemId })) ?? [];

  it('nur der Platz des Teils bleibt leer; Figur steht, Meldung kommt, die übrigen Teile sind gesetzt', async () => {
    const teilFehler: string[] = [];
    const meldungen: string[] = [];
    const steuerung = new FigurSteuerung(
      {
        hatWebGL: () => true,
        warteBilder: async () => {},
        ladeBuendel: async () => ({ Vorschau: Attrappe as unknown as BuendelModul['Vorschau'] }),
      },
      {
        beiFertig: (f) => meldungen.push(`fertig ${f}`),
        beiTeilFehler: (slot, datei) => teilFehler.push(`${slot} ${datei}`),
      },
    );
    const eng: Attrappe[] = [];
    const orig = Attrappe.prototype.setzeWurzel;
    Attrappe.prototype.setzeWurzel = async function (this: Attrappe, u: string) {
      eng.push(this);
      this.wirftBei.add('ironward/IronwardHelmet');
      return orig.call(this, u);
    };
    try {
      await steuerung.starte(LEINWAND);
      const plan = () => planFuerRecke(DATEN, MANN, voll);
      expect(await steuerung.ladeAlles(plan)).toBe(true);
    } finally {
      Attrappe.prototype.setzeWurzel = orig;
    }
    expect(meldungen.at(-1)).toBe('fertig true');
    expect(teilFehler).toEqual(['klassenruestung-0 ironward/IronwardHelmet']);
    const rufe = eng[0].aufrufe;
    expect(rufe.at(rufe.lastIndexOf('setze klassenruestung-0 null'))).toBe(
      'setze klassenruestung-0 null',
    );
    expect(rufe.filter((r) => /^setze klassenruestung-[1-6] \w/.test(r)).length).toBe(6);
  });

  it('die werfende Fassung für das Rückschalten der Erstellung bleibt werfend', async () => {
    const { steuerung, engines } = aufbau();
    await steuerung.starte(LEINWAND);
    engines[0].wirftBei.add('ironward/IronwardHelmet');
    await expect(steuerung.zeigeRuestung(() => planFuerRecke(DATEN, MANN, voll))).rejects.toThrow(
      /Incompatible/,
    );
  });
});

describe('Nachbesserung N1: Lebenszyklus', () => {
  it('zwei gleichzeitige starte() ergeben eine Engine', async () => {
    let gib!: () => void;
    const warten = new Promise<void>((r) => {
      gib = r;
    });
    const { steuerung, engines, geladen } = aufbau({ buendelWarte: warten });
    const a = steuerung.starte(LEINWAND);
    const b = steuerung.starte(LEINWAND);
    gib();
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect(engines).toHaveLength(1);
    expect(geladen()).toBe(1);
    steuerung.dispose();
    expect(engines[0].entsorgt).toBe(1);
  });

  it('der Fehler eines veralteten Laufs wird nicht gemeldet', async () => {
    const { steuerung, engines, fehler } = aufbau();
    await steuerung.starte(LEINWAND);
    let los!: () => void;
    engines[0].vorKoerper = () =>
      new Promise<void>((resolve, reject) => {
        los = () => reject(new Error('alter Lauf'));
        void resolve;
      });
    const alt = steuerung.ladeAlles(planKrieger);
    await Promise.resolve();
    engines[0].vorKoerper = null;
    const neu = steuerung.ladeAlles(planKrieger);
    los();
    expect(await alt).toBe(false);
    expect(await neu).toBe(true);
    expect(fehler.filter((f) => f !== null)).toEqual([]);
  });

  it('von zwei gleichzeitigen Rüstungsläufen gewinnt der letzte', async () => {
    const { steuerung } = aufbau();
    await steuerung.starte(LEINWAND);
    const erster = steuerung.zeigeRuestung(planKrieger);
    const zweiter = steuerung.zeigeRuestung(planKrieger);
    expect(await erster).toBe(false);
    expect(await zweiter).toBe(true);
    const e1 = steuerung.zeigeRuestungNachsichtig(planKrieger);
    const e2 = steuerung.zeigeRuestungNachsichtig(planKrieger);
    expect([await e1, await e2]).toEqual([false, true]);
  });

  it('nach dispose() läuft ein angehaltener Ladevorgang ins Leere: keine Aufrufe, kein „fertig“', async () => {
    const { steuerung, engines, meldungen } = aufbau();
    await steuerung.starte(LEINWAND);
    let weiter!: () => void;
    engines[0].vorKoerper = () =>
      new Promise<void>((r) => {
        weiter = r;
      });
    const lauf = steuerung.ladeAlles(planKrieger);
    await Promise.resolve();
    steuerung.dispose();
    weiter();
    expect(await lauf).toBe(false);
    expect(engines[0].nachEntsorgen).toEqual([]);
    expect(meldungen).not.toContain('fertig true');
  });
});
