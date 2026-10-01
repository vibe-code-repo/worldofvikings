/**
 * Ruestkammer R1: `GET /accounts/armory` und `GET /accounts/armory/:id`,
 * gegen einen echten node:http-Server und eine echte Kontendatenbank in
 * einem Temp-Verzeichnis.
 *
 * Zusicherungen:
 *  1. Die Liste zeigt keine Standardkonten, keine gebannten (Konto, Spieler)
 *     und keine geloeschten Charaktere/Konten; das Verschwinden gilt sofort,
 *     auch gegen den Puffer.
 *  2. Suche: Teilstring, ohne Gross-/Kleinschreibung, auch fuer Umlaute;
 *     `%`, `_`, `'` und SQL-Text sind nur Zeichen, keine Muster.
 *  3. Seiten: feste Groesse, keine Ueberlappung, Sortierung "zuletzt gespielt
 *     zuerst"; negative, riesige und unlesbare `seite` ergeben eine Seite.
 *  4. Profil: Ausruestung je Platz, Waffe, abgeleitete Werte wie im Spiel,
 *     Symbolpfad, Profiltext nur beim Avatar; der juengste Stand aller Welten.
 *  5. Antworten tragen NUR Schluessel der Positivliste (rekursiv) und weder
 *     Kontoname, E-Mail, spielerId, Position, Bett, Welt noch nicht angelegte
 *     Inventarstuecke.
 *  6. 404: unbekannt, Id 0, nicht numerisch, Standardkonto, gebannt, geloescht.
 *  7. Kaputter Spielstand (kein JSON, Array, falsche Typen, riesiges
 *     Inventar) wirft nicht und gibt nichts preis.
 *  8. Puffer: greift innerhalb von ARMORY_CACHE_MS, laeuft danach ab, bleibt
 *     in der Groesse begrenzt (Uhr ueber `api.armory.uhr` einstellbar).
 */
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ausgehenderNahkampfSchaden, findItem, lebensmaximum, replaceDataItems } from '@wov/shared';
import { KontoApi } from '../src/konto/KontoApi.js';
import { Kontendatenbank } from '../src/konto/Kontendatenbank.js';
import {
  ARMORY_CACHE_MAX, ARMORY_CACHE_MS, ARMORY_NEUBAU_MIN_MS, ARMORY_DROSSEL_FENSTER_MS, ARMORY_DROSSEL_MAX, ARMORY_SEITENGROESSE, ARMORY_SUCHE_MAX,
  bereinigeSuche,
} from '../src/konto/Armory.js';
import { geheimnisErzeugen } from '../src/net/Identitaet.js';
import { passwortEinlagernSync } from '../src/konto/Passwort.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const ordner = mkdtempSync(join(tmpdir(), 'wov-konto-armory-'));
// Auch wenn der Aufbau wirft, bleibt kein Temp-Ordner liegen.
process.on('exit', () => rmSync(ordner, { recursive: true, force: true }));
const db = new Kontendatenbank(join(ordner, 'konten.db'));
const geheimnis = Buffer.from(geheimnisErzeugen(), 'hex');
const api = new KontoApi(db, geheimnis, () => ({ spieler: 0, plaetze: 10, tag: 1, welt: 'test' }), ['gast'], ['gast', 'admin', 'testgast']);
let jetzt = Date.now();
api.armory.uhr = () => jetzt;

const server = createServer((req, res) => { if (!api.behandle(req, res)) res.writeHead(404).end(); });
await new Promise<void>((ok, fehler) => { server.once('error', fehler); server.listen(0, '127.0.0.1', () => ok()); });
const basis = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

let anfragen = 0;
async function hole(pfad: string, herkunft?: string): Promise<{ status: number; text: string; daten: Json }> {
  // Jede Anfrage kommt von einer anderen Herkunft, damit die Drossel (eigener Abschnitt unten) nicht dazwischenfunkt.
  const r = await fetch(basis + pfad, { headers: { 'x-forwarded-for': herkunft ?? `203.0.113.${(++anfragen % 250) + 1}` } });
  const text = await r.text();
  let daten: Json = {};
  try { daten = JSON.parse(text) as Json; } catch { /* leer */ }
  return { status: r.status, text, daten };
}
const liste = (abfrage = '', herkunft?: string) => hole(`/accounts/armory${abfrage}`, herkunft);
/** Die Liste baut sich nach einer Aenderung der Sichtbarkeit hoechstens einmal je ARMORY_NEUBAU_MIN_MS neu: erst die Frist verstreichen lassen. */
const listeFrisch = (abfrage = '', herkunft?: string) => { jetzt += ARMORY_NEUBAU_MIN_MS + 1; return liste(abfrage, herkunft); };
const profil = (id: number | string) => hole(`/accounts/armory/${id}`);
const namen = (d: Json): string[] => (d.eintraege as Json[]).map((e) => e.name as string);

const aussehen = { figur: 'wikingerin', frisur: 'H_01', haarfarbe: 'mittelbraun', augenfarbe: 'fjordblau', ober: '', beine: '' };
function konto(name: string): number {
  const r = db.kontoAnlegen(name, `${name}@example.org`, passwortEinlagernSync('geheimespasswort1'));
  assert.ok(r.ok, `Konto ${name}`);
  return r.konto.id;
}
function figur(kontoId: number, name: string, klasse = 'krieger'): { id: number; spielerId: string } {
  const r = db.charakterAnlegen(kontoId, name, { ...aussehen, klasse });
  assert.ok(r.ok, `Charakter ${name}`);
  return { id: r.charakter.id, spielerId: r.charakter.spielerId };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const roh = (db as any).db as { prepare(s: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): any } };
