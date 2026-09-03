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
import type { Vector3 } from './types.js';
import { DUNGEONS_BY_NAME } from './dungeons.js';
import { attachRoom, computeOpenConnections, removeRoom } from './dungeonGenerator.js';
import type { OpenConnection } from './dungeonGenerator.js';

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

// ---------------------------------------------------------------------------
// Anbaubare Kanten — wo darf der nächste Raum hin?
// ---------------------------------------------------------------------------

/**
 * Eine Kante, an die sich anbauen lässt.
 *
 * Sie ist eine `OpenConnection` und nichts anderes — genau das, was
 * `attachRoom` erwartet. `wandIndex` ist die einzige Zutat: Steht er, ist
 * die Kante nicht offen, sondern von einem Abschlussraum ZUGEMAUERT, und
 * dieser Raum muss weg, bevor dort etwas anderes hinkommt.
 */
export interface AnbaubareKante extends OpenConnection {
  /**
   * Index des Abschlussraums (`endCap`) im Layout, der diese Kante belegt.
   * Fehlt bei einer wirklich offenen Kante.
   *
   * ACHTUNG: Der Index gilt für das Layout, aus dem die Liste gezogen
   * wurde. Nach jedem `removeRoom` rutschen die Indizes — wer eine solche
   * Liste aufhebt, hebt eine Lüge auf. `fuegeAnKante` weiter unten nimmt
   * einem das ab.
   */
  wandIndex?: number;
}

/** Quadratischer Abstand — die Koinzidenzprobe des Generators, 0,1 m. */
function abstandQuadrat(a: Vector3, b: Vector3): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

/**
 * Alle Connector-Positionen der Abschlussräume, samt ihrem Raumindex.
 *
 * Gerechnet wird über `computeOpenConnections` auf einem Layout, das NUR
 * diesen einen Raum enthält: Alleinstehend ist jeder seiner Connectors
 * offen, und man bekommt sie in Weltkoordinaten heraus, ohne die
 * Quaternionen-Rechnung aus `dungeonGenerator.ts` hier ein zweites Mal
 * hinzuschreiben. Eine zweite Kopie dieser Rechnung wäre genau die Sorte
 * Duplikat, die erst dann auffällt, wenn eine Drehung anders gerundet wird
 * als dort.
 */
function wandConnectors(
  layout: DungeonLayout,
  baseName: string,
  istWand: (index: number) => boolean
): Array<{ wandIndex: number; pos: Vector3 }> {
  const out: Array<{ wandIndex: number; pos: Vector3 }> = [];
  layout.rooms.forEach((r, i) => {
    if (!istWand(i)) return;
    const einzeln: DungeonLayout = { ...layout, rooms: [r], doors: [], props: [] };
    for (const c of computeOpenConnections(einzeln, baseName)) {
      out.push({ wandIndex: i, pos: c.pos });
    }
  });
  return out;
}

/**
 * Die Kanten, an denen weitergebaut werden darf — offene UND zugemauerte.
 *
 * ── Warum die zugemauerten mitkommen ─────────────────────────────────
 * Im Modul-Kit ist eine Wand ein eigener Raum (`StoneVaultWall`,
 * `endCap`). Ein Grab, das einmal dicht gemacht wurde — und das tut der
 * Editor beim Speichern von selbst —, hat danach genau EINE offene Kante:
 * den Eingang. Wer weiterbauen wollte, musste erst im Grundriss eine Wand
 * suchen, anklicken und entfernen; das ist ein Umweg, den niemand von
 * selbst findet, und im Grundriss sieht ein zugemauertes Grab aus wie ein
 * fertiges. Eine Wand ist aber kein Bauwerk, sondern ein Platzhalter für
 * „hier ist noch nichts" — also gehört sie in dieselbe Liste wie eine
 * offene Kante, nur erkennbar markiert.
 *
 * ── Wie eine verwandete Kante gefunden wird ──────────────────────────
 * Die Kante gehört dem NACHBARN, nicht der Wand: Angefügt wird an die
 * Verbindung der Zelle, vor der die Wand steht. Gerechnet wird sie
 * deshalb auf einem Layout OHNE die Abschlussräume — was dort offen ist
 * und im echten Layout nicht, ist genau eine verwandete Kante. Der
 * `wandIndex` kommt danach über Connector-Koinzidenz (0,1 m, dieselbe
 * Schwelle wie in `computeOpenConnections`).
 *
 * ── Was NICHT angeboten wird ─────────────────────────────────────────
 * Die Eingangskante des Startraums (Raum 0 UND `connection.entrance`) —
 * weder offen noch verwandet. Dort geht es hinaus; der Server setzt genau
 * dort die Verbindung zur Oberwelt an. Ein Raum davor wäre ein Grab, das
 * man nicht betreten kann.
 *
 * Reihenfolge: erst die offenen Kanten in der Reihenfolge von
 * `computeOpenConnections`, dann die verwandeten. Die offenen behalten
 * damit ihre Plätze, und ein Editor, der auf Index 0 vorbelegt, zeigt
 * weiterhin dorthin, wo wirklich ein Loch ist.
 */
