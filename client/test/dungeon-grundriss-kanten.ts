/**
 * Connector-Treffertest im 1.0-Grundriss (ZIEL A, Punkt 4).
 *
 * ── Warum das hier und nicht erst in 3D ──────────────────────────────
 * Die 3D-Vorschau (`DungeonVorschau3d.ts`, s. `dungeon-vorschau3d.ts`)
 * braucht Marker-Meshes an jeder anbaubaren Kante — aber der 2D-Grundriss
 * zeichnet diese Marker SCHON (`zeichne()`, Abschnitt „Offene Connectors"),
 * nur ohne Treffertest: `waehleBei()` prüft heute ausschliesslich
 * Raum-Polygone (`imPolygon`, s. Kopfkommentar `DungeonGrundriss.ts`,
 * „waehleBei testet nur Raum-Polygone"). Ein Klick auf eine Kantenmarke
 * trifft deshalb heute IMMER daneben oder in den darunterliegenden Raum —
 * das ist der stille Fehler, den dieser Test rot hält, bis Kanten VOR
 * Räumen geprüft werden.
 *
 * ── Was geprüft wird ──────────────────────────────────────────────────
 *  1. Eine reine, exportierte Treffertest-Funktion (ANNAHME: `trifftKante`
 *     in `DungeonGrundriss.ts`) — Kreis um `kante.pos` in WELTKOORDINATEN,
 *     Radius ~0,6 m: ein Klick 0,3 m daneben trifft, einer 1,0 m daneben
 *     nicht.
 *  2. `waehleBei` (privat, per Cast erreicht wie in anderen Tests dieses
 *     Ordners) ruft bei einem Klick nahe einer Kante `cb.connectorAngeklickt
 *     (idx)` — NICHT die Raumauswahl — auf. `idx` zählt in `anbaubare`
 *     (dieselbe Liste wie `fuegeAn`), nicht in `offeneVerbindungen`.
 *  3. Regressionswache: ein Klick auf einen Raum OHNE nahe Kante wählt
 *     weiterhin den Raum (Bestandsverhalten bleibt erhalten).
 *
 * Stand vor der Implementierung: ROT.
 *  - `trifftKante` existiert in `DungeonGrundriss.ts` noch nicht → Prüfung
 *    1 schlägt fehl (Funktion fehlt, statt Ergebnis zu vergleichen).
 *  - `GrundrissRueckrufe.connectorAngeklickt` gibt es nicht, und `waehleBei`
 *    ruft es folglich nie → Prüfung 2 schlägt fehl (Raumauswahl statt
 *    Kantenauswahl, oder gar keine Auswahl).
 *
 * DOM-Stummel wie in `dungeon-editor-kanten.ts`: `DungeonGrundriss` legt im
 * Konstruktor eine Canvas an; `getContext` liefert `null`, `zeichne()`
 * steigt dort sofort aus. Kein echtes jsdom.
 *
 * Lauf: npx tsx client/test/dungeon-grundriss-kanten.ts   (aus dem Repo-Wurzelverzeichnis)
 */
import { DUNGEONS_BY_NAME, anbaubareKanten, type AnbaubareKante } from '@wov/shared';

// ── DOM-Stummel, VOR dem Import des Grundrisses gesetzt ──────────────
class StummelKnoten {
  constructor(readonly tag: string = '') {}
  style: Record<string, string> = {};
  cssText = '';
  kinder: StummelKnoten[] = [];
  addEventListener(): void {}
  appendChild(k: StummelKnoten): void {
    this.kinder.push(k);
  }
  getContext(): null {
    return null;
  }
}
const g = globalThis as unknown as Record<string, unknown>;
g.document = { createElement: (tag: string) => new StummelKnoten(tag) };
g.window = { addEventListener: () => undefined, devicePixelRatio: 1 };

const { DungeonGrundriss } = await import('../src/editor/DungeonGrundriss');
const { neuesDungeonDokument } = await import('../src/editor/DungeonNeuesDokument');

