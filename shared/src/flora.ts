/**
 * Eigene Flora — Streuparameter für die selbst gebauten Pflanzen.
 *
 * `shared/src/vegetation.ts` las bis Block A die 120 Einträge aus Valheims
 * `vegetation.pkg`. Dort standen ausschliesslich Original-Prefabs; unsere
 * prozeduralen Bäume, Sträucher und Bodenpflanzen (tools/baeume-bauen.sh,
 * tools/buesche-bauen.sh, tools/blumen-bauen.sh) kamen darin nicht vor.
 *
 * Seit die Originale dort gegen `istEigenesModell()` herausgefiltert
 * werden, ist FOLIAGE genau das, was hier steht — diese Datei IST die
 * Streutabelle der Welt und nicht mehr ihr Anhang.
 *
 * Der ZoneManager streut über diese Liste (ZoneManager.ts:527). Ohne
 * einen Eintrag hier wird ein Modell NIE gestreut — auch dann nicht,
 * wenn es in der Kuratierungsliste einer Region steht. Wer eine Art in
 * eine der *_FLORA_NAMEN-Listen aufnimmt, braucht also IMMER auch einen
 * Streueintrag; das ist die Fehlerquelle, gegen die
 * `server/test/h4-graslandflora.ts` steht.
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
 *     Blumen     inForest false, 1.10–5.00  → überall ausserhalb
 *
 * Die Fenster überlappen sich absichtlich nur an den Rändern — so steht
 * das Gebüsch dort, wo der Wald in die Wiese übergeht.
 *
 * NACHGEPRÜFT (Block A, Schritt 15): Bei `inForest: false` wird das
 * Fenster GAR NICHT ausgewertet — streuung.ts:337 prüft den Waldfaktor
 * nur, wenn `inForest` gesetzt ist, genau wie das C++-Vorbild. Die Zahlen
 * hinter einem `false` sind damit reine Dokumentation dessen, was
 * gemeint war, und keine Regel. Wer eine Art WIRKLICH aus dem Wald
 * heraushalten will, braucht `inForest: true` mit einem Fenster am
 * oberen Ende der Skala. Die neuen Bündel schreiben deshalb `[false, 0,
 * 5]` — „keine Waldbedingung" — statt ein Fenster vorzutäuschen, das
 * niemand liest.
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

/**
 * Alle Biom-Bits auf einmal — die Maske, die JEDER eigene Eintrag trägt.
 *
 * ── Warum eigene Flora keine Biom-Maske mehr hat ─────────────────────
 * Der Streudurchlauf (shared/src/worldgen/streuung.ts) prüft je Kandidat
 * ZWEI Dinge hintereinander, und die Reihenfolge ist der ganze Punkt:
 *
 *   1. die Biom-Maske:      if ((veg.biome & biome) === 0) continue;
 *   2. das Kuratierungstor:  hat die Region eine `vegetation`-Liste,
 *      wächst genau das und sonst nichts.
 *
 * Bis hierher trugen alle 61 Einträge dieser Datei `Biome.Meadows`. Das
 * war als zweiter Riegel gedacht: Eigene Pflanzen sollten nicht auf jeder
 * Insel zusätzlich zu den Originalen aufgehen. Genau das verhindert aber
 * schon Schritt 2 — steht eine Art nicht in der Kuratierungsliste,
 * kommt sie nicht durch; hat eine Region gar keine Liste, ist eigene
 * Flora ohnehin ausgeschlossen (EIGENE_FLORA_HASHES). Der Riegel war
 * also redundant.
 *
 * Redundant und schädlich: Weil die Maske VOR dem Tor greift, fiel jede
 * Region durch, deren Biom nicht Meadows ist. Vier der Weltregionen sind
 * das — insel-2 (blackforest), insel-3 (swamp), land-1 (deepnorth),
 * insel-16 (ashlands). Sie wären nach der Umstellung auf eigene Modelle
 * VOLLSTÄNDIG KAHL geblieben, ohne Fehlermeldung, weil „nichts gewachsen"
 * im Streudurchlauf kein Fehler ist, sondern der Normalfall für jeden
 * abgelehnten Kandidaten.
 *
 * Mit allen Bits gesetzt ist die Maske durchlässig, und die
 * Kuratierungsliste ist die alleinige Autorität darüber, was wo wächst —
 * so, wie der Kommentar in streuung.ts es ohnehin behauptet.
 *
 * ── Die verworfene Alternative ───────────────────────────────────────
 * Naheliegend wäre gewesen, jeder Pflanze eine handgepflegte Biom-Liste
 * zu geben: Fichte nach BlackForest|DeepNorth, Weide nach Swamp, Margerite
 * nach Meadows und so fort. Dagegen sprechen drei Dinge:
 *
 *   • Es sind 61 Zuweisungen, und bei jeder neuen Pflanze kommt eine
 *     weitere dazu — eine Pflegelast, die nie aufhört.
 *   • Sie bildet die Kuratierung ein zweites Mal nach, nur gröber: Die
 *     Liste einer Region nennt ARTEN, die Maske nur BIOME. Wer im
 *     Editor eine Fichte auf eine Graslandinsel setzen will, müsste
 *     dafür den Quelltext ändern.
 *   • Sie kann der Kuratierung widersprechen. Zwei Wahrheiten über
 *     dieselbe Frage, von denen die stillere (die Maske) gewinnt — genau
 *     die Konstellation, aus der die vier kahlen Regionen entstanden
 *     sind.
 *
 * `-1` oder eine nackte Zahl täte dasselbe, sagt aber nicht, was sie
 * meint; deshalb die benannte Konstante aus den Bits von `Biome`.
 * Ocean steht bewusst mit drin: Was im Wasser nicht wachsen soll, hält
 * `minAltitude` (0,5 m über der Wasserlinie) auf, nicht die Biom-Maske.
 */
