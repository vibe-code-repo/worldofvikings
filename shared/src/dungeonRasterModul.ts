/**
 * Modulerklärung des Rastergenerators (Meilenstein G2 der Konzeptnotiz
 * „Modul-Generierung 2.0-Logik“).
 *
 * ── Wofür ────────────────────────────────────────────────────────────
 * Der 1.0-Generator wählt erst ein Modul und erfährt danach, was daneben
 * liegt. Er hat kein Konzept „Rasterzelle belegt“, er reagiert nur auf
 * Connectors — und an der eingebauten Wand eines Korridors gibt es keinen
 * Connector. Ergebnis, über 40 Saaten gemessen: jede dritte Abschluss-
 * platte steht im Körper des Nachbarmoduls.
 *
 * Damit ein Generator das VORHER wissen kann, muss jedes Modul sich
 * selbst beschreiben: Wie viele Zellen belegt es, auf wie vielen Ebenen,
 * und was ist an jeder seiner sechs Zellkanten — Durchgang, Wand, oder
 * eine Wand, die die Kante nur zum Teil deckt. Genau das leistet
 * {@link modulAusRoomDef}. Sie ist rein und liest nur die
 * Kit-Definition; sie erzeugt nichts und ändert nichts.
 *
 * ── Warum sechs Kanten und nicht vier ────────────────────────────────
 * Ein Kantenmodell mit n/o/s/w erklärt median 32 senkrechte Nachbar-
 * schaften je Grundriss zu Nichts (gemessen: 1328 gestapelte Zellpaare
 * über 40 Saaten, bis zu 6 Ebenen). Boden und Decke sind deshalb
 * gleichberechtigte Kanten. Ihre Vorgabe ist `wand`: Ein Ebenenwechsel
 * muss ERKLÄRT werden, sonst wächst ein Grundriss durch den Boden.
 *
 * ── Warum drei Zustände und nicht zwei ───────────────────────────────
 * `wandTeilweise` ist kein Feinschliff, sondern der Unterschied zwischen
 * 531 überflüssigen und 414 nötigen Platten. Die Wände von Korridor,
 * Ecke und Abzweig laufen über die volle Ebenenhöhe (−0,25 … 3,75,
 * `make-stonevault.py:56-59`) — dagegen darf nie eine Platte gesetzt
 * werden. Die Flanken der Treppe sind Keile, die mit dem Lauf steigen
 * (`:483-491`) und die Kante je Ebene nur zum Teil decken — dort muss
 * eine Platte gesetzt werden.
 *
 * ── Warum die Funktion wirft statt zu raten ──────────────────────────
 * `rasterKanten` ist eine ERKLÄRUNG über das GLB, keine Messung an ihm.
 * Ein stiller Vorgabewert `wand` für jede nicht genannte Aussenkante
 * sähe genauso aus wie eine bewusste Wand — und ein vergessener Eintrag
 * fiele erst im fertigen Grab auf. Deshalb verlangt diese Funktion für
 * JEDE waagerechte Aussenkante eine Aussage (Connector oder
 * `rasterKanten`) und meldet jeden Widerspruch als Fehler. Der Preis ist,
 * dass ein neues Modul ohne Erklärung nicht durchrutscht — das ist der
 * Zweck.
 */
import { MODUL_ZELLE_HOEHE_M, verschlussAchse } from './dungeonRaster.js';
import { quatMulVec3 } from './worldgen/Math3d.js';
import type { RoomDef } from './dungeons.js';
import type { Vector3 } from './types.js';

/** Kantenlänge einer Rasterzelle in Metern (Modul-Format v0). */
export const MODUL_ZELLE_M = 2;

/**
 * Höhe einer Ebene in Metern. Dieselbe Zahl wie die lichte Zellhöhe: Im
 * Modulformat IST eine Ebene eine Zellhöhe (s. `MODUL_ZELLE_HOEHE_M`),
 * anders als im 4-m-Kit, wo der Ebenensprung 8 m misst.
 */
export const MODUL_EBENE_M = MODUL_ZELLE_HOEHE_M;

