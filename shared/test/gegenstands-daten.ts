/**
 * Items from data, library part G1 (card "Gegenstaende aus Daten G1").
 * Gegenstaende aus Daten, Bibliotheksteil G1.
 *
 * Covers the sanitiser (valid, invalid, broken file, prototype keys, limits, clamps, code collision,
 * text layer, recipe cycles), the registration (atomic swap, replacing removes old items), the
 * "code items unchanged" hash of ITEM_DEFS and the working-copy path helper.
 *
 * The Holzaxt is only test data here; shared/data/gegenstaende.json stays empty.
 *
 * Run: npx tsx shared/test/gegenstands-daten.ts   (from the repo root)
 */
import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ITEMS_BY_NAME,
  ITEM_DEFS,
  REZEPTE,
  findItem,
  istCodeItem,
  replaceDataItems,
  type ItemShared,
} from '../src/items/index.js';
import {
  MAX_DATEI_BYTES,
  MAX_EINTRAEGE,
  datenRezepte,
  gegenstaendeMitUpload,
  GegenstandsSchreibFehler,
  gegenstandZuItem,
  VERWERF_GRUENDE,
  leseGegenstandsDatei,
  pruefeEintrag,
  schreibeGegenstandsDatei,
  wendeGegenstandsDatenAn,
  type GegenstandsEintrag,
} from '../src/items/gegenstandsDaten.js';
import { gegenstandsArbeitsDatei, gegenstandsRepoDatei } from '../src/items/gegenstandsArbeitskopie.js';
import { ersetzeDatenTexte, inhaltText } from '../src/texte.js';

let fehler = 0;
let geprueft = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  geprueft++;
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

type Roh = Record<string, unknown>;

const axt = findItem('AxeFlint');
if (!axt || !axt.holdPosition || !axt.holdRotation) throw new Error('AxeFlint fehlt oder hat keinen Griff');

/** The Holzaxt example with the values of the decision of 29.09. (damage 10, tree level 1, 8 Wood, grip like AxeFlint). */
function holzaxt(ueberschreibe: Roh = {}): Roh {
  return {
    id: 'Holzaxt',
    nameSchluessel: 'inhalt.gegenstand.Holzaxt.name',
    beschreibungSchluessel: 'inhalt.gegenstand.Holzaxt.beschreibung',
    typ: 'zweihaendigWaffe',
    slot: 'hand',
    modell: {
      upload: 'hochgeladen/U_Holzaxt',
      skala: 0.6,
      haltePosition: [...axt!.holdPosition!],
      halteRotation: [...axt!.holdRotation!],
      hiebVersatz: 0,
      animationsSatz: axt!.animationSet ?? 'sword',
    },
    symbol: null,
    stapel: 1,
    gewicht: 2,
    werte: { damage: 10 },
    ernte: { baum: 1 },
    haltbarkeit: { max: 150, verbrauch: 1, ausdauer: 8 },
    itemLevel: 1,
    rarity: 'common',
    rezept: { menge: 1, zutaten: [{ item: 'Wood', menge: 8 }] },
    texte: {
      'inhalt.gegenstand.Holzaxt.name': { de: 'Holzaxt', en: 'Wooden axe' },
      'inhalt.gegenstand.Holzaxt.beschreibung': { de: 'Eine einfache Axt aus Holz.', en: 'A plain axe made of wood.' },
    },
    ...ueberschreibe,
  };
}

/** A minimal valid entry with a name text. */
function schlicht(id: string, ueberschreibe: Roh = {}): Roh {
  return {
    id,
    nameSchluessel: `inhalt.gegenstand.${id}.name`,
    typ: 'material',
    texte: { [`inhalt.gegenstand.${id}.name`]: { de: id, en: `${id} (en)` } },
    ...ueberschreibe,
  };
}

const datei = (eintraege: unknown[], kopf: Roh = {}): string => JSON.stringify({ version: 1, gegenstaende: eintraege, ...kopf });
const lese = (...eintraege: unknown[]) => leseGegenstandsDatei(datei(eintraege));
const grundVon = (r: ReturnType<typeof leseGegenstandsDatei>, i = 0): string | undefined => r.verworfen[i]?.grund;
const hash = (): string => createHash('sha256').update(JSON.stringify(ITEM_DEFS)).digest('hex');
const zustand = (): string =>
  JSON.stringify({
    namen: [...ITEMS_BY_NAME.keys()].filter((n) => !istCodeItem(n)).sort(),
    rezepte: datenRezepte(),
    name: inhaltText('inhalt.gegenstand.Holzaxt.name', 'en'),
  });

// ── 0. Baseline for "code items unchanged" ───────────────────────────
console.log('Gegenstandsdaten — Ausgangslage');
const hashVorher = hash();
const axtVorher = findItem('AxeFlint');
const mapVorher = ITEMS_BY_NAME;
const rezepteVorher = JSON.stringify(REZEPTE);
console.log(`  ITEM_DEFS-Hash (sha256 von JSON.stringify): ${hashVorher}`);
pruefe(datenRezepte().length === 0, 'Datenrezepte sind zu Beginn leer');

// ── 1. The shipped file is empty and valid ───────────────────────────
console.log('Gegenstandsdaten — mitgelieferte Datei');
const wurzel = resolve(fileURLToPath(import.meta.url), '../../..');
const leer = leseGegenstandsDatei(readFileSync(gegenstandsRepoDatei(wurzel), 'utf-8'));
pruefe(leer.ok && leer.dateiFehler === null && leer.eintraege.length === 0 && leer.verworfen.length === 0, 'shared/data/gegenstaende.json ist gueltig und leer');
wendeGegenstandsDatenAn(leer.eintraege);
pruefe(hash() === hashVorher, 'ITEM_DEFS byte-gleich nach Anwenden der leeren Datei');
replaceDataItems([]);
pruefe(hash() === hashVorher, 'ITEM_DEFS byte-gleich nach replaceDataItems([])');

// ── 2. Valid entry (Holzaxt) ─────────────────────────────────────────
console.log('Gegenstandsdaten — gueltiger Eintrag');
const gut = lese(holzaxt());
pruefe(gut.ok && gut.eintraege.length === 1 && gut.verworfen.length === 0 && gut.unbekannteFelder === 0, 'Holzaxt wird ohne Verlust gelesen');
const e0 = gut.eintraege[0] as GegenstandsEintrag;
pruefe(e0.werte.damage === 10 && e0.ernte.baum === 1 && e0.rezept?.zutaten[0].item === 'Wood' && e0.rezept.zutaten[0].menge === 8, 'Schaden 10, ernte.baum 1, Rezept 8 Wood');
const item = gegenstandZuItem(e0);
pruefe(item.name === 'Holzaxt' && item.label === 'Holzaxt', 'name = id, label = deutscher Name');
pruefe(item.model === 'hochgeladen/U_Holzaxt' && item.modellSkala === 0.6, 'model = Upload-Kennung, modellSkala 0,6');
pruefe(JSON.stringify(item.holdPosition) === JSON.stringify(axt.holdPosition) && JSON.stringify(item.holdRotation) === JSON.stringify(axt.holdRotation), 'Griff gleich AxeFlint');
pruefe(item.datenItem === true && item.toolTier === 0 && item.ernte?.baum === 1 && item.nameSchluessel === 'inhalt.gegenstand.Holzaxt.name', 'datenItem, toolTier 0, ernte, nameSchluessel');
pruefe(item.stats?.damage === 10 && item.maxStackSize === 1 && item.weight === 2 && item.icon === '', 'Werte, Stapel, Gewicht, kein Symbol (Rueckfall)');
pruefe(item.maxDurability === 150 && item.attackStamina === 8 && item.useDurabilityDrain === 1, 'Haltbarkeitsfelder');
pruefe(item.itemType === axt.itemType, 'zweihaendigWaffe wie AxeFlint (TwoHandedWeapon)');
const minimal = lese(schlicht('Klein'));
pruefe(minimal.eintraege.length === 1 && minimal.eintraege[0].stapel === 1 && minimal.eintraege[0].rezept === null && minimal.eintraege[0].modell.upload === null, 'Mindesteintrag bekommt Vorgaben');
pruefe(gegenstandZuItem(minimal.eintraege[0]).model === null, 'ohne Upload model = null');