export const ALLE_BIOME: number =
  Biome.Meadows |
  Biome.Swamp |
  Biome.Mountain |
  Biome.BlackForest |
  Biome.Plains |
  Biome.AshLands |
  Biome.DeepNorth |
  Biome.Ocean |
  Biome.Mistlands;

type FloraKurz = {
  readonly name: string;
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
    // Kein Parameter: Eigene Flora wächst in jedem Biom durch die Maske,
    // die Kuratierung entscheidet allein (siehe ALLE_BIOME oben).
    biome: ALLE_BIOME,
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
  flora({ name: 'Eiche1', radius: 8, min: 1, max: 3, maxTilt: 20, wald: [true, 0.9, 1.3] }),
  flora({ name: 'Eiche2', radius: 7, min: 1, max: 3, maxTilt: 22, wald: [true, 0.9, 1.3] }),
  flora({ name: 'Eiche3', radius: 9, min: 0, max: 2, maxTilt: 18, wald: [true, 1.0, 1.4] }),
  // Birken tragen den Wald: viele, in Gruppen, mit kleinem Abstand.
  flora({ name: 'BirkeHoch2', radius: 3.2, min: 12, max: 30, maxTilt: 28, wald: [true, 0.0, 1.15], gruppe: [12, 2, 5] }),
  flora({ name: 'BirkeHoch3', radius: 4.0, min: 8, max: 20, maxTilt: 26, wald: [true, 0.0, 1.15], gruppe: [12, 2, 4] }),
  flora({ name: 'BirkeDicht2', radius: 3.6, min: 9, max: 24, maxTilt: 28, wald: [true, 0.0, 1.1], gruppe: [10, 2, 4] }),
  // Jungwuchs am Waldrand — die kleinen Stufen, damit der Wald nicht aus
  // lauter gleich alten Bäumen besteht.
  flora({ name: 'BirkeHoch1', radius: 2.0, min: 10, max: 26, maxTilt: 32, wald: [true, 0.85, 1.25], gruppe: [8, 2, 5] }),

  // Die grossen Laubbäume — dieselbe Überlegung wie im Nadelwald, nur
  // dass hier die Krone die Sicht nimmt und nicht der Stamm.
  flora({ name: 'Eiche4', radius: 11, min: 0, max: 2, maxTilt: 18, wald: [true, 0.9, 1.35] }),
  flora({ name: 'BirkeHoch4', radius: 4.4, min: 2, max: 7, maxTilt: 26, wald: [true, 0.0, 1.2], gruppe: [14, 2, 4] }),

  // ── Felsen ─────────────────────────────────────────────────────────
  // Auf der offenen Wiese liegen sie einzeln — ein Findling im Gras ist
  // ein Blickpunkt und eine Wegmarke.
  flora({ name: 'Findling2', radius: 3.2, min: 0, max: 2, maxTilt: 22, wald: [false, 0.9, 5], scaleMin: 0.8, scaleMax: 1.4, kippen: 6 }),
  flora({ name: 'Findling1', radius: 1.8, min: 1, max: 4, maxTilt: 30, wald: [false, 0.9, 5], scaleMin: 0.7, scaleMax: 1.4, kippen: 9 }),
  flora({ name: 'Felsplatte1', radius: 2.6, min: 0, max: 3, maxTilt: 26, wald: [false, 0.9, 5], scaleMin: 0.8, scaleMax: 1.5, kippen: 8 }),
  flora({ name: 'Steinbank1', radius: 3.0, min: 0, max: 2, maxTilt: 24, wald: [false, 1.0, 5], scaleMin: 0.8, scaleMax: 1.3, kippen: 5 }),

  // ── Sträucher ──────────────────────────────────────────────────────
  // Am Waldrand (Fenster 0.9–1.3), wo Bäume aufhören und Wiese anfängt.
  flora({ name: 'Hasel2', radius: 2.4, min: 3, max: 8, maxTilt: 35, wald: [true, 0.9, 1.3], gruppe: [10, 2, 4] }),
  flora({ name: 'Hasel3', radius: 3.0, min: 1, max: 4, maxTilt: 32, wald: [true, 0.9, 1.25] }),
  flora({ name: 'Schlehe1', radius: 2.2, min: 2, max: 7, maxTilt: 38, wald: [true, 0.95, 1.35], gruppe: [9, 2, 5] }),
  flora({ name: 'Schlehe2', radius: 2.8, min: 1, max: 4, maxTilt: 35, wald: [true, 0.95, 1.3] }),
  flora({ name: 'Hartriegel1', radius: 2.0, min: 2, max: 6, maxTilt: 38, wald: [true, 0.9, 1.35], gruppe: [8, 2, 4] }),
  flora({ name: 'Holunder2', radius: 2.6, min: 0, max: 3, maxTilt: 32, wald: [true, 0.9, 1.25] }),
  // Brombeere und Wacholder wachsen auch im Offenen — flaches Gestrüpp
  // braucht kein Kronendach.
  flora({ name: 'Brombeere2', radius: 1.6, min: 4, max: 12, maxTilt: 45, wald: [false, 0.9, 1.6], gruppe: [7, 2, 6], kippen: 4 }),
  flora({ name: 'Brombeere1', radius: 1.2, min: 4, max: 14, maxTilt: 50, wald: [false, 0.9, 1.8], gruppe: [6, 2, 6], kippen: 5 }),
  flora({ name: 'Wacholder2', radius: 1.8, min: 1, max: 5, maxTilt: 40, wald: [false, 1.1, 2.0], kippen: 3 }),

  // ── Bodenpflanzen ──────────────────────────────────────────────────
  // NUR auf der offenen Wiese (inForest false, Fenster ab 1.1) und in
  // Gruppen: Blumen stehen in Horsten, nicht gleichverteilt. Die Zahlen
  // sind bewusst hoch — ein Horst kostet 18 bis 40 Dreiecke.
  flora({ name: 'Margerite2', radius: 1.1, min: 6, max: 14, maxTilt: 25, wald: [false, 1.1, 5], gruppe: [6, 2, 5], kippen: 5 }),
  flora({ name: 'Margerite1', radius: 0.8, min: 6, max: 16, maxTilt: 28, wald: [false, 1.1, 5], gruppe: [5, 2, 6], kippen: 6 }),
  flora({ name: 'Glockenblume2', radius: 1.0, min: 4, max: 12, maxTilt: 25, wald: [false, 1.15, 5], gruppe: [5, 2, 5], kippen: 5 }),
  flora({ name: 'Trollblume2', radius: 1.0, min: 3, max: 9, maxTilt: 22, wald: [false, 1.2, 5], gruppe: [5, 2, 4], kippen: 5 }),
  flora({ name: 'Schafgarbe1', radius: 0.9, min: 5, max: 13, maxTilt: 28, wald: [false, 1.1, 5], gruppe: [5, 2, 5], kippen: 6 }),
  // Unkraut steht dort, wo der Boden gestört ist — hier vertreten durch
  // den Übergangsbereich zum Waldrand.
  flora({ name: 'Brennnessel1', radius: 1.3, min: 2, max: 8, maxTilt: 35, wald: [true, 0.95, 1.4], gruppe: [6, 2, 5], kippen: 4 }),
  flora({ name: 'Distel1', radius: 1.0, min: 2, max: 7, maxTilt: 32, wald: [false, 1.05, 5], gruppe: [5, 1, 4], kippen: 5 }),
  flora({ name: 'Ampfer1', radius: 0.9, min: 3, max: 9, maxTilt: 30, wald: [false, 1.05, 5], gruppe: [5, 1, 4], kippen: 5 }),
  flora({ name: 'Seggen1', radius: 0.8, min: 5, max: 14, maxTilt: 30, wald: [false, 1.0, 5], gruppe: [5, 2, 6], kippen: 4 }),
  // Farn braucht Schatten — als einzige Bodenpflanze im Wald.
  flora({ name: 'Farn2', radius: 1.2, min: 4, max: 11, maxTilt: 35, wald: [true, 0.0, 1.2], gruppe: [7, 2, 5], kippen: 5 }),
  flora({ name: 'Farn1', radius: 0.9, min: 4, max: 12, maxTilt: 38, wald: [true, 0.0, 1.25], gruppe: [6, 2, 6], kippen: 6 }),
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
  flora({ name: 'Kiefer4', radius: 9.0, min: 1, max: 3, maxTilt: 24, wald: [true, 0.0, 0.90] }),
  flora({ name: 'Fichte6', radius: 5.0, min: 2, max: 5, maxTilt: 26, wald: [true, 0.0, 0.95], gruppe: [16, 1, 3] }),
  flora({ name: 'Tanne7', radius: 6.0, min: 1, max: 4, maxTilt: 26, wald: [true, 0.0, 0.95], gruppe: [16, 1, 3] }),
  flora({ name: 'Fichte5', radius: 4.2, min: 3, max: 8, maxTilt: 28, wald: [true, 0.0, 1.05], gruppe: [14, 2, 4] }),
  flora({ name: 'Fichte4', radius: 4.0, min: 4, max: 10, maxTilt: 28, wald: [true, 0.0, 1.10], gruppe: [14, 2, 5] }),
  flora({ name: 'Kiefer2', radius: 6.5, min: 1, max: 4, maxTilt: 26, wald: [true, 0.0, 1.00] }),
  flora({ name: 'Kiefer1', radius: 5.5, min: 2, max: 5, maxTilt: 30, wald: [true, 0.0, 1.10] }),

  // ── Schicht 2: Hauptbestand (10–18 m) ──────────────────────────────
  // Er traegt den Wald. Die Kronen sollen sich beruehren, deshalb ein
  // Radius knapp unter dem Kronenradius — vollstaendig ueberlappungsfrei
  // waere ein Park, kein Bestand.
  flora({ name: 'Tanne5', radius: 3.4, min: 4, max: 11, maxTilt: 28, wald: [true, 0.0, 1.25], gruppe: [14, 2, 5] }),
  flora({ name: 'Fichte2', radius: 2.6, min: 8, max: 18, maxTilt: 28, wald: [true, 0.0, 1.25], gruppe: [14, 2, 6] }),
  flora({ name: 'Fichte1', radius: 2.4, min: 10, max: 24, maxTilt: 30, wald: [true, 0.0, 1.30], gruppe: [14, 2, 6] }),
  flora({ name: 'Tanne1', radius: 2.8, min: 6, max: 14, maxTilt: 28, wald: [true, 0.0, 1.25], gruppe: [12, 2, 5] }),

  // ── Schicht 3: Unterschicht (3–10 m) ───────────────────────────────
  // Jungwuchs. Er fuellt, was die grossen frei gelassen haben, und macht
  // den Bestand nach unten dicht — ohne ihn sieht man unter den Kronen
  // hindurch bis zum Horizont.
  flora({ name: 'Fichte3', radius: 1.9, min: 10, max: 24, maxTilt: 32, wald: [true, 0.0, 1.4], gruppe: [12, 2, 6] }),
  flora({ name: 'Tanne2', radius: 1.8, min: 8, max: 20, maxTilt: 30, wald: [true, 0.0, 1.4], gruppe: [12, 2, 6] }),
  flora({ name: 'Tanne3', radius: 1.3, min: 10, max: 26, maxTilt: 35, wald: [true, 0.0, 1.45], gruppe: [10, 2, 7] }),
  flora({ name: 'Tanne4', radius: 0.8, min: 12, max: 30, maxTilt: 40, wald: [true, 0.0, 1.5], gruppe: [8, 2, 8] }),
  // Ein paar Birken am Rand — ein reiner Fichtenforst wirkt gepflanzt.
  //
  // BEWUSST eine Art, die das Grasland nicht benutzt. Mehrere
  // Streueintraege je Prefab waeren an sich moeglich (Valheim fuehrt
  // `FirTree` dreifach), aber die Kuratierung arbeitet ueber den NAMEN
  // und kann zwei Eintraege desselben Prefabs nicht unterscheiden —
  // beide wuerden greifen.
  flora({ name: 'BirkeDicht1', radius: 2.0, min: 1, max: 5, maxTilt: 30, wald: [true, 1.0, 1.4], gruppe: [12, 2, 4] }),

  // ── Schicht 4: Felsen ──────────────────────────────────────────────
  // Sie gehoeren in den Wald wie das Laub: In den Vorbildern liegt in
  // fast jeder Senke ein moosiger Buckel.
  flora({ name: 'Felsplatte2', radius: 4.5, min: 0, max: 3, maxTilt: 25, wald: [true, 0.0, 1.6], scaleMin: 0.8, scaleMax: 1.3, kippen: 6 }),
  flora({ name: 'Felsblock2', radius: 3.2, min: 0, max: 2, maxTilt: 26, wald: [true, 0.0, 1.5], scaleMin: 0.8, scaleMax: 1.3, kippen: 5 }),
  flora({ name: 'Findling2', radius: 3.0, min: 0, max: 3, maxTilt: 28, wald: [true, 0.0, 1.6], scaleMin: 0.8, scaleMax: 1.3, kippen: 6 }),
  flora({ name: 'Felsplatte1', radius: 2.5, min: 1, max: 5, maxTilt: 30, wald: [true, 0.0, 1.7], scaleMin: 0.8, scaleMax: 1.4, kippen: 8 }),
  flora({ name: 'Findling1', radius: 1.8, min: 1, max: 5, maxTilt: 35, wald: [true, 0.0, 1.8], scaleMin: 0.7, scaleMax: 1.4, kippen: 9 }),

  // ── Schicht 5: Strauch- und Krautschicht ───────────────────────────
  // Zuletzt, weil sie in jede verbliebene Luecke passt. Farn und
  // Heidelbeere sind die Bodendecker des Nadelwaldes; Wiesenblumen
  // wachsen unter geschlossenem Kronendach nicht.
  flora({ name: 'Wacholder2', radius: 1.8, min: 2, max: 7, maxTilt: 40, wald: [false, 1.2, 2.2], kippen: 3 }),
  flora({ name: 'Farn2', radius: 1.0, min: 8, max: 20, maxTilt: 35, wald: [true, 0.0, 1.4], gruppe: [7, 2, 6], kippen: 5 }),
  flora({ name: 'Farn1', radius: 0.8, min: 9, max: 22, maxTilt: 38, wald: [true, 0.0, 1.45], gruppe: [6, 2, 7], kippen: 6 }),
  flora({ name: 'Heidelbeere2', radius: 0.9, min: 6, max: 16, maxTilt: 35, wald: [true, 0.0, 1.4], gruppe: [6, 2, 6], kippen: 5 }),
  flora({ name: 'Heidelbeere3', radius: 1.0, min: 4, max: 12, maxTilt: 32, wald: [true, 0.0, 1.35], gruppe: [6, 2, 5], kippen: 4 }),
  flora({ name: 'Heidekraut2', radius: 0.9, min: 3, max: 11, maxTilt: 32, wald: [false, 1.25, 5], gruppe: [6, 2, 6], kippen: 5 }),
  flora({ name: 'Seggen1', radius: 0.8, min: 2, max: 8, maxTilt: 30, wald: [true, 0.9, 1.4], gruppe: [5, 2, 5], kippen: 4 }),
];

