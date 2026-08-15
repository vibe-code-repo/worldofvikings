/**
 * Eigene Flora — Streuparameter für die selbst gebauten Pflanzen.
 *
 * `shared/src/vegetation.ts` liest die 120 Einträge aus Valheims
 * `vegetation.pkg`. Dort stehen ausschliesslich Original-Prefabs; unsere
 * prozeduralen Bäume, Sträucher und Bodenpflanzen (tools/baeume-bauen.sh,
 * tools/buesche-bauen.sh, tools/blumen-bauen.sh) kommen darin nicht vor.
 *
 * Der ZoneManager streut aber genau über diese Liste (ZoneManager.ts:527).
 * Ohne einen Eintrag hier wird ein Modell NIE gestreut — auch dann nicht,
 * wenn es in der Kuratierungsliste einer Region steht. Diese Datei
 * schliesst die Lücke: Sie definiert dieselbe Struktur von Hand und hängt
 * sie an FOLIAGE an, so wie `prefabs.ts` seine HINT_DEFS an die
 * pkg-Prefabs hängt.
 *
 * ── Die Werte und woher sie kommen ───────────────────────────────────
 * Eine Zone ist 64 × 64 m = 4.096 m². `min`/`max` gelten JE ZONE, der
 * Rest ist an den Originalen gemessen, die dieselbe Rolle spielen:
 *
 *     Birch1              5 Bäume/Zone   = 1 je 819 m²
 *     Bush01             60–80 Büsche   = 1 je 58 m²
 *     Pickable_Dandelion  8–10 Gruppen à 1–3
 *
 * ── `inForest` ist die eigentliche Verteilungsregel ──────────────────
 * Der Waldfaktor ist ein eigenes Perlin-Feld über der Welt. `inForest`
 * plus `forestTresholdMin/Max` schneidet daraus das Fenster heraus, in
 * dem eine Art wachsen darf. Genau daran hängt, dass Grasland nicht
 * gleichmässig zugewachsen aussieht, sondern eine Wiese mit Baumgruppen
 * ist:
 *
 *     Bäume      inForest true,  0.00–1.15  → nur in den Waldinseln
 *     Sträucher  inForest true,  0.90–1.30  → am Waldrand
 *     Blumen     inForest false, 1.10–5.00  → nur auf der offenen Wiese
 *
 * Die drei Fenster überlappen sich absichtlich nur an den Rändern — so
 * steht das Gebüsch dort, wo der Wald in die Wiese übergeht.
 */

import { Biome } from './types.js';
import { getStableHash } from './hash.js';
import type { Foliage } from './vegetation.js';

/**
 * Vorgaben, die für alle eigenen Einträge gleich sind.
 *
 * `blockCheck` bleibt an: Ohne ihn wachsen Pflanzen in Bauwerke hinein.
 * `minAltitude` 0.5 hält sie aus der Brandung heraus (Werte sind relativ
 * zur Wasserlinie, siehe Foliage.minAltitude).
 */
const BASIS = {
  biomeArea: 7, // Rand + Mitte, wie fast alle Originaleinträge
  groupRadius: 0,
  forcePlacement: false,
  groupSizeMin: 1,
  groupSizeMax: 1,
  randTilt: 0,
  blockCheck: true,
  minAltitude: 0.5,
  maxAltitude: 1000,
  minOceanDepth: 0,
  maxOceanDepth: 0,
  terrainDeltaRadius: 0,
  minTerrainDelta: 0,
  maxTerrainDelta: 2,
  snapToWater: false,
  snapToStaticSolid: false,
  groundOffset: 0,
  chanceToUseGroundTilt: 0,
  minVegetation: 0,
  maxVegetation: 0,
} as const;

type FloraKurz = {
  readonly name: string;
  readonly biome: Biome;
  /** Mindestabstand zweier Exemplare in Metern. */
  readonly radius: number;
  /** Stückzahl je Zone (64 × 64 m). */
  readonly min: number;
  readonly max: number;
  /** Erlaubte Hangneigung in Grad. */
  readonly maxTilt: number;
  /** Waldfenster: [drinnen?, von, bis]. */
  readonly wald: readonly [boolean, number, number];
  readonly scaleMin?: number;
  readonly scaleMax?: number;
  /** Gruppenbildung: [Radius in m, min, max]. */
  readonly gruppe?: readonly [number, number, number];
  /** Zufällige Neigung in Grad — bei Bodenpflanzen erwünscht. */
  readonly kippen?: number;
};

