/**
 * E7 — die zweite Basis-URL: `Gen_`-Module kommen aus `assets/generiert/`.
 *
 * ── Was hier eigentlich behauptet wird ───────────────────────────────
 * Zwei Zusagen, die zusammen erst etwas wert sind:
 *
 *   (1) Der AssetManager FRAGT ein Modul mit `Gen_`-Präfix unter
 *       `/assets/generiert/` an, jedes andere unter `/assets/models/`.
 *   (2) Der Vite-Dev-Server LIEFERT unter genau diesem Pfad aus.
 *
 * Fiele eine der beiden weg, wäre die andere wertlos, und keiner der
 * bestehenden Tests würde rot: Die von Hand gepflegten Modelle lägen
 * weiter richtig. Der Fehler zeigte sich erst im Browser, als ein
 * frisch gebauter Saal, den der Editor im Katalog anzeigt, als
 * Platzhalter erscheint.
 *
 * ── Warum ein echter HTTP-Server der Zeuge ist ───────────────────────
 * Ein Test, der `modelBaseUrl('Gen_X')` gegen `'/assets/generiert/'`
 * hielte, schriebe die Konstante ein zweites Mal auf und bestünde auch
 * dann noch, wenn `loadContainer` sie gar nicht benutzt. Gemessen wird
 * deshalb am einzigen Ort, an dem beide Hälften aufeinandertreffen: Ein
 * `node:http`-Server fährt die ECHTE Ausliefer-Regel aus
 * `client/vite.config.ts` (`assetHandler`, nicht eine Nachbildung) und
 * schreibt jeden angefragten Pfad mit. Der AssetManager erfährt weder
 * den Port noch den Ordner — er kennt nur seine Basis-URLs. Was im
 * Mitschnitt steht, hat er also selbst gewählt.
 *
 * ── Warum eine XHR-Attrappe nötig ist ────────────────────────────────
 * Babylon lädt über `Tools.LoadFile` → `WebRequest` → `XMLHttpRequest`,
 * und das gibt es in Node nicht. Die Attrappe unten ist bewusst dumm:
 * sie leitet nur auf `node:http` um und misst nichts. Alles, was dieser
 * Test behauptet, steht im Mitschnitt des SERVERS, nicht in ihr.
 * `FileToolsOptions.BaseUrl` hängt den Ursprung vor die absoluten
 * `/assets/…`-Pfade — derselbe Mechanismus, den Babylon im Browser für
 * einen fremden CDN-Ursprung vorsieht.
 *
 * Lauf:  npx tsx client/test/gen-basis-laden.ts
 *
 * The second base URL end to end: a Gen_-prefixed module is requested
 * from /assets/generiert/, everything else from /assets/models/, and the
 * real Vite dev-server rule serves both. Witness is the HTTP server's
 * request log, not a restated constant.
 */
import { createServer, get as httpGet, type IncomingMessage, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FileToolsOptions } from '@babylonjs/core/Misc/fileTools';
import { Logger } from '@babylonjs/core/Misc/logger';
// Derselbe Seiteneffekt-Import wie in `AssetManager.ts` — ohne ihn kennt
// der SceneLoader die Endung `.glb` nicht.
import '@babylonjs/loaders/glTF/2.0';
// Wie im Client: ohne diesen Import fehlen die thinInstance*-Methoden am
// Mesh, obwohl die Typen sie kennen.
import '@babylonjs/core/Meshes/thinInstanceMesh';

import { buildHall } from '@wov/shared/src/hallenGeometrie.js';
import { encodeGlb } from '../../server/src/world/dungeon/GlbWriter.js';
import { AssetManager } from '../src/engine/AssetManager';

let fehler = 0;
function pruefe(bedingung: boolean, was: string): void {
  if (bedingung) {
    console.log(`  OK   ${was}`);
  } else {
    fehler++;
    console.error(`  ROT  ${was}`);
  }
}

/** Der generierte Saal und ein Bestandsmodul daneben — beide echte GLBs. */
const GEN_NAME = 'Gen_StoneVaultHall3x3';
const BESTAND_NAME = 'StoneVaultHallLarge';

// ── XHR-Attrappe auf node:http (s. Kopf) ─────────────────────────────
type Zuhoerer = (ereignis: unknown) => void;

class NodeXhr {
  /** `fileTools.ts` liest `XMLHttpRequest.DONE` als Wert, nicht nur als Typ. */
  static readonly DONE = 4;

  readyState = 0;
  status = 0;
  statusText = '';
  response: ArrayBuffer | string | null = null;
  responseText = '';
  responseType = '';
  responseURL = '';
  timeout = 0;
  onprogress: Zuhoerer | null = null;

