/**
 * WaterDepthMap — Grundhöhe rund um den Spieler als Textur, 1 m je Texel.
 *
 * ── Wozu ────────────────────────────────────────────────────────────
 * Der Wassershader braucht die Wassersäule über dem Grund: sie steuert
 * Absorption, Schaumsaum und das discard trockengefallener Stellen.
 *
 * Bisher kam sie aus dem Vertex-Attribut `aDepth` — im 4-m-Raster der
 * Wassergeometrie, über die Fläche linear interpoliert. Das reicht für
 * die Wellenamplitude (die läuft ohnehin über 10 m hoch), aber nicht für
 * die Uferlinie: ein Schaumsaum von 0,2 m Breite auf einem 4-m-Gitter
 * wird zwangsläufig polygonal, und die discard-Kante folgt den Dreiecken
 * statt der Küste.
 *
 * Diese Textur löst 1 m auf — viermal feiner — und ist vom Gitter
 * entkoppelt.
 *
 * ── Warum diese Quelle und nicht der Tiefenpuffer ───────────────────
 * Naheliegend wäre, die Tiefe wie im Original aus dem Depth-Buffer zu
 * lesen. Beide verfügbaren Puffer scheiden aus:
 *
 *   • Der GeometryBuffer (für DOF/Motion-Blur) ENTHÄLT das Wasser selbst,
 *     man läse also die Tiefe der eigenen Fläche. Ausserdem existiert er
 *     nur, wenn DOF oder Motion-Blur eingeschaltet sind — das Wasser
 *     bräche bei einer Postprocessing-Einstellung. Und da Plugin-Code
 *     nicht in geometry.vertex.fx injiziert wird, stünde dort ohnehin die
 *     unverschobene Ebene ohne Wellen.
 *
 *   • Das Refraktions-RTT schliesst das Wasser zwar korrekt aus, gibt es
 *     aber bei "Wasserqualität: Aus" gar nicht — also genau dort nicht,
 *     wo die Durchsicht am dringendsten stimmen muss.
 *
 * Das Höhenfeld dagegen liegt bereits vor, ist exakt, unabhängig von
 * jeder Grafikeinstellung und billiger als der bisherige Bake: statt je
 * Vertex ein `getGroundHeight()` mit Zonen-Lookup wird hier zonenweise
 * direkt aus `Heightmap.heights` kopiert.
 *
 * ── Format ──────────────────────────────────────────────────────────
 * R32F. Halbes Float wäre sparsamer (und 3 cm ULP bei 30 m Höhe wären
 * reichlich genau), verlangt aber eine Float32→Float16-Umrechnung von
 * Hand. Lineares Filtern von 32-Bit-Float ist in WebGL2 nicht Kernumfang
 * (OES_texture_float_linear); fehlt die Erweiterung, fällt die Textur auf
 * NEAREST zurück — dann ist die Uferlinie 1-m-gerastert statt weich, aber
 * immer noch viermal feiner als vorher.
 */
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Vector4 } from '@babylonjs/core/Maths/math';
import type { Scene } from '@babylonjs/core/scene';
import { HeightmapProvider, E_WIDTH, ZONE_UNITS, WATER_LEVEL } from '@wov/shared';
import type { ClientWorld } from '../world/World';
// Nur der Typ und die Prüffunktion des gemeinsamen Terrain-Budgets —
// `import type` erzeugt keinen Laufzeit-Zyklus, `budgetOffen` ist eine
// freie Funktion und kein Teil der Klasse.
import { budgetOffen, zonenSchrittweiseAktiv, type TerrainBudget } from './Terrain';

/** Kantenlänge in Metern = Texeln. Deckt die Nahwasserfläche (512 m) ab. */
const SIZE = 512;
/**
 * Warum das Nachfüllen budgetiert ist (das Fenster kommt inzwischen von
 * aussen, s. `schritt()`).
 *
 * Vorher stand hier `ZONES_PER_FRAME = 9`, also eine feste Stückzahl. Das
 * ist genau der Fehler, den das Projekt in `Terrain`, `EntityManager` und
 * `Shadows` schon dreimal korrigiert hat: Der teure Teil ist nicht das
 * Kopieren, sondern `getZone()`, und das ist **variabel teuer** — eine
 * bereits erzeugte Zone kostet nichts, eine neue rechnet 65×65 Rauschwerte
 * durch. Neun neue Zonen in einem Frame sind deshalb kein Neuntel der
 * Arbeit, sondern der ganze Ruckler.
 *
 * Gemessen am 16.08.2026 in Mikes Umgebung: ein Einzelframe von **84,4 ms**
 * in `depthMap.schritt()`, während der Posten über den ganzen Lauf nur
 * 124 ms brauchte. Eine einzige Spitze, sonst nichts — die Signatur einer
 * unbudgetierten Schleife.
 *
 */
