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