// ── 3. Invalid entries: one reason code each ─────────────────────────
console.log('Gegenstandsdaten — ungueltige Eintraege');
const faelle: Array<[string, Roh | unknown, string]> = [
  ['id klein geschrieben', schlicht('holzaxt2', { id: 'holzaxt2' }), 'id-ungueltig'],
  ['id mit Pfad', schlicht('Ab', { id: 'A/../b' }), 'id-ungueltig'],
  ['id fehlt', { nameSchluessel: 'inhalt.gegenstand.X.name', typ: 'material' }, 'id-ungueltig'],
  ['Eintrag kein Objekt', 42, 'eintrag-kein-objekt'],
  ['Eintrag Liste', [1, 2], 'eintrag-kein-objekt'],
  ['typ unbekannt', schlicht('Aa', { typ: 'zauberstab' }), 'typ-unbekannt'],
  ['typ fehlt', schlicht('Ab', { typ: undefined }), 'typ-unbekannt'],
  ['slot unbekannt', schlicht('Ac', { slot: 'kopf' }), 'slot-unbekannt'],
  ['Schluessel fremder Praefix', schlicht('Ad', { nameSchluessel: 'inhalt.gegenstand.Anderer.name' }), 'schluessel-ungueltig'],
  ['Schluessel ohne inhalt.', schlicht('Ae', { nameSchluessel: 'name' }), 'schluessel-ungueltig'],
  ['Upload ohne Praefix', schlicht('Af', { modell: { upload: 'U_Holzaxt' } }), 'modell-ungueltig'],
  ['Upload mit ..', schlicht('Ag', { modell: { upload: 'hochgeladen/../U_x' } }), 'modell-ungueltig'],
  ['Upload mit Schraegstrich', schlicht('Ah', { modell: { upload: 'hochgeladen/U_a/b' } }), 'modell-ungueltig'],
  ['Upload zu lang', schlicht('Ai', { modell: { upload: `hochgeladen/U_${'x'.repeat(41)}` } }), 'modell-ungueltig'],
  ['Halteposition zwei Werte', schlicht('Aj', { modell: { haltePosition: [0, 1] } }), 'modell-ungueltig'],
  ['Animationssatz unbekannt', schlicht('Ak', { modell: { animationsSatz: 'magie' } }), 'modell-ungueltig'],
  ['Symbol mit Pfad', schlicht('Al', { symbol: '../etc/passwd' }), 'symbol-ungueltig'],
  ['Schaden als Text', schlicht('Am', { werte: { damage: '10' } }), 'zahl-ungueltig'],
  ['Schaden unendlich (1e999)', JSON.parse('{"id":"An","nameSchluessel":"inhalt.gegenstand.An.name","typ":"material","werte":{"damage":1e999},"texte":{"inhalt.gegenstand.An.name":{"de":"a","en":"a"}}}'), 'zahl-ungueltig'],
  ['werte kein Objekt', schlicht('Ao', { werte: [1] }), 'werte-ungueltig'],
  ['rarity unbekannt', schlicht('Ap', { rarity: 'mythisch' }), 'feld-ungueltig'],
  ['ernte kein Objekt', schlicht('Aq', { ernte: 3 }), 'feld-ungueltig'],
  ['Rezept ohne Zutaten', schlicht('Ar', { rezept: { menge: 1, zutaten: [] } }), 'rezept-ungueltig'],
  ['Rezept 21 Zutaten', schlicht('As', { rezept: { menge: 1, zutaten: Array.from({ length: 21 }, (_, i) => ({ item: `Wood${i}`, menge: 1 })) } }), 'rezept-ungueltig'],
  ['Rezept Zutat doppelt', schlicht('At', { rezept: { menge: 1, zutaten: [{ item: 'Wood', menge: 1 }, { item: 'Wood', menge: 2 }] } }), 'rezept-ungueltig'],
  ['Rezept Zutat ohne Menge', schlicht('Au', { rezept: { menge: 1, zutaten: [{ item: 'Wood' }] } }), 'rezept-ungueltig'],
  ['Rezept Selbstbezug', schlicht('Av', { rezept: { menge: 1, zutaten: [{ item: 'Av', menge: 1 }] } }), 'rezept-selbstbezug'],
  ['Rezept Zutat unbekannt', schlicht('Aw', { rezept: { menge: 1, zutaten: [{ item: 'GibtEsNicht', menge: 1 }] } }), 'rezept-zutat-unbekannt'],
];
for (const [name, roh, grund] of faelle) {
  const r = lese(roh);
  pruefe(r.ok && r.eintraege.length === 0 && grundVon(r) === grund, `${name} -> ${grund} (war: ${grundVon(r)})`);
}
// Good entries next to bad ones survive.
const gemischt = lese(schlicht('Gut1'), 42, schlicht('Gut2'));
pruefe(gemischt.eintraege.map((e) => e.id).join() === 'Gut1,Gut2' && gemischt.verworfen.length === 1 && gemischt.verworfen[0].index === 1, 'gueltige Nachbarn bleiben, Index des verworfenen stimmt');
const doppelt = lese(schlicht('Zwei'), schlicht('Zwei'));
pruefe(doppelt.eintraege.length === 1 && grundVon(doppelt) === 'id-doppelt', 'doppelte id: der erste bleibt, der zweite id-doppelt');
pruefe(lese(42).verworfen.every((v) => typeof v.grund === 'string' && !/\s/.test(v.grund)), 'Grund-Codes sind Kennungen, kein Freitext');

// ── 4. Broken file as a whole ────────────────────────────────────────
console.log('Gegenstandsdaten — kaputte Datei');
const dateiFehlerVon = (text: string) => leseGegenstandsDatei(text);
const kaputt: Array<[string, string, string]> = [
  ['kein JSON', '{"version":1,', 'datei-kein-json'],
  ['leerer Text', '', 'datei-kein-json'],
  ['Wurzel Liste', '[]', 'datei-kopf-falsch'],
  ['version fehlt', '{"gegenstaende":[]}', 'datei-kopf-falsch'],
  ['gegenstaende kein Array', '{"version":1,"gegenstaende":{}}', 'datei-kopf-falsch'],
  ['version als Text', '{"version":"1","gegenstaende":[]}', 'datei-kopf-falsch'],
  ['version 2', '{"version":2,"gegenstaende":[]}', 'datei-version-unbekannt'],
];
for (const [name, text, grund] of kaputt) {
  const r = dateiFehlerVon(text);
  pruefe(!r.ok && r.dateiFehler === grund && r.eintraege.length === 0, `${name} -> ${grund} (war: ${r.dateiFehler})`);
}
const mitteKaputt = leseGegenstandsDatei('{"version":1,"gegenstaende":[{"id":"Ok1"},');
pruefe(!mitteKaputt.ok, 'abgeschnittene Datei ist kaputt');

