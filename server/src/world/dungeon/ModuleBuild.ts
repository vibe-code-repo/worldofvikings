/**
 * ModuleBuild.ts — ein Saal aus dem Editor, gebaut vom SPIELSERVER.
 *
 * ── Warum der Spielserver und nicht der Betriebsdienst ───────────────
 * Der Betriebsdienst (`admin/`) schreibt bewusst keine Dungeon-Daten und
 * begründet es selbst: anderer Prozess, kennt die `documents` des
 * Spielservers nicht. Der bestehende Schreibweg des Editors ist
 * `DungeonEditSave` über den Spielserver-Socket — der Modulbau bekommt
 * denselben Weg, dasselbe Tor und eine eigene, knappere Drossel.
 *
 * ── Was diese Datei ist: die EINZIGE Klemmenliste ────────────────────
 * `WovServer` liest aus dem Paket vier Zahlen und reicht sie hier
 * herein; jede Prüfung steht in `baueModul`, keine im Paketweg. Der
 * Grund ist nicht Ordnung, sondern Prüfbarkeit: Eine Klemme, die im
 * Socket-Handler sitzt, lässt sich nur mit einem laufenden Server
 * messen — und was sich schwer messen lässt, wird beim nächsten Umbau
 * still anders.
 *
 * ── Die zwei Tore ────────────────────────────────────────────────────
 * `peer.isAdmin` schützt heute nichts: `server/data/server.yml` trägt
 * `everyone-admin: true`, jeder verbundene Client ist Admin. Der zweite
 * Schalter `dungeons.modulbau` (Vorgabe FALSE) ist deshalb nicht Gürtel
 * zum Hosenträger, sondern das einzige Schloss, das heute wirklich zu
 * ist. Beide müssen zutreffen.
 *
 * ── Der Name kommt aus dem Mass, nicht aus dem Formular ──────────────
 * `Gen_StoneVaultHall<cx>x<cz>[r<raster>]`, vom Server gebildet (Mikes
 * Entscheidung zu offener Frage 2). Ein freier Name bräuchte einen
 * Zusatz gegen Doppelungen und wäre zugleich die erste Stelle, an der
 * ein Zeichen aus dem Netz zu einem Dateinamen würde. Das Raster steht
 * nur dann im Namen, wenn es die Geometrie WIRKLICH ändert — siehe
 * `modulName`.
 *
 * Namen sind unveränderlich: Live liegt `/assets/` sieben Tage im
 * Browsercache, und `AssetManager` cacht Container ausserdem prozessweit.
 * Eine ersetzte Datei unter gleichem Namen wäre bis zu eine Woche alt,
 * ohne dass es auffällt. Ein geänderter Saal ist deshalb ein NEUER Name,
 * und ein vorhandener Name ist eine Ablehnung.
 *
 * ── Der Dreiecksdeckel ist keine Zierde ──────────────────────────────
 * Säle haben KEIN `_col`-Netz — das sichtbare Netz IST die Havok-Form.
 * Jedes Dreieck ist begehbare Kollisionsgeometrie. Nachgerechnet:
 * 8×8 Zellen mit dem VORGABERASTER 2 ergeben 12·(2 + 1024 + 3·49)
 * = 14 076 Dreiecke und werden abgelehnt; dieselben 8×8 mit Raster 4
 * ergeben 12 636 und gehen durch. Der Deckel liegt also mitten im
 * erlaubten Bereich, nicht dahinter.
 *
 * ── Warum die Registry beim Start gelesen wird ───────────────────────
 * Die Nachschlagewerke sind Prozesszustand; ein Neustart vergisst jeden
 * zur Laufzeit gebauten Saal. Ein Dokument, das ihn benutzt, verlöre
 * seinen Raum dann STILL (`sanitizeDungeonDocument` verwirft unbekannte
 * Räume wortlos). Deshalb liest `ladeModulRegistrierung` die Datei beim
 * Start — und behandelt sie wie eine Eingabe, denn sie ist eine
 * Textdatei, die ein Mensch bearbeiten kann.
 *
 * Sprache: neue Bezeichner englisch, wo sie nicht an einen bestehenden
 * deutschen Namen andocken (Pakettyp `DungeonModulBau`, `pruefsumme`,
 * `nurManuell`).
 *
 * Builds a stone-vault hall on the game server: two gates, hard clamps,
 * a size-derived immutable name, GLB + registry on disk, and the
 * registration into the runtime lookups.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GRID_M, HEIGHT_M, buildHall, pillarPositions } from '@wov/shared/src/hallenGeometrie.js';
import { fnv1a32 } from '@wov/shared/src/dungeon2/layout.js';
import { registerModule, roomDefForHall } from '@wov/shared/src/moduleRegistry.js';
import { encodeGlb } from './GlbWriter.js';

// ── Klemmen ─────────────────────────────────────────────────────────────
/** Kleinster Saal: ein einzelliger „Saal" wäre ein Korridorstück. */
export const CELLS_MIN = 2;
/** Grösster Saal: 8 Zellen sind 16 m — darüber trägt der Dreiecksdeckel ohnehin nicht mehr. */
export const CELLS_MAX = 8;
/** Erlaubte Pfeilerraster in Metern. Vielfache von `GRID_M`, sonst wirft `pillarPositions`. */
export const RASTER_ERLAUBT: readonly number[] = [2, 4, 6];
export const GEWICHT_MIN = 0.1;
export const GEWICHT_MAX = 2.0;
/** Harter Deckel: das sichtbare Netz ist die Kollisionsform (siehe Kopf). */
export const DREIECKS_DECKEL = 13_000;