  private readonly zuhoerer = new Map<string, Set<Zuhoerer>>();
  private url = '';
  private kopfzeilen: Record<string, string> = {};
  private abgebrochen = false;

  open(_method: string, url: string): void {
    this.url = url;
    this.readyState = 1;
  }

  setRequestHeader(): void {
    /* Der Testserver wertet keine Kopfzeilen aus. */
  }

  addEventListener(typ: string, fn: Zuhoerer): void {
    if (!this.zuhoerer.has(typ)) this.zuhoerer.set(typ, new Set());
    this.zuhoerer.get(typ)!.add(fn);
  }

  removeEventListener(typ: string, fn: Zuhoerer): void {
    this.zuhoerer.get(typ)?.delete(fn);
  }

  getResponseHeader(name: string): string | null {
    return this.kopfzeilen[name.toLowerCase()] ?? null;
  }

  abort(): void {
    this.abgebrochen = true;
  }

  send(): void {
    httpGet(this.url, (res: IncomingMessage) => {
      const teile: Buffer[] = [];
      res.on('data', (d: Buffer) => teile.push(d));
      res.on('end', () => {
        if (this.abgebrochen) return;
        const rumpf = Buffer.concat(teile);
        this.status = res.statusCode ?? 0;
        this.statusText = res.statusMessage ?? '';
        this.responseURL = this.url;
        this.kopfzeilen = Object.fromEntries(
          Object.entries(res.headers).map(([k, v]) => [k, String(v)])
        );
        this.responseText = rumpf.toString('utf8');
        this.response =
          this.responseType === 'arraybuffer'
            ? rumpf.buffer.slice(rumpf.byteOffset, rumpf.byteOffset + rumpf.byteLength)
            : this.responseText;
        this.readyState = NodeXhr.DONE;
        // Reihenfolge wie im Browser: erst readystatechange, dann loadend.
        for (const fn of [...(this.zuhoerer.get('readystatechange') ?? [])]) fn({});
        for (const fn of [...(this.zuhoerer.get('loadend') ?? [])]) fn({});
      });
    }).on('error', (err: Error) => {
      if (this.abgebrochen) return;
      this.status = 0;
      this.statusText = err.message;
      this.readyState = NodeXhr.DONE;
      for (const fn of [...(this.zuhoerer.get('readystatechange') ?? [])]) fn({});
      for (const fn of [...(this.zuhoerer.get('loadend') ?? [])]) fn({});
    });
  }
}

/**
 * Ein einzelner GET auf einen ROHEN Pfad — für die Ausbruchsprobe.
 *
 * `httpGet('http://…/assets/../x')` taugt dafür nicht: Node normalisiert
 * die URL vor dem Absenden, der Server bekäme `/x` zu sehen und wiese es
 * ab, weil es nicht mit `/assets/` beginnt. Die Probe wäre grün, ohne je
 * am Wächter gewesen zu sein. Über die `path`-Option geht die Zeichenkette
 * unverändert auf die Leitung — und mit `%2f` statt `/` überlebt der
 * Ausbruch auch jede Normalisierung unterwegs.
 */
function hole(port: number, pfad: string): Promise<number> {
  return new Promise((fertig, schiefgegangen) => {
    httpGet({ host: '127.0.0.1', port, path: pfad }, (res) => {
      res.resume();
      res.on('end', () => fertig(res.statusCode ?? 0));
    }).on('error', schiefgegangen);
  });
}