// ── 5. Limits: 500 entries / 256 KB ──────────────────────────────────
console.log('Gegenstandsdaten — Grenzen');
const viele = (n: number) => Array.from({ length: n }, (_, i) => schlicht(`Item${i}`.replace(/\d/g, (d) => 'ABCDEFGHIJ'[Number(d)])));
const vollste = leseGegenstandsDatei(datei(viele(MAX_EINTRAEGE)));
pruefe(vollste.ok && vollste.eintraege.length === MAX_EINTRAEGE && vollste.verworfen.length === 0, `genau ${MAX_EINTRAEGE} Eintraege sind erlaubt`);
const zuViele = leseGegenstandsDatei(datei(viele(MAX_EINTRAEGE + 1)));
pruefe(!zuViele.ok && zuViele.dateiFehler === 'datei-zu-viele-eintraege' && zuViele.eintraege.length === 0, '501 Eintraege: ganze Datei abgelehnt');
const polster = (n: number) => datei([], { fuellung: 'x'.repeat(n) });
const grenze = MAX_DATEI_BYTES - polster(0).length;
pruefe(leseGegenstandsDatei(polster(grenze - 16)).dateiFehler !== 'datei-zu-gross', 'knapp unter MAX_DATEI_BYTES ist nicht zu gross');
const genau = polster(MAX_DATEI_BYTES - polster(0).length + 1);
pruefe(genau.length > MAX_DATEI_BYTES && leseGegenstandsDatei(genau).dateiFehler === 'datei-zu-gross', 'MAX_DATEI_BYTES + 1 Byte: zu gross');
// Multi-byte characters count as bytes, not as characters.
const umlaute = polster(Math.ceil(MAX_DATEI_BYTES / 2));
pruefe(umlaute.length < MAX_DATEI_BYTES && leseGegenstandsDatei(datei([], { fuellung: 'ä'.repeat(MAX_DATEI_BYTES / 2 + 10) })).dateiFehler === 'datei-zu-gross', 'Umlaute zaehlen als Bytes (zwei je Zeichen)');

// ── 6. Prototype keys ────────────────────────────────────────────────
console.log('Gegenstandsdaten — Prototypschluessel');
const proto = leseGegenstandsDatei(
  '{"version":1,"gegenstaende":[{"__proto__":{"polluted":1},"constructor":{"x":1},"id":"Pr","nameSchluessel":"inhalt.gegenstand.Pr.name","typ":"material",' +
  '"werte":{"__proto__":{"damage":99},"damage":5},"texte":{"inhalt.gegenstand.Pr.name":{"de":"a","en":"b","__proto__":{"de":"x"}}}}]}'
);
pruefe(proto.eintraege.length === 1 && proto.eintraege[0].werte.damage === 5, 'Prototypschluessel werden nicht gelesen');
pruefe(proto.unbekannteFelder >= 4, `Prototypschluessel als unbekannte Felder gezaehlt (${proto.unbekannteFelder})`);
pruefe(({} as Roh).polluted === undefined && ({} as Roh).damage === undefined && !Object.hasOwn(Object.prototype, 'polluted'), 'Object.prototype unveraendert');
pruefe(lese(schlicht('Ax', { id: 'constructor' })).verworfen[0]?.grund === 'id-ungueltig', 'id "constructor" wird abgelehnt');
pruefe(grundVon(lese(schlicht('Ay', { texte: { __proto__x: { de: 'a', en: 'b' } } }))) === 'texte-schluessel-fremd', 'fremder Texteschluessel wird abgelehnt');

// ── 7. Clamps and unknown fields ─────────────────────────────────────
console.log('Gegenstandsdaten — Klemmen und unbekannte Felder');
const geklemmt = lese(holzaxt({
  stapel: 5000, gewicht: -3, itemLevel: 500,
  werte: { damage: 9999, armor: 5000, strength: -4 },
  ernte: { baum: 99, fels: -2 },
  modell: { skala: 100, hiebVersatz: 9, haltePosition: [50, -50, 0], halteRotation: [100, 0, -100] },
  rezept: { menge: 5000, zutaten: [{ item: 'Wood', menge: 0 }, { item: 'Stone', menge: 5000 }] },
})).eintraege[0];
pruefe(geklemmt.stapel === 999 && geklemmt.gewicht === 0 && geklemmt.itemLevel === 100, 'stapel <= 999, gewicht >= 0, itemLevel <= 100');
pruefe(geklemmt.werte.damage === 200 && geklemmt.werte.armor === 1000 && geklemmt.werte.strength === 0, 'damage <= 200, sonst <= 1000, nie negativ');
pruefe(geklemmt.ernte.baum === 5 && geklemmt.ernte.fels === 0, 'ernte auf 0..5 geklemmt');
pruefe(geklemmt.modell.skala === 5 && geklemmt.modell.hiebVersatz === 1.5 && geklemmt.modell.haltePosition?.[0] === 2 && geklemmt.modell.haltePosition?.[1] === -2, 'Modellwerte geklemmt');
pruefe(Math.abs((geklemmt.modell.halteRotation?.[0] ?? 0) - 2 * Math.PI) < 1e-9, 'Rotation auf +-2 pi geklemmt');
pruefe(geklemmt.rezept?.menge === 999 && geklemmt.rezept.zutaten[0].menge === 1 && geklemmt.rezept.zutaten[1].menge === 999, 'Rezeptmengen auf 1..999');
const unbekannt = lese(holzaxt({ rezept: { station: 'werkbank', menge: 1, zutaten: [{ item: 'Wood', menge: 8, extra: 1 }] }, zauber: 'feuer', werte: { damage: 10, mana: 3 } }));
pruefe(unbekannt.eintraege.length === 1 && unbekannt.unbekannteFelder === 4, `unbekannte Felder (station, extra, zauber, mana) verworfen und gezaehlt: ${unbekannt.unbekannteFelder}`);
pruefe(!('station' in (unbekannt.eintraege[0].rezept as object)) && !('zauber' in unbekannt.eintraege[0]), 'unbekannte Felder kommen im Ergebnis nicht vor');

// ── 8. Collision with code items ─────────────────────────────────────
console.log('Gegenstandsdaten — Kollision mit Code-Items');
const setTeil = ITEM_DEFS.find((d) => d.ruestungsteil)?.name as string;
for (const n of ['AxeFlint', 'Wood', 'Club']) {
  pruefe(lese(schlicht(n)).verworfen[0]?.grund === 'id-code-kollision', `Code-Item ${n} gewinnt: Eintrag verworfen`);
}
// Clothing and set parts are code items too; their names cannot even pass the id pattern (underscore).
pruefe(istCodeItem(setTeil) && lese(schlicht('Xx', { id: setTeil })).verworfen[0]?.grund !== undefined && lese(schlicht('Xx', { id: setTeil })).eintraege.length === 0, `Set-Teil ${setTeil} kann nicht als Datenitem angelegt werden`);
const kollision = lese(schlicht('AxeFlint'), schlicht('Neu1'));
pruefe(kollision.eintraege.length === 1 && kollision.eintraege[0].id === 'Neu1', 'nur der kollidierende Eintrag faellt weg');
wendeGegenstandsDatenAn(lese(holzaxt()).eintraege);
pruefe(findItem('AxeFlint') === axtVorher, 'AxeFlint bleibt dasselbe Objekt (Code-Item unangetastet)');
replaceDataItems([]);
let geworfen = false;
try {
  replaceDataItems([{ ...(axt as ItemShared), datenItem: true }]);
} catch {
  geworfen = true;
}
pruefe(geworfen && findItem('AxeFlint') === axtVorher, 'replaceDataItems lehnt ein Datenitem mit Code-Namen ab');

// ── 8b. Case-insensitive collisions (N1) ─────────────────────────────
console.log('Gegenstandsdaten — Kollision ohne Beachtung der Schreibung');
for (const n of ['MESSER', 'HOE', 'PICKAXEANTLER', 'axeflint'.replace(/^a/, 'A').toUpperCase(), 'WOOD']) {
  const r = lese(schlicht(n));
  pruefe(r.eintraege.length === 0 && grundVon(r) === 'id-schreibung-code', `${n} neben einem Code-Item -> id-schreibung-code (war: ${grundVon(r)})`);
}
const da = lese(schlicht('Da'), schlicht('DA'), schlicht('dA'.replace(/^d/, 'D')));
pruefe(da.eintraege.map((e) => e.id).join() === 'Da' && da.verworfen.length === 2 && da.verworfen.every((v) => v.grund === 'id-schreibung-doppelt'), 'Da / DA: der erste bleibt, die anderen id-schreibung-doppelt');
let schreibWurf = false;
try {
  replaceDataItems([{ ...(axt as ItemShared), name: 'AXEFLINT', datenItem: true }]);
} catch {
  schreibWurf = true;
}
pruefe(schreibWurf, 'replaceDataItems lehnt auch AXEFLINT ab (letzte Verteidigungslinie)');
let schreibWurf2 = false;
try {
  replaceDataItems([{ ...(axt as ItemShared), name: 'Zz', datenItem: true }, { ...(axt as ItemShared), name: 'ZZ', datenItem: true }]);
} catch {
  schreibWurf2 = true;
}
pruefe(schreibWurf2 && findItem('Zz') === undefined, 'replaceDataItems lehnt Zz/ZZ ab, nichts uebernommen');

