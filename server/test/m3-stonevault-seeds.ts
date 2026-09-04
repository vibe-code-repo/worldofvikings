/**
 * M3 — Saat-Test fuer das Modul-Kit `DG_StoneVault`.
 *
 * Beweist per Skript (nicht per Rendering), dass der Generator (NUR
 * importiert — siehe Projektregeln, dieser Test ruehrt weder
 * `dungeonGenerator.ts` noch `dungeonRasterGenerator.ts` an) aus dem Kit
 * dichte, reproduzierbare Grundrisse baut. Welcher der beiden Wege
 * gebaut wird, entscheidet der Verteiler `erzeugeLayoutFuerKit` und
 * nicht dieser Test — seit G8 ist das fuer `DG_StoneVault` der
 * Rasterpfad. Arbeitet ausschliesslich mit `shared`-Daten (Kit-Defs,
 * RNG) und laedt keine GLBs — laeuft deshalb unabhaengig von `assets/`.
 *
 * Pruefungen je Seed (1..40):
 *  1. Determinismus — zweiter Lauf mit demselben Seed liefert ein
 *     bytengleiches Layout (JSON-Vergleich).
 *  2. Keine zwei Raum-AABBs ueberlappen (rotatedSize/roomBodyFromFloor aus
 *     `testCollision` nachgebildet, kleines Epsilon fuer Gleitkomma-Beruehrung
 *     an gemeinsamen Kanten) — seit G8 OHNE jede Ausnahme, s. unten.
 *  3. Keine Oeffnung ins Leere: Hinter jedem Connector ohne Gegenstueck
 *     steht der Koerper eines Nachbarmoduls (Zeile 3 der Kantentafel).
 *     Der Eingangsconnector der Startraum-Rolle war bis zum 4.9.2026
 *     abgezogen ("die Tuer in die Aussenwelt"); seit der Eingang
 *     versiegelt wird, hat er ohnehin ein Gegenstueck — der Filter steht
 *     nur noch als Zeuge da, dass genau EINE Platte davor sitzt (9.).
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
 *  8. JEDER der fuenf Saele steht in mindestens so vielen Seeds, wie
 *     `SAAL_GRENZEN` je Zuschnitt nennt (das seltenste Gewicht darf
 *     trotzdem nicht zum Ausreisser werden).
 *  9. Genau EINE Platte je Layout steht auf der Eingangskante — s. den
 *     naechsten Abschnitt.
 *
 * ── Der Eingang: aus einer Ausnahme wird eine Pflicht (4.9.2026) ───────
 * Die dokumentierte Ausnahme (a) hiess "7 Notfall-Abschluesse gegen den
 * Eingangsraum": `placeEndCaps` mauerte den Eingangsport in 7 von 40 Seeds
 * ZUFAELLIG zu, ohne Kollisionspruefung, und dann eben mitten im Koerper
 * des Eingangsmoduls. Sie ist mit G8 weggefallen — und mit der Messung der
 * "Lichtfuge" kam heraus, dass der offen gelassene Port ein Schacht ohne
 * Decke und ohne Boden war, durch den Tageslicht ins Grab fiel.
 *
 * Der Rasterpfad setzt dort jetzt PLANMAESSIG eine Platte: keine 7 von 40
 * mehr, sondern 40 von 40, und jede auf der Kante statt im Stein. Pruefung
 * 9 haelt genau diese Zahl fest — eine zweite waere ein Deckungskonflikt,
 * keine waere der offene Schacht.
 *
 * ── Umbau mit G8 (4.9.2026): beide Ausnahmen sind ERSATZLOS weg ────────
 * Dieser Test hat bis zum 3.9.2026 ZWEI dokumentierte Ausnahmen von
 * Pruefung 2 gefuehrt, beide aus dem 1.0-Generator:
 *  (a) 7 Notfall-Abschluesse gegen den Eingangsraum ueber 40 Seeds,
 *  (b) 13 Notfall-Abschluesse in der Luftraum-Haelfte der Treppenhuelle.
 * Beide entstanden aus derselben Wurzel: `placeEndCaps` mauert jede
 * unbeschaltete Kante zu und faellt, wenn kein Kandidat passt, auf einen
 * Zweig OHNE Kollisionspruefung zurueck ("ein sich ueberschneidender
 * Abschluss ist besser als ein Loch ins Nichts").
 *
 * Seit G8 laeuft `DG_StoneVault` ueber den Rasterpfad
 * (`DungeonDef.gridGeneration` → `erzeugeLayoutFuerKit`). Dort entsteht
 * eine Platte nur noch nach der Kantentafel, und wo eine steht, ist der
 * Streifen per Konstruktion frei. Die Konzeptnotiz macht daraus einen
 * WAECHTER und keine Fussnote: "faellt eine davon nicht weg, hat die
 * Versiegelung ihr Versprechen gebrochen". Beide Ausnahmen sind deshalb
 * hier ersatzlos gestrichen — jede Ueberlappung ist wieder ein Fehler.
 * Gemessen ueber dieselben 40 Seeds: 0 Ueberlappungen ueberhaupt.
 *
 * ── Was sich an Pruefung 3 dafuer aendert ──────────────────────────────
 * `computeOpenConnections` kennt die Kantentafel nicht (das kommt mit
 * G9). Zeile 3 der Tafel — "offen gegen eingebaute Wand → KEINE Platte,
 * die Wand des Nachbarn IST die Wand" — sieht fuer sie deshalb aus wie
 * ein offener Connector; gemessen 46 Stueck ueber 40 Seeds. Eine Platte
 * davor waere genau eine der 531 ueberfluessigen aus dem G1-Befund.
 *
 * Pruefung 3 fragt deshalb nicht mehr "0 offen", sondern: Steht hinter
 * JEDEM offenen Connector der Koerper eines Nachbarmoduls? Das ist die
 * schaerfere Frage, denn sie faellt auch dann rot aus, wenn eine Oeffnung
 * ins LEERE zeigt — und genau dort steht nach der Tafel (Zeile 5) immer
 * eine Platte. Geprueft wird geometrisch am Layout und nicht am
 * Rastermodell des Generators: Ein Test, der die Buchhaltung des
 * Erzeugers nachliest, bestaetigt nur sie selbst.
 *
 * Run: npx tsx server/test/m3-stonevault-seeds.ts   (from the repo root)
 */