export function anbaubareKanten(layout: DungeonLayout, baseName: string): AnbaubareKante[] {
  const def = DUNGEONS_BY_NAME.get(baseName);
  if (!def) return [];
  const nachName = new Map(def.rooms.map((r) => [r.name, r]));
  const istWand = (index: number): boolean =>
    !!nachName.get(layout.rooms[index]?.room ?? '')?.endCap;
  const istEingangsKante = (roomIndex: number, connIndex: number): boolean =>
    roomIndex === 0 &&
    !!nachName.get(layout.rooms[0]?.room ?? '')?.connections[connIndex]?.entrance;

  const kanten: AnbaubareKante[] = offeneOhneEingang(layout, baseName, nachName).map((c) => ({
    ...c,
  }));
  const schonDa = new Set(kanten.map((k) => `${k.roomIndex}/${k.connIndex}`));

  // Layout ohne die Wände — und die Rückabbildung auf die Indizes des
  // Originals. Ohne sie zeigte jeder `roomIndex` nach dem ersten
  // Abschlussraum auf den falschen Raum.
  const zurueck: number[] = [];
  const ohneWaende: DungeonLayout = { ...layout, rooms: [], doors: [], props: [] };
  layout.rooms.forEach((r, i) => {
    if (istWand(i)) return;
    ohneWaende.rooms.push(r);
    zurueck.push(i);
  });

  const waende = wandConnectors(layout, baseName, istWand);
  for (const c of computeOpenConnections(ohneWaende, baseName)) {
    const roomIndex = zurueck[c.roomIndex];
    if (roomIndex === undefined) continue;
    if (schonDa.has(`${roomIndex}/${c.connIndex}`)) continue;
    if (istEingangsKante(roomIndex, c.connIndex)) continue;
    const wand = waende.find((w) => abstandQuadrat(w.pos, c.pos) < 0.1 * 0.1);
    // Keine Wand in Reichweite: Dann steht dort etwas anderes (eine Zelle,
    // die im vollen Layout andockt) — das ist keine anbaubare Kante.
    if (!wand) continue;
    kanten.push({ ...c, roomIndex, wandIndex: wand.wandIndex });
  }
  return kanten;
}

/**
 * Die Beschriftung einer anbaubaren Kante — für BEIDE Editoren dieselbe.
 *
 * Bis zum 03.09.2026 stand dieser Ausdruck zweimal da, einmal je Editor.
 * Solange beide nur „Raum#i/j [typ]" sagten, fiel das nicht auf; mit dem
 * Zusatz „(Wand)" wäre die zweite Kopie die gewesen, die ihn nicht
 * bekommt — und dort klickte man dann ahnungslos eine Wand weg.
 */
export function kantenBeschriftung(layout: DungeonLayout, kante: AnbaubareKante): string {
  const raum = layout.rooms[kante.roomIndex]?.room ?? '?';
  return (
    `${raum}#${kante.roomIndex}/${kante.connIndex}` +
    `${kante.type ? ` [${kante.type}]` : ''}${kante.wandIndex === undefined ? '' : ' (Wand)'}`
  );
}

/** Was `fuegeAnKante` getan hat. */
export type AnfuegeErgebnis =
  | { ok: true; wandErsetzt: boolean }
  | { ok: false; reason: string };

/**
 * Einen Raum an eine anbaubare Kante setzen — notfalls über die Wand hinweg.
 *
 * Bei einer offenen Kante ist das schlicht `attachRoom` plus das Anhängen,
 * das jener Funktion ausdrücklich nicht gehört.
 *
 * ── Warum eine Kopie und nicht „erst abreissen, dann bauen" ──────────
 * An einer verwandeten Kante muss die Wand weg, BEVOR `attachRoom` etwas
 * hinstellen kann: Sie stünde sonst als Kollisionskörper im Weg. Passt der
 * neue Raum dann doch nicht, wäre die Wand trotzdem gefallen — und ein
 * Fehlversuch hinterliesse ein Loch, das niemand angekündigt hat.
 * Gerechnet wird deshalb auf einer KOPIE des Layouts; das echte wird erst
 * angefasst, wenn feststeht, dass es klappt. Ein Fehlschlag ist damit
 * folgenlos.
 *
 * ── Die Indizes rutschen ─────────────────────────────────────────────
 * `removeRoom` schiebt jeden Raum hinter dem entfernten um eins nach vorn.
 * Der `roomIndex` der Kante muss deshalb NACH dem Entfernen neu bestimmt
 * werden. Position und Drehung der Kante bleiben, wo sie sind — der
 * Nachbarraum wurde ja nicht bewegt.
 */
export function fuegeAnKante(
  layout: DungeonLayout,
  baseName: string,
  kante: AnbaubareKante,
  raumName: string,
  kanteIndex?: number
): AnfuegeErgebnis {
  if (kante.wandIndex === undefined) {
    const ergebnis = attachRoom(layout, baseName, kante, raumName, kanteIndex);
    if (!ergebnis.ok) return { ok: false, reason: ergebnis.reason };
    layout.rooms.push(ergebnis.placed);
    return { ok: true, wandErsetzt: false };
  }

  const wandIndex = kante.wandIndex;
  const probe = JSON.parse(JSON.stringify(layout)) as DungeonLayout;
  const weg = removeRoom(probe, baseName, wandIndex);
  if (!weg.ok) return { ok: false, reason: weg.reason ?? 'Wand lässt sich nicht entfernen' };
  const verschoben: AnbaubareKante = {
    ...kante,
    roomIndex: kante.roomIndex > wandIndex ? kante.roomIndex - 1 : kante.roomIndex,
  };
  const ergebnis = attachRoom(probe, baseName, verschoben, raumName, kanteIndex);
  if (!ergebnis.ok) return { ok: false, reason: ergebnis.reason };

  // Erst jetzt ans echte Layout: dieselben zwei Schritte, dasselbe
  // Ergebnis — die Kopie hat bewiesen, dass sie durchgehen.
  removeRoom(layout, baseName, wandIndex);
  layout.rooms.push(ergebnis.placed);
  return { ok: true, wandErsetzt: true };
}
