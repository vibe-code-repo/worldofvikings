/**
 * GD2: the item route and the base stock, in process (the route function behind a plain HTTP server, test root under
 * /tmp/gd2-route-*, no child process).
 *
 *  [1] Reconciliation before reading/saving: working copy `[]` without a basis is pulled (29 entries, new hash); a repo that
 *      moved on is pulled into an untouched copy (a PUT with the old hash is 412); a conflict keeps the working copy.
 *  [2] A PUT that takes a base id out of the old working copy: 422 `grundgegenstand-nicht-loeschbar` (also with
 *      `?bestaetigt=1`), file byte-equal; a non-base id still needs the confirmation (409); a file without base entries
 *      (the DEV state `[]`) can be saved without them.
 *  [3] `POST /api/gegenstaende/zuruecksetzen`: removes exactly that entry, the others stay byte for byte (also other
 *      deviating copies); `grundErsetzt` of the new file; idempotent; refusals (not a base id, no `If-Match`, stale hash,
 *      unreadable file, discarded entries, wrong method) leave the file byte-equal.
 *  [4] The receipt answer carries `grundErsetzt` (from the watch's `ersetzt`).
 *
 * Run: npx tsx admin/test/gd2-grundstand-route.ts   (from the repo root)
 */
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRUNDBESTAND, GRUNDBESTAND_IDS, leseGegenstandsDatei } from '@wov/shared/src/items/gegenstandsDaten.js';
import { gegenstandsArbeitsDatei, gegenstandsBasisLesen, gegenstandsRepoDatei } from '@wov/shared/src/items/gegenstandsArbeitskopie.js';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { gegenstaendeBehandeln } from '../src/routen/gegenstaende.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}`);
}
const sha = (b: Buffer | string): string => layoutHash(b);

const WURZEL_ECHT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ECHT = readFileSync(gegenstandsRepoDatei(WURZEL_ECHT));
const ORDNER = mkdtempSync('/tmp/gd2-route-');
const ARBEITSORDNER = resolve(ORDNER, 'arbeit');
mkdirSync(ARBEITSORDNER, { recursive: true });
mkdirSync(dirname(gegenstandsRepoDatei(ORDNER)), { recursive: true });
process.env.WOV_WELT_VERZEICHNIS = ARBEITSORDNER;
const REPO = gegenstandsRepoDatei(ORDNER);
const ARBEIT = gegenstandsArbeitsDatei(ORDNER);
const QUITTUNG = resolve(ARBEITSORDNER, 'gegenstaende.quittung.json');
writeFileSync(REPO, REPO_ECHT);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  void gegenstaendeBehandeln(req, res, url.pathname, url.searchParams, ORDNER).then((ok) => {
    if (!ok) {
      res.writeHead(404);
      res.end();
    }
  });
});
await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig));
const port = (server.address() as { port: number }).port;

type Antwort = { status: number; daten: Record<string, unknown>; etag: string | null };
async function anfrage(methode: string, pfad: string, opt: { body?: string; ifMatch?: string | null } = {}): Promise<Antwort> {
  const kopf: Record<string, string> = { 'content-type': 'application/json' };
  if (opt.ifMatch) kopf['if-match'] = `"${opt.ifMatch}"`;
  const r = await fetch(`http://127.0.0.1:${port}${pfad}`, { method: methode, headers: kopf, ...(opt.body === undefined ? {} : { body: opt.body }) });
  const roh = await r.text();
  let daten: Record<string, unknown> = {};
  try {
    daten = JSON.parse(roh) as Record<string, unknown>;
  } catch {
    /* no JSON */
  }
  return { status: r.status, daten, etag: r.headers.get('etag') };
}
const get = (): Promise<Antwort> => anfrage('GET', '/api/gegenstaende');
const put = (body: string, ifMatch: string | null, query = ''): Promise<Antwort> => anfrage('PUT', `/api/gegenstaende${query}`, { body, ifMatch });
const zurueck = (id: unknown, ifMatch: string | null, body?: string): Promise<Antwort> =>
  anfrage('POST', '/api/gegenstaende/zuruecksetzen', { body: body ?? JSON.stringify({ id }), ifMatch });
