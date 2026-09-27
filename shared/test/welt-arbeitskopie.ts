/**
 * World working copy (editor stage E2, card K5.7): where the world lives at run time, and how the
 * working copy is created, pulled forward, accepted and discarded.
 * Zur Laufzeit liegt die Welt unter WOV_WELT_VERZEICHNIS (nur ausdruecklich gesetzt, absolut), sonst unter
 * <Wurzel>/server/data/welten-arbeit; der Repo-Stand ist der abgenommene. Die vier Faelle beim Start (fehlt /
 * nur Repo geaendert / beide geaendert / keiner geaendert) mit den erwarteten Bytes der Arbeitskopie und der
 * Log-Zeile; dazu B1 (Vorgabe ohne Variable), H2 (Abnehmen schreibt keine Basis), M1 (Abgleich und Speichern
 * unter derselben Sperre; der Wettlauf zweier Prozesse steht in welt-abgleich-wettlauf.ts) und N1 (kaputte Dateien).
 *
 *   npx tsx test/welt-arbeitskopie.ts   (from shared/)
 *
 * Alles in einem Temp-Verzeichnis; nach /var/lib/wov wird nie geschrieben.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  WeltVerzeichnisUngueltig,
  weltArbeitsOrdner,
  weltArbeitsOrdnerImDatenOrdner,
  weltBasisDatei,
  weltDatei,
  weltRepoDatei,
} from '../src/instanz.js';
import { layoutHash, layoutSchreiben, layoutText } from '../src/worldlayout/layoutDatei.js';
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
  // ── Pfade (B1, N2) ───────────────────────────────────────────────────
  const vorher = process.env.WOV_WELT_VERZEICHNIS;
  delete process.env.WOV_WELT_VERZEICHNIS;
  check('ohne Variable: <Wurzel>/server/data/welten-arbeit, NICHT /var/lib/wov', weltArbeitsOrdner('/wurzel') === '/wurzel/server/data/welten-arbeit' && weltDatei('/wurzel', 'dev') === '/wurzel/server/data/welten-arbeit/dev.json');
  check('ohne Variable haengt der Ordner an der Wurzel: zwei Checkouts, zwei Ordner', weltDatei('/a', 'dev') !== weltDatei('/b', 'dev'));
  check('ohne Variable, Datenordner des Servers: <Daten>/welten-arbeit', weltArbeitsOrdnerImDatenOrdner('/wurzel/server/data') === weltArbeitsOrdner('/wurzel'));
  check('leerer Wert zaehlt als nicht gesetzt', weltArbeitsOrdner('/wurzel', '  ') === '/wurzel/server/data/welten-arbeit');
  check('ausdruecklich gesetzter absoluter Wert gilt (auch /var/lib/wov/welten)', weltArbeitsOrdner('/wurzel', '/var/lib/wov/welten') === '/var/lib/wov/welten' && weltArbeitsOrdner('/wurzel', '/tmp/x') === '/tmp/x');
  const relativ = ['relwelt', './welt', '../welt', 'a/b'].map((w) => {
    try {
      weltArbeitsOrdner('/wurzel', w);
      return null;
    } catch (f) {
      return f instanceof WeltVerzeichnisUngueltig ? f.message : `andere Ausnahme: ${(f as Error).message}`;
    }
  });
  check('relativer Wert wird abgelehnt (N2), mit Meldung', relativ.every((m) => m !== null && /kein absoluter Pfad/.test(m)), JSON.stringify(relativ));
  process.env.WOV_WELT_VERZEICHNIS = resolve(T, 'w');
  check('weltDatei = <Ordner>/<instanz>.json, unabhaengig von der Wurzel', weltDatei('/irgendwo', 'dev') === resolve(T, 'w/dev.json') && weltDatei('/anderswo', 'live') === resolve(T, 'w/live.json'));
  check('weltBasisDatei = <Ordner>/<instanz>.basis', weltBasisDatei('/irgendwo', 'dev') === resolve(T, 'w/dev.basis'));
  check('weltRepoDatei bleibt server/data/welten/<instanz>.json der Wurzel', weltRepoDatei('/wurzel', 'dev') === '/wurzel/server/data/welten/dev.json');
  process.env.WOV_WELT_VERZEICHNIS = 'relwelt';
  check('weltDatei mit relativer Variable wirft (kein stilles Aufloesen gegen das cwd)', (() => {
    try {
      weltDatei('/wurzel', 'dev');
      return false;
    } catch (f) {
      return f instanceof WeltVerzeichnisUngueltig;
    }
  })());
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
    const basisVorher = basisLesen(f.arbeit);
    const r = weltAbnehmen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('abnehmen: Repo-Datei = Bytes der Arbeitskopie (Sanitizer-Bytegleich)', lies(f.repo) === gespeichert && r.geaendert && r.verworfen === 0);
    check('abnehmen (H2): schreibt KEINE Basis, die alte bleibt', basisLesen(f.arbeit) === basisVorher && basisVorher !== layoutHash(gespeichert) && r.repoHash === layoutHash(gespeichert));
    check('abnehmen: Arbeitskopie unveraendert, nichts im Repo-Ordner ausser der Datei', lies(f.arbeit) === gespeichert);
    check('nach dem Abnehmen: der naechste Start meldet keinen Konflikt und traegt die Basis nach', (() => {
      const a = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
      return a.fall === 'unveraendert' && basisLesen(f.arbeit) === layoutHash(gespeichert);
    })());
    const zweites = weltAbnehmen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('erneutes abnehmen ohne Aenderung: Repo-Datei unveraendert', !zweites.geaendert && lies(f.repo) === gespeichert);

    // Von Hand formatiert: abnehmen schreibt den sanitisierten Text; die Arbeitskopie bleibt, wie sie ist.
    const roh = JSON.stringify(JSON.parse(gespeichert)); // ohne Einrueckung
    writeFileSync(f.arbeit, roh);
    weltAbnehmen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('abnehmen: Repo-Datei ist der sanitisierte Text, nicht die rohen Bytes; Arbeitskopie bleibt roh', lies(f.repo) === gespeichert && roh !== gespeichert && lies(f.arbeit) === roh);
    check('abnehmen: nach dem Sanitizer gleich → kein Scheinkonflikt, Basis = Repo-Hash', (() => {
      const a = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
      return a.fall === 'unveraendert' && basisLesen(f.arbeit) === layoutHash(gespeichert) && lies(f.arbeit) === roh;
    })());
    check('danach ein neues Repo bei der (roh formatierten, ungleich der Basis) Arbeitskopie: Konflikt, nichts ueberschrieben', (() => {
      writeFileSync(f.repo, dokument('Repo D', 11));
      const a = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
      return a.fall === 'konflikt' && lies(f.arbeit) === roh;
    })());

    const g = fall(dokument('Repo A'));
    weltAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit });
    writeFileSync(g.arbeit, dokument('Wegwerfen', 5));
    const v = weltVerwerfen({ repoDatei: g.repo, arbeitsDatei: g.arbeit });
    check('verwerfen: Arbeitskopie = Repo, Basis = Repo-Hash', lies(g.arbeit) === lies(g.repo) && basisLesen(g.arbeit) === layoutHash(lies(g.repo)));
    check('verwerfen: die verworfene Arbeitskopie liegt als Sicherung daneben', v.sicherung !== null && lies(v.sicherung) === dokument('Wegwerfen', 5));
    // N4: 12 weitere Verwerfen (und 12 Editor-Speicherungen) lassen die erste Bearbeitung nicht verschwinden.
    const erstesX = dokument('ErsteBearbeitung', 3);
    writeFileSync(g.arbeit, erstesX);
    const ersteSicherung = weltVerwerfen({ repoDatei: g.repo, arbeitsDatei: g.arbeit }).sicherung!;
    for (let k = 0; k < 12; k++) {
      writeFileSync(g.arbeit, dokument(`Spaeter${k}`, 10 + k));
      weltVerwerfen({ repoDatei: g.repo, arbeitsDatei: g.arbeit });
      layoutSchreiben(g.arbeit, JSON.parse(dokument(`Editor${k}`, 20 + k)));
    }
    check('verwerfen (N4): die erste Bearbeitung ist nach 12 weiteren Verwerfen und 12 Speicherungen noch gesichert', existsSync(ersteSicherung) && lies(ersteSicherung) === erstesX && readdirSync(g.ordner).filter((n) => n.endsWith('.bak')).length <= 10);
    const fehlt = fall(dokument('Repo A'));
    const vf = weltVerwerfen({ repoDatei: fehlt.repo, arbeitsDatei: fehlt.arbeit });
    check('verwerfen (N4): ohne Arbeitskopie wird sie aus dem Repo angelegt (kein Abbruch)', vf.angelegt && vf.sicherung === null && lies(fehlt.arbeit) === lies(fehlt.repo) && basisLesen(fehlt.arbeit) === layoutHash(lies(fehlt.repo)));
    const kaputtesRepo = fall('{kaputt');
    check('verwerfen: ein kaputtes Repo wird nicht kopiert, nichts angelegt', (() => {
      try {
        weltVerwerfen({ repoDatei: kaputtesRepo.repo, arbeitsDatei: kaputtesRepo.arbeit });
        return false;
      } catch {
        return !existsSync(kaputtesRepo.arbeit);
      }
    })());
  }

  // ── H2: Abnehmen im Worktree, dann ein DEV-Neustart vor dem Merge ──────
  {
    const r0 = dokument('R0', 100);
    const x = dokument('X', 222);
    const f = fall(r0);
    weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit }); // W = B = R0
    writeFileSync(f.arbeit, x); // der Editor speichert X
    // Das Abnehmen laeuft im Worktree: eine ANDERE Repo-Datei (Branch), dieselbe Arbeitskopie (lesend).
    const branchRepo = resolve(T, 'branch-repo.json');
    weltAbnehmen({ repoDatei: branchRepo, arbeitsDatei: f.arbeit });
    check('H2: nach dem Abnehmen im Worktree ist die Basis der DEV-Arbeitskopie unveraendert (R0)', basisLesen(f.arbeit) === layoutHash(r0) && lies(f.arbeit) === x && lies(branchRepo) === x);
    // DEV startet neu, main steht noch auf R0 (Branch nicht gemergt).
    const a = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('H2: DEV-Neustart vor dem Merge zieht X NICHT zurueck', a.fall === 'unveraendert' && lies(f.arbeit) === x);
    // Nach dem Merge (Repo = X) und Rollout: Arbeitskopie = Repo, Basis wird nachgetragen.
    writeFileSync(f.repo, x);
    const b = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    check('H2: nach Merge und Rollout traegt der Start die Basis nach', b.fall === 'unveraendert' && basisLesen(f.arbeit) === layoutHash(x));
  }

  // ── N1 und Sanitizer-Pruefung: kaputte Dateien werden nicht kopiert ───
  {
    const gut = dokument('Gut', 100);
    // W kein JSON / leer, Repo = Basis
    for (const [name, inhalt] of [['kein JSON', '{kaputt'], ['leer', ''], ['kein Weltdokument', '{"foo":1}']] as const) {
      const f = fall(gut);
      weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
      writeFileSync(f.arbeit, inhalt);
      const a = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
      check(`N1 Arbeitskopie ${name}: eigener Fall arbeit-kaputt, Datei und Basis unveraendert`, a.fall === 'arbeit-kaputt' && lies(f.arbeit) === inhalt && basisLesen(f.arbeit) === layoutHash(gut) && /FEHLER Arbeitskopie/.test(a.meldung), a.fall);
      // auch bei neuem Repo wird die kaputte Arbeitskopie nicht stillschweigend ersetzt
      writeFileSync(f.repo, dokument('Neu', 7));
      const b = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
      check(`N1 Arbeitskopie ${name}, Repo neu: weiter arbeit-kaputt, nichts ersetzt`, b.fall === 'arbeit-kaputt' && lies(f.arbeit) === inhalt);
    }
    // Repo kein JSON / leer, W = Basis
    for (const [name, inhalt] of [['kein JSON', '{kaputt'], ['leer', '']] as const) {
      const f = fall(gut);
      weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
      writeFileSync(f.repo, inhalt);
      const a = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
      check(`N1 Repo ${name}: repo-kaputt, Arbeitskopie bleibt das gute Dokument, keine Sicherung`, a.fall === 'repo-kaputt' && lies(f.arbeit) === gut && basisLesen(f.arbeit) === layoutHash(gut) && !readdirSync(f.ordner).some((n) => n.endsWith('.bak')), a.fall);
      const g = fall(inhalt);
      const b = weltAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit });
      check(`N1 Arbeitskopie fehlt, Repo ${name}: repo-kaputt, NICHTS angelegt`, b.fall === 'repo-kaputt' && !existsSync(g.arbeit) && !existsSync(basisDatei(g.arbeit)));
    }
  }

  // ── M1: Sicherung vor dem Nachziehen, gleiche Sperre wie das Speichern ─
  {
    const f = fall(dokument('R0', 100));
    weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    const alt = lies(f.arbeit);
    writeFileSync(f.repo, dokument('R1', 300));
    const a = weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    const baks = readdirSync(f.ordner).filter((n) => n.endsWith('.bak'));
    check('M1: vor dem Nachziehen wird der alte Stand als .bak gesichert', a.fall === 'nachgezogen' && baks.length === 1 && a.sicherung !== null && a.sicherung !== undefined && lies(a.sicherung) === alt, baks.join(','));
    // mehrere Nachziehvorgaenge: begrenzte Anzahl
    for (let k = 0; k < 14; k++) {
      writeFileSync(f.repo, dokument(`R${k + 2}`, 400 + k));
      weltAbgleichen({ repoDatei: f.repo, arbeitsDatei: f.arbeit });
    }
    check('M1: die .bak-Anzahl bleibt begrenzt (<= 10)', readdirSync(f.ordner).filter((n) => n.endsWith('.bak')).length <= 10);
    check('M1: nach dem Abgleich bleibt keine Sperre und kein Tmp liegen', !readdirSync(f.ordner).some((n) => n.endsWith('.lock') || n.endsWith('.tmp')), readdirSync(f.ordner).join(','));
    // Der Abgleich nimmt DIESELBE Sperrdatei wie das Speichern: eine fremde, lebende Sperre haelt ihn auf.
    const g = fall(dokument('R0', 100));
    writeFileSync(`${g.arbeit}.lock`, JSON.stringify({ pid: process.ppid, start: null, host: 'fremd', marke: 'x' }));
    const t0 = Date.now();
    let gewartet = false;
    try {
      weltAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit, sperreWartenMs: 300 });
    } catch (fe) {
      gewartet = /gesperrt/.test((fe as Error).message) && Date.now() - t0 >= 250;
    }
    check('M1: eine fremde Sperre auf <arbeitskopie>.lock haelt den Abgleich auf (gleiche Sperrdatei wie layoutSchreiben)', gewartet && !existsSync(g.arbeit));
    rmSync(`${g.arbeit}.lock`, { force: true });
    // Nur pruefen liest ohne Sperre.
    writeFileSync(`${g.arbeit}.lock`, JSON.stringify({ pid: process.ppid, start: null, host: 'fremd', marke: 'x' }));
    check('M1: pruefen wartet nicht auf die Sperre', weltAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit, modus: 'pruefen' }).fall === 'angelegt');
    rmSync(`${g.arbeit}.lock`, { force: true });
  }

  // ── N1 (K5.7 N2): eine leere oder unlesbare Sperre gilt als verwaist und wird sofort gebrochen ─────────────
  {
    for (const [name, inhalt] of [
      ['leer', ''],
      ['nur Leerraum', '  \n'],
      ['kein JSON', 'x'],
      ['JSON ohne Besitzangabe', '{}'],
      ['abgeschnitten', '{"pid":123,"sta'],
    ] as const) {
      const g = fall(dokument('R0', 100));
      writeFileSync(`${g.arbeit}.lock`, inhalt);
      const t0 = Date.now();
      let ergebnis = '';
      try {
        ergebnis = weltAbgleichen({ repoDatei: g.repo, arbeitsDatei: g.arbeit, sperreWartenMs: 300 }).fall;
      } catch (fe) {
        ergebnis = `FEHLER ${(fe as Error).message.slice(0, 120)}`;
      }
      const dauer = Date.now() - t0;
      check(`N1: Sperre "${name}": sofort gebrochen (Abgleich laeuft, ${dauer} ms < 250), Arbeitskopie angelegt, keine Sperre und kein Tmp uebrig`, ergebnis === 'angelegt' && dauer < 250 && existsSync(g.arbeit) && !readdirSync(g.ordner).some((n) => n.endsWith('.lock') || n.endsWith('.tmp')), `${ergebnis} ${dauer} ms ${readdirSync(g.ordner).join(',')}`);
    }
    // Eine Sperre mit lesbarer Angabe eines nicht pruefbaren Besitzers (anderer Rechner) bleibt: nur eine leere wird sofort gebrochen.
    const h = fall(dokument('R0', 100));
    writeFileSync(`${h.arbeit}.lock`, JSON.stringify({ pid: process.ppid, start: null, host: 'fremd', marke: 'x' }));
    let blieb = false;
    try {
      weltAbgleichen({ repoDatei: h.repo, arbeitsDatei: h.arbeit, sperreWartenMs: 300 });
    } catch (fe) {
      blieb = /gesperrt/.test((fe as Error).message);
    }
    check('N1: eine Sperre mit lesbarer Besitzangabe (auch mit nicht pruefbarem Besitzer) wird nicht gebrochen', blieb && existsSync(`${h.arbeit}.lock`) && !existsSync(h.arbeit));
    rmSync(`${h.arbeit}.lock`, { force: true });
    // Ein Anleger, der zwischen Schreiben und `link` starb, laesst `<datei>.lock.<pid>.<hex>.tmp` zurueck: der naechste Halter raeumt es weg.
    const o = fall(dokument('R0', 100));
    writeFileSync(resolve(o.ordner, '.dev.json.lock.2147483646.abcdef123456.tmp'), '{}');
    writeFileSync(resolve(o.ordner, `.dev.json.lock.${process.pid}.abcdef123456.tmp`), '{}');
    weltAbgleichen({ repoDatei: o.repo, arbeitsDatei: o.arbeit });
    check('N1: Tmp-Rest eines toten Sperr-Anlegers wird beim naechsten Halten weggeraeumt, ein Tmp der eigenen pid bleibt', !existsSync(resolve(o.ordner, '.dev.json.lock.2147483646.abcdef123456.tmp')) && existsSync(resolve(o.ordner, `.dev.json.lock.${process.pid}.abcdef123456.tmp`)), readdirSync(o.ordner).join(','));
    rmSync(resolve(o.ordner, `.dev.json.lock.${process.pid}.abcdef123456.tmp`), { force: true });
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
