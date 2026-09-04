/**
 * ZIEL A, Punkt 2+3 — `DungeonVorschau3d`: die 3D-Ansicht des 1.0-Dokuments
 * im Karteneditor, nach dem Muster von `Dungeon2Vorschau.ts`
 * (`client/test/dungeon2-vorschau.ts` für dessen reine Steuerung,
 * `client/test/kollisionsnetz.ts` für den NullEngine-Weg über echte
 * Produktivklassen statt eines nachgebauten Modells).
 *
 * Die Klasse gibt es inzwischen; der Import-Zweig unten bleibt trotzdem
 * stehen — er ist die Fehlermeldung für den Fall, dass jemand die Datei
 * verschiebt.
 *
 * ── Angenommene Signatur (ANNAHME — hier entschieden, nicht in der Klasse) ──
 *
 *   export interface DungeonVorschau3dRueckrufe {
 *     meldung?(text: string, fehler?: boolean): void;
 *     // wie GrundrissRueckrufe.connectorAngeklickt (dungeon-grundriss-kanten.ts):
 *     // ein Klick auf eine Kanten-Markierung in 3D meldet ihren Index in
 *     // `anbaubareKanten(...)`.
 *     connectorAngeklickt?(idx: number): void;
 *     // ein Klick auf einen Raum meldet dessen roomIndex — dieselbe Zahl,
 *     // mit der `DungeonGrundriss.waehle(index)` (ANNAHME dort) angesteuert wird.
 *     raumAngeklickt?(roomIndex: number): void;
 *   }
 *
 *   export class DungeonVorschau3d {
 *     constructor(
 *       viewport: HTMLElement,
 *       cb?: DungeonVorschau3dRueckrufe,
 *       // Testhaken: eine vorbereitete AssetManager-Instanz statt einer
 *       // selbst angelegten — GENAU der Weg, den `kollisionsnetz.ts` für
 *       // `EntityManager` benutzt (Container vorab in `assets.containers`
 *       // gesetzt, kein GLB-Ladepfad im Test).
 *       assets?: AssetManager
 *     );
 *     setzeDokument(doc: DungeonDocument | null): void;
 *     /** Raum per Index auswählen — Gegenstück zu einem Klick in 3D. * /
 *     waehle(index: number): void;
 *     get gewaehlterRaum(): number;
 *     zeige(an: boolean): void;
 *     get sichtbar(): boolean;
 *     dispose(): void;
 *   }
 *
 * ── Was geprüft wird, sobald die Klasse existiert ────────────────────
 *  1. Sichtbarkeits-Zustandsmaschine / Entprellung / dispose-Idempotenz —
 *     wie `dungeon2-vorschau.ts`, hier aber am ÖFFENTLICHEN `zeige()` der
 *     neuen Klasse selbst gemessen (kein `VorschauTreiber` von aussen
 *     injizierbar, da die Klasse ihre Babylon-Hälfte selbst hält — anders
 *     als `Dungeon2Vorschau`, das seine Steuerung ausdrücklich TRENNT. Muss
 *     die Umsetzung dieselbe Trennung wählen, wird dieser Testblock durch
 *     einen echten `VorschauSteuerung`-Test wie in `dungeon2-vorschau.ts`
 *     ersetzt — vermerkt als offener Punkt).
 *  2. NullEngine, SYNTHETISCHE Prototyp-Master (ein Würfel je Prefab statt
 *     GLB) über `AssetManager.getMasters()` — echte Produktivklasse, nur der
 *     Ladeweg ersetzt (wie `kollisionsnetz.ts`): aus einem Layout mit 3
 *     Räumen entstehen 3 Instanzen an den richtigen Weltpositionen.
 *  3. Marker an ALLEN anbaubaren Kanten — Anzahl = `anbaubareKanten(...).length`.
 *  4. Auswahl-Hervorhebung wechselt bei `waehle(index)`.
 *  5. Komfortstufen (04.09.2026): Ebenenfilter (Treppe gehört BEIDEN
 *     Ebenen), Decken-Schnittebene und Fokus. Gemessen wird an dem, was
 *     man sonst erst im Bild sähe — `isEnabled()` je Instanz,
 *     `scene.clipPlane.d` und Ziel/Radius der Kamera.
 *
 * Lauf: npx tsx client/test/dungeon-vorschau3d.ts   (aus dem Repo-Wurzelverzeichnis)
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import '@babylonjs/core/Meshes/thinInstanceMesh';

import { DUNGEONS_BY_NAME, anbaubareKanten } from '@wov/shared';
import { AssetManager } from '../src/engine/AssetManager';

// ── DOM-Stummel — wie DungeonGrundriss.ts legt die Vorschau eine Canvas an ──
class StummelKnoten {
  constructor(readonly tag: string = '') {}
  style: Record<string, string> = {};
  cssText = '';
  tabIndex = 0;
  kinder: StummelKnoten[] = [];
  addEventListener(): void {}
  removeEventListener(): void {}
  appendChild(k: StummelKnoten): void {
    this.kinder.push(k);
  }
  remove(): void {}
  getContext(): null {
    return null;
  }
}
const g = globalThis as unknown as Record<string, unknown>;
if (!g.document)
  g.document = {
    createElement: (tag: string) => new StummelKnoten(tag),
    // `engine.dispose()` haengt seine Zuhoerer am Dokument ab — ohne diese
    // beiden Stummel wirft der Abbau, und zwar NACH allen Pruefungen: Der
    // Lauf saehe gruen aus und ginge trotzdem mit 1 heraus.
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
if (!g.window) g.window = { addEventListener: () => undefined, removeEventListener: () => undefined, devicePixelRatio: 1, setTimeout, clearTimeout };

let fehler = 0;
function pruefe(bedingung: boolean, was: string, zusatz = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${was}${zusatz ? ` — ${zusatz}` : ''}`);
}

function wuerfel(name: string, sz: Scene): Mesh {
  const m = new Mesh(name, sz);
  const d = new VertexData();
  const p: number[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) p.push(x, y, z);
  d.positions = p;
  d.indices = [
    0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1,
    2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3,
  ];
  d.applyToMesh(m);
  return m;
}

/** Einen geladenen Container vortäuschen — wie in `kollisionsnetz.ts`. */
function stelleContainerBereit(assets: AssetManager, scene: Scene, name: string): void {
  const wurzel = new TransformNode(`${name}_wurzel`, scene);
  const sichtbar = wuerfel('Sichtbar', scene);
  sichtbar.material = new PBRMaterial(`${name}_mat`, scene);
  sichtbar.parent = wurzel;
  const container = new AssetContainer(scene);
  container.meshes.push(sichtbar);
  container.transformNodes.push(wurzel);
  container.removeAllFromScene();
  (
    assets as unknown as { containers: Map<string, Promise<AssetContainer | null>> }
  ).containers.set(name, Promise.resolve(container));
}

