/**
 * Bausatz-Instanzen im Weltdokument (C2): Sanitizer, 422-Liste (9 Regeln = 9 Fälle, dazu Zusatzfälle N1/N2), Grenze 257,
 * Rundlauf, Altbestand mit dem echten dev.json (nur gelesen), pruefeLayout-Befunde, Vorgang `bausaetze`.
 *
 * Lauf: npx tsx shared/test/bausatz-welt.ts   (aus shared/)
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bausatzInstanzenFehler, sanitizeBausatzInstanzen, sanitizeBausatz } from '../src/bausatz/sanitize.js';
import { BAUSATZ_INSTANZEN_MAX } from '../src/bausatz/types.js';
import {
  LayoutBausaetzeUngueltig,
  LayoutFeldUngueltig,
  LayoutZuVieleBausaetze,
  layoutSchreiben,
  layoutText,
} from '../src/worldlayout/layoutDatei.js';
import { PREFABS_BY_NAME, istEigenesModell } from '../src/prefabs.js';
import { pruefeLayout } from '../src/worldlayout/pruefung.js';
import { OP_COLLECTIONS, wende } from '../src/worldlayout/ops.js';
import { sanitizeWorldLayout } from '../src/worldlayout/sanitize.js';

let fehler = 0;
function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const devPfad = fileURLToPath(new URL('../../server/data/welten/dev.json', import.meta.url));
const devBytes = readFileSync(devPfad, 'utf8');
const dev = JSON.parse(devBytes) as Record<string, unknown>;
const devSauber = sanitizeWorldLayout(dev)!;
const platzierungsIds = new Set((devSauber.placements ?? []).map((p) => p.id!));
const eineId = [...platzierungsIds][0]!;

const inst = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id: 'dorf-1', bausatz: 'startdorf', x: -22600, z: -5800.5, yaw: 0.5, ...extra });

// ── Sanitizer der Instanzen ─────────────────────────────────────────────
{
  const s = sanitizeBausatzInstanzen([inst({ x: -22600.00049, kennungen: { b: 'alt-b', a: 'alt-a' } }), inst({ id: 'a-dorf', yaw: 0 })]);
  pruefe('Instanzen nach id sortiert', s.map((i) => i.id).join() === 'a-dorf,dorf-1');
  pruefe('x auf 1e-3 gerundet', s[1]!.x === -22600);
  pruefe('yaw 0 entfällt', s[0]!.yaw === undefined && !('yaw' in s[0]!));
  pruefe('kennungen sortiert', Object.keys(s[1]!.kennungen!).join() === 'a,b');
  pruefe('kaputte Instanz verschwindet', sanitizeBausatzInstanzen([5, null, { id: 'ok', bausatz: 'k', x: 1e9, z: 0 }, inst()]).length === 1);
  pruefe('yaw außerhalb ±2π wird geklemmt (keine Regel)', sanitizeBausatzInstanzen([inst({ yaw: 100 })])[0]!.yaw === 2 * Math.PI);
// N2 A2/X7: der Sanitizer allein (Ladeweg beim Boot) nimmt nur eine Zahl als yaw; Nicht-Zahl = kein yaw
for (const yaw of ['1.5', true, null, [], {}, [1]]) {
  pruefe(`X7 sanitizeBausatzInstanzen yaw=${JSON.stringify(yaw)}: kein yaw`, sanitizeBausatzInstanzen([inst({ yaw })])[0]!.yaw === undefined);
  const w = sanitizeWorldLayout({ ...dev, bausaetze: [inst({ yaw })] })!;
  pruefe(`X7 sanitizeWorldLayout yaw=${JSON.stringify(yaw)}: Instanz bleibt, kein yaw`, w.bausaetze!.length === 1 && w.bausaetze![0]!.yaw === undefined);
}
  pruefe('kennungen = Platzierungs-id wird verworfen', sanitizeBausatzInstanzen([inst({ kennungen: { t: eineId, u: 'frei' } })], platzierungsIds)[0]!.kennungen!.t === undefined);
  const zwei = sanitizeBausatzInstanzen([inst({ kennungen: { t: 'x1' } }), inst({ id: 'dorf-2', kennungen: { t: 'x1', u: 'x2' } })]);
  pruefe('kennungen zweimal vergeben: die zweite Instanz verliert den Wert', zwei.find((i) => i.id === 'dorf-2')!.kennungen!.t === undefined && zwei.find((i) => i.id === 'dorf-2')!.kennungen!.u === 'x2' && zwei.find((i) => i.id === 'dorf-1')!.kennungen!.t === 'x1');
  pruefe('keine Liste → leer', sanitizeBausatzInstanzen('x').length === 0 && sanitizeBausatzInstanzen(undefined).length === 0);
  const t = JSON.stringify(sanitizeBausatzInstanzen([inst({ kennungen: { b: 'q', a: 'p' } })]));
  pruefe('Rundlauf Instanzen byte-gleich', JSON.stringify(sanitizeBausatzInstanzen(JSON.parse(t))) === t);
}

// ── 422-Liste: neun Regeln, neun Fälle ──────────────────────────────────
const REGELN = 9;
const faelle: Array<{ regel: string; roh: unknown[]; erwartetFeld: string }> = [
  { regel: '1 Instanz ist kein Objekt', roh: ['x'], erwartetFeld: 'eintrag' },
  { regel: '2 id/bausatz fehlt oder kein ID_RE', roh: [inst({ bausatz: 'GROSS Nein' })], erwartetFeld: 'bausatz' },
  { regel: '3 x/z außerhalb des Weltrahmens', roh: [inst({ x: 1e7 })], erwartetFeld: 'x' },
  { regel: '4 unbekannter Schlüssel', roh: [inst({ Yaw: 1 })], erwartetFeld: 'schluessel' },
  { regel: '5 dieselbe id doppelt mit anderem Inhalt', roh: [inst(), inst({ x: 5 })], erwartetFeld: 'id' },
  { regel: '6 kennungen kein Objekt / Wert kein ID_RE', roh: [inst({ kennungen: { a: 'Nicht Gut' } })], erwartetFeld: 'kennungen' },
  { regel: '7 kennungen-Wert = Platzierungs-id', roh: [inst({ kennungen: { a: eineId } })], erwartetFeld: 'kennungen' },
  { regel: '8 kennungen-Wert zweimal vergeben', roh: [inst({ kennungen: { a: 'gleich', b: 'gleich' } })], erwartetFeld: 'kennungen' },
  { regel: '9 yaw ist keine endliche Zahl', roh: [inst({ yaw: 'abc' })], erwartetFeld: 'yaw' },
];
// Zusatzfälle derselben Fehlerliste (Unterfälle von Regel 6 und 9)
const zusatz: Array<{ titel: string; roh: unknown[]; erwartetFeld: string }> = [
  ...[true, 'abc', null, [], '1.5', {}].map((yaw) => ({ titel: `Regel 9 yaw=${JSON.stringify(yaw)}`, roh: [inst({ yaw })], erwartetFeld: 'yaw' })),
  { titel: 'N1 kennungen-Schlüssel Gross', roh: [inst({ kennungen: { Gross: 'q1' } })], erwartetFeld: 'kennungen' },
  { titel: 'N1 kennungen-Schlüssel ö', roh: [inst({ kennungen: JSON.parse('{"ö":"alt-3","gut":"alt-4"}') })], erwartetFeld: 'kennungen' },
  { titel: 'N1 kennungen-Schlüssel __proto__', roh: [inst({ kennungen: JSON.parse('{"__proto__":"alt-1","gut":"alt-4"}') })], erwartetFeld: 'kennungen' },
  { titel: 'N2 4001 kennungen', roh: [inst({ kennungen: Object.fromEntries(Array.from({ length: 4001 }, (_, i) => [`t${i}`, `v${i}`])) })], erwartetFeld: 'kennungen' },
];
pruefe(`Zahl der Regeln (${REGELN}) = Zahl der Fälle (${faelle.length})`, faelle.length === REGELN);
const dir = mkdtempSync(join(tmpdir(), 'bausatz-c2-welt-'));
try {
  for (const f of faelle) {
    const liste = bausatzInstanzenFehler(f.roh, platzierungsIds);
    pruefe(`Regel ${f.regel}: Fehlerliste`, liste.length >= 1 && liste[0]!.feld === f.erwartetFeld, JSON.stringify(liste[0]));
    let klasse = '';
    try {
      layoutSchreiben(join(dir, `regel-${f.regel[0]}.json`), { ...dev, bausaetze: f.roh });
    } catch (e) {
      klasse = e instanceof LayoutBausaetzeUngueltig ? `LayoutBausaetzeUngueltig:${e.fehlerhaft.length}` : e instanceof LayoutFeldUngueltig ? 'LayoutFeldUngueltig' : String(e);
    }
    // Der Schreibweg wirft die benannte Klasse (bzw. „alle verworfen“, wenn nichts übrig bleibt): nie 200.
    pruefe(`Regel ${f.regel}: Schreibweg lehnt ab`, klasse.startsWith('LayoutBausaetzeUngueltig') || klasse === 'LayoutFeldUngueltig', klasse);
  }

  for (const f of zusatz) {
    const liste = bausatzInstanzenFehler(f.roh, platzierungsIds);
    let klasse = '';
    try {
      layoutSchreiben(join(dir, 'zusatz.json'), { ...dev, bausaetze: f.roh });
    } catch (e) {
      klasse = e instanceof LayoutBausaetzeUngueltig || e instanceof LayoutFeldUngueltig ? 'abgelehnt' : String(e);
    }
    pruefe(`Zusatzfall ${f.titel}: Fehlerliste und Ablehnung`, liste.some((x) => x.feld === f.erwartetFeld) && klasse === 'abgelehnt', `${JSON.stringify(liste[0])} ${klasse}`);
  }
  pruefe('Grenzfälle ok: 4000 kennungen, yaw ±2π, yaw 7 (geklemmt, keine Regel)', bausatzInstanzenFehler([inst({ kennungen: Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`t${i}`, `v${i}`])) }), inst({ id: 'b', yaw: 7 }), inst({ id: 'c', yaw: -100 })]).length === 0);
  pruefe('N2 Sanitizer wirft überlange kennungen nicht still zur Hälfte weg: ganz ohne Feld', sanitizeBausatzInstanzen([inst({ kennungen: Object.fromEntries(Array.from({ length: 4001 }, (_, i) => [`t${i}`, `v${i}`])) })])[0]!.kennungen === undefined);
  {
    // Zeit: 256 Instanzen × 4 000 kennungen (Körpergrenze des Betriebsdienstes ist der einzige andere Deckel)
    const gross = Array.from({ length: 256 }, (_, i) => inst({ id: `g-${i}`, kennungen: Object.fromEntries(Array.from({ length: 4000 }, (_, j) => [`t${j}`, `v${i}-${j}`])) }));
    const t0 = performance.now();
    const l = bausatzInstanzenFehler(gross, platzierungsIds);
    const t1 = performance.now();
    const sau = sanitizeBausatzInstanzen(gross, platzierungsIds);
    const t2 = performance.now();
    console.log(`N2 Zeit 256 × 4000 kennungen: Fehlerliste ${Math.round(t1 - t0)} ms, Sanitizer ${Math.round(t2 - t1)} ms (${l.length} Fehler, ${sau.length} Instanzen)`);
    pruefe('N2 256 × 4000 kennungen: beide Wege unter 10 s, keine Fehler', l.length === 0 && sau.length === 256 && t2 - t0 < 10000);
  }
  pruefe('Text der Meldung nennt Anzahl und Instanz', (() => {
    try {
      layoutSchreiben(join(dir, 'm.json'), { ...dev, bausaetze: [inst({ x: 1e7 }), inst({ id: 'ok-2' })] });
    } catch (e) {
      return e instanceof LayoutBausaetzeUngueltig && /1 Fehler in Bausatz-Instanzen \(dorf-1 x=/.test(e.message) && e.fehlerhaft[0]!.id === 'dorf-1';
    }
    return false;
  })());

  // Gültige identische Wiederholung ist kein Fehler (der Sanitizer fasst sie zusammen)
  pruefe('dieselbe id mit gleichem Inhalt: kein Fehler', bausatzInstanzenFehler([inst(), inst()]).length === 0);
  // Unbekannter Bausatz ist KEINE 422-Regel
  pruefe('unbekannter Bausatz: keine Fehlerliste', bausatzInstanzenFehler([inst({ bausatz: 'gibt-es-nicht' })]).length === 0);
  const okPfad = join(dir, 'ok.json');
  let geschrieben = false;
  try {
    layoutSchreiben(okPfad, { ...dev, bausaetze: [inst({ bausatz: 'gibt-es-nicht' })] });
    geschrieben = true;
  } catch {
    /* fällt durch */
  }
  pruefe('unbekannter Bausatz: Schreibweg nimmt das Dokument an', geschrieben && JSON.parse(readFileSync(okPfad, 'utf8')).bausaetze[0].bausatz === 'gibt-es-nicht');

  // ── Grenzen ───────────────────────────────────────────────────────────
  const viele = Array.from({ length: BAUSATZ_INSTANZEN_MAX + 1 }, (_, i) => inst({ id: `i-${i}` }));
  let g: unknown;
  try {
    layoutSchreiben(join(dir, 'viele.json'), { ...dev, bausaetze: viele });
  } catch (e) {
    g = e;
  }
  pruefe('257 Instanzen: LayoutZuVieleBausaetze mit Zahlen', g instanceof LayoutZuVieleBausaetze && g.anzahl === 257 && g.grenze === 256 && /257 Bausatz-Instanzen — mehr als 256/.test(g.message));
  const genau = Array.from({ length: BAUSATZ_INSTANZEN_MAX }, (_, i) => inst({ id: `i-${i}` }));
  let genauOk = true;
  try {
    layoutSchreiben(join(dir, 'genau.json'), { ...dev, bausaetze: genau });
  } catch {
    genauOk = false;
  }
  pruefe('256 Instanzen: angenommen, keine Kappung', genauOk && JSON.parse(readFileSync(join(dir, 'genau.json'), 'utf8')).bausaetze.length === 256);
  pruefe('Nicht-Liste: LayoutFeldUngueltig', (() => {
    try {
      layoutSchreiben(join(dir, 'nl.json'), { ...dev, bausaetze: { a: 1 } });
    } catch (e) {
      return e instanceof LayoutFeldUngueltig && e.feld === 'bausaetze';
    }
    return false;
  })());
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ── Weltdokument: Rundlauf und Altbestand ────────────────────────────────
{
  const mit = sanitizeWorldLayout({ ...dev, bausaetze: [inst({ kennungen: { b: 'nb', a: 'na' } }), inst({ id: 'a-2', x: 3.00049 })] })!;
  const t1 = layoutText(mit);
  const t2 = layoutText(sanitizeWorldLayout(JSON.parse(t1))!);
  pruefe('Rundlauf Weltdokument mit bausaetze: byte-gleich', t1 === t2 && (mit.bausaetze?.length ?? 0) === 2);
  const ohne = layoutText(devSauber);
  pruefe('Altbestand: dev.json ohne bausaetze → kein Feld im Ergebnis', !ohne.includes('"bausaetze"') && devSauber.bausaetze === undefined);
  pruefe('Altbestand: sanitize(sanitize(dev)) byte-gleich sanitize(dev)', layoutText(sanitizeWorldLayout(JSON.parse(ohne))!) === ohne);
  pruefe('Altbestand: dev.json blieb unverändert gelesen (nur Lesen)', readFileSync(devPfad, 'utf8') === devBytes);
  // Das Weltdokument ohne das Feld hat dieselben Bytes wie das mit leerer Liste
  pruefe('leere Liste = kein Feld', layoutText(sanitizeWorldLayout({ ...dev, bausaetze: [] })!) === ohne);
}