/** Das Kit, zu dem gebaute Säle gehören. Heute gibt es genau eines. */
export const KIT_NAME = 'DG_StoneVault';
/** Namenspräfix — zugleich die Auskunft an den `AssetManager`, wo die Datei liegt (E7). */
export const NAME_PRAEFIX = 'Gen_StoneVaultHall';
/**
 * Die Form, die ein Modulname haben MUSS, bevor aus ihm ein Pfad wird.
 * Buchstaben und Ziffern, 1…16 Zeichen hinter dem Präfix — dieselbe
 * Bauart wie die Erlaubnisliste der Dungeon-ID im Betriebsdienst.
 */
export const NAME_MUSTER = /^Gen_StoneVaultHall[A-Za-z0-9]{1,16}$/;

export const REGISTRY_DATEI = 'modul-registry.json';
export const REGISTRY_VERSION = 1;

/**
 * Der Ordner, in den gebaute Module gehen: `assets/generiert/`, NICHT
 * `assets/models/`. Dort ist `assets/manifest.json` git-getrackt und der
 * Manifest-Test rekursiert über alle Unterordner — ein Server, der dort
 * hineinschriebe, machte den Testlauf rot und hinterliesse auf jeder
 * Maschine mit Modellen eine ungetrackte Änderung an einer getrackten
 * Datei (E7).
 */
export const GENERIERT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../assets/generiert'
);

// ── Typen ───────────────────────────────────────────────────────────────
/** Was der Client schickt: vier Zahlen, kein Name, kein Pfad. */
export interface ModulBauWunsch {
  readonly cellsX: number;
  readonly cellsZ: number;
  readonly raster: number;
  readonly weight: number;
}

/** Was der Server dazu weiss — beides Tore, plus der Zielordner. */
export interface ModulBauKontext {
  readonly istAdmin: boolean;
  readonly modulbauErlaubt: boolean;
  readonly verzeichnis: string;
}

/** Ein Eintrag der Registry-Datei. Deutsche Schlüssel wie in der Konzeptnotiz. */
export interface RegistryModul {
  readonly kit: string;
  readonly name: string;
  readonly zellenX: number;
  readonly zellenZ: number;
  readonly pfeilerRaster: number;
  readonly gewicht: number;
  readonly tris: number;
  readonly erzeugt: string;
}

export interface RegistryDatei {
  readonly version: number;
  readonly pruefsumme: string;
  readonly module: RegistryModul[];
}

export interface ModulBauErgebnis {
  readonly name: string;
  readonly cellsX: number;
  readonly cellsZ: number;
  readonly raster: number;
  readonly weight: number;
  readonly tris: number;
  readonly vertices: number;
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly datei: string;
  readonly pruefsumme: string;
}

export type ModulBauAntwort =
  | { readonly ok: true; readonly ergebnis: ModulBauErgebnis }
  | { readonly ok: false; readonly meldung: string };

