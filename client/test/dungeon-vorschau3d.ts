/**
 * ZIEL A, Punkt 2+3 — `DungeonVorschau3d`: die 3D-Ansicht des 1.0-Dokuments
 * im Karteneditor, nach dem Muster von `Dungeon2Vorschau.ts`
 * (`client/test/dungeon2-vorschau.ts` für dessen reine Steuerung,
 * `client/test/kollisionsnetz.ts` für den NullEngine-Weg über echte
 * Produktivklassen statt eines nachgebauten Modells).
 *
 * `DungeonVorschau3d.ts` EXISTIERT NOCH NICHT — diese Datei hält die
 * Signatur fest, die der Auftragskopf vorgibt, und ist bis zur Umsetzung
 * ROT (Import schlägt fehl). Sie ist trotzdem lauffähig geschrieben, damit
 * sie beim Anlegen der Klasse ohne weitere Änderung von ROT nach GRÜN geht.
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
    };
  };

  const KIT = 'DG_StoneVault';
  const def = DUNGEONS_BY_NAME.get(KIT)!;
  const { neuesDungeonDokument } = await import('../src/editor/DungeonNeuesDokument');
  const neu = neuesDungeonDokument({ id: 'test-3d-vault', base: KIT, seed: 7 });
  if (!neu.ok) throw new Error(`Vorbedingung fehlgeschlagen: ${neu.grund}`);
  const doc = neu.doc;
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
