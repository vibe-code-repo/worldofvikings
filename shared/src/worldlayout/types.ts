/**
 * WorldLayout — das Autorformat der designer-definierten Welt.
 *
 * Ein Layout beschreibt Regionen (Polygone/Kreise mit Biom und
 * Terrainparametern) auf einer unbegrenzten Karte. Alles außerhalb von
 * Regionen ist offener Ozean; das Detail INNERHALB einer Region liefern
 * weiterhin die Valheim-Biomhöhenfunktionen (RegionGeo ersetzt nur die
 * radiale Basis). Die Reihenfolge in `regions` ist die Z-Ordnung: spätere
 * Regionen überdecken frühere — so malt man ein Gebirge mitten auf einen
 * Wiesen-Kontinent.
 *
 * Das Dokument ist klein (JSON, typisch < 200 KB) und wird 1:1 an Client
 * und Karten-Worker übertragen; das Laufzeitformat (Distanzfeld) kompiliert
 * jede Seite deterministisch selbst (compile.ts).
 */

import { Biome } from '../types.js';
import type { NpcDef } from '../npc.js';

export const WORLD_LAYOUT_VERSION = 1;

/**
 * Größte erlaubte Ausdehnung. Bewusst 40 km statt der ursprünglich
 * geplanten 100 km: Das Dungeon-Instanzband beginnt bei x > 50 000
 * (shared/src/constants.ts) und bleibt so unangetastet, und die
 * float32-Präzision liegt bei ±40 km noch bei ~4 mm. Immer noch das
 * 16-fache der klassischen Weltfläche.
 */
export const LAYOUT_MAX_EXTENT = 40_000;

/**
 * Autorenname eines Bioms im Weltdokument.
 *
 * `grassland` hiess bis 08/2026 `meadows`. Umbenannt, weil der Name in
 * DIESEM Projekt eine Landschaftsform beschreibt und keinen Verweis auf
 * das Vorbild sein soll — der Bezug dorthin steckt allein in der
 * Bitmaske `Biome.Meadows`, die unveraendert bleibt (sie ist Teil des
 * Netzformats und der gespeicherten Welten). Alte Dokumente mit
 * `meadows` liest `sanitizeWorldLayout` weiterhin und schreibt sie auf
 * den neuen Namen um.
 */
export type BiomeName =
  | 'grassland'
  | 'blackforest'
  | 'swamp'
  | 'mountain'
  | 'plains'
  | 'mistlands'
  | 'ashlands'
  | 'deepnorth';

/** Autorname → Bitmasken-Biom (shared/src/types.ts, Werte aus C++ Types.h). */
export const BIOME_BY_NAME: ReadonlyMap<BiomeName, Biome> = new Map([
  ['grassland', Biome.Meadows],
  ['blackforest', Biome.BlackForest],
  ['swamp', Biome.Swamp],
  ['mountain', Biome.Mountain],
  ['plains', Biome.Plains],
  ['mistlands', Biome.Mistlands],
  ['ashlands', Biome.AshLands],
  ['deepnorth', Biome.DeepNorth],
]);

/**
 * Basis-Plateau je Biom (normierte getBaseHeight-Skala; 0.15 ⇔ Wasserlinie,
 * ×200 = Meter). Die Werte orientieren sich an den Schwellen der radialen
 * Formel: Mountain entschied dort bei base > 0.4, Swamp lebte in 0.05–0.25.
 */
export const DEFAULT_BASE_LEVEL: ReadonlyMap<BiomeName, number> = new Map([
  ['grassland', 0.22],
  ['blackforest', 0.26],
  ['swamp', 0.16],
  ['mountain', 0.5],
  ['plains', 0.22],
  ['mistlands', 0.27],
  ['ashlands', 0.22],
  ['deepnorth', 0.34],
]);

export interface ContinentDef {
  id: string;
  name: string;
  faction?: 'saxon' | 'viking' | 'neutral';
  /** Startpunkt dieser Fraktion [x, z] — der Server spawnt hier (Höhe
   *  kommt aus dem Gelände). Ohne Angabe gilt der Welt-Spawn. */
  spawn?: readonly [number, number];
}

export type RegionShape =
  | {
      kind: 'polygon';
      /** Einfaches Polygon (keine Löcher), Weltkoordinaten [x, z] in Metern. */
      points: ReadonlyArray<readonly [number, number]>;
    }
  | { kind: 'circle'; x: number; z: number; radius: number };

