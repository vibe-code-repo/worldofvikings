/**
 * PRÜFT deploy/nginx-live.conf: der `$editor_host`-Schalter kennt jede
 * produktive Editor-Domain — ohne ihn wären `/editor.html` und `/api/`
 * (Betriebsdienst, `x-wov-token`) auf dem jeweiligen `play.*`-Host ohne
 * Passwortabfrage erreichbar, sobald der Editor dort freigeschaltet wird.
 *
 * Angriffsbefund F2 (Karte D1, Opus-Prüfung c2c2765): der Mutant
 * "nginx-live ohne editor.world-of-mmorpg.de" überlebte, weil kein Test
 * diese Datei überhaupt las. Textnachweis, keine echte nginx-Prüfung —
 * dieselbe Bauart und Begründung wie `tools/test/nginx-wov-lab-pfade.ts`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WURZEL = resolve(import.meta.dirname, '../..');
const PFAD = resolve(WURZEL, 'deploy/nginx-live.conf');

const ERWARTUNGEN: { weg: string; muster: RegExp }[] = [
  { weg: 'Schalter $editor_host wird gesetzt (Vorgabe 0)', muster: /map\s+\$host\s+\$editor_host\s*\{\s*default\s+0;/ },
  { weg: 'editor.world-of-vikings.com ⇒ 1', muster: /editor\.world-of-vikings\.com\s+1;/ },
  { weg: 'editor.world-of-mmorpg.com ⇒ 1 (Karte D1)', muster: /editor\.world-of-mmorpg\.com\s+1;/ },
  { weg: 'editor.world-of-mmorpg.de ⇒ 1 (Karte D1)', muster: /editor\.world-of-mmorpg\.de\s+1;/ },
  { weg: '/editor.html ist unter $editor_host = 0 dicht', muster: /location\s+=\s+\/editor\.html\s*\{\s*if\s*\(\$editor_host\s*=\s*0\)\s*\{\s*return\s+404;/ },
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
      ? `\nnginx-live-editor-host: alle ${ERWARTUNGEN.length} Zusicherungen gefunden.\n`
      : `\nnginx-live-editor-host: ${fehler} FEHLEND.\n`,
  );
  process.exit(fehler > 0 ? 1 : 0);
}

main();
