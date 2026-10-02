/**
 * T4a — "Speichern & neu starten" of the terrain tab, DOM-free, with fakes for `fetch` and the clock.
 * Gelände-Reiter „Speichern & neu starten“, ohne DOM, mit Attrappen für fetch und Uhr.
 *
 *  1. Save ok → `POST /api/server neustart` exactly once, AFTER the save → polling until it runs → "läuft wieder".
 *  2. Save failed (no base, 409, 422, network) → NO `/api/server` call at all, the message of the save stays.
 *  3. Restart answered 409 `aktion-laeuft` → friendly text, one POST, no second try, no polling.
 *  4. The service never comes up → error state with the time limit (fake clock, bounded).
 *  5. F1: a damaged `heightDeltas` sends NOTHING (no save, no restart) — for both buttons; HUD text names the reason.
 *  6. Double click: the second call is ignored, one restart; the lock is free again afterwards.
 *  7. Z3: a held-back deletion does not stop the restart; the final text names the count.
 *  8. Players for the dialog: a number, or `null` when the service gives none.
 *  9. Wiring in the source (what no run without a browser reaches) and texts de/en.
 * 10. M1: a 2xx answer without a valid new hash is not "saved" (real `localStoragePersistenz`, fake `fetch`/storage).
 * 11. M2: what the sanitiser would drop (region id twice, broken river/lake/placement) stops both buttons.
 * 12. N1–N7: time limit after the POST, monotone clock, unreadable draft, warning text, unclear restart, locks, strokes.
 * 14. N2 (R1–R7): empty route announced not blocked, non-list collections, every collection checked, hash form,
 *     restart refused during a plain save, throwing `rohtext`, no outdated geo sentence.
 * 13. M3: the control logic (`neustartSteuerung`): no run before "Ja", unlock after every end, status and players reach the surface.
 *
 * Run: npx tsx test/gelaende-neustart.ts   (from client/)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { sanitizeWorldLayout } from '@wov/shared';
import { entwurfErgebnisText, entwurfSpeichern, GEPRUEFTE_SAMMLUNGEN, type EntwurfDienste } from '../src/editor/testflug/entwurfSpeichern';
import { neustartSteuerung, type NeustartOberflaeche } from '../src/editor/testflug/neustartSteuerung';
import { speichernVerdrahtung } from '../src/editor/testflug/speichernVerdrahtung';
import { istDienstHash, localStoragePersistenz } from '../src/editor/testflug/LocalStoragePersistenz';
import { STAND_KEY } from '../src/editor/weltdokument';
import { LIMIT_MS, MAX_ABFRAGEN, neustartLauf, neustartText, spielerLesen, type Holen, type NeustartStatus } from '../src/editor/testflug/neustart';
import type { SpeicherAntwort } from '../src/editor/testflug/TestflugPersistenz';

const HIER = dirname(fileURLToPath(import.meta.url));
const lies = (rel: string): string => readFileSync(resolve(HIER, rel), 'utf-8');

let fehler = 0;
let fertig = false;
// A test that dies on a never-settled promise would leave without a word and with exit 0: that is a failure.
process.on('exit', () => {
  if (!fertig) {
    console.error('Test vorzeitig beendet (ein Versprechen wurde nie erfüllt)');
    process.exitCode = 1;
  }
});
function pruefe(ok: boolean, name: string, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}

const ENTWURF = (extra: Record<string, unknown> = {}): object => ({
  version: 1,
  name: 'T4a',
  detailSeed: 'wov',
  continents: [],
  regions: [{ id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2000 }, edgeFalloff: 300 }],
  placements: [{ prefab: 'Beech1', x: 10, z: 10 }],
  heightDeltas: [{ zx: 0, zz: 0, r: ['32|32|12'] }],
  ...extra,
});

interface Aufruf { url: string; methode: string; body?: string }

/** A scripted service: `zustaende` are the answers of GET /api/server in order (the last one repeats). */
function attrappe(opt: { post?: { status: number; body?: unknown }; zustaende?: Array<{ aktiv: boolean; roh: string } | 'fehler'>; spieler?: unknown }) {
  const aufrufe: Aufruf[] = [];
  let gets = 0;
  const holen: Holen = async (url, init) => {
    aufrufe.push({ url, methode: init?.method ?? 'GET', ...(init?.body ? { body: init.body } : {}) });
    if ((init?.method ?? 'GET') === 'POST') {
      const p = opt.post ?? { status: 200, body: { aktion: 'neustart' } };
      return { ok: p.status < 400, status: p.status, json: async () => p.body ?? {} };
    }
    const z = (opt.zustaende ?? [{ aktiv: true, roh: 'active' }])[Math.min(gets++, (opt.zustaende ?? [1]).length - 1)]!;
    if (z === 'fehler') throw new Error('Verbindung getrennt');
    return { ok: true, status: 200, json: async () => ({ dienst: 'wov-server', zustand: { ...z, seit: 'x' }, ...(opt.spieler !== undefined ? { spieler: opt.spieler } : {}) }) };
  };
  return { holen, aufrufe, posts: () => aufrufe.filter((a) => a.methode === 'POST') };
}

function uhr() {
  let t = 1_000_000;
  let schlaefe = 0;
  return {
    jetzt: () => t,
    /** Moves the fake clock (also backwards). */
    vor: (ms: number): void => {
      t += ms;
    },
    schlafe: async (ms: number): Promise<void> => {
      t += ms;
      if (++schlaefe > 400) throw new Error('endlos gewartet (Zeitlimit greift nicht)');
    },
  };
}

function lauf(opt: { speichern: (d: object) => Promise<SpeicherAntwort>; laden?: () => object | null; netz: ReturnType<typeof attrappe>; reihenfolge?: string[]; rohtext?: () => string | null; uhr?: ReturnType<typeof uhr> }) {
  const stati: NeustartStatus[] = [];
  const u = opt.uhr ?? uhr();
  const speichernAufrufe: object[] = [];
  const entwurf: EntwurfDienste = {
    laden: opt.laden ?? (() => ENTWURF()),
    ...(opt.rohtext ? { rohtext: opt.rohtext } : {}),
    speichern: async (d) => {
      speichernAufrufe.push(d);
      opt.reihenfolge?.push('speichern');
      return opt.speichern(d);
    },
  };
  const l = neustartLauf({
    entwurf,
    holen: async (url, init) => {
      if (init?.method === 'POST') opt.reihenfolge?.push('neustart');
      return opt.netz.holen(url, init);
    },
    jetzt: u.jetzt,
    schlafe: u.schlafe,
    status: (s) => stati.push(s),
  });
  return { l, stati, speichernAufrufe };
}

const HASH2 = '2'.repeat(64);
const HASH3 = 'c'.repeat(64);
const warteTick = (): Promise<void> => new Promise((f) => setTimeout(f, 5));
const OK: SpeicherAntwort = { ok: true, message: 'Gespeichert' };


/**
 * A1: the binding of `Testflug.ts` to `speichernVerdrahtung.ts`, read from the syntax tree. Returns the violations (empty = bound).
 *  - the four panel callbacks (`neustartKlick`, `neustartJa`, `neustartAbbruch`, `speichernGelaende`) come from ONE spread
 *    `...panelRueckrufe(() => ({ verdrahtung, neustart }))`; nobody else assigns them (no property, no `x.neustartJa = …`);
 *    nothing follows the spread in that object literal;
 *  - `aufSpeichern` is assigned exactly once, to `verdrahtung.speichereEntwurf`, in an object literal without any spread;
 *  - `belegt` is assigned exactly once, to the arrow `() => verdrahtung.einfachLaeuft()`.
 */
