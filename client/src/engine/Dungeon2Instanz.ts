/**
 * Der SPIELWEG einer Dungeon-2.0-Instanz (AP13) — vom empfangenen Deskriptor
 * bis zur begehbaren Instanz, und wieder zurueck.
 * The GAME path of a dungeon 2.0 instance — from the received descriptor to a
 * walkable instance, and back again.
 *
 * Es gibt diese Datei, damit `main.ts` fuer den ganzen 2.0-Weg fuenf Zeilen
 * bekommt statt hundertfuenfzig: `betrete()`, `weiterbauen()`, `verlasse()`.
 * `main.ts` ist ohnehin die laengste Datei des Clients, und was dort nicht
 * steht, kann dort auch nicht mit dem Wetter, dem Gras und der Minimap
 * verheddern.
 * This file exists so `main.ts` gets five lines for the whole 2.0 path instead
 * of a hundred and fifty.
 *
 * DIE REIHENFOLGE IST DER INHALT DIESER DATEI. Sie steht so und nicht anders,
 * und jeder Schritt hat einen Grund, den ein spaeterer Umbau kennen muss:
 *
 *   1. Layout aus dem Deskriptor erzeugen und die Pruefsumme vergleichen.
 *      Weicht sie ab, wird es LAUT gemeldet und trotzdem gebaut — ein
 *      Spieler, der in einem leeren Nichts steht, ist schlimmer als einer,
 *      der in einem leicht anderen Grab steht. Aber still darf es nie sein.
 *   2. Materialtexturen laden (fehlschlagen erlaubt: dann graue Kaesten).
 *   3. `new DungeonBauer(...)` — NACH der Physik, nie davor: Der Bauer fragt
 *      `scene.getPhysicsEngine()` und legt ohne Antwort schweigend keine
 *      Koerper an. In `main.ts` steht Havok laengst, das ist hier nur die
 *      Begruendung, warum diese Klasse nichts daran aendert.
 *   4. `baueSpawnBloecke()` und auf `dungeonBereit` warten. ERST DANN darf
 *      der Ladebildschirm weg und die Figur auftauen.
 *   5. Deko und Atmosphaere danach — beides ist Optik und darf nachziehen.
 *
 * THE ORDER IS THE CONTENT OF THIS FILE.
 */

import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Scene } from '@babylonjs/core/scene';
import { dungeon2 } from '@wov/shared';
import { DungeonAtmosphaere, type Grundlicht } from './DungeonAtmosphere.js';
import { DungeonBauer, formOberkante, type KollisionsForm } from './DungeonBuilder.js';
import type { DekoModellQuelle } from './DungeonDeko.js';
import type { Lichtquelle } from './LightPool.js';
import { STEINGRAB_THEMA, dungeonStufe, type DungeonGrafikStufe } from './DungeonMaterial.js';
import {
  ladeDungeonMaterialArrays,
  type DungeonMaterialArrays,
} from './DungeonMaterialArrays.js';

/**
 * Wo die Materialsaetze liegen koennen. Zwei Pfade, weil der Dev-Server den
 * Repo-Ordner `assets/` unter `/assets/` ausliefert und ein Produktivbau die
 * Dateien flach unter `/dungeon2/` erwartet. Es wird der erste genommen, der
 * antwortet — geraten wird nicht.
 * Where the material sets may live. Two paths; the first that answers wins.
 */
const ARRAY_PFADE = ['/assets/dungeon2/', '/dungeon2/'] as const;

/** Was der Client aus dem Teleportpaket ueber die Instanz erfaehrt. */
/** What the client learns about the instance from the teleport packet. */
export interface Dungeon2Deskriptor {
  readonly thema: string;
  readonly seeds: dungeon2.LayoutSeeds;
  readonly pruefsumme: string;
  readonly layoutVersion: number;
  readonly id: string;
  readonly name: string;
  /**
   * Grundhelligkeit dieser Instanz (0..1), vom Server bereits aufgeloest
   * (Dokument schlaegt Thema, `dungeon2.ambientLichtVon`). 1 = wie bisher,
   * 0 = stockdunkel, nur die Fackeln.
   * Base brightness (0..1), already resolved by the server.
   */
  readonly ambientLicht: number;
  /**
   * Das MITGELIEFERTE Layout als JSON — nur bei handgebauten Graebern
   * (`modus === 'gebaut'`) gesetzt, sonst leer/fehlend. Ein solches Grab
   * laesst sich aus seinen Seeds nicht wiederherstellen; ohne dieses Feld
   * baut der Client das URSPRUENGLICHE Grab und wirft jede Handarbeit weg
   * (Befund 01.09.2026 — „nachtraeglich gesetzte Raeume fehlen im Spiel").
   * The SHIPPED layout as JSON — set only for hand-built graves; a seed-only
   * descriptor cannot carry hand edits.
   */
  readonly layoutJson?: string;
}