const zuletzt = (id: number, ms: number | null): void => { roh.prepare('UPDATE charaktere SET zuletzt_gespielt = ? WHERE id = ?').run(ms, id); };
let stand = 0;
function zustand(spielerId: string, daten: unknown, weltId = 'welt-a', s = ++stand): void {
  db.spielerzustandSchreiben([{ spielerId, weltId, stand: s, daten: typeof daten === 'string' ? daten : JSON.stringify(daten) }]);
}
function anzahlCharaktere(): number { return (roh.prepare('SELECT COUNT(*) AS n FROM charaktere').get() as { n: number }).n; }

/**
 * Positivliste je PFAD: Objekt = erlaubte Schluessel mit ihrer Form, 'w' = Skalar oder null,
 * [Form] = Array dieser Form. Alles andere (auch ein erlaubter Schluesselname an der falschen Stelle) faellt durch.
 */
type Form = 'w' | Form[] | { [k: string]: Form };
const STAT: Form = { damage: 'w', armor: 'w', strength: 'w', vitality: 'w', agility: 'w' };
const STUECK: Form = { kennung: 'w', name: 'w', textKey: 'w', seltenheit: 'w', itemStufe: 'w', qualitaet: 'w', werte: STAT, symbol: 'w' };
const ASPEKT: Form = { figur: 'w', frisur: 'w', haarfarbe: 'w', augenfarbe: 'w' };
const EINTRAG: Form = { id: 'w', name: 'w', klasse: 'w', aussehen: ASPEKT, erstellt: 'w', zuletztGespielt: 'w' };
const SLOTS = ['kopf', 'halskette', 'hemd', 'hose', 'schuhe', 'armreif', 'ring1', 'ring2', 'schultern', 'unterarme', 'haende'];
const FORM_LISTE: Form = { eintraege: [EINTRAG], seite: 'w', seitenGroesse: 'w', gesamt: 'w', seiten: 'w' };
const FORM_PROFIL: Form = {
  ...(EINTRAG as Record<string, Form>),
  ausruestung: Object.fromEntries(SLOTS.map((k) => [k, STUECK])),
  waffe: STUECK,
  werte: { ...(STAT as Record<string, Form>), lebenMax: 'w', nahkampfSchaden: 'w' },
  profil: 'w',
};
function schluesselPruefen(wert: unknown, form: Form, pfad = '$'): void {
  if (form === 'w') {
    assert.ok(wert === null || typeof wert !== 'object', `${pfad}: Skalar erwartet`);
    return;
  }
  if (Array.isArray(form)) {
    assert.ok(Array.isArray(wert), `${pfad}: Array erwartet`);
    (wert as unknown[]).forEach((w, i) => schluesselPruefen(w, form[0], `${pfad}[${i}]`));
    return;
  }
  if (wert === null) return;
  assert.ok(typeof wert === 'object' && !Array.isArray(wert), `${pfad}: Objekt erwartet`);
  for (const [k, v] of Object.entries(wert as Record<string, unknown>)) {
    assert.ok(Object.hasOwn(form, k), `Schluessel ausserhalb der Positivliste: ${pfad}.${k}`);
    schluesselPruefen(v, form[k], `${pfad}.${k}`);
  }
}
const GEHEIM = [
  'Alrunskonto', 'alrunskonto@example', 'bett-geheim',  'geheimespasswort1', 'position', 'spawnPoint', 'spawnBett', 'weltId', 'welt-a',
  '123.456', '-98.7', 'spielerId', 'kontoId', 'konto_id', 'inventar', 'Spear', 'durability', 'gridX', 'equipped', 'stack',
];
function nichtsGeheimes(text: string, was: string): void {
  for (const g of GEHEIM) assert.ok(!text.includes(g), `${was}: "${g}" darf nicht in der Antwort stehen`);
}

