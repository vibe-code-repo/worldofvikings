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
import { vergleiche, type Unterschied } from '../src/editor/weltdokument';
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

console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
