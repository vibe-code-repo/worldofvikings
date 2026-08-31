/**
 * Materialisierung einer 2.0-Instanz — ZDOs NUR fuer Bewegliches und
 * Interaktives (ARCHITECTURE.md AP13, data-model.md §4.3).
 * Materialisation of a 2.0 instance — ZDOs ONLY for movable and interactive
 * things.
 *
 * Der Unterschied zum Altbestand in einem Satz: Frueher bekam JEDE Raumhuelle
 * eine ZDO, weil der Client die Architektur als GLB-Instanzen zugestellt bekam.
 * Der 2.0-Client baut die Architektur selbst aus dem Layout — die Waende
 * brauchen also keine Kennung mehr, sondern nur noch das, was einen ZUSTAND
 * hat: eine Truhe, die offen sein kann, ein Skelett, das gleich laeuft.
 * The difference to legacy in one sentence: previously EVERY room shell got a
 * ZDO because the client received the architecture as GLB instances. The 2.0
 * client builds the architecture itself from the layout — the walls need no id
 * any more, only things that carry STATE do.
 *
 * DIE ZDO-KENNUNG KOMMT AUS DER ANKER-ID, NICHT AUS DER ZIEHREIHENFOLGE.
 * `DekoAnker.id` entsteht in `generator.ts` aus Zellposition und Rolle. Wuerde
 * die Kennung stattdessen fortlaufend vergeben, wanderte der Zustand einer
 * geoeffneten Truhe auf eine andere, sobald sich irgendetwas an der Erzeugung
 * aendert — und man saehe es nie, weil beide Truhen ja da waeren.
 * THE ZDO ID COMES FROM THE ANCHOR ID, NEVER FROM THE DRAW ORDER. Handed out
 * sequentially, the state of an opened chest would migrate to a different one
 * as soon as anything about generation changes — and nobody would notice,
 * because both chests would still be there.
 */

import {
  dungeon2,
  findPrefabByName,
  getStableHash,
  type Vector3,
} from '@wov/shared';
import { ZDOID } from '../../zdo/ZDOID.js';
import type { ZDOManager } from '../../zdo/ZDOManager.js';

/**
 * Nutzbare Bits einer ZDO-Kennung. `ZDOID` packt Nutzerindex und Objekt-Id in
 * ein uint32, davon bleiben 22 Bit fuer die Id (`ZDOID.ts`). Die Anker-Id ist
 * ein 32-Bit-Hash und muss deshalb gefaltet werden — das Falten ist der Grund,
 * warum es unten eine Kollisionsbehandlung gibt.
 * Usable bits of a ZDO id. `ZDOID` packs user index and object id into one
 * uint32, leaving 22 bits for the id. The anchor id is a 32-bit hash and must
 * be folded — the folding is why there is collision handling below.
 */
const ID_BITS = 22;
const ID_MASKE = (1 << ID_BITS) - 1;

/**
 * `Spawner_Skeleton(_respawn_30)` -> `Skeleton`. Dieselbe Regel wie im
 * Altbestand (`DungeonManager.spawnerCreature`): Das Spawner-Teil bleibt als
 * unsichtbarer Marker stehen, die Kreatur entsteht daneben.
 * Same rule as legacy: the spawner piece stays as an invisible marker, the
 * creature comes into being next to it.
 */
function spawnerKreatur(prefabName: string): string | null {
  const m = /^Spawner_(.+?)(?:_respawn_\d+)?$/.exec(prefabName);
  return m ? m[1]! : null;
}

/** Was eine Materialisierung hinterlassen hat. / What a materialisation left. */
export interface Materialisierung2Ergebnis {
  /** ALLE erzeugten ZDOs — die Abrissliste. / ALL created ZDOs. */
  readonly zdoids: ZDOID[];
  /**
   * Nur die aus Ankern erzeugten. Sie duerfen einzeln weg, ohne dass die
   * Instanz abgerissen wird (`ankerAngleichen`).
   * Only those created from anchors. They may go individually without tearing
   * down the instance.
   */
  readonly ankerZdoids: ZDOID[];
  /** Anker-Id -> ZDO, damit `ankerAngleichen` vergleichen kann statt zu raten. */
  /** Anchor id -> ZDO, so `ankerAngleichen` can compare instead of guess. */
  readonly ankerZuZdo: Map<number, ZDOID>;
  /** Anker, deren Prefab die Registry nicht kennt — GEZAEHLT, nicht verschwiegen. */
  /** Anchors whose prefab the registry does not know — COUNTED, not swallowed. */
  readonly ohnePrefab: string[];
}

/**
 * Eine freie, aus der Anker-Id hergeleitete Kennung im Ziel-ZDO-Raum.
 *
 * Lineares Sondieren statt eines Zufallssprungs: deterministisch, und bei
 * einigen hundert Ankern in 4 Mio. Plaetzen praktisch immer der erste Versuch.
 * Wichtig ist nur, dass DIESELBE Anker-Id in DERSELBEN Instanz immer dieselbe
 * Kennung ergibt — und das tut sie, weil die Anker in fester Reihenfolge
 * (nach `ankerId`) durchlaufen werden.
 *
 * A free id derived from the anchor id in the target ZDO space. Linear probing
 * instead of a random jump: deterministic, and with a few hundred anchors in
 * 4M slots practically always the first attempt.
 */
