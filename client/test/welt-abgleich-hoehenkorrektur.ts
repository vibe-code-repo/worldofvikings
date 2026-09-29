/**
 * Karte T1/N2 (Angriffsbefund N2): `vergleiche()` (Editor-Gegenüberstellung
 * Server/Entwurf, `client/src/editor/weltdokument.ts`) muss die Handkorrektur
 * der Geländehöhe (`heightDeltas`) INHALTLICH prüfen, nicht nur nach
 * Punktzahl. Rot auf 4234ef4 (T1/N1): dort verglich `vergleiche()` nur
 * `server.heightDeltas?.length` gegen `entwurf.heightDeltas?.length` — ein
 * Entwurf, der eine Korrektur durch eine ANDERE gleicher Größe ersetzt (Zone
 * getauscht, Delta geändert), zeigte identische Zahlen und wurde als
 * unauffällig markiert (`schwer: false`), obwohl der Nutzer beim Speichern
 * einen Verlust erlitten hätte.
 *
 * Geprüft: `schwer` gilt SOBALD eine Korrektur ENTFERNT oder GEÄNDERT wird
 * (fremde/ersetzte Zone, anderes Delta, weniger Punkte) — reines Umsortieren
 * zählt NICHT als schwer, reines Hinzufügen auch nicht. DOM-frei, ohne
 * Browser/Assets/GPU (KERN-Bedingung).
 *
 * Lauf:  npx tsx client/test/welt-abgleich-hoehenkorrektur.ts
 */
import { holeWeltdokument, importPruefen, schreibeWeltdokument, vergleiche, type Unterschied } from '../src/editor/weltdokument';
import type { WorldLayout, ZoneHeightDelta } from '@wov/shared';

let fehler = 0;
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}

function dok(heightDeltas?: ZoneHeightDelta[]): WorldLayout {
  return {
    version: 1,
    name: 'Handkorrektur-Vergleich-Test',
    detailSeed: 'x',
    continents: [],
    regions: [],
    ...(heightDeltas !== undefined ? { heightDeltas } : {}),
  } as unknown as WorldLayout;
}

function hoehenZeile(u: readonly Unterschied[]): Extract<Unterschied, { art: 'zeile' }> | undefined {
  return u.find((z): z is Extract<Unterschied, { art: 'zeile' }> => z.art === 'zeile' && z.feld === 'Handkorrektur (Rasterpunkte)');
}

const BASIS: ZoneHeightDelta[] = [
  { zx: 0, zz: 0, r: ['3|1,2,3|50,60,70'] },
  { zx: 1, zz: 0, r: ['5|10|100'] },
];

// ── 1) Identisch (auch bei anderer Reihenfolge/Formatierung): keine Zeile ──
{
  const server = dok(BASIS);
  const entwurfGleich = dok([BASIS[1]!, BASIS[0]!]); // Zonen vertauscht, Inhalt gleich
  const u = vergleiche(server, entwurfGleich);
  check(
    'Identischer Inhalt (Zonen nur umsortiert): KEINE Handkorrektur-Zeile (kein Verlust, keine Änderung)',
    hoehenZeile(u) === undefined,
    JSON.stringify(hoehenZeile(u))
  );
}

// ── 2) Ein Punkt ENTFERNT: schwer ──────────────────────────────────────
{
  const server = dok(BASIS);
  const entwurf = dok([{ zx: 0, zz: 0, r: ['3|1,2|50,60'] }, BASIS[1]!]); // Punkt rx=3 in Zeile 3 fehlt
  const u = vergleiche(server, entwurf);
  const z = hoehenZeile(u);
  check('Ein entfernter Punkt: Zeile vorhanden UND als schwer markiert', z !== undefined && z.schwer === true, JSON.stringify(z));
}

// ── 3) GLEICHE Punktzahl, aber ein Delta GEÄNDERT (der T1/N1-Blindfleck) ──
{
  const server = dok(BASIS);
  // Derselbe Punkt (Zone 1,0 / ry=5 / rx=10) bekommt ein ANDERES Delta — Punktzahl bleibt exakt gleich.
  const entwurf = dok([BASIS[0]!, { zx: 1, zz: 0, r: ['5|10|999'] }]);
  const u = vergleiche(server, entwurf);
  const z = hoehenZeile(u);
  check(
    'Gleiche Punktzahl, aber ein Delta geändert: Zeile vorhanden UND als schwer markiert (rot auf 4234ef4: ja, dort nur Punktzahl verglichen)',
    z !== undefined && z.schwer === true && z.server === z.entwurf,
    JSON.stringify(z)
  );
}

