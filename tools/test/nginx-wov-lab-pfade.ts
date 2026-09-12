/**
 * PRÜFT deploy/nginx/wov-lab.conf: alle Aufgaben des einen Ursprungs
 * (Bauer "Ein Ursprung im Container", 12.09.2026) stehen als eigener
 * `location`-Block in der Datei — inklusive der beiden Kollisionen
 * zwischen Webseite und Spiel unter `/assets/` und `/api/`: beide Seiten
 * liefern eigene Dateien unter demselben Präfix, die Webseite muss dort
 * zuerst geprüft werden.
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
  { weg: '/api/*.json (statische Daten der Webseite)', muster: /location\s+~\s+\^\/api\/[^\n{]*\\\.json[^\n{]*\{/ },
  { weg: '/api/accounts/ (Konten-API des Spielservers)', muster: /location\s+\/api\/accounts\/\s*\{/ },
  { weg: '/accounts/ (Konten-API, bare, fuer den eingebauten Anmeldedialog)', muster: /location\s+\/accounts\/\s*\{/ },
  { weg: '/api/ (Betriebsdienst)', muster: /location\s+\/api\/\s*\{/ },
  { weg: '/assets/ (Webseite: Schriften/Bilder, VOR den Spiel-Assets)', muster: /location\s+\/assets\/\s*\{[^}]*wov-web\/build\/assets\/[^}]*\}/ },
  { weg: '@spiel-assets (Fallback: Modelle/Texturen/Audio)', muster: /location\s+@spiel-assets\s*\{[^}]*\/opt\/worldofvikings\/assets\/[^}]*\}/ },
  { weg: '/ws (Spielserver-WebSocket)', muster: /location\s+\/ws\s*\{/ },
  /*
    Seit `world-of-vikings.com` ohne Basic-Auth auf diesen Container zeigt
    (12.09.2026), haengt an drei Bloecken ein Riegel gegen den
    oeffentlichen Namen. Er ist nicht zu sehen, wenn er wirkt — deshalb
    steht er hier: Faellt der Schalter beim naechsten Umbau weg, liegt der
    Betriebsdienst mit beigelegtem Admin-Token offen im Netz.
  */
  { weg: 'Schalter $oeffentlich wird gesetzt', muster: /set\s+\$oeffentlich\s+0;/ },
  { weg: 'Schalter erkennt world-of-vikings.com', muster: /if\s*\(\$host[\s\S]{0,80}?world-of-vikings/ },
  { weg: '/api/ (Betriebsdienst) ist unter dem oeffentlichen Namen dicht', muster: /location\s+\/api\/\s*\{[^}]*if\s*\(\$oeffentlich\)\s*\{\s*return\s+404/ },
  { weg: '/editor/ ist unter dem oeffentlichen Namen dicht', muster: /location\s+=\s*\/editor\/\s*\{\s*if\s*\(\$oeffentlich\)\s*\{\s*return\s+404/ },
  { weg: '/editor (ohne Schraegstrich) ebenso', muster: /location\s+=\s*\/editor\s*\{\s*if\s*\(\$oeffentlich\)\s*\{\s*return\s+404/ },
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

  console.log(
    fehler === 0
      ? `\nnginx-wov-lab-pfade: alle ${ERWARTUNGEN.length} Wege gefunden.\n`
      : `\nnginx-wov-lab-pfade: ${fehler} FEHLEND.\n`,
  );
  process.exit(fehler > 0 ? 1 : 0);
}

main();
