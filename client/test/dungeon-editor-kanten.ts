/**
 * Der Editor-Weg des Modul-Kits: Ausrichtung, Zeichenhülle, neues Dokument.
 *
 * Drei Dinge sind hier zusammen, weil sie EINEN Arbeitsgang bilden — Mike
 * legt ein leeres Grab an, sieht die Zellen im Grundriss und fügt in eine
 * gewählte Richtung an. Jedes Stück davon hat seine eigene stille
 * Fehlerart:
 *
 *  1. `kantenName`/`ausrichtungsOptionen` (shared) — die Liste, aus der
 *     beide Editoren ihre Kanten anbieten. Sie muss auf den Connector-TYP
 *     filtern: `attachRoom` weist einen Index mit falschem Typ ab, und ein
 *     Angebot, das erst beim Klick scheitert, ist schlechter als keines.
 *  2. `DungeonGrundriss.fuegeAn(..., kanteIndex)` — die DURCHREICHUNG des
 *     fünften `attachRoom`-Parameters. Sie ist die Art Draht, die man
 *     nicht sieht: Ohne sie meldet der Editor „angefügt", und der Raum
 *     zeigt in die falsche Richtung. Geprüft wird wie in
 *     `server/test/m4-hand-bauen.ts` — Index 0 und 1 müssen zu
 *     UNTERSCHIEDLICHEN Drehungen führen.
 *  3. `zeichenHuelle`/`ebeneVon`/`neuesDungeonDokument` — die reine
 *     Rechnung hinter Grundriss und Formular.
 *
 * ── Warum ein DOM-Stummel und nicht „nur die Logik" ─────────────────
 * `DungeonGrundriss` legt im Konstruktor eine Canvas an und hängt sie in
 * den Viewport. Prüfte man nur `attachRoom`, prüfte man `dungeonGenerator.ts`
 * — die Datei, die hier gar nicht geändert wurde — und nicht die eine
 * Zeile, um die es geht. Der Stummel unten ist deshalb absichtlich das
 * Mindeste: `getContext` gibt `null` zurück, `zeichne()` steigt dort
 * sofort aus, und gemessen wird allein, was `fuegeAn` mit dem Layout tut.
 * Ein echtes jsdom benutzt in `client/test/` bisher nichts.
 *
 * Lauf: npx tsx client/test/dungeon-editor-kanten.ts   (aus dem Repo-Wurzelverzeichnis)
 */
import {
  DUNGEONS_BY_NAME,
  STEIN_TEXTUREN,
  anbaubareKanten,
  ausrichtungsOptionen,
  computeOpenConnections,
  kantenName,
  sanitizeDungeonDocument,
} from '@wov/shared';

// ── DOM-Stummel, VOR dem Import des Grundrisses gesetzt ──────────────
//
// Er kann seit der Prüfung der Seitenleiste (Abschnitt 8) etwas mehr als
// nur „nichts tun": Kinder, `textContent`, `value` und die drei
// Ereignisfelder, die `DungeonKatalog.ts` benutzt. Das ist immer noch
// kein jsdom — es gibt kein Layout, keine Ereignisausbreitung und keine
// Attribute. Es ist genau so viel Browser, wie nötig ist, um einen
// Regler zu FINDEN und ihn anzustossen; alles darüber hinaus wäre ein
// zweiter Browser, den niemand pflegt.
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
  /** Für das Häkchen „beim Speichern schließen". */
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

  /** Wie im Browser: Text setzen wirft die Kinder weg. */
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
  /** Alle Knoten im Teilbaum — die Suchhilfe der Prüfungen unten. */
  alle(): StummelKnoten[] {
    return this.kinder.flatMap((k) => [k, ...k.alle()]);
  }
}
const g = globalThis as unknown as Record<string, unknown>;
g.document = { createElement: (tag: string) => new StummelKnoten(tag) };
g.window = { addEventListener: () => undefined, devicePixelRatio: 1 };

const { DungeonGrundriss, ebeneVon, rasterVonBasis, zeichenHuelle } = await import(
  '../src/editor/DungeonGrundriss'
);
const { neuesDungeonDokument, waehlbareBasen } = await import('../src/editor/DungeonNeuesDokument');
const { DungeonSeite } = await import('../src/editor/DungeonKatalog');