try {
  // ── Bestand ────────────────────────────────────────────────────────
  const gast = konto('gast');
  const admin = konto('admin');
  const alrun = konto('Alrunskonto');
  const bjarne = konto('Bjarneskonto');
  const gastFigur = figur(gast, 'Gastrecke');
  const adminFigur = figur(admin, 'Adminrecke');
  const ulf = figur(alrun, 'Ärger-Ulf', 'jaeger');
  const bjorn = figur(bjarne, 'Björn Eisenfaust');
  const ohneZeit = figur(bjarne, 'Nie Gespielt');
  zuletzt(ulf.id, 5_000);
  zuletzt(bjorn.id, 9_000);

  const ausruestet = {
    name: 'Ärger-Ulf',
    position: { x: 123.456, y: 7, z: -98.7 },
    flying: false,
    spawnPoint: { x: 1.5, y: 2, z: 3 },
    spawnBettId: 'bett-geheim',
    figur: 'javascript:alert(1)',
    frisur: '<img src=x onerror=1>',
    spielerId: ulf.spielerId,
    ruestung: 'ironward_brust|ironward_hose',
    waffe: 'SwordNorth',
    inventar: [
      { name: 'IronwardCuirass', stack: 1, durability: 100, quality: 3, gridX: 0, gridY: 0, equipped: true },
      { name: 'IronwardLeggings', stack: 1, durability: 100, quality: 2, gridX: 1, gridY: 0, equipped: true },
      { name: 'IronwardHelmet', stack: 1, durability: 100, quality: 1, gridX: 2, gridY: 0, equipped: true },
      { name: 'SwordNorth', stack: 1, durability: 90, quality: 4, gridX: 3, gridY: 0, equipped: true },
      { name: 'Spear', stack: 7, durability: 50, quality: 1, gridX: 4, gridY: 0, equipped: false },
      // Frei, aber NICHT angelegt: darf nicht erscheinen (Platz schuhe ist leer).
      { name: 'IronwardBoots', stack: 1, durability: 100, quality: 9, gridX: 6, gridY: 0, equipped: false },
      // Angelegt, aber nicht die Waffe des Spielstands (`waffe: SwordNorth`): erscheint nicht.
      { name: 'Club', stack: 1, durability: 100, quality: 1, gridX: 7, gridY: 0, equipped: true },
      { name: 'GibtEsNichtImSpiel', stack: 1, durability: 1, quality: 1, gridX: 5, gridY: 0, equipped: true },
    ],
  };
  // Aeltere Zeile einer anderen Welt: darf den juengeren Stand nicht verdraengen.
  zustand(ulf.spielerId, { ...ausruestet, inventar: [], ruestung: '' }, 'welt-b', 1);
  zustand(ulf.spielerId, ausruestet, 'welt-a', 50);

  // ── 1. Liste: Standardkonten fehlen, nur Charakternamen ───────────
  let l = await listeFrisch();
  assert.equal(l.status, 200);
  assert.deepEqual(namen(l.daten), ['Björn Eisenfaust', 'Ärger-Ulf', 'Nie Gespielt'],
    'zuletzt gespielt zuerst, nie gespielte zuletzt, Standardkonten fehlen');
  assert.equal(l.daten.gesamt, 3);
  assert.equal(l.daten.seite, 1);
  assert.equal(l.daten.seitenGroesse, ARMORY_SEITENGROESSE);
  assert.deepEqual(l.daten.eintraege[1].aussehen, { figur: 'wikingerin', frisur: 'H_01', haarfarbe: 'mittelbraun', augenfarbe: 'fjordblau' });
  assert.equal(l.daten.eintraege[1].klasse, 'jaeger');
  assert.equal(l.daten.eintraege[2].zuletztGespielt, null);
  schluesselPruefen(l.daten, FORM_LISTE);
  nichtsGeheimes(l.text, 'Liste');
  assert.ok(!l.text.includes('Bjarneskonto') && !l.text.includes('example.org'), 'kein Kontoname, keine E-Mail');
  for (const f of [gastFigur, adminFigur]) assert.equal((await profil(f.id)).status, 404, 'Standardkonto-Charakter: 404');
  assert.equal((await listeFrisch('?q=gastrecke')).daten.gesamt, 0, 'auch die Suche findet kein Standardkonto');

  // ── 2. Suche ──────────────────────────────────────────────────────
  assert.deepEqual(namen((await listeFrisch('?q=bj%C3%96rn')).daten), ['Björn Eisenfaust'], 'Umlaut ohne Gross-/Kleinschreibung');
  assert.deepEqual(namen((await listeFrisch('?q=%C3%84RGER')).daten), ['Ärger-Ulf'], 'Grossbuchstabe findet Kleinbuchstabe');
  assert.deepEqual(namen((await listeFrisch('?q=ISENF')).daten), ['Björn Eisenfaust'], 'Teilstring mitten im Namen');
  assert.equal((await listeFrisch('?q=%20%20ulf%20')).daten.gesamt, 1, 'getrimmt');
  assert.equal((await listeFrisch('?q=')).daten.gesamt, 3, 'leere Suche = alle');
  const vorher = anzahlCharaktere();
  for (const q of ["'", "' OR '1'='1", "\"; DROP TABLE charaktere;--", "%", "_", "\\", "%25", "a'%", 'x'.repeat(5000), '%00', '\u0000', '😀', 'Ä'.repeat(40)]) {
    const r = await listeFrisch(`?q=${encodeURIComponent(q)}`);
    assert.equal(r.status, 200, `q=${JSON.stringify(q).slice(0, 30)} -> 200`);
    schluesselPruefen(r.daten, FORM_LISTE);
    if (q === '%' || q === '_' || q === "'" || q === "' OR '1'='1" || q === '\\') {
      assert.equal(r.daten.gesamt, 0, `q=${q} ist Text, kein Muster: keine Treffer`);
    }
  }
  assert.equal(anzahlCharaktere(), vorher, 'keine SQL-Einwirkung');
  assert.equal((await listeFrisch('?q=%FF%FE')).status, 200, 'kaputte Prozentkodierung');

  // ── 3. Seiten ─────────────────────────────────────────────────────
  const masse = konto('Massenkonto');
  const massen: number[] = [];
  for (let i = 0; i < 30; i++) {
    const f = figur(masse, `Massenrecke ${String(i).padStart(2, '0')}`);
    zuletzt(f.id, 100 + i);
    massen.push(f.id);
  }
  const s1 = (await listeFrisch('?q=massenrecke')).daten;
  const s2 = (await listeFrisch('?q=massenrecke&seite=2')).daten;
  assert.equal(s1.gesamt, 30);
  assert.equal(s1.seiten, 2);
  assert.equal(s1.eintraege.length, ARMORY_SEITENGROESSE);
  assert.equal(s2.eintraege.length, 30 - ARMORY_SEITENGROESSE);
  assert.equal(s2.seite, 2);
  assert.equal(new Set([...namen(s1), ...namen(s2)]).size, 30, 'keine Ueberlappung');
  assert.equal(s1.eintraege[0].name, 'Massenrecke 29', 'juengster Spielzeitpunkt zuerst');
  assert.equal(s2.eintraege.at(-1).name, 'Massenrecke 00');
  for (const s of ['0', '-1', '-99999999999', 'abc', '1e9', '', '1.5', '%20', '0x10', 'NaN']) {
    const r = await listeFrisch(`?seite=${s}`);
    assert.equal(r.status, 200, `seite=${s} -> 200`);
    assert.equal(r.daten.seite, 1, `seite=${s} -> Seite 1`);
  }
  for (const s of ['99999999999999999999', '999999999', '5']) {
    const r = await listeFrisch(`?seite=${s}`);
    assert.equal(r.status, 200);
    assert.equal(r.daten.seite, r.daten.seiten, `seite=${s} ergibt die letzte Seite`);
    assert.ok(r.daten.eintraege.length > 0);
  }

  // ── 4. Profil ─────────────────────────────────────────────────────
  const werteHier = { vitality: 2, strength: 5 };
  let p = await profil(ulf.id);
  assert.equal(p.status, 200);
  assert.equal(p.daten.name, 'Ärger-Ulf');
  assert.equal(p.daten.klasse, 'jaeger');
  assert.deepEqual(Object.keys(p.daten.ausruestung).sort(), ['hemd', 'hose', 'kopf'], 'ein Stueck je Platz, Unbekanntes fehlt');
  const hemd = p.daten.ausruestung.hemd as Json;
  assert.equal(hemd.kennung, 'IronwardCuirass');
  assert.equal(hemd.textKey, 'inhalt.item.ironward_brust');
  assert.ok(typeof hemd.name === 'string' && hemd.name.length > 0, 'Rueckfall auf das Label');
  assert.equal(hemd.seltenheit, 'rare');
  assert.equal(hemd.itemStufe, 10);
  assert.equal(hemd.qualitaet, 3);
  assert.deepEqual(hemd.werte, { armor: 11, strength: 3, vitality: 1 });
  assert.equal(hemd.symbol, '/assets/sprites/ironward_brust.png', 'relativer Pfad wie im Spielclient');
  assert.equal(p.daten.waffe.kennung, 'SwordNorth');
  assert.equal(p.daten.waffe.symbol, '/assets/sprites/sword_north.png');
  assert.deepEqual(p.daten.werte, {
    damage: 12, armor: 19, strength: werteHier.strength, vitality: werteHier.vitality, agility: 0,
    lebenMax: lebensmaximum(werteHier.vitality, 0), nahkampfSchaden: ausgehenderNahkampfSchaden(12, werteHier.strength),
  }, 'Werte wie der Spielserver sie rechnet');
  assert.equal(p.daten.profil, undefined, 'kein Profiltext ohne Avatar');
  const stueckVon = (name: string, qualitaet: number): Json => {
    const i = findItem(name)!;
    return {
      kennung: name, name: i.label, ...(i.textKey ? { textKey: i.textKey } : {}), seltenheit: i.rarity,
      itemStufe: i.itemLevel, qualitaet, werte: i.stats, symbol: `/assets/sprites/${i.icon}.png`,
    };
  };
  assert.deepEqual(p.daten, {
    id: ulf.id, name: 'Ärger-Ulf', klasse: 'jaeger',
    aussehen: { figur: 'wikingerin', frisur: 'H_01', haarfarbe: 'mittelbraun', augenfarbe: 'fjordblau' },
    erstellt: (await listeFrisch('?q=ulf')).daten.eintraege[0].erstellt, zuletztGespielt: 5_000,
    ausruestung: {
      kopf: stueckVon('IronwardHelmet', 1), hemd: stueckVon('IronwardCuirass', 3), hose: stueckVon('IronwardLeggings', 2),
    },
    waffe: stueckVon('SwordNorth', 4),
    werte: p.daten.werte,
  }, 'das ganze Profil, Feld fuer Feld (kein fremder Wert unter einem erlaubten Schluessel)');
  schluesselPruefen(p.daten, FORM_PROFIL);
  nichtsGeheimes(p.text, 'Profil');
  assert.ok(!p.text.includes('GibtEsNicht'), 'unbekannte Items erscheinen nicht');

  db.avatarSetzen(alrun, ulf.id);
  db.profilTextSetzen(alrun, 'Ich jage Wölfe.');
  jetzt += ARMORY_CACHE_MS + 1;
  p = await profil(ulf.id);
  assert.equal(p.daten.profil, 'Ich jage Wölfe.', 'Profiltext beim Avatar');
  assert.equal((await profil(bjorn.id)).daten.profil, undefined, 'nicht beim anderen Charakter');
  const ohne = (await profil(ohneZeit.id)).daten;
  assert.deepEqual(ohne.ausruestung, {}, 'ohne Spielstand: nichts angelegt');
  assert.equal(ohne.waffe, null);
  assert.equal(ohne.werte.damage, 4, 'Faustschaden');
  assert.equal(ohne.werte.lebenMax, 100);

  // ── 6. 404 ─────────────────────────────────────────────────────────
  for (const id of ['999999', '0', '000000000', 'abc', '-1', '12345678901234', '1.5', '%20']) {
    assert.equal((await profil(id)).status, 404, `/armory/${id} -> 404`);
  }
  assert.equal((await hole('/accounts/armory/1/extra')).status, 404);

  // ── 7. Kaputte Staende ─────────────────────────────────────────────
  const riesig = Array.from({ length: 20_000 }, () => ({
    name: 'IronwardCuirass', stack: 1, durability: 1, quality: 1, gridX: 0, gridY: 0, equipped: true,
  }));
  const kaputte: [string, unknown][] = [
    ['kein JSON', '{kaputt'],
    ['leer', ''],
    ['null', 'null'],
    ['Array', '[1,2,3]'],
    ['Zahl', '42'],
    ['Inventar kein Array', { inventar: 'viel', ruestung: 7, waffe: {} }],
    ['Eintraege falsch', { inventar: [null, 1, 'x', [], { equipped: true }, { name: {}, equipped: true }, { name: 'IronwardCuirass', equipped: 'ja', quality: 'x' }] }],
    ['Aussehen falsch', { figur: { a: 1 }, frisur: 'x'.repeat(500), haarfarbe: 7, ruestung: '|||{"a":' }],
    ['Prototyp', JSON.parse('{"__proto__":{"inventar":[{"name":"Spear","equipped":true}]},"constructor":1}')],
    ['riesiges Inventar', { inventar: riesig }],
    ['Qualitaet nicht endlich', { inventar: [{ name: 'IronwardCuirass', quality: 1e999, equipped: true }] }],
  ];
  const kontoK = konto('Kaputtkonto');
  for (const [was, daten] of kaputte) {
    const f = figur(kontoK, `Kaputt ${was}`.slice(0, 24));
    zustand(f.spielerId, daten);
    const r = await profil(f.id);
    assert.equal(r.status, 200, `${was}: 200 statt Fehler`);
    schluesselPruefen(r.daten, FORM_PROFIL);
    nichtsGeheimes(r.text, was);
    assert.ok(r.daten.name.startsWith('Kaputt'), `${was}: Name aus der Kontenzeile`);
    assert.ok(Object.keys(r.daten.ausruestung).length <= 12, `${was}: hoechstens ein Stueck je Platz`);
  }
  assert.equal((await listeFrisch('?q=kaputt')).status, 200);
  assert.equal((await listeFrisch('?q=kaputt')).daten.gesamt, kaputte.length);

  // ── 1b. Verschwinden: Bann, Loeschung; sofort, auch gegen den Puffer ─
  assert.equal((await listeFrisch('?q=eisenfaust')).daten.gesamt, 1);
  db.bannSetzen('konto', String(bjarne), { grund: 'Test' });
  assert.equal((await listeFrisch('?q=eisenfaust')).daten.gesamt, 0, 'gebanntes Konto verschwindet sofort aus der Liste');
  assert.equal((await profil(bjorn.id)).status, 404, 'und aus dem Profil');
  db.bannAufheben('konto', String(bjarne));
  assert.equal((await profil(bjorn.id)).status, 200, 'Aufheben bringt es zurueck');
  db.bannSetzen('spieler', bjorn.spielerId, { grund: 'Test' });
  assert.equal((await profil(bjorn.id)).status, 404, 'Spielerbann');
  assert.equal((await listeFrisch('?q=eisenfaust')).daten.gesamt, 0, 'Spielerbann versteckt auch in der Liste');
  assert.equal((await profil(ohneZeit.id)).status, 200, 'der andere Charakter des Kontos bleibt');
  db.bannAufheben('spieler', bjorn.spielerId);

  assert.equal((await listeFrisch('?q=Nie%20Gespielt')).daten.gesamt, 1);
  assert.ok(db.charakterLoeschen(bjarne, ohneZeit.id));
  assert.equal((await listeFrisch('?q=Nie%20Gespielt')).daten.gesamt, 0, 'geloeschter Charakter sofort weg');
  assert.equal((await profil(ohneZeit.id)).status, 404);
  assert.equal((await listeFrisch('?q=eisenfaust')).daten.gesamt, 1);
  assert.ok(db.kontoLoeschen(bjarne, db.kontoNachName('Bjarneskonto')!.passwort));
  assert.equal((await listeFrisch('?q=eisenfaust')).daten.gesamt, 0, 'geloeschtes Konto sofort weg');
  assert.equal((await profil(bjorn.id)).status, 404);

  // ── 9. Welt: nur die Zeile der aktiven Welt (B2) ───────────────────
  const weltKonto = konto('Weltenkonto');
  const fritz = figur(weltKonto, 'Weltfritz');
  const stueck = (name: string, equipped = true): Json => ({ name, stack: 1, durability: 9, quality: 1, gridX: 0, gridY: 0, equipped });
  zustand(fritz.spielerId, { inventar: [stueck('IronwardCuirass')], ruestung: '' }, 'welt-fremd', 9_000);
  zustand(fritz.spielerId, { inventar: [stueck('SwordNorth')], waffe: 'SwordNorth', ruestung: '' }, 'welt-a', 2_000);
  {
    const w = (await profil(fritz.id)).daten;
    assert.equal(w.waffe?.kennung, 'SwordNorth', 'Zeile der aktiven Welt, obwohl die fremde einen hoeheren Stand hat');
    assert.deepEqual(w.ausruestung, {}, 'nichts aus der fremden Welt');
  }
  {
    // Ein frischer Server, der noch keine Welt gelesen oder geschrieben hat: lieber keine Ausruestung als eine fremde.
    const ordner2 = mkdtempSync(join(tmpdir(), 'wov-konto-armory-b-'));
    try {
      const db2 = new Kontendatenbank(join(ordner2, 'konten.db'));
      const k2 = db2.kontoAnlegen('Zweitkonto', 'z@example.org', passwortEinlagernSync('geheimespasswort1'));
      assert.ok(k2.ok);
      const c2 = db2.charakterAnlegen(k2.konto.id, 'Unbekannte Welt', { ...aussehen, klasse: 'krieger' });
      assert.ok(c2.ok);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db2 as any).db.prepare('INSERT INTO spielerzustand (spieler_id, welt_id, stand, daten) VALUES (?, ?, ?, ?)')
        .run(c2.charakter.spielerId, 'welt-a', 1, JSON.stringify({ inventar: [stueck('IronwardCuirass')] }));
      const api2 = new KontoApi(db2, geheimnis, () => ({ spieler: 0, plaetze: 1, tag: 1, welt: 't' }));
      assert.deepEqual(api2.armory.profil(c2.charakter.id)!.ausruestung, {}, 'Welt unbekannt: keine Ausruestung');
      db2.spielerzustandLesen('welt-a'); // so beginnt jeder Serverstart
      api2.armory.uhr = () => jetzt + 10 * ARMORY_CACHE_MS;
      assert.ok(api2.armory.profil(c2.charakter.id)!.ausruestung.hemd, 'Welt bekannt: Ausruestung da');
    } finally { rmSync(ordner2, { recursive: true, force: true }); }
  }

  // ── 10. Profiltext haengt nur am Avatar, und der Wechsel gilt sofort (B4) ─
  const zweiKonto = konto('Zweikonto');
  const zwA = figur(zweiKonto, 'Zwilling A');
  const zwB = figur(zweiKonto, 'Zwilling B');
  db.avatarSetzen(zweiKonto, zwA.id);
  db.profilTextSetzen(zweiKonto, 'Text von Zwei');
  assert.equal((await profil(zwA.id)).daten.profil, 'Text von Zwei');
  assert.equal((await profil(zwB.id)).daten.profil, undefined, 'nicht am anderen Charakter des Kontos');
  db.avatarSetzen(zweiKonto, zwB.id);
  assert.equal((await profil(zwA.id)).daten.profil, undefined, 'Avatarwechsel gilt sofort (A)');
  assert.equal((await profil(zwB.id)).daten.profil, 'Text von Zwei', 'Avatarwechsel gilt sofort (B)');
  db.profilTextSetzen(zweiKonto, '');
  assert.equal((await profil(zwB.id)).daten.profil, undefined, 'geleerter Text steht nicht weiter im Profil');

  // ── 11. Banns: befristet, abgelaufen, ueberschrieben (B3/B5) ───────
  const zeitKonto = konto('Zeitkonto');
  const zeitFigur = figur(zeitKonto, 'Zeitbann Zed');
  assert.equal((await profil(zeitFigur.id)).status, 200);
  db.bannSetzen('konto', String(zeitKonto), { bis: Date.now() + 1e10 });
  assert.equal((await profil(zeitFigur.id)).status, 404, 'befristeter, laufender Bann versteckt');
  assert.equal((await listeFrisch('?q=zeitbann')).daten.gesamt, 0);
  db.bannSetzen('konto', String(zeitKonto), { bis: Date.now() - 1_000 });
  assert.equal((await profil(zeitFigur.id)).status, 200, 'abgelaufener Bann versteckt nicht');
  assert.equal((await listeFrisch('?q=zeitbann')).daten.gesamt, 1);
  db.bannAufheben('konto', String(zeitKonto));
  {
    const k5 = konto('Ueberschriebenkonto');
    figur(k5, 'Ueberschrieben Ulla');
    roh.prepare("INSERT INTO banns (art, wert, grund, gesetzt_von, gesetzt, bis) VALUES ('konto', ?, '', '', 1000, 1)").run(String(k5));
    assert.equal((await listeFrisch('?q=ueberschrieben')).daten.gesamt, 1, 'abgelaufene Zeile: sichtbar');
    roh.prepare("UPDATE banns SET bis = NULL WHERE art = 'konto' AND wert = ?").run(String(k5));
    assert.equal((await listeFrisch('?q=ueberschrieben')).daten.gesamt, 0, 'dieselbe Zeile, nur die Frist geaendert: sofort weg');
  }

  // ── 12. Grenzen mit Zahlen, boeses Item, Aussehen (B3/B6/B8) ───────
  const grenzKonto = konto('Grenzkonto');
  const fuellung = (n: number): Json[] => Array.from({ length: n }, () => stueck('Spear', false));
  const innen = figur(grenzKonto, 'Grenze Innen');
  zustand(innen.spielerId, { inventar: [...fuellung(10), stueck('IronwardBoots')] });
  assert.ok((await profil(innen.id)).daten.ausruestung.schuhe, 'Stapel innerhalb der Grenze zaehlt');
  const aussen = figur(grenzKonto, 'Grenze Aussen');
  zustand(aussen.spielerId, { inventar: [...fuellung(1_100), stueck('IronwardBoots')] });
  assert.deepEqual((await profil(aussen.id)).daten.ausruestung, {}, 'Stapel hinter der 1000er-Grenze zaehlt nicht');
  const knapp = figur(grenzKonto, 'Grenze Knapp');
  zustand(knapp.spielerId, JSON.stringify({ inventar: [stueck('IronwardBoots')], pad: 'x'.repeat(3_500_000) }));
  assert.ok((await profil(knapp.id)).daten.ausruestung.schuhe, '3,5 MB werden gelesen');
  const zuGross = figur(grenzKonto, 'Grenze Gross');
  zustand(zuGross.spielerId, JSON.stringify({ inventar: [stueck('IronwardBoots')], pad: 'x'.repeat(4_300_000) }));
  assert.deepEqual((await profil(zuGross.id)).daten.ausruestung, {}, 'ueber 4 MB gilt der Stand als unlesbar');
  const kurz = figur(grenzKonto, 'Grenze Kurz');
  zustand(kurz.spielerId, { ruestung: 'ironward_brust|ironward_hose|{"kopf":"ironward_helm"}' });
  assert.equal((await profil(kurz.id)).daten.werte.armor, 25, 'kurze Ruestungszeichenkette wird gelesen');
  const lang = figur(grenzKonto, 'Grenze Lang');
  zustand(lang.spielerId, { ruestung: `ironward_brust|ironward_hose|{"kopf":"ironward_helm","x":"${'x'.repeat(1_500)}"}` });
  assert.equal((await profil(lang.id)).daten.werte.armor, 0, 'zu lange Ruestungszeichenkette wird nicht dekodiert');
  const riesenKette = figur(grenzKonto, 'Grenze Kette');
  zustand(riesenKette.spielerId, { ruestung: '|'.repeat(3_000_000) });
  const t0 = performance.now();
  assert.equal((await profil(riesenKette.id)).status, 200);
  assert.ok(performance.now() - t0 < 100, 'riesige Ruestungszeichenkette kostet fast nichts');
  const qualitaetFigur = figur(grenzKonto, 'Grenze Qualitaet');
  zustand(qualitaetFigur.spielerId, { inventar: [{ ...stueck('IronwardBoots'), quality: -1.5e300 }, { ...stueck('IronwardHelmet'), quality: 1e300 }] });
  {
    const q = (await profil(qualitaetFigur.id)).daten.ausruestung;
    assert.equal(q.schuhe.qualitaet, 0, 'Qualitaet nach unten gekappt');
    assert.equal(q.kopf.qualitaet, 1000, 'Qualitaet nach oben gekappt');
  }
  assert.equal(Array.from(bereinigeSuche('a'.repeat(100))).length, ARMORY_SUCHE_MAX, 'Suchbegriff auf 32 Zeichen gekuerzt');
  const aussehenFigur = figur(grenzKonto, 'Grenze Aussehen');
  zustand(aussehenFigur.spielerId, { figur: 'javascript:alert(1)', frisur: '<img src=x onerror=1>', haarfarbe: 'x'.repeat(30), augenfarbe: 7 });
  assert.deepEqual((await profil(aussehenFigur.id)).daten.aussehen,
    { figur: 'wikingerin', frisur: 'H_01', haarfarbe: 'mittelbraun', augenfarbe: 'fjordblau' }, 'unbekannte Aussehenswerte fallen auf die Konten-Zeile zurueck');
  const handFigur = figur(grenzKonto, 'Grenze Hand');
  zustand(handFigur.spielerId, { waffe: 'SwordNorth', inventar: [stueck('Club'), stueck('SwordNorth')] });
  assert.equal((await profil(handFigur.id)).daten.waffe.kennung, 'SwordNorth', 'die Waffe des Spielstands gilt, nicht der erste Handstapel');
  zustand(handFigur.spielerId, { waffe: '', inventar: [stueck('Club')] });
  jetzt += ARMORY_CACHE_MS + 1;
  assert.equal((await profil(handFigur.id)).daten.waffe, null, 'leere Waffe = Faust, auch mit einem angelegten Handstapel');
  // Ein Daten-Item mit bosem Symbol und Namen: das Symbol wird null, der Name geht woertlich hinaus (die Webseite escapt).
  const boese = figur(grenzKonto, 'Grenze Boese');
  const stiefel = findItem('IronwardBoots')!;
  replaceDataItems([{ ...stiefel, name: 'BoeseStiefel', label: '<script>x</script>', icon: '../../etc/passwd' }]);
  try {
    zustand(boese.spielerId, { inventar: [stueck('BoeseStiefel')] });
    const b = (await profil(boese.id)).daten.ausruestung.schuhe;
    assert.equal(b.symbol, null, 'Symbol mit Pfadteilen wird verworfen');
    assert.equal(b.name, '<script>x</script>');
  } finally { replaceDataItems([]); }

  // ── 13. Suche und Unicode-Form (B7), feste Standardkonten (B9) ─────
  figur(konto('Nfdkonto'), 'Zoe\u0308 Nfd');
  assert.deepEqual(namen((await listeFrisch('?q=zo%C3%AB')).daten), ['Zoe\u0308 Nfd'], 'NFC-Suche findet einen NFD-Namen');
  figur(konto('Nfckonto'), 'Ren\u00e9 Nfc');
  assert.equal((await listeFrisch(`?q=${encodeURIComponent('rene\u0301')}`)).daten.gesamt, 1, 'NFD-Suche findet einen NFC-Namen');
  {
    // Ohne `standard-konto` in der Konfiguration: gast/admin bleiben trotzdem draussen.
    const api3 = new KontoApi(db, geheimnis, () => ({ spieler: 0, plaetze: 1, tag: 1, welt: 't' }));
    api3.armory.uhr = () => jetzt;
    assert.equal(api3.armory.liste('1', 'gastrecke').gesamt, 0);
    assert.equal(api3.armory.liste('1', 'adminrecke').gesamt, 0);
    assert.equal(api3.armory.profil(gastFigur.id), null);
    assert.equal(api3.armory.profil(adminFigur.id), null);
  }
  // Das in der Konfiguration genannte Standardkonto fehlt ebenfalls.
  figur(db.kontoNachName('testgast')?.id ?? konto('testgast'), 'Testgast Tilda');
  assert.equal((await listeFrisch('?q=tilda')).daten.gesamt, 0, 'Standardkonto aus der Konfiguration');

  // ── 14. Last: keine Zustandsbildung je Anfrage (B1) und Drossel ────
  {
    const a = api.armory as unknown as { aufnahme: unknown; profile: Map<number, unknown>; drosselung: Map<string, unknown> };
    await liste();
    const vorherAufnahme = a.aufnahme;
    for (let i = 0; i < 60; i++) {
      await liste(`?q=wechsel${i}`);
      await liste(`?seite=${1_000_000 + i}`);
    }
    assert.equal(a.aufnahme, vorherAufnahme, 'wechselnde q und seite bauen nichts Neues und fuellen keinen Speicher');
    // Neubau hoechstens einmal je ARMORY_NEUBAU_MIN_MS, auch wenn sich die Sichtbarkeit aendert (Schutz vor Anlegen/Loeschen in Schleife).
    const schnellKonto = konto('Schnellkonto');
    figur(schnellKonto, 'Schnell Anna');
    jetzt += ARMORY_NEUBAU_MIN_MS + 1;
    const vorher = (await liste()).daten.gesamt; // baut neu (Anna ist neu)
    const schnell = figur(schnellKonto, 'Schnell Sven');
    assert.equal((await liste()).daten.gesamt, vorher, 'innerhalb der Frist: noch der alte Stand');
    assert.equal((await profil(schnell.id)).status, 200, 'das Profil prueft die Sichtbarkeit aber immer sofort');
    jetzt += ARMORY_NEUBAU_MIN_MS + 1;
    assert.equal((await liste()).daten.gesamt, vorher + 1, 'danach neu gebaut');
    const fuell = konto('Fuellkonto');
    const fuellIds: number[] = [];
    for (let i = 0; i < ARMORY_CACHE_MAX + 50; i++) fuellIds.push(figur(fuell, `Fuell ${i}`).id);
    for (const id of fuellIds) assert.equal((await profil(id)).status, 200);
    assert.ok(a.profile.size <= ARMORY_CACHE_MAX, `Profil-Puffer bleibt begrenzt (${a.profile.size})`);
    const ip = '198.51.100.77';
    for (let i = 0; i < ARMORY_DROSSEL_MAX; i++) assert.equal((await liste('', ip)).status, 200, `Anfrage ${i + 1} noch erlaubt`);
    assert.equal((await liste('', ip)).status, 429, 'danach Drossel (Liste)');
    assert.equal((await profil(ulf.id)).status, 200, 'andere Herkunft unberuehrt');
    assert.equal((await hole(`/accounts/armory/${ulf.id}`, ip)).status, 429, 'danach Drossel (Profil)');
    assert.equal((await hole('/accounts/armory', ip)).daten.error, 'rate-limited');
    jetzt += ARMORY_DROSSEL_FENSTER_MS + 1;
    assert.equal((await liste('', ip)).status, 200, 'nach dem Fenster wieder frei');
    assert.ok(a.drosselung.size < 4096);
  }

  // ── 8. Puffer ─────────────────────────────────────────────────────
  zuletzt(ulf.id, 5_000);
  jetzt += ARMORY_CACHE_MS + 1;
  const erste = await liste('?q=ulf');
  assert.equal(erste.daten.eintraege[0].zuletztGespielt, 5_000);
  zuletzt(ulf.id, 7_777);
  jetzt += ARMORY_CACHE_MS - 5_000;
  assert.equal((await liste('?q=ulf')).daten.eintraege[0].zuletztGespielt, 5_000, 'innerhalb der Frist: gepufferte Antwort');
  jetzt += 5_001;
  assert.equal((await liste('?q=ulf')).daten.eintraege[0].zuletztGespielt, 7_777, 'nach der Frist: frisch aus der Datenbank');

  assert.equal((await profil(ulf.id)).daten.waffe.kennung, 'SwordNorth');
  zustand(ulf.spielerId, { ...ausruestet, inventar: [], ruestung: '' }, 'welt-a', 99);
  assert.equal((await profil(ulf.id)).daten.waffe.kennung, 'SwordNorth', 'Profil ebenfalls gepuffert');
  jetzt += ARMORY_CACHE_MS + 1;
  assert.equal((await profil(ulf.id)).daten.waffe, null, 'Profil nach der Frist frisch');


  console.log('konto-armory: OK');
} finally {
  server.close();
  server.closeAllConnections?.();
  rmSync(ordner, { recursive: true, force: true });
}
