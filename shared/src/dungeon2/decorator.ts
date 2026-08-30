/**
 * Der Bestuecker (Deko-Bestuecker) des Dungeon-Generators 2.0 — Rolle -> Prefab.
 * The furnisher (decor furnisher) of dungeon generator 2.0 — role -> prefab.
 *
 * Quelle: `design/data-model.md` §2.5 (`bestuecke()`), `design/ARCHITECTURE.md`
 * §1.2 (Datei `bestuecker.ts`, hier als `decorator.ts` — englischer Dateiname
 * nach Vorgabe, siehe `design/decisions-log.md`), W7 ("ein Strom je Anker im
 * Bestuecker") und §1.3 (Datenfluss: `dekoPlaetze -> bestuecke -> ZDOs`).
 * Source: `design/data-model.md` §2.5 (`bestuecke()`), `design/ARCHITECTURE.md`
 * §1.2 (file `bestuecker.ts`, named `decorator.ts` here per the English
 * filename rule, see `design/decisions-log.md`), W7 ("one stream per anchor in
 * the furnisher") and §1.3 (data flow: `dekoPlaetze -> bestuecke -> ZDOs`).
 *
 * Getrennt vom Generator und vom Bauer, weil er getrennt laufen muss: Der
 * Server ruft ihn beim Materialisieren (ZDOs), der Editor beim Anzeigen. Eine
 * Aenderung an den Deko-Tabellen (`ThemenProfil.dekoTabellen`) erzeugt dadurch
 * KEIN neues Layout — dieselben Anker, andere Modelle.
 * Separate from the generator and the builder, because it must run separately:
 * the server calls it while materialising (ZDOs), the editor while displaying.
 * A change to the decor tables therefore produces NO new layout — the same
 * anchors, different models.
 *
 * Eingabe ist `BauErgebnis.dekoPlaetze` (Meter, vom Bauer aufgeloest), nicht
 * `DungeonLayout2` direkt (Abweichung von der Signatur in `data-model.md` §2.5,
 * siehe `design/decisions-log.md`, Paket "decorator"): Der Bauer ist die EINE
 * Stelle, die Anker-Positionen in Meter uebersetzt (`ankerPosition()`); ein
 * zweiter, unabhaengig geschriebener Umrechnungspfad hier waere genau die Art
 * Duplikat, die auseinanderlaufen kann, ohne dass es auffiele.
 * Input is `BauErgebnis.dekoPlaetze` (metres, resolved by the builder), not
 * `DungeonLayout2` directly (a deviation from the signature in `data-model.md`
 * §2.5, see the decision log, package "decorator"): the builder is the ONE
 * place that translates anchor positions into metres (`ankerPosition()`); a
 * second, independently written conversion path here would be exactly the
 * kind of duplicate that can drift apart unnoticed.
 *
 * Dieses Modul ist rein: kein Babylon, kein DOM, kein `node:`, kein
 * `Math.random`, keine Uhr, keine Trigonometrie. `hash.ts` und
 * `worldgen/Random.ts` liegen ausserhalb von `dungeon2/`, sind aber selbst rein
 * (nur `Math.imul`/Shifts/XOR fuer den Prefab-Hash bzw. den xorshift128-Strom)
 * und werden bereits von `generator.ts` importiert.
 * This module is pure: no Babylon, no DOM, no `node:`, no `Math.random`, no
 * clock, no trigonometry. `hash.ts` and `worldgen/Random.ts` live outside
 * `dungeon2/` but are themselves pure (only `Math.imul`/shifts/XOR for the
 * prefab hash resp. the xorshift128 stream) and are already imported by
 * `generator.ts`.
 */