/**
 * Der Sumpf — nass, schattig, niedrig.
 *
 * Die Rolle dieses Bioms in der Welt (insel-3) ist der unwegsame Ort:
 * kein Fernblick, kein trockener Fuss, und alles steht dicht. Das
 * unterscheidet ihn vom Nadelwald, der ebenfalls dunkel ist, aber
 * begehbar — im Wald nimmt das KRONENDACH das Licht, im Sumpf nimmt der
 * BODEN den Weg.
 *
 * Warum diese Arten: Die Moorbirke (BirkeDicht3/4) ist der Baum der
 * nordeuropäischen Moore — schlank, licht, in lockeren Beständen; ein
 * Hochwald wäre hier falsch, deshalb keine Fichte und keine Eiche.
 * Darunter das Weidengebüsch (Weide1–3, gemessene 1,5–3,4 m: Strauch,
 * nicht Baum), das die Sicht auf Kopfhöhe nimmt. Der Boden gehört Segge
 * und Wollgras — beides Sauergräser, die im Stehwasser wachsen und die
 * hellen Fruchtschöpfe des Wollgrases sind das einzige Helle im Bild.
 * Farn und Brennnessel füllen die feuchten Halbschatten dazwischen.
 *
 * Die niedrigen `maxTilt`-Werte sind Absicht und tragen mehr als sie
 * aussehen: Sumpfarten wachsen nur im FLACHEN. Damit bleiben die Hänge
 * einer Sumpfinsel frei, und der Bewuchs zeichnet von selbst nach, wo
 * das Wasser steht.
 *
 * Wiederverwendete Arten (Seggen1, Farn1/2, Brennnessel1) behalten ihre
 * Grasland-Zahlen — ein Prefab hat GENAU EINEN Streueintrag (siehe
 * EIGENE_FLORA). Wo der Sumpf dichter stehen soll als die Wiese, steht
 * deshalb die grössere Schwesterart mit eigenen Zahlen daneben
 * (Seggen2, Brennnessel2, Ampfer2) statt dass der Grasland-Eintrag
 * verstellt würde: Das Grasland mitzuverändern wäre der teuerste
 * denkbare Nebeneffekt einer Sumpfliste.
 */
