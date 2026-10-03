/**
 * GD2: the item route and the base stock, in process (the route function behind a plain HTTP server, test root under
 * /tmp/gd2-route-*, no child process).
 *
 *  [1] Reconciliation before reading/saving (the file holds deviations only): the DEV state is not touched; a missing copy is
 *      created EMPTY; the 29 repo copies of an older build are taken out (back-up, a PUT with the old hash is 412); a
 *      conflict (deviation + moved repo) is one warning of the route.
 *  [2] A PUT that takes a base id out of the old working copy: 422 `grundgegenstand-nicht-loeschbar` (also with
 *      `?bestaetigt=1`), file byte-equal; a non-base id still needs the confirmation (409); a PUT writes only deviations
 *      (the hash stays valid); an invalid or locked-field copy can be healed by a PUT without it or by the reset.
 *  [3] `POST /api/gegenstaende/zuruecksetzen`: removes exactly that entry, the others keep content and order, 2-space
 *      indentation; `grundErsetzt` of the new file; idempotent; 400 for a body that is no `{id: string}`, 422 for a string that is
 *      no base id; refusals (no `If-Match`, stale hash, unreadable file, discarded entries, wrong method) leave the file byte-equal.
 *  [4] The receipt answer carries `grundErsetzt` (from the watch's `ersetzt`).
 *
 * Run: npx tsx admin/test/gd2-grundstand-route.ts   (from the repo root)
 */
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRUNDBESTAND, GRUNDBESTAND_IDS, leseGegenstandsDatei, schreibeGegenstandsDatei, setzeGrundbestand, type GegenstandsEintrag } from '@wov/shared/src/items/gegenstandsDaten.js';
import { gegenstandsArbeitsDatei, gegenstandsBasisLesen, gegenstandsBasisStand, gegenstandsRepoDatei } from '@wov/shared/src/items/gegenstandsArbeitskopie.js';
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

const warnungen: string[] = [];
const echteWarnung = console.warn;
console.warn = (...teile: unknown[]): void => {
  warnungen.push(teile.join(' '));
};
const umgekehrt = (e: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(e).reverse());