import {
  DEFAULT_GENERATOR_SETTINGS,
  DUNGEONS_BY_NAME,
  MODUL_ZELLE_HOEHE_M,
  computeOpenConnections,
  erzeugeLayoutFuerKit,
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
  /**
   * Jede gefundene Überlappung. Seit G8 gibt es keine zweite Liste mehr:
   * Die beiden dokumentierten Ausnahmen sind ersatzlos gestrichen
   * (s. Kopfkommentar), jede Überlappung ist wieder ein Fehler.
   */
  all: string[];
}

function findOverlaps(layout: DungeonLayout): OverlapResult {
  const placed = layout.rooms.map((p: PlacedRoom) => {
    const room = roomsByName.get(p.room);
    if (!room) throw new Error(`Raum '${p.room}' fehlt in der Kit-Definition`);
    return {
      name: p.room,
      full: { pos: mitte(p.pos, rotatedSize(room.size, p.rot)), size: rotatedSize(room.size, p.rot) },
      shrunk: { pos: mitte(p.pos, collisionSize(room, p.rot)), size: collisionSize(room, p.rot) },
    };
  });
  const all: string[] = [];
  for (let i = 1; i < placed.length; i++) {
    for (let j = 0; j < i; j++) {
      if (overlaps(placed[i].shrunk.size, placed[i].shrunk.pos, placed[j].full.size, placed[j].full.pos)) {
        all.push(`${placed[i].name}#${i} (später) <-> ${placed[j].name}#${j} (früher)`);
      }
    }
  }
  return { all };
}

