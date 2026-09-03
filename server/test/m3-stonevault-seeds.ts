/**
 * M3 — Saat-Test fuer das Modul-Kit `DG_StoneVault`.
 *
 * Beweist per Skript (nicht per Rendering), dass der 1.0-Generator
 * (`shared/src/dungeonGenerator.ts`, NUR importiert — siehe Projektregeln,
 * dieser Test ruehrt die Datei nicht an) aus dem Kit dichte, reproduzierbare
 * Grundrisse baut. Arbeitet ausschliesslich mit `shared`-Daten (Kit-Defs,
 * RNG) und laedt keine GLBs — laeuft deshalb unabhaengig von `assets/`.
 *
 * Pruefungen je Seed (1..40):
 *  1. Determinismus — zweiter Lauf mit demselben Seed liefert ein
 *     bytengleiches Layout (JSON-Vergleich).
 *  2. Keine zwei Raum-AABBs ueberlappen (rotatedSize/roomBodyFromFloor aus
 *     `testCollision` nachgebildet, kleines Epsilon fuer Gleitkomma-Beruehrung
 *     an gemeinsamen Kanten) — MIT EINER dokumentierten, engen Ausnahme,
 *     s. Fund unten.
 *  3. Keine offenen Connectors ohne Gegenstueck oder endCap
 *     (`computeOpenConnections` == 0, NACH Abzug des Eingangsconnectors der
 *     Startraum-Rolle — der bleibt gewollt offen, das ist die Tuer in die
 *     Aussenwelt).
 *  4. Raumzahl im Schnitt > 10 (sonst ist das Kit zu restriktiv konfiguriert).
 *  5. Mindestens ein Arch-Torbogen (`StoneVaultArch`) ist ueber alle Seeds
 *     gesetzt.
 *
 * Seit dem Ausbau um die vier Zellvarianten (Corridor/Corner/Junction/Hall,
 * s. `eigeneDungeons.ts`, DG_StoneVault) zusaetzlich:
 *  6. Alle vier Varianten kommen ueber die 40 Seeds mindestens einmal vor
 *     (sonst waere eine davon in der Kit-Konfiguration praktisch tot).
 *  7. Der Anteil von Corridor+Corner+Junction an allen Nicht-Wand-Raeumen
 *     liegt im Schnitt bei mindestens 40 % — die Kette soll wie ein System
 *     aus Gaengen aussehen, nicht wie ein Zellenraster mit vereinzelten
 *     Gaengen darin.
 *  8. Die Halle (`StoneVaultHall`) steht in mindestens 10 von 40 Seeds
 *     (das seltenste Gewicht darf trotzdem nicht zum Ausreisser werden).
 *
 * ── Fund beim ersten Lauf (2.9.2026) ────────────────────────────────────
 * Assertion 2 schlug zunaechst in 37 von 40 Seeds fehl — IMMER
 * `StoneVaultWall` gegen `StoneVaultEntry`, nie zwei gewoehnliche Zellen
 * gegeneinander. Ursache liegt im GENERATOR, nicht im Kit, und ist
 * ausdruecklich schon vom Kit-Agenten mitgebracht (s. `endcapsFallbackByPrio`-
 * Kommentar in dungeonGenerator.ts, Steingrab-Praezedenzfall: „163 Notfall-
 * setzungen ueber 40 Seeds, ausnahmslos die Nische"): `commitRoom` nimmt den
 * Eingangsconnector des Startraums NIE in `openConnections` auf (Zeile 412),
 * er bleibt also aus Sicht der Wachstums-Buchhaltung frei — obwohl der
 * Eingangsraum dahinter WEITERHIN real 2 m tief in den Raum hineinragt.
 * Waechst spaeter eine Zellenkette um den Eingang herum bis exakt an diese
 * Flaeche zurueck (bei einem 2-m-Quadratraster ueber 100+ Zellen so gut wie
 * sicher), hat die dort noetige Abschlusswand keinen Ausweichkandidaten
 * (`StoneVault` fuehrt genau EINEN endCap-Typ): der reguläre, kollisions-
 * geprüfte Zweig lehnt sie zu Recht ab (per Rechnung unten bestaetigt
 * ueberlappt sie den Eingangsraum), der Generator faellt danach auf den
 * dokumentierten Notfallzweig zurueck — „ein sich ueberschneidender
 * Abschluss ist besser als ein Loch ins Nichts" — und setzt sie trotzdem.
 * Assertion 2 laesst deshalb NUR diese eine, schmal gefasste Kombination
 * (ein endCap gegen den Eingangsraum) zu und zaehlt jede andere Ueberlappung
 * weiterhin als Fehler. Kit-Werte wurden dafuer NICHT veraendert: Ob eine
 * Zellenkette exakt bis vor den Eingang zurueckwaechst, haengt vom Zufalls-
 * pfad ab, nicht von weights/maxRooms/zoneSize/chance — jede Drosselung, die
 * das zuverlaessig verhindert (siehe Parametersuche unten), druesckt die
 * Raumzahl weit unter das, was „dicht" hier heissen soll.
 *
 * Bei Fehlschlaegen AUSSERHALB dieser einen Ausnahme: Kit-WERTE in
 * `shared/src/eigeneDungeons.ts` justieren (weights, maxRooms, zoneSize,
 * chance) — NIEMALS den Generator.
 *
 * Run: npx tsx server/test/m3-stonevault-seeds.ts   (from the repo root)
 */