try {
  console.log('\n[1] Reconciliation before reading and saving (the file holds deviations only)');
  {
    const leer = dokument([]);
    zustand(leer, sha(leer)); // the DEV state: `[]` and a basis equal to it
    const g = await get();
    check('1 DEV state: GET returns no entries, the file is NOT touched (byte-equal), no back-up', g.status === 200 && (g.daten.eintraege as unknown[]).length === 0 && readFileSync(ARBEIT, 'utf-8') === leer && g.daten.hash === sha(leer) && !readdirSync(ARBEITSORDNER).some((n) => n.endsWith('.bak')), `${g.status}`);
    check('1 ... the basis is the repo hash now, grundErsetzt []', gegenstandsBasisLesen(ARBEIT) === sha(REPO_ECHT) && (g.daten.grundErsetzt as unknown[]).length === 0);
  }
  {
    // an old hash-only basis that already equals the repo hash: GET migrates it to the full copy
    zustand(dokument([holzaxt]), sha(REPO_ECHT));
    await get();
    check('1 an old hash-only basis equal to the repo hash is replaced by the full repo copy on GET', gegenstandsBasisStand(ARBEIT)?.text === REPO_ECHT.toString());
  }
  {
    zustand(null, null);
    const g = await get();
    check('1 working copy missing: GET creates an EMPTY document (the base items follow the repo), basis = repo hash', g.status === 200 && readFileSync(ARBEIT, 'utf-8') === dokument([]) && (g.daten.eintraege as unknown[]).length === 0 && gegenstandsBasisLesen(ARBEIT) === sha(REPO_ECHT));
  }
  {
    // the 29 repo copies an older build left, plus an own item: GET takes the 29 out
    const alt = dokument([...rohe(), holzaxt]);
    zustand(alt, null);
    const g = await get();
    check('1 29 repo copies + Holzaxt: GET shows only the Holzaxt, the file is cleaned, the hash is the new file hash', g.status === 200 && (g.daten.eintraege as Array<{ id: string }>).map((e) => e.id).join() === 'Holzaxt' && g.daten.hash === sha(bytes()), `${(g.daten.eintraege as unknown[]).length}`);
    check('1 ... a back-up with the old bytes lies there; basis = repo hash', readdirSync(ARBEITSORDNER).filter((n) => n.endsWith('.bak')).some((n) => readFileSync(resolve(ARBEITSORDNER, n), 'utf-8') === alt) && gegenstandsBasisLesen(ARBEIT) === sha(REPO_ECHT));
    const stale = await put(dokument([holzaxt]), sha(alt));
    check('1 a PUT with the hash from BEFORE the clean-out is 412 (the first save never builds on the stale file)', stale.status === 412, `${stale.status}`);
  }
  {
    // GD1 hash basis + a repo change of a locked field (Wood.gewicht) AND AxeFlint.ernte at the same time: the history carries it
    const r0 = REPO_ECHT.toString('utf-8');
    const doc = JSON.parse(r0) as { version: number; gegenstaende: Array<Record<string, unknown>> };
    doc.gegenstaende.find((e) => e.id === 'Wood')!.gewicht = 9.5;
    doc.gegenstaende.find((e) => e.id === 'AxeFlint')!.ernte = { baum: 2 };
    const r1 = `${JSON.stringify(doc, null, 2)}\n`;
    const historie = resolve(dirname(REPO), 'gegenstaende-historie', `${sha(REPO_ECHT)}.json`);
    mkdirSync(dirname(historie), { recursive: true });
    writeFileSync(historie, REPO_ECHT);
    const holzEintrag = leseGegenstandsDatei(dokument([holzaxt])).eintraege[0]!;
    zustand(schreibeGegenstandsDatei([...leseGegenstandsDatei(r0).eintraege, holzEintrag]), sha(REPO_ECHT));
    writeFileSync(REPO, r1);
    warnungen.length = 0;
    // the route of the NEW build: the base stock baked in is R1
    setzeGrundbestand([]);
    setzeGrundbestand(leseGegenstandsDatei(r1).eintraege);
    let g: Awaited<ReturnType<typeof get>>;
    try {
      g = await get();
    } finally {
      setzeGrundbestand(GRUNDBESTAND);
    }
    check('1 hash basis R0 + repo R1 (Wood.gewicht and AxeFlint.ernte changed), history there: GET shows only the Holzaxt, grundErsetzt [] (AxeFlint follows the repo)', g.status === 200 && (g.daten.eintraege as Array<{ id: string }>).map((e) => e.id).join() === 'Holzaxt' && (g.daten.grundErsetzt as unknown[]).length === 0 && (g.daten.verworfen as unknown[]).length === 0, JSON.stringify(g.daten.eintraege).slice(0, 100));
    check('1 ... no conflict warning, the basis is the full copy of R1', warnungen.length === 0 && gegenstandsBasisStand(ARBEIT)?.text === r1, JSON.stringify(warnungen));
    writeFileSync(REPO, REPO_ECHT);
    rmSync(resolve(dirname(REPO), 'gegenstaende-historie'), { recursive: true, force: true });
  }
  {
    // the repo moved on while the copy deviates: a conflict, reported ONCE, the copy wins
    const eigen = dokument([mitWerten('AxeFlint', { ernte: { baum: 3 } }), holzaxt]);
    zustand(eigen, sha(REPO_ECHT));
    const neuerRepo = dokument(rohe().map((e) => (e.id === 'AxeFlint' ? { ...e, ernte: { baum: 2 } } : e)));
    writeFileSync(REPO, neuerRepo);
    warnungen.length = 0;
    const g = await get();
    check('1 conflict (AxeFlint overridden, repo moved): GET returns the working copy byte-equal, quelle arbeit', g.status === 200 && readFileSync(ARBEIT, 'utf-8') === eigen && g.daten.quelle === 'arbeit' && (g.daten.eintraege as Array<{ id: string }>).map((e) => e.id).join() === 'AxeFlint,Holzaxt');
    check('1 ... the route logs ONE warning naming the conflict and AxeFlint', warnungen.length === 1 && warnungen[0]!.includes('Konflikt') && warnungen[0]!.includes('AxeFlint'), JSON.stringify(warnungen));
    await get();
    await get();
    check('1 ... further reads do not repeat it (basis = repo now)', warnungen.length === 1 && gegenstandsBasisLesen(ARBEIT) === sha(neuerRepo), `${warnungen.length}`);
    writeFileSync(REPO, REPO_ECHT);
  }

  console.log('\n[2] Taking a base id out of the file');
  {
    // two base items are overridden on purpose
    const text = dokument([mitWerten('Wood', { ernte: { baum: 3 } }), mitWerten('Stone', { ernte: { fels: 3 } }), holzaxt]);
    zustand(text, sha(REPO_ECHT));
    const g0 = await get();
    const hash = String(g0.daten.hash);
    const vor = bytes();
    const ohneWood = dokument([mitWerten('Stone', { ernte: { fels: 3 } }), holzaxt]);
    const a = await put(ohneWood, hash);
    check('2 PUT without Wood (an override stood in the old file): 422 grundgegenstand-nicht-loeschbar, names Wood, file byte-equal', a.status === 422 && a.daten.fehler === 'grundgegenstand-nicht-loeschbar' && JSON.stringify(a.daten.grundgegenstaende) === '["Wood"]' && bytes().equals(vor), `${a.status} ${JSON.stringify(a.daten)}`);
    const b = await put(ohneWood, hash, '?bestaetigt=1');
    check('2 ... also with ?bestaetigt=1', b.status === 422 && b.daten.fehler === 'grundgegenstand-nicht-loeschbar' && bytes().equals(vor));
    const c = await put(dokument([holzaxt]), hash);
    check('2 two base ids out: both named', c.status === 422 && JSON.stringify([...(c.daten.grundgegenstaende as string[])].sort()) === '["Stone","Wood"]', JSON.stringify(c.daten.grundgegenstaende));
    const d = await put(dokument([mitWerten('Wood', { ernte: { baum: 3 } }), mitWerten('Stone', { ernte: { fels: 3 } }), holzaxt, { ...holzaxt, id: 'Eisenaxt', nameSchluessel: 'inhalt.gegenstand.Eisenaxt.name', texte: { 'inhalt.gegenstand.Eisenaxt.name': { de: 'Eisenaxt', en: 'Iron axe' } } }]), hash);
    check('2 the overrides kept and a new item added: 200, 4 entries written', d.status === 200 && d.daten.eintraege === 4, `${d.status} ${JSON.stringify(d.daten)}`);
    const h2 = String(d.daten.hash);
    const nurAxtWeg = await put(dokument([mitWerten('Wood', { ernte: { baum: 3 } }), mitWerten('Stone', { ernte: { fels: 3 } }), holzaxt]), h2);
    check('2 a non-base item out: still 409 (needs the confirmation), not 422', nurAxtWeg.status === 409 && nurAxtWeg.daten.fehler === 'brauchtBestaetigung' && JSON.stringify(nurAxtWeg.daten.entfernt) === '["Eisenaxt"]', JSON.stringify(nurAxtWeg.daten));
    const beides = await put(dokument([mitWerten('Stone', { ernte: { fels: 3 } }), holzaxt]), h2);
    check('2 base id AND other change: the 422 comes first', beides.status === 422 && beides.daten.fehler === 'grundgegenstand-nicht-loeschbar');
  }
  {
    // a PUT only writes deviations: base entries that equal the repo are left out (the hash the mask gets stays valid)
    zustand(dokument([holzaxt]), sha(REPO_ECHT));
    const g = await get();
    const a = await put(dokument([...rohe().map(umgekehrt), holzaxt]), String(g.daten.hash));
    check('2 a PUT with all 29 repo entries (reversed keys) + Holzaxt: 200, written is only the Holzaxt (eintraege 1)', a.status === 200 && a.daten.eintraege === 1 && (JSON.parse(readFileSync(ARBEIT, 'utf-8')) as { gegenstaende: Array<{ id: string }> }).gegenstaende.map((e) => e.id).join() === 'Holzaxt', `${a.status} ${JSON.stringify(a.daten)}`);
    const g2 = await get();
    check('2 ... the next GET has the SAME hash (nothing left to clean out, the mask is not made stale)', g2.daten.hash === a.daten.hash);
  }
  {
    // the old DEV state without base entries: saving without them is no removal
    zustand(dokument([holzaxt]), sha(REPO_ECHT));
    const g = await get();
    const a = await put(dokument([{ ...holzaxt, stapel: 3 }]), String(g.daten.hash));
    check('2 a working copy with no base entries: a PUT without them is 200 (nothing to remove)', a.status === 200, `${a.status} ${JSON.stringify(a.daten)}`);
  }
  {
    // an INVALID base copy can be healed: it is replaced in the game, so leaving it out is no deletion
    const kaputtWood = { ...rohe().find((e) => e.id === 'Wood')!, stapel: 'viel' };
    const text = dokument([kaputtWood, holzaxt]);
    zustand(text, sha(REPO_ECHT));
    const g = await get();
    check('2 invalid Wood copy: GET 200, nothing discarded, Wood named in grundErsetzt (the file is not lost)', g.status === 200 && (g.daten.verworfen as unknown[]).length === 0 && JSON.stringify(g.daten.grundErsetzt) === '["Wood"]' && (g.daten.eintraege as Array<{ id: string }>).map((e) => e.id).sort().join() === 'Holzaxt,Wood', JSON.stringify(g.daten.grundErsetzt));
    const heil = await put(dokument([holzaxt]), String(g.daten.hash));
    check('2 ... a PUT that leaves the invalid copy out is REFUSED: 422 grundkopie-nur-zuruecksetzen, file byte-equal (healing only by the reset)', heil.status === 422 && heil.daten.fehler === 'grundkopie-nur-zuruecksetzen' && JSON.stringify(heil.daten.grundgegenstaende) === '["Wood"]' && readFileSync(ARBEIT, 'utf-8') === text, `${heil.status} ${JSON.stringify(heil.daten)}`);
    const heil1 = await put(dokument([holzaxt]), String(g.daten.hash), '?bestaetigt=1');
    check('2 ... also with ?bestaetigt=1', heil1.status === 422 && heil1.daten.fehler === 'grundkopie-nur-zuruecksetzen' && readFileSync(ARBEIT, 'utf-8') === text);
    const g2 = await get();
    const r = await zurueck('Wood', String(g2.daten.hash));
    check('2 ... the reset heals it: 200, Wood gone from the file, Holzaxt stays', r.status === 200 && r.daten.zurueckgesetzt === true && JSON.stringify(r.daten.grundErsetzt) === '[]' && (JSON.parse(readFileSync(ARBEIT, 'utf-8')) as { gegenstaende: Array<{ id: string }> }).gegenstaende.map((e) => e.id).join() === 'Holzaxt', `${r.status} ${JSON.stringify(r.daten)}`);
    // a copy that deviates in a locked field: its own ernte is IN EFFECT, a form that lacks it must not drop it
    const axt = mitWerten('AxeFlint', { stapel: 77, ernte: { baum: 5 } });
    const text2 = dokument([axt, holzaxt]);
    zustand(text2, sha(REPO_ECHT));
    const g3 = await get();
    const heil2 = await put(dokument([holzaxt]), String(g3.daten.hash));
    check('2 a replaced copy with its own ernte (baum 5, stack 77): a PUT without it is 422 grundkopie-nur-zuruecksetzen, the file is byte-equal (the harvest value is not lost)', heil2.status === 422 && heil2.daten.fehler === 'grundkopie-nur-zuruecksetzen' && readFileSync(ARBEIT, 'utf-8') === text2, `${heil2.status} ${JSON.stringify(heil2.daten)}`);
    const g4 = await get();
    check('2 ... the replaced copy still carries its harvest (baum 5) in what the mask reads', (g4.daten.eintraege as Array<{ id: string; ernte: { baum?: number } }>).find((e) => e.id === 'AxeFlint')?.ernte.baum === 5);
    // the mask sends the replaced copy along (it reads it from GET): that is NO omission, the PUT goes through and the ernte stays
    zustand(text2, sha(REPO_ECHT));
    const gm = await get();
    const maskeEintraege = (gm.daten.eintraege as GegenstandsEintrag[]).map((e) => (e.id === 'Holzaxt' ? { ...e, stapel: 3 } : e));
    const maskePut = await put(schreibeGegenstandsDatei(maskeEintraege), String(gm.daten.hash));
    check('2 a mask PUT that carries the replaced AxeFlint copy (as GET delivered it) is 200 (the mask is not locked out); the copy keeps its harvest (baum 5)', maskePut.status === 200 && (JSON.parse(readFileSync(ARBEIT, 'utf-8')) as { gegenstaende: Array<{ id: string; ernte?: { baum?: number } }> }).gegenstaende.find((e) => e.id === 'AxeFlint')?.ernte?.baum === 5, `${maskePut.status} ${JSON.stringify(maskePut.daten)}`);
    // BOTH kinds missing at once: the code is the one of the copy in effect, the answer names both lists
    zustand(dokument([mitWerten('PickaxeAntler', { ernte: { fels: 5 } }), mitWerten('Wood', { stapel: 77 }), holzaxt]), sha(REPO_ECHT));
    const gb = await get();
    const beides = await put(dokument([holzaxt]), String(gb.daten.hash));
    check('2 a copy in effect AND a replaced copy missing: 422 grundgegenstand-nicht-loeschbar naming PickaxeAntler, and the answer names the replaced Wood as well (grundkopien, message)', beides.status === 422 && beides.daten.fehler === 'grundgegenstand-nicht-loeschbar' && JSON.stringify(beides.daten.grundgegenstaende) === '["PickaxeAntler"]' && JSON.stringify(beides.daten.grundkopien) === '["Wood"]' && String(beides.daten.message).includes('Wood'), `${beides.status} ${JSON.stringify(beides.daten)}`);
    const nurKopie = await put(dokument([mitWerten('PickaxeAntler', { ernte: { fels: 5 } }), holzaxt]), String(gb.daten.hash));
    check('2 only the replaced copy missing: 422 grundkopie-nur-zuruecksetzen, grundkopien the same list', nurKopie.status === 422 && nurKopie.daten.fehler === 'grundkopie-nur-zuruecksetzen' && JSON.stringify(nurKopie.daten.grundkopien) === '["Wood"]' && JSON.stringify(nurKopie.daten.grundgegenstaende) === '["Wood"]', `${nurKopie.status} ${JSON.stringify(nurKopie.daten)}`);
    // a valid override (nothing replaced) keeps its own code
    zustand(dokument([mitWerten('AxeFlint', { ernte: { baum: 5 } }), holzaxt]), sha(REPO_ECHT));
    const g5 = await get();
    const hart = await put(dokument([holzaxt]), String(g5.daten.hash));
    check('2 a valid override left out keeps the code grundgegenstand-nicht-loeschbar', hart.status === 422 && hart.daten.fehler === 'grundgegenstand-nicht-loeschbar', `${hart.status} ${JSON.stringify(hart.daten)}`);
  }
  {
    // the real reason of an invalid base copy in a PUT
    zustand(dokument([holzaxt]), sha(REPO_ECHT));
    const g = await get();
    const hash = String(g.daten.hash);
    const vor = bytes();
    const kaputtWood = { ...rohe().find((e) => e.id === 'Wood')!, stapel: 'viel' };
    const a = await put(dokument([kaputtWood, holzaxt]), hash);
    const v = (a.daten.verworfen as Array<{ grund: string; id: string }> | undefined) ?? [];
    check('2 PUT with an INVALID Wood copy: 422 eintraege-verworfen with the REAL reason (zahl-ungueltig), not grundwert-gesperrt', a.status === 422 && a.daten.fehler === 'eintraege-verworfen' && v.length === 1 && v[0]!.id === 'Wood' && v[0]!.grund === 'zahl-ungueltig' && bytes().equals(vor), `${a.status} ${JSON.stringify(a.daten.verworfen)}`);
    const eigen = await put(dokument([{ ...holzaxt, stapel: 'viel' }]), hash);
    check('2 ... the same fault on an own item gives the same reason (zahl-ungueltig)', (eigen.daten.verworfen as Array<{ grund: string }>)[0]?.grund === 'zahl-ungueltig');
    const gesperrt = await put(dokument([mitWerten('Wood', { stapel: 77 }), holzaxt]), hash);
    check('2 a VALID copy with a locked field still says grundwert-gesperrt', (gesperrt.daten.verworfen as Array<{ grund: string }>)[0]?.grund === 'grundwert-gesperrt', JSON.stringify(gesperrt.daten.verworfen));
  }

  {
    // a duplicate id is NOT healed by the replacement: the file stays refused as a whole, as before
    const wood = mitWerten('Wood', { ernte: { baum: 3 } });
    zustand(dokument([wood, { ...wood }, holzaxt]), sha(REPO_ECHT));
    const g = await get();
    check('2 Wood twice (both valid): the second is discarded as id-doppelt, grundErsetzt []', (g.daten.verworfen as Array<{ grund: string }>).length === 1 && (g.daten.verworfen as Array<{ grund: string }>)[0]!.grund === 'id-doppelt' && (g.daten.grundErsetzt as unknown[]).length === 0, JSON.stringify(g.daten.verworfen));
    zustand(dokument([wood, { ...wood, stapel: 'viel' }, holzaxt]), sha(REPO_ECHT));
    const g2 = await get();
    check('2 Wood valid + Wood invalid: the invalid second one is discarded (not replaced next to the valid one)', (g2.daten.verworfen as unknown[]).length === 1 && (g2.daten.grundErsetzt as unknown[]).length === 0, JSON.stringify(g2.daten.verworfen));
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
    check('3 the others keep their content (Stone still deviates with stapel 66)', JSON.stringify(nachRoh.gegenstaende) === JSON.stringify([mitWerten('Stone', { stapel: 66 }), holzaxt]));
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
    // the written form: other entries keep their content and ORDER, the file is indented with two spaces (a compact file is re-formatted)
    const eintraege = [umgekehrt(mitWerten('Hammer', { ernte: { baum: 2 } })), mitWerten('Wood', { ernte: { baum: 3 } }), holzaxt];
    const kompakt = JSON.stringify({ gegenstaende: eintraege, version: 1 });
    zustand(kompakt, sha(REPO_ECHT));
    const g = await get();
    const r = await zurueck('Wood', String(g.daten.hash));
    const erwartet = `${JSON.stringify({ gegenstaende: [eintraege[0], eintraege[2]], version: 1 }, null, 2)}\n`;
    check('3 written form: 2-space indentation, trailing newline, the others in the same order with the same key order', r.status === 200 && readFileSync(ARBEIT, 'utf-8') === erwartet, readFileSync(ARBEIT, 'utf-8').slice(0, 80));
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
    check('3 refusal: id is no string: 400 anfrage-ungueltig', c.status === 400 && c.daten.fehler === 'anfrage-ungueltig' && gleich(), `${c.status}`);
    const d = await zurueck(null, hash, 'das ist kein json');
    check('3 refusal: body is no JSON: 400 anfrage-ungueltig', d.status === 400 && d.daten.fehler === 'anfrage-ungueltig' && gleich(), `${d.status}`);
    const e = await zurueck(null, hash, 'null');
    check('3 refusal: body null: 400 anfrage-ungueltig', e.status === 400 && e.daten.fehler === 'anfrage-ungueltig' && gleich(), `${e.status}`);
    const arr = await zurueck(null, hash, '["Wood"]');
    check('3 refusal: body is an array: 400 anfrage-ungueltig', arr.status === 400 && arr.daten.fehler === 'anfrage-ungueltig' && gleich(), `${arr.status}`);
    const fehlend = await zurueck(null, hash, '{}');
    check('3 refusal: no id at all: 400 anfrage-ungueltig', fehlend.status === 400 && fehlend.daten.fehler === 'anfrage-ungueltig' && gleich(), `${fehlend.status}`);
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
    check('3 refusal: a file with a discarded NON-base entry: 422 eintraege-verworfen with the list, file byte-equal (no quiet clean-up)', b.status === 422 && b.daten.fehler === 'eintraege-verworfen' && Array.isArray(b.daten.verworfen) && (b.daten.verworfen as unknown[]).length === 1 && readFileSync(ARBEIT, 'utf-8') === mitMuell, `${b.status} ${JSON.stringify(b.daten)}`);
  }

    console.log('\n[3b] The notes of the reconciliation reach the mask (N6)');
  {
    const keine = { ernteUnklar: [], basisKaputt: false, zeit: null };
    zustand(dokument([holzaxt]), sha(REPO_ECHT));
    const g0 = await get();
    check('3b no notes: GET carries hinweise {ernteUnklar [], basisKaputt false, zeit null}', JSON.stringify(g0.daten.hinweise) === JSON.stringify(keine), JSON.stringify(g0.daten.hinweise));
    // a copy that `main` saved after "the axe harvests nothing" (no ernte field), no basis file: unknown state
    const doc = JSON.parse(schreibeGegenstandsDatei([...leseGegenstandsDatei(REPO_ECHT.toString('utf-8'), { ohneGrundsperre: true }).eintraege, leseGegenstandsDatei(dokument([holzaxt])).eintraege[0]!])) as { version: number; gegenstaende: Array<Record<string, unknown>> };
    delete doc.gegenstaende.find((e) => e.id === 'AxeFlint')!.ernte;
    zustand(`${JSON.stringify(doc, null, 2)}\n`, null);
    const g = await get();
    const h = g.daten.hinweise as { ernteUnklar: string[]; basisKaputt: boolean; zeit: string | null };
    check('3b unknown state (no basis, AxeFlint without ernte): GET carries hinweise.ernteUnklar [AxeFlint] and a time', JSON.stringify(h.ernteUnklar) === '["AxeFlint"]' && h.basisKaputt === false && typeof h.zeit === 'string', JSON.stringify(h));
    const q = await anfrage('GET', '/api/gegenstaende/quittung');
    check('3b ... and the receipt answer carries the same notes (also with status "keine")', q.status === 200 && JSON.stringify(q.daten.hinweise) === JSON.stringify(h), JSON.stringify(q.daten.hinweise));
    writeFileSync(QUITTUNG, JSON.stringify({ status: 'angewendet', hash: 'x', zeit: 'jetzt' }));
    const q2 = await anfrage('GET', '/api/gegenstaende/quittung');
    check('3b ... with a receipt of the watch as well', JSON.stringify(q2.daten.hinweise) === JSON.stringify(h) && q2.daten.status === 'angewendet');
    writeFileSync(QUITTUNG, 'kaputt');
    const q3 = await anfrage('GET', '/api/gegenstaende/quittung');
    check('3b ... and with an unreadable receipt', q3.daten.status === 'unlesbar' && JSON.stringify(q3.daten.hinweise) === JSON.stringify(h));
    rmSync(QUITTUNG, { force: true });
    // an unreadable basis
    zustand(dokument([{ ...mitWerten('AxeFlint', { gewicht: 99 }), ernte: undefined }, holzaxt]), null);
    writeFileSync(resolve(ARBEITSORDNER, 'gegenstaende.basis'), REPO_ECHT.toString('utf-8').slice(0, 200));
    const k = await get();
    check('3b unreadable basis: hinweise.basisKaputt true', (k.daten.hinweise as { basisKaputt: boolean }).basisKaputt === true, JSON.stringify(k.daten.hinweise));
    // the next run under the lock (here a reset) finds the basis healthy and removes the notes
    const k1 = await get();
    check('3b a plain read after it still shows them (reads only check, they do not write)', (k1.daten.hinweise as { basisKaputt: boolean }).basisKaputt === true);
    const r = await zurueck('AxeFlint', String(k1.daten.hash));
    const k2 = await get();
    check('3b after the next run under the lock (a reset) the notes are gone', r.status === 200 && JSON.stringify(k2.daten.hinweise) === JSON.stringify(keine), `${r.status} ${JSON.stringify(k2.daten.hinweise)}`);
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
  console.warn = echteWarnung;
  server.close();
  rmSync(ORDNER, { recursive: true, force: true });
}
if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nalle Pruefungen bestanden');
process.exit(0);