/**
 * Steht hinter diesem offenen Connector der KOERPER eines Nachbarmoduls?
 *
 * Grundlage von Pruefung 3 seit G8. Die Kantentafel laesst genau einen
 * Fall zu, in dem eine Oeffnung ohne Platte bleibt: Zeile 3, "offen gegen
 * eingebaute Wand" — die Wand des Nachbarn IST die Wand. Zeigt eine
 * Oeffnung dagegen ins Leere (Zeile 5), steht dort immer eine Platte, und
 * ein offener Connector ohne Nachbarkoerper waere genau das Loch, das der
 * ganze Umbau abschaffen soll.
 *
 * ── Warum die Achse aus der PARITAET faellt und nicht aus der Drehung ──
 * Zellmitten liegen auf `(2i, 3,5e, 2j−1)`, Kantenmitten genau dazwischen.
 * Eine Kante quer zu x hat damit ungerade x UND ungerade z, eine Kante
 * quer zu z gerade x und gerade z. Das ist ablesbar und braucht weder die
 * Connector-Drehung noch eine Annahme darueber, welche lokale Achse
 * "hinaus" zeigt — beides waere eine zweite Wahrheit ueber die Geometrie
 * des Kits.
 *
 * Geprueft werden BEIDE Nachbarn der Kante, der eigene Raum ausgenommen:
 * Der innere von beiden ist die eigene Zellmitte und liegt im eigenen
 * Koerper; dass kein fremder Koerper dort hineinragt, sagt Pruefung 2.
 * Abschluesse (`endCap`) zaehlen nicht mit — eine Platte VOR der Oeffnung
 * waere kein Nachbarmodul, sondern der Fehler aus Mikes Befund.
 */
function stehtNachbarDahinter(layout: DungeonLayout, roomIndex: number, connIndex: number): boolean {
  const placed = layout.rooms[roomIndex]!;
  const def0 = roomsByName.get(placed.room);
  const conn = def0?.connections[connIndex];
  if (!conn) return false;
  const lokal = quatMulVec3(placed.rot, conn.localPos);
  const kante = { x: placed.pos.x + lokal.x, y: placed.pos.y + lokal.y, z: placed.pos.z + lokal.z };
  const querZuX = Math.abs(Math.round(kante.x)) % 2 === 1;
  // Auf halber Ebenenhoehe pruefen: Der Connector sitzt auf dem BODEN
  // (y = 0 lokal), und ein Punkt genau auf der Bodenflaeche liegt auf dem
  // Rand jeder Huelle — eine Frage, die von Rundung abhaengt.
  const y = kante.y + MODUL_ZELLE_HOEHE_M / 2;
  const kandidaten: Vector3[] = [1, -1].map((s) =>
    querZuX ? { x: kante.x + s, y, z: kante.z } : { x: kante.x, y, z: kante.z + s }
  );
  return layout.rooms.some((andere, i) => {
    if (i === roomIndex) return false;
    const d = roomsByName.get(andere.room);
    if (!d || d.endCap) return false;
    const size = rotatedSize(d.size, andere.rot);
    const m = mitte(andere.pos, size);
    return kandidaten.some(
      (k) =>
        Math.abs(k.x - m.x) <= size.x / 2 + EPSILON &&
        Math.abs(k.y - m.y) <= size.y / 2 + EPSILON &&
        Math.abs(k.z - m.z) <= size.z / 2 + EPSILON
    );
  });
}

/**
 * Die Zellvarianten — Wall und Entry zaehlen bewusst nicht mit (s. Pruefung 6/7).
 * Seit dem 04.09.2026 stehen die beiden groesseren Saele mit in der Liste: Ein
 * Modul, das der Generator nie setzt, faellt sonst in keiner Zahl auf.
 */