let fehler = 0;
function pruefe(bedingung: boolean, was: string, zusatz = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${was}${zusatz ? ` — ${zusatz}` : ''}`);
}

const KIT = 'DG_StoneVault';
const def = DUNGEONS_BY_NAME.get(KIT)!;
const raum = (name: string) => def.rooms.find((r) => r.name === name)!;
const TYP = raum('StoneVaultCorridor').connections[0]!.type;

// ── 1. Kantennamen ──────────────────────────────────────────────────
pruefe(kantenName({ x: 0, z: 1 }, 0) === 'Nord', 'kantenName +z heisst Nord');
pruefe(kantenName({ x: 0, z: -3 }, 1) === 'Süd', 'kantenName −z heisst Süd');
pruefe(kantenName({ x: 2, z: 1 }, 2) === 'Ost', 'kantenName: dominante Achse gewinnt');
pruefe(kantenName({ x: -1, z: 0 }, 3) === 'West', 'kantenName −x heisst West');
pruefe(
  kantenName({ x: 0, z: 0 }, 7) === 'Kante 7',
  'kantenName ohne dominante Achse nennt den Index'
);

// ── 2. Optionsliste ─────────────────────────────────────────────────
const gangOptionen = ausrichtungsOptionen(raum('StoneVaultCorridor'), TYP);
pruefe(gangOptionen.length === 2, 'Korridor bietet zwei Kanten', `${gangOptionen.length}`);
pruefe(
  gangOptionen.map((o) => o.beschriftung).join(' | ') === 'Nord #0 | Süd #1',
  'Korridor-Beschriftungen tragen den Index',
  gangOptionen.map((o) => o.beschriftung).join(' | ')
);
pruefe(
  ausrichtungsOptionen(raum('StoneVaultCorridor'), 'gibtEsNicht').length === 0,
  'fremder Connector-Typ ergibt keine Option'
);
pruefe(
  ausrichtungsOptionen(raum('StoneVaultCorridor'), undefined).length === 0,
  'ohne offenen Connector wird nichts angeboten'
);
pruefe(ausrichtungsOptionen(undefined, TYP).length === 0, 'ohne Raum wird nichts angeboten');
pruefe(
  ausrichtungsOptionen(raum('StoneVaultJunction'), TYP).length ===
    raum('StoneVaultJunction').connections.length,
  'Kreuzung bietet alle ihre Kanten an'
);

// ── 3. Zeichenhülle: Innenmass ist nicht Zellmass ───────────────────
const RASTER = rasterVonBasis(KIT);
pruefe(RASTER === 2, 'StoneVault wird im 2-m-Raster gezeichnet', String(RASTER));
pruefe(rasterVonBasis('DG_Steingrab') === 4, 'Steingrab bleibt im 4-m-Raster');
const gangHuelle = zeichenHuelle(raum('StoneVaultCorridor'), RASTER);
pruefe(
  Math.abs(gangHuelle.x - 2) < 1e-9 && Math.abs(gangHuelle.z - 2) < 1e-9,
  'Korridor wird als volle 2-m-Zelle gezeichnet',
  `${gangHuelle.x} × ${gangHuelle.z}`
);
const treppenHuelle = zeichenHuelle(raum('StoneVaultStairs'), RASTER);
pruefe(
  Math.abs(treppenHuelle.x - 2) < 1e-9 && Math.abs(treppenHuelle.z - 6) < 1e-9,
  'Treppe: x auf 2 korrigiert, z bleibt 6',
  `${treppenHuelle.x} × ${treppenHuelle.z}`
);
const halleHuelle = zeichenHuelle(raum('StoneVaultHall'), RASTER);
pruefe(
  halleHuelle.x === raum('StoneVaultHall').size.x && halleHuelle.z === raum('StoneVaultHall').size.z,
  'Halle bleibt unangetastet (kein Innenmass)'
);
const wandHuelle = zeichenHuelle(raum('StoneVaultWall'), RASTER);
pruefe(
  Math.abs(wandHuelle.z - 0.3) < 1e-9,
  'Wandabschluss behält seine 0,3 m — er ist kein Innenmass-Fall',
  String(wandHuelle.z)
);

// ── 4. Ebenen ───────────────────────────────────────────────────────
pruefe(ebeneVon(3.5) === 3.5, 'Ebene 3,5 wird nicht auf 4 gerundet', String(ebeneVon(3.5)));
pruefe(ebeneVon(-0.0000001) === 0, 'Fliesskomma-Rauschen landet auf Ebene 0');

// ── 5. Neues Dokument ───────────────────────────────────────────────
const basen = waehlbareBasen();
pruefe(basen[0]?.name === 'DG_StoneVault', 'eigenes Modulkit steht vorn', basen[0]?.name);
pruefe(basen[1]?.name === 'DG_Steingrab', 'Steingrab steht auf Platz zwei', basen[1]?.name);
pruefe(
  !basen.some((d) => d.name === 'DG_Hildir_PlainsFortress'),
  'die nicht instanzierbare Plains-Festung fehlt'
);

const schlecht = neuesDungeonDokument({ id: 'Nicht Erlaubt!', base: KIT });
pruefe(!schlecht.ok, 'unbrauchbare ID wird abgelehnt', schlecht.ok ? '' : schlecht.grund);
const fremd = neuesDungeonDokument({ id: 'test-vault', base: 'DG_GibtEsNicht' });
pruefe(!fremd.ok, 'unbekannte Basis wird abgelehnt');

const neu = neuesDungeonDokument({ id: 'Test-Vault', base: KIT, seed: 7 });
if (!neu.ok) {
  console.log(`FAIL neues Dokument: ${neu.grund}`);
  process.exit(1);
}
const frisch = neu.doc;
pruefe(frisch.id === 'test-vault', 'ID wird kleingeschrieben', frisch.id);
pruefe(frisch.mode === 'custom', 'neues Dokument ist von Hand gebaut, nicht generiert');
pruefe(frisch.layout.rooms.length === 1, 'nur der Eingangsraum steht', `${frisch.layout.rooms.length}`);
pruefe(
  raum(frisch.layout.rooms[0]!.room).entrance === true,
  'und dieser eine Raum ist der Eingang',
  frisch.layout.rooms[0]!.room
);
const offenNeu = computeOpenConnections(frisch.layout, KIT);
pruefe(
  offenNeu.length === raum(frisch.layout.rooms[0]!.room).connections.length,
  'alle Kanten des Eingangs sind sofort offen',
  `${offenNeu.length}`
);
// Der Weg, den das Dokument beim Speichern nimmt: Was der Sanitizer
// verwirft, wäre im Grundriss zu sehen und nach dem Speichern weg.
const sauber = sanitizeDungeonDocument(JSON.parse(JSON.stringify(frisch)));
pruefe(sauber !== null, 'neues Dokument überlebt den Sanitizer');
pruefe(
  sauber !== null && sauber.layout.rooms.length === frisch.layout.rooms.length,
  'der Sanitizer verwirft keinen Raum'
);

// ── 6. Die Durchreichung: fuegeAn mit kanteIndex ────────────────────
function grundrissMit(dok: typeof frisch): InstanceType<typeof DungeonGrundriss> {
  const viewport = { appendChild: () => undefined, clientWidth: 800, clientHeight: 600 };
  const gr = new DungeonGrundriss(viewport as unknown as HTMLElement, {
    meldung: () => undefined,
    auswahlGeaendert: () => undefined,
  });
  gr.setzeDokument(dok);
  return gr;
}
function angefuegt(kante: number | undefined, name = 'StoneVaultCorridor') {
  const dok = JSON.parse(JSON.stringify(frisch)) as typeof frisch;
  const gr = grundrissMit(dok);
  const ok = gr.fuegeAn(0, name, kante);
  return { ok, dok, gr };
}

const a = angefuegt(0);
const b = angefuegt(1);
pruefe(a.ok && b.ok, 'beide Ausrichtungen fügen an');
const rotA = a.dok.layout.rooms[1]!.rot;
const rotB = b.dok.layout.rooms[1]!.rot;
pruefe(
  Math.abs(rotA.y - rotB.y) > 1e-6 || Math.abs(rotA.w - rotB.w) > 1e-6,
  'kanteIndex 0 und 1 ergeben UNTERSCHIEDLICHE Drehungen',
  `0: (y ${rotA.y.toFixed(3)}, w ${rotA.w.toFixed(3)}) · 1: (y ${rotB.y.toFixed(3)}, w ${rotB.w.toFixed(3)})`
);
const auto = angefuegt(undefined);
const rotAuto = auto.dok.layout.rooms[1]!.rot;
pruefe(
  Math.abs(rotAuto.y - rotA.y) < 1e-9 && Math.abs(rotAuto.w - rotA.w) < 1e-9,
  '„automatisch" bleibt beim ersten kollisionsfreien Connector (Index 0)'
);
// Ein Index mit falschem Typ ist ein FEHLER, keine stille Rückkehr zum
// alten Verhalten — sonst baute der Editor woanders weiter, als er sagt.
pruefe(!angefuegt(99).ok, 'ein Index, den es nicht gibt, fügt nichts an');

// ── 7. Ebenen mit der Treppe ────────────────────────────────────────
const mitTreppe = angefuegt(0, 'StoneVaultStairs');
pruefe(mitTreppe.ok, 'Treppe lässt sich anfügen');
const treppenEbenen = mitTreppe.gr.ebenen;
pruefe(
  treppenEbenen.includes(0) && treppenEbenen.includes(3.5),
  'der obere Treppenausgang bringt Ebene 3,5 in den Filter',
  treppenEbenen.join(', ')
);
const obereOffen = computeOpenConnections(mitTreppe.dok.layout, KIT).filter(
  (c) => ebeneVon(c.pos.y) === 3.5
);
pruefe(obereOffen.length === 1, 'genau ein offener Connector liegt auf 3,5', `${obereOffen.length}`);
pruefe(
  mitTreppe.dok.layout.rooms.every((r) => ebeneVon(r.pos.y) === 0),
  'dabei steht jeder RAUM noch auf 0 — nach dem Raum sortiert wäre der Ausgang unsichtbar'
);

// ── 8. Seitenleiste: Grundbeleuchtung und Steinmaterial ─────────────
//
// Gemessen wird, was die Bedienelemente INS DOKUMENT schreiben — nicht,
// dass sie dastehen. Der Unterschied ist der ganze Test: Ein Regler ohne
// `oninput` sieht auf einem Bildschirmfoto genauso aus wie einer mit,
// und „gespeichert" stünde trotzdem in der Meldung.
//
// Warum das Löschen eine eigene Prüfung hat: `ambientLicht` FEHLEN zu
// lassen heisst „Umgebung unverändert" und ist ausdrücklich etwas
// anderes als eine eingetragene 1 (s. `dungeons.ts`). Ein „Vorgabe",
// das in Wahrheit 1 schreibt, fiele sonst nie auf.
console.log('\nSeitenleiste:');
const behaelter = new StummelKnoten('div');
const seiteDoc = JSON.parse(JSON.stringify(frisch)) as typeof frisch;
const seite = new DungeonSeite(
  behaelter as unknown as HTMLElement,
  grundrissMit(seiteDoc),
  { meldung: () => undefined }
);
seite.baue();

const suche = {
  regler: () => behaelter.alle().find((k) => k.type === 'range'),
  vorgabe: () =>
    behaelter.alle().find((k) => k.tag === 'button' && k.textContent === 'Vorgabe'),
  // Die drei Flächen-Auswahlen erkennt man an ihrem ersten Eintrag: Nur
  // sie bieten „Kit-Vorgabe" an.
  steinWahlen: () =>
    behaelter
      .alle()
      .filter((k) => k.tag === 'select' && k.kinder.some((o) => o.textContent === 'Kit-Vorgabe')),
  zahlen: () => behaelter.alle().filter((k) => k.type === 'number'),
};

const regler = suche.regler();
pruefe(regler !== undefined, 'die Leiste hat einen Regler');
pruefe(regler?.max === '3' && regler?.step === '0.05', 'Bereich 0..3 in Schritten von 0,05',
  `${regler?.min}..${regler?.max} / ${regler?.step}`);
pruefe(regler?.value === '1', 'Vorgabe 1, solange das Feld fehlt', regler?.value);
pruefe(
  seiteDoc.ambientLicht === undefined,
  'und der blosse Aufbau schreibt das Feld NICHT ins Dokument'
);

regler!.value = '0.35';
regler!.oninput!();
pruefe(seiteDoc.ambientLicht === 0.35, 'der Regler schreibt doc.ambientLicht', String(seiteDoc.ambientLicht));

// Beim nächsten Aufbau muss der Wert AUS DEM DOKUMENT zurückkommen —
// sonst stünde die Leiste nach jeder anderen Aktion wieder auf 1.
seite.baue();
pruefe(suche.regler()?.value === '0.35', 'nach dem Neuaufbau steht der Wert im Regler',
  suche.regler()?.value);

// 0 ist ein GÜLTIGER Wert (stockdunkel) und darf nicht als „nicht
// gesetzt" verschwinden.
const reglerNull = suche.regler()!;
reglerNull.value = '0';
reglerNull.oninput!();
pruefe(seiteDoc.ambientLicht === 0, 'die 0 überlebt als Wert', String(seiteDoc.ambientLicht));

suche.vorgabe()!.onclick!();
pruefe(!('ambientLicht' in seiteDoc), '„Vorgabe" LÖSCHT das Feld, statt 1 zu schreiben');
pruefe(suche.regler()?.value === '1', 'und der Regler zeigt danach wieder 1');

// ── Steinmaterial ───────────────────────────────────────────────────
const wahlen = suche.steinWahlen();
pruefe(wahlen.length === 3, 'drei Flächen zur Wahl (Wand/Decke/Boden)', `${wahlen.length}`);
pruefe(
  wahlen[0]!.kinder.length === STEIN_TEXTUREN.length + 1,
  'jede bietet die Erlaubnisliste plus „Kit-Vorgabe"',
  `${wahlen[0]!.kinder.length}`
);
pruefe(
  wahlen[0]!.kinder[1]!.textContent === 'stein_clean',
  'angezeigt wird der blosse Dateiname',
  wahlen[0]!.kinder[1]!.textContent
);

wahlen[0]!.value = '/assets/models/stein_moos.png';
wahlen[0]!.onchange!();
pruefe(
  JSON.stringify(seiteDoc.steinKit) === '{"wandTextur":"/assets/models/stein_moos.png"}',
  'die Wand-Auswahl schreibt NUR ihr eigenes Feld',
  JSON.stringify(seiteDoc.steinKit)
);
pruefe(
  suche.steinWahlen()[0]!.value === '/assets/models/stein_moos.png',
  'und sie steht beim Neuaufbau vorbelegt da'
);

const zahlen = suche.zahlen();
pruefe(zahlen.length === 3, 'drei Verwitterungszahlen', `${zahlen.length}`);
pruefe(zahlen.every((z) => z.value === ''), 'ungesetzt heisst leer, nicht 0');
zahlen[0]!.value = '1.5';
zahlen[0]!.onchange!();
pruefe(
  seiteDoc.steinKit?.verwitterung?.moos === 1.5 &&
    seiteDoc.steinKit?.verwitterung?.frost === undefined,
  'nur das gefüllte Verwitterungsfeld landet im Dokument',
  JSON.stringify(seiteDoc.steinKit?.verwitterung)
);
pruefe(suche.zahlen()[0]!.value === '1.5', 'auch die Zahl kommt vorbelegt zurück');

// Leeren nimmt den Schlüssel wieder heraus — und wenn das letzte Feld
// geht, muss `steinKit` GANZ verschwinden: Ein `steinKit: {}` wäre kein
// leeres Feld, sondern ein gesetztes ohne Inhalt.
const zahlLeeren = suche.zahlen()[0]!;
zahlLeeren.value = '';
zahlLeeren.onchange!();
pruefe(
  seiteDoc.steinKit?.verwitterung === undefined,
  'leeres Feld nimmt den Schlüssel heraus',
  JSON.stringify(seiteDoc.steinKit)
);
const wandZurueck = suche.steinWahlen()[0]!;
wandZurueck.value = '';
wandZurueck.onchange!();
pruefe(!('steinKit' in seiteDoc), '„Kit-Vorgabe" auf der letzten Fläche löscht steinKit ganz',
  JSON.stringify(seiteDoc.steinKit));

// Und die Gegenprobe zum Vorbelegen: ein Dokument, das die Werte schon
// mitbringt, zeigt sie ohne einen einzigen Klick.
const vorbelegt = JSON.parse(JSON.stringify(frisch)) as typeof frisch;
vorbelegt.ambientLicht = 2.5;
vorbelegt.steinKit = {
  bodenTextur: '/assets/models/stein_frost.png',
  verwitterung: { moos: 0, frost: 3, nass: 0.5 },
};
const behaelter2 = new StummelKnoten('div');
const seite2 = new DungeonSeite(
  behaelter2 as unknown as HTMLElement,
  grundrissMit(vorbelegt),
  { meldung: () => undefined }
);
seite2.baue();
pruefe(
  behaelter2.alle().find((k) => k.type === 'range')?.value === '2.5',
  'ein geöffnetes Dokument bringt seinen Lichtwert mit'
);
const wahlen2 = behaelter2
  .alle()
  .filter((k) => k.tag === 'select' && k.kinder.some((o) => o.textContent === 'Kit-Vorgabe'));
pruefe(
  wahlen2[2]?.value === '/assets/models/stein_frost.png' && wahlen2[0]?.value === '',
  'der Boden steht auf Frost, Wand und Decke auf Kit-Vorgabe',
  `${wahlen2[0]?.value} | ${wahlen2[1]?.value} | ${wahlen2[2]?.value}`
);
pruefe(
  behaelter2
    .alle()
    .filter((k) => k.type === 'number')
    .map((z) => z.value)
    .join(',') === '0,3,0.5',
  'und die Verwitterung steht in den Zahlenfeldern'
);

// ── 9. Kanten schliessen: Knopf und Schalter ────────────────────────
//
// Die Rechnung selbst steht in `shared/test/dungeon-kanten-schliessen.ts`.
// Hier wird die VERDRAHTUNG gemessen — dieselbe Sorte Draht wie bei
// `fuegeAn` in Abschnitt 6: Ein Knopf ohne `onclick` sieht auf einem
// Bildschirmfoto genauso aus wie einer mit, und die Wände fehlten
// trotzdem. Und der Schalter beim Speichern ist die stillste Stelle von
// allen: Wenn er nicht zieht, meldet der Editor „gespeichert" und das
// Dokument hat im Spiel Löcher.
console.log('\nKanten schließen:');

let letzteMeldung = '';
function seiteMit(dok: typeof frisch): {
  seite: InstanceType<typeof DungeonSeite>;
  behaelter: StummelKnoten;
} {
  const behaelter = new StummelKnoten('div');
  const seite = new DungeonSeite(behaelter as unknown as HTMLElement, grundrissMit(dok), {
    meldung: (t: string) => {
      letzteMeldung = t;
    },
  });
  seite.baue();
  return { seite, behaelter };
}
const knopfNamens = (b: StummelKnoten, text: string): StummelKnoten | undefined =>
  b.alle().find((k) => k.tag === 'button' && k.textContent === text);

const kantenDoc = JSON.parse(JSON.stringify(frisch)) as typeof frisch;
const kanten = seiteMit(kantenDoc);
const schliessKnopf = knopfNamens(kanten.behaelter, 'Kanten schließen');
pruefe(schliessKnopf !== undefined, 'die Aktionen-Zeile hat einen Knopf „Kanten schließen"');
pruefe(kantenDoc.layout.rooms.length === 1, 'vor dem Klick steht nur der Eingang');
schliessKnopf!.onclick!();
pruefe(
  kantenDoc.layout.rooms.length === 5,
  'der Klick setzt vier Wände (die Eingangskante gehört seit dem 04.09.2026 dazu)',
  `${kantenDoc.layout.rooms.length}`
);
pruefe(letzteMeldung === '4 Wände gesetzt', 'und meldet, wie viele es waren', letzteMeldung);
pruefe(
  computeOpenConnections(kantenDoc.layout, KIT).length === 0,
  'keine Kante bleibt offen — auch der Eingang nicht',
  `${computeOpenConnections(kantenDoc.layout, KIT).length}`
);
// Der Weg zum Weiterbauen: eine Wand entfernen gibt ihre Kante frei.
// Ohne diese Gegenprobe wäre „Kanten schließen" eine Einbahnstrasse, und
// genau das behauptet der Hinweistext in der Leiste NICHT.
const nachEntfernen = grundrissMit(kantenDoc);
pruefe(nachEntfernen.entferne(1), 'eine gesetzte Wand lässt sich wieder entfernen');
pruefe(
  computeOpenConnections(kantenDoc.layout, KIT).length === 1,
  'danach ist ihre Kante wieder offen',
  `${computeOpenConnections(kantenDoc.layout, KIT).length}`
);

// Der Schalter: Vorgabe AN, Zustand an der Klasse (nicht im Element, das
// `baue()` wegwirft).
const schalterDoc = JSON.parse(JSON.stringify(frisch)) as typeof frisch;
const mitSchalter = seiteMit(schalterDoc);
// Über die BESCHRIFTUNG suchen, nicht über „das erste Häkchen in der
// Leiste": Seit „Neu anlegen" ein eigenes Häkchen hat („voll generieren",
// und das steht weiter oben), holte die erste Fassung dieser Zeile den
// falschen Schalter — und prüfte dann seine Vorgabe statt der hier
// gemeinten. Der Prüfgegenstand ist unverändert.
const haekchen = (
  b: StummelKnoten,
  beschriftung = 'beim Speichern schließen'
): StummelKnoten | undefined =>
  b
    .alle()
    .find((k) => k.tag === 'label' && k.alle().some((c) => c.textContent === beschriftung))
    ?.alle()
    .find((k) => k.type === 'checkbox');
pruefe(haekchen(mitSchalter.behaelter) !== undefined, 'es gibt ein Häkchen');
pruefe(haekchen(mitSchalter.behaelter)?.checked === true, 'Vorgabe: beim Speichern schließen');

// Der Speicherweg bis zur Netzverbindung: `speichereDungeon` braucht
// `location` und einen laufenden Spielserver, beides gibt es hier nicht —
// der Aufruf endet in einem Fehler. Das MACHT NICHTS und ist der Punkt:
// Zugemauert wird VOR dem Absenden, und genau diese Reihenfolge ist der
// Prüfgegenstand. Wäre sie andersherum, stünden die Wände im Grundriss und
// nicht in der Datei.
const mitPrivat = mitSchalter.seite as unknown as { speichere(doc: unknown): Promise<void> };
await mitPrivat.speichere(schalterDoc).catch(() => undefined);
pruefe(
  schalterDoc.layout.rooms.length === 5,
  'Speichern mit gesetztem Häkchen mauert vorher zu',
  `${schalterDoc.layout.rooms.length}`
);

const ohneDoc = JSON.parse(JSON.stringify(frisch)) as typeof frisch;
const ohneSchalter = seiteMit(ohneDoc);
const box = haekchen(ohneSchalter.behaelter)!;
box.checked = false;
box.onchange!();
const ohnePrivat = ohneSchalter.seite as unknown as { speichere(doc: unknown): Promise<void> };
await ohnePrivat.speichere(ohneDoc).catch(() => undefined);
pruefe(
  ohneDoc.layout.rooms.length === 1,
  'ohne Häkchen bleibt das Dokument offen — der Zwischenstand',
  `${ohneDoc.layout.rooms.length}`
);
// Und der abgeschaltete Zustand überlebt den nächsten Aufbau der Leiste:
// Er steht an der Klasse, nicht im weggeworfenen Element.
ohneSchalter.seite.baue();
pruefe(
  haekchen(ohneSchalter.behaelter)?.checked === false,
  'das ausgeschaltete Häkchen kommt ausgeschaltet zurück'
);

// ── 10. Flüssiges Bauen: Wandkanten anbieten, Wand ersetzen ─────────
//
// Die Rechnung steht in `shared/test/dungeon-kanten-schliessen.ts`. Hier
// wird wieder die VERDRAHTUNG gemessen — dieselbe Sorte Draht wie in
// Abschnitt 6: Bietet die Anfügen-Liste die zugemauerten Kanten überhaupt
// an, und reisst ein Klick auf „Anfügen" die richtige Wand weg? Ein
// Auswahlfeld, das die Kanten zwar zeigt, aber `attachRoom` statt
// `fuegeAnKante` ruft, sähe auf einem Bildschirmfoto genauso aus und
// meldete „Kollision".
console.log('\nFlüssiges Bauen:');

/**
 * Ein Grundriss, dessen Meldungen hier ankommen — `grundrissMit` schluckt
 * sie. Ohne das prüfte der Satz „Wand ersetzt" weiter unten den Text der
 * SEITENLEISTE, und der kommt beim Anfügen gar nicht vorbei.
 */
function grundrissMitMeldung(dok: typeof frisch): InstanceType<typeof DungeonGrundriss> {
  const viewport = { appendChild: () => undefined, clientWidth: 800, clientHeight: 600 };
  const gr = new DungeonGrundriss(viewport as unknown as HTMLElement, {
    meldung: (t: string) => {
      letzteMeldung = t;
    },
    auswahlGeaendert: () => undefined,
  });
  gr.setzeDokument(dok);
  return gr;
}

/** Wie `seiteMit`, aber an einem schon gebauten Grundriss. */
function seiteMit2(
  gr: InstanceType<typeof DungeonGrundriss>
): { seite: InstanceType<typeof DungeonSeite>; behaelter: StummelKnoten } {
  const behaelter = new StummelKnoten('div');
  const seite = new DungeonSeite(behaelter as unknown as HTMLElement, gr, {
    meldung: (t: string) => {
      letzteMeldung = t;
    },
  });
  seite.baue();
  return { seite, behaelter };
}

const wandDoc = JSON.parse(JSON.stringify(frisch)) as typeof frisch;
const wandGrundriss = grundrissMitMeldung(wandDoc);
wandGrundriss.schliesseKanten();
pruefe(wandDoc.layout.rooms.length === 5, 'Ausgangslage: zugemauerter Eingangsraum',
  `${wandDoc.layout.rooms.length}`);
// Seit G9 zählt `offeneVerbindungen` LÖCHER und nicht mehr Connectors:
// Die Eingangskante ist mit Absicht offen (dort geht es hinaus), also ist
// sie kein Loch. Bis dahin stand hier eine 1 — und genau diese 1 las Mike
// am dichten Grab als „da fehlt was". Angeboten wurde sie schon vorher
// nicht; das prüft die Zeile darunter unverändert weiter.
pruefe(
  wandGrundriss.offeneVerbindungen.length === 0,
  'am dichten Grab meldet die Kopfzeile 0 offen — die Eingangskante zählt nicht mit',
  `${wandGrundriss.offeneVerbindungen.length}`
);
pruefe(
  wandGrundriss.anbaubare.length === 3,
  'anbaubar sind trotzdem drei Kanten',
  `${wandGrundriss.anbaubare.length}`
);

const wandSeite = seiteMit2(wandGrundriss);
const wandWahl = wandSeite.behaelter
  .alle()
  .find((k) => k.tag === 'select' && k.kinder.some((o) => o.textContent.endsWith('(Wand)')));
pruefe(wandWahl !== undefined, 'die Anfügen-Liste zeigt Kanten mit „(Wand)"');
pruefe(
  wandWahl?.kinder.every((o) => o.textContent.endsWith('(Wand)')) === true,
  'am dichten Grab tragen alle drei den Zusatz',
  wandWahl?.kinder.map((o) => o.textContent).join(' | ')
);
pruefe(
  !wandWahl?.kinder.some((o) => /#0\/0 \[/.test(o.textContent) && !o.textContent.endsWith('(Wand)')),
  'und die Eingangskante steht nicht als offener Eintrag darin'
);

// Der Klick: erste Kante wählen, Korridor anfügen. Danach muss GENAU EINE
// Wand gefallen und ein Korridor dazugekommen sein.
const zielIndex = 0;
const wandIndexVorher = wandGrundriss.anbaubare[zielIndex]!.wandIndex;
pruefe(wandIndexVorher !== undefined, 'die gewählte Kante trägt einen wandIndex',
  String(wandIndexVorher));
const wandRaumWahl = wandSeite.behaelter
  .alle()
  .find((k) => k.tag === 'select' && k.kinder.some((o) => /^StoneVaultCorridor /.test(o.textContent)))!;
wandWahl!.value = String(zielIndex);
wandRaumWahl.value = 'StoneVaultCorridor';
knopfNamens(wandSeite.behaelter, 'Anfügen')!.onclick!();

const istWand = (name: string): boolean => !!raum(name).endCap;
pruefe(
  wandDoc.layout.rooms.length === 5,
  'die Raumzahl bleibt bei fünf — eine Wand raus, ein Gang rein',
  `${wandDoc.layout.rooms.length}`
);
pruefe(
  wandDoc.layout.rooms.filter((r) => istWand(r.room)).length === 3,
  'genau eine Wand ist gefallen',
  `${wandDoc.layout.rooms.filter((r) => istWand(r.room)).length}`
);
pruefe(
  wandDoc.layout.rooms.some((r) => r.room === 'StoneVaultCorridor'),
  'und der Korridor steht im Layout'
);
pruefe(letzteMeldung.startsWith('Wand ersetzt, StoneVaultCorridor angefügt'),
  'die Meldung sagt, dass eine Wand ersetzt wurde', letzteMeldung);
pruefe(
  anbaubareKanten(wandDoc.layout, KIT).every(
    (k) => k.wandIndex === undefined || istWand(wandDoc.layout.rooms[k.wandIndex]!.room)
  ),
  'nach dem Ersetzen zeigt jeder wandIndex weiterhin auf eine Wand'
);

// Ein Fehlschlag lässt die Wand stehen: derselbe Klick mit einem Raum, der
// dort nicht hinpasst. Ohne die Kopie in `fuegeAnKante` hinterliesse jeder
// Fehlversuch ein Loch.
const heilDoc = JSON.parse(JSON.stringify(frisch)) as typeof frisch;
const heilGrundriss = grundrissMit(heilDoc);
heilGrundriss.schliesseKanten();
const raeumeVorher = JSON.stringify(heilDoc.layout.rooms);
pruefe(
  !heilGrundriss.fuegeAn(0, 'StoneVaultCorridor', 99),
  'ein unmöglicher Anbau meldet einen Fehler'
);
pruefe(
  JSON.stringify(heilDoc.layout.rooms) === raeumeVorher,
  'und lässt das Layout unverändert — die Wand steht noch'
);

// ── 11. „Anlegen & speichern" legt OFFEN ab ─────────────────────────
//
// Der Schalter „beim Speichern schließen" steht auf AN (Vorgabe), und das
// soll er auch: Ein gebautes Grab gehört dicht in die Datei. Beim ANLEGEN
// wäre dieselbe Regel aber der Schuss ins Knie — das frische Dokument käme
// zugemauert zurück, und der erste Arbeitsgang wäre, eine Wand
// abzureissen. Betreten kann es zu diesem Zeitpunkt niemand.
//
// Gemessen wird am DOKUMENT nach dem Aufruf, nicht an der Meldung:
// `speichereDungeon` braucht einen Spielserver, den es hier nicht gibt,
// und scheitert. Das macht nichts — zugemauert würde VOR dem Absenden.
console.log('\nAnlegen & speichern:');
const anlegeGrundriss = grundrissMit(JSON.parse(JSON.stringify(frisch)) as typeof frisch);
const anlegeSeite = new DungeonSeite(
  new StummelKnoten('div') as unknown as HTMLElement,
  anlegeGrundriss,
  { meldung: () => undefined }
);
const anlegePrivat = anlegeSeite as unknown as {
  neuId: string;
  neuBasis: string;
  beimSpeichernSchliessen: boolean;
  legeAn(): Promise<void>;
};
anlegePrivat.neuId = 'offen-probe';
anlegePrivat.neuBasis = KIT;
pruefe(anlegePrivat.beimSpeichernSchliessen === true, 'der Schalter steht auf AN');
await anlegePrivat.legeAn().catch(() => undefined);
pruefe(
  anlegeGrundriss.dokument?.id === 'offen-probe',
  'das neue Dokument liegt im Grundriss',
  anlegeGrundriss.dokument?.id
);
pruefe(
  anlegeGrundriss.dokument?.layout.rooms.length === 1,
  'und es ist OFFEN gespeichert worden — nur der Eingangsraum',
  `${anlegeGrundriss.dokument?.layout.rooms.length}`
);
pruefe(
  anlegeGrundriss.anbaubare.length === 3,
  'es lässt sich sofort in drei Richtungen anbauen',
  `${anlegeGrundriss.anbaubare.length}`
);

// ── 9. Voll generieren (ROT — Ziel B, noch nicht umgesetzt) ─────────
//
// VOR DER UMSETZUNG ROT: `neuesDungeonDokument` kennt `wunsch.voll`,
// `wunsch.maxRooms` und `wunsch.zoneSize` noch nicht (Annahme dieses
// Abschnitts) — jeder Aufruf unten liefert heute dasselbe leere
// Ein-Raum-Dokument wie Abschnitt 5, egal was übergeben wird. Erwartet
// wird nach der Umsetzung:
//  - `voll: true` lässt den Generator wirklich wachsen (mehrere Räume,
//    mehr als eine offene Kante ist dabei nicht garantiert — Abschlüsse
//    dürfen die letzten offenen Kanten zumauern).
//  - Derselbe Seed liefert zweimal dasselbe JSON-Layout (Determinismus).
//  - `voll: false`/fehlend bleibt wie Abschnitt 5: ein Raum.
//  - `maxRooms: 6` bremst das Wachstum spürbar gegenüber ungebremst.
//  - `zoneSize` landet sowohl in `doc.generatorEinstellungen.zoneSize`
//    als auch (informativ) in `doc.zoneSize`.
//  - `mode` ist bei `voll: true` `'generated'`, sonst `'custom'`.
//
// NACH DER UMSETZUNG GRÜN, ohne Änderung an diesem Abschnitt.
console.log('\nVoll generieren (Ziel B):');

type NeuWunschVoll = Parameters<typeof neuesDungeonDokument>[0] & {
  voll?: boolean;
  maxRooms?: number;
  zoneSize?: number;
};
const bauen = (w: NeuWunschVoll) => neuesDungeonDokument(w as Parameters<typeof neuesDungeonDokument>[0]);

const voll1 = bauen({ id: 'voll-probe-1', base: KIT, seed: 99, voll: true });
if (!voll1.ok) {
  console.log(`FAIL voll generieren: ${voll1.grund}`);
  fehler++;
} else {
  pruefe(
    voll1.doc.layout.rooms.length > 1,
    'voll:true erzeugt mehr als den Eingangsraum',
    `${voll1.doc.layout.rooms.length}`
  );
  pruefe(
    computeOpenConnections(voll1.doc.layout, KIT).length >= 0,
    'computeOpenConnections lässt sich auf das volle Layout anwenden'
  );
  pruefe(voll1.doc.mode === 'generated', 'voll:true ergibt mode generated', voll1.doc.mode);

  // Determinismus: derselbe Seed -> JSON-identisches Layout.
  const voll2 = bauen({ id: 'voll-probe-1', base: KIT, seed: 99, voll: true });
  pruefe(
    voll2.ok && JSON.stringify(voll2.doc.layout) === JSON.stringify(voll1.doc.layout),
    'derselbe Seed liefert byte-identisches Layout',
    voll2.ok ? '' : voll2.grund
  );
}

const nichtVoll = bauen({ id: 'nicht-voll-probe', base: KIT, seed: 99 });
pruefe(
  nichtVoll.ok && nichtVoll.doc.layout.rooms.length === 1,
  'voll:false/fehlend bleibt beim Ein-Raum-Dokument aus Abschnitt 5',
  nichtVoll.ok ? `${nichtVoll.doc.layout.rooms.length}` : nichtVoll.grund
);
pruefe(
  nichtVoll.ok && nichtVoll.doc.mode === 'custom',
  'voll:false/fehlend bleibt mode custom',
  nichtVoll.ok ? nichtVoll.doc.mode : nichtVoll.grund
);

// maxRooms-Override: deutlich weniger Wachstum als ungebremst.
const ungebremst = bauen({ id: 'max-probe-frei', base: KIT, seed: 4242, voll: true });
const gebremst = bauen({ id: 'max-probe-6', base: KIT, seed: 4242, voll: true, maxRooms: 6 });
pruefe(
  ungebremst.ok &&
    gebremst.ok &&
    gebremst.doc.layout.rooms.length < ungebremst.doc.layout.rooms.length,
  'maxRooms:6 bremst das Wachstum gegenüber ungebremst',
  ungebremst.ok && gebremst.ok
    ? `${gebremst.doc.layout.rooms.length} < ${ungebremst.doc.layout.rooms.length}?`
    : `${ungebremst.ok ? '' : ungebremst.grund} ${gebremst.ok ? '' : gebremst.grund}`
);

// zoneSize-Override landet im Dokument.
const zoneProbe = bauen({ id: 'zone-probe', base: KIT, seed: 5, voll: true, zoneSize: 24 });
pruefe(
  zoneProbe.ok && (zoneProbe.doc as unknown as { generatorEinstellungen?: { zoneSize?: number } }).generatorEinstellungen?.zoneSize === 24,
  'zoneSize-Override landet in doc.generatorEinstellungen.zoneSize',
  zoneProbe.ok
    ? JSON.stringify((zoneProbe.doc as unknown as { generatorEinstellungen?: unknown }).generatorEinstellungen)
    : zoneProbe.grund
);
pruefe(
  zoneProbe.ok && zoneProbe.doc.zoneSize === 24,
  'zoneSize-Override landet auch informativ in doc.zoneSize',
  zoneProbe.ok ? `${zoneProbe.doc.zoneSize}` : zoneProbe.grund
);

console.log(fehler === 0 ? '\nAlles grün.' : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
process.exit(fehler > 0 ? 1 : 0);