export interface RegionDef {
  id: string;
  continentId?: string;
  biome: BiomeName;
  shape: RegionShape;
  /** Küsten-/Grenz-Falloff in Metern — über diese Strecke steigt das Land
   *  vom Ozeanboden auf das Regionsniveau. */
  edgeFalloff: number;
  /** Basis-Plateau (normiert); Default: DEFAULT_BASE_LEVEL des Bioms. */
  baseLevel?: number;
  /** Amplitudenfaktor des Perlin-Details (Default 1). */
  heightScale?: number;
  /**
   * Progressionsstufe 0–5 (Ersatz für die Weltzentrums-Distanzen der
   * Radialwelt): Locations mit höherer Stufe entstehen hier nicht. Ohne
   * Angabe gilt keine Beschränkung — dann zählen nur Biom und die
   * Kuratierungslisten.
   */
  tier?: number;
  /** Override für den Waldfaktor (0 = kahl … 2 = dicht); ohne Wert gilt
   *  weiterhin das globale Wald-Perlin. */
  forestDensity?: number;
  /**
   * Faktor auf die Stückzahl JE STREUEINTRAG (0.1 … 4, Vorgabe 1).
   *
   * Die zweite Hälfte der Bewuchssteuerung, und sie meint etwas anderes
   * als `forestDensity`:
   *
   *   forestDensity  verschiebt den Waldfaktor — also WO Wald ist.
   *   bewuchsDichte  skaliert die Stückzahlen — also WIE VIELE Bäume
   *                  auf der Fläche stehen, die Wald ist.
   *
   * Beide zusammen ergeben die Bandbreite von der lichten Weide bis zum
   * geschlossenen Bestand. Getrennt, weil man sie getrennt braucht: eine
   * kleine dichte Waldinsel ist etwas anderes als ein flächiger lichter
   * Hain, und mit einer einzigen Zahl liesse sich das nicht sagen.
   *
   * Der Mindestabstand der Arten (`Foliage.radius`) bleibt die harte
   * Grenze — er verhindert, dass hohe Werte die Bäume ineinander
   * schieben. Ab einem gewissen Punkt bringt Aufdrehen deshalb nichts
   * mehr, und das ist Absicht.
   */
  bewuchsDichte?: number;
  /**
   * Körnung des Waldfaktor-Feldes (0.2 … 3, Vorgabe 1).
   *
   * Die dritte Stellschraube des Bewuchses, und die einzige, die nicht
   * die MENGE, sondern die räumliche STRUKTUR betrifft:
   *
   *   forestDensity  verschiebt den Waldfaktor  — wie viel Wald
   *   bewuchsDichte  skaliert die Stückzahlen   — wie dicht darauf
   *   waldKoernung   skaliert das Feld selbst   — wie GROSS die Flächen
   *
   * Der Waldfaktor ist ein fbm-Perlin mit 250 m Wellenlänge (grobste
   * Oktave, GeoManager.getForestFactor). Daraus entstehen Waldflecken
   * von wenigen hundert Metern — man tritt ständig aus dem Wald heraus
   * und wieder hinein. Ein Wert unter 1 zieht das Feld auseinander und
   * macht die Flächen entsprechend grösser: 0.35 ergibt gut 700 m
   * zusammenhängenden Wald, und erst darin läuft man wirklich "durch
   * den Wald" statt über eine Lichtungslandschaft.
   *
   * Die Lichtungen verschwinden dabei NICHT — sie werden im selben Mass
   * grösser. Das ist der Unterschied zu `forestDensity`, das sie
   * zuwachsen liesse.
   */
  waldKoernung?: number;
  /**
   * Faktor auf den MINDESTABSTAND aller Streueinträge (0.3 … 2,
   * Vorgabe 1).
   *
   * Die vierte Stellschraube — und gemessen die wirksamste. Jeder
   * Foliage-Eintrag trägt einen `radius`, unter den zwei Exemplare nicht
   * zusammenrücken dürfen; er ist die HARTE Grenze der Dichte. Solange
   * er fest war, lief `bewuchsDichte` gegen eine Wand: Gemessen an einem
   * Nadelwald brachten die Stufen 1.0 / 1.5 / 2.5 / 4.0 durchweg 45 bis
   * 47 Stämme je Zone — der Regler tat praktisch nichts.
   *
   * Weil die belegte Fläche mit dem QUADRAT des Radius geht, vervierfacht
   * ein Faktor 0.5 die mögliche Stammzahl. Das ist der Griff, mit dem aus
   * einem lichten Hain ein geschlossener Bestand wird.
   *
   * Nach unten begrenzt auf 0.3: Darunter wachsen Stämme sichtbar
   * ineinander.
   */
  abstandFaktor?: number;
  /**
   * Nadelwald-Nester: Stärke der Binnenvariation (0 … 1, Vorgabe 0).
   *
   * Die bisherigen vier Regler beschreiben eine Region als GANZES — sie
   * ist überall gleich dicht. Ein echter Mischwald ist das nicht: Er hat
   * Partien, in denen der Nadelwald geschlossen und dunkel steht, und
   * andere, durch die man hindurchsieht.
   *
   * `nester` legt dafür ein eigenes Rauschfeld über die Region
   * (`RegionGeo.nestFaktor`), das ZWEI Dinge zugleich moduliert:
   *
   *   den Baumabstand   — im Nest rücken die Stämme enger zusammen
   *   die Geländeamplitude — und das Gelände wird dort bewegter
   *
   * Die Kopplung ist der eigentliche Gewinn. In den Vorbildern ist der
   * dunkle Nadelwald nicht nur dichter bewachsen, er liegt auch im
   * kupierten Gelände, während die offene Wiese flach ist. Beides aus
   * demselben Feld zu speisen, bindet Bewuchs und Landschaft aneinander,
   * statt sie unabhängig voneinander würfeln zu lassen.
   *
   * Vorgabe 0: Ohne ausdrückliche Angabe ändert sich an einer
   * bestehenden Welt nichts — weder am Bewuchs noch am Terrain.
   */
  nester?: number;
  /** Körnung der Nester (0.2 … 3, Vorgabe 1 ≈ 300-m-Flecken). */
  nesterKoernung?: number;
  /**
   * Kuratierung (Nutzer-Entscheidung: volle Kontrolle je Region).
   * Fehlt ein Feld, gelten die Standard-Tabellen des Bioms (gefiltert über
   * die vorhandenen biome-Bitmasken). Gesetzt = exakt diese Einträge; Namen
   * aus FOLIAGE / FEATURES / SPAWN_TABLE, unbekannte werden serverseitig
   * ignoriert.
   */
  vegetation?: readonly string[];
  locations?: readonly string[];
  spawns?: readonly string[];
}