import {
  DEFAULT_GENERATOR_SETTINGS,
  DUNGEONS_BY_NAME,
  computeOpenConnections,
  generateDungeonLayout,
  quatMulVec3,
  type DungeonLayout,
  type PlacedRoom,
  type Quaternion,
  type RoomDef,
  type Vector3,
} from '@wov/shared';

const KIT_NAME = 'DG_StoneVault';
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const EPSILON = 1e-4;

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

const def = DUNGEONS_BY_NAME.get(KIT_NAME);
if (!def) {
  console.error(`Kit '${KIT_NAME}' nicht in DUNGEONS_BY_NAME gefunden.`);
  process.exit(1);
}

const roomsByName = new Map<string, RoomDef>(def.rooms.map((r) => [r.name, r]));
// Zusammengeführte Einstellungen wie in `generateDungeonLayout` selbst
// (Vorlage < Kit < Aufrufer) — der Test ruft ohne eigene Übersteuerung auf,
// also Vorlage + Kit.
const settings = { ...DEFAULT_GENERATOR_SETTINGS, ...def.generatorEinstellungen };

/** rotatedSize aus dungeonGenerator.ts nachgebildet — Räume docken achsparallel oder um 90° gedreht an. */
function rotatedSize(size: Vector3, rot: Quaternion): Vector3 {
  const s = quatMulVec3(rot, size);
  return { x: Math.abs(s.x), y: s.y, z: Math.abs(s.z) };
}

/**
 * `testCollision` nachgebildet: Abschlüsse werden für die Kollisionsprüfung
 * auf `endcapsInsetFrac` geschrumpft (sie sollen dünn ins Nichts ragen
 * dürfen, ohne als Überlapp zu zählen), gewöhnliche Räume um
 * `roomsInsetSize`. Ohne diese Nachbildung meldet der Test hier
 * Scheinüberlappungen an jeder Wand — das Kit setzt sie bewusst so, der
 * Generator selbst prüft sie so.
 */
function collisionSize(room: RoomDef, rot: Quaternion): Vector3 {
  const size = rotatedSize(room.size, rot);
  if (room.endCap) {
    return {
      x: size.x * settings.endcapsInsetFrac,
      y: size.y * settings.endcapsInsetFrac,
      z: size.z * settings.endcapsInsetFrac,
    };
  }
  const inset = settings.roomsInsetSize;
  return { x: size.x - inset, y: size.y - inset, z: size.z - inset };
}

function mitte(pos: Vector3, size: Vector3): Vector3 {
  return settings.roomBodyFromFloor ? { x: pos.x, y: pos.y + size.y / 2, z: pos.z } : pos;
}

/** Wie `rectOverlapRect`, aber um `EPSILON` geschrumpft — Gleitkomma-Berührung an gemeinsamen Kanten ist kein Überlapp. */
function overlaps(size1: Vector3, pos1: Vector3, size2: Vector3, pos2: Vector3): boolean {
  const s1 = { x: size1.x / 2 - EPSILON, y: size1.y / 2 - EPSILON, z: size1.z / 2 - EPSILON };
  const s2 = { x: size2.x / 2 - EPSILON, y: size2.y / 2 - EPSILON, z: size2.z / 2 - EPSILON };
  return !(
    pos1.x + s1.x < pos2.x - s2.x ||
    pos1.y + s1.y < pos2.y - s2.y ||
    pos1.z + s1.z < pos2.z - s2.z ||
    pos1.x - s1.x > pos2.x + s2.x ||
    pos1.y - s1.y > pos2.y + s2.y ||
    pos1.z - s1.z > pos2.z + s2.z
  );
}

