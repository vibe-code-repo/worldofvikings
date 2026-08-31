/**
 * Themenprofile des Dungeon-Generators 2.0 — was ein Grab ausmacht, als Daten.
 * Theme profiles of dungeon generator 2.0 — what makes a barrow, as data.
 *
 * Quelle: `design/data-model.md` §2.2 (Interface-Wortlaut), `design/ARCHITECTURE.md`
 * W5 (Materialtag-Belegung 0..5) und §1.2 (Modulzuschnitt). `generator.ts` liest
 * dieses Profil und zieht nichts, was hier nicht als Bereich steht.
 * Source: `design/data-model.md` §2.2 (interface wording), `design/ARCHITECTURE.md`
 * W5 (material tag assignment 0..5) and §1.2 (module layout). `generator.ts`
 * reads this profile and draws nothing that is not written here as a range.
 *
 * Dieses Modul ist rein und nebenwirkungsfrei: kein Babylon, kein DOM, kein
 * `node:`, kein `Math.random`, keine Uhr, keine Trigonometrie, und kein
 * Registry-Eintrag auf Modulebene (`shared/package.json` sagt
 * `"sideEffects": false` — die Tabellen hier sind reine Daten, kein Aufruf).
 * This module is pure and free of side effects: no Babylon, no DOM, no `node:`,
 * no `Math.random`, no clock, no trigonometry, and no registry registration at
 * module level (`shared/package.json` declares `"sideEffects": false` — the
 * tables below are plain data, not a call).
 */

import {
  KANTE,
  MAX_MATERIAL_TAG,
  type Kante,
  type RaumStempel,
  type RaumTyp,
} from './layout.js';
import { hashPos } from './hashing.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Profil-Typen / profile types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ein Eintrag einer gewichteten Prefabliste. Der Bestuecker (`bestuecker.ts`,
 * eigenes Paket) waehlt daraus, der Generator nie — er setzt nur die ROLLE.
 * One entry of a weighted prefab list. The furnisher (`bestuecker.ts`, its own
 * package) picks from it, the generator never does — it only sets the ROLE.
 */
export interface PrefabGewicht {
  readonly prefab: string;
  /** Ganzzahliges Gewicht > 0. / Integer weight > 0. */
  readonly gewicht: number;
}

/**
 * Profil eines Raumtyps. Alle Bereiche sind INKLUSIVE (`[min, max]`) und
 * ganzzahlig — der Generator zieht mit `rangeInt(min, max + 1)`.
 * Profile of one room type. All ranges are INCLUSIVE (`[min, max]`) and
 * integral — the generator draws with `rangeInt(min, max + 1)`.
 */
export interface RaumTypProfil {
  readonly typ: RaumTyp;
  /** Ganzzahliges Ziehgewicht in P2. / Integer draw weight in P2. */
  readonly gewicht: number;
  /** Ausdehnung in Zellen, inklusive. / Footprint range in cells, inclusive. */
  readonly breite: readonly [number, number];
  readonly tiefe: readonly [number, number];
  /** Hoehe in HOEHEN_SCHRITT_M, inklusive. / Height in height steps. */
  readonly hoehe: readonly [number, number];
  /** Wie viele Ausgaenge dieser Typ anbietet. / How many exits this type offers. */
  readonly ausgaenge: readonly [number, number];
  /** Hoechstzahl im Dungeon (Schatzkammer: 1). / Cap per dungeon. */
  readonly maxAnzahl?: number;
  /** Fruehestens ab dieser Baumtiefe. / Earliest tree depth. */
  readonly minTiefe?: number;
  /** Deko-Muster, die auf diesen Typ angewendet werden. / Decor patterns. */
  readonly dekoMuster: readonly string[];
  /** Zellmaterial 0..MAX_MATERIAL_TAG (W5). / Cell material 0..MAX_MATERIAL_TAG. */
  readonly materialTag: number;
}

/**
 * Profil eines Themas. `steingrab` ist das erste und einzige in Meilenstein 1.
 * Profile of one theme. `steingrab` is the first and only one in milestone 1.
 */
