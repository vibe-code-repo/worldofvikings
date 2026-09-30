/**
 * Editor card EG2 N1: the flow around saving, DOM-free (`client/src/editor/gegenstaende/ablauf.ts`) and how the page
 * (`seite.ts`) uses it.
 * Editor-Karte EG2 N1: der Ablauf ums Speichern, DOM-frei, und seine Verdrahtung in der Seite.
 *
 *  [1] finding 3: the save button is locked while loading (and says "loading"), while saving, while a conflict
 *      waits, and while the form has errors; loading wins
 *  [2] finding 4: nothing from the dialog or the network layer escapes as an unhandled rejection; a throwing
 *      `frage` never leads to the confirmed PUT
 *  [3] finding 5: `pruefeKonflikt` for every case (server changed / removed / same, draft changed / not, new entry)
 *  [4] finding 5 end to end against an in-memory server with the route's `If-Match` rule: 412, reload, both choices
 *  [6] EG2 N2: removal builds list and hash from ONE snapshot; a foreign PUT and a reload in the dialog give 412
 *  [5] the wiring in `seite.ts` on the syntax tree: the conflict blocks saving, the load runs the check, every
 *      promise of a button goes through `sicher`, the removal asks about dependents BEFORE it sends
 *
 * Run: npx tsx test/editor-gegenstaende-ablauf.ts   (from client/, cwd as in scripts/kern/client.mjs)
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { leseGegenstandsDatei, schreibeGegenstandsDatei, type GegenstandsEintrag } from '@wov/shared/src/items/gegenstandsDaten.js';
import { entferneGegenstand, ladeGefangen, pruefeKonflikt, schnappschuss, speichereGefangen, speicherSperre, unterschiede } from '../src/editor/gegenstaende/ablauf';
import { ladeStand, speichernMitBestaetigung, speichere } from '../src/editor/gegenstaende/api';
import { eintragZuFormular, formularZuEintrag, mitEintrag, type Formular } from '../src/editor/gegenstaende/modell';

let fehler = 0;
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}
const gleich = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

let unbehandelt = 0;
process.on('unhandledRejection', () => {
  unbehandelt++;
});

function eintrag(id: string, de: string, extra: Record<string, unknown> = {}): GegenstandsEintrag {
  const roh = { id, nameSchluessel: `inhalt.gegenstand.${id}.name`, typ: 'material', texte: { [`inhalt.gegenstand.${id}.name`]: { de, en: de } }, ...extra };
  const l = leseGegenstandsDatei(JSON.stringify({ version: 1, gegenstaende: [roh] }));
  if (l.eintraege.length !== 1) throw new Error(`fixture refused: ${JSON.stringify(l.verworfen)}`);
  return l.eintraege[0];
}
const AXT = eintrag('Axt', 'Axt', { gewicht: 3 });
const FEDER = eintrag('Feder', 'Feder');

// ── [1] the save button ────────────────────────────────────────────────
console.log('\n[1] Speichern-Knopf (Befund 3):');
{
  const z = (o: Partial<{ laedt: boolean; speichert: boolean; konflikt: boolean; fehlerAnzahl: number }>) => speicherSperre({ laedt: false, speichert: false, konflikt: false, fehlerAnzahl: 0, ...o });
  check('nichts im Weg: nicht gesperrt', z({}) === null);
  check('waehrend des Ladens: gesperrt, Grund "laedt"', z({ laedt: true }) === 'laedt');
  check('waehrend des Speicherns: gesperrt', z({ speichert: true }) === 'speichert');
  check('waehrend ein Konflikt wartet: gesperrt', z({ konflikt: true }) === 'konflikt');
  check('mit Formularfehlern: gesperrt', z({ fehlerAnzahl: 2 }) === 'fehler');
  check('Laden geht vor allem anderen (der Knopf sagt "laedt")', z({ laedt: true, speichert: true, konflikt: true, fehlerAnzahl: 3 }) === 'laedt');
  check('Speichern geht vor Konflikt und Fehlern', z({ speichert: true, konflikt: true, fehlerAnzahl: 1 }) === 'speichert');
}

// ── [2] nothing escapes ────────────────────────────────────────────────
console.log('\n[2] Nichts entkommt als unbehandelte Ablehnung (Befund 4):');
{
  const antwort409 = { ok: false, fehler: 'brauchtBestaetigung', brauchtBestaetigung: true, entfernt: ['Axt'], entferntOhneId: [], hash: 'a'.repeat(64) };
  let aufrufe = 0;
  const fetcher = async (): Promise<Response> => {
    aufrufe++;
    return new Response(JSON.stringify(antwort409), { status: 409 });
  };
  const wirft = async (): Promise<boolean> => {
    throw new Error('Dialog kaputt');
  };
  // the raw call rejects: this is the hole of the old page
  aufrufe = 0;
  let roh = 'kein Fehler';
  try {
    await speichernMitBestaetigung({ fetcher }, [], 'b'.repeat(64), wirft);
  } catch {
    roh = 'wirft';
  }
  check('ohne Fang wirft speichernMitBestaetigung, wenn `frage` wirft (die Probe beisst)', roh === 'wirft');
  aufrufe = 0;
  const erg = await speichereGefangen({ fetcher }, [], 'b'.repeat(64), wirft);
  check('speichereGefangen: `frage` wirft -> Ergebnis "ausnahme", keine Ablehnung', erg.art === 'ausnahme', JSON.stringify(erg));
  check('ein Wurf in `frage` ist keine Antwort: es ging NUR der erste PUT raus, kein bestaetigter', aufrufe === 1, String(aufrufe));
  aufrufe = 0;
  const nein = await speichereGefangen({ fetcher }, [], 'b'.repeat(64), async () => false);
  check('Antwort "nein" bleibt "abgebrochen" (kein zweiter PUT)', nein.art === 'abgebrochen' && aufrufe === 1);
  // a throw below the client: `kopf` is read outside its own try
  const boese = { get kopf(): Record<string, string> { throw new Error('kopf kaputt'); } };
  const s = await speichereGefangen(boese, [], 'c'.repeat(64), async () => true);
  check('speichereGefangen: Wurf unterhalb des Clients -> "ausnahme"', s.art === 'ausnahme');
  const l = await ladeGefangen(boese);
  check('ladeGefangen: Wurf unterhalb des Clients -> "ausnahme"', l.art === 'ausnahme');
  let lRoh = 'kein Fehler';
  try {
    await ladeStand(boese);
  } catch {
    lRoh = 'wirft';
  }
  check('ohne Fang wirft ladeStand dort (die Probe beisst)', lRoh === 'wirft');
  const netz = await ladeGefangen({ fetcher: async () => { throw new Error('offline'); } });
  check('Netzfehler bleibt "netz" (der Client faengt ihn selbst)', netz.art === 'netz');
  await new Promise((r) => setTimeout(r, 20));
  check('keine unbehandelte Ablehnung im ganzen Abschnitt', unbehandelt === 0, String(unbehandelt));
}

// ── [3] conflict check ─────────────────────────────────────────────────
console.log('\n[3] Konfliktpruefung (Befund 5):');
{
  const axtServer = eintrag('Axt', 'Axt vom Server', { gewicht: 3 });
  const form = (e: GegenstandsEintrag): Formular => eintragZuFormular(e);
  const eigen = (e: GegenstandsEintrag, aend: (f: Formular) => void): Formular => {
    const f = form(e);
    aend(f);
    return f;
  };
  // server did not touch this entry, only another one
  {
    const k = pruefeKonflikt({ basis: AXT, form: eigen(AXT, (f) => (f.nameDe = 'Meine Axt')), ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [AXT, FEDER] });
    check('Server hat nur einen ANDEREN Eintrag geaendert: kein Konflikt', k.art === 'keiner');
  }
  // server changed THIS entry, the draft changed too
  {
    const k = pruefeKonflikt({ basis: AXT, form: eigen(AXT, (f) => (f.nameDe = 'Meine Axt')), ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [axtServer] });
    check('Server hat DIESEN Eintrag geaendert und der Entwurf auch: Konflikt', k.art === 'konflikt');
    if (k.art === 'konflikt') {
      const u = k.unterschiede.find((x) => x.feld === 'nameDe');
      check('der Konflikt nennt das Feld mit BEIDEN Fassungen (eigene und Server)', u !== undefined && u.eigen === 'Meine Axt' && u.server === 'Axt vom Server', JSON.stringify(k.unterschiede));
      check('und nur die Felder, in denen beide sich unterscheiden (der Server aenderte den Namen in beiden Sprachen, das Gewicht blieb gleich)', k.unterschiede.every((x) => x.eigen !== x.server) && gleich(k.unterschiede.map((x) => x.feld), ['nameDe', 'nameEn']), JSON.stringify(k.unterschiede));
      check('die Server-Fassung steht bereit', k.server !== null && k.server.texte['inhalt.gegenstand.Axt.name'].de === 'Axt vom Server');
    }
  }
  // server changed, the draft did not: nothing to lose
  {
    const k = pruefeKonflikt({ basis: AXT, form: form(AXT), ausgewaehlt: 'Axt', entwurfGeaendert: false, neuerStand: [axtServer] });
    check('Server hat geaendert, der Entwurf ist unberuehrt: Server-Fassung uebernehmen, nichts geht verloren', k.art === 'uebernehmen' && k.server !== null && k.server.gewicht === 3);
  }
  // draft equals the server's version
  {
    const k = pruefeKonflikt({ basis: AXT, form: form(axtServer), ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [axtServer] });
    check('Entwurf = Server-Fassung (beide gleich geaendert): uebernehmen, kein Streit', k.art === 'uebernehmen');
  }
  // server removed the entry
  {
    const k = pruefeKonflikt({ basis: AXT, form: eigen(AXT, (f) => (f.nameDe = 'Meine Axt')), ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [FEDER] });
    check('Server hat den Eintrag ENTFERNT, der Entwurf ist geaendert: Konflikt mit Server = null', k.art === 'konflikt' && k.server === null);
    const k2 = pruefeKonflikt({ basis: AXT, form: form(AXT), ausgewaehlt: 'Axt', entwurfGeaendert: false, neuerStand: [FEDER] });
    check('entfernt, Entwurf unberuehrt: uebernehmen (der Eintrag verschwindet aus der Maske)', k2.art === 'uebernehmen' && k2.server === null);
  }
  // new entries
  {
    const neu = eigen(AXT, (f) => {
      f.neu = true;
      f.nameSchluessel = null;
      f.beschreibungSchluessel = null;
      f.id = 'Speer';
      f.nameDe = 'Speer';
      f.nameEn = 'Spear';
    });
    check('neuer Eintrag, die id ist frei: kein Konflikt', pruefeKonflikt({ basis: null, form: neu, ausgewaehlt: null, entwurfGeaendert: true, neuerStand: [AXT, FEDER] }).art === 'keiner');
    const speerServer = eintrag('Speer', 'Server-Speer');
    const k = pruefeKonflikt({ basis: null, form: neu, ausgewaehlt: null, entwurfGeaendert: true, neuerStand: [AXT, speerServer] });
    check('neuer Eintrag, jemand hat dieselbe id inzwischen angelegt: Konflikt', k.art === 'konflikt' && k.server !== null && k.unterschiede.some((x) => x.feld === 'nameDe'));
    neu.id = 'x';
    check('neuer Eintrag mit ungueltiger id: kein Konflikt (die Maske meldet die id selbst)', pruefeKonflikt({ basis: null, form: neu, ausgewaehlt: null, entwurfGeaendert: true, neuerStand: [AXT] }).art === 'keiner');
  }
  // fields
  {
    const a = eigen(AXT, (f) => {
      f.gewicht = '9';
      f.werte.damage = '5';
      f.haltePosition = ['1', '2', '3'];
      f.hatRezept = true;
      f.rezeptMenge = '2';
      f.zutaten = [{ item: 'Wood', menge: '4' }];
    });
    const u = unterschiede(a, form(AXT));
    check('unterschiede: Gewicht, Schaden, Halteposition, Rezept, mit beiden Werten, in Formularreihenfolge', gleich(u.map((x) => x.feld), ['haltePosition', 'gewicht', 'wert.damage', 'rezept']) && u.find((x) => x.feld === 'rezept')?.eigen === '2: 4 Wood' && u.find((x) => x.feld === 'gewicht')?.server === '3', JSON.stringify(u));
    check('unterschiede: zwei gleiche Formulare haben keine', unterschiede(form(AXT), form(AXT)).length === 0);
  }
}

// ── [4] end to end against an in-memory server ─────────────────────────
console.log('\n[4] 412 -> Neu laden -> Wahl, gegen einen Server mit der If-Match-Regel:');
{
  const hashVon = (t: string): string => createHash('sha256').update(t).digest('hex');
  const bau = (start: GegenstandsEintrag[]) => {
    const z = { text: schreibeGegenstandsDatei(start), puts: 0 };
    const fetcher = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const h = new Headers(init?.headers);
      if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ ok: true, text: z.text, hash: hashVon(z.text), quelle: 'arbeit' }), { status: 200 });
      z.puts++;
      const basis = (h.get('If-Match') ?? '').replaceAll('"', '');
      if (basis !== hashVon(z.text)) return new Response(JSON.stringify({ ok: false, fehler: 'veraltet', hash: hashVon(z.text) }), { status: 412 });
      z.text = String(init?.body);
      return new Response(JSON.stringify({ ok: true, hash: hashVon(z.text), eintraege: leseGegenstandsDatei(z.text).eintraege.length, entfernt: [], entferntOhneId: [] }), { status: 200 });
    };
    return { z, o: { fetcher } as const };
  };
  const { z, o } = bau([AXT, FEDER]);
  const laden1 = await ladeStand(o);
  if (laden1.art !== 'ok') throw new Error('load failed');
  const basis = laden1.stand.eintraege.find((e) => e.id === 'Axt') ?? null;
  const meinForm = eintragZuFormular(AXT);
  meinForm.nameDe = 'Meine Axt';
  const meinEintrag = formularZuEintrag(meinForm);

  // the other author changes Axt AND Feder on the server
  z.text = schreibeGegenstandsDatei([eintrag('Axt', 'Axt vom Server', { gewicht: 3 }), eintrag('Feder', 'Feder neu')]);
  const versuch = await speichere(o, mitEintrag(laden1.stand.eintraege, 'Axt', meinEintrag), laden1.stand.hash);
  check('Speichern mit dem alten Hash: 412 (veraltet), nichts geschrieben', versuch.art === 'veraltet' && leseGegenstandsDatei(z.text).eintraege.find((e) => e.id === 'Axt')?.texte['inhalt.gegenstand.Axt.name'].de === 'Axt vom Server');

  const laden2 = await ladeStand(o);
  if (laden2.art !== 'ok') throw new Error('reload failed');
  const k = pruefeKonflikt({ basis, form: meinForm, ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: laden2.stand.eintraege });
  check('nach dem Neuladen erkennt die Pruefung: DIESER Eintrag wurde auf dem Server geaendert', k.art === 'konflikt');
  if (k.art !== 'konflikt') throw new Error('no conflict');

  // choice A: keep mine -> save with the NEW hash; the other author's Feder change stays
  const a = await speichere(o, mitEintrag(laden2.stand.eintraege, 'Axt', meinEintrag), laden2.stand.hash);
  const nachA = leseGegenstandsDatei(z.text).eintraege;
  check('eigene behalten + Speichern mit neuem Hash: die eigene Fassung steht auf dem Server', a.art === 'ok' && nachA.find((e) => e.id === 'Axt')?.texte['inhalt.gegenstand.Axt.name'].de === 'Meine Axt');
  check('... und die Aenderung am ANDEREN Eintrag (Feder neu) ist erhalten', nachA.find((e) => e.id === 'Feder')?.texte['inhalt.gegenstand.Feder.name'].de === 'Feder neu');

  // choice B: take the server's version -> the form equals the server's entry, nothing is sent
  const putsVorher = z.puts;
  const serverForm = k.server ? eintragZuFormular(k.server) : null;
  check('Server-Fassung uebernehmen: das Formular entspricht dem Server-Eintrag, es wird nichts gesendet', serverForm !== null && serverForm.nameDe === 'Axt vom Server' && z.puts === putsVorher);
  // no silent overwrite in either direction: before the choice nothing was written by the reload itself
  check('das Neuladen selbst schrieb nichts (nur der eine gezielte PUT)', putsVorher === 2, String(putsVorher));
}

// ── [6] EG2 N2 finding 2: list and hash are ONE snapshot ─────────────
console.log('\n[6] Entfernen: Liste und Hash aus einem Schnappschuss, Neuladen waehrend des Dialogs (EG2 N2, Befund 2):');
{
  const hashVon = (t: string): string => createHash('sha256').update(t).digest('hex');
  const bau = (start: GegenstandsEintrag[]) => {
    const z = { text: schreibeGegenstandsDatei(start), puts: 0, hashes: [] as string[] };
    const fetcher = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const h = new Headers(init?.headers);
      if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ ok: true, text: z.text, hash: hashVon(z.text), quelle: 'arbeit' }), { status: 200 });
      z.puts++;
      const basis = (h.get('If-Match') ?? '').replaceAll('"', '');
      z.hashes.push(basis);
      if (basis !== hashVon(z.text)) return new Response(JSON.stringify({ ok: false, fehler: 'veraltet', hash: hashVon(z.text) }), { status: 412 });
      z.text = String(init?.body);
      return new Response(JSON.stringify({ ok: true, hash: hashVon(z.text), eintraege: leseGegenstandsDatei(z.text).eintraege.length, entfernt: [], entferntOhneId: [] }), { status: 200 });
    };
    return { z, o: { fetcher } as const };
  };
  const BB: GegenstandsEintrag = { ...eintrag('Bb', 'Bb'), rezept: { menge: 1, zutaten: [{ item: 'Axt', menge: 1 }] } };
  const ja = async (): Promise<boolean> => true;
  const laden = async (o: ReturnType<typeof bau>['o']) => {
    const l = await ladeStand(o);
    if (l.art !== 'ok') throw new Error('load failed');
    return l.stand;
  };

  // the attack of the night: a foreign PUT and a reload while the dependents dialog is open
  {
    const { z, o } = bau([AXT, BB, FEDER]);
    let aktuell = await laden(o);
    const alterHash = aktuell.hash;
    const fremd = schreibeGegenstandsDatei([AXT, BB, eintrag('Feder', 'Feder', { gewicht: 9 })]);
    const erg = await entferneGegenstand(o, () => aktuell, 'Axt', async () => {
      z.text = fremd; // another author saves
      aktuell = await laden(o); // and this page reloads (the hash of `aktuell` is now the new one)
      return true;
    }, ja);
    check('fremder PUT + Neuladen waehrend des Dialogs: 412 (veraltet), kein 200 mit alter Liste', erg.art === 'veraltet', JSON.stringify(erg));
    check('es ging genau ein PUT raus, mit dem Hash des Stands, aus dem die Liste gebaut wurde', z.puts === 1 && z.hashes[0] === alterHash && z.hashes[0] !== aktuell.hash, z.hashes.join());
    check('die fremde Aenderung steht bytegleich in der Datei', z.text === fremd);
    check('... und der Stand der Seite ist der neue (Neu-laden-Weg fuer den Nutzer: die Seite laedt nach 412)', aktuell.hash === hashVon(fremd));
  }
  // without the reload, only the foreign PUT
  {
    const { z, o } = bau([AXT, BB, FEDER]);
    const s0 = await laden(o);
    const fremd = schreibeGegenstandsDatei([AXT, BB, eintrag('Feder', 'Feder', { gewicht: 9 })]);
    const erg = await entferneGegenstand(o, () => s0, 'Axt', async () => { z.text = fremd; return true; }, ja);
    check('nur ein fremder PUT im Dialog: 412, Datei bytegleich', erg.art === 'veraltet' && z.text === fremd);
  }
  // controls: nothing in between -> it is removed, with its dependents
  {
    const { z, o } = bau([AXT, BB, FEDER]);
    const s0 = await laden(o);
    const erg = await entferneGegenstand(o, () => s0, 'Axt', ja, ja);
    check('Kontrolle: nichts dazwischen, Dialog ja: Axt und Bb sind weg, Feder bleibt', erg.art === 'ok' && gleich(leseGegenstandsDatei(z.text).eintraege.map((e) => e.id), ['Feder']));
  }
  {
    const { z, o } = bau([AXT, FEDER]);
    const s0 = await laden(o);
    const erg = await entferneGegenstand(o, () => s0, 'Feder', async () => { throw new Error('kein Dialog erwartet'); }, ja);
    check('Kontrolle: ohne Abhaengige kein Dialog, Hash aus dem Stand, Erfolg', erg.art === 'ok' && z.hashes[0] === s0.hash && gleich(leseGegenstandsDatei(z.text).eintraege.map((e) => e.id), ['Axt']));
  }
  {
    const { z, o } = bau([AXT, BB, FEDER]);
    const s0 = await laden(o);
    const vorher = z.text;
    const nein = await entferneGegenstand(o, () => s0, 'Axt', async () => false, ja);
    check('Dialog "nein": nichts gesendet, Datei unberuehrt', nein.art === 'dialog-nein' && z.puts === 0 && z.text === vorher);
    const wirft = await entferneGegenstand(o, () => s0, 'Axt', async () => { throw new Error('Dialog kaputt'); }, ja);
    check('Dialog wirft: ausnahme, nichts gesendet', wirft.art === 'ausnahme' && z.puts === 0 && z.text === vorher);
    const leer = await entferneGegenstand(o, () => null, 'Axt', ja, ja);
    check('ohne Stand: ausnahme, nichts gesendet', leer.art === 'ausnahme' && z.puts === 0);
  }
  // the snapshot itself is frozen: a list that changes later does not change what was taken
  {
    const liste = [AXT, FEDER];
    const stand = { eintraege: liste, hash: 'a'.repeat(64) };
    const s = schnappschuss(stand);
    liste.push(BB);
    stand.hash = 'b'.repeat(64);
    check('Schnappschuss: spaetere Aenderung an Liste und Hash aendert ihn nicht und er ist eingefroren', s.eintraege.length === 2 && s.hash === 'a'.repeat(64) && Object.isFrozen(s) && Object.isFrozen(s.eintraege));
  }
}

// ── [5] wiring in seite.ts ─────────────────────────────────────────────
console.log('\n[5] Verdrahtung in seite.ts (Syntaxbaum):');
{
  const HIER = dirname(fileURLToPath(import.meta.url));
  const pfad = resolve(HIER, '../src/editor/gegenstaende/seite.ts');
  const sf = ts.createSourceFile(pfad, readFileSync(pfad, 'utf-8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const methoden = new Map<string, ts.MethodDeclaration>();
  const besuche = (n: ts.Node, f: (x: ts.Node) => void): void => {
    f(n);
    ts.forEachChild(n, (k) => besuche(k, f));
  };
  besuche(sf, (n) => {
    if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) methoden.set(n.name.text, n);
  });
  const rumpf = (name: string): string => methoden.get(name)?.getText(sf) ?? '';
  check('die Methoden sind da (Scanner ist nicht leer)', ['laden', 'senden', 'speichern', 'entfernen', 'aktualisiere', 'sicher'].every((m) => methoden.has(m)), [...methoden.keys()].join());
  check('senden(): die Sperre kommt aus speicherSperre (laedt, speichert, konflikt), bei gesperrt wird NICHT gesendet und eine uebersetzte Meldung gezeigt', /speicherSperre\(/.test(rumpf('senden')) && /this\.laedt/.test(rumpf('senden')) && /this\.speichert/.test(rumpf('senden')) && /this\.konflikt\s*!==\s*null/.test(rumpf('senden')) && /gesperrt_laedt/.test(rumpf('senden')) && /gesperrt_speichert/.test(rumpf('senden')) && /gesperrt_konflikt/.test(rumpf('senden')) && rumpf('senden').indexOf('gesperrt_konflikt') < rumpf('senden').indexOf('await lauf()'));
  check('senden(): sendet nur ueber den Schnappschuss-Ablauf (lauf), nie selbst mit this.stand.hash', /await lauf\(\)/.test(rumpf('senden')) && !/\.hash/.test(rumpf('senden')) && !/speichernMitBestaetigung\(|speichereGefangen\(/.test(rumpf('senden')));
  check('laden(): prueft den Entwurf gegen den neuen Stand (pruefeKonflikt) und benutzt den gefangenen Aufruf', /pruefeKonflikt\(/.test(rumpf('laden')) && /ladeGefangen\(/.test(rumpf('laden')));
  check('aktualisiere(): Sperre kommt aus speicherSperre, Beschriftung "laedt" wird gesetzt', /speicherSperre\(/.test(rumpf('aktualisiere')) && /speichern_laedt/.test(rumpf('aktualisiere')));
  check('laden(): sperrt den Knopf sofort (aktualisiere() vor dem ersten await)', rumpf('laden').indexOf('this.aktualisiere()') !== -1 && rumpf('laden').indexOf('this.aktualisiere()') < rumpf('laden').indexOf('await'));
  const ent = rumpf('entfernen');
  check('entfernen(): Liste und Hash kommen aus entferneGegenstand (ein Schnappschuss), die Seite baut keine eigene Liste und liest keinen Hash', /entferneGegenstand\(/.test(ent) && !/\.hash/.test(ent) && !/ohneEintrag\(|abhaengige\(/.test(ent) && /this\.senden\(/.test(ent));
  check('speichern(): Liste und Hash aus EINEM Schnappschuss (schnappschuss + speichereSchnappschuss), kein this.stand.hash', /schnappschuss\(this\.stand\)/.test(rumpf('speichern')) && /speichereSchnappschuss\(/.test(rumpf('speichern')) && !/\.hash/.test(rumpf('speichern')));
  check('seite.ts liest this.stand.hash nirgends (nur der Schnappschuss traegt den Hash)', !/this\.stand\??\.hash/.test(sf.getText()));
  check('Entfernen-Knopf: wird in aktualisiere() mit speicherSperre gesperrt wie Speichern', (rumpf('aktualisiere').match(/speicherSperre\(/g) ?? []).length === 2 && /entfernenKnopf/.test(rumpf('aktualisiere')) && /entfernenKnopf\s*=\s*knopf\(/.test(sf.getText()));
  const vielleicht: string[] = [];
  besuche(sf, (n) => {
    if (ts.isVoidExpression(n) && ts.isCallExpression(n.expression) && ts.isPropertyAccessExpression(n.expression.expression) && n.expression.expression.expression.kind === ts.SyntaxKind.ThisKeyword) vielleicht.push(n.expression.expression.name.text);
  });
  check('kein `void this.methode()`: jedes Versprechen laeuft ueber sicher()', vielleicht.length === 0, vielleicht.join());
  let sicherAufrufe = 0;
  besuche(sf, (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'sicher' && n.expression.expression.kind === ts.SyntaxKind.ThisKeyword) sicherAufrufe++;
  });
  check('sicher() wird von den Knoepfen und dem Laden benutzt (mindestens 5 Stellen)', sicherAufrufe >= 5, String(sicherAufrufe));
  check('sicher() faengt mit .catch und setzt die Sperren zurueck', /\.catch\(/.test(rumpf('sicher')) && /this\.laedt = false/.test(rumpf('sicher')) && /this\.speichert = false/.test(rumpf('sicher')));
}

console.log(fehler === 0 ? '\nalles gruen' : `\n${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
