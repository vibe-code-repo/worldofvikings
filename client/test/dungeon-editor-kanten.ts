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
  ausrichtungsOptionen,
  computeOpenConnections,
  kantenName,
  sanitizeDungeonDocument,
} from '@wov/shared';

// ── DOM-Stummel, VOR dem Import des Grundrisses gesetzt ──────────────
interface StummelKnoten {
  style: { cssText: string };
  width: number;
  height: number;
  addEventListener(): void;
  appendChild(): void;
  getContext(): null;
}
function stummelKnoten(): StummelKnoten {
  return {
    style: { cssText: '' },
    width: 0,
    height: 0,
    addEventListener: () => undefined,
    appendChild: () => undefined,
    getContext: () => null,
  };
}
const g = globalThis as unknown as Record<string, unknown>;
g.document = { createElement: () => stummelKnoten() };
g.window = { addEventListener: () => undefined, devicePixelRatio: 1 };

const { DungeonGrundriss, ebeneVon, rasterVonBasis, zeichenHuelle } = await import(
  '../src/editor/DungeonGrundriss'
);
const { neuesDungeonDokument, waehlbareBasen } = await import('../src/editor/DungeonNeuesDokument');

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

console.log(fehler === 0 ? '\nAlles grün.' : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
process.exit(fehler > 0 ? 1 : 0);
