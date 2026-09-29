/**
 * PRÜFT deploy/npm-weiterleitung-vikings.conf gegen dieselbe Regel wie
 * wov-web/src/lib/basisDomains.ts (weiterleitungsZielVikings): /de, /de/… und
 * /de?… auf world-of-mmorpg.de, alles andere (auch /deutsch) auf
 * world-of-mmorpg.com — Pfad und Query bleiben.
 *
 * Die Vorlage hält die Form fest, die seit dem 28.09.2026 im Nginx Proxy
 * Manager (Proxy-Host 3) auf SERVER-Ebene steht: drei Zeilen, kein
 * `location`-Block (der würde mit dem selbst erzeugten `location /` des
 * Proxy Managers kollidieren), mit Ausnahme für die ACME-Prüfung. Die Regel
 * selbst wird von wov-web/src/lib/domain-verdrahtung.test.ts gegen
 * weiterleitungsZielVikings ausgeführt; dieser Test hält den TEXT der Vorlage
 * (Textnachweis wie `nginx-wov-lab-pfade.ts`, keine echte nginx-Prüfung).
 *
 * Angriffsbefund E2 (Karte D1, Opus-Prüfung c2c2765): Vorlage und Funktion
 * waren nicht gekoppelt — ein Mutant, der in der Vorlage `/de` auf `.com`
 * drehte, überlebte, weil kein Test die Vorlage überhaupt las.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WURZEL = resolve(import.meta.dirname, '../..');
const PFAD = resolve(WURZEL, 'deploy/npm-weiterleitung-vikings.conf');
const BASIS = resolve(WURZEL, 'wov-web/src/lib/basisDomains.ts');

/** Eine wirksame Direktive der Vorlage: `# `-Zeile ohne das Kommentarzeichen. */
const ZEILE_ZIEL = 'set $d1_ziel world-of-mmorpg.com;';
const ZEILE_DE = 'if ($request_uri ~ "^/de(/|\\?|$)") { set $d1_ziel world-of-mmorpg.de; }';
const ZEILE_RETURN =
  'if ($request_uri !~ "^/\\.well-known/acme-challenge/") { return 301 https://$d1_ziel$request_uri; }';

function main(): void {
  let text: string;
  let basis: string;
  try {
    text = readFileSync(PFAD, 'utf-8');
    basis = readFileSync(BASIS, 'utf-8');
  } catch (e) {
    console.log(`FEHLGESCHLAGEN — Datei nicht lesbar: ${(e as Error).message}`);
    process.exit(1);
  }

  // Die Vorlage ist durchgehend auskommentiert: jede Zeile `# <Direktive>`
  // zählt als die Direktive; reine Erklärzeilen fallen durch ihren Inhalt heraus.
  const direktiven = text
    .split('\n')
    .map((z) => z.replace(/^#\s?/, ''))
    .filter((z) => /^(set|if)\s/.test(z));

  const ERWARTUNGEN: { weg: string; ok: boolean }[] = [
    {
      weg: 'server_name deckt world-of-vikings.com UND www. ab',
      ok: /^#\s*server_name\s+world-of-vikings\.com\s+www\.world-of-vikings\.com;$/m.test(text),
    },
    { weg: 'Vorgabe: alles geht nach world-of-mmorpg.com', ok: direktiven.includes(ZEILE_ZIEL) },
    {
      weg: '/de, /de/… und /de?… wählen world-of-mmorpg.de (kein /deutsch)',
      ok: direktiven.includes(ZEILE_DE),
    },
    {
      weg: '301 auf $d1_ziel$request_uri, ausser für die ACME-Prüfung',
      ok: direktiven.includes(ZEILE_RETURN),
    },
    {
      weg: 'die Vorlage schreibt KEINEN location-Block (Kollision mit dem Proxy Manager)',
      ok: !/^#\s*location\s/m.test(text),
    },
    {
      weg: 'Server-Ebene, ACME-Ausnahme und Rückweg „Feld leeren“ sind erklärt',
      ok: /Server-Ebene/.test(text) && /acme-challenge/.test(text) && /Feld .*leeren/.test(text),
    },
    {
      weg: 'die Subdomain-Regel gilt ausdrücklich erst mit dem nächsten Live-Stand',
      ok: /GILT ERST MIT DEM NAECHSTEN LIVE-STAND/.test(text),
    },
    {
      weg: 'die Subdomain-Regel leitet <name>.world-of-vikings.com auf <name>.world-of-mmorpg.com',
      ok: /return\s+301\s+https:\/\/<name>\.world-of-mmorpg\.com\$request_uri;/.test(text),
    },
    // Dieselbe Regel in weiterleitungsZielVikings: dieselben Verzweigungen
    // (das Verhalten selbst prüft wov-web/src/lib/domain-verdrahtung.test.ts).
    {
      weg: 'basisDomains.ts: /de und /de/… gehen nach MMORPG_DE, sonst MMORPG_COM',
      ok:
        /pfad === '\/de' \|\| pfad\.startsWith\('\/de\/'\)\) return `https:\/\/\$\{MMORPG_DE\}/.test(basis) &&
        /return `https:\/\/\$\{MMORPG_COM\}\$\{pfad\}\$\{anhang\}`;\s*\}/.test(basis),
    },
  ];

  let fehler = 0;
  for (const { weg, ok } of ERWARTUNGEN) {
    console.log(`${ok ? 'OK  ' : 'FEHL'}  ${weg}`);
    if (!ok) fehler++;
  }

  console.log(
    fehler === 0
      ? `\nnpm-weiterleitung-vikings-vorlage: alle ${ERWARTUNGEN.length} Zusicherungen gefunden.\n`
      : `\nnpm-weiterleitung-vikings-vorlage: ${fehler} FEHLEND.\n`,
  );
  process.exit(fehler > 0 ? 1 : 0);
}

main();