const ZELLVARIANTEN = [
  'StoneVaultCorridor', 'StoneVaultCorner', 'StoneVaultJunction',
  'StoneVaultHall', 'StoneVaultHallLarge', 'StoneVaultHallLong',
  'StoneVaultHallGrand', 'StoneVaultHallVast',
] as const;
/** Varianten, die den Eindruck eines Gangsystems tragen (s. Pruefung 7) — die Halle zaehlt hier nicht: sie ist ein Saal, kein Gang. */
const GANGVARIANTEN = ['StoneVaultCorridor', 'StoneVaultCorner', 'StoneVaultJunction'] as const;

const roomCounts: number[] = [];
const doorCounts: number[] = [];
let archGesetzt = false;
/**
 * Offene Connectors, hinter denen die EINGEBAUTE WAND eines Nachbarn
 * steht (Zeile 3 der Kantentafel) — keine Fehler, sondern der Fix fuer
 * die 531 ueberfluessigen Platten aus dem G1-Befund. Sie werden gezaehlt
 * und nicht nur uebergangen: Faellt die Zahl auf 0, versiegelt wieder
 * jemand gegen fremde Wandkoerper, und das faellt in keiner anderen
 * Pruefung auf.
 */
let offeneGegenWand = 0;
/** Je Seed die Haeufigkeit jedes Raumnamens — Grundlage fuer Pruefung 6/7/8 und die Statistikausgabe. */
const namensverteilungJeSeed: Map<string, number>[] = [];
/** In wie vielen Seeds `StoneVaultHall` mindestens einmal vorkommt (Pruefung 8). */
let seedsMitHalle = 0;
/**
 * Dasselbe je Saalgroesse (Pruefung 8b, 04.09.2026). Die Grenzen sind
 * verschieden, und zwar aus einem messbaren Grund: Je groesser der
 * Fussabdruck, desto seltener findet die Wachstumsfront am Stueck Platz
 * dafuer.
 *
 * Seit dem 04.09.2026 stehen fuenf Saele in der Liste, und die beiden
 * groessten haben zusaetzlich ein KLEINERES Kit-Gewicht (0,5 bzw. 0,25 —
 * s. `pickStampOption` im Rastergenerator). Ihre Grenzen sind deshalb
 * niedriger, und zwar mit Ansage: Der Vast belegt 36 der 60 Zellen, der
 * Stempelversuch bricht ohnehin ab, sobald `cells.size + 36 > target` —
 * er kann nur ganz frueh im Wachstum zustande kommen.
 *
 * Gemessen ueber diese 40 Seeds bei der Kit-Vorgabe (60 Zellen, Zone 48):
 * 2x2 in 11, 3x3 in 13, 2x4 in 8, 4x4 in 6, 6x6 in 3 Seeds. Die Grenzen
 * liegen darunter, aber nicht bei 0: Eine Grenze 0 waere keine Aussage,
 * und genau ein Fund je Saal soll ein Ausfall sein, den dieser Test
 * meldet.
 */
const seedsMitSaal = new Map<string, number>();
/** Saal -> Mindestzahl Seeds, in denen er vorkommen muss (Pruefung 8b). */
const SAAL_GRENZEN = [
  ['StoneVaultHall', 8],
  ['StoneVaultHallLarge', 8],
  ['StoneVaultHallLong', 5],
  ['StoneVaultHallGrand', 4],
  ['StoneVaultHallVast', 2],
] as const;
/** Anteil Gangvarianten an Nicht-Wand-Raeumen, je Seed (Pruefung 7). */
const gangAnteilJeSeed: number[] = [];
/** Anzahl `StoneVaultStairs` je Seed — Grundlage der Stairs-Anteil-Statistik (s. Befund vom 3.9.2026). */
const treppenJeSeed: number[] = [];
/** In wie vielen Seeds mindestens eine Treppe steht. */
let seedsMitTreppe = 0;
/** Platten auf der Eingangskante je Seed — Soll: genau 1 (Pruefung 9). */
const eingangsplattenJeSeed: number[] = [];