// ── 8c. Non-finite numbers in every number field (N1) ────────────────
console.log('Gegenstandsdaten — Infinity in allen Zahlenfeldern');
const unendlich = ['1e999', '-1e999'];
const zahlenFelder: Array<[string, (w: string) => string]> = [
  ['stapel', (w) => `"stapel":${w}`],
  ['gewicht', (w) => `"gewicht":${w}`],
  ['itemLevel', (w) => `"itemLevel":${w}`],
  ['werte.damage', (w) => `"werte":{"damage":${w}}`],
  ['werte.armor', (w) => `"werte":{"armor":${w}}`],
  ['ernte.baum', (w) => `"ernte":{"baum":${w}}`],
  ['ernte.fels', (w) => `"ernte":{"fels":${w}}`],
  ['modell.skala', (w) => `"modell":{"skala":${w}}`],
  ['modell.hiebVersatz', (w) => `"modell":{"hiebVersatz":${w}}`],
  ['modell.haltePosition', (w) => `"modell":{"haltePosition":[0,${w},0]}`],
  ['modell.halteRotation', (w) => `"modell":{"halteRotation":[0,0,${w}]}`],
  ['haltbarkeit.max', (w) => `"haltbarkeit":{"max":${w}}`],
  ['haltbarkeit.verbrauch', (w) => `"haltbarkeit":{"verbrauch":${w}}`],
  ['haltbarkeit.ausdauer', (w) => `"haltbarkeit":{"ausdauer":${w}}`],
  ['rezept.menge', (w) => `"rezept":{"menge":${w},"zutaten":[{"item":"Wood","menge":1}]}`],
  ['rezept.zutat.menge', (w) => `"rezept":{"menge":1,"zutaten":[{"item":"Wood","menge":${w}}]}`],
];
const kopfText = '"id":"Inf1","nameSchluessel":"inhalt.gegenstand.Inf1.name","typ":"material","texte":{"inhalt.gegenstand.Inf1.name":{"de":"a","en":"b"}}';
for (const [feld, bau] of zahlenFelder) {
  for (const w of unendlich) {
    const r = leseGegenstandsDatei(`{"version":1,"gegenstaende":[{${kopfText},${bau(w)}}]}`);
    const erwartet = feld.startsWith('rezept') ? 'rezept-ungueltig' : 'zahl-ungueltig';
    const grund = feld.startsWith('modell.halte') ? 'modell-ungueltig' : erwartet;
    pruefe(r.eintraege.length === 0 && (grundVon(r) === grund || grundVon(r) === 'zahl-ungueltig'), `${feld} = ${w} verwirft den Eintrag (war: ${grundVon(r)})`);
  }
}

// ── 9. Text layer ────────────────────────────────────────────────────
console.log('Gegenstandsdaten — Texte-Schicht');
wendeGegenstandsDatenAn([]);
pruefe(inhaltText('inhalt.gegenstand.Holzaxt.name', 'de') === 'inhalt.gegenstand.Holzaxt.name', 'ohne Datenstand: Schluessel selbst als Rueckfall');
wendeGegenstandsDatenAn(lese(holzaxt()).eintraege);
pruefe(inhaltText('inhalt.gegenstand.Holzaxt.name', 'de') === 'Holzaxt' && inhaltText('inhalt.gegenstand.Holzaxt.name', 'en') === 'Wooden axe', 'Schicht liefert de und en ueber inhaltText');
pruefe(inhaltText('inhalt.gegenstand.Holzaxt.name', 'fr') === 'Holzaxt' && inhaltText('inhalt.gegenstand.Holzaxt.name', undefined) === 'Holzaxt', 'unbekannte Sprache faellt auf Deutsch zurueck');
pruefe(inhaltText('inhalt.item.beispiel', 'de') === 'Beispieltext', 'Repo-Katalog unveraendert erreichbar');
ersetzeDatenTexte({ de: new Map([['inhalt.item.beispiel', 'SCHICHT']]), en: new Map([['inhalt.item.beispiel', 'LAYER']]) });
pruefe(inhaltText('inhalt.item.beispiel', 'de') === 'Beispieltext' && inhaltText('inhalt.item.beispiel', 'en') !== 'LAYER', 'ein Schluessel im Repo-Katalog gewinnt gegen die Schicht');
pruefe(inhaltText('inhalt.gegenstand.Holzaxt.name', 'de') === 'inhalt.gegenstand.Holzaxt.name', 'Ersetzen der Schicht entfernt die alten Texte');
ersetzeDatenTexte({ de: new Map([['__proto__', 'x'], ['constructor', 'y']]), en: new Map() });
pruefe(inhaltText('toString', 'de') === 'toString' && inhaltText('__proto__', 'de') === 'x', 'Prototypnamen bleiben harmlos (Map statt Objekt)');
wendeGegenstandsDatenAn([]);
pruefe(inhaltText('__proto__', 'de') === '__proto__', 'wendeGegenstandsDatenAn([]) leert die Schicht');
const textFaelle: Array<[string, Roh, string]> = [
  ['fremder Praefix in texte', holzaxt({ texte: { 'inhalt.gegenstand.Anderer.name': { de: 'x', en: 'y' }, 'inhalt.gegenstand.Holzaxt.name': { de: 'a', en: 'b' } } }), 'texte-schluessel-fremd'],
  ['Schluessel weder Name noch Beschreibung', holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.sonst': { de: 'x', en: 'y' }, 'inhalt.gegenstand.Holzaxt.name': { de: 'a', en: 'b' } } }), 'texte-schluessel-fremd'],
  ['en fehlt', holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'Holzaxt' } } }), 'texte-name-fehlt'],
  ['de fehlt', holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { en: 'Axe' } } }), 'texte-name-fehlt'],
  ['en nur Leerzeichen', holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'Holzaxt', en: '   ' } } }), 'texte-name-fehlt'],
  ['texte fehlt ganz', holzaxt({ texte: undefined }), 'texte-name-fehlt'],
  ['Text 201 Zeichen', holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'x'.repeat(201), en: 'y' } } }), 'texte-ungueltig'],
  ['Steuerzeichen', holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'a\u0007b', en: 'y' } } }), 'texte-ungueltig'],
  ['RTL-Override U+202E', holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'a\u202Eb', en: 'y' } } }), 'texte-ungueltig'],
  ['Bidi-Isolat U+2066', holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'a\u2066b', en: 'y' } } }), 'texte-ungueltig'],
  ['Nullbreit U+200B', holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'a\u200Bb', en: 'y' } } }), 'texte-ungueltig'],
  ['Nullbreit U+200F', holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'a\u200Fb', en: 'y' } } }), 'texte-ungueltig'],
  ['BOM U+FEFF', holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: '\uFEFFa', en: 'y' } } }), 'texte-ungueltig'],
  ['Zeilentrenner U+2028', holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'a\u2028b', en: 'y' } } }), 'texte-ungueltig'],
  ['Zeilenumbruch', holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'a\nb', en: 'y' } } }), 'texte-ungueltig'],
  ['Text keine Zeichenkette', holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 5, en: 'y' } } }), 'texte-ungueltig'],
];
for (const [name, roh, grund] of textFaelle) {
  const r = lese(roh);
  pruefe(r.eintraege.length === 0 && grundVon(r) === grund, `${name} -> ${grund} (war: ${grundVon(r)})`);
}
pruefe(lese(holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'x'.repeat(200), en: 'y' } } })).eintraege.length === 1, '200 Zeichen sind erlaubt');
pruefe(lese(holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: '<b>Axt</b> & Co', en: 'Ümlaut ß 斧' } } })).eintraege.length === 1, 'HTML und normale Unicode-Zeichen bleiben erlaubt (Anzeige nur per textContent)');
const fremdSprache = lese(holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'a', en: 'b', fr: 'c' } } }));
pruefe(fremdSprache.eintraege.length === 1 && fremdSprache.unbekannteFelder === 1 && !('fr' in fremdSprache.eintraege[0].texte['inhalt.gegenstand.Holzaxt.name']), 'weitere Sprache wird verworfen und gezaehlt');
pruefe(lese(holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'a', en: 'b' } } })).eintraege.length === 1, 'Beschreibung ohne Text ist erlaubt');