export const SUMPF_FLORA: readonly Foliage[] = [
  // ── Baumschicht: Moorbirke, licht ──────────────────────────────────
  // Zuerst, aus demselben Grund wie im Nadelwald: Die Streuung arbeitet
  // FOLIAGE der Reihe nach ab, und wer zuerst kommt, bekommt den Platz.
  flora({ name: 'BirkeDicht4', radius: 5.0, min: 0, max: 3, maxTilt: 16, wald: [true, 0.0, 1.35], gruppe: [16, 1, 3] }),
  flora({ name: 'BirkeDicht3', radius: 3.4, min: 4, max: 12, maxTilt: 18, wald: [true, 0.0, 1.45], gruppe: [12, 2, 5] }),

  // ── Strauchschicht: Weidengebüsch ──────────────────────────────────
  // `inForest: false` — Weiden stehen gerade NICHT unter den Birken,
  // sondern auf den offenen nassen Flächen dazwischen. In Gruppen, weil
  // Weiden aus einem Wurzelstock heraus buschig treiben.
  flora({ name: 'Weide3', radius: 2.0, min: 4, max: 12, maxTilt: 24, wald: [false, 0.0, 5], gruppe: [10, 2, 5], kippen: 4 }),
  flora({ name: 'Weide2', radius: 1.4, min: 6, max: 18, maxTilt: 28, wald: [false, 0.0, 5], gruppe: [8, 2, 6], kippen: 5 }),
  flora({ name: 'Weide1', radius: 1.0, min: 8, max: 22, maxTilt: 32, wald: [false, 0.0, 5], gruppe: [7, 2, 7], kippen: 6 }),

  // ── Krautschicht: Sauergräser ──────────────────────────────────────
  // Der eigentliche Sumpfboden. Die höchsten Stückzahlen der ganzen
  // Datei — eine Seggenfläche ist geschlossen, nicht getupft. Möglich
  // wird das über den kleinen `radius`: Halme dürfen dicht stehen.
  flora({ name: 'Seggen2', radius: 0.7, min: 14, max: 34, maxTilt: 25, wald: [false, 0.0, 5], gruppe: [6, 3, 8], kippen: 4 }),
  flora({ name: 'Seggen1', radius: 0.8, min: 5, max: 14, maxTilt: 30, wald: [false, 1.0, 5], gruppe: [5, 2, 6], kippen: 4 }),
  flora({ name: 'Wollgras2', radius: 0.8, min: 8, max: 20, maxTilt: 18, wald: [false, 0.0, 5], gruppe: [6, 2, 7], kippen: 5 }),
  flora({ name: 'Wollgras1', radius: 0.6, min: 8, max: 24, maxTilt: 16, wald: [false, 0.0, 5], gruppe: [5, 3, 8], kippen: 6 }),

  // ── Halbschatten: Farn, Brennnessel, Ampfer ────────────────────────
  // Sie stehen dort, wo Birkenschatten und nasser Boden zusammenkommen.
  // Brennnessel2 und Ampfer2 sind die grossen Formen — im Sumpf wächst
  // Unkraut höher als auf der Wiese, weil ihm nichts das Wasser nimmt.
  flora({ name: 'Farn2', radius: 1.2, min: 4, max: 11, maxTilt: 35, wald: [true, 0.0, 1.2], gruppe: [7, 2, 5], kippen: 5 }),
  flora({ name: 'Farn1', radius: 0.9, min: 4, max: 12, maxTilt: 38, wald: [true, 0.0, 1.25], gruppe: [6, 2, 6], kippen: 6 }),
  flora({ name: 'Brennnessel2', radius: 1.1, min: 5, max: 14, maxTilt: 30, wald: [false, 0.0, 5], gruppe: [7, 2, 6], kippen: 4 }),
  flora({ name: 'Brennnessel1', radius: 1.3, min: 2, max: 8, maxTilt: 35, wald: [true, 0.95, 1.4], gruppe: [6, 2, 5], kippen: 4 }),
  flora({ name: 'Ampfer2', radius: 0.9, min: 4, max: 12, maxTilt: 28, wald: [false, 0.0, 5], gruppe: [6, 2, 5], kippen: 5 }),
];