function testflugBindung(quelle: string): string[] {
  const sf = ts.createSourceFile('Testflug.ts', quelle, ts.ScriptTarget.Latest, true);
  const SCHLUESSEL = ['neustartKlick', 'neustartJa', 'neustartAbbruch', 'speichernGelaende'];
  const verstoesse: string[] = [];
  const name = (n: ts.PropertyName | ts.Expression): string | null => (ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : null);
  const zuweisungen = new Map<string, Array<{ init: ts.Node | null; objekt: ts.ObjectLiteralExpression | null }>>();
  const spreads: ts.SpreadAssignment[] = [];
  const merke = (k: string, init: ts.Node | null, objekt: ts.ObjectLiteralExpression | null): void => {
    const l = zuweisungen.get(k) ?? [];
    l.push({ init, objekt });
    zuweisungen.set(k, l);
  };
  const gehe = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n)) {
      const k = name(n.name);
      if (k) merke(k, n.initializer, n.parent as ts.ObjectLiteralExpression);
      else if (ts.isComputedPropertyName(n.name)) merke('<berechnet>', n, null);
    } else if (ts.isShorthandPropertyAssignment(n)) merke(n.name.text, null, n.parent as ts.ObjectLiteralExpression);
    else if (ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n)) {
      const k = name(n.name);
      if (k) merke(k, null, ts.isObjectLiteralExpression(n.parent) ? n.parent : null);
    } else if (ts.isSpreadAssignment(n)) spreads.push(n);
    else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left)) merke(n.left.name.text, n.right, null);
    ts.forEachChild(n, gehe);
  };
  gehe(sf);
  const text = (n: ts.Node | null): string => (n ? n.getText(sf).replace(/\s+/g, ' ') : '');
  const panelSpreads = spreads.filter((s) => ts.isCallExpression(s.expression) && text(s.expression.expression) === 'panelRueckrufe');
  if (panelSpreads.length !== 1) verstoesse.push(`panelRueckrufe wird ${panelSpreads.length}-mal durchgereicht (erwartet 1)`);
  else {
    const sp = panelSpreads[0]!;
    const arg = (sp.expression as ts.CallExpression).arguments.map((a) => text(a)).join(',');
    if (arg !== '() => ({ verdrahtung, neustart })') verstoesse.push(`panelRueckrufe bekommt ${arg}`);
    const objekt = sp.parent as ts.ObjectLiteralExpression;
    const nach = objekt.properties.slice(objekt.properties.indexOf(sp) + 1);
    for (const p of nach) if (ts.isSpreadAssignment(p)) verstoesse.push('nach dem Durchreichen folgt ein weiterer Spread');
    for (const p of nach) {
      const k = p.name ? name(p.name) : null;
      if (k && SCHLUESSEL.includes(k)) verstoesse.push(`${k} wird nach dem Durchreichen überschrieben`);
    }
  }
  for (const k of SCHLUESSEL) if ((zuweisungen.get(k) ?? []).length > 0) verstoesse.push(`${k} wird in Testflug.ts selbst zugewiesen`);
  if ((zuweisungen.get('<berechnet>') ?? []).length > 0) verstoesse.push('berechneter Schlüssel in einem Objekt');
  const auf = zuweisungen.get('aufSpeichern') ?? [];
  if (auf.length !== 1) verstoesse.push(`aufSpeichern wird ${auf.length}-mal zugewiesen (erwartet 1)`);
  else {
    if (text(auf[0]!.init) !== 'verdrahtung.speichereEntwurf') verstoesse.push(`aufSpeichern ist ${text(auf[0]!.init)}`);
    if (auf[0]!.objekt?.properties.some((p) => ts.isSpreadAssignment(p))) verstoesse.push('im Objekt von aufSpeichern steht ein Spread');
  }
  const bel = zuweisungen.get('belegt') ?? [];
  if (bel.length !== 1) verstoesse.push(`belegt wird ${bel.length}-mal zugewiesen (erwartet 1)`);
  else if (text(bel[0]!.init) !== '() => verdrahtung.einfachLaeuft()') verstoesse.push(`belegt ist ${text(bel[0]!.init)}`);
  return verstoesse;
}

