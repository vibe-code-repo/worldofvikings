/**
 * DungeonDeko — sichtbare Instanzen der bestueckten Deko-Anker (M1-Schritt 2).
 * DungeonDeko — visible instances of the furnished decor anchors.
 *
 * `decorator.ts` (shared) loest jeden `DekoAnker` zu einem `BestuecktesTeil`
 * auf (Rolle -> Prefab, Position, Drehung). Bis hierher war das NUR eine
 * Lichtquelle (`DungeonBauer.lichtquellen()`, `LightPool`). Dieses Modul
 * macht daraus zusaetzlich ein sichtbares Modell: EIN Ladevorgang je Prefab
 * (`AssetManager.getMasters`), viele Thin-Instance-Matrizen — derselbe Weg,
 * den `EntityManager` fuer die gesamte gestreute Welt schon geht.
 * `decorator.ts` (shared) resolves every `DekoAnker` into a `BestuecktesTeil`
 * (role -> prefab, position, rotation). Until now that was ONLY a light
 * source. This module additionally turns it into a visible model: ONE load
 * per prefab, many thin-instance matrices — the same path `EntityManager`
 * already takes for the whole scattered world.
 *
 * ── Trennung: reine Mathematik vs. Engine-Aufruf ─────────────────────────
 * `gruppiereDekoNachPrefab` und `dekoWeltmatrix` sind reine Funktionen (nur
 * Babylon-Matrixmathematik, kein Laden, kein Netz) — sie laufen unter der
 * NullEngine ohne jeden Dateizugriff und sind deshalb der Wächter dieses
 * Pakets: `client/test/dungeon2-deko.ts` prüft mit einer GEFAKTEN Modell-
 * quelle (kein GLB-Fetch unter Node), dass jeder Anker entweder platziert
 * ODER als "ohne Modell" gezählt wird — nie beides, nie keines (die Zusage
 * "kein stiller Schwund").
 * Separation: pure maths vs. engine call. The grouping and matrix functions
 * are pure (Babylon matrix maths only, no loading, no network) — they run
 * under the NullEngine with zero file access and are therefore this
 * package's guard: the test uses a FAKE model source (no GLB fetch under
 * Node) to prove every anchor is either placed OR counted as "no model" —
 * never both, never neither (the "no silent loss" promise).
 *
 * ── Warum eine eigene Modellquelle statt `AssetManager` direkt ───────────
 * `DekoModellQuelle` ist absichtlich nur `{ getMasters(name) }` — die eine
 * Methode, die dieses Modul braucht. `AssetManager` erfuellt sie strukturell
 * (TypeScript prueft das ohne einen Adapter), der Test kann aber eine
 * Attrappe ohne Szene, ohne glTF-Loader, ohne Netzwerk einsetzen.
 * Why a dedicated model source instead of `AssetManager` directly:
 * `DekoModellQuelle` is deliberately just `{ getMasters(name) }` — the one
 * method this module needs. `AssetManager` satisfies it structurally, but
 * the test can substitute a stub with no scene, no glTF loader, no network.
 *
 * ── x-Spiegelungs-Konvention ──────────────────────────────────────────────
 * Dieses Modul dreht und verschiebt NUR den Anker (`Matrix.Compose`) und
 * multipliziert ihn mit `master.localMatrix`. Die Spiegelungskorrektur
 * eigener Modelle (Vault: „Client spiegelt eigene Modelle") steckt bereits
 * in `localMatrix` (`AssetManager.zuMaster()`, `sideOrientation` bei
 * negativer Determinante) — ein zweites Mal hier zu spiegeln waere die
 * Aufhebung der Aufhebung.
 * This module only rotates/translates the anchor and multiplies by
 * `master.localMatrix`. The mirroring fix for our own models already lives
 * in `localMatrix` — mirroring a second time here would cancel the fix.
 */
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
// Seiteneffekt-Import: haengt `thinInstanceSetBuffer` etc. an `Mesh.prototype`
// — ohne ihn wirft der Aufruf unten "is not a function" (unter Node UND im
// Bundle, s. `client/test/dungeon2-deko.ts`, wo genau das aufgefallen ist).
// Side-effect import: attaches `thinInstanceSetBuffer` etc. to
// `Mesh.prototype` — without it the call below throws "is not a function".
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { dungeon2 } from '@wov/shared';
import type { PrefabMaster } from './AssetManager';

type BestuecktesTeil = dungeon2.BestuecktesTeil;

/**
 * Alles, was dieses Modul von `AssetManager` braucht — strukturell erfuellt,
 * kein Adapter noetig (siehe Kopfkommentar).
 * Everything this module needs from `AssetManager` — satisfied structurally.
 */
export interface DekoModellQuelle {
  getMasters(name: string): Promise<PrefabMaster[]>;
}

/** Ergebnis eines Deko-Baus — zum Messen, nicht zum Spielen. */
/** Result of one decor build — for measuring, not for playing. */
export interface DekoBauStatistik {
  /** Anker insgesamt, unabhaengig vom Ausgang. / Anchors overall. */
  readonly angefordert: number;
  /** Anker, die eine sichtbare Instanz bekommen haben. / Anchors placed. */
  readonly platziert: number;
  /** Anker, deren Prefab kein Modell lieferte (gezaehlt, nicht verschluckt). */
  /** Anchors whose prefab yielded no model (counted, not swallowed). */
  readonly ohneModell: number;
  /** Prefabnamen ohne Modell, je einmal. / Prefab names without a model, once each. */
  readonly prefabsOhneModell: readonly string[];
}