// ── pruefeLayout ────────────────────────────────────────────────────────
{
  const kit = sanitizeBausatz({
    bausatzVersion: 1,
    id: 'kit',
    name: 'Kit',
    grundflaeche: { halbX: 5, halbZ: 5 },
    teile: [
      { id: 'p1', prefab: 'U_Nichts', dx: 0, dz: 0, yaw: 0, scale: 1 },
      { id: 'p2', prefab: 'U_Nichts', dx: 1, dz: 0, yaw: 0, scale: 1 },
      { id: 'p3', prefab: 'U_Anderes', dx: 2, dz: 0, yaw: 0, scale: 1 },
    ],
  })!;
  const welt = sanitizeWorldLayout({ ...dev, bausaetze: [inst({ id: 'k-1', bausatz: 'kit' }), inst({ id: 'k-2', bausatz: 'kit', x: 9 }), inst({ id: 'weg', bausatz: 'fehlt' })] })!;
  const befunde = pruefeLayout(welt, new Map([['kit', kit]])).filter((b) => b.art === 'bausatz');
  pruefe('unbekannter Bausatz: ein Befund mit ref', befunde.some((b) => b.text.startsWith('unbekannter Bausatz: fehlt') && b.ref?.sammlung === 'bausaetze' && b.ref.id === 'weg'));
  pruefe('unbekanntes Prefab je Name und Bausatz gezählt (2 Teile, eine Zeile, trotz 2 Instanzen)', befunde.filter((b) => b.text.startsWith('unbekanntes Prefab: U_Nichts')).length === 1 && befunde.some((b) => b.text === 'unbekanntes Prefab: U_Nichts (2 Teile in kit)'), JSON.stringify(befunde.map((b) => b.text)));
  pruefe('Einzahl: 1 Teil; insgesamt 3 Befunde (Bausatz + 2 Prefab-Namen)', befunde.some((b) => b.text === 'unbekanntes Prefab: U_Anderes (1 Teil in kit)') && befunde.length === 3, String(befunde.length));
  pruefe('ohne Katalog: keine Bausatz-Befunde', pruefeLayout(welt).every((b) => b.art !== 'bausatz'));
}