for (const seed of SEEDS) {
  // Der VERTEILER, nicht ein Pfad direkt: Dieser Test soll das messen,
  // was Server und Editor bauen. Riefe er `generateGridLayout` an, bliebe
  // er auch dann gruen, wenn der Schalter am Kit verschwaende.
  const layout1 = erzeugeLayoutFuerKit(def, seed);
  const layout2 = erzeugeLayoutFuerKit(def, seed);

  check(`seed ${seed}: Determinismus`, JSON.stringify(layout1) === JSON.stringify(layout2));

  const { all } = findOverlaps(layout1);
  check(`seed ${seed}: keine Überlappung`, all.length === 0, all.slice(0, 3).join('; '));

  // Der Eingangsconnector des Startraums bleibt ABSICHTLICH offen (Tuer in
  // die Aussenwelt, s. `placeStartRoom`/`commitRoom`) — er zaehlt hier
  // nicht als Fehler.
  const open = computeOpenConnections(layout1, KIT_NAME).filter((o) => {
    const room = roomsByName.get(layout1.rooms[o.roomIndex].room);
    return !room?.connections[o.connIndex]?.entrance;
  });
  const loecher = open.filter((o) => !stehtNachbarDahinter(layout1, o.roomIndex, o.connIndex));
  offeneGegenWand += open.length - loecher.length;
  check(
    `seed ${seed}: keine Öffnung ins Leere`,
    loecher.length === 0,
    `${open.length} ohne Partner, davon ${loecher.length} ohne Nachbarkörper dahinter`
  );

  roomCounts.push(layout1.rooms.length);
  doorCounts.push(layout1.doors.length);
  if (layout1.doors.some((d) => d.prefabName === 'StoneVaultArch')) archGesetzt = true;

  const namen = new Map<string, number>();
  for (const p of layout1.rooms) namen.set(p.room, (namen.get(p.room) ?? 0) + 1);
  namensverteilungJeSeed.push(namen);
  if ((namen.get('StoneVaultHall') ?? 0) > 0) seedsMitHalle++;
  for (const saal of SAAL_GRENZEN.map(([name]) => name)) {
    if ((namen.get(saal) ?? 0) > 0) seedsMitSaal.set(saal, (seedsMitSaal.get(saal) ?? 0) + 1);
  }
  const treppenImSeed = namen.get('StoneVaultStairs') ?? 0;
  treppenJeSeed.push(treppenImSeed);
  if (treppenImSeed > 0) seedsMitTreppe++;

  // Nicht-Wand-Raeume: alles ausser dem Abschluss `StoneVaultWall` — Entry
  // zaehlt mit (es ist geometrisch eine gewoehnliche Zelle, s. Kommentar am
  // Raum selbst), macht bei 1 Raum je Seed aber ohnehin keinen Unterschied.
  // Pruefung 9: genau EINE Platte auf der Eingangskante. Die liegt im
  // URSPRUNG — dort haengt das ganze Grab, und dort sitzt der
  // Eingangsconnector des Startraums. Gefragt wird nach dem CONNECTOR der
  // Platte und nicht nach ihrer Mitte: Ihr Koerper liegt 0,15 m dahinter,
  // und eine Mittenabfrage haette eine Toleranz gebraucht, die auch die
  // Nachbarkante mitnaehme.
  const amEingang = layout1.rooms.filter((p) => {
    const rd = roomsByName.get(p.room);
    if (!rd?.endCap) return false;
    const conn = rd.connections[0];
    if (!conn) return false;
    const lokal = quatMulVec3(p.rot, conn.localPos);
    return Math.hypot(p.pos.x + lokal.x, p.pos.y + lokal.y, p.pos.z + lokal.z) < 0.1;
  }).length;
  eingangsplattenJeSeed.push(amEingang);

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

for (const [saal, grenze] of SAAL_GRENZEN) {
  const n = seedsMitSaal.get(saal) ?? 0;
  check(`${saal} in mindestens ${grenze} von 40 Seeds gesetzt`, n >= grenze, `${n} Seeds`);
}

const eingangGesamt = eingangsplattenJeSeed.reduce((a, b) => a + b, 0);
check(
  `genau eine Eingangsplatte je Layout (40 von 40 Seeds)`,
  eingangsplattenJeSeed.every((n) => n === 1),
  `${eingangGesamt} Platten über ${eingangsplattenJeSeed.length} Seeds, ` +
    `Ausreisser: ${eingangsplattenJeSeed.filter((n) => n !== 1).length}`
);

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
  `Offene Connectors gegen die eingebaute Wand eines Nachbarn (Kantentafel Zeile 3, keine Platte): ` +
    `${offeneGegenWand} über 40 Seeds`
);
console.log(
  `Gang-Anteil (Corridor+Corner+Junction an Nicht-Wand-Räumen) im Schnitt: ${(gangAnteilSchnitt * 100).toFixed(1)} %`
);
console.log(`Halle (StoneVaultHall) gesetzt in ${seedsMitHalle} von 40 Seeds`);

