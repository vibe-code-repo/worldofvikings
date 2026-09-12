/**
 * PRÜFT deploy/nginx/wov-lab.conf: alle fünf Aufgaben des einen Ursprungs
 * (Bauer "Ein Ursprung im Container", 12.09.2026) stehen als eigener
 * `location`-Block in der Datei.
 *
 * ── Warum ein Textnachweis und keine echte nginx-Prüfung ─────────────
 * Diese Maschine hat kein installiertes nginx (`which nginx` — nichts).
 * `tools/dev-ursprung.mjs` bildet die Regeln als Node-Proxy nach und
 * bekommt seine eigene Browser-Probe; DIESER Test hält nur die Konfi-
 * gurationsdatei selbst fest, damit ein Umbenennen oder Löschen eines
 * Wegs (z. B. beim Umstieg auf gebaute Bündel statt Vite-Dev) sofort
 * rot wird — unabhängig davon, ob gerade ein nginx läuft oder nicht.
 *
 * Absichtlich GROB (Substring, keine echte nginx-Grammatik): Eine echte
 * Prüfung bräuchte einen nginx-Parser, den es hier nicht gibt, und ein
 * selbstgebauter wäre eine zweite, ungetestete Grammatik. Ein Substring-
 * Treffer kann nicht durch Zufall falsch positiv werden — die Wege sind
 * dafür zu genau benannt (`/api/accounts/`, nicht `/api/`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WURZEL = resolve(import.meta.dirname, '../..');
const PFAD = resolve(WURZEL, 'deploy/nginx/wov-lab.conf');

interface Erwartung {
  weg: string;
  /** Wonach in der Datei gesucht wird — ein location-Kopf, der den Weg trägt. */
  muster: RegExp;
}

const ERWARTUNGEN: Erwartung[] = [
  { weg: '/ (Webseite)', muster: /location\s+\/\s*\{/ },
  { weg: '/play/ (Spiel-Client)', muster: /location\s+\/play\/\s*\{/ },
  { weg: '/editor/ (Editor-Einstieg)', muster: /location\s+=?\s*\/editor\/\s*\{/ },
  { weg: '/api/accounts/ (Konten-API des Spielservers)', muster: /location\s+\/api\/accounts\/\s*\{/ },
  { weg: '/accounts/ (Konten-API, bare, fuer den eingebauten Anmeldedialog)', muster: /location\s+\/accounts\/\s*\{/ },
  { weg: '/api/ (Betriebsdienst)', muster: /location\s+\/api\/\s*\{/ },
  { weg: '/assets/ (statische Modelle/Texturen)', muster: /location\s+\/assets\/\s*\{/ },
  { weg: '/ws (Spielserver-WebSocket)', muster: /location\s+\/ws\s*\{/ },
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

  // Die Reihenfolge der location-Blöcke ist für nginx bedeutungslos (es
  // wählt den längsten passenden Präfix), aber ein Test, der das still
  // voraussetzt, sollte es wenigstens einmal aussprechen — nicht prüfen,
  // nur dokumentieren, warum hier keine Reihenfolge verlangt wird.
  console.log('(Reihenfolge der Blöcke ist für nginx-Präfixmatching ohne Bedeutung — nicht geprüft.)');

  console.log(fehler === 0 ? '\nnginx-wov-lab-pfade: alle acht Wege gefunden.\n' : `\nnginx-wov-lab-pfade: ${fehler} FEHLEND.\n`);
  process.exit(fehler > 0 ? 1 : 0);
}

main();