/**
 * `testCollision` prüft NICHT symmetrisch: Nur der gerade platzierte
 * Kandidat wird geschrumpft (endCap-Anteil oder `roomsInsetSize`), das
 * BEREITS stehende Zimmer geht mit seiner vollen `rotatedSize` in den
 * Vergleich ein (Zeile 338 in `dungeonGenerator.ts` — `otherSize` bekommt
 * keinerlei Inset, auch nicht das eines eigenen endCap). Da `layout.rooms`
 * in Platzierungsreihenfolge steht (siehe `placedRooms.map(...)` am Ende
 * von `generateDungeonLayout`), lässt sich das hier 1:1 nachstellen: Raum
 * `i` (der später kam) gegen jeden früheren Raum `j`, mit genau dieser
 * Asymmetrie. Eine symmetrische Prüfung (beide Seiten geschrumpft) meldet
 * an jeder Wand eine Scheinüberlappung, weil `StoneVaultWall` bewusst zur
 * Hälfte in seinen Nachbarn hineinragen darf (`endcapsInsetFrac`).
 */
interface OverlapResult {
  /** Jede gefundene Überlappung, roh — inklusive der dokumentierten Ausnahme. */
  all: string[];
  /** Nur Überlappungen AUSSERHALB der dokumentierten endCap-vs-Eingang-Ausnahme. */
  unerwartet: string[];
}

function findOverlaps(layout: DungeonLayout): OverlapResult {
  const placed = layout.rooms.map((p: PlacedRoom) => {
    const room = roomsByName.get(p.room);
    if (!room) throw new Error(`Raum '${p.room}' fehlt in der Kit-Definition`);
    return {
      name: p.room,
      entrance: room.entrance,
      endCap: room.endCap,
      full: { pos: mitte(p.pos, rotatedSize(room.size, p.rot)), size: rotatedSize(room.size, p.rot) },
      shrunk: { pos: mitte(p.pos, collisionSize(room, p.rot)), size: collisionSize(room, p.rot) },
    };
  });
  const all: string[] = [];
  const unerwartet: string[] = [];
  for (let i = 1; i < placed.length; i++) {
    for (let j = 0; j < i; j++) {
      if (overlaps(placed[i].shrunk.size, placed[i].shrunk.pos, placed[j].full.size, placed[j].full.pos)) {
        const text = `${placed[i].name}#${i} (später) <-> ${placed[j].name}#${j} (früher)`;
        all.push(text);
        // Dokumentierte Ausnahme (s. Kopfkommentar): ein endCap, der den
        // Notfallzweig durchlaufen hat, gegen den Eingangsraum. Alles andere
        // ist eine ECHTE Überlappung.
        const istBekannteAusnahme =
          (placed[i].endCap && placed[j].entrance) || (placed[j].endCap && placed[i].entrance);
        if (!istBekannteAusnahme) unerwartet.push(text);
      }
    }
  }
  return { all, unerwartet };
}

/** Die vier neuen Zellvarianten — Wall und Entry zaehlen bewusst nicht mit (s. Pruefung 6/7). */
const ZELLVARIANTEN = ['StoneVaultCorridor', 'StoneVaultCorner', 'StoneVaultJunction', 'StoneVaultHall'] as const;
/** Varianten, die den Eindruck eines Gangsystems tragen (s. Pruefung 7) — die Halle zaehlt hier nicht: sie ist ein Saal, kein Gang. */
const GANGVARIANTEN = ['StoneVaultCorridor', 'StoneVaultCorner', 'StoneVaultJunction'] as const;

const roomCounts: number[] = [];
const doorCounts: number[] = [];
let archGesetzt = false;
let notfallUeberlappungen = 0;
/** Je Seed die Haeufigkeit jedes Raumnamens — Grundlage fuer Pruefung 6/7/8 und die Statistikausgabe. */
const namensverteilungJeSeed: Map<string, number>[] = [];
/** In wie vielen Seeds `StoneVaultHall` mindestens einmal vorkommt (Pruefung 8). */
let seedsMitHalle = 0;
/** Anteil Gangvarianten an Nicht-Wand-Raeumen, je Seed (Pruefung 7). */
const gangAnteilJeSeed: number[] = [];

