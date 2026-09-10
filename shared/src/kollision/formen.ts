/**
 * formen.ts — aus Modellgeometrie wird eine {@link KollisionsForm}.
 *
 * Die EINE Stelle, an der diese Entscheidung fällt. Vorher stand sie im
 * Client (`client/src/engine/Physics.ts`, `deriveCollider` und
 * `buildMeshCollider`, plus die Auswahl in `EntityManager`), und der
 * Server hatte gar keine: Er kannte die Formen nicht, weil er nie eine
 * GLB öffnet. Sobald er die Spielerbewegung gegen Hindernisse rechnet,
 * müssen beide Seiten dieselbe Form aus denselben Zahlen bekommen —
 * sonst steht der Spieler im Client vor einem Stein, durch den ihn der
 * Server hindurchzieht, und das sieht wie ein Netzfehler aus.
 *
 * ── Was hier NICHT drin ist ──────────────────────────────────────────
 * Babylon, Havok, `Mesh`, `Matrix`. Die Funktion bekommt rohe Zahlen und
 * gibt rohe Zahlen zurück; der Client baut daraus seine Havok-Shapes,
 * der Server seine eigene Abfrage.
 *
 * ── Warum kein `Math.hypot`, `pow`, `atan2` ──────────────────────────
 * Gedächtnisnotiz „Portierung: Float-Vergleiche": Diese drei liefern in
 * verschiedenen Laufzeiten verschiedene Bits. Solange nur der Client
 * rechnete, war das gleichgültig; jetzt rechnen zwei Prozesse dasselbe
 * und vergleichen ihre Ergebnisse. Erlaubt sind `+ - * /`, `Math.sqrt`
 * und Vergleiche — mehr braucht es hier nicht.
 *
 * ── Das Bezugssystem ─────────────────────────────────────────────────
 * `positionen` steht LOKAL zur Instanz, in Clientkoordinaten: Babylons
 * glTF-Import klappt die x-Achse um (`__root__`, gemessen als
 * diag(−1, 1, 1, 1), s. `shared/test/kollision-glb.ts`). Wer aus einer
 * GLB liest, muss vorher spiegeln; wer Babylon-Vertexdaten hat, hat es
 * bereits.
 *
 * Derives a collision shape from raw model geometry — the one place that
 * decision is made, shared by client (Havok) and server (own query).
 */
import type { KollisionsForm, Vek3 } from './form.js';
import type { StoreKollision } from '../storeKatalog.js';
import { STORE_FELSEN_NAMEN } from '../storeFelsen.js';

/**
 * Höhenband, in dem der Stammradius gemessen wird — in Metern über dem
 * PREFAB-URSPRUNG, nicht über der Modellunterkante.
 *
 * Der Ursprung ist die Standfläche: dort sitzt das Objekt auf dem Boden.
 * Fast alle Modelle ragen darunter hinaus (Oak1 bis −1,82 m, stubbe bis
 * −2,56 m), weil Wurzeln und Stammfuss in die Erde reichen. Relativ zur
 * Unterkante gemessen lag das Band deshalb UNTER dem Boden, wo alles
 * breit ist — daher kam ein Baumstumpf auf 2,41 m „Stammradius" und eine
 * Eiche auf 2,04 m. Kniehoch bis brusthoch über dem Boden ist das, was
 * man beim Laufen tatsächlich trifft.
 */
export const STAMMBAND_MIN = 0.3;
export const STAMMBAND_MAX = 2.0;
/**
 * Percentile of the measured radii to keep. The MEDIAN, not a high
 * percentile: in the trunk band most vertices sit on the trunk itself, so
 * the median lands on it, while low branches and root flare stay in the
 * tail. With 0.9 an oak came out at a 2.2 m "trunk" — measured, wrong,
 * and enough to wall off the forest.
 */
export const STAMM_PERZENTIL = 0.5;
/**
 * Above this height an obstacle is treated as trunk-like (capsule at the
 * band radius); below it, as a rock (bounding box).
 *
 * Deliberately NOT the TREE_BASE flag: saplings like Beech_small1/2 do
 * not carry it, fell into the box branch and got a 3.4 m wide crown box —
 * the exact failure the band measurement exists to avoid.
 */