const bytes = (): Buffer => readFileSync(ARBEIT);
const nebenDateien = (): string => readdirSync(ARBEITSORDNER).filter((n) => !n.endsWith('.lock')).sort().join();

const rohe = (): Array<Record<string, unknown>> => (JSON.parse(REPO_ECHT.toString('utf-8')) as { gegenstaende: Array<Record<string, unknown>> }).gegenstaende;
const dokument = (liste: unknown[]): string => `${JSON.stringify({ version: 1, gegenstaende: liste }, null, 2)}\n`;
const holzaxt = {
  id: 'Holzaxt', nameSchluessel: 'inhalt.gegenstand.Holzaxt.name', typ: 'material', stapel: 1,
  texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'Holzaxt', en: 'Wooden axe' } },
};
const mitWerten = (id: string, ueber: Record<string, unknown>): Record<string, unknown> => ({ ...rohe().find((e) => e.id === id)!, ...ueber });
/** A fresh state: working copy and basis as given (a basis of `null` = no basis file). */
function zustand(arbeitText: string | null, basis: string | null): void {
  for (const n of readdirSync(ARBEITSORDNER)) rmSync(resolve(ARBEITSORDNER, n), { recursive: true, force: true });
  if (arbeitText !== null) writeFileSync(ARBEIT, arbeitText);
  if (basis !== null) writeFileSync(resolve(ARBEITSORDNER, 'gegenstaende.basis'), `${basis}\n`);
}

