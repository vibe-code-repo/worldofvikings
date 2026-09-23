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
 *   2. Jede andere Seite enthält im HTML (ohne JavaScript) die Links auf beide.
 *   3. Der Musterhinweis steht auf beiden Seiten GENAU DANN, wenn
 *      `src/lib/rechtliches.ts` (neben dem Bau) noch einen `[[`-Wert enthält.
 *      Um das zu beweisen, ruft man das Skript einmal gegen einen Bau mit
 *      gefüllten Testwerten auf (siehe Bericht).
 *   4. Auf den beiden Seiten lädt nichts von einem fremden Host: kein src=, kein
 *      <link href=> mit fremder Adresse; jede https-Adresse im HTML gehört zur
 *      eigenen Domain oder zu den zwei bekannten Chip-Links der Fußzeile.
 *   5. Keine Antwort setzt ein Cookie; die Content-Security-Policy trägt
 *      default-src 'self'.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const argument = (name, vorgabe) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : vorgabe;
};
const BUILD = resolve(argument('--build', 'build'));
const PORT = Number(argument('--port', '5290'));
const BASIS = `http://127.0.0.1:${PORT}`;
const QUELLE = resolve(dirname(BUILD), 'src/lib/rechtliches.ts');

/** Die Seiten, die den Link auf beide Rechtsseiten tragen müssen. */
const ANDERE = {
  de: ['/de', '/de/saga', '/de/ruhmeshalle', '/de/ruestkammer', '/de/thing', '/de/erstellen', '/de/konto'],
  en: ['/en', '/en/saga', '/en/hall-of-fame', '/en/armory', '/en/thing', '/en/create', '/en/account'],
};
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

async function warteAufPort() {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${BASIS}/de`, { redirect: 'manual' });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return false;
}

async function lauf() {
  const quelle = existsSync(QUELLE) ? readFileSync(QUELLE, 'utf8') : null;
  // Wert-Zeilen in ANBIETER, die mit '[[ beginnen — Kommentare mit [[ zählen nicht.
  const hatPlatzhalter = quelle === null ? true : /^\s+\w+:\s*'\[\[/m.test(quelle);
  console.log(`Quelle ${QUELLE}: ${quelle === null ? 'FEHLT' : hatPlatzhalter ? 'Platzhalter vorhanden' : 'alle Werte gefüllt'}`);
  pruefe(quelle !== null, 'rechtliches.ts neben dem Bau gefunden');

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
      const roh = /\[\[/.test(ohneKommentare(r.text).replace(/<script[\s\S]*?<\/script>/g, ''));
      pruefe(roh === hatPlatzhalter, `${pfad}: sichtbare [[-Platzhalter ${hatPlatzhalter ? 'vorhanden' : 'fehlen'} wie in rechtliches.ts`);
      const noindex = /<meta[^>]+name="robots"[^>]+noindex/.test(r.text);
      pruefe(noindex === hatPlatzhalter, `${pfad}: noindex ${hatPlatzhalter ? 'gesetzt' : 'nicht gesetzt'}`);
    }
  }

  for (const l of ['de', 'en']) {
    for (const pfad of ANDERE[l]) {
      const r = await hole(pfad);
      pruefe(r.status === 200, `${pfad} liefert 200`, `Status ${r.status}`);
      const h = ohneKommentare(r.text).replace(/<script[\s\S]*?<\/script>/g, '');
      for (const k of ['impressum', 'datenschutz']) {
        pruefe(h.includes(`href="${RECHT[l][k]}"`), `${pfad} verlinkt ${RECHT[l][k]} (im HTML, ohne JavaScript)`);
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
  stdio: ['ignore', 'ignore', 'inherit'],
});
console.log(`Dienst gestartet: PID ${dienst.pid}, ${BASIS}`);
try {
  if (!(await warteAufPort())) {
    pruefe(false, 'Dienst antwortet auf dem Port');
  } else {
    await lauf();
  }
} catch (e) {
  pruefe(false, 'Lauf ohne Ausnahme', String(e));
} finally {
  dienst.kill('SIGTERM');
  await new Promise((r) => dienst.once('exit', r));
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