/**
 * Handplatziertes Einzelobjekt (Editor-Spawn): Baum, Fels, Gegenstand …
 * Die Höhe wird beim Spawnen aus dem Boden abgeleitet, nie gespeichert —
 * so überleben Platzierungen jede Höhenänderung des Layouts.
 */
export interface PlacementDef {
  /** Prefab-Name (Registry); unbekannte Namen ignoriert der Server. */
  prefab: string;
  x: number;
  z: number;
  /** Drehung um die Hochachse in Radiant (Default 0). */
  yaw?: number;
  /** Einheitliche Skalierung (Default 1, geklemmt 0.2–5). */
  scale?: number;
  /**
   * ID einer Route aus `WorldLayout.routes`: Der Server lässt dieses Objekt
   * die Route ablaufen (nur sinnvoll für Prefabs mit SYNCED_TRANSFORM).
   * Ein unbekannter Name wird beim Spawnen ignoriert — das Objekt steht
   * dann einfach still, statt dass die ganze Platzierung ausfällt.
   */
  route?: string;
  /**
   * Untergrund einebnen: Radius in Metern, in dem das Gelände auf die Höhe
   * des Platzierungspunkts gezogen wird — große Bauwerke (Grabhügel) stehen
   * sonst mit durchstoßenden Bodenwellen da. Bewusst ein FELD an der
   * Platzierung statt eines eigenen Verformungs-Objekts (wie Fluss/See):
   * Verschieben oder Löschen im Editor nimmt den Sockel automatisch mit,
   * eine separate Verformung müsste jede dieser Operationen nachziehen.
   * Die Zielhöhe wird NICHT gespeichert — sie ist die Geländehöhe am
   * Mittelpunkt, wie bei der Spawn-Höhe der Platzierung selbst.
   */
  einebnen?: number;
  /**
   * Einordnung dieser Figur (Name, Rolle, Fraktion, Stufe, Quest) —
   * ausschliesslich die ABWEICHUNGEN von der Prefab-Vorgabe
   * (shared/npc.ts, NPC_VORGABEN). Fehlt das Feld oder ein einzelner
   * Wert darin, gilt die Vorgabe; zusammengesetzt wird beides an genau
   * einer Stelle, `loeseNpcAuf`.
   *
   * Bewusst nur die Abweichungen: Ein Dokument, das die Vorgaben
   * ausschreibt, müsste bei jeder Änderung an NPC_VORGABEN nachgezogen
   * werden — und bis dahin wäre jede alte Platzierung eine Ausnahme.
   */
  npc?: NpcDef;
}

