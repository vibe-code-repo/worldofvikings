#!/usr/bin/env node
/**
 * Prüft Impressum und Datenschutz am GEBAUTEN Bündel (Karte W1).
 *
 * Aufruf (in wov-web/, nach `npm run build`):
 *   node tools/rechtsseiten-pruefen.mjs [--build build] [--port 5290]
 *
 * Es startet `node <build>` auf 127.0.0.1:<port>, fragt die Seiten per HTTP ab
 * und beendet den Dienst am Ende wieder (Beweis: die PID steht in der Ausgabe
 * und wird mit process.kill(pid, 0) auf Ende geprüft). Gemessen wird das, was
 * ein Besucher bekommt — nicht der Quelltext.
 *
 * Geprüft wird:
 *   1. Impressum und Datenschutz gibt es in de und en (HTTP 200, <h1>, <main>).
 *   2. JEDE ABLEITBARE gebaute Seite je Sprache enthält im HTML (ohne JavaScript) die Links
 *      auf beide. Die Liste wird nicht von Hand geführt, sondern aus dem Bau
 *      abgeleitet: alle vorgerenderten Dateien unter build/prerendered, alle
 *      Adressen der /sitemap.xml und je Sprache eine nicht vorhandene Adresse
 *      (404-Seite). Eine neue Seite kommt damit von selbst hinzu.
 *   3. Der Musterhinweis steht auf beiden Seiten GENAU DANN, wenn
 *      `offeneFelder()` in `src/lib/rechtliches.ts` (neben dem Bau) ein Feld als
 *      offen meldet. Dazu läuft eine Matrix über die reine Funktion: jede Form
 *      (fehlt, leer, Leerraum, NBSP, unsichtbare Cf-Zeichen, Platzhalter-Klammern
 *      in mehreren Schreibweisen) je Pflichtfeld, alles gefüllt, optionales
 *      Feld leer, neues ungelistetes Feld leer. Die Matrix am GEBAUTEN Bündel
 *      erzeugt man, indem man das Skript gegen Bauten mit veränderten
 *      Werten aufruft (siehe Bericht).
 *   4. Auf den beiden Seiten lädt nichts von einem fremden Host: kein src=, kein
 *      <link href=> mit fremder Adresse; jede https-Adresse im HTML gehört zur
 *      eigenen Domain oder zu den zwei bekannten Chip-Links der Fußzeile.
 *   5. Keine Antwort setzt ein Cookie; die Content-Security-Policy trägt
 *      default-src 'self'.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const argument = (name, vorgabe) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : vorgabe;
};
const BUILD = resolve(argument('--build', 'build'));
const PORT = Number(argument('--port', '5290'));
const BASIS = `http://127.0.0.1:${PORT}`;
const QUELLE = resolve(dirname(BUILD), 'src/lib/rechtliches.ts');

/** Nicht vorhandene Adressen: Die Fehlerseite trägt den Fuß ebenfalls. */
const FEHLERSEITEN = { de: '/de/gibt-es-nicht', en: '/en/gibt-es-nicht' };
const RECHT = {
  de: { impressum: '/de/impressum', datenschutz: '/de/datenschutz', hinweis: 'Muster, Angaben folgen' },
  en: { impressum: '/en/legal-notice', datenschutz: '/en/privacy', hinweis: 'Sample, details to follow' },
};
/** https-Hosts, die im Seiten-HTML stehen dürfen. */
const ERLAUBTE_HOSTS = [/(^|\.)world-of-vikings\.com$/, /^discord\.gg$/, /^github\.com$/];