export const STAMM_MIN_HOEHE = 2.0;
/**
 * Ein Objekt gilt als Stamm, wenn es auf Spielerhöhe deutlich DÜNNER ist
 * als seine Gesamtausdehnung: gemessener Bandradius höchstens dieser
 * Anteil der halben Gesamtbreite.
 *
 * Die Gesamtform taugt dafür nicht. Ein Beech_small2 ist 3,9 m hoch bei
 * 3,4 m Kronenbreite — nach „höher als breit" also kein Stamm, und er
 * bekam eine 3,4 m breite Kiste, an der man zweieinhalb Meter vom
 * Stämmchen entfernt hängenblieb.
 */
export const STAMM_MAX_RADIUSANTEIL = 0.6;
/** Never produce a collider thinner than this — degenerate shapes tunnel. */
export const MIN_RADIUS = 0.12;
/**
 * Unter dieser Höhe bekommt ein Objekt gar keinen Kollider. Das Original
 * lässt einen über kniehohe Steine steigen und durch Büsche laufen; gäbe
 * man jedem davon einen Körper, stünde der Spieler ständig auf
 * knöchelhohen Sockeln statt auf dem Boden (gemessen: in 61 % der Proben
 * kein Bodenkontakt, ~0,7 m über Grund).
 */
export const MIN_HINDERNISHOEHE = 0.5;

/**
 * Prefabs, die statt eines Hüllquaders ihre exakte Oberfläche als
 * Kollision bekommen — Findlinge, Erzbrocken, Abbaufelsen.
 *
 * Erfasst die 15 gespawnten Felsklassen des Altbestands: Rock_3/4,
 * Rock_4_plains, rock1..4_* (mountain/heath/coast/forest/copper),
 * rock_mistlands1, MineRock_Tin, MineRock_Obsidian, silvervein. Der
 * SPEICHER-Fels fällt durch dieses Muster (`environment-sm-env-rock-…`
 * beginnt nicht mit `rock`) und wird über {@link STORE_FELSEN_NAMEN}
 * erkannt.
 */
export const FELS_NAME = /^(rock|minerock|silvervein|copperore|tinore|obsidian|stone)/i;
/**
 * Obergrenze für die exakte Fels-Kollision. Die Felsen des Exports liegen
 * bei 196 bis rund 800 Dreiecken; 4000 lässt Luft nach oben, ohne dass
 * ein unerwartet feines Modell die Physik sprengt. Darüber bleibt es beim
 * Hüllquader.
 */
export const FELS_MAX_DREIECKE = 4000;
/**
 * Bauwerke, durch die man hindurchgehen können muss.
 *
 * Für sie gilt dasselbe wie für Dungeon-Räume: Ein Hüllquader wäre fatal,
 * weil er den Durchgang massiv macht — beim Steinkreis stünde man vor
 * einer unsichtbaren Wand statt zwischen den Steinen. Die exakte
 * Kollision ist hier NICHT ans Dreiecksbudget gebunden (der Steinkreis
 * hat 11.362), und wenn sie nicht zustande kommt, bleibt das Prefab
 * lieber ganz ohne Kollision als mit einer Box.
 */
export const BEGEHBAR_NAME = /^(Grabhuegel|Steinkreis)/i;

/** Was der Aufrufer weiss und die Geometrie nicht hergibt. */
export interface FormOptionen {
  /**
   * `PrefabFlag.TREE_BASE` — grosse, fällbare Bäume bekommen IMMER die
   * Stammkapsel, auch wenn die Höhen-/Dünnheitsprobe sie verfehlt.
   */
  stammartig?: boolean;
  /** Dungeon-Raum (Phase G): sein Inneres ist begehbar, Box wäre fatal. */
  dungeonRaum?: boolean;
  /**
   * `positionen` ist ein EIGENES Kollisionsnetz (`_col` aus der GLB, s.
   * AssetManager-Kopf) und nicht das Sichtnetz. Es ersetzt die Kollision
   * vollständig: Wer eines mitliefert, hat sich etwas dabei gedacht, und
   * ein aus den gerenderten Treppenstufen gebackener Körper ist für die
   * 0,4-m-Kapsel unbegehbar.
   */
  eigenesNetz?: boolean;
}