/**
 * ZDO-Member, in dem der Server die Herkunft einer gespawnten
 * Platzierung führt — `layoutKennung` des Eintrags.
 *
 * Er ist zugleich der SCHLÜSSEL, über den der Client eine Instanz ihrem
 * Layout-Eintrag zuordnet (Namensschild): Das Dokument hat er ohnehin
 * schon (Paket WorldLayoutData), der Member steht ohnehin schon in jeder
 * ZDO — so kostet die Einordnung KEIN einziges zusätzliches Byte auf der
 * Leitung. Position wäre der naheliegende Schlüssel gewesen und wäre
 * falsch: Ein Routen-NPC ist längst woanders.
 */
export const LAYOUT_ID_MEMBER = 'layoutId';

/**
 * Kennung eines Layout-Eintrags: Prefab + gerundete Position.
 *
 * Bewusst aus dem INHALT abgeleitet und keine vergebene ID — das
 * Dokument wird von Hand, vom Editor und vom MCP-Server geschrieben, und
 * keiner dieser Wege könnte eine Zählernummer verlässlich fortführen.
 * Zwei Objekte im selben Meter sind der Preis dafür (dann teilen sie
 * sich die Kennung); das ist beim Setzen bereits Deckungsgleichheit.
 */
export function layoutKennung(p: { prefab: string; x: number; z: number }): string {
  return `${p.prefab}@${Math.round(p.x)},${Math.round(p.z)}`;
}

/**
 * Fluss als Polylinie (Review-Punkt 32): schneidet sich ins Gelände,
 * ändert aber KEIN Biom — Wasser entsteht dadurch, dass der Boden unter
 * die Wasserlinie fällt, genau wie im Original.
 */
export interface RiverDef {
  id: string;
  /** Verlauf [x, z] in Metern, mindestens zwei Punkte. */
  points: ReadonlyArray<readonly [number, number]>;
  /** Breite des Wasserlaufs in Metern (Bettbreite). */
  width: number;
  /** Wie tief unter die Wasserlinie das Bett reicht (m, Default 6). */
  depth?: number;
}

/**
 * Wie eine Route endet, wenn der letzte Wegpunkt erreicht ist.
 *   loop     — im Kreis: vom letzten zurück zum ersten Punkt (Runde).
 *   pingpong — hin und zurück: die Reihenfolge kehrt sich um.
 */
export type RouteMode = 'loop' | 'pingpong';

/** Gehgeschwindigkeit ohne Angabe (m/s) — ruhiger Schritt eines NPCs. */
export const ROUTE_DEFAULT_SPEED = 1.5;

/**
 * Längste Pause an einem Wegpunkt (s). Zehn Minuten sind reichlich für
 * „steht am Feuer und schaut" — darüber hinaus ist der Punkt in Wahrheit
 * ein Standposten (eigene Ein-Punkt-Route) und keine Pause mehr.
 */
export const ROUTE_MAX_PAUSE = 600;

/**
 * Ein Wegpunkt: `[x, z]` oder `[x, z, pause]` mit einer Wartezeit in
 * Sekunden.
 *
 * Die Pause hängt am PUNKT und nicht in einem parallelen Feld
 * (`pauses: number[]`): Jede Editor-Operation verschiebt Wegpunkte —
 * anhängen, zurücknehmen, ziehen — und ein zweites Array müsste bei jeder
 * einzelnen mitgezogen werden. Genau dort entstehen Versätze, nach denen
 * die Pause am falschen Punkt klebt. Als drittes Element kann das nicht
 * passieren; ausserdem bleiben alte Dokumente wörtlich gültig: `[x, z]`
 * ist eine Pause von 0.
 */
export type Wegpunkt = readonly [number, number] | readonly [number, number, number];

