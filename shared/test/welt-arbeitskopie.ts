/**
 * World working copy (editor stage E2, card K5.7): where the world lives at run time, and how the
 * working copy is created, pulled forward, accepted and discarded.
 * Zur Laufzeit liegt die Welt unter WOV_WELT_VERZEICHNIS (Vorgabe /var/lib/wov/welten); der Repo-Stand
 * ist der abgenommene. Die vier Faelle beim Start (fehlt / nur Repo geaendert / beide geaendert / keiner
 * geaendert) mit den erwarteten Bytes der Arbeitskopie und der Log-Zeile.
 *
 *   npx tsx test/welt-arbeitskopie.ts   (from shared/)
 *
 * Alles in einem Temp-Verzeichnis; nach /var/lib/wov wird nie geschrieben.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  WELT_VERZEICHNIS_VORGABE,
  weltArbeitsOrdner,
  weltBasisDatei,
  weltDatei,
  weltRepoDatei,
} from '../src/instanz.js';
import { layoutHash, layoutText } from '../src/worldlayout/layoutDatei.js';
import { sanitizeWorldLayout } from '../src/worldlayout/sanitize.js';
import { basisDatei, basisLesen, weltAbgleichen, weltAbnehmen, weltVerwerfen } from '../src/worldlayout/weltArbeitskopie.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const T = mkdtempSync(resolve(tmpdir(), 'wov-welt-arbeitskopie-'));
const vorVarLibWov = existsSync('/var/lib/wov') ? readdirSync('/var/lib/wov').sort().join(',') : null;

function dokument(name: string, radius = 100): string {
  const roh = {
    version: 1,
    name,
    detailSeed: 'ak',
    continents: [],
    regions: [{ id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2000 }, edgeFalloff: 300 }],
    lakes: [{ id: 'lk-00', x: 0, z: 0, radius }],
  };
  return layoutText(sanitizeWorldLayout(roh)!);
}

/** Ein frischer Fall: Repo-Datei, Arbeitsordner (leer). */
let zaehler = 0;
function fall(repoText: string): { repo: string; arbeit: string; ordner: string } {
  const d = resolve(T, `f${zaehler++}`);
  const ordner = resolve(d, 'arbeit');
  mkdirSync(ordner, { recursive: true });
  const repo = resolve(d, 'repo-dev.json');
  writeFileSync(repo, repoText);
  return { repo, arbeit: resolve(ordner, 'dev.json'), ordner };
}
const lies = (p: string): string => readFileSync(p, 'utf-8');

