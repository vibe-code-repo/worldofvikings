/**
 * uploadedModelUpload.ts — die Prüfung, das Schreiben und die
 * Registry-Datei EINES per Editor hochgeladenen `.glb`
 * (Karte „Editor U1 modell-hochladen").
 *
 * ── Warum das hier in `shared/` liegt, aber NICHT im Barrel ──────────
 * Zwei Prozesse brauchen dieselbe Prüfung: der Betriebsdienst
 * (`admin/src/main.ts`, nimmt den Upload entgegen) UND der Spielserver
 * (`server/src/main.ts`, liest die Registry beim Start). `admin` und
 * `server` sind getrennte Pakete ohne gegenseitige Abhängigkeit — nur
 * `@wov/shared` teilen beide. Eine Kopie dieser Prüfung in jedem der
 * beiden wäre die Art Fehlerquelle, die beim nächsten Umbau
 * auseinanderläuft, ohne dass ein Test es sähe.
 *
 * Trotzdem steht diese Datei bewusst NICHT im Barrel (`shared/src/
 * index.ts`) — genau wie `shared/src/kollision/glb.ts` (dortiger
 * Kopfkommentar: „Der Client braucht ihn nie, und über `export *` läge
 * er in jedem Spiel-Bundle"). Sie importiert `node:fs`; ein Import im
 * Browser-Bundle wäre entweder ein toter Import oder ein Bundler-Fehler.
 * Admin und Server holen sie deshalb über den EXPLIZITEN Pfad
 * (`@wov/shared/src/uploadedModelUpload.js`), der Client nie.
 *
 * ── Warum das im Betriebsdienst-Prozess angenommen wird, nicht im
 *    Spielserver ───────────────────────────────────────────────────
 * `admin/src/main.ts` hat schon alle Schranken, die ein Upload braucht
 * (Herkunft, Token, `NAHE_NETZE`) — und einen Ausweg aus dem
 * JSON-Zwang von `leibLesen()` (8 MB, `JSON.parse` IMMER) ist dort
 * leichter zu öffnen als über den Spielserver-Socket: Der hat mit 1 MB
 * `maxPayload` (`server/src/net/WebSocketAcceptor.ts`) eine noch
 * engere, GETEILTE Grenze, die für ALLE Spielpakete gilt — sie für
 * einen seltenen Admin-Upload anzuheben wäre ein Tor, das für jeden
 * verbundenen Client offen bliebe, nicht nur für den einen Upload.
 *
 * Diese Datei kennt darum den Betriebsdienst nicht (kein `req`, keine
 * Herkunftsprüfung) — sie bekommt fertige Bytes und einen Kontext, wie
 * `ModuleBuild.baueModul` fertige Zahlen bekommt.
 *
 * ── Der Name ist der Kern der Naht ────────────────────────────────────
 * Ein Upload landet NIE in `shared/src/prefabs.ts` — die eigentliche
 * Registrierung passiert in `shared/src/uploadedModelRegistry.ts`, die
 * mit `PREFAB_DEFS`/`EIGENE_MODELLE_SET` genau die Karten füllt, die
 * `pruefeLayout`/`istEigenesModell` schon abfragen. Diese Datei hier ist
 * nur die FS-Schicht davor: Datei validieren, schreiben, Registry-Text
 * lesen/schreiben, beim Start laden.
 *
 * Sprache: neue Bezeichner englisch, wo sie nicht an einen bestehenden
 * deutschen Namen andocken.
 */
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findPrefabByName } from './prefabs.js';
import { leseGlb, parseGlbChunks } from './kollision/glb.js';
import {
  GRUNDSKALA_MAX,
  GRUNDSKALA_MIN,
  HUELLBOX_ABLEHNEN_MAX_M,
  HUELLBOX_ABLEHNEN_MIN_M,
  HUELLBOX_HINWEIS_MAX_M,
  HUELLBOX_HINWEIS_MIN_M,
  MAX_BILD_BYTES,
  MAX_BYTES,
  MAX_DREIECKE,
  MAX_KOLLISIONSNETZ_DREIECKE,
  MAX_MATERIALIEN,
  MAX_MESHES,
  NAME_MUSTER,
  REGISTRY_DATEI,
  REGISTRY_VERSION,
  applyUploadedModelRegistry,
  erzwingeName,
  hashSchonVergebenVon,
  leereRegistry,
  leseRegistryAusText,
  nameAblehnungsGrund,
  pruefeRegistryEintrag,
  registerUploadedPrefab,
  unregisterUploadedPrefab,
  uploadedModelEntries,
  uploadedModelEntry,
  type Kollisionsart,
  type RegistryDatei,
  type UploadedModelEntry,
} from './uploadedModelRegistry.js';

/** `<repo>/assets/hochgeladen` — zwei Ebenen hinauf: Diese Datei liegt in `shared/src/`, also `src → shared → <repo>`. */
const UPLOAD_DIR_VORGABE = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/hochgeladen');

/** `WOV_HOCHGELADEN_DIR` ist gesetzt, aber leer, kein absoluter Pfad oder inhaltlich unbrauchbar (B8). */
export class HochgeladenDirUngueltig extends Error {
  constructor(readonly wert: string, grund: string) {
    super(`WOV_HOCHGELADEN_DIR="${wert}" ${grund}`);
    this.name = 'HochgeladenDirUngueltig';
  }
}