// ── pruefeLayout: kein eigenes Modell, verwaiste Kennungen (N3) ─────────
{
  const namen = [...PREFABS_BY_NAME.keys()];
  const eigen = namen.find((n) => istEigenesModell(n))!;
  const fremd = namen.find((n) => !istEigenesModell(n))!;
  pruefe('Probe: je ein eigenes und ein fremdes Prefab gefunden', !!eigen && !!fremd);
  const kit = sanitizeBausatz({
    bausatzVersion: 1,
    id: 'kit',
    name: 'Kit',
    grundflaeche: { halbX: 5, halbZ: 5 },
    teile: [
      { id: 'p1', prefab: fremd, dx: 0, dz: 0, yaw: 0, scale: 1 },
      { id: 'p2', prefab: fremd, dx: 1, dz: 0, yaw: 0, scale: 1 },
      { id: 'p3', prefab: eigen, dx: 2, dz: 0, yaw: 0, scale: 1 },
    ],
  })!;
  const katalog = new Map([['kit', kit]]);
  const welt = sanitizeWorldLayout({
    ...dev,
    bausaetze: [
      inst({ id: 'k-1', bausatz: 'kit', kennungen: { p1: 'adr-1', weg: 'adr-weg' } }),
      inst({ id: 'k-2', bausatz: 'kit', x: 9, kennungen: { weg: 'adr-zwei' } }),
      inst({ id: 'k-3', bausatz: 'kit', x: 18 }),
    ],
  })!;
  const befunde = pruefeLayout(welt, katalog);
  const modell = befunde.filter((b) => b.art === 'modell' && b.wo === 'bausaetze');
  pruefe('kein eigenes Modell: je Name und Bausatz gezählt (2 Teile, eine Zeile, trotz 3 Instanzen)', modell.length === 1 && modell[0]!.text === `kein eigenes Modell: ${fremd} (2 Teile in kit)`, JSON.stringify(modell.map((b) => b.text)));
  pruefe('kein eigenes Modell: das eigene Prefab wird nicht gemeldet', !befunde.some((b) => b.text.includes(`: ${eigen} `)));
  pruefe('kein eigenes Modell: ohne Katalog kein Befund für Teile', pruefeLayout(welt).every((b) => b.wo !== 'bausaetze'));
  const verwaist = befunde.filter((b) => b.text.startsWith('verwaiste Kennung'));
  pruefe('verwaiste Kennung: je Instanz eine Zeile (k-1, k-2), nicht für p1 und nicht für k-3', verwaist.length === 2 && verwaist.every((b) => b.art === 'bausatz' && b.wo === 'bausaetze'), JSON.stringify(verwaist.map((b) => b.text)));
  pruefe('verwaiste Kennung: Text nennt Instanz, Teil-id und Adresse', verwaist.some((b) => b.text.includes('k-1') && b.text.includes('weg') && b.text.includes('adr-weg') && b.ref?.id === 'k-1') && verwaist.some((b) => b.text.includes('k-2') && b.text.includes('adr-zwei') && b.ref?.id === 'k-2'));
  pruefe('verwaiste Kennung: gültiger Eintrag (p1 → adr-1) bleibt stumm', !befunde.some((b) => b.text.includes('adr-1')));
  pruefe('verwaiste Kennung: ohne Katalog kein Befund', pruefeLayout(welt).every((b) => !b.text.startsWith('verwaiste Kennung')));
}

