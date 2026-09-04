/**
 * Das Editor-Formular „Neuer Saal" (E8) — Sichtbarkeit, Beschriftung,
 * Vorschau, Deckel und der Draht zum Paket.
 *
 * ── Was hier gemessen wird und warum ─────────────────────────────────
 * Die Rechnung hinter dem Saal steht längst geprüft woanders: die
 * Quaderzahlen in `shared/test/hallen-geometrie.ts`, die Klemmen in
 * `server/test/modulbau-grenzen.ts`, die Prüfsumme in
 * `server/test/registry-pruefsumme.ts`. Was ALLEN diesen Tests fehlt, ist
 * die letzte Handbreit: ob das Formular überhaupt dasteht, ob es die
 * richtigen vier Zahlen schickt, und ob es dieselben Klemmen kennt wie
 * der Server. Genau dort sitzen die stillen Fehler dieses Meilensteins:
 *
 *  1. **Ein Formular ohne Erlaubnis.** `dungeons.modulbau` ist ein
 *     Servertor. Steht das Formular trotzdem da, klickt Mike es an und
 *     bekommt eine Absage — auf dev sähe das aus wie ein Fehler des
 *     Bauwegs, dabei ist es der Schalter.
 *  2. **„Zellen" heisst zweimal etwas anderes.** Im Formular „Neu
 *     anlegen" ist es die Zellzahl des GANZEN GRABES (G8), hier die
 *     Kantenlänge EINES MODULS. Die Konzeptnotiz führt das unter
 *     „Risiken"; ein Bildschirmfoto zeigt den Unterschied nicht.
 *  3. **Ein Deckel, der erst auf dem Server greift.** 8x8 bei Raster 2
 *     sind 14 076 Dreiecke. Prüft nur der Server, wartet man zehn
 *     Sekunden auf eine Absage, die aus vier Zahlen sofort ableitbar war.
 *  4. **Vier Zahlen, die keiner schickt.** Ein Knopf ohne `onclick` sieht
 *     auf einem Bildschirmfoto genauso aus wie einer mit.
 *
 * ── Warum ein DOM-Stummel und kein Browser ───────────────────────────
 * Dieselbe Begründung wie in `client/test/dungeon-editor-kanten.ts`, aus
 * dem der Stummel unten stammt: `DungeonGrundriss` legt im Konstruktor
 * eine Canvas an. Gemessen wird hier nur, was `DungeonSeite` in ihren
 * Behälter hängt und was ein Klick auslöst. Das FENSTER — Saal bauen,
 * neu laden, betreten — bleibt `tools/pw-editor-saal-bauen.mjs`
 * vorbehalten; grüne Tests sind kein Fenster.
 *
 * Lauf: npx tsx client/test/dungeon-neuer-saal.ts   (aus dem Repo-Wurzelverzeichnis)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FLAG_ASHLANDS_MODERN,
  FLAG_BILINEAR_HEIGHT,
  FLAG_BLEND_SMOOTHSTEP,
  FLAG_DISABLE_DISTANT_RIVERS,
  FLAG_LAYOUT_MODE,
  FLAG_MODULE_BUILD,
  FLAG_RIVER_AFFECTS_OCEAN,
  moduleBuildAllowed,
  moduleRegistry,
  serverConfigFlags,
} from '@wov/shared';

// ── DOM-Stummel, VOR dem Import der Seite gesetzt ────────────────────
//
// Übernommen aus `dungeon-editor-kanten.ts` und um nichts erweitert: Es
// ist genau so viel Browser, wie nötig ist, um ein Feld zu FINDEN und
// einen Knopf anzustossen.
class StummelKnoten {
  readonly style = { cssText: '' };
  readonly kinder: StummelKnoten[] = [];
  width = 0;
  height = 0;
  value = '';
  type = '';
  min = '';
  max = '';
  step = '';
  checked = false;
  title = '';
  placeholder = '';
  selected = false;
  disabled = false;
  label = '';
  onclick: (() => void) | null = null;
  onchange: (() => void) | null = null;
  oninput: (() => void) | null = null;
  private eigenerText = '';

  constructor(readonly tag: string) {}

  get textContent(): string {
    return this.eigenerText;
  }
  set textContent(t: string) {
    this.eigenerText = t;
    this.kinder.length = 0;
  }
  set innerHTML(_h: string) {
    this.kinder.length = 0;
    this.eigenerText = '';
  }
  addEventListener(): void {}
  appendChild(k: StummelKnoten): void {
    this.kinder.push(k);
  }
  getContext(): null {
    return null;
  }
  alle(): StummelKnoten[] {
    return this.kinder.flatMap((k) => [k, ...k.alle()]);
  }
  /** Der ganze sichtbare Text des Teilbaums — für die Hinweisprüfungen. */
  text(): string {
    return [this.textContent, ...this.kinder.map((k) => k.text())].join(' ');
  }
}
const g = globalThis as unknown as Record<string, unknown>;
g.document = { createElement: (tag: string) => new StummelKnoten(tag) };
g.window = { addEventListener: () => undefined, devicePixelRatio: 1 };