try {
  // ── Pfade ────────────────────────────────────────────────────────────
  check('Vorgabe des Weltverzeichnisses ist /var/lib/wov/welten', WELT_VERZEICHNIS_VORGABE === '/var/lib/wov/welten' && weltArbeitsOrdner('') === '/var/lib/wov/welten');
  check('leerer Wert zaehlt als nicht gesetzt', weltArbeitsOrdner('  ') === '/var/lib/wov/welten');
  check('WOV_WELT_VERZEICHNIS ueberschreibt', weltArbeitsOrdner('/tmp/x') === '/tmp/x');
  const vorher = process.env.WOV_WELT_VERZEICHNIS;
  process.env.WOV_WELT_VERZEICHNIS = resolve(T, 'w');
  check('weltDatei = <Ordner>/<instanz>.json, unabhaengig von der Wurzel', weltDatei('/irgendwo', 'dev') === resolve(T, 'w/dev.json') && weltDatei('/anderswo', 'live') === resolve(T, 'w/live.json'));
  check('weltBasisDatei = <Ordner>/<instanz>.basis', weltBasisDatei('dev') === resolve(T, 'w/dev.basis'));
  check('weltRepoDatei bleibt server/data/welten/<instanz>.json der Wurzel', weltRepoDatei('/wurzel', 'dev') === '/wurzel/server/data/welten/dev.json');
  if (vorher === undefined) delete process.env.WOV_WELT_VERZEICHNIS;
  else process.env.WOV_WELT_VERZEICHNIS = vorher;

  // ── Fall 1: Arbeitskopie fehlt → einmal aus dem Repo anlegen ──────────
  {
    const f = fall(dokument('Repo A'));
    const a = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('Fall fehlt: Fall = angelegt', a.fall === 'angelegt', a.fall);
    check('Fall fehlt: Arbeitskopie hat die Bytes des Repos', lies(f.arbeit) === lies(f.repo));
    check('Fall fehlt: Basis = Hash des Repo-Stands', basisLesen(f.arbeit) === layoutHash(lies(f.repo)) && lies(basisDatei(f.arbeit)) === `${layoutHash(lies(f.repo))}\n`);
    check('Fall fehlt: Logzeile nennt "angelegt"', /Arbeitskopie angelegt aus dem Repo/.test(a.meldung), a.meldung);
    check('Fall fehlt: keine Tmp-Reste im Ordner', readdirSync(f.ordner).sort().join(',') === 'dev.basis,dev.json', readdirSync(f.ordner).join(','));
    const nurAnlegen = fall(dokument('Repo N'));
    const n = weltAbgleichen({ repoDatei: nurAnlegen.repo, arbeitsDatei: nurAnlegen.arbeit, modus: 'anlegen' });
    check('Modus anlegen legt eine fehlende Arbeitskopie an', n.fall === 'angelegt' && lies(nurAnlegen.arbeit) === lies(nurAnlegen.repo));
    const pruef = fall(dokument('Repo P'));
    const p = weltAbgleichen({ repoDatei: pruef.repo, arbeitsDatei: pruef.arbeit, modus: 'pruefen' });
    check('Modus pruefen schreibt nichts', p.fall === 'angelegt' && !existsSync(pruef.arbeit) && !existsSync(basisDatei(pruef.arbeit)));
  }

  // ── Fall 2: nur das Repo geaendert → nachziehen ──────────────────────
  {
    const f = fall(dokument('Repo A'));
    weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    const alt = lies(f.repo);
    const neu = dokument('Repo B', 333);
    writeFileSync(f.repo, neu);
    const pruef = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit, modus: 'pruefen' });
    check('Fall nur Repo (Pruefung): meldet nachgezogen, schreibt nichts', pruef.fall === 'nachgezogen' && lies(f.arbeit) === alt && basisLesen(f.arbeit) === layoutHash(alt));
    const a = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('Fall nur Repo: Fall = nachgezogen', a.fall === 'nachgezogen', a.fall);
    check('Fall nur Repo: Arbeitskopie hat die neuen Repo-Bytes', lies(f.arbeit) === neu);
    check('Fall nur Repo: Basis = neuer Repo-Hash', basisLesen(f.arbeit) === layoutHash(neu));
    check('Fall nur Repo: Logzeile nennt "nachgezogen"', /Arbeitskopie nachgezogen: das Repo hat sich geaendert/.test(a.meldung), a.meldung);
  }

  // ── Fall 3: beide geaendert → nichts ueberschreiben, laute Warnung ─────
  {
    const f = fall(dokument('Repo A'));
    weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    const basis = basisLesen(f.arbeit);
    const arbeitNeu = dokument('Arbeit', 777);
    writeFileSync(f.arbeit, arbeitNeu);
    const repoNeu = dokument('Repo C', 555);
    writeFileSync(f.repo, repoNeu);
    const a = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('Fall beide: Fall = konflikt', a.fall === 'konflikt', a.fall);
    check('Fall beide: Arbeitskopie unveraendert (Bytes)', lies(f.arbeit) === arbeitNeu);
    check('Fall beide: Basis unveraendert', basisLesen(f.arbeit) === basis);
    check('Fall beide: Warnung nennt den Konflikt und die Auswege', /Weltkonflikt: Repo und Arbeitskopie beide geaendert, Welt abnehmen oder verwerfen/.test(a.meldung), a.meldung);
    const zweiter = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('Fall beide: auch der zweite Start ueberschreibt nichts', zweiter.fall === 'konflikt' && lies(f.arbeit) === arbeitNeu);
  }

  // ── Fall 4: keiner geaendert → Arbeitskopie lesen ─────────────────────
  {
    const f = fall(dokument('Repo A'));
    weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    const vor = lies(f.arbeit);
    const a = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('Fall keiner: Fall = unveraendert, Bytes gleich', a.fall === 'unveraendert' && lies(f.arbeit) === vor);
    check('Fall keiner: Logzeile nennt "gelesen"', /Arbeitskopie gelesen/.test(a.meldung), a.meldung);
    // Nur die Arbeitskopie geaendert (Editor hat gespeichert), Repo = Basis: nichts anfassen.
    const gespeichert = dokument('Gespeichert', 42);
    writeFileSync(f.arbeit, gespeichert);
    const b = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('Fall nur Arbeitskopie: unveraendert, Bytes der Arbeitskopie bleiben', b.fall === 'unveraendert' && lies(f.arbeit) === gespeichert && basisLesen(f.arbeit) === layoutHash(vor));
  }

  // ── Randfaelle ────────────────────────────────────────────────────────
  {
    // Abbruch zwischen Arbeitskopie und Basis: Arbeitskopie = Repo, Basis fehlt oder alt → Basis nachtragen.
    const f = fall(dokument('Repo A'));
    writeFileSync(f.arbeit, lies(f.repo));
    const a = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('Arbeitskopie = Repo ohne Basis: Basis wird nachgetragen', a.fall === 'unveraendert' && basisLesen(f.arbeit) === layoutHash(lies(f.repo)));
    // Arbeitskopie von Hand hingelegt, ohne Basis, anderes Dokument: Konflikt statt Ueberschreiben.
    const g = fall(dokument('Repo A'));
    writeFileSync(g.arbeit, dokument('Fremd', 9));
    const b = weltAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit });
    check('Arbeitskopie ohne Basis und ungleich Repo: Konflikt, nichts ueberschrieben', b.fall === 'konflikt' && lies(g.arbeit) === dokument('Fremd', 9));
    // Beschaedigte Basis zaehlt als fehlend.
    const h = fall(dokument('Repo A'));
    weltAbgleichen({ repoDatei: h.repo, arbeitsDatei: h.arbeit });
    writeFileSync(basisDatei(h.arbeit), 'kein hash\n');
    check('beschaedigte Basis gilt als fehlend', basisLesen(h.arbeit) === null);
    // Beide Pfade gleich: kein Abgleich.
    const i = fall(dokument('Repo A'));
    const c = weltAbgleichen({ repoDatei: i.repo, arbeitsDatei: i.repo });
    check('gleicher Pfad fuer Repo und Arbeitskopie: kein Abgleich, keine Basis', c.fall === 'gleicher-pfad' && !existsSync(basisDatei(i.repo)));
    // Repo fehlt.
    const j = fall(dokument('Repo A'));
    rmSync(j.repo);
    check('Repo-Datei fehlt: Fall repo-fehlt, nichts angelegt', weltAbgleichen({ repoDatei: j.repo, arbeitsDatei: j.arbeit }).fall === 'repo-fehlt' && !existsSync(j.arbeit));
  }

  // ── Abnehmen und Verwerfen ────────────────────────────────────────────
  {
    const f = fall(dokument('Repo A'));
    weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    const gespeichert = dokument('Abgenommen', 64);
    writeFileSync(f.arbeit, gespeichert);
    const r = weltAbnehmen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('abnehmen: Repo-Datei = Bytes der Arbeitskopie (Sanitizer-Bytegleich)', lies(f.repo) === gespeichert && r.geaendert && r.verworfen === 0);
    check('abnehmen: Basis = Hash der neuen Repo-Datei', basisLesen(f.arbeit) === layoutHash(gespeichert) && r.repoHash === layoutHash(gespeichert));
    check('abnehmen: Arbeitskopie unveraendert, nichts im Repo-Ordner ausser der Datei', lies(f.arbeit) === gespeichert && !r.arbeitskopieAngeglichen);
    check('nach dem Abnehmen: Abgleich meldet keinen Konflikt', weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit }).fall === 'unveraendert');
    const zweites = weltAbnehmen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('erneutes abnehmen ohne Aenderung: Repo-Datei unveraendert', !zweites.geaendert && lies(f.repo) === gespeichert);

    // Von Hand formatiert: abnehmen schreibt den sanitisierten Text und gleicht die Arbeitskopie an.
    const roh = JSON.stringify(JSON.parse(gespeichert)); // ohne Einrueckung
    writeFileSync(f.arbeit, roh);
    const s = weltAbnehmen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('abnehmen: Repo-Datei ist der sanitisierte Text, nicht die rohen Bytes', lies(f.repo) === gespeichert && roh !== gespeichert);
    check('abnehmen: abweichende Arbeitskopie wird auf den sanitisierten Text gesetzt, alte gesichert', s.arbeitskopieAngeglichen && lies(f.arbeit) === gespeichert && readdirSync(f.ordner).some((n) => n.endsWith('.bak')));
    check('abnehmen: danach kein Scheinkonflikt bei geaendertem Repo', (() => {
      writeFileSync(f.repo, dokument('Repo D', 11));
      return weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit }).fall === 'nachgezogen';
    })());

    const g = fall(dokument('Repo A'));
    weltAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit });
    writeFileSync(g.arbeit, dokument('Wegwerfen', 5));
    const v = weltVerwerfen({ repoDatei: g.repo, arbeitsDatei: g.arbeit });
    check('verwerfen: Arbeitskopie = Repo, Basis = Repo-Hash', lies(g.arbeit) === lies(g.repo) && basisLesen(g.arbeit) === layoutHash(lies(g.repo)));
    check('verwerfen: die verworfene Arbeitskopie liegt als Sicherung daneben', v.sicherung !== null && lies(v.sicherung) === dokument('Wegwerfen', 5));
  }

  const nachVarLibWov = existsSync('/var/lib/wov') ? readdirSync('/var/lib/wov').sort().join(',') : null;
  check('/var/lib/wov wurde nicht angefasst', vorVarLibWov === nachVarLibWov, `${vorVarLibWov} -> ${nachVarLibWov}`);
} finally {
  rmSync(T, { recursive: true, force: true });
}

if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nwelt-arbeitskopie: alles gruen');