import { getPrefabHash } from '../hash.js';
import type { Hash, Vector3 } from '../types.js';
import { XorShiftRandom } from '../worldgen/Random.js';
import type { AnkerOrt, Kante } from './layout.js';
import type { BlockId, DekoPlatz } from './builder.js';
import type { PrefabGewicht, ThemenProfil } from './themen.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Ergebnistyp / result type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ein bestuecktes Deko-Teil: ein aufgeloester `DekoPlatz`, dem ein konkretes
 * Prefab zugewiesen wurde. Entspricht `{ anker, prefab, prefabHash, pos, rot }`
 * aus `data-model.md` §2.5 — Feldnamen an `DekoPlatz` angeglichen (`position`/
 * `drehung` statt `pos`/`rot`), damit dieselbe Groesse in der ganzen Kette
 * (Anker -> DekoPlatz -> BestuecktesTeil) denselben Namen traegt.
 * A furnished decor piece: a resolved `DekoPlatz` assigned a concrete prefab.
 * Corresponds to `{ anker, prefab, prefabHash, pos, rot }` from `data-model.md`
 * §2.5 — field names aligned with `DekoPlatz` (`position`/`drehung` instead of
 * `pos`/`rot`), so the same quantity carries the same name throughout the chain
 * (anchor -> DekoPlatz -> BestuecktesTeil).
 */
