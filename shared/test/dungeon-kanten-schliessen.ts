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
  attachRoom,
  computeOpenConnections,
  generateDungeonLayout,
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

const e1 = schliesseOffeneKanten(eingang, vault.name);
pruefe(e1.gesetzt === 3, 'drei Wände gesetzt (die Eingangskante bleibt frei)', `${e1.gesetzt}`);
pruefe(e1.offenGeblieben === 0, 'nichts blieb ungewollt offen', `${e1.offenGeblieben}`);
pruefe(
  anzahlAbschluesse(eingang, vault) === 3,
  'und im Layout stehen drei Abschlussräume',
  `${anzahlAbschluesse(eingang, vault)}`
);
pruefe(offeneOhneEingang(eingang, vault) === 0, 'keine offene Kante ausser dem Eingang');
const eingangsKante = computeOpenConnections(eingang, vault.name);
pruefe(eingangsKante.length === 1, 'genau EINE Kante ist noch offen', `${eingangsKante.length}`);
pruefe(
  eingangsKante[0]!.roomIndex === 0 &&
    vaultRaum(eingang.rooms[0]!.room).connections[eingangsKante[0]!.connIndex]!.entrance === true,
  'und das ist die Eingangskante des Startraums'
);

// Ein zweiter Lauf darf NICHTS mehr tun — sonst stapelten sich Wände auf
// Wänden, und jedes Speichern liesse das Dokument wachsen.
const e2 = schliesseOffeneKanten(eingang, vault.name);
pruefe(e2.gesetzt === 0, 'ein zweiter Lauf setzt nichts nach', `${e2.gesetzt}`);
pruefe(eingang.rooms.length === 4, 'und das Layout bleibt bei vier Räumen', `${eingang.rooms.length}`);

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
pruefe(k.gesetzt === offenVorher - 1, 'jede offene Kante bis auf den Eingang bekam eine Wand',
  `${k.gesetzt} von ${offenVorher}`);
pruefe(k.offenGeblieben === 0, 'die Kette ist dicht', `${k.offenGeblieben}`);
pruefe(offeneOhneEingang(kette, vault) === 0, 'nachgezählt: kein Loch mehr');
pruefe(
  computeOpenConnections(kette, vault.name).length === 1,
  'nur der Eingang steht noch offen',
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

console.log(fehler === 0 ? '\nAlles grün.' : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
process.exit(fehler > 0 ? 1 : 0);
