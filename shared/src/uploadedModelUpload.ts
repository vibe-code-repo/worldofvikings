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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findPrefabByName } from './prefabs.js';
import { leseGlb, parseGlbChunks } from './kollision/glb.js';
import {
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
  REGISTRY_DATEI,
  REGISTRY_VERSION,
  applyUploadedModelRegistry,
  erzwingeName,
  leereRegistry,
  leseRegistryAusText,
  pruefeRegistryEintrag,
  registerUploadedPrefab,
  unregisterUploadedPrefab,
  uploadedModelEntry,
  type Kollisionsart,
  type RegistryDatei,
  type UploadedModelEntry,
} from './uploadedModelRegistry.js';

/**
 * `<repo>/assets/hochgeladen` — zwei Ebenen hinauf: Diese Datei liegt in
 * `shared/src/`, also `src → shared → <repo>`.
 */
export const UPLOAD_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../assets/hochgeladen'
);

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
  JSON.parse(text); // wirft bei kaputtem JSON — auf dem Server ein Vorfall, kein „dann eben leer".
  return leseRegistryAusText(text);
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
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { breite: maxX - minX, hoehe: maxY - minY, tiefe: maxZ - minZ };
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
}

export type UploadAntwort =
  | { readonly ok: true; readonly eintrag: UploadedModelEntry; readonly hinweise: readonly string[] }
  | { readonly ok: false; readonly meldung: string };

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

  const name = erzwingeName(wunsch.angezeigterName);
  if (name === null) {
    return nein(
      `Aus '${wunsch.angezeigterName}' lässt sich kein zulässiger Name bilden — es müssen Buchstaben, Ziffern oder Unterstriche übrig bleiben.`
    );
  }

  let roh;
  try {
    roh = parseGlbChunks(wunsch.bytes);
  } catch (e) {
    return nein(`Keine gültige GLB-Datei: ${(e as Error).message}.`);
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

  if (uploadedModelEntry(name) !== undefined || findPrefabByName(name) !== undefined) {
    return nein(`Der Name '${name}' ist bereits vergeben — bitte einen anderen Anzeigenamen wählen.`);
  }

  mkdirSync(kontext.verzeichnis, { recursive: true });
  const pfad = join(kontext.verzeichnis, `${name}.glb`);
  if (existsSync(pfad)) {
    return nein(`Unter dem Namen '${name}' liegt bereits eine Datei — bitte einen anderen Anzeigenamen wählen.`);
  }

  // ── Ab hier wird geschrieben ────────────────────────────────────────
  const temp = `${pfad}.neu`;
  writeFileSync(temp, wunsch.bytes);
  renameSync(temp, pfad);

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
  };

  const stand = leseRegistry(kontext.verzeichnis);
  schreibeRegistry(kontext.verzeichnis, [...stand.modelle, eintrag]);

  try {
    registerUploadedPrefab(eintrag);
  } catch (e) {
    // Datei und Registry stehen, der Prozess kennt den Namen aber nicht —
    // derselbe gutartige Ausgang wie bei `ModuleBuild.baueModul`: kein
    // Rollback (der könnte eine Datei löschen, die längst ausgeliefert
    // wird), sondern eine Meldung. Ein Neustart des Betriebsdienstes holt
    // den Eintrag beim nächsten Abgleich nach.
    return nein(`Geschrieben, aber nicht registriert: ${(e as Error).message}`);
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
  const stand = leseRegistry(kontext.verzeichnis);
  const eintrag = stand.modelle.find((m) => m.name === name);
  if (!eintrag) {
    return { ok: false, meldung: `Die Registry kennt '${name}' nicht — es gibt nichts zu entfernen.` };
  }

  const nutzung = platzierungsNutzung(kontext.layoutDatei, name);
  if (nutzung.anzahl > 0 && !bestaetigt) {
    return { ok: false, brauchtBestaetigung: true, nutzung };
  }

  const pfad = join(kontext.verzeichnis, `${name}.glb`);
  if (existsSync(pfad)) {
    const beiseiteOrdner = join(kontext.verzeichnis, 'entfernt');
    mkdirSync(beiseiteOrdner, { recursive: true });
    const zeitstempel = new Date().toISOString().replace(/[:.]/g, '-');
    renameSync(pfad, join(beiseiteOrdner, `${name}.${zeitstempel}.glb`));
  }

  const verbleibend = stand.modelle.filter((m) => m.name !== name);
  schreibeRegistry(kontext.verzeichnis, verbleibend);

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