/**
 * Der Hohe Norden — karg.
 *
 * Die Rolle dieses Bioms (land-1) ist die Weite. Was den Hohen Norden
 * ausmacht, ist nicht, was dort wächst, sondern WIE WENIG: Man sieht
 * über das Land hinweg, und ein einzelner Baum ist von weit her eine
 * Wegmarke. Deshalb sind die Stückzahlen die niedrigsten der Datei und
 * die Radien die grössten — jede andere Einstellung machte daraus einen
 * Nadelwald mit anderer Beschriftung.
 *
 * Warum diese Arten: An der Waldgrenze bleiben genau drei Wuchsformen
 * übrig. Erstens einzelne alte Nadelbäume (Kiefer3 mit 26 m, Tanne6 mit
 * 20 m) — nicht ihre Setzlinge, denn in der Kältesteppe steht, was alt
 * geworden ist, nicht was gerade keimt. Zweitens Wacholder, das
 * windgeschorene Polster, das noch dort liegt, wo kein Baum mehr steht.
 * Drittens Heidekraut als Bodendecker. Alles drei ist bewusst NIEDRIG
 * ausser den Bäumen: Über Kniehöhe hält der Wind nichts.
 *
 * Dazu Fels, und der trägt hier mehr als Dekoration — auf einer Fläche
 * fast ohne Bewuchs sind Findling und Felsnadel das Einzige, woran das
 * Auge Entfernung misst.
 *
 * Ausschliesslich Arten, die kein anderes Bündel benutzt. Damit greifen
 * die Zahlen hier auch wirklich (siehe EIGENE_FLORA: erster Eintrag
 * eines Prefabs gewinnt) — bei einem Biom, das über die Stückzahl
 * definiert ist, wäre alles andere sinnlos.
 */
