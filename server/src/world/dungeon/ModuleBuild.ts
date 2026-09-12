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
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getStableHash } from '@wov/shared/src/hash.js';
import { HEIGHT_M, buildHall } from '@wov/shared/src/hallenGeometrie.js';
import {
  CELLS_MAX,
  CELLS_MIN,
  DREIECKS_DECKEL,
  GEWICHT_MAX,
  GEWICHT_MIN,
  KIT_NAME,
  NAME_MUSTER,
  NAME_PRAEFIX,
  RASTER_ERLAUBT,
  REGISTRY_DATEI,
  REGISTRY_VERSION,
  applyModuleRegistry,
  dreiecke,
  kanonischesRaster,
  leereRegistry,
  leseRegistryAusText,
  modulName,
  pruefeDreiecke,
  pruefeMasse,
  pruefeName,
  pruefeRegistryEintrag,
  registerRegistryEntry,
  removeRegistryEntry,
  registryChecksum,
  registryPruefsumme,
  type ModulBauWunsch,
  type RegistryDatei,
  type RegistryModul,
} from '@wov/shared/src/moduleRegistry.js';
import { encodeGlb } from './GlbWriter.js';

/**
 * E6: Klemmen, Namensform, Dreiecksformel und Prüfsumme sind nach
 * `shared/src/moduleRegistry.ts` gezogen, weil ab E6 AUCH DER BROWSER
 * registriert (`client/src/main.ts`, `editorMain.ts`). Zwei Klemmenlisten
 * ergäben Prüfsummen, die übereinstimmen, während die Modulmengen es
 * nicht tun — genau der Fehler, den E6 abstellt, eine Ebene tiefer.
 *
 * Weitergereicht statt umgeleitet: Der Bauweg von E5 (`WovServer`, Test,
 * Werkzeuge) hat EINEN Einstiegspunkt, und der bleibt diese Datei.
 * They are re-exported so E5's single entry point stays this file.
 */