/**
 * Der Ordner der hochgeladenen Modelle — geprüft wie `weltArbeitsOrdner`
 * (`shared/src/instanz.ts`): `WOV_HOCHGELADEN_DIR` MUSS, wenn gesetzt, ein
 * absoluter Pfad sein, sonst wirft dieser Aufruf `HochgeladenDirUngueltig`.
 *
 * H2 (Angriff „Editor Upload-Größe" N1): Anders als jeder andere Pfad im
 * Betriebsdienst (`WOV_WURZEL`) hing dieser Ordner am Ort DIESER Moduldatei,
 * nicht an der Umgebung — ein Prozess-Test mit eigenem `WOV_WURZEL` schrieb
 * dadurch trotzdem in die ECHTE `assets/hochgeladen/` des Checkouts (beim
 * Ausrollen die von DEV). `WOV_HOCHGELADEN_DIR` überschreibt ihn deshalb,
 * wenn gesetzt — nur Tests setzen es, Server und Betriebsdienst laufen ohne
 * Änderung weiter am bisherigen, moduleigenen Pfad.
 *
 * F4 (Nachangriff „Editor Upload-Größe N1"): Anders als bei
 * `WOV_WELT_VERZEICHNIS` gilt ein LEERER Wert hier NICHT als „nicht
 * gesetzt" — `WOV_HOCHGELADEN_DIR=` liess `UPLOAD_DIR` vorher zu `""`
 * werden, der Dienst startete, und jeder Upload scheiterte erst danach mit
 * 500 statt schon beim Start mit einer verständlichen Meldung. Ein
 * relativer Wert löste sich zuvor gegen das `cwd` des jeweiligen Prozesses
 * auf (`admin/` beim Betriebsdienst, `server/` beim Spielserver) — zwei
 * verschiedene Ordner für denselben Namen.
 *
 * B8 (Nachangriff „Editor Upload-Größe N2", Info): F4 prüfte nur die FORM
 * des Pfads, nicht, ob er tatsächlich benutzbar ist. Ein Pfad unter
 * `/proc`/`/sys` (virtuelle Kernel-Schnittstellen, keine echten Ordner),
 * ein hängender Symlink (Ziel existiert nicht) oder eine Datei statt eines
 * Ordners liessen den Dienst zwar starten, aber jeder Upload scheiterte
 * erst danach mit einem nackten 500 (ENOENT/ENOTDIR/EEXIST nur im
 * Server-Log). Jetzt wird das beim Start geprüft: ein hängender Symlink
 * und eine Nicht-Ordner-Stelle brechen sofort ab; ein noch NICHT
 * existierender Pfad wird angelegt (wie bisher, `mkdirSync`) und mit einer
 * Schreibprobe bestätigt.
 *
 * N4 (Nachangriff „Editor Upload-Größe N3", Befund N3-4, Info): B8 prüfte
 * nur den ROHEN Text (`roh.startsWith('/proc/')`) — `//proc/x` und
 * `/./proc/x` liefen daran vorbei, direkt in `mkdirSync(roh, { recursive:
 * true })`, und hingen dort synchron bei 100 % CPU (dieselbe Endlosschleife
 * wie beim Upload selbst, nur jetzt schon beim Start). Ein Symlink auf
 * `/proc/self` wurde nur zufällig über die Schreibprobe abgefangen (falsche
 * Meldung „nicht beschreibbar"), ein Tippfehler im Pfad legte still einen
 * mehrstufigen Ordnerbaum an, und die feste Schreibprobe `.wov-
 * schreibprobe` folgte einem dort liegenden Symlink und kürzte dessen Ziel
 * auf 0 Byte. Jetzt: erst `resolve()` (Normalisierung, faltet `//`, `/./`,
 * `..`, ohne dem Dateisystem zu folgen), DANN die Sperrliste prüfen —
 * `//proc/x` wird so VOR jedem Dateisystemzugriff abgelehnt, keine
 * Endlosschleife mehr möglich. Ein vorhandener Symlink wird zusätzlich
 * über `realpathSync` (folgt der GANZEN Kette) gegen dieselbe Sperrliste
 * geprüft. Fehlt der Pfad noch, wird nur EIN Elternverzeichnis vorausgesetzt
 * — existiert es nicht, bricht der Start mit einer Meldung ab, statt still
 * einen Baum aus mehreren Ebenen anzulegen (ein Tippfehler bleibt so
 * sichtbar). Die Schreibprobe läuft über einen ZUFÄLLIGEN Dateinamen mit
 * `O_CREAT|O_EXCL` (keine feste, vorhersagbare Stelle mehr, der ein Symlink
 * auflauern könnte, und `O_EXCL` folgt ohnehin nie einem vorhandenen Eintrag).
 */
const GESPERRTE_WURZELN = ['/dev/shm', '/dev', '/proc', '/sys'] as const;

/** `pfad` ist eine der gesperrten Wurzeln selbst oder liegt darunter (bzw. ist `/`). */
function unterGesperrterWurzel(pfad: string): boolean {
  if (pfad === '/') return true;
  return GESPERRTE_WURZELN.some((g) => pfad === g || pfad.startsWith(`${g}/`));
}