const { DungeonGrundriss } = await import('../src/editor/DungeonGrundriss');
const { DungeonSeite } = await import('../src/editor/DungeonKatalog');

let fehler = 0;
function pruefe(bedingung: boolean, was: string, zusatz = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${was}${zusatz ? ` — ${zusatz}` : ''}`);
}

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (p: string): string => readFileSync(resolve(WURZEL, p), 'utf8');

// ── 1. Die Flagbits stehen an EINER Stelle ──────────────────────────
//
// Bis E8 gab es die sechs Bits ZWEIMAL: als `const FLAG_…` in
// `server/src/WovServer.ts` und noch einmal in `client/src/main.ts`, mit
// je einem Kommentar „same order client-side"/„server-side" als einziger
// Zusage. Ein siebtes Bit hätte daraus drei Kopien gemacht — die dritte
// im Editor. Zwei Listen, die auseinanderlaufen, verschieben kein Feld:
// Sie machen aus einem gesetzten Schalter ein anderes Bit, und das
// Formular erschiene bei „Layout-Modus" statt bei „Modulbau".
console.log('ServerConfig-Flags:');
pruefe(FLAG_BLEND_SMOOTHSTEP === 1, 'Bit 0 unverändert', String(FLAG_BLEND_SMOOTHSTEP));
pruefe(FLAG_BILINEAR_HEIGHT === 2, 'Bit 1 unverändert', String(FLAG_BILINEAR_HEIGHT));
pruefe(FLAG_ASHLANDS_MODERN === 4, 'Bit 2 unverändert', String(FLAG_ASHLANDS_MODERN));
pruefe(FLAG_RIVER_AFFECTS_OCEAN === 8, 'Bit 3 unverändert', String(FLAG_RIVER_AFFECTS_OCEAN));
pruefe(FLAG_DISABLE_DISTANT_RIVERS === 16, 'Bit 4 unverändert', String(FLAG_DISABLE_DISTANT_RIVERS));
pruefe(FLAG_LAYOUT_MODE === 32, 'Bit 5 unverändert', String(FLAG_LAYOUT_MODE));
pruefe(FLAG_MODULE_BUILD === 64, 'Modulbau ist Bit 6', String(FLAG_MODULE_BUILD));

const AUS = {
  blendSmoothStep: false,
  bilinearHeight: false,
  ashlandsModernNoise: false,
  riverAffectsOcean: false,
  disableDistantRivers: false,
  layoutMode: false,
  moduleBuild: false,
};
pruefe(serverConfigFlags(AUS) === 0, 'alles aus ergibt 0');
pruefe(
  serverConfigFlags({ ...AUS, moduleBuild: true }) === 64,
  'nur Modulbau ergibt genau Bit 6',
  String(serverConfigFlags({ ...AUS, moduleBuild: true }))
);
pruefe(
  serverConfigFlags({ ...AUS, layoutMode: true, moduleBuild: true }) === 96,
  'Layout und Modulbau stören sich nicht'
);
pruefe(moduleBuildAllowed(64), 'Bit 6 gesetzt heisst: bauen erlaubt');
pruefe(!moduleBuildAllowed(63), 'alle anderen sechs Bits heissen es NICHT');
pruefe(!moduleBuildAllowed(0), 'ein leeres Flagbyte heisst nein');

// ── 2. Wächter: keine zweite Bitliste ────────────────────────────────
for (const [datei, holt] of [
  // Der Server BAUT das Byte und nennt kein einzelnes Bit mehr beim
  // Namen; der Client LIEST es und braucht die Bits weiterhin einzeln.
  ['server/src/WovServer.ts', 'serverConfigFlags'],
  ['client/src/main.ts', 'FLAG_LAYOUT_MODE'],
] as const) {
  const text = lies(datei);
  pruefe(
    !/^const FLAG_[A-Z_]+\s*=/m.test(text),
    `${datei} führt keine eigene Bitliste mehr`,
    (text.match(/^const FLAG_[A-Z_]+\s*=.*$/m) ?? [''])[0]
  );
  pruefe(
    new RegExp(`\\b${holt}\\b`).test(text) && /from '@wov\/shared'/.test(text),
    `${datei} holt sich ${holt} aus @wov/shared`
  );
}

// ── 3. Das Formular erscheint nur mit Erlaubnis ─────────────────────
//
// Und es hängt NICHT am geöffneten Dokument: Einen Saal zu bauen hat mit
// einem offenen Grab nichts zu tun, und ein Formular, das erst nach dem
// Öffnen eines fremden Dokuments auftaucht, findet niemand.
console.log('\nSichtbarkeit:');

interface Gebaut {
  seite: InstanceType<typeof DungeonSeite>;
  behaelter: StummelKnoten;
  auftraege: moduleRegistry.ModulBauWunsch[];
}
let antwortStub: { ok: boolean; message: string; info?: unknown } = {
  ok: true,
  message: 'Gebaut',
};
function seiteMit(erlaubt: boolean): Gebaut {
  const behaelter = new StummelKnoten('div');
  const viewport = { appendChild: () => undefined, clientWidth: 800, clientHeight: 600 };
  const gr = new DungeonGrundriss(viewport as unknown as HTMLElement, {
    meldung: () => undefined,
    auswahlGeaendert: () => undefined,
  });
  const auftraege: moduleRegistry.ModulBauWunsch[] = [];
  const seite = new DungeonSeite(
    behaelter as unknown as HTMLElement,
    gr,
    { meldung: () => undefined },
    async (wunsch) => {
      auftraege.push(wunsch);
      return antwortStub as never;
    }
  );
  seite.setModuleBuild(erlaubt);
  seite.baue();
  return { seite, behaelter, auftraege };
}
const knopfNamens = (b: StummelKnoten, text: string): StummelKnoten | undefined =>
  b.alle().find((k) => k.tag === 'button' && k.textContent === text);

const ohne = seiteMit(false);
pruefe(
  knopfNamens(ohne.behaelter, 'Saal bauen') === undefined,
  'ohne dungeons.modulbau gibt es keinen Knopf „Saal bauen"'
);
pruefe(
  !ohne.behaelter.text().includes('Neuer Saal'),
  'und auch keine Überschrift, die einen Weg verspricht'
);

const mit = seiteMit(true);
pruefe(knopfNamens(mit.behaelter, 'Saal bauen') !== undefined, 'mit Erlaubnis steht der Knopf da');

// ── 4. Modulzellen sind nicht Grabzellen ────────────────────────────
console.log('\nBeschriftung:');
const beschriftungen = mit.behaelter
  .alle()
  .filter((k) => k.tag === 'span')
  .map((k) => k.textContent);
pruefe(
  beschriftungen.some((t) => t.includes('Modulzellen')),
  'die beiden Zahlenfelder heissen „Modulzellen"',
  beschriftungen.filter((t) => t.includes('zellen')).join(' · ')
);
pruefe(
  !beschriftungen.includes('Zellen'),
  'und keines von ihnen heisst blank „Zellen" wie bei „Neu anlegen"'
);

// ── 5. Die Vorschau rechnet mit der geteilten Formel ────────────────
//
// Nicht mit einer nachgeschriebenen: Stünde die Formel im Formular ein
// zweites Mal, zeigte es nach jeder Änderung an `hallenGeometrie.ts` eine
// andere Zahl an als der Server baut.
console.log('\nVorschau:');
function setze(g: Gebaut, breite: string, tiefe: string, raster: string, gewicht: string): void {
  const zahlen = g.behaelter.alle().filter((k) => k.type === 'number');
  const [b, t, w] = [zahlen[0]!, zahlen[1]!, zahlen[2]!];
  b.value = breite;
  b.oninput?.();
  t.value = tiefe;
  t.oninput?.();
  w.value = gewicht;
  w.oninput?.();
  const wahl = g.behaelter
    .alle()
    .find((k) => k.tag === 'select' && k.kinder.some((o) => o.textContent?.startsWith('Raster')));
  if (wahl) {
    wahl.value = raster;
    wahl.onchange?.();
  }
}
setze(mit, '4', '3', '2', '0.5');
const vorschau = mit.behaelter.text();
pruefe(
  vorschau.includes(moduleRegistry.modulName(4, 3, 2)),
  `die Vorschau nennt ${moduleRegistry.modulName(4, 3, 2)}`
);
pruefe(
  vorschau.includes(String(moduleRegistry.dreiecke(4, 3, 2))),
  `sie nennt ${moduleRegistry.dreiecke(4, 3, 2)} Dreiecke`
);
pruefe(vorschau.includes('8 × 6 m'), 'und die Masse in METERN — 4 x 3 Zellen sind 8 x 6 m');

// Und sie erneuert sich, OHNE die Leiste neu aufzubauen. Das ist keine
// Sparsamkeit: `baue()` wirft jedes Element weg und legt es neu an — an
// einem `oninput` hiesse das, dass das Feld nach jedem getippten Zeichen
// ein anderes ist und die Schreibmarke keinen Halt hat. Man könnte genau
// eine Ziffer eintippen. Gemessen an der IDENTITÄT des Feldes, weil ein
// Stummel keinen Fokus kennt und der Fehler sonst erst im Browser auffiele.
const feldVorher = mit.behaelter.alle().filter((k) => k.type === 'number')[0];
setze(mit, '6', '5', '2', '0.5');
const feldNachher = mit.behaelter.alle().filter((k) => k.type === 'number')[0];
pruefe(feldVorher === feldNachher, 'das Eingabefeld überlebt die Eingabe — kein Neuaufbau');
pruefe(
  mit.behaelter.text().includes(moduleRegistry.modulName(6, 5, 2)),
  'die Vorschau ist trotzdem auf dem neuen Stand',
  moduleRegistry.modulName(6, 5, 2)
);

// ── 6. Der Deckel greift VOR dem Paket ──────────────────────────────
console.log('\nDreiecksdeckel:');
const gross = seiteMit(true);
setze(gross, '8', '8', '2', '0.5');
const tris8 = moduleRegistry.dreiecke(8, 8, 2);
pruefe(tris8 === 14_076, '8x8 bei Raster 2 sind 14 076 Dreiecke', String(tris8));
const bauKnopf = knopfNamens(gross.behaelter, 'Saal bauen')!;
pruefe(bauKnopf.disabled === true, 'der Knopf ist gesperrt');
pruefe(
  gross.behaelter.text().includes(String(moduleRegistry.DREIECKS_DECKEL)),
  'und der Grund steht daneben — der Deckel wird beim Namen genannt'
);
bauKnopf.onclick?.();
await new Promise((r) => setTimeout(r, 0));
pruefe(gross.auftraege.length === 0, 'ein Klick darauf schickt NICHTS');

// Dieselbe Klemme, andere Ursache: 9 Zellen gibt es nicht.
setze(gross, '9', '3', '2', '0.5');
pruefe(
  gross.behaelter.text().includes('2…8'),
  'ausserhalb 2…8 nennt das Formular denselben Bereich wie der Server'
);
pruefe(knopfNamens(gross.behaelter, 'Saal bauen')!.disabled === true, 'auch dann gesperrt');

// ── 7. Der Klick schickt genau vier Zahlen ──────────────────────────
console.log('\nBauauftrag:');
antwortStub = {
  ok: true,
  message: 'Gebaut: Gen_StoneVaultHall4x3 — 2364 Dreiecke, 8 x 6 m',
  info: { name: 'Gen_StoneVaultHall4x3', tris: 2364, sizeX: 8, sizeY: 3.5, sizeZ: 6 },
};
setze(mit, '4', '3', '2', '0.5');
knopfNamens(mit.behaelter, 'Saal bauen')!.onclick?.();
await new Promise((r) => setTimeout(r, 0));
await new Promise((r) => setTimeout(r, 0));
pruefe(mit.auftraege.length === 1, 'genau ein Auftrag ging hinaus', String(mit.auftraege.length));
const auftrag = mit.auftraege[0];
pruefe(
  auftrag?.cellsX === 4 && auftrag?.cellsZ === 3 && auftrag?.raster === 2 && auftrag?.weight === 0.5,
  'mit genau den vier eingetippten Zahlen',
  JSON.stringify(auftrag)
);

// ── 8. Die Antwort zeigt Zahlen UND die beiden Wege dahinter ────────
const nachher = mit.behaelter.text();
pruefe(nachher.includes('2364'), 'die Antwort nennt die Dreiecke');
pruefe(nachher.includes('8 x 6') || nachher.includes('8 × 6'), 'und die Masse');
pruefe(nachher.includes('Seite neu laden'), 'sie sagt „Seite neu laden"');
pruefe(
  nachher.includes('wov-update.sh --assets'),
  'und dass live erst nach wov-update.sh --assets folgt'
);

// ── 9. Eine Absage wird gezeigt, nicht verschluckt ──────────────────
console.log('\nAbsage:');
antwortStub = { ok: false, message: 'Modulbau ist auf diesem Server nicht eingeschaltet.' };
const absage = seiteMit(true);
setze(absage, '4', '3', '2', '0.5');
knopfNamens(absage.behaelter, 'Saal bauen')!.onclick?.();
await new Promise((r) => setTimeout(r, 0));
await new Promise((r) => setTimeout(r, 0));
pruefe(
  absage.behaelter.text().includes('nicht eingeschaltet'),
  'die Meldung des Servers steht wörtlich in der Leiste'
);
pruefe(
  !absage.behaelter.text().includes('Seite neu laden'),
  'und die Hinweise zum Nachladen stehen NICHT da — es liegt nichts zum Laden bereit'
);

console.log(fehler === 0 ? '\nAlle Prüfungen bestanden.' : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
process.exit(fehler === 0 ? 0 : 1);