const LEERE_INDIZES = new Uint32Array(0);

/**
 * Die Form eines Prefabs — oder `null`, wenn es keinen Körper bekommt.
 *
 * `positionen` sind die zusammengeführten Vertexpositionen ALLER
 * beteiligten Netze, bereits in Instanz-lokalen Clientkoordinaten
 * (Hierarchie eingerechnet). `indizes` gehört dazu und darf `null` sein —
 * dann kann nur Kiste oder Kapsel herauskommen, nie ein Netz.
 *
 * `katalogAngabe` ist die Kollisionsangabe des Speichers
 * ({@link storeKollision}) oder `null` für den Altbestand.
 */
export function kollisionsForm(
  positionen: Float32Array,
  indizes: Uint32Array | null,
  prefabName: string,
  katalogAngabe: StoreKollision | null,
  optionen: FormOptionen = {}
): KollisionsForm | null {
  /*
    `art: 'none'` ist die Ansage der Quelle: kein Körper. Sie steht ganz
    vorn, weil sie über eine 594 m breite Bergkulisse und über Wolken
    entscheidet — durch die muss man hindurchlaufen können, und keine
    Geometrieprobe der Welt käme von selbst darauf.

    Bis zum 10.09.2026 fragte der Client dafür `STORE_NICHT_STREUEN`,
    weil die Angabe nur im Editor-Katalog stand und der nicht ins
    Spiel-Bundle darf. Seit `storeKollisionDaten.ts` gibt es sie schmal;
    dass beide Mengen dieselbe Antwort geben, hält
    `shared/test/kollision-formen.ts` fest.
  */
  if (katalogAngabe !== null && katalogAngabe.art === 'none') return null;

  const begehbar = BEGEHBAR_NAME.test(prefabName);
  /*
    FELSEN bekommen die exakte Oberfläche, und die Kiste des Katalogs ist
    dabei nur RÜCKFALL, nie Vorrang.

    Ein Findling ist unregelmässig und liegt schräg im Hang; sein
    Hüllquader steht als unsichtbare Wand weit davor, und man rennt
    dagegen, bevor man den Stein überhaupt berührt. Gemeldet als: „Rock_4
    hat eine sehr grosse Box, man läuft erstmal gegen eine unsichtbare
    Wand — es sollte wie Terrain behandelt werden, nur die reine
    Oberfläche."

    Das Vorbild sagt dasselbe: Dort tragen Felsen und Klippen
    ausnahmslos konvexe Netz-Collider, nie Kisten (Vermessung der
    Original-Spieldaten). Der SPEICHER-Katalog dagegen führt alle 22
    Felsklassen als `art: 'box'` — `sm-env-rock-cliff-02` als
    5,7 × 17,2 × 6,2 m grosse Kiste, die im Vorbild begehbare Wege
    sperrte. Diese Angabe wird hier bewusst NICHT gefragt.

    Bezahlbar ist das, weil die Form zwischen allen Instanzen geteilt
    wird: Die 22 Speichermodelle liegen bei 24 bis 986 Dreiecken. Die
    Obergrenze schützt vor Ausreissern — was auch immer künftig unter den
    Namensfilter fällt, darf die Physik nicht sprengen; darüber bleibt es
    bei der Kiste.
  */
  const felsig = FELS_NAME.test(prefabName) || STORE_FELSEN_NAMEN.has(prefabName);
  /*
    `art: 'mesh'` ist die Ansage der Quelle: exakte Geometrie. Sie steht
    bei vier begehbaren Bauwerken (Treppe, Unterstand, Steg, Torbogen) —
    und Treppen sind im Vorbild die einzigen NICHT-konvexen Netze
    überhaupt. Ein Hüllquader machte aus einer Treppe eine Rampe aus
    massivem Stein: Man kommt nicht hinauf und auch nicht hindurch.
  */
  const eigenesNetzLautKatalog = katalogAngabe !== null && katalogAngabe.art === 'mesh';
  const dreiecke = indizes === null ? 0 : (indizes.length / 3) | 0;
  const exakt =
    optionen.eigenesNetz === true ||
    optionen.dungeonRaum === true ||
    begehbar ||
    eigenesNetzLautKatalog ||
    (felsig && dreiecke <= FELS_MAX_DREIECKE);

  if (exakt) {
    const netz = netzForm(positionen, indizes);
    if (netz !== null) return netz;
  }
  /*
    Kein Netz zustande gekommen. Für einen Felsen ist die Hüllform immer
    noch besser als GAR KEINE Kollision — bei Dungeon-Räumen und
    begehbaren Bauwerken dagegen wäre eine Box fatal (sie machte das
    begehbare Innere massiv), dort bleibt es bei „kein Körper".
  */
  if (optionen.dungeonRaum === true || begehbar) return null;
  return kisteOderKapsel(positionen, optionen.stammartig === true);
}

