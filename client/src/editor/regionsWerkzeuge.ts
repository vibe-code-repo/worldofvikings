/**
 * Regions-Vorlagen, Feldvalidierung und Kontinent-/Startpunkt-Logik
 * (Aufgaben B2 + B10) — DOM-frei, ausgelagert aus editorMain.ts (das baut
 * beim Import sofort die ganze Editor-Shell auf und stößt einen Fetch an,
 * s. Begründung in befundSchwere.ts). Reine Funktionen auf `WorldLayout`/
 * `RegionDef`, testbar ohne Browser.
 *
 * ── Vorlagen (B10) ────────────────────────────────────────────────────
 * Eine leere Region-Maske mit einem Dutzend Feldern wird nicht ausgefüllt
 * — eine vorbelegte wird angepasst. Die Werte sind, wo ein Vorbild
 * existiert, aus der DEV-Welt GEMESSEN (Kopie server/data/welten/dev.json
 * → /tmp/dev-kopie.json, Stand 20.08.2026, 19 Regionen): edgeFalloff 300
 * ist der Wert von 17 der 19 Regionen, land-1 (deepnorth) ist mit 400 die
 * einzige Ausnahme. Die Bewuchs-Regler von "Grenzwald" sind exakt die
 * Werte von insel-17 (DEV-Welt) — dem einzigen dort schon existierenden
 * "Mischwald"-Bewuchs. Für "Hoher Norden" und "Hochgebirge" nutzt die
 * DEV-Welt selbst keine Region mit diesem Bewuchs; hier übernehmen die
 * Vorlagen stattdessen die Regler des "Hoher Norden"-Bewuchsknopfs im
 * Regions-Inspektor (editorMain.ts), der seinerseits als GEMESSEN
 * dokumentiert ist (Kommentar dort).
 *
 * Wo KEIN Vorbild existiert — "Hochgebirge" (biome 'mountain'; keine
 * einzige Region der DEV-Welt nutzt dieses Biom) — ist das im `hinweis`
 * jeder Vorlage ausdrücklich vermerkt statt stillschweigend erfunden.
 *
 * `tier` setzt keine Vorlage aus einer Messung: Keine Region der DEV-Welt
 * hat bislang eine Stufe gesetzt (das Feld war bis B2 im Editor gar nicht
 * erreichbar). Die Werte folgen der Rollenbeschreibung aus dem `hinweis`
 * und aus `tierAusDistanz` (shared/src/worldlayout/types.ts): 0 = Start,
 * 5 = Endgame — genau der Roadmap-Befund, den B10 lösen soll ("Endgame-
 * Locations in der Startwiese").
 *
 * ── Feldvalidierung ───────────────────────────────────────────────────
 * Dieselben Grenzen wie `sanitizeWorldLayout` (shared/src/worldlayout/
 * sanitize.ts, private Funktion `klemm`) — dort nicht exportiert, deshalb
 * hier dupliziert. Die Kopie dort ist die serverseitige Wahrheit; diese
 * hier ist nur Editor-Komfort (ein Wert klemmt sofort sichtbar, statt
 * erst beim Speichern lautlos verändert wiederzukommen). Der Test
 * `client/test/region-werkzeuge.ts` hält die Grenzen gegen ECHTE
 * `sanitizeWorldLayout`-Läufe fest, damit eine künftige Änderung dort
 * hier auffällt statt als stille Drift.
 */
import {
  ASCHE_FLORA_NAMEN,
  GRASLAND_FLORA_NAMEN,
  HOCHNORD_FLORA_NAMEN,
  LAYOUT_MAX_EXTENT,
  NADELWALD_FLORA_NAMEN,
  SUMPF_FLORA_NAMEN,
  type BiomeName,
  type ContinentDef,
  type RegionDef,
  type WorldLayout,
} from '@wov/shared';

// ── Feldvalidierung ─────────────────────────────────────────────────────

