/**
 * PRÜFT deploy/nginx/wov-lab.conf: alle Aufgaben des einen Ursprungs
 * (Bauer "Ein Ursprung im Container", 12.09.2026) stehen als eigener
 * `location`-Block in der Datei — inklusive der beiden Kollisionen
 * zwischen Webseite und Spiel unter `/assets/` und `/api/`: beide Seiten
 * liefern eigene Dateien unter demselben Präfix, die Webseite muss dort
 * zuerst geprüft werden.
 *
 * ── Warum ein Textnachweis und keine echte nginx-Prüfung ─────────────
 * Entstanden ist der Test auf einer Maschine ohne nginx. Auf wov-dev
 * gibt es `/usr/sbin/nginx` (1.26.3): dort lassen sich die Wege mit einem
 * eigenen nginx auf eigenem Präfix und eigenem Port wirklich fahren — so
 * wurde zuletzt die Editor-Umleitung belegt. Der Test bleibt trotzdem ein
 * Textnachweis, weil er in `npm test` auch auf Rechnern laufen soll, auf
 * denen nginx nicht installiert ist, ohne Ports, ohne Upstreams und ohne
 * Rechte. `tools/dev-ursprung.mjs` bildet die Regeln als Node-Proxy nach
 * und bekommt seine eigene Browser-Probe; DIESER Test hält nur die Konfi-
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

const ERWARTUNGEN: Erwartung[] = [
  {
    weg: '/ (Webseite, gerendert vom Node-Dienst)',
    // `(?:[^{}]|\{[^{}]*\})*`: der Block enthaelt seit der Editor-Umleitung ein
    // eigenes `if (...) { ... }` — ein nacktes `[^}]*` endete an dessen Klammer.
    muster: /location\s+\/\s*\{(?:[^{}]|\{[^{}]*\})*proxy_pass\s+http:\/\/127\.0\.0\.1:3000/,
  },
  /*
    Karte D1, Angriffsbefund M1: `location = /` weicht VOR dem Node-Dienst
    nach Host aus, weil adapter-node die vorgerenderte Wurzel-Datei
    (immer `/de`) ausliefert, bevor `hooks.server.ts` je läuft — ein
    host-abhängiges Ziel geht deshalb nur hier. Je eine Zusicherung pro
    Domain, damit ein Mutant, der eine Zeile still auf die falsche Sprache
    dreht, hier auffällt (nicht nur die Existenz des Blocks).
  */
  {
    weg: 'location = / leitet world-of-mmorpg.de auf /de',
    muster: /if\s*\(\$host\s*=\s*world-of-mmorpg\.de\)\s*\{\s*return\s+302\s+\/de\$is_args\$args;\s*\}/,
  },
  {
    weg: 'location = / leitet world-of-mmorpg.com auf /en',
    muster: /if\s*\(\$host\s*=\s*world-of-mmorpg\.com\)\s*\{\s*return\s+302\s+\/en\$is_args\$args;\s*\}/,
  },
  /*
    Angriffsbefund N-2/M1a: eine fehlende www.-Zeile blieb bisher unbemerkt,
    weil es dafür keine eigene Zusicherung gab — www. leitet genauso um wie
    der Apex, aber als eigene `if`-Zeile in der Konfiguration.
  */
  {
    weg: 'location = / leitet www.world-of-mmorpg.de auf /de',
    muster: /if\s*\(\$host\s*=\s*www\.world-of-mmorpg\.de\)\s*\{\s*return\s+302\s+\/de\$is_args\$args;\s*\}/,
  },
  {
    weg: 'location = / leitet www.world-of-mmorpg.com auf /en',
    muster: /if\s*\(\$host\s*=\s*www\.world-of-mmorpg\.com\)\s*\{\s*return\s+302\s+\/en\$is_args\$args;\s*\}/,
  },
  {
    weg: 'location = / fällt für jeden anderen Host auf denselben Node-Dienst zurück',
    muster: /location\s*=\s*\/\s*\{(?:[^{}]|\{[^{}]*\})*proxy_pass\s+http:\/\/127\.0\.0\.1:3000/,
  },
  { weg: '/play/ (Spiel-Client)', muster: /location\s+\/play\/\s*\{/ },
  { weg: '/editor/ (Editor-Einstieg)', muster: /location\s+=?\s*\/editor\/\s*\{/ },
  { weg: '/api/*.json (statische Daten der Webseite)', muster: /location\s+~\s+\^\/api\/[^\n{]*\\\.json[^\n{]*\{/ },
  /*
    Dev-Log (30.09.2026): /api/devlog.json kommt zuerst aus dem Zustandsverzeichnis
    /var/lib/wov/web (der taegliche Lauf schreibt dort, ohne Build), sonst aus der
    Rueckfall-Datei im Build. `location =` haelt den Weg vor der Regex-location
    darueber; `no-cache`, damit ein neuer Tag sofort sichtbar ist. Die Probe mit
    einem eigenen nginx steht im Bericht der Karte.
  */
  {
    weg: '/api/devlog.json (exakt, zuerst /var/lib/wov/web/devlog.json, no-cache, keine Symlinks)',
    muster:
      /location\s+=\s+\/api\/devlog\.json\s*\{[^}]*root\s+\/var\/lib\/wov\/web\s*;[^}]*try_files\s+\/devlog\.json\s+@devlog-rueckfall\s*;[^}]*disable_symlinks\s+on\b[^;]*;[^}]*Cache-Control\s+"no-cache"[^}]*\}/,
  },
  {
    weg: '@devlog-rueckfall (Rueckfall-Datei aus dem Build, no-cache)',
    muster:
      /location\s+@devlog-rueckfall\s*\{[^}]*root\s+\/opt\/worldofvikings\/wov-web\/build\/client\s*;[^}]*try_files\s+\/api\/devlog\.json\s+=404\s*;[^}]*Cache-Control\s+"no-cache"[^}]*\}/,
  },
  { weg: '/api/accounts/ (Konten-API des Spielservers)', muster: /location\s+\/api\/accounts\/\s*\{/ },
  { weg: '/api/forum/ (Das Thing, Foren-API des Spielservers)', muster: /location\s+\/api\/forum\/\s*\{/ },
  { weg: '/accounts/ (Konten-API, bare, fuer den eingebauten Anmeldedialog)', muster: /location\s+\/accounts\/\s*\{/ },
  { weg: '/api/ (Betriebsdienst)', muster: /location\s+\/api\/\s*\{/ },
  {
    weg: '/assets/ (Webseite: Schriften/Bilder, VOR den Spiel-Assets)',
    muster: /location\s+\/assets\/\s*\{[^}]*wov-web\/build\/client\/assets\/[^}]*\}/,
  },
  /*
    Angriffsbefund N-2 (Nebenfund beim Umbau auf universelle
    Kommentar-Entfernung): Der bisherige Treffer stammte allein aus dem
    erklaerenden Kommentar dieses Blocks ("... wird /assets/x zu
    /opt/worldofvikings/assets/x"), nicht aus echtem Code — die einzige
    Direktive hier ist "root /opt/worldofvikings;", das Wort "assets"
    kommt erst aus dem angefragten Pfad dazu. Ohne Kommentare waere die
    Zusicherung nie erfuellbar gewesen. Geprueft wird jetzt die echte
    root-Direktive.
  */
  { weg: '@spiel-assets (Fallback: Modelle/Texturen/Audio)', muster: /location\s+@spiel-assets\s*\{[^}]*root\s+\/opt\/worldofvikings\s*;[^}]*\}/ },
  { weg: '/ws (Spielserver-WebSocket)', muster: /location\s+\/ws\s*\{/ },
  /*
    Der statische Wurzelordner zeigt seit dem Node-Adapter auf
    `build/client` (Buendel, Assets, /api/*.json) — nicht mehr auf `build`.
    Faellt das zurueck, liefert nginx die Buendel aus dem falschen Ordner
    und jede Seite steht ohne Stil da.
  */
  {
    weg: 'root zeigt auf wov-web/build/client',
    muster: /root\s+\/opt\/worldofvikings\/wov-web\/build\/client\s*;/,
  },
  /*
    Seit `world-of-vikings.com` ohne Basic-Auth auf diesen Container zeigt
    (12.09.2026), haengt an drei Bloecken ein Riegel gegen den
    oeffentlichen Namen. Er ist nicht zu sehen, wenn er wirkt — deshalb
    steht er hier: Faellt der Schalter beim naechsten Umbau weg, liegt der
    Betriebsdienst mit beigelegtem Admin-Token offen im Netz.
  */
  { weg: 'Schalter $oeffentlich wird gesetzt', muster: /set\s+\$oeffentlich\s+0;/ },
  // Verankert auf den Namen selbst: `[\s\S]{0,80}?world-of-vikings` traefe auch den
  // Editor-Schalter unten und hielte den Test gruen, obwohl `$oeffentlich` fehlt.
  //
  // Karte D1 (Zweitdomains): world-of-mmorpg.com/.de sind gleichwertige
  // oeffentliche Hauptdomains und muessen im SELBEN Schalter stehen wie
  // world-of-vikings.com — ein Umbau, der sie in eine eigene, vergessene
  // zweite Bedingung schriebe, liesse `$oeffentlich` fuer sie bei 0 stehen.
  {
    weg: 'Schalter erkennt world-of-vikings.com UND world-of-mmorpg.com/.de',
    muster: /if\s*\(\$host\s*~\*\s*"\^\(www\\\.\)\?\(world-of-vikings\\\.com\|world-of-mmorpg\\\.\(com\|de\)\)\$"\)/,
  },
  { weg: '/api/ (Betriebsdienst) ist unter dem oeffentlichen Namen dicht', muster: /location\s+\/api\/\s*\{[^}]*if\s*\(\$oeffentlich\)\s*\{\s*return\s+404/ },
  { weg: '/editor/ ist unter dem oeffentlichen Namen dicht', muster: /location\s+=\s*\/editor\/\s*\{\s*if\s*\(\$oeffentlich\)\s*\{\s*return\s+404/ },
  { weg: '/editor (ohne Schraegstrich) ebenso', muster: /location\s+=\s*\/editor\s*\{\s*if\s*\(\$oeffentlich\)\s*\{\s*return\s+404/ },
  /*
    Der Editor-Name (`editor.dev.world-of-vikings.com`, Proxy-Host 16) landete
    seit dem einen Ursprung auf der Webseite: `/` gehoert `location /`, und
    die Datei entscheidet nur nach dem Pfad. Zwei Haelften gehoeren zusammen —
    der Schalter auf den Namen und die Umleitung als ERSTE Anweisung von
    `location /`. 302, nicht 301: ein Browser merkt sich 301 dauerhaft.
  */
  {
    weg: 'Schalter $editor_name wird gesetzt und erkennt editor.dev',
    muster: /set\s+\$editor_name\s+0;\s*if\s*\(\$host\s*~\*\s*"\^editor\\\.dev\\\.world-of-vikings\\\.com\$"\)\s*\{\s*set\s+\$editor_name\s+1;/,
  },
  /*
    Karte D1, Angriffsbefund M4: dieselbe editor.dev-Rolle gilt zusätzlich
    für die zwei neuen Hauptdomains (DNS liegt dort ebenso an). Eigener
    Fund, weil ein Umbau die Regex oben leicht um `|world-of-mmorpg\.(com|de)`
    erweitern könnte, ohne dass ein Test das verlangt — dann bliebe der
    Editor auf den neuen dev-Namen ohne die Wurzel-Umleitung stehen.
  */
  {
    weg: 'editor.dev.world-of-mmorpg.com/.de setzt $editor_name ebenfalls',
    muster: /if\s*\(\$host\s*~\*\s*"\^editor\\\.dev\\\.world-of-mmorpg\\\.\(com\|de\)\$"\)\s*\{\s*set\s+\$editor_name\s+1;/,
  },
  /*
    `absolute_redirect off;` steht auf der `server`-Ebene, VOR dem ersten
    `location`. Nur in `location /` wirkte es nicht auf `= /editor` und
    `= /play`, deren 301 dann weiter `http://<Host>:<Port>/…` trügen —
    hinter dem Proxy Manager, wo TLS endet, ein Sprung von `https://` auf
    `http://`. Gelesen wird gegen die kommentarfreie Fassung (siehe unten).
  */
  {
    weg: 'absolute_redirect off; auf der server-Ebene (vor dem ersten location)',
    muster: /server\s*\{(?:(?!\blocation\b)[\s\S])*?\babsolute_redirect\s+off\s*;/,
  },
  {
    weg: 'location / leitet den Editor-Namen zuerst per 302 auf /editor/',
    muster: /location\s+\/\s*\{\s*(?:#[^\n]*\n\s*)*if\s*\(\$editor_name\)\s*\{\s*return\s+302\s+\/editor\/;\s*\}/,
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
  // Angriffsbefund N-2: JEDE Zusicherung liest die kommentarfreie Fassung,
  // nicht nur die eine, die das vorher ausdruecklich anforderte — sonst
  // haelt eine auskommentierte Host-Weiche (`# if ($host = ...) { ... }`)
  // den Text-Treffer trotzdem gruen.
  const ohneKomm = ohneKommentare(text);
  for (const { weg, muster } of ERWARTUNGEN) {
    const treffer = muster.test(ohneKomm);
    console.log(`${treffer ? 'OK  ' : 'FEHL'}  ${weg}`);
    if (!treffer) fehler++;
  }

  /*
    Dev-Log N1: Der Kommentar zum Regex-Block /api/*.json ("Fehlt eine Datei, liefert
    dieser Block ehrlich 404") steht unmittelbar vor seinem Block, nicht ueber dem
    Dev-Log-Abschnitt. Ein Kommentar ist nur im Rohtext sichtbar, deshalb hier `text`.
  */
  {
    const weg = 'Kommentar „Statische Daten“ steht unmittelbar vor der /api/*.json-Regex-location';
    const ok = /404 statt stillschweigend an den Betriebsdienst durchzufallen\.\s*\n\s*location\s+~\s+\^\/api\//.test(text);
    console.log(`${ok ? 'OK  ' : 'FEHL'}  ${weg}`);
    if (!ok) fehler++;
  }

  /*
    Karte D1-R (Angriffsbefund NG6 und Punkt 4): die vier Host-Zeilen zählen
    nur, wenn sie IM Block `location = /` stehen — dieser wiederum im
    `server`-Block. Die Muster oben lesen die ganze Datei; eine Zeile, die in
    einen anderen location-Block wanderte (etwa nach `/ws`), hielt sie grün,
    obwohl die Wurzel dann auf die Meta-Refresh-Seite fiel. Der Suchteil
    bleibt beim 302 erhalten (`$is_args$args`).
  */
  const wurzel = block(ohneKomm, /location\s*=\s*\//);
  const server = block(ohneKomm, /\bserver/);
  const zeilen: [string, string][] = [
    ['world-of-mmorpg.de', '/de'],
    ['www.world-of-mmorpg.de', '/de'],
    ['world-of-mmorpg.com', '/en'],
    ['www.world-of-mmorpg.com', '/en'],
  ];
  const blockErgebnisse: { weg: string; ok: boolean }[] = [
    { weg: 'location = / liegt im server-Block (Tiefe 1)', ok: wurzel !== null && wurzel.tiefe === 1 && server !== null && server.inhalt.includes(wurzel.inhalt) },
    ...zeilen.map(([host, ziel]) => ({
      weg: `IM Block location = /: ${host} -> 302 ${ziel} mit Suchteil ($is_args$args)`,
      ok:
        wurzel !== null &&
        wurzel.inhalt.includes(`if ($host = ${host}) { return 302 ${ziel}$is_args$args; }`),
    })),
    {
      weg: 'die Host-Zeilen stehen NUR in location = / (nicht doppelt in einem anderen Block)',
      ok: (ohneKomm.match(/if\s*\(\$host\s*=\s*(?:www\.)?world-of-mmorpg\.(?:com|de)\)\s*\{\s*return\s+302/g) ?? []).length === 4,
    },
    {
      weg: 'Kommentarfilter: `#` in einem String bleibt, ein Kommentar geht',
      ok:
        ohneKommentare('add_header X "a #b"; # c').trim() === 'add_header X "a #b";' &&
        ohneKommentare("x 'a #b' y; #z").trim() === "x 'a #b' y;" &&
        ohneKommentare('# ganz\nreturn 1; # rest').replace(/\s+/g, ' ').trim() === 'return 1;',
    },
  ];
  for (const { weg, ok } of blockErgebnisse) {
    console.log(`${ok ? 'OK  ' : 'FEHL'}  ${weg}`);
    if (!ok) fehler++;
  }

  // Die Reihenfolge der location-Blöcke ist für nginx bedeutungslos (es
  // wählt den längsten passenden Präfix), aber ein Test, der das still
  // voraussetzt, sollte es wenigstens einmal aussprechen — nicht prüfen,
  // nur dokumentieren, warum hier keine Reihenfolge verlangt wird.
  console.log('(Reihenfolge der Blöcke ist für nginx-Präfixmatching ohne Bedeutung — nicht geprüft.)');

  console.log(
    fehler === 0
      ? `\nnginx-wov-lab-pfade: alle ${ERWARTUNGEN.length + blockErgebnisse.length} Wege gefunden.\n`
      : `\nnginx-wov-lab-pfade: ${fehler} FEHLEND.\n`,
  );
  process.exit(fehler > 0 ? 1 : 0);
}

main();