// ── 4) GLEICHE Punktzahl, aber eine ANDERE Zone ersetzt eine bestehende ──
{
  const server = dok(BASIS);
  // Zone (1,0) verschwindet, eine FREMDE Zone (9,9) mit derselben Punktzahl (1) taucht auf.
  const entwurf = dok([BASIS[0]!, { zx: 9, zz: 9, r: ['5|10|100'] }]);
  const u = vergleiche(server, entwurf);
  const z = hoehenZeile(u);
  check('Fremde Zone ersetzt eine bestehende (gleiche Gesamtpunktzahl): als schwer markiert', z !== undefined && z.schwer === true, JSON.stringify(z));
}

// ── 5) Nur HINZUGEFÜGT (ein neuer Punkt, nichts vom Server verloren): NICHT schwer ──
{
  const server = dok(BASIS);
  const entwurf = dok([{ zx: 0, zz: 0, r: ['3|1,2,3,4|50,60,70,80'] }, BASIS[1]!]); // rx=4 neu dazu, 1/2/3 unverändert
  const u = vergleiche(server, entwurf);
  const z = hoehenZeile(u);
  check(
    'Nur ein neuer Punkt dazu (nichts vom Server verloren/verändert): Zeile vorhanden, aber NICHT schwer',
    z !== undefined && z.schwer === false && z.server === '4' && z.entwurf === '5',
    JSON.stringify(z)
  );
}

// ── 6) Server ohne heightDeltas, Entwurf mit welchem: keine Zeile ist ausgeschlossen (nichts verloren) ──
{
  const server = dok(undefined);
  const entwurf = dok(BASIS);
  const u = vergleiche(server, entwurf);
  const z = hoehenZeile(u);
  check(
    'Server ohne heightDeltas, Entwurf hat welche dazu: Zeile vorhanden (0 vs 4 Punkte), NICHT schwer (reines Hinzufügen)',
    z !== undefined && z.schwer === false && z.server === '0' && z.entwurf === '4',
    JSON.stringify(z)
  );
}

function jsonAntwort(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ETag: '"neu"' } });
}

const GUELTIGES_LAYOUT: WorldLayout = dok([]);
const HOEHEN_UND_PLATZIERUNGEN = {
  ok: false,
  message: 'ungueltig',
  heightProblem: {
    reason: 'invalid',
    zonen: 1,
    punkte: 1,
    zoneLimit: 10,
    pointLimit: 20,
    fehlerhaftHoehe: [{ zone: '0,0', feld: 'r[0]', wert: 'kaputt' }],
  },
  fehlerhaftHoehe: [{ zone: '0,0', feld: 'r[0]', wert: 'kaputt' }],
  anzahlFehlerhaftHoehe: 1,
  fehlerhaft: [{ id: 'haus-1', feld: 'yaw', wert: 'abc' }],
  anzahlFehlerhaft: 1,
};

// ── 7) DOM-freier echter Schreibweg: Höhe UND Platzierungen in einer 422-Meldung ──
{
  const fetchFn: typeof fetch = async () => jsonAntwort(422, HOEHEN_UND_PLATZIERUNGEN);
  const de = await schreibeWeltdokument(GUELTIGES_LAYOUT, 'basis', fetchFn, 'de');
  check('POST 422 (de): Höhe und Platzierung stehen gemeinsam in der Fehlermeldung', de.art === 'fehler' && /0,0/.test(de.message) && /r\[0\]/.test(de.message) && /haus-1/.test(de.message) && /yaw/.test(de.message), JSON.stringify(de));
  const en = await schreibeWeltdokument(GUELTIGES_LAYOUT, 'basis', fetchFn, 'en');
  check('POST 422 (en): dieselbe kombinierte Meldung ist englisch auswählbar und enthält beide Listen', en.art === 'fehler' && /0,0/.test(en.message) && /haus-1/.test(en.message) && /yaw/.test(en.message) && !/Nicht gespeichert/.test(en.message), JSON.stringify(en));
}