/** Wartezeit eines Wegpunkts in Sekunden (0, wenn keine angegeben ist). */
export function wegpunktPause(p: Wegpunkt): number {
  return p.length === 3 ? p[2] : 0;
}

/**
 * Benannte Route: die Folge von Wegpunkten, die ein platzierter NPC abläuft
 * (`PlacementDef.route`).
 *
 * Die Route liegt bewusst IM Layout-Dokument und nicht in einer eigenen
 * Datei: Wegpunkte sind Weltdesign wie Flüsse und Platzierungen — sie
 * gehören zu genau der Welt, in der sie liegen, und nehmen so den
 * vorhandenen Weg über Editor, MCP-Sanitisierung und Deploy mit.
 *
 * Wie bei Platzierungen steht KEINE Höhe drin: Der Server holt sie beim
 * Laufen aus dem Gelände, damit der NPC jeder späteren Höhenänderung des
 * Layouts folgt, statt in der Luft oder im Boden zu laufen.
 */
export interface RouteDef {
  id: string;
  /**
   * Wegpunkte in Metern, mindestens einer (ein Punkt = Standposten).
   * `[x, z]` läuft durch, `[x, z, pause]` hält dort pause Sekunden an.
   */
  points: ReadonlyArray<Wegpunkt>;
  mode: RouteMode;
  /** Gehgeschwindigkeit in m/s (Default ROUTE_DEFAULT_SPEED). */
  speed?: number;
}

/** See als Kreis — dieselbe Carving-Logik wie beim Fluss. */
export interface LakeDef {
  id: string;
  x: number;
  z: number;
  radius: number;
  depth?: number;
}

export interface WorldLayout {
  version: typeof WORLD_LAYOUT_VERSION;
  name: string;
  /** Seed NUR fürs Perlin-Detail (Hügel, Wald, Küstenrauschen). */
  detailSeed: string;
  continents: readonly ContinentDef[];
  /** Z-Ordnung: spätere überdecken frühere. */
  regions: readonly RegionDef[];
  /** Handplatzierte Objekte (Editor-Spawn), zusätzlich zur Vegetation. */
  placements?: readonly PlacementDef[];
  /** Welt-Startpunkt [x, z] — greift, wenn die Fraktion keinen eigenen
   *  hat. Ohne Angabe bleibt es beim Ursprung (kann Ozean sein!). */
  defaultSpawn?: readonly [number, number];
  /** Flüsse (Polylinien) — schneiden sich ins Gelände. */
  rivers?: readonly RiverDef[];
  /** Seen (Kreise) — dieselbe Carving-Logik. */
  lakes?: readonly LakeDef[];
  /** Benannte NPC-Routen; eine Platzierung verweist per `route` darauf. */
  routes?: readonly RouteDef[];
}

/**
 * Progressionsstufe eines Features aus seiner Radialwelt-Distanz —
 * `minDistance` kodierte dort implizit, wie weit fortgeschritten ein
 * Spieler sein musste. Ohne diese Übersetzung stünden Bosskammern und
 * Startdörfer im Layout-Modus gleichberechtigt nebeneinander.
 */
export function tierAusDistanz(minDistance: number): number {
  if (minDistance <= 0) return 0;
  if (minDistance < 1000) return 1;
  if (minDistance < 2000) return 2;
  if (minDistance < 4000) return 3;
  if (minDistance < 7000) return 4;
  return 5;
}

/** Achsenparallele Hülle einer Form (für Bbox-Checks und den Kompiler). */
export function shapeBounds(shape: RegionShape): {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
} {
  if (shape.kind === 'circle') {
    return {
      minX: shape.x - shape.radius,
      minZ: shape.z - shape.radius,
      maxX: shape.x + shape.radius,
      maxZ: shape.z + shape.radius,
    };
  }
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of shape.points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

/** Bounding-Box des gesamten Layouts (ohne Falloff-Ränder). */
export function layoutBounds(layout: WorldLayout): {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
} {
  let minX = -1024;
  let minZ = -1024;
  let maxX = 1024;
  let maxZ = 1024;
  for (const r of layout.regions) {
    const b = shapeBounds(r.shape);
    if (b.minX < minX) minX = b.minX;
    if (b.minZ < minZ) minZ = b.minZ;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxZ > maxZ) maxZ = b.maxZ;
  }
  return { minX, minZ, maxX, maxZ };
}