try {
  console.log('\n[1] Reconciliation before reading and saving');
  {
    zustand(dokument([]), null); // the DEV state
    const g = await get();
    check('1 working copy [] without a basis: GET pulls the repo state (29 entries)', g.status === 200 && (g.daten.eintraege as unknown[]).length === 29 && g.daten.hash === sha(REPO_ECHT), `${g.status} ${(g.daten.eintraege as unknown[])?.length}`);
    check('1 ... the file is the repo file, basis = repo hash, quelle repo, grundErsetzt []', bytes().equals(REPO_ECHT) && gegenstandsBasisLesen(ARBEIT) === sha(REPO_ECHT) && g.daten.quelle === 'repo' && (g.daten.grundErsetzt as unknown[]).length === 0);
    check('1 ... a backup of the old file lies there', readdirSync(ARBEITSORDNER).some((n) => n.endsWith('.bak')));
  }
  {
    zustand(null, null);
    const g = await get();
    check('1 working copy missing: GET creates it from the repo state', g.status === 200 && bytes().equals(REPO_ECHT) && gegenstandsBasisLesen(ARBEIT) === sha(REPO_ECHT));
  }
  {
    // the repo moved on, the working copy is untouched (= basis)
    zustand(null, null);
    await get();
    const alt = String((await get()).daten.hash);
    const neuerRepo = dokument(rohe().map((e) => (e.id === 'Wood' ? { ...e, ernte: { baum: 4 } } : e)));
    writeFileSync(REPO, neuerRepo);
    const stale = await put(dokument(rohe()), alt);
    check('1 the repo moved on: a PUT with the OLD hash is 412 (the first save never builds on the stale file), the file is the new repo state', stale.status === 412 && readFileSync(ARBEIT, 'utf-8') === neuerRepo, `${stale.status}`);
    const g = await get();
    check('1 GET then shows the new state (Wood.ernte.baum 4), hash = the new repo hash', g.daten.hash === sha(neuerRepo) && (g.daten.eintraege as Array<{ id: string; ernte: { baum?: number } }>).find((e) => e.id === 'Wood')?.ernte.baum === 4);
    writeFileSync(REPO, REPO_ECHT);
  }
  {
    // a conflict: own entries, no basis, other than the repo
    const eigen = dokument([holzaxt]);
    zustand(eigen, null);
    const g = await get();
    check('1 conflict (a Holzaxt copy, no basis): GET returns the working copy, byte-equal, quelle arbeit', g.status === 200 && readFileSync(ARBEIT, 'utf-8') === eigen && g.daten.quelle === 'arbeit' && (g.daten.eintraege as Array<{ id: string }>).map((e) => e.id).join() === 'Holzaxt');
    check('1 ... no basis written, no backup', gegenstandsBasisLesen(ARBEIT) === null && !readdirSync(ARBEITSORDNER).some((n) => n.endsWith('.bak')));
  }

  console.log('\n[2] Taking a base id out of the file');
  {
    zustand(null, null);
    const g0 = await get();
    const hash = String(g0.daten.hash);
    const ohneWood = dokument(rohe().filter((e) => e.id !== 'Wood'));
    const vor = bytes();
    const a = await put(ohneWood, hash);
    check('2 PUT without Wood: 422 grundgegenstand-nicht-loeschbar, names Wood, file byte-equal', a.status === 422 && a.daten.fehler === 'grundgegenstand-nicht-loeschbar' && JSON.stringify(a.daten.grundgegenstaende) === '["Wood"]' && bytes().equals(vor), `${a.status} ${JSON.stringify(a.daten)}`);
    const b = await put(ohneWood, hash, '?bestaetigt=1');
    check('2 ... also with ?bestaetigt=1', b.status === 422 && b.daten.fehler === 'grundgegenstand-nicht-loeschbar' && bytes().equals(vor));
    const ohneZwei = dokument(rohe().filter((e) => e.id !== 'Wood' && e.id !== 'Stone'));
    const c = await put(ohneZwei, hash);
    check('2 two base ids out: both named', c.status === 422 && JSON.stringify([...(c.daten.grundgegenstaende as string[])].sort()) === '["Stone","Wood"]', JSON.stringify(c.daten.grundgegenstaende));
    const mitAxt = await put(dokument([...rohe(), holzaxt]), hash);
    check('2 a file WITH all base entries and a new item: 200', mitAxt.status === 200, `${mitAxt.status} ${JSON.stringify(mitAxt.daten)}`);
    const h2 = String(mitAxt.daten.hash);
    const nurAxtWeg = await put(dokument(rohe()), h2);
    check('2 a non-base item out: still 409 (needs the confirmation), not 422', nurAxtWeg.status === 409 && nurAxtWeg.daten.fehler === 'brauchtBestaetigung' && JSON.stringify(nurAxtWeg.daten.entfernt) === '["Holzaxt"]');
    const beides = await put(dokument(rohe().filter((e) => e.id !== 'Wood')), h2);
    check('2 base id AND other change: the 422 comes first', beides.status === 422 && beides.daten.fehler === 'grundgegenstand-nicht-loeschbar');
  }
  {
    // the old DEV state without base entries: saving without them is no removal
    zustand(dokument([holzaxt]), sha(REPO_ECHT)); // repo = basis: the copy is kept as it is
    const g = await get();
    const a = await put(dokument([{ ...holzaxt, stapel: 3 }]), String(g.daten.hash));
    check('2 a working copy with no base entries: a PUT without them is 200 (nothing to remove)', a.status === 200, `${a.status} ${JSON.stringify(a.daten)}`);
  }

  console.log('\n[3] Reset to the base state');
  {
    // Wood and Stone as deviating copies (hand edited: the PUT would refuse), plus a Holzaxt
    const text = dokument([mitWerten('Wood', { stapel: 77 }), mitWerten('Stone', { stapel: 66 }), holzaxt]);
    zustand(text, sha(REPO_ECHT));
    const g = await get();
    check('3 setup: GET names both deviating copies', JSON.stringify([...(g.daten.grundErsetzt as string[])].sort()) === '["Stone","Wood"]', JSON.stringify(g.daten.grundErsetzt));
    const nebenVor = nebenDateien();
    const r = await zurueck('Wood', String(g.daten.hash));
    const nachRoh = JSON.parse(readFileSync(ARBEIT, 'utf-8')) as { gegenstaende: Array<{ id: string }> };
    check('3 reset Wood: 200, zurueckgesetzt true', r.status === 200 && r.daten.zurueckgesetzt === true && r.daten.id === 'Wood', `${r.status} ${JSON.stringify(r.daten)}`);
    check('3 the Wood entry is gone, Stone and Holzaxt stay', nachRoh.gegenstaende.map((e) => e.id).join() === 'Stone,Holzaxt', nachRoh.gegenstaende.map((e) => e.id).join());
    check('3 the others are byte for byte what they were (Stone still deviates with stapel 66)', JSON.stringify(nachRoh.gegenstaende) === JSON.stringify([mitWerten('Stone', { stapel: 66 }), holzaxt]));
    check('3 the answer: new hash = file hash, grundErsetzt names only Stone, ETag', r.daten.hash === sha(bytes()) && JSON.stringify(r.daten.grundErsetzt) === '["Stone"]' && r.etag === `"${sha(bytes())}"`);
    check('3 no new side files (no lock, no tmp)', nebenDateien() === nebenVor, nebenDateien());
    const g2 = await get();
    check('3 GET: Wood is no longer replaced, the base entry applies', JSON.stringify(g2.daten.grundErsetzt) === '["Stone"]' && leseGegenstandsDatei(bytes().toString('utf-8')).grundErsetzt.join() === 'Stone');
    const r2 = await zurueck('Stone', String(g2.daten.hash));
    check('3 reset Stone too: the warning source is gone (the reader replaces nothing any more)', r2.status === 200 && JSON.stringify(r2.daten.grundErsetzt) === '[]' && leseGegenstandsDatei(bytes().toString('utf-8')).grundErsetzt.length === 0);
    const vor = bytes();
    const r3 = await zurueck('Stone', String(r2.daten.hash));
    check('3 reset again: 200, zurueckgesetzt false, file byte-equal (idempotent)', r3.status === 200 && r3.daten.zurueckgesetzt === false && bytes().equals(vor) && r3.daten.hash === sha(vor), JSON.stringify(r3.daten));
    check('3 Holzaxt untouched', (JSON.parse(bytes().toString('utf-8')) as { gegenstaende: Array<{ id: string }> }).gegenstaende.map((e) => e.id).join() === 'Holzaxt');
  }
  {
    // a full working copy (all 29): resetting one entry removes exactly that one, the other 28 stay byte-equal
    zustand(null, null);
    const g = await get();
    const vorher = (JSON.parse(bytes().toString('utf-8')) as { gegenstaende: unknown[] }).gegenstaende;
    const r = await zurueck('Hammer', String(g.daten.hash));
    const nachher = (JSON.parse(bytes().toString('utf-8')) as { gegenstaende: Array<{ id: string }> }).gegenstaende;
    check('3 all 29 present, reset Hammer: 28 entries left, the same ones in the same order, byte-equal', r.status === 200 && nachher.length === 28 && JSON.stringify(nachher) === JSON.stringify(vorher.filter((e) => (e as { id: string }).id !== 'Hammer')));
    const g2 = await get();
    check('3 the base entry of Hammer still applies: reading gives 28 entries and no error', g2.status === 200 && (g2.daten.eintraege as unknown[]).length === 28 && g2.daten.dateiFehler === null);
  }
  {
    zustand(dokument([mitWerten('Wood', { stapel: 77 }), holzaxt]), sha(REPO_ECHT));
    const g = await get();
    const hash = String(g.daten.hash);
    const vor = bytes();
    const gleich = (): boolean => bytes().equals(vor);
    const a = await zurueck('Holzaxt', hash);
    check('3 refusal: not a base id (Holzaxt): 422 kein-grundgegenstand, file byte-equal', a.status === 422 && a.daten.fehler === 'kein-grundgegenstand' && gleich(), `${a.status} ${JSON.stringify(a.daten)}`);
    const b = await zurueck('wood', hash);
    check('3 refusal: wrong spelling (wood): 422 kein-grundgegenstand', b.status === 422 && b.daten.fehler === 'kein-grundgegenstand' && gleich());
    const c = await zurueck(null, hash, '{"id": 5}');
    check('3 refusal: id is no string: 422 kein-grundgegenstand', c.status === 422 && c.daten.fehler === 'kein-grundgegenstand' && gleich());
    const d = await zurueck(null, hash, 'das ist kein json');
    check('3 refusal: body is no JSON: 422 kein-grundgegenstand', d.status === 422 && d.daten.fehler === 'kein-grundgegenstand' && gleich());
    const e = await zurueck(null, hash, 'null');
    check('3 refusal: body null: 422 kein-grundgegenstand', e.status === 422 && e.daten.fehler === 'kein-grundgegenstand' && gleich());
    const f = await zurueck('Wood', null);
    check('3 refusal: no If-Match: 428 basis-fehlt', f.status === 428 && f.daten.fehler === 'basis-fehlt' && gleich(), `${f.status}`);
    const h = await zurueck('Wood', sha('ein anderer Stand'));
    check('3 refusal: stale hash: 412 veraltet with the current hash', h.status === 412 && h.daten.fehler === 'veraltet' && h.daten.hash === hash && gleich(), `${h.status}`);
    const i = await anfrage('GET', '/api/gegenstaende/zuruecksetzen');
    check('3 refusal: GET on the reset route: 405 methode, Allow POST', i.status === 405 && i.daten.fehler === 'methode' && gleich());
    const j = await anfrage('PUT', '/api/gegenstaende/zuruecksetzen', { body: '{}', ifMatch: hash });
    check('3 refusal: PUT on the reset route: 405', j.status === 405 && gleich());
    const gross = await zurueck(null, hash, JSON.stringify({ id: 'x'.repeat(5000) }));
    check('3 refusal: a body over 4096 bytes: 413, file byte-equal', gross.status === 413 && gross.daten.fehler === 'anfrage-zu-gross' && gleich(), `${gross.status}`);
  }
  {
    // unreadable and partly discarded files: a reset changes nothing
    const kaputt = '{"version":1,"gegenstaende":[';
    zustand(kaputt, sha(REPO_ECHT));
    const a = await zurueck('Wood', sha(kaputt));
    check('3 refusal: broken working copy: 422 datei-kein-json (or a head error), file byte-equal', a.status === 422 && typeof a.daten.fehler === 'string' && String(a.daten.fehler).startsWith('datei-') && readFileSync(ARBEIT, 'utf-8') === kaputt, `${a.status} ${JSON.stringify(a.daten)}`);
    const mitMuell = dokument([mitWerten('Wood', { stapel: 77 }), { id: 'Kaputt' }, holzaxt]);
    zustand(mitMuell, sha(REPO_ECHT));
    const b = await zurueck('Wood', sha(mitMuell));
    check('3 refusal: a file with a discarded entry: 422 eintraege-verworfen with the list, file byte-equal (no quiet clean-up)', b.status === 422 && b.daten.fehler === 'eintraege-verworfen' && Array.isArray(b.daten.verworfen) && (b.daten.verworfen as unknown[]).length === 1 && readFileSync(ARBEIT, 'utf-8') === mitMuell, `${b.status} ${JSON.stringify(b.daten)}`);
  }

  console.log('\n[4] The receipt answer');
  {
    zustand(null, null);
    await get();
    writeFileSync(QUITTUNG, JSON.stringify({ status: 'angewendet', hash: 'x', zeit: 'jetzt', ersetzt: ['Wood', 'Stone'] }));
    const q = await anfrage('GET', '/api/gegenstaende/quittung');
    check('4 receipt with ersetzt: the answer carries grundErsetzt with the same ids', q.status === 200 && JSON.stringify(q.daten.grundErsetzt) === '["Wood","Stone"]' && JSON.stringify(q.daten.ersetzt) === '["Wood","Stone"]', JSON.stringify(q.daten));
    writeFileSync(QUITTUNG, JSON.stringify({ status: 'angewendet', hash: 'x', zeit: 'jetzt' }));
    const q2 = await anfrage('GET', '/api/gegenstaende/quittung');
    check('4 receipt without ersetzt: grundErsetzt is []', q2.status === 200 && JSON.stringify(q2.daten.grundErsetzt) === '[]');
    rmSync(QUITTUNG);
    const q3 = await anfrage('GET', '/api/gegenstaende/quittung');
    check('4 no receipt: status keine', q3.daten.status === 'keine');
  }
  check('the base stock is the 29 ids this test works on', GRUNDBESTAND.length === 29 && GRUNDBESTAND_IDS.length === 29);
} finally {
  server.close();
  rmSync(ORDNER, { recursive: true, force: true });
}
if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nalle Pruefungen bestanden');
process.exit(0);