/**
 * Toleranz für Lagevergleiche in Metern. Die gemessene Drift der
 * Zellmitten geht bis 2,6 · 10⁻⁵ m; Modul-LOKALE Masse sind getippt und
 * daher exakt, hier reicht Rundungsrauschen.
 */
const TOLERANZ_M = 1e-4;

/**
 * Dreiwertiger Zustand einer Zellkante.
 *
 * `offen` — dort sitzt ein Connector, die Kante kann ein Durchgang werden.
 * `wand` — eine Wand über die volle Ebenenhöhe ist ins GLB gebaut.
 * `wandTeilweise` — eine Wand ist da, deckt die Kante aber nicht ganz.
 */
export type Kantenzustand = 'offen' | 'wand' | 'wandTeilweise';

/** Die sechs Kanten einer Zelle — vier waagerecht, plus Boden und Decke. */
export type Richtung = 'n' | 'o' | 's' | 'w' | 'oben' | 'unten';

/**
 * Feste Reihenfolge der Richtungen. Kantenlisten werden überall in dieser
 * Reihenfolge durchlaufen — Determinismus-Falle aus dem Konzept: Wer über
 * eine `Set`-Iteration geht, bekommt irgendwann einen anderen Grundriss
 * aus derselben Saat.
 */
export const RICHTUNGEN: readonly Richtung[] = ['n', 'o', 's', 'w', 'oben', 'unten'];

/** Richtung → achsparalleler Einheitsvektor in MODUL-lokalen Koordinaten. */
export const RICHTUNG_VEKTOR: Readonly<Record<Richtung, Vector3>> = {
  n: { x: 0, y: 0, z: 1 },
  o: { x: 1, y: 0, z: 0 },
  s: { x: 0, y: 0, z: -1 },
  w: { x: -1, y: 0, z: 0 },
  oben: { x: 0, y: 1, z: 0 },
  unten: { x: 0, y: -1, z: 0 },
};

/** Gegenrichtung — die andere Seite derselben Kante. */
export const GEGENRICHTUNG: Readonly<Record<Richtung, Richtung>> = {
  n: 's',
  s: 'n',
  o: 'w',
  w: 'o',
  oben: 'unten',
  unten: 'oben',
};

/** Waagerecht sind die vier Himmelsrichtungen; oben/unten sind es nicht. */
export function istWaagerecht(r: Richtung): boolean {
  return r !== 'oben' && r !== 'unten';
}

/**
 * Achsparalleler Vektor → Richtungsname, oder null.
 *
 * Gerundet statt verglichen: Ein Quaternion-Produkt in float32 trifft die
 * 1 nicht exakt, und ein Gleichheitsvergleich auf Kantenrichtungen ist
 * genau die Falle, gegen die das ganze Modul gebaut ist.
 */
export function richtungAusVektor(v: Vector3): Richtung | null {
  const x = Math.round(v.x);
  const y = Math.round(v.y);
  const z = Math.round(v.z);
  for (const r of RICHTUNGEN) {
    const d = RICHTUNG_VEKTOR[r];
    if (d.x === x && d.y === y && d.z === z) return r;
  }
  return null;
}

/**
 * Ein Eintrag der additiven Kantenerklärung am `RoomDef`.
 *
 * Zwei Formen, und der Unterschied ist Absicht:
 *
 *  • **Ohne `zelle`** — die Aussage über die AUSSENHAUT des Moduls: „jede
 *    Kante dieser Richtung, an der weder ein Ausgang noch eine eigene
 *    Zeile steht“. Sie überschreibt weder einen Connector noch eine
 *    Innenkante. Ohne diese Form wären die Treppenflanken zwölf
 *    gleichlautende Zeilen, in denen ein Tippfehler nicht auffiele.
 *  • **Mit `zelle`** — die Aussage über GENAU DIESE Kante. Sie gilt auch
 *    für eine Innenkante (so erklärt die Treppe ihren Ebenenwechsel) und
 *    ist ein Fehler, wenn dort ein Connector sitzt.
 *
 * Innerhalb einer Form überschreibt der spätere Eintrag den früheren; über
 * die Formen hinweg gewinnt immer die Einzelzeile, egal wo sie steht — sonst
 * hinge die Bedeutung einer Ausnahme an ihrer Zeilennummer.
 */
