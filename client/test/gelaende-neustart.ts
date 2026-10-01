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
 *
 * Run: npx tsx test/gelaende-neustart.ts   (from client/)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entwurfErgebnisText, entwurfSpeichern, type EntwurfDienste } from '../src/editor/testflug/entwurfSpeichern';
import { LIMIT_MS, neustartLauf, neustartText, spielerLesen, type Holen, type NeustartStatus } from '../src/editor/testflug/neustart';
import type { SpeicherAntwort } from '../src/editor/testflug/TestflugPersistenz';

const HIER = dirname(fileURLToPath(import.meta.url));
const lies = (rel: string): string => readFileSync(resolve(HIER, rel), 'utf-8');

let fehler = 0;
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
    schlafe: async (ms: number): Promise<void> => {
      t += ms;
      if (++schlaefe > 400) throw new Error('endlos gewartet (Zeitlimit greift nicht)');
    },
  };
}

function lauf(opt: { speichern: (d: object) => Promise<SpeicherAntwort>; laden?: () => object | null; netz: ReturnType<typeof attrappe>; reihenfolge?: string[] }) {
  const stati: NeustartStatus[] = [];
  const u = uhr();
  const speichernAufrufe: object[] = [];
  const entwurf: EntwurfDienste = {
    laden: opt.laden ?? (() => ENTWURF()),
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

const OK: SpeicherAntwort = { ok: true, message: 'Gespeichert' };

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
  pruefe(/const speichereEntwurf = \(\): void => \{[\s\S]{0,300}entwurfSpeichern\(entwurfDienste\)/.test(testflug), '9: der einfache Speichern-Knopf geht über entwurfSpeichern (F1)');
  pruefe(!/sanitizeWorldLayout\(roh as never\)/.test(testflug), '9: Testflug.ts bereinigt den Entwurf nicht mehr am Schutz vorbei');
  pruefe(/speichernNeustart: \(\) => void neustart\.starten\(\)/.test(testflug) && /entwurf: entwurfDienste/.test(testflug), '9: der Neustart-Knopf geht über denselben Speicherweg');
  pruefe(/this\.cb\.speichernNeustart\?\.\(\)/.test(panel) && /testflug\.neustart\.ja/.test(panel), '9: Panel ruft den Neustart erst nach der Bestätigung');
  pruefe(/this\.neustartKnopf\.disabled = laeuft/.test(panel), '9: Panel sperrt den Knopf während des Laufs');
  const de = JSON.parse(lies('../src/i18n/katalog/de.json')) as Record<string, string>;
  const en = JSON.parse(lies('../src/i18n/katalog/en.json')) as Record<string, string>;
  const schluessel = Object.keys(de).filter((k) => k.startsWith('testflug.neustart.') || k.startsWith('testflug.gelaende.hoehe.') || k === 'testflug.gelaende.speichern_neustart');
  pruefe(schluessel.length === 19, '9: 19 neue Schlüssel', String(schluessel.length));
  pruefe(schluessel.every((k) => typeof en[k] === 'string' && en[k] !== de[k]), '9: jeder Schlüssel in en vorhanden und übersetzt');
  const quelle = lies('../src/editor/testflug/neustart.ts') + lies('../src/editor/testflug/entwurfSpeichern.ts') + panel;
  pruefe(schluessel.every((k) => quelle.includes(`'${k}'`)), '9: jeder neue Schlüssel wird im Quelltext benutzt');
  const text = de['testflug.neustart.text'] ?? '';
  pruefe(/Spieler/.test(text) && /getrennt/.test(text) && /automatisch/.test(text) && /Gelände/.test(text), '9: der Dialogtext sagt ehrlich, was passiert');

  console.log(fehler === 0 ? '\nalle Prüfungen bestanden' : `\n${fehler} Prüfung(en) FEHLGESCHLAGEN`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
