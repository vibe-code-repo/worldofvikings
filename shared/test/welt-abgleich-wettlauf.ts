/**
 * Wettlauf Abgleich gegen Editor-Speichern (editor stage E2, card K5.7, M1).
 *
 * Beim Start des Spielservers zieht `weltAbgleichen` die Arbeitskopie nach; im selben Moment kann der Editor ueber den
 * Betriebsdienst speichern (`layoutSchreiben` mit Basis). Beide muessen dieselbe Sperre nehmen, sonst
 *   - geht eine akzeptierte Bearbeitung still verloren (Speichern gewinnt, dann ueberschreibt der Abgleich), oder
 *   - meldet der Abgleich "nachgezogen", obwohl dazwischen eine Bearbeitung kam (Arbeitskopie = X, nicht Repo).
 * Gemessen am Stand ohne Sperre (Angriff): 4-12 verlorene Bearbeitungen und 28-280 falsche Meldungen in je 500 Runden.
 *
 * Zwei Prozesse (nicht Threads: die Sperre erkennt "eigene Sperrleichen" an der pid), ein Vater, der die Runden per IPC
 * anstoesst. Je Runde: Arbeitskopie = Basis = R0, Repo = R1; Abgleich und Speichern (Basis = Hash von R0) starten nach
 * zufaelligem Versatz. Erwartet: 0 verlorene Bearbeitungen, 0 falsche "nachgezogen".
 *
 *   npx tsx test/welt-abgleich-wettlauf.ts   (from shared/)
 *
 * Runden: WOV_WETTLAUF_RUNDEN (Vorgabe 300). Alles in einem Temp-Verzeichnis.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutHash, layoutSchreiben, layoutText, LayoutVeraltet } from '../src/worldlayout/layoutDatei.js';
import { sanitizeWorldLayout } from '../src/worldlayout/sanitize.js';
import { weltAbgleichen } from '../src/worldlayout/weltArbeitskopie.js';

if (process.argv[2] === 'kind') {
  // Kindprozess: eine Rolle, wartet auf "los" des Vaters, busy-wartet den Versatz, fuehrt aus, antwortet.
  const [, , , rolle, repo, arbeit, editorText, basisRoh] = process.argv;
  const busy = (us: number): void => {
    const ende = process.hrtime.bigint() + BigInt(us) * 1000n;
    while (process.hrtime.bigint() < ende) {
      /* Versatz */
    }
  };
  process.on('message', (m: { los: number; versatzUs: number }) => {
    busy(m.versatzUs);
    let antwort: string;
    try {
      if (rolle === 'abgleich') antwort = weltAbgleichen({ repoDatei: repo!, arbeitsDatei: arbeit! }).fall;
      else {
        layoutSchreiben(arbeit!, JSON.parse(editorText!), 0, { basis: basisRoh });
        antwort = 'gespeichert';
      }
    } catch (fehler) {
      antwort = fehler instanceof LayoutVeraltet ? 'veraltet' : `fehler:${(fehler as Error).message}`;
    }
    process.send!({ los: m.los, antwort });
  });
  process.send!({ bereit: true });
} else {
  await vater();
}

async function vater(): Promise<void> {
  const RUNDEN = Number(process.env.WOV_WETTLAUF_RUNDEN ?? 300);
  const T = mkdtempSync(resolve(tmpdir(), 'wov-welt-wettlauf-'));
  const dokument = (name: string, radius: number): string =>
    layoutText(
      sanitizeWorldLayout({
        version: 1,
        name,
        detailSeed: 'ak',
        continents: [],
        regions: [{ id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2000 }, edgeFalloff: 300 }],
        lakes: [{ id: 'lk-00', x: 0, z: 0, radius }],
      })!
    );
  const skript = fileURLToPath(import.meta.url);
  const r0 = dokument('R0', 100);
  const r1 = dokument('R1', 300);
  const xText = dokument('EditorX', 77);
  const repo = resolve(T, 'repo-dev.json');
  const arbeitsOrdner = resolve(T, 'arbeit');
  const arbeit = resolve(arbeitsOrdner, 'dev.json');
  type Kind = ReturnType<typeof spawn>;
  const starte = (rolle: 'abgleich' | 'speichern'): Kind =>
    spawn(process.execPath, [...process.execArgv, skript, 'kind', rolle, repo, arbeit, xText, layoutHash(r0)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const kinder = [starte('abgleich'), starte('speichern')];
  try {
    await Promise.all(kinder.map((k) => new Promise<void>((ok) => k.once('message', () => ok()))));
    const runde = (k: Kind, los: number, versatzUs: number): Promise<string> =>
      new Promise((ok) => {
        const h = (m: { los?: number; antwort?: string }): void => {
          if (m.los === los) {
            k.off('message', h);
            ok(m.antwort ?? '');
          }
        };
        k.on('message', h);
        k.send!({ los, versatzUs });
      });
    const z = { verloren: 0, falschNachgezogen: 0, konflikt: 0, veraltet: 0, gespeichert: 0, fehler: 0 };
    for (let n = 0; n < RUNDEN; n++) {
      rmSync(arbeitsOrdner, { recursive: true, force: true });
      mkdirSync(arbeitsOrdner, { recursive: true });
      writeFileSync(repo, r0);
      weltAbgleichen({ repoDatei: repo, arbeitsDatei: arbeit }); // W = B = R0
      writeFileSync(repo, r1); // das Repo ist weiter
      // Versatz 0-1500 µs je Seite, damit sich die Abschnitte in beiden Reihenfolgen und ueberlappend treffen.
      const [a, s] = await Promise.all([runde(kinder[0]!, n, Math.floor(Math.random() * 1500)), runde(kinder[1]!, n, Math.floor(Math.random() * 1500))]);
      const endW = readFileSync(arbeit, 'utf-8');
      if (a.startsWith('fehler') || s.startsWith('fehler')) z.fehler++;
      else if (s === 'gespeichert' && endW === r1) z.verloren++; // Bearbeitung akzeptiert, danach still weg
      else if (a === 'nachgezogen' && endW !== r1) z.falschNachgezogen++; // "nachgezogen" gemeldet, W ist aber X
      if (a === 'konflikt') z.konflikt++;
      if (s === 'veraltet') z.veraltet++;
      if (s === 'gespeichert') z.gespeichert++;
    }
    console.log(`Wettlauf ${RUNDEN} Runden: verloren=${z.verloren} falsch-nachgezogen=${z.falschNachgezogen} konflikt=${z.konflikt} gespeichert=${z.gespeichert} veraltet=${z.veraltet} fehler=${z.fehler}`);
    let fehler = 0;
    const check = (name: string, ok: boolean, detail = ''): void => {
      if (!ok) fehler++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` (${detail})` : ''}`);
    };
    check('M1 Wettlauf: 0 verlorene Bearbeitungen', z.verloren === 0, String(z.verloren));
    check('M1 Wettlauf: 0 falsche "nachgezogen"-Meldungen', z.falschNachgezogen === 0, String(z.falschNachgezogen));
    check('M1 Wettlauf: keine Fehler; beide Ausgaenge kommen vor (Speichern ok und abgelehnt), also wurde der Wettlauf wirklich getroffen', z.fehler === 0 && z.gespeichert > 0 && z.veraltet > 0 && z.gespeichert + z.veraltet === RUNDEN, JSON.stringify(z));
    if (fehler > 0) process.exitCode = 1;
    else console.log('\nwelt-abgleich-wettlauf: alles gruen');
  } finally {
    for (const k of kinder) k.kill('SIGTERM');
    rmSync(T, { recursive: true, force: true });
  }
}