export interface BestuecktesTeil {
  /** Anker-Id — Grundlage der ZDO-Id (ARCHITECTURE AP13). / Anchor id. */
  readonly ankerId: number;
  /** Stempel, zu dem der Anker gehoert; -1 = Handarbeit. / Owning stamp, -1 = hand work. */
  readonly stempelId: number;
  /** Block der Ankerzelle — fuer blockweise ZDO-Erzeugung. / Anchor's block. */
  readonly block: BlockId;
  /** Die ROLLE, aus der das Prefab aufgeloest wurde. / The resolved role. */
  readonly rolle: string;
  /** Aufgeloestes Prefab: entweder handgesetzt oder gewichtet gezogen. */
  /** Resolved prefab: either hand-nailed or drawn by weight. */
  readonly prefab: string;
  /** `getStableHash(prefab)` — dieselbe Funktion wie fuer jede ZDO im Projekt. */
  /** `getStableHash(prefab)` — the same function used for every ZDO in the project. */
  readonly prefabHash: Hash;
  readonly ort: AnkerOrt;
  readonly kante?: Kante;
  readonly position: Vector3;
  readonly drehung: 0 | 1 | 2 | 3;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Gewichtete Wahl / weighted choice
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zieht ein Prefab gewichtet aus einer Prefabliste. Dieselbe Form wie
 * `generator.ts`s `zieheTyp()` (feste Listenreihenfolge, EINE Ziehung, kein
 * Nachziehen), damit dasselbe Muster nicht zweimal unabhaengig geschrieben
 * steht. Eintraege mit `gewicht <= 0` zaehlen nicht mit (Datenfehlerschutz;
 * `themen.ts`s Kommentar verlangt "> 0", ein Thema mit einem Tippfehler soll
 * trotzdem etwas Sinnvolles ziehen statt eine Ausnahme zu werfen).
 * Draws one prefab by weight from a prefab list. Same shape as `generator.ts`'s
 * `zieheTyp()` (fixed list order, ONE draw, no re-draw), so the same pattern is
 * not written independently twice. Entries with `gewicht <= 0` do not count
 * (defensive against a data typo — a theme with a mistake should still draw
 * something sensible rather than throw).
 */
function ziehePrefab(strom: XorShiftRandom, kandidaten: readonly PrefabGewicht[]): string | undefined {
  let summe = 0;
  for (const k of kandidaten) if (k.gewicht > 0) summe += k.gewicht;
  if (summe <= 0) return undefined;
  let r = strom.rangeInt(0, summe);
  for (const k of kandidaten) {
    if (k.gewicht <= 0) continue;
    r -= k.gewicht;
    if (r < 0) return k.prefab;
  }
  // Rundungsrest (kann bei ganzzahliger Arithmetik nicht vorkommen, ist aber
  // die deterministische Rueckfallwahl statt eines `undefined`).
  // Rounding leftover (cannot occur with integer arithmetic, but is the
  // deterministic fallback choice instead of `undefined`).
  for (let i = kandidaten.length - 1; i >= 0; i--) {
    if (kandidaten[i]!.gewicht > 0) return kandidaten[i]!.prefab;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Der Bestuecker / the furnisher
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loest jeden Deko-Platz zu einem konkreten Prefab auf.
 *
 * Reihenfolge-Stabilitaet: Die Eingabeliste wird zuerst nach `ankerId`
 * sortiert (die Anker-Id ist deterministisch aus der Layout-Position und der
 * Rolle, `generator.ts`, `ankerId()`) — das Ergebnis haengt nie von der
 * Reihenfolge der uebergebenen `dekoPlaetze` ab. Jeder Anker zieht aus seinem
 * EIGENEN Strom `new XorShiftRandom(platz.seed)`, wobei `platz.seed` bereits
 * `mische(seeds.deko, anker.id)` ist (vom Generator in P9 gesetzt, unveraendert
 * durch den Bauer gereicht) — exakt der Strom aus W7. Ein Anker, der dazu- oder
 * wegkommt, aendert deshalb keine Ziehung eines anderen Ankers.
 *
 * Resolves every decor place to a concrete prefab.
 *
 * Order stability: the input list is sorted by `ankerId` first (the anchor id
 * is deterministic, derived from the layout position and the role,
 * `generator.ts`, `ankerId()`) — the result never depends on the order of the
 * supplied `dekoPlaetze`. Every anchor draws from its OWN stream
 * `new XorShiftRandom(platz.seed)`, where `platz.seed` is already
 * `mische(seeds.deko, anker.id)` (set by the generator in P9, passed through
 * unchanged by the builder) — exactly the stream from W7. An anchor added or
 * removed therefore never changes another anchor's draw.
 *
 * Ein handgesetztes Prefab (`DekoAnker.prefab`, ARCHITECTURE §3.4) zieht NICHT
 * aus dem Strom — es ist festgenagelt, keine Ziehung noetig. Fehlt fuer die
 * Rolle eine Tabelle (unbekannte Rolle, leere oder nur-nichtpositive Liste),
 * wird der Platz ausgelassen: ein Anker ohne Prefab ist keine ZDO, aber auch
 * kein Fehler dieses Moduls — `themen.ts` legt fest, welche Rollen es gibt.
 * A hand-nailed prefab (`DekoAnker.prefab`, ARCHITECTURE §3.4) does NOT draw
 * from the stream — it is nailed down, no draw needed. If the role has no
 * table (unknown role, empty or only non-positive list), the place is skipped:
 * an anchor without a prefab is not a ZDO, but also not a fault of this
 * module — `themen.ts` decides which roles exist.
 */
export function bestuecke(
  dekoPlaetze: readonly DekoPlatz[],
  thema: ThemenProfil
): readonly BestuecktesTeil[] {
  const sortiert = [...dekoPlaetze].sort((a, b) => a.ankerId - b.ankerId);
  const teile: BestuecktesTeil[] = [];

  for (const platz of sortiert) {
    let prefab: string;
    if (platz.prefab !== undefined) {
      prefab = platz.prefab;
    } else {
      const kandidaten = thema.dekoTabellen[platz.rolle];
      if (kandidaten === undefined || kandidaten.length === 0) continue;
      const strom = new XorShiftRandom(platz.seed >>> 0);
      const gezogen = ziehePrefab(strom, kandidaten);
      if (gezogen === undefined) continue;
      prefab = gezogen;
    }

    teile.push({
      ankerId: platz.ankerId,
      stempelId: platz.stempelId,
      block: platz.block,
      rolle: platz.rolle,
      prefab,
      prefabHash: getPrefabHash(prefab),
      ort: platz.ort as AnkerOrt,
      ...(platz.kante === undefined ? {} : { kante: platz.kante }),
      position: platz.position,
      drehung: platz.drehung,
    });
  }

  return teile;
}