export const HOCHNORD_FLORA: readonly Foliage[] = [
  // ── Die letzten Bäume ──────────────────────────────────────────────
  // `min: 0` heisst: In den meisten Zonen steht keiner. Das ist der
  // Unterschied zwischen „lichter Wald" und „Baumgrenze".
  flora({ name: 'Kiefer3', radius: 10.0, min: 0, max: 2, maxTilt: 26, wald: [true, 0.0, 0.9] }),
  flora({ name: 'Tanne6', radius: 6.5, min: 0, max: 3, maxTilt: 28, wald: [true, 0.0, 1.05], gruppe: [18, 1, 3] }),

  // ── Fels ───────────────────────────────────────────────────────────
  // Vor dem Kleinbewuchs, damit die grossen Steine ihren Platz bekommen.
  flora({ name: 'Findling3', radius: 4.0, min: 0, max: 2, maxTilt: 25, wald: [false, 0.0, 5], scaleMin: 0.8, scaleMax: 1.3, kippen: 5 }),
  flora({ name: 'Felsnadel1', radius: 1.6, min: 1, max: 5, maxTilt: 35, wald: [false, 0.0, 5], scaleMin: 0.8, scaleMax: 1.5, kippen: 4 }),
  flora({ name: 'Felsblock1', radius: 1.0, min: 1, max: 5, maxTilt: 40, wald: [false, 0.0, 5], scaleMin: 0.7, scaleMax: 1.4, kippen: 9 }),

  // ── Zwergstrauchheide ──────────────────────────────────────────────
  // Der einzige flächige Bewuchs des Bioms, und auch der bleibt fleckig:
  // kleine Gruppen mit engem Gruppenradius statt Teppich.
  //
  // Die Zahlen sind ZWEIMAL heruntergesetzt worden. Der erste Ansatz
  // (Heidekraut1 min 6/max 18 in Gruppen zu 3–8) ergab gemessen 2.250
  // Polster auf der Probeinsel und damit einen Hohen Norden, der auf
  // 57 % des Graslandbewuchses kam — eine Heide, keine Kältesteppe. Der
  // Fehler steckte nicht in `min`/`max`, sondern in der GRUPPENGRÖSSE:
  // Sie multipliziert die Stückzahl, und das fällt beim Lesen der Zeile
  // nicht auf. Jetzt sind es rund 4 Polster je Zone.
  flora({ name: 'Wacholder3', radius: 2.2, min: 1, max: 5, maxTilt: 40, wald: [false, 0.0, 5], gruppe: [8, 1, 3], kippen: 4 }),
  flora({ name: 'Wacholder1', radius: 0.9, min: 2, max: 6, maxTilt: 45, wald: [false, 0.0, 5], gruppe: [6, 1, 4], kippen: 5 }),
  flora({ name: 'Heidekraut3', radius: 0.7, min: 2, max: 8, maxTilt: 38, wald: [false, 0.0, 5], gruppe: [6, 2, 5], kippen: 5 }),
  flora({ name: 'Heidekraut1', radius: 0.5, min: 3, max: 10, maxTilt: 42, wald: [false, 0.0, 5], gruppe: [5, 2, 5], kippen: 6 }),
];

