/**
 * Speichern mit Basis (K0.3): Der Speicherweg des Editors gegen eine
 * Fetch-Attrappe, ohne Editorfenster.
 *
 * Vertrag mit K0.2 (Betriebsdienst):
 *   GET  /api/worldlayout  → Kopf `ETag: "<hash>"` und Rumpffeld `hash`
 *   POST /api/worldlayout  → Kopf `If-Match: "<hash>"`;
 *                            409 { fehler: 'veraltet', aktuell }
 *                            422 { fehler: 'zu-viele-platzierungen', anzahl, grenze }
 *                            Erfolg: Antwort mit neuem `hash`
 *                            428 { fehler: 'basis-fehlt', message } (E1: POST ohne Basis)
 * Die Funktion `schreibeWeltdokument` selbst sendet auf Wunsch auch ohne Basis
 * (Abschnitt 3); der EDITOR tut das nie (Abschnitt 8: ohne Basis kein POST).
 *
 * Lauf:  npx tsx test/editor-speichern-basis.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeWorldLayout } from '@wov/shared';
import { BASIS_FEHLT, basisNachBestaetigung, hashNormalisieren, holeWeltdokument, schreibeWeltdokument } from '../src/editor/weltdokument';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '../..');

let fehler = 0;
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}

const echt = sanitizeWorldLayout(
  JSON.parse(readFileSync(resolve(WURZEL, 'server/data/welten/dev.json'), 'utf-8'))
)!;

// ── Fetch-Attrappe ───────────────────────────────────────────────────
interface Aufruf {
  methode: string;
  kopf: Record<string, string>;
  rumpf: string | undefined;
}
type FesteAntwort = { status: number; rumpf?: unknown; roh?: string; kopf?: Record<string, string> } | 'netz';
type Antwortmuster = FesteAntwort | ((aufruf: Aufruf) => FesteAntwort);

function attrappe(antworten: Antwortmuster[]): { fetchFn: typeof fetch; aufrufe: Aufruf[] } {
  const aufrufe: Aufruf[] = [];
  const fetchFn = (async (_url: string, init?: RequestInit): Promise<Response> => {
    aufrufe.push({
      methode: init?.method ?? 'GET',
      kopf: { ...(init?.headers as Record<string, string> | undefined) },
      rumpf: init?.body as string | undefined,
    });
    const roh = antworten[Math.min(aufrufe.length - 1, antworten.length - 1)]!;
    const a = typeof roh === 'function' ? roh(aufrufe[aufrufe.length - 1]!) : roh;
    if (a === 'netz') throw new Error('ECONNREFUSED');
    return new Response(a.roh ?? JSON.stringify(a.rumpf ?? {}), { status: a.status, headers: a.kopf });
  }) as typeof fetch;
  return { fetchFn, aufrufe };
}
const posts = (a: Aufruf[]): number => a.filter((x) => x.methode === 'POST').length;

// ── 1. Hash lesen ────────────────────────────────────────────────────
console.log('▶ GET: Hash aus Rumpf und ETag');
{
  const gueltig = { ok: true, message: 'x', instanz: 'dev', datei: 'dev.json', layout: echt };
  let s = await holeWeltdokument(attrappe([{ status: 200, rumpf: { ...gueltig, hash: 'abc123' } }]).fetchFn);
  check('Rumpffeld hash wird gelesen', s.erreichbar && s.hash === 'abc123', s.erreichbar ? String(s.hash) : s.grund);
  s = await holeWeltdokument(attrappe([{ status: 200, rumpf: gueltig, kopf: { ETag: '"def456"' } }]).fetchFn);
  check('ETag-Kopf ohne Anführungszeichen', s.erreichbar && s.hash === 'def456', s.erreichbar ? String(s.hash) : s.grund);
  s = await holeWeltdokument(attrappe([{ status: 200, rumpf: gueltig, kopf: { ETag: 'W/"schwach"' } }]).fetchFn);
  check('schwacher ETag W/"…" wird geglättet', s.erreichbar && s.hash === 'schwach');
  s = await holeWeltdokument(attrappe([{ status: 200, rumpf: { ...gueltig, hash: 'vorn' }, kopf: { ETag: '"hinten"' } }]).fetchFn);
  check('Rumpf geht vor Kopf', s.erreichbar && s.hash === 'vorn');
  s = await holeWeltdokument(attrappe([{ status: 200, rumpf: gueltig }]).fetchFn);
  check('Ohne Hash (Server vor K0.2): hash === null, Dokument trotzdem da', s.erreichbar && s.hash === null && s.layout.regions.length === echt.regions.length);
  check('hashNormalisieren: leer/Zahl/undefined → null', hashNormalisieren('') === null && hashNormalisieren('""') === null && hashNormalisieren(5) === null && hashNormalisieren(undefined) === null);
  check('hashNormalisieren toleriert Leerzeichen nach W/: W/ "abc" → abc, W/  "abc" → abc, W/"abc" → abc', hashNormalisieren('W/ "abc"') === 'abc' && hashNormalisieren('W/  "abc"') === 'abc' && hashNormalisieren('W/"abc"') === 'abc', JSON.stringify([hashNormalisieren('W/ "abc"'), hashNormalisieren('W/  "abc"')]));
  check('hashNormalisieren: gewöhnlicher Wert, Anführungszeichen, Randleerzeichen', hashNormalisieren('abc') === 'abc' && hashNormalisieren('"abc"') === 'abc' && hashNormalisieren('  "abc" ') === 'abc');
  s = await holeWeltdokument(attrappe([{ status: 200, rumpf: gueltig, kopf: { ETag: 'W/ "leer"' } }]).fetchFn);
  check('ETag W/ "…" (mit Leerzeichen) wird beim Lesen geglättet', s.erreichbar && s.hash === 'leer');
}

// ── 2. POST mit Basis ────────────────────────────────────────────────
console.log('▶ POST: If-Match und neuer Hash');
{
  const { fetchFn, aufrufe } = attrappe([{ status: 200, rumpf: { ok: true, message: 'Gespeichert in dev.json', hash: 'h2' } }]);
  const a = await schreibeWeltdokument(echt, 'h1', fetchFn);
  check('Erfolg: art=ok, neuer Hash h2', a.art === 'ok' && a.hash === 'h2', JSON.stringify(a));
  check('Genau 1 POST', posts(aufrufe) === 1, `POSTs=${posts(aufrufe)}`);
  check('Kopf If-Match: "h1" (mit Anführungszeichen)', aufrufe[0]?.kopf['If-Match'] === '"h1"', JSON.stringify(aufrufe[0]?.kopf));
  check('Rumpf ist das Dokument selbst — kein Zusatzfeld `basis`', aufrufe[0]?.rumpf === JSON.stringify(echt) && !aufrufe[0]!.rumpf!.includes('"basis"'));
}
{
  const { fetchFn } = attrappe([{ status: 200, rumpf: { ok: true, message: 'ok' }, kopf: { ETag: '"h3"' } }]);
  const a = await schreibeWeltdokument(echt, 'h1', fetchFn);
  check('Neuer Hash darf auch im ETag-Kopf der Antwort kommen', a.art === 'ok' && a.hash === 'h3');
}

// ── 3. POST ohne Hash vom Server ─────────────────────────────────────
console.log('▶ POST ohne bekannte Basis (Server vor K0.2)');
{
  const { fetchFn, aufrufe } = attrappe([{ status: 200, rumpf: { ok: true, message: 'Gespeichert in dev.json' } }]);
  const a = await schreibeWeltdokument(echt, null, fetchFn);
  check('POST geht ohne If-Match hinaus, wie heute', aufrufe.length === 1 && !('If-Match' in aufrufe[0]!.kopf), JSON.stringify(aufrufe[0]?.kopf));
  check('Erfolg ohne Hash: art=ok, hash=null (nächstes Speichern wieder ohne Basis)', a.art === 'ok' && a.hash === null);
  check('Kopf Content-Type bleibt application/json', aufrufe[0]?.kopf['Content-Type'] === 'application/json');
}

// ── 4. 409 ───────────────────────────────────────────────────────────
console.log('▶ 409: veraltet — nichts überschreiben');
{
  const { fetchFn, aufrufe } = attrappe([{ status: 409, rumpf: { fehler: 'veraltet', aktuell: '"h9"' } }]);
  const a = await schreibeWeltdokument(echt, 'h1', fetchFn);
  check('art=veraltet mit aktuellem Hash h9', a.art === 'veraltet' && a.aktuell === 'h9', JSON.stringify(a));
  check('Es ging 1 POST hinaus, danach 0 weitere (kein Wiederholen, kein Überschreiben)', posts(aufrufe) === 1 && aufrufe.length === 1, `Aufrufe=${aufrufe.length}`);
  check('Die Meldung sagt, dass nichts geschrieben wurde', a.message.includes('nichts geschrieben'));
}
{
  const { fetchFn } = attrappe([{ status: 409, roh: 'not json' }]);
  const a = await schreibeWeltdokument(echt, 'h1', fetchFn);
  check('409 mit unlesbarem Rumpf ist trotzdem veraltet (aktuell=null)', a.art === 'veraltet' && a.aktuell === null);
}

// ── 5. 422 ───────────────────────────────────────────────────────────
console.log('▶ 422: zu viele Platzierungen');
{
  const { fetchFn, aufrufe } = attrappe([{ status: 422, rumpf: { fehler: 'zu-viele-platzierungen', anzahl: 2001, grenze: 2000 } }]);
  const a = await schreibeWeltdokument(echt, 'h1', fetchFn);
  check('art=zu-viele-platzierungen mit anzahl=2001, grenze=2000', a.art === 'zu-viele-platzierungen' && a.anzahl === 2001 && a.grenze === 2000, JSON.stringify(a));
  check('Meldung nennt Anzahl und Grenze', a.message.includes('2001') && a.message.includes('2000'), a.message);
  check('Genau 1 POST', aufrufe.length === 1);
}
{
  const { fetchFn } = attrappe([{ status: 422, rumpf: { fehler: 'zu-viele-platzierungen' } }]);
  const a = await schreibeWeltdokument(echt, 'h1', fetchFn);
  check('422 ohne Zahlen fällt auf einen allgemeinen Fehler zurück (keine erfundenen Zahlen)', a.art === 'fehler');
}

// ── 6. Sonstige Fehler ───────────────────────────────────────────────
console.log('▶ Sonstige Fehler');
{
  const a = await schreibeWeltdokument(echt, 'h1', attrappe([{ status: 400, rumpf: { ok: false, message: 'Ungültiges Layout' } }]).fetchFn);
  check('400 mit Meldung: art=fehler, Text des Servers', a.art === 'fehler' && a.message === 'Ungültiges Layout');
  const b = await schreibeWeltdokument(echt, 'h1', attrappe([{ status: 500, roh: '<html>' }]).fetchFn);
  check('500 ohne JSON: art=fehler, nennt den Statuscode', b.art === 'fehler' && b.message.includes('500'), b.art === 'fehler' ? b.message : '');
  const c = await schreibeWeltdokument(echt, 'h1', attrappe(['netz']).fetchFn);
  check('Netzfehler: art=fehler, Wortlaut wie bisher', c.art === 'fehler' && c.message.startsWith('Speichern fehlgeschlagen:'));
  const d = await schreibeWeltdokument(echt, 'h1', attrappe([{ status: 200, rumpf: { ok: false, message: 'nein' } }]).fetchFn);
  check('200 mit ok:false wird nicht als Erfolg gewertet', d.art === 'fehler');
}

// ── 7. Sitzungsablauf, wie ihn der Editor fährt ──────────────────────
console.log('▶ Ablauf: laden → speichern → speichern → 409 → kein weiterer POST');
{
  const { fetchFn, aufrufe } = attrappe([
    { status: 200, rumpf: { ok: true, message: 'x', instanz: 'dev', datei: 'dev.json', layout: echt, hash: 'h1' } },
    { status: 200, rumpf: { ok: true, message: 'Gespeichert', hash: 'h2' } },
    { status: 200, rumpf: { ok: true, message: 'Gespeichert', hash: 'h3' } },
    { status: 409, rumpf: { fehler: 'veraltet', aktuell: 'h7' } },
  ]);
  const stand = await holeWeltdokument(fetchFn);
  let basis = stand.erreichbar ? stand.hash : null;
  const kopfzeilen: (string | undefined)[] = [];
  for (let i = 0; i < 3; i++) {
    const a = await schreibeWeltdokument(echt, basis, fetchFn);
    kopfzeilen.push(aufrufe[aufrufe.length - 1]!.kopf['If-Match']);
    if (a.art === 'ok') basis = a.hash;
  }
  check('Die Basis rückt nach jedem Erfolg vor: If-Match "h1", "h2", "h3"', kopfzeilen.join(' ') === '"h1" "h2" "h3"', kopfzeilen.join(' '));
  check('Der dritte POST bekam 409; die Basis blieb h3 (nicht auf h7 gesprungen)', basis === 'h3');
  check('Insgesamt 3 POSTs, der 409-Zweig löste keinen vierten aus', posts(aufrufe) === 3, `POSTs=${posts(aufrufe)}`);
}

// ── 7b. Nicht-dev: bestätigte Ersetzung nimmt die frisch gelesene Basis (B3) ──
console.log('▶ Nicht-dev: „Ja, überschreiben" mit frischer Basis');
{
  /** Ein Server, der die Basis prüft; jemand anders hat auf h7 gespeichert, der Editor kennt noch h1. */
  const server = (): { antworten: Antwortmuster[]; aufrufe: () => Aufruf[]; fetchFn: typeof fetch } => {
    const antworten: Antwortmuster[] = [
      { status: 200, rumpf: { ok: true, message: 'x', instanz: 'live', datei: 'live.json', layout: echt, hash: 'h7' } },
      (a) =>
        a.kopf['If-Match'] === '"h7"'
          ? { status: 200, rumpf: { ok: true, message: 'Gespeichert', hash: 'h8' } }
          : { status: 409, rumpf: { ok: false, fehler: 'veraltet', aktuell: 'h7', message: 'veraltet' } },
      (a) =>
        a.kopf['If-Match'] === '"h7"'
          ? { status: 200, rumpf: { ok: true, message: 'Gespeichert', hash: 'h8' } }
          : { status: 409, rumpf: { ok: false, fehler: 'veraltet', aktuell: 'h7', message: 'veraltet' } },
    ];
    const { fetchFn, aufrufe } = attrappe(antworten);
    return { antworten, aufrufe: () => aufrufe, fetchFn };
  };
  {
    const s = server();
    const frisch = await holeWeltdokument(s.fetchFn); // die Vorprüfung des Editors
    const basis = basisNachBestaetigung('h1', frisch);
    check('Vorprüfung liefert h7, die Basis nach der Bestätigung ist h7 (nicht die alte h1)', frisch.erreichbar && frisch.hash === 'h7' && basis === 'h7', String(basis));
    const a = await schreibeWeltdokument(echt, basis, s.fetchFn);
    check('Bestätigte Ersetzung: 1 POST, 200, kein 409 und kein zweiter Dialog', a.art === 'ok' && posts(s.aufrufe()) === 1, `POSTs=${posts(s.aufrufe())}, art=${a.art}`);
    check('… mit If-Match "h7"; neue Basis h8', s.aufrufe()[1]?.kopf['If-Match'] === '"h7"' && a.art === 'ok' && a.hash === 'h8');
  }
  {
    // Gegenprobe: mit der alten Basis (Stand 5eb78eb) läuft dieselbe Bestätigung in den 409.
    const s = server();
    await holeWeltdokument(s.fetchFn);
    const a = await schreibeWeltdokument(echt, 'h1', s.fetchFn);
    check('Gegenprobe alte Basis h1: 409 (art=veraltet) — der Fehler, den B3 beschreibt', a.art === 'veraltet', a.art);
  }
  const unlesbar = await holeWeltdokument(attrappe(['netz']).fetchFn);
  check('Vorprüfung nicht lesbar: bisherige Basis bleibt', basisNachBestaetigung('h1', unlesbar) === 'h1');
  const ohneHash = await holeWeltdokument(attrappe([{ status: 200, rumpf: { ok: true, message: 'x', layout: echt } }]).fetchFn);
  check('Vorprüfung ohne Hash (Server vor K0.2): bisherige Basis bleibt', basisNachBestaetigung('h1', ohneHash) === 'h1' && basisNachBestaetigung(null, ohneHash) === null);
}