/**
 * Sollwert an Zonen je Frame — das Budget oben ist nur die OBERGRENZE.
 *
 * Dieselbe Lehre wie beim Ufer-Bake in Terrain.ts: Ein reines Zeitbudget
 * ist gierig. Liegen die Zonen im Cache, kostet das Kopieren fast nichts
 * und es passen weit mehr als neun hinein — aus einem seltenen Ausreisser
 * wird dann eine Dauerlast. Der Puffer muss aber gar nicht schnell fertig
 * werden: Neu gefuellt wird nur beim Wasserversatz, also alle 64 m.
 *
 * Neun Zonen als Soll (wie vorher), Budget als Notbremse fuer den Fall,
 * dass eine davon erst erzeugt werden muss.
 */
const ZONEN_SOLL = 9;
/**
 * Vertexzeilen je Schritt, wenn eine Zone fuer die Kachel erst erzeugt
 * werden muss — dieselbe Koernung wie im Gelaendestrom (Terrain.ts).
 */
const ZONEN_ZEILEN_JE_SCHRITT = 8;
/** Grundhöhe ausserhalb der Kachel: so tief, dass depth01 = 1 gilt. */
const AUSSERHALB_TIEFE = 40;

export class WaterDepthMap {
  readonly texture: RawTexture;
  /**
   * (originX, originZ, 1/SIZE, 0) — geht als `waterGroundInfo` ins UBO.
   * origin ist die Weltkoordinate des Texels (0,0).
   */
  readonly info = new Vector4(0, 0, 1 / SIZE, 0);

  private readonly daten = new Float32Array(SIZE * SIZE);
  private readonly heightmaps: HeightmapProvider;
  /**
   * Origin, die gerade AUFGEBAUT wird — sie kann der veröffentlichten
   * `info` um einige Frames voraus sein.
   *
   * Die Trennung ist der Kern des Ganzen: `info` geht als
   * `waterGroundInfo` in den Shader und muss immer zu dem passen, was
   * WIRKLICH in der Textur steht. Beides zugleich umzustellen hiess, dem
   * Shader für die Dauer des Aufbaus neue Koordinaten auf alte Höhen zu
   * geben — an der Küste liest er dann Landhöhe, wo Wasser ist, `wTiefe`
   * wird negativ und das discard löscht die komplette Fläche. Sichtbar
   * als kurzes, vollständiges Verschwinden des Wassers beim Überschreiten
   * einer Zonengrenze (vom Nutzer gemeldet: "nur für einen Bruchteil
   * einer Sekunde", beim langsamen Laufen Richtung Meer).
   */
  private zielX = 0;
  private zielZ = 0;
  /** Zonenkoordinaten der linken unteren Ecke der aktuellen Kachel. */
  private zoneX0 = 0;
  private zoneZ0 = 0;
  /** Laufindex über die abzudeckenden Zonen; -1 = nichts zu tun. */
  private naechsteZone = -1;
  /**
   * Ob `setzeMitte` schon einmal gelaufen ist. Ohne dieses Flag müsste
   * der Vergleich auf die Origin allein zurückfallen — und die steht
   * anfangs auf (0,0), was eine gültige Spielposition ist.
   */
  private initialisiert = false;
  /** Zonen je Achse, die die Kachel schneiden (SIZE/64 + 1). */
  private readonly zonenProAchse = SIZE / ZONE_UNITS + 1;

