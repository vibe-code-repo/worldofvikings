/**
 * Steckbriefe der Kreaturen — die Werte je Art für die KI-Zustandsmaschine
 * (`shared/src/kiZustand.ts`) und die Körpermaße für die Kollision.
 *
 * Eigene Datentabelle (Balance-Werte, T13): Wer eine Art umstellt, ändert
 * hier eine Zeile und sonst nichts. Die Spannen, in denen die Werte liegen
 * dürfen, stehen am Fuß der Datei bei `KI_SPANNEN`; der Test
 * `server/test/ki-zustaende.ts` hält jede Tabellenzeile dagegen.
 *
 * Tiere (Kuh, Huhn) haben keine KI-Zustände: Die Kuh ist friedlich und wandert,
 * das Huhn flieht (Werte im SpawnEntry). Für sie steht hier nur der Körper.
 */

import type { KiSteckbrief } from '@wov/shared';

export interface KreaturSteckbrief {
  readonly art: 'monster' | 'tier';
  /**
   * Kollisionsradius in Metern: mittlere Halbachse der Hülle aus dem
   * Manifest, (breite + tiefe) / 4 — ein Kreis, der Körper und Kopf
   * deckt, ohne den Körper zu einem Pfosten zu machen.
   */
  readonly koerperRadius: number;
  /** KI-Werte; null = keine Zustandsmaschine (Tiere). */
  readonly ki: KiSteckbrief | null;
}

/**
 * Die Werte, mit denen jede aggressive Kreatur ohne eigenen Steckbrief
 * spielt (Testtabellen, Bosse, Layout-NPCs): genau das Verhalten von vor der
 * Zustandsmaschine — Sicht 20 m rundum, Loslassen jenseits 32 m, Schlag alle
 * 2 s ab 1,7 m, keine Leine, kein Rückzug, kein Verfall.
 */
export const KI_VORGABE: KiSteckbrief = {
  sicht: 20,
  haltSicht: 32,
  sichtWinkelGrad: 360,
  hoeren: 0,
  leine: Infinity,
  verfolgungM: Infinity,
  verfolgungSec: Infinity,
  taktSec: 2,
  angriffReichweite: 1.7,
  anrennenAb: 20,
  bemerktSec: 0,
  rueckzugNach: 0,
  rueckzugChance: 0,
  blockChance: 0,
  umlaufen: false,
  verfallSec: 0,
  koerperRadius: 0.4,
};

/**
 * Wolf — die einzige Kreatur mit Zustandsmaschine.
 *
 * Jeder Wert liegt in der Spanne aus `KI_SPANNEN`; Begründung je Zeile:
 *  - sicht 17, sichtWinkelGrad 230, hoeren 30: die feste Staffel der Vorgabe.
 *    Ein Nahkämpfer hat 17 m (22 m gilt für Fernkämpfer, die es noch nicht gibt).
 *  - haltSicht 17: im Kampf hält er das Ziel so weit, wie er es hätte sehen können.
 *  - leine 12: Obergrenze der Spanne 10–12 m. Der Wolf ist ein Wächter seines
 *    Reviers; 12 lässt ihm den meisten Raum, ohne die Zuglinie zu öffnen.
 *    Sein Wanderradius wird auf die Leine gekappt (SpawnSystem), sonst läge er
 *    schon beim Wandern jenseits davon.
 *  - verfolgungM 15, verfolgungSec 10: 15 m Strecke ist der Wert der Vorgabe,
 *    10 s die Mitte von 5–20 s.
 *  - taktSec 2: der bisherige Takt, bewusst außerhalb der Roadmap-Spanne
 *    0,5–1,5 s (Entscheidung Mike, 30.09.2026). Der Schaden je Sekunde im
 *    Dauerkampf bleibt damit wie vor der Zustandsmaschine. Der Test
 *    `ki-zustaende` führt diese Ausnahme ausdrücklich.
 *  - angriffReichweite 1.7, schlagen mit Radius 2.4 (SpawnSystem): unverändert.
 *  - anrennenAb 17 (= sicht): was er sieht, rennt er an. bemerktSec 0.25: ein
 *    Sync-Schritt (4 Hz), damit die Clients die Drehung vor dem Losrennen sehen.
 *  - rueckzugNach 3, rueckzugChance 0.4: Mitte von 2–5 Schlägen bei 40 %, dem
 *    Wert, den die Roadmap für die Spielprobe nennt (0–80 % ist die Spanne).
 *  - blockChance 0: ein Tier blockt nicht (Spanne 0–100 %). NOCH OHNE
 *    WIRKUNG: Der Kampfkern kennt keine Schlagabwehr der Kreatur, der Wert
 *    wird nirgends gelesen.
 *  - umlaufen true: ein Rudeltier läuft dem abgewandten Spieler nicht in den Rücken.
 *  - verfallSec 20: die Vorgabe.
 */
const WOLF: KreaturSteckbrief = {
  art: 'monster',
  koerperRadius: 0.45,
  ki: {
    sicht: 17,
    haltSicht: 17,
    sichtWinkelGrad: 230,
    hoeren: 30,
    leine: 12,
    verfolgungM: 15,
    verfolgungSec: 10,
    taktSec: 2,
    angriffReichweite: 1.7,
    anrennenAb: 17,
    bemerktSec: 0.25,
    rueckzugNach: 3,
    rueckzugChance: 0.4,
    blockChance: 0,
    umlaufen: true,
    verfallSec: 20,
    koerperRadius: 0.45,
  },
};

/** Kuh: friedlich, wandert. Körper (0,765 × 2,959 m) → Radius 0,9. */
const KUH: KreaturSteckbrief = { art: 'tier', koerperRadius: 0.9, ki: null };

/** Huhn: flieht (SpawnEntry.flees). Körper (0,381 × 0,255 m) → Radius 0,16. */
const HUHN: KreaturSteckbrief = { art: 'tier', koerperRadius: 0.16, ki: null };

const STECKBRIEFE: ReadonlyMap<string, KreaturSteckbrief> = new Map([
  ['Wolf', WOLF],
  ['Kuh', KUH],
  ['Huhn', HUHN],
]);

/** Steckbrief einer Art oder undefined (dann gilt `KI_VORGABE` / Radius 0,4). */
export function steckbriefFuer(prefab: string): KreaturSteckbrief | undefined {
  return STECKBRIEFE.get(prefab);
}

/** Alle Arten mit Steckbrief (für den Test). */
export function alleSteckbriefe(): ReadonlyMap<string, KreaturSteckbrief> {
  return STECKBRIEFE;
}

/** Erlaubte Spannen je Wert (untere, obere Grenze, beide eingeschlossen). */
export const KI_SPANNEN = {
  sicht: [17, 22],
  sichtWinkelGrad: [230, 230],
  hoeren: [30, 30],
  leine: [10, 12],
  verfolgungSec: [5, 20],
  // Roadmap-Spanne. Der Wolf liegt mit 2 s bewusst darüber (siehe WOLF); der Test
  // führt die Ausnahme je Art und Wert, `KI_SPANNEN` bleibt die Spanne der Roadmap.
  taktSec: [0.5, 1.5],
  rueckzugNach: [2, 5],
  rueckzugChance: [0, 0.8],
  blockChance: [0, 1],
} as const satisfies Record<string, readonly [number, number]>;