export interface Dungeon2Umgebung {
  readonly scene: Scene;
  readonly kamera: Camera;
  /** Der `AssetManager` der Szene — geteilt, nicht eigens angelegt. */
  readonly assets: DekoModellQuelle;
  /** HUD-Zeile. / HUD line. */
  readonly meldung: (text: string) => void;
  /**
   * Die Weltbeleuchtung, an der die Grundhelligkeit anliegt. Optional, weil
   * ein Prüfstand ohne sie auskommen soll — im Spielweg ist sie immer da.
   * The world lighting the base brightness applies to.
   */
  readonly licht?: Grundlicht;
}

/** Zahlen eines Betretens — fuer die Messung und fuer `window.__dg2live`. */
/** Numbers of one entry — for measurement and for `window.__dg2live`. */
export interface Dungeon2Messung {
  readonly id: string;
  readonly pruefsummeErwartet: string;
  readonly pruefsummeGerechnet: string;
  readonly abweichung: boolean;
  readonly layoutFehler: number;
  /** ms von `betrete()` bis `dungeonBereit`. / ms until the spawn blocks stand. */
  readonly msBisBereit: number;
  /** ms bis zum vollstaendigen Bau. / ms until everything is built. */
  msBisVollstaendig: number;
  readonly bloecke: number;
  readonly meshes: number;
  readonly koerper: number;
  readonly arraysGeladen: boolean;
  dekoPlatziert: number;
  dekoOhneModell: number;
}

/**
 * Das mitgelieferte Layout-JSON zu einem Objekt lesen. Ein kaputter String
 * ergibt `null` — `migriere()` weist ihn dann als unbrauchbar ab, und
 * `betrete()` bricht LAUT ab, statt still das falsche Seed-Grab zu bauen.
 * Parse the shipped layout JSON; a broken string yields `null`, which
 * `migriere()` rejects and `betrete()` reports loudly.
 */
function leseLayoutJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export class Dungeon2Instanz {
  private readonly atmosphaere: DungeonAtmosphaere;
  private formenZwischenspeicher: KollisionsForm[] | null = null;
  private begonnen = performance.now();

  private constructor(
    readonly deskriptor: Dungeon2Deskriptor,
    readonly layout: dungeon2.DungeonLayout2,
    readonly bauer: DungeonBauer,
    readonly messung: Dungeon2Messung,
    private readonly umgebung: Dungeon2Umgebung
  ) {
    this.atmosphaere = new DungeonAtmosphaere(
      umgebung.scene,
      umgebung.kamera,
      dungeonStufe(),
      deskriptor.ambientLicht,
      umgebung.licht ?? null,
      // Die Lichtschaechte kommen aus dem BAUER, also aus dem Layout, das
      // dieser Client selbst gerechnet hat — nicht aus dem Deskriptor. Der
      // Server schickt nie Geometrie (ARCHITECTURE §3), und eine Liste von
      // Weltpositionen waere genau das.
      // The shafts come from the BUILDER, i.e. from the layout this client
      // computed itself — the server never sends geometry, and a list of world
      // positions would be exactly that.
      bauer.lichtschaechte
    );
  }

  /**
   * Eine 2.0-Instanz betreten. Loest auf, sobald die Bloecke um den Spawn
   * stehen — der Aufrufer darf ab da den Ladebildschirm nehmen und die Figur
   * auftauen, und keinen Frame frueher.
   * Enter a 2.0 instance. Resolves as soon as the blocks around the spawn
   * stand — not one frame earlier.
   */
  static async betrete(
    deskriptor: Dungeon2Deskriptor,
    umgebung: Dungeon2Umgebung
  ): Promise<Dungeon2Instanz | null> {
    const begonnen = performance.now();
    // Ein handgebautes Grab reist mit SEINEM Layout an (`layoutJson`); daraus
    // wird gebaut, nicht aus den Seeds. Fehlt das Feld (erzeugtes Grab, oder
    // aelterer Server), gilt der Seed-Weg wie bisher.
    // A hand-built grave ships its OWN layout; build from that, not the seeds.
    const erg = deskriptor.layoutJson
      ? dungeon2.layoutAusMitgeliefert(leseLayoutJson(deskriptor.layoutJson), deskriptor.pruefsumme)
      : dungeon2.layoutAusDeskriptor(deskriptor);
    if (erg.layout === null) {
      console.error(
        deskriptor.layoutJson
          ? `[dungeon2] Mitgeliefertes Layout unbrauchbar — '${deskriptor.id}' nicht baubar.`
          : `[dungeon2] Layout nicht herstellbar — Thema '${deskriptor.thema}' unbekannt?`
      );
      umgebung.meldung('Dungeon konnte nicht gebaut werden');
      return null;
    }
    if (erg.abweichung) {
      // LAUT, nicht still. Der Grund steht in ARCHITECTURE.md §1.3: Ein
      // stiller Rueckfall waere die Bauform, bei der man ein Jahr spaeter
      // merkt, dass der Determinismus seit Monaten kaputt ist.
      // LOUD, not silent.
      console.error(
        `[dungeon2] PRÜFSUMME WEICHT AB — Server ${erg.erwartet}, Client ${erg.gerechnet}. ` +
          `Server und Client erzeugen aus denselben Seeds VERSCHIEDENE Gräber.`
      );
      umgebung.meldung('Dungeon: Prüfsumme weicht ab — siehe Konsole');
    }
    if (erg.befunde.length > 0) {
      console.error(
        `[dungeon2] ${erg.befunde.length} Layout-Fehler: ` +
          erg.befunde.slice(0, 5).map((b) => b.regel).join(', ')
      );
    }

    const arrays = await ladeArrays(umgebung.scene);

    const bauer = new DungeonBauer(umgebung.scene, erg.layout, {
      thema: STEINGRAB_THEMA,
      arrays,
      // Ausdruecklich statt hergeleitet: Steht Havok noch nicht (der
      // `initPhysics`-Aufruf in `main.ts` laeuft nebenher), waere die
      // Herleitung `scene.getPhysicsEngine() !== null` ein stilles `false`
      // — und ein Grab ganz ohne Kollision sieht genauso aus wie eines mit.
      // Explicit instead of derived: without this a race with `initPhysics`
      // would silently yield a dungeon with no collision at all.
      physik: umgebung.scene.getPhysicsEngine() !== null,
    });
    bauer.baueSpawnBloecke();
    await bauer.dungeonBereit;
    const msBisBereit = performance.now() - begonnen;
    const stat = bauer.statistik();

    const messung: Dungeon2Messung = {
      id: deskriptor.id,
      pruefsummeErwartet: erg.erwartet,
      pruefsummeGerechnet: erg.gerechnet,
      abweichung: erg.abweichung,
      layoutFehler: erg.befunde.length,
      msBisBereit,
      msBisVollstaendig: 0,
      bloecke: stat.bloeckeGesamt,
      meshes: stat.meshes,
      koerper: stat.koerper,
      arraysGeladen: arrays !== null,
      dekoPlatziert: 0,
      dekoOhneModell: 0,
    };

    const instanz = new Dungeon2Instanz(deskriptor, erg.layout, bauer, messung, umgebung);
    instanz.begonnen = begonnen;
    instanz.atmosphaere.betrete();
    console.log(
      `[dungeon2] '${deskriptor.id}' baubereit nach ${msBisBereit.toFixed(0)} ms ` +
        `(${stat.bloeckeGebaut}/${stat.bloeckeGesamt} Blöcke, ${stat.meshes} Meshes, ` +
        `${stat.koerper} Körper, Prüfsumme ${erg.gerechnet})`
    );

    // Deko laeuft NEBENHER weiter — sie laedt GLBs ueber das Netz, und
    // darauf soll der Ladebildschirm nicht warten. Die Rollen, die der
    // Server als ZDO schickt, werden ausgelassen (`ROLLEN_MIT_ZDO`).
    // Decor continues ALONGSIDE — it loads GLBs over the network.
    void bauer
      .baueDeko(umgebung.assets, dungeon2.ROLLEN_MIT_ZDO)
      .then((s) => {
        instanz.messung.dekoPlatziert = s.platziert;
        instanz.messung.dekoOhneModell = s.ohneModell;
        console.log(
          `[dungeon2] Deko: ${s.platziert} gesetzt, ${s.ohneModell} ohne Modell` +
            (s.prefabsOhneModell.length > 0 ? ` (${s.prefabsOhneModell.join(', ')})` : '')
        );
      })
      .catch((e: unknown) => console.warn('[dungeon2] Deko fehlgeschlagen:', e));

    return instanz;
  }

  /**
   * Einen Schwung weiterer Bloecke bauen — gehoert in die Bildschleife, an
   * dieselbe Stelle, an der die Oberwelt ihr Gelaende streamt.
   * Build the next batch of blocks — belongs in the frame loop.
   */
  weiterbauen(): void {
    // Die Atmosphaere zuerst — und AUSSERHALB der `vollstaendig`-Schranke
    // darunter. Die Godrays suchen sich je Bild ihren Schacht; haengte der
    // Aufruf hinter dem `return`, hoerte der Effekt in dem Moment auf zu
    // folgen, in dem der Dungeon fertig gebaut ist — also immer dann, wenn man
    // ihn tatsaechlich anschaut.
    // The atmosphere first, and OUTSIDE the `vollstaendig` guard below: behind
    // the `return`, the godrays would stop following the moment the dungeon is
    // finished — i.e. exactly when one is looking at it.
    const k = this.umgebung.kamera.globalPosition;
    this.atmosphaere.aktualisiere(k.x, k.y, k.z);
    if (this.bauer.vollstaendig) return;
    const rest = this.bauer.baueWeiter();
    this.formenZwischenspeicher = null;
    if (!rest) {
      this.messung.msBisVollstaendig = performance.now() - this.begonnen;
      console.log(
        `[dungeon2] '${this.deskriptor.id}' vollständig nach ` +
          `${this.messung.msBisVollstaendig.toFixed(0)} ms ` +
          `(${this.bauer.statistik().meshes} Meshes)`
      );
    }
  }

  /** Ob die Bloecke um den Spawn stehen. / Whether the spawn blocks stand. */
  get bereit(): boolean {
    return this.bauer.bereit;
  }

  /**
   * Grafikstufe zur Laufzeit umstellen — Material, Nachbearbeitung UND
   * Geometrie.
   *
   * Alle drei, weil die Stufe im Dungeon nicht nur Nachbearbeitung ist: Der
   * Bauer legt auf Niedrig andere Geometrie zusammen (`DungeonBauer.setzeStufe`
   * baut deshalb neu), die Atmosphaere haengt SSAO, Godrays und SSR um, und
   * das Material wechselt seine Defines. Wer nur eines davon ruft, bekommt
   * einen halb umgestellten Dungeon — und der sieht nicht nach „halb" aus,
   * sondern nach einem Fehler an der Stelle, die man gerade ansieht.
   * Switch the graphics tier at runtime — material, post processing AND
   * geometry. Calling only one of the three yields a half-switched dungeon,
   * which does not look "half" but like a bug wherever one happens to look.
   */
  setzeStufe(stufe: DungeonGrafikStufe): void {
    this.atmosphaere.setzeStufe(stufe);
    this.bauer.setzeStufe(stufe);
  }

  /** Nur zum Messen: die Werte der Atmosphaere. / For measuring only. */
  get atmosphaereWerte(): ReturnType<DungeonAtmosphaere['werte']> {
    return this.atmosphaere.werte();
  }

  /**
   * Boden unter einem Punkt — aus den KOLLISIONSFORMEN des Bauers, nicht aus
   * einem Havok-Strahl.
   *
   * Warum es das gibt: `main.ts` taut die Figur auf, sobald `bodenSonde` unter
   * ihr etwas findet, und die Sonde strahlt in die Havok-Welt. Das ist der
   * richtige Zeuge, aber ein zweiter schadet nicht — er antwortet auch dann,
   * wenn Havok noch gar nicht steht, und er misst genau das, was der Bauer
   * gebaut zu haben behauptet.
   * Ground below a point — from the builder's COLLISION SHAPES, not a ray.
   */
  bodenOberkante(x: number, z: number): number | null {
    this.formenZwischenspeicher ??= this.bauer.formen();
    let hoechste: number | null = null;
    for (const form of this.formenZwischenspeicher) {
      const y = formOberkante(form, x, z);
      if (y !== null && (hoechste === null || y > hoechste)) hoechste = y;
    }
    return hoechste;
  }

  /**
   * Die Lichtquellen DIESER Instanz — die Schnittstelle, aus der sich der
   * `LightPool` des Spiels speist, solange man drin steht.
   *
   * WARUM ES DIESE ZEILE BRAUCHT (Befund vom 31.08.2026, `fackeln 0/16 array`
   * im Debug-Overlay): Der Pool des Spiels wird EINMAL beim Weltaufbau
   * angelegt und fragt `EntityManager.lichtquellen()` — also die ZDO-
   * Entitaeten. Die Fackeln eines 2.0-Grabs sind aber ausdruecklich KEINE
   * ZDOs (`ROLLEN_MIT_ZDO` fuehrt nur `truhe` und `spawner`), sondern Thin
   * Instances des Clients. Der Pool fand deshalb in einem Grab mit
   * fuenfzig Fackeln genau null Quellen — und ein Pool ohne Quellen sieht
   * von aussen aus wie ein Dungeon ohne Fackeln, nicht wie ein falsch
   * verdrahteter Pool.
   *
   * Die Vorschau (`dungeon2Preview.ts`) hatte die Kopplung von Anfang an
   * (`new LightPool(scene, (x, z, r) => bauer.lichtquellen(x, z, r))`) und
   * sah deshalb richtig aus. Genau das ist die Falle: Zwei Wege, von denen
   * nur einer verdrahtet ist, und der verdrahtete ist der, den man ansieht.
   *
   * This instance's light sources — the interface the game's `LightPool`
   * feeds from while the player is inside. The game pool is created ONCE at
   * world build time and asks the ZDO entities; a 2.0 barrow's torches are
   * deliberately NOT ZDOs but client thin instances, so the pool found zero
   * sources in a barrow with fifty torches.
   */
  lichtquellen(x: number, z: number, radius: number): Lichtquelle[] {
    return this.bauer.lichtquellen(x, z, radius);
  }

  /** Der ausdrueckliche Spawnpunkt des Bauers. / The builder's spawn point. */
  get spawnPunkt(): { x: number; y: number; z: number } {
    const p = this.bauer.spawnPunkt;
    return { x: p.x, y: p.y, z: p.z };
  }

  /**
   * Verlassen: Atmosphaere zuerst zurueckgeben, dann abreissen.
   *
   * Die Reihenfolge ist wichtig. `DungeonAtmosphaere.betrete()` haengt die
   * Postprocessing-Kette des Spiels von der Kamera AB und `verlasse()` haengt
   * genau dieselbe wieder an. Wer den Bauer zuerst entsorgt und dabei
   * stolpert, laesst die Oberwelt ohne Tiefenunschaerfe zurueck — ein Fehler,
   * den man erst zwei Raeume spaeter sieht.
   * Leaving: give the atmosphere back FIRST, then tear down.
   */
  verlasse(): void {
    this.atmosphaere.verlasse();
    this.atmosphaere.dispose();
    this.bauer.dispose();
    this.formenZwischenspeicher = null;
  }
}

/**
 * Materialsaetze laden. Ein Fehlschlag ist KEIN Fehlschlag des Betretens:
 * Ohne Arrays baut der Bauer graue Kaesten, und graue Kaesten sind begehbar.
 * Load the material sets. A failure is NOT a failure of entering.
 */
async function ladeArrays(scene: Scene): Promise<DungeonMaterialArrays | null> {
  for (const pfad of ARRAY_PFADE) {
    try {
      return await ladeDungeonMaterialArrays(scene, pfad);
    } catch {
      /* naechster Pfad / next path */
    }
  }
  console.warn('[dungeon2] Keine Materialsätze gefunden — graue Kästen');
  return null;
}
