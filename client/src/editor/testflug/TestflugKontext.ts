/**
 * Everything the offline flight needs from `main()`'s closure.
 *
 * Values that `main()` reassigns after start (`world`, `player`, `entities`,
 * `terrain`, `grass`, `sockelFreiflaechen`) are passed as GETTERS, never as
 * copies: a copy taken here would freeze the state at the moment of the call
 * and silently break the flight as soon as `main()` rebuilds one of them.
 * Constants (`scene`, `engine`, `canvas`, `hud`, `lighting`) are passed as
 * they are.
 *
 * Alles, was der Offline-Testflug aus der `main()`-Closure braucht. Was
 * `main()` später neu zuweist, kommt als Getter herein, nie als Kopie.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { ClientWorld } from '../../world/World';
import type { TerrainManager } from '../../engine/Terrain';
import type { Lighting } from '../../engine/Lighting';
import type { GrassClutter } from '../../engine/GrassClutter';
import type { EntityManager } from '../../entities/EntityManager';
import type { PlayerController } from '../../player/PlayerController';
import type { Hud } from '../../ui/Hud';
import type { TestflugPersistenz } from './TestflugPersistenz';

/** Freed circle around a levelled plinth: no clutter grass grows on it. */
export type SockelFreiflaeche = { x: number; z: number; r: number };

export interface TestflugKontext {
  readonly scene: Scene;
  /** Only the frame delta is read (route preview). */
  readonly engine: { getDeltaTime(): number };
  readonly canvas: HTMLCanvasElement;
  readonly hud: Hud;
  readonly lighting: Lighting;
  readonly persistenz: TestflugPersistenz;

  world(): ClientWorld | null;
  player(): PlayerController | null;
  entities(): EntityManager | null;
  terrain(): TerrainManager | null;
  grass(): GrassClutter | null;
  sockelFreiflaechen(): SockelFreiflaeche[];
  /** `main()` reassigns the list (removal filters it into a new array). */
  setzeSockelFreiflaechen(liste: SockelFreiflaeche[]): void;

  /** Registers the query `main()`'s `cursorNoetig()` uses for the spawn panel. */
  setzeSpawnEditorOffen(istOffen: () => boolean): void;
  /** Same for the route editor. */
  setzeRoutenEditorOffen(istOffen: () => boolean): void;
  /** Why the editor's jump (`?pos`) was refused, or null: the flight shows it. */
  einsprungMeldung?(): string | null;
}