// ── 8) DOM-freier echter Leseweg: GET 422 übernimmt nie ein mitgeliefertes gekürztes Layout ──
{
  const gekuerzt: WorldLayout = { ...GUELTIGES_LAYOUT, name: 'Darf nicht übernommen werden', heightDeltas: [] } as WorldLayout;
  const fetchFn: typeof fetch = async () => jsonAntwort(422, { ...HOEHEN_UND_PLATZIERUNGEN, layout: gekuerzt });
  const standDe = await holeWeltdokument(fetchFn, 'de');
  check('GET 422 (de): liefert Fehler statt gekürztes Layout zu übernehmen', standDe.erreichbar === false && /0,0/.test(standDe.grund) && /haus-1/.test(standDe.grund) && !('layout' in standDe), JSON.stringify(standDe));
  const standEn = await holeWeltdokument(fetchFn, 'en');
  check('GET 422 (en): übersetzter Fehlerzweig bleibt ohne Layoutübernahme', standEn.erreichbar === false && /0,0/.test(standEn.grund) && /haus-1/.test(standEn.grund) && !('layout' in standEn), JSON.stringify(standEn));
}

// ── 9) Legacy-Weg bleibt mutationssensitiv: fehlerhaftHoehe allein darf nicht stumm verschwinden ──
{
  const fetchFn: typeof fetch = async () =>
    jsonAntwort(422, {
      ok: false,
      art: 'hoehenkorrektur',
      fehlerhaftHoehe: [{ zone: '9,9', feld: 'delta', wert: 'NaN' }],
      anzahlFehlerhaftHoehe: 1,
    });
  const antwort = await schreibeWeltdokument(GUELTIGES_LAYOUT, 'basis', fetchFn, 'de');
  check('Legacy POST 422: fehlerhaftHoehe ohne heightProblem erzeugt weiterhin eine konkrete Höhenmeldung', antwort.art === 'fehler' && /9,9/.test(antwort.message) && /delta/.test(antwort.message) && /NaN/.test(antwort.message), JSON.stringify(antwort));
}

// ── 10) 202 bleibt ok (Datei geschrieben), lokalisiert aber verworfene Höhen vor generischen Hinweisen ──
{
  const fetchFn: typeof fetch = async () => jsonAntwort(202, { ...HOEHEN_UND_PLATZIERUNGEN, ok: true, message: 'File saved', angewendet: false, grund: 'verworfen' });
  const de = await schreibeWeltdokument(GUELTIGES_LAYOUT, 'basis', fetchFn, 'de');
  check('POST 202 (de): bleibt art ok und enthält Höhe + Platzierung in message/detail', de.art === 'ok' && /0,0/.test(de.message) && /haus-1/.test(de.message) && /0,0/.test(de.detail ?? '') && /haus-1/.test(de.detail ?? '') && de.grund === 'verworfen', JSON.stringify(de));
  const en = await schreibeWeltdokument(GUELTIGES_LAYOUT, 'basis', fetchFn, 'en');
  check('POST 202 (en): ok-Zweig nutzt Locale ohne deutschen Fehlerwrapper', en.art === 'ok' && /0,0/.test(en.message) && /haus-1/.test(en.message) && !/Nicht gespeichert/.test(en.message), JSON.stringify(en));
}

// Manual import is also a reader: never accept an editable sanitized remainder.
{
  const oversized = Array.from({ length: 5000 }, (_, index) => ({ zx: index % 64, zz: Math.floor(index / 64), r: ['0|0|1'] }));
  for (const [name, raw] of [['invalid', [{ zx: 0, zz: 0, r: ['0|0|1', '1|0|bad'] }]], ['string', 'kaputt'], ['over-limit', oversized]] as const) {
    for (const locale of ['de', 'en']) {
      const result = importPruefen(JSON.stringify({ ...dok(), heightDeltas: raw }), locale);
      check(`Import ${name}/${locale}: refuses whole correction with repair advice`, result.layout === null &&
        /Git/.test(result.message ?? '') && (locale === 'en' ? /height correction/i : /Höhenkorrektur/).test(result.message ?? ''), JSON.stringify(result));
    }
  }
  check('Import: valid correction is preserved', JSON.stringify(importPruefen(JSON.stringify(dok(BASIS))).layout?.heightDeltas) === JSON.stringify(BASIS));
  check('Import: absent correction is still accepted', importPruefen(JSON.stringify(dok())).layout !== null);
  const placementOnly = importPruefen(JSON.stringify({ ...dok(BASIS), placements: [{ id: 'import-tree', prefab: 'Beech1', x: 1, z: 1, yaw: 'bad' }] }));
  check('Import: placement-only cleanup still requires the existing decision', placementOnly.layout !== null && placementOnly.fehlerhaft.length > 0 && !placementOnly.message);
}

console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