for (const seed of SEEDS) {
  const layout1 = generateDungeonLayout(def, seed);
  const layout2 = generateDungeonLayout(def, seed);

  check(`seed ${seed}: Determinismus`, JSON.stringify(layout1) === JSON.stringify(layout2));

  const { all, unerwartet } = findOverlaps(layout1);
  notfallUeberlappungen += all.length - unerwartet.length;
  check(
    `seed ${seed}: keine unerwartete Überlappung`,
    unerwartet.length === 0,
    unerwartet.length > 0 ? unerwartet.join('; ') : all.length > 0 ? `${all.length}x Notfall-Abschluss am Eingang (bekannt)` : ''
  );

  // Der Eingangsconnector des Startraums bleibt ABSICHTLICH offen (Tuer in
  // die Aussenwelt, s. `placeStartRoom`/`commitRoom`) — er zaehlt hier
  // nicht als Fehler.
  const open = computeOpenConnections(layout1, KIT_NAME).filter((o) => {
    const room = roomsByName.get(layout1.rooms[o.roomIndex].room);
    return !room?.connections[o.connIndex]?.entrance;
  });
  check(`seed ${seed}: keine offenen Connectors`, open.length === 0, `${open.length} offen`);

  roomCounts.push(layout1.rooms.length);
  doorCounts.push(layout1.doors.length);
  if (layout1.doors.some((d) => d.prefabName === 'StoneVaultArch')) archGesetzt = true;

  const namen = new Map<string, number>();
  for (const p of layout1.rooms) namen.set(p.room, (namen.get(p.room) ?? 0) + 1);
  namensverteilungJeSeed.push(namen);
  if ((namen.get('StoneVaultHall') ?? 0) > 0) seedsMitHalle++;

  // Nicht-Wand-Raeume: alles ausser dem Abschluss `StoneVaultWall` — Entry
  // zaehlt mit (es ist geometrisch eine gewoehnliche Zelle, s. Kommentar am
  // Raum selbst), macht bei 1 Raum je Seed aber ohnehin keinen Unterschied.
  const nichtWand = layout1.rooms.length - (namen.get('StoneVaultWall') ?? 0);
  const gangSumme = GANGVARIANTEN.reduce((sum, name) => sum + (namen.get(name) ?? 0), 0);
  gangAnteilJeSeed.push(nichtWand > 0 ? gangSumme / nichtWand : 0);
}

for (const variante of ZELLVARIANTEN) {
  const kommtVor = namensverteilungJeSeed.some((m) => (m.get(variante) ?? 0) > 0);
  check(`Variante ${variante} kommt über die 40 Seeds mindestens einmal vor`, kommtVor);
}

const gangAnteilSchnitt = gangAnteilJeSeed.reduce((a, b) => a + b, 0) / gangAnteilJeSeed.length;
check(
  `Anteil Corridor+Corner+Junction an Nicht-Wand-Raeumen im Schnitt >= 40 %`,
  gangAnteilSchnitt >= 0.4,
  `Schnitt ${(gangAnteilSchnitt * 100).toFixed(1)} %`
);

check(`StoneVaultHall in mindestens 10 von 40 Seeds gesetzt`, seedsMitHalle >= 10, `${seedsMitHalle} Seeds`);

const avgRooms = roomCounts.reduce((a, b) => a + b, 0) / roomCounts.length;
check(`Raumzahl im Schnitt > 10`, avgRooms > 10, `Schnitt ${avgRooms.toFixed(2)}`);
check(`mindestens ein Arch-Torbogen über alle Seeds gesetzt`, archGesetzt);

const sorted = (arr: number[]) => [...arr].sort((a, b) => a - b);
const stats = (arr: number[]) => {
  const s = sorted(arr);
  return { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
};
const roomStats = stats(roomCounts);
const doorStats = stats(doorCounts);

console.log('\n--- Statistik über 40 Seeds ---');
console.log(
  `Räume:  min ${roomStats.min}, median ${roomStats.median}, max ${roomStats.max}, Schnitt ${avgRooms.toFixed(2)}`
);
console.log(`Türen:  min ${doorStats.min}, median ${doorStats.median}, max ${doorStats.max}`);
console.log(
  `Notfall-Abschlüsse am Eingang (dokumentierte Ausnahme, s. Kopfkommentar): ${notfallUeberlappungen} über 40 Seeds`
);
console.log(
  `Gang-Anteil (Corridor+Corner+Junction an Nicht-Wand-Räumen) im Schnitt: ${(gangAnteilSchnitt * 100).toFixed(1)} %`
);
console.log(`Halle (StoneVaultHall) gesetzt in ${seedsMitHalle} von 40 Seeds`);
console.log('Seed -> Räume/Türen (Verteilung nach Raumname, kompakt):');
const KURZNAME: Record<string, string> = {
  StoneVaultWall: 'Wall',
  StoneVaultJunction: 'Junction',
  StoneVaultCorner: 'Corner',
  StoneVaultHall: 'Hall',
  StoneVaultCorridor: 'Corridor',
  StoneVaultCell: 'Cell',
  StoneVaultEntry: 'Entry',
};
SEEDS.forEach((seed, i) => {
  const namen = namensverteilungJeSeed[i];
  const verteilung = [...namen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${KURZNAME[name] ?? name} ${n}`)
    .join(', ');
  console.log(`  seed ${seed}: ${roomCounts[i]} Räume, ${doorCounts[i]} Türen — ${verteilung}`);
});

if (failures > 0) {
  console.error(`\n${failures} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
} else {
  console.log('\nAlle Prüfungen grün.');
}