// ── Vorgang auf `bausaetze` ─────────────────────────────────────────────
{
  pruefe("'bausaetze' in OP_COLLECTIONS", (OP_COLLECTIONS as readonly string[]).includes('bausaetze'));
  const basis = sanitizeWorldLayout({ ...dev, bausaetze: [inst()] })!;
  const neu = { id: 'dorf-1', bausatz: 'startdorf', x: -22590, z: -5800.5, yaw: 0.5 };
  const r = wende(basis, { vorgangId: 'v1', ops: [{ art: 'aendere', sammlung: 'bausaetze', id: 'dorf-1', vorher: basis.bausaetze![0], nachher: neu }] });
  pruefe('aendere Instanz (verschieben)', r.ok && r.layout.bausaetze![0]!.x === -22590, JSON.stringify(r).slice(0, 200));
  const r2 = wende(basis, { vorgangId: 'v2', ops: [{ art: 'setze', sammlung: 'bausaetze', id: 'zweite', nachher: { id: 'zweite', bausatz: 'hafen', x: 1, z: 2 } }] });
  pruefe('setze Instanz', r2.ok && r2.layout.bausaetze!.length === 2);
  const r3 = wende(basis, { vorgangId: 'v3', ops: [{ art: 'entferne', sammlung: 'bausaetze', id: 'dorf-1', vorher: basis.bausaetze![0] }] });
  pruefe('entferne Instanz', r3.ok && (r3.layout.bausaetze?.length ?? 0) === 0);
}