function klemm(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function klemmInt(v: number, min: number, max: number): number {
  return Math.round(klemm(v, min, max));
}

/**
 * Klemmt jedes in `patch` GESETZTE Feld auf den Wertebereich, den
 * `sanitizeWorldLayout` zulässt (dieselben Grenzen, s. Dateikopf). Felder,
 * die im Patch fehlen, bleiben unangetastet — kein Feld wird durch Klemmen
 * neu ERFUNDEN, nur ein vorhandenes eingeschränkt.
 */
export function klemmeRegionsFelder(patch: Partial<RegionDef>): Partial<RegionDef> {
  const ergebnis: Partial<RegionDef> = { ...patch };
  if (patch.edgeFalloff !== undefined) ergebnis.edgeFalloff = klemm(patch.edgeFalloff, 16, 5000);
  if (patch.baseLevel !== undefined) ergebnis.baseLevel = klemm(patch.baseLevel, 0.03, 0.6);
  if (patch.heightScale !== undefined) ergebnis.heightScale = klemm(patch.heightScale, 0, 4);
  if (patch.tier !== undefined) ergebnis.tier = klemmInt(patch.tier, 0, 5);
  if (patch.forestDensity !== undefined) ergebnis.forestDensity = klemm(patch.forestDensity, 0, 2);
  if (patch.bewuchsDichte !== undefined) ergebnis.bewuchsDichte = klemm(patch.bewuchsDichte, 0.1, 4);
  if (patch.waldKoernung !== undefined) ergebnis.waldKoernung = klemm(patch.waldKoernung, 0.2, 3);
  if (patch.abstandFaktor !== undefined) ergebnis.abstandFaktor = klemm(patch.abstandFaktor, 0.3, 2);
  if (patch.nester !== undefined) ergebnis.nester = klemm(patch.nester, 0, 1);
  if (patch.nesterKoernung !== undefined) ergebnis.nesterKoernung = klemm(patch.nesterKoernung, 0.2, 3);
  return ergebnis;
}

/** Weltkoordinate klemmen wie `sanitizeWorldLayout`s `koordinate()`: auf
 *  ±LAYOUT_MAX_EXTENT begrenzt, auf Millimeter gerundet. */
export function klemmeKoordinate(v: number): number {
  return Math.round(klemm(v, -LAYOUT_MAX_EXTENT, LAYOUT_MAX_EXTENT) * 1000) / 1000;
}

// ── Regions-Vorlagen (B10) ───────────────────────────────────────────────

export interface RegionVorlage {
  id: string;
  name: string;
  /** Emoji-Kennzeichen, wie es die Bewuchs-Knöpfe im Regions-Inspektor
   *  bereits vor ihren Text setzen (kein eigenes Sinnbild-Icon nötig). */
  sinnbild: string;
  /** Erklärt die Herkunft der Werte — Messung oder Design-Entscheidung. */
  hinweis: string;
  werte: Partial<RegionDef> & { biome: BiomeName };
}

// Dieselbe Namensliste wie der "Mischwald"-Bewuchsknopf im
// Regions-Inspektor (editorMain.ts) — dort als GEMESSEN an insel-17
// dokumentiert (Werte s. u.).
const MISCHWALD_FLORA_NAMEN: readonly string[] = [
  ...new Set([...GRASLAND_FLORA_NAMEN, ...NADELWALD_FLORA_NAMEN]),
];

export const REGION_VORLAGEN: readonly RegionVorlage[] = [
  {
    id: 'startwiese',
    name: 'Startwiese',
    sinnbild: '🌾',
    hinweis:
      'edgeFalloff 300 m: Mehrheitswert (17 von 19 Regionen der DEV-Welt). ' +
      'Bewuchs bleibt Biom-Standard — wie 14 der 16 Grasland-Inseln dort. ' +
      'tier 0: Startgebiet, keine Beschränkung nötig, aber ausdrücklich gesetzt statt "frei".',
    werte: { biome: 'grassland', tier: 0, edgeFalloff: 300 },
  },
  {
    id: 'grenzwald',
    name: 'Grenzwald',
    sinnbild: '🌲',
    hinweis:
      'Bewuchs-Regler exakt wie insel-17 (DEV-Welt), dort der "Mischwald"-Knopf. ' +
      'edgeFalloff 300 m wie insel-2, dem einzigen Schwarzwald-Biom der DEV-Welt. ' +
      'tier 2: Übergangszone zwischen Startgebiet und Kernland.',
    werte: {
      biome: 'blackforest',
      tier: 2,
      edgeFalloff: 300,
      vegetation: MISCHWALD_FLORA_NAMEN,
      forestDensity: 1.1,
      bewuchsDichte: 1.2,
      waldKoernung: 0.6,
      abstandFaktor: 0.75,
      nester: 0.8,
    },
  },
  {
    id: 'sumpfmoor',
    name: 'Sumpfmoor',
    sinnbild: '🌿',
    hinweis:
      'edgeFalloff 300 m wie insel-3, dem einzigen Sumpf-Biom der DEV-Welt. ' +
      'Bewuchs-Regler wie der "Sumpf"-Knopf im Regions-Inspektor (dort begründet: ' +
      'hohe Bewuchsdichte bei mittlerem Waldanteil, feine Körnung). tier 1: früher, ' +
      'aber nicht das Startgebiet selbst.',
    werte: {
      biome: 'swamp',
      tier: 1,
      edgeFalloff: 300,
      vegetation: SUMPF_FLORA_NAMEN,
      forestDensity: 1.0,
      bewuchsDichte: 1.6,
      waldKoernung: 0.8,
      abstandFaktor: 0.7,
    },
  },
  {
    id: 'hochgebirge',
    name: 'Hochgebirge',
    sinnbild: '🏔',
    hinweis:
      'KEIN Vorbild in der DEV-Welt — keine einzige Region nutzt das Biom "mountain". ' +
      'edgeFalloff 300 m ist deshalb der allgemeine Standardwert, kein Messwert. ' +
      'heightScale 1.6 ist eine Design-Entscheidung (Typkommentar: Mountain entschied in ' +
      'der Radialwelt bei base > 0.4, also bewegteres Gelände als der Rest); Bewuchs-Regler ' +
      'wie der "Hoher Norden"-Knopf (kargste vorhandene Vorlage) als nächstliegende Näherung. ' +
      'tier 4: spät, aber nicht zwingend das äußerste Endgame.',
    werte: {
      biome: 'mountain',
      tier: 4,
      edgeFalloff: 300,
      heightScale: 1.6,
      vegetation: HOCHNORD_FLORA_NAMEN,
      forestDensity: 0.5,
      bewuchsDichte: 0.45,
      waldKoernung: 1.4,
      abstandFaktor: 1.6,
    },
  },
  {
    id: 'hoher-norden',
    name: 'Hoher Norden',
    sinnbild: '❄',
    hinweis:
      'edgeFalloff 400 m exakt wie land-1, der einzigen deepnorth-Region der DEV-Welt und ' +
      'zugleich der einzigen Region überhaupt, die von den sonst durchgängigen 300 m abweicht. ' +
      'Bewuchs-Regler wie der "Hoher Norden"-Knopf im Regions-Inspektor (dort als gemessen ' +
      'dokumentiert: weite Abstände, grobe Körnung). tier 4: spät, kargess Grenzland.',
    werte: {
      biome: 'deepnorth',
      tier: 4,
      edgeFalloff: 400,
      vegetation: HOCHNORD_FLORA_NAMEN,
      forestDensity: 0.5,
      bewuchsDichte: 0.45,
      waldKoernung: 1.4,
      abstandFaktor: 1.6,
    },
  },
  {
    id: 'oedland',
    name: 'Ödland (Aschewüste)',
    sinnbild: '🌋',
    hinweis:
      'edgeFalloff 300 m wie insel-16, dem einzigen Ascheland-Biom der DEV-Welt. ' +
      'Bewuchs leer wie der "Aschewüste"-Knopf (nichts wächst dort, s. dessen Begründung). ' +
      'bewuchsDichte 0.1 statt des Knopf-Werts 0: 0.1 ist die dokumentierte Untergrenze ' +
      '(Feldkommentar in shared/src/worldlayout/types.ts, "0.1 … 4"), sanitizeWorldLayout ' +
      'klemmt eine 0 ohnehin dorthin — bei leerer vegetation-Liste bleibt es ohne Wirkung. ' +
      'tier 5: Endgame — genau der Roadmap-Befund, den B10 löst: Ohne gesetztes tier könnte ' +
      'eine Endgame-Location in der Startwiese entstehen.',
    werte: {
      biome: 'ashlands',
      tier: 5,
      edgeFalloff: 300,
      vegetation: ASCHE_FLORA_NAMEN,
      forestDensity: 0,
      bewuchsDichte: 0.1,
    },
  },
];

/**
 * Felder, die eine Vorlage als GANZES setzt. Fehlt ein Feld in der
 * gewählten Vorlage, wird es auf `undefined` zurückgesetzt (= Vorgabe/
 * Biom-Standard) statt den Wert einer VORHERIGEN Vorlage stehen zu
 * lassen — sonst mischten sich zwei Vorlagen zu einer dritten, die es so
 * nirgends gibt (s. Modul-Kopf).
 */
export function wendeVorlageAn(region: RegionDef, vorlage: RegionVorlage): RegionDef {
  const felder = klemmeRegionsFelder(vorlage.werte);
  return {
    ...region,
    biome: vorlage.werte.biome,
    tier: felder.tier,
    edgeFalloff: felder.edgeFalloff ?? region.edgeFalloff,
    baseLevel: felder.baseLevel,
    heightScale: felder.heightScale,
    forestDensity: felder.forestDensity,
    bewuchsDichte: felder.bewuchsDichte,
    waldKoernung: felder.waldKoernung,
    abstandFaktor: felder.abstandFaktor,
    nester: felder.nester,
    nesterKoernung: felder.nesterKoernung,
    vegetation: felder.vegetation,
  };
}

// ── Kontinente ────────────────────────────────────────────────────────

// Wortgleich mit ID_RE in shared/src/worldlayout/sanitize.ts — dort
// privat, deshalb hier dupliziert (dieselbe Begründung wie bei `klemm`).
const KONTINENT_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

/**
 * Leitet eine ID_RE-taugliche Kennung aus dem Anzeigenamen ab und macht
 * sie eindeutig gegen `bestehende`. Umlaute/Akzente werden zu ihrem
 * Grundbuchstaben normiert (ä→a) statt verworfen — sonst würde "Äsgard"
 * zu einer leeren oder nichtssagenden ID.
 */
export function kontinentIdVorschlag(name: string, bestehende: readonly ContinentDef[]): string {
  const basis =
    name
      .toLowerCase()
      .normalize('NFKD')
      // Kombinierende Diakritika (U+0300..U+036F) weg -- ae->a, e-Akzent->e usw.
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'kontinent';
  const ids = new Set(bestehende.map((k) => k.id));
  if (!ids.has(basis)) return basis;
  let n = 2;
  while (ids.has(`${basis}-${n}`)) n++;
  return `${basis}-${n}`;
}

/** Legt einen Kontinenten an; leerer/reiner-Whitespace-Name ist ein No-Op
 *  (kein Kontinent ohne lesbaren Namen). */
export function kontinentHinzufuegen(
  layout: WorldLayout,
  eingabe: { name: string; faction?: ContinentDef['faction'] }
): WorldLayout {
  const name = eingabe.name.trim().slice(0, 128);
  if (name.length === 0) return layout;
  const id = kontinentIdVorschlag(name, layout.continents);
  const kontinent: ContinentDef = { id, name };
  if (eingabe.faction) kontinent.faction = eingabe.faction;
  return { ...layout, continents: [...layout.continents, kontinent] };
}

/** Nimmt einen Kontinenten weg UND löst seine Referenzen an Regionen —
 *  sonst bliebe `continentId` auf eine Kennung zeigen, die es nicht mehr
 *  gibt (sanitizeWorldLayout ließe das durchgehen, es wäre aber eine
 *  stille Halbwahrheit im Dokument). */
export function kontinentEntfernen(layout: WorldLayout, id: string): WorldLayout {
  return {
    ...layout,
    continents: layout.continents.filter((k) => k.id !== id),
    regions: layout.regions.map((r) => (r.continentId === id ? { ...r, continentId: undefined } : r)),
  };
}

// ── Startpunkt (B2) ──────────────────────────────────────────────────────
// RegionDef hat KEIN Spawn-Feld — der Prüfbefund nennt nur zwei Wege:
// `continent.spawn` (Startpunkt EINER Fraktion) und `WorldLayout.
// defaultSpawn` (Fallback ohne Fraktion). `setzeStartpunkt` bildet genau
// diese zwei ab; ein regionsgebundener dritter Weg existiert im
// Datenmodell nicht und wird hier folgerichtig nicht erfunden.

export type StartpunktZiel = 'welt' | { continentId: string };

export function setzeStartpunkt(layout: WorldLayout, ziel: StartpunktZiel, x: number, z: number): WorldLayout {
  const punkt: readonly [number, number] = [klemmeKoordinate(x), klemmeKoordinate(z)];
  if (ziel === 'welt') {
    return { ...layout, defaultSpawn: punkt };
  }
  return {
    ...layout,
    continents: layout.continents.map((k) => (k.id === ziel.continentId ? { ...k, spawn: punkt } : k)),
  };
}