// ── Rechnung ────────────────────────────────────────────────────────────
/**
 * Die Dreieckszahl eines Saals OHNE ihn zu bauen — die geschlossene
 * Formel aus der Konzeptnotiz: 12·(2 + 16·cx·cz + 3·P).
 *
 * Sie steht hier, weil der Deckel VOR dem Bau greifen muss: Ein Saal,
 * den man erst baut und dann verwirft, hat schon 14 000 Quader im
 * Speicher gehabt — und im Registry-Leser gibt es gar keine Geometrie,
 * nur Zahlen aus einer Textdatei.
 */
export function dreiecke(cellsX: number, cellsZ: number, raster: number): number {
  const pfeiler = pillarPositions(cellsX, cellsZ, raster).length;
  return 12 * (2 + 16 * cellsX * cellsZ + 3 * pfeiler);
}

/**
 * Das Raster, das im Namen steht — und das ist NICHT immer das gewünschte.
 *
 * Gemessen statt angenommen: Ein 2×2-Saal ist 4 m breit, liegt also unter
 * der Pfeilerspanne und bekommt unter JEDEM Raster null Pfeiler; bei 2×4
 * ergeben Raster 4 und 6 beide null. Hiesse der Name schlicht nach der
 * eingetippten Zahl, stünden zwei (oder drei) Namen für eine einzige,
 * byte-gleiche Geometrie: Der zweite Bau schriebe eine Kopie unter neuem
 * Namen, statt auf das vorhandene Modul zu zeigen — und der Editor böte
 * dieselbe Halle mehrfach an. Deshalb wird auf das KLEINSTE erlaubte
 * Raster zurückgeführt, das dieselben Pfeilerstellen ergibt.
 */
function kanonischesRaster(cellsX: number, cellsZ: number, raster: number): number {
  const soll = JSON.stringify(pillarPositions(cellsX, cellsZ, raster));
  for (const r of RASTER_ERLAUBT) {
    if (JSON.stringify(pillarPositions(cellsX, cellsZ, r)) === soll) return r;
  }
  return raster;
}

/**
 * Der massabgeleitete Modulname. Das Raster steht nur im Namen, wenn es
 * von der Vorgabe abweicht — und nur, wenn diese Abweichung überhaupt
 * eine andere Geometrie ergibt (siehe `kanonischesRaster`).
 */
export function modulName(cellsX: number, cellsZ: number, raster: number): string {
  const kanon = kanonischesRaster(cellsX, cellsZ, raster);
  const anhang = kanon === GRID_M ? '' : `r${kanon}`;
  return `${NAME_PRAEFIX}${cellsX}x${cellsZ}${anhang}`;
}

// ── Prüfungen ───────────────────────────────────────────────────────────
/**
 * Die Masse. Gibt die Ablehnungsmeldung zurück oder `null`.
 *
 * Dieselbe Funktion läuft im Paketweg UND im Registry-Leser: Eine von
 * Hand nachgetragene Zeile in der Registry ist genauso eine Eingabe wie
 * ein Paket aus dem Netz, nur eine, der man es weniger ansieht.
 */
export function pruefeMasse(wunsch: ModulBauWunsch): string | null {
  const { cellsX, cellsZ, raster, weight } = wunsch;
  for (const [achse, wert] of [
    ['x', cellsX],
    ['z', cellsZ],
  ] as const) {
    if (!Number.isInteger(wert) || wert < CELLS_MIN || wert > CELLS_MAX) {
      return (
        `Zellzahl ${achse} = ${wert} liegt ausserhalb von ${CELLS_MIN}…${CELLS_MAX} ` +
        `(ganzzahlig).`
      );
    }
  }
  if (!RASTER_ERLAUBT.includes(raster)) {
    return `Pfeilerraster ${raster} ist nicht erlaubt — zulässig sind ${RASTER_ERLAUBT.join(', ')} m.`;
  }
  // Float32-Toleranz: Der Client schickt das Gewicht als Float32, und
  // 0,1 kommt dort als 0,10000000149 an. Ohne das Epsilon wäre die untere
  // Klemme genau am Randwert unerreichbar — ein Fehler, der aussieht wie
  // Willkür.
  if (!Number.isFinite(weight) || weight < GEWICHT_MIN - 1e-6 || weight > GEWICHT_MAX + 1e-6) {
    return `Gewicht ${weight} liegt ausserhalb von ${GEWICHT_MIN}…${GEWICHT_MAX}.`;
  }
  return null;
}

