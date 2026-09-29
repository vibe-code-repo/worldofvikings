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


/**
 * Entfernt nginx-Kommentare: ein `#` am Zeilenanfang oder nach Leerraum, aber
 * NICHT innerhalb eines Strings (`"a #b"`, `'a #b'`) — der frühere Filter
 * `/(^|\s)#.*$/` schnitt dort mitten im String ab und verschluckte den Rest
 * der Direktive.
 */
function ohneKommentare(text: string): string {
  return text
    .split('\n')
    .map((zeile) => {
      let anfuehrung = '';
      for (let i = 0; i < zeile.length; i++) {
        const c = zeile[i];
        if (anfuehrung) {
          if (c === '\\') i++;
          else if (c === anfuehrung) anfuehrung = '';
        } else if (c === '"' || c === "'") {
          anfuehrung = c;
        } else if (c === '#' && (i === 0 || /\s/.test(zeile[i - 1]))) {
          return zeile.slice(0, i);
        }
      }
      return zeile;
    })
    .join('\n');
}

/**
 * Der Inhalt (ohne äußere Klammern) des ersten Blocks, dessen Kopf auf `kopf`
 * passt, mit Klammer-Zählung — samt Tiefe des Kopfs (0 = oberste Ebene).
 * Strings zählen nicht mit.
 */
function block(text: string, kopf: RegExp): { inhalt: string; tiefe: number } | null {
  const treffer = new RegExp(kopf.source + '\\s*\\{', kopf.flags).exec(text);
  if (!treffer) return null;
  const von = treffer.index + treffer[0].length;
  let tiefe = 0;
  let anfuehrung = '';
  for (let i = 0; i < treffer.index; i++) {
    const c = text[i];
    if (anfuehrung) {
      if (c === '\\') i++;
      else if (c === anfuehrung) anfuehrung = '';
    } else if (c === '"' || c === "'") anfuehrung = c;
    else if (c === '{') tiefe++;
    else if (c === '}') tiefe--;
  }
  let rest = 1;
  anfuehrung = '';
  for (let i = von; i < text.length; i++) {
    const c = text[i];
    if (anfuehrung) {
      if (c === '\\') i++;
      else if (c === anfuehrung) anfuehrung = '';
      continue;
    }
    if (c === '"' || c === "'") anfuehrung = c;
    else if (c === '{') rest++;
    else if (c === '}' && --rest === 0) return { inhalt: text.slice(von, i), tiefe };
  }
  return null;
}

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
  // Angriffsbefund N-2: Ohne diesen Schritt macht eine auskommentierte
  // Zeile (`#    editor.world-of-mmorpg.de    1;`) den Text-Treffer
  // trotzdem gruen — der alte F2-Mutant ueberlebte genau so.
  const ohneKomm = ohneKommentare(text);
  for (const { weg, muster } of ERWARTUNGEN) {
    const treffer = muster.test(ohneKomm);
    console.log(`${treffer ? 'OK  ' : 'FEHL'}  ${weg}`);
    if (!treffer) fehler++;
  }

  /*
    Angriffsbefund NG7 (Karte D1-R): die Editor-Hosts zählen nur IN der
    `$editor_host`-map. Eine Zeile `editor.world-of-mmorpg.de 1;` in einer
    fremden map hielt die Muster oben grün, obwohl `$editor_host` dort 0 blieb
    und `/editor.html` und `/api/` auf dem Host ohne Sperre offen waren.
  */
  const karte = block(ohneKomm, /map\s+\$host\s+\$editor_host/);
  const inKarte = (host: string): boolean =>
    karte !== null && new RegExp(`(^|\\s)${host.replace(/\./g, '\\.')}\\s+1;`).test(karte.inhalt);
  const kartenErgebnisse: { weg: string; ok: boolean }[] = [
    { weg: 'die map $editor_host liegt auf oberster Ebene', ok: karte !== null && karte.tiefe === 0 },
    ...['editor.world-of-vikings.com', 'editor.world-of-mmorpg.com', 'editor.world-of-mmorpg.de'].map((h) => ({
      weg: `IN der map $editor_host: ${h} 1;`,
      ok: inKarte(h),
    })),
    {
      weg: 'Kommentarfilter: `#` in einem String bleibt, ein Kommentar geht',
      ok:
        ohneKommentare('add_header X "a #b"; # c').trim() === 'add_header X "a #b";' &&
        ohneKommentare("x 'a #b' y; #z").trim() === "x 'a #b' y;",
    },
  ];
  for (const { weg, ok } of kartenErgebnisse) {
    console.log(`${ok ? 'OK  ' : 'FEHL'}  ${weg}`);
    if (!ok) fehler++;
  }

  console.log(
    fehler === 0
      ? `\nnginx-live-editor-host: alle ${ERWARTUNGEN.length + kartenErgebnisse.length} Zusicherungen gefunden.\n`
      : `\nnginx-live-editor-host: ${fehler} FEHLEND.\n`,
  );
  process.exit(fehler > 0 ? 1 : 0);
}

main();
