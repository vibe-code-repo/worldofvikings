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
import { connect as netConnect } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ausgehenderNahkampfSchaden, findItem, lebensmaximum, replaceDataItems } from '@wov/shared';
import { KontoApi, rohPfadUnzulaessig } from '../src/konto/KontoApi.js';
import { herkunftErmitteln } from '../src/net/Herkunft.js';
import { Kontendatenbank } from '../src/konto/Kontendatenbank.js';
import {
  ARMORY_CACHE_MAX, ARMORY_CACHE_MS, ARMORY_NEUBAU_MIN_MS, ARMORY_DROSSEL_FENSTER_MS, ARMORY_DROSSEL_MAX, ARMORY_SEITENGROESSE, ARMORY_SUCHE_MAX,
  ARMORY_EIMER, ARMORY_KANDIDATEN_MAX, Armory, bereinigeSuche,
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
/** Wie `liste`, aber nach Ablauf der Neubau-Frist UND nachdem der in Haeppchen laufende Neubau fertig ist (der erste Aufruf kann 503 oder den alten Stand liefern). */
const listeFrisch = async (abfrage = '', herkunft?: string) => {
  jetzt += ARMORY_NEUBAU_MIN_MS + 1;
  await liste(abfrage, herkunft);
  await api.armory.bereit();
  return liste(abfrage, herkunft);
};
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
/** Eine Stunde in ms: `zuletztGespielt` wird nach aussen auf volle Stunden abgerundet. */
const H = 3_600_000;
const EINTRAG: Form = { id: 'w', name: 'w', klasse: 'w', aussehen: ASPEKT, erstellt: 'w', zuletztGespielt: 'w' };
const SLOTS = ['kopf', 'halskette', 'hemd', 'hose', 'schuhe', 'armreif', 'ring1', 'ring2', 'schultern', 'unterarme', 'haende'];
const FORM_LISTE: Form = { eintraege: [EINTRAG], seite: 'w', seitenGroesse: 'w', gesamt: 'w', seiten: 'w', suche: 'w', suche_gekuerzt: 'w' };
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
  zuletzt(ulf.id, 5 * H);
  zuletzt(bjorn.id, 9 * H);

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
    if (q === "' OR '1'='1") assert.equal(r.daten.gesamt, 0, `q=${q} ist Text, kein Muster: keine Treffer`);
    if (q === '%' || q === '_' || q === "'" || q === '\\') {
      assert.equal(r.daten.suche, '', `q=${q}: ein Zeichen ist keine Suche`);
      assert.ok(r.daten.gesamt > 0, `q=${q}: dieselbe Antwort wie ohne Suche`);
    }
  }
  assert.equal(anzahlCharaktere(), vorher, 'keine SQL-Einwirkung');
  assert.equal((await listeFrisch('?q=%FF%FE')).status, 200, 'kaputte Prozentkodierung');

  // ── 3. Seiten ─────────────────────────────────────────────────────
  const masse = konto('Massenkonto');
  const massen: number[] = [];
  for (let i = 0; i < 30; i++) {
    const f = figur(masse, `Massenrecke ${String(i).padStart(2, '0')}`);
    zuletzt(f.id, (100 + i) * H);
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
    erstellt: (await listeFrisch('?q=ulf')).daten.eintraege[0].erstellt, zuletztGespielt: 5 * H,
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
  assert.equal((await listeFrisch('?q=eisenfaust')).daten.gesamt, 1, 'und auch in der Liste (neuer Stand gebaut)');
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

  // ── 12b. Der Profil-Puffer ueberlebt keinen Neubau des Speicherstands (O8) ─
  {
    const o8 = figur(konto('Puffer8konto'), 'Puffer Acht');
    zustand(o8.spielerId, { waffe: 'SwordNorth', inventar: [stueck('SwordNorth')] });
    await listeFrisch(); // Charakter ist neu: Stand mit ihm
    assert.equal((await profil(o8.id)).daten.waffe.kennung, 'SwordNorth');
    zustand(o8.spielerId, { waffe: '', inventar: [] });
    assert.equal((await profil(o8.id)).daten.waffe.kennung, 'SwordNorth', 'gepuffert');
    figur(konto('Puffer8zwei'), 'Puffer Acht Zwei'); // aendert die Sichtbarkeit => Neubau
    await listeFrisch();
    assert.equal((await profil(o8.id)).daten.waffe, null, 'nach dem Neubau kein alter Profil-Puffer mehr');
  }

  // ── 12c. Ein uralter Stand zeigt keine Geloeschten und Gebannten (N2-2) ─
  {
    const schlaf = konto('Schlafkonto');
    const schlafFigur = figur(schlaf, 'Schlaf Sven');
    const schlafBann = konto('Schlafbannkonto');
    figur(schlafBann, 'Schlaf Bert');
    const schlafBleibt = figur(konto('Schlafbleibtkonto'), 'Schlaf Clara');
    assert.equal((await listeFrisch('?q=schlaf')).daten.gesamt, 3, 'Stand mit allen dreien');
    db.charakterLoeschen(schlaf, schlafFigur.id);
    db.bannSetzen('konto', String(schlafBann), { grund: 'Test' });
    jetzt += 3_600_000; // eine Stunde ohne Aufruf
    const erster = await liste('?q=schlaf'); // EIN Aufruf, ohne auf den Neubau zu warten
    assert.equal(erster.status, 200);
    assert.deepEqual(namen(erster.daten), ['Schlaf Clara'], 'der erste Aufruf nach der Pause zeigt weder den geloeschten noch den gebannten Charakter');
    assert.ok(schlafBleibt.id > 0);
    await api.armory.bereit();
    assert.equal((await liste('?q=schlaf')).daten.gesamt, 1, 'danach der neue Stand');
  }

  // ── 13. Suche und Unicode-Form (B7), feste Standardkonten (B9) ─────
  figur(konto('Nfdkonto'), 'Zoe\u0308 Nfd');
  assert.deepEqual(namen((await listeFrisch('?q=zo%C3%AB')).daten), ['Zoe\u0308 Nfd'], 'NFC-Suche findet einen NFD-Namen');
  figur(konto('Nfckonto'), 'Ren\u00e9 Nfc');
  assert.equal((await listeFrisch(`?q=${encodeURIComponent('rene\u0301')}`)).daten.gesamt, 1, 'NFD-Suche findet einen NFC-Namen');
  {
    // Ohne `standard-konto` in der Konfiguration: gast/admin bleiben trotzdem draussen.
    const api3 = new KontoApi(db, geheimnis, () => ({ spieler: 0, plaetze: 1, tag: 1, welt: 't' }));
    api3.armory.uhr = () => jetzt;
    assert.equal(api3.armory.liste('1', 'gastrecke'), null, 'vor dem ersten Speicherstand: noch nichts');
    await api3.armory.bereit();
    assert.equal(api3.armory.liste('1', 'gastrecke')!.gesamt, 0);
    assert.equal(api3.armory.liste('1', 'adminrecke')!.gesamt, 0);
    assert.equal(api3.armory.profil(gastFigur.id), null);
    assert.equal(api3.armory.profil(adminFigur.id), null);
  }
  // Das in der Konfiguration genannte Standardkonto fehlt ebenfalls.
  figur(konto('TestGast'), 'Testgast Tilda'); // Schreibung weicht von der Konfiguration ('testgast') ab
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
    const vorher = (await listeFrisch()).daten.gesamt; // baut neu (Anna ist neu)
    const schnell = figur(schnellKonto, 'Schnell Sven');
    await liste();
    await api.armory.bereit();
    assert.equal((await liste()).daten.gesamt, vorher, 'innerhalb der Frist: noch der alte Stand');
    assert.equal((await profil(schnell.id)).status, 200, 'das Profil prueft die Sichtbarkeit aber immer sofort');
    assert.equal((await listeFrisch()).daten.gesamt, vorher + 1, 'danach neu gebaut');
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

  // ── 15. Pfade, die ein Vorschalter anders liest als `new URL` (N1-1) ─
  {
    const rohAnfrage = (pfad: string): Promise<{ status: number; text: string }> => new Promise((ok, fehler) => {
      const port = (server.address() as { port: number }).port;
      const s = netConnect(port, '127.0.0.1');
      let d = '';
      s.on('data', (b) => { d += b; });
      s.on('end', () => ok({ status: Number(d.split(' ')[1]), text: d.split('\r\n\r\n').slice(1).join('') }));
      s.on('error', fehler);
      s.write(`GET ${pfad} HTTP/1.1\r\nHost: x\r\nConnection: close\r\nX-Forwarded-For: 192.0.2.${(++anfragen % 250) + 1}\r\n\r\n`);
    });
    const umgehungen = [
      '/accounts/x\\..\\armory', `/accounts/x\\..\\armory\\${ulf.id}`, '/accounts/x/..\\armory', '/accounts/x\\%2e%2e\\armory',
      '/accounts/x/../armory', '/accounts/x/%2e%2e/armory', '/accounts/x/%2E%2E/armory', '/accounts/x/%2e./armory', '/accounts/x/.%2e/armory',
      '/accounts/./armory', '/accounts/%2e/armory', '/accounts/x%5c..%5carmory', '/accounts/x%5C..%5Carmory', '/accounts/x/..%2farmory',
      '/accounts/armory/..', '/accounts/x\\..\\status', '/accounts/x/../status', '/accounts/%00x', '/accounts/x%zz',
      'http://evil.example/accounts/x\\..\\armory', 'http://evil.example/accounts/x/%2e%2e/armory',
      // N2-1: nginx fasst `//` zusammen und waehlt eine andere location, `new URL` liest den ersten Teil als Host.
      '//accounts/accounts/armory', `//accounts/accounts/armory/${ulf.id}`, '///accounts/accounts/armory', '//ws/accounts/armory',
      `//ws/accounts/armory/${ulf.id}`, '//%61ccounts/accounts/armory', '//a@b/accounts/armory', '//accounts:1/accounts/armory',
      '//accounts%2faccounts/armory', '//x/accounts/status', '////accounts/accounts/armory',
    ];
    // Wege, die nach dem Parsen gar nicht mehr zur KontoApi gehoeren: nur kein 200 mit Daten.
    const fremd = ['/\\accounts/armory', 'http://evil//accounts/accounts/armory', 'http://evil.example//ws/accounts/armory', '\\\\accounts\\armory'];
    for (const p of fremd) {
      const r = await rohAnfrage(p);
      assert.notEqual(r.status, 200, `${JSON.stringify(p)} liefert nichts (war ${r.status})`);
      assert.ok(!r.text.includes('eintraege') && !r.text.includes('kennung'), `${JSON.stringify(p)}: keine Daten`);
    }
    for (const p of umgehungen) {
      const r = await rohAnfrage(p);
      assert.equal(r.status, 400, `${JSON.stringify(p)} wird abgelehnt (400), war ${r.status}`);
      assert.ok(!r.text.includes('eintraege') && !r.text.includes('kennung'), `${JSON.stringify(p)}: keine Daten in der Antwort`);
    }
    // Rohpruefung als Funktion, auch fuer Wege, die nicht armory heissen.
    for (const p of ['/accounts/armory', '/accounts/armory?q=a%20b&seite=2', '/accounts/armory/12', '/accounts/characters/3', '/accounts/status',
      '/accounts/armory?q=%5C', '/accounts/armory?q=../..', '/accounts/armory#..']) {
      assert.equal(rohPfadUnzulaessig(p), false, `${p} ist ein normaler Pfad`);
    }
    for (const p of umgehungen) assert.equal(rohPfadUnzulaessig(p), true, `${p}`);
    assert.equal((await rohAnfrage('/accounts/armory?q=a')).status === 400, false, 'normale Anfragen gehen weiter');
    assert.equal((await rohAnfrage('/accounts/status')).status, 200, 'andere Wege der KontoApi ebenfalls');
  }

  // ── 16. Herkunft: nur von Loopback ein Weiterleitungskopf (N1-3a) ─
  {
    const fake = (peer: string, kopf: Record<string, string>): never =>
      ({ socket: { remoteAddress: peer }, headers: kopf }) as never;
    assert.equal(herkunftErmitteln(fake('203.0.113.9', { 'x-forwarded-for': '6.6.6.6' })), '203.0.113.9', 'fremder Peer: Kopf wird ignoriert');
    assert.equal(herkunftErmitteln(fake('10.10.10.10', { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '7.7.7.7' })), '10.10.10.10');
    assert.equal(herkunftErmitteln(fake('127.0.0.1', { 'x-forwarded-for': '6.6.6.6, 198.51.100.4' })), '198.51.100.4', 'Loopback: letzter, vom Vorschalter gesetzter Eintrag');
    assert.equal(herkunftErmitteln(fake('::1', { 'x-forwarded-for': 'unknown' })), '::1', 'kaputter Kopf: Peer');
    assert.equal(herkunftErmitteln(fake('127.0.0.1', { 'x-forwarded-for': 'evil text' })), '127.0.0.1');
  }

  // ── 17. Drossel: gesperrte Herkuenfte bleiben gesperrt, die Karte bleibt klein (N1-4) ─
  {
    let t = 1_000_000;
    const a = new Armory(db, []);
    a.uhr = () => t;
    a.drosselKarteMax = 50;
    for (let i = 0; i < ARMORY_DROSSEL_MAX + 5; i++) a.erlaubt('angreifer');
    assert.equal(a.erlaubt('angreifer'), false, 'gesperrt');
    for (let i = 0; i < 400; i++) a.erlaubt(`fremd-${i}`);
    assert.equal(a.erlaubt('angreifer'), false, 'eine Flut fremder Schluessel setzt die Sperre nicht zurueck');
    const karte = (a as unknown as { drosselung: Map<string, unknown> }).drosselung;
    assert.ok(karte.size <= 50, `Karte bleibt begrenzt (${karte.size})`);
    // Notbremse: nur noch gesperrte Herkuenfte in der Karte => keine neue Herkunft kommt hinein.
    const b = new Armory(db, []);
    b.uhr = () => t;
    b.drosselKarteMax = 5;
    for (let h = 0; h < 5; h++) for (let i = 0; i < ARMORY_DROSSEL_MAX + 1; i++) b.erlaubt(`gesperrt-${h}`);
    assert.equal(b.erlaubt('neu'), false, 'Notbremse: die Karte ist voll von Gesperrten, unbekannte Herkuenfte werden abgewiesen');
    assert.equal(b.erlaubt('gesperrt-0'), false);
    t += ARMORY_DROSSEL_FENSTER_MS + 1;
    assert.equal(b.erlaubt('neu'), true, 'nach dem Fenster wieder frei');
  }

  // ── 18. Neubau in Haeppchen: der Faden bleibt frei, der alte Stand gilt (N1-2) ─
  {
    const ordner3 = mkdtempSync(join(tmpdir(), 'wov-konto-armory-c-'));
    try {
      const db3 = new Kontendatenbank(join(ordner3, 'konten.db'));
      const k3 = db3.kontoAnlegen('Grosskonto', 'g@example.org', passwortEinlagernSync('geheimespasswort1'));
      assert.ok(k3.ok);
      const N = 20_000;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const roh3 = (db3 as any).db as { exec(s: string): void; prepare(s: string): { run(...a: unknown[]): unknown } };
      roh3.exec('BEGIN');
      for (let i = 0; i < N; i++) {
        const r = db3.charakterAnlegen(k3.konto.id, `Gross ${i}`, { ...aussehen, klasse: 'krieger' });
        assert.ok(r.ok);
        roh3.prepare('UPDATE charaktere SET zuletzt_gespielt = ? WHERE id = ?').run(((i * 7919) % 100_003) * H, r.charakter.id);
      }
      roh3.exec('COMMIT');
      // Luecken in den Ids (jede dritte Zeile weg): Seiten nach Id-ABSTAND statt nach der letzten Id lieferten doppelte oder fehlende Zeilen.
      roh3.exec('DELETE FROM charaktere WHERE id % 3 = 0');
      const erwartet = ((db3 as any).db.prepare('SELECT COUNT(*) AS n FROM charaktere').get() as { n: number }).n; // eslint-disable-line @typescript-eslint/no-explicit-any
      const letzterName = ((db3 as any).db.prepare('SELECT name FROM charaktere ORDER BY id DESC LIMIT 1').get() as { name: string }).name; // eslint-disable-line @typescript-eslint/no-explicit-any
      let t3 = 5_000_000;
      const gross = new Armory(db3, []);
      gross.uhr = () => t3;
      assert.equal(gross.liste('1', ''), null, 'vor dem ersten Speicherstand: noch nichts, kein Warten am Stueck');
      await gross.bereit();
      const l1 = gross.liste('1', '')!;
      assert.equal(l1.gesamt, erwartet, 'kein Charakter fehlt (keine stille Obergrenze)');
      assert.equal(gross.liste('1', letzterName.toLowerCase())!.gesamt, 1);
      {
        const alle: { id: number; name: string }[] = [];
        for (let p = 1; p <= l1.seiten; p++) alle.push(...gross.liste(String(p), '')!.eintraege);
        assert.equal(alle.length, erwartet, 'alle Seiten zusammen: genau so viele Zeilen wie Charaktere');
        assert.equal(new Set(alle.map((e) => e.id)).size, erwartet, 'keine doppelten Zeilen ueber Id-Luecken hinweg');
        // N2-4: die Suche ueber den Paar-Index liefert dasselbe wie ein Durchlauf ueber alle Namen.
        const gesucht = ['g', 'gr', 'gro', 'gros', 'gross 1', 'ross 19', 's 199', '1', '19', '99', 'zzz', 'ö', letzterName.toLowerCase(), '  GROSS  ', 'ss 1', ' 1', '9 ', 'gross 12'];
        for (const q of gesucht) {
          const eff = q.trim().normalize('NFC').toLowerCase();
          const kurz = Array.from(eff).length < 2;
          const soll = kurz ? alle : alle.filter((e) => e.name.normalize('NFC').toLowerCase().includes(eff));
          const ist = gross.liste('1', q)!;
          assert.equal(ist.suche, kurz ? '' : eff, `Suche ${JSON.stringify(q)}: angewandte Suche`);
          if (ist.suche_gekuerzt) {
            // Zu allgemein: nur die ersten Kandidaten (Anzeigereihenfolge) wurden geprueft; die Treffer sind ein Anfangsstueck der vollen Trefferliste.
            assert.ok(ist.gesamt <= Math.min(soll.length, ARMORY_KANDIDATEN_MAX), `Suche ${JSON.stringify(q)}: gekuerzte Trefferzahl`);
            assert.deepEqual(ist.eintraege.map((e) => e.id), soll.slice(0, Math.min(ARMORY_SEITENGROESSE, ist.gesamt)).map((e) => e.id), `Suche ${JSON.stringify(q)}: gekuerzte erste Seite`);
            continue;
          }
          assert.equal(ist.gesamt, soll.length, `Suche ${JSON.stringify(q)}: Trefferzahl`);
          assert.deepEqual(ist.eintraege.map((e) => e.id), soll.slice(0, ARMORY_SEITENGROESSE).map((e) => e.id), `Suche ${JSON.stringify(q)}: erste Seite in Anzeigereihenfolge`);
          if (ist.seiten > 1) {
            assert.deepEqual(gross.liste(String(ist.seiten), q)!.eintraege.map((e) => e.id), soll.slice((ist.seiten - 1) * ARMORY_SEITENGROESSE).map((e) => e.id), `Suche ${JSON.stringify(q)}: letzte Seite`);
          }
        }
        // Harte Obergrenze (F1): eine allgemeine Suche prueft hoechstens ARMORY_KANDIDATEN_MAX Kandidaten und sagt, dass sie gekuerzt ist.
        {
          const kk0 = gross.statistik.suchKandidaten;
          const breit = gross.liste('1', 'gr')!;
          assert.equal(breit.suche_gekuerzt, true, 'allgemeine Suche: gekuerzt');
          assert.ok(gross.statistik.suchKandidaten - kk0 <= ARMORY_KANDIDATEN_MAX, `hoechstens ${ARMORY_KANDIDATEN_MAX} Kandidaten (${gross.statistik.suchKandidaten - kk0})`);
          assert.ok(breit.gesamt > 0 && breit.gesamt <= ARMORY_KANDIDATEN_MAX);
          assert.equal(gross.liste('1', 'gross 12345')!.suche_gekuerzt, false, 'selektive Suche: nicht gekuerzt');
          assert.equal(gross.liste('1', '')!.suche_gekuerzt, false, 'ohne Suche: nie gekuerzt');
        }
        // Das Salz des Index wird bei jedem Aufbau neu gezogen (F1a): ein im Repo berechnetes Kollisionsset haelt nicht.
        {
          const salzVon = (): string => { const ix = (gross as unknown as { aufnahme: { index: { salz1: number; salz2: number } } }).aufnahme.index; return `${ix.salz1}:${ix.salz2}`; };
          const vorher = salzVon();
          t3 += ARMORY_CACHE_MS + 1;
          gross.liste('1', '');
          await gross.bereit();
          assert.notEqual(salzVon(), vorher, 'neuer Aufbau, neues Salz');
        }
        // Selektive Suche prueft nur wenige Kandidaten; dieselbe Suche noch einmal kommt aus dem Ergebnis-Puffer.
        const k0 = gross.statistik.suchKandidaten;
        const h0 = gross.statistik.suchTreffer;
        gross.liste('1', 'gross 12345');
        const kandidaten = gross.statistik.suchKandidaten - k0;
        assert.ok(kandidaten > 0 && kandidaten < erwartet / 10, `selektive Suche prueft wenige Kandidaten (${kandidaten} von ${erwartet})`);
        gross.liste('1', 'gross 12345');
        assert.equal(gross.statistik.suchKandidaten - k0, kandidaten, 'zweiter Aufruf: aus dem Puffer, keine Kandidaten');
        assert.equal(gross.statistik.suchTreffer - h0, 1, 'Pufferzugriff gezaehlt');
        // Der Ergebnis-Puffer bleibt begrenzt, auch bei wechselnden Suchbegriffen.
        for (let i = 0; i < 700; i++) gross.liste('1', `gross ${i}x`);
        const sc = ((gross as unknown as { aufnahme: { suchCache: Map<string, unknown> } }).aufnahme).suchCache;
        assert.ok(sc.size <= 256, `Ergebnis-Puffer begrenzt (${sc.size})`);
      }
      // Sortierung: zuletzt gespielt absteigend.
      const zeiten = gross.liste('1', '')!.eintraege.map((e) => e.zuletztGespielt as number);
      assert.deepEqual([...zeiten].sort((x, y) => y - x), zeiten, 'Reihenfolge nach dem Haeppchen-Sortieren stimmt');
      assert.ok(gross.statistik.schritte >= 10, `der Neubau lief in vielen Haeppchen (${gross.statistik.schritte})`);
      assert.ok(gross.statistik.laengsterSchrittMs < 25, `kein Haeppchen blockiert den Faden lange (${gross.statistik.laengsterSchrittMs.toFixed(1)} ms)`);
      // Waehrend des Neubaus gilt der alte Stand.
      const k4 = db3.kontoAnlegen('Zweitgross', 'z@example.org', passwortEinlagernSync('geheimespasswort1'));
      assert.ok(k4.ok);
      db3.charakterAnlegen(k4.konto.id, 'Neu Dazu', { ...aussehen, klasse: 'krieger' });
      t3 += ARMORY_NEUBAU_MIN_MS + 1;
      const waehrend = gross.liste('1', 'neu dazu')!;
      assert.equal(waehrend.gesamt, 0, 'der Neubau laeuft: der alte Stand gilt');
      assert.ok((gross as unknown as { lauf: unknown }).lauf !== null, 'der Neubau ist noch nicht fertig, der Faden war frei');
      await gross.bereit();
      assert.equal(gross.liste('1', 'neu dazu')!.gesamt, 1, 'danach der neue Stand');

      // N2-3 (Q12): laeuft ein Neubau nur wegen des Alters, antwortet die Liste weiter mit dem alten Stand, nie mit 503.
      // N2-3 (Q6): ein zweiter Aufruf waehrend des laufenden Neubaus startet keinen zweiten (sonst wird er bei Dauerlast nie fertig).
      {
        const lauf = (): unknown => (gross as unknown as { lauf: unknown }).lauf;
        const vor = gross.statistik.neubauten;
        t3 += ARMORY_CACHE_MS + 1;
        assert.ok(gross.liste('1', '') !== null, 'Ablauf der Frist: alter Stand, kein 503');
        assert.ok(lauf() !== null);
        for (let i = 0; i < 20_000 && lauf() !== null; i++) {
          assert.ok(gross.liste('1', '') !== null, 'waehrend des Neubaus: alter Stand, kein 503');
          await new Promise<void>((ok) => setImmediate(ok));
        }
        assert.equal(lauf(), null, 'der Neubau wird auch bei Dauerlast fertig');
        assert.equal(gross.statistik.neubauten - vor, 1, 'genau ein Neubau, kein zweiter waehrend des ersten');
      }
      // N2-3 (Q9) und H2: ein Fehler im Neubau laesst den alten Stand stehen, setzt den Lauf zurueck und sperrt kurz.
      {
        const lauf = (): unknown => (gross as unknown as { lauf: unknown }).lauf;
        const echt = console.error;
        console.error = () => undefined;
        try {
          (db3 as unknown as { armorySeite: () => never }).armorySeite = () => { throw new Error('Testfehler'); };
          const vor = gross.statistik.neubauten;
          t3 += ARMORY_CACHE_MS + 1;
          assert.ok(gross.liste('1', '') !== null);
          for (let i = 0; i < 2_000 && lauf() !== null; i++) await new Promise<void>((ok) => setImmediate(ok));
          assert.equal(lauf(), null, 'nach einem Fehler ist der Lauf zurueckgesetzt');
          assert.equal(gross.statistik.neubauten - vor, 1);
          assert.ok(gross.liste('1', '') !== null, 'der alte Stand bleibt');
          for (let i = 0; i < 50; i++) gross.liste('1', '');
          assert.equal(gross.statistik.neubauten - vor, 1, 'nach einem Fehler: kein neuer Versuch ohne Abstand');
          delete (db3 as unknown as { armorySeite?: unknown }).armorySeite;
          t3 += ARMORY_NEUBAU_MIN_MS + 1;
          gross.liste('1', '');
          await gross.bereit();
          assert.equal(gross.statistik.neubauten - vor, 2, 'nach dem Abstand ein neuer Versuch, der gelingt');
        } finally { console.error = echt; }
      }
    } finally { rmSync(ordner3, { recursive: true, force: true }); }
  }

  // ── 19. Suchindex fester Groesse, auch bei vielfaeltigen Namen (N3-1); Suche erst ab 2 Zeichen (N3-2) ─
  {
    const ordner4 = mkdtempSync(join(tmpdir(), 'wov-konto-armory-d-'));
    try {
      const db4 = new Kontendatenbank(join(ordner4, 'konten.db'));
      const k = db4.kontoAnlegen('Cjkkonto', 'c@example.org', passwortEinlagernSync('geheimespasswort1'));
      assert.ok(k.ok);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw4 = (db4 as any).db as { exec(s: string): void };
      const N = 20_000;
      let zufall = 12345;
      const zeichen = (): string => { zufall = (Math.imul(zufall, 1103515245) + 12345) & 0x7fffffff; return String.fromCharCode(0x4e00 + (zufall % 20_000)); };
      const namen4: string[] = [];
      raw4.exec('BEGIN');
      for (let i = 0; i < N; i++) {
        const name = Array.from({ length: 24 }, zeichen).join(''); // 24 Zeichen, fast jedes Paar einmalig: der schlimmste Fall fuer einen Index je Paar
        const r = db4.charakterAnlegen(k.konto.id, name, { ...aussehen, klasse: 'krieger' });
        if (r.ok) namen4.push(name);
      }
      raw4.exec('COMMIT');
      let t4 = 9_000_000;
      const cjk = new Armory(db4, []);
      cjk.uhr = () => t4;
      cjk.liste('1', '');
      await cjk.bereit();
      assert.equal(cjk.liste('1', '')!.gesamt, namen4.length);
      // Der Index hat feste Eimerzahl: sein Speicher haengt nur von den Namen ab (hoechstens 23 Paare je Name), nicht von der Vielfalt.
      assert.ok(cjk.statistik.indexBytes <= (ARMORY_EIMER + 1) * 4 + namen4.length * 23 * 4, `Index klein (${cjk.statistik.indexBytes} Byte fuer ${namen4.length} Namen)`);
      assert.ok(cjk.statistik.laengsterSchrittMs < 25, `kein Haeppchen blockiert den Faden lange (${cjk.statistik.laengsterSchrittMs.toFixed(1)} ms)`);
      const alle: string[] = [];
      for (let p = 1; p <= cjk.liste('1', '')!.seiten; p++) alle.push(...cjk.liste(String(p), '')!.eintraege.map((e) => e.name));
      for (const q of [namen4[7].slice(5, 8), namen4[9000].slice(10, 12), namen4[19999].slice(0, 5), '未知未知', namen4[3].slice(23, 24) + namen4[4].slice(0, 1)]) {
        const soll = alle.filter((n) => n.toLowerCase().includes(q.toLowerCase()));
        const ist = cjk.liste('1', q)!;
        assert.equal(ist.gesamt, soll.length, `CJK-Suche ${q}: Trefferzahl`);
        assert.deepEqual(ist.eintraege.map((e) => e.name), soll.slice(0, ARMORY_SEITENGROESSE), `CJK-Suche ${q}: erste Seite`);
      }
      // Ein Zeichen ist keine Suche: dieselbe Antwort wie ohne Suche, `suche` sagt es.
      const ohne = cjk.liste('1', '')!;
      const eins = cjk.liste('1', namen4[1].slice(0, 1))!;
      assert.equal(eins.suche, '');
      assert.deepEqual({ ...eins }, { ...ohne }, 'ein Zeichen: dieselbe Antwort wie ohne Suche');
      assert.equal(cjk.liste('1', namen4[1].slice(0, 2))!.suche, namen4[1].slice(0, 2).toLowerCase(), 'zwei Zeichen sind eine Suche');
      assert.equal(cjk.liste('1', ' ' + namen4[1].slice(0, 1) + ' ')!.suche, '', 'auch mit Leerraum drumherum zaehlt nur das Zeichen');
      // F3: gezaehlt wird nach der VOLLSTAENDIGEN Faltung, in Graphemen: `\u0130` faltet zu zwei Codepunkten (i + U+0307), ist aber ein Zeichen.
      for (const eins1 of ['\u0130', 'i\u0307', 'e\u0301', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}', '\u{1F1E9}\u{1F1EA}']) {
        assert.equal(cjk.liste('1', eins1)!.suche, '', `${JSON.stringify(eins1)} ist ein Zeichen und damit keine Suche`);
      }
      assert.equal(cjk.liste('1', 'ab')!.suche, 'ab', 'zwei Zeichen sind eine Suche');
      assert.equal(cjk.liste('1', '\u0130a')!.suche, 'i\u0307a', 'İ plus ein Zeichen sind zwei Zeichen');
      assert.equal(cjk.liste('1', '\u{1F600}')!.suche, '', 'ein Zeichen jenseits der BMP (zwei UTF-16-Einheiten) ist ebenfalls nur ein Zeichen');
      // R9: scheitert schon der ERSTE Aufbau, folgt ein Versuch erst nach ARMORY_NEUBAU_MIN_MS.
      const frisch = new Armory(db4, []);
      frisch.uhr = () => t4;
      const echt = console.error;
      console.error = () => undefined;
      try {
        (db4 as unknown as { armorySeite: () => never }).armorySeite = () => { throw new Error('Testfehler'); };
        for (let i = 0; i < 50; i++) { assert.equal(frisch.liste('1', ''), null); await new Promise<void>((ok) => setImmediate(ok)); }
        assert.equal(frisch.statistik.neubauten, 1, 'erster Aufbau scheitert: 50 Aufrufe starten nur einen Versuch');
        delete (db4 as unknown as { armorySeite?: unknown }).armorySeite;
        t4 += ARMORY_NEUBAU_MIN_MS + 1;
        assert.equal(frisch.liste('1', ''), null);
        await frisch.bereit();
        assert.equal(frisch.statistik.neubauten, 2, 'nach dem Abstand ein zweiter Versuch');
        assert.ok(frisch.liste('1', '') !== null, 'und er gelingt');
      } finally { console.error = echt; }
    } finally { rmSync(ordner4, { recursive: true, force: true }); }
  }

  // ── 20. Genau an der Grenze der Kandidaten: 5 000 nicht gekuerzt, 5 001 gekuerzt (N6) ─
  {
    const ordner5 = mkdtempSync(join(tmpdir(), 'wov-konto-armory-e-'));
    try {
      const db5 = new Kontendatenbank(join(ordner5, 'konten.db'));
      const k = db5.kontoAnlegen('Grenzkontofuenf', 'g5@example.org', passwortEinlagernSync('geheimespasswort1'));
      assert.ok(k.ok);
      // Namen 'qq' + 13 Stellen aus a/b: nur wenige verschiedene Buchstabenpaare, der Eimer von 'qq' enthaelt genau die Namen mit 'qq'.
      const nameZu = (i: number): string => 'qq' + i.toString(2).padStart(13, '0').replace(/0/g, 'a').replace(/1/g, 'b');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw5 = (db5 as any).db as { exec(s: string): void };
      raw5.exec('BEGIN');
      for (let i = 0; i < ARMORY_KANDIDATEN_MAX; i++) assert.ok(db5.charakterAnlegen(k.konto.id, nameZu(i), { ...aussehen, klasse: 'krieger' }).ok);
      raw5.exec('COMMIT');
      let t5 = 11_000_000;
      const grenze = new Armory(db5, []);
      grenze.uhr = () => t5;
      /** Sucht `qq` und liefert (Kandidaten, gekuerzt); ein Eimer-Zusammenstoss mit anderen Paaren (Salz zufaellig) wird mit neuem Salz wiederholt. */
      const probe = async (erwartet: number): Promise<{ gekuerzt: boolean; gesamt: number }> => {
        for (let versuch = 0; versuch < 8; versuch++) {
          t5 += ARMORY_CACHE_MS + 1; // neuer Aufbau, neues Salz
          grenze.liste('1', '');
          await grenze.bereit();
          const k0 = grenze.statistik.suchKandidaten;
          const r = grenze.liste('1', 'qq')!;
          if (grenze.statistik.suchKandidaten - k0 === Math.min(erwartet, ARMORY_KANDIDATEN_MAX)) return { gekuerzt: r.suche_gekuerzt, gesamt: r.gesamt };
        }
        throw new Error('Eimer-Zusammenstoesse in 8 Aufbauten hintereinander');
      };
      const bei5000 = await probe(ARMORY_KANDIDATEN_MAX);
      assert.equal(bei5000.gekuerzt, false, 'genau 5 000 Kandidaten: nicht gekuerzt');
      assert.equal(bei5000.gesamt, ARMORY_KANDIDATEN_MAX, 'alle 5 000 gefunden');
      assert.ok(db5.charakterAnlegen(k.konto.id, nameZu(ARMORY_KANDIDATEN_MAX), { ...aussehen, klasse: 'krieger' }).ok);
      const bei5001 = await probe(ARMORY_KANDIDATEN_MAX + 1);
      assert.equal(bei5001.gekuerzt, true, '5 001 Kandidaten: gekuerzt');
      assert.equal(bei5001.gesamt, ARMORY_KANDIDATEN_MAX, 'geprueft werden hoechstens 5 000');
    } finally { rmSync(ordner5, { recursive: true, force: true }); }
  }

  // ── 21. N7: nur Loopback-Peers (A2), Stempel in fester Reihenfolge (A1), Stundenraster (F1), Pruefung gepuffert (F6) ─
  {
    // A2: ein Nicht-Loopback-Peer (der Spielserver lauscht auf allen Schnittstellen) bekommt die Ruestkammer-Wege nicht, andere Wege schon.
    const peerAnfrage = (peer: string | undefined, pfad: string): { status: number; text: string } => {
      const res = { status: 0, text: '', setHeader() { /* leer */ }, writeHead(c: number) { this.status = c; return this; }, end(t?: string) { this.text = t ?? ''; } };
      const req = { url: pfad, method: 'GET', headers: { 'x-forwarded-for': '127.0.0.1' }, socket: { remoteAddress: peer } };
      assert.equal(api.behandle(req as never, res as never), true);
      return { status: res.status, text: res.text };
    };
    for (const pfad of ['/accounts/armory', '/accounts/armory?q=ab', `/accounts/armory/${ulf.id}`]) {
      for (const peer of ['10.1.2.3', '192.168.0.9', '::ffff:10.0.0.1', '2001:db8::1', 'fe80::1', undefined]) {
        const r = peerAnfrage(peer, pfad);
        assert.equal(r.status, 404, `${pfad} von ${String(peer)}: 404 wie ein unbekannter Weg`);
        assert.equal(r.text, JSON.stringify({ error: 'unknown-endpoint' }));
      }
      for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
        assert.equal(peerAnfrage(peer, pfad).status, 200, `${pfad} von ${peer}: erlaubt`);
      }
    }
    assert.equal(peerAnfrage('10.1.2.3', '/accounts/status').status, 200, 'andere Wege der KontoApi bleiben unveraendert');
    assert.equal(peerAnfrage('10.1.2.3', `/accounts/characters/${ulf.id}`).status, 200);

    // A1: derselbe Bestand an Banns ergibt denselben Stempel, auch wenn die Zeilen in anderer Reihenfolge stehen.
    {
      const insert = (wert: string): void => { roh.prepare("INSERT INTO banns (art, wert, grund, gesetzt_von, gesetzt, bis) VALUES ('konto', ?, '', '', 2000, NULL)").run(wert); };
      insert('987001');
      insert('987002');
      const vorher = db.armoryStempel();
      roh.prepare("DELETE FROM banns WHERE art = 'konto' AND wert = '987001'").run();
      insert('987001'); // jetzt die zweite Zeile im Speicher
      assert.equal(db.armoryStempel(), vorher, 'gleicher Bestand, andere Zeilenfolge: gleicher Stempel');
      roh.prepare("DELETE FROM banns WHERE art = 'konto' AND wert IN ('987001', '987002')").run();
    }

    // F1: zuletztGespielt wird auf volle Stunden abgerundet; sortiert wird nach dem gerundeten Wert, bei Gleichstand nach Name.
    {
      const rk = konto('Rasterkonto');
      const zeta = figur(rk, 'Raster Zeta');
      const alpha = figur(rk, 'Raster Alpha');
      const spaet = figur(rk, 'Raster Spaet');
      const feste = 8_000_000 * H; // frei gewaehlte Stunde, hinter allen anderen Testwerten
      zuletzt(zeta.id, feste + 3_000_000); // roh spaeter als Alpha: nach dem genauen Zeitpunkt laege Zeta vorn
      zuletzt(alpha.id, feste + 5); // roh frueher innerhalb derselben Stunde
      zuletzt(spaet.id, feste + H + 17); // naechste Stunde
      const l1 = (await listeFrisch('?q=raster')).daten;
      assert.deepEqual(namen(l1), ['Raster Spaet', 'Raster Alpha', 'Raster Zeta'], 'neuere Stunde zuerst, innerhalb der Stunde nach Name (nicht nach dem genauen Zeitpunkt)');
      assert.deepEqual(l1.eintraege.map((e: Json) => e.zuletztGespielt), [feste + H, feste, feste], 'volle Stunden');
      assert.equal((await profil(alpha.id)).daten.zuletztGespielt, feste, 'auch im Profil');
      assert.equal((await profil(spaet.id)).daten.zuletztGespielt, feste + H);
      for (const e of l1.eintraege as Json[]) assert.equal((e.zuletztGespielt as number) % H, 0);
    }
  }

  // ── 21b. F6: die Einzelpruefung bei unsicherem Stand laeuft einmal je Stempel (nicht je Anfrage) ─
  {
    const ordner6 = mkdtempSync(join(tmpdir(), 'wov-konto-armory-f-'));
    try {
      const db6 = new Kontendatenbank(join(ordner6, 'konten.db'));
      const k = db6.kontoAnlegen('Sechskonto', 's@example.org', passwortEinlagernSync('geheimespasswort1'));
      assert.ok(k.ok);
      for (let i = 0; i < 60; i++) assert.ok(db6.charakterAnlegen(k.konto.id, `Sechs ${String(i).padStart(2, '0')}`, { ...aussehen, klasse: 'krieger' }).ok);
      let t6 = 12_000_000;
      const a6 = new Armory(db6, []);
      a6.uhr = () => t6;
      a6.liste('1', '');
      await a6.bereit();
      assert.equal(a6.liste('1', '')!.eintraege.length, ARMORY_SEITENGROESSE);
      // Sichtbarkeit aendert sich; ohne Zwischenpause (kein await) kann der Neubau nicht fertig werden: der Stand bleibt unsicher.
      assert.ok(db6.charakterAnlegen(k.konto.id, 'Sechs Neu', { ...aussehen, klasse: 'krieger' }).ok);
      t6 += ARMORY_NEUBAU_MIN_MS + 1;
      const vor = a6.statistik.einzelpruefungen;
      for (let i = 0; i < 300; i++) assert.equal(a6.liste('1', '')!.eintraege.length, ARMORY_SEITENGROESSE);
      assert.equal(a6.statistik.einzelpruefungen - vor, ARMORY_SEITENGROESSE, '300 Anfragen, ein Pruefdurchgang (24 Eintraege)');
      // Eine neue Aenderung (neuer Stempel) fuehrt zu einem neuen Durchgang.
      assert.ok(db6.charakterAnlegen(k.konto.id, 'Sechs Neuer', { ...aussehen, klasse: 'krieger' }).ok);
      for (let i = 0; i < 50; i++) a6.liste('1', '');
      assert.equal(a6.statistik.einzelpruefungen - vor, 2 * ARMORY_SEITENGROESSE, 'anderer Stempel: einmal neu pruefen');
      await a6.bereit();
    } finally { rmSync(ordner6, { recursive: true, force: true }); }
  }

  // ── 8. Puffer ─────────────────────────────────────────────────────
  zuletzt(ulf.id, 5 * H);
  jetzt += ARMORY_CACHE_MS + 1;
  await liste('?q=ulf'); // Ablauf der Frist startet den Neubau, der alte Stand gilt bis er fertig ist
  await api.armory.bereit();
  const erste = await liste('?q=ulf');
  assert.equal(erste.daten.eintraege[0].zuletztGespielt, 5 * H);
  zuletzt(ulf.id, 7 * H);
  jetzt += ARMORY_CACHE_MS - 5_000;
  assert.equal((await liste('?q=ulf')).daten.eintraege[0].zuletztGespielt, 5 * H, 'innerhalb der Frist: gepufferte Antwort');
  jetzt += 5_001;
  await liste('?q=ulf');
  await api.armory.bereit();
  assert.equal((await liste('?q=ulf')).daten.eintraege[0].zuletztGespielt, 7 * H, 'nach der Frist: frisch aus der Datenbank');

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