/**
 * Die exakte Geometrie als Form.
 *
 * Bezahlbar ist das, weil die Form über alle Instanzen geteilt wird: Ein
 * Speicher-Fels hat 196 bis 986 Dreiecke, einmal trianguliert tragen alle
 * Instanzen dieselbe Form.
 */
export function netzForm(
  positionen: Float32Array,
  indizes: Uint32Array | null
): KollisionsForm | null {
  if (indizes === null || indizes.length === 0 || positionen.length === 0) return null;
  const h = huelle(positionen);
  if (h === null) return null;
  return { art: 'netz', positionen, indizes: indizes ?? LEERE_INDIZES, min: h.min, max: h.max };
}

/** Achsparallele Hüllbox der Punktwolke, oder `null` bei leerer Wolke. */
function huelle(p: Float32Array): { min: Vek3; max: Vek3 } | null {
  if (p.length < 3) return null;
  let minX = p[0]!;
  let minY = p[1]!;
  let minZ = p[2]!;
  let maxX = minX;
  let maxY = minY;
  let maxZ = minZ;
  for (let i = 3; i < p.length; i += 3) {
    const x = p[i]!;
    const y = p[i + 1]!;
    const z = p[i + 2]!;
    if (x < minX) minX = x;
    else if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    else if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    else if (z > maxZ) maxZ = z;
  }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

/**
 * Kiste oder Stammkapsel — die Messung aus dem Client, unverändert.
 *
 * Für einen Baum darf die Form NICHT die Hüllbox sein: Die spannt die
 * KRONE auf, mehrere Meter breit, während man tatsächlich gegen einen
 * Stamm von unter einem Meter läuft. Man schöbe eine unsichtbare Tonne
 * vor sich her. Der Radius kommt deshalb aus den Vertices in einem Band
 * auf Spielerhöhe und als PERZENTIL statt als Extremwert — so bläht ein
 * einzelner tiefer Ast ihn nicht auf.
 *
 * Felsen und Verwandte bekommen ihre Hüllbox, denn dort IST die Box das
 * Hindernis.
 */
export function kisteOderKapsel(positionen: Float32Array, stammartig: boolean): KollisionsForm | null {
  const m = messe(positionen);
  const hoehe = m.maxY - m.minY;
  if (!(hoehe > 0)) return null;
  // Zu flach, um ein Hindernis zu sein — man steigt darüber.
  if (hoehe < MIN_HINDERNISHOEHE) return null;

  // Bandradius auf Spielerhöhe — der Wert, um den es beim Anstossen geht.
  let bandRadius: number | null = null;
  if (m.radien.length > 0) {
    m.radien.sort((a, b) => a - b);
    const idx = Math.min(m.radien.length - 1, Math.floor(m.radien.length * STAMM_PERZENTIL));
    const r = m.radien[idx]!;
    bandRadius = r > MIN_RADIUS ? r : MIN_RADIUS;
  }

  // Stammartig: hoch genug, und auf Spielerhöhe deutlich dünner als die
  // Gesamtausdehnung (Krone breit, Stamm dünn). Gegen den SICHTBAREN Teil
  // vergleichen: unter der Erde spreizen sich Wurzelteller, gegen die
  // jeder Stamm dünn wirkt.
  const halbeBreite =
    (m.maxXOben > m.maxZOben ? m.maxXOben : m.maxZOben) || (m.maxX > m.maxZ ? m.maxX : m.maxZ);
  const duenn = bandRadius !== null && bandRadius <= halbeBreite * STAMM_MAX_RADIUSANTEIL;
  if (bandRadius !== null && (stammartig || (hoehe >= STAMM_MIN_HOEHE && duenn))) {
    return { art: 'kapsel', x: 0, z: 0, radius: bandRadius, yMin: m.minY, yMax: m.minY + hoehe };
  }
  // No vertices in the band (a low bush, a flat rock) — fall back to the box.
  const halbX = m.maxX > MIN_RADIUS ? m.maxX : MIN_RADIUS;
  const halbZ = m.maxZ > MIN_RADIUS ? m.maxZ : MIN_RADIUS;
  return {
    art: 'kiste',
    min: { x: -halbX, y: m.minY, z: -halbZ },
    max: { x: halbX, y: m.minY + hoehe, z: halbZ },
  };
}

interface Messung {
  radien: number[];
  minY: number;
  maxY: number;
  maxX: number;
  maxZ: number;
  /** Grösste Ausdehnung ÜBER dem Ursprung — ohne den Wurzelteller. */
  maxXOben: number;
  maxZOben: number;
}

function messe(p: Float32Array): Messung {
  const radien: number[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  let maxX = 0;
  let maxZ = 0;
  let maxXOben = 0;
  let maxZOben = 0;

  for (let i = 0; i < p.length; i += 3) {
    const wx = p[i]!;
    const wy = p[i + 1]!;
    const wz = p[i + 2]!;
    if (wy < minY) minY = wy;
    if (wy > maxY) maxY = wy;
    const ax = wx < 0 ? -wx : wx;
    const az = wz < 0 ? -wz : wz;
    if (ax > maxX) maxX = ax;
    if (az > maxZ) maxZ = az;
    if (wy >= 0) {
      if (ax > maxXOben) maxXOben = ax;
      if (az > maxZOben) maxZOben = az;
    }
  }
  if (!Number.isFinite(minY)) {
    return { radien, minY: 0, maxY: 0, maxX: 0, maxZ: 0, maxXOben: 0, maxZOben: 0 };
  }

  // Zweiter Durchgang für das Stammband — Höhe über dem URSPRUNG (y = 0),
  // nicht über minY (s. STAMMBAND_MIN).
  for (let i = 0; i < p.length; i += 3) {
    const h = p[i + 1]!;
    if (h < STAMMBAND_MIN || h > STAMMBAND_MAX) continue;
    const wx = p[i]!;
    const wz = p[i + 2]!;
    radien.push(Math.sqrt(wx * wx + wz * wz));
  }

  /*
    Grob tessellierte Stämme (ein 4-Ecken-Zylinder mit nur zwei Ringen,
    z. B. bei y=0 und y=2,2) können das feste Band komplett verfehlen —
    `radien` bleibt dann leer, es fällt auf den Kronen-Box-Fallback
    zurück (Breite der gesamten Baumkrone über die volle Höhe), und man
    bleibt meterweit vor dem Stamm stehen. Nachgewiesen an
    BirkeHoch3.glb/Kiefer1.glb: Ringe nur bei y=0,000 und y=2,180 bzw.
    y=3,196, beide ausserhalb von [0,3; 2,0]. Bei leerem Band: den Ring
    nehmen, der der Bandmitte am nächsten liegt, statt die Krone zu
    vermessen.
  */
  if (radien.length === 0) {
    const bandMitte = (STAMMBAND_MIN + STAMMBAND_MAX) / 2;
    let besteEntfernung = Infinity;
    let besteHoehe = 0;
    for (let i = 0; i < p.length; i += 3) {
      const h = p[i + 1]!;
      const d = h - bandMitte < 0 ? bandMitte - h : h - bandMitte;
      if (d < besteEntfernung) {
        besteEntfernung = d;
        besteHoehe = h;
      }
    }
    const tol = 0.01;
    for (let i = 0; i < p.length; i += 3) {
      const h = p[i + 1]!;
      const d = h - besteHoehe < 0 ? besteHoehe - h : h - besteHoehe;
      if (d > tol) continue;
      const wx = p[i]!;
      const wz = p[i + 2]!;
      radien.push(Math.sqrt(wx * wx + wz * wz));
    }
  }
  return { radien, minY, maxY, maxX, maxZ, maxXOben, maxZOben };
}