export interface RasterKanteDef {
  /** Lokale Zellindizes (x-Reihe, z-Reihe, Ebene). Fehlt sie: alle Zellen. */
  readonly zelle?: { readonly a: number; readonly b: number; readonly e: number };
  /** Kanten, für die der Zustand gilt. */
  readonly kanten: readonly Richtung[];
  readonly zustand: Kantenzustand;
}

/** Eine Öffnung des Moduls: der Connector, seine Zelle und seine Kante. */
export interface ModulPort {
  /** Index in `RoomDef.connections` — die Rückverbindung zur Kit-Definition. */
  readonly connector: number;
  /** Index in {@link Modul.zellen}. */
  readonly zelle: number;
  readonly richtung: Richtung;
  readonly entrance: boolean;
  readonly allowDoor: boolean;
  /**
   * Kantenmitte in MODUL-lokalen Koordinaten. Sie ist die Sollstelle des
   * Connectors und damit der Zeuge gegen eine Kit-Geometrie, die sich
   * unter der Erklärung wegbewegt (Konzept S6).
   */
  readonly lokaleKantenmitte: Vector3;
}

/** Eine Zelle des Moduls mit ihren sechs Kanten. */
export interface ModulZelle {
  /** Lokaler Zellindex in x-Richtung, 0 … zellenX−1. */
  readonly a: number;
  /** Lokaler Zellindex in z-Richtung, 0 … zellenZ−1. */
  readonly b: number;
  /** Lokale Ebene, 0 … ebenen−1. */
  readonly e: number;
  /**
   * Zellmitte in MODUL-lokalen Koordinaten (Pivot = Bodenmitte des
   * Moduls). y ist die BODENoberkante der Ebene, nicht die halbe Höhe —
   * `roomBodyFromFloor` gilt für dieses Kit.
   */
  readonly lokaleMitte: Vector3;
  readonly kanten: Readonly<Record<Richtung, Kantenzustand>>;
  /**
   * Führt die Kante zu einer anderen Zelle DESSELBEN Moduls? Dort kann
   * von aussen nichts anstossen — die Versiegelung überspringt solche
   * Kanten, und die Prüfung „offene Kante braucht einen Connector“ gilt
   * dort nicht.
   */
  readonly innen: Readonly<Record<Richtung, boolean>>;
}

/** Die vollständige Selbstbeschreibung eines Rastermoduls. */
export interface Modul {
  readonly name: string;
  /** Zellen in lokaler x-Richtung. */
  readonly zellenX: number;
  /** Zellen in lokaler z-Richtung. */
  readonly zellenZ: number;
  readonly ebenen: number;
  /** Kanonisch sortiert nach (e, b, a) — s. Determinismus-Falle im Konzept. */
  readonly zellen: readonly ModulZelle[];
  readonly ports: readonly ModulPort[];
  /**
   * Verschlussmodul (`endCap`, dünner als eine Zelle): Es belegt KEINE
   * Zelle, es legt sich in die Kantenebene. Wer es als Zelle führte,
   * hielte jede versiegelte Kante für belegt.
   */
  readonly verschluss: boolean;
  /**
   * Der Ankerport — der Eingangsconnector, an dem der Grundriss aufhängt.
   * Nur der Eingangsraum hat einen; bei allen anderen null.
   */
  readonly anker: ModulPort | null;
}

function fehler(name: string, text: string): never {
  throw new Error(`Rastermodul '${name}': ${text}`);
}

/** Ganzes Vielfaches, oder null. Rundet und prüft die Rundung nach. */
function vielfaches(wert: number, schritt: number): number | null {
  const n = Math.round(wert / schritt);
  return Math.abs(wert - n * schritt) < TOLERANZ_M ? n : null;
}

/**
 * Leitet aus einer Kit-Raumdefinition die Rasterbeschreibung ab.
 *
 * Abgeleitet (nicht getippt) werden Fussabdruck, Ebenen und alle `offen`-
 * Kanten; getippt (`RoomDef.rasterKanten`) werden nur die Zustände, die
 * im GLB stecken und an keiner Datenstruktur hängen: `wand` und
 * `wandTeilweise`. Wirft bei jeder Lücke und jedem Widerspruch — die
 * Begründung steht im Kopf dieser Datei.
 */