async function main(): Promise<void> {
  // ── Vorbedingung: das gültige Testdokument hat kein heightProblem ──
  const gesund = await entwurfSpeichern({ laden: () => ENTWURF(), speichern: async () => OK });
  pruefe(gesund.art === 'antwort', '0: Der Testentwurf mit gültiger Handkorrektur wird gespeichert', gesund.art);

  // ── 1. Ablauf ok ──
  {
    const netz = attrappe({ zustaende: [{ aktiv: false, roh: 'activating' }, { aktiv: false, roh: 'activating' }, { aktiv: true, roh: 'active' }] });
    const reihenfolge: string[] = [];
    const r = lauf({ speichern: async () => OK, netz, reihenfolge });
    const ende = await r.l.starten();
    pruefe(netz.posts().length === 1, '1: genau EIN POST /api/server', String(netz.posts().length));
    pruefe(netz.posts()[0]?.url === '/api/server' && JSON.parse(netz.posts()[0]?.body ?? '{}').aktion === 'neustart', '1: der POST trägt {aktion:"neustart"}');
    pruefe(reihenfolge.join(',') === 'speichern,neustart', '1: erst speichern, dann neu starten', reihenfolge.join(','));
    pruefe(ende?.phase === 'laeuft-wieder', '1: Endzustand „läuft wieder“', JSON.stringify(ende));
    const phasen = r.stati.map((s) => s.phase);
    pruefe(phasen[0] === 'speichert' && phasen.includes('startet-neu') && phasen.at(-1) === 'laeuft-wieder', '1: Zustände speichert → startet neu → läuft wieder', phasen.join(','));
    pruefe(netz.aufrufe.filter((a) => a.methode === 'GET').length >= 4, '1: gepollt, bis der Dienst stabil läuft', String(netz.aufrufe.length));
    pruefe(!r.l.laeuft(), '1: Sperre nach dem Ende frei');
    pruefe(r.speichernAufrufe.length === 1, '1: genau ein Speichern');
    // Ein Verbindungsabriss während des Neustarts ist kein Fehler, solange das Zeitlimit hält.
    const netz2 = attrappe({ zustaende: ['fehler', 'fehler', { aktiv: true, roh: 'active' }] });
    const e2 = await lauf({ speichern: async () => OK, netz: netz2 }).l.starten();
    pruefe(e2?.phase === 'laeuft-wieder', '1b: Verbindungsabriss beim Polling wird überbrückt', JSON.stringify(e2));
  }

  // ── 2. Speichern scheitert ──
  const faelle: Array<[string, () => Promise<SpeicherAntwort>, string]> = [
    ['ohne_basis', async () => ({ ok: false, message: 'Keine Basis — bitte im Editor abgleichen' }), 'speichern'],
    ['409 veraltet', async () => ({ ok: false, message: 'Server hat sich geändert' }), 'speichern'],
    ['422 Höhenkorrektur', async () => ({ ok: false, message: 'Höhenkorrektur ungültig' }), 'speichern'],
    ['Netzfehler', async () => { throw new Error('Failed to fetch'); }, 'netz'],
  ];
  for (const [name, speichern, grund] of faelle) {
    const netz = attrappe({});
    const r = lauf({ speichern, netz });
    const ende = await r.l.starten();
    pruefe(netz.aufrufe.length === 0, `2: ${name} → kein einziger /api/server-Aufruf`, String(netz.aufrufe.length));
    pruefe(ende?.phase === 'fehler' && ende.grund === grund, `2: ${name} → Fehlerzustand „${grund}“`, JSON.stringify(ende));
    pruefe(!r.stati.some((s) => s.phase === 'startet-neu'), `2: ${name} → nie „startet neu“`);
    pruefe(!r.l.laeuft(), `2: ${name} → Sperre wieder frei`);
    pruefe(JSON.stringify(r.stati.at(-1)) === JSON.stringify(ende), `2: ${name} → der Fehlerzustand wird an status() gemeldet`);
  }
  {
    const r = lauf({ speichern: async () => ({ ok: false, message: 'Keine Basis — bitte im Editor abgleichen' }), netz: attrappe({}) });
    const ende = await r.l.starten();
    pruefe(ende !== null && neustartText(ende).includes('Keine Basis — bitte im Editor abgleichen'), '2: die bestehende Meldung der Speicherung erscheint im Text', ende ? neustartText(ende) : 'null');
  }

  // ── 3. Neustart 409 ──
  {
    const netz = attrappe({ post: { status: 409, body: { fehler: 'aktion-laeuft', message: 'Eine andere Serveraktion läuft bereits' } } });
    const r = lauf({ speichern: async () => OK, netz });
    const ende = await r.l.starten();
    pruefe(netz.posts().length === 1, '3: ein POST, kein zweiter Versuch', String(netz.posts().length));
    pruefe(netz.aufrufe.length === 1, '3: kein Polling nach dem 409', String(netz.aufrufe.length));
    pruefe(ende?.phase === 'fehler' && ende.grund === 'aktion-laeuft', '3: Grund aktion-laeuft', JSON.stringify(ende));
    pruefe(ende !== null && neustartText(ende).includes('zweiter Tab'), '3: freundlicher HUD-Text', ende ? neustartText(ende) : '');
    const netz5 = attrappe({ post: { status: 500, body: { message: 'systemctl kaputt' } } });
    const e5 = await lauf({ speichern: async () => OK, netz: netz5 }).l.starten();
    pruefe(e5?.phase === 'fehler' && e5.grund === 'neustart' && neustartText(e5).includes('systemctl kaputt'), '3b: anderer Fehler beim Neustart zeigt den Grund des Dienstes');
  }

  // ── 4. Zeitlimit ──
  {
    const netz = attrappe({ zustaende: [{ aktiv: false, roh: 'activating' }] });
    const ende = await lauf({ speichern: async () => OK, netz }).l.starten();
    pruefe(ende?.phase === 'fehler' && ende.grund === 'zeitlimit', '4: Dienst kommt nie hoch → Zeitlimit', JSON.stringify(ende));
    pruefe(ende?.phase === 'fehler' && ende.grund === 'zeitlimit' && ende.sekunden >= LIMIT_MS / 1000 && ende.sekunden < LIMIT_MS / 1000 + 5, '4: gemessene Wartezeit liegt am Limit', JSON.stringify(ende));
    const flatter = attrappe({ zustaende: [{ aktiv: true, roh: 'active' }, { aktiv: false, roh: 'activating' }] });
    const e2 = await lauf({ speichern: async () => OK, netz: flatter }).l.starten();
    pruefe(e2?.phase === 'fehler' && e2.grund === 'zeitlimit', '4b: kurz „läuft“ und wieder aus (Fehlstart) zählt nicht als fertig', JSON.stringify(e2));
  }

  // ── 5. F1 ──
  for (const [name, extra] of [['heightDeltas kein Array', { heightDeltas: 'kaputt' }], ['ungültiger Punkteintrag', { heightDeltas: [{ zx: 0, zz: 0, r: ['kaputt'] }] }], ['zu viele Zonen', { heightDeltas: Array.from({ length: 4097 }, (_, i) => ({ zx: i, zz: 0, r: ['32|32|12'] })) }]] as const) {
    const netz = attrappe({});
    const r = lauf({ speichern: async () => OK, laden: () => ENTWURF(extra), netz });
    const ende = await r.l.starten();
    pruefe(r.speichernAufrufe.length === 0, `5: ${name} → nichts gespeichert (Neustart-Knopf)`);
    pruefe(netz.aufrufe.length === 0, `5: ${name} → kein Neustart (Neustart-Knopf)`);
    pruefe(ende?.phase === 'fehler' && ende.grund === 'hoehe', `5: ${name} → Fehlerzustand „hoehe“`, JSON.stringify(ende));
    pruefe(ende !== null && neustartText(ende).includes('beschädigt'), `5: ${name} → Text nennt den Grund`, ende ? neustartText(ende) : '');
    // der einfache Speichern-Knopf geht denselben Weg
    let gesendet = 0;
    const e = await entwurfSpeichern({ laden: () => ENTWURF(extra), speichern: async () => { gesendet++; return OK; } });
    pruefe(gesendet === 0 && e.art === 'hoehe', `5: ${name} → auch der einfache Speichern-Knopf sendet nichts`, e.art);
    pruefe(entwurfErgebnisText(e).includes('beschädigt'), `5: ${name} → HUD-Text des einfachen Knopfs`, entwurfErgebnisText(e));
  }

  // ── 6. Doppelklick ──
  {
    const netz = attrappe({ zustaende: [{ aktiv: false, roh: 'activating' }, { aktiv: true, roh: 'active' }] });
    const r = lauf({ speichern: async () => OK, netz });
    const a = r.l.starten();
    const sofort = r.l.laeuft();
    const b = r.l.starten();
    const [ea, eb] = await Promise.all([a, b]);
    pruefe(sofort, '6: während des Laufs ist der Knopf gesperrt');
    pruefe(eb === null && ea?.phase === 'laeuft-wieder', '6: der zweite Aufruf wird ignoriert', JSON.stringify([ea, eb]));
    pruefe(netz.posts().length === 1 && r.speichernAufrufe.length === 1, '6: genau ein Neustart und ein Speichern', `${netz.posts().length}/${r.speichernAufrufe.length}`);
    const c = await r.l.starten();
    pruefe(c !== null && netz.posts().length === 2, '6: nach dem Ende ist ein neuer Lauf wieder möglich');
  }

  // ── 7. Z3 ──
  {
    const netz = attrappe({});
    const ende = await lauf({ speichern: async () => ({ ok: true, message: 'Gespeichert', loeschsperre: 3 }), netz }).l.starten();
    pruefe(netz.posts().length === 1, '7: eine zurückgehaltene Löschung hält den Neustart nicht an');
    pruefe(ende?.phase === 'laeuft-wieder' && ende.loeschsperre === 3, '7: Endzustand trägt die Zahl', JSON.stringify(ende));
    pruefe(ende !== null && neustartText(ende).includes('3') && neustartText(ende).includes('Karteneditor'), '7: Text nennt Anzahl und Karteneditor', ende ? neustartText(ende) : '');
  }

  // ── 8. Spieler ──
  pruefe((await spielerLesen(attrappe({ spieler: 4 }).holen)) === 4, '8: Zahl aus GET /api/server');
  pruefe((await spielerLesen(attrappe({}).holen)) === null, '8: ohne Feld → null');
  pruefe((await spielerLesen(attrappe({ spieler: 'viele' }).holen)) === null, '8: kein Zahlenwert → null');
  pruefe((await spielerLesen(attrappe({ spieler: -1 }).holen)) === null, '8: negative Zahl → null');
  pruefe((await spielerLesen(attrappe({ zustaende: ['fehler'] }).holen)) === null, '8: Netzfehler → null');

  // ── 9. Verdrahtung und Texte ──
  const testflug = lies('../src/editor/testflug/Testflug.ts');
  const panel = lies('../src/editor/SpawnPanel.ts');
  const verd = lies('../src/editor/testflug/speichernVerdrahtung.ts');
  pruefe(/speichereEntwurf\(\) \{[\s\S]{0,900}entwurfSpeichern\(d\.entwurf\)/.test(verd), '9: der einfache Speichern-Knopf geht über entwurfSpeichern (F1)');
  // A1: die Bindung wird am Syntaxbaum geprüft, nicht am Text; die Umformulierungen des Prüfers müssen auffallen
  const urspruenglich = testflugBindung(testflug);
  pruefe(urspruenglich.length === 0, '9: Testflug.ts ist an die Verdrahtung gebunden (Syntaxbaum: Rückrufe, aufSpeichern, belegt)', urspruenglich.join('; '));
  const DURCH = '      ...panelRueckrufe(() => ({ verdrahtung, neustart })),';
  const AUF = '      aufSpeichern: verdrahtung.speichereEntwurf,';
  const umformulierungen: Array<[string, string, string]> = [
    ['X26b „Ja“ dahinter überschrieben', DURCH, `${DURCH}\n      neustartJa: () => undefined,`],
    ['X26d eigenes speichernGelaende dahinter', DURCH, `${DURCH}\n      speichernGelaende: () => void persistenz.speichern(persistenz.laden() ?? {}),`],
    ['X27b alte Zeile als Kommentar, eigenes aufSpeichern', AUF, '      // aufSpeichern: verdrahtung.speichereEntwurf\n      aufSpeichern: () => void persistenz.speichern(persistenz.laden() ?? {}),'],
    ['X27c zweites aufSpeichern per Spread', AUF, `${AUF}\n      ...{ aufSpeichern: () => void persistenz.speichern(persistenz.laden() ?? {}) },`],
    ['Y14b belegt && false', '      belegt: () => verdrahtung.einfachLaeuft(),', '      belegt: () => verdrahtung.einfachLaeuft() && false,'],
    ['X26 Durchreichen entfernt', `${DURCH}\n`, ''],
    ['X27 aufSpeichern am Schutz vorbei', AUF, '      aufSpeichern: () => void persistenz.speichern(persistenz.laden() ?? {}),'],
    ['Zuweisung nach dem Bau (cb.neustartJa = …)', AUF, `${AUF}\n      zusatz: (cb: { neustartJa?: () => void }) => { cb.neustartJa = () => undefined; },`],
  ];
  for (const [name, alt, neu] of umformulierungen) {
    const treffer = testflug.split(alt).length - 1;
    const verstoesse = treffer === 1 ? testflugBindung(testflug.replace(alt, neu)) : ['Stelle nicht gefunden'];
    pruefe(treffer === 1 && verstoesse.length > 0, `9: ${name} → die Bindungsprüfung schlägt an`, verstoesse.join('; ') || 'NICHT erkannt');
  }
  pruefe(/neustartJa: \(\) => void holen\(\)\.neustart\.neustartJa\(\)/.test(verd) && /neustartKlick: \(\) => void holen\(\)\.neustart\.neustartKlick\(\)/.test(verd) && /neustartAbbruch: \(\) => holen\(\)\.neustart\.neustartAbbruch\(\)/.test(verd), '9: die Panel-Rückrufe sind verdrahtet (Ja ist nicht tot)');
  pruefe(!/sanitizeWorldLayout\(roh as never\)/.test(testflug), '9: Testflug.ts bereinigt den Entwurf nicht mehr am Schutz vorbei');
  pruefe(/neustartSteuerung\(\{[\s\S]{0,200}entwurf: entwurfDienste/.test(testflug) && /speichernVerdrahtung\(\{ entwurf: entwurfDienste/.test(testflug), '9: beide Knöpfe gehen über denselben Speicherweg (entwurfDienste)');
  pruefe(/'testflug\.gelaende\.speichern_neustart'\), \(\) => this\.cb\.neustartKlick\?\.\(\)/.test(panel), '9: der Knopf „Speichern & neu starten“ ruft nur die Frage (neustartKlick)');
  pruefe((panel.match(/cb\.neustartJa\?\.\(\)/g) ?? []).length === 1 && /'testflug\.neustart\.ja'\), \(\) => this\.cb\.neustartJa\?\.\(\)/.test(panel), '9: neustartJa hängt allein am „Ja“ der Bestätigung');
  pruefe(/class SpawnPanel implements NeustartOberflaeche/.test(panel) && /oberflaeche: panel,/.test(testflug), '9: das Panel ist die Oberfläche der Steuerung (Status, Frage, Sperre verdrahtet)');
  pruefe(/spieler: \(\) => spielerLesen\(echtesHolen\)/.test(testflug), '9: die Spielerzahl ist verdrahtet');
  pruefe(/neustartSteuerung\(\{[\s\S]{0,400}jetzt: monotoneUhr/.test(testflug) && !/jetzt: \(\) => Date\.now/.test(testflug), '9: monotone Uhr statt Wanduhr');
  pruefe(/if \(d\.neustart\(\)\.laeuft\(\)\) \{[\s\S]{0,80}testflug\.neustart\.fehler\.gesperrt/.test(verd), '9: der einfache Speichern-Knopf ist während des Laufs gesperrt (N6)');
  pruefe(/for \(const k of \[this\.speichernKnopf, this\.neustartKnopf\]\)/.test(panel) && /k\.disabled = an/.test(panel), '9: das Panel sperrt beide Knöpfe');
  const de = JSON.parse(lies('../src/i18n/katalog/de.json')) as Record<string, string>;
  const en = JSON.parse(lies('../src/i18n/katalog/en.json')) as Record<string, string>;
  const schluessel = Object.keys(de).filter((k) => k.startsWith('testflug.neustart.') || k.startsWith('testflug.gelaende.hoehe.') || k.startsWith('testflug.gelaende.verworfen.') || k === 'testflug.gelaende.speichern_neustart');
  pruefe(schluessel.length === 38, '9: 38 neue Schlüssel', String(schluessel.length));
  pruefe(schluessel.every((k) => typeof en[k] === 'string' && en[k] !== de[k]), '9: jeder Schlüssel in en vorhanden und übersetzt');
  const quelle = lies('../src/editor/testflug/neustart.ts') + lies('../src/editor/testflug/entwurfSpeichern.ts') + lies('../src/editor/testflug/LocalStoragePersistenz.ts') + lies('../src/editor/testflug/neustartSteuerung.ts') + lies('../src/editor/testflug/speichernVerdrahtung.ts') + testflug + panel;
  pruefe(schluessel.every((k) => quelle.includes(`'${k}'`)), '9: jeder neue Schlüssel wird im Quelltext benutzt');
  pruefe(quelle.includes("'testflug.gelaende.leere_route'") && typeof de['testflug.gelaende.leere_route'] === 'string' && typeof en['testflug.gelaende.leere_route'] === 'string', '9: Text „Leere Route nicht gespeichert“ in de und en');
  pruefe(typeof de['testflug.persistenz.local.unbestaetigt'] === 'string' && typeof en['testflug.persistenz.local.unbestaetigt'] === 'string', '9: Text „nicht bestätigt“ in de und en');
  const text = de['testflug.neustart.text'] ?? '';
  pruefe(/Spieler/.test(text) && /getrennt/.test(text) && /automatisch/.test(text) && /Gelände/.test(text), '9: der Dialogtext sagt ehrlich, was passiert');

  // ── 10. M1: 2xx ohne gültigen neuen Hash ist nicht „gespeichert“ ──
  {
    const speicher = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => speicher.get(k) ?? null,
      setItem: (k: string, v: string) => void speicher.set(k, v),
    };
    const zettel = JSON.stringify({ zeit: '2026-10-01T00:00:00.000Z', instanz: 'dev', quelle: 'server', tabId: 'tabA', basis: 'h1' });
    let antwort: () => Response = () => new Response('{}');
    (globalThis as unknown as { fetch: unknown }).fetch = async () => antwort();
    const p = localStoragePersistenz();
    const faelle: Array<[string, () => Response]> = [
      ['HTML-Seite', () => new Response('<html>Bad Gateway</html>', { status: 200 })],
      ['leerer Leib', () => new Response('', { status: 200 })],
      ['abgeschnittenes JSON', () => new Response('{"ok":true,"ha', { status: 200 })],
      ['{}', () => new Response('{}', { status: 200 })],
      ['204', () => new Response(null, { status: 204 })],
      ['ok ohne Hash', () => new Response(JSON.stringify({ ok: true, message: 'saved' }), { status: 200 })],
      ['leerer Hash', () => new Response(JSON.stringify({ ok: true, hash: '  ' }), { status: 200 })],
    ];
    for (const [name, a] of faelle) {
      speicher.set(STAND_KEY, zettel);
      antwort = a;
      const r = await p.speichern(ENTWURF());
      pruefe(r.ok === false, `10: ${name} → nicht gespeichert`, JSON.stringify(r));
      pruefe(JSON.parse(speicher.get(STAND_KEY) ?? '{}').basis === 'h1', `10: ${name} → Basis unangetastet`);
      const netz = attrappe({});
      const reihenfolge: string[] = [];
      const lf = lauf({ speichern: (d) => p.speichern(d), netz, reihenfolge });
      const ende = await lf.l.starten();
      pruefe(netz.aufrufe.length === 0 && ende?.phase === 'fehler' && ende.grund === 'speichern', `10: ${name} → kein Neustart, Fehlerzustand`, JSON.stringify(ende));
      pruefe(ende !== null && neustartText(ende).includes('nicht bestätigt'), `10: ${name} → HUD nennt „nicht bestätigt“`);
    }
    speicher.set(STAND_KEY, zettel);
    antwort = () => new Response(JSON.stringify({ ok: true, message: 'Gespeichert', hash: HASH2 }), { status: 200 });
    const gut = await p.speichern(ENTWURF());
    pruefe(gut.ok === true && JSON.parse(speicher.get(STAND_KEY) ?? '{}').basis === HASH2, '10: gültiger Hash → gespeichert, Basis nachgezogen', JSON.stringify(gut));
    speicher.set(STAND_KEY, zettel);
    antwort = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ETag: `"${HASH3}"` } });
    const etag = await p.speichern(ENTWURF());
    pruefe(etag.ok === true && JSON.parse(speicher.get(STAND_KEY) ?? '{}').basis === HASH3, '10: Hash im ETag-Kopf genügt', JSON.stringify(etag));
  }

  // ── 11. M2: was der Sanitizer verwerfen würde, hält an ──
  {
    const kern = { id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2000 }, edgeFalloff: 300 };
    const schlecht: Array<[string, Record<string, unknown>, string, number]> = [
      ['Region mit doppelter id', { regions: [kern, { ...kern, shape: { kind: 'circle', x: 5000, z: 0, radius: 900 } }] }, 'regions', 1],
      ['Fluss mit kaputtem Punkt', { rivers: [{ id: 'fluss1', width: 8, points: [[0, 0], [100, 'x'], [200, 0]] }] }, 'rivers', 1],
      ['See mit kaputter Form', { lakes: [{ id: 'see1', x: 'a', z: 0, radius: 50 }] }, 'lakes', 1],
      ['Platzierung mit kaputter Koordinate', { placements: [{ prefab: 'Beech1', x: 10, z: 10 }, { prefab: 'Beech1', x: 'abc', z: 10 }] }, 'placements', 1],
    ];
    for (const [name, extra, feld, anzahl] of schlecht) {
      const netz = attrappe({});
      const r = lauf({ speichern: async () => OK, laden: () => ENTWURF(extra), netz });
      const ende = await r.l.starten();
      pruefe(r.speichernAufrufe.length === 0 && netz.aufrufe.length === 0, `11: ${name} → nichts gesendet, kein Neustart`);
      pruefe(ende?.phase === 'fehler' && ende.grund === 'verworfen' && ende.teile.some((x) => x.feld === feld && x.anzahl === anzahl), `11: ${name} → Art und Anzahl`, JSON.stringify(ende));
      let gesendet = 0;
      const e = await entwurfSpeichern({ laden: () => ENTWURF(extra), speichern: async () => { gesendet++; return OK; } });
      pruefe(gesendet === 0 && e.art === 'verworfen', `11: ${name} → auch der einfache Speichern-Knopf sendet nichts`, e.art);
      pruefe(entwurfErgebnisText(e).includes(': 1'), `11: ${name} → HUD nennt die Anzahl`, entwurfErgebnisText(e));
    }
    const zwei = await entwurfSpeichern({ laden: () => ENTWURF({ regions: [kern, { ...kern, id: 'insel2', shape: { kind: 'circle', x: 5000, z: 0, radius: '900' } }] }), speichern: async () => OK });
    pruefe(zwei.art === 'antwort', '11: Region mit Radius als Text bleibt erhalten, kein Anhalten', zwei.art);
    const dup = await entwurfSpeichern({ laden: () => ENTWURF({ placements: [{ prefab: 'Beech1', x: 10, z: 10 }, { prefab: 'Beech1', x: 10, z: 10 }] }), speichern: async () => OK });
    pruefe(dup.art === 'antwort', '11: ein exaktes Duplikat wird zusammengefasst und nicht als Verlust gezählt', dup.art);
    const leer = await entwurfSpeichern({ laden: () => ENTWURF({ heightDeltas: [], rivers: [], lakes: [] }), speichern: async () => OK });
    pruefe(leer.art === 'antwort', '11: leere Listen sind kein Verlust', leer.art);
    // E6: gesendet wird der bereinigte Entwurf, nicht der rohe
    const gesendetes: object[] = [];
    const roh = ENTWURF({ fremdesFeld: 'weg', placements: [{ prefab: 'Beech1', x: 10, z: 10, unbekannt: 1 }] });
    await entwurfSpeichern({ laden: () => roh, speichern: async (d) => { gesendetes.push(d); return OK; } });
    const soll = sanitizeWorldLayout(roh as never);
    pruefe(gesendetes.length === 1 && JSON.stringify(gesendetes[0]) === JSON.stringify(soll) && !('fremdesFeld' in (gesendetes[0] as object)), '11: gesendet wird der bereinigte Entwurf, nicht der rohe');
  }

  // ── 12. N1–N7 ──
  {
    // N1: der POST darf beliebig lange dauern, das Limit zählt erst danach
    const u = uhr();
    const netz = attrappe({});
    const holenLangsam: Holen = async (url, init) => {
      if (init?.method === 'POST') u.vor(56_000);
      return netz.holen(url, init);
    };
    const stati: NeustartStatus[] = [];
    const l = neustartLauf({ entwurf: { laden: () => ENTWURF(), speichern: async () => OK }, holen: holenLangsam, jetzt: u.jetzt, schlafe: u.schlafe, status: (s) => stati.push(s) });
    const ende = await l.starten();
    pruefe(ende?.phase === 'laeuft-wieder', 'N1: POST von 56 s, danach läuft der Dienst → „läuft wieder“, kein Zeitlimit', JSON.stringify(ende));
    pruefe(ende?.phase === 'laeuft-wieder' && ende.sekunden < 20, 'N1: die Sekunden zählen ab der Antwort auf den POST', JSON.stringify(ende));
    // N2: Uhr springt eine Stunde zurück
    const u2 = uhr();
    let sprung = false;
    const stati2: NeustartStatus[] = [];
    const netz2 = attrappe({ zustaende: [{ aktiv: false, roh: 'activating' }] });
    const l2 = neustartLauf({
      entwurf: { laden: () => ENTWURF(), speichern: async () => OK },
      holen: netz2.holen,
      jetzt: () => u2.jetzt(),
      schlafe: async (ms) => {
        await u2.schlafe(ms);
        if (!sprung && u2.jetzt() > 1_000_000 + 10_000) {
          sprung = true;
          u2.vor(-3_600_000);
        }
      },
      status: (s) => stati2.push(s),
    });
    const ende2 = await l2.starten();
    pruefe(ende2?.phase === 'fehler' && ende2.grund === 'zeitlimit', 'N2: Uhrsprung zurück, Dienst nie oben → Zeitlimit', JSON.stringify(ende2));
    pruefe(netz2.aufrufe.filter((a) => a.methode === 'GET').length <= MAX_ABFRAGEN + 1, `N2: die Zahl der Abfragen ist begrenzt (${netz2.aufrufe.length} ≤ ${MAX_ABFRAGEN + 2})`);
    pruefe(stati2.every((s) => s.phase !== 'startet-neu' || s.sekunden >= 0), 'N2: keine negativen Sekunden');
    const testflugQuelle = lies('../src/editor/testflug/neustart.ts');
    pruefe(/monotoneUhr = \(\): number => performance\.now\(\)/.test(testflugQuelle), 'N2: die echte Uhr ist monoton (performance.now)');

    // N3: unlesbarer Entwurf
    const n3 = lauf({ speichern: async () => OK, laden: () => { throw new SyntaxError('Unexpected token'); }, netz: attrappe({}) });
    const e3 = await n3.l.starten();
    pruefe(e3?.phase === 'fehler' && e3.grund === 'entwurf', 'N3: unlesbarer Entwurf hat einen eigenen Grund', JSON.stringify(e3));
    pruefe(e3 !== null && !neustartText(e3).includes('Betriebsdienst') && neustartText(e3).includes('nicht lesbar'), 'N3: der Text sagt „nicht lesbar“, nicht „Verbindung“', e3 ? neustartText(e3) : '');
    const e3b = await entwurfSpeichern({ laden: () => { throw new SyntaxError('x'); }, speichern: async () => OK });
    pruefe(e3b.art === 'unlesbar' && entwurfErgebnisText(e3b).includes('nicht lesbar'), 'N3: auch der einfache Knopf sagt „nicht lesbar“');

    // N4: Warntext der Speicherung
    const e4 = await lauf({ speichern: async () => ({ ok: true, message: 'Der Server hat den Stand aus Schutz nicht angewendet (abgelehnt)', grund: 'abgelehnt' }), netz: attrappe({}) }).l.starten();
    pruefe(e4 !== null && neustartText(e4).includes('aus Schutz nicht angewendet'), 'N4: der Warntext der Speicherung steht im Schlusstext', e4 ? neustartText(e4) : '');

    // N5: Netzabbruch / 504 beim Neustart-POST
    for (const [name, post] of [['Netzabbruch', 'wirft'], ['504', { status: 504, body: {} }], ['502', { status: 502, body: {} }]] as const) {
      const n = attrappe(post === 'wirft' ? {} : { post });
      const holen: Holen = post === 'wirft' ? async (url, init) => (init?.method === 'POST' ? (n.aufrufe.push({ url, methode: 'POST' }), Promise.reject(new Error('Failed to fetch'))) : n.holen(url, init)) : n.holen;
      const stati5: NeustartStatus[] = [];
      const u5 = uhr();
      const l5 = neustartLauf({ entwurf: { laden: () => ENTWURF(), speichern: async () => OK }, holen, jetzt: u5.jetzt, schlafe: u5.schlafe, status: (s) => stati5.push(s) });
      const p1 = l5.starten();
      const zweiter = await l5.starten();
      const e5 = await p1;
      pruefe(e5?.phase === 'laeuft-wieder' && e5.unklar, `N5: ${name} beim POST → Zustand wird geprüft, Ende „läuft“ mit unklarem Neustart`, JSON.stringify(e5));
      pruefe(zweiter === null && n.posts().length === 1, `N5: ${name} → ein zweiter Klick sendet nicht erneut`, String(n.posts().length));
      pruefe(stati5.some((s) => s.phase === 'startet-neu' && s.unklar === true), `N5: ${name} → Zwischenstand „unklar“`);
      pruefe(e5 !== null && neustartText(e5).includes('unklar'), `N5: ${name} → Text sagt „unklar“`, e5 ? neustartText(e5) : '');
    }
    {
      const n = attrappe({ zustaende: [{ aktiv: false, roh: 'activating' }] });
      const holen: Holen = async (url, init) => (init?.method === 'POST' ? Promise.reject(new Error('abgebrochen')) : n.holen(url, init));
      const u5 = uhr();
      const e = await neustartLauf({ entwurf: { laden: () => ENTWURF(), speichern: async () => OK }, holen, jetzt: u5.jetzt, schlafe: u5.schlafe, status: () => undefined }).starten();
      pruefe(e?.phase === 'fehler' && e.grund === 'zeitlimit', 'N5: unklar und Dienst kommt nie hoch → Zeitlimit', JSON.stringify(e));
    }

    // N7: Strich während des Laufs
    let roh7 = 'A';
    const netz7 = attrappe({});
    const r7 = lauf({ speichern: async () => { roh7 = 'B'; return OK; }, netz: netz7, rohtext: () => roh7 });
    const e7 = await r7.l.starten();
    pruefe(e7?.phase === 'laeuft-wieder' && e7.striche === true && neustartText(e7).includes('noch nicht auf dem Server'), 'N7: Änderung während des Laufs → Hinweis im Schlusstext', e7 ? neustartText(e7) : '');
    const r7b = lauf({ speichern: async () => OK, netz: attrappe({}), rohtext: () => 'A' });
    const e7b = await r7b.l.starten();
    pruefe(e7b?.phase === 'laeuft-wieder' && e7b.striche === false && !neustartText(e7b).includes('noch nicht auf dem Server'), 'N7: ohne Änderung kein Hinweis');
  }

  // ── 13. M3: die Steuerlogik ──
  {
    const aufruf: string[] = [];
    const ui: NeustartOberflaeche & { status: Array<[string, string]>; sperren: boolean[]; spieler: Array<number | null> } = {
      status: [],
      sperren: [],
      spieler: [],
      zeigeNeustartFrage(n) { aufruf.push('frage'); this.spieler.push(n); },
      schliesseNeustartFrage() { aufruf.push('zu'); },
      zeigeNeustartStatus(text, phase) { this.status.push([phase, text]); },
      sperreSpeichern(an) { this.sperren.push(an); },
    };
    const bau = (opt: { netz: ReturnType<typeof attrappe>; speichern?: () => Promise<SpeicherAntwort>; spieler?: () => Promise<number | null> }) => {
      const u = uhr();
      const hud: string[] = [];
      const speichernAufrufe: number[] = [];
      const st = neustartSteuerung({
        entwurf: { laden: () => ENTWURF(), speichern: async () => { speichernAufrufe.push(1); return (opt.speichern ?? (async () => OK))(); } },
        holen: opt.netz.holen,
        jetzt: u.jetzt,
        schlafe: u.schlafe,
        spieler: opt.spieler ?? (async () => 4),
        oberflaeche: ui,
        hud: (x) => hud.push(x),
      });
      return { st, hud, speichernAufrufe };
    };
    const frisch = (): void => { aufruf.length = 0; ui.status.length = 0; ui.sperren.length = 0; ui.spieler.length = 0; };

    frisch();
    const a = bau({ netz: attrappe({}) });
    await a.st.neustartKlick();
    pruefe(aufruf.join() === 'frage' && ui.spieler[0] === 4, '13: Klick fragt nur und reicht die Spielerzahl an die Frage', `${aufruf.join()} ${ui.spieler[0]}`);
    pruefe(a.speichernAufrufe.length === 0 && ui.status.length === 0 && ui.sperren.length === 0, '13: ohne „Ja“ kein Speichern, kein Neustart, keine Sperre');
    a.st.neustartAbbruch();
    pruefe(aufruf.at(-1) === 'zu' && a.speichernAufrufe.length === 0, '13: Abbrechen schließt die Frage und startet nichts');
    await a.st.neustartJa();
    pruefe(a.speichernAufrufe.length === 1 && ui.sperren.join() === 'true,false', '13: „Ja“ startet genau einen Lauf, Sperre an dann aus', ui.sperren.join());
    pruefe(ui.status[0]?.[0] === 'speichert' && ui.status.at(-1)?.[0] === 'laeuft-wieder', '13: jeder Zustand erreicht die Oberfläche', ui.status.map((s) => s[0]).join());
    pruefe(a.hud.length === 1 && a.hud[0] === ui.status.at(-1)?.[1], '13: das Ende steht auch im HUD');

    frisch();
    const f = bau({ netz: attrappe({}), speichern: async () => ({ ok: false, message: 'Server hat sich geändert' }) });
    await f.st.neustartJa();
    pruefe(ui.status.at(-1)?.[0] === 'fehler' && ui.sperren.join() === 'true,false' && f.hud.length === 1, '13: nach einem Fehler: Zeile zeigt den Fehler, Sperre wieder aus, HUD-Meldung', `${ui.status.at(-1)?.[0]} ${ui.sperren.join()}`);

    frisch();
    const o = bau({ netz: attrappe({}), spieler: async () => null });
    await o.st.neustartKlick();
    pruefe(ui.spieler[0] === null, '13: ohne Zahl zeigt die Frage keine Zahl');
    frisch();
    const w = bau({ netz: attrappe({}), spieler: async () => { throw new Error('x'); } });
    await w.st.neustartKlick();
    pruefe(ui.spieler[0] === null && aufruf.join() === 'frage', '13: scheitert das Lesen der Zahl, kommt die Frage trotzdem');

    frisch();
    const netzD = attrappe({ zustaende: [{ aktiv: false, roh: 'activating' }, { aktiv: true, roh: 'active' }] });
    const d = bau({ netz: netzD });
    const l1 = d.st.neustartJa();
    await d.st.neustartKlick();
    pruefe(!aufruf.includes('frage') && d.st.laeuft(), '13: während des Laufs öffnet ein Klick keine neue Frage');
    const l2 = d.st.neustartJa();
    await Promise.all([l1, l2]);
    pruefe(netzD.posts().length === 1 && d.speichernAufrufe.length === 1, '13: zweimal „Ja“ → ein Lauf', `${netzD.posts().length}/${d.speichernAufrufe.length}`);
    pruefe(!d.st.laeuft(), '13: nach dem Ende frei');
  }

  // ── 13b. M3 (R3): Steuerung genauer ──
  {
    const log: string[] = [];
    const sperren: boolean[] = [];
    const ui: NeustartOberflaeche = {
      zeigeNeustartFrage: () => void log.push('frage'),
      schliesseNeustartFrage: () => void log.push('zu'),
      zeigeNeustartStatus: () => undefined,
      sperreSpeichern: (an) => void sperren.push(an),
    };
    const bau = (spieler: () => Promise<number | null>, netz = attrappe({ zustaende: [{ aktiv: false, roh: 'activating' }, { aktiv: true, roh: 'active' }] }), speichern: () => Promise<SpeicherAntwort> = async () => OK) => {
      const u = uhr();
      return neustartSteuerung({ entwurf: { laden: () => ENTWURF(), speichern }, holen: netz.holen, jetzt: u.jetzt, schlafe: u.schlafe, spieler, oberflaeche: ui, hud: () => undefined });
    };
    // X20: ein zweites „Ja“ im Lauf hebt die Sperre nicht auf
    const st = bau(async () => 1);
    const lauf1 = st.neustartJa();
    await st.neustartJa();
    pruefe(sperren.join() === 'true', '13b: ein zweites „Ja“ im Lauf ändert die Sperre nicht (kein vorzeitiges Aufheben)', sperren.join());
    await lauf1;
    pruefe(sperren.join() === 'true,false', '13b: Sperre an, nach dem Ende genau einmal aus', sperren.join());
    // X23: „Ja“ schließt die Frage
    log.length = 0;
    await bau(async () => 1).neustartJa();
    pruefe(log[0] === 'zu', '13b: „Ja“ schließt die Frage', log.join());
    // X19: die Frage erscheint nicht, wenn inzwischen ein Lauf begonnen hat
    log.length = 0;
    let frei: (n: number | null) => void = () => undefined;
    let speicherFrei: (a: SpeicherAntwort) => void = () => undefined;
    const st2 = bau(() => new Promise<number | null>((f) => (frei = f)), undefined, () => new Promise<SpeicherAntwort>((f) => (speicherFrei = f)));
    const klick = st2.neustartKlick();
    const lauf2 = st2.neustartJa();
    await warteTick();
    frei(2);
    await klick;
    speicherFrei(OK);
    await lauf2;
    pruefe(!log.includes('frage'), '13b: die Frage erscheint nicht, wenn inzwischen ein Lauf begonnen hat', log.join());
  }

  // ── 14. N2: R1–R7 ──
  {
    const route0 = { id: 'route1', points: [] as unknown[], mode: 'loop', speed: 1.4 };
    // R1: leere Route
    const gesendetR1: object[] = [];
    const r1 = await entwurfSpeichern({ laden: () => ENTWURF({ routes: [route0] }), speichern: async (d) => { gesendetR1.push(d); return OK; } });
    pruefe(r1.art === 'antwort' && r1.leereRouten === 1, 'R1: „Neue Route“ ohne Punkt sperrt das Speichern nicht', r1.art);
    pruefe(gesendetR1.length === 1 && !('routes' in (gesendetR1[0] as object)), 'R1: die leere Route geht nicht mit auf den Server');
    pruefe(entwurfErgebnisText(r1).includes('Leere Route nicht gespeichert'), 'R1: das HUD sagt es in einem Satz', entwurfErgebnisText(r1));
    const netz1 = attrappe({});
    const e1 = await lauf({ speichern: async () => OK, laden: () => ENTWURF({ routes: [route0] }), netz: netz1 }).l.starten();
    pruefe(e1?.phase === 'laeuft-wieder' && netz1.posts().length === 1 && neustartText(e1).includes('Leere Route nicht gespeichert'), 'R1: auch „Speichern & neu starten“ läuft durch und nennt die leere Route', e1 ? neustartText(e1) : '');
    const kaputt = await entwurfSpeichern({ laden: () => ENTWURF({ routes: [route0, { id: 'r2', points: [[0, 0], [1, 'x']], mode: 'loop' }] }), speichern: async () => OK });
    pruefe(kaputt.art === 'verworfen' && kaputt.teile.some((x) => x.feld === 'routes' && x.anzahl === 1), 'R1: eine Route mit kaputtem Punkt sperrt weiter (die leere daneben zählt nicht mit)', JSON.stringify(kaputt));

    // R2: Sammlung ist keine Liste
    const keineListe: Array<[string, Record<string, unknown>, string]> = [
      ['regions als Objekt', { regions: { '0': { id: 'kern' } } }, 'regions'],
      ['rivers als Objekt', { rivers: { a: 1 } }, 'rivers'],
      ['placements als Text', { placements: 'viele' }, 'placements'],
      ['lakes als Zahl', { lakes: 5 }, 'lakes'],
      ['routes als Objekt', { routes: {} }, 'routes'],
      ['bausaetze als Text', { bausaetze: 'x' }, 'bausaetze'],
      ['continents als Objekt', { continents: { a: 1 } }, 'continents'],
    ];
    for (const [name, extra, feld] of keineListe) {
      let gesendet = 0;
      const e = await entwurfSpeichern({ laden: () => ENTWURF(extra), speichern: async () => { gesendet++; return OK; } });
      pruefe(gesendet === 0 && e.art === 'verworfen' && e.teile.some((x) => x.feld === feld && x.keineListe === true), `R2: ${name} → nichts gesendet, als beschädigt gemeldet`, e.art);
      pruefe(entwurfErgebnisText(e).includes('keine Liste'), `R2: ${name} → HUD sagt „keine Liste“`, entwurfErgebnisText(e));
      const netz = attrappe({});
      const ende = await lauf({ speichern: async () => OK, laden: () => ENTWURF(extra), netz }).l.starten();
      pruefe(netz.aufrufe.length === 0 && ende?.phase === 'fehler', `R2: ${name} → kein Neustart`);
    }
    const nullen = await entwurfSpeichern({ laden: () => ENTWURF({ rivers: null, lakes: null, routes: null }), speichern: async () => OK });
    pruefe(nullen.art === 'antwort', 'R2: ein Feld mit null ist kein Verlust', nullen.art);

    // R3: jede geprüfte Sammlung hat einen Zeugen
    const kern = { id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2000 }, edgeFalloff: 300 };
    const jeSammlung: Array<[string, Record<string, unknown>, string]> = [
      ['continents', { continents: [null, { id: {} }] }, 'continents'],
      ['regions', { regions: [kern, { ...kern }] }, 'regions'],
      ['placements', { placements: [{ prefab: 'Beech1', x: 'abc', z: 10 }] }, 'placements'],
      ['rivers', { rivers: [{ id: 'f', width: 8, points: [[0, 0], [100, 'x']] }] }, 'rivers'],
      ['lakes', { lakes: [{ id: 's', x: 'a', z: 0, radius: 50 }] }, 'lakes'],
      ['routes', { routes: [{ id: 'r', points: [[0, 0], [1, 'x']], mode: 'loop' }] }, 'routes'],
      ['bausaetze', { bausaetze: [null, {}] }, 'bausaetze'],
      ['vegetationEntfernt', { vegetationEntfernt: [{ x: 1, z: 1, r: 500 }] }, 'vegetationEntfernt'],
      ['defaultSpawn', { defaultSpawn: [null, {}] }, 'defaultSpawn'],
    ];
    pruefe(GEPRUEFTE_SAMMLUNGEN.every((f) => jeSammlung.some(([, , x]) => x === f)), 'R3: jede geprüfte Sammlung hat einen Zeugen im Test', GEPRUEFTE_SAMMLUNGEN.join());
    for (const [name, extra, feld] of jeSammlung) {
      let gesendet = 0;
      const e = await entwurfSpeichern({ laden: () => ENTWURF(extra), speichern: async () => { gesendet++; return OK; } });
      pruefe(gesendet === 0 && e.art === 'verworfen' && e.teile.some((x) => x.feld === feld), `R3: ${name} → nichts gesendet`, e.art);
    }

    // R4: nur 64 Hex-Zeichen sind ein Hash
    pruefe(istDienstHash(HASH2) && !istDienstHash('h2') && !istDienstHash('5f3a-proxy') && !istDienstHash('<html>') && !istDienstHash('A'.repeat(64)) && !istDienstHash('2'.repeat(63)) && !istDienstHash('2'.repeat(65)) && !istDienstHash(null) && !istDienstHash(''), 'R4: istDienstHash nimmt nur 64 Kleinbuchstaben-Hex');
    {
      const speicher = new Map<string, string>();
      (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => speicher.get(k) ?? null, setItem: (k: string, v: string) => void speicher.set(k, v) };
      const zettel = JSON.stringify({ zeit: '2026-10-01T00:00:00.000Z', instanz: 'dev', quelle: 'server', tabId: 'tabA', basis: 'h1' });
      let antwort: () => Response = () => new Response('{}');
      (globalThis as unknown as { fetch: unknown }).fetch = async () => antwort();
      const p = localStoragePersistenz();
      const faelle: Array<[string, () => Response]> = [
        ['HTML mit fremdem ETag', () => new Response('<html>Gateway</html>', { status: 200, headers: { ETag: '"5f3a-proxy"' } })],
        ['schwacher fremder ETag', () => new Response('<html></html>', { status: 200, headers: { ETag: 'W/"abc"' } })],
        ['HTML im hash-Feld', () => new Response(JSON.stringify({ ok: true, hash: '<html>' }), { status: 200 })],
        ['Hash mit Großbuchstaben', () => new Response(JSON.stringify({ ok: true, hash: 'A'.repeat(64) }), { status: 200 })],
        ['Hash zu kurz', () => new Response(JSON.stringify({ ok: true, hash: '2'.repeat(63) }), { status: 200 })],
      ];
      for (const [name, a] of faelle) {
        speicher.set(STAND_KEY, zettel);
        antwort = a;
        const r = await p.speichern(ENTWURF());
        pruefe(r.ok === false && JSON.parse(speicher.get(STAND_KEY) ?? '{}').basis === 'h1', `R4: ${name} → nicht gespeichert, Basis unangetastet`, JSON.stringify(r).slice(0, 80));
      }
      // R7 durch die Persistenz: der Grund wird durchgereicht
      speicher.set(STAND_KEY, zettel);
      antwort = () => new Response(JSON.stringify({ ok: true, hash: HASH2, angewendet: false, grund: 'geo', message: 'Geschrieben, aber nicht angewendet (geo).' }), { status: 202 });
      const geo = await p.speichern(ENTWURF());
      pruefe(geo.ok === true && geo.grund === 'geo', 'R7: die Persistenz reicht den Grund (geo) durch', JSON.stringify(geo));
    }

    // R5: ein Neustart-Lauf wird abgelehnt, solange ein einfaches Speichern unterwegs ist
    {
      let freigeben: (a: SpeicherAntwort) => void = () => undefined;
      let speichernN = 0;
      const entwurf: EntwurfDienste = { laden: () => ENTWURF(), speichern: () => (speichernN++, new Promise<SpeicherAntwort>((f) => (freigeben = f))) };
      const hud: string[] = [];
      const netz = attrappe({});
      const u = uhr();
      let st: ReturnType<typeof neustartSteuerung>;
      const v = speichernVerdrahtung({ entwurf, hud: (x) => hud.push(x), neustart: () => st });
      st = neustartSteuerung({ entwurf, holen: netz.holen, jetzt: u.jetzt, schlafe: u.schlafe, spieler: async () => 0, oberflaeche: { zeigeNeustartFrage() {}, schliesseNeustartFrage() {}, zeigeNeustartStatus() {}, sperreSpeichern() {} }, hud: (x) => hud.push(x), belegt: () => v.einfachLaeuft() });
      v.speichereEntwurf();
      v.speichereEntwurf();
      await st.neustartJa();
      await st.neustartKlick();
      pruefe(speichernN === 1 && netz.aufrufe.length === 0, 'R5: unterwegs ist nur EIN Welt-POST, „Ja“ und Klick starten nichts', `${speichernN}/${netz.aufrufe.length}`);
      pruefe(hud.filter((x) => x.includes('läuft noch')).length === 3, 'R5: jedes Mal der Hinweis „Speichern läuft noch“', hud.join(' | '));
      freigeben(OK);
      await warteTick();
      pruefe(!v.einfachLaeuft(), 'R5: nach dem Ende ist das Speichern wieder frei');
      const zweiterLauf = st.neustartJa();
      await warteTick();
      pruefe(speichernN === 2, 'R5: danach läuft ein Neustart-Lauf (zweites Speichern)');
      freigeben(OK);
      await zweiterLauf;
    }

    // R6: rohtext wirft
    {
      const netz = attrappe({});
      const r = lauf({ speichern: async () => OK, netz, rohtext: () => { throw new Error('Speicher gesperrt'); } });
      const ende = await r.l.starten();
      pruefe(ende?.phase === 'fehler' && ende.grund === 'entwurf' && r.stati.at(-1)?.phase === 'fehler', 'R6: wirft rohtext() am Anfang → Fehlermeldung, die Zeile bleibt nicht auf „Speichere …“', JSON.stringify(ende));
      pruefe(netz.aufrufe.length === 0 && !r.l.laeuft(), 'R6: nichts gesendet, Sperre frei');
      let n = 0;
      const netz2 = attrappe({});
      const r2 = lauf({ speichern: async () => OK, netz: netz2, rohtext: () => { if (n++ > 0) throw new Error('weg'); return 'A'; } });
      const e2 = await r2.l.starten();
      pruefe(e2?.phase === 'laeuft-wieder' && e2.striche === true, 'R6: wirft rohtext() am Ende → Lauf endet sauber, der Hinweis auf offene Änderungen kommt vorsichtshalber', JSON.stringify(e2));
      // etwas Unerwartetes wirft mitten im Lauf (hier die Uhr): eine Meldung, keine abgelehnte Zusage, Sperre frei
      let aufrufeUhr = 0;
      const stati4: NeustartStatus[] = [];
      const l4 = neustartLauf({ entwurf: { laden: () => ENTWURF(), speichern: async () => OK }, holen: attrappe({}).holen, jetzt: () => { if (++aufrufeUhr > 2) throw new Error('Uhr kaputt'); return aufrufeUhr; }, schlafe: async () => undefined, status: (x) => stati4.push(x) });
      const e4 = await l4.starten().catch(() => 'abgelehnt' as const);
      pruefe(e4 !== 'abgelehnt' && e4?.phase === 'fehler' && stati4.at(-1)?.phase === 'fehler' && !l4.laeuft(), 'R6: ein unerwarteter Fehler im Lauf wird zur Fehlermeldung, die Sperre ist frei', JSON.stringify(e4));
      const r3 = lauf({ speichern: async () => { throw new Error('boom'); }, netz: attrappe({}), laden: () => { throw new Error('x'); } });
      const e3 = await r3.l.starten();
      pruefe(e3?.phase === 'fehler' && !r3.l.laeuft(), 'R6: unlesbar bleibt eine Meldung');
    }

    // R7/A3: nur der überholte Dienstsatz entfällt; ein angehängter Warnhinweis und Meldungen anderer Gründe bleiben
    const ACHTUNG = 'ACHTUNG: 2 Einträge vom Betriebsdienst verworfen';
    const a3: Array<[string | undefined, string | undefined, boolean, boolean]> = [
      // [Grund, Warnung, Dienstsatz sichtbar?, Warnung sichtbar?]
      ['geo', undefined, false, false],
      ['geo', ACHTUNG, false, true],
      ['server-aus', undefined, false, false],
      ['server-aus', ACHTUNG, false, true],
      ['zu-viele-aenderungen', undefined, false, false],
      ['zu-viele-aenderungen', ACHTUNG, false, true],
      ['keine-quittung', undefined, false, false],
      ['keine-quittung', ACHTUNG, false, true],
      [undefined, undefined, false, false],
      [undefined, ACHTUNG, false, true],
      ['abgelehnt', undefined, true, false],
    ];
    for (const [grund, warnung, satz, warn] of a3) {
      const e = await lauf({ speichern: async () => ({ ok: true, message: 'Meldung-des-Dienstes', ...(grund ? { grund } : {}), ...(warnung ? { warnung } : {}) }), netz: attrappe({}) }).l.starten();
      const text = e ? neustartText(e) : '';
      pruefe(text.includes('Meldung-des-Dienstes') === satz && text.includes('ACHTUNG') === warn, `A3: Grund ${String(grund)}${warnung ? ' mit Warnhinweis' : ''} → Dienstsatz ${satz ? 'bleibt' : 'entfällt'}, Warnhinweis ${warn ? 'bleibt' : 'fehlt'}`, text);
    }
    {
      const e200 = await lauf({ speichern: async () => ({ ok: true, message: 'Gespeichert' }), netz: attrappe({}) }).l.starten();
      pruefe(e200 !== null && !neustartText(e200).includes('Meldung beim Speichern'), 'A3: bei 200 kein „Meldung beim Speichern: Gespeichert“', e200 ? neustartText(e200) : '');
      // durch die echte Persistenz: 202 geo mit „verworfen“ → der Warnhinweis kommt als `warnung` an und im Schlusstext
      const speicher = new Map<string, string>();
      (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => speicher.get(k) ?? null, setItem: (k: string, v: string) => void speicher.set(k, v) };
      speicher.set(STAND_KEY, JSON.stringify({ zeit: '2026-10-01T00:00:00.000Z', instanz: 'dev', quelle: 'server', tabId: 'tabA', basis: 'h1' }));
      (globalThis as unknown as { fetch: unknown }).fetch = async () => new Response(JSON.stringify({ ok: true, hash: HASH2, angewendet: false, grund: 'geo', verworfen: 2, message: 'Geschrieben, aber nicht angewendet (geo).' }), { status: 202 });
      const pers = localStoragePersistenz();
      const echt = await pers.speichern(ENTWURF());
      pruefe(echt.ok === true && echt.warnung?.includes('ACHTUNG') === true && echt.warnung.includes('2'), 'A3: die Persistenz reicht den Warnhinweis des Dienstes getrennt durch', JSON.stringify(echt));
      const eEcht = await lauf({ speichern: (d) => pers.speichern(d), netz: attrappe({}) }).l.starten();
      pruefe(eEcht !== null && neustartText(eEcht).includes('ACHTUNG') && !neustartText(eEcht).includes('Geschrieben, aber nicht angewendet'), 'A3: Schlusstext zeigt den Warnhinweis, aber nicht den überholten Satz', eEcht ? neustartText(eEcht) : '');
    }

    // A2: ein werfendes HUD hält die Sperre nie dauerhaft
    {
      let gespeichert = 0;
      const entwurf: EntwurfDienste = { laden: () => ENTWURF(), speichern: async () => (gespeichert++, OK) };
      let hudAufrufe = 0;
      const v = speichernVerdrahtung({ entwurf, hud: () => { hudAufrufe++; throw new Error('HUD kaputt'); }, neustart: () => ({ laeuft: () => false, neustartKlick: async () => undefined, neustartJa: async () => undefined, neustartAbbruch: () => undefined }) });
      v.speichereEntwurf();
      await warteTick();
      await warteTick();
      pruefe(gespeichert === 1 && hudAufrufe === 2, 'A2: ein werfendes HUD stoppt das Speichern nicht', `${gespeichert}/${hudAufrufe}`);
      pruefe(!v.einfachLaeuft(), 'A2: die Sperre ist danach frei');
      v.speichereEntwurf();
      await warteTick();
      await warteTick();
      pruefe(gespeichert === 2 && !v.einfachLaeuft(), 'A2: ein weiterer Klick speichert wieder');
    }

    // Hinweis: eine unerwartete Ausnahme hat einen eigenen Text
    {
      let uhrAufrufe = 0;
      const l5 = neustartLauf({ entwurf: { laden: () => ENTWURF(), speichern: async () => OK }, holen: attrappe({}).holen, jetzt: () => { if (++uhrAufrufe > 2) throw new Error('Uhr kaputt'); return uhrAufrufe; }, schlafe: async () => undefined, status: () => undefined });
      const e5 = await l5.starten();
      pruefe(e5?.phase === 'fehler' && e5.grund === 'unerwartet', 'Unerwartete Ausnahme hat den Grund „unerwartet“', JSON.stringify(e5));
      pruefe(e5 !== null && neustartText(e5).includes('Unerwarteter Fehler') && !neustartText(e5).includes('Betriebsdienst'), 'Unerwartete Ausnahme: eigener, zutreffender Text', e5 ? neustartText(e5) : '');
    }
  }

  console.log(fehler === 0 ? '\nalle Prüfungen bestanden' : `\n${fehler} Prüfung(en) FEHLGESCHLAGEN`);
  fertig = true;
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