function kennungFuerAnker(zdos: ZDOManager, ankerId: number): ZDOID {
  let kandidat = ankerId & ID_MASKE;
  // Die 0 ist `ZDOID.NONE` und darf nie vergeben werden.
  // Zero is `ZDOID.NONE` and must never be handed out.
  if (kandidat === 0) kandidat = 1;
  for (let versuch = 0; versuch < 64; versuch++) {
    const id = zdos.zdoidFuer(kandidat);
    if (zdos.getZDO(id) === undefined) return id;
    kandidat = (kandidat + 1) & ID_MASKE;
    if (kandidat === 0) kandidat = 1;
  }
  // Nach 64 belegten Nachbarn ist etwas grundsaetzlich falsch — dann lieber
  // eine fortlaufende Kennung als eine Endlosschleife.
  // After 64 occupied neighbours something is fundamentally wrong.
  return ZDOID.NONE;
}

/**
 * Ein 2.0-Layout in einem ZDO-Raum materialisieren.
 *
 * `bau` ist das bereits gerechnete `BauErgebnis` — es wird HEREINGEREICHT und
 * nicht hier erzeugt, weil derselbe Bau auch den Spawnpunkt und die
 * Kollisionsdaten der Instanz traegt. Zweimal bauen waere zweimal dieselbe
 * Rechnung mit der Chance, dass eine der beiden abweicht.
 *
 * Materialise a 2.0 layout into a ZDO space. `bau` is the already computed
 * `BauErgebnis` — handed in, not created here, because the same build carries
 * the instance's spawn point and collision data.
 */
export function materialisiere2(
  bau: dungeon2.BauErgebnis,
  thema: dungeon2.ThemenProfil,
  origin: Vector3,
  zdos: ZDOManager
): Materialisierung2Ergebnis {
  const zdoids: ZDOID[] = [];
  const ankerZdoids: ZDOID[] = [];
  const ankerZuZdo = new Map<number, ZDOID>();
  const ohnePrefab: string[] = [];

  // `bestuecke()` sortiert selbst nach `ankerId` — die Reihenfolge hier ist
  // damit dieselbe wie ueberall sonst in der Kette.
  // `bestuecke()` sorts by `ankerId` itself — the order here is the same as
  // everywhere else in the chain.
  for (const teil of dungeon2.bestuecke(bau.dekoPlaetze, thema)) {
    if (!dungeon2.rolleHatZdo(teil.rolle)) continue;

    // Ein Prefab ohne Registry-Eintrag bekommt KEINE ZDO. Der Client koennte
    // mit einem unbekannten Hash nichts anfangen, und ein Zaehler im Log ist
    // die einzige Form, in der man von einer Themen-Tabelle mit einem
    // Platzhalter je erfaehrt.
    // A prefab without a registry entry gets NO ZDO — the client could do
    // nothing with an unknown hash, and a counter in the log is the only way
    // one ever learns of a placeholder in a theme table.
    if (findPrefabByName(teil.prefab) === undefined) {
      ohnePrefab.push(teil.prefab);
      continue;
    }

    const pos: Vector3 = {
      x: origin.x + teil.position.x,
      y: origin.y + teil.position.y,
      z: origin.z + teil.position.z,
    };
    // `drehung` ist eine Vierteldrehung um Y (0..3) — dieselbe Zaehlung wie im
    // Bauer. Quaternion aus dem halben Winkel.
    // `drehung` is a quarter turn about Y (0..3) — same counting as the
    // builder. Quaternion from the half angle.
    const halb = (teil.drehung * Math.PI) / 4;
    const rot = { x: 0, y: Math.sin(halb), z: 0, w: Math.cos(halb) };

    const kennung = kennungFuerAnker(zdos, teil.ankerId);
    const zdo = kennung.isNone()
      ? zdos.createZDO(teil.prefabHash, pos, rot)
      : zdos.createZDOWithID(kennung, teil.prefabHash, pos, rot);
    // `createZDOWithID` ist fuer das WIEDEREINLESEN gebaut und setzt deshalb
    // `isNew`/`dirty` auf false. Hier entsteht das Objekt aber gerade erst, und
    // `collectDirtyZDOs()` sammelt ausschliesslich, was eines von beiden traegt
    // — ohne diese zwei Zeilen stuende der Spieler in einer Instanz ohne
    // Truhen, und zwar wortlos.
    // `createZDOWithID` is built for RELOADING and therefore clears
    // `isNew`/`dirty`. Here the object is coming into being, and
    // `collectDirtyZDOs()` only ever gathers what carries one of the two —
    // without these two lines the player would stand in an instance without
    // chests, and silently so.
    zdo.isNew = true;
    zdo.dirty = true;
    zdoids.push(zdo.zdoid);
    ankerZdoids.push(zdo.zdoid);
    ankerZuZdo.set(teil.ankerId, zdo.zdoid);

    const kreatur = spawnerKreatur(teil.prefab);
    if (kreatur !== null && findPrefabByName(kreatur) !== undefined) {
      // Die Kreatur bekommt eine FORTLAUFENDE Kennung, keine aus dem Anker:
      // Sie ist beweglich und stirbt, ihr Zustand soll gerade NICHT ueber
      // eine Neuerzeugung hinweg an derselben Stelle wieder auftauchen.
      // The creature gets a SEQUENTIAL id, not one from the anchor: it moves
      // and dies, and its state should precisely NOT survive a regeneration.
      const c = zdos.createZDO(getStableHash(kreatur), { ...pos, y: pos.y + 0.2 }, rot);
      zdoids.push(c.zdoid);
    }
  }

  return { zdoids, ankerZdoids, ankerZuZdo, ohnePrefab };
}