function flora(k: FloraKurz): Foliage {
  return {
    ...BASIS,
    prefabName: k.name,
    prefabHash: getStableHash(k.name),
    biome: k.biome,
    radius: k.radius,
    min: k.min,
    max: k.max,
    minTilt: 0,
    maxTilt: k.maxTilt,
    inForest: k.wald[0],
    forestTresholdMin: k.wald[1],
    forestTresholdMax: k.wald[2],
    scaleMin: k.scaleMin ?? 0.9,
    scaleMax: k.scaleMax ?? 1.1,
    groupRadius: k.gruppe?.[0] ?? 0,
    groupSizeMin: k.gruppe?.[1] ?? 1,
    groupSizeMax: k.gruppe?.[2] ?? 1,
    randTilt: k.kippen ?? 0,
  };
}

const M = Biome.Meadows;

/**
 * Die Flora des Graslands — Laubwald-Inseln in offener Wiese.
 *
 * Bewusst OHNE Nadelbäume: Fichte und Tanne stehen im Nadelwald, und die
 * Trennung der Biome ist das, was eine Graslandinsel von einem
 * Schwarzwald unterscheidet. Wer sie trotzdem will, trägt sie in der
 * Kuratierungsliste der Region nach.
 */
export const GRASLAND_FLORA: readonly Foliage[] = [
  // ── Bäume ──────────────────────────────────────────────────────────
  // Eichen stehen EINZELN und selten (max 2 je Zone): Eine Eiche ist ein
  // Solitär, und mit 12 m Kronenbreite ist sie das Grössenmass, an dem
  // alles andere hängt. Der grosse `radius` hält sie auseinander.
  flora({ name: 'Eiche1', biome: M, radius: 8, min: 1, max: 3, maxTilt: 20, wald: [true, 0.9, 1.3] }),
  flora({ name: 'Eiche2', biome: M, radius: 7, min: 1, max: 3, maxTilt: 22, wald: [true, 0.9, 1.3] }),
  flora({ name: 'Eiche3', biome: M, radius: 9, min: 0, max: 2, maxTilt: 18, wald: [true, 1.0, 1.4] }),
  // Birken tragen den Wald: viele, in Gruppen, mit kleinem Abstand.
  flora({ name: 'BirkeHoch2', biome: M, radius: 3.2, min: 12, max: 30, maxTilt: 28, wald: [true, 0.0, 1.15], gruppe: [12, 2, 5] }),
  flora({ name: 'BirkeHoch3', biome: M, radius: 4.0, min: 8, max: 20, maxTilt: 26, wald: [true, 0.0, 1.15], gruppe: [12, 2, 4] }),
  flora({ name: 'BirkeDicht2', biome: M, radius: 3.6, min: 9, max: 24, maxTilt: 28, wald: [true, 0.0, 1.1], gruppe: [10, 2, 4] }),
  // Jungwuchs am Waldrand — die kleinen Stufen, damit der Wald nicht aus
  // lauter gleich alten Bäumen besteht.
  flora({ name: 'BirkeHoch1', biome: M, radius: 2.0, min: 10, max: 26, maxTilt: 32, wald: [true, 0.85, 1.25], gruppe: [8, 2, 5] }),

  // Die grossen Laubbäume — dieselbe Überlegung wie im Nadelwald, nur
  // dass hier die Krone die Sicht nimmt und nicht der Stamm.
  flora({ name: 'Eiche4', biome: M, radius: 11, min: 0, max: 2, maxTilt: 18, wald: [true, 0.9, 1.35] }),
  flora({ name: 'BirkeHoch4', biome: M, radius: 4.4, min: 2, max: 7, maxTilt: 26, wald: [true, 0.0, 1.2], gruppe: [14, 2, 4] }),

  // ── Felsen ─────────────────────────────────────────────────────────
  // Auf der offenen Wiese liegen sie einzeln — ein Findling im Gras ist
  // ein Blickpunkt und eine Wegmarke.
  flora({ name: 'Findling2', biome: M, radius: 3.2, min: 0, max: 2, maxTilt: 22, wald: [false, 0.9, 5], scaleMin: 0.8, scaleMax: 1.4, kippen: 6 }),
  flora({ name: 'Findling1', biome: M, radius: 1.8, min: 1, max: 4, maxTilt: 30, wald: [false, 0.9, 5], scaleMin: 0.7, scaleMax: 1.4, kippen: 9 }),
  flora({ name: 'Felsplatte1', biome: M, radius: 2.6, min: 0, max: 3, maxTilt: 26, wald: [false, 0.9, 5], scaleMin: 0.8, scaleMax: 1.5, kippen: 8 }),
  flora({ name: 'Steinbank1', biome: M, radius: 3.0, min: 0, max: 2, maxTilt: 24, wald: [false, 1.0, 5], scaleMin: 0.8, scaleMax: 1.3, kippen: 5 }),

  // ── Sträucher ──────────────────────────────────────────────────────
  // Am Waldrand (Fenster 0.9–1.3), wo Bäume aufhören und Wiese anfängt.
  flora({ name: 'Hasel2', biome: M, radius: 2.4, min: 3, max: 8, maxTilt: 35, wald: [true, 0.9, 1.3], gruppe: [10, 2, 4] }),
  flora({ name: 'Hasel3', biome: M, radius: 3.0, min: 1, max: 4, maxTilt: 32, wald: [true, 0.9, 1.25] }),
  flora({ name: 'Schlehe1', biome: M, radius: 2.2, min: 2, max: 7, maxTilt: 38, wald: [true, 0.95, 1.35], gruppe: [9, 2, 5] }),
  flora({ name: 'Schlehe2', biome: M, radius: 2.8, min: 1, max: 4, maxTilt: 35, wald: [true, 0.95, 1.3] }),
  flora({ name: 'Hartriegel1', biome: M, radius: 2.0, min: 2, max: 6, maxTilt: 38, wald: [true, 0.9, 1.35], gruppe: [8, 2, 4] }),
  flora({ name: 'Holunder2', biome: M, radius: 2.6, min: 0, max: 3, maxTilt: 32, wald: [true, 0.9, 1.25] }),
  // Brombeere und Wacholder wachsen auch im Offenen — flaches Gestrüpp
  // braucht kein Kronendach.
  flora({ name: 'Brombeere2', biome: M, radius: 1.6, min: 4, max: 12, maxTilt: 45, wald: [false, 0.9, 1.6], gruppe: [7, 2, 6], kippen: 4 }),
  flora({ name: 'Brombeere1', biome: M, radius: 1.2, min: 4, max: 14, maxTilt: 50, wald: [false, 0.9, 1.8], gruppe: [6, 2, 6], kippen: 5 }),
  flora({ name: 'Wacholder2', biome: M, radius: 1.8, min: 1, max: 5, maxTilt: 40, wald: [false, 1.1, 2.0], kippen: 3 }),

  // ── Bodenpflanzen ──────────────────────────────────────────────────
  // NUR auf der offenen Wiese (inForest false, Fenster ab 1.1) und in
  // Gruppen: Blumen stehen in Horsten, nicht gleichverteilt. Die Zahlen
  // sind bewusst hoch — ein Horst kostet 18 bis 40 Dreiecke.
  flora({ name: 'Margerite2', biome: M, radius: 1.1, min: 6, max: 14, maxTilt: 25, wald: [false, 1.1, 5], gruppe: [6, 2, 5], kippen: 5 }),
  flora({ name: 'Margerite1', biome: M, radius: 0.8, min: 6, max: 16, maxTilt: 28, wald: [false, 1.1, 5], gruppe: [5, 2, 6], kippen: 6 }),
  flora({ name: 'Glockenblume2', biome: M, radius: 1.0, min: 4, max: 12, maxTilt: 25, wald: [false, 1.15, 5], gruppe: [5, 2, 5], kippen: 5 }),
  flora({ name: 'Trollblume2', biome: M, radius: 1.0, min: 3, max: 9, maxTilt: 22, wald: [false, 1.2, 5], gruppe: [5, 2, 4], kippen: 5 }),
  flora({ name: 'Schafgarbe1', biome: M, radius: 0.9, min: 5, max: 13, maxTilt: 28, wald: [false, 1.1, 5], gruppe: [5, 2, 5], kippen: 6 }),
  // Unkraut steht dort, wo der Boden gestört ist — hier vertreten durch
  // den Übergangsbereich zum Waldrand.
  flora({ name: 'Brennnessel1', biome: M, radius: 1.3, min: 2, max: 8, maxTilt: 35, wald: [true, 0.95, 1.4], gruppe: [6, 2, 5], kippen: 4 }),
  flora({ name: 'Distel1', biome: M, radius: 1.0, min: 2, max: 7, maxTilt: 32, wald: [false, 1.05, 5], gruppe: [5, 1, 4], kippen: 5 }),
  flora({ name: 'Ampfer1', biome: M, radius: 0.9, min: 3, max: 9, maxTilt: 30, wald: [false, 1.05, 5], gruppe: [5, 1, 4], kippen: 5 }),
  flora({ name: 'Seggen1', biome: M, radius: 0.8, min: 5, max: 14, maxTilt: 30, wald: [false, 1.0, 5], gruppe: [5, 2, 6], kippen: 4 }),
  // Farn braucht Schatten — als einzige Bodenpflanze im Wald.
  flora({ name: 'Farn2', biome: M, radius: 1.2, min: 4, max: 11, maxTilt: 35, wald: [true, 0.0, 1.2], gruppe: [7, 2, 5], kippen: 5 }),
  flora({ name: 'Farn1', biome: M, radius: 0.9, min: 4, max: 12, maxTilt: 38, wald: [true, 0.0, 1.25], gruppe: [6, 2, 6], kippen: 6 }),
];

