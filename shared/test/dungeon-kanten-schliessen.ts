/**
 * `schliesseOffeneKanten` — jede offene Kante bekommt ihre Wand, ausser
 * dem Eingang.
 *
 * ── Warum das eine eigene Prüfung braucht ────────────────────────────
 * Im Modul-Kit `DG_StoneVault` ist eine Wand kein Teil der Zelle, sondern
 * ein EIGENER Raum (`StoneVaultWall`, `endCap: true`). Der Generator
 * zieht ihn über `placeEndCaps` auf jede Kante, die sonst ins Nichts
 * zeigte — die beiden Editoren taten das bis zum 03.09.2026 nicht. Was
 * dort von Hand gebaut wurde, hatte im Spiel Löcher, und zwar lautlos:
 * Im Grundriss sieht eine offene Kante genauso aus wie eine, an der noch
 * gebaut werden soll. Der Unterschied fällt erst auf, wenn man drin steht
 * und ins Schwarze schaut.
 *
 * Gemessen wird deshalb an der ZAHL der Wände und an den offen
 * gebliebenen Kanten, nicht daran, dass die Funktion „durchläuft":
 * Ein Abschluss, der wegen Kollision nicht gesetzt wird, wäre ein
 * stiller Fehlschlag mit genau demselben Rückgabewert `{ gesetzt: 0 }`,
 * wenn man nur „wirft nicht" prüft.
 *
 * Der EINGANG bleibt offen — das ist keine Lücke, sondern die Tür: Dort
 * setzt der Server die Verbindung zur Oberwelt an. Eine Wand davor wäre
 * ein Grab, das man nicht betreten kann.
 *
 * Lauf: npx tsx shared/test/dungeon-kanten-schliessen.ts   (aus dem Repo-Wurzelverzeichnis)
 */
import {
  DUNGEONS_BY_NAME,
  anbaubareKanten,
  attachRoom,
  computeOpenConnections,
  fuegeAnKante,
  generateDungeonLayout,
  kantenBeschriftung,
  removeRoom,
  schliesseOffeneKanten,
  type DungeonDef,
  type DungeonLayout,
  type RoomDef,
} from '../src/index.js';