let fehler = 0;
const pruefe = (ok, text, detail = '') => {
  console.log(`${ok ? 'ok    ' : 'FEHLER'} ${text}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fehler += 1;
};

async function hole(pfad) {
  const r = await fetch(BASIS + pfad, { redirect: 'manual' });
  return { status: r.status, text: await r.text(), kopf: r.headers };
}

const ohneKommentare = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

/** Wird wahr, sobald der eigene Dienst endet (z. B. Port belegt): dann NICHT gegen einen fremden Dienst prüfen. */
let dienstBeendet = false;

/**
 * Wartet, bis der EIGENE Dienst meldet, dass er lauscht (Zeile „Listening“ auf
 * seiner Standardausgabe). Ein bloßes Antworten am Port genügt nicht: Belegt
 * ein fremder Dienst den Port, würde sonst gegen ihn geprüft.
 */
let lauscht = false;
async function warteAufPort() {
  for (let i = 0; i < 100; i++) {
    if (dienstBeendet) return false;
    if (lauscht) {
      try {
        await fetch(`${BASIS}/de`, { redirect: 'manual' });
        return !dienstBeendet;
      } catch {
        /* noch nicht bereit */
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** Alle vorgerenderten Seiten als Adresse (`de/saga.html` → `/de/saga`). */
function vorgerenderte(ordner, praefix = '') {
  const adressen = [];
  for (const name of readdirSync(ordner)) {
    const voll = resolve(ordner, name);
    if (statSync(voll).isDirectory()) adressen.push(...vorgerenderte(voll, `${praefix}/${name}`));
    else if (name.endsWith('.html')) adressen.push(`${praefix}/${name.slice(0, -5)}`);
  }
  return adressen;
}

/** Die Matrix über die reine Funktion `offeneFelder`. */
function matrix(modul) {
  const { offeneFelder, FELDER, OPTIONALFELDER } = modul;
  const pflicht = FELDER.filter((f) => !OPTIONALFELDER.includes(f));
  const gefuellt = Object.fromEntries(FELDER.map((f) => [f, `Wert ${f}`]));
  const unsichtbar = { ZWSP: '​', ZWNJ: '‌', ZWJ: '‍', WJ: '⁠', MVS: '᠎', BOM: '﻿' };
  // Unsichtbare Zeichen aus dem Angriffsbericht 3 (Lo, Mn, So, Cf), je einzeln
  // und mit einem Leerzeichen davor bzw. dahinter.
  const angriff = {
    'U+3164': '\u3164', 'U+115F': '\u115F', 'U+1160': '\u1160', 'U+FFA0': '\uFFA0',
    'U+2800': '\u2800', 'U+034F': '\u034F', 'U+FE00': '\uFE00', 'U+FE01': '\uFE01',
    'U+13441': '\u{13441}', 'U+13442': '\u{13442}',
    'U+FE0F': '\uFE0F', 'U+180B': '\u180B', 'U+180C': '\u180C', 'U+180D': '\u180D',
    'U+180F': '\u180F', 'U+00AD': '\u00AD', 'U+E0020': '\u{E0020}',
  };
  const angriffsformen = {};
  for (const [n, z] of Object.entries(angriff)) {
    angriffsformen[n] = (o, f) => (o[f] = z);
    angriffsformen[`${n} + Leerzeichen`] = (o, f) => (o[f] = ` ${z} `);
    angriffsformen[`${n} + Leerzeichen + ${n}`] = (o, f) => (o[f] = `${z} ${z}`);
  }
  const formen = {
    ...angriffsformen,
    'alle Angriffszeichen zusammen': (o, f) => (o[f] = Object.values(angriff).join(' ')),
    'nur Satzzeichen ---': (o, f) => (o[f] = '---'),
    'nur Satzzeichen ?': (o, f) => (o[f] = ' ? '),
    fehlt: (o, f) => delete o[f],
    leer: (o, f) => (o[f] = ''),
    leerraum: (o, f) => (o[f] = '  \t\n '),
    nbsp: (o, f) => (o[f] = ' '),
    'nbsp + Leerraum': (o, f) => (o[f] = '  　  '),
    'alle Cf-Zeichen': (o, f) => (o[f] = Object.values(unsichtbar).join('')),
    'Cf + nbsp gemischt': (o, f) => (o[f] = ` ${unsichtbar.ZWSP} ${unsichtbar.WJ} ${unsichtbar.BOM}`),
    ...Object.fromEntries(Object.entries(unsichtbar).map(([n, z]) => [n, (o, f) => (o[f] = z)])),
    platzhalter: (o, f) => (o[f] = '[[X]]'),
    'platzhalter nach Leerraum': (o, f) => (o[f] = '  \n[[X]]'),
    'platzhalter in Zeile 2': (o, f) => (o[f] = 'Zeile 1\n[[X]]'),
    '[ [X] ]': (o, f) => (o[f] = '[ [X] ]'),
    '{{X}}': (o, f) => (o[f] = '{{X}}'),
    'X}}': (o, f) => (o[f] = 'X}}'),
    'X]]': (o, f) => (o[f] = 'X]]'),
    '[ZWSP[X]]': (o, f) => (o[f] = `[${unsichtbar.ZWSP}[X]${unsichtbar.WJ}]`),
    '{ nbsp {X}}': (o, f) => (o[f] = '{ {X}}'),
  };
  let zeilen = 0;
  const vorher = fehler;
  pruefe(offeneFelder(gefuellt).length === 0, 'Matrix: alles gefüllt → nichts offen', JSON.stringify(offeneFelder(gefuellt)));
  for (const f of pflicht) {
    for (const [form, aendere] of Object.entries(formen)) {
      const o = { ...gefuellt };
      aendere(o, f);
      const offen = offeneFelder(o);
      zeilen += 1;
      if (!(offen.length === 1 && offen[0] === f)) {
        pruefe(false, `Matrix: Pflichtfeld ${f} „${form}“ → als offen erkannt`, `beobachtet: ${JSON.stringify(offen)}`);
      }
    }
  }
  if (fehler === vorher) console.log(`ok     Matrix: ${zeilen} Zeilen (${pflicht.length} Pflichtfelder × ${Object.keys(formen).length} Formen) erkennen genau das eine offene Feld`);
  // Optionale Felder: leer in jeder Form darf fehlen, ein Platzhalter nicht.
  const optional = [
    ['leer', '', false], ['nur Leerraum', '   ', false], ['fehlt', undefined, false],
    ['nur ZWSP/WJ/BOM', '​⁠﻿', false], ['nbsp + ZWSP', ' ​', false],
    ['nur U+3164', '\u3164', false], ['nur U+2800', '\u2800', false], ['U+115F U+1160 U+FFA0 + Leerzeichen', '\u115F \u1160 \uFFA0', false],
    ['nur U+034F U+FE0F', '\u034F\uFE0F', false],
    ['Platzhalter [[UST-ID]]', '[[UST-ID]]', true], ['Platzhalter [ [X] ]', '[ [X] ]', true],
    ['Platzhalter {{X}}', '{{X}}', true], ['echter Wert', 'DE123456789', false],
  ];
  for (const f of OPTIONALFELDER) {
    for (const [name, wert, erwartet] of optional) {
      const o = { ...gefuellt };
      if (wert === undefined) delete o[f];
      else o[f] = wert;
      const offen = offeneFelder(o).includes(f);
      pruefe(offen === erwartet, `Matrix: optionales Feld ${f}: ${name} → ${erwartet ? 'offen' : 'ohne Hinweis'}`, `beobachtet: ${offen ? 'offen' : 'ok'}`);
    }
  }
  // Fehlalarm-Gegenproben: echte Werte müssen als gefüllt gelten (jedes Pflichtfeld).
  const echt = [
    'Müller & Söhne KG', 'Straße 5', 'ß', 'Schmidt-Obermüller', "O'Brien", 'D’Arcy',
    'mike@example.de', '+491701234567', '0170 1234567', '+49 (0) 170 123-4567',
    'Иван Петров', '田中太郎', '山田 花子', '김민수', 'محمد', 'A\u3164', '\u3164A', '5', 'a',
    'Kiel\nSchleswig-Holstein',
  ];
  let echteBad = 0;
  for (const f of pflicht) {
    for (const wert of echt) {
      const offen = offeneFelder({ ...gefuellt, [f]: wert }).includes(f);
      if (offen) { echteBad += 1; pruefe(false, `Gegenprobe: Pflichtfeld ${f} = ${JSON.stringify(wert)} → gefüllt`, 'beobachtet: offen'); }
    }
  }
  if (echteBad === 0) console.log(`ok     Gegenproben: ${pflicht.length * echt.length} echte Werte (Umlaute, ß, Bindestrich, Apostroph, E-Mail, Telefon, Kyrillisch, CJK, Arabisch, Hangul, Mischwerte) gelten als gefüllt`);
  pruefe([0x13443, 0x13444, 0x13445, 0x13446].every((c) => modul.hatWert(String.fromCodePoint(c)) === true), 'U+13443..U+13446 (Lost Sign, sichtbare Markierung) gelten bewusst als gefüllt');
  pruefe(modul.hatWert('Testwert') === true && modul.hatWert('\u3164') === false && modul.hatWert('\u2800') === false, 'hatWert: Testwert ja, U+3164 nein, U+2800 nein');
  // Umgedrehte Logik: ein NEUES Feld ist ohne Eintrag in einer Liste Pflicht.
  for (const [name, wert, erwartet] of [['leer', '', true], ['ZWSP', '​', true], ['Platzhalter', '[[NEU]]', true], ['gefüllt', 'ein Wert', false]]) {
    const offen = offeneFelder({ ...gefuellt, neuesFeld: wert }).includes('neuesFeld');
    pruefe(offen === erwartet, `Matrix: neues, ungelistetes Feld ${name} → ${erwartet ? 'offen (Pflicht)' : 'ok'}`, `beobachtet: ${offen ? 'offen' : 'ok'}`);
  }
  pruefe(FELDER.length === new Set(FELDER).size && OPTIONALFELDER.every((f) => FELDER.includes(f)), 'FELDER ohne Doppelte, OPTIONALFELDER ⊂ FELDER');
}

async function lauf() {
  let modul = null;
  try {
    modul = await import(pathToFileURL(QUELLE).href);
  } catch (e) {
    console.log(`Quelle ${QUELLE}: nicht ladbar (${String(e).split('\n')[0]})`);
  }
  pruefe(modul !== null, 'rechtliches.ts neben dem Bau ladbar');
  // Ohne Quelle gilt „Muster erwartet“, damit die Seitenprüfung trotzdem läuft.
  const hatPlatzhalter = modul === null ? true : modul.MUSTER;
  if (modul !== null) {
    console.log(`Quelle ${QUELLE}: ${hatPlatzhalter ? 'offene Felder: ' + modul.OFFENE_PLATZHALTER.join(', ') : 'alle Werte gefüllt'}`);
    matrix(modul);
  }

  const seiten = {};
  for (const l of ['de', 'en']) {
    for (const k of ['impressum', 'datenschutz']) {
      const pfad = RECHT[l][k];
      const r = await hole(pfad);
      seiten[pfad] = r;
      pruefe(r.status === 200, `${pfad} liefert 200`, `Status ${r.status}`);
      const h = ohneKommentare(r.text);
      pruefe(/<main\b/.test(h) && /<h1\b/.test(h), `${pfad} hat <main> und <h1>`);
      const gesehen = r.text.includes(RECHT[l].hinweis);
      pruefe(gesehen === hatPlatzhalter, `${pfad}: Musterhinweis ${hatPlatzhalter ? 'vorhanden' : 'fehlt'} wie in rechtliches.ts`, `Hinweis ${gesehen ? 'steht da' : 'fehlt'}`);
      // Sichtbarer Text in <main>, ohne Tags; dieselbe Funktion wie der Waechter.
      const haupt = (ohneKommentare(r.text).match(/<main\b[\s\S]*?<\/main>/) ?? [''])[0]
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<style[\s\S]*?<\/style>/g, '')
        .replace(/<[^>]*>/g, ' ');
      const roh = modul === null ? /\[\[/.test(haupt) : modul.enthaeltPlatzhalter(haupt);
      pruefe(roh === hatPlatzhalter, `${pfad}: sichtbare Platzhalter-Klammern ${hatPlatzhalter ? 'vorhanden' : 'fehlen'} wie in rechtliches.ts`);
      const noindex = /<meta[^>]+name="robots"[^>]+noindex/.test(r.text);
      pruefe(noindex === hatPlatzhalter, `${pfad}: noindex ${hatPlatzhalter ? 'gesetzt' : 'nicht gesetzt'}`);
    }
  }

  // Alle Seiten je Sprache: vorgerendert + Sitemap (dort steht auch das
  // serverseitig gerenderte Thing) + Fehlerseiten.
  const sprachlos = new Set(vorgerenderte(resolve(BUILD, 'prerendered')));
  const sitemap = await hole('/sitemap.xml');
  pruefe(sitemap.status === 200, '/sitemap.xml liefert 200', `Status ${sitemap.status}`);
  for (const m of sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)) sprachlos.add(new URL(m[1]).pathname);
  for (const l of ['de', 'en']) {
    const liste = [...sprachlos].filter((p) => p === `/${l}` || p.startsWith(`/${l}/`)).sort();
    console.log(`Seiten ${l}: ${liste.length} (${liste.join(' ')})`);
    pruefe(liste.length >= 10, `${l}: mindestens 10 Seiten gefunden`, `${liste.length}`);
    for (const pfad of [...liste, FEHLERSEITEN[l]]) {
      const fehlerseite = pfad === FEHLERSEITEN[l];
      const r = await hole(pfad);
      pruefe(fehlerseite ? r.status === 404 : r.status === 200, `${pfad} liefert ${fehlerseite ? 404 : 200}`, `Status ${r.status}`);
      const h = ohneKommentare(r.text).replace(/<script[\s\S]*?<\/script>/g, '');
      for (const k of ['impressum', 'datenschutz']) {
        // Die 404-Seite kennt die Sprache nicht (bekannt, Karte W5): dort
        // genügt der Link in irgendeiner Sprache.
        const ziel = fehlerseite ? [RECHT.de[k], RECHT.en[k]] : [RECHT[l][k]];
        pruefe(ziel.some((z) => h.includes(`href="${z}"`)), `${pfad} verlinkt ${ziel.join(' oder ')} (im HTML, ohne JavaScript)`);
      }
    }
  }

  for (const [pfad, r] of Object.entries(seiten)) {
    const h = ohneKommentare(r.text);
    const fremdeQuelle = [...h.matchAll(/\b(?:src|srcset|action|poster)="(https?:)?\/\/([^/"]+)/g)]
      .map((m) => m[2])
      .filter((host) => !ERLAUBTE_HOSTS.some((re) => re.test(host)));
    const fremdeLinks = [...h.matchAll(/<link\b[^>]*\bhref="https?:\/\/([^/"]+)/g)]
      .map((m) => m[1])
      .filter((host) => !ERLAUBTE_HOSTS.some((re) => re.test(host)));
    pruefe(fremdeQuelle.length + fremdeLinks.length === 0, `${pfad}: nichts wird von einem fremden Host geladen`, [...fremdeQuelle, ...fremdeLinks].join(', '));
    const hosts = [...new Set([...h.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()))].sort();
    const unerlaubt = hosts.filter((host) => !ERLAUBTE_HOSTS.some((re) => re.test(host)));
    pruefe(unerlaubt.length === 0, `${pfad}: jede https-Adresse gehört zu einem erlaubten Host`, `gefunden: ${hosts.join(', ')}${unerlaubt.length ? ` | UNERLAUBT: ${unerlaubt.join(', ')}` : ''}`);
    pruefe(!r.kopf.get('set-cookie'), `${pfad}: kein Set-Cookie`);
    pruefe(/content-security-policy[^>]*default-src 'self'/.test(r.text), `${pfad}: CSP mit default-src 'self'`);
  }
}

if (!existsSync(resolve(BUILD, 'index.js'))) {
  console.error(`Kein Bau unter ${BUILD} — erst 'npm run build'.`);
  process.exit(2);
}

const dienst = spawn('node', [BUILD], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
// Stirbt das Skript unterwegs (z. B. Ausgabe in eine geschlossene Pipe), darf der
// Dienst nicht verwaisen und den Port belegen.
process.on('exit', () => {
  try {
    dienst.kill('SIGKILL');
  } catch {
    /* schon weg */
  }
});
process.stdout.on('error', () => process.exit(1));
// Signale: `exit` feuert dabei nicht. Kind beenden, dann mit 128 + Signalnummer aussteigen.
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.on(signal, () => {
    try {
      dienst.kill('SIGKILL');
    } catch {
      /* schon weg */
    }
    process.exit(code);
  });
}
dienst.stdout.on('data', (d) => {
  if (String(d).includes('Listening')) lauscht = true;
});
dienst.once('exit', () => {
  dienstBeendet = true;
});
console.log(`Dienst gestartet: PID ${dienst.pid}, ${BASIS}`);
try {
  if (!(await warteAufPort())) {
    pruefe(false, 'Eigener Dienst antwortet auf dem Port', dienstBeendet ? 'Dienst hat sich beendet (Port belegt?)' : 'keine Antwort');
  } else {
    await lauf();
  }
} catch (e) {
  pruefe(false, 'Lauf ohne Ausnahme', String(e));
} finally {
  dienst.kill('SIGTERM');
  if (!dienstBeendet) await new Promise((r) => dienst.once('exit', r));
  let lebt = true;
  try {
    process.kill(dienst.pid, 0);
  } catch {
    lebt = false;
  }
  console.log(`Dienst beendet: PID ${dienst.pid} ${lebt ? 'LEBT NOCH' : 'weg'}`);
}
console.log(fehler === 0 ? '\nalles ok' : `\n${fehler} Prüfung(en) fehlgeschlagen`);
process.exit(fehler === 0 ? 0 : 1);