export interface ThemenProfil {
  readonly id: string;
  readonly raumTypen: readonly RaumTypProfil[];
  /** Ganglaenge in Zellen. / Corridor length in cells. */
  readonly gangLaenge: readonly [number, number];
  /** Zahl der Ebenen, inklusive. / Number of storeys, inclusive. */
  readonly ebenen: readonly [number, number];
  /** Anteil der Beruehrungskanten, die zu Schleifen geoeffnet werden (0..1). */
  /** Share of contact edges opened into loops (0..1). */
  readonly schleifenAnteil: number;
  /** Wahrscheinlichkeit einer Tuer je Verbindungskante (0..1). */
  /** Probability of a door per connection edge (0..1). */
  readonly tuerChance: number;
  readonly tuerArten: readonly string[];
  /** Zielgroesse in ZELLEN, nicht in Raeumen. / Target size in CELLS, not rooms. */
  readonly zielZellen: readonly [number, number];
  /** Verweis auf den Triplanar-Materialsatz des Bauers. / Builder material set. */
  readonly materialSatz: string;
  /**
   * Name der Innen-Umgebung (Unity `Location.m_interiorEnvironment`) — die
   * Beleuchtung, die der Client in dieser Instanz erzwingt. Der Altbestand
   * fuehrt dieselbe Zuordnung als `interiorEnvironment(base)` ueber das Kit
   * (`shared/src/dungeons.ts`); 2.0 hat keine Kits mehr, also traegt sie das
   * Thema. Muss ein Name aus `envData.json` sein.
   * Name of the interior lighting environment the client forces inside this
   * instance. Legacy keeps the same mapping keyed by kit; 2.0 has no kits, so
   * the theme carries it. Must be a name from `envData.json`.
   */
  readonly innenUmgebung: string;
  /** Deko-Tabellen: Rolle -> gewichtete Prefabliste. / Decor tables: role -> prefabs. */
  readonly dekoTabellen: Readonly<Record<string, readonly PrefabGewicht[]>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Rollen und Varianten / roles and variants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Alle Deko-ROLLEN in fester Reihenfolge. Die Position in dieser Liste geht in
 * die Anker-Id ein (`generator.ts`, `ankerId()`), damit eine Id aus der
 * Layout-Position und der Rolle entsteht und NIE aus der Ziehreihenfolge —
 * genau die Zusage aus `ARCHITECTURE.md` AP13 ("sonst wandert der ZDO-Zustand
 * einer geoeffneten Truhe auf eine andere").
 * All decor ROLES in fixed order. The position in this list enters the anchor
 * id (`generator.ts`, `ankerId()`), so an id derives from the layout position
 * and the role and NEVER from a draw order — exactly the guarantee from
 * `ARCHITECTURE.md` AP13 ("otherwise the ZDO state of an opened chest migrates
 * to a different one").
 *
 * ANHAENGEND ERWEITERN, nie umsortieren: Eine Umsortierung vergibt jedem Anker
 * eine neue Id und damit jedem gespeicherten ZDO einen neuen Platz.
 * EXTEND BY APPENDING, never reorder: a reorder gives every anchor a new id and
 * therefore every stored ZDO a new home.
 */
export const ROLLEN: readonly string[] = [
  'fackel',
  'geroell',
  'altar',
  'sarkophag',
  'truhe',
  'saeule',
  'urne',
  'spawner',
];

/** Index einer Rolle in `ROLLEN`, oder -1. / Index of a role in `ROLLEN`, or -1. */
export function rollenIndex(rolle: string): number {
  return ROLLEN.indexOf(rolle);
}

/**
 * Die Rollen, die BEWEGLICH oder INTERAKTIV sind und deshalb als ZDO leben —
 * alles andere baut der Client selbst aus dem Layout (`DungeonDeko`).
 *
 * Diese Liste ist die EINE Trennlinie zwischen Server und Client, und sie steht
 * absichtlich hier und nicht zweimal: Der Server materialisiert genau diese
 * Rollen (`Materialisierung2.ts`), der Client laesst genau diese Rollen beim
 * Deko-Bau aus. Stuende sie zweimal, saehe ein Spieler eine Truhe doppelt —
 * einmal als Thin Instance, einmal als Entity — und niemand haette einen
 * Fehler gemacht.
 *
 * The roles that are MOVABLE or INTERACTIVE and therefore live as ZDOs —
 * everything else the client builds itself from the layout. This list is the
 * ONE dividing line between server and client, and it deliberately exists once:
 * the server materialises exactly these roles, the client omits exactly these
 * roles when building decor. Written twice, a player would see a chest twice.
 */
export const ROLLEN_MIT_ZDO: readonly string[] = ['truhe', 'spawner'];

/** Gehoert diese Rolle dem Server? / Does this role belong to the server? */
export function rolleHatZdo(rolle: string): boolean {
  return ROLLEN_MIT_ZDO.includes(rolle);
}

/**
 * Zahl der Materialsatz-Varianten je Thema (`RaumStempel.variante`).
 *
 * ENTSCHEIDUNG (siehe `design/decisions-log.md` AP4-3): Das eingefrorene
 * `ThemenProfil` aus `data-model.md` §2.2 hat kein Feld fuer die Variantenzahl,
 * `RaumStempel.variante` verlangt aber einen Wertebereich. Eine Modulkonstante
 * ist die konservative Wahl — sie erweitert das Profil-Interface nicht und ist
 * an genau einer Stelle aenderbar.
 * DECISION (see `design/decisions-log.md` AP4-3): the frozen `ThemenProfil`
 * from `data-model.md` §2.2 has no field for the variant count, yet
 * `RaumStempel.variante` needs a range. A module constant is the conservative
 * choice — it does not widen the profile interface and can be changed in
 * exactly one place.
 */
export const VARIANTEN = 4;

/**
 * Materialsatz-Variante eines Stempels — aus `seeds.material` und der
 * Rasterposition GEHASHT, nicht aus dem Architekturstrom GEZOGEN.
 * Material-set variant of a stamp — HASHED from `seeds.material` and the grid
 * position, not DRAWN from the architecture stream.
 *
 * Grund: `ARCHITECTURE.md` W2 sagt zu, dass der Material-Seed "jederzeit neu
 * gewuerfelt werden" darf. Eine Ziehung aus dem Architekturstrom wuerde den
 * Grundriss an den Material-Seed binden; ein Hash ueber die Position tut das
 * nicht — derselbe Grundriss, andere Varianten.
 * Reason: `ARCHITECTURE.md` W2 promises the material seed may be "re-rolled at
 * any time". A draw from the architecture stream would tie the floor plan to
 * the material seed; a hash over the position does not — same plan, different
 * variants.
 */
export function varianteFuerStempel(
  stempel: Pick<RaumStempel, 'x' | 'z' | 'ebene'>,
  materialSeed: number
): number {
  return hashPos(stempel.x, stempel.z, stempel.ebene, materialSeed) % VARIANTEN;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Zugriff auf Profile / profile lookup
// ─────────────────────────────────────────────────────────────────────────────

/** Raumtyp-Profil eines Themas, oder `undefined`. / Room type profile, or `undefined`. */
export function profilFuer(thema: ThemenProfil, typ: RaumTyp): RaumTypProfil | undefined {
  return thema.raumTypen.find((p) => p.typ === typ);
}

/**
 * Zellmaterial eines Stempels: der `materialTag` seines Raumtyp-Profils.
 * Cell material of a stamp: the `materialTag` of its room type profile.
 *
 * ENTSCHEIDUNG (siehe `design/decisions-log.md` AP4-2): Der Materialtag haengt
 * NUR vom Raumtyp ab, nicht von einer Ziehung. Damit aendert ein neuer
 * `seeds.material` weder Grundriss noch Zellmaterial — er aendert nur
 * `variante` und die Hashes des Bauers (W8). Ein unbekannter Typ faellt auf 2
 * (Boden-Platten) zurueck, den Wert, den `cells.ts` ohne Thema setzt.
 * DECISION (see `design/decisions-log.md` AP4-2): the material tag depends ONLY
 * on the room type, not on a draw. A new `seeds.material` therefore changes
 * neither the floor plan nor the cell material — it only changes `variante` and
 * the builder's hashes (W8). An unknown type falls back to 2 (floor slabs), the
 * value `cells.ts` uses without a theme.
 */
export function materialTagFuerStempel(thema: ThemenProfil, stempel: RaumStempel): number {
  const profil = profilFuer(thema, stempel.typ);
  const tag = profil?.materialTag ?? 2;
  return tag >= 0 && tag <= MAX_MATERIAL_TAG ? tag : 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Thema `steingrab` / theme `steingrab`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ganglaenge, an genau einer Stelle geschrieben: `ThemenProfil.gangLaenge` und
 * die `tiefe` des Gang-Profils sind derselbe Wert. Zwei getrennte Zahlen waeren
 * zwei Zahlen, von denen eines Tages eine geaendert wird.
 * Corridor length, written in exactly one place: `ThemenProfil.gangLaenge` and
 * the `tiefe` of the corridor profile are the same value. Two separate numbers
 * would be two numbers of which one day only one gets changed.
 */
const GANG_LAENGE = [3, 9] as const;

/**
 * Hoehenbereiche in HOEHEN_SCHRITT_M. Untergrenze ist `MIN_LICHTE_STUFEN` (8 =
 * 4 m), Obergrenze 15: Die Regel `ebenen-abstand` (`validation.ts`) verlangt
 * Deckenoberkante unten < Bodenunterkante oben, und eine Ebene ist
 * `EBENE_M / HOEHEN_SCHRITT_M` = 16 Stufen hoch. Bei `bodenVersatz = 0` heisst
 * das: `hoehe <= 15`.
 * Height ranges in height steps. Lower bound is `MIN_LICHTE_STUFEN` (8 = 4 m),
 * upper bound 15: rule `ebenen-abstand` (`validation.ts`) requires the lower
 * ceiling top below the upper floor bottom, and one storey is
 * `EBENE_M / HOEHEN_SCHRITT_M` = 16 steps tall. At `bodenVersatz = 0` that
 * means `hoehe <= 15`.
 */
const HOEHE_NIEDRIG = [8, 10] as const;
const HOEHE_MITTEL = [9, 12] as const;
const HOEHE_HOCH = [12, 15] as const;

/**
 * Das Steingrab: helle Sandsteinquader, verlegte Boeden, Runenholz, ein
 * Sarkophag ganz hinten. Zielbild ist Mikes Barrow-Referenz
 * (`design/material-plan.md` §2).
 * The barrow: light sandstone ashlar, laid floors, rune wood, a sarcophagus at
 * the very back. Target image is Mike's barrow reference
 * (`design/material-plan.md` §2).
 */
export const STEINGRAB: ThemenProfil = {
  id: 'steingrab',
  raumTypen: [
    {
      // Der Eingangsraum wird nur in P1 gesetzt, nie in P2 gezogen —
      // `gewicht: 0` haelt ihn aus der gewichteten Auswahl heraus.
      // The entrance room is only placed in P1, never drawn in P2 —
      // `gewicht: 0` keeps it out of the weighted selection.
      typ: 'eingang',
      gewicht: 0,
      breite: [3, 4],
      tiefe: [3, 4],
      hoehe: HOEHE_MITTEL,
      ausgaenge: [2, 3],
      maxAnzahl: 1,
      dekoMuster: ['wandfackeln'],
      materialTag: 2,
    },
    {
      typ: 'gang',
      gewicht: 46,
      breite: [1, 1],
      tiefe: GANG_LAENGE,
      hoehe: HOEHE_NIEDRIG,
      ausgaenge: [1, 3],
      dekoMuster: ['wandfackeln', 'bodenschutt'],
      materialTag: 3,
    },
    {
      typ: 'kammer',
      gewicht: 24,
      breite: [3, 5],
      tiefe: [3, 5],
      hoehe: HOEHE_MITTEL,
      ausgaenge: [1, 3],
      dekoMuster: ['wandfackeln', 'bodenschutt', 'wandnische'],
      materialTag: 2,
    },
    {
      typ: 'saal',
      gewicht: 10,
      breite: [5, 8],
      tiefe: [5, 8],
      hoehe: HOEHE_HOCH,
      ausgaenge: [2, 4],
      dekoMuster: ['wandfackeln', 'saeulen', 'bodenschutt'],
      materialTag: 2,
    },
    {
      typ: 'nische',
      gewicht: 12,
      breite: [1, 2],
      tiefe: [1, 2],
      hoehe: HOEHE_NIEDRIG,
      ausgaenge: [0, 1],
      dekoMuster: ['wandnische'],
      materialTag: 1,
    },
    {
      typ: 'treppe',
      gewicht: 8,
      // Ein Schacht ist immer 1x1 — er verbindet genau eine Zellsaeule.
      // A shaft is always 1x1 — it links exactly one cell column.
      breite: [1, 1],
      tiefe: [1, 1],
      hoehe: [15, 15],
      ausgaenge: [1, 2],
      minTiefe: 2,
      dekoMuster: ['wandfackeln'],
      materialTag: 1,
    },
    {
      typ: 'schatzkammer',
      gewicht: 4,
      breite: [3, 4],
      tiefe: [3, 4],
      hoehe: HOEHE_MITTEL,
      ausgaenge: [0, 1],
      maxAnzahl: 1,
      minTiefe: 3,
      dekoMuster: ['truhe', 'wandfackeln'],
      materialTag: 2,
    },
    {
      typ: 'grabkammer',
      gewicht: 5,
      breite: [4, 6],
      tiefe: [4, 6],
      hoehe: HOEHE_HOCH,
      ausgaenge: [0, 1],
      maxAnzahl: 1,
      minTiefe: 4,
      dekoMuster: ['sarkophage', 'mitte-altar', 'wandfackeln'],
      materialTag: 0,
    },
    {
      typ: 'abschluss',
      gewicht: 6,
      breite: [1, 2],
      tiefe: [1, 2],
      hoehe: HOEHE_NIEDRIG,
      ausgaenge: [0, 0],
      dekoMuster: ['bodenschutt'],
      materialTag: 1,
    },
  ],
  gangLaenge: GANG_LAENGE,
  ebenen: [1, 2],
  schleifenAnteil: 0.45,
  tuerChance: 0.22,
  tuerArten: ['steinplatte', 'holz', 'gitter', 'bogen'],
  zielZellen: [220, 340],
  materialSatz: 'barrow',
  // Dieselbe Umgebung, die der Altbestand fuer `DG_Steingrab` fuehrt
  // (`INTERIOR_ENV` in `shared/src/dungeons.ts`) — der Wechsel auf 2.0 soll das
  // LICHT nicht mit umstellen, sonst misst man zwei Aenderungen als eine.
  // The same environment legacy keeps for `DG_Steingrab` — moving to 2.0 must
  // not also change the LIGHT, or two changes get measured as one.
  innenUmgebung: 'Crypt',
  // Prefabnamen ohne Registry-Eintrag sind PLATZHALTER fuer die Tripo-Unikate
  // (Altar, Sarkophag, Saeule, Urne); der Bestuecker (eigenes Paket) gleicht
  // sie gegen `shared/src/prefabs.ts` ab. Der Generator liest diese Tabelle
  // NICHT — er setzt nur Rollen.
  // Prefab names without a registry entry are PLACEHOLDERS for the Tripo
  // one-offs (altar, sarcophagus, pillar, urn); the furnisher (its own package)
  // reconciles them against `shared/src/prefabs.ts`. The generator does NOT read
  // this table — it only sets roles.
  dekoTabellen: {
    fackel: [
      { prefab: 'CryptWallTorch', gewicht: 3 },
      { prefab: 'piece_walltorch', gewicht: 1 },
    ],
    geroell: [
      { prefab: 'Steingrab_Geroell_A', gewicht: 2 },
      { prefab: 'Steingrab_Geroell_B', gewicht: 1 },
    ],
    altar: [{ prefab: 'Steingrab_Altar', gewicht: 1 }],
    sarkophag: [{ prefab: 'Steingrab_Sarkophag', gewicht: 1 }],
    truhe: [
      { prefab: 'TreasureChest_meadows', gewicht: 2 },
      // `HolzTruhe`, nicht `chest_wood`: `chest_wood` ist der MODELLNAME des
      // Eintrags, nicht sein Prefabname (s. `shared/src/prefabs.ts`). Hier
      // stehen Prefabnamen — `findPrefabByName('chest_wood')` ist `undefined`,
      // und die Materialisierung laesst einen unbekannten Anker ausdruecklich
      // WEG (`Materialisierung2.ts`, `ohnePrefab`). Auf wov-dev sah man das am
      // 29.08.2026 als „0 ZDOs, 1 anchor without a registered prefab" bei
      // `steingrab-2` — dem einzigen Grab, dessen Deko-Wurf auf diese Zeile
      // fiel. Die Truhe fehlte dort ganz, und zwar wortlos.
      // `HolzTruhe`, not `chest_wood`: the latter is the MODEL name of that
      // registry entry, not its prefab name. This table holds prefab names,
      // and an unknown one is silently dropped during materialisation.
      { prefab: 'HolzTruhe', gewicht: 1 },
    ],
    saeule: [{ prefab: 'Steingrab_Saeule', gewicht: 1 }],
    urne: [{ prefab: 'Steingrab_Urne', gewicht: 1 }],
    spawner: [{ prefab: 'Spawner_Skeleton', gewicht: 1 }],
  },
};

/**
 * Alle bekannten Themen. Reine Datenliste — kein Registrierungsaufruf, damit
 * die `sideEffects: false`-Zusage haelt.
 * All known themes. A plain data list — no registration call, so the
 * `sideEffects: false` promise holds.
 */
export const THEMEN: readonly ThemenProfil[] = [STEINGRAB];

/** Thema zu einer Kennung, oder `undefined`. / Theme by id, or `undefined`. */
export function themaFinden(id: string): ThemenProfil | undefined {
  return THEMEN.find((t) => t.id === id);
}

/**
 * Vierteldrehung, mit der ein an dieser Kante haengendes Deko-Stueck in den
 * Raum blickt. Nord = 0, dann im Uhrzeigersinn — die Umkehrung der
 * Nord/Ost/Sued/West-Bitfolge aus `layout.ts`.
 * Quarter turn with which a decor piece hanging on this edge faces into the
 * room. North = 0, then clockwise — the inverse of the north/east/south/west bit
 * order from `layout.ts`.
 */
export function kanteZuDrehung(kante: Kante): 0 | 1 | 2 | 3 {
  if (kante === KANTE.Nord) return 0;
  if (kante === KANTE.Ost) return 1;
  if (kante === KANTE.Sued) return 2;
  return 3;
}
