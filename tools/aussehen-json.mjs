#!/usr/bin/env node
/**
 * Schreibt die Aussehen-Listen als JSON fuer die Webseite.
 *
 * ── Englische FELDNAMEN, deutsche WERTE ─────────────────────────────
 * Die Schluessel dieser Datei sind Drahtformat: sie werden von
 * wov-web (/erstellen, /konto) gelesen und heissen deshalb englisch,
 * wie alles andere zwischen Server und Browser. Die WERTE bleiben,
 * wie shared/src/aussehen.ts sie fuehrt -- 'wikingerin', 'H_01',
 * 'leder_bh' sind Kennungen, die im Weltspeicher und in der
 * Kontendatenbank liegen. Sie zu uebersetzen waere eine
 * Datenwanderung, kein Umbenennen.
 *
 *   node_modules/.bin/tsx tools/aussehen-json.mjs [--aus <datei>]
 *
 * ── Warum erzeugt und nicht abgeschrieben ────────────────────────────
 * Die Charaktererstellung liegt auf world-of-vikings.com, die Pruefung
 * der eingehenden Wahl im Spielserver. Das sind zwei getrennte Systeme
 * auf zwei Rechnern — genau die Lage, in der zwei Listen unweigerlich
 * auseinanderlaufen. In diesem Projekt ist das schon zweimal passiert
 * (das MCP-Schema kannte `meadows`, als die Welt laengst `grassland`
 * hiess; `server.yml` versprach sechzehn Schluessel, die niemand las),
 * und `figuren.ts` traegt deshalb im Kopf denselben Hinweis.
 *
 * Hier bleibt shared/src/aussehen.ts die eine Quelle. Die Webseite
 * bekommt eine ERZEUGTE Datei; wer sie von Hand bearbeitet, verliert
 * seine Aenderung beim naechsten Lauf.
 *
 * Braucht tsx statt `node`, weil `@wov/shared` TypeScript ist — dieselbe
 * Begruendung wie bei tools/asset-manifest.mjs.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIGUREN, FIGUR_VORGABE,
  FRISUREN, FRISUR_VORGABE,
  BAERTE, BART_VORGABE,
  HAARFARBEN, HAARFARBE_VORGABE,
  RUESTUNG, AUSSEHEN_ORDNER, AUSSEHEN_KOERPER,
  FRACTION_SUNRISE, FRACTION_MIDDAY, FRACTION_SUNSET,
} from '../shared/src/index.ts';

const HIER = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const AUS = argv.includes('--aus')
  ? argv[argv.indexOf('--aus') + 1]
  : resolve(HIER, '../assets/appearance.json');

const englischeHaarfarben = {
  rabenschwarz: 'Raven black', dunkelbraun: 'Dark brown', kastanie: 'Chestnut',
  mittelbraun: 'Medium brown', hellbraun: 'Light brown', aschblond: 'Ash blonde',
  weizenblond: 'Wheat blonde', hellblond: 'Light blonde', fuchsrot: 'Fox red',
  kupfer: 'Copper red', eisgrau: 'Ice grey', schneeweiss: 'Snow white',
};

const daten = {
  generatedBy: 'tools/aussehen-json.mjs aus shared/src/aussehen.ts — nicht von Hand bearbeiten',
  folder: AUSSEHEN_ORDNER,
  body: AUSSEHEN_KOERPER,
  figures: FIGUREN.map((f) => ({
    id: f.id, model: f.modell, name: f.name,
    nameEn: f.id === 'wikingerin' ? 'Viking woman' : 'Viking',
  })),
  defaultFigure: FIGUR_VORGABE,
  hairstyles: FRISUREN.map((f, index) => ({
    id: f.id, file: f.datei, name: f.name,
    nameEn: `Hairstyle ${String(index + 1).padStart(2, '0')}`,
  })),
  defaultHairstyle: FRISUR_VORGABE,
  beards: BAERTE.map((b, index) => ({
    id: b.id, file: b.datei, name: b.name,
    nameEn: `Beard ${String(index + 1).padStart(2, '0')}`,
  })),
  defaultBeard: BART_VORGABE,
  // Der Hex-Wert geht MIT: Die Webseite setzt ihn als Farbfleck neben
  // die Auswahl und reicht ihn an die Vorschau weiter. Sie kennt
  // shared/aussehen.ts nicht — vorschau-web.ts importiert bewusst nur
  // Babylon.
  hairColors: HAARFARBEN.map((h) => ({
    id: h.id, name: h.name, nameEn: englischeHaarfarben[h.id] ?? h.name, hex: h.hex,
  })),
  defaultHairColor: HAARFARBE_VORGABE,
  equipment: RUESTUNG.map((r) => ({
    id: r.id, file: r.datei, name: r.name,
    nameEn: r.id === 'leder_bh' ? 'Leather top' : 'Leather shorts', slot: r.slot,
  })),
  // Tageszeit-Marken fuer die Uhrzeit-Auswahl der Webseite.
  //
  // Aus dem Umgebungsmodell abgeleitet, nicht abgeschrieben: die
  // Sonnenaufgang liegt bei 0.1333 des Tages, also gegen 03:00 und NICHT
  // bei 06:00. Eine von Hand getippte Beschriftung wuerde das frueher oder
  // spaeter falsch behaupten -- dieselbe Begruendung wie fuer die Listen
  // darueber. main.ts baut seine Auswahl aus genau diesen Konstanten.
  timeOfDay: {
    marks: Object.fromEntries([
      [0, 'Mitternacht'],
      [Math.round(FRACTION_SUNRISE * 24), 'Sonnenaufgang'],
      [Math.round(FRACTION_MIDDAY * 24), 'Mittag'],
      [Math.round(FRACTION_SUNSET * 24), 'Sonnenuntergang'],
    ]),
  },
};

mkdirSync(dirname(AUS), { recursive: true });
writeFileSync(AUS, JSON.stringify(daten, null, 2) + '\n', 'utf8');
console.log(
  'GESCHRIEBEN %s — %d Figuren, %d Frisuren, %d Baerte, %d Ruestungsteile, %d Haarfarben',
  AUS, daten.figures.length, daten.hairstyles.length, daten.beards.length, daten.equipment.length,
  daten.hairColors.length
);
