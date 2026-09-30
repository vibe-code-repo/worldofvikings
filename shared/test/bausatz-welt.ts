/**
 * Bausatz-Instanzen im Weltdokument (C2): Sanitizer, 422-Liste (8 Regeln = 8 Fälle), Grenze 257,
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
  pruefe('yaw außerhalb ±2π wird geklemmt (keine Regel)', sanitizeBausatzInstanzen([inst({ yaw: 100 })])[0]!.yaw === 6.283185);
  pruefe('kennungen = Platzierungs-id wird verworfen', sanitizeBausatzInstanzen([inst({ kennungen: { t: eineId, u: 'frei' } })], platzierungsIds)[0]!.kennungen!.t === undefined);
  const zwei = sanitizeBausatzInstanzen([inst({ kennungen: { t: 'x1' } }), inst({ id: 'dorf-2', kennungen: { t: 'x1', u: 'x2' } })]);
  pruefe('kennungen zweimal vergeben: die zweite Instanz verliert den Wert', zwei.find((i) => i.id === 'dorf-2')!.kennungen!.t === undefined && zwei.find((i) => i.id === 'dorf-2')!.kennungen!.u === 'x2' && zwei.find((i) => i.id === 'dorf-1')!.kennungen!.t === 'x1');
  pruefe('keine Liste → leer', sanitizeBausatzInstanzen('x').length === 0 && sanitizeBausatzInstanzen(undefined).length === 0);
  const t = JSON.stringify(sanitizeBausatzInstanzen([inst({ kennungen: { b: 'q', a: 'p' } })]));
  pruefe('Rundlauf Instanzen byte-gleich', JSON.stringify(sanitizeBausatzInstanzen(JSON.parse(t))) === t);
}

// ── 422-Liste: acht Regeln, acht Fälle ──────────────────────────────────
const REGELN = 8;
const faelle: Array<{ regel: string; roh: unknown[]; erwartetFeld: string }> = [
  { regel: '1 Instanz ist kein Objekt', roh: ['x'], erwartetFeld: 'eintrag' },
  { regel: '2 id/bausatz fehlt oder kein ID_RE', roh: [inst({ bausatz: 'GROSS Nein' })], erwartetFeld: 'bausatz' },
  { regel: '3 x/z außerhalb des Weltrahmens', roh: [inst({ x: 1e7 })], erwartetFeld: 'x' },
  { regel: '4 unbekannter Schlüssel', roh: [inst({ Yaw: 1 })], erwartetFeld: 'schluessel' },
  { regel: '5 dieselbe id doppelt mit anderem Inhalt', roh: [inst(), inst({ x: 5 })], erwartetFeld: 'id' },
  { regel: '6 kennungen kein Objekt / Wert kein ID_RE', roh: [inst({ kennungen: { a: 'Nicht Gut' } })], erwartetFeld: 'kennungen' },
  { regel: '7 kennungen-Wert = Platzierungs-id', roh: [inst({ kennungen: { a: eineId } })], erwartetFeld: 'kennungen' },
  { regel: '8 kennungen-Wert zweimal vergeben', roh: [inst({ kennungen: { a: 'gleich', b: 'gleich' } })], erwartetFeld: 'kennungen' },
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

console.log(fehler === 0 ? 'ALLES OK' : `${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