/**
 * Die Aschewüste — LEER, und das ist die Antwort, nicht ihr Fehlen.
 *
 * insel-16 ist Asche: kein Boden, keine Feuchte, kein Licht ausser dem
 * der Glut. Botanisch wäre alles falsch, was wir haben — der gesamte
 * Bestand unter assets/models ist mitteleuropäisch-nordisch und GRÜN.
 * Eine Birke in der Aschewüste sähe nicht karg aus, sondern versehentlich
 * hingestellt, und ein Wacholderpolster auf Schlacke wäre die
 * Verlegenheitslösung, die diese leere Liste vermeidet.
 *
 * Auch der Fels hilft nicht aus: Findling, Felsplatte und Steinbank sind
 * abgerundete Granitformen aus tools/felsen-generieren.py, gebaut für
 * Wiese und Wald. Eine Aschewüste braucht Scherbe und Säule, keinen
 * geschliffenen Buckel. Felsnadel1/2 kämen dem am nächsten — sie stehen
 * hier trotzdem nicht, weil sie schon den Hohen Norden tragen und
 * dieselbe Form in beiden Biomen die Unterscheidung einebnete.
 *
 * WICHTIG für den Editor: Eine leere Liste ist NICHT dasselbe wie ein
 * fehlendes Feld. Fehlt `vegetation`, gilt die Biom-Standardtabelle;
 * steht `[]` da, wächst garantiert nichts (streuung.ts, Kuratierungstor).
 * Genau diese Garantie ist hier gewollt — nackter Aschegrund ist der
 * Entwurf, nicht eine noch nicht gefüllte Liste.
 *
 * Was das ändern würde: verkohlte Stümpfe, Basaltsäulen, Schlackebrocken
 * aus tools/felsen-generieren.py mit eigener Textur. Kommen die, kommen
 * hier Einträge hin — bis dahin ist die ehrliche Zahl null.
 */