/**
 * Der Nadelwald — dicht, dunkel, wenig Unterwuchs.
 *
 * Das Gegenstück zum Grasland und der Grund, warum es überhaupt mehrere
 * Bündel gibt: Ein Wald ist nicht dieselbe Wiese mit mehr Bäumen. Drei
 * Dinge unterscheiden ihn, und alle drei stecken in den Zahlen:
 *
 *  1. STÜCKZAHL. Fichten stehen zu zehnt bis zwanzigst je Zone statt zu
 *     dritt. Der Mindestabstand (`radius`) ist dabei die eigentliche
 *     Grenze — er verhindert, dass sie ineinander wachsen, und sorgt
 *     dafür, dass aus hohen Zahlen ein Bestand wird und kein Klumpen.
 *  2. WALDFENSTER. Die Bäume nehmen fast die ganze Skala (0…1.35), statt
 *     sich auf die Waldinseln zu beschränken. Wo im Grasland Wiese wäre,
 *     steht hier noch Wald.
 *  3. UNTERWUCHS. Unter einem geschlossenen Kronendach wachsen keine
 *     Wiesenblumen. Es bleiben Farn, Heidelbeere und Wacholder — und die
 *     nur dort, wo das Dach aufreisst.
 */
export const NADELWALD_FLORA: readonly Foliage[] = [
  // ── Schicht 1: Oberschicht (> 18 m) ────────────────────────────────
  //
  // Das Waldfenster ist je Schicht ENGER, je groesser der Baum: Die
  // Riesen stehen nur im Kern (bis 0.95), der Hauptbestand reicht
  // weiter (1.25), der Jungwuchs bis an den Rand (1.5). Daraus entsteht
  // der Uebergang von selbst — innen dunkel und geschlossen, aussen
  // licht und offen. Ohne die Staffelung waere der Wald ueberall gleich
  // dicht und hoerte an einer Kante auf.
  // ZUERST, und das ist der Kern des Ganzen. Die Streuung prueft jeden
  // Kandidaten gegen die schon belegten Flaechen und arbeitet FOLIAGE der
  // Reihe nach ab — wer zuerst kommt, bekommt den Platz.
  //
  // Gemessen an der alten Reihenfolge (Setzlinge vorn): Von den
  // Riesen kam NICHT EIN EINZIGER durch, der Wald bestand zu zwei
  // Dritteln aus 3-m-Tannen. So wächst kein Wald: Erst stehen die
  // alten Baeume, dann fuellt der Jungwuchs die Luecken.
  flora({ name: 'Kiefer4', biome: M, radius: 9.0, min: 1, max: 3, maxTilt: 24, wald: [true, 0.0, 0.90] }),
  flora({ name: 'Fichte6', biome: M, radius: 5.0, min: 2, max: 5, maxTilt: 26, wald: [true, 0.0, 0.95], gruppe: [16, 1, 3] }),
  flora({ name: 'Tanne7', biome: M, radius: 6.0, min: 1, max: 4, maxTilt: 26, wald: [true, 0.0, 0.95], gruppe: [16, 1, 3] }),
  flora({ name: 'Fichte5', biome: M, radius: 4.2, min: 3, max: 8, maxTilt: 28, wald: [true, 0.0, 1.05], gruppe: [14, 2, 4] }),
  flora({ name: 'Fichte4', biome: M, radius: 4.0, min: 4, max: 10, maxTilt: 28, wald: [true, 0.0, 1.10], gruppe: [14, 2, 5] }),
  flora({ name: 'Kiefer2', biome: M, radius: 6.5, min: 1, max: 4, maxTilt: 26, wald: [true, 0.0, 1.00] }),
  flora({ name: 'Kiefer1', biome: M, radius: 5.5, min: 2, max: 5, maxTilt: 30, wald: [true, 0.0, 1.10] }),

  // ── Schicht 2: Hauptbestand (10–18 m) ──────────────────────────────
  // Er traegt den Wald. Die Kronen sollen sich beruehren, deshalb ein
  // Radius knapp unter dem Kronenradius — vollstaendig ueberlappungsfrei
  // waere ein Park, kein Bestand.
  flora({ name: 'Tanne5', biome: M, radius: 3.4, min: 4, max: 11, maxTilt: 28, wald: [true, 0.0, 1.25], gruppe: [14, 2, 5] }),
  flora({ name: 'Fichte2', biome: M, radius: 2.6, min: 8, max: 18, maxTilt: 28, wald: [true, 0.0, 1.25], gruppe: [14, 2, 6] }),
  flora({ name: 'Fichte1', biome: M, radius: 2.4, min: 10, max: 24, maxTilt: 30, wald: [true, 0.0, 1.30], gruppe: [14, 2, 6] }),
  flora({ name: 'Tanne1', biome: M, radius: 2.8, min: 6, max: 14, maxTilt: 28, wald: [true, 0.0, 1.25], gruppe: [12, 2, 5] }),

  // ── Schicht 3: Unterschicht (3–10 m) ───────────────────────────────
  // Jungwuchs. Er fuellt, was die grossen frei gelassen haben, und macht
  // den Bestand nach unten dicht — ohne ihn sieht man unter den Kronen
  // hindurch bis zum Horizont.
  flora({ name: 'Fichte3', biome: M, radius: 1.9, min: 10, max: 24, maxTilt: 32, wald: [true, 0.0, 1.4], gruppe: [12, 2, 6] }),
  flora({ name: 'Tanne2', biome: M, radius: 1.8, min: 8, max: 20, maxTilt: 30, wald: [true, 0.0, 1.4], gruppe: [12, 2, 6] }),
  flora({ name: 'Tanne3', biome: M, radius: 1.3, min: 10, max: 26, maxTilt: 35, wald: [true, 0.0, 1.45], gruppe: [10, 2, 7] }),
  flora({ name: 'Tanne4', biome: M, radius: 0.8, min: 12, max: 30, maxTilt: 40, wald: [true, 0.0, 1.5], gruppe: [8, 2, 8] }),
  // Ein paar Birken am Rand — ein reiner Fichtenforst wirkt gepflanzt.
  //
  // BEWUSST eine Art, die das Grasland nicht benutzt. Mehrere
  // Streueintraege je Prefab waeren an sich moeglich (Valheim fuehrt
  // `FirTree` dreifach), aber die Kuratierung arbeitet ueber den NAMEN
  // und kann zwei Eintraege desselben Prefabs nicht unterscheiden —
  // beide wuerden greifen.
  flora({ name: 'BirkeDicht1', biome: M, radius: 2.0, min: 1, max: 5, maxTilt: 30, wald: [true, 1.0, 1.4], gruppe: [12, 2, 4] }),

  // ── Schicht 4: Felsen ──────────────────────────────────────────────
  // Sie gehoeren in den Wald wie das Laub: In den Vorbildern liegt in
  // fast jeder Senke ein moosiger Buckel.
  flora({ name: 'Felsplatte2', biome: M, radius: 4.5, min: 0, max: 3, maxTilt: 25, wald: [true, 0.0, 1.6], scaleMin: 0.8, scaleMax: 1.3, kippen: 6 }),
  flora({ name: 'Felsblock2', biome: M, radius: 3.2, min: 0, max: 2, maxTilt: 26, wald: [true, 0.0, 1.5], scaleMin: 0.8, scaleMax: 1.3, kippen: 5 }),
  flora({ name: 'Findling2', biome: M, radius: 3.0, min: 0, max: 3, maxTilt: 28, wald: [true, 0.0, 1.6], scaleMin: 0.8, scaleMax: 1.3, kippen: 6 }),
  flora({ name: 'Felsplatte1', biome: M, radius: 2.5, min: 1, max: 5, maxTilt: 30, wald: [true, 0.0, 1.7], scaleMin: 0.8, scaleMax: 1.4, kippen: 8 }),
  flora({ name: 'Findling1', biome: M, radius: 1.8, min: 1, max: 5, maxTilt: 35, wald: [true, 0.0, 1.8], scaleMin: 0.7, scaleMax: 1.4, kippen: 9 }),

  // ── Schicht 5: Strauch- und Krautschicht ───────────────────────────
  // Zuletzt, weil sie in jede verbliebene Luecke passt. Farn und
  // Heidelbeere sind die Bodendecker des Nadelwaldes; Wiesenblumen
  // wachsen unter geschlossenem Kronendach nicht.
  flora({ name: 'Wacholder2', biome: M, radius: 1.8, min: 2, max: 7, maxTilt: 40, wald: [false, 1.2, 2.2], kippen: 3 }),
  flora({ name: 'Farn2', biome: M, radius: 1.0, min: 8, max: 20, maxTilt: 35, wald: [true, 0.0, 1.4], gruppe: [7, 2, 6], kippen: 5 }),
  flora({ name: 'Farn1', biome: M, radius: 0.8, min: 9, max: 22, maxTilt: 38, wald: [true, 0.0, 1.45], gruppe: [6, 2, 7], kippen: 6 }),
  flora({ name: 'Heidelbeere2', biome: M, radius: 0.9, min: 6, max: 16, maxTilt: 35, wald: [true, 0.0, 1.4], gruppe: [6, 2, 6], kippen: 5 }),
  flora({ name: 'Heidelbeere3', biome: M, radius: 1.0, min: 4, max: 12, maxTilt: 32, wald: [true, 0.0, 1.35], gruppe: [6, 2, 5], kippen: 4 }),
  flora({ name: 'Heidekraut2', biome: M, radius: 0.9, min: 3, max: 11, maxTilt: 32, wald: [false, 1.25, 5], gruppe: [6, 2, 6], kippen: 5 }),
  flora({ name: 'Seggen1', biome: M, radius: 0.8, min: 2, max: 8, maxTilt: 30, wald: [true, 0.9, 1.4], gruppe: [5, 2, 5], kippen: 4 }),
];