// ── 9b. Invisible characters by category (N2) ────────────────────────
console.log('Gegenstandsdaten — unsichtbare Zeichen');
const unsichtbar: number[] = [
  0x061c, 0x180e, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x2065, 0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f,
  0x034f, 0x00ad, 0xfe00, 0xfe0f, 0xe0001, 0xe0020, 0xe007f, 0xe0100, 0xe01ef, 0xfff9, 0xfffa, 0xfffb, 0xfffc,
  0x3164, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180c, 0x180d, 0x2800, 0x1d173, 0xfffe, 0xffff, 0xd800, 0xdfff,
  0xe000, 0x2029, 0xfff0, 0xfff8, 0xfdd0, 0xfdef, 0x1fffe, 0x10ffff, 0xe0fff,
];
const nameMit = (de: string) => holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de, en: 'Axe' } } });
for (const cp of unsichtbar) {
  const z = cp >= 0xd800 && cp <= 0xdfff ? String.fromCharCode(cp) : String.fromCodePoint(cp);
  const hex = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  const mitten = lese(nameMit(`a${z}b`));
  const ganz = lese(nameMit(z + z));
  const mittenOk = mitten.eintraege.length === 0 && grundVon(mitten) === 'texte-ungueltig';
  const ganzOk = ganz.eintraege.length === 0 && (grundVon(ganz) === 'texte-ungueltig' || grundVon(ganz) === 'texte-name-fehlt');
  pruefe(mittenOk && ganzOk, `${hex} mitten im Namen und als ganzer Name abgelehnt`);
}
pruefe(unsichtbar.length >= 41, `mindestens 41 Codepunkte geprueft (${unsichtbar.length})`);
pruefe(lese(nameMit('a\u{1F600}b')).eintraege.length === 1, 'gueltiges Surrogatpaar (Emoji) bleibt erlaubt');
pruefe(lese(holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: '!!! ---', en: 'Axe' } } })).verworfen[0]?.grund === 'texte-ungueltig', 'Name ohne Buchstabe und Ziffer wird abgelehnt');
pruefe(lese(holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'Axt', en: '  \u00a0 ' } } })).eintraege.length === 0, 'Name nur aus Leerraum wird abgelehnt');
for (const name of ["Äxte über Öl", 'Straße', 'Café Zoë', "O'Brien-Axt", 'Éowyn’s Schwert', 'Axt 2', '1234', '斧', 'Ünï-çødé ß']) {
  pruefe(lese(nameMit(name)).eintraege.length === 1, `normaler Name bleibt erlaubt: ${name}`);
}

// ── 10. Recipes across entries ───────────────────────────────────────
console.log('Gegenstandsdaten — Rezepte, Zyklen');
const rz = (id: string, ...zutaten: string[]) => schlicht(id, { rezept: { menge: 1, zutaten: zutaten.map((item) => ({ item, menge: 1 })) } });
const zyklus = lese(rz('Aa', 'Bb'), rz('Bb', 'Aa'), rz('Cc', 'Aa'), rz('Dd', 'Wood'), rz('Ee', 'Dd'));
pruefe(zyklus.eintraege.map((e) => e.id).join() === 'Dd,Ee', `Zyklus Aa<->Bb faellt weg, auch Cc (haengt daran); Dd und Ee bleiben: ${zyklus.eintraege.map((e) => e.id).join()}`);
pruefe(zyklus.verworfen.filter((v) => v.grund === 'rezept-zyklus').length === 2 && zyklus.verworfen.some((v) => v.id === 'Cc' && v.grund === 'rezept-zutat-unbekannt'), 'Codes: zwei mal rezept-zyklus, Cc rezept-zutat-unbekannt');
const dreier = lese(rz('Aa', 'Bb'), rz('Bb', 'Cc'), rz('Cc', 'Aa'));
pruefe(dreier.eintraege.length === 0 && dreier.verworfen.length === 3, 'Dreierzyklus faellt ganz weg');
const raute = lese(rz('Aa', 'Bb', 'Cc'), rz('Bb', 'Dd'), rz('Cc', 'Dd'), rz('Dd', 'Stone'));
pruefe(raute.eintraege.length === 4, 'Raute (kein Zyklus) bleibt');
const kette = lese(rz('Aa', 'Bb'), rz('Bb', 'Wood'));
pruefe(kette.eintraege.length === 2, 'Datenitem als Zutat eines Datenitems ist erlaubt');
wendeGegenstandsDatenAn(kette.eintraege);
const dr = datenRezepte();
pruefe(dr.length === 2 && dr[0].ergebnis === 'Aa' && dr[0].zutaten[0].item === 'Bb', 'datenRezepte() liefert die Rezepte der Datenitems');
pruefe(REZEPTE.every((r) => r.zutaten.every((z) => istCodeItem(z.item)) && istCodeItem(r.ergebnis)), 'Code-Rezepte nutzen nur Code-Items');
pruefe(JSON.stringify(REZEPTE) === rezepteVorher, 'REZEPTE byte-gleich');
wendeGegenstandsDatenAn([]);
pruefe(datenRezepte().length === 0, 'Rezepte werden mit dem Datenstand ersetzt');

// ── 10b. Canonical writer (N3) ───────────────────────────────────────
console.log('Gegenstandsdaten — schreibeGegenstandsDatei');
const alle = lese(
  holzaxt({ haltbarkeit: { max: 150, verbrauch: 1, ausdauer: 8 }, ernte: { baum: 2, fels: 3 }, werte: { damage: 10, armor: 2, strength: 1, vitality: 3, agility: 4 }, symbol: 'axt-holz', rarity: 'rare', itemLevel: 7 }),
  schlicht('Nur'),
  schlicht('Mit', { rezept: { menge: 3, zutaten: [{ item: 'Holzaxt', menge: 2 }, { item: 'Stone', menge: 1 }] }, modell: { upload: 'hochgeladen/U_Mit', hiebVersatz: 0.5, haltePosition: [0.1, 0.2, 0.3] } }),
).eintraege;
pruefe(alle.length === 3, 'Rundreise-Eingabe: drei Eintraege, alle Felder belegt');
const text1 = schreibeGegenstandsDatei(alle);
pruefe(text1.endsWith('}\n') && !text1.endsWith('\n\n') && text1.startsWith('{\n  "version": 1,\n  "gegenstaende": [\n    {\n      "id": "Holzaxt"'), 'zwei Leerzeichen, Zeilenumbruch am Ende, feste Feldreihenfolge (id zuerst)');
const zurueck = leseGegenstandsDatei(text1);
pruefe(zurueck.ok && zurueck.verworfen.length === 0 && zurueck.unbekannteFelder === 0, 'die geschriebene Datei wird ohne Verlust gelesen');
let gleich = true;
try {
  deepStrictEqual(zurueck.eintraege, alle);
} catch {
  gleich = false;
}
pruefe(gleich, 'lese(schreibe(x)).eintraege ist gleich x (texte, rezept, modell, ernte, werte, haltbarkeit)');
pruefe(schreibeGegenstandsDatei(alle) === text1, 'zweimal schreiben: byte-gleich');
pruefe(schreibeGegenstandsDatei(zurueck.eintraege) === text1, 'lese -> schreibe: byte-gleich');
pruefe(schreibeGegenstandsDatei(leseGegenstandsDatei(schreibeGegenstandsDatei(leseGegenstandsDatei(text1).eintraege)).eintraege) === text1, 'lese -> schreibe -> lese -> schreibe: byte-gleich');
// Same entries, other key order in the input -> same output.
const umgedreht = (o: unknown): unknown => (Array.isArray(o) ? o.map(umgedreht) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o as Roh).reverse().map(([k, v]) => [k, umgedreht(v)])) : o);
const ausUmgedreht = leseGegenstandsDatei(JSON.stringify(umgedreht(JSON.parse(text1))));
pruefe(ausUmgedreht.ok && ausUmgedreht.verworfen.length === 0 && schreibeGegenstandsDatei(ausUmgedreht.eintraege) === text1, 'andere Schluesselreihenfolge in der Eingabe ergibt dieselbe Ausgabe');
const leerText = schreibeGegenstandsDatei([]);
pruefe(leerText === '{\n  "version": 1,\n  "gegenstaende": []\n}\n' && leseGegenstandsDatei(leerText).ok, 'leere Liste: kanonische leere Datei, lesbar');
const kleinesText = schreibeGegenstandsDatei(lese(schlicht('Nur')).eintraege);
pruefe(!kleinesText.includes('"fels"') && !kleinesText.includes('"max"'), 'nicht gesetzte Felder tauchen nicht auf (keine erfundenen Vorgaben)');