export {
  CELLS_MAX,
  CELLS_MIN,
  DREIECKS_DECKEL,
  GEWICHT_MAX,
  GEWICHT_MIN,
  KIT_NAME,
  NAME_MUSTER,
  NAME_PRAEFIX,
  RASTER_ERLAUBT,
  REGISTRY_DATEI,
  REGISTRY_VERSION,
  dreiecke,
  modulName,
  pruefeDreiecke,
  pruefeMasse,
  registryChecksum,
  registryPruefsumme,
  type ModulBauWunsch,
  type RegistryDatei,
  type RegistryModul,
};

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
/** Was der Server dazu weiss — beides Tore, plus der Zielordner. */
export interface ModulBauKontext {
  readonly istAdmin: boolean;
  readonly modulbauErlaubt: boolean;
  readonly verzeichnis: string;
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

// ── Prüfungen ───────────────────────────────────────────────────────────
/**
 * Aus einem Modulnamen einen Pfad machen — die einzige Stelle, die das
 * darf, und deshalb die Stelle, an der der Name geprüft wird.
 *
 * Drei getrennte Meldungen statt einer: Ein Name mit einem Schrägstrich
 * ist ein anderer Vorfall als einer ohne Präfix. Wer nur „ungültiger
 * Name" liest, sucht an der falschen Stelle.
 */
export function glbPfad(verzeichnis: string, name: string): string {
  // Die drei Meldungen stehen seit E6 in `pruefeName` (shared) — dieselbe
  // Prüfung läuft im Browser, wo es weder `join` noch einen Pfad gibt.
  // Hier bleibt genau das, was ohne Dateisystem sinnlos wäre.
  const grund = pruefeName(name);
  if (grund) throw new Error(grund);
  return join(verzeichnis, `${name}.glb`);
}

// ── Registry ────────────────────────────────────────────────────────────
/**
 * Die Registry-Datei lesen. Fehlt sie, ist der Stand „keine Module".
 *
 * Gelesen wird mit derselben Funktion, mit der der Browser die per
 * `fetch` geholte Antwort liest (`leseRegistryAusText`, E6): Die Datei
 * ist auf beiden Seiten derselbe Text, und ein zweiter Leser wäre eine
 * zweite Meinung darüber, was in ihr steht.
 *
 * Was hier bleibt, ist das Dateisystem: EXISTIERT sie überhaupt, und ein
 * unlesbarer Inhalt wird zur leeren Registry statt zu einem Absturz beim
 * Serverstart.
 */
export function leseRegistry(verzeichnis: string): RegistryDatei {
  const pfad = join(verzeichnis, REGISTRY_DATEI);
  if (!existsSync(pfad)) return leereRegistry();
  const text = readFileSync(pfad, 'utf8');
  // Auf dem SERVER ist eine unlesbare Registry ein Vorfall und keine
  // Achselzuckerei: Sie liegt neben den GLBs, die er selbst geschrieben
  // hat, und ein stilles „dann eben keine Module" liesse jedes Dokument,
  // das einen Saal benutzt, beim nächsten Speichern auflaufen — mit einer
  // Meldung über die Prüfsumme statt über die kaputte Datei. Im Browser
  // ist dieselbe Datei bloss abwesend; dort ist `leseRegistryAusText`
  // deshalb nachsichtig und hier nicht.
  JSON.parse(text);
  return leseRegistryAusText(text);
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
    // Über `registerRegistryEntry` und nicht über `registerModule`: Erst
    // der Vermerk dort macht den frischen Saal für `registryChecksum()`
    // sichtbar. Ohne ihn bliebe die Prüfsumme des Servers auf dem Stand
    // von vor dem Bau — und der Editor, der gleich darauf sein Dokument
    // schickte, bekäme „Registry veraltet" für ein Modul, das der Server
    // gerade selbst gebaut hat.
    registerRegistryEntry(eintrag);
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

// ── Löschen (E9) ────────────────────────────────────────────────────────
/*
  Löschen ist der gefährlichere der beiden Wege, und zwar aus drei
  Gründen, die alle NICHT am Löschen selbst hängen:

  (1) Der Name kommt aus dem NETZ. Beim Bauen bildet ihn der Server aus
      vier Zahlen; hier schickt ihn der Client. Er wird zu einem
      Dateipfad UND zu einem Schlüssel in die Raumtabellen des laufenden
      Prozesses — die erste Zeichenkette dieses Projekts, die beides ist.

  (2) Ein fehlender Raum hat kein Symptom. `sanitizeDungeonDocument`
      verwirft unbekannte Räume WORTLOS. Ein Saal, der verschwindet,
      während ein Grab ihn benutzt, wird nicht zu einer Meldung, sondern
      zu einem Loch im Boden — beim nächsten Speichern dieses Dokuments,
      Tage später, durch jemand anderen.

  (3) Die Frage „benutzt ihn jemand?" ist auf der PLATTE zu stellen, nicht
      im Prozess. Ein Server kennt genau eine Welt (`dungeonsDir` ist
      `data/dungeons/<welt>`); die GLB-Datei und die Registry teilen sich
      ALLE Welten dieser Maschine. Wer nur die eigene Welt fragt, löscht
      auf `dev` ein Modell weg, das `world` benutzt.
*/

/** Wie tief unter der Dokumentwurzel gesucht wird. */
const SCAN_TIEFE = 3;

/**
 * Beim Löschen zusätzlich zu den beiden Toren: wo die Dokumente ALLER
 * Welten liegen (`server/data/dungeons`), nicht die einer einzelnen.
 */
export interface ModuleDeleteContext extends ModulBauKontext {
  readonly dungeonsWurzel: string;
}

export interface ModuleDeleteResult {
  readonly name: string;
  readonly datei: string;
  /** Lag die GLB-Datei überhaupt noch da? (Ein zweiter Anlauf räumt nur noch den Eintrag.) */
  readonly dateiEntfernt: boolean;
  readonly pruefsumme: string;
  readonly verbleibend: number;
}

export type ModuleDeleteAnswer =
  | { readonly ok: true; readonly ergebnis: ModuleDeleteResult }
  | { readonly ok: false; readonly meldung: string };

/** Alle `*.json` unter der Wurzel, begrenzt tief. */
function jsonDateien(wurzel: string, tiefe = SCAN_TIEFE): string[] {
  if (tiefe < 0 || !existsSync(wurzel)) return [];
  const raus: string[] = [];
  for (const eintrag of readdirSync(wurzel, { withFileTypes: true })) {
    const pfad = join(wurzel, eintrag.name);
    // `isDirectory()` ist bei einem Symlink FALSE — der Baum wird also
    // nicht über eine Verknüpfung verlassen, und eine Schleife gibt es
    // schon deshalb nicht.
    if (eintrag.isDirectory()) raus.push(...jsonDateien(pfad, tiefe - 1));
    else if (eintrag.isFile() && eintrag.name.endsWith('.json')) raus.push(pfad);
  }
  return raus;
}

/**
 * Schlüssel, unter denen eine ZAHL ein Raum- oder Prefab-Hash sein kann.
 *
 * Die Einschränkung auf Namen ist keine Sparsamkeit, sondern eine
 * Vermeidung falscher Treffer: `seed` ist im Dokument eine zufällige
 * 32-Bit-Zahl und träfe irgendwann jeden Hash. Ein falscher Treffer wäre
 * hier zwar die harmlose Richtung (es wird NICHT gelöscht), aber eine
 * Ablehnung, die niemand nachvollziehen kann, ist auch keine.
 */
const HASH_SCHLUESSEL = new Set(['room', 'raum', 'hash', 'prefabHash', 'prefabhash', 'roomHash']);

/**
 * Steht dieser Saal irgendwo in diesem Dokument — beim Namen oder beim Hash?
 *
 * Bewusst OHNE Formatkenntnis: Unter `data/dungeons` liegen zwei Formate
 * nebeneinander (1.x und 2.0, unterschieden erst am Feld `version`), und
 * ein Sucher, der nur eines von beiden kennt, übersähe das andere STILL.
 * Ein struktureller Durchgang kann das nicht — er irrt höchstens in die
 * sichere Richtung.
 */
function nenntRaum(wert: unknown, name: string, hash: number): boolean {
  if (typeof wert === 'string') return wert === name;
  if (Array.isArray(wert)) return wert.some((v) => nenntRaum(v, name, hash));
  if (wert && typeof wert === 'object') {
    for (const [schluessel, v] of Object.entries(wert as Record<string, unknown>)) {
      if (typeof v === 'number' && v === hash && HASH_SCHLUESSEL.has(schluessel)) return true;
      if (nenntRaum(v, name, hash)) return true;
    }
  }
  return false;
}

export interface RaumNutzung {
  /** IDs der Dokumente, die den Saal führen. */
  readonly dokumente: string[];
  /** Dateien, über die sich NICHTS sagen lässt — sie zählen wie eine Nutzung. */
  readonly unlesbar: string[];
}

/**
 * Welche Dokumente unter der Wurzel führen diesen Saal?
 *
 * Ein unlesbares Dokument ist KEIN Freibrief: „Ich konnte nicht
 * nachsehen" heisst nicht „es benutzt ihn nicht". Es wandert deshalb in
 * `unlesbar` und blockt genauso — mit Nennung der Datei, damit die
 * Ablehnung eine Handlung nahelegt statt eines Rätsels.
 */
export function documentsUsingRoom(wurzel: string, name: string): RaumNutzung {
  const hash = getStableHash(name);
  const dokumente: string[] = [];
  const unlesbar: string[] = [];
  for (const pfad of jsonDateien(wurzel)) {
    const datei = pfad.slice(wurzel.length + 1);
    if (pfad.endsWith('entrances.json')) continue;
    let roh: unknown;
    try {
      roh = JSON.parse(readFileSync(pfad, 'utf8'));
    } catch {
      unlesbar.push(datei);
      continue;
    }
    if (!nenntRaum(roh, name, hash)) continue;
    const id = (roh as { id?: unknown })?.id;
    dokumente.push(typeof id === 'string' && id.length > 0 ? id : datei);
  }
  return { dokumente, unlesbar };
}

/**
 * Gebuchte Eingänge dieses Kits, deren Dokument es noch NICHT gibt.
 *
 * Ein Eingang trägt ein Rezept (Kit + Seed); das Dokument entsteht erst
 * beim ersten Betreten (`DungeonManager.getOrCreateInstance`). Solange es
 * nicht auf der Platte liegt, kann {@link documentsUsingRoom} nichts über
 * es aussagen — sie sieht nur, was geschrieben ist. Deshalb blockt ein
 * solcher Eingang, und zwar konservativ für das ganze KIT: Was in einem
 * künftigen Wurf steht, weiss heute niemand.
 *
 * Eingänge OHNE `base` bleiben aussen vor, und das ist nachgesehen statt
 * angenommen: `assignEntrance` löscht das Rezept genau dann, wenn es auf
 * ein VORHANDENES Dokument zeigt, und `deleteDocument` nimmt die Eingänge
 * eines gelöschten Dokuments mit. Ein Eingang ohne Rezept hat sein
 * Dokument also auf der Platte — und damit im Durchgang oben.
 */
export function pendingEntrances(wurzel: string, kit: string): string[] {
  const offen: string[] = [];
  for (const pfad of jsonDateien(wurzel)) {
    if (!pfad.endsWith('entrances.json')) continue;
    const ordner = dirname(pfad);
    let roh: { entries?: unknown } | null = null;
    try {
      roh = JSON.parse(readFileSync(pfad, 'utf8')) as { entries?: unknown };
    } catch {
      // Eine unlesbare Eingangsliste ist KEIN Grund, das Löschen zu
      // verhindern: Sie sagt nichts über Räume, nur über Zonen — und der
      // Server selbst behandelt sie beim Start genauso (Warnung, weiter).
      continue;
    }
    for (const e of Array.isArray(roh?.entries) ? (roh.entries as Record<string, unknown>[]) : []) {
      if (e?.base !== kit || typeof e?.dungeonId !== 'string') continue;
      if (existsSync(join(ordner, `${e.dungeonId}.json`))) continue;
      offen.push(`${e.dungeonId} (${ordner.slice(wurzel.length + 1) || '.'})`);
    }
  }
  return offen;
}

/**
 * Einen gebauten Saal wieder entfernen — Datei, Registry, Prozess.
 *
 * Reihenfolge der Prüfungen wie beim Bauen: erst die beiden Tore, dann
 * der Name, dann die Registry, dann der Bestand. Erst danach wird
 * angefasst.
 *
 * Reihenfolge des ENTFERNENS ist die umgekehrte Frage, und sie ist
 * gewählt, nicht geraten: Datei → Registry → Prozess. Bricht der Server
 * dazwischen ab, bleibt ein Registry-Eintrag ohne GLB stehen — und den
 * meldet `ladeModulRegistrierung` beim nächsten Start bereits als
 * Warnung, mit Namen. Ein zweiter Löschgang räumt ihn zu Ende. Andersherum
 * bliebe eine GLB-Datei ohne Eintrag liegen: still, von keiner Meldung
 * erwähnt — und sie sperrte den Namen für immer, weil `baueModul` eine
 * vorhandene Datei als „schon gebaut" ablehnt.
 */
export function deleteModule(kontext: ModuleDeleteContext, name: string): ModuleDeleteAnswer {
  const nein = (meldung: string): ModuleDeleteAnswer => ({ ok: false, meldung });

  if (!kontext.istAdmin) return nein('Keine Berechtigung');
  if (!kontext.modulbauErlaubt) {
    return nein('Modulbau ist ausgeschaltet (server.yml: dungeons.modulbau).');
  }

  // Der Name, BEVOR aus ihm ein Pfad oder ein Tabellenschlüssel wird.
  // Dieselbe Erlaubnisliste wie beim Bauen — und hier ist sie keine
  // Formsache: Sie ist es, die `StoneVaultHall` draussen hält.
  const grund = pruefeName(name);
  if (grund) return nein(grund);

  const stand = leseRegistry(kontext.verzeichnis);
  const eintrag = stand.module.find((m) => m.name === name);
  if (!eintrag) {
    return nein(`Die Registry kennt '${name}' nicht — es gibt nichts zu löschen.`);
  }

  const nutzung = documentsUsingRoom(kontext.dungeonsWurzel, name);
  if (nutzung.dokumente.length > 0) {
    return nein(
      `'${name}' wird noch benutzt — ${nutzung.dokumente.length} Dokument(e): ` +
        `${nutzung.dokumente.join(', ')}. Erst dort den Raum entfernen, dann löschen.`
    );
  }
  if (nutzung.unlesbar.length > 0) {
    return nein(
      `Nicht gelöscht: ${nutzung.unlesbar.join(', ')} lässt sich nicht lesen. Solange ` +
        `unklar ist, ob dort '${name}' steht, bliebe ein Loch im Grab statt einer Meldung.`
    );
  }

  const offen = pendingEntrances(kontext.dungeonsWurzel, eintrag.kit);
  if (offen.length > 0) {
    return nein(
      `Nicht gelöscht: ${offen.length} gebuchte(r), nie betretene(r) Eingang(e) des Kits ` +
        `${eintrag.kit} — ${offen.join(', ')}. Ihre Dokumente entstehen erst beim Betreten; ` +
        `bis dahin lässt sich nicht sagen, ob sie '${name}' benutzen.`
    );
  }

  // ── Ab hier wird entfernt ──────────────────────────────────────────
  const pfad = join(kontext.verzeichnis, `${name}.glb`);
  const dateiEntfernt = existsSync(pfad);
  // `force`, weil eine fehlende Datei kein Fehlschlag ist: Genau so sieht
  // der zweite Anlauf nach einem Abbruch aus, und der soll durchgehen.
  rmSync(pfad, { force: true });

  const verbleibend = stand.module.filter((m) => m.name !== name);
  const pruefsumme = schreibeRegistry(kontext.verzeichnis, verbleibend);
  // Der Prozess zuletzt — und ein `false` ist hier kein Fehler, sondern
  // der Normalfall eines Servers, der diesen Eintrag beim Start abgelehnt
  // hatte (kaputte Zeile) und ihn deshalb nie registriert hat.
  removeRegistryEntry(name);

  return {
    ok: true,
    ergebnis: {
      name,
      datei: `${name}.glb`,
      dateiEntfernt,
      pruefsumme,
      verbleibend: verbleibend.length,
    },
  };
}

/**
 * Legt beim Serverstart eine LEERE, gültige Registry an, wenn `verzeichnis`
 * oder die Datei darin noch fehlen — der Normalfall auf einer frischen
 * Installation, die noch nie einen Saal gebaut hat.
 *
 * Warum das nötig ist: Der Client fragt `assets/generiert/modul-registry.json`
 * per HTTP ab (`ModuleRegistryLoad.ts`) und behandelt ein 404 dort als
 * „keine gebauten Säle" — das bleibt richtig. Diese Funktion ändert daran
 * nichts, sie sorgt nur dafür, dass ab dem ersten Start eine ECHTE, durch
 * `leseRegistryAusText`/`applyModuleRegistry` lesbare Datei mit korrekter
 * Prüfsumme dort liegt, statt dass die Datei erst mit dem ersten
 * `baueModul`-Aufruf entsteht.
 *
 * Zwei Entscheidungen:
 *
 * (1) Die Prüfsumme kommt aus `leereRegistry()` (also `registryPruefsumme`)
 *     — nie hart kodiert. Ändert sich die Formel, zieht diese Stelle von
 *     selbst mit.
 * (2) Eine VORHANDENE Datei wird nie angefasst, auch nicht, wenn sie leer
 *     oder kaputt ist — das ist Sache von `leseRegistry`/`ladeModulRegistrierung`
 *     weiter unten, nicht dieser Funktion.
 */
export function sorgeFuerRegistryDatei(verzeichnis: string = GENERIERT_DIR): {
  readonly angelegt: boolean;
  readonly pfad: string;
} {
  mkdirSync(verzeichnis, { recursive: true });
  const pfad = join(verzeichnis, REGISTRY_DATEI);
  if (existsSync(pfad)) {
    return { angelegt: false, pfad };
  }
  schreibeRegistry(verzeichnis, leereRegistry().module);
  return { angelegt: true, pfad };
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

  // Die Klemmen laufen in `applyModuleRegistry` (shared) — DIESELBE
  // Funktion, die der Browser fährt (E6). Zwei Listen ergäben Prüfsummen,
  // die übereinstimmen, während die Modulmengen es nicht tun.
  const erg = applyModuleRegistry(stand);
  meldungen.push(...erg.meldungen);

  // Was der Browser NICHT prüfen kann: liegt die GLB-Datei da? Eine
  // fehlende Datei ist nur eine WARNUNG, der Saal wird trotzdem
  // registriert. Ihn wegzulassen hiesse, ein Dokument, das ihn benutzt,
  // beim nächsten Speichern still um diesen Raum zu erleichtern — genau
  // der Fehler, gegen den die Prüfsumme steht. Und es machte die
  // Prüfsumme dieses Servers von seinem Dateibestand abhängig statt von
  // seiner Registry: Zwei Server mit derselben Datei wären sich uneinig,
  // weil auf einem ein tar noch nicht angekommen ist.
  for (const m of stand.module) {
    // Nur für Einträge, die auch angenommen wurden: Ein abgelehnter Saal
    // bekäme sonst zwei Meldungen, und die zweite lenkte von der ersten ab.
    if (pruefeRegistryEintrag(m)) continue;
    if (!existsSync(join(verzeichnis, `${m.name}.glb`))) {
      warnungen.push(`'${m.name}': registriert, aber ${m.name}.glb fehlt in ${verzeichnis}.`);
    }
  }

  return { geladen: erg.geladen, meldungen, warnungen };
}