// ── M2: Vorgangsweg prüft Instanzen wie den Schreibweg (422-Art, nie stilles Streichen) ──
{
  const basis2 = sanitizeWorldLayout({ ...dev, bausaetze: [inst({ kennungen: { t: 'x1' } })] })!;
  const setze = (id: string, nachher: unknown): unknown => ({ vorgangId: `m2-${id}`, ops: [{ art: 'setze', sammlung: 'bausaetze', id, nachher }] });
  const abgelehnt = (titel: string, r: ReturnType<typeof wende>, feld: string): void => {
    pruefe(`M2 ${titel}: abgelehnt (art ungueltig = 422), nichts gestrichen`, !r.ok && r.art === 'ungueltig' && (r.fehlerhaft ?? []).some((f) => f.feld === feld), JSON.stringify(r.ok ? 'ok' : (r.fehlerhaft ?? r.message)).slice(0, 160));
  };
  abgelehnt('kennungen = Platzierungs-id', wende(basis2, setze('n-1', inst({ id: 'n-1', kennungen: { a: eineId, b: 'frei-b' } }))), 'kennungen');
  abgelehnt('kennungen-Wert doppelt in einer Instanz', wende(basis2, setze('n-2', inst({ id: 'n-2', kennungen: { a: 'gleich', b: 'gleich' } }))), 'kennungen');
  abgelehnt('Schlüssel Yaw', wende(basis2, setze('n-3', inst({ id: 'n-3', Yaw: 1.5 }))), 'schluessel');
  abgelehnt('yaw "abc"', wende(basis2, setze('n-4', inst({ id: 'n-4', yaw: 'abc' }))), 'yaw');
  abgelehnt('kennungen-Schlüssel Gross', wende(basis2, setze('n-5', inst({ id: 'n-5', kennungen: { Gross: 'q1' } }))), 'kennungen');
  abgelehnt('kennungen-Wert schon bei einer anderen Instanz', wende(basis2, setze('n-6', inst({ id: 'n-6', kennungen: { t: 'x1', u: 'x2' } }))), 'kennungen');
  for (const yaw of [true, null, [], '1.5', {}]) abgelehnt(`M4 yaw=${JSON.stringify(yaw)}`, wende(basis2, setze('n-7', inst({ id: 'n-7', yaw }))), 'yaw');
  const aend = wende(basis2, { vorgangId: 'm2-aend', ops: [{ art: 'aendere', sammlung: 'bausaetze', id: 'dorf-1', vorher: basis2.bausaetze![0], nachher: inst({ kennungen: { t: 'x1' }, yaw: 'abc' }) }] });
  abgelehnt('aendere mit yaw "abc"', aend, 'yaw');
  // Platzierung nimmt den kennungen-Wert einer Instanz
  const pl = wende(basis2, { vorgangId: 'm2-pl', ops: [{ art: 'setze', sammlung: 'placements', id: 'x1', nachher: { id: 'x1', prefab: 'Beech1', x: 5, z: 6 } }] });
  pruefe('M2 neue Platzierung mit id = kennungen-Wert einer Instanz: abgelehnt, Wert bleibt', !pl.ok && pl.art === 'ungueltig' && (pl.fehlerhaft ?? []).some((f) => f.id === 'dorf-1' && f.feld === 'kennungen') && basis2.bausaetze![0]!.kennungen!.t === 'x1', JSON.stringify(pl.ok ? 'ok' : pl.message).slice(0, 200));
  const gut = wende(basis2, setze('n-8', inst({ id: 'n-8', yaw: 7, kennungen: { t: 'frei-neu' } })));
  pruefe('M2 gültige Instanz (yaw 7 nur geklemmt) wird angenommen', gut.ok && gut.layout.bausaetze!.find((i) => i.id === 'n-8')!.yaw === 2 * Math.PI && gut.layout.bausaetze!.find((i) => i.id === 'dorf-1')!.kennungen!.t === 'x1');
}