/** Der Dreiecksdeckel. Gibt die Ablehnungsmeldung zurück oder `null`. */
export function pruefeDreiecke(tris: number): string | null {
  if (tris > DREIECKS_DECKEL) {
    return (
      `${tris} Dreiecke überschreiten den Deckel von ${DREIECKS_DECKEL} — Säle haben kein ` +
      `Kollisionsnetz, das sichtbare Netz ist die Havok-Form.`
    );
  }
  return null;
}

/**
 * Aus einem Modulnamen einen Pfad machen — die einzige Stelle, die das
 * darf, und deshalb die Stelle, an der der Name geprüft wird.
 *
 * Drei getrennte Meldungen statt einer: Ein Name mit einem Schrägstrich
 * ist ein anderer Vorfall als einer ohne Präfix. Wer nur „ungültiger
 * Name" liest, sucht an der falschen Stelle.
 */
export function glbPfad(verzeichnis: string, name: string): string {
  if (/[^A-Za-z0-9_]/.test(name)) {
    throw new Error(
      `Modulname '${name}' enthält Zeichen, die kein Dateiname sein dürfen — erlaubt sind ` +
        `Buchstaben, Ziffern und Unterstrich.`
    );
  }
  if (!name.startsWith(NAME_PRAEFIX)) {
    throw new Error(`Modulname '${name}' trägt nicht das Präfix ${NAME_PRAEFIX}.`);
  }
  if (!NAME_MUSTER.test(name)) {
    throw new Error(
      `Modulname '${name}' hat nicht die Form ${NAME_PRAEFIX}<Kennung> mit 1…16 Zeichen.`
    );
  }
  return join(verzeichnis, `${name}.glb`);
}

// ── Registry ────────────────────────────────────────────────────────────
/**
 * Die Prüfsumme über den Modulstand — dieselbe Bauart wie bei den
 * Dungeon-2.0-Dokumenten (`fnv1a32`, acht Hexstellen).
 *
 * Der ZEITSTEMPEL geht bewusst NICHT ein. Die Prüfsumme beantwortet in
 * E6 genau eine Frage: „Kennen Client und Server dieselben Module?"
 * Ginge die Bauzeit ein, meldete sie Drift zwischen zwei Seiten, die
 * über jeden Raum einig sind — und eine Warnung, die falsch anschlägt,
 * wird nach dem dritten Mal weggeklickt.
 */
export function registryPruefsumme(module: readonly RegistryModul[]): string {
  const kanonisch = [...module]
    .map((m) => `${m.kit}|${m.name}|${m.zellenX}|${m.zellenZ}|${m.pfeilerRaster}|${m.gewicht}|${m.tris}`)
    .sort()
    .join('\n');
  return (fnv1a32(`v${REGISTRY_VERSION}\n${kanonisch}`) >>> 0).toString(16).padStart(8, '0');
}

/** Die Registry-Datei lesen. Fehlt sie, ist der Stand „keine Module". */
export function leseRegistry(verzeichnis: string): RegistryDatei {
  const pfad = join(verzeichnis, REGISTRY_DATEI);
  if (!existsSync(pfad)) return { version: REGISTRY_VERSION, pruefsumme: registryPruefsumme([]), module: [] };
  const roh = JSON.parse(readFileSync(pfad, 'utf8')) as Partial<RegistryDatei>;
  const module = Array.isArray(roh.module) ? (roh.module as RegistryModul[]) : [];
  return {
    version: typeof roh.version === 'number' ? roh.version : REGISTRY_VERSION,
    pruefsumme: typeof roh.pruefsumme === 'string' ? roh.pruefsumme : registryPruefsumme(module),
    module,
  };
}

/**
 * Die Registry schreiben — über eine Nebendatei und `rename`.
 *
 * Ein Absturz mitten im `writeFileSync` hinterliesse sonst eine halbe
 * JSON-Datei, und der nächste Start läse GAR KEIN Modul mehr: Aus einem
 * verlorenen Saal würden alle. `rename` innerhalb desselben Ordners ist
 * atomar.
 */
function schreibeRegistry(verzeichnis: string, module: readonly RegistryModul[]): string {
  const pruefsumme = registryPruefsumme(module);
  const inhalt = JSON.stringify({ version: REGISTRY_VERSION, pruefsumme, module }, null, 2);
  const ziel = join(verzeichnis, REGISTRY_DATEI);
  const temp = `${ziel}.neu`;
  writeFileSync(temp, `${inhalt}\n`, 'utf8');
  renameSync(temp, ziel);
  return pruefsumme;
}