let fehler = 0;
function pruefe(bedingung: boolean, was: string, zusatz = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${was}${zusatz ? ` — ${zusatz}` : ''}`);
}

/**
 * Der Startzustand, den auch „Neu anlegen" im Editor herstellt: der
 * Eingangsraum mit ALLEN Kanten offen. `maxRooms: 0` liefert den Eingang
 * plus die Abschlüsse, die `placeEndCaps` gleich darüberzieht — die
 * fallen hier mit `removeRoom` wieder weg, genau wie in
 * `client/src/editor/DungeonNeuesDokument.ts`.
 */
function leeresLayout(def: DungeonDef, seed = 7): DungeonLayout {
  const layout = generateDungeonLayout({ ...def, maxRooms: 0, minRequiredRooms: 0 }, seed);
  const istAbschluss = new Map(def.rooms.map((r) => [r.name, !!r.endCap]));
  for (let i = layout.rooms.length - 1; i >= 0; i--) {
    if (istAbschluss.get(layout.rooms[i]!.room)) removeRoom(layout, def.name, i);
  }
  return layout;
}

/** Die offenen Kanten OHNE die Eingangskante des Startraums. */
function offeneOhneEingang(layout: DungeonLayout, def: DungeonDef): number {
  const nachName = new Map(def.rooms.map((r) => [r.name, r]));
  return computeOpenConnections(layout, def.name).filter((c) => {
    if (c.roomIndex !== 0) return true;
    const raum = nachName.get(layout.rooms[0]!.room);
    return !raum?.connections[c.connIndex]?.entrance;
  }).length;
}

function anzahlAbschluesse(layout: DungeonLayout, def: DungeonDef): number {
  const istAbschluss = new Map(def.rooms.map((r) => [r.name, !!r.endCap]));
  return layout.rooms.filter((r) => istAbschluss.get(r.room)).length;
}

// ── 1. DG_StoneVault: Eingang mit vier offenen Kanten ───────────────
console.log('DG_StoneVault:');
const vault = DUNGEONS_BY_NAME.get('DG_StoneVault')!;
const vaultRaum = (name: string): RoomDef => vault.rooms.find((r) => r.name === name)!;

const eingang = leeresLayout(vault);
pruefe(eingang.rooms.length === 1, 'Ausgangslage: nur der Eingangsraum', `${eingang.rooms.length}`);
pruefe(
  computeOpenConnections(eingang, vault.name).length === 4,
  'und vier offene Kanten',
  `${computeOpenConnections(eingang, vault.name).length}`
);

// Seit dem 04.09.2026 gehört die Eingangskante dazu: Die Zelle davor
// bleibt im Rasterpfad für immer leer, und ein offener Port machte daraus
// einen Schacht ohne Decke und ohne Boden — Mikes „Lichtfuge". Betreten
// wird ein Grab per Teleport, nicht durch den Port. Vier Kanten, vier
// Wände. (Für Nicht-Rasterkits bleibt es beim alten Verhalten, s. u.)
const e1 = schliesseOffeneKanten(eingang, vault.name);
pruefe(e1.gesetzt === 4, 'vier Wände gesetzt (die Eingangskante gehört dazu)', `${e1.gesetzt}`);
pruefe(e1.offenGeblieben === 0, 'nichts blieb ungewollt offen', `${e1.offenGeblieben}`);
pruefe(
  anzahlAbschluesse(eingang, vault) === 4,
  'und im Layout stehen vier Abschlussräume',
  `${anzahlAbschluesse(eingang, vault)}`
);
pruefe(offeneOhneEingang(eingang, vault) === 0, 'keine offene Kante ausser dem Eingang');
const eingangsKante = computeOpenConnections(eingang, vault.name);
pruefe(eingangsKante.length === 0, 'auch die Eingangskante ist zu', `${eingangsKante.length}`);
// Die Platte davor ist trotzdem keine Einladung zum Anbauen: Der Editor
// zeigt die Eingangskante weiterhin nicht (`anbaubareKanten`, dort geprüft).
pruefe(
  vaultRaum(eingang.rooms[0]!.room).connections.some((c) => c.entrance),
  'der Startraum führt weiterhin einen Eingangsconnector'
);

// Ein zweiter Lauf darf NICHTS mehr tun — sonst stapelten sich Wände auf
// Wänden, und jedes Speichern liesse das Dokument wachsen.
const e2 = schliesseOffeneKanten(eingang, vault.name);
pruefe(e2.gesetzt === 0, 'ein zweiter Lauf setzt nichts nach', `${e2.gesetzt}`);
pruefe(eingang.rooms.length === 5, 'und das Layout bleibt bei fünf Räumen', `${eingang.rooms.length}`);

// ── 2. Kette Eingang → Korridor → Halle ─────────────────────────────
const kette = leeresLayout(vault);
{
  const anfuegen = (name: string): void => {
    const offen = computeOpenConnections(kette, vault.name).filter((c) => {
      const raum = vault.rooms.find((r) => r.name === kette.rooms[c.roomIndex]!.room);
      return !(c.roomIndex === 0 && raum?.connections[c.connIndex]?.entrance);
    });
    const ziel = offen[0]!;
    const erg = attachRoom(kette, vault.name, ziel, name);
    if (!erg.ok) throw new Error(`${name} liess sich nicht anfügen: ${erg.reason}`);
    kette.rooms.push(erg.placed);
  };
  anfuegen('StoneVaultCorridor');
  anfuegen('StoneVaultHall');
}
pruefe(kette.rooms.length === 3, 'Kette steht: Eingang, Korridor, Halle', `${kette.rooms.length}`);
const offenVorher = computeOpenConnections(kette, vault.name).length;
const k = schliesseOffeneKanten(kette, vault.name);
pruefe(k.gesetzt === offenVorher, 'jede offene Kante bekam eine Wand — der Eingang mit',
  `${k.gesetzt} von ${offenVorher}`);
pruefe(k.offenGeblieben === 0, 'die Kette ist dicht', `${k.offenGeblieben}`);
pruefe(offeneOhneEingang(kette, vault) === 0, 'nachgezählt: kein Loch mehr');
pruefe(
  computeOpenConnections(kette, vault.name).length === 0,
  'nicht einmal der Eingang steht noch offen',
  `${computeOpenConnections(kette, vault.name).length}`
);

// ── 3. DG_Steingrab: zwei Abschlusstypen, der niedrigere gewinnt ────
//
// Das Steingrab hat ZWEI endCaps (`SteingrabAbschluss`, endCapPrio 0, und
// `SteingrabEndkappe`, endCapPrio 10). Die Reihenfolge ist nicht Kosmetik:
// Der Generator nimmt im Notfall den mit der NIEDRIGSTEN Prio (das
// schmalste Teil), und dieselbe Wahl muss der Editor treffen — sonst
// stünde von Hand gebaut ein anderes Stück Stein als gewürfelt.
console.log('\nDG_Steingrab:');
const grab = DUNGEONS_BY_NAME.get('DG_Steingrab')!;
const grabLayout = leeresLayout(grab, 11);
const grabOffenVorher = computeOpenConnections(grabLayout, grab.name).length;
const g = schliesseOffeneKanten(grabLayout, grab.name);
pruefe(g.gesetzt === grabOffenVorher - 1, 'jede Kante bis auf den Eingang geschlossen',
  `${g.gesetzt} von ${grabOffenVorher}`);
pruefe(g.offenGeblieben === 0, 'auch das Steingrab wird dicht', `${g.offenGeblieben}`);
pruefe(offeneOhneEingang(grabLayout, grab) === 0, 'nachgezählt: kein Loch mehr');
const gesetzteNamen = new Set(
  grabLayout.rooms
    .filter((r) => grab.rooms.find((d) => d.name === r.room)?.endCap)
    .map((r) => r.room)
);
pruefe(
  gesetzteNamen.size === 1 && gesetzteNamen.has('SteingrabAbschluss'),
  'gesetzt wird der Abschluss mit der niedrigsten endCapPrio',
  [...gesetzteNamen].join(', ')
);

// ── 4. Ein Kit ohne Abschlüsse ist kein Absturz ─────────────────────
//
// `offenGeblieben` ist der ehrliche Rückgabewert für „ging nicht" — der
// Editor kann daraus eine Meldung machen, statt zu behaupten, es sei
// dicht.
const ohneBasis = leeresLayout(vault);
const fremd = schliesseOffeneKanten(ohneBasis, 'DG_GibtEsNicht');
pruefe(fremd.gesetzt === 0, 'unbekannte Basis setzt nichts', `${fremd.gesetzt}`);
pruefe(ohneBasis.rooms.length === 1, 'und lässt das Layout in Ruhe', `${ohneBasis.rooms.length}`);

// ── 5. anbaubareKanten: die Wand ist ein Angebot, kein Hindernis ────
//
// ── Warum das eine eigene Prüfung braucht ───────────────────────────
// Seit „Kanten schließen" mauert der Editor beim Speichern zu. Danach hat
// ein Grab GENAU EINE offene Kante — den Eingang, und der wird nicht
// angeboten. Ohne `anbaubareKanten` stünde man vor einer leeren
// Anfügen-Liste und müsste erst im Grundriss eine Wand suchen und
// abreissen; im Grundriss sieht ein zugemauertes Grab aber aus wie ein
// fertiges, und die Wand findet man nur, wenn man weiss, dass es sie gibt.
//
// Gemessen wird an der ZAHL und am `wandIndex`, nicht daran, dass die
// Funktion etwas zurückgibt: Eine Liste ohne `wandIndex` sähe im Editor
// genauso aus und risse beim Anfügen die falsche (oder gar keine) Wand weg.
console.log('\nanbaubareKanten:');

/**
 * Die Zusagen, die jede Liste halten muss — sie werden nach JEDEM Schritt
 * geprüft, weil genau hier die Indizes rutschen: `removeRoom` schiebt alles
 * hinter dem entfernten Raum um eins nach vorn. Ein `wandIndex`, der auf
 * einen Nicht-Abschluss zeigt, ist der Fehler, den man sonst erst bemerkt,
 * wenn beim Anfügen ein Korridor verschwindet.
 */
function invarianten(layout: DungeonLayout, def: DungeonDef, wo: string): void {
  const nachName = new Map(def.rooms.map((r) => [r.name, r]));
  const istWand = (i: number): boolean => !!nachName.get(layout.rooms[i]?.room ?? '')?.endCap;
  const kanten = anbaubareKanten(layout, def.name);
  const nachbarOk = kanten.every((k) => layout.rooms[k.roomIndex] !== undefined && !istWand(k.roomIndex));
  const wandOk = kanten.every((k) => k.wandIndex === undefined || istWand(k.wandIndex));
  const eingangWeg = !kanten.some(
    (k) => k.roomIndex === 0 && nachName.get(layout.rooms[0]!.room)?.connections[k.connIndex]?.entrance
  );
  pruefe(nachbarOk, `${wo}: jede Kante gehört einem echten Nicht-Abschluss`);
  pruefe(wandOk, `${wo}: jeder wandIndex zeigt auf einen Abschlussraum`);
  pruefe(eingangWeg, `${wo}: die Eingangskante wird nicht angeboten`);
}

// 5a. Offener Eingangsraum — drei Kanten, keine davon verwandet.
const offenerEingang = leeresLayout(vault);
const offeneKanten = anbaubareKanten(offenerEingang, vault.name);
pruefe(offeneKanten.length === 3, 'offener Eingang: drei anbaubare Kanten', `${offeneKanten.length}`);
pruefe(
  offeneKanten.every((k) => k.wandIndex === undefined),
  'und keine davon ist verwandet'
);
invarianten(offenerEingang, vault, 'offener Eingang');

// 5b. Dichter Eingangsraum — dieselben drei Kanten, jetzt mit wandIndex.
const dicht = leeresLayout(vault);
schliesseOffeneKanten(dicht, vault.name);
pruefe(computeOpenConnections(dicht, vault.name).length === 0, 'dicht: keine offene Kante mehr');
const dichteKanten = anbaubareKanten(dicht, vault.name);
pruefe(dichteKanten.length === 3, 'dichter Eingang: trotzdem drei anbaubare Kanten',
  `${dichteKanten.length}`);
pruefe(
  dichteKanten.every((k) => k.wandIndex !== undefined),
  'und jede trägt den Index ihrer Wand',
  dichteKanten.map((k) => String(k.wandIndex)).join(', ')
);
pruefe(
  dichteKanten.every((k) => k.roomIndex === 0),
  'die Kante gehört dem NACHBARN (Raum 0), nicht der Wand'
);
pruefe(
  new Set(dichteKanten.map((k) => k.wandIndex)).size === 3,
  'drei verschiedene Wände, nicht dreimal dieselbe'
);
pruefe(
  kantenBeschriftung(dicht, dichteKanten[0]!).endsWith(' (Wand)'),
  'die Beschriftung sagt „(Wand)"',
  kantenBeschriftung(dicht, dichteKanten[0]!)
);
invarianten(dicht, vault, 'dichter Eingang');

// 5c. Anfügen an eine verwandete Kante: die Wand fällt, der Raum kommt.
const ersetzt = leeresLayout(vault);
schliesseOffeneKanten(ersetzt, vault.name);
const zielKante = anbaubareKanten(ersetzt, vault.name)[0]!;
const wandVorher = ersetzt.rooms[zielKante.wandIndex!]!.room;
const erg = fuegeAnKante(ersetzt, vault.name, zielKante, 'StoneVaultCorridor');
pruefe(erg.ok && erg.wandErsetzt, 'Anfügen an eine Wandkante meldet „Wand ersetzt"');
pruefe(ersetzt.rooms.length === 5, 'die Raumzahl bleibt bei fünf (Wand raus, Gang rein)',
  `${ersetzt.rooms.length}`);
pruefe(anzahlAbschluesse(ersetzt, vault) === 3, 'genau eine Wand ist gefallen',
  `${anzahlAbschluesse(ersetzt, vault)} von 3 (${wandVorher})`);
pruefe(
  ersetzt.rooms[ersetzt.rooms.length - 1]!.room === 'StoneVaultCorridor',
  'und der Korridor steht am Ende der Liste'
);
pruefe(ersetzt.rooms[0]!.room === 'StoneVaultEntry', 'der Eingang bleibt Raum 0');
pruefe(
  !anbaubareKanten(ersetzt, vault.name).some(
    (k) => k.roomIndex === 0 && k.connIndex === zielKante.connIndex
  ),
  'die ersetzte Kante wird nicht mehr angeboten — dort steht jetzt ein Raum'
);
invarianten(ersetzt, vault, 'nach dem Ersetzen');

// Und weiter geht es: zumauern, wieder eine Wand ersetzen. Der zweite
// Durchgang ist der eigentliche Prüfstein — jetzt stehen Wände VOR und
// HINTER dem Nachbarraum in der Liste.
schliesseOffeneKanten(ersetzt, vault.name);
invarianten(ersetzt, vault, 'zweite Runde, dicht');
const zweite = anbaubareKanten(ersetzt, vault.name).find(
  (k) => k.roomIndex === ersetzt.rooms.findIndex((r) => r.room === 'StoneVaultCorridor')
)!;
pruefe(zweite !== undefined, 'auch der Korridor bietet verwandete Kanten an');
const vorZahl = ersetzt.rooms.length;
const erg2 = fuegeAnKante(ersetzt, vault.name, zweite, 'StoneVaultCorridor');
pruefe(erg2.ok && erg2.wandErsetzt, 'zweiter Anbau an eine Wandkante geht durch');
pruefe(ersetzt.rooms.length === vorZahl, 'wieder eine raus, eine rein', `${ersetzt.rooms.length}`);
pruefe(
  ersetzt.rooms.filter((r) => r.room === 'StoneVaultCorridor').length === 2,
  'jetzt stehen zwei Korridore'
);
invarianten(ersetzt, vault, 'nach dem zweiten Ersetzen');

// 5d. Ein Fehlschlag ist FOLGENLOS — die Wand bleibt stehen.
//
// Das ist der Grund, warum `fuegeAnKante` auf einer Kopie rechnet: Risse
// es die Wand zuerst weg und scheiterte danach, hinterliesse jeder
// Fehlversuch ein Loch, das niemand angekündigt hat. Der Fehlschlag hier
// ist ein Ausrichtungs-Index, den es nicht gibt — `attachRoom` weist ihn
// ab, und zwar erst NACH dem (gedachten) Entfernen.
const folgenlos = leeresLayout(vault);
schliesseOffeneKanten(folgenlos, vault.name);
const raeumeVorher = JSON.stringify(folgenlos.rooms);
const misslungen = fuegeAnKante(
  folgenlos,
  vault.name,
  anbaubareKanten(folgenlos, vault.name)[0]!,
  'StoneVaultCorridor',
  99
);
pruefe(!misslungen.ok, 'ein Ausrichtungs-Index, den es nicht gibt, fügt nichts an');
pruefe(
  JSON.stringify(folgenlos.rooms) === raeumeVorher,
  'und das Layout ist Byte für Byte unverändert — die Wand steht noch'
);

// 5e. Die offene Kante bleibt der einfache Fall.
const einfach = leeresLayout(vault);
const einfachKante = anbaubareKanten(einfach, vault.name)[0]!;
const erg3 = fuegeAnKante(einfach, vault.name, einfachKante, 'StoneVaultCorridor');
pruefe(erg3.ok && !erg3.wandErsetzt, 'an einer offenen Kante fällt keine Wand');
pruefe(einfach.rooms.length === 2, 'und es steht ein Raum mehr da', `${einfach.rooms.length}`);
pruefe(
  kantenBeschriftung(einfach, einfachKante).includes('StoneVaultEntry#0/'),
  'die Beschriftung nennt Raum, Index und Typ',
  kantenBeschriftung(einfach, einfachKante)
);

// 5f. Unbekannte Basis: leere Liste statt Absturz.
pruefe(anbaubareKanten(einfach, 'DG_GibtEsNicht').length === 0, 'unbekannte Basis bietet nichts an');

console.log(fehler === 0 ? '\nAlles grün.' : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
process.exit(fehler > 0 ? 1 : 0);