// ── M16: der Welt-Sanitizer übergibt die Platzierungs-ids (Schutz im Boot und in wende) ──
{
  const k = sanitizeWorldLayout({ ...dev, bausaetze: [inst({ kennungen: { a: eineId, b: 'frei-b' } })] })!.bausaetze![0]!.kennungen!;
  pruefe('M16 sanitizeWorldLayout streicht kennungen-Wert = Platzierungs-id des Dokuments, lässt den freien', k.a === undefined && k.b === 'frei-b', JSON.stringify(k));
}

// ── M17: OP_LIMITS.bausaetze gilt in wende (257 Instanzen in einem Vorgang) ──
{
  const leer = sanitizeWorldLayout({ ...dev })!;
  const ops = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({ art: 'setze', sammlung: 'bausaetze', id: `z-${i}`, nachher: { id: `z-${i}`, bausatz: 'k', x: i, z: 0 } }));
  const r = wende(leer, { vorgangId: 'm17', ops: ops(257) });
  pruefe('M17 257 Instanzen per Vorgang: art grenze mit 257/256', !r.ok && r.art === 'grenze' && r.sammlung === 'bausaetze' && r.anzahl === 257 && r.grenze === 256, JSON.stringify(r.ok ? 'ok' : r).slice(0, 160));
  const r2 = wende(leer, { vorgangId: 'm17b', ops: ops(256) });
  pruefe('M17 256 Instanzen per Vorgang: angenommen', r2.ok && r2.layout.bausaetze!.length === 256);
}

console.log(fehler === 0 ? 'ALLES OK' : `${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
