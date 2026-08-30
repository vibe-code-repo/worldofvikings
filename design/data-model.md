# Dungeon Generator 2.0 — Datenmodell, Generator, Geometrie-Bauer, Adapter

Entwurf vom 30.08.2026, Worktree `/home/mike/wov-wt-dungeon2`, Branch `dungeon-generator-2`.
Maßgebliche Beschlüsse: `02 Projekte/World-of-Vikings/Dungeon Generator 2.0.md` (Vault).
Gültig bleibende Instanz-Infrastruktur: `Dungeon-Instanzen sind eigene Welten`, `Konzept Dungeons und Instanzen` (Ebene 4).

Dieses Dokument beschreibt **vier Verträge**: das Layout-Format, den Generator darauf, den Geometrie-Bauer und den Adapter an die vorhandene Instanz-Infrastruktur. Es benennt am Ende, welche Altdateien `LEGACY` werden.

---

## 0. Bestandsaufnahme — was der Code heute wirklich tut

Vier Befunde aus dem Worktree, die den Entwurf tragen. Sie stehen vorweg, weil drei davon einer verbreiteten Annahme widersprechen.

**1. Der Server prüft keine Kollision.** `grep -ni "kollision|collision" server/src` liefert fünf Treffer, keiner davon ist Geometrie (Spawn-Kommentar, Hash-Kollisionsraum, ZDO-UIDs). Die gesamte Physik liegt im Client: `client/src/engine/Physics.ts`, Havok, und die Kollisionsform wird **aus der GLB gemessen** (Kopfkommentar: „the Unity prefabs' colliders are not in our asset export … so the shapes are measured from the GLBs at load time"). Der Satz aus dem Beschluss — „Geometrie-Bauer deterministisch in `shared/` (Server braucht ihn für Kollision)" — beschreibt also ein **Ziel**, keinen Ist-Zustand. Der Vertrag unten ist deshalb so geschnitten, dass der Server die Kollision *bekommen kann*, ohne dass der Client dafür umgebaut wird; heute ist der erste Verwender der Kollisionsliste die NPC-Wegfindung und die Spawn-Platzprüfung.

**2. Das heutige Layout ist eine Liste von Prefab-Instanzen, kein Grundriss.** `DungeonLayout = { rooms: PlacedRoom[], doors: PlacedDoor[], props: PlacedProp[] }` (`shared/src/dungeons.ts`). Jeder `PlacedRoom` trägt `pos: Vector3` und `rot: Quaternion` — **Fließkomma**, entstanden aus Quaternionenketten in `calculateRoomPosRot`. Der Sanitizer normalisiert Quaternionen bewusst *nicht*, wenn sie schon nahe bei 1 liegen, „normalizing healthy ones would shift f32-precision generator output on every save/load cycle". Das ist die ehrlichste Zeile im ganzen Altbestand: **Der heutige Determinismus hängt an Fließkomma-Bitmustern.** Das neue Format kommt deshalb ohne Fließkomma aus (§1.1).

**3. Die Instanz-Infrastruktur ist sauber und bleibt.** `DungeonManager` (652 Zeilen) besteht aus vier Teilen — Dokumente, Eingangs-Registry, Instanzen/Welten, Regen-Tick. Genau **eine** private Methode berührt Geometrie: `materialize()`. Dazu `getSpawnPoint()` und `dekoAngleichen()`. Alles andere ist geometriefrei. Der Adapter ist damit klein (§4).

**4. `generateCampLayout` steht in derselben Datei wie der Dungeon-Generator und ist NICHT Legacy.** `shared/src/dungeonGenerator.ts` enthält ab Zeile 623 die Lager-Erzeugung (CampRadial) für Dörfer, Höfe und Goblinlager — **Oberweltinhalt**, der mit Dungeons nichts zu tun hat und weiterlebt. Wer die Datei als Ganzes `LEGACY` stempelt, stempelt die Oberwelt mit. Sie muss vorher geteilt werden (§5).

---

## 1. Das Layout-Datenformat

Modul: **`shared/src/dungeon2/layout.ts`** (Typen, Konstanten, Kanonisierung, Prüfsumme).

### 1.1 Der tragende Grundsatz: das Dokument enthält keine Fließkommazahlen

Jede Koordinate im Layout ist eine **Ganzzahl** — Zellenindex, Ebenenindex, Höhenstufe, Vierteldrehung. Meter entstehen erst im Geometrie-Bauer, durch Multiplikation mit den Rasterkonstanten, und zwar auf beiden Seiten mit derselben Funktion.

Das ist keine Ästhetik, es löst vier Probleme auf einmal:

- **Determinismus wird nachweisbar** statt geglaubt. Zwei Layouts sind gleich, wenn ihre kanonische Serialisierung Byte für Byte gleich ist. Über Fließkomma ließ sich das nie sagen (siehe Befund 2).
- **Server und Client können nicht auseinanderlaufen**, weil es nichts gibt, worin sie sich um ein ULP unterscheiden könnten. Die Notiz „Node-Krypto ist nicht Browser-Krypto" beschreibt dieselbe Fehlerklasse eine Ebene tiefer.
- **Speichern und Laden ist verlustfrei.** Der Kunstgriff im heutigen Sanitizer (Quaternionen nur reparieren, wenn sie kaputt sind) wird überflüssig.
- **Das Dokument bleibt klein.** Ein 60-Raum-Grab sind ~40 Stempel und ein paar Dutzend Zellen-Korrekturen, nicht 500 Transformationsmatrizen.

### 1.2 Raster und Einheiten

```ts
/**
 * Rasterkonstanten. Sie stehen ZUSÄTZLICH im Dokument (`raster`), weil eine
 * Konstante sich ändern kann und ein altes Dokument dann still umgedeutet
 * würde.
 * Grid constants. They are ALSO written into each document, because a
 * constant can change and an old document would then be silently reinterpreted.
 */
export const ZELLE_M = 4;          // Kantenlänge einer Zelle / cell edge length
export const EBENE_M = 8;          // Stockwerkshöhe / storey height
export const HOEHEN_SCHRITT_M = 0.5; // feinste Höhenstufe / finest height step
export const MIN_LICHTE_STUFEN = 8;  // 4 m — Mindesthöhe / minimum headroom
```

`ZELLE_M = 4`, `EBENE_M = 8` und die 4-m-Mindesthöhe sind **nicht neu erfunden**, sondern die belegten Werte aus `shared/src/dungeonRaster.ts` (dreizehn Vorlage-Kits, Figurenmaße `BODY_RADIUS 0.4` / `BODY_HEIGHT 1.8`, Z-Fighting-Rechnung für die Stockwerkshöhe). Die Herleitung überlebt den Neubau, das Modul, in dem sie stand, nicht. `HOEHEN_SCHRITT_M = 0.5` ist neu: Der GLB-Bauteilsatz konnte keine Zwischenhöhen, prozedurale Geometrie kann es, und eine Stufe von 0,5 m ist die feinste, die man beim Gehen noch als Absatz und nicht als Ruckeln wahrnimmt.

### 1.3 Die Zelle

```ts
/** Kanten einer Zelle als Bitmaske. / Cell edges as a bit mask. */
export const enum Kante { Nord = 1, Ost = 2, Sued = 4, West = 8 }

export const enum ZellenArt {
  Leer = 0,      // Fels — nicht begehbar / solid rock, not walkable
  Boden = 1,     // waagerechte Standfläche / flat walkable floor
  Treppe = 2,    // geneigt, überwindet Höhenstufen / sloped, spans height steps
  Schacht = 3,   // offen nach oben/unten (Leiter, Loch) / vertical opening
  Wasser = 4,    // Boden unter Wasserspiegel / floor below water level
}

export interface Zelle {
  /** Rasterkoordinaten, Ganzzahlen. / Grid coordinates, integers. */
  readonly x: number;
  readonly z: number;
  /** Stockwerk. Höhe der Ebene = ebene * EBENE_M. / Storey. */
  readonly ebene: number;

  readonly art: ZellenArt;

  /**
   * Bodenhöhe in HOEHEN_SCHRITT_M, RELATIV zur Ebene. Bei einer Treppe die
   * Höhe an der Kante mit dem kleineren Index (siehe `neigung`).
   * Floor height in height steps, RELATIVE to the storey.
   */
  readonly boden: number;
  /** Deckenhöhe in HOEHEN_SCHRITT_M über dem Boden DIESER Zelle. */
  readonly decke: number;
  /** Nur bei Treppe: Richtung des Anstiegs. / Ascent direction, stairs only. */
  readonly neigung?: Kante;

  /**
   * Wand ERZWINGEN an diesen Kanten, auch wenn die Nachbarzelle begehbar ist.
   * Force a wall on these edges even if the neighbour is walkable.
   */
  readonly wandErzwungen: number;
  /**
   * Durchgang ERZWINGEN — keine Wand, auch wenn die Ableitung eine setzen
   * würde. Schlägt `wandErzwungen` (auch das der Nachbarzelle).
   * Force an opening; beats `wandErzwungen`, including the neighbour's.
   */
  readonly durchgangErzwungen: number;

  /** Materialkennung — Index in den Materialsatz des Themas. */
  readonly materialTag: number;
  /** Zusatzmerkmale für das Material-Blending (Moos, Feuchte, Ruß, Riss). */
  readonly oberflaeche: number;

  /** Stempel, aus dem diese Zelle stammt — oder -1 für Handarbeit. */
  readonly stempelId: number;
}
```

**Wände werden abgeleitet, nicht gespeichert.** Der Regelfall ist: Zwischen zwei Zellen steht eine Wand, wenn genau eine von beiden begehbar ist, oder wenn beide begehbar sind und ihre Bodenhöhen um mehr als eine Stufe auseinanderliegen. Gespeichert werden nur die **Abweichungen** — `wandErzwungen` (eine Trennwand mitten im Saal) und `durchgangErzwungen` (ein Loch in einer Außenwand, das der Autor will).

Die Auflösungsregel ist bewusst **symmetrisch**:

```
Wand(A,B)  =  ( abgeleitet(A,B) ∨ erzwungen_A ∨ erzwungen_B )
              ∧ ¬( durchgang_A ∨ durchgang_B )
```

Damit hängt das Ergebnis nicht davon ab, welche der beiden Zellen zuerst besucht wird. Eine Regel „die Zelle mit dem kleineren Index gewinnt" wäre die Sorte Detail, die genau einmal falsch herum implementiert wird und dann eine Wand erzeugt, die je nach Blickrichtung da ist oder nicht.

### 1.4 Raum-Stempel

```ts
export type RaumTyp =
  | 'eingang' | 'gang' | 'kammer' | 'saal'
  | 'schatzkammer' | 'grabkammer' | 'treppe' | 'nische' | 'abschluss';

export interface RaumStempel {
  /** Stabil über die Lebenszeit des Dokuments; wird nie neu vergeben. */
  readonly id: number;
  readonly typ: RaumTyp;

  /** Ankerzelle (kleinste x/z-Ecke vor der Drehung). / Anchor cell. */
  readonly x: number;
  readonly z: number;
  readonly ebene: number;
  /** Ausdehnung in Zellen. / Footprint in cells. */
  readonly breite: number;
  readonly tiefe: number;
  /** Höhe über dem Raumboden, in HOEHEN_SCHRITT_M. */
  readonly hoehe: number;
  /** Anhebung des Raumbodens gegenüber der Ebene, in HOEHEN_SCHRITT_M. */
  readonly bodenVersatz: number;

  /** Vierteldrehungen um die Hochachse. 0..3, keine anderen Winkel. */
  readonly drehung: 0 | 1 | 2 | 3;

  /** Eigener Deko-Seed dieses Raums — siehe §2.5. */
  readonly seed: number;
  /** Themenvariante (Materialsatz-Index). */
  readonly variante: number;

  /**
   * Reihenfolge beim Auftragen. Spätere Stempel überschreiben die Zellen
   * früherer. Damit ist „Gang durch Saal" definiert statt zufällig.
   * Stamp order; later stamps overwrite earlier cells.
   */
  readonly ordnung: number;

  /** Tiefe im Wachstumsbaum (0 = Eingang) — für Inhaltsverteilung. */
  readonly tiefe_im_baum: number;
}
```

**Stempel sind die Autorenschicht, Zellen sind die Wahrheit.** Das Dokument speichert **Stempel plus Zellen-Korrekturen**, nicht die ausgerollten Zellen:

```ts
/** Eine von Hand geänderte Zelle. Wird NACH allen Stempeln aufgetragen. */
export interface ZellenKorrektur {
  readonly x: number;
  readonly z: number;
  readonly ebene: number;
  /** Teilweise Überschreibung; fehlende Felder behalten den Stempelwert. */
  readonly aendere: Partial<Omit<Zelle, 'x' | 'z' | 'ebene'>>;
  /** true = Zelle ganz entfernen (Fels). / true = carve the cell away. */
  readonly loeschen?: boolean;
}
```

Die ausgerollte Zellmenge entsteht durch eine reine Funktion:

```ts
export function zellenAufbauen(layout: DungeonLayout2): ZellenGitter;
```

Warum nicht die Zellen speichern: Dann könnte der Editor „diesen Saal eine Nummer größer" nicht mehr, und ein Themenwechsel müsste jede Zelle einzeln anfassen. Warum nicht *nur* die Stempel: Dann ist die Zellen-Ebene des Editors eine Lüge. Beides zu haben kostet eine Funktion und löst beides.

### 1.5 Türen

```ts
export interface Tuer {
  /** Zelle und Kante, an der die Tür steht — kanonisiert (siehe unten). */
  readonly x: number;
  readonly z: number;
  readonly ebene: number;
  readonly kante: Kante;
  /** Türart aus dem Themenprofil ('holz', 'gitter', 'bogen', 'steinplatte'). */
  readonly art: string;
  readonly zustand: 'offen' | 'zu' | 'verschlossen';
  /** Schlüsselkennung bei `verschlossen`. */
  readonly schluessel?: string;
}
```

Eine Tür sitzt auf einer Kante, und eine Kante gehört zwei Zellen. Gespeichert wird sie **immer an der Zelle mit dem kleineren (`ebene`, `z`, `x`)** — der Schreibweg kanonisiert das, nicht der Leseweg. Eine Tür impliziert `durchgangErzwungen` auf ihrer Kante; wer eine Tür setzt, muss die Wand nicht extra öffnen.

### 1.6 Deko-Anker

```ts
export const enum AnkerOrt { Wand = 0, Boden = 1, Decke = 2, Ecke = 3 }

export interface DekoAnker {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly ebene: number;
  readonly ort: AnkerOrt;
  /** Bei Wand/Ecke: welche Kante. / Which edge, for wall/corner anchors. */
  readonly kante?: Kante;
  /**
   * Versatz innerhalb der Zelle, in Achteln einer Zelle (0..8) bzw. in
   * HOEHEN_SCHRITT_M für die Höhe. Ganzzahlen — s. §1.1.
   */
  readonly u: number;
  readonly v: number;
  readonly h: number;
  readonly drehung: 0 | 1 | 2 | 3;

  /**
   * Die ROLLE, nicht das Prefab: 'fackel', 'truhe', 'altar', 'sarkophag',
   * 'spawner', 'saeule', 'geroell'. Welches Modell daraus wird, entscheidet
   * der Bestücker aus der Themen-Tabelle und `seed`.
   * The ROLE, not the prefab — the furnisher resolves it.
   */
  readonly rolle: string;
  /** Von Hand festgenagelt: dieses Prefab und kein anderes. */
  readonly prefab?: string;
  readonly seed: number;
  /** Stempel, zu dem der Anker gehört — geht mit ihm, wenn er entfernt wird. */
  readonly stempelId: number;
}
```

Der Anker ist ein **Platz**, keine Instanz. Das ist der Unterschied zum heutigen `PlacedProp`, der einen `prefabHash` trägt und damit jedes Layout an den Modellbestand des Tages bindet. Ein neues Fackelmodell soll in alten Gräbern auftauchen können, ohne dass 3.596 Dokumente angefasst werden; ein von Hand gesetzter Altar soll trotzdem der Altar bleiben — dafür ist `prefab` da.

`stempelId` ersetzt den heutigen `roomIndex`. Der Grund steht in der Vault-Notiz: `removeRoom` muss die Indizes aller nachfolgenden Räume nachziehen, und „auffallen würde das erst, wenn beim Entfernen eines zweiten Raums die Fackeln eines dritten verschwinden". Eine **nie neu vergebene ID** hat dieses Problem nicht.

### 1.7 Seeds — drei, nicht einer

```ts
export interface LayoutSeeds {
  /** Grundriss: Stempel, Gänge, Ebenen, Schleifen. */
  readonly architektur: number;
  /** Oberflächen: Materialvariation, Moos, Feuchte, Verschmutzung. */
  readonly material: number;
  /** Bestückung: welches Prefab an welchem Anker. */
  readonly deko: number;
}
```

Getrennt, weil sie getrennte Folgen haben. Den Materialseed neu würfeln heißt: **der Server merkt es nicht** — keine ZDOs ändern sich, keine Instanz muss abgerissen werden, der Client baut anders aussehende Wände an denselben Stellen. Den Architekturseed neu würfeln heißt: alles neu. Ein einziger Seed würde diese Unterscheidung unmöglich machen und jedes „sieht mir zu grün aus" zu einem Neuaufbau der Instanz.

### 1.8 Das Dokument

```ts
export const LAYOUT_FORMAT = 'wov-dungeon-layout' as const;
export const LAYOUT_VERSION = 1;

export interface DungeonLayout2 {
  /** Unterscheidungsmerkmal gegen das Altformat — s. §4.1. */
  readonly format: typeof LAYOUT_FORMAT;
  readonly version: number;

  readonly id: string;      // isValidDungeonId(), unverändert
  readonly name: string;

  /** Themenprofil: Raumtypen, Gewichte, Materialsatz, Deko-Tabellen. */
  readonly thema: string;   // z. B. 'steingrab'

  readonly seeds: LayoutSeeds;

  /**
   * Die Rasterwerte, mit denen dieses Dokument erzeugt wurde. Mitgeschrieben
   * und NICHT angenommen: Ändert sich die Konstante, wird ein altes Dokument
   * sonst still umgedeutet.
   * The grid this document was built with — written down, never assumed.
   */
  readonly raster: {
    readonly zelleM: number;
    readonly ebeneM: number;
    readonly hoehenSchrittM: number;
  };

  /** Wachstumsgrenzen in ZELLEN, nicht in Metern. */
  readonly grenzen: {
    readonly minX: number; readonly maxX: number;
    readonly minZ: number; readonly maxZ: number;
    readonly minEbene: number; readonly maxEbene: number;
  };

  /** Die Eingangszelle und die Kante, durch die man hereinkommt. */
  readonly eingang: {
    readonly x: number; readonly z: number;
    readonly ebene: number; readonly kante: Kante;
  };

  readonly stempel: readonly RaumStempel[];
  readonly korrekturen: readonly ZellenKorrektur[];
  readonly tueren: readonly Tuer[];
  readonly anker: readonly DekoAnker[];

  /**
   * FNV-1a über die kanonische Serialisierung ALLES OBIGE außer diesem Feld.
   * Der Zeuge, an dem sich zeigt, ob Server und Client dasselbe Grab meinen.
   * The witness that server and client mean the same dungeon.
   */
  readonly pruefsumme: string;
}
```

Erzeugungsart und Herkunft stehen **nicht** im Layout, sondern im Instanz-Dokument (§4.1). Das Layout beantwortet die Frage „wie sieht dieser Dungeon aus", nicht „woher kommt er".

### 1.9 Kanonisierung, Prüfsumme, Versionierung

```ts
/** Deterministische Serialisierung: sortierte Listen, feste Feldreihenfolge. */
export function kanonisch(layout: DungeonLayout2): string;
/** FNV-1a über `kanonisch()`. Reine Funktion, keine Krypto — s. u. */
export function layoutPruefsumme(layout: DungeonLayout2): string;
/** Kette reiner Schritte v_n → v_{n+1}. Nie im Sanitizer. */
export function migriere(roh: unknown): DungeonLayout2 | null;
```

Drei Festlegungen:

- **Sortiert wird vor dem Serialisieren.** Stempel nach `ordnung`, dann `id`; Korrekturen, Türen und Anker nach (`ebene`, `z`, `x`, Unterscheidungsfeld). Eine `Map`-Iterationsreihenfolge darf nie in die Prüfsumme eingehen.
- **FNV-1a und kein HMAC.** Die Prüfsumme ist ein Zeuge gegen Auseinanderlaufen, keine Absicherung gegen einen Angreifer — das Dokument kommt ohnehin durch den Sanitizer. Und die Notiz „Node-Krypto ist nicht Browser-Krypto" beschreibt genau die Falle, in die man tritt, wenn man hier `crypto` nimmt: Es läuft auf einer Seite anders als auf der anderen, und zwar still.
- **Migration ist eine Kette einzelner Funktionen**, nicht ein wachsender Sanitizer. Der Sanitizer sagt „ist das gültig", die Migration sagt „was bedeutete das damals". Zwei Fragen, zwei Orte. Additive Felder bekommen trotzdem eine Versionserhöhung, weil sonst genau die Zahl entsteht, die zwei Dinge behauptet (der Fehler, den der heutige `DUNGEON_DOCUMENT_VERSION`-Kommentar beschreibt).

### 1.10 Invarianten — was ein gültiges Layout zusagt

Modul `shared/src/dungeon2/pruefung.ts`, benutzt von Generator (nach dem Bauen), Editor (nach jeder Änderung), Server (beim Laden) und Test.

| Regel | Warum |
|---|---|
| Jede begehbare Zelle ist vom Eingang aus erreichbar (Flutfüllung über offene Kanten) | Ein abgeschnittener Raum ist unsichtbar kaputt |
| `decke ≥ MIN_LICHTE_STUFEN` in jeder begehbaren Zelle | Sonst geduckt statt gewölbt (Herleitung aus `dungeonRaster.ts`) |
| Keine zwei begehbaren Zellen mit gleichem (x,z,ebene) | Der Zellenaufbau darf nicht doppelt belegen |
| Zwei Ebenen übereinander: Deckenoberkante unten < Bodenunterkante oben | Die Z-Fighting-Rechnung, die `DUNGEON_EBENE_M = 8` begründet hat |
| Jede Treppenzelle hat oben und unten je eine begehbare Nachbarzelle | Eine Treppe ins Nichts |
| Jede Tür sitzt auf einer Kante zwischen zwei begehbaren Zellen | Türen im Fels |
| Jeder Anker liegt in einer begehbaren Zelle; `Wand`-Anker an einer Kante mit Wand | Fackeln in der Luft |
| Alle Ganzzahlfelder sind ganzzahlig und endlich | Der Grundsatz aus §1.1, geprüft statt gehofft |
| `pruefsumme` stimmt mit `layoutPruefsumme()` überein | Der Zeuge |

Die Prüfung liefert `Befund[]` mit stabilem `regel`-Kurznamen — dieselbe Bauform wie `RasterBefund` heute, damit Tests und der Editor-Prüfbericht darauf filtern können.

---

## 2. Der Auto-Generator

Modul: **`shared/src/dungeon2/generator.ts`**, Profile in **`shared/src/dungeon2/themen.ts`**.

```ts
export function erzeugeLayout(
  thema: ThemenProfil,
  seeds: LayoutSeeds,
  vorgaben?: Partial<Erzeugungsvorgaben>
): DungeonLayout2;
```

Rein und deterministisch: gleiche Eingabe → gleiche Ausgabe, Byte für Byte, in Node und im Browser.

### 2.1 Der Zufallsgenerator

`XorShiftRandom` aus `shared/src/worldgen/Random.ts` bleibt — er ist bereits float32-genau portiert und projektweit im Einsatz. **Aber: mehrere Ströme statt einem.**

```ts
const architektur = new XorShiftRandom(seeds.architektur);
// Pro Raum ein eigener Strom, aus Seed und Stempel-ID gemischt.
// One stream per room, mixed from seed and stamp id.
const raumStrom = (id: number) => new XorShiftRandom(mische(seeds.deko, id));
```

Der Altgenerator hat **einen** Strom, und sein Kopfkommentar sagt: „draw order is part of the contract — do not reorder calls". Das ist wahr und teuer: Jede neue Eigenschaft, die irgendwo eine Zahl zieht, verschiebt alles danach. Mit Strömen je Raum bleibt eine lokale Änderung lokal — man kann im Editor einen Raum umdekorieren, ohne dass die Nachbarräume anders aussehen. Der Architekturstrom bleibt einer und behält die Regel; für ihn gilt zusätzlich: **neue Merkmale bekommen einen neuen Strom, keine zusätzlichen Ziehungen im alten.**

### 2.2 Das Themenprofil

```ts
export interface RaumTypProfil {
  readonly typ: RaumTyp;
  readonly gewicht: number;
  /** Ausdehnung in Zellen, inklusive. / Footprint range in cells. */
  readonly breite: readonly [number, number];
  readonly tiefe: readonly [number, number];
  /** Höhe in HOEHEN_SCHRITT_M. */
  readonly hoehe: readonly [number, number];
  /** Wie viele Ausgänge dieser Typ anbietet. */
  readonly ausgaenge: readonly [number, number];
  /** Höchstzahl im Dungeon (Schatzkammer: 1). */
  readonly maxAnzahl?: number;
  /** Frühestens ab dieser Baumtiefe (Grabkammer weit hinten). */
  readonly minTiefe?: number;
  /** Deko-Muster, die auf diesen Typ angewendet werden. */
  readonly dekoMuster: readonly string[];
  readonly materialTag: number;
}

export interface ThemenProfil {
  readonly id: string;              // 'steingrab'
  readonly raumTypen: readonly RaumTypProfil[];
  readonly gangLaenge: readonly [number, number];   // in Zellen
  readonly ebenen: readonly [number, number];
  /** Anteil der Sackgassen, die zu Schleifen verbunden werden (0..1). */
  readonly schleifenAnteil: number;
  readonly tuerChance: number;
  readonly tuerArten: readonly string[];
  /** Zielgröße in ZELLEN, nicht in Räumen — s. u. */
  readonly zielZellen: readonly [number, number];
  /** Verweis auf den Triplanar-Materialsatz des Bauers. */
  readonly materialSatz: string;
  /** Deko-Tabellen: Rolle → gewichtete Prefabliste. */
  readonly dekoTabellen: Readonly<Record<string, readonly { prefab: string; gewicht: number }[]>>;
}
```

**Zielgröße in Zellen, nicht in Räumen.** Der Altgenerator zählt `maxRooms` — und dessen eigener Kommentar muss dazuschreiben „Number of placement ATTEMPTS, not rooms (original naming)". Eine Raumzahl lügt außerdem, sobald Räume verschieden groß sind: 30 Nischen und 30 Säle sind nicht derselbe Dungeon. Zellen sind das Maß, das der Spieler als Länge erlebt.

### 2.3 Die Phasen

| # | Phase | Was passiert |
|---|---|---|
| P0 | Belegung anlegen | Dünnbesetztes Gitter `(ebene,x,z) → stempelId`, plus die Grenzen aus dem Profil |
| P1 | Eingang | Eingangsstempel auf `(0,0,0)`, Eingangskante nach `Sued`. Der Ursprung ist die Eingangszelle — wie heute der Eingangs-Connector |
| P2 | Wachstum | Schleife über die **Anschlussliste** (offene Kanten). Ziehe Index, ziehe Raumtyp gewichtet, ziehe Ausdehnung, prüfe Rechteck gegen Belegung + Grenzen, stemple. Bei Misserfolg bis zu `N` andere Typen, dann Anschluss schließen. Ende, wenn `zielZellen` erreicht oder die Liste leer ist |
| P3 | Gänge | Gänge sind gewöhnliche Stempel (1×L). Sie entstehen in P2 mit, nicht als Sonderweg — ein Gang ist ein Raumtyp |
| P4 | Ebenen | Treppenstempel spannen zwei Ebenen; die Belegungsprüfung läuft über **beide**. (Der Altgenerator hat genau hier gepatzt: `roomBodyFromFloor` existiert, weil die Treppe der erste Fall war, in dem der Prüfkörper um `size.y/2` danebenlag — im neuen Modell kann das nicht passieren, weil Böden und Decken ganzzahlig und ausdrücklich sind statt aus einem Ursprungsversatz erschlossen) |
| P5 | Schleifen | Paare benachbarter offener Anschlüsse suchen und nach `schleifenAnteil` zu Durchgängen verbinden. **Ohne diese Phase ist jeder erzeugte Dungeon ein Baum**, und Bäume laufen sich beim Spielen als Sackgassenparcours an |
| P6 | Pflichträume | Schatz-/Grabkammer an die tiefsten Blätter. Auswahl über kanonisch sortierte Kandidatenliste, nie über Iterationsreihenfolge |
| P7 | Abschlüsse | Übrige offene Anschlüsse zumauern (`wandErzwungen`) oder mit `nische`/`abschluss` schließen. Kein Notfallzweig, der ohne Prüfung setzt — im Zellmodell ist „zumauern" immer möglich, weil eine Wand kein Bauteil braucht |
| P8 | Türen | Auf Kanten zwischen zwei Stempeln, nach `tuerChance` und `tuerArten` |
| P9 | Deko-Anker | Je Stempel Muster aus `dekoMuster` anwenden, mit dem Raumstrom aus §2.1 |
| P10 | Abnahme | `pruefeLayout()` (§1.10). Ein Befund der Schwere `fehler` wirft — ein Generator, der kaputte Layouts ausliefert, verschiebt die Diagnose in den Client |

Bemerkenswert an P7: Der Altgenerator braucht dafür `endcapsFallbackByPrio`, `endcapsCollision`, `endcapsInsetFrac` und einen Zweig, der „force-place a candidate without collision check" macht — gemessene 163 solcher Notfallsetzungen über 40 Seeds. **Diese ganze Familie von Einstellungen verschwindet ersatzlos**, weil sie ein Problem löst, das nur entsteht, wenn Wände Bauteile mit Platzbedarf sind.

### 2.4 Determinismus — die Regeln, schriftlich

1. Kein `Math.random`, kein `Date`, kein `performance.now`.
2. Keine Entscheidung hängt an `Object.keys`, `Map`-Iteration oder `Set`-Iteration. Wo über eine Menge entschieden wird, wird vorher kanonisch sortiert.
3. Keine Fließkommazahl geht in die Ausgabe (§1.1). Interne Fließkommarechnung ist erlaubt, aber jedes Ergebnis wird ganzzahlig festgelegt, bevor es das Layout berührt.
4. Ziehreihenfolge des Architekturstroms ist Vertrag. Neue Merkmale bekommen einen eigenen Strom.
5. Prüfung: `test/dungeon2-determinismus.ts` erzeugt 100 Seeds und vergleicht gegen eingefrorene Prüfsummen; zusätzlich läuft derselbe Vergleich einmal im Browser-Bündel (die Notiz „Node-Krypto ist nicht Browser-Krypto" ist genau dieser Test, eine Ebene tiefer).

### 2.5 Der Bestücker

```ts
export function bestuecke(
  layout: DungeonLayout2, thema: ThemenProfil
): BestuecktesTeil[];   // { anker, prefab, prefabHash, pos, rot }
```

Getrennt vom Generator, weil er getrennt laufen muss: Der Server ruft ihn beim Materialisieren (ZDOs), der Editor beim Anzeigen. Und weil eine Änderung an den Deko-Tabellen dann **kein** neues Layout erzeugt — dieselben Anker, andere Modelle. Jeder Anker zieht aus `XorShiftRandom(mische(seeds.deko, anker.id))`, also aus seinem eigenen Strom; das Hinzufügen einer Fackel verschiebt keine andere.

---

## 3. Der Geometrie-Bauer

Modul: **`shared/src/dungeon2/bauer.ts`**. Rein, ohne Babylon, ohne DOM, ohne `node:`-Importe — er muss im Server, im Client und im Test laufen.

```ts
export function baueGeometrie(
  layout: DungeonLayout2,
  auswahl?: { bloecke?: readonly BlockId[] }   // blockweise, s. u.
): BauErgebnis;
```

### 3.1 Was herauskommt

```ts
export interface BauErgebnis {
  /** Sichtgeometrie, gruppiert nach Block und Materialkennung. */
  readonly stuecke: readonly BauStueck[];
  /** Kollisionskörper — EIGENE Liste, nicht „die Meshes". */
  readonly kollision: readonly KollisionsKoerper[];
  /** Begehbares Gitter für NPC-Wegfindung und Spawn-Platzprüfung. */
  readonly nav: readonly NavZelle[];
  /** Aufgelöste Ankerplätze in Metern (Eingabe für den Bestücker/ZDOs). */
  readonly dekoPlaetze: readonly DekoPlatz[];
  /** Wo ein Spieler beim Betreten steht — ausdrücklich, nicht hergeleitet. */
  readonly spawnPunkt: Vector3;
  readonly huelle: { readonly min: Vector3; readonly max: Vector3 };
  readonly pruefsumme: string;
}

export interface BauStueck {
  readonly art: 'boden' | 'wand' | 'decke' | 'sims' | 'stufe' | 'tuerrahmen' | 'saeule' | 'kante';
  readonly block: BlockId;
  readonly materialTag: number;
  /** Alles in Metern, aus Ganzzahlen berechnet — nie akkumuliert addiert. */
  readonly mitte: Vector3;
  readonly groesse: Vector3;
  readonly drehung: 0 | 1 | 2 | 3;
  /**
   * Blend-Attribute für das Triplanar-Material, im Bauer ausgerechnet:
   * hoeheUeberBoden (m) und kantenAbstand (m) je Ecke. Sie wandern im
   * Client in UV2 — der Shader kann sie nicht selbst wissen.
   * Blend attributes for the triplanar material, computed here.
   */
  readonly blend: BlendAttribute;
}

export interface KollisionsKoerper {
  readonly form: 'box' | 'rampe';
  readonly mitte: Vector3;
  readonly groesse: Vector3;
  readonly drehung: 0 | 1 | 2 | 3;
  /** Nur bei 'rampe': Steigung in Höhenstufen je Zelle. */
  readonly steigung?: number;
}
```

### 3.2 Die fünf Vertragsregeln

**(1) Optik und Kollision sind zwei Ausgaben, nicht eine.** Heute misst der Client die Kollisionsform *aus dem geladenen Mesh* (`Physics.ts`, `PhysicsShapeMesh` für Dungeon-Räume). Damit ist die Kollision eine Folge der Optik — und Optik wird sich ändern (Simse, Bruchkanten, Risse, Deko-Geometrie), Kollision soll das nicht. Getrennte Listen heißen: Der Server kann die Kollision haben, ohne je ein Dreieck zu sehen; und ein Kunstpass ändert nicht das Laufgefühl.

**(2) Der Bauer würfelt nicht, er hasht.** Jede Variation (versetzte Steinreihe, unregelmäßige Kante, Moosfleck) entsteht aus `hash(x, z, ebene, seeds.material)`, nicht aus einem Zufallsstrom. Folge: Der Bauer ist **blockweise und in beliebiger Reihenfolge** aufrufbar — man kann die drei Blöcke um den Spawn zuerst bauen und den Rest nachziehen, ohne dass sich etwas ändert. Mit einem Strom ginge das nicht, und genau das ist der Unterschied zum Generator, der ziehen *muss*, weil seine Entscheidungen voneinander abhängen.

**(3) Meter entstehen durch Multiplikation, nie durch Addition.** `x * ZELLE_M`, nicht `vorige + ZELLE_M`. Bei 60 Zellen Kantenlänge ist der Unterschied rechnerisch klein und praktisch der zwischen „Wände stoßen zusammen" und „Wände haben einen Haarriss, den man nur an einer Stelle sieht".

**(4) Blöcke sind die Einheit von allem Weiteren.** `BlockId` fasst 8×8 Zellen einer Ebene zusammen. Daran hängen: gemergte Meshes (ein Draw Call je Block und Materialkennung), Sichtbarkeit/Occlusion, der Ladefortschritt beim Betreten, und später das Nachladen großer Gräber. 8×8 = 32 m Kante, das passt zur Sichtweite in engen Gängen.

**(5) Der Bauer kennt keine Grafikstufe.** Er liefert immer alles; was auf Stufe Niedrig weggelassen wird, entscheidet der Client-Adapter über `art` (Simse und Kanten fallen zuerst). Sonst wären Kollision und Optik grafikstufenabhängig verschieden — und ein Spieler auf Niedrig fiele durch den Boden, den er nicht sieht.

### 3.3 Client-Adapter

**`client/src/engine/DungeonBauer.ts`** — der einzige Ort mit Babylon-Bezug:

- je Block und `materialTag` ein gemergtes Mesh, Blend-Attribute in `uv2`;
- Material aus dem Triplanar-Plugin (`MaterialPluginBase`, Muster: `PbrNebelFix.ts`, `NebelRichtung.ts`, `StandardGammaFix.ts` — alle im Client vorhanden);
- ein `PhysicsShapeMesh` je Block, gebaut aus `kollision`, **nicht** aus der Sichtgeometrie;
- `dungeonBereit`-Zusage: Der Ladebildschirm blendet erst aus, wenn die Blöcke um den Spawn stehen. Die Vault-Notiz „Ladebildschirm hängt am Gelände" beschreibt den Grund — in einer Instanz gibt es kein `terrain.ready`, also braucht der Bauer ein eigenes.

**Serverseitig** (`server/src/world/dungeon/`): `kollision` und `nav` sind die Eingabe für NPC-Wegfindung und Spawn-Platzprüfung. Autoritative Spielerbewegung ist damit *möglich* geworden, aber nicht Teil dieses Entwurfs — heute prüft der Server nichts (Befund 1), und das eine Entscheidung für sich.

---

## 4. Der Adapter an die Instanz-Infrastruktur

### 4.1 Was das Instanz-Dokument ersetzt

Das heutige `DungeonDocument` (`{version, id, name, base, mode, seed, zoneSize, layout}`) wird ersetzt durch:

```ts
export const DUNGEON_DOKUMENT_VERSION_2 = 10;   // Sprung, s. u.

export interface DungeonDokument2 {
  readonly version: number;             // ≥ 10 = Format 2.0
  readonly id: string;                  // isValidDungeonId — unverändert
  readonly name: string;
  /** 'erzeugt' = aus Thema+Seeds reproduzierbar, 'gebaut' = Handarbeit. */
  readonly modus: 'erzeugt' | 'gebaut';
  readonly thema: string;
  readonly seeds: LayoutSeeds;
  /**
   * Bei 'erzeugt' fehlt das Layout — es entsteht aus Thema und Seeds.
   * Bei 'gebaut' steht es hier vollständig.
   * Absent for generated dungeons; the seed travels instead of the data.
   */
  readonly layout?: DungeonLayout2;
  /** Prüfsumme des erwarteten Layouts — auch bei 'erzeugt'. Der Zeuge. */
  readonly pruefsumme: string;
}
```

**Der Versionssprung von 2 auf 10 ist Absicht.** Damit unterscheidet ein `version >= 10` beide Formate ohne Zusatzfeld, und ein 2.0-Dokument kann nie versehentlich durch den Alt-Sanitizer laufen. `sanitizeDungeonDokument(raw)` wird zum Weichensteller: `version >= 10` → neuer Weg, sonst → `sanitizeDungeonDocument` (LEGACY, unverändert).

**Bei `modus: 'erzeugt'` reist der Seed und nicht das Layout.** Server und Client rufen beide `erzeugeLayout(thema, seeds)` und vergleichen `pruefsumme`. Gehen sie auseinander, lädt der Client das volle Dokument nach **und meldet es laut** — ein stiller Rückfall wäre die Bauform, bei der man ein Jahr später bemerkt, dass der Determinismus seit Monaten kaputt ist. Bei `modus: 'gebaut'` wird das Layout übertragen (einmalig beim Betreten, gzip; ein 60-Raum-Grab liegt im niedrigen zweistelligen kB-Bereich).

Ablage bleibt `server/data/dungeons/<id>.json`, `entrances.json` bleibt unverändert.

### 4.2 Was am `DungeonManager` unverändert bleibt

Alles außer drei Methoden:

- `load()`, `saveDocument()`, `deleteDocument()`, `listDocuments()` — bis auf den Weichensteller im Sanitizer;
- die **komplette Eingangs-Registry**: `registerEntrance`, `backfillFromFeatures`, `assignEntrance`, `findEntranceNear`, `saveEntrances`, `spawnEntranceHull`, `spawnAllEntranceHulls`. Die Eingangshüllen sind Oberweltmodelle und haben mit dem Dungeoninneren nichts zu tun;
- `getOrCreateInstance` / `destroyInstance` samt Welt-Anlegen, Slot-Verwaltung, ZDO-Zerstörungsreihenfolge (erst ZDOs, dann Welt — der Grund steht im Kommentar und gilt weiter);
- `tick()` mit `DUNGEON_REGEN_INTERVAL_MS`;
- `WovServer.enterDungeon` / `leaveDungeon`, `peer.dungeonReturn`, `charakterUmziehen`, das Leeren von `knownZDOs`, das Zerstören des alten Charakter-ZDOs vor dem Wechsel. **Alle drei Fallen aus der Vault-Notiz bleiben gelöst und werden nicht angefasst.**
- `interiorEnvironment(base)` — bekommt eine Themen-Variante (`interiorEnvironmentFuerThema(thema)`), die Aufrufstelle bleibt.

### 4.3 Was sich ändert

| Heute | 2.0 |
|---|---|
| `materialize()` → `flattenLayout()` → ein ZDO je Raumhülle (+ netViews, Türen, Deko) | `materialisiere2()` → `baueGeometrie()` + `bestuecke()` → ZDOs **nur** für Bewegliches/Interaktives: Türen, Truhen, Fackeln, Spawner, Kreaturen. **Architektur bekommt keine ZDOs mehr** |
| Client baut Räume aus GLBs, die er über Raum-ZDOs zugestellt bekommt | Client baut Architektur aus dem Layout, das er beim Betreten erhält bzw. aus dem Seed selbst erzeugt |
| `getSpawnPoint()` leitet 2 m Richtung Startraummitte her | `BauErgebnis.spawnPunkt` — ein ausdrücklicher Punkt statt einer Herleitung |
| `dekoAngleichen()` vergleicht `layout.props` | `ankerAngleichen()` vergleicht `anker` — dieselbe Bauform, dasselbe Ziel: **Deko ändern reißt die Instanz nicht ab** (sonst teleportiert jede gesetzte Fackel den Spieler an den Eingang) |
| `upsertDocument` vergleicht `rooms`/`doors` per `JSON.stringify` | vergleicht `pruefsumme` **ohne** Anker gegen `pruefsumme` **ohne** Anker. Sauberer und billiger als ein Stringvergleich, und es fällt keine neue Eigenschaft still durch |

Die ZDO-Ersparnis ist der Nebeneffekt, der die Zahl erklärt: Ein Steingrab mit 50 Räumen erzeugt heute 50 Raum-ZDOs plus Einrichtung; künftig sind es nur noch die interaktiven — Größenordnung ein Fünftel.

### 4.4 Betreten, Schritt für Schritt

1. `enterDungeon(peer, id)` — **unverändert**.
2. `getOrCreateInstance(id)` — unverändert bis auf `materialisiere2()`.
3. Der Server sendet im vorhandenen Teleport-Paket (das heute schon `dungeonId` und `interiorEnv` trägt) **zwei Felder mehr**: `thema` und `seeds` bei `modus: 'erzeugt'`, plus `pruefsumme`. Kein neuer Lebenszyklus, kein neues Protokollverfahren.
4. Bei `modus: 'gebaut'` folgt das Layout über eine eigene Anfrage (`RPC_DungeonLayout`), weil es zu groß für das Teleportpaket ist.
5. Client: `erzeugeLayout` bzw. Layout empfangen → `pruefeLayout` → `baueGeometrie` (Spawnblöcke zuerst) → `dungeonBereit` → Ladebildschirm aus.
6. `charakterUmziehen` in die Instanzwelt — unverändert.

### 4.5 Editor

Der Karteneditor-Modus `dungeons` (Etappe 4 des Altkonzepts) schreibt **dasselbe** `DungeonDokument2`. Zwei Ebenen, ein Format:

- **Stempel-Ebene**: Raumtyp wählen, aufs Raster setzen, drehen, Größe ziehen. Schreibt `stempel`.
- **Zellen-Ebene**: einzelne Zellen malen, Boden-/Deckenhöhe setzen, Wände erzwingen oder öffnen. Schreibt `korrekturen`.

Ein erzeugter Dungeon wird durch die erste Handänderung nicht zu `'gebaut'` — er behält `thema` und `seeds` und bekommt Korrekturen obendrauf. Erst wenn jemand die Stempel selbst anfasst, wird das Layout eingefroren und `modus` wechselt. Damit bleibt „regenerieren, meine Fackeln behalten" möglich, was heute nicht geht (`dungeon regen <id>` wirft die Deko weg).

Die Bau-Logik liegt in `shared/` (`zellenAufbauen`, `stempelSetzen`, `stempelEntfernen`, `pruefeLayout`) und wird von Editor, Generator und Server benutzt — **keine zweite Bau-Logik**, dieselbe Regel wie im Altkonzept, und sie hat sich bewährt.

Zwei Vorsichtsmaßnahmen aus dem Gedächtnis: Der Editor darf zum Erproben **nicht** in Mikes `dev.json` schreiben (eigene Erprobungskopie), und vor jedem Schreiben werden Änderungszeiten geprüft (parallele Sitzungen).

---

## 5. Was LEGACY wird

Regel aus dem Beschluss: markieren, nicht löschen; Sammelliste `LEGACY.md`; **ein** Lösch-Commit nach Mikes Abnahme.

### 5.1 Vorher aufteilen — sonst stempelt man die Oberwelt mit

`shared/src/dungeonGenerator.ts` muss **zuerst geteilt** werden:

- `shared/src/campGenerator.ts` ← `generateCampLayout`, `CampGround` (Zeilen 623–764). **Bleibt aktiv**, Oberweltinhalt, wird vom `ZoneManager` benutzt.
- Der Rest der Datei wird LEGACY.

Dasselbe gilt in kleinerem Maßstab für `shared/src/dungeons.ts`: Die Datei bleibt (Camps, `getDungeonByHash` für die Eingangserkennung, `ENTRANCE_HULL_MODELS`, `isValidDungeonId`, `interiorEnvironment`), aber ihr Abschnitt „Layout & document" wird als LEGACY-Block markiert.

### 5.2 Die Liste

| Datei / Symbol | Status | Grund |
|---|---|---|
| `shared/src/dungeonGenerator.ts` (ohne Camps) | **LEGACY** | Connector-Kopplung ersetzt durch Zellen |
| ↳ `generateDungeonLayout`, `DungeonGeneratorSettings`, `DEFAULT_GENERATOR_SETTINGS` | LEGACY | inkl. `endcaps*`, `roomsFlipped`, `roomsInsetSize`, `roomBodyFromFloor` — alle lösen Bauteilprobleme, die es nicht mehr gibt |
| ↳ `attachRoom`, `removeRoom`, `computeOpenConnections`, `OpenConnection` | LEGACY | ersetzt durch `stempelSetzen` / `stempelEntfernen` |
| ↳ `generateCampLayout`, `CampGround` | **bleibt** → nach `campGenerator.ts` | Oberwelt |
| `shared/src/dungeonFlatten.ts` | **LEGACY** | Layout → Raum-GLB-Instanzen; Architektur ist keine Prefabliste mehr |
| `shared/src/dungeonRaster.ts` | **LEGACY** | prüft GLB-Bauteile, die es nicht mehr gibt. **Die Konstanten und ihre Herleitung wandern nach `dungeon2/layout.ts`** |
| `shared/src/eigeneDungeons.ts` (`DG_Steingrab`, 687 Z.) | **LEGACY** | RoomDefs mit Connectors. `propTypes` wandert in `dungeon2/themen.ts` |
| `shared/src/dungeons.ts` — `RoomDef`, `RoomConnectionDef`, `PlacedRoom`, `PlacedDoor`, `PlacedProp`, `DungeonLayout`, `DungeonPropDef`, `sanitizeDungeonDocument`, `MAX_DUNGEON_*`, `DUNGEON_DOCUMENT_VERSION` | **LEGACY-Block** | Altformat; Rest der Datei bleibt |
| `shared/src/roomPieces.ts`, `roomPiecesData.json` (4,9 MB) | **LEGACY für Dungeons** | wird nur noch von Camps gelesen; nach dem Umbau prüfen, ob die Camps wirklich alle 289 Räume brauchen |
| `shared/test/dungeon-generator.ts`, `shared/test/dungeon-raster.ts` | **LEGACY** | ersetzt durch `dungeon2-determinismus.ts`, `dungeon2-invarianten.ts`, `dungeon2-bauer.ts` |
| `server/src/world/dungeon/DungeonManager.ts` — `materialize()`, `dekoAngleichen()`, `getSpawnPoint()` | **ersetzt** | Rest der Klasse bleibt |
| `client/src/ui/DungeonEditor.ts` (F4) | **LEGACY** | baut über Connectors |
| `client/src/ui/DekoPlatzierung.ts` | **LEGACY** | setzt `PlacedProp` mit `roomIndex` |
| `client/src/editor/DungeonGrundriss.ts`, `DungeonKatalog.ts`, `DungeonDokument.ts`, `DungeonSpeichern.ts` | **LEGACY** | Raumbibliothek + Connector-Grundriss; ersetzt durch das Zellen-Modul |
| `client/src/engine/Physics.ts` — Mesh-Collider-Zweig für Dungeon-Räume (`kind: 'mesh'`, ~Z. 134/143/553) | **LEGACY-Zweig** | Kollision kommt künftig aus `BauErgebnis.kollision`, nicht aus dem Mesh |
| `tools/steingrab-erzeugen.py`, `tools/dungeon-zusammensetzen.py` | **LEGACY** | erzeugen Architektur-GLBs |
| `assets/models/Steingrab*.glb` (liegt außerhalb des Repos) | **LEGACY** | Mike sichert `assets/` selbst — nicht löschen, nur aus `EIGENE_MODELLE` nehmen |
| `shared/src/prefabs.ts` — die Steingrab-Einträge in `EIGENE_MODELLE` und `MODELL_ALIAS` | **LEGACY-Einträge** | müssen zusammen mit dem Kit fallen, sonst zeigt die Registry auf Modelle ohne Verwender |

### 5.3 Neue Dateien

```
shared/src/dungeon2/layout.ts       Typen, Konstanten, Kanonisierung, Prüfsumme, Migration
shared/src/dungeon2/zellen.ts       Stempel + Korrekturen → Zellgitter, Wandableitung
shared/src/dungeon2/generator.ts    erzeugeLayout (P0–P10)
shared/src/dungeon2/themen.ts       ThemenProfil, 'steingrab' als erstes Thema
shared/src/dungeon2/bauer.ts        baueGeometrie (rein, ohne Babylon)
shared/src/dungeon2/bestuecker.ts   Anker → Prefabs
shared/src/dungeon2/pruefung.ts     Invarianten (§1.10)
shared/src/campGenerator.ts         herausgelöst, bleibt aktiv
client/src/engine/DungeonBauer.ts   Babylon-Adapter: Meshes, Havok, Blöcke, Bereitschaft
client/src/engine/DungeonMaterial.ts  Triplanar-MaterialPluginBase
server/src/world/dungeon/Materialisierung2.ts  ZDOs aus dekoPlaetze
LEGACY.md                           Sammelliste
```

---

## 6. Was noch bei Mike liegt

1. **Höhenschritt 0,5 m** — neu eingeführt (§1.2). Feiner erlaubt Absätze und Podeste, gröber wäre einfacher. Vor dem ersten Thema festzulegen; nachträglich ändert sich jede gespeicherte Höhe.
2. **Blockgröße 8×8 Zellen** (32 m) — bestimmt Draw Calls, Occlusion und Ladefortschritt. Sollte an der ersten Messung auf Stufe Mittel überprüft werden, nicht vorher entschieden.
3. **Schleifenanteil** (§2.3, P5) — wie sehr sich ein Grab in sich zurückbiegen soll. Das ist eine Spielgefühl-Entscheidung, keine technische; sie steht im Themenprofil und lässt sich jederzeit drehen.
4. **`modus: 'erzeugt'` überträgt den Seed statt des Layouts** (§4.1). Das ist der sparsame Weg und zugleich der, der Determinismusfehler sofort sichtbar macht. Wer lieber immer das volle Dokument schickt, bekommt weniger Aufregung und weniger Beweis.

---

## 7. Reihenfolge des Baus (Meilenstein 1)

Der Beschluss nennt als Meilenstein 1 den *begehbaren Auto-Dungeon auf wov-dev*. In dieser Reihenfolge trägt jeder Schritt den nächsten und ist für sich prüfbar:

1. `layout.ts` + `zellen.ts` + `pruefung.ts`, mit Test — ein von Hand geschriebenes Zwei-Raum-Layout, das die Invarianten besteht.
2. `bauer.ts` mit Test auf Prüfsumme und Hüllmaße — noch ohne Client, noch ohne Bilder.
3. `generator.ts` + `themen.ts` (`steingrab`), Determinismustest über 100 Seeds.
4. `DungeonBauer.ts` im Client: graue Kästen, Havok, Ladebereitschaft. **Hier das erste Rendering für Mike** — vor dem Material, weil ein Fehler im Grundriss unter einer schönen Oberfläche verschwindet.
5. `DungeonMaterial.ts`: Triplanar + Blending. Zweites Rendering.
6. Adapter (§4): `materialisiere2`, Weichensteller im Sanitizer, Teleportpaket. Betreten auf wov-dev.
7. Atmosphäre (SSAO, Godrays, SSR, Parallax) hinter Grafikstufen. Messung auf Stufe Mittel.
8. Editor-Modul.
9. `LEGACY.md` füllen — laufend ab Schritt 1, nicht am Ende.