/** Alle eigenen Flora-Einträge, die an FOLIAGE angehängt werden. */
export const EIGENE_FLORA: readonly Foliage[] = [
  ...GRASLAND_FLORA,
  // Nur die Arten, die das Grasland nicht schon beigesteuert hat —
  // ein Prefab darf in FOLIAGE nur EINMAL vorkommen, sonst streut der
  // ZoneManager es doppelt.
  ...NADELWALD_FLORA.filter(
    (n) => !GRASLAND_FLORA.some((g) => g.prefabName === n.prefabName)
  ),
];

/**
 * Schnelltest im Streudurchlauf: Ist dieser Eintrag eigener Bau?
 *
 * Der ZoneManager braucht ihn, um eigene Flora nur dort wachsen zu
 * lassen, wo eine Region sie ausdrücklich kuratiert — sonst ginge sie
 * auf jeder Graslandinsel zusätzlich zu den Originalbäumen auf.
 */
export const EIGENE_FLORA_HASHES: ReadonlySet<number> = new Set(
  EIGENE_FLORA.map((f) => f.prefabHash)
);

/**
 * Namensliste für die Kuratierung einer Region (RegionDef.vegetation).
 *
 * Der Editor trägt sie mit einem Knopf ein. Als Liste und nicht als
 * Schalter, weil `RegionDef.vegetation` schon so definiert ist: exakt
 * diese Einträge, nichts anderes — damit auf einer Graslandinsel keine
 * Valheim-Fichte mehr auftaucht.
 */
export const GRASLAND_FLORA_NAMEN: readonly string[] = GRASLAND_FLORA.map((f) => f.prefabName);

/** Dasselbe für den Nadelwald. */
export const NADELWALD_FLORA_NAMEN: readonly string[] = NADELWALD_FLORA.map((f) => f.prefabName);