async function main(): Promise<void> {
  console.log('\nE7 — Gen_-Module aus der zweiten Basis-URL\n');

  /*
    Ein Wegwerf-Assetordner ausserhalb des Repos. Der echte
    `assets/`-Ordner liegt bewusst ausserhalb des Repos und fehlt im
    CI-Checkout ganz — ein Test, der ihn bräuchte, liefe dort nie. Der
    Nachbar `assets-neben` daneben ist die Ausbruchsprobe: sein Name
    beginnt als Zeichenkette mit dem der Wurzel.
  */
  const basis = mkdtempSync(join(tmpdir(), 'wov-e7-'));
  const wurzel = join(basis, 'assets');
  mkdirSync(join(wurzel, 'models'), { recursive: true });
  mkdirSync(join(wurzel, 'generiert'), { recursive: true });
  mkdirSync(join(basis, 'assets-neben'), { recursive: true });

  const saal = buildHall(3, 3, { raster: 2 });
  writeFileSync(
    join(wurzel, 'generiert', `${GEN_NAME}.glb`),
    encodeGlb(saal.boxes, { name: GEN_NAME })
  );
  writeFileSync(
    join(wurzel, 'models', `${BESTAND_NAME}.glb`),
    encodeGlb(saal.boxes, { name: BESTAND_NAME })
  );
  writeFileSync(join(basis, 'assets-neben', 'Gen_Boese.glb'), 'kein GLB');

  /*
    Die Ausliefer-Regel des Dev-Servers, im Original. `vite.config.ts`
    liest beim Laden den Admin-Token; die Umleitung auf /dev/null hält
    die Warnung aus dem Testprotokoll, ohne dass der Test etwas
    vortäuscht — der Token spielt für /assets/ keine Rolle.
  */
  process.env.WOV_ADMIN_TOKEN_DATEI = '/dev/null';
  const { assetHandler } = await import('../vite.config.js');
  const regel = assetHandler(wurzel);

  const gesehen: string[] = [];
  const server: Server = createServer((req, res) => {
    if (req.url) gesehen.push(req.url);
    regel(req, res, () => {
      res.statusCode = 404;
      res.end('kein /assets/');
    });
  });
  await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig));
  const port = (server.address() as { port: number }).port;
  const ursprung = `http://127.0.0.1:${port}`;

  const echtesXhr = (globalThis as Record<string, unknown>).XMLHttpRequest;
  const echteBasis = FileToolsOptions.BaseUrl;
  const echteWiederholung = FileToolsOptions.DefaultRetryStrategy;
  (globalThis as Record<string, unknown>).XMLHttpRequest = NodeXhr;
  FileToolsOptions.BaseUrl = ursprung;
  /*
    Ohne das versucht Babylon einen fehlgeschlagenen Ladeversuch
    mehrfach mit wachsender Wartezeit. Im Spiel richtig, im Test nur
    langsam — und der ROTE Fall ist hier der interessante.
  */
  FileToolsOptions.DefaultRetryStrategy = () => -1;

  const engine = new NullEngine();
  const scene = new Scene(engine);
  const stille = { error: Logger.Error, warn: Logger.Warn };
  Logger.Error = () => {};
  Logger.Warn = () => {};

  try {
    const am = new AssetManager(scene);
    const gen = await am.instantiate(GEN_NAME);
    const bestand = await am.instantiate(BESTAND_NAME);

    console.log(`  Mitschnitt des Servers: ${gesehen.join('  ')}`);
    console.log(`  AssetManager.failed:    ${[...am.failed.keys()].join(', ') || '(leer)'}`);

    pruefe(
      gesehen.includes(`/assets/generiert/${GEN_NAME}.glb`),
      `Server sieht /assets/generiert/${GEN_NAME}.glb`
    );
    pruefe(
      !gesehen.includes(`/assets/models/${GEN_NAME}.glb`),
      `Server sieht KEIN /assets/models/${GEN_NAME}.glb`
    );
    pruefe(
      gesehen.includes(`/assets/models/${BESTAND_NAME}.glb`),
      `Bestandsmodul bleibt unter /assets/models/`
    );
    pruefe(gen !== null, `${GEN_NAME} ist wirklich geladen (nicht nur angefragt)`);
    pruefe(bestand !== null, `${BESTAND_NAME} ist wirklich geladen`);
    pruefe(am.failed.size === 0, 'kein Ladefehler im AssetManager');

    // ── Ausbruchsprobe ────────────────────────────────────────────────
    const raus = await hole(port, '/assets/..%2fassets-neben/Gen_Boese.glb');
    const drin = await hole(port, `/assets/generiert/${GEN_NAME}.glb`);
    console.log(`  /assets/..%2fassets-neben/ → ${raus}, /assets/generiert/ → ${drin}`);
    pruefe(raus === 404, 'Ausbruch aus dem Assetordner wird abgewiesen (404)');
    pruefe(drin === 200, 'der generierte Ordner selbst wird ausgeliefert (200)');
  } finally {
    Logger.Error = stille.error;
    Logger.Warn = stille.warn;
    scene.dispose();
    engine.dispose();
    await new Promise<void>((fertig) => server.close(() => fertig()));
    (globalThis as Record<string, unknown>).XMLHttpRequest = echtesXhr;
    FileToolsOptions.BaseUrl = echteBasis;
    FileToolsOptions.DefaultRetryStrategy = echteWiederholung;
    rmSync(basis, { recursive: true, force: true });
  }

  console.log(fehler === 0 ? '\nE7-Basis: alles grün.\n' : `\nE7-Basis: ${fehler} ROT.\n`);
  process.exit(fehler > 0 ? 1 : 0);
}

void main();
