/**
 * Dungeon-2.0-Vorschau — ein erzeugtes Steingrab, lokal gebaut, OHNE Server.
 * Dungeon 2.0 preview — a generated barrow, built locally, WITHOUT a server.
 *
 * Warum es diesen Einstieg gibt: Der reguläre Weg in einen Dungeon führt über
 * Anmeldung, Weltwechsel und ein Teleportpaket vom Server (AP13). Solange der
 * Adapter noch nicht steht, wäre der Client-Bauer damit gar nicht auszuprobieren
 * — und ein Bauer, den man nur im Vollbetrieb sieht, wird im Vollbetrieb
 * debuggt. Diese Seite baut aus `?seed=` ein Layout und stellt einen Betrachter
 * hinein.
 * Why this entry exists: the regular way into a dungeon goes through login,
 * world switch and a teleport packet from the server (AP13). Until that adapter
 * exists the client builder could not be tried out at all.
 *
 * Adresszeile / query parameters:
 *   ?seed=1234        Architektur-Seed (auch `?arch=`) / architecture seed
 *   ?material=77      Material-Seed — treibt Risse, Moos, Variante
 *   ?deko=9           Deko-Seed — treibt die Prefab-Wahl
 *   ?stufe=0|1|2      Grafikstufe: Niedrig | Mittel | Hoch
 *   ?arrays=0         Texturen NICHT laden — graue Kästen (der AP6-Zustand)
 *   ?physik=1         Havok starten und Kollisionskoerper bauen
 *   ?triplanar=off    Killschalter des Materials (A/B-Messung)
 *   ?px=&py=&pz=      Kamerastandort in Metern / camera position in metres
 *   ?blick=Grad       Blickrichtung (0 = Nord/+z, 90 = Ost/+x)
 *   ?neigung=Grad     Nickwinkel, positiv nach unten / pitch, positive = down
 *   ?ambient=0..1     Grundhelligkeit; 0 = stockdunkel, nur Fackeln
 *                     base brightness; 0 = pitch dark, torches only
 *
 * Der Vorschaupfad rührt NICHTS an, was der Spielclient benutzt: eigene Seite,
 * eigene Szene, eigener Einstieg. Das ist Absicht — die Vault-Notiz „Agenten
 * nicht in dev.json erproben lassen" gilt sinngemäß auch hier: eine Erprobung
 * darf den Betriebspfad nicht anfassen.
 * The preview path touches NOTHING the game client uses: own page, own scene,
 * own entry point. That is deliberate.
 */
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent';
import { dungeon2 } from '@wov/shared';
import { installiereFackelLicht, FackelLichter } from './engine/FackelLicht';
import { LightPool } from './engine/LightPool';
import { AssetManager } from './engine/AssetManager';
import { DungeonBauer } from './engine/DungeonBuilder';
import { DungeonAtmosphaere, type Grundlicht } from './engine/DungeonAtmosphere';
import { DungeonGrafikStufe } from './engine/DungeonMaterial';
import { ladeDungeonMaterialArrays, type DungeonMaterialArrays } from './engine/DungeonMaterialArrays';

/**
 * Fundort der Texturen im Entwicklungsserver.
 *
 * `vite.config.ts` reicht den Repo-Ordner `assets/` unter `/assets/` durch —
 * dort liegen die von AP9/AP12 gebackenen Arrays bereits. Der ausgelieferte
 * Client erwartet sie dagegen unter `/dungeon2/` (`DUNGEON2_BASIS_URL`), weil
 * `assets/` ausserhalb des Repos liegt und der Ausrollschritt kopiert. Die
 * Vorschau nimmt zuerst den Entwicklungspfad und faellt auf den Auslieferpfad
 * zurueck — so laeuft dieselbe Seite in beiden Faellen.
 * Location of the textures on the dev server. `vite.config.ts` serves the repo
 * folder `assets/` under `/assets/`; the shipped client expects `/dungeon2/`.
 */
const ARRAY_PFADE: readonly string[] = ['/assets/dungeon2/', '/dungeon2/'];

/** Bewegung des Betrachters in Metern je Sekunde. / Viewer speed in m/s. */
const TEMPO = 8;