let fehler = 0;
function pruefe(bedingung: boolean, was: string, zusatz = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${was}${zusatz ? ` — ${zusatz}` : ''}`);
}

const KIT = 'DG_StoneVault';
const def = DUNGEONS_BY_NAME.get(KIT)!;
pruefe(!!def, `Vorbedingung: ${KIT} ist im Katalog`);

// ── Ein Dokument mit mindestens einer anbaubaren Kante ───────────────
const neu = neuesDungeonDokument({ id: 'test-kanten-vault', base: KIT, seed: 7 });
if (!neu.ok) throw new Error(`Vorbedingung fehlgeschlagen: ${neu.grund}`);
const doc = neu.doc;
const kanten: AnbaubareKante[] = anbaubareKanten(doc.layout, doc.base);
pruefe(kanten.length > 0, `Vorbedingung: mindestens eine anbaubare Kante (${kanten.length})`);
const zielKante = kanten[0]!;

function viewport(): { appendChild: () => void; clientWidth: number; clientHeight: number } {
  return { appendChild: () => undefined, clientWidth: 800, clientHeight: 600 };
}

// ── 1. Reine Treffertest-Funktion (ANNAHME: trifftKante) ─────────────
{
  const modul = (await import('../src/editor/DungeonGrundriss')) as unknown as {
    trifftKante?: (welt: { x: number; z: number }, kante: AnbaubareKante) => boolean;
  };
  const trifftKante = modul.trifftKante;
  if (!trifftKante) {
    fehler++;
    console.log(
      'FAIL trifftKante ist noch nicht aus DungeonGrundriss.ts exportiert (ANNAHME, ZIEL A Punkt 4)'
    );
  } else {
    const nah = { x: zielKante.pos.x + 0.3, z: zielKante.pos.z };
    const fern = { x: zielKante.pos.x + 1.0, z: zielKante.pos.z };
    pruefe(trifftKante(nah, zielKante) === true, 'Treffer 0,3 m neben der Kante (< 0,6 m Radius)');
    pruefe(trifftKante(fern, zielKante) === false, 'kein Treffer 1,0 m neben der Kante (> 0,6 m Radius)');
  }
}

// ── 2. waehleBei ruft connectorAngeklickt statt Raumauswahl ──────────
{
  interface RueckrufeMitKante {
    meldung(text: string, fehler?: boolean): void;
    auswahlGeaendert(): void;
    connectorAngeklickt?(idx: number): void;
  }
  const angeklickt: number[] = [];
  let auswahlGeaendertCount = 0;
  const cb: RueckrufeMitKante = {
    meldung: () => undefined,
    auswahlGeaendert: () => {
      auswahlGeaendertCount++;
    },
    connectorAngeklickt: (idx: number) => {
      angeklickt.push(idx);
    },
  };
  const gr = new DungeonGrundriss(viewport() as unknown as HTMLElement, cb as never);
  gr.setzeDokument(doc);
  gr.passeEin();

  // Pixelposition der Zielkante mit denselben privaten Feldern berechnen,
  // die `zuBild`/`waehleBei` intern benutzen — kein zweiter Nachbau der
  // Projektion, nur ihr Aufruf über einen Cast (wie die anderen Tests in
  // diesem Ordner private Methoden erreichen).
  const intern = gr as unknown as {
    zoom: number;
    mitte: { x: number; z: number };
    waehleBei(px: number, py: number): void;
  };
  const { breite, hoehe } = { breite: 800, hoehe: 600 };
  const px = breite / 2 + (zielKante.pos.x - intern.mitte.x) * intern.zoom;
  const py = hoehe / 2 + (zielKante.pos.z - intern.mitte.z) * intern.zoom;

  intern.waehleBei(px, py);

  pruefe(
    angeklickt.length === 1,
    `waehleBei auf der Kantenmarke ruft connectorAngeklickt genau einmal (ist: ${angeklickt.length}x)`
  );
  pruefe(
    angeklickt[0] === 0,
    `connectorAngeklickt bekommt den Index in 'anbaubare' (0), ist: ${angeklickt[0]}`
  );
  pruefe(
    gr.gewaehlterRaum === -1,
    `ein Kantentreffer wählt KEINEN Raum aus (gewaehlterRaum ist: ${gr.gewaehlterRaum})`
  );
}

// ── 3. Regressionswache: Klick auf einen Raum ohne nahe Kante ────────
{
  const angeklickt: number[] = [];
  let raumGewaehlt = false;
  const cb = {
    meldung: () => undefined,
    auswahlGeaendert: () => {
      raumGewaehlt = true;
    },
    connectorAngeklickt: (idx: number) => {
      angeklickt.push(idx);
    },
  };
  const gr = new DungeonGrundriss(viewport() as unknown as HTMLElement, cb as never);
  gr.setzeDokument(doc);
  gr.passeEin();
  const intern = gr as unknown as {
    zoom: number;
    mitte: { x: number; z: number };
    waehleBei(px: number, py: number): void;
  };
  // Mitte des Startraums (Eingang) — weit von jeder Kantenmarke entfernt.
  const startRaum = doc.layout.rooms[0]!;
  const { breite, hoehe } = { breite: 800, hoehe: 600 };
  const px = breite / 2 + (startRaum.pos.x - intern.mitte.x) * intern.zoom;
  const py = hoehe / 2 + (startRaum.pos.z - intern.mitte.z) * intern.zoom;
  intern.waehleBei(px, py);
  pruefe(angeklickt.length === 0, 'Klick auf den Raum löst KEIN connectorAngeklickt aus');
  pruefe(raumGewaehlt, 'Klick auf den Raum wählt weiterhin über auswahlGeaendert aus (Bestand bleibt)');
}

console.log(`\ndungeon-grundriss-kanten: ${fehler === 0 ? 'OK' : `${fehler} FEHLER (ROT erwartet vor der Umsetzung)`}`);
process.exit(fehler === 0 ? 0 : 1);