// Stairs-Anteil und Ebenen (s. Befund vom 3.9.2026, Punkt (c)): Wie oft
// steht `StoneVaultStairs` ueberhaupt, und wie gross ist ihr Anteil an
// allen bzw. an den begehbaren (Nicht-Wand-)Raeumen. `MODUL_ZELLE_HOEHE_M`
// (3,5 m) ist die Zellhoehe je Ebene — die Treppe selbst ueberspannt genau
// zwei davon (0 … 7 m, s. Kommentar an `StoneVaultStairs`).
const gesamtTreppen = treppenJeSeed.reduce((a, b) => a + b, 0);
const gesamtRaeume = roomCounts.reduce((a, b) => a + b, 0);
const gesamtNichtWand = namensverteilungJeSeed.reduce(
  (sum, namen) => sum + [...namen.entries()].reduce((s, [name, n]) => (name === 'StoneVaultWall' ? s : s + n), 0),
  0
);
console.log(
  `Treppen (StoneVaultStairs, je ${MODUL_ZELLE_HOEHE_M} m Ebenenhoehe, Huelle ueber 2 Ebenen = ${2 * MODUL_ZELLE_HOEHE_M} m): ` +
    `${gesamtTreppen} über ${gesamtRaeume} Räume (${((gesamtTreppen / gesamtRaeume) * 100).toFixed(1)} %; ` +
    `${((gesamtTreppen / gesamtNichtWand) * 100).toFixed(1)} % bezogen auf ${gesamtNichtWand} begehbare Räume ohne Wall), ` +
    `in ${seedsMitTreppe} von 40 Seeds mindestens einmal gesetzt`
);
check(`StoneVaultStairs kommt über die 40 Seeds mindestens in 5 Seeds vor`, seedsMitTreppe >= 5, `${seedsMitTreppe} Seeds`);

console.log('Seed -> Räume/Türen (Verteilung nach Raumname, kompakt):');
const KURZNAME: Record<string, string> = {
  StoneVaultWall: 'Wall',
  StoneVaultJunction: 'Junction',
  StoneVaultCorner: 'Corner',
  StoneVaultHall: 'Hall',
  StoneVaultHallLarge: 'Hall3x3',
  StoneVaultHallLong: 'Hall2x4',
  StoneVaultHallGrand: 'Hall4x4',
  StoneVaultHallVast: 'Hall6x6',
  StoneVaultCorridor: 'Corridor',
  StoneVaultCell: 'Cell',
  StoneVaultEntry: 'Entry',
  StoneVaultStairs: 'Stairs',
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