export function ermittleUploadDir(roh: string | undefined = process.env.WOV_HOCHGELADEN_DIR): string {
  if (roh === undefined) return UPLOAD_DIR_VORGABE;
  if (roh === '' || !isAbsolute(roh)) {
    throw new HochgeladenDirUngueltig(
      roh,
      'ist leer oder kein absoluter Pfad. Ein relativer oder leerer Wert loest sich je Prozess ' +
        '(Spielserver, Betriebsdienst) gegen ein anderes Arbeitsverzeichnis auf und meinte zwei ' +
        'verschiedene Ordner. Absoluten Pfad setzen oder die Variable weglassen.'
    );
  }
  // N4/N3-4: erst normalisieren (faltet "//proc/x", "/./proc/x", ".." — rein
  // textuell, OHNE dem Dateisystem zu folgen), DANN gegen die Sperrliste
  // pruefen — vor jedem mkdirSync/lstatSync, damit keine dieser Formen je
  // in einen Dateisystemzugriff unter /proc bzw. /sys gelangt.
  const normalisiert = resolve(roh);
  if (unterGesperrterWurzel(normalisiert)) {
    throw new HochgeladenDirUngueltig(
      roh,
      `liegt unter '${normalisiert}' — das ist eine virtuelle oder besonders geschuetzte Systemstelle, kein Ordner fuer Dateien.`
    );
  }
  // Existiert der Pfad schon (als Symlink oder sonst), muss er ein ECHTER,
  // erreichbarer Ordner sein — ein hängender Symlink, ein Symlink auf eine
  // gesperrte Wurzel oder eine Datei an dieser Stelle sollen den Start
  // verhindern, nicht erst den ersten Upload.
  let liegtSchonDa = false;
  try {
    const linkStand = lstatSync(normalisiert);
    liegtSchonDa = true;
    if (linkStand.isSymbolicLink()) {
      let ziel: string;
      try {
        ziel = realpathSync(normalisiert); // folgt der GANZEN Kette; wirft ENOENT bei einem haengenden Symlink
      } catch {
        throw new HochgeladenDirUngueltig(roh, 'ist ein haengender Symlink (das Ziel existiert nicht).');
      }
      if (unterGesperrterWurzel(ziel)) {
        throw new HochgeladenDirUngueltig(
          roh,
          `zeigt auf '${ziel}' — das ist eine virtuelle oder besonders geschuetzte Systemstelle, kein Ordner fuer Dateien.`
        );
      }
    }
    if (!statSync(normalisiert).isDirectory()) {
      throw new HochgeladenDirUngueltig(roh, 'ist kein Ordner (dort liegt schon eine Datei oder etwas anderes).');
    }
  } catch (e) {
    if (e instanceof HochgeladenDirUngueltig) throw e;
    liegtSchonDa = false; // existiert nicht -- wird unten angelegt
  }
  if (!liegtSchonDa) {
    // N4/N3-4: nur EIN Elternverzeichnis wird vorausgesetzt, nie ein ganzer
    // Baum still angelegt — ein Tippfehler im Pfad bricht so sichtbar ab,
    // statt einen leeren Ordner irgendwo im Dateisystem zu hinterlassen.
    const elternordner = dirname(normalisiert);
    if (!existsSync(elternordner) || !statSync(elternordner).isDirectory()) {
      throw new HochgeladenDirUngueltig(
        roh,
        `das Elternverzeichnis '${elternordner}' existiert nicht — vermutlich ein Tippfehler. ` +
          'Verzeichnis von Hand anlegen oder den Pfad pruefen.'
      );
    }
  }
  try {
    if (!liegtSchonDa) mkdirSync(normalisiert);
    // N4/N3-4: zufälliger Dateiname statt der festen ".wov-schreibprobe" —
    // ein dort abgelegter Symlink kann nicht mehr auflauern, weil sein Name
    // nie vorher bekannt ist; O_CREAT|O_EXCL folgt ohnehin nie einem
    // vorhandenen Eintrag (Datei oder Symlink), sondern bricht sofort ab.
    const schreibprobe = join(normalisiert, `.wov-schreibprobe-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fd = openSync(schreibprobe, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    closeSync(fd);
    rmSync(schreibprobe, { force: true });
  } catch (e) {
    throw new HochgeladenDirUngueltig(roh, `ist nicht beschreibbar: ${(e as Error).message}`);
  }
  return normalisiert;
}

export const UPLOAD_DIR = ermittleUploadDir();

// ── Freigabeliste für glTF-Erweiterungen ─────────────────────────────
/**
 * U1-N4: Babylons glTF-Lader schaltet eine Erweiterung an, sobald sie in
 * `extensionsUsed` steht (`isExtensionUsed`); `extensionsRequired` ist für
 * ihn nur die Abbruchliste. Was hier nicht steht, wird abgelehnt — eine
 * Sperrliste bekannter Gefahren ließ `KHR_interactivity` (Skalierung ×100 per
 * Graph), `KHR_node_visibility` (unsichtbare Wand) und `MSFT_audio_emitter`
 * (Abruf einer `uri`) durch. Aufgenommen wird nur, was ausschließlich das
 * Aussehen EINES Materials oder EINER Textur ändert und weder Transformation,
 * Animation, Logik, Ton, LOD, Sichtbarkeit, externe Ressourcen, Lichter noch
 * einen szenenweiten Zusatzpass einführt. Jeder Eintrag mit einer Zeile
 * Begründung; neue Einträge nur nach derselben Prüfung am Babylon-Quelltext.
 */
export const ERLAUBTE_GLTF_ERWEITERUNGEN: Readonly<Record<string, string>> = {
  KHR_materials_emissive_strength: 'ein Skalar für die Leuchtstärke des Materials',
  KHR_materials_unlit: 'schaltet die Beleuchtung dieses Materials ab, sonst nichts',
  KHR_materials_clearcoat: 'zweite Lackschicht, nur Materialparameter (gilt auch für KHR_materials_coat)',
  KHR_materials_coat: 'Nachfolger von clearcoat, nur Materialparameter',
  KHR_materials_sheen: 'Stoffglanz, nur Materialparameter',
  KHR_materials_specular: 'Glanzlicht-Stärke und -Farbe, nur Materialparameter',
  KHR_materials_ior: 'Brechungsindex als Materialparameter, ohne Zusatzpass',
  KHR_materials_anisotropy: 'gerichteter Glanz, nur Materialparameter',
  KHR_materials_iridescence: 'Schillern, nur Materialparameter',
  KHR_materials_fuzz: 'Flaum-Schicht, nur Materialparameter',
  KHR_materials_diffuse_roughness: 'Rauheit des Streulichts, nur Materialparameter',
  KHR_materials_pbrSpecularGlossiness: 'ältere Materialbeschreibung, nur Parameter und Texturen des Materials',
  KHR_texture_transform: 'verschiebt/dreht/skaliert nur die UV-Koordinaten einer Textur',
};

// ── Registry-Datei ────────────────────────────────────────────────────
/** Wie `moduleRegistry`s Registry: über eine Nebendatei und `rename` — atomar. */
function schreibeRegistry(verzeichnis: string, modelle: readonly UploadedModelEntry[]): void {
  const inhalt = JSON.stringify({ version: REGISTRY_VERSION, modelle }, null, 2);
  const ziel = join(verzeichnis, REGISTRY_DATEI);
  const temp = `${ziel}.neu`;
  writeFileSync(temp, `${inhalt}\n`, 'utf8');
  renameSync(temp, ziel);
}

export function leseRegistry(verzeichnis: string): RegistryDatei {
  const pfad = join(verzeichnis, REGISTRY_DATEI);
  if (!existsSync(pfad)) return leereRegistry();
  const text = readFileSync(pfad, 'utf8');
  const roh: unknown = JSON.parse(text); // wirft bei kaputtem JSON — auf dem Server ein Vorfall, kein „dann eben leer".
  // U1-N5: Vorhanden, aber ohne gültige `modelle`-Liste (`{"version":1}`, `null`,
  // `[]`, `{"modelle":{}}`) ist ebenfalls ein Vorfall: `leseRegistryAusText` läse
  // sie nachsichtig als leer, und jede Datei im Ordner gälte dann als Waise und
  // würde überschrieben. Fail closed — nicht lesbar, Upload und Entfernen lehnen ab.
  if (typeof roh !== 'object' || roh === null || Array.isArray(roh) || !Array.isArray((roh as { modelle?: unknown }).modelle)) {
    throw new Error(`${REGISTRY_DATEI} enthält keine gültige 'modelle'-Liste`);
  }
  // Einträge, die keine Objekte sind, verwirft `leseRegistryAusText` selbst.
  const stand = leseRegistryAusText(text);
  return stand;
}

export function sorgeFuerRegistryDatei(verzeichnis: string = UPLOAD_DIR): {
  readonly angelegt: boolean;
  readonly pfad: string;
} {
  mkdirSync(verzeichnis, { recursive: true });
  const pfad = join(verzeichnis, REGISTRY_DATEI);
  if (existsSync(pfad)) return { angelegt: false, pfad };
  schreibeRegistry(verzeichnis, []);
  return { angelegt: true, pfad };
}

export interface LadeErgebnis {
  readonly geladen: number;
  readonly meldungen: string[];
  readonly warnungen: string[];
}

/**
 * Beim Serverstart lesen und registrieren — MUSS vor `createWovServer`
 * laufen, aus demselben Grund wie `ladeModulRegistrierung`: `PREFAB_DEFS`
 * wird beim Bauen der Welt einmal kopiert, eine Registrierung danach
 * bleibt unsichtbar.
 */
export function ladeHochgeladeneRegistrierung(verzeichnis: string = UPLOAD_DIR): LadeErgebnis {
  let stand: RegistryDatei;
  try {
    stand = leseRegistry(verzeichnis);
  } catch (e) {
    return { geladen: 0, meldungen: [`${REGISTRY_DATEI} ist unlesbar: ${(e as Error).message}`], warnungen: [] };
  }
  const erg = applyUploadedModelRegistry(stand);
  const warnungen: string[] = [];
  for (const m of stand.modelle) {
    if (pruefeRegistryEintrag(m)) continue;
    if (!existsSync(join(verzeichnis, `${m.name}.glb`))) {
      warnungen.push(`'${m.name}': registriert, aber ${m.name}.glb fehlt in ${verzeichnis}.`);
    }
  }
  return { geladen: erg.geladen, meldungen: erg.meldungen, warnungen };
}

// ── Hüllbox ───────────────────────────────────────────────────────────
function huellbox(positionen: Float32Array): { breite: number; hoehe: number; tiefe: number } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positionen.length; i += 3) {
    const x = positionen[i]!, y = positionen[i + 1]!, z = positionen[i + 2]!;
    // N1 (Angriff, Abschnitt „Grenzen des Prüftors", NaN in Positionsdaten):
    // Ein Vergleich mit NaN ist IMMER false — eine NaN-Ecke neben gültigen
    // Ecken würde von `x < minX`/`x > maxX` einfach STILL ÜBERSPRUNGEN und
    // ginge im min/max von den ÜBRIGEN, gültigen Ecken unter. Die Hüllbox
    // käme dann vollständig endlich heraus, obwohl das Netz kaputte Daten
    // enthält. Deshalb hier hart abbrechen, statt nur zu hoffen, dass eine
    // durchgehend-NaN-Achse die spätere `Number.isFinite`-Prüfung trifft.
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return { breite: NaN, hoehe: NaN, tiefe: NaN };
    }
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { breite: maxX - minX, hoehe: maxY - minY, tiefe: maxZ - minZ };
}

/**
 * U1-N4: `extensionsUsed` und `extensionsRequired` gegen die Freigabeliste.
 * Gibt die Ablehnung zurück oder `null`. Ein Wert, der kein Array aus
 * Strings ist, wird abgelehnt und NIE als leer behandelt (Babylon wertet
 * einen String per `indexOf` als Teilstring aus und schaltete die
 * Erweiterung an).
 */
function pruefeErweiterungen(json: object): string | null {
  const roh = json as Record<string, unknown>;
  for (const feld of ['extensionsRequired', 'extensionsUsed'] as const) {
    const wert = roh[feld];
    if (wert === undefined) continue;
    if (!Array.isArray(wert) || wert.some((e) => typeof e !== 'string')) {
      return `'${feld}' muss eine Liste von Namen (Texten) sein — die Datei ist so nicht lesbar.`;
    }
    const unbekannt = (wert as string[]).filter((e) => !Object.prototype.hasOwnProperty.call(ERLAUBTE_GLTF_ERWEITERUNGEN, e));
    if (unbekannt.length > 0) {
      return `Das Modell ${feld === 'extensionsRequired' ? 'verlangt' : 'benutzt'} glTF-Erweiterungen, die nicht freigegeben sind: ${unbekannt.join(', ')}. Erlaubt sind nur reine Material-/Textur-Erweiterungen (${Object.keys(ERLAUBTE_GLTF_ERWEITERUNGEN).join(', ')}).`;
    }
  }
  // glTF 2.0: Was verlangt wird, muss auch als benutzt aufgeführt sein. Babylon
  // schaltet nur Erweiterungen aus `extensionsUsed` ein und bricht sonst das
  // Laden ab — im Spiel bliebe eine unsichtbare (feste) Wand.
  const benutzt = roh.extensionsUsed as string[] | undefined;
  const verlangt = (roh.extensionsRequired as string[] | undefined) ?? [];
  const fehlend = verlangt.filter((e) => !(benutzt ?? []).includes(e));
  if (fehlend.length > 0) {
    return `'extensionsRequired' nennt Erweiterungen, die nicht in 'extensionsUsed' stehen: ${fehlend.join(', ')} — die Datei ist so nicht ladbar.`;
  }
  // `1e999` wird nach `JSON.parse` zu Infinity; in Erweiterungswerten (Leuchtstärke,
  // UV-Transformation …) zeichnete das ein unendliches Material.
  if (enthaeltNichtEndlicheZahl(json)) {
    return 'Die Datei enthält nicht-endliche Zahlen (Infinity/NaN, etwa 1e999) — so nicht ladbar.';
  }
  return null;
}

/** Sucht in einem geparsten JSON-Baum (ohne Rekursion, tiefe Verschachtelung ist Eingabe) nach Infinity/NaN. */
function enthaeltNichtEndlicheZahl(wurzel: unknown): boolean {
  const stapel: unknown[] = [wurzel];
  while (stapel.length > 0) {
    const w = stapel.pop();
    if (typeof w === 'number') {
      if (!Number.isFinite(w)) return true;
    } else if (Array.isArray(w)) {
      for (const x of w) stapel.push(x);
    } else if (typeof w === 'object' && w !== null) {
      for (const x of Object.values(w)) stapel.push(x);
    }
  }
  return false;
}

// ── Hochladen ─────────────────────────────────────────────────────────
export interface UploadKontext {
  /** Beide Tore schon geprüft, BEVOR diese Funktion gerufen wird: Instanz ≠ live UND server.yml-Schalter an. */
  readonly erlaubt: boolean;
  readonly verzeichnis: string;
  readonly hochgeladenVon: string;
}

export interface UploadWunsch {
  readonly bytes: Uint8Array;
  readonly angezeigterName: string;
  readonly kollisionswunsch: Kollisionsart;
  /** Grundskala (Karte „Editor Upload-Größe"); fehlt sie, gilt 1 ("wie Datei"). */
  readonly grundskala?: number;
}

/**
 * Grundskala-Eingabe prüfen — dieselbe Grenze wie `pruefeRegistryEintrag`
 * (`GRUNDSKALA_MIN`…`GRUNDSKALA_MAX`), hier VOR jedem Schreiben, für
 * Upload UND „nachträglich ändern". `undefined` (Feld fehlt) ist gültig
 * und bedeutet 1 — nur ein VORHANDENER, aber falscher Wert wird abgelehnt.
 */
export function pruefeGrundskala(grundskala: number | undefined): string | null {
  if (grundskala === undefined) return null;
  if (
    typeof grundskala !== 'number' ||
    !Number.isFinite(grundskala) ||
    grundskala < GRUNDSKALA_MIN ||
    grundskala > GRUNDSKALA_MAX
  ) {
    return `Grundskala muss eine endliche Zahl zwischen ${GRUNDSKALA_MIN} und ${GRUNDSKALA_MAX} sein (bekommen: ${String(grundskala)}).`;
  }
  return null;
}

export type UploadAntwort =
  | { readonly ok: true; readonly eintrag: UploadedModelEntry; readonly hinweise: readonly string[] }
  | { readonly ok: false; readonly meldung: string };

/** Rückbau einer gerade geschriebenen Datei; scheitert er, bleibt eine Waise, die der nächste Upload ersetzt. */
function entferneWaise(pfad: string): void {
  try {
    rmSync(pfad, { force: true });
  } catch (e) {
    console.error(`[ModellUpload] Rückbau von '${pfad}' fehlgeschlagen, Waise bleibt liegen: ${(e as Error).message}`);
  }
}

/**
 * Die eine Klemmenliste des Uploads — Reihenfolge mit Absicht: erst das
 * Tor, dann Struktur und Grösse (billig), dann Geometrie (braucht
 * Vertexdaten), erst DANACH Name/Bestand, erst DANN wird geschrieben.
 * Jede Ablehnung lässt die Platte unberührt.
 */
export function pruefeUndSpeichereUpload(kontext: UploadKontext, wunsch: UploadWunsch): UploadAntwort {
  const nein = (meldung: string): UploadAntwort => ({ ok: false, meldung });

  if (!kontext.erlaubt) {
    return nein('Modell-Upload ist auf dieser Instanz nicht erlaubt (server.yml: uploads.modell-hochladen, oder Instanz live).');
  }
  if (wunsch.bytes.byteLength === 0) return nein('Die Datei ist leer.');
  if (wunsch.bytes.byteLength > MAX_BYTES) {
    return nein(`Die Datei ist zu groß: ${wunsch.bytes.byteLength} Byte, erlaubt sind höchstens ${MAX_BYTES} Byte.`);
  }
  const grundskalaFehler = pruefeGrundskala(wunsch.grundskala);
  if (grundskalaFehler !== null) return nein(grundskalaFehler);

  const name = erzwingeName(wunsch.angezeigterName);
  if (name === null) {
    // N2 (Nachangriff, Befund N-3): der Grund als eigener Satz statt der
    // immer gleichen, teils falschen Meldung — siehe Kopf von `nameAblehnungsGrund`.
    return nein(nameAblehnungsGrund(wunsch.angezeigterName));
  }

  let roh;
  try {
    roh = parseGlbChunks(wunsch.bytes);
  } catch (e) {
    return nein(`Keine gültige GLB-Datei: ${(e as Error).message}.`);
  }

  // N1 (Angriff, Abschnitt „Prüftor"): Struktur VOR Geometrie — beide
  // Prüfungen unten brauchen keine Vertexdaten und laufen deshalb vor
  // `leseGlb`. Eine geforderte Erweiterung (Draco, Meshopt, GPU-Instancing)
  // würde von Babylon anders (mehrfach-instanziert, dekomprimiert)
  // gezeichnet, als dieses Tor zählt — abgelehnt, statt falsch zu zählen.
  const erweiterungsFehler = pruefeErweiterungen(roh.json);
  if (erweiterungsFehler !== null) return nein(erweiterungsFehler);
  // Nur der eingebettete BIN-Chunk ist erlaubt — ein `uri` an einem Puffer
  // ist eine externe Datei, die beim Hochladen nie mitkommt (dieselbe
  // Regel wie bei `images[].uri` unten, nur eine Ebene tiefer).
  for (const puffer of roh.json.buffers ?? []) {
    if (puffer.uri !== undefined) {
      return nein(
        `Das Modell verweist auf externe Binärdaten ('${puffer.uri}') — nur der eingebettete BIN-Chunk ist erlaubt.`
      );
    }
  }

  let inhalt: ReturnType<typeof leseGlb>;
  try {
    inhalt = leseGlb(wunsch.bytes);
  } catch (e) {
    return nein(`Die GLB-Datei ist beschädigt oder unvollständig: ${(e as Error).message}.`);
  }

  if (inhalt.sicht === null) {
    return nein('Das Modell hat kein sichtbares Netz (0 Dreiecke, nur unrenderbare Knoten).');
  }
  const dreiecke = Math.floor(inhalt.sicht.indizes.length / 3);
  if (dreiecke > MAX_DREIECKE) {
    return nein(`Zu viele Dreiecke: ${dreiecke}, erlaubt sind höchstens ${MAX_DREIECKE}.`);
  }

  const meshes = roh.json.meshes?.length ?? 0;
  if (meshes > MAX_MESHES) {
    return nein(`Zu viele Netze: ${meshes}, erlaubt sind höchstens ${MAX_MESHES}.`);
  }
  const materialien = roh.json.materials?.length ?? 0;
  if (materialien > MAX_MATERIALIEN) {
    return nein(`Zu viele Materialien: ${materialien}, erlaubt sind höchstens ${MAX_MATERIALIEN}.`);
  }

  const bilder = roh.json.images ?? [];
  for (const bild of bilder) {
    if (bild.uri !== undefined) {
      return nein(
        `Das Modell verweist auf eine externe Bilddatei ('${bild.uri}') — Texturen müssen in der GLB eingebettet sein.`
      );
    }
    if (bild.bufferView !== undefined) {
      const bv = roh.json.bufferViews?.[bild.bufferView];
      if (bv && bv.byteLength > MAX_BILD_BYTES) {
        return nein(`Ein eingebettetes Bild ist zu groß: ${bv.byteLength} Byte, erlaubt sind höchstens ${MAX_BILD_BYTES} Byte.`);
      }
    }
  }
  const fehlendeTexturen = materialien > 0 && bilder.length === 0;

  const { breite, hoehe, tiefe } = huellbox(inhalt.sicht.positionen);
  // N1 (Angriff, Abschnitt „Prüftor", NaN in Positionsdaten): Ein Vergleich
  // mit NaN ist IMMER falsch — `groesste >= ABLEHNEN_MAX` UND
  // `groesste < ABLEHNEN_MIN` wären beide false, und ein Modell mit
  // kaputten (NaN/±Infinity) Vertexpositionen liefe unbemerkt durch die
  // Hüllbox-Prüfung. Deshalb ein eigener, expliziter Endlichkeits-Riegel
  // davor statt eines Vergleichs, der bei NaN schweigt.
  if (!Number.isFinite(breite) || !Number.isFinite(hoehe) || !Number.isFinite(tiefe)) {
    return nein('Die Hüllbox lässt sich nicht bestimmen — das Modell enthält ungültige Positionsdaten (NaN oder Unendlich).');
  }
  const groesste = Math.max(breite, hoehe, tiefe);
  if (groesste >= HUELLBOX_ABLEHNEN_MAX_M || groesste < HUELLBOX_ABLEHNEN_MIN_M) {
    return nein(
      `Die Hüllbox ist unplausibel: ${breite.toFixed(3)} × ${hoehe.toFixed(3)} × ${tiefe.toFixed(3)} m.`
    );
  }
  const hinweise: string[] = [];
  if (groesste >= HUELLBOX_HINWEIS_MAX_M || groesste < HUELLBOX_HINWEIS_MIN_M) {
    hinweise.push(
      `Ungewöhnliche Größe: ${breite.toFixed(3)} × ${hoehe.toFixed(3)} × ${tiefe.toFixed(3)} m — bitte Maßstab prüfen.`
    );
  }
  if (fehlendeTexturen) {
    hinweise.push('Keine eingebetteten Texturen gefunden — das Modell erscheint im Spiel möglicherweise ungefärbt.');
  }

  let hatKollisionsnetz = false;
  let kollisionsnetzAbgelehnt = false;
  if (inhalt.kollision !== null) {
    const colDreiecke = Math.floor(inhalt.kollision.indizes.length / 3);
    if (colDreiecke > 0 && colDreiecke <= MAX_KOLLISIONSNETZ_DREIECKE) {
      hatKollisionsnetz = true;
    } else if (colDreiecke > MAX_KOLLISIONSNETZ_DREIECKE) {
      kollisionsnetzAbgelehnt = true;
      hinweise.push(
        `Eigenes Kollisionsnetz hat zu viele Dreiecke (${colDreiecke} > ${MAX_KOLLISIONSNETZ_DREIECKE}) — Kollision fällt auf die Hüllbox zurück.`
      );
    }
  }

  // N1 (Angriff, Befund B7): ohne Rücksicht auf Groß-/Kleinschreibung, weil
  // zwei Namen, die sich nur darin unterscheiden, auf Linux zwei Dateien
  // ergäben (harmlos dort), aber bei einer Kopie auf Windows/macOS
  // kollidierten. `findPrefabByName`/`uploadedModelEntry` sind exakt (das
  // deckt den Bestand und schon vergebene Uploads); der Vergleich hier
  // deckt zusätzlich ZUKÜNFTIGE Uploads untereinander.
  const nameLower = name.toLowerCase();
  const nameVergeben =
    uploadedModelEntry(name) !== undefined ||
    findPrefabByName(name) !== undefined ||
    uploadedModelEntries().some((e) => e.name.toLowerCase() === nameLower);
  if (nameVergeben) {
    return nein(`Der Name '${name}' ist bereits vergeben — bitte einen anderen Anzeigenamen wählen.`);
  }

  mkdirSync(kontext.verzeichnis, { recursive: true });
  const pfad = join(kontext.verzeichnis, `${name}.glb`);
  // U1-N4: Ob ein Name belegt ist, entscheidet die Registry, nicht die bloße
  // Datei. Eine `.glb` ohne Registry-Eintrag ist eine Waise (etwa nach einem
  // Upload, dessen Rückbau selbst scheiterte) und würde den Namen sonst ohne
  // Handarbeit für immer sperren; ein DELETE kennt sie nicht. Sie wird
  // deshalb vom nächsten Upload unter diesem Namen überschrieben.
  let stand: RegistryDatei;
  try {
    stand = leseRegistry(kontext.verzeichnis);
  } catch (e) {
    console.error(`[ModellUpload] Registry unlesbar (${pfad}), Upload abgelehnt: ${(e as Error).message}`);
    return nein('Registry nicht lesbar, Upload zurückgerollt (Einzelheiten im Server-Log).');
  }
  if (stand.modelle.some((m) => typeof m.name === 'string' && m.name.toLowerCase() === nameLower)) {
    return nein(`Unter dem Namen '${name}' liegt bereits ein Eintrag — bitte einen anderen Anzeigenamen wählen.`);
  }
  if (existsSync(pfad)) {
    console.warn(`[ModellUpload] Verwaiste Datei '${pfad}' ohne Registry-Eintrag wird durch den neuen Upload ersetzt.`);
  }

  // N2 (Nachangriff, Befund N-2): Der Hash wird HIER geprüft, VOR jedem
  // Schreiben — nicht erst in `registerUploadedPrefab`. Eine Kollision
  // zweier verschiedener Namen (`getStableHash` ist 32-bittig) sperrte
  // sonst erst NACH dem Schreiben eine Datei UND einen Registry-Eintrag,
  // die beide nie registriert würden ("Geschrieben, aber nicht
  // registriert") — der Name bliebe über `existsSync` oben für immer
  // belegt, aber ohne "Entfernen"-Knopf im Katalog (der nur für
  // REGISTRIERTE Uploads erscheint). Der zweite Rollback weiter unten
  // bleibt trotzdem stehen, falls diese Prüfung durch einen künftigen
  // zweiten Schreiber umgangen würde.
  const hashBelegtVon = hashSchonVergebenVon(name);
  if (hashBelegtVon !== null) {
    return nein(
      `Der Name '${name}' kollidiert mit dem Hash von '${hashBelegtVon}' — bitte einen anderen Anzeigenamen wählen.`
    );
  }

  // ── Ab hier wird geschrieben ────────────────────────────────────────
  const temp = `${pfad}.neu`;
  try {
    writeFileSync(temp, wunsch.bytes);
    renameSync(temp, pfad);
  } catch (e) {
    // N2 (Nachangriff, Befund N-4): Die `message` eines fs-Fehlers enthält
    // IMMER den vollen Pfad (Auslöser im Angriff: ein Verzeichnis lag schon
    // unter dem Zielnamen) — der darf nie in einer Antwort an den Browser
    // stehen, nur ins Log.
    console.error(`[ModellUpload] Schreiben von '${pfad}' fehlgeschlagen: ${(e as Error).message}`);
    return nein('Die Datei konnte nicht geschrieben werden (Einzelheiten im Server-Log).');
  }

  const eintrag: UploadedModelEntry = {
    name,
    anzeigename: wunsch.angezeigterName,
    bytes: wunsch.bytes.byteLength,
    dreiecke,
    meshes,
    materialien,
    bilder: bilder.length,
    fehlendeTexturen,
    breite,
    hoehe,
    tiefe,
    kollisionsart: wunsch.kollisionswunsch,
    hatKollisionsnetz,
    kollisionsnetzAbgelehnt,
    hochgeladenVon: kontext.hochgeladenVon,
    zeitpunkt: new Date().toISOString(),
    // Nur SCHREIBEN, wenn ausdrücklich mitgeschickt — ein fehlendes Feld
    // bleibt fehlend (nicht `1`), damit ein Registry-Diff zeigt, welche
    // Einträge nie eine Grundskala gesetzt bekamen.
    ...(wunsch.grundskala !== undefined ? { grundskala: wunsch.grundskala } : {}),
  };

  // N1 (Angriff, Befund B2): Wirft `schreibeRegistry` HIER (volle Platte,
  // Rechte), lag die `.glb` vorher schon auf der Platte — sie wird wieder
  // entfernt. Scheitert auch das (U1-N4), bleibt eine Waise, die der nächste
  // Upload unter demselben Namen ersetzt (siehe oben). `stand` wurde schon vor
  // dem Schreiben gelesen und dient dem Registrierungs-Rückbau weiter unten.
  try {
    schreibeRegistry(kontext.verzeichnis, [...stand.modelle, eintrag]);
  } catch (e) {
    entferneWaise(pfad);
    console.error(`[ModellUpload] Registry nicht schreibbar (${pfad}), Upload zurückgerollt: ${(e as Error).message}`);
    return nein('Registry nicht schreibbar, Upload zurückgerollt (Einzelheiten im Server-Log).');
  }

  try {
    registerUploadedPrefab(eintrag);
  } catch (e) {
    // N2 (Nachangriff, Befund N-2): Anders als hier bisher angenommen,
    // trifft "ein Rollback könnte eine ausgelieferte Datei löschen" NICHT
    // zu — die Datei wurde in DERSELBEN synchronen Folge gerade erst
    // angelegt, niemand hat sie bis hierher ausgeliefert bekommen. Ohne
    // Rückbau blieben Datei UND Registry-Eintrag stehen: der Name wäre für
    // immer gesperrt (der `existsSync`-Riegel oben), aber nie im Katalog
    // sichtbar (der nächste Prozessstart lehnt den Eintrag beim Abgleich
    // ab) und ohne "Entfernen"-Knopf, weil der nur für registrierte
    // Uploads erscheint — nur ein Neustart mit Handarbeit an der
    // registry.json käme wieder heraus. Die Hash-Prüfung oben deckt den
    // Regelfall schon ab; dieser Zweig ist die Absicherung für den Rest.
    entferneWaise(pfad);
    try {
      schreibeRegistry(kontext.verzeichnis, stand.modelle);
    } catch (e2) {
      console.error(`[ModellUpload] Registry-Rückbau fehlgeschlagen (${pfad}): ${(e2 as Error).message}`);
    }
    return nein(`Geschrieben, aber nicht registriert, Upload zurückgerollt: ${(e as Error).message}`);
  }

  return { ok: true, eintrag, hinweise };
}

// ── Entfernen ─────────────────────────────────────────────────────────
export interface PlatzierungsOrt {
  readonly x: number;
  readonly z: number;
}

export interface Nutzung {
  readonly anzahl: number;
  readonly orte: readonly PlatzierungsOrt[];
}

/** Wie oft und wo `name` in einem Weltlayout-Dokument vorkommt. */
export function platzierungsNutzung(layoutDatei: string, name: string): Nutzung {
  if (!existsSync(layoutDatei)) return { anzahl: 0, orte: [] };
  let roh: unknown;
  try {
    roh = JSON.parse(readFileSync(layoutDatei, 'utf8'));
  } catch {
    // Ein unlesbares Dokument ist KEIN Freibrief — sicherheitshalber so
    // behandelt, als würde es den Namen benutzen, sonst könnte ein
    // kaputtes Layout eine Löschung durchwinken, die es gar nicht darf.
    return { anzahl: 1, orte: [] };
  }
  const placements = Array.isArray((roh as { placements?: unknown })?.placements)
    ? ((roh as { placements: { prefab?: unknown; x?: unknown; z?: unknown }[] }).placements)
    : [];
  const treffer = placements.filter((p) => p.prefab === name);
  return {
    anzahl: treffer.length,
    orte: treffer.map((p) => ({ x: typeof p.x === 'number' ? p.x : 0, z: typeof p.z === 'number' ? p.z : 0 })),
  };
}

export interface EntfernenKontext {
  readonly erlaubt: boolean;
  readonly verzeichnis: string;
  readonly layoutDatei: string;
}

export type EntfernenAntwort =
  | { readonly ok: true; readonly name: string; readonly verbleibend: number }
  | { readonly ok: false; readonly meldung: string }
  | { readonly ok: false; readonly brauchtBestaetigung: true; readonly nutzung: Nutzung };

/**
 * Ein hochgeladenes Modell zurückziehen: Datei beiseiteschieben (NICHT
 * löschen), Registry-Eintrag entfernen, Prozess austragen.
 *
 * Ohne `bestaetigt` und mit bestehender Nutzung wird NICHTS angefasst —
 * die Antwort nennt nur Zahl und Orte, damit der Editor fragen kann,
 * bevor er einen zweiten Aufruf mit `bestaetigt: true` schickt.
 */
export function entferneUpload(kontext: EntfernenKontext, name: string, bestaetigt: boolean): EntfernenAntwort {
  if (!kontext.erlaubt) {
    return { ok: false, meldung: 'Modell-Upload ist auf dieser Instanz nicht erlaubt.' };
  }
  // N1 (Angriff, Befund B5): Der Name kommt aus der ANFRAGE und wird
  // gegen die Registry NUR nachgeschlagen (`stand.modelle.find`), nie
  // gegen ein Muster geprüft — eine von Hand verdorbene `registry.json`
  // (oder ein künftiger zweiter Schreiber) könnte einen Eintrag mit einem
  // Pfadanteil im Namen enthalten, und dieser Riegel hier ist die einzige
  // Stelle, die ihn VOR `join(verzeichnis, name + '.glb')` abfängt. Ohne
  // ihn fand die Probe eine Datei AUSSERHALB von `assets/hochgeladen/`
  // und versuchte, sie zu verschieben (500 mit absoluten Pfaden in der
  // Antwort). `NAME_MUSTER` lässt nie `/`, `\` oder `.` durch — ein
  // Treffer hier kann also nie aus dem Zielordner ausbrechen.
  if (!NAME_MUSTER.test(name)) {
    return { ok: false, meldung: `Ungültiger Name — erwartet wird das Muster ${NAME_MUSTER}.` };
  }
  let stand: RegistryDatei;
  try {
    stand = leseRegistry(kontext.verzeichnis);
  } catch (e) {
    // U1-N3: auch der Lese-Weg gibt keine rohe `message` an den Browser
    // (kaputtes JSON: ein Ausschnitt des Dateiinhalts; fs-Fehler: Pfad).
    console.error(`[ModellUpload] Registry unlesbar (${kontext.verzeichnis}): ${(e as Error).message}`);
    return { ok: false, meldung: 'Die Registry ist nicht lesbar (Einzelheiten im Server-Log).' };
  }
  const eintrag = stand.modelle.find((m) => m.name === name);
  if (!eintrag) {
    return { ok: false, meldung: `Die Registry kennt '${name}' nicht — es gibt nichts zu entfernen.` };
  }

  const nutzung = platzierungsNutzung(kontext.layoutDatei, name);
  if (nutzung.anzahl > 0 && !bestaetigt) {
    return { ok: false, brauchtBestaetigung: true, nutzung };
  }

  const pfad = join(kontext.verzeichnis, `${name}.glb`);
  // U1-N3: Wohin die Datei geschoben wurde, damit ein gescheitertes
  // Schreiben der Registry sie zurückholen kann (kein Eintrag ohne Datei).
  let beiseiteZiel: string | null = null;
  // U1-N5: Fehlt die Datei schon (Halbzustand eines früheren Aufrufs, Eintrag steht),
  // ist auch ein weiteres Scheitern am Registry-Schreiben „nur teilweise entfernt“.
  const dateiSchonWeg = !existsSync(pfad);
  if (!dateiSchonWeg) {
    const beiseiteOrdner = join(kontext.verzeichnis, 'entfernt');
    try {
      mkdirSync(beiseiteOrdner, { recursive: true });
      const zeitstempel = new Date().toISOString().replace(/[:.]/g, '-');
      const ziel = join(beiseiteOrdner, `${name}.${zeitstempel}.glb`);
      renameSync(pfad, ziel);
      beiseiteZiel = ziel;
    } catch (e) {
      // N2 (Nachangriff, Befund N-4, dieselbe Klasse wie beim Hochladen):
      // die `message` eines fs-Fehlers traegt den vollen Pfad — nur ins Log.
      console.error(`[ModellUpload] Beiseiteschieben von '${pfad}' fehlgeschlagen: ${(e as Error).message}`);
      return { ok: false, meldung: 'Die Datei konnte nicht entfernt werden (Einzelheiten im Server-Log).' };
    }
  }

  const verbleibend = stand.modelle.filter((m) => m.name !== name);
  try {
    schreibeRegistry(kontext.verzeichnis, verbleibend);
  } catch (e) {
    // U1-N3: Die Datei ist schon beiseite, die Registry aber unverändert —
    // ohne Rückschieben stünde ein Eintrag ohne Datei da (der Katalog
    // böte ein Modell an, dessen Laden 404 gibt). Zurückschieben, dann
    // ist alles wie vor dem Aufruf; der Pfad steht nur im Log.
    console.error(
      `[ModellUpload] Registry nicht schreibbar (${kontext.verzeichnis}), Entfernen zurückgerollt: ${(e as Error).message}`
    );
    if (beiseiteZiel !== null) {
      try {
        renameSync(beiseiteZiel, pfad);
      } catch (e2) {
        console.error(`[ModellUpload] Zurückschieben von '${beiseiteZiel}' fehlgeschlagen: ${(e2 as Error).message}`);
        // U1-N4: Der Zustand ist halb — die Datei liegt beiseite, der Eintrag
        // steht noch. Das sagt die Antwort ehrlich; ein erneutes DELETE räumt auf.
        return {
          ok: false,
          meldung:
            'Die Registry konnte nicht geschrieben werden und die Datei nicht zurückgelegt: Das Modell ist nur teilweise entfernt (Datei beiseitegelegt, Registry-Eintrag noch vorhanden). Bitte erneut entfernen, das räumt auf (Einzelheiten im Server-Log).',
        };
      }
    }
    if (dateiSchonWeg) {
      return {
        ok: false,
        meldung:
          'Die Registry konnte nicht geschrieben werden: Das Modell ist nur teilweise entfernt (Datei schon beiseitegelegt, Registry-Eintrag noch vorhanden). Bitte erneut entfernen, das räumt auf (Einzelheiten im Server-Log).',
      };
    }
    return {
      ok: false,
      meldung: 'Die Registry konnte nicht geschrieben werden, nichts wurde entfernt (Einzelheiten im Server-Log).',
    };
  }

  // Ein `false` ist hier kein Fehler: Es kann ein Server sein, der diesen
  // Eintrag beim Start bereits abgelehnt hatte (kaputte Zeile) und ihn
  // deshalb nie registriert hat.
  try {
    unregisterUploadedPrefab(name);
  } catch {
    /* schon nicht registriert — Registry und Platte sind trotzdem sauber */
  }

  return { ok: true, name, verbleibend: verbleibend.length };
}

// ── Grundskala nachträglich ändern (Karte „Editor Upload-Größe") ──────
export interface GrundskalaKontext {
  /** Dasselbe Tor wie beim Hochladen — Instanz ≠ live UND server.yml-Schalter an. */
  readonly erlaubt: boolean;
  readonly verzeichnis: string;
}

export type GrundskalaAntwort =
  | { readonly ok: true; readonly eintrag: UploadedModelEntry }
  | { readonly ok: false; readonly meldung: string };

/**
 * Die Grundskala eines SCHON hochgeladenen Modells ändern — dieselbe
 * Datei bleibt liegen, nur der Registry-Eintrag und die Laufzeit-
 * Registrierung (`PREFAB_DEFS`/`PREFABS_BY_NAME`/`PREFABS_BY_HASH`)
 * bekommen den neuen Faktor. Gesetzte Platzierungen behalten ihre
 * `scale` unverändert (Auftrag, Punkt 5) — sie werden dadurch grösser
 * oder kleiner, ohne dass irgendetwas an ihnen selbst geschrieben wird.
 *
 * Geschützt wie der bestehende Upload-Weg: dasselbe `erlaubt`-Tor, dieselbe
 * Namensprüfung wie `entferneUpload` (Handarbeit an der Registry darf nie
 * aus dem Zielordner ausbrechen), derselbe Registry-Schreibweg (temp+rename).
 * Der Name ändert sich nie, also gibt es hier — anders als beim Hochladen —
 * keine neue Hash-Kollision zu prüfen.
 */
export function aendereGrundskala(
  kontext: GrundskalaKontext,
  name: string,
  grundskala: number
): GrundskalaAntwort {
  if (!kontext.erlaubt) {
    return { ok: false, meldung: 'Modell-Upload ist auf dieser Instanz nicht erlaubt (server.yml: uploads.modell-hochladen, oder Instanz live).' };
  }
  if (!NAME_MUSTER.test(name)) {
    return { ok: false, meldung: `Ungültiger Name — erwartet wird das Muster ${NAME_MUSTER}.` };
  }
  const grundskalaFehler = pruefeGrundskala(grundskala);
  if (grundskalaFehler !== null) return { ok: false, meldung: grundskalaFehler };

  let stand: RegistryDatei;
  try {
    stand = leseRegistry(kontext.verzeichnis);
  } catch (e) {
    console.error(`[ModellUpload] Registry unlesbar (${kontext.verzeichnis}): ${(e as Error).message}`);
    return { ok: false, meldung: 'Die Registry ist nicht lesbar (Einzelheiten im Server-Log).' };
  }
  const index = stand.modelle.findIndex((m) => m.name === name);
  if (index < 0) {
    return { ok: false, meldung: `Die Registry kennt '${name}' nicht — es gibt nichts zu ändern.` };
  }

  const eintrag: UploadedModelEntry = { ...stand.modelle[index]!, grundskala };
  const modelle = [...stand.modelle];
  modelle[index] = eintrag;
  try {
    schreibeRegistry(kontext.verzeichnis, modelle);
  } catch (e) {
    console.error(`[ModellUpload] Registry nicht schreibbar (${kontext.verzeichnis}), Grundskala nicht geändert: ${(e as Error).message}`);
    return { ok: false, meldung: 'Die Registry konnte nicht geschrieben werden, nichts wurde geändert (Einzelheiten im Server-Log).' };
  }

  // Laufzeit-Registrierung nachziehen — derselbe Diff-Weg wie
  // `applyUploadedModelRegistry` für GENAU diesen einen Eintrag: austragen,
  // neu eintragen. Der Hash hängt nur am NAMEN (unverändert), kann hier
  // also nie kollidieren.
  try {
    unregisterUploadedPrefab(name);
  } catch {
    /* war (noch) nicht registriert, z. B. weil dieser Prozess gerade erst gestartet ist */
  }
  try {
    registerUploadedPrefab(eintrag);
  } catch (e) {
    console.error(`[ModellUpload] Neu-Registrierung nach Grundskala-Änderung fehlgeschlagen ('${name}'): ${(e as Error).message}`);
    return { ok: false, meldung: 'Grundskala in der Registry geändert, aber nicht neu registriert (Einzelheiten im Server-Log) — ein Neustart des Prozesses holt das nach.' };
  }

  return { ok: true, eintrag };
}
