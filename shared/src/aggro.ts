/**
 * ── Aggro: wen ein NPC ansieht und wann er zuschlägt ─────────────────
 *
 * Reine Rechnung, keine Zustandshaltung, keine ZDO, keine Szene. Genau
 * deshalb steht sie hier und nicht im Server: Der EDITOR-TESTFLUG
 * (client/editor/RoutenVorschau.ts) muss dasselbe Verhalten zeigen wie
 * die fertige Welt, und eine Vorschau, die anders rechnet als der Server,
 * wäre schlimmer als keine — man gestaltete nach einem Bild, das die
 * fertige Welt nie zeigt. Dieselbe Überlegung hat schon `RoutenLauf` aus
 * dem Server nach shared geholt (s. worldlayout/routenlauf.ts).
 *
 * Was drumherum verschieden BLEIBEN darf, ist die Buchführung: Der Server
 * drosselt auf 4 Hz, schreibt in ZDO-Member und muss sich mit dem
 * RoutenLaeufer um die Vorfahrt einigen; die Vorschau zeichnet einfach
 * jeden Frame neu. Beide fragen aber dieselbe Funktion, was zu tun ist.
 */

import type { AnimZustand } from './constants.js';
import {
  SPIELER_FRAKTION,
  haltungZwischen,
  loeseNpcAuf,
  npcKampf,
  type NpcDef,
} from './npc.js';

/** Ein möglicher Gegner — in der Praxis eine Spielerposition. */
export interface AggroZiel {
  readonly x: number;
  readonly z: number;
}

/**
 * Ab welchem Anteil des Aggroradius der NPC NACHSETZT.
 *
 * Warum ein Anteil und keine dritte Zahl je NPC: Die Staffelung
 * „bemerken — nachsetzen — zuschlagen" ist für alle dieselbe Geschichte,
 * und sie hängt an der Grösse der Figur, die schon in `aggro` steckt.
 * Eine eigene Zahl je NPC wäre eine dritte Stelle, die man beim nächsten
 * Riesen vergisst.
 *
 * Die Hälfte ist dabei nicht beliebig: Sie lässt zwischen Bemerken und
 * Losgehen genug Raum, dass der Spieler die Drehung SIEHT und noch
 * ausweichen kann. Beim Krieger sind das 18 m bemerken, ab 9 m kommt er.
 */
export const VERFOLGUNG_ANTEIL = 0.5;

export interface AggroErgebnis {
  /** Blickrichtung zum Ziel (Bogenmass, Gierachse). */
  readonly yaw: number;
  /** Was in die Animationsgruppe gehört. */
  readonly anim: AnimZustand;
  /** Abstand zum Ziel in Metern — für Meldungen und Prüfungen. */
  readonly abstand: number;
  /**
   * Position nach diesem Schritt. Steht er, ist es die übergebene —
   * derselbe Vertrag wie bei `RoutenLauf.schritt`, damit der Aufrufer in
   * beiden Fällen dasselbe tut.
   */
  readonly x: number;
  readonly z: number;
  /** Ob er sich in diesem Schritt bewegt hat (dann ZDO-Position schreiben). */
  readonly bewegt: boolean;
}

/**
 * Was ein NPC in diesem Augenblick tun soll, oder null.
 *
 * null heisst „geht dich nichts an": kein NPC, nicht feindlich, oder das
 * nächste Ziel ist ausser Reichweite. Der Aufrufer lässt ihn dann in
 * Ruhe — er soll gerade NICHT auf 'idle' zurückgesetzt werden, denn ein
 * Routen-NPC läuft in diesem Fall weiter, und ein stehender bleibt so
 * gedreht, wie er stand.
 *
 * Die Haltung ergibt sich aus den FRAKTIONEN (`haltungZwischen`), nicht
 * aus einem Feld am NPC — steht ausführlich in npc.ts. `def` ist die
 * Angabe an der Platzierung, die die Prefab-Vorgabe schlägt; der Server
 * kennt sie am ZDO nicht und lässt sie weg.
 */
export function aggroSchritt(
  prefab: string,
  x: number,
  z: number,
  ziele: readonly AggroZiel[],
  deltaSec = 0,
  def?: NpcDef | null
): AggroErgebnis | null {
  if (ziele.length === 0) return null;
  const einordnung = loeseNpcAuf(prefab, def);
  if (!einordnung) return null;
  if (haltungZwischen(einordnung.fraktion, SPIELER_FRAKTION) !== 'feindlich') return null;

  // Nächstes Ziel in der WAAGERECHTEN. Die Höhe bleibt bewusst draussen:
  // Ein Riese auf einem Hügel soll den Spieler zehn Meter unter sich
  // trotzdem sehen, und die Blickrichtung ist ohnehin nur ein Gieren um
  // die Hochachse.
  let besteSqr = Infinity;
  let dx = 0;
  let dz = 0;
  for (const ziel of ziele) {
    const ax = ziel.x - x;
    const az = ziel.z - z;
    const sqr = ax * ax + az * az;
    if (sqr < besteSqr) {
      besteSqr = sqr;
      dx = ax;
      dz = az;
    }
  }

  const kampf = npcKampf(prefab);
  const abstand = Math.sqrt(besteSqr);
  if (abstand > kampf.aggro) return null;

  // Dieselbe Rechnung wie beim RoutenLauf (yaw = atan2(dx, dz)), damit ein
  // NPC, der eben noch lief, sich beim Umschalten nicht einmal um die
  // eigene Achse dreht.
  const yaw = Math.atan2(dx, dz);
  const steht = { yaw, abstand, x, z, bewegt: false } as const;

  // ── Die drei Bänder ───────────────────────────────────────────────
  // In Reichweite: stehen und zuschlagen. Er läuft dabei ausdrücklich
  // NICHT weiter — sonst schöbe er den Spieler vor sich her.
  if (abstand <= kampf.angriff) return { ...steht, anim: 'attack' };

  // Bemerkt, aber noch weit weg: nur hindrehen. Das ist die Warnung, und
  // sie ist gewollt — wer nicht will, geht weg.
  const verfolgung = Math.max(kampf.aggro * VERFOLGUNG_ANTEIL, kampf.angriff);
  if (abstand > verfolgung) return { ...steht, anim: 'idle' };

  // Verfolgungsband: nachsetzen, aber nur bis an die Angriffsreichweite.
  // Der Schritt wird an `abstand - angriff` GEKAPPT, sonst überliefe er
  // bei grossem deltaSec sein Ziel und pendelte im nächsten Tick zurück.
  const weg = Math.min(kampf.tempo * deltaSec, abstand - kampf.angriff);
  if (weg <= 0) return { ...steht, anim: 'walk' };
  return {
    yaw,
    anim: 'walk',
    abstand,
    x: x + (dx / abstand) * weg,
    z: z + (dz / abstand) * weg,
    bewegt: true,
  };
}