// ── Bauen ───────────────────────────────────────────────────────────────
/**
 * Ein Saal, von der Anfrage bis zur eingetragenen RoomDef.
 *
 * Reihenfolge mit Absicht: erst die beiden Tore, dann die Masse, dann der
 * Name, dann der Deckel — und ERST DANN wird geschrieben. Jede Ablehnung
 * lässt die Platte unberührt; eine, die eine halbe Datei hinterliesse,
 * wäre teurer als gar keine.
 */
export function baueModul(kontext: ModulBauKontext, wunsch: ModulBauWunsch): ModulBauAntwort {
  const nein = (meldung: string): ModulBauAntwort => ({ ok: false, meldung });

  // (1) Tor eins: der Peer. Heute wirkungslos (everyone-admin), deshalb
  // steht Tor zwei daneben und nicht statt seiner.
  if (!kontext.istAdmin) return nein('Keine Berechtigung');
  // (2) Tor zwei: der Schalter. Vorgabe FALSE.
  if (!kontext.modulbauErlaubt) {
    return nein('Modulbau ist ausgeschaltet (server.yml: dungeons.modulbau).');
  }

  const masse = pruefeMasse(wunsch);
  if (masse) return nein(masse);

  const { cellsX, cellsZ, raster } = wunsch;
  // Der Wert, der in der Registry landet und in die Prüfsumme eingeht.
  // Ein Float32-Rundgang macht aus 0,1 die Zahl 0,10000000149 — die
  // stünde sonst für immer in der Datei und in jeder Prüfsumme.
  const gewicht = Math.round(wunsch.weight * 1000) / 1000;

  const name = modulName(cellsX, cellsZ, raster);
  const kanon = kanonischesRaster(cellsX, cellsZ, raster);

  const tris = dreiecke(cellsX, cellsZ, kanon);
  const deckel = pruefeDreiecke(tris);
  if (deckel) return nein(deckel);

  let pfad: string;
  try {
    pfad = glbPfad(kontext.verzeichnis, name);
  } catch (e) {
    return nein((e as Error).message);
  }

  // Name vergeben? Beide Fragen zählen: die Nachschlagewerke (dieser
  // Prozess kennt den Saal schon) UND die Platte (ein früherer Prozess
  // hat ihn gebaut, dieser hat die Registry noch nicht gelesen). Fehlte
  // die zweite, überschriebe ein Neustart eine ausgelieferte Datei —
  // und Live läge die alte Fassung noch sieben Tage im Browsercache.
  const bekannt = leseRegistry(kontext.verzeichnis).module.some((m) => m.name === name);
  if (bekannt || existsSync(pfad)) {
    return nein(
      `Der Saal '${name}' ist bereits gebaut — ein Modulname ist unveränderlich. ` +
        `Für eine andere Fassung braucht es einen anderen Zuschnitt.`
    );
  }

  const geometrie = buildHall(cellsX, cellsZ, { raster: kanon });
  if (geometrie.triangles !== tris) {
    // Kann nur eintreten, wenn Formel und Geometrie auseinanderlaufen —
    // dann ist der Deckel oben an der falschen Zahl gemessen worden.
    return nein(
      `Innerer Widerspruch: Formel sagt ${tris} Dreiecke, gebaut wurden ${geometrie.triangles}.`
    );
  }

  mkdirSync(kontext.verzeichnis, { recursive: true });
  writeFileSync(pfad, encodeGlb(geometrie.boxes, { name }));

  const eintrag: RegistryModul = {
    kit: KIT_NAME,
    name,
    zellenX: cellsX,
    zellenZ: cellsZ,
    pfeilerRaster: kanon,
    gewicht,
    tris,
    erzeugt: new Date().toISOString(),
  };
  const stand = leseRegistry(kontext.verzeichnis);
  const pruefsumme = schreibeRegistry(kontext.verzeichnis, [...stand.module, eintrag]);

  try {
    registerModule(KIT_NAME, roomDefForHall(name, cellsX, cellsZ, gewicht));
  } catch (e) {
    // Die Datei und die Registry stehen jetzt, der Prozess kennt den Saal
    // aber nicht. Das ist der gutartige der beiden Ausgänge: Der nächste
    // Start liest ihn aus der Registry. Deshalb wird hier gemeldet und
    // nicht zurückgerollt — ein Rollback löschte eine Datei, die ein
    // anderer Prozess vielleicht schon ausliefert.
    return nein(
      `Gebaut und in der Registry, aber nicht registriert: ${(e as Error).message} ` +
        `Nach einem Serverneustart ist '${name}' da.`
    );
  }

  return {
    ok: true,
    ergebnis: {
      name,
      cellsX,
      cellsZ,
      raster: kanon,
      weight: gewicht,
      tris,
      vertices: geometrie.vertices,
      sizeX: geometrie.sizeX,
      sizeY: HEIGHT_M,
      sizeZ: geometrie.sizeZ,
      datei: `${name}.glb`,
      pruefsumme,
    },
  };
}

