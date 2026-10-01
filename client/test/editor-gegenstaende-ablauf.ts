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
 *      promise of a button goes through `sicher`, the removal asks about dependents BEFORE it sends; no read of a
 *      hash anywhere in seite.ts (N3: on the syntax tree, not a text pattern)
 *  [7] EG2 N3: a request that never answers is given up (time limit), buttons free, own message
 *  [8] EG2 N3: a failed reload keeps an open conflict decidable (banner with both choices)
 *  [9] EG2 N3 (N1 finding 4/5): three-way merge per field; a removed entry shows the draft's fields
 *
 * Run: npx tsx test/editor-gegenstaende-ablauf.ts   (from client/, cwd as in scripts/kern/client.mjs)
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { leseGegenstandsDatei, schreibeGegenstandsDatei, type GegenstandsEintrag } from '@wov/shared/src/items/gegenstandsDaten.js';
import type { Anzeigetext } from '../src/editor/gegenstaende/anzeige';
import { eigeneBehaltenAbgleich, entferneGegenstand, entscheideNachSpeichern, brauchtVorwarnung, hatVorwarnung, juengsteAntwort, kanonisch, kopiereFeld, ladeGefangen, ladefehlerBanner, pruefeKonflikt, schnappschuss, speichereGefangen, speichereSchnappschuss, speicherSperre, unterschiede, vorabFuer, vorwarnungVon } from '../src/editor/gegenstaende/ablauf';
import { ZEITGRENZE_MS, type Stand, ladeQuittung, ladeStand, speichernMitBestaetigung, speichere } from '../src/editor/gegenstaende/api';
import { eintragZuFormular, formularZuEintrag, mitEintrag, vereinheitlichung, type Formular } from '../src/editor/gegenstaende/modell';

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
      check('und nur das Feld, das BEIDE geaendert haben (N3: der Server aenderte auch nameEn, der Entwurf nicht: das geht ohne Frage in den Entwurf)', gleich(k.unterschiede.map((x) => x.feld), ['nameDe']) && gleich(k.uebernommen, ['nameEn']) && k.zusammen?.nameEn === 'Axt vom Server', JSON.stringify(k.unterschiede));
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
  /** True if the node reads something called `hash`: `x.hash`, `x['hash']`, `const { hash } = x`, `{ hash }` (EG2 N3: syntax tree, not a text pattern). */
  const liestHash = (n: ts.Node): boolean => {
    let gefunden = false;
    besuche(n, (k) => {
      if (ts.isPropertyAccessExpression(k) && k.name.text === 'hash') gefunden = true;
      if (ts.isElementAccessExpression(k) && ts.isStringLiteralLike(k.argumentExpression) && k.argumentExpression.text === 'hash') gefunden = true;
      if (ts.isBindingElement(k) && ((k.propertyName !== undefined && ts.isIdentifier(k.propertyName) && k.propertyName.text === 'hash') || (k.propertyName === undefined && ts.isIdentifier(k.name) && k.name.text === 'hash'))) gefunden = true;
      if (ts.isShorthandPropertyAssignment(k) && k.name.text === 'hash') gefunden = true;
    });
    return gefunden;
  };
  const probeLiestHash = (code: string): boolean => liestHash(ts.createSourceFile('probe.ts', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS));
  check('der Hash-Scanner beisst: this.stand.hash, const { hash } = this.stand, x["hash"], { hash }, Umbenennung', probeLiestHash('const a = this.stand.hash;') && probeLiestHash('const { hash } = this.stand;') && probeLiestHash("const a = x['hash'];") && probeLiestHash('f({ hash });') && probeLiestHash('const { hash: h } = this.stand;') && probeLiestHash('const a = this.stand?.hash;'));
  check('... und laesst Namen ohne Lesung durch (hashVon, ein Kommentar, ein Text)', !probeLiestHash('const hashVon = 1; // .hash\nconst t = "x.hash";'));
  const hashFrei = (name: string): boolean => methoden.has(name) && !liestHash(methoden.get(name) as ts.Node);
  check('die Methoden sind da (Scanner ist nicht leer)', ['laden', 'senden', 'speichern', 'entfernen', 'aktualisiere', 'sicher'].every((m) => methoden.has(m)), [...methoden.keys()].join());
  check('senden(): die Sperre kommt aus speicherSperre (laedt, speichert, konflikt), bei gesperrt wird NICHT gesendet und eine uebersetzte Meldung gezeigt', /speicherSperre\(/.test(rumpf('senden')) && /this\.laedt/.test(rumpf('senden')) && /this\.speichert/.test(rumpf('senden')) && /this\.konflikt\s*!==\s*null/.test(rumpf('senden')) && /gesperrt_laedt/.test(rumpf('senden')) && /gesperrt_speichert/.test(rumpf('senden')) && /gesperrt_konflikt/.test(rumpf('senden')) && rumpf('senden').indexOf('gesperrt_konflikt') < rumpf('senden').indexOf('await lauf()'));
  check('senden(): sendet nur ueber den Schnappschuss-Ablauf (lauf), nie selbst mit this.stand.hash', /await lauf\(\)/.test(rumpf('senden')) && hashFrei('senden') && !/speichernMitBestaetigung\(|speichereGefangen\(/.test(rumpf('senden')));
  check('laden(): prueft den Entwurf gegen den neuen Stand (ueber pruefeNeuenStand, das pruefeKonflikt ruft) und benutzt den gefangenen Aufruf', /pruefeNeuenStand\(/.test(rumpf('laden')) && /pruefeKonflikt\(/.test(rumpf('pruefeNeuenStand')) && /ladeGefangen\(/.test(rumpf('laden')));
  check('N3: laden() baut bei einem Ladefehler das Banner mit ladefehlerBanner (der offene Konflikt bleibt entscheidbar) und gibt Wahlknoepfe aus', /ladefehlerBanner\(/.test(rumpf('laden')) && /wahlKnoepfe\(/.test(rumpf('laden')) && /konflikt:\s*this\.konflikt/.test(rumpf('laden')));
  check('N3: Netzergebnis mit Zeitgrenze zeigt den Text "zeit" (laden und senden)', /zugangText\(erg\.zeit === true \? 'zeit' : 'netz'\)/.test(rumpf('laden')) && /zugangText\(erg\.zeit === true \? 'zeit' : 'netz'\)/.test(rumpf('senden')));
  check('N3: laden() uebernimmt eine Zusammenfuehrung ohne Wahl (art "zusammen") und nennt die Felder', /k\.art === 'zusammen'/.test(rumpf('pruefeNeuenStand')) && /zusammengefuehrtText\(/.test(rumpf('pruefeNeuenStand')) && /eigeneBehaltenAbgleich\(/.test(rumpf('eigeneBehalten')));
  check('aktualisiere(): Sperre kommt aus speicherSperre, Beschriftung "laedt" wird gesetzt', /speicherSperre\(/.test(rumpf('aktualisiere')) && /speichern_laedt/.test(rumpf('aktualisiere')));
  check('laden(): sperrt den Knopf sofort (aktualisiere() vor dem ersten await)', rumpf('laden').indexOf('this.aktualisiere()') !== -1 && rumpf('laden').indexOf('this.aktualisiere()') < rumpf('laden').indexOf('await'));
  const ent = rumpf('entfernen');
  check('entfernen(): Liste und Hash kommen aus entferneGegenstand (ein Schnappschuss), die Seite baut keine eigene Liste und liest keinen Hash', /entferneGegenstand\(/.test(ent) && hashFrei('entfernen') && !/ohneEintrag\(|abhaengige\(/.test(ent) && /this\.senden\(/.test(ent));
  check('speichern(): Liste und Hash aus EINEM Schnappschuss (schnappschuss + speichereSchnappschuss), kein this.stand.hash', /schnappschuss\(this\.stand\)/.test(rumpf('speichern')) && /speichereSchnappschuss\(/.test(rumpf('speichern')) && hashFrei('speichern'));
  check('seite.ts liest nirgends einen Hash (am Syntaxbaum: kein .hash, kein ["hash"], kein { hash }; nur der Schnappschuss traegt ihn)', !liestHash(sf));
  check('Entfernen-Knopf: wird in aktualisiere() mit speicherSperre gesperrt wie Speichern', (rumpf('aktualisiere').match(/speicherSperre\(/g) ?? []).length === 2 && /entfernenKnopf/.test(rumpf('aktualisiere')) && /entfernenKnopf\s*=\s*knopfT\(/.test(sf.getText()));
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
  check('sicher() faengt mit .catch und gibt die Speichersperre frei (die Ladesperre nicht, EG2 N9 I4: dort gilt der Test unten)', /\.catch\(/.test(rumpf('sicher')) && /this\.speichert = false/.test(rumpf('sicher')));
}

// ── [7] time limit ─────────────────────────────────────────────────────
console.log('\n[7] Zeitgrenze (EG2 N3, N2-Angriff 1): eine Antwort, die nie kommt:');
{
  /** A watchdog: a missing time limit shows up as a red check, not as a test that hangs. */
  const binnen = <T>(p: Promise<T>): Promise<T | { art: 'haengt' }> => Promise.race([p, new Promise<{ art: 'haengt' }>((r) => setTimeout(() => r({ art: 'haengt' }), 3000))]);
  const nieAntwort = (): ((...a: unknown[]) => Promise<Response>) => () => new Promise<Response>(() => {});
  const t0 = Date.now();
  const l = await binnen(ladeStand({ fetcher: nieAntwort() as typeof fetch, zeitgrenzeMs: 60 }));
  check('Laden: ein Fetch, der nie antwortet, endet nach der Zeitgrenze als netz mit zeit', l.art === 'netz' && l.zeit === true && Date.now() - t0 < 2000, JSON.stringify(l));
  const p = await binnen(speichere({ fetcher: nieAntwort() as typeof fetch, zeitgrenzeMs: 60 }, [AXT], 'a'.repeat(64)));
  check('Speichern (PUT): dasselbe, netz mit zeit, kein Haenger', p.art === 'netz' && p.zeit === true, JSON.stringify(p));
  const q = await binnen(ladeQuittung({ fetcher: nieAntwort() as typeof fetch, zeitgrenzeMs: 60 }));
  check('Quittung: dasselbe', q.art === 'netz' && q.zeit === true);
  // the body of an answer that starts and never ends
  const haengtImText = async (): Promise<Response> => ({ status: 200, headers: new Headers(), text: () => new Promise<string>(() => {}) }) as unknown as Response;
  const b = await binnen(ladeStand({ fetcher: haengtImText as typeof fetch, zeitgrenzeMs: 60 }));
  check('auch ein Fetch, der antwortet, dessen Text aber nie fertig wird, wird abgebrochen', b.art === 'netz' && b.zeit === true, JSON.stringify(b));
  // a real fetch is aborted by the signal
  let abgebrochen = false;
  const hoertZu = ((_u: unknown, init?: RequestInit): Promise<Response> =>
    new Promise<Response>((_ok, nein) => init?.signal?.addEventListener('abort', () => {
      abgebrochen = true;
      nein(new Error('aborted'));
    }))) as typeof fetch;
  const h = await binnen(ladeStand({ fetcher: hoertZu, zeitgrenzeMs: 60 }));
  check('der Fetch bekommt ein AbortSignal und es feuert', h.art === 'netz' && h.zeit === true && abgebrochen);
  // a failed connection is not a time-out
  const aus = await binnen(ladeStand({ fetcher: (async () => { throw new Error('offline'); }) as typeof fetch, zeitgrenzeMs: 60 }));
  check('ein Verbindungsfehler bleibt "netz" und ist keine Zeitueberschreitung', aus.art === 'netz' && aus.zeit === false, JSON.stringify(aus));
  // a quick answer is untouched
  const gut = await binnen(ladeStand({ fetcher: (async () => new Response(JSON.stringify({ text: schreibeGegenstandsDatei([AXT]), hash: 'h'.repeat(64) }), { status: 200 })) as typeof fetch, zeitgrenzeMs: 60 }));
  check('eine rechtzeitige Antwort geht unveraendert durch', gut.art === 'ok' && gut.stand.eintraege.length === 1);
  // the sequence the page lives through: hung PUT, then the next call works (the lock is the page's try/finally; here: the next request is not blocked)
  let stand = 'haengt';
  const wechsel = ((): Promise<Response> => stand === 'haengt' ? new Promise<Response>(() => {}) : Promise.resolve(new Response(JSON.stringify({ ok: true, hash: 'n'.repeat(64), eintraege: 1, entfernt: [], entferntOhneId: [] }), { status: 200 }))) as typeof fetch;
  const erst = await binnen(speichereGefangen({ fetcher: wechsel, zeitgrenzeMs: 60 }, [AXT], 'a'.repeat(64), async () => true));
  stand = 'geht';
  const zweit = await binnen(speichereGefangen({ fetcher: wechsel, zeitgrenzeMs: 60 }, [AXT], 'a'.repeat(64), async () => true));
  check('nach dem haengenden PUT geht der naechste Versuch durch (kein dauerhafter Zustand)', erst.art === 'netz' && zweit.art === 'ok', `${erst.art} ${zweit.art}`);
  check('die Standardgrenze liegt zwischen 5 und 60 Sekunden', ZEITGRENZE_MS >= 5000 && ZEITGRENZE_MS <= 60000, String(ZEITGRENZE_MS));
}

// ── [8] a failed reload keeps the conflict decidable ───────────────────
console.log('\n[8] Ladefehler bei offenem Konflikt (EG2 N3, N2-Angriff 2):');
{
  const axtServer = eintrag('Axt', 'Axt vom Server', { gewicht: 3 });
  const meinForm = eintragZuFormular(AXT);
  meinForm.nameDe = 'Meine Axt';
  const k = pruefeKonflikt({ basis: AXT, form: meinForm, ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [axtServer] });
  if (k.art !== 'konflikt') throw new Error('no conflict');
  const mit = ladefehlerBanner({ fehlerText: 'FEHLERTEXT' as Anzeigetext, konflikt: k });
  check('offener Konflikt: das Banner zeigt den Fehler UND den Konflikt mit seinen Zeilen, und die Wahlknoepfe bleiben', mit.wahlknoepfe && mit.zeilen[0] === 'FEHLERTEXT' && mit.zeilen.length >= 3 && mit.zeilen.some((z) => z.includes('Meine Axt') && z.includes('Axt vom Server')), JSON.stringify(mit));
  const ohne = ladefehlerBanner({ fehlerText: 'FEHLERTEXT' as Anzeigetext, konflikt: null });
  check('ohne Konflikt: nur der Fehler, keine Wahlknoepfe', ohne.wahlknoepfe === false && gleich(ohne.zeilen, ['FEHLERTEXT']));
  // the end to end sequence of the page: conflict open -> reload fails -> the conflict value is still the same and "keep mine" still works
  const behalten = k.zusammen;
  check('der Konflikt bleibt unveraendert (Wahl "Eigene behalten" hat seinen Entwurf noch)', behalten !== null && behalten.nameDe === 'Meine Axt');
}

// ── [9] three-way merge ────────────────────────────────────────────────
console.log('\n[9] Drei-Wege-Abgleich je Feld (EG2 N3, N1-Angriff 4 und 5):');
{
  const basis = eintrag('Axt', 'Axt', { gewicht: 3 });
  const aend = (e: GegenstandsEintrag, f: (x: Formular) => void): GegenstandsEintrag => {
    const x = eintragZuFormular(e);
    f(x);
    return formularZuEintrag(x);
  };
  const eigenForm = (f: (x: Formular) => void): Formular => {
    const x = eintragZuFormular(basis);
    f(x);
    return x;
  };
  // 1. only the server changed a field -> the server's value is taken
  {
    const server = aend(basis, (x) => (x.gewicht = '7'));
    const k = pruefeKonflikt({ basis, form: eigenForm((x) => (x.nameDe = 'Meine Axt')), ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [server] });
    check('Feld nur auf dem Server geaendert (Gewicht), anderes Feld nur im Entwurf (Name): kein Konflikt, art "zusammen"', k.art === 'zusammen', k.art);
    if (k.art === 'zusammen') {
      check('... Server-Wert uebernommen (Gewicht 7), Entwurf behalten (Name), uebernommene Felder genannt', k.form.gewicht === '7' && k.form.nameDe === 'Meine Axt' && gleich(k.uebernommen, ['gewicht']), JSON.stringify(k.uebernommen));
      check('... und der gespeicherte Eintrag daraus hat Gewicht 7 UND den eigenen Namen (die Server-Aenderung geht beim Speichern nicht verloren)', formularZuEintrag(k.form).gewicht === 7 && formularZuEintrag(k.form).texte['inhalt.gegenstand.Axt.name'].de === 'Meine Axt');
    }
  }
  // 2. only the draft changed a field -> the draft's value stays (server changed something else, so there is a check at all)
  {
    const server = aend(basis, (x) => (x.itemLevel = '4'));
    const k = pruefeKonflikt({ basis, form: eigenForm((x) => (x.gewicht = '9')), ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [server] });
    check('Feld nur im Entwurf geaendert (Gewicht 9), Server aenderte ein anderes (Item-Level): art "zusammen", Entwurfswert bleibt', k.art === 'zusammen' && k.form.gewicht === '9' && k.form.itemLevel === '4' && gleich(k.uebernommen, ['itemLevel']), JSON.stringify(k));
  }
  // 3. both changed the same field -> conflict, only that field is listed
  {
    const server = aend(basis, (x) => {
      x.gewicht = '7';
      x.itemLevel = '4';
    });
    const k = pruefeKonflikt({ basis, form: eigenForm((x) => (x.gewicht = '9')), ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [server] });
    check('Feld auf beiden Seiten geaendert (Gewicht 9 gegen 7): Konflikt', k.art === 'konflikt', k.art);
    if (k.art === 'konflikt') {
      check('... NUR das Feld im Streit steht in der Liste, mit beiden Werten', gleich(k.unterschiede, [{ feld: 'gewicht', eigen: '9', server: '7' }]), JSON.stringify(k.unterschiede));
      check('... das andere Server-Feld (Item-Level 4) ist schon im Entwurf, der Streitwert bleibt der eigene (9) bis zur Wahl', k.zusammen?.itemLevel === '4' && k.zusammen?.gewicht === '9' && gleich(k.uebernommen, ['itemLevel']));
    }
  }
  // 3b. both changed the same field to the SAME value -> no dispute
  {
    const server = aend(basis, (x) => {
      x.gewicht = '9';
      x.itemLevel = '4';
    });
    const k = pruefeKonflikt({ basis, form: eigenForm((x) => (x.gewicht = '9')), ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [server] });
    check('beide aendern das Gewicht auf denselben Wert (9): kein Streit, nur Item-Level kommt vom Server', k.art === 'zusammen' && gleich(k.uebernommen, ['itemLevel']) && k.form.gewicht === '9', JSON.stringify(k));
  }
  // composite fields move as a whole
  {
    const server = aend(basis, (x) => {
      x.haltePosition = ['1', '2', '3'];
      x.werte.damage = '8';
      x.hatRezept = true;
      x.rezeptMenge = '2';
      x.zutaten = [{ item: 'Wood', menge: '4' }];
      x.upload = '';
    });
    const k = pruefeKonflikt({ basis, form: eigenForm((x) => (x.nameEn = 'My axe')), ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [server] });
    check('Halteposition, Schadenswert und Rezept (mehrteilige Felder) kommen als Ganzes vom Server', k.art === 'zusammen' && gleich(k.form.haltePosition, ['1', '2', '3']) && k.form.werte.damage === '8' && k.form.hatRezept && k.form.rezeptMenge === '2' && gleich(k.form.zutaten, [{ item: 'Wood', menge: '4' }]) && k.form.nameEn === 'My axe', JSON.stringify(k));
    if (k.art === 'zusammen') {
      const z = k.form.zutaten[0];
      z.menge = '99';
      check('... und das zusammengefuehrte Formular teilt keine Objekte mit dem Server-Eintrag (Zutat bearbeiten aendert den Server-Stand nicht)', server.rezept?.zutaten[0].menge === 4);
    }
    const f = eintragZuFormular(basis);
    kopiereFeld(f, eintragZuFormular(server), 'id');
    check('kopiereFeld fasst die id nie an', f.id === 'Axt');
  }
  // Both changed a different field AND the same one: the three states in one go
  {
    const server = aend(basis, (x) => {
      x.gewicht = '7';
      x.rarity = 'rare';
    });
    const k = pruefeKonflikt({ basis, form: eigenForm((x) => {
      x.gewicht = '9';
      x.symbol = 'axe';
    }), ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [server] });
    check('alle drei Faelle zugleich: Streit nur im Gewicht, Rarity vom Server, Symbol vom Entwurf', k.art === 'konflikt' && gleich(k.unterschiede.map((x) => x.feld), ['gewicht']) && k.zusammen?.rarity === 'rare' && k.zusammen?.symbol === 'axe' && gleich(k.uebernommen, ['rarity']), JSON.stringify(k));
  }
  // N1 finding 5: the entry is gone on the server
  {
    const form = eigenForm((x) => {
      x.nameDe = 'Meine Axt';
      x.gewicht = '9';
    });
    const k = pruefeKonflikt({ basis, form, ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [FEDER] });
    check('Server hat den Eintrag geloescht: Konflikt, Server null, und die Felder des Entwurfs stehen als Zeilen (id, Name, Gewicht ...)', k.art === 'konflikt' && k.server === null && k.zusammen === null && ['id', 'nameDe', 'nameEn', 'gewicht', 'typ', 'stapel'].every((f) => k.unterschiede.some((u) => u.feld === f)), k.art === 'konflikt' ? JSON.stringify(k.unterschiede.map((u) => u.feld)) : k.art);
    if (k.art === 'konflikt') {
      check('... mit dem Wert des Entwurfs je Zeile (Meine Axt, 9), leere Felder ausgelassen', k.unterschiede.find((u) => u.feld === 'nameDe')?.eigen === 'Meine Axt' && k.unterschiede.find((u) => u.feld === 'gewicht')?.eigen === '9' && !k.unterschiede.some((u) => u.eigen === ''));
    }
  }
}

// ── [10] N4: keep mine against the live form, after-save, text keys ───────
console.log('\n[10] N4: "Eigene behalten" gegen das lebende Formular, Nachladen nach dem Speichern, Textschluessel (Angriff N3, Befunde 1, 4, 5a):');
{
  const basis = eintrag('Axt', 'Axt', { gewicht: 3 });
  const aend = (e: GegenstandsEintrag, f: (x: Formular) => void): GegenstandsEintrag => {
    const x = eintragZuFormular(e);
    f(x);
    return formularZuEintrag(x);
  };
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

  // Befund 1: the conflict is on screen, the author edits the form, then presses "keep mine"
  {
    const server = aend(basis, (x) => (x.nameDe = 'Server-Axt'));
    const form = eintragZuFormular(basis);
    form.nameDe = 'Meine Axt';
    const k = pruefeKonflikt({ basis, form, ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [server] });
    if (k.art !== 'konflikt') throw new Error('no conflict');
    form.gewicht = '42'; // typed AFTER the conflict was shown; the form stays editable
    check('Vorbedingung: der alte Schnappschuss des Konflikts kennt die Eingabe nach der Anzeige nicht (zusammen.gewicht bleibt 3)', k.zusammen?.gewicht === '3');
    const r = eigeneBehaltenAbgleich({ basis, form, ausgewaehlt: 'Axt', konflikt: k });
    check('"Eigene behalten": die Eingabe nach der Konfliktanzeige (Gewicht 42) steht im Ergebnis, der eigene Name auch', r.art === 'weiter' && r.form.gewicht === '42' && r.form.nameDe === 'Meine Axt', JSON.stringify(r));
    check('... und es ist nicht der Schnappschuss von der Anzeige', r.art === 'weiter' && r.form !== k.zusammen);
    // the author settled the disputed field by typing the server's value: nothing left to ask
    const gleichgezogen = eintragZuFormular(basis);
    gleichgezogen.nameDe = 'Server-Axt';
    const r2 = eigeneBehaltenAbgleich({ basis, form: gleichgezogen, ausgewaehlt: 'Axt', konflikt: k });
    check('der Autor hat den Streit beigelegt (Server-Wert getippt): weiter, ohne neue Anzeige', r2.art === 'weiter' && r2.form.nameDe === 'Server-Axt', JSON.stringify(r2));
    // the author typed into a field the SERVER changed too: a new dispute they have not seen
    const server2 = aend(basis, (x) => {
      x.nameDe = 'Server-Axt';
      x.gewicht = '7';
    });
    const form2 = eintragZuFormular(basis);
    form2.nameDe = 'Meine Axt';
    const k2 = pruefeKonflikt({ basis, form: form2, ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [server2] });
    if (k2.art !== 'zusammen' && k2.art !== 'konflikt') throw new Error('unexpected');
    check('Vorbedingung: gezeigt wird nur der Streit um den Namen, das Gewicht kam vom Server', k2.art === 'konflikt' && gleich(k2.unterschiede.map((u) => u.feld), ['nameDe']) && gleich(k2.uebernommen, ['gewicht']));
    if (k2.art === 'konflikt') {
      form2.gewicht = '99'; // now both changed the weight, differently
      const r3 = eigeneBehaltenAbgleich({ basis, form: form2, ausgewaehlt: 'Axt', konflikt: k2 });
      check('Eingabe in einem Feld, das auch der Server aenderte: die Maske zeigt den Konflikt NEU (Gewicht jetzt streitig), entscheidet nicht still', r3.art === 'neu' && r3.konflikt.unterschiede.some((u) => u.feld === 'gewicht' && u.eigen === '99' && u.server === '7') && r3.konflikt.unterschiede.some((u) => u.feld === 'nameDe'), JSON.stringify(r3));
    }
    // the entry is gone on the server: keep the live form as a new entry
    const gone = pruefeKonflikt({ basis, form, ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [FEDER] });
    if (gone.art !== 'konflikt') throw new Error('no conflict');
    form.stapel = '5';
    const r4 = eigeneBehaltenAbgleich({ basis, form, ausgewaehlt: 'Axt', konflikt: gone });
    check('Eintrag auf dem Server entfernt: "eigene behalten" bleibt beim lebenden Formular (Stapel 5), server null', r4.art === 'weiter' && r4.server === null && r4.form === form && r4.form.stapel === '5');
    // a new entry (no base) whose id someone else made meanwhile
    const neuForm = eintragZuFormular(basis);
    neuForm.nameDe = 'Mein Neues';
    const k5 = pruefeKonflikt({ basis: null, form: neuForm, ausgewaehlt: null, entwurfGeaendert: true, neuerStand: [server] });
    if (k5.art !== 'konflikt') throw new Error('no conflict');
    neuForm.nameDe = 'Mein Neues 2'; // a field that was in dispute already
    const r5 = eigeneBehaltenAbgleich({ basis: null, form: neuForm, ausgewaehlt: null, konflikt: k5 });
    check('neuer Eintrag mit Id-Kollision: der Entwurf (geaenderter Name, schon im Streit) bleibt', r5.art === 'weiter' && r5.form.nameDe === 'Mein Neues 2', JSON.stringify(r5.art));
    neuForm.stapel = '9'; // a field nobody argued about before
    check('... ein Feld, das vorher nicht streitig war (Stapel 9), oeffnet den Konflikt neu', eigeneBehaltenAbgleich({ basis: null, form: neuForm, ausgewaehlt: null, konflikt: k5 }).art === 'neu');
    // wiring: the page runs the comparison again and does not take the copy made when the conflict was found
    const eb = methoden.get('eigeneBehalten');
    let liestKopie = false;
    let ruftAbgleich = false;
    if (eb) besuche(eb, (n) => {
      if (ts.isPropertyAccessExpression(n) && n.name.text === 'zusammen') liestKopie = true;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'eigeneBehaltenAbgleich') ruftAbgleich = true;
    });
    check('seite.ts: eigeneBehalten() ruft eigeneBehaltenAbgleich mit dem lebenden this.form und liest nirgends k.zusammen (die Kopie von der Anzeige)', eb !== undefined && ruftAbgleich && !liestKopie && /form:\s*this\.form/.test(eb.getText(sf)));
    check('seite.ts: bei "neu" wird der Konflikt erneut angezeigt (zeigeKonflikt) und nichts entschieden', eb !== undefined && /r\.art === 'neu'/.test(eb.getText(sf)) && /zeigeKonflikt\(/.test(eb.getText(sf)));
  }

  // Befund 4: after a save the form is replaced only if it is still what was saved
  {
    const f = eintragZuFormular(basis);
    const vor = kanonisch(f);
    const aus = (o: Partial<Parameters<typeof entscheideNachSpeichern>[0]>) => entscheideNachSpeichern({ formVorher: vor, idVorher: 'Axt', ausgewaehltVorher: 'Axt', formJetzt: f, ausgewaehltJetzt: 'Axt', gespeicherteId: 'Axt', server: basis, ...o });
    check('Formular unveraendert seit dem Start des Speicherns: ersetzen (alter Weg)', aus({}).art === 'ersetzen');
    const geaendert = eintragZuFormular(basis);
    geaendert.gewicht = '77';
    const r = aus({ formJetzt: geaendert });
    check('waehrend des Speicherns weitergetippt: der Entwurf bleibt, folgt dem gespeicherten Eintrag (Basis = Server-Eintrag), kein "neu"', r.art === 'behalten' && r.weiter !== null && r.weiter.ausgewaehlt === 'Axt' && r.weiter.basis === basis && r.weiter.neu === false, JSON.stringify(r));
    const andere = eintragZuFormular(FEDER);
    const r2 = aus({ formJetzt: andere, ausgewaehltJetzt: 'Feder' });
    check('waehrend des Speicherns einen anderen Eintrag geoeffnet: der bleibt offen, nichts an ihm wird geaendert', r2.art === 'behalten' && r2.weiter === null);
    const neu = eintragZuFormular(basis);
    neu.neu = true;
    const vorNeu = kanonisch(neu);
    const nachTippen = { ...neu, gewicht: '5' };
    const r3 = entscheideNachSpeichern({ formVorher: vorNeu, idVorher: 'Axt', ausgewaehltVorher: null, formJetzt: nachTippen, ausgewaehltJetzt: null, gespeicherteId: 'Axt', server: basis });
    check('neuer Eintrag gespeichert und weitergetippt: der Entwurf gehoert jetzt zum gespeicherten Eintrag (ausgewaehlt Axt, nicht mehr neu)', r3.art === 'behalten' && r3.weiter?.ausgewaehlt === 'Axt' && r3.weiter.neu === false && r3.weiter.basis === basis);
    const r4 = entscheideNachSpeichern({ formVorher: vor, idVorher: 'Axt', ausgewaehltVorher: 'Axt', formJetzt: geaendert, ausgewaehltJetzt: 'Axt', gespeicherteId: null, server: null });
    check('Entfernen und weitergetippt: der Entwurf bleibt als neuer Eintrag (ausgewaehlt null, neu, ohne Basis)', r4.art === 'behalten' && r4.weiter?.ausgewaehlt === null && r4.weiter.neu === true && r4.weiter.basis === null);
    check('Formular ist weg (null): nicht ersetzen', entscheideNachSpeichern({ formVorher: vor, idVorher: 'Axt', ausgewaehltVorher: 'Axt', formJetzt: null, ausgewaehltJetzt: null, gespeicherteId: 'Axt', server: basis }).art === 'behalten');
    // the canonical form does not depend on the order in which the fields were set
    const umgekehrt = Object.fromEntries(Object.entries(f).reverse()) as unknown as Formular;
    check('kanonisch: gleiche Felder in anderer Reihenfolge = gleiche Form; eine geaenderte Zahl = andere Form', kanonisch(umgekehrt) === vor && kanonisch(geaendert) !== vor);
    // wiring
    const ns = methoden.get('nachSpeichern');
    const sp = methoden.get('speichern');
    const en = methoden.get('entfernen');
    const setzeForms: Array<{ bedingung: string }> = [];
    if (ns) besuche(ns, (n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'setzeForm') {
        let p: ts.Node | undefined = n.parent;
        let bed = '';
        while (p && p !== ns) {
          if (ts.isIfStatement(p)) bed = p.expression.getText(sf);
          p = p.parent;
        }
        setzeForms.push({ bedingung: bed });
      }
    });
    check('seite.ts: nachSpeichern() ersetzt das Formular (setzeForm) nur im Zweig "ersetzen" von entscheideNachSpeichern', ns !== undefined && /entscheideNachSpeichern\(/.test(ns.getText(sf)) && setzeForms.length >= 1 && setzeForms.every((x) => /ersetzen/.test(x.bedingung)), JSON.stringify(setzeForms));
    check('seite.ts: speichern() und entfernen() merken die kanonische Form VOR dem Senden und geben sie an nachSpeichern', sp !== undefined && en !== undefined && /kanonisch\(this\.form\)/.test(sp.getText(sf)) && /kanonisch\(this\.form\)/.test(en.getText(sf)) && sp.getText(sf).indexOf('kanonisch(') < sp.getText(sf).indexOf('this.senden(') && en.getText(sf).indexOf('kanonisch(') < en.getText(sf).indexOf('this.senden(') && /nachSpeichern\([^)]*vorher[^)]*\)/.test(sp.getText(sf)) && /nachSpeichern\([^)]*vorher[^)]*\)/.test(en.getText(sf)));
    check('seite.ts: das Banner nach "behalten" sagt, dass ungespeicherte Aenderungen offen sind', ns !== undefined && /nach_speichern_offen/.test(ns.getText(sf)));
  }

  // Befund 5a: the text keys are fields of the three-way comparison
  {
    const mitKey = (name2: string) => ({ nameSchluessel: 'inhalt.gegenstand.Axt.name2', texte: { 'inhalt.gegenstand.Axt.name2': { de: name2, en: name2 } } });
    const server = eintrag('Axt', 'Axt', { gewicht: 3, ...mitKey('Axt') });
    check('Vorbedingung: der Server-Eintrag hat einen anderen nameSchluessel als die Basis', server.nameSchluessel !== basis.nameSchluessel);
    const form = eintragZuFormular(basis);
    form.nameEn = 'Meine Axt';
    const k = pruefeKonflikt({ basis, form, ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [server] });
    check('Server aendert nur den nameSchluessel, der Entwurf einen Namen: "zusammen", der Schluessel des Servers steht im Ergebnis und wird genannt', k.art === 'zusammen' && k.form.nameSchluessel === 'inhalt.gegenstand.Axt.name2' && k.uebernommen.includes('nameSchluessel') && k.form.nameEn === 'Meine Axt', JSON.stringify(k));
    if (k.art === 'zusammen') check('... und der Eintrag daraus traegt den neuen Schluessel (beim Speichern geht die Aenderung des Servers nicht verloren)', formularZuEintrag(k.form).nameSchluessel === 'inhalt.gegenstand.Axt.name2');
    const beide = eintragZuFormular(basis);
    beide.nameSchluessel = 'inhalt.gegenstand.Axt.name3';
    beide.nameEn = 'Meine Axt';
    const k2 = pruefeKonflikt({ basis, form: beide, ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [server] });
    check('Server und Entwurf aendern den Schluessel verschieden: Konflikt, genau die Zeile "nameSchluessel"', k2.art === 'konflikt' && gleich(k2.unterschiede.map((u) => u.feld), ['nameSchluessel']), JSON.stringify(k2));
    const bServer = eintrag('Axt', 'Axt', { gewicht: 3, beschreibungSchluessel: 'inhalt.gegenstand.Axt.beschreibung', texte: { 'inhalt.gegenstand.Axt.name': { de: 'Axt', en: 'Axt' }, 'inhalt.gegenstand.Axt.beschreibung': { de: 'b', en: 'b' } } });
    const bForm = eintragZuFormular(basis);
    bForm.nameEn = 'Meine Axt';
    const k3 = pruefeKonflikt({ basis, form: bForm, ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [bServer] });
    check('dasselbe fuer beschreibungSchluessel', k3.art === 'zusammen' && k3.form.beschreibungSchluessel === 'inhalt.gegenstand.Axt.beschreibung' && k3.uebernommen.includes('beschreibungSchluessel'), JSON.stringify(k3));
  }
  // N5 (Angriff N4, Befund 1): "keep mine" takes the author's value for every disputed field AND every field they changed
  // since the conflict was shown, also when the value typed is the starting value (a reset is an edit)
  {
    const server = aend(basis, (x) => {
      x.nameDe = 'Server';
      x.gewicht = '11';
      x.stapel = '9';
    });
    const form = eintragZuFormular(basis);
    form.nameDe = 'Mein';
    form.gewicht = '5';
    form.stapel = '9'; // the draft already agrees with the server here: no dispute, not shown
    const k = pruefeKonflikt({ basis, form, ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [server] });
    if (k.art !== 'konflikt') throw new Error('no conflict');
    check('Vorbedingung: gezeigt werden nameDe und gewicht, Stapel nicht (Entwurf = Server)', gleich(k.unterschiede.map((u) => u.feld), ['nameDe', 'gewicht']));
    const zurueck = (f: (x: Formular) => void) => {
      const x = structuredClone(form);
      f(x);
      return eigeneBehaltenAbgleich({ basis, form: x, ausgewaehlt: 'Axt', konflikt: k });
    };
    const r1 = zurueck((x) => (x.nameDe = 'Axt'));
    check('nameDe zurueck auf den Ausgangswert "Axt": "Eigene behalten" behaelt "Axt", nicht den Server-Wert', r1.art === 'weiter' && r1.form.nameDe === 'Axt', JSON.stringify(r1.art === 'weiter' ? r1.form.nameDe : r1));
    const r2 = zurueck((x) => (x.gewicht = '3'));
    check('gewicht zurueck auf den Ausgangswert 3: behaelt 3, nicht 11', r2.art === 'weiter' && r2.form.gewicht === '3' && r2.form.nameDe === 'Mein', JSON.stringify(r2.art === 'weiter' ? r2.form.gewicht : r2));
    const r3 = zurueck((x) => (x.stapel = '1'));
    check('ein Feld, das nicht gezeigt war und das der Autor seit der Anzeige auf den Ausgangswert zurueckgesetzt hat (Stapel 9 -> 1): behaelt 1', r3.art === 'weiter' && r3.form.stapel === '1', JSON.stringify(r3.art === 'weiter' ? r3.form.stapel : r3));
    const r4 = zurueck(() => undefined);
    check('nichts angefasst: der Streit wird wie bisher mit dem Entwurf entschieden (Mein, 5), das uebrige bleibt Drei-Wege (Stapel 9)', r4.art === 'weiter' && r4.form.nameDe === 'Mein' && r4.form.gewicht === '5' && r4.form.stapel === '9');
    check('die Kopie des Formulars von der Anzeige haengt nicht am lebenden Formular (spaetere Eingabe aendert sie nicht)', k.formBeiAnzeige.nameDe === 'Mein' && zurueck((x) => (x.nameDe = 'Axt')).art === 'weiter' && k.formBeiAnzeige.nameDe === 'Mein');
  }

  // N5 (Angriff N4, Befund 3): after a save with further typing the saved state is the base of the next comparison
  {
    const gespeichert = aend(basis, (x) => (x.gewicht = '4')); // what the save wrote
    const f = eintragZuFormular(basis);
    f.gewicht = '4';
    const vor = kanonisch(f);
    const weiterGetippt = structuredClone(f);
    weiterGetippt.stapel = '6';
    const w = entscheideNachSpeichern({ formVorher: vor, idVorher: 'Axt', ausgewaehltVorher: 'Axt', formJetzt: weiterGetippt, ausgewaehltJetzt: 'Axt', gespeicherteId: 'Axt', server: gespeichert });
    if (w.art !== 'behalten' || w.weiter === null) throw new Error('unexpected');
    const spaeter = aend(gespeichert, (x) => (x.gewicht = '3')); // another author sets the weight back
    const mitNeuerBasis = pruefeKonflikt({ basis: w.weiter.basis, form: weiterGetippt, ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [spaeter] });
    const mitAlterBasis = pruefeKonflikt({ basis, form: weiterGetippt, ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [spaeter] });
    check('mit dem gespeicherten Stand als Basis: der Server hat das Gewicht geaendert, der Autor nicht seit dem Speichern: das Gewicht des Servers (3) kommt in den Entwurf', mitNeuerBasis.art === 'zusammen' && mitNeuerBasis.form.gewicht === '3' && mitNeuerBasis.form.stapel === '6', JSON.stringify(mitNeuerBasis));
    check('... mit dem alten Stand als Basis ginge das Gewicht des Servers still verloren: die Pruefung sieht dann keinen Unterschied (keiner), der Entwurf behielte 4 und das naechste Speichern ueberschriebe die 3 des Servers; mit der neuen Basis sagt sie zusammen und der Entwurf bekommt die 3', mitAlterBasis.art === 'keiner' && weiterGetippt.gewicht === '4' && mitNeuerBasis.art === 'zusammen' && mitNeuerBasis.form.gewicht === '3', JSON.stringify([mitAlterBasis.art, weiterGetippt.gewicht, mitNeuerBasis.art]));
    const ns = methoden.get('nachSpeichern');
    let setztBasis = 0;
    if (ns) besuche(ns, (n) => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && n.left.getText(sf) === 'this.basis' && n.right.getText(sf) === 'w.weiter.basis') {
        let p: ts.Node | undefined = n.parent;
        let imZweig = false;
        while (p && p !== ns) {
          if (ts.isIfStatement(p) && /w\.weiter\s*!==\s*null/.test(p.expression.getText(sf))) imZweig = true;
          p = p.parent;
        }
        if (imZweig) setztBasis++;
      }
    });
    check('seite.ts: nachSpeichern() setzt im Zweig "behalten mit weiter" die Basis auf w.weiter.basis (Syntaxbaum)', setztBasis === 1, String(setztBasis));
  }

  // N5 (Angriff N4, Info): nothing is open when no form is
  {
    const f = eintragZuFormular(basis);
    const r = entscheideNachSpeichern({ formVorher: kanonisch(f), idVorher: 'Axt', ausgewaehltVorher: 'Axt', formJetzt: null, ausgewaehltJetzt: null, gespeicherteId: 'Axt', server: basis });
    check('ohne Formular (null) meldet entscheideNachSpeichern keine offenen Aenderungen (offen false, kein weiter)', r.art === 'behalten' && r.offen === false && r.weiter === null, JSON.stringify(r));
    const mit = entscheideNachSpeichern({ formVorher: kanonisch(f), idVorher: 'Axt', ausgewaehltVorher: 'Axt', formJetzt: { ...f, gewicht: '9' }, ausgewaehltJetzt: 'Axt', gespeicherteId: 'Axt', server: basis });
    check('mit einem geaenderten Formular bleibt offen true', mit.art === 'behalten' && mit.offen === true);
    const ns = methoden.get('nachSpeichern');
    check('seite.ts: das Banner "ungespeicherte Aenderungen" haengt an w.offen', ns !== undefined && /w\.offen\s*\?\s*\[tA\('editor\.gegenstand\.seite\.nach_speichern_offen'\)\]/.test(ns.getText(sf)));
  }

  // ── [11] EG2 N8 ─────────────────────────────────────────────────────
  console.log('\n[11] EG2 N8: Vorwarnung vor dem Speichern, der juengste Ladevorgang, die Verdrahtung in seite.ts:');
  {
    const dreckig = JSON.stringify({
      version: 1,
      kommentar: 'von Hand',
      gegenstaende: [
        { id: 'Axt', nameSchluessel: 'inhalt.gegenstand.Axt.name', typ: 'material', stapel: 2.5, gewicht: 5000, texte: { 'inhalt.gegenstand.Axt.name': { de: 'Axt', en: 'Axt' } } },
        { id: 'Kaputt', nameSchluessel: 'inhalt.gegenstand.Kaputt.name', typ: 'unsinn', texte: {} },
      ],
    });
    const HASH = 'd'.repeat(64);
    const anfragen: string[] = [];
    const fetcher = async (_u: unknown, init?: RequestInit): Promise<Response> => {
      anfragen.push(init?.method ?? 'GET');
      if (init?.method === 'PUT') return new Response(JSON.stringify({ ok: true, hash: 'e'.repeat(64), eintraege: 1 }), { status: 200 });
      return new Response(JSON.stringify({ text: dreckig, hash: HASH, quelle: 'arbeit' }), { status: 200 });
    };
    const geladen = await ladeStand({ fetcher });
    if (geladen.art !== 'ok') throw new Error('load failed');
    const stand = geladen.stand;
    check('ladeStand: die handgeschriebene Datei meldet ihre Vereinheitlichung (Axt, Dateiebene) und den verworfenen Eintrag', gleich(stand.vereinheitlicht, { ids: ['Axt'], dateiebene: true }) && stand.verworfen.length === 1, JSON.stringify(stand.vereinheitlicht));
    const eintragAxt = stand.eintraege[0];
    const s = schnappschuss(stand);
    const liste = mitEintrag(s.eintraege, 'Axt', eintragAxt);

    anfragen.length = 0;
    let gefragt = 0;
    const nein = await speichereSchnappschuss({ fetcher }, s, liste, async () => true, { warnung: vorwarnungVon(stand, 'Axt'), frage: async () => (gefragt++, false) });
    check('Vorwarnung, Antwort "nein": es geht KEIN PUT raus (kein einziger Aufruf), Ergebnis dialog-nein', nein.art === 'dialog-nein' && gefragt === 1 && anfragen.length === 0, `${nein.art} ${gefragt} ${anfragen.join()}`);
    const wirft = await speichereSchnappschuss({ fetcher }, s, liste, async () => true, { warnung: vorwarnungVon(stand, 'Axt'), frage: async () => { throw new Error('Dialog kaputt'); } });
    check('Vorwarnung, der Dialog wirft: Ergebnis ausnahme, KEIN PUT', wirft.art === 'ausnahme' && anfragen.length === 0, `${wirft.art} ${anfragen.join()}`);
    const ja = await speichereSchnappschuss({ fetcher }, s, liste, async () => true, { warnung: vorwarnungVon(stand, 'Axt'), frage: async () => true });
    check('Vorwarnung, Antwort "ja": genau ein PUT', ja.art === 'ok' && anfragen.filter((m) => m === 'PUT').length === 1, `${ja.art} ${anfragen.join()}`);
    anfragen.length = 0;
    gefragt = 0;
    const sauberStand = { ...stand, vereinheitlicht: { ids: [], dateiebene: false }, verworfen: [] };
    const ohneWarnung = await speichereSchnappschuss({ fetcher }, schnappschuss(sauberStand), liste, async () => true, { warnung: vorwarnungVon(sauberStand, 'Axt'), frage: async () => (gefragt++, false) });
    check('saubere Datei: keine Frage, der PUT geht raus', ohneWarnung.art === 'ok' && gefragt === 0 && anfragen.filter((m) => m === 'PUT').length === 1);

    // Removal: it writes the whole file too, so the same question comes first (after the dependents dialog)
    anfragen.length = 0;
    const entf = await entferneGegenstand({ fetcher }, () => stand, 'Axt', async () => true, async () => true, { warnung: vorwarnungVon(stand, null), frage: async () => false });
    check('Entfernen aus einer unsauberen Datei: ohne "ja" der Vorwarnung kein PUT', entf.art === 'dialog-nein' && anfragen.length === 0, `${entf.art} ${anfragen.join()}`);

    // The id of a discarded entry
    const w = vorwarnungVon(stand, 'Kaputt');
    check('vorwarnungVon: ein Eintrag mit der Id eines verworfenen Eintrags (Kaputt) meldet das Ueberschreiben', gleich(w.ueberschreibt.map((v) => v.id), ['Kaputt']) && vorwarnungVon(stand, 'Axt').ueberschreibt.length === 0 && vorwarnungVon(stand, null).ueberschreibt.length === 0);
    const nurId = { vereinheitlicht: { ids: [], dateiebene: false }, verworfeneInDatei: [], ueberschreibt: w.ueberschreibt };
    anfragen.length = 0;
    let fragen2 = 0;
    const idNein = await speichereSchnappschuss({ fetcher }, s, liste, async () => true, { warnung: nurId, frage: async () => (fragen2++, false) });
    check('nur die Id-Kollision, ohne Vereinheitlichung: es wird trotzdem gefragt, ohne "ja" kein PUT', idNein.art === 'dialog-nein' && fragen2 === 1 && anfragen.length === 0);
    check('hatVorwarnung: leer = nichts zu fragen; Id-Kollision allein, Vereinheitlichung allein, nur Dateiebene = fragen', !hatVorwarnung({ vereinheitlicht: { ids: [], dateiebene: false }, verworfeneInDatei: [], ueberschreibt: [] }) && hatVorwarnung(nurId) && hatVorwarnung({ vereinheitlicht: { ids: ['A'], dateiebene: false }, verworfeneInDatei: [], ueberschreibt: [] }) && hatVorwarnung({ vereinheitlicht: { ids: [], dateiebene: true }, verworfeneInDatei: [], ueberschreibt: [] }));

    // The newest load wins
    const nachLauf = juengsteAntwort();
    let erstes: (e: { art: 'ausnahme' }) => void = () => undefined;
    const langsam = nachLauf(() => new Promise((a) => (erstes = a)));
    const schnell = await nachLauf(async () => ({ art: 'ausnahme' as const }));
    erstes({ art: 'ausnahme' });
    check('zwei Ladevorgaenge ueberholen sich nicht: der aeltere, spaeter eintreffende gilt nicht (null), der juengste gilt', (await langsam) === null && schnell !== null);
    check('nacheinander laufende Ladevorgaenge gelten beide', (await nachLauf(async () => ({ art: 'ausnahme' as const }))) !== null && (await nachLauf(async () => ({ art: 'ausnahme' as const }))) !== null);

    // wiring in seite.ts
    const rumpf = (name: string): string => methoden.get(name)?.getText(sf) ?? '';
    const nsText = rumpf('nachSpeichern');
    check('seite.ts: nachSpeichern() prueft den neuen Stand wie laden() (pruefeNeuenStand), setzt this.stand nicht an der Pruefung vorbei', /pruefeNeuenStand\(/.test(nsText) && /pruefeNeuenStand\(/.test(rumpf('laden')) && /pruefeKonflikt\(/.test(rumpf('pruefeNeuenStand')));
    check('seite.ts: nachSpeichern() und laden() laden ueber den Zaehler (juengste), nie ladeGefangen allein', /this\.juengste\(\(\) => ladeGefangen\(/.test(nsText) && /this\.juengste\(\(\) => ladeGefangen\(/.test(rumpf('laden')) && !/await ladeGefangen\(/.test(nsText) && !/await ladeGefangen\(/.test(rumpf('laden')));
    {
      // I1.1: another author changes the entry between our PUT and the reload, while the draft keeps being typed
      const gesendet = formularZuEintrag({ ...eintragZuFormular(AXT), gewicht: '4' });
      const fremd = formularZuEintrag({ ...eintragZuFormular(gesendet), stapel: '9' }); // what the reload brings back
      const f = { ...eintragZuFormular(gesendet), nameDe: 'weitergetippt' };
      const vorStand = kanonisch({ ...f, nameDe: 'Axt' });
      const mitGesendet = entscheideNachSpeichern({ formVorher: vorStand, idVorher: 'Axt', ausgewaehltVorher: 'Axt', formJetzt: f, ausgewaehltJetzt: 'Axt', gespeicherteId: 'Axt', server: gesendet });
      const mitFremd = entscheideNachSpeichern({ formVorher: vorStand, idVorher: 'Axt', ausgewaehltVorher: 'Axt', formJetzt: f, ausgewaehltJetzt: 'Axt', gespeicherteId: 'Axt', server: fremd });
      if (mitGesendet.art !== 'behalten' || mitGesendet.weiter === null || mitFremd.art !== 'behalten' || mitFremd.weiter === null) throw new Error('unexpected');
      const k1 = pruefeKonflikt({ basis: mitGesendet.weiter.basis, form: f, ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [fremd] });
      const k2 = pruefeKonflikt({ basis: mitFremd.weiter.basis, form: f, ausgewaehlt: 'Axt', entwurfGeaendert: true, neuerStand: [fremd] });
      check('Fremdaenderung zwischen PUT und Neuladen: mit dem GESENDETEN Eintrag als Basis nimmt der Entwurf den fremden Stapel (9) auf (zusammen)', k1.art === 'zusammen' && k1.form.stapel === '9' && k1.form.nameDe === 'weitergetippt', JSON.stringify(k1.art));
      check('... mit dem neu geladenen Eintrag als Basis (der alte Weg) saehe die Pruefung nichts (keiner): die fremde Aenderung wuerde beim naechsten Speichern still ueberschrieben', k2.art === 'keiner');
      check('seite.ts: nachSpeichern() gibt dem Entscheider den gesendeten Eintrag als Stand der Basis (server: e ? (geschrieben ?? e) : null)', /server:\s*e \? \(geschrieben \?\? e\) : null/.test(nsText));
    }
    check('seite.ts: nachSpeichern() haelt die Ladesperre (laedt) und gibt sie im finally frei', /this\.laedt = true/.test(nsText) && /finally\s*\{[^}]*this\.laedt = false/.test(nsText));
    check('seite.ts: scheitert der Abruf in nachSpeichern(), steht eine uebersetzte Meldung im Banner (kein stilles return)', /nach_speichern_ladefehler/.test(nsText) && !/if \(erg\.art !== 'ok'\) return;/.test(nsText));
    check('seite.ts: nachSpeichern() bekommt den gesendeten Eintrag (Basis fuer den Vergleich) von speichern() und null von entfernen()', /nachSpeichern\(eintrag\.id, vorher, eintrag\)/.test(rumpf('speichern')) && /nachSpeichern\(null, vorher, null\)/.test(rumpf('entfernen')));
    check('seite.ts: speichern() baut den Eintrag mit dem gespeicherten Eintrag als Basis (unbekannte Felder bleiben)', /formularZuEintrag\(this\.form, this\.basis\)/.test(rumpf('speichern')));
    check('seite.ts: speichern() und entfernen() geben die Vorwarnung (vorab) an den Ablauf', /this\.vorab\(this\.stand, eintrag\.id\)/.test(rumpf('speichern')) && /,\s*vorab\)/.test(rumpf('speichern')) && /this\.vorab\(this\.stand, null\)/.test(rumpf('entfernen')) && /,\s*vorab\)/.test(rumpf('entfernen')));
    check('seite.ts: das Laden zeigt die Vereinheitlichung als Banner (vereinheitlichtZeilen)', /vereinheitlichtZeilen\(erg\.stand\.vereinheitlicht\)/.test(rumpf('laden')));
    check('seite.ts: die Ergebniszeile bei netz/zeit kommt aus nichtGespeichertText, kein festes "nicht gespeichert" in senden()', (rumpf('senden').match(/nichtGespeichertText\(erg\.art\)/g) ?? []).length >= 6 && !/seite\.nicht_gespeichert/.test(rumpf('senden')));
  }
}

// ── [12] EG2 N9: verworfene Eintraege in der Vorwarnung, der Merker, die Infos I1 bis I5 ──
console.log('\n[12] EG2 N9: Vorwarnung (verworfene Eintraege, einmal je Stand), I1, I3, I4, I5:');
{
  const V = (index: number, id: string | null, grund: Stand['verworfen'][number]['grund'] = 'typ-unbekannt'): Stand['verworfen'][number] => ({ index, id, grund });
  const standMit = (hash: string, o: { ids?: string[]; datei?: boolean; verworfen?: ReturnType<typeof V>[] }) => ({ hash, vereinheitlicht: { ids: o.ids ?? [], dateiebene: o.datei ?? false }, verworfen: o.verworfen ?? [] });
  const zwei = [V(1, null, 'id-ungueltig'), V(2, 'Epsilon', 'zahl-ungueltig')];

  // A1
  const sA = standMit('a'.repeat(64), { verworfen: zwei });
  for (const id of ['Gamma', 'Zeta', null]) {
    const w = vorwarnungVon(sA, id);
    check(`A1: vorwarnungVon(${id === null ? 'Entfernen' : id}): beide verworfenen Eintraege der Datei stehen drin, auch ohne gleiche Id`, w.verworfeneInDatei.length === 2 && w.ueberschreibt.length === 0 && hatVorwarnung(w), JSON.stringify(w));
  }
  check('A1: gleiche Id eines verworfenen Eintrags: ueberschreibt und verworfeneInDatei zugleich', vorwarnungVon(sA, 'Epsilon').ueberschreibt.length === 1 && vorwarnungVon(sA, 'Epsilon').verworfeneInDatei.length === 2);
  check('A1: hatVorwarnung allein wegen verworfener Eintraege; ohne irgendetwas nicht', hatVorwarnung({ vereinheitlicht: { ids: [], dateiebene: false }, verworfeneInDatei: [V(0, 'X')], ueberschreibt: [] }) && !hatVorwarnung(vorwarnungVon(standMit('b'.repeat(64), {}), 'Gamma')));
  {
    // end to end with an in-memory route: two discarded and two valid entries, saving Gamma
    // the two valid entries are in the canonical form, so the question is only about the two discarded ones
    const kanonDatei = JSON.parse(schreibeGegenstandsDatei([eintrag('Gamma', 'Gamma'), eintrag('Zeta', 'Zeta')])) as { gegenstaende: Array<Record<string, unknown>> };
    const [kGamma, kZeta] = kanonDatei.gegenstaende;
    const text = JSON.stringify({ version: 1, gegenstaende: [kGamma, { ...kZeta, id: 'x y' }, { ...kZeta, id: 'Epsilon', stapel: 'viel' }, kZeta] });
    const anfragen: string[] = [];
    const fetcher = async (_u: unknown, init?: RequestInit): Promise<Response> => {
      anfragen.push(init?.method ?? 'GET');
      if (init?.method === 'PUT') return new Response(JSON.stringify({ ok: true, hash: 'f'.repeat(64), eintraege: 2 }), { status: 200 });
      return new Response(JSON.stringify({ text, hash: 'c'.repeat(64), quelle: 'arbeit' }), { status: 200 });
    };
    const geladen = await ladeStand({ fetcher });
    if (geladen.art !== 'ok') throw new Error('load failed');
    const st = geladen.stand;
    check('A1: Laden: zwei gueltige, zwei verworfene Eintraege, keine Vereinheitlichung', st.eintraege.length === 2 && st.verworfen.length === 2 && st.vereinheitlicht.ids.length === 0 && !st.vereinheitlicht.dateiebene, JSON.stringify(st));
    const liste = mitEintrag(st.eintraege, 'Gamma', st.eintraege[0]);
    anfragen.length = 0;
    let gesehen = -1;
    let merker: string | null = null;
    const nein = await speichereSchnappschuss({ fetcher }, schnappschuss(st), liste, async () => true, vorabFuer({ merker, setzeMerker: (h) => (merker = h), stand: st, id: 'Gamma', dialog: async (w) => ((gesehen = w.verworfeneInDatei.length), false) }));
    check('A1: Gamma speichern, Antwort "nein": die Frage kommt (2 verworfene genannt), dialog-nein, kein PUT, Merker bleibt leer', nein.art === 'dialog-nein' && gesehen === 2 && anfragen.length === 0 && merker === null, `${nein.art} ${gesehen} ${anfragen.join()} ${merker}`);
    const ja = await speichereSchnappschuss({ fetcher }, schnappschuss(st), liste, async () => true, vorabFuer({ merker, setzeMerker: (h) => (merker = h), stand: st, id: 'Gamma', dialog: async () => true }));
    check('A1: Antwort "ja": genau ein PUT, Merker = Hash des Stands', ja.art === 'ok' && anfragen.filter((m) => m === 'PUT').length === 1 && merker === st.hash, `${ja.art} ${anfragen.join()}`);
  }

  // A2: brauchtVorwarnung / vorabFuer
  const sH1 = standMit('1'.repeat(64), { ids: ['Axt'], verworfen: [V(3, 'Kaputt'), V(4, 'Anders')] });
  const sH2 = standMit('2'.repeat(64), { ids: ['Axt'], verworfen: [V(3, 'Kaputt')] });
  const b0 = brauchtVorwarnung(null, sH1, 'Gamma');
  check('A2: ohne Merker wird gefragt, die Warnung ist ungekuerzt, der Merker nach "ja" ist der Hash des Stands', b0.fragen && b0.warnung.vereinheitlicht.ids.length === 1 && b0.warnung.verworfeneInDatei.length === 2 && b0.merkerNachJa === sH1.hash);
  const b1 = brauchtVorwarnung(sH1.hash, sH1, 'Gamma');
  check('A2: nach "ja" fuer DIESEN Stand: weder Vereinheitlichung noch verworfene Eintraege werden noch einmal gefragt (keine Frage)', !b1.fragen && b1.warnung.vereinheitlicht.ids.length === 0 && !b1.warnung.vereinheitlicht.dateiebene && b1.warnung.verworfeneInDatei.length === 0);
  const b2 = brauchtVorwarnung(sH1.hash, sH1, 'Kaputt');
  check('A2: die Zeilen zum Ueberschreiben (gleiche Id) werden nie geleert: auch mit Merker wird gefragt, nur sie', b2.fragen && b2.warnung.ueberschreibt.length === 1 && b2.warnung.ueberschreibt[0].id === 'Kaputt' && b2.warnung.vereinheitlicht.ids.length === 0 && b2.warnung.verworfeneInDatei.length === 0);
  const b3 = brauchtVorwarnung(sH1.hash, sH2, 'Gamma');
  check('A2: neues Laden mit anderem Hash und neuer Warnung: wieder gefragt, mit der vollen Warnung (ein "ja" fuer den alten Stand gilt nicht)', b3.fragen && b3.warnung.vereinheitlicht.ids.length === 1 && b3.warnung.verworfeneInDatei.length === 1 && b3.merkerNachJa === sH2.hash);
  check('A2: ein "ja" fuer einen anderen Stand (auch ein beliebiger Merker) unterdrueckt nichts', brauchtVorwarnung('x', sH1, 'Gamma').fragen && brauchtVorwarnung('', sH1, 'Gamma').fragen);
  check('A2: ein sauberer Stand fragt nie, auch ohne Merker', !brauchtVorwarnung(null, standMit('3'.repeat(64), {}), 'Gamma').fragen);

  // a page in miniature: memory + the real flow, as seite.ts uses it
  {
    const abl = async (stand: ReturnType<typeof standMit>, id: string | null, antwort: boolean | 'wirft', seite: { merker: string | null; fragen: number; puts: number }): Promise<string> => {
      const erg = await speichereSchnappschuss(
        { fetcher: async (_u: unknown, init?: RequestInit) => (init?.method === 'PUT' ? (seite.puts++, new Response(JSON.stringify({ ok: true, hash: '9'.repeat(64), eintraege: 1 }), { status: 200 })) : new Response('{}', { status: 500 })) },
        { eintraege: [], hash: stand.hash },
        [],
        async () => true,
        vorabFuer({ merker: seite.merker, setzeMerker: (h) => (seite.merker = h), stand, id, dialog: async () => { seite.fragen++; if (antwort === 'wirft') throw new Error('Dialog kaputt'); return antwort; } })
      );
      return erg.art;
    };
    const seite = { merker: null as string | null, fragen: 0, puts: 0 };
    check('A2 (Ablauf): "nein": gefragt, kein PUT, Merker leer', (await abl(sH1, 'Gamma', false, seite)) === 'dialog-nein' && seite.fragen === 1 && seite.puts === 0 && seite.merker === null);
    check('A2 (Ablauf): danach wird wieder gefragt (nach "nein"); der Dialog wirft: ausnahme, kein PUT, Merker leer', (await abl(sH1, 'Gamma', 'wirft', seite)) === 'ausnahme' && seite.fragen === 2 && seite.puts === 0 && seite.merker === null);
    check('A2 (Ablauf): wieder gefragt, "ja": PUT, Merker = Hash', (await abl(sH1, 'Gamma', true, seite)) === 'ok' && seite.fragen === 3 && seite.puts === 1 && seite.merker === sH1.hash);
    check('A2 (Ablauf): dasselbe geladene Stand noch einmal (z. B. ein Netzfehler zuvor): KEINE zweite Frage, PUT geht raus', (await abl(sH1, 'Gamma', false, seite)) === 'ok' && seite.fragen === 3 && seite.puts === 2);
    check('A2 (Ablauf): dasselbe Laden, aber ein Eintrag mit der Id eines verworfenen: gefragt', (await abl(sH1, 'Kaputt', false, seite)) === 'dialog-nein' && seite.fragen === 4 && seite.puts === 2);
    check('A2 (Ablauf): neuer Stand mit anderem Hash und Warnung: gefragt', (await abl(sH2, 'Gamma', false, seite)) === 'dialog-nein' && seite.fragen === 5 && seite.puts === 2);
  }

  // Binding in seite.ts on the syntax tree
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
  const m = (name: string): ts.MethodDeclaration => {
    const x = methoden.get(name);
    if (x === undefined) throw new Error(`seite.ts has no method ${name}`);
    return x;
  };
  const rumpfText = (name: string): string => m(name).getText(sf);
  const eigenschaft = (o: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined => o.properties.find((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === name);
  const vorab = m('vorab');
  const stmts = vorab.body?.statements ?? [];
  const ret = stmts.length === 1 && ts.isReturnStatement(stmts[0]) ? stmts[0].expression : undefined;
  const aufruf = ret !== undefined && ts.isCallExpression(ret) && ts.isIdentifier(ret.expression) && ret.expression.text === 'vorabFuer' && ret.arguments.length === 1 && ts.isObjectLiteralExpression(ret.arguments[0]) ? ret.arguments[0] : undefined;
  check('A2 (Bindung): vorab() ist nur `return vorabFuer({...})`, keine eigene Entscheidung in der Seite', aufruf !== undefined && (vorab.body?.statements.length ?? 0) === 1);
  if (aufruf === undefined) throw new Error('vorab() is not a call of vorabFuer');
  const prop = (n: string): ts.Node | undefined => {
    const p = eigenschaft(aufruf, n);
    return p !== undefined && ts.isPropertyAssignment(p) ? p.initializer : p;
  };
  const merkerP = prop('merker');
  check('A2 (Bindung): merker = this.vorwarnungMerker (der gespeicherte Merker)', merkerP !== undefined && merkerP.getText(sf) === 'this.vorwarnungMerker');
  const setzeP = prop('setzeMerker');
  check('A2 (Bindung): setzeMerker speichert in this.vorwarnungMerker (h => this.vorwarnungMerker = h)', setzeP !== undefined && ts.isArrowFunction(setzeP) && setzeP.parameters.length === 1 && (() => {
    let b: ts.Node = setzeP.body;
    while (ts.isParenthesizedExpression(b)) b = b.expression;
    return ts.isBinaryExpression(b) && b.operatorToken.kind === ts.SyntaxKind.EqualsToken && b.left.getText(sf) === 'this.vorwarnungMerker' && b.right.getText(sf) === (setzeP.parameters[0].name as ts.Identifier).text;
  })());
  check('A2 (Bindung): stand und id werden unveraendert durchgereicht (stand, id)', eigenschaft(aufruf, 'stand') !== undefined && eigenschaft(aufruf, 'id') !== undefined && ts.isShorthandPropertyAssignment(eigenschaft(aufruf, 'stand') as ts.Node) && ts.isShorthandPropertyAssignment(eigenschaft(aufruf, 'id') as ts.Node));
  const dialogP = prop('dialog');
  let dialogOk = false;
  if (dialogP !== undefined && ts.isArrowFunction(dialogP) && dialogP.parameters.length === 1 && ts.isIdentifier(dialogP.parameters[0].name)) {
    const par = dialogP.parameters[0].name.text;
    const b = dialogP.body;
    dialogOk = ts.isCallExpression(b) && b.expression.getText(sf) === 'fragenDialog' && b.arguments.length === 1 && ts.isCallExpression(b.arguments[0]) && b.arguments[0].expression.getText(sf) === 'vorwarnungsInhalt' && b.arguments[0].arguments.length === 1 && b.arguments[0].arguments[0].getText(sf) === par;
  }
  check('A2 (Bindung): der Dialog ist `w => fragenDialog(vorwarnungsInhalt(w))`: wirklich der Dialog, mit der Warnung genau so, wie der Ablauf sie gibt (nichts verschwiegen)', dialogOk, dialogP?.getText(sf));
  check('A2 (Bindung): seite.ts hat die Entscheidung nicht mehr (kein vorwarnungVon, keinen Vergleich mit dem Stand, keine keineVereinheitlichung)', !/vorwarnungVon|keineVereinheitlichung|vorwarnungBestaetigt/.test(sf.getText()));

  // I1: a doubled id whose FIRST entry is discarded
  {
    const kIota = (JSON.parse(schreibeGegenstandsDatei([eintrag('Iota', 'Iota')])) as { gegenstaende: Array<Record<string, unknown>> }).gegenstaende[0];
    const g = (extra: Record<string, unknown> = {}) => ({ ...kIota, ...extra });
    const text = JSON.stringify({ version: 1, gegenstaende: [g({ stapel: 'viel' }), g()] });
    const l = leseGegenstandsDatei(text);
    check('I1 (Vorbedingung): der erste Iota wird verworfen, der zweite angenommen', l.eintraege.length === 1 && l.verworfen.length === 1 && l.verworfen[0].index === 0 && l.verworfen[0].id === 'Iota', JSON.stringify(l.verworfen));
    check('I1: der unveraenderte zweite Iota wird NICHT als vereinheitlicht gemeldet', gleich(vereinheitlichung(text, l.eintraege, l.verworfen), { ids: [], dateiebene: false }), JSON.stringify(vereinheitlichung(text, l.eintraege, l.verworfen)));
    check('I1: ohne die Liste der verworfenen Eintraege wuerde er es (der alte Fehler)', gleich(vereinheitlichung(text, l.eintraege).ids, ['Iota']));
    const text2 = JSON.stringify({ version: 1, gegenstaende: [g({ stapel: 'viel' }), g({ zauber: 1 })] });
    const l2 = leseGegenstandsDatei(text2);
    check('I1: ist der zweite Iota wirklich zu vereinheitlichen (das unbekannte Feld faellt weg), wird er gemeldet', gleich(vereinheitlichung(text2, l2.eintraege, l2.verworfen).ids, ['Iota']), JSON.stringify(vereinheitlichung(text2, l2.eintraege, l2.verworfen)));
    const geladen = await ladeStand({ fetcher: async () => new Response(JSON.stringify({ text, hash: 'd'.repeat(64), quelle: 'arbeit' }), { status: 200 }) });
    check('I1 (Verdrahtung): ladeStand reicht die verworfenen Eintraege an die Pruefung weiter', geladen.art === 'ok' && geladen.stand.vereinheitlicht.ids.length === 0 && geladen.stand.verworfen.length === 1);
  }

  // I5: whitespace and doubled keys are not a unification (known limit, decided in N9)
  {
    const a = leseGegenstandsDatei(schreibeGegenstandsDatei([AXT]));
    const kanon = schreibeGegenstandsDatei([AXT]);
    const eingerueckt = JSON.stringify(JSON.parse(kanon), null, '\t');
    const doppelt = kanon.replace(/"gewicht":\s*(\d+)/, '"gewicht":1,"gewicht":$1');
    for (const [name, t] of [['anders eingerueckt', eingerueckt], ['doppelter Schluessel (der letzte gilt)', doppelt]] as const) {
      const l = leseGegenstandsDatei(t);
      check(`I5: ${name}: gleicher Inhalt wie die kanonische Datei, KEINE Frage (bekannte Grenze, kein Datenverlust)`, l.eintraege.length === 1 && gleich(vereinheitlichung(t, l.eintraege, l.verworfen), { ids: [], dateiebene: false }) && t !== kanon, JSON.stringify(vereinheitlichung(t, l.eintraege, l.verworfen)));
    }
    check('I5 (Vorbedingung): die kanonische Datei selbst ist unveraendert', a.eintraege.length === 1 && gleich(vereinheitlichung(kanon, a.eintraege, a.verworfen), { ids: [], dateiebene: false }));
  }

  // I2 binding: 'fehler' gives the status to the text
  check('I2 (Bindung): senden() uebergibt bei "fehler" den Status an nichtGespeichertText', /case 'fehler':[\s\S]*?nichtGespeichertText\(erg\.art, undefined, erg\.status\)/.test(rumpfText('senden')));

  // I3: after a failed reload the state is marked stale; the next save or removal loads first
  {
    const zuweisung = (name: string, links: string, rechts: string): ts.BinaryExpression[] => {
      const aus: ts.BinaryExpression[] = [];
      besuche(m(name), (n) => {
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && n.left.getText(sf) === links && n.right.getText(sf) === rechts) aus.push(n);
      });
      return aus;
    };
    const imZweig = (n: ts.Node, bedingung: RegExp): boolean => {
      for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) if (ts.isIfStatement(p) && bedingung.test(p.expression.getText(sf)) && p.thenStatement.pos <= n.pos && n.end <= p.thenStatement.end) return true;
      return false;
    };
    const veraltetGesetzt = zuweisung('nachSpeichern', 'this.standVeraltet', 'true');
    check("I3: nachSpeichern(): scheitert der Abruf (erg.art !== 'ok'), wird this.standVeraltet = true gesetzt", veraltetGesetzt.length === 1 && imZweig(veraltetGesetzt[0], /erg\.art !== 'ok'/));
    check('I3: nachSpeichern() und laden(): ein erfolgreiches Laden (this.stand = erg.stand) setzt this.standVeraltet = false', zuweisung('nachSpeichern', 'this.standVeraltet', 'false').length === 1 && zuweisung('laden', 'this.standVeraltet', 'false').length === 1 && /this\.stand = erg\.stand;\s*this\.standVeraltet = false;/.test(rumpfText('nachSpeichern')) && /this\.stand = erg\.stand;\s*this\.standVeraltet = false;/.test(rumpfText('laden')));
    for (const name of ['speichern', 'entfernen']) {
      const t = rumpfText(name);
      const wo = t.search(/if \(this\.standVeraltet\) return this\.laden\(true\);/);
      check(`I3: ${name}() laedt zuerst neu und sendet dann nichts, wenn der Stand veraltet ist (vor dem Schnappschuss und vor senden())`, wo !== -1 && wo < t.search(/this\.senden\(|schnappschuss\(/) && wo < t.search(/this\.vorab\(/));
    }
    check('I3: this.standVeraltet kommt sonst nirgends vor (nur die Stellen oben)', (sf.getText().match(/this\.standVeraltet/g) ?? []).length === 5, String((sf.getText().match(/this\.standVeraltet/g) ?? []).length));
  }

  // I4: sicher() leaves the loading lock alone; the lock is freed by the load itself, also when aktualisiere() throws
  {
    let laedtGesetzt = 0;
    besuche(m('sicher'), (n) => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && n.left.getText(sf) === 'this.laedt') laedtGesetzt++;
    });
    check('I4: sicher() setzt this.laedt nirgends (ein Laden, das es nicht gestartet hat, behaelt seine Sperre)', laedtGesetzt === 0 && /this\.speichert = false/.test(rumpfText('sicher')));
    for (const name of ['laden', 'nachSpeichern']) {
      const s2 = m(name).body?.statements ?? [];
      const i = s2.findIndex((x) => x.getText(sf) === 'this.laedt = true;');
      const nach = i >= 0 ? s2[i + 1] : undefined;
      check(`I4: ${name}(): direkt nach this.laedt = true folgt das try, dessen finally die Sperre freigibt (nichts davor kann sie haengen lassen)`, nach !== undefined && ts.isTryStatement(nach) && nach.finallyBlock !== undefined && /this\.laedt = false;/.test(nach.finallyBlock.getText(sf)) && !/^\s*this\.aktualisiere\(\)/.test(s2.slice(i + 1, i + 2).map((x) => x.getText(sf)).join('')));
    }
  }
}

console.log(fehler === 0 ? '\nalles gruen' : `\n${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
