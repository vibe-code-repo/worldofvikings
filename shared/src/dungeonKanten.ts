/**
 * Kanten eines Kit-Raums benennen — die gemeinsame Sprache beider Editoren.
 *
 * ── Warum das hier steht und nicht zweimal daneben ───────────────────
 * Seit `attachRoom` einen optionalen fünften Parameter `connIndex` kennt,
 * darf der Mensch entscheiden, WELCHE Kante des neuen Raums an der offenen
 * Kante andockt. Beide Editoren bieten dafür dasselbe Feld an — der
 * F4-Editor im Spiel (`client/src/ui/DungeonEditor.ts`) und die
 * Dungeon-Seite des Karteneditors (`client/src/editor/DungeonKatalog.ts`).
 * Zwei Kopien derselben vier Zeilen wären die Sorte Duplikat, die man erst
 * bemerkt, wenn eine Seite „Nord" sagt und die andere „Kante 2": Der
 * Unterschied fällt nicht beim Lesen auf, sondern beim Bauen.
 *
 * Reine Funktionen, kein DOM, keine Babylon-Abhängigkeit — deshalb steht
 * das hier in `shared/` und nicht in einem der beiden Client-Ordner. Der
 * Karteneditor und der Spielclient sind getrennte Bündel; ein Import aus
 * dem einen in das andere zöge das falsche halbe Bündel mit herüber.
 *
 * Edge naming for kit rooms — the shared vocabulary of BOTH editors (the
 * in-game F4 panel and the map editor's dungeon page). Pure functions, no
 * DOM: the two editors are separate bundles, so this belongs in `shared/`.
 */
import type { RoomDef } from './dungeons.js';

/**
 * Himmelsrichtung einer Kante aus ihrer lokalen Position — +z Nord,
 * −z Süd, +x Ost, −x West (die Bezeichnungen, die auch in
 * `eigeneDungeons.ts` an den Connectors stehen).
 *
 * Entschieden wird über die DOMINANTE Achse: eine Kante bei (x 2, z 1)
 * liegt im Osten, auch wenn sie nach Norden versetzt sitzt. Ist keine
 * Achse dominant (beide gleich gross, etwa bei einer Diagonale oder bei
 * (0,0)), gibt es keine ehrliche Antwort — dann heisst die Kante schlicht
 * nach ihrem Index.
 */
export function kantenName(localPos: { x: number; z: number }, index: number): string {
  const ax = Math.abs(localPos.x);
  const az = Math.abs(localPos.z);
  if (ax > az) return localPos.x > 0 ? 'Ost' : 'West';
  if (az > ax) return localPos.z > 0 ? 'Nord' : 'Süd';
  return `Kante ${index}`;
}

/** Eine anwählbare Ausrichtung: der Index für `attachRoom` und sein Text. */
export interface AusrichtungsOption {
  /** Index in `RoomDef.connections` — genau das, was `attachRoom` erwartet. */
  index: number;
  /** Beschriftung im Auswahlfeld. */
  beschriftung: string;
}

/**
 * Die anwählbaren Kanten eines Raums, gefiltert auf den Typ der offenen
 * Kante, an die angefügt werden soll.
 *
 * Der Filter ist kein Komfort, sondern die Bedingung: `attachRoom` weist
 * einen Index mit falschem Connector-Typ ab. Was hier herauskommt, ist
 * genau das, was dort auch durchgeht.
 *
 * `connType === undefined` heisst „kein offener Connector gewählt" und
 * ergibt eine leere Liste — nicht etwa alle Kanten. Ein Angebot, das erst
 * beim Klick scheitert, ist schlechter als gar keines.
 *
 * Der Index steht mit in der Beschriftung, weil eine Zelle zwei Kanten auf
 * DERSELBEN Seite haben kann (die Doppelzelle hat je zwei Ost- und
 * West-Kanten) — zwei Einträge „Ost" wären sonst nicht auseinanderzuhalten.
 * Nur die namenlose Rückfallform („Kante 3") trägt den Index schon selbst
 * und bekommt ihn nicht zweimal.
 */
export function ausrichtungsOptionen(
  raum: RoomDef | undefined,
  connType: string | undefined
): AusrichtungsOption[] {
  if (!raum || connType === undefined) return [];
  const optionen: AusrichtungsOption[] = [];
  raum.connections.forEach((c, i) => {
    if (c.type !== connType) return;
    const name = kantenName(c.localPos, i);
    optionen.push({ index: i, beschriftung: name.startsWith('Kante') ? name : `${name} #${i}` });
  });
  return optionen;
}