async function main(): Promise<void> {
  let modul: typeof import('../src/editor/DungeonVorschau3d') | null = null;
  try {
    modul = await import('../src/editor/DungeonVorschau3d');
  } catch (f) {
    fehler++;
    console.log(
      'FAIL DungeonVorschau3d.ts existiert noch nicht (ZIEL A, Punkt 2) — ' +
        `Import schlägt fehl: ${(f as Error).message}`
    );
  }

  if (!modul) {
    console.log(
      `\ndungeon-vorschau3d: ${fehler} FEHLER (ROT erwartet vor der Umsetzung — Signatur s. Kopfkommentar)`
    );
    process.exit(1);
  }

  const { DungeonVorschau3d } = modul as unknown as {
    DungeonVorschau3d: new (
      viewport: HTMLElement,
      cb?: { meldung?: (t: string, f?: boolean) => void; connectorAngeklickt?: (i: number) => void; raumAngeklickt?: (i: number) => void },
      assets?: AssetManager
    ) => {
      setzeDokument(doc: unknown): void;
      waehle(index: number): void;
      gewaehlterRaum: number;
      zeige(an: boolean): void;
      sichtbar: boolean;
      dispose(): void;
      // ── Komfortstufen (Auftrag 04.09.2026) ────────────────────────────
      /** Nur Räume dieser Ebene zeigen; `null` = alle. */
      setzeEbene(y: number | null): void;
      aktiveEbene: number | null;
      /** Decke der Module zeigen (`false` = Blick von oben hinein). */
      setzeDecke(an: boolean): void;
      deckeAn: boolean;
      /** Kamera auf den gewählten Raum — ohne Auswahl auf das Ganze. */
      fokussiere(): void;
    };
  };

  const KIT = 'DG_StoneVault';
  const def = DUNGEONS_BY_NAME.get(KIT)!;
  const { neuesDungeonDokument } = await import('../src/editor/DungeonNeuesDokument');
  const neu = neuesDungeonDokument({ id: 'test-3d-vault', base: KIT, seed: 7 });
  if (!neu.ok) throw new Error(`Vorbedingung fehlgeschlagen: ${neu.grund}`);
  const doc = neu.doc;

  // ── Zwei Ebenen von Hand stellen ───────────────────────────────────────
  // Ein frisches Dokument hat genau den Eingangsraum, also EINE Ebene — und
  // an einer Ebene ist ein Ebenenfilter nicht zu widerlegen. Die beiden
  // Räume werden deshalb direkt ins Layout gesetzt (kein Generator, keine
  // Rasterprüfung: geprüft wird hier das Ausblenden, nicht das Bauen).
  // Die Treppe ist der interessante Fall — sie ist 7 m hoch und gehört
  // damit BEIDEN Ebenen, während der Raum darüber nur auf 3,5 steht.
  const KEINE_DREHUNG = { x: 0, y: 0, z: 0, w: 1 };
  doc.layout.rooms.push(
    { room: 'StoneVaultStairs', pos: { x: 20, y: 0, z: 0 }, rot: { ...KEINE_DREHUNG }, placeOrder: 1, seed: 1 },
    { room: 'StoneVaultCell', pos: { x: 20, y: 3.5, z: 8 }, rot: { ...KEINE_DREHUNG }, placeOrder: 2, seed: 2 }
  );
  const IDX_EINGANG = 0;
  const IDX_TREPPE = doc.layout.rooms.length - 2;
  const IDX_OBEN = doc.layout.rooms.length - 1;
  pruefe(doc.layout.rooms.length >= 1, `Vorbedingung: Dokument hat Räume (${doc.layout.rooms.length})`);
  const kanten = anbaubareKanten(doc.layout, doc.base);

  const engine = new NullEngine();
  const scene = new Scene(engine);
  const assets = new AssetManager(scene);
  for (const r of doc.layout.rooms) stelleContainerBereit(assets, scene, r.room);

  const viewport = { appendChild: () => undefined, clientWidth: 800, clientHeight: 600 } as unknown as HTMLElement;
  const angeklickteKanten: number[] = [];
  const vorschau = new DungeonVorschau3d(
    viewport,
    { connectorAngeklickt: (i) => angeklickteKanten.push(i) },
    assets
  );

  vorschau.setzeDokument(doc);
  vorschau.zeige(true);
  await new Promise((r) => setTimeout(r, 0));

  pruefe(
    scene.meshes.length > 0 || scene.getNodes().length > 0,
    'nach setzeDokument+zeige(true) stehen Instanzen/Knoten in der Szene'
  );

  // Der Bau laeuft ENTPRELLT (VorschauSteuerung, 120 ms) und danach noch
  // asynchron ueber `getMasters` — deshalb hier warten statt sofort zaehlen.
  // Ohne dieses Warten misst der Test die leere Szene und ist immer gruen.
  await new Promise((r) => setTimeout(r, 400));

  const marken = scene.meshes.filter(
    (m) => (m.metadata as { kanteIndex?: number } | undefined)?.kanteIndex !== undefined
  );
  pruefe(
    marken.length === kanten.length,
    `je anbaubarer Kante genau eine Marke (${marken.length} von ${kanten.length})`
  );
  const raumInstanzen = scene.meshes.filter(
    (m) => (m.metadata as { roomIndex?: number } | undefined)?.roomIndex !== undefined
  );
  pruefe(
    raumInstanzen.length >= doc.layout.rooms.length,
    `je platziertem Raum mindestens eine Instanz mit roomIndex ` +
      `(${raumInstanzen.length} fuer ${doc.layout.rooms.length} Raeume)`
  );
  const raum0 = doc.layout.rooms[0]!;
  const nah = raumInstanzen.some(
    (m) =>
      Math.abs(m.position.x - raum0.pos.x) < 0.01 &&
      Math.abs(m.position.z - raum0.pos.z) < 0.01
  );
  pruefe(nah, 'die Instanz von Raum 0 steht an dessen Weltposition');

  vorschau.waehle(0);
  pruefe(vorschau.gewaehlterRaum === 0, `waehle(0) setzt gewaehlterRaum (ist: ${vorschau.gewaehlterRaum})`);
  vorschau.waehle(-1);
  pruefe(vorschau.gewaehlterRaum === -1, 'waehle(-1) hebt die Auswahl auf');

  // ── Komfortstufe 2: Ebenenfilter ───────────────────────────────────────
  // Gemessen wird an `isEnabled()`, nicht an der Existenz: Der Filter darf
  // nichts wegwerfen, sonst kostet jeder Ebenenwechsel einen Neubau.
  const anAufEbene = (idx: number): number =>
    raumInstanzen.filter(
      (m) => (m.metadata as { roomIndex?: number }).roomIndex === idx && m.isEnabled()
    ).length;
  const markenAuf = (y: number): number =>
    marken.filter((m) => Math.abs(m.position.y - y) < 0.05 && m.isEnabled()).length;

  vorschau.setzeEbene(null);
  pruefe(
    anAufEbene(IDX_EINGANG) > 0 && anAufEbene(IDX_OBEN) > 0,
    'ohne Filter sind Räume beider Ebenen sichtbar'
  );

  vorschau.setzeEbene(0);
  pruefe(vorschau.aktiveEbene === 0, `setzeEbene(0) merkt sich die Ebene (ist: ${vorschau.aktiveEbene})`);
  pruefe(anAufEbene(IDX_EINGANG) > 0, 'Ebene 0: der Eingangsraum bleibt sichtbar');
  pruefe(anAufEbene(IDX_OBEN) === 0, 'Ebene 0: der Raum auf y = 3,5 ist ausgeblendet');
  pruefe(anAufEbene(IDX_TREPPE) > 0, 'Ebene 0: die Treppe (7 m hoch) bleibt sichtbar');
  pruefe(markenAuf(3.5) === 0, 'Ebene 0: Marken auf y = 3,5 sind ausgeblendet');

  vorschau.setzeEbene(3.5);
  pruefe(anAufEbene(IDX_OBEN) > 0, 'Ebene 3,5: der obere Raum ist sichtbar');
  pruefe(anAufEbene(IDX_EINGANG) === 0, 'Ebene 3,5: der Eingangsraum ist ausgeblendet');
  pruefe(
    anAufEbene(IDX_TREPPE) > 0,
    'Ebene 3,5: die Treppe gehört BEIDEN angrenzenden Ebenen und bleibt sichtbar'
  );
  pruefe(markenAuf(3.5) > 0, 'Ebene 3,5: die Marke des oberen Treppenausgangs steht');

  vorschau.setzeEbene(null);
  pruefe(anAufEbene(IDX_EINGANG) > 0 && anAufEbene(IDX_OBEN) > 0, 'Filter zurück auf „alle Ebenen"');

  // ── Komfortstufe 1: Decke ausblenden ───────────────────────────────────
  // Die Module sind EIN verschmolzenes Netz je Prefab (Boden, Wände und
  // Decke in einem) — es gibt kein Decken-Mesh zum Abschalten. Geschnitten
  // wird deshalb mit `scene.clipPlane` knapp unter der Deckenunterkante.
  pruefe(scene.clipPlane !== null, 'Vorgabe: Decke AUS, also steht eine Schnittebene');
  vorschau.setzeDecke(true);
  pruefe(vorschau.deckeAn && scene.clipPlane === null, 'setzeDecke(true) nimmt die Schnittebene weg');
  vorschau.setzeDecke(false);
  pruefe(!vorschau.deckeAn && scene.clipPlane !== null, 'setzeDecke(false) setzt sie wieder');
  // Die Schnitthöhe folgt der Ebene: unten knapp unter deren Decke (3,4),
  // oben eine Ebene höher (6,9).
  const schnitt = (): number => -(scene.clipPlane?.d ?? 0);
  vorschau.setzeEbene(0);
  const hoeheAuf0 = schnitt();
  vorschau.setzeEbene(3.5);
  const hoeheAuf35 = schnitt();
  pruefe(
    Math.abs(hoeheAuf0 - 3.4) < 0.001 && Math.abs(hoeheAuf35 - 6.9) < 0.001,
    `die Schnitthöhe folgt der gewählten Ebene (Ebene 0 → ${hoeheAuf0}, Ebene 3,5 → ${hoeheAuf35})`
  );
  // Ohne Filter zählt die AUSWAHL, ohne Auswahl der Eingang: Eine waagerechte
  // Fläche öffnet nur EIN Stockwerk, und ein Schnitt über der obersten Decke
  // liesse von aussen einen geschlossenen Klotz stehen.
  vorschau.setzeEbene(null);
  vorschau.waehle(-1);
  pruefe(Math.abs(schnitt() - 3.4) < 0.001, `ohne Filter und Auswahl zählt der Eingang (${schnitt()})`);
  vorschau.waehle(IDX_OBEN);
  pruefe(Math.abs(schnitt() - 6.9) < 0.001, `ohne Filter folgt der Schnitt dem gewählten Raum (${schnitt()})`);
  vorschau.waehle(-1);

  // ── Komfortstufe 3: Fokus ──────────────────────────────────────────────
  const kamera = scene.getCameraByName('vorschau3dKamera');
  pruefe(kamera !== null, 'die Vorschau hält eine ArcRotate-Kamera in der Szene');
  const arc = kamera as unknown as { target: { x: number; y: number; z: number }; radius: number };
  vorschau.waehle(IDX_OBEN);
  vorschau.fokussiere();
  const obenPos = doc.layout.rooms[IDX_OBEN]!.pos;
  pruefe(
    Math.abs(arc.target.x - obenPos.x) < 0.01 && Math.abs(arc.target.z - obenPos.z) < 0.01,
    `Fokus richtet das Ziel auf die Raummitte (${arc.target.x}/${arc.target.z} statt ${obenPos.x}/${obenPos.z})`
  );
  const radiusRaum = arc.radius;
  pruefe(radiusRaum > 0 && radiusRaum < 40, `Fokus zieht die Kamera nah heran (radius ${radiusRaum})`);
  vorschau.waehle(-1);
  vorschau.fokussiere();
  pruefe(
    arc.radius > radiusRaum,
    `ohne Auswahl passt Fokus das ganze Dungeon ein (radius ${arc.radius} > ${radiusRaum})`
  );

  vorschau.zeige(false);
  pruefe(!vorschau.sichtbar, 'zeige(false) macht die Vorschau unsichtbar');

  vorschau.dispose();
  vorschau.dispose();
  pruefe(true, 'dispose ist zweimal aufrufbar, ohne zu werfen (Idempotenz)');

  scene.dispose();
  engine.dispose();

  console.log(`\ndungeon-vorschau3d: ${fehler === 0 ? 'OK' : `${fehler} FEHLER`}`);
  process.exit(fehler === 0 ? 0 : 1);
}

void main().catch((f: unknown) => {
  console.error(f);
  process.exit(1);
});
