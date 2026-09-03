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
 * Dasselbe gilt für `schliesseOffeneKanten` weiter unten: Was der
 * Generator mit `placeEndCaps` von selbst tut, müssen beide Editoren beim
 * Speichern nachholen — und zwar mit DERSELBEN Rechnung, sonst hat ein von
 * Hand gebautes Grab andere Wände als ein gewürfeltes.
 *
 * Edge naming for kit rooms — the shared vocabulary of BOTH editors (the
 * in-game F4 panel and the map editor's dungeon page). Pure functions, no
 * DOM: the two editors are separate bundles, so this belongs in `shared/`.
 */
import type { DungeonLayout, RoomDef } from './dungeons.js';
import { DUNGEONS_BY_NAME } from './dungeons.js';
import { attachRoom, computeOpenConnections } from './dungeonGenerator.js';

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

/** Was `schliesseOffeneKanten` getan hat — Futter für die Meldung im Editor. */
export interface KantenSchlussErgebnis {
  /** Wie viele Abschlussräume (Wände) angehängt wurden. */
  gesetzt: number;
  /**
   * Wie viele Kanten TROTZDEM offen blieben — Löcher, die kein Abschluss
   * schliessen konnte. Die Eingangskante des Startraums zählt hier NICHT
   * mit: Sie bleibt mit Absicht offen. `0` heisst also „dicht".
   */
  offenGeblieben: number;
}

/**
 * Obergrenze der Runden.
 *
 * Ein Abschluss bringt eigene Connectors mit (beim Wandmodul genau einen,
 * und der liegt auf der Kante, die er gerade zugemacht hat). Fiele ein Kit
 * anders aus — ein Abschluss mit einer zweiten, freien Kante —, öffnete
 * jede gesetzte Wand eine neue, und die Schleife liefe ewig. Die Grenze ist
 * die billige Versicherung dagegen; erreicht wird sie im heutigen Bestand
 * nach der ERSTEN Runde nicht mehr.
 */
const MAX_RUNDEN = 32;

/**
 * Jede offene Kante eines Layouts mit einem Abschlussraum des Kits
 * zumauern — ausser der Eingangskante des Startraums.
 *
 * ── Warum es das überhaupt gibt ──────────────────────────────────────
 * Im Modul-Kit ist eine Wand kein Teil der Zelle, sondern ein eigener Raum
 * (`StoneVaultWall`, `endCap: true`). Beim WÜRFELN zieht `placeEndCaps`
 * ihn über jede Kante, die sonst ins Nichts zeigt. Beim BAUEN VON HAND tat
 * das niemand: Was die Editoren erzeugten, hatte im Spiel Löcher — und
 * zwar lautlos, denn im Grundriss sieht eine offene Kante genauso aus wie
 * eine, an der man gleich weiterbauen will. Der Unterschied fällt erst
 * auf, wenn man drinsteht und ins Schwarze schaut.
 *
 * ── Warum der Eingang offen bleibt ───────────────────────────────────
 * Er ist die Tür. Dort setzt der Server die Verbindung zur Oberwelt an;
 * eine Wand davor wäre ein Grab, das man nicht betreten kann. Erkannt wird
 * er hart an zwei Merkmalen — Raum 0 UND `connection.entrance` — und nicht
 * etwa an der Position (0,0,0): Ein zweiter Connector, der dort zufällig
 * auch läge, bliebe sonst als Loch zurück.
 *
 * ── Welcher Abschluss ────────────────────────────────────────────────
 * Kits dürfen mehrere haben (das Steingrab hat zwei: `SteingrabAbschluss`
 * mit `endCapPrio` 0 und `SteingrabEndkappe` mit 10). Genommen wird der mit
 * der NIEDRIGSTEN Prio zuerst — dieselbe Wahl, die der Generator in seinem
 * Notfallzweig trifft (`endcapsFallbackByPrio`, das lockerste Teil zuerst).
 * Der erste, den `attachRoom` durchgehen lässt, gewinnt.
 *
 * Verändert wird ALLEIN `layout.rooms` (angehängt). `mode = 'custom'` setzt
 * diese Funktion NICHT — das ist Sache des Aufrufers, der auch weiss, ob er
 * gerade an einem Dokument oder an einer Vorschau arbeitet.
 */
export function schliesseOffeneKanten(
  layout: DungeonLayout,
  baseName: string
): KantenSchlussErgebnis {
  const def = DUNGEONS_BY_NAME.get(baseName);
  if (!def) return { gesetzt: 0, offenGeblieben: 0 };

  const nachName = new Map(def.rooms.map((r) => [r.name, r]));
  // Niedrigste `endCapPrio` zuerst — s. Kopfkommentar. `[...]` vor dem
  // Sortieren, weil `def.rooms` die Kit-Definition ist und nicht umsortiert
  // werden darf.
  const abschluesse = [...def.rooms]
    .filter((r) => r.endCap)
    .sort((a, b) => a.endCapPrio - b.endCapPrio);
  if (abschluesse.length === 0) {
    return { gesetzt: 0, offenGeblieben: offeneOhneEingang(layout, baseName, nachName).length };
  }

  let gesetzt = 0;
  for (let runde = 0; runde < MAX_RUNDEN; runde++) {
    const offen = offeneOhneEingang(layout, baseName, nachName);
    if (offen.length === 0) break;
    let inDieserRunde = 0;
    for (const kante of offen) {
      for (const abschluss of abschluesse) {
        // `attachRoom` RECHNET nur; anhängen ist Sache des Aufrufers.
        // Endkappen überspringen dabei die Kollisionsprüfung — eine Wand,
        // die einen Nachbarkörper streift, ist besser als ein Loch.
        const ergebnis = attachRoom(layout, baseName, kante, abschluss.name);
        if (!ergebnis.ok) continue;
        layout.rooms.push(ergebnis.placed);
        gesetzt++;
        inDieserRunde++;
        break;
      }
    }
    // Nichts ging mehr: Die restlichen Kanten passen zu keinem Abschluss
    // dieses Kits. Weiterdrehen brächte nur dasselbe Ergebnis noch einmal.
    if (inDieserRunde === 0) break;
  }

  return { gesetzt, offenGeblieben: offeneOhneEingang(layout, baseName, nachName).length };
}

/**
 * Die offenen Kanten OHNE die Eingangskante des Startraums.
 *
 * Eigene Funktion, weil sie ZWEIMAL gebraucht wird — vor dem Zumauern als
 * Arbeitsliste und danach als Zählung. Zwei Kopien derselben Bedingung
 * wären genau die Sorte Duplikat, bei der die eine Seite den Eingang
 * mitzählt und die andere nicht.
 */
function offeneOhneEingang(
  layout: DungeonLayout,
  baseName: string,
  nachName: ReadonlyMap<string, RoomDef>
): ReturnType<typeof computeOpenConnections> {
  return computeOpenConnections(layout, baseName).filter((c) => {
    if (c.roomIndex !== 0) return true;
    const start = nachName.get(layout.rooms[0]?.room ?? '');
    return !start?.connections[c.connIndex]?.entrance;
  });
}

/**
 * Der Satz, den beide Editoren nach dem Schliessen anzeigen.
 *
 * Auch das steht hier und nicht zweimal daneben: Der F4-Editor und die
 * Dungeon-Seite melden dasselbe Ereignis, und zwei getippte Sätze gehen
 * beim ersten Nachbessern auseinander. Wichtiger als der Wortlaut ist der
 * ZWEITE Halbsatz — er erscheint nur, wenn etwas offen blieb, und ist die
 * einzige Stelle, an der ein Loch überhaupt zur Sprache kommt.
 */
export function kantenSchlussMeldung(ergebnis: KantenSchlussErgebnis): string {
  const kern = `${ergebnis.gesetzt} ${ergebnis.gesetzt === 1 ? 'Wand' : 'Wände'} gesetzt`;
  return ergebnis.offenGeblieben === 0
    ? kern
    : `${kern} — ${ergebnis.offenGeblieben} Kante(n) blieben offen`;
}