  constructor(scene: Scene, world: ClientWorld) {
    this.heightmaps = world.heightmaps;
    // Bis zum ersten Bake gilt überall "tief" — nie "trocken", sonst
    // verschwände die Fläche im ersten Frame per discard.
    this.daten.fill(WATER_LEVEL - AUSSERHALB_TIEFE);
    const linear = scene.getEngine().getCaps().textureFloatLinearFiltering;
    this.texture = RawTexture.CreateRTexture(
      this.daten,
      SIZE,
      SIZE,
      scene,
      /* generateMipMaps */ false,
      /* invertY */ false,
      linear ? Constants.TEXTURE_BILINEAR_SAMPLINGMODE : Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      Constants.TEXTURETYPE_FLOAT
    );
    // CLAMP: ausserhalb der Kachel greift ohnehin der Aussen-Zweig im
    // Shader, aber ein Wiederholen würde am Rand falsche Küsten spiegeln.
    this.texture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    this.texture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
  }

  /**
   * Kachel auf eine neue Mitte setzen (Weltkoordinaten, auf das
   * Zonenraster gesnappt — dieselben Werte wie die Wassermeshes).
   * Startet den verteilten Neuaufbau.
   */
  setzeMitte(mitteX: number, mitteZ: number): void {
    const originX = mitteX - SIZE / 2;
    const originZ = mitteZ - SIZE / 2;
    // Nur bei echtem Ortswechsel neu anfangen. Ein laufender Aufbau darf
    // NICHT zurückgesetzt werden — diese Methode läuft jeden Frame, und
    // ein Neustart je Frame käme nie ans Ende.
    if (this.initialisiert && originX === this.zielX && originZ === this.zielZ) return;
    this.initialisiert = true;
    // NUR das Ziel setzen. `info` bleibt auf der alten Kachel stehen, bis
    // die neuen Höhen wirklich in der Textur sind — siehe `zielX`.
    this.zielX = originX;
    this.zielZ = originZ;
    // Zone, deren Bereich [z*64-32, z*64+32) den linken unteren Rand
    // enthält. Der +32-Versatz ist die halbe Zone, um die das
    // Zonenzentrum gegen den Rand verschoben ist.
    this.zoneX0 = Math.floor((originX + ZONE_UNITS / 2) / ZONE_UNITS);
    this.zoneZ0 = Math.floor((originZ + ZONE_UNITS / 2) / ZONE_UNITS);
    this.naechsteZone = 0;
  }

  /** True, sobald die Kachel einmal vollständig gefüllt wurde. */
  get fertig(): boolean {
    return this.naechsteZone === -1;
  }

  /**
   * Ein Frame-Budget abarbeiten. Lädt den Puffer erst hoch, wenn alle
   * Zonen drin sind — ein Teil-Upload wäre sichtbar (halb alte, halb neue
   * Küste).
   */
  schritt(budget: TerrainBudget): void {
    if (this.naechsteZone < 0) return;
    // Das Zeitfenster kommt seit dem 21.08.2026 von aussen und gilt für
    // ALLE Terrain-Posten zusammen. Vorher hatte diese Methode ein
    // eigenes 4-ms-Budget mit eigener "mindestens eins"-Ausnahme — und
    // konnte damit im selben Frame zuschlagen wie ein Chunk-Bau und eine
    // Ufer-Reihe. Begründung und Messwerte: `TERRAIN_BUDGET_MS`.
    //
    // Aufschieben ist hier gefahrlos: Bis der neue Puffer steht, arbeitet
    // der Shader weiter mit der alten, vollständigen Kachel (s. `zielX`).
    if (!budgetOffen(budget)) return;
    const gesamt = this.zonenProAchse * this.zonenProAchse;
    const ende = budget.ende;
    const soll = Math.min(gesamt, this.naechsteZone + ZONEN_SOLL);
    let n = this.naechsteZone;
    for (; n < soll; n++) {
      const fertig = this.kopiereZone(
        this.zoneX0 + (n % this.zonenProAchse),
        this.zoneZ0 + Math.floor(n / this.zonenProAchse)
      );
      budget.gebaut = true;
      // Noch nicht fertige Zone: NICHT weiterzaehlen, sonst bliebe ihr
      // Streifen in der Kachel auf der Grundhoehe stehen.
      if (!fertig) break;
      if (performance.now() >= ende) {
        n++;
        break;
      }
    }
    this.naechsteZone = Math.min(n, gesamt);
    if (this.naechsteZone >= gesamt) {
      this.naechsteZone = -1;
      // Upload und Origin-Wechsel im selben Frame: ab hier passen
      // Koordinaten und Höhen wieder zusammen. Bis dahin hat der Shader
      // durchgehend mit der alten, vollständigen Kachel gearbeitet — die
      // deckt nach 64 m Versatz noch 448 der 512 m ab, und für den
      // fehlenden Randstreifen greift ohnehin der Aussen-Zweig ("tief").
      this.texture.update(this.daten);
      this.info.x = this.zielX;
      this.info.y = this.zielZ;
    }
  }

