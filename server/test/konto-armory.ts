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
import { ausgehenderNahkampfSchaden, lebensmaximum } from '@wov/shared';
import { KontoApi } from '../src/konto/KontoApi.js';
import { Kontendatenbank } from '../src/konto/Kontendatenbank.js';
import { ARMORY_CACHE_MAX, ARMORY_CACHE_MS, ARMORY_SEITENGROESSE } from '../src/konto/Armory.js';
import { geheimnisErzeugen } from '../src/net/Identitaet.js';
import { passwortEinlagernSync } from '../src/konto/Passwort.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const ordner = mkdtempSync(join(tmpdir(), 'wov-konto-armory-'));
const db = new Kontendatenbank(join(ordner, 'konten.db'));
const geheimnis = Buffer.from(geheimnisErzeugen(), 'hex');
const api = new KontoApi(db, geheimnis, () => ({ spieler: 0, plaetze: 10, tag: 1, welt: 'test' }), ['gast'], ['gast', 'admin']);
let jetzt = Date.now();
api.armory.uhr = () => jetzt;

const server = createServer((req, res) => { if (!api.behandle(req, res)) res.writeHead(404).end(); });
await new Promise<void>((ok, fehler) => { server.once('error', fehler); server.listen(0, '127.0.0.1', () => ok()); });
const basis = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

async function hole(pfad: string): Promise<{ status: number; text: string; daten: Json }> {
  const r = await fetch(basis + pfad);
  const text = await r.text();
  let daten: Json = {};
  try { daten = JSON.parse(text) as Json; } catch { /* leer */ }
  return { status: r.status, text, daten };
}
const liste = (abfrage = '') => hole(`/accounts/armory${abfrage}`);
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

