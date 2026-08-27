/**
 * Welt — die Einheit „ein Spielraum mit allem, was dazugehört".
 *
 * ── Warum es diese Klasse gibt ───────────────────────────────────────
 * Bis hierher gab es genau EINE Welt, und ihre Bausteine hingen als
 * Felder am `WovServer`: `geo`, `heightmaps`, `zdos`, `zones`, `spawns`,
 * `aggro`, `routen`. Dungeon-Instanzen behalfen sich deshalb mit einem
 * Koordinatenband ab x = 100.000 im SELBEN ZDO-Raum — mit dem Preis, den
 * float32 dort verlangt: Zwei benachbarte darstellbare Werte liegen bei
 * 100.000 ganze 7,8 mm auseinander, und das sieht man an Kanten, die
 * zittern, und an Flächen, die miteinander streiten.
 *
 * Diese Klasse dreht das um. Eine Welt ist ein Objekt, das seine Systeme
 * BESITZT und selbst tickt. Die Hauptwelt wird genauso gebaut wie eine
 * Dungeon-Instanz; es gibt keinen Sonderfall und keine zweite Bauform.
 *
 * ── Die Regel, die daraus folgt ──────────────────────────────────────
 * Wer dem Spiel ein neues weltgebundenes System hinzufügt, hängt es HIER
 * hinein und tickt es in `tick()`. Dann hat jede Instanz es automatisch
 * mit — ohne dass irgendwo eine zweite Liste gepflegt werden muss. Ein
 * System, das statt dessen am Server hängt, ist damit eine bewusste
 * Aussage: „gilt nur für die Hauptwelt". Genau diese Aussage war vorher
 * unsichtbar, weil es gar nichts anderes gab.
 *
 * ── Was eine Instanz anders macht, ist ihre GEO, nicht ihre Bauform ──
 * Ein Dungeon hat kein Gelände. Er bekommt deshalb keine abgespeckte
 * Welt, sondern eine mit `LeereGeo` — flacher Boden, ein Biom, keine
 * Vegetation, keine Locations. Kommen später Instanzen mit Landmassen
 * dazu, bekommen sie eine echte Geo und sonst nichts Neues.
 */

import type { HeightmapProvider, IGeo, Vector3 } from '@wov/shared';
import type { GeoManager } from '@wov/shared';
import { ZDOManager } from '../zdo/ZDOManager.js';
import { ZoneManager, type ZoneManagerOptions } from './ZoneManager.js';
import { SpawnSystem } from './SpawnSystem.js';
import { AggroSystem } from './AggroSystem.js';
import { RoutenLaeufer } from './RoutenLaeufer.js';

/** Stabile Kennung der einen Spielwelt. */
export const HAUPTWELT_ID = 'haupt';

/**
 * Was eine Welt vom Server braucht, ohne ihn zu kennen.
 *
 * Bewusst zwei schmale Rückrufe statt einer Server-Referenz: Eine Welt,
 * die den `WovServer` hält, könnte alles — und dann wandert beim nächsten
 * Umbau wieder Weltlogik in den Server zurück, weil es so bequem ist.
 */
export interface WeltUmgebung {
  /** Prefab-Name zu einem Hash — ohne ihn ist eine ZDO nur eine Zahl. */
  prefabName(hash: number): string | undefined;
  /**
   * Eine Kreatur trifft. Wen sie trifft, weiß nur der Server (er hält die
   * Peers); dass sie trifft, weiß nur die Welt.
   */
  kreaturTrifft(pos: Vector3, schaden: number, radius: number): void;
}

export interface WeltBauplan {
  readonly id: string;
  readonly geo: IGeo;
  readonly heightmaps: HeightmapProvider;
  /** C++ GeoManager()->GetSeed() = getStableHash(worldSeed). */
  readonly zonenSeed: number;
  readonly zonenOptionen?: ZoneManagerOptions;
  /** Kreaturen-Spawnsystem anlegen? (server.yml `world.creatures`) */
  readonly mitKreaturen: boolean;
  /**
   * Vorhandener ZDO-Raum. Die Hauptwelt reicht ihren eigenen herein, weil
   * er im Konstruktor des Servers entsteht — vor jeder Geo. Eine Instanz
   * lässt ihn hier anlegen.
   */
  readonly zdos?: ZDOManager;
  readonly serverUserId: bigint;
}

export class Welt {
  readonly id: string;
  readonly geo: IGeo;
  readonly heightmaps: HeightmapProvider;
  readonly zdos: ZDOManager;
  readonly zones: ZoneManager;
  /** Null nur, wenn `world.creatures` global aus ist — nicht je Welt. */
  readonly spawns: SpawnSystem | null;
  readonly aggro: AggroSystem;
  readonly routen: RoutenLaeufer;

  constructor(bauplan: WeltBauplan, umgebung: WeltUmgebung) {
    this.id = bauplan.id;
    this.geo = bauplan.geo;
    this.heightmaps = bauplan.heightmaps;
    this.zdos = bauplan.zdos ?? new ZDOManager(bauplan.serverUserId);

    this.zones = new ZoneManager(
      this.geo as GeoManager,
      this.heightmaps,
      this.zdos,
      bauplan.zonenSeed,
      bauplan.zonenOptionen ?? {}
    );

    this.spawns = bauplan.mitKreaturen
      ? new SpawnSystem(this.zdos, this.geo as GeoManager, this.heightmaps, this.zones)
      : null;
    if (this.spawns) {
      this.spawns.onCreatureAttack = (pos, dmg, r) => umgebung.kreaturTrifft(pos, dmg, r);
    }

    // Die Höhe kommt bei BEIDEN aus derselben Quelle wie Spawn-Höhe und
    // Kreaturen. Ein Verfolger, der seine Höhe aus der alten Position
    // fortschriebe, liefe den Hügel waagerecht hinauf.
    this.routen = new RoutenLaeufer(this.zdos, (x, z) => this.bodenHoehe(x, z));
    this.aggro = new AggroSystem(
      this.zdos,
      (hash) => umgebung.prefabName(hash),
      (x, z) => this.bodenHoehe(x, z)
    );
    // Der RoutenLaeufer bekommt die Menge der gerade kämpfenden NPCs,
    // damit er ihnen nicht ins Steuer greift.
    this.routen.gesperrt = this.aggro.gesperrt;
  }

  /** Geländehöhe dieser Welt — die Wahrheit über y, für alles. */
  bodenHoehe(x: number, z: number): number {
    return this.heightmaps.getGroundHeight(x, z);
  }

  /**
   * Ein Tick dieser Welt.
   *
   * `positionen` sind die Spieler IN DIESER WELT. Eine Welt ohne Spieler
   * bekommt eine leere Liste und rechnet dann fast nichts — Vegetation,
   * Kreaturen und Routen hängen alle am Umkreis der Spieler. Genau
   * deshalb kostet eine leerstehende Instanz nichts.
   */
  tick(deltaSec: number, positionen: readonly Vector3[]): { neueZonen: number } {
    const neueZonen = this.zones.update(positionen);
    this.spawns?.update(deltaSec, positionen);
    this.routen.update(deltaSec, positionen);
    this.aggro.update(deltaSec, positionen);
    return { neueZonen };
  }

  /** Diagnose für Log und Admin-Ausgabe. */
  get zdoAnzahl(): number {
    return this.zdos.totalZDOCount;
  }
}