  /**
   * Nach Terraforming: betroffene Zonen sind neu zu lesen. Der Aufwand,
   * einzelne Zonen nachzuziehen, lohnt gegenüber dem Neuaufbau nicht —
   * ein voller Durchlauf kostet ZONES_PER_FRAME-verteilt ~9 Frames.
   */
  invalidiere(): void {
    this.naechsteZone = 0;
  }

  /**
   * Wie `invalidiere()`, aber nur wenn eine der Zonen überhaupt auf der
   * Kachel liegt.
   *
   * Der Unterschied ist nicht akademisch: Diese Methode hängt am
   * Grabungspfad (`Terrain.refreshZones`), und der läuft bei JEDEM
   * Hackenschlag. Ohne die Prüfung würde eine Grabung am anderen Ende der
   * Welt — ein zweiter Spieler, eine Location beim Weltaufbau — hier
   * einen vollen Neuaufbau über 64 Zonen auslösen.
   */
  invalidiereZonen(zones: ReadonlyArray<readonly [number, number]>): void {
    for (const [zx, zz] of zones) {
      if (
        zx >= this.zoneX0 &&
        zx < this.zoneX0 + this.zonenProAchse &&
        zz >= this.zoneZ0 &&
        zz < this.zoneZ0 + this.zonenProAchse
      ) {
        this.naechsteZone = 0;
        return;
      }
    }
  }

  /**
   * Eine 64×64-Zone in den Puffer kopieren.
   *
   * `heights` liegt auf ganzzahligen Weltkoordinaten (E_WIDTH = 65
   * Vertices je Achse, geteilte Ränder zwischen Nachbarzonen), und die
   * Kachel-Origin ist immer ganzzahlig — der Index ist deshalb reine
   * Ganzzahlarithmetik ohne die Rundung aus `getGroundHeight`.
   */
  private kopiereZone(zx: number, zz: number): boolean {
    // Zeilenweise holen statt am Stueck (Paket G13): Eine noch unbekannte
    // Zone kostete hier rund 9 ms in EINEM Bild — das Budget oben konnte
    // das nicht verhindern, weil `getZone()` entweder ganz oder gar nicht
    // rechnet. `null` heisst: diese Zone ist noch nicht fertig, der
    // Aufrufer kommt im naechsten Bild wieder. Gefahrlos, weil der Shader
    // bis zum Upload weiter mit der alten, vollstaendigen Kachel arbeitet.
    const hm = zonenSchrittweiseAktiv()
      ? this.heightmaps.zoneSchrittweise(zx, zz, ZONEN_ZEILEN_JE_SCHRITT)
      : this.heightmaps.getZone(zx, zz);
    if (hm === null) return false;
    // Gegen die ZIEL-Origin, nicht gegen die veröffentlichte: der Puffer
    // wird für die neue Kachel gefüllt, `info` zeigt bis zum Upload noch
    // auf die alte.
    const basisX = zx * ZONE_UNITS - ZONE_UNITS / 2 - this.zielX;
    const basisZ = zz * ZONE_UNITS - ZONE_UNITS / 2 - this.zielZ;
    for (let vy = 0; vy < ZONE_UNITS; vy++) {
      const j = basisZ + vy;
      if (j < 0 || j >= SIZE) continue;
      const zeileTex = j * SIZE;
      const zeileHm = vy * E_WIDTH;
      for (let vx = 0; vx < ZONE_UNITS; vx++) {
        const i = basisX + vx;
        if (i < 0 || i >= SIZE) continue;
        this.daten[zeileTex + i] = hm.heights[zeileHm + vx];
      }
    }
    return true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