export const ASCHE_FLORA: readonly Foliage[] = [];

/**
 * Die Bündel in FOLIAGE-Reihenfolge.
 *
 * Die Reihenfolge ist Streu-Vorrecht: Der Durchlauf arbeitet FOLIAGE von
 * vorn nach hinten ab und prüft jeden Kandidaten gegen die schon
 * belegten Flächen. Grasland zuerst, weil es das grösste Bündel ist und
 * seine Zahlen die längste Messgeschichte haben.
 */
const BUENDEL: readonly (readonly Foliage[])[] = [
  GRASLAND_FLORA,
  NADELWALD_FLORA,
  SUMPF_FLORA,
  HOCHNORD_FLORA,
  ASCHE_FLORA,
];

/**
 * Alle eigenen Flora-Einträge — seit Block A IST das die Streutabelle.
 *
 * Ein Prefab darf in FOLIAGE nur EINMAL vorkommen, sonst streut der
 * ZoneManager es doppelt. Beim ersten Bündel, das eine Art nennt,
 * gewinnen dessen Zahlen; alle späteren Nennungen derselben Art werden
 * hier verworfen. Für die Kuratierung ist das folgenlos — sie arbeitet
 * über NAMEN, und ein Name darf in beliebig vielen *_FLORA_NAMEN-Listen
 * stehen. Folgen hat es nur für die ZAHLEN: Wer eine Art in einem
 * zweiten Biom anders gestreut haben will, nimmt dort die
 * Schwesterart (Seggen2 statt Seggen1), statt den ersten Eintrag zu
 * verstellen.
 */
export const EIGENE_FLORA: readonly Foliage[] = (() => {
  const liste: Foliage[] = [];
  const gesehen = new Set<string>();
  for (const buendel of BUENDEL) {
    for (const eintrag of buendel) {
      if (gesehen.has(eintrag.prefabName)) continue;
      gesehen.add(eintrag.prefabName);
      liste.push(eintrag);
    }
  }
  return liste;
})();

/**
 * Schnelltest im Streudurchlauf: Ist dieser Eintrag eigener Bau?
 *
 * Der ZoneManager braucht ihn, um eigene Flora nur dort wachsen zu
 * lassen, wo eine Region sie ausdrücklich kuratiert.
 *
 * Seit die Originaleinträge aus FOLIAGE heraus sind, ist die Menge
 * deckungsgleich mit FOLIAGE selbst — der Test beantwortet also
 * praktisch immer „ja". Er bleibt trotzdem stehen, und zwar als
 * BEDEUTUNG, nicht als Filter: Er ist die Stelle, an der steht „ohne
 * Bestellung wächst hier nichts". Ihn wegzulassen hiesse, dieselbe
 * Regel implizit aus einer leeren Tabelle folgen zu lassen — und die
 * wäre wieder gefüllt, sobald jemand einen Fremdeintrag ergänzt.
 */
export const EIGENE_FLORA_HASHES: ReadonlySet<number> = new Set(
  EIGENE_FLORA.map((f) => f.prefabHash)
);

/**
 * Namensliste für die Kuratierung einer Region (RegionDef.vegetation).
 *
 * Der Editor trägt sie mit einem Knopf ein. Als Liste und nicht als
 * Schalter, weil `RegionDef.vegetation` schon so definiert ist: exakt
 * diese Einträge, nichts anderes.
 *
 * Seit die Biom-Maske durchlässig ist (ALLE_BIOME oben), sind diese
 * Listen die EINZIGE Stelle, an der steht, was wo wächst. Eine Region
 * ohne Liste bleibt kahl — nicht als Fehler, sondern weil es keine
 * Standardtabelle mehr gibt, aus der sie sich bedienen könnte.
 */
export const GRASLAND_FLORA_NAMEN: readonly string[] = GRASLAND_FLORA.map((f) => f.prefabName);

/**
 * Dasselbe für den Nadelwald — und zugleich die Liste des Bioms
 * `blackforest` (insel-2). Ein eigenes Bündel bekommt der Schwarzwald
 * nicht: „Nadelwald" IST seine Landschaftsform, und zwei Listen mit
 * demselben Inhalt liefen nach der ersten Änderung auseinander.
 */
export const NADELWALD_FLORA_NAMEN: readonly string[] = NADELWALD_FLORA.map((f) => f.prefabName);

/** Der Sumpf (insel-3). */
export const SUMPF_FLORA_NAMEN: readonly string[] = SUMPF_FLORA.map((f) => f.prefabName);

/** Der Hohe Norden (land-1). */
export const HOCHNORD_FLORA_NAMEN: readonly string[] = HOCHNORD_FLORA.map((f) => f.prefabName);

/** Die Aschewüste (insel-16) — leer, siehe ASCHE_FLORA. */
export const ASCHE_FLORA_NAMEN: readonly string[] = ASCHE_FLORA.map((f) => f.prefabName);