// ── 8. Quelltextprüfung: der Editor benutzt den Speicherweg ──────────
console.log('▶ Quelltextprüfung editorMain.ts');
{
  const q = readFileSync(resolve(HIER, '../src/editor/editorMain.ts'), 'utf-8');
  const von = q.indexOf('async function inDieWeltSpeichern');
  const bis = q.indexOf('async function veraltetAbgleichen');
  const ende = q.indexOf('\n}\n', bis);
  const speichern = q.slice(von, bis);
  const abgleich = q.slice(bis, ende);
  const start = q.slice(q.indexOf('async function weltAbgleich'), q.indexOf('// ── Start ──'));
  const zaehle = (re: RegExp, text: string): number => (text.match(re) ?? []).length;
  check('inDieWeltSpeichern und veraltetAbgleichen gefunden', von > 0 && bis > von && ende > bis);

  // — Speichern: die Basis ist die des ENTWURFS, ohne Basis geht nichts hinaus —
  check('inDieWeltSpeichern: die Basis beginnt bei der Basis des Entwurfs (entwurfsSpeicher.basisLesen), nicht bei einem „zuletzt gelesenen" Stand', /let basis = entwurfsSpeicher\.basisLesen\(\);/.test(speichern) && !/serverHash/.test(q));
  check('… schickt sie: schreibeWeltdokument(sauber, basis)', /schreibeWeltdokument\(sauber, basis\)/.test(speichern));
  check('… und nimmt nach bestätigter Frischprüfung deren Hash (basisNachBestaetigung(basis, stand)) — erst NACH dem „ja"', /if \(wahl !== 'ja'\) \{[\s\S]*?return false;\s*\}\s*[^]*?basis = basisNachBestaetigung\(basis, stand\);/.test(speichern));
  const iNull = speichern.indexOf('if (basis === null)');
  const iPost = speichern.indexOf('schreibeWeltdokument(sauber, basis)');
  check('… ohne Basis geht KEIN POST hinaus: `if (basis === null)` mit BASIS_FEHLT steht vor dem POST und bricht ab', iNull > 0 && iPost > iNull && /if \(basis === null\) \{\s*shell\.meldung\(BASIS_FEHLT, true\);\s*return false;\s*\}/.test(speichern), `Positionen ${iNull} < ${iPost}`);
  check('… ruft nirgends selbst fetch(…) für den POST auf', !/fetch\(/.test(speichern.slice(speichern.indexOf('Speichere nach'))));
  const iGuard = speichern.indexOf('if (fremderEntwurfUebernommen()) return false;');
  const iSauber = speichern.indexOf('const sauber = sanitizeWorldLayout(layout);');
  const iFrage = speichern.indexOf('await frage(');
  const iGuard2 = speichern.indexOf('if (fremderEntwurfUebernommen()) return false;', iGuard + 1);
  check('… ein anderer Tab, der den Entwurf inzwischen geändert hat, wird VOR dem Lesen von `layout` übernommen und nach der Rückfrage noch einmal (dann Abbruch, kein POST)', iGuard >= 0 && iGuard < iSauber && iFrage > iSauber && iGuard2 > iFrage && iGuard2 < iPost, `Positionen ${iGuard} < ${iSauber} < ${iFrage} < ${iGuard2} < ${iPost}`);
  check('… bei Erfolg wird der Entwurf geschrieben und die Basis erst DANACH, nur wenn er im Speicher steht: entwurfImSpeicher(speichereEntwurf(\'server\')) → setzeEntwurfBasis(antwort.hash)', /if \(entwurfImSpeicher\(speichereEntwurf\('server'\)\)\) setzeEntwurfBasis\(antwort\.hash\);/.test(speichern));
  check('… bei 409 wird abgeglichen statt überschrieben', /antwort\.art === 'veraltet'[\s\S]*veraltetAbgleichen\(sauber\)/.test(speichern));
  check('… 428 (art basis-fehlt) fällt in `shell.meldung(antwort.message, true)`: kein POST-Wiederholen, keine Basis erfunden', /shell\.meldung\(antwort\.message, true\);\s*return false;\s*\}/.test(speichern) && !/basis-fehlt/.test(speichern));

  // — Abgleich: HOLEN ändert die Basis nicht —
  check('Kein serverHash und kein setzeServerHash mehr im Editor (die Basis ist die des Entwurfs, nicht der zuletzt gelesene Serverstand)', !/serverHash|setzeServerHash/.test(q));
  check('basisMerken wird nur in setzeEntwurfBasis aufgerufen (Editor UND Begleitzettel), an keiner anderen Stelle', zaehle(/entwurfsSpeicher\.basisMerken\(/g, q) === 1 && /function setzeEntwurfBasis\(hash: string \| null\): void \{\s*entwurfsSpeicher\.basisMerken\(hash\);\s*\}/.test(q));
  check('setzeEntwurfBasis hat genau fünf Aufrufer: Start-Abgleich (Übernahme, Behalten), Speichern, 409-Abgleich (Laden, Behalten)', zaehle(/\bsetzeEntwurfBasis\(/g, q) === 1 + 5, String(zaehle(/\bsetzeEntwurfBasis\(/g, q)));
  const iWahl = start.indexOf('const wahl = await frage(');
  const iErster = start.indexOf('setzeEntwurfBasis(');
  const iZweiter = start.indexOf('setzeEntwurfBasis(', iErster + 1);
  const iAlles = start.indexOf("const geschrieben = alles('server');");
  const iFrueh = start.indexOf('const entwurf = entwurfsSpeicher.entwurfNachAbgleich();');
  check('Start-Abgleich: kein setzeEntwurfBasis beim bloßen Holen — der erste Aufruf steht in uebernehmen NACH alles(\'server\'), der zweite NACH der Dialogantwort', iWahl > 0 && iFrueh > 0 && iAlles > iFrueh && iErster > iAlles && iErster < iWahl && iZweiter > iWahl && start.indexOf('setzeEntwurfBasis(', iZweiter + 1) === -1, `Positionen ${iFrueh} < ${iAlles} < ${iErster} < ${iWahl} < ${iZweiter}`);
  check('… der erste Aufruf nur, wenn der Entwurf im Speicher steht: if (entwurfImSpeicher(geschrieben)) setzeEntwurfBasis(stand.hash)', /if \(entwurfImSpeicher\(geschrieben\)\) setzeEntwurfBasis\(stand\.hash\);/.test(start));
  check('… „Entwurf behalten" setzt die gezeigte Basis (stand.hash), aber nicht bei fremd (behalten === \'fremd\' → return davor)', /const behalten = speichereEntwurf\([^)]*\);[\s\S]*?if \(behalten === 'fremd'\) return;\s*setzeEntwurfBasis\(stand\.hash\);/.test(start));
  check('… und sagt deutlich, dass der Serverstand beim nächsten Speichern (auch aus dem Testflug) ersetzt wird — im Knopf und in der Meldung', /Serverstand wird beim nächsten Speichern ersetzt — auch aus dem Testflug/.test(start) && /function behaltenMeldung/.test(q) && /Speichern \(auch aus dem Testflug\) durch deinen Entwurf ersetzt/.test(q));
  check('409-Abgleich: kein setzeEntwurfBasis vor der Dialogantwort', abgleich.indexOf('setzeEntwurfBasis(') > abgleich.indexOf('const wahl = await frage('), String(abgleich.indexOf('setzeEntwurfBasis(')));
  check('… „Serverstand laden": Basis nach alles(\'server\'), nur bei im Speicher stehendem Entwurf', /const grund = alles\('server'\);[\s\S]*?if \(entwurfImSpeicher\(grund\)\) setzeEntwurfBasis\(stand\.hash\);/.test(abgleich));
  check('… „Entwurf behalten": ein zwischenzeitlich geänderter Entwurf (abgleichen() → true) bekommt keine Basis; sonst die gezeigte, mit deutlicher Meldung', /if \(entwurfsSpeicher\.abgleichen\(\)\) return;\s*setzeEntwurfBasis\(stand\.hash\);\s*shell\.meldung\(behaltenMeldung\(weltName\(\)\), true\);/.test(abgleich));
  check('veraltetAbgleichen schreibt selbst NICHT auf den Server (0 POSTs im 409-Zweig)', !/schreibeWeltdokument\(|fetch\(|method: 'POST'/.test(abgleich));
  check('… und benutzt den vorhandenen Abgleich-Dialog (frage, unterschiedsTafel, vergleiche)', /frage\(/.test(abgleich) && /unterschiedsTafel\(/.test(abgleich) && /vergleiche\(stand\.layout, sauber\)/.test(abgleich));
}

// ── 8b. 428: der Betriebsdienst verlangt eine Basis ──────────────────
console.log('▶ 428: Basis fehlt — verständlich melden, nichts wiederholen');
{
  const { fetchFn, aufrufe } = attrappe([{ status: 428, rumpf: { ok: false, fehler: 'basis-fehlt', message: 'If-Match fehlt' } }]);
  const a = await schreibeWeltdokument(echt, null, fetchFn);
  check('art=basis-fehlt (nicht „fehler" mit dem technischen Dienst-Text)', a.art === 'basis-fehlt', JSON.stringify(a));
  check('… die Meldung sagt: nicht gespeichert, erst Serverstand laden/abgleichen', /Nicht gespeichert/.test(a.message) && /Serverstand laden oder abgleichen/.test(a.message) && a.message === BASIS_FEHLT, a.message);
  check('… genau ein POST, kein Wiederholen', aufrufe.length === 1 && posts(aufrufe) === 1);
  const roh = await schreibeWeltdokument(echt, null, attrappe([{ status: 428, roh: '<html>' }]).fetchFn);
  check('428 ohne JSON: dieselbe Meldung', roh.art === 'basis-fehlt' && roh.message === BASIS_FEHLT);
}

// ── 9. Meldungen: 503 gesperrt (B5), verworfene Einträge bei 200 (B4) ──
console.log('▶ 503 gesperrt und verworfene Einträge');
{
  const { fetchFn, aufrufe } = attrappe([
    { status: 503, rumpf: { ok: false, fehler: 'gesperrt', message: 'dev.json ist gesperrt (gehalten von pid 4711 auf Rechner x)' }, kopf: { 'Retry-After': '3' } },
  ]);
  const a = await schreibeWeltdokument(echt, 'h1', fetchFn);
  check('503: art=fehler, nichts wiederholt (1 Aufruf)', a.art === 'fehler' && aufrufe.length === 1, JSON.stringify(a));
  check('503: verständliche Meldung („in ein paar Sekunden erneut versuchen"), Retry-After genannt, nichts geschrieben',
    /in ein paar Sekunden erneut versuchen/.test(a.message) && /Retry-After: 3 s/.test(a.message) && /nichts geschrieben/.test(a.message), a.message);
  check('503: die technische Sperrmeldung (pid/Rechner) steht nicht in der Nutzermeldung', !/pid|Rechner/.test(a.message), a.message);
  const ohneKopf = await schreibeWeltdokument(echt, 'h1', attrappe([{ status: 503, rumpf: { ok: false, fehler: 'gesperrt' } }]).fetchFn);
  check('503 ohne Retry-After: dieselbe Meldung, ohne Zahl', ohneKopf.art === 'fehler' && /in ein paar Sekunden erneut versuchen/.test(ohneKopf.message) && !/Retry-After/.test(ohneKopf.message), ohneKopf.message);
}
{
  const { fetchFn } = attrappe([
    { status: 200, rumpf: { ok: true, message: 'Gespeichert in dev.json: 1 Platzierung(en)', hash: 'h5', verworfen: 2, verworfenJeFeld: { placements: 2, rivers: 0 } } },
  ]);
  const a = await schreibeWeltdokument(echt, 'h1', fetchFn);
  check('200 mit verworfen=2: art=ok, Hash übernommen', a.art === 'ok' && a.hash === 'h5', JSON.stringify(a));
  check('… die Erfolgsmeldung nennt die Zahl (2) und das Feld (placements: 2), nicht das Nullfeld', /2 Eintrag/.test(a.message) && /placements: 2/.test(a.message) && !/rivers/.test(a.message), a.message);
  const still = await schreibeWeltdokument(echt, 'h1', attrappe([{ status: 200, rumpf: { ok: true, message: 'Gespeichert in dev.json', hash: 'h6' } }]).fetchFn);
  check('200 ohne verworfen: Meldung unverändert', still.art === 'ok' && still.message === 'Gespeichert in dev.json', still.message);
  const null_ = await schreibeWeltdokument(echt, 'h1', attrappe([{ status: 200, rumpf: { ok: true, message: 'Gespeichert', hash: 'h6', verworfen: 0 } }]).fetchFn);
  check('200 mit verworfen=0: Meldung unverändert', null_.art === 'ok' && null_.message === 'Gespeichert', null_.message);
}

console.log(fehler === 0 ? '\nalle Prüfungen bestanden' : `\n${fehler} Prüfung(en) FEHLGESCHLAGEN`);
process.exit(fehler === 0 ? 0 : 1);
