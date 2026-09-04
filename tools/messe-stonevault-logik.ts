/**
 * Messskript (read-only) für Modul-Kits auf dem 2-m-Raster.
 *
 * ── Teil 1: die alten Verbindungsmetriken ────────────────────────────
 * Offene Kanten ins Leere, Blindtüren gegen eingebaute Wände, stumme
 * Zellnachbarschaften, Erreichbarkeit vom Eingang, Treppen mit
 * unversorgtem Anschluss.
 *
 * ── Teil 2 (G1): die Rastermetriken ──────────────────────────────────
 * Teil 1 ist per Konstruktion blind für die Fehlerklasse, die Mike sieht:
 * Er sondiert nur Connectors OHNE Partner. Eine offene Zellkante, die vor
 * der eingebauten Seitenwand eines Korridors steht, bekommt aber von
 * `placeEndCaps` eine Platte — damit hat sie einen Partner und fällt aus
 * der Stichprobe. Der Fehler bleibt trotzdem stehen: die 0,3-m-Platte
 * liegt im Streifen 0,7 … 1,0 der Nachbarzelle, also exakt in deren
 * eingebauter Wand (`make-stonevault.py`, `innenwand`).
 *
 * Teil 2 misst deshalb auf dem ZELLGITTER statt an den Connectors und
 * übernimmt die Messgrössen aus `tools/angriff-stonevault.ts`:
 *
 *   - Platte in belegter Zelle (und gegen welches Modul),
 *   - davon gegen eine volle Wand (überflüssig) bzw. gegen eine Teilwand
 *     (nötig — die Treppenflanke ist ein Keil und deckt die Kante nur
 *     teilweise),
 *   - unerklärte Nachbarschaft (Zellkante, deren gebaute Wirklichkeit zu
 *     keiner Zeile der Kantentafel passt),
 *   - senkrecht gestapelte Zellen (Ebene n/n+1),
 *   - Abweichung der Zellmitten vom Sollraster.
 *
 * `--streng` macht daraus einen Wächter: Exit-Code 1, sobald eine
 * Invariante verletzt ist. Heute ist der Lauf ROT (952 Platten in
 * belegten Zellen) — das ist der Sinn der Sache. Grün wird er erst mit
 * dem Rastergenerator (Meilensteine G4…G7).
 *
 * Aufruf:
 *   npx tsx tools/messe-stonevault-logik.ts
 *   npx tsx tools/messe-stonevault-logik.ts --streng
 *   npx tsx tools/messe-stonevault-logik.ts --kit=DG_Steingrab --seeds=10
 *   npx tsx tools/messe-stonevault-logik.ts --maxRooms=12 --zoneSize=32 --seeds=2123721695
 */
import { generateDungeonLayout, computeOpenConnections } from '../shared/src/dungeonGenerator.js';
import { DUNGEONS_BY_NAME } from '../shared/src/dungeons.js';
import { quatMul, quatMulVec3 } from '../shared/src/worldgen/Math3d.js';
import type { DungeonGeneratorSettings } from '../shared/src/dungeonGenerator.js';
import type { DungeonDef, DungeonLayout, RoomDef, PlacedRoom } from '../shared/src/dungeons.js';
import type { Quaternion, Vector3 } from '../shared/src/types.js';

/** Vorgabe: 40 Saaten — dieselbe Stichprobe wie im Befund vom 04.09.2026. */
export const SEED_ANZAHL_VORGABE = 40;

/** Kantenlänge einer Rasterzelle in Metern. */
const ZELL_M = 2;
/** Höhe einer Ebene in Metern. */
const EBENE_M = 3.5;

// ─────────────────────────────────────────────────────────────────────
// Verteiler-Einstieg
// ─────────────────────────────────────────────────────────────────────

/**
 * Der EINE Punkt, an dem dieses Skript ein Layout erzeugt.
 *
 * Warum eine eigene Funktion für einen Einzeiler: Ab G8 entscheidet
 * `erzeugeLayoutFuerKit` in `shared/src/dungeonRasterGenerator.ts`, ob
 * ein Kit über den Rasterpfad oder über den 1.0-Pfad läuft. Steht der
 * Aufruf schon heute an genau einer Stelle mit genau dieser Signatur,
 * wechselt dieses Skript später durch das Umhängen EINES Imports die
 * Seite — und misst dann nachweislich dieselben Grössen am neuen
 * Generator. Ein `await import(...)` mit Rückfall wäre eleganter, geht
 * hier aber nicht: tsx übersetzt `tools/**` mangels `type: module` nach
 * CJS, und dort ist Top-Level-await verboten.
 */
export function erzeugeLayoutFuerKit(
  def: DungeonDef,
  seed: number,
  einstellungen?: Partial<DungeonGeneratorSettings>
): DungeonLayout {
  return generateDungeonLayout(def, seed, einstellungen);
}

/** Kit nachschlagen — mit lauter Fehlermeldung statt `undefined`. */
export function holeKit(name: string): DungeonDef {
  const def = DUNGEONS_BY_NAME.get(name);
  if (!def) throw new Error(`Kit '${name}' nicht gefunden`);
  return def;
}

// ─────────────────────────────────────────────────────────────────────
// Kleinkram: Quaternionen, Vektoren
// ─────────────────────────────────────────────────────────────────────

