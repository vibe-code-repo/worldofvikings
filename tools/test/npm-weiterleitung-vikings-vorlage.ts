/**
 * PRÜFT deploy/npm-weiterleitung-vikings.conf gegen dieselbe Regel wie
 * wov-web/src/lib/basisDomains.ts (weiterleitungsZielVikings): /de/… auf
 * world-of-mmorpg.de, /en/… auf world-of-mmorpg.com, alles andere auf
 * world-of-mmorpg.com.
 *
 * Angriffsbefund E2 (Karte D1, Opus-Prüfung c2c2765): die Vorlage (Text,
 * NPM kann sie nicht ausführen und die Funktion nicht aufrufen) und die
 * Funktion (mit eigenem Test, `basisDomains.test.ts`) waren nicht
 * gekoppelt — ein Mutant, der in der Vorlage `/de` auf `.com` drehte,
 * überlebte, weil kein Test die Vorlage überhaupt las. Textnachweis wie
 * `nginx-wov-lab-pfade.ts`, keine echte nginx-Prüfung (die Vorlage ist
 * durchgehend auskommentiert, kein wirksamer Proxy-Host).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WURZEL = resolve(import.meta.dirname, '../..');
const PFAD = resolve(WURZEL, 'deploy/npm-weiterleitung-vikings.conf');

const ERWARTUNGEN: { weg: string; muster: RegExp }[] = [
  {
    weg: '/de/ (Präfix) leitet auf world-of-mmorpg.de',
    muster: /location\s+\/de\/\s*\{\s*#\s*return\s+301\s+https:\/\/world-of-mmorpg\.de\$request_uri;/,
  },
  {
    weg: '= /de (ohne Schrägstrich) leitet ebenso auf world-of-mmorpg.de',
    muster: /location\s+=\s+\/de\s*\{\s*#\s*return\s+301\s+https:\/\/world-of-mmorpg\.de\$request_uri;/,
  },
  {
    weg: '/en/ (Präfix) leitet auf world-of-mmorpg.com',
    muster: /location\s+\/en\/\s*\{\s*#\s*return\s+301\s+https:\/\/world-of-mmorpg\.com\$request_uri;/,
  },
  {
    weg: '= /en (ohne Schrägstrich) leitet ebenso auf world-of-mmorpg.com',
    muster: /location\s+=\s+\/en\s*\{\s*#\s*return\s+301\s+https:\/\/world-of-mmorpg\.com\$request_uri;/,
  },
  {
    weg: 'location / (Rückfall, alles andere) leitet auf world-of-mmorpg.com',
    muster: /location\s+\/\s*\{\s*#\s*return\s+301\s+https:\/\/world-of-mmorpg\.com\$request_uri;/,
  },
  {
    weg: 'die Subdomain-Regel leitet <name>.world-of-vikings.com auf <name>.world-of-mmorpg.com',
    muster: /return\s+301\s+https:\/\/<name>\.world-of-mmorpg\.com\$request_uri;/,
  },
];

function main(): void {
  let text: string;
  try {
    text = readFileSync(PFAD, 'utf-8');
  } catch (e) {
    console.log(`FEHLGESCHLAGEN — ${PFAD} nicht lesbar: ${(e as Error).message}`);
    process.exit(1);
  }

  let fehler = 0;
  for (const { weg, muster } of ERWARTUNGEN) {
    const treffer = muster.test(text);
    console.log(`${treffer ? 'OK  ' : 'FEHL'}  ${weg}`);
    if (!treffer) fehler++;
  }

  console.log(
    fehler === 0
      ? `\nnpm-weiterleitung-vikings-vorlage: alle ${ERWARTUNGEN.length} Zusicherungen gefunden.\n`
      : `\nnpm-weiterleitung-vikings-vorlage: ${fehler} FEHLEND.\n`,
  );
  process.exit(fehler > 0 ? 1 : 0);
}

main();