/**
 * Gruppiert Deko-Teile nach Prefabname, in fester Ordnung.
 *
 * Reihenfolge-Stabilitaet wie im Bestuecker selbst (`decorator.ts`,
 * `bestuecke()`): zuerst nach `ankerId` sortiert, damit die Instanzreihen-
 * folge je Master nie von der Aufrufreihenfolge abhaengt.
 * Groups decor pieces by prefab name, in a fixed order — sorted by anchor id
 * first, same as the furnisher itself, so a master's instance order never
 * depends on call order.
 */
export function gruppiereDekoNachPrefab(
  teile: readonly BestuecktesTeil[]
): Map<string, BestuecktesTeil[]> {
  const sortiert = [...teile].sort((a, b) => a.ankerId - b.ankerId);
  const gruppen = new Map<string, BestuecktesTeil[]>();
  for (const teil of sortiert) {
    let liste = gruppen.get(teil.prefab);
    if (liste === undefined) {
      liste = [];
      gruppen.set(teil.prefab, liste);
    }
    liste.push(teil);
  }
  return gruppen;
}

/**
 * Weltmatrix eines Deko-Teils — Drehung um die Hochachse aus `drehung`
 * (Vierteldrehung, Nord = 0 dann im Uhrzeigersinn, `themen.kanteZuDrehung`;
 * Babylons `RotationAxis(Up, ...)` dreht im selben Sinn: Norden = +z, Osten
 * = +x, s. `design/decisions-log.md` AP1), Position aus dem bereits vom
 * Bauer aufgeloesten Anker in Metern.
 * World matrix of a decor piece — yaw from `drehung`, position from the
 * anchor already resolved to metres by the builder.
 */
export function dekoWeltmatrix(teil: BestuecktesTeil): Matrix {
  const winkel = teil.drehung * (Math.PI / 2);
  return Matrix.Compose(
    Vector3.One(),
    Quaternion.RotationAxis(Vector3.Up(), winkel),
    new Vector3(teil.position.x, teil.position.y, teil.position.z)
  );
}

/**
 * Baut sichtbare Instanzen aus bestueckten Deko-Teilen — ein Ladevorgang je
 * Prefab (`DekoModellQuelle.getMasters`, gecacht dort), viele Thin-Instance-
 * Matrizen je Master.
 * Builds visible instances from furnished decor pieces — one load per
 * prefab, many thin-instance matrices per master.
 */
export class DungeonDeko {
  private readonly benutzteMaster: Mesh[] = [];

  constructor(private readonly quelle: DekoModellQuelle) {}

  /** Alle bisher gesetzten Master. Fuer Tests. / All masters used so far. */
  get master(): readonly Mesh[] {
    return this.benutzteMaster;
  }

  async baue(teile: readonly BestuecktesTeil[]): Promise<DekoBauStatistik> {
    const gruppen = gruppiereDekoNachPrefab(teile);
    let platziert = 0;
    let ohneModell = 0;
    const prefabsOhneModell: string[] = [];

    for (const [prefab, gruppe] of gruppen) {
      const masters = await this.quelle.getMasters(prefab);
      if (masters.length === 0) {
        ohneModell += gruppe.length;
        prefabsOhneModell.push(prefab);
        continue;
      }
      for (const master of masters) {
        const daten = new Float32Array(gruppe.length * 16);
        for (let i = 0; i < gruppe.length; i++) {
          const welt = dekoWeltmatrix(gruppe[i]!);
          master.localMatrix.multiply(welt).toArray(daten, i * 16);
        }
        master.mesh.thinInstanceSetBuffer('matrix', daten, 16, false);
        master.mesh.setEnabled(true);
        this.benutzteMaster.push(master.mesh);
      }
      platziert += gruppe.length;
    }

    return {
      angefordert: teile.length,
      platziert,
      ohneModell,
      prefabsOhneModell,
    };
  }

  /**
   * Schaltet die Thin-Instance-Puffer dieses Baus wieder ab.
   *
   * Die Master-Meshes selbst gehoeren der `DekoModellQuelle` (dem
   * `AssetManager`, geteilt ueber die Szene) und werden hier NICHT entsorgt
   * — genau die Regel, nach der auch die Architektur ihr Material behandelt
   * (Nutzerzaehler statt Vollabriss). Ein zweiter Dungeon mit demselben
   * Thema wuerde sonst ein Modell verlieren, das er sich nur teilt.
   * Turns this build's thin-instance buffers back off. The master meshes
   * themselves belong to the shared `AssetManager` and are NOT disposed here.
   */
  dispose(): void {
    for (const mesh of this.benutzteMaster) {
      mesh.thinInstanceSetBuffer('matrix', null, 16, false);
      mesh.setEnabled(false);
    }
    this.benutzteMaster.length = 0;
  }
}