// ── 10c. pruefeEintrag agrees with leseGegenstandsDatei (N3) ──────────
console.log('Gegenstandsdaten — pruefeEintrag');
const kontext = lese(schlicht('Zwei')).eintraege;
// Bb needs Aa, which is the entry being edited and therefore not part of the context.
const kontextZyklus = lese(schlicht('Aa'), schlicht('Bb', { rezept: { menge: 1, zutaten: [{ item: 'Aa', menge: 1 }] } })).eintraege.filter((e) => e.id === 'Bb');
const pruefFaelle: Array<[string, unknown, GegenstandsEintrag[], string]> = [
  ...faelle.map(([n, roh, g]): [string, unknown, GegenstandsEintrag[], string] => [n, roh, [], g]),
  ...textFaelle.map(([n, roh, g]): [string, unknown, GegenstandsEintrag[], string] => [n, roh, [], g]),
  ['id doppelt im Kontext', schlicht('Zwei'), kontext, 'id-doppelt'],
  ['Schreibung doppelt im Kontext', schlicht('ZWEI'), kontext, 'id-schreibung-doppelt'],
  ['Schreibung Code', schlicht('MESSER'), [], 'id-schreibung-code'],
  ['Code-Kollision', schlicht('Club'), [], 'id-code-kollision'],
  ['Zyklus mit einem Eintrag des Kontexts', rz('Aa', 'Bb'), kontextZyklus, 'rezept-zyklus'],
];
const gesehen = new Set<string>();
for (const [name, roh, andere, grund] of pruefFaelle) {
  const codes = pruefeEintrag(roh, andere);
  const ausDatei = leseGegenstandsDatei(datei([...andere, roh])).verworfen.filter((v) => v.index === andere.length).map((v) => v.grund);
  pruefe(codes.length === 1 && codes[0] === grund, `pruefeEintrag: ${name} -> ${grund} (war: ${codes.join()})`);
  pruefe(JSON.stringify(codes) === JSON.stringify(ausDatei), `pruefeEintrag == leseGegenstandsDatei: ${name}`);
  gesehen.add(grund);
}
// The same cases against a non-empty context: the entry being checked must not be mixed up with the others.
for (const [name, roh, , grund] of pruefFaelle.slice(0, faelle.length + textFaelle.length)) {
  const codes = pruefeEintrag(roh, kontext);
  pruefe(codes.length === 1 && codes[0] === grund, `mit nichtleerem Kontext: ${name} -> ${grund} (war: ${codes.join()})`);
}
pruefe(pruefeEintrag(schlicht('Ok1', { typ: 'x' }), kontext).join() === 'typ-unbekannt', 'ungueltiger Eintrag bei nichtleerem andere: typ-unbekannt (nicht [])');
// A live object that throws must give a code, never an exception.
const werfend = { get id(): string { throw new Error('boom'); } };
const proxyWerfend = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); }, get() { throw new Error('boom'); } });
let wurf = false;
let ausGetter: string[] = [];
let ausProxy: string[] = [];
try {
  ausGetter = pruefeEintrag(werfend, kontext);
  ausProxy = pruefeEintrag(proxyWerfend, []);
} catch {
  wurf = true;
}
pruefe(!wurf && ausGetter.join() === 'eintrag-ungueltig' && ausProxy.join() === 'eintrag-ungueltig', 'werfender Getter und werfender Proxy: eintrag-ungueltig statt Ausnahme');
gesehen.add('eintrag-ungueltig');
// More than 500 entries.
const fuenfhundert = viele(MAX_EINTRAEGE).map((r) => lese(r).eintraege[0]);
pruefe(pruefeEintrag(schlicht('Extra'), fuenfhundert).join() === 'zu-viele-eintraege', 'der 501. Eintrag: zu-viele-eintraege');
pruefe(pruefeEintrag(schlicht('Extra'), fuenfhundert.slice(1)).length === 0, 'der 500. Eintrag ist noch in Ordnung');
gesehen.add('zu-viele-eintraege');
pruefe(VERWERF_GRUENDE.every((g) => gesehen.has(g)), `jeder Grund-Code ist abgedeckt (fehlt: ${VERWERF_GRUENDE.filter((g) => !gesehen.has(g)).join() || 'keiner'})`);
pruefe(pruefeEintrag(holzaxt(), []).length === 0 && pruefeEintrag(schlicht('Frisch'), kontext).length === 0, 'gueltiger Eintrag: leere Liste');
pruefe(pruefeEintrag(rz('Neu9', 'Zwei'), kontext).length === 0, 'Zutat aus den anderen Eintraegen ist bekannt');
pruefe(pruefeEintrag(rz('Neu9', 'Zwei'), []).join() === 'rezept-zutat-unbekannt', 'dieselbe Zutat ohne Kontext: rezept-zutat-unbekannt');