// ── Beim Start lesen ────────────────────────────────────────────────────
export interface LadeErgebnis {
  readonly geladen: number;
  /** Einträge, die NICHT registriert wurden — mit Grund. */
  readonly meldungen: string[];
  /** Einträge, die registriert wurden, aber Fragen aufwerfen. */
  readonly warnungen: string[];
}

/**
 * Die Registry beim Serverstart einlesen und jedes Modul registrieren.
 *
 * MUSS vor dem Aufbau des Servers laufen: `PrefabManager` zieht beim
 * Bauen einmal über `PREFAB_DEFS`, und der Editor-Katalog leitet sein
 * `MIT_MODELL` beim Import daraus ab. Ein `registerModule` danach trägt
 * in alle sechs Karten ein und bleibt trotzdem unsichtbar — ohne
 * Meldung, weil nichts fehlschlägt.
 *
 * Die Datei wird wie eine EINGABE behandelt: Sie liegt neben den GLBs,
 * reist per tar und lässt sich von Hand bearbeiten. Ein Name, aus dem
 * ein Pfad würde, oder ein Zuschnitt jenseits der Klemmen wird deshalb
 * abgelehnt — mit derselben Funktion, die auch den Paketweg klemmt.
 *
 * Eine FEHLENDE GLB-Datei ist dagegen nur eine Warnung: Der Saal wird
 * trotzdem registriert. Ihn wegzulassen hiesse, ein Dokument, das ihn
 * benutzt, beim nächsten Speichern still um diesen Raum zu erleichtern —
 * genau der Fehler, gegen den die Prüfsumme aus E6 steht.
 */
export function ladeModulRegistrierung(verzeichnis: string = GENERIERT_DIR): LadeErgebnis {
  const meldungen: string[] = [];
  const warnungen: string[] = [];
  let geladen = 0;

  let stand: RegistryDatei;
  try {
    stand = leseRegistry(verzeichnis);
  } catch (e) {
    return {
      geladen: 0,
      meldungen: [`${REGISTRY_DATEI} ist unlesbar: ${(e as Error).message}`],
      warnungen: [],
    };
  }

  for (const m of stand.module) {
    const wunsch: ModulBauWunsch = {
      cellsX: m.zellenX,
      cellsZ: m.zellenZ,
      raster: m.pfeilerRaster,
      weight: m.gewicht,
    };
    const masse = pruefeMasse(wunsch);
    if (masse) {
      meldungen.push(`'${m.name}': ${masse}`);
      continue;
    }
    try {
      glbPfad(verzeichnis, m.name);
    } catch (e) {
      meldungen.push((e as Error).message);
      continue;
    }
    const soll = dreiecke(m.zellenX, m.zellenZ, m.pfeilerRaster);
    const deckel = pruefeDreiecke(soll);
    if (deckel) {
      meldungen.push(`'${m.name}': ${deckel}`);
      continue;
    }
    if (m.tris !== soll) {
      // Registry und GLB widersprechen sich: Der Eintrag beschreibt eine
      // andere Geometrie als die Datei, die unter dem Namen liegt.
      meldungen.push(
        `'${m.name}': Registry nennt ${m.tris} Dreiecke, der Zuschnitt ergibt ${soll}.`
      );
      continue;
    }
    if (!existsSync(join(verzeichnis, `${m.name}.glb`))) {
      warnungen.push(`'${m.name}': registriert, aber ${m.name}.glb fehlt in ${verzeichnis}.`);
    }
    try {
      registerModule(m.kit, roomDefForHall(m.name, m.zellenX, m.zellenZ, m.gewicht));
      geladen++;
    } catch (e) {
      meldungen.push(`'${m.name}': ${(e as Error).message}`);
    }
  }

  return { geladen, meldungen, warnungen };
}