function zahl(params: URLSearchParams, name: string, vorgabe: number): number {
  const roh = params.get(name);
  if (roh === null) return vorgabe;
  const wert = Number(roh);
  return Number.isFinite(wert) ? Math.trunc(wert) : vorgabe;
}

function meldung(text: string): void {
  const feld = document.getElementById('meldung');
  if (feld !== null) feld.textContent = text;
}

async function ladeArrays(scene: Scene): Promise<DungeonMaterialArrays | null> {
  for (const pfad of ARRAY_PFADE) {
    try {
      return await ladeDungeonMaterialArrays(scene, pfad);
    } catch (fehler) {
      console.warn(`[dungeon2-vorschau] ${pfad} nicht ladbar:`, fehler);
    }
  }
  // Kein Rueckfall auf „irgendetwas": ohne Arrays baut `erzeugeDungeonMaterial`
  // ein graues PBR-Material, und das ist ein DEFINIERTER Zustand (AP6), kein
  // halbes Bild.
  // No fallback to "something": without arrays the factory builds a grey PBR
  // material, and that is a DEFINED state (AP6), not half a picture.
  return null;
}

async function starte(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const leinwand = document.getElementById('leinwand') as HTMLCanvasElement | null;
  if (leinwand === null) throw new Error('kein <canvas id="leinwand"> / no canvas');

  const seeds = {
    architektur: zahl(params, 'seed', zahl(params, 'arch', 1234)),
    material: zahl(params, 'material', 77),
    deko: zahl(params, 'deko', 9),
  };
  const stufe = ([DungeonGrafikStufe.Niedrig, DungeonGrafikStufe.Mittel, DungeonGrafikStufe.Hoch][
    zahl(params, 'stufe', 1)
  ] ?? DungeonGrafikStufe.Mittel) as DungeonGrafikStufe;

  const engine = new Engine(leinwand, true, { preserveDrawingBuffer: true, stencil: true }, true);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.02, 0.02, 0.03, 1);
  // Ein Innenraum hat kein Umgebungslicht von aussen. Der schwache
  // Hemisphaerenanteil ist NUR da, damit graue Kaesten ohne Fackeln ueberhaupt
  // sichtbar sind — er ist Werkzeug, keine Beleuchtungsaussage.
  // An interior has no ambient from outside. The weak hemispheric term exists
  // ONLY so grey boxes are visible without torches — a tool, not a lighting
  // statement.
  const licht = new HemisphericLight('vorschauLicht', new Vector3(0, 1, 0), scene);
  const GRUNDHELLIGKEIT = 0.55;
  licht.intensity = GRUNDHELLIGKEIT;
  licht.diffuse = new Color3(0.8, 0.82, 0.9);
  licht.groundColor = new Color3(0.12, 0.11, 0.1);

  // `?ambient=` — dieselbe Groesse wie `ThemenProfil.ambientLicht` bzw.
  // `DungeonDokument2.ambientLicht` im Spiel, hier auf das eine Licht der
  // Vorschau gelegt. Die Vorschau hat kein `Lighting`, aber sie erfuellt
  // dieselbe Schnittstelle (`Grundlicht`) — und genau deshalb misst
  // `?ambient=0` hier dasselbe wie `dungeon create2 … 0` dort: KEINE
  // Grundhelligkeit, nur die platzierten Quellen.
  // `?ambient=` — the same quantity as in the game, applied to the preview's
  // single light through the same `Grundlicht` interface.
  const grundlicht: Grundlicht = {
    setzeDungeonDaempfung: (faktor) => {
      licht.intensity = GRUNDHELLIGKEIT * (faktor ?? 1);
    },
  };
  const ambientRoh = params.get('ambient');
  const ambientLicht =
    ambientRoh !== null && Number.isFinite(Number(ambientRoh))
      ? Math.min(1, Math.max(0, Number(ambientRoh)))
      : 1;

  meldung('Layout wird erzeugt …');
  const beginnLayout = performance.now();
  const bericht = dungeon2.erzeugeLayoutMitBericht(dungeon2.STEINGRAB, seeds);
  const dauerLayout = performance.now() - beginnLayout;
  const layout = bericht.layout;

  const arrays = params.get('arrays') === '0' ? null : await ladeArrays(scene);

  // Fackellicht VOR dem Bau installieren: `installiereFackelLicht` haengt sein
  // Plugin an jedes vorhandene und kuenftige Material — nach dem Bau haetten
  // die Dungeon-Materialien es zwar auch bekommen (ueber das Observable), aber
  // erst nach ihrer ersten Uebersetzung, also mit einer sichtbaren Neuuebersetzung.
  // Install the torch light BEFORE the build: it hooks its plugin onto every
  // existing and future material, and afterwards the dungeon materials would
  // only get it after their first compile — i.e. with a visible recompile.
  const plaetze = installiereFackelLicht(scene);

  // Havok VOR dem Bau starten. `?physik=1` allein reichte nicht: der Bauer
  // fragt `scene.getPhysicsEngine()` und stieg still aus, wenn keine da war —
  // der Schalter war also seit AP6 wirkungslos, ohne Symptom. Vault-Notiz
  // „Messzellen brauchen Zeugen": ohne Zustandsgroesse merkt man einen
  // wirkungslosen Schalter nie. Die Zahl steht deshalb in der Meldezeile.
  // Start Havok BEFORE the build. `?physik=1` alone was not enough: the builder
  // asks `scene.getPhysicsEngine()` and bailed out silently when there was none,
  // so the switch had been inert since AP6, without a symptom. The number is in
  // the status line for that reason.
  const physikGewuenscht = params.get('physik') === '1';
  if (physikGewuenscht) {
    meldung('Havok wird gestartet …');
    const { initPhysics } = await import('./engine/Physics');
    await initPhysics(scene);
  }

  meldung('Geometrie wird gebaut …');
  const beginnBau = performance.now();
  const bauer = new DungeonBauer(scene, layout, { arrays, physik: physikGewuenscht });
  bauer.baueSpawnBloecke();
  const dauerSpawn = performance.now() - beginnBau;
  await bauer.dungeonBereit;
  bauer.baueAlles();
  const dauerBau = performance.now() - beginnBau;

  // Sichtbare Deko (M1-Schritt 2) — NACH der Architektur, aber vor der
  // Meldezeile: die Zahlen unten sollen den echten Ausgang zeigen, nicht
  // "noch am Laden". `assets` gehoert der Szene, nicht dem Bauer (siehe
  // `DungeonBauer.baueDeko`-Kommentar).
  // Visible decor (M1 step 2) — AFTER the architecture but before the status
  // line, so the numbers below reflect the real outcome.
  meldung('Deko wird geladen …');
  const beginnDeko = performance.now();
  const assets = new AssetManager(scene);
  const deko = await bauer.baueDeko(assets);
  const dauerDeko = performance.now() - beginnDeko;

  const kamera = new UniversalCamera(
    'vorschauKamera',
    // Augenhoehe ueber dem Spawnpunkt — 1,7 m, nicht 0: der Spawnpunkt ist die
    // STANDflaeche, und eine Kamera auf Bodenniveau steckt in der Bodenplatte.
    // Eye height above the spawn point — the spawn point is the STANDING
    // surface, and a camera at floor level sits inside the slab.
    bauer.spawnPunkt.add(new Vector3(0, 1.7, 0)),
    scene
  );
  kamera.minZ = 0.1;
  kamera.maxZ = 200;
  kamera.speed = TEMPO / 60;
  kamera.attachControl(leinwand, true);
  kamera.keysUp = [87, 38];
  kamera.keysDown = [83, 40];
  kamera.keysLeft = [65, 37];
  kamera.keysRight = [68, 39];

  // Optionale Kamera-Vorgabe aus der URL (?px=&py=&pz=&blick=Grad&neigung=Grad)
  // — fuer reproduzierbare Beweisbilder an einer bestimmten Stelle des
  // Dungeons. `neigung` ist der Nickwinkel, positiv nach UNTEN (Babylon zaehlt
  // `rotation.x` so herum): ohne ihn laesst sich eine Treppe nur von der Seite
  // zeigen, nie von oben herab.
  // Optional camera pose from the URL — for reproducible proof shots.
  // `neigung` is the pitch, positive DOWNWARD (that is how Babylon counts
  // `rotation.x`): without it a staircase can only be shown from the side,
  // never looking down it.
  const px = params.get('px'); const pz = params.get('pz');
  if (px !== null && pz !== null) {
    kamera.position.set(Number(px), zahl(params, 'py', kamera.position.y), Number(pz));
  }
  const blick = params.get('blick');
  if (blick !== null) kamera.rotation.y = (Number(blick) * Math.PI) / 180;
  const neigung = params.get('neigung');
  if (neigung !== null) kamera.rotation.x = (Number(neigung) * Math.PI) / 180;

  // Debug-Handle fuer Werkzeuge und Konsole — nur die Vorschau tut das.
  // Debug handle for tooling and the console — only the preview does this.
  (window as unknown as Record<string, unknown>).dungeon2Vorschau = { kamera, bauer };

  const atmosphaere = new DungeonAtmosphaere(scene, kamera, stufe, ambientLicht, grundlicht);
  atmosphaere.betrete();
  bauer.setzeStufe(stufe);

  // Der Pool holt sich die naechsten Fackeln aus den Deko-Ankern des Bauers —
  // dieselbe Schnittstelle, ueber die im Dorf die Lagerfeuer leuchten. Der
  // Dungeon macht KEINE eigenen Lichter auf.
  // The pool takes the nearest torches from the builder's decor anchors — the
  // same interface village camp fires use. The dungeon opens NO lights of its own.
  const pool = new LightPool(scene, (x, z, radius) => bauer.lichtquellen(x, z, radius));

  const s = bauer.statistik();
  meldung(
    `Seed ${seeds.architektur} · ${layout.stempel.length} Stempel · ${s.bloeckeGebaut}/${s.bloeckeGesamt} Blöcke · ` +
      `${s.meshes} Meshes · ${s.dreiecke} Dreiecke · ${s.koerper} Körper (${s.formen} Formen) · ` +
      `${bauer.dekoTeile.length} Deko (${deko.platziert} sichtbar` +
      (deko.ohneModell > 0 ? `, ${deko.ohneModell} ohne Modell [${deko.prefabsOhneModell.join(', ')}]` : '') +
      `) · Physik ${physikGewuenscht ? (scene.getPhysicsEngine() === null ? 'AUS (Start fehlgeschlagen)' : 'Havok') : 'aus'} · ` +
      `Layout ${dauerLayout.toFixed(1)} ms · Spawn ${dauerSpawn.toFixed(1)} ms · ` +
      `alles ${dauerBau.toFixed(1)} ms · Deko ${dauerDeko.toFixed(1)} ms · ` +
      `Material ${arrays === null ? 'grau' : 'Arrays'} · ` +
      `${plaetze} Fackelplätze · Grundhelligkeit ${ambientLicht.toFixed(2)} ` +
      `(Licht ${licht.intensity.toFixed(3)})` +
      (bericht.rueckfall ? ' · RÜCKFALLFORM' : '')
  );

  // Diagnosefenster wie im Spielclient (`__vb`): ohne so einen Griff misst man
  // nichts nach, ohne die Seite neu zu bauen.
  // A diagnostic handle as in the game client — without one, nothing can be
  // re-measured without a rebuild.
  (window as unknown as { __dg2: unknown }).__dg2 = {
    bauer,
    atmosphaere,
    layout,
    bericht,
    pool,
    statistik: () => bauer.statistik(),
    fackeln: () => ({ plaetze: FackelLichter.plaetze, an: FackelLichter.anzahl }),
    ambient: () => ({ ...atmosphaere.werte(), lichtIntensitaet: licht.intensity }),
    deko: () => bauer.dekoStatistik,
    stufe: (n: number) => {
      atmosphaere.setzeStufe(n as DungeonGrafikStufe);
      bauer.setzeStufe(n as DungeonGrafikStufe);
      return bauer.statistik();
    },
  };

  engine.runRenderLoop(() => {
    // `getDeltaTime()` in Sekunden — der Pool rechnet damit sein Flackern, und
    // ein festes 1/60 liesse es auf schnellerer Hardware schneller flackern.
    // Delta time in seconds — a fixed 1/60 would make the flicker run faster on
    // faster hardware.
    pool.update(kamera.position.x, kamera.position.y, kamera.position.z, engine.getDeltaTime() / 1000);
    scene.render();
  });
  window.addEventListener('resize', () => engine.resize());
}

void starte().catch((fehler: unknown) => {
  console.error('[dungeon2-vorschau]', fehler);
  meldung(`Fehler: ${String(fehler)}`);
});