/** Alle Schluessel, die in einer Antwort ueberhaupt vorkommen duerfen (Positivliste, rekursiv geprueft). */
const ERLAUBT = new Set([
  'eintraege', 'seite', 'seitenGroesse', 'gesamt', 'seiten',
  'id', 'name', 'klasse', 'aussehen', 'erstellt', 'zuletztGespielt', 'figur', 'frisur', 'haarfarbe', 'augenfarbe',
  'ausruestung', 'waffe', 'werte', 'profil',
  'stufe', 'erfahrung', 'tode', 'spielzeitMinuten', 'fertigkeiten',
  'kennung', 'textKey', 'seltenheit', 'itemStufe', 'qualitaet', 'symbol',
  'damage', 'armor', 'strength', 'vitality', 'agility', 'lebenMax', 'nahkampfSchaden',
  'kopf', 'halskette', 'hemd', 'hose', 'schuhe', 'armreif', 'ring1', 'ring2', 'schultern', 'unterarme', 'haende',
]);
function schluesselPruefen(wert: unknown, pfad = '$'): void {
  if (Array.isArray(wert)) { wert.forEach((w, i) => schluesselPruefen(w, `${pfad}[${i}]`)); return; }
  if (wert && typeof wert === 'object') {
    for (const [k, v] of Object.entries(wert)) {
      assert.ok(ERLAUBT.has(k), `Schluessel ausserhalb der Positivliste: ${pfad}.${k}`);
      schluesselPruefen(v, `${pfad}.${k}`);
    }
  }
}
const GEHEIM = [
  'Alrunskonto', 'alrunskonto@example', 'geheimespasswort1', 'position', 'spawnPoint', 'spawnBett', 'weltId', 'welt-a',
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
    spielerId: ulf.spielerId,
    ruestung: 'ironward_brust|ironward_hose',
    waffe: 'SwordNorth',
    inventar: [
      { name: 'IronwardCuirass', stack: 1, durability: 100, quality: 3, gridX: 0, gridY: 0, equipped: true },
      { name: 'IronwardLeggings', stack: 1, durability: 100, quality: 2, gridX: 1, gridY: 0, equipped: true },
      { name: 'IronwardHelmet', stack: 1, durability: 100, quality: 1, gridX: 2, gridY: 0, equipped: true },
      { name: 'SwordNorth', stack: 1, durability: 90, quality: 4, gridX: 3, gridY: 0, equipped: true },
      { name: 'Spear', stack: 7, durability: 50, quality: 1, gridX: 4, gridY: 0, equipped: false },
      { name: 'GibtEsNichtImSpiel', stack: 1, durability: 1, quality: 1, gridX: 5, gridY: 0, equipped: true },
    ],
  };
  // Aeltere Zeile einer anderen Welt: darf den juengeren Stand nicht verdraengen.
  zustand(ulf.spielerId, { ...ausruestet, inventar: [], ruestung: '' }, 'welt-b', 1);
  zustand(ulf.spielerId, ausruestet, 'welt-a', 50);

  // ── 1. Liste: Standardkonten fehlen, nur Charakternamen ───────────
  let l = await liste();
  assert.equal(l.status, 200);
  assert.deepEqual(namen(l.daten), ['Björn Eisenfaust', 'Ärger-Ulf', 'Nie Gespielt'],
    'zuletzt gespielt zuerst, nie gespielte zuletzt, Standardkonten fehlen');
  assert.equal(l.daten.gesamt, 3);
  assert.equal(l.daten.seite, 1);
  assert.equal(l.daten.seitenGroesse, ARMORY_SEITENGROESSE);
  assert.deepEqual(l.daten.eintraege[1].aussehen, { figur: 'wikingerin', frisur: 'H_01', haarfarbe: 'mittelbraun', augenfarbe: 'fjordblau' });
  assert.equal(l.daten.eintraege[1].klasse, 'jaeger');
  assert.equal(l.daten.eintraege[2].zuletztGespielt, null);
  schluesselPruefen(l.daten);
  nichtsGeheimes(l.text, 'Liste');
  assert.ok(!l.text.includes('Bjarneskonto') && !l.text.includes('example.org'), 'kein Kontoname, keine E-Mail');
  for (const f of [gastFigur, adminFigur]) assert.equal((await profil(f.id)).status, 404, 'Standardkonto-Charakter: 404');
  assert.equal((await liste('?q=gastrecke')).daten.gesamt, 0, 'auch die Suche findet kein Standardkonto');

  // ── 2. Suche ──────────────────────────────────────────────────────
  assert.deepEqual(namen((await liste('?q=bj%C3%96rn')).daten), ['Björn Eisenfaust'], 'Umlaut ohne Gross-/Kleinschreibung');
  assert.deepEqual(namen((await liste('?q=%C3%84RGER')).daten), ['Ärger-Ulf'], 'Grossbuchstabe findet Kleinbuchstabe');
  assert.deepEqual(namen((await liste('?q=ISENF')).daten), ['Björn Eisenfaust'], 'Teilstring mitten im Namen');
  assert.equal((await liste('?q=%20%20ulf%20')).daten.gesamt, 1, 'getrimmt');
  assert.equal((await liste('?q=')).daten.gesamt, 3, 'leere Suche = alle');
  const vorher = anzahlCharaktere();
  for (const q of ["'", "' OR '1'='1", "\"; DROP TABLE charaktere;--", "%", "_", "\\", "%25", "a'%", 'x'.repeat(5000), '%00', '\u0000', '😀', 'Ä'.repeat(40)]) {
    const r = await liste(`?q=${encodeURIComponent(q)}`);
    assert.equal(r.status, 200, `q=${JSON.stringify(q).slice(0, 30)} -> 200`);
    schluesselPruefen(r.daten);
    if (q === '%' || q === '_' || q === "'" || q === "' OR '1'='1" || q === '\\') {
      assert.equal(r.daten.gesamt, 0, `q=${q} ist Text, kein Muster: keine Treffer`);
    }
  }
  assert.equal(anzahlCharaktere(), vorher, 'keine SQL-Einwirkung');
  assert.equal((await liste('?q=%FF%FE')).status, 200, 'kaputte Prozentkodierung');

  // ── 3. Seiten ─────────────────────────────────────────────────────
  const masse = konto('Massenkonto');
  const massen: number[] = [];
  for (let i = 0; i < 30; i++) {
    const f = figur(masse, `Massenrecke ${String(i).padStart(2, '0')}`);
    zuletzt(f.id, 100 + i);
    massen.push(f.id);
  }
  const s1 = (await liste('?q=massenrecke')).daten;
  const s2 = (await liste('?q=massenrecke&seite=2')).daten;
  assert.equal(s1.gesamt, 30);
  assert.equal(s1.seiten, 2);
  assert.equal(s1.eintraege.length, ARMORY_SEITENGROESSE);
  assert.equal(s2.eintraege.length, 30 - ARMORY_SEITENGROESSE);
  assert.equal(s2.seite, 2);
  assert.equal(new Set([...namen(s1), ...namen(s2)]).size, 30, 'keine Ueberlappung');
  assert.equal(s1.eintraege[0].name, 'Massenrecke 29', 'juengster Spielzeitpunkt zuerst');
  assert.equal(s2.eintraege.at(-1).name, 'Massenrecke 00');
  for (const s of ['0', '-1', '-99999999999', 'abc', '1e9', '', '1.5', '%20', '0x10', 'NaN']) {
    const r = await liste(`?seite=${s}`);
    assert.equal(r.status, 200, `seite=${s} -> 200`);
    assert.equal(r.daten.seite, 1, `seite=${s} -> Seite 1`);
  }
  for (const s of ['99999999999999999999', '999999999', '5']) {
    const r = await liste(`?seite=${s}`);
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
  schluesselPruefen(p.daten);
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
    schluesselPruefen(r.daten);
    nichtsGeheimes(r.text, was);
    assert.ok(r.daten.name.startsWith('Kaputt'), `${was}: Name aus der Kontenzeile`);
    assert.ok(Object.keys(r.daten.ausruestung).length <= 12, `${was}: hoechstens ein Stueck je Platz`);
  }
  assert.equal((await liste('?q=kaputt')).status, 200);
  assert.equal((await liste('?q=kaputt')).daten.gesamt, kaputte.length);

  // ── 1b. Verschwinden: Bann, Loeschung; sofort, auch gegen den Puffer ─
  assert.equal((await liste('?q=eisenfaust')).daten.gesamt, 1);
  db.bannSetzen('konto', String(bjarne), { grund: 'Test' });
  assert.equal((await liste('?q=eisenfaust')).daten.gesamt, 0, 'gebanntes Konto verschwindet sofort aus der Liste');
  assert.equal((await profil(bjorn.id)).status, 404, 'und aus dem Profil');
  db.bannAufheben('konto', String(bjarne));
  assert.equal((await profil(bjorn.id)).status, 200, 'Aufheben bringt es zurueck');
  db.bannSetzen('spieler', bjorn.spielerId, { grund: 'Test' });
  assert.equal((await profil(bjorn.id)).status, 404, 'Spielerbann');
  assert.equal((await profil(ohneZeit.id)).status, 200, 'der andere Charakter des Kontos bleibt');
  db.bannAufheben('spieler', bjorn.spielerId);

  assert.equal((await liste('?q=Nie%20Gespielt')).daten.gesamt, 1);
  assert.ok(db.charakterLoeschen(bjarne, ohneZeit.id));
  assert.equal((await liste('?q=Nie%20Gespielt')).daten.gesamt, 0, 'geloeschter Charakter sofort weg');
  assert.equal((await profil(ohneZeit.id)).status, 404);
  assert.equal((await liste('?q=eisenfaust')).daten.gesamt, 1);
  assert.ok(db.kontoLoeschen(bjarne, db.kontoNachName('Bjarneskonto')!.passwort));
  assert.equal((await liste('?q=eisenfaust')).daten.gesamt, 0, 'geloeschtes Konto sofort weg');
  assert.equal((await profil(bjorn.id)).status, 404);

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

  for (let i = 0; i < ARMORY_CACHE_MAX + 100; i++) await liste(`?q=suche${i}`);
  const groesse = (api.armory as unknown as { puffer: Map<string, unknown> }).puffer.size;
  assert.ok(groesse <= ARMORY_CACHE_MAX, `Puffer bleibt begrenzt (${groesse})`);

  console.log('konto-armory: OK');
} finally {
  server.close();
  server.closeAllConnections?.();
  rmSync(ordner, { recursive: true, force: true });
}