export function modulAusRoomDef(raum: RoomDef): Modul {
  // ── Verschluss zuerst: er hat keinen Fussabdruck ────────────────────
  //
  // `verschlussAchse` ist die bestehende, eng gefasste Regel aus
  // `dungeonRaster.ts` (endCap + genau ein Connector + genau eine dünne
  // Achse, Connector quer darauf). Sie hier wiederzuverwenden statt „0,3
  // ist dünn“ zu tippen hält die beiden Aussagen zusammen.
  if (verschlussAchse(raum, MODUL_ZELLE_M) !== null) {
    return {
      name: raum.name,
      zellenX: 0,
      zellenZ: 0,
      ebenen: 0,
      zellen: [],
      ports: [],
      verschluss: true,
      anker: null,
    };
  }

  // ── Fussabdruck ────────────────────────────────────────────────────
  //
  // `size` lügt auf jeder Achse mit eingebauter Wand bewusst um 0,6 m:
  // 1,4 statt 2 hält den Abschluss der Nachbarzelle von der Hülle fern
  // (Begründung an `StoneVaultCorridor`). Für den Fussabdruck zählt
  // deshalb das RASTERmass, nicht die Hülle — `max(size, 2)` macht aus
  // dem Innenmass wieder die ganze Zelle.
  const zellenX = vielfaches(Math.max(raum.size.x, MODUL_ZELLE_M), MODUL_ZELLE_M);
  const zellenZ = vielfaches(Math.max(raum.size.z, MODUL_ZELLE_M), MODUL_ZELLE_M);
  const ebenen = vielfaches(raum.size.y, MODUL_EBENE_M);
  if (zellenX === null || zellenZ === null || ebenen === null || ebenen < 1) {
    fehler(
      raum.name,
      `Hülle ${raum.size.x}×${raum.size.y}×${raum.size.z} liegt nicht auf dem Raster ` +
        `(${MODUL_ZELLE_M} m in x/z, ${MODUL_EBENE_M} m in y).`
    );
  }

  // ── Zellen anlegen, Innenkanten markieren ──────────────────────────
  interface Bau {
    a: number;
    b: number;
    e: number;
    lokaleMitte: Vector3;
    kanten: Record<Richtung, Kantenzustand>;
    innen: Record<Richtung, boolean>;
    /** Kanten, über die `rasterKanten` eine Aussage getroffen hat. */
    erklaert: Set<Richtung>;
    /** Kanten, auf denen ein Connector sitzt (Index in `ports`). */
    port: Map<Richtung, number>;
  }

  const bau: Bau[] = [];
  const index = new Map<string, number>();
  const schluessel = (a: number, b: number, e: number): string => `${a}|${b}|${e}`;
  for (let e = 0; e < ebenen; e++) {
    for (let b = 0; b < zellenZ; b++) {
      for (let a = 0; a < zellenX; a++) {
        index.set(schluessel(a, b, e), bau.length);
        bau.push({
          a,
          b,
          e,
          // Der Pivot liegt in der Bodenmitte des Moduls, die Zellen
          // liegen also symmetrisch darum. Bei gerader Zellzahl (Halle)
          // sitzt der Pivot ZWISCHEN den Zellen — genau deshalb steht
          // hier (n−1)/2 und keine Ganzzahlrechnung.
          lokaleMitte: {
            x: (a - (zellenX - 1) / 2) * MODUL_ZELLE_M,
            y: e * MODUL_EBENE_M,
            z: (b - (zellenZ - 1) / 2) * MODUL_ZELLE_M,
          },
          kanten: { n: 'wand', o: 'wand', s: 'wand', w: 'wand', oben: 'wand', unten: 'wand' },
          innen: { n: false, o: false, s: false, w: false, oben: false, unten: false },
          erklaert: new Set<Richtung>(),
          port: new Map<Richtung, number>(),
        });
      }
    }
  }

  for (const z of bau) {
    for (const r of RICHTUNGEN) {
      const d = RICHTUNG_VEKTOR[r];
      const nachbar = index.get(schluessel(z.a + d.x, z.b + d.z, z.e + d.y));
      if (nachbar === undefined) continue;
      z.innen[r] = true;
      // Waagerechte Innenkanten sind Durchgang: Ein mehrzelliges Modul
      // ist EIN Raum, seine Zellen hängen zusammen. Senkrechte NICHT —
      // gestapelte Zellen eines Moduls sind der Luftraum über einer
      // Treppe, und der ist nur dort begehbar, wo der Lauf ihn kreuzt.
      if (istWaagerecht(r)) z.kanten[r] = 'offen';
    }
  }

  // ── Ports aus den Connectors ableiten ──────────────────────────────
  const ports: ModulPort[] = [];
  for (let i = 0; i < raum.connections.length; i++) {
    const c = raum.connections[i]!;
    // Die Connectordrehung zeigt aus dem Modul HINAUS (Kit-Konvention),
    // die lokale +z-Achse ist die Blickrichtung.
    const r = richtungAusVektor(quatMulVec3(c.localRot, { x: 0, y: 0, z: 1 }));
    if (r === null || !istWaagerecht(r)) {
      fehler(
        raum.name,
        `Connector ${i} zeigt nicht in eine der vier Himmelsrichtungen — ` +
          `senkrechte Durchgänge kennt das Modulformat nicht.`
      );
    }
    // Die Zelle hinter dem Connector: eine halbe Zelle entgegen seiner
    // Blickrichtung. Der Connector sitzt auf der KANTE, nicht auf der
    // Hüllfläche (die liegt bei eingebauten Wänden 0,3 m weiter innen).
    const d = RICHTUNG_VEKTOR[r];
    const mx = c.localPos.x - (d.x * MODUL_ZELLE_M) / 2;
    const mz = c.localPos.z - (d.z * MODUL_ZELLE_M) / 2;
    const a = vielfaches(mx + ((zellenX - 1) / 2) * MODUL_ZELLE_M, MODUL_ZELLE_M);
    const b = vielfaches(mz + ((zellenZ - 1) / 2) * MODUL_ZELLE_M, MODUL_ZELLE_M);
    const e = vielfaches(c.localPos.y, MODUL_EBENE_M);
    const treffer =
      a === null || b === null || e === null ? undefined : index.get(schluessel(a, b, e));
    if (treffer === undefined) {
      fehler(
        raum.name,
        `Connector ${i} auf (${c.localPos.x}, ${c.localPos.y}, ${c.localPos.z}) liegt auf keiner ` +
          `Zellkante des ${zellenX}×${zellenZ}×${ebenen}-Fussabdrucks.`
      );
    }
    const z = bau[treffer]!;
    if (z.innen[r]) {
      fehler(
        raum.name,
        `Connector ${i} sitzt auf der INNENkante ${r} der Zelle (${z.a},${z.b},${z.e}) — ` +
          `dort kann nie ein Nachbar andocken.`
      );
    }
    if (z.port.has(r)) {
      fehler(
        raum.name,
        `Zelle (${z.a},${z.b},${z.e}) trägt zwei Connectors auf Kante ${r} ` +
          `(${z.port.get(r)} und ${i}).`
      );
    }
    z.kanten[r] = 'offen';
    z.port.set(r, ports.length);
    ports.push({
      connector: i,
      zelle: treffer,
      richtung: r,
      entrance: c.entrance,
      allowDoor: c.allowDoor,
      lokaleKantenmitte: {
        x: z.lokaleMitte.x + (d.x * MODUL_ZELLE_M) / 2,
        y: z.lokaleMitte.y,
        z: z.lokaleMitte.z + (d.z * MODUL_ZELLE_M) / 2,
      },
    });
  }

  // ── Die getippte Erklärung darüberlegen ────────────────────────────
  //
  // NACH den Ports, weil beide Formen sich auf sie beziehen: Die
  // Aussenhaut-Regel lässt einen Ausgang stehen, die Einzelzeile
  // widerspricht ihm. Zuerst die Einzelzeilen — sie sind die genauere
  // Aussage und dürfen von der Fläche nicht zugedeckt werden.
  const einzeln = new Set<string>();
  for (const eintrag of raum.rasterKanten ?? []) {
    if (eintrag.zelle === undefined) continue;
    const treffer = index.get(schluessel(eintrag.zelle.a, eintrag.zelle.b, eintrag.zelle.e));
    if (treffer === undefined) {
      fehler(
        raum.name,
        `rasterKanten nennt Zelle (${eintrag.zelle.a},${eintrag.zelle.b},${eintrag.zelle.e}), ` +
          `die es bei ${zellenX}×${zellenZ}×${ebenen} nicht gibt.`
      );
    }
    const z = bau[treffer]!;
    for (const r of eintrag.kanten) {
      if (z.port.has(r) && eintrag.zustand !== 'offen') {
        fehler(
          raum.name,
          `Widerspruch an Zelle (${z.a},${z.b},${z.e}), Kante ${r}: rasterKanten sagt ` +
            `'${eintrag.zustand}', dort sitzt aber Connector ${z.port.get(r)}.`
        );
      }
      z.kanten[r] = eintrag.zustand;
      z.erklaert.add(r);
      einzeln.add(`${z.a}|${z.b}|${z.e}|${r}`);
    }
  }
  for (const eintrag of raum.rasterKanten ?? []) {
    if (eintrag.zelle !== undefined) continue;
    for (const z of bau) {
      for (const r of eintrag.kanten) {
        // Innenkanten und Ausgänge bleiben stehen: Die Fläche beschreibt,
        // was AUSSEN und ZU ist, nicht was das Modul zusammenhält.
        if (z.innen[r] || z.port.has(r)) continue;
        if (einzeln.has(`${z.a}|${z.b}|${z.e}|${r}`)) continue;
        z.kanten[r] = eintrag.zustand;
        z.erklaert.add(r);
      }
    }
  }

  // ── Vollständigkeit und Widerspruchsfreiheit ───────────────────────
  for (const z of bau) {
    for (const r of RICHTUNGEN) {
      if (istWaagerecht(r) && !z.innen[r]) {
        // Jede waagerechte Aussenkante entscheidet über eine Platte.
        // Schweigen ist deshalb keine Aussage, sondern eine Lücke.
        if (!z.erklaert.has(r) && !z.port.has(r)) {
          fehler(
            raum.name,
            `Zelle (${z.a},${z.b},${z.e}) sagt nichts über ihre Aussenkante ${r} — ` +
              `entweder ein Connector oder ein rasterKanten-Eintrag.`
          );
        }
        // Eine offene Aussenkante ohne Connector wäre eine Öffnung, an
        // der nie ein Nachbar andocken kann: die „Öffnung ins Leere“.
        if (z.kanten[r] === 'offen' && !z.port.has(r)) {
          fehler(
            raum.name,
            `Zelle (${z.a},${z.b},${z.e}) erklärt die Aussenkante ${r} als offen, ` +
              `trägt dort aber keinen Connector.`
          );
        }
      }
      // Innenkanten haben zwei Seiten in DERSELBEN Erklärung — sie müssen
      // übereinstimmen. Ein einseitig geöffneter Ebenenwechsel wäre eine
      // Einbahnstrasse durch Stein, und niemand zählt ihn.
      if (z.innen[r]) {
        const d = RICHTUNG_VEKTOR[r];
        const gegen = bau[index.get(schluessel(z.a + d.x, z.b + d.z, z.e + d.y))!]!;
        if (gegen.kanten[GEGENRICHTUNG[r]] !== z.kanten[r]) {
          fehler(
            raum.name,
            `Innenkante zwischen (${z.a},${z.b},${z.e}) und (${gegen.a},${gegen.b},${gegen.e}) ` +
              `ist einseitig erklärt: ${r} = '${z.kanten[r]}', ` +
              `${GEGENRICHTUNG[r]} = '${gegen.kanten[GEGENRICHTUNG[r]]}'.`
          );
        }
      }
    }
  }

  const zellen: ModulZelle[] = bau.map((z) => ({
    a: z.a,
    b: z.b,
    e: z.e,
    lokaleMitte: z.lokaleMitte,
    kanten: { ...z.kanten },
    innen: { ...z.innen },
  }));

  return {
    name: raum.name,
    zellenX,
    zellenZ,
    ebenen,
    zellen,
    ports,
    verschluss: false,
    anker: ports.find((p) => p.entrance) ?? null,
  };
}