function quatInverse(q: Quaternion): Quaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}
function vAdd(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function localToGlobal(localPos: Vector3, localRot: Quaternion, parentPos: Vector3, parentRot: Quaternion) {
  return { pos: vAdd(parentPos, quatMulVec3(parentRot, localPos)), rot: quatMul(localRot, parentRot) };
}
function sqDist(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

// ─────────────────────────────────────────────────────────────────────
// Rastermodell (G1): Zellen, Kanten, Kantenzustände
// ─────────────────────────────────────────────────────────────────────

/**
 * Dreiwertiger Kantenzustand. `wandTeilweise` ist kein Feinschliff,
 * sondern der Unterschied zwischen 531 überflüssigen und 414 nötigen
 * Platten: Die Wände von Korridor/Ecke/Abzweig laufen über die volle
 * Ebenenhöhe (−0,25 … 3,75, `make-stonevault.py:56-59`), die Flanken der
 * Treppe sind Keile, die mit dem Lauf steigen (`:483-491`) und die Kante
 * je Ebene nur teilweise decken.
 */
export type Kantenzustand = 'offen' | 'wand' | 'wandTeilweise';

/** Sechs Kanten je Zelle — vier waagerecht, plus Boden und Decke. */
export type Richtung = 'n' | 'o' | 's' | 'w' | 'oben' | 'unten';

const RICHTUNGEN: readonly Richtung[] = ['n', 'o', 's', 'w', 'oben', 'unten'];
const RICHTUNG_VEKTOR: Record<Richtung, Vector3> = {
  n: { x: 0, y: 0, z: 1 },
  o: { x: 1, y: 0, z: 0 },
  s: { x: 0, y: 0, z: -1 },
  w: { x: -1, y: 0, z: 0 },
  oben: { x: 0, y: 1, z: 0 },
  unten: { x: 0, y: -1, z: 0 },
};
const GEGENRICHTUNG: Record<Richtung, Richtung> = {
  n: 's', s: 'n', o: 'w', w: 'o', oben: 'unten', unten: 'oben',
};

/** Weltvektor (achsparallel, Länge 1) → Richtungsname. */
function richtungAusVektor(v: Vector3): Richtung | null {
  const x = Math.round(v.x), y = Math.round(v.y), z = Math.round(v.z);
  for (const r of RICHTUNGEN) {
    const d = RICHTUNG_VEKTOR[r];
    if (d.x === x && d.y === y && d.z === z) return r;
  }
  return null;
}

/** Ganzzahliger Zellschlüssel `i|j|e` — die einzige Wahrheit des Rasters. */
export function zellSchluessel(i: number, j: number, e: number): string {
  return `${i}|${j}|${e}`;
}

/**
 * Weltpunkt → Zellschlüssel. Zellmitten liegen auf `(2i, 3,5e, 2j−1)`:
 * Der Eingang steht auf `pos = (0,0,−1)`, deshalb `round((z+1)/2)` und
 * nicht `round(z/2)`. Immer runden, nie vergleichen — die gemessene Drift
 * geht bis 2,6 · 10⁻⁵ m.
 */
export function weltZuZelle(x: number, y: number, z: number): string {
  return zellSchluessel(Math.round(x / ZELL_M), Math.round((z + 1) / ZELL_M), Math.round(y / EBENE_M));
}

function zelleZerlegen(k: string): { i: number; j: number; e: number } {
  const [i, j, e] = k.split('|').map(Number);
  return { i: i!, j: j!, e: e! };
}

function nachbarZelle(k: string, r: Richtung): string {
  const { i, j, e } = zelleZerlegen(k);
  const d = RICHTUNG_VEKTOR[r];
  return zellSchluessel(i + d.x, j + d.z, e + d.y);
}

/**
 * Die Kantenerklärung des StoneVault-Kits, in LOKALEN Richtungen (vor der
 * Gierung) und lokalen Zellindizes.
 *
 * Warum sie hier steht und nicht im Kit: G1 misst, G2 erklärt. Die
 * Tabelle wandert mit `gridModuleFromRoomDef()` und `RoomDef.gridEdges?`
 * in `shared/src` — dann liest dieses Skript sie von dort, statt sie zu
 * kennen (G2 hat beide angelegt, der Umzug steht noch aus). Bis dahin ist sie eine Erklärung ÜBER das GLB (Risiko: sie kann
 * mit `make-stonevault.py` auseinanderlaufen), abgeleitet aus den
 * Kommentaren an den Moduldefinitionen in `eigeneDungeons.ts`.
 *
 * Ungenannte Kanten sind `wand`: Boden und Decke tragen im Kit keine
 * Öffnung, und eine Modulseite ohne Connector hat immer Stein davor.
 */
interface ModulErklaerung {
  /** Zellen in lokal-x bzw. lokal-z, plus Ebenen. */
  zellenX: number;
  zellenZ: number;
  ebenen: number;
  /** Zustand der Aussenkante `r` an der lokalen Zelle `(a, b, e)`. */
  kante(a: number, b: number, e: number, r: Richtung): Kantenzustand;
}

function einzelzelle(offen: readonly Richtung[]): ModulErklaerung {
  const menge = new Set(offen);
  return {
    zellenX: 1,
    zellenZ: 1,
    ebenen: 1,
    kante: (_a, _b, _e, r) => (menge.has(r) ? 'offen' : 'wand'),
  };
}

const MODUL_ERKLAERUNG: Record<string, ModulErklaerung> = {
  // Vier freie Kanten, keine eingebaute Wand.
  StoneVaultEntry: einzelzelle(['n', 'o', 's', 'w']),
  StoneVaultCell: einzelzelle(['n', 'o', 's', 'w']),
  // Seitenwände nach Ost und West eingebaut.
  StoneVaultCorridor: einzelzelle(['n', 's']),
  // West- und Südwand eingebaut, die Kurve öffnet nach Nord und Ost.
  StoneVaultCorner: einzelzelle(['n', 'o']),
  // Nur die Westwand eingebaut.
  StoneVaultJunction: einzelzelle(['n', 'o', 's']),
  // 2 × 2 Zellen, acht Ports: jede Aussenkante ist offen.
  StoneVaultHall: {
    zellenX: 2,
    zellenZ: 2,
    ebenen: 1,
    kante: (_a, _b, _e, r) => (r === 'oben' || r === 'unten' ? 'wand' : 'offen'),
  },
  /*
    Die Treppe: 1 × 3 Zellen auf ZWEI Ebenen, genau zwei Ports (unten Süd
    auf Ebene 0, oben Nord auf Ebene 1). Alles andere ist `wandTeilweise`
    — die Flanken sind Keile, und die beiden „falschen" Enden (Nord unten,
    Süd oben) sind Lauf- bzw. Luftraum, keine geschlossene Wand. Das ist
    bewusst grob: Es hält die 414 Platten gegen die Treppe in der Klasse
    „nötig", statt sie als überflüssig auszuweisen, die sie nicht sind.
    Die feine Erklärung je Ebene ist Sache von G2/G7.
  */
  StoneVaultStairs: {
    zellenX: 1,
    zellenZ: 3,
    ebenen: 2,
    kante: (_a, b, e, r) => {
      if (r === 'oben' || r === 'unten') return 'wand';
      if (e === 0 && b === 0 && r === 's') return 'offen';
      if (e === 1 && b === 2 && r === 'n') return 'offen';
      return 'wandTeilweise';
    },
  },
};

/**
 * Trägt jedes Modul dieses Kits eine Rastererklärung?
 *
 * Ohne diese Weiche liefert Teil 2 für ein Fremdkit Zahlen, die wie ein
 * Befund aussehen und keiner sind: `DG_Steingrab` steht auf 8-m-Zellen,
 * gemessen an einem 2-m-Raster fallen prompt 1,5 m „Drift" und
 * Doppelbelegungen an, die es nicht gibt. Ab G2 ersetzt
 * `DungeonDef.rasterErzeugung?` diese Prüfung — dann ist die Anwesenheit
 * des Feldes der Schalter, nicht die Vollständigkeit einer Tabelle hier.
 */
export function hatRastererklaerung(def: DungeonDef): boolean {
  return def.rooms.every((r) => r.endCap || MODUL_ERKLAERUNG[r.name] !== undefined);
}

/** Eine belegte Zelle mit ihrem Modul und ihren lokalen Indizes. */
interface BelegteZelle {
  key: string;
  raumIndex: number;
  raum: string;
  /** Lokale Zellindizes im Modul — nötig, um die richtige Kante zu treffen. */
  a: number;
  b: number;
  e: number;
  /** Gierung des Moduls, um Welt- in lokale Richtungen zurückzudrehen. */
  rot: Quaternion;
}

/**
 * Zellen eines platzierten Moduls, mit der grössten Abweichung der
 * berechneten Zellmitte vom Sollraster.
 */
function zellenEinesRaums(
  p: PlacedRoom,
  raumIndex: number,
  raumDef: RoomDef
): { zellen: BelegteZelle[]; drift: number } {
  const erkl = MODUL_ERKLAERUNG[p.room];
  const zellenX = erkl?.zellenX ?? Math.round(Math.max(raumDef.size.x, ZELL_M) / ZELL_M);
  const zellenZ = erkl?.zellenZ ?? Math.round(Math.max(raumDef.size.z, ZELL_M) / ZELL_M);
  const ebenen = erkl?.ebenen ?? Math.max(1, Math.round(raumDef.size.y / EBENE_M));
  const zellen: BelegteZelle[] = [];
  let drift = 0;
  for (let a = 0; a < zellenX; a++) {
    for (let b = 0; b < zellenZ; b++) {
      const lx = (a - (zellenX - 1) / 2) * ZELL_M;
      const lz = (b - (zellenZ - 1) / 2) * ZELL_M;
      const w = quatMulVec3(p.rot, { x: lx, y: 0, z: lz });
      const wx = p.pos.x + w.x, wz = p.pos.z + w.z;
      const i = Math.round(wx / ZELL_M);
      const j = Math.round((wz + 1) / ZELL_M);
      const e0 = Math.round(p.pos.y / EBENE_M);
      drift = Math.max(
        drift,
        Math.abs(wx - i * ZELL_M),
        Math.abs(wz - (j * ZELL_M - 1)),
        Math.abs(p.pos.y - e0 * EBENE_M)
      );
      for (let e = 0; e < ebenen; e++) {
        zellen.push({ key: zellSchluessel(i, j, e0 + e), raumIndex, raum: p.room, a, b, e, rot: p.rot });
      }
    }
  }
  return { zellen, drift };
}

/** Zustand der Kante einer belegten Zelle in WELTrichtung `r`. */
function kantenzustand(z: BelegteZelle, r: Richtung): Kantenzustand {
  const erkl = MODUL_ERKLAERUNG[z.raum];
  if (!erkl) return 'wand'; // Fremdkit ohne Erklärung: nichts behaupten, alles als Stein lesen.
  // Weltrichtung zurück in die lokale drehen: inverse Gierung anwenden.
  const lokal = richtungAusVektor(quatMulVec3(quatInverse(z.rot), RICHTUNG_VEKTOR[r]));
  if (!lokal) return 'wand';
  // Innenkanten mehrzelliger Module sind keine Aussenkanten — dort kann
  // per Konstruktion nichts von aussen anstossen.
  const innen =
    (lokal === 'o' && z.a < erkl.zellenX - 1) ||
    (lokal === 'w' && z.a > 0) ||
    (lokal === 'n' && z.b < erkl.zellenZ - 1) ||
    (lokal === 's' && z.b > 0) ||
    (lokal === 'oben' && z.e < erkl.ebenen - 1) ||
    (lokal === 'unten' && z.e > 0);
  if (innen) return 'offen';
  return erkl.kante(z.a, z.b, z.e, lokal);
}

// ─────────────────────────────────────────────────────────────────────
// Rastermetrik je Layout
// ─────────────────────────────────────────────────────────────────────

export interface RasterMetrik {
  seed: number;
  raeume: number;
  zellen: number;
  /** Alle Abschlussplatten (`endCap`) des Layouts. */
  plattenGesamt: number;
  /** Davon in einer BELEGTEN Nachbarzelle — der Kern des Befunds. */
  platteInBelegterZelle: number;
  /** … gegen eine Wand über die volle Ebenenhöhe: hätte nie gesetzt werden dürfen. */
  plattenUeberfluessig: number;
  /** … gegen eine Teilwand (Treppenflanke): nötig, weil der Keil die Kante nicht deckt. */
  plattenNoetig: number;
  /** … im Eingangsraum: die dokumentierte Altausnahme aus `m3-stonevault-seeds.ts`. */
  plattenEingang: number;
  /** … quer vor einer als offen erklärten Kante: eine Wand vor einer Tür. */
  plattenVorOeffnung: number;
  /** Platte je Nachbarmodul — die Aufschlüsselung aus dem Befund. */
  plattenNachModul: Map<string, number>;
  /** Zellen, die zwei verschiedene Räume beanspruchen. */
  doppelbelegungen: number;
  /** Belegte Zellen, über denen (Ebene n+1) wieder eine belegte Zelle liegt. */
  gestapelteZellen: number;
  /** Grösste Abweichung einer Zellmitte vom Sollraster, in Metern. */
  maxZellDrift: number;
  /** Zellkanten, deren gebaute Wirklichkeit zu keiner Zeile der Kantentafel passt. */
  unerklaerteNachbarschaften: number;
  /** Aufschlüsselung dazu, nach Art des Verstosses. */
  unerklaertNachArt: Map<string, number>;
  beispiele: string[];
}

function leereMetrik(seed: number): RasterMetrik {
  return {
    seed, raeume: 0, zellen: 0,
    plattenGesamt: 0, platteInBelegterZelle: 0,
    plattenUeberfluessig: 0, plattenNoetig: 0, plattenEingang: 0, plattenVorOeffnung: 0,
    plattenNachModul: new Map(), doppelbelegungen: 0, gestapelteZellen: 0, maxZellDrift: 0,
    unerklaerteNachbarschaften: 0, unerklaertNachArt: new Map(), beispiele: [],
  };
}

function zaehle(m: Map<string, number>, k: string, n = 1): void {
  m.set(k, (m.get(k) ?? 0) + n);
}

/**
 * Die G1-Messung auf dem Zellgitter.
 *
 * Der Trick gegen die Blindheit von Teil 1: Die Platte wird über ihre
 * eigene POSITION einer Zelle zugeordnet, nicht über ihren Connector. Ihr
 * Körper liegt 0,15 m hinter der Kante (der Connector sitzt auf der
 * VORDERfläche von `StoneVaultWall`), sie rundet also in die Zelle, VOR
 * der sie steht — und ist diese Zelle belegt, steht sie im Körper des
 * Nachbarmoduls.
 */
export function messeRasterLayout(layout: DungeonLayout, def: DungeonDef): RasterMetrik {
  const raumDefs = new Map<string, RoomDef>(def.rooms.map((r) => [r.name, r]));
  const m = leereMetrik(0);
  m.raeume = layout.rooms.length;

  // ── Belegung aufbauen ──────────────────────────────────────────────
  const belegt = new Map<string, BelegteZelle>();
  const doppelt = new Set<string>();
  layout.rooms.forEach((p, idx) => {
    const rd = raumDefs.get(p.room);
    if (!rd || rd.endCap) return; // Platten belegen keine Zelle, sie stehen davor.
    const { zellen, drift } = zellenEinesRaums(p, idx, rd);
    m.maxZellDrift = Math.max(m.maxZellDrift, drift);
    for (const z of zellen) {
      const vorher = belegt.get(z.key);
      if (vorher && vorher.raumIndex !== z.raumIndex) doppelt.add(z.key);
      else if (!vorher) belegt.set(z.key, z);
    }
  });
  m.zellen = belegt.size;
  m.doppelbelegungen = doppelt.size;

  for (const k of belegt.keys()) {
    const { i, j, e } = zelleZerlegen(k);
    if (belegt.has(zellSchluessel(i, j, e + 1))) m.gestapelteZellen++;
  }

  // ── Platten einsortieren ───────────────────────────────────────────
  // `vorne` zeigt vom Plattenkörper in die Zelle, die sie abschliesst;
  // die Platte selbst liegt in der Zelle dahinter.
  const plattenAnKante = new Map<string, number>();
  layout.rooms.forEach((p) => {
    const rd = raumDefs.get(p.room);
    if (!rd?.endCap) return;
    m.plattenGesamt++;
    const vorne = richtungAusVektor(quatMulVec3(p.rot, { x: 0, y: 0, z: 1 }));
    if (!vorne) return;
    const zelle = weltZuZelle(p.pos.x, p.pos.y, p.pos.z);
    zaehle(plattenAnKante, `${zelle}#${vorne}`);

    const wirt = belegt.get(zelle);
    if (!wirt) return;
    m.platteInBelegterZelle++;
    zaehle(m.plattenNachModul, wirt.raum);
    const zustand = kantenzustand(wirt, vorne);
    if (raumDefs.get(wirt.raum)?.entrance) m.plattenEingang++;
    else if (zustand === 'wand') m.plattenUeberfluessig++;
    else if (zustand === 'wandTeilweise') m.plattenNoetig++;
    else {
      m.plattenVorOeffnung++;
      if (m.beispiele.length < 6) {
        m.beispiele.push(
          `Platte vor einer Öffnung: (${p.pos.x.toFixed(2)},${p.pos.y.toFixed(2)},${p.pos.z.toFixed(2)}) ` +
            `in Zelle ${zelle} von ${wirt.raum}, Kante ${vorne}`
        );
      }
    }
  });

  // ── Kantentafel gegen die gebaute Wirklichkeit ─────────────────────
  // Der Eingangsport von Raum 0 ist ausgenommen: Er führt absichtlich
  // nach draussen und bekommt nie eine Platte.
  const eingangsKanten = new Set<string>();
  layout.rooms.forEach((p) => {
    const rd = raumDefs.get(p.room);
    if (!rd) return;
    rd.connections.forEach((c) => {
      if (!c.entrance) return;
      const g = localToGlobal(c.localPos, c.localRot, p.pos, p.rot);
      const r = richtungAusVektor(quatMulVec3(g.rot, { x: 0, y: 0, z: 1 }));
      if (r) eingangsKanten.add(`${weltZuZelle(p.pos.x, p.pos.y, p.pos.z)}#${r}`);
    });
  });

  const gesehen = new Set<string>();
  for (const [key, zelle] of belegt) {
    for (const r of RICHTUNGEN) {
      const nachbarKey = nachbarZelle(key, r);
      const nachbar = belegt.get(nachbarKey);
      if (nachbar && nachbar.raumIndex === zelle.raumIndex) continue; // eigener Körper
      const kanonisch = key < nachbarKey ? `${key}#${r}` : `${nachbarKey}#${GEGENRICHTUNG[r]}`;
      if (gesehen.has(kanonisch)) continue;
      gesehen.add(kanonisch);
      if (eingangsKanten.has(`${key}#${r}`)) continue;

      const a = kantenzustand(zelle, r);
      const b: Kantenzustand | 'fels' = nachbar ? kantenzustand(nachbar, GEGENRICHTUNG[r]) : 'fels';
      // Platten auf dieser Kante: je Seite kann eine stehen.
      const anzahl =
        (plattenAnKante.get(`${key}#${r}`) ?? 0) +
        (plattenAnKante.get(`${nachbarKey}#${GEGENRICHTUNG[r]}`) ?? 0);

      let art: string | null = null;
      if (a === 'offen' && b === 'offen') {
        // Zeile 1 der Kantentafel: Durchgang. Eine Platte darin ist eine
        // Wand vor einer Tür — genau Mikes Befund.
        if (anzahl > 0) art = 'Platte vor einem Durchgang';
      } else if (a === 'offen' || b === 'offen') {
        const andere = a === 'offen' ? b : a;
        if (andere === 'wand') {
          // Zeile 3: keine Platte — die eingebaute Wand IST die Wand.
          if (anzahl > 0) art = 'überflüssige Platte gegen eine volle Wand';
        } else if (andere === 'wandTeilweise') {
          // Zeile 4: Platte auf der offenen Seite, weil der Keil nicht deckt.
          if (anzahl === 0) art = 'Teilwand ohne Platte';
        } else if (andere === 'fels') {
          // Zeile 5: genau eine Platte.
          if (anzahl === 0) art = 'offene Kante ins Leere';
        }
      } else if (anzahl > 0) {
        // Zeile 6: zwei geschlossene Seiten brauchen nichts dazwischen.
        art = 'Platte zwischen zwei Wänden';
      }
      if (art) {
        m.unerklaerteNachbarschaften++;
        zaehle(m.unerklaertNachArt, art);
        if (m.beispiele.length < 10) {
          m.beispiele.push(`${art}: Zelle ${key} → ${r} (${a}/${b}, ${anzahl} Platte(n))`);
        }
      }
    }
  }

  return m;
}

/** Summiert Einzelmessungen zu einer Gesamtmetrik (Drift: Maximum). */
export function summiereRaster(einzel: readonly RasterMetrik[]): RasterMetrik {
  const g = leereMetrik(-1);
  for (const m of einzel) {
    g.raeume += m.raeume;
    g.zellen += m.zellen;
    g.plattenGesamt += m.plattenGesamt;
    g.platteInBelegterZelle += m.platteInBelegterZelle;
    g.plattenUeberfluessig += m.plattenUeberfluessig;
    g.plattenNoetig += m.plattenNoetig;
    g.plattenEingang += m.plattenEingang;
    g.plattenVorOeffnung += m.plattenVorOeffnung;
    g.doppelbelegungen += m.doppelbelegungen;
    g.gestapelteZellen += m.gestapelteZellen;
    g.unerklaerteNachbarschaften += m.unerklaerteNachbarschaften;
    g.maxZellDrift = Math.max(g.maxZellDrift, m.maxZellDrift);
    for (const [k, v] of m.plattenNachModul) zaehle(g.plattenNachModul, k, v);
    for (const [k, v] of m.unerklaertNachArt) zaehle(g.unerklaertNachArt, k, v);
  }
  return g;
}

/**
 * Die Invarianten, die der Rastergenerator ab G4 halten muss. Heute
 * verletzt der 1.0-Pfad die ersten drei — genau deshalb steht die Liste
 * hier und nicht in einer Roadmap.
 */
export function verletzteInvarianten(g: RasterMetrik): string[] {
  const raus: string[] = [];
  if (g.platteInBelegterZelle > 0) raus.push(`${g.platteInBelegterZelle} Platten in belegten Zellen (soll 0)`);
  if (g.unerklaerteNachbarschaften > 0) raus.push(`${g.unerklaerteNachbarschaften} unerklärte Nachbarschaften (soll 0)`);
  if (g.plattenVorOeffnung > 0) raus.push(`${g.plattenVorOeffnung} Platten vor einer Öffnung (soll 0)`);
  if (g.doppelbelegungen > 0) raus.push(`${g.doppelbelegungen} doppelt belegte Zellen (soll 0)`);
  if (g.maxZellDrift >= 1e-4) raus.push(`Zellmitten-Drift ${g.maxZellDrift.toExponential(2)} m (soll < 1e-4)`);
  return raus;
}

// ─────────────────────────────────────────────────────────────────────
// Teil 1: die alten Verbindungsmetriken
// ─────────────────────────────────────────────────────────────────────

interface ConnInst {
  roomIndex: number;
  connIndex: number;
  pos: Vector3;
  rot: Quaternion;
  outward: Vector3; // Weltrichtung, in die der Connector zeigt (lokal +Z)
  entrance: boolean;
}

function allConnections(layout: DungeonLayout, roomsByName: Map<string, RoomDef>): ConnInst[] {
  const out: ConnInst[] = [];
  layout.rooms.forEach((placed, roomIndex) => {
    const room = roomsByName.get(placed.room);
    if (!room) return;
    room.connections.forEach((c, connIndex) => {
      const g = localToGlobal(c.localPos, c.localRot, placed.pos, placed.rot);
      const outward = quatMulVec3(g.rot, { x: 0, y: 0, z: 1 });
      out.push({ roomIndex, connIndex, pos: g.pos, rot: g.rot, outward, entrance: c.entrance });
    });
  });
  return out;
}

/** Punkt liegt im tatsächlichen (nicht genudgten) Rumpf eines platzierten Raums? */
function pointInRoomHull(p: Vector3, placed: PlacedRoom, room: RoomDef): boolean {
  // lokaler Punkt = invRot * (p - pos); roomBodyFromFloor: Ursprung ist der Boden.
  const inv = quatInverse(placed.rot);
  const rel = { x: p.x - placed.pos.x, y: p.y - placed.pos.y, z: p.z - placed.pos.z };
  const lp = quatMulVec3(inv, rel);
  const halfX = room.size.x / 2;
  const halfZ = room.size.z / 2;
  const eps = 0.02;
  return (
    lp.x >= -halfX - eps && lp.x <= halfX + eps &&
    lp.z >= -halfZ - eps && lp.z <= halfZ + eps &&
    lp.y >= -eps && lp.y <= room.size.y + eps
  );
}

const ZELLARTIG = new Set(['StoneVaultEntry', 'StoneVaultCell', 'StoneVaultCorridor', 'StoneVaultCorner', 'StoneVaultJunction', 'StoneVaultHall', 'StoneVaultStairs']);

interface Befund {
  seed: number;
  offenInsLeere: number;
  blindtueren: number;
  stummeNachbarn: number;
  unerreichbar: number;
  treppenProblem: number;
  raeume: number;
  beispiele: string[];
}

const pairTypeTally = new Map<string, number>();

function messeLayout(layout: DungeonLayout, seed: number, def: DungeonDef): Befund {
  const roomsByName = new Map<string, RoomDef>(def.rooms.map((r) => [r.name, r]));
  const conns = allConnections(layout, roomsByName);
  const open = computeOpenConnections(layout, def.name);
  // Menge der "offenen" Positionen (roomIndex+connIndex) für schnellen Lookup.
  const openKey = new Set(open.map((o) => `${o.roomIndex}:${o.connIndex}`));

  let offenInsLeere = 0;
  let blindtueren = 0;
  const beispiele: string[] = [];

  for (const c of conns) {
    if (c.entrance) continue; // Eingang des GESAMTEN Dungeons — bleibt absichtlich offen (Anschluss nach draussen)
    if (!openKey.has(`${c.roomIndex}:${c.connIndex}`)) continue; // hat einen Partner (Raum oder Wand) — kein Fehler
    // "Offen": kein Connector-Partner. Prüfen, ob physisch trotzdem ein Raum im Weg steht (Blindtür)
    // oder wirklich Leere dahinter ist.
    const probe = vAdd(c.pos, { x: c.outward.x * 0.4, y: c.outward.y * 0.4, z: c.outward.z * 0.4 });
    let blocked: { idx: number; name: string } | null = null;
    layout.rooms.forEach((placed, idx) => {
      if (idx === c.roomIndex) return;
      const room = roomsByName.get(placed.room);
      if (!room) return;
      if (pointInRoomHull(probe, placed, room)) blocked = { idx, name: placed.room };
    });
    if (blocked) {
      blindtueren++;
      const b = blocked as { idx: number; name: string };
      if (beispiele.length < 6) {
        beispiele.push(
          `Blindtür: Raum #${c.roomIndex} (${layout.rooms[c.roomIndex]!.room}) Connector ${c.connIndex} bei ` +
            `(${c.pos.x.toFixed(1)},${c.pos.y.toFixed(1)},${c.pos.z.toFixed(1)}) stößt auf eingebaute Wand von ` +
            `Raum #${b.idx} (${b.name})`
        );
      }
    } else {
      offenInsLeere++;
      if (beispiele.length < 6) {
        beispiele.push(
          `Offen ins Leere: Raum #${c.roomIndex} (${layout.rooms[c.roomIndex]!.room}) Connector ${c.connIndex} bei ` +
            `(${c.pos.x.toFixed(1)},${c.pos.y.toFixed(1)},${c.pos.z.toFixed(1)})`
        );
      }
    }
  }

  // (c) Stumme Nachbarschaft: zellartige Räume, deren nominale (auf 2 m
  // hochgerundete) Grundfläche aneinanderstößt, ohne dass irgendein Connector
  // beider Räume dort zusammentrifft (auch nicht über eine Wand).
  const cellRooms = layout.rooms
    .map((p, i) => ({ p, i, room: roomsByName.get(p.room) }))
    .filter((x) => x.room && ZELLARTIG.has(x.p.room));

  function nominalHalf(room: RoomDef, rot: Quaternion): { hx: number; hy: number; hz: number } {
    const nx = Math.max(room.size.x, 2);
    const nz = Math.max(room.size.z, 2);
    const s = quatMulVec3(rot, { x: nx, y: room.size.y, z: nz });
    return { hx: Math.abs(s.x) / 2, hy: Math.abs(s.y) / 2, hz: Math.abs(s.z) / 2 };
  }

  let stummeNachbarn = 0;
  for (let a = 0; a < cellRooms.length; a++) {
    for (let b = a + 1; b < cellRooms.length; b++) {
      const A = cellRooms[a]!, B = cellRooms[b]!;
      const ha = nominalHalf(A.room!, A.p.rot);
      const hb = nominalHalf(B.room!, B.p.rot);
      const ymidA = A.p.pos.y + A.room!.size.y / 2;
      const ymidB = B.p.pos.y + B.room!.size.y / 2;
      const dx = Math.abs(A.p.pos.x - B.p.pos.x);
      const dz = Math.abs(A.p.pos.z - B.p.pos.z);
      const dy = Math.abs(ymidA - ymidB);
      const touchEps = 0.1;
      const overlapY = dy < ha.hy + hb.hy - touchEps;
      const touchX = Math.abs(dx - (ha.hx + hb.hx)) < touchEps && dz < ha.hz + hb.hz - touchEps;
      const touchZ = Math.abs(dz - (ha.hz + hb.hz)) < touchEps && dx < ha.hx + hb.hx - touchEps;
      if (!overlapY || (!touchX && !touchZ)) continue;
      // beruehren sich -> gibt es EINEN Connector von A und EINEN von B, die
      // (egal ob direkt gepaart oder ueber eine Wand) an dieser Grenze liegen?
      // Boundary je Achse EXAKT (Mittelpunkt der beiden Zentren); je Raum wird
      // auf der SENKRECHTEN Achse dessen EIGENES Zentrum verwendet, nicht das
      // des Partners — sonst verschiebt sich der Suchpunkt bei mehrzelligen
      // Räumen (Treppe, Halle) und ihre eigenen Connectors werden verfehlt.
      const boundaryX = (A.p.pos.x + B.p.pos.x) / 2;
      const boundaryZ = (A.p.pos.z + B.p.pos.z) / 2;
      const nearBoundary = (c: ConnInst, ownPos: Vector3) => {
        const px = touchX ? boundaryX : ownPos.x;
        const pz = touchX ? ownPos.z : boundaryZ;
        return Math.hypot(c.pos.x - px, c.pos.z - pz) < 1.2 && Math.abs(c.pos.y - ownPos.y) < 2;
      };
      const aHas = conns.some((c) => c.roomIndex === A.i && nearBoundary(c, A.p.pos));
      const bHas = conns.some((c) => c.roomIndex === B.i && nearBoundary(c, B.p.pos));
      if (!aHas && !bHas) {
        stummeNachbarn++;
        const pairKey = [A.p.room, B.p.room].sort().join('+');
        pairTypeTally.set(pairKey, (pairTypeTally.get(pairKey) ?? 0) + 1);
        if (beispiele.length < 6) {
          beispiele.push(
            `Stumme Nachbarschaft: #${A.i} (${A.p.room}) @(${A.p.pos.x},${A.p.pos.z}) <-> ` +
              `#${B.i} (${B.p.room}) @(${B.p.pos.x},${B.p.pos.z}) — kein Connector auf beiden Seiten`
          );
        }
      }
    }
  }

  // (d) Erreichbarkeit: Graph aus gepaarten Connectors (nur zwischen
  // zellartigen Räumen — Wände sind Sackgassen).
  const cellIdx = new Set(cellRooms.map((x) => x.i));
  const adj = new Map<number, Set<number>>();
  for (const i of cellIdx) adj.set(i, new Set());
  const cellConns = conns.filter((c) => cellIdx.has(c.roomIndex));
  for (let a = 0; a < cellConns.length; a++) {
    for (let b = a + 1; b < cellConns.length; b++) {
      const ca = cellConns[a]!, cb = cellConns[b]!;
      if (ca.roomIndex === cb.roomIndex) continue;
      if (sqDist(ca.pos, cb.pos) < 0.01) {
        adj.get(ca.roomIndex)!.add(cb.roomIndex);
        adj.get(cb.roomIndex)!.add(ca.roomIndex);
      }
    }
  }
  const startIdx = 0; // Eingangsraum
  const seen = new Set<number>([startIdx]);
  const queue = [startIdx];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  const unerreichbar = cellRooms.filter((x) => !seen.has(x.i)).length;
  if (unerreichbar > 0) {
    const beispielRaum = cellRooms.find((x) => !seen.has(x.i))!;
    beispiele.push(`Unerreichbar: #${beispielRaum.i} (${beispielRaum.p.room}) @(${beispielRaum.p.pos.x},${beispielRaum.p.pos.z},${beispielRaum.p.pos.y})`);
  }

  // (e) Treppen mit unversorgtem Anschluss (offen ODER Blindtür).
  let treppenProblem = 0;
  for (const c of conns) {
    if (layout.rooms[c.roomIndex]!.room !== 'StoneVaultStairs') continue;
    if (openKey.has(`${c.roomIndex}:${c.connIndex}`)) {
      treppenProblem++;
      beispiele.push(
        `Treppenanschluss unversorgt: #${c.roomIndex} Connector ${c.connIndex} bei (${c.pos.x.toFixed(1)},${c.pos.y.toFixed(1)},${c.pos.z.toFixed(1)})`
      );
    }
  }

  return {
    seed,
    offenInsLeere,
    blindtueren,
    stummeNachbarn,
    unerreichbar,
    treppenProblem,
    raeume: layout.rooms.length,
    beispiele,
  };
}

function stats(vals: number[]) {
  const sorted = [...vals].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const mid = sorted.length / 2;
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[Math.floor(mid)]!;
  const betroffen = vals.filter((v) => v > 0).length;
  return { min, median, max, betroffenAnteil: `${betroffen}/${vals.length}` };
}

// ─────────────────────────────────────────────────────────────────────
// Kommandozeile und Ausgabe
// ─────────────────────────────────────────────────────────────────────

interface Aufruf {
  kit: string;
  seeds: number[];
  maxRooms?: number;
  zoneSize?: number;
  streng: boolean;
}

/**
 * `--seeds=40` heisst 1…40, `--seeds=7,11` eine Liste, `--seeds=100-110`
 * einen Bereich. Eine einzelne Zahl über 1000 ist eine SAAT, keine Anzahl
 * — sonst liesse sich Mikes `2123721695` nicht messen, ohne zwei
 * Milliarden Layouts zu bauen.
 */
function leseSeeds(wert: string): number[] {
  if (wert.includes(',')) return wert.split(',').map((s) => Number(s.trim()));
  const bereich = /^(\d+)-(\d+)$/.exec(wert);
  if (bereich) {
    const von = Number(bereich[1]), bis = Number(bereich[2]);
    return Array.from({ length: Math.max(0, bis - von + 1) }, (_, i) => von + i);
  }
  const n = Number(wert);
  return n <= 1000 ? Array.from({ length: n }, (_, i) => i + 1) : [n];
}

export function leseAufruf(argv: readonly string[]): Aufruf {
  const a: Aufruf = { kit: 'DG_StoneVault', seeds: [], streng: false };
  for (const arg of argv) {
    const m = /^--([a-zA-Z]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    const name = m[1]!, wert = m[2];
    if (name === 'streng') a.streng = true;
    else if (name === 'kit' && wert) a.kit = wert;
    else if (name === 'seeds' && wert) a.seeds = leseSeeds(wert);
    else if (name === 'maxRooms' && wert) a.maxRooms = Number(wert);
    else if (name === 'zoneSize' && wert) a.zoneSize = Number(wert);
  }
  if (a.seeds.length === 0) a.seeds = Array.from({ length: SEED_ANZAHL_VORGABE }, (_, i) => i + 1);
  return a;
}

function tabelle(zeilen: ReadonlyArray<readonly [string, string]>): void {
  const breite = Math.max(...zeilen.map((z) => z[0].length));
  for (const [links, rechts] of zeilen) console.log(`  ${links.padEnd(breite)}  ${rechts}`);
}

/** Teil 2 als Tabelle — die Zahlen, gegen die G4…G7 gemessen werden. */
function druckeRastermetrik(g: RasterMetrik): void {
  const anteil = (n: number) => (g.plattenGesamt > 0 ? ` (${((100 * n) / g.plattenGesamt).toFixed(1)} %)` : '');
  tabelle([
    ['Räume gesamt', String(g.raeume)],
    ['belegte Zellen', String(g.zellen)],
    ['Wandplatten gesamt', String(g.plattenGesamt)],
    ['davon in einer BELEGTEN Zelle', `${g.platteInBelegterZelle}${anteil(g.platteInBelegterZelle)}`],
    ['  … gegen volle Wand (überflüssig)', String(g.plattenUeberfluessig)],
    ['  … gegen Teilwand (Treppe, nötig)', String(g.plattenNoetig)],
    ['  … im Eingangsraum (Altausnahme)', String(g.plattenEingang)],
    ['  … vor einer Öffnung', String(g.plattenVorOeffnung)],
    ['Doppelbelegungen', String(g.doppelbelegungen)],
    ['gestapelte Zellen (Ebene n/n+1)', String(g.gestapelteZellen)],
    ['unerklärte Nachbarschaften', String(g.unerklaerteNachbarschaften)],
    ['Zellmitten-Drift (max)', `${g.maxZellDrift.toExponential(2)} m`],
  ]);
  if (g.plattenNachModul.size > 0) {
    console.log('\n  Platte in belegter Zelle, nach Nachbarmodul:');
    tabelle([...g.plattenNachModul].sort((x, y) => y[1] - x[1]).map(([k, v]) => [`    ${k}`, String(v)] as const));
  }
  if (g.unerklaertNachArt.size > 0) {
    console.log('\n  Unerklärte Nachbarschaften, nach Art:');
    tabelle([...g.unerklaertNachArt].sort((x, y) => y[1] - x[1]).map(([k, v]) => [`    ${k}`, String(v)] as const));
  }
}

function main(): void {
  const a = leseAufruf(process.argv.slice(2));
  const basis = holeKit(a.kit);
  const def: DungeonDef = a.maxRooms !== undefined ? { ...basis, maxRooms: a.maxRooms } : basis;
  const einstellungen = a.zoneSize !== undefined ? { zoneSize: a.zoneSize } : undefined;

  const layouts = a.seeds.map((seed) => ({ seed, layout: erzeugeLayoutFuerKit(def, seed, einstellungen) }));
  const rasterkit = hatRastererklaerung(def);
  const raster = rasterkit
    ? layouts.map(({ seed, layout }) => {
        const m = messeRasterLayout(layout, def);
        m.seed = seed;
        return m;
      })
    : [];
  const g = summiereRaster(raster);
  const befunde = layouts.map(({ seed, layout }) => messeLayout(layout, seed, def));

  const kopf =
    `${a.kit} — ${a.seeds.length} Saat(en)` +
    (a.maxRooms !== undefined ? `, maxRooms ${a.maxRooms}` : '') +
    (a.zoneSize !== undefined ? `, zoneSize ${a.zoneSize}` : '');

  console.log(`=== Rastermetrik (G1): ${kopf} ===\n`);
  if (rasterkit) druckeRastermetrik(g);
  else {
    console.log(`  ÜBERSPRUNGEN — '${a.kit}' hat keine Rastererklärung.`);
    console.log('  Teil 2 setzt 2-m-Zellen und 3,5-m-Ebenen voraus; an einem Kit mit');
    console.log('  anderem Raster misst es Zahlen, die wie ein Befund aussehen und');
    console.log('  keiner sind. Teil 1 gilt weiter.');
  }

  console.log(`\n=== Verbindungsmetrik (Teil 1): ${kopf} ===\n`);
  console.log('  Metrik                   min  median  max  betroffene Saaten');
  for (const [label, key] of [
    ['offene Kanten ins Leere', 'offenInsLeere'],
    ['Blindtüren (Wand davor)', 'blindtueren'],
    ['stumme Nachbarschaften ', 'stummeNachbarn'],
    ['unerreichbare Räume    ', 'unerreichbar'],
    ['Treppen-Anschlussfehler', 'treppenProblem'],
  ] as const) {
    const vals = befunde.map((b) => b[key as keyof Befund] as number);
    const s = stats(vals);
    console.log(`  ${label}  ${String(s.min).padStart(3)}  ${String(s.median).padStart(6)}  ${String(s.max).padStart(3)}  ${s.betroffenAnteil}`);
  }
  console.log(
    `\n  Räume je Layout: min ${Math.min(...befunde.map((b) => b.raeume))}` +
      ` median ${stats(befunde.map((b) => b.raeume)).median}` +
      ` max ${Math.max(...befunde.map((b) => b.raeume))}`
  );
  if (pairTypeTally.size > 0) {
    console.log('\n  Stumme Nachbarschaften nach Raumtyp-Paar:');
    tabelle([...pairTypeTally].sort((x, y) => y[1] - x[1]).map(([k, v]) => [`    ${k}`, String(v)] as const));
  }

  console.log('\n--- Beispiele (auffälligste Saaten) ---');
  for (const b of [...raster].sort((x, y) => y.unerklaerteNachbarschaften - x.unerklaerteNachbarschaften).slice(0, 2)) {
    console.log(
      `\n  Saat ${b.seed}: ${b.raeume} Räume, ${b.zellen} Zellen, ` +
        `${b.platteInBelegterZelle} Platten in belegten Zellen, ${b.unerklaerteNachbarschaften} unerklärt`
    );
    for (const e of b.beispiele.slice(0, 5)) console.log('    ' + e);
  }

  console.log('\n--- Alle Saaten (roh) ---');
  for (let i = 0; i < befunde.length; i++) {
    const b = befunde[i]!, r = raster[i];
    const teil2 = r
      ? `zellen=${r.zellen} platten=${r.plattenGesamt} inBelegt=${r.platteInBelegterZelle} ` +
        `ueberfluessig=${r.plattenUeberfluessig} noetig=${r.plattenNoetig} eingang=${r.plattenEingang} ` +
        `vorOeffnung=${r.plattenVorOeffnung} gestapelt=${r.gestapelteZellen} unerklaert=${r.unerklaerteNachbarschaften} `
      : '';
    console.log(
      `seed=${b.seed} raeume=${b.raeume} ${teil2}` +
        `offen=${b.offenInsLeere} blind=${b.blindtueren} stumm=${b.stummeNachbarn} unerreichbar=${b.unerreichbar} treppe=${b.treppenProblem}`
    );
  }

  console.log('');
  if (!rasterkit) {
    // Kein Rasterkit heisst: keine Aussage. Ein „alles gehalten" wäre hier
    // eine grüne Lampe an einem Gerät, das gar nicht angeschlossen ist.
    console.log('Invarianten: nicht geprüft (Kit ohne Rastererklärung).');
    return;
  }
  const verletzt = verletzteInvarianten(g);
  if (verletzt.length === 0) {
    console.log('Invarianten: alle gehalten.');
    return;
  }
  console.log('Invarianten VERLETZT:');
  for (const v of verletzt) console.log(`  - ${v}`);
  if (a.streng) {
    console.log('\n--streng: Exit-Code 1.');
    process.exit(1);
  }
  console.log('\n(Ohne --streng bleibt der Exit-Code 0 — die Messzelle ist auch ein Werkzeug.)');
}

// Nur beim direkten Aufruf messen: der Abnahmetest importiert die
// Funktionen und will keine dreihundert Zeilen Ausgabe dazu.
if (process.argv[1] !== undefined && /messe-stonevault-logik\.[tj]s$/.test(process.argv[1])) main();