// ── 9c. Characters in context, engine independence (N4) ──────────────
console.log('Gegenstandsdaten — Zeichen im Zusammenhang');
const nameGeht = (de: string): boolean => lese(nameMit(de)).eintraege.length === 1;
const erlaubt: Array<[string, string]> = [
  ['Persisch mit ZWNJ', 'می\u200cخواهم'],
  ['Devanagari mit ZWJ', 'क\u094d\u200dष'],
  ['Emoji-Sequenz Mann+Garbe im Namen', 'Bauer 👨\u200d🌾'],
  ['Emoji mit Hautton und ZWJ', 'Bauerin 👩🏽\u200d🌾'],
  ['Herz mit VS16', 'Axt ❤\ufe0f'],
  ['Herz-Feuer', 'Axt ❤\ufe0f\u200d🔥'],
  ['ZWNJ zwischen Buchstaben (Latein)', 'a\u200cb'],
  ['neu zugewiesenes Emoji U+1FAE9', 'Axt \u{1FAE9}'],
  ['in jeder Unicode-Version unzugewiesen U+0378', 'a\u0378b'],
];
for (const [n, de] of erlaubt) pruefe(nameGeht(de), `erlaubt: ${n}`);
const verboten: Array<[string, string]> = [
  ['ZWJ am Anfang', '\u200dab'],
  ['ZWJ am Ende', 'ab\u200d'],
  ['ZWJ nach Leerzeichen', 'a \u200db'],
  ['ZWJ vor Leerzeichen', 'a\u200d b'],
  ['zwei ZWJ hintereinander', 'a\u200d\u200db'],
  ['ZWNJ zwischen Ziffern', '1\u200c2'],
  ['VS16 am Anfang', '\ufe0fab'],
  ['VS16 nach Buchstabe', 'a\ufe0f'],
  ['weiches Trennzeichen', 'Holz\u00adaxt'],
  ['Nichtzeichen U+FDD0', 'a\ufdd0b'],
  ['Nichtzeichen U+1FFFF', 'a\u{1FFFF}b'],
  ['reiner Emoji-Name', '🪓'],
  ['reine Emoji-Sequenz als Name', '👨\u200d🌾'],
  ['nur Herz mit VS16', '❤\ufe0f'],
];
for (const [n, de] of verboten) pruefe(!nameGeht(de), `verboten: ${n}`);
// The visibility rule holds for the English name too (the `||` branch).
for (const en of ['!!!', '---', '\u{1FA93}', '   ']) {
  const r = lese(holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'Axt', en } } }));
  pruefe(r.eintraege.length === 0 && (grundVon(r) === 'texte-ungueltig' || grundVon(r) === 'texte-name-fehlt'), `gueltiges de, en ohne Buchstabe/Ziffer (${JSON.stringify(en)}) -> abgelehnt`);
}
pruefe(lese(holzaxt({ texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'Axt', en: 'Axe\u2060' } } })).eintraege.length === 0, 'gueltiges de, en mit Wortverbinder -> abgelehnt');
pruefe(!/\p\{Cn\}/.test(readFileSync(new URL('../src/items/gegenstandsDaten.ts', import.meta.url), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')), 'Quelltext benutzt \\p{Cn} nicht mehr (Kommentare ausgenommen)');
// The reader must not throw on odd but valid JSON.
for (const roh of ['null', '"x"', '{"version":1,"gegenstaende":[null,[],{"id":{}},{"id":"Ab","nameSchluessel":[]}]}', '{"version":1,"gegenstaende":[{"__proto__":1}]}']) {
  let wirft = false;
  try {
    leseGegenstandsDatei(roh);
  } catch {
    wirft = true;
  }
  pruefe(!wirft, `leseGegenstandsDatei wirft nie: ${roh.slice(0, 40)}`);
}

// ── 10d. Writer at the limits (N4) ───────────────────────────────────
console.log('Gegenstandsdaten — Schreiber an den Grenzen');
const zutatNamen = ITEM_DEFS.map((d) => d.name).filter((n) => /^[A-Za-z0-9_]{1,64}$/.test(n)).slice(0, 20);
pruefe(zutatNamen.length === 20, 'zwanzig Code-Items als Zutaten vorhanden');
const idNr = (i: number, laenge: number): string => {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  } while (n > 0);
  return `Q${s}`.padEnd(laenge, '0');
};
/** A completely filled entry. `hoechst` = the largest the sanitiser allows; otherwise realistic sizes. */
function voll(i: number, hoechst: boolean): Roh {
  const id = idNr(i, hoechst ? 32 : 14);
  const tx = (n: number, c: string): string => c.repeat(n);
  const zahlL = hoechst ? 0.123456789012345 : 0.6;
  return {
    id,
    nameSchluessel: `inhalt.gegenstand.${id}.name`,
    beschreibungSchluessel: `inhalt.gegenstand.${id}.beschreibung`,
    typ: 'zweihaendigWaffe',
    slot: 'hand',
    modell: {
      upload: hoechst ? `hochgeladen/U_${'x'.repeat(40)}` : 'hochgeladen/U_Holzaxt',
      skala: zahlL, haltePosition: [zahlL, -zahlL, zahlL], halteRotation: [-1.9, zahlL, 0], hiebVersatz: zahlL, animationsSatz: 'sword',
    },
    symbol: hoechst ? 'y'.repeat(64) : 'axt-holz',
    stapel: 999, gewicht: hoechst ? 123.456789012345 : 2.5,
    werte: { damage: 10, armor: 5, strength: 2, vitality: 3, agility: 4 },
    ernte: { baum: 1, fels: 1 },
    haltbarkeit: { max: 150, verbrauch: 1, ausdauer: 8 },
    itemLevel: 42, rarity: 'legendary',
    rezept: { menge: 3, zutaten: zutatNamen.slice(0, hoechst ? 20 : 5).map((item) => ({ item, menge: 999 })) },
    texte: {
      [`inhalt.gegenstand.${id}.name`]: { de: tx(hoechst ? 200 : 40, 'a'), en: tx(hoechst ? 200 : 40, 'b') },
      [`inhalt.gegenstand.${id}.beschreibung`]: { de: tx(hoechst ? 200 : 120, 'c'), en: tx(hoechst ? 200 : 120, 'd') },
    },
  };
}
const viele2 = (n: number, hoechst: boolean): GegenstandsEintrag[] => {
  // Read in chunks: the compact input for 500 largest entries would itself be over the file limit.
  const alle: GegenstandsEintrag[] = [];
  for (let von = 0; von < n; von += 50) {
    const r = leseGegenstandsDatei(datei(Array.from({ length: Math.min(50, n - von) }, (_, k) => voll(von + k, hoechst))));
    if (r.eintraege.length !== Math.min(50, n - von)) throw new Error(`Testdaten ungueltig: ${JSON.stringify(r.verworfen.slice(0, 2))} ${r.dateiFehler}`);
    alle.push(...r.eintraege);
  }
  return alle;
};
const einzeln = (hoechst: boolean): number => new TextEncoder().encode(schreibeGegenstandsDatei(viele2(2, hoechst))).length - new TextEncoder().encode(schreibeGegenstandsDatei(viele2(1, hoechst))).length;
const bytesReal = einzeln(false);
const bytesMax = einzeln(true);
console.log(`  Rechnung: ein voll gefuellter, realistischer Eintrag = ${bytesReal} Byte, der groesstmoegliche = ${bytesMax} Byte; in ${MAX_DATEI_BYTES} Byte passen ${Math.floor(MAX_DATEI_BYTES / bytesReal)} bzw. ${Math.floor(MAX_DATEI_BYTES / bytesMax)}`);
pruefe(bytesReal * MAX_EINTRAEGE < MAX_DATEI_BYTES, `${MAX_EINTRAEGE} realistische, voll gefuellte Eintraege passen in MAX_DATEI_BYTES (${bytesReal * MAX_EINTRAEGE} < ${MAX_DATEI_BYTES})`);
const realText = schreibeGegenstandsDatei(viele2(MAX_EINTRAEGE, false));
const realZurueck = leseGegenstandsDatei(realText);
pruefe(realZurueck.ok && realZurueck.eintraege.length === MAX_EINTRAEGE && realZurueck.verworfen.length === 0, `500 realistische Eintraege: schreiben -> lesen gelingt (${realText.length} Byte)`);
pruefe(schreibeGegenstandsDatei(realZurueck.eintraege) === realText, '... und ist bytestabil');
// Never write what the reader refuses: for every count either the round trip works or the writer throws first.
let letzteOk = 0;
let ersteZuGross = 0;
for (const n of [1, 50, 100, 200, 300, 400, 500]) {
  const liste = viele2(n, true);
  let text: string | null = null;
  let code: string | null = null;
  try {
    text = schreibeGegenstandsDatei(liste);
  } catch (f) {
    code = f instanceof GegenstandsSchreibFehler ? f.code : `fremd:${String(f)}`;
  }
  if (text !== null) {
    const r = leseGegenstandsDatei(text);
    pruefe(r.ok && r.eintraege.length === n && r.verworfen.length === 0, `${n} groesstmoegliche Eintraege: geschrieben und wieder gelesen`);
    letzteOk = n;
  } else {
    pruefe(code === 'datei-zu-gross', `${n} groesstmoegliche Eintraege: Schreiber wirft datei-zu-gross statt eine unlesbare Datei zu schreiben (war: ${code})`);
    if (ersteZuGross === 0) ersteZuGross = n;
  }
}
console.log(`  groesstmoegliche Eintraege: bis ${letzteOk} geschrieben, ab ${ersteZuGross || 'nie'} wirft der Schreiber`);
let zuVieleCode: string | null = null;
try {
  schreibeGegenstandsDatei(viele2(MAX_EINTRAEGE, false).concat(viele2(1, false).map((e) => ({ ...e, id: 'Zusatz' }))));
} catch (f) {
  zuVieleCode = f instanceof GegenstandsSchreibFehler ? f.code : "fremd";
}
pruefe(zuVieleCode === 'datei-zu-viele-eintraege', '501 Eintraege: Schreiber wirft datei-zu-viele-eintraege');
const kompakt = schreibeGegenstandsDatei(lese(schlicht('Nur')).eintraege);
pruefe(!kompakt.includes('null') && !kompakt.includes('{}') && !kompakt.includes('[]'), 'nicht gesetzte Felder fehlen (kein null, keine leeren Objekte)');
pruefe(leseGegenstandsDatei('{"version":1,"gegenstaende":[{"id":"Alt","nameSchluessel":"inhalt.gegenstand.Alt.name","typ":"material","modell":{"hiebVersatz":null},"texte":{"inhalt.gegenstand.Alt.name":{"de":"a","en":"b"}}}]}').eintraege.length === 1, 'alte Dateien mit hiebVersatz: null bleiben lesbar');
let stapelDurch = leseGegenstandsDatei(schreibeGegenstandsDatei(viele2(3, false)));
pruefe(stapelDurch.eintraege.length === 3, 'Rundreise mit voll gefuellten Eintraegen');
stapelDurch = leseGegenstandsDatei(schreibeGegenstandsDatei(lese(schlicht('Kein', { modell: { skala: 1 } })).eintraege));
pruefe(stapelDurch.eintraege[0].modell.skala === 1, 'skala 1 (Vorgabe) wird weggelassen und wieder als 1 gelesen');

// ── 11. Registration: atomic, replacing removes ──────────────────────
console.log('Gegenstandsdaten — Registrierung');
const zwei = lese(holzaxt(), schlicht('Bruch', { werte: { damage: 1 } })).eintraege;
wendeGegenstandsDatenAn(zwei);
pruefe(findItem('Holzaxt')?.datenItem === true && ITEMS_BY_NAME.get('Bruch')?.name === 'Bruch', 'findItem und ITEMS_BY_NAME kennen die Datenitems');
pruefe(ITEMS_BY_NAME !== mapVorher && ITEM_DEFS.every((d) => !d.datenItem), 'ITEMS_BY_NAME ist eine neue Map, ITEM_DEFS bleibt nur Code');
pruefe(datenRezepte().length === 1 && inhaltText('inhalt.gegenstand.Holzaxt.name', 'en') === 'Wooden axe', 'Rezept und Text sind da');
const stand = zustand();
// Failure in the middle of the build: a getter that throws on the second element.
const kaputtesItem = { get name(): string { throw new Error('Aufbau bricht ab'); } } as unknown as ItemShared;
let bruch = false;
try {
  replaceDataItems([gegenstandZuItem(lese(schlicht('Neuling')).eintraege[0]), kaputtesItem]);
} catch {
  bruch = true;
}
pruefe(bruch, 'Fehler mitten im Aufbau wirft');
pruefe(zustand() === stand && findItem('Neuling') === undefined && findItem('Holzaxt') !== undefined && findItem('Bruch') !== undefined, 'alter Stand bleibt stehen, nichts halb uebernommen');
// Same through the high-level function: an entry that bypasses the sanitiser and collides.
const boese = { ...lese(schlicht('Zweiter')).eintraege[0], id: 'Club' } as GegenstandsEintrag;
let bruch2 = false;
try {
  wendeGegenstandsDatenAn([lese(schlicht('Erster')).eintraege[0], boese]);
} catch {
  bruch2 = true;
}
pruefe(bruch2 && zustand() === stand && findItem('Erster') === undefined, 'wendeGegenstandsDatenAn: Kollision mitten in der Liste laesst Items, Rezepte und Texte unveraendert');
let bruch3 = false;
try {
  replaceDataItems([gegenstandZuItem(lese(schlicht('Dupl')).eintraege[0]), gegenstandZuItem(lese(schlicht('Dupl')).eintraege[0])]);
} catch {
  bruch3 = true;
}
pruefe(bruch3 && zustand() === stand, 'doppelter Name in der Liste wirft, alter Stand bleibt');
// Replacing removes old data items.
wendeGegenstandsDatenAn(lese(schlicht('Nur1')).eintraege);
pruefe(findItem('Holzaxt') === undefined && findItem('Bruch') === undefined && findItem('Nur1') !== undefined, 'erneuter Aufruf ersetzt den ganzen Datenstand, entfernte Eintraege sind weg');
pruefe(inhaltText('inhalt.gegenstand.Holzaxt.name', 'en') === 'inhalt.gegenstand.Holzaxt.name' && datenRezepte().length === 0, 'auch Text und Rezept der entfernten Eintraege sind weg');
wendeGegenstandsDatenAn([]);
pruefe(findItem('Nur1') === undefined && [...ITEMS_BY_NAME.keys()].every((n) => istCodeItem(n)), 'Leerliste entfernt alle Datenitems');

// ── 12. Upload use (Ä4) ─────────────────────────────────────────────
console.log('Gegenstandsdaten — gegenstaendeMitUpload');
const mitUpload = lese(holzaxt(), schlicht('Ohne'), schlicht('Andere', { modell: { upload: 'hochgeladen/U_Anderes' } })).eintraege;
pruefe(gegenstaendeMitUpload(mitUpload, 'U_Holzaxt').map((e) => e.id).join() === 'Holzaxt', 'Treffer ueber den Uploadnamen');
pruefe(gegenstaendeMitUpload(mitUpload, 'hochgeladen/U_Holzaxt').length === 1, 'Treffer ueber die volle Kennung');
pruefe(gegenstaendeMitUpload(mitUpload, 'U_Holz').length === 0 && gegenstaendeMitUpload(mitUpload, 'U_Nix').length === 0, 'kein Teiltreffer, kein Treffer ohne Nutzer');
pruefe(gegenstaendeMitUpload([], 'U_Holzaxt').length === 0, 'leere Liste');

// ── 13. Working-copy path (Ä3) ──────────────────────────────────────
console.log('Gegenstandsdaten — Pfad der Arbeitskopie');
pruefe(gegenstandsArbeitsDatei('/srv/wov', '/var/lib/wov/welten') === '/var/lib/wov/welten/gegenstaende.json', 'mit WOV_WELT_VERZEICHNIS: derselbe Ordner wie die Welt, fester Dateiname');
pruefe(gegenstandsArbeitsDatei('/srv/wov', undefined) === '/srv/wov/server/data/welten-arbeit/gegenstaende.json', 'ohne Variable: Ordner der Welt-Arbeitskopie im Checkout');
let relativ = false;
try {
  gegenstandsArbeitsDatei('/srv/wov', 'relativ/pfad');
} catch {
  relativ = true;
}
pruefe(relativ, 'relativer Ordner wird abgelehnt (wie bei der Welt)');
pruefe(gegenstandsRepoDatei('/srv/wov') === '/srv/wov/shared/data/gegenstaende.json', 'Repo-Datei liegt unter shared/data');

// ── 14. Code items unchanged ─────────────────────────────────────────
console.log('Gegenstandsdaten — Code-Items unveraendert');
pruefe(hash() === hashVorher, `ITEM_DEFS-Hash nach allen Laeufen gleich (${hash()})`);
pruefe(findItem('AxeFlint') === axtVorher && ITEM_DEFS.every((d) => d.datenItem === undefined && d.ernte === undefined && d.modellSkala === undefined && d.nameSchluessel === undefined), 'Code-Items tragen keines der neuen Felder');

if (fehler > 0) {
  console.error(`\n${fehler} von ${geprueft} Pruefungen FEHLGESCHLAGEN`);
  process.exit(1);
}
console.log(`\nalle ${geprueft} Pruefungen bestanden`);
