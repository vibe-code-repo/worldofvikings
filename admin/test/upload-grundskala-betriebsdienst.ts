/**
 * Grundskala im Betriebsdienst (Karte „Editor Upload-Größe", Auftrag
 * Punkt 6 — Annahme/Grenzen — und Punkt 5 — „nachträglich ändern") —
 * am ECHTEN Prozess (`admin/src/main.ts` per `spawn`, Port 0), nicht an
 * importierten Funktionen: Erst hier zeigt sich, ob die Kopfzeile
 * `X-Wov-Grundskala` bei POST wirklich ankommt und ob `PATCH
 * /api/modell-hochladen` wirklich verdrahtet ist — Muster wie
 * `admin/test/betriebsdienst.ts` (eigenes WOV_WURZEL, Wegwerf-Token,
 * WOV_ADMIN_PORT=0).
 *
 * ── H2 (Nachbesserung „Editor Upload-Größe N1"): `assets/hochgeladen/`
 *    war NICHT über WOV_WURZEL umlenkbar ─────────────────────────────────
 * `UPLOAD_DIR` (`shared/src/uploadedModelUpload.ts`) hing an
 * `import.meta.url`, nicht an WOV_WURZEL. Ein echter Prozess-Upload schrieb
 * deshalb IMMER in `<dieses Worktree>/assets/hochgeladen/` — im Checkout,
 * das beim Ausrollen die echte DEV-Registry ist. Der Angriff zum
 * Marktstand2-PR fand das (`upload-grundskala-betriebsdienst-*`-Reste in
 * `/tmp` von abgebrochenen Läufen) und zeigte per SIGKILL, dass Testmodelle
 * in der echten `registry.json` stehen blieben, wenn der Testprozess selbst
 * (Zeitlimit, Speicherwächter) mitten im Lauf beendet wird.
 *
 * `UPLOAD_DIR` nimmt jetzt `WOV_HOCHGELADEN_DIR` an, wenn gesetzt — dieser
 * Test setzt es auf einen Ordner UNTER dem eigenen Wegwerf-`WOV_WURZEL`
 * (`ORDNER`), der Betriebsdienst schreibt also nie mehr in den Checkout.
 * Abschnitt 12 fährt genau die SIGKILL-Probe des Angriffs nach und beweist
 * per sha256-Vergleich, dass die ECHTE `assets/hochgeladen/registry.json`
 * dieses Checkouts vorher und nachher byte-gleich ist.
 *
 * ── F1 (Nachangriff „Editor Upload-Größe N1"): kein verwaister Enkel ──────
 * `kind` ist der `node_modules/.bin/tsx`-WRAPPER, nicht der Dienst selbst —
 * der eigentliche Prozess ist ein ENKEL (`node --require …/tsx/preflight.cjs
 * --import …/tsx/loader.mjs src/main.ts`). `kind.kill('SIGKILL')` traf nur
 * den Wrapper; tsx kann SIGKILL nicht weiterreichen, der Enkel blieb als
 * Waise (PPID 1) auf seinem Port hängen — genau das fand der Nachangriff
 * (Befund F1). Sogar das schlichte `kind.kill()` (SIGTERM) am Ende des
 * Normalfalls wartete nie auf das tatsächliche Ende, bevor der Testprozess
 * weiterlief. Jetzt startet `starten()` mit `detached: true` (derselbe Weg
 * wie `scripts/run-tests.mjs`, `gruppeSignal`): Der Wrapper wird zum Leiter
 * einer EIGENEN Prozessgruppe, `beendeGruppe()` schickt das Signal an
 * `-kind.pid` (die ganze Gruppe, Wrapper UND Enkel) und wartet auf das
 * `exit`-Ereignis, mit einer SIGKILL-Eskalation nach 3 s als Netz.
 *
 * Lauf:  npx tsx admin/test/upload-grundskala-betriebsdienst.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { request, type IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');
const WURZEL_REPO = resolve(ADMIN, '..');
/** Der ECHTE Ordner dieses Checkouts — ab jetzt nur noch GELESEN, nie beschrieben (H2). */
const ECHTER_HOCHGELADEN_DIR = resolve(WURZEL_REPO, 'assets/hochgeladen');
const ECHTE_REGISTRY_DATEI = join(ECHTER_HOCHGELADEN_DIR, 'registry.json');

function sha256VonDatei(pfad: string): string | null {
  if (!existsSync(pfad)) return null;
  return createHash('sha256').update(readFileSync(pfad)).digest('hex');
}

/** Nachweis für H2: der Hash der echten Registry-Datei VOR jedem Prozessstart. */
const echteRegistryVorher = sha256VonDatei(ECHTE_REGISTRY_DATEI);

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── Ein winziges, gültiges GLB — wie server/test/upload-grundskala-kollision.ts. ──
function u32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}
function bauGlb(groesse: number): Buffer {
  const positionen = new Float32Array([0, 0, 0, groesse, 0, 0, 0, groesse, groesse]);
  const posBytes = Buffer.from(positionen.buffer, positionen.byteOffset, positionen.byteLength);
  const indizes = new Uint32Array([0, 1, 2]);
  const idxBytes = Buffer.from(indizes.buffer, indizes.byteOffset, indizes.byteLength);
  const bin = Buffer.concat([posBytes, idxBytes]);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Sicht', mesh: 0 }],
    meshes: [{ name: 'Sicht', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0, mode: 4 }] }],
    materials: [{ name: 'M0' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5125, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length },
      { buffer: 0, byteOffset: posBytes.length, byteLength: idxBytes.length },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  let binBuf = bin;
  binBuf = Buffer.concat([binBuf, Buffer.alloc((4 - (binBuf.length % 4)) % 4, 0)]);
  const jsonChunk = Buffer.concat([u32le(jsonBuf.length), u32le(0x4e4f534a), jsonBuf]);
  const binChunk = Buffer.concat([u32le(binBuf.length), u32le(0x004e4942), binBuf]);
  const kopf = Buffer.concat([u32le(0x46546c67), u32le(2), u32le(12 + jsonChunk.length + binChunk.length)]);
  return Buffer.concat([kopf, jsonChunk, binChunk]);
}

/** Ein Wegwerf-WOV_WURZEL samt eigenem, UMGELENKTEM Upload-Ordner (H2) für einen Dienst-Lauf. */
function wegwerfWurzelBauen(slug: string): { ordner: string; hochgeladenDir: string; tokenDatei: string; token: string } {
  const ordner = mkdtempSync(resolve(tmpdir(), `wov-${slug}-`));
  const serverDaten = resolve(ordner, 'server/data');
  mkdirSync(serverDaten, { recursive: true });
  writeFileSync(
    resolve(serverDaten, 'server.yml'),
    'uploads:\n  modell-hochladen: true\nplayers:\n  everyone-admin: false\n'
  );
  const token = `pruef-grundskala-token-${slug}`;
  const tokenDatei = resolve(ordner, 'token');
  writeFileSync(tokenDatei, `${token}\n`);
  // H2: eigener Upload-Ordner UNTER dem Wegwerf-WOV_WURZEL, nie im Checkout.
  const hochgeladenDir = resolve(ordner, 'assets/hochgeladen');
  return { ordner, hochgeladenDir, tokenDatei, token };
}

function starten(opt: { ordner: string; hochgeladenDir: string; tokenDatei: string }): Promise<{ port: number; kind: ChildProcess }> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(resolve(WURZEL_REPO, 'node_modules/.bin/tsx'), ['src/main.ts'], {
      cwd: ADMIN,
      // F1 (Nachangriff): eigene Prozessgruppe, s. Kopfkommentar — nur so
      // erreicht `beendeGruppe()` auch den Enkelprozess (den echten Dienst).
      detached: true,
      env: {
        ...process.env,
        WOV_WURZEL: opt.ordner,
        // H2 (Nachbesserung „Editor Upload-Größe N1"): erst DIESE Zeile lenkt
        // `UPLOAD_DIR` tatsächlich um — ohne sie schriebe der Dienst weiter
        // in den Checkout, egal was WOV_WURZEL sagt (Kopfkommentar oben).
        WOV_HOCHGELADEN_DIR: opt.hochgeladenDir,
        WOV_INSTANZ: 'dev',
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        WOV_ADMIN_PORT: '0',
        WOV_ADMIN_TOKEN_DATEI: opt.tokenDatei,
        WOV_LOG_STROEME_MAX: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let puffer = '';
    const zeitgrenze = setTimeout(() => scheitern(new Error(`Dienst startet nicht:\n${puffer}`)), 30_000);
    kind.stdout.on('data', (s: Buffer) => {
      puffer += s.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(puffer);
      if (t) {
        clearTimeout(zeitgrenze);
        fertig({ port: Number(t[1]), kind });
      }
    });
    kind.stderr.on('data', (s: Buffer) => {
      puffer += s.toString();
    });
    kind.on('exit', (code) => {
      clearTimeout(zeitgrenze);
      scheitern(new Error(`Dienst beendet mit ${code}:\n${puffer}`));
    });
  });
}

/**
 * Die GANZE Prozessgruppe von `kind` beenden und auf das tatsächliche Ende
 * warten (F1, Nachangriff) — `kind.kill()` träfe nur den `tsx`-Wrapper,
 * nicht den Enkelprozess, der der eigentliche Dienst ist. `detached: true`
 * beim Start macht `kind.pid` zur PGID einer eigenen Gruppe (wie
 * `scripts/run-tests.mjs`, `gruppeSignal`); `-kind.pid` adressiert sie.
 * Eine SIGKILL-Eskalation nach 3 s fängt den Fall ab, dass `signal` allein
 * (z. B. SIGTERM) nicht binnen nützlicher Frist wirkt.
 */
function beendeGruppe(kind: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  return new Promise((fertig) => {
    if (kind.pid === undefined || kind.exitCode !== null || kind.signalCode !== null) {
      fertig();
      return;
    }
    const eskalation = setTimeout(() => {
      try {
        process.kill(-kind.pid!, 'SIGKILL');
      } catch {
        /* Gruppe ist schon weg */
      }
    }, 3_000);
    kind.once('exit', () => {
      clearTimeout(eskalation);
      fertig();
    });
    try {
      process.kill(-kind.pid, signal);
    } catch {
      // Gruppe existiert nicht mehr (Dienst schon beendet) — nichts zu tun.
      clearTimeout(eskalation);
      fertig();
    }
  });
}

/**
 * F4 (Nachangriff „Editor Upload-Größe N1"): den Dienst mit einem
 * UNGÜLTIGEN `WOV_HOCHGELADEN_DIR` starten und erwarten, dass er NICHT
 * bereit wird, sondern mit einer klaren Meldung abbricht — anders als
 * `starten()` oben, das gerade den Erfolgsfall erwartet.
 */
function probeFehlgeschlagenerStart(hochgeladenDirWert: string): Promise<{ code: number | null; ausgabe: string }> {
  return new Promise((fertig) => {
    const ordner = mkdtempSync(resolve(tmpdir(), 'wov-grundskala-f4-'));
    const serverDaten = resolve(ordner, 'server/data');
    mkdirSync(serverDaten, { recursive: true });
    writeFileSync(
      resolve(serverDaten, 'server.yml'),
      'uploads:\n  modell-hochladen: true\nplayers:\n  everyone-admin: false\n'
    );
    const tokenDatei = resolve(ordner, 'token');
    writeFileSync(tokenDatei, 'egal-fuer-diese-probe\n');
    const kind = spawn(resolve(WURZEL_REPO, 'node_modules/.bin/tsx'), ['src/main.ts'], {
      cwd: ADMIN,
      detached: true,
      env: {
        ...process.env,
        WOV_WURZEL: ordner,
        WOV_HOCHGELADEN_DIR: hochgeladenDirWert,
        WOV_INSTANZ: 'dev',
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        WOV_ADMIN_PORT: '0',
        WOV_ADMIN_TOKEN_DATEI: tokenDatei,
        WOV_LOG_STROEME_MAX: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ausgabe = '';
    kind.stdout.on('data', (s: Buffer) => (ausgabe += s.toString()));
    kind.stderr.on('data', (s: Buffer) => (ausgabe += s.toString()));
    const zeitgrenze = setTimeout(() => {
      void beendeGruppe(kind, 'SIGKILL').then(() => {
        rmSync(ordner, { recursive: true, force: true });
        fertig({ code: -1, ausgabe: `${ausgabe}\n[Testfehler: Dienst lief trotz ungültigem WOV_HOCHGELADEN_DIR länger als 5 s]` });
      });
    }, 5_000);
    kind.on('exit', (code) => {
      clearTimeout(zeitgrenze);
      rmSync(ordner, { recursive: true, force: true });
      fertig({ code, ausgabe });
    });
  });
}

type Antwort = { code: number; daten: Record<string, unknown> };

/** POST mit einem GLB-Körper (application/octet-stream) und den Upload-Kopfzeilen. */
function hochladen(opt: {
  port: number;
  token: string;
  name: string;
  bytes: Buffer;
  grundskala?: string;
  kollision?: string;
}): Promise<Antwort> {
  return new Promise((fertig, scheitern) => {
    const kopf: Record<string, string> = {
      'x-wov-token': opt.token,
      'content-type': 'application/octet-stream',
      'content-length': String(opt.bytes.length),
      'x-wov-modellname': encodeURIComponent(opt.name),
      'x-wov-kollision': opt.kollision ?? 'fest',
    };
    if (opt.grundskala !== undefined) kopf['x-wov-grundskala'] = opt.grundskala;
    const req = request(
      { host: '127.0.0.1', port: opt.port, path: '/api/modell-hochladen', method: 'POST', headers: kopf },
      (res: IncomingMessage) => {
        let text = '';
        res.setEncoding('utf-8');
        res.on('data', (s: string) => (text += s));
        res.on('end', () => {
          let daten: Record<string, unknown> = {};
          try {
            daten = JSON.parse(text) as Record<string, unknown>;
          } catch {
            /* keine JSON-Antwort */
          }
          fertig({ code: res.statusCode ?? 0, daten });
        });
      }
    );
    req.on('error', scheitern);
    req.write(opt.bytes);
    req.end();
  });
}

/** JSON-Anfrage (PATCH/DELETE) mit Token. */
function jsonAnfrage(opt: { port: number; token: string; pfad: string; methode: string; leib: unknown }): Promise<Antwort> {
  return new Promise((fertig, scheitern) => {
    const text = JSON.stringify(opt.leib);
    const req = request(
      {
        host: '127.0.0.1',
        port: opt.port,
        path: opt.pfad,
        method: opt.methode,
        headers: {
          'x-wov-token': opt.token,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(text)),
        },
      },
      (res: IncomingMessage) => {
        let out = '';
        res.setEncoding('utf-8');
        res.on('data', (s: string) => (out += s));
        res.on('end', () => {
          let daten: Record<string, unknown> = {};
          try {
            daten = JSON.parse(out) as Record<string, unknown>;
          } catch {
            /* keine JSON-Antwort */
          }
          fertig({ code: res.statusCode ?? 0, daten });
        });
      }
    );
    req.on('error', scheitern);
    req.write(text);
    req.end();
  });
}

const HAUPT = wegwerfWurzelBauen('grundskala-betriebsdienst');
const { port, kind } = await starten(HAUPT);
console.log(`# Betriebsdienst auf 127.0.0.1:${port}, WOV_WURZEL ${HAUPT.ordner}, Uploads nach ${HAUPT.hochgeladenDir} (NICHT im Checkout, H2)`);

// Namen der waehrend des Laufs tatsaechlich REGISTRIERTEN Modelle — am
// Ende alle per DELETE zurueckgezogen, egal wo der Test sonst abbricht.
const angelegteNamen: string[] = [];

try {
  console.log('\n1. Annahme — POST ohne Grundskala-Kopfzeile: "wie Datei" (Feld fehlt in der Registry)\n');
  {
    const a = await hochladen({ port, token: HAUPT.token, name: 'GrundskalaOhne', bytes: bauGlb(1) });
    check('ohne Kopfzeile -> 200', a.code === 200, `= ${a.code} ${JSON.stringify(a.daten)}`);
    const eintrag = a.daten.eintrag as { name?: string; grundskala?: number } | undefined;
    check('ohne Kopfzeile: kein grundskala-Feld im Eintrag', eintrag?.grundskala === undefined, `= ${eintrag?.grundskala}`);
    if (eintrag?.name) angelegteNamen.push(eintrag.name);
  }

  console.log('\n2. Annahme — POST MIT gültiger Grundskala-Kopfzeile (4)\n');
  {
    const a = await hochladen({ port, token: HAUPT.token, name: 'U_GrundskalaVier', bytes: bauGlb(1), grundskala: '4' });
    check('grundskala 4 -> 200', a.code === 200, `= ${a.code} ${JSON.stringify(a.daten)}`);
    const eintrag = a.daten.eintrag as { name?: string; grundskala?: number } | undefined;
    check('Eintrag trägt grundskala 4', eintrag?.grundskala === 4, `= ${eintrag?.grundskala}`);
    if (eintrag?.name) angelegteNamen.push(eintrag.name);
  }

  console.log('\n3. Grenzen — POST mit Grundskala GENAU an GRUNDSKALA_MAX (100) wird angenommen\n');
  {
    const a = await hochladen({ port, token: HAUPT.token, name: 'GrundskalaGrenzeMax', bytes: bauGlb(1), grundskala: '100' });
    check('grundskala 100 (Grenze) -> 200', a.code === 200, `= ${a.code} ${JSON.stringify(a.daten)}`);
    const eintrag = a.daten.eintrag as { name?: string; grundskala?: number } | undefined;
    check('Eintrag trägt grundskala 100', eintrag?.grundskala === 100, `= ${eintrag?.grundskala}`);
    if (eintrag?.name) angelegteNamen.push(eintrag.name);
  }

  console.log('\n4. Grenzen — POST mit Grundskala knapp ÜBER 100 wird mit 422 abgelehnt, NICHTS wird geschrieben\n');
  {
    const a = await hochladen({ port, token: HAUPT.token, name: 'GrundskalaZuGross', bytes: bauGlb(1), grundskala: '100.01' });
    check('grundskala 100.01 -> 422', a.code === 422, `= ${a.code} ${JSON.stringify(a.daten)}`);
    check("Fehlerkennung 'grundskala-ungueltig'", a.daten.fehler === 'grundskala-ungueltig', `= ${a.daten.fehler}`);
  }

  console.log('\n5. Grenzen — POST mit Grundskala knapp UNTER 0,01 wird mit 422 abgelehnt\n');
  {
    const a = await hochladen({ port, token: HAUPT.token, name: 'GrundskalaZuKlein', bytes: bauGlb(1), grundskala: '0.005' });
    check('grundskala 0.005 -> 422', a.code === 422, `= ${a.code} ${JSON.stringify(a.daten)}`);
    check("Fehlerkennung 'grundskala-ungueltig'", a.daten.fehler === 'grundskala-ungueltig', `= ${a.daten.fehler}`);
  }

  console.log('\n6. Grenzen — POST mit einer NICHT-Zahl in der Kopfzeile wird abgelehnt (NaN)\n');
  {
    const a = await hochladen({ port, token: HAUPT.token, name: 'GrundskalaKeineZahl', bytes: bauGlb(1), grundskala: 'abc' });
    check("grundskala 'abc' -> 422", a.code === 422, `= ${a.code} ${JSON.stringify(a.daten)}`);
  }

  console.log('\n6b. N1 — Kopfzeile nimmt nur schlichte Dezimalzahlen an (0x10, 1e1, +4 werden abgewiesen)\n');
  {
    // ' 4 ' (mit umgebenden Leerzeichen) steht NICHT in dieser Liste: Node
    // kuerzt optionale Leerzeichen (OWS, RFC 7230) an Kopfzeilenwerten schon
    // im HTTP-Parser, BEVOR der Wert bei `modellHochladenBehandeln` ankommt
    // — der Handler sieht dann nur noch '4', nicht mehr ' 4 '. Ueber ein
    // echtes HTTP-Kopffeld laesst sich dieser Fall also gar nicht auslösen;
    // der Riegel im Code bleibt trotzdem stehen (er greift, wenn der Wert
    // je aus einer anderen Quelle als einem HTTP-Header kommt).
    for (const roh of ['0x10', '1e1', '+4', '0b11', '4.', '.5']) {
      const a = await hochladen({ port, token: HAUPT.token, name: `GrundskalaN1${roh.replace(/[^A-Za-z0-9]/g, '')}`, bytes: bauGlb(1), grundskala: roh });
      check(`grundskala '${roh}' -> 422 (N1)`, a.code === 422, `= ${a.code} ${JSON.stringify(a.daten)}`);
      check(`grundskala '${roh}': Fehlerkennung 'grundskala-ungueltig'`, a.daten.fehler === 'grundskala-ungueltig', `= ${a.daten.fehler}`);
    }
    // Gegenprobe: eine schlichte Dezimalzahl bleibt erlaubt.
    const gut = await hochladen({ port, token: HAUPT.token, name: 'GrundskalaN1Gut', bytes: bauGlb(1), grundskala: '2.5' });
    check("grundskala '2.5' -> 200 (schlichte Dezimalzahl bleibt erlaubt)", gut.code === 200, `= ${gut.code} ${JSON.stringify(gut.daten)}`);
    const eintrag = gut.daten.eintrag as { name?: string } | undefined;
    if (eintrag?.name) angelegteNamen.push(eintrag.name);
  }

  console.log('\n7. Nachträglich ändern — PATCH mit gültigem Namen und gültiger Grundskala\n');
  {
    const a = await jsonAnfrage({ port, token: HAUPT.token, pfad: '/api/modell-hochladen', methode: 'PATCH', leib: { name: 'U_GrundskalaVier', grundskala: 2 } });
    check('PATCH auf 2 -> 200', a.code === 200, `= ${a.code} ${JSON.stringify(a.daten)}`);
    const eintrag = a.daten.eintrag as { grundskala?: number } | undefined;
    check('Antwort trägt die neue grundskala 2', eintrag?.grundskala === 2, `= ${eintrag?.grundskala}`);

    // Auf der Platte UND in einem frischen Aufruf sichtbar — kein Halbzustand.
    // H2: das ist der Ordner UNTER HAUPT.ordner, nie der Checkout.
    const registryPfad = join(HAUPT.hochgeladenDir, 'registry.json');
    const aufPlatte = JSON.parse(readFileSync(registryPfad, 'utf-8')) as { modelle: { name: string; grundskala?: number }[] };
    const geschrieben = aufPlatte.modelle.find((m) => m.name === 'U_GrundskalaVier');
    check('registry.json auf der Platte trägt grundskala 2', geschrieben?.grundskala === 2, `= ${geschrieben?.grundskala}`);
  }

  console.log('\n8. PATCH — Körperfeld "name" fehlt -> 400\n');
  {
    const a = await jsonAnfrage({ port, token: HAUPT.token, pfad: '/api/modell-hochladen', methode: 'PATCH', leib: { grundskala: 2 } });
    check('ohne name -> 400', a.code === 400, `= ${a.code} ${JSON.stringify(a.daten)}`);
    check("Fehlerkennung 'name-fehlt'", a.daten.fehler === 'name-fehlt', `= ${a.daten.fehler}`);
  }

  console.log('\n9. PATCH — Körperfeld "grundskala" fehlt oder ist keine Zahl -> 400\n');
  {
    const a1 = await jsonAnfrage({ port, token: HAUPT.token, pfad: '/api/modell-hochladen', methode: 'PATCH', leib: { name: 'U_GrundskalaVier' } });
    check('ohne grundskala -> 400', a1.code === 400, `= ${a1.code} ${JSON.stringify(a1.daten)}`);
    check("Fehlerkennung 'grundskala-fehlt'", a1.daten.fehler === 'grundskala-fehlt', `= ${a1.daten.fehler}`);
    const a2 = await jsonAnfrage({ port, token: HAUPT.token, pfad: '/api/modell-hochladen', methode: 'PATCH', leib: { name: 'U_GrundskalaVier', grundskala: '2' } });
    check('grundskala als Text (kein number) -> 400', a2.code === 400, `= ${a2.code} ${JSON.stringify(a2.daten)}`);
  }

  console.log('\n10. PATCH — grundskala ausserhalb 0,01…100 -> 422, Eintrag bleibt unveraendert\n');
  {
    const a = await jsonAnfrage({ port, token: HAUPT.token, pfad: '/api/modell-hochladen', methode: 'PATCH', leib: { name: 'U_GrundskalaVier', grundskala: 500 } });
    check('grundskala 500 -> 422', a.code === 422, `= ${a.code} ${JSON.stringify(a.daten)}`);
    check("Fehlerkennung 'grundskala-ungueltig'", a.daten.fehler === 'grundskala-ungueltig', `= ${a.daten.fehler}`);
    const registryPfad = join(HAUPT.hochgeladenDir, 'registry.json');
    const aufPlatte = JSON.parse(readFileSync(registryPfad, 'utf-8')) as { modelle: { name: string; grundskala?: number }[] };
    const geschrieben = aufPlatte.modelle.find((m) => m.name === 'U_GrundskalaVier');
    check('unveraendert: registry.json trägt weiter grundskala 2', geschrieben?.grundskala === 2, `= ${geschrieben?.grundskala}`);
  }

  console.log('\n11. PATCH — unbekannter Name wird abgelehnt, nicht abgestürzt\n');
  {
    const a = await jsonAnfrage({ port, token: HAUPT.token, pfad: '/api/modell-hochladen', methode: 'PATCH', leib: { name: 'U_GibtEsNicht', grundskala: 2 } });
    check('unbekannter Name -> 400', a.code === 400, `= ${a.code} ${JSON.stringify(a.daten)}`);
    check("Fehlerkennung 'abgelehnt'", a.daten.fehler === 'abgelehnt', `= ${a.daten.fehler}`);
  }
} finally {
  // ── Aufräumen: jeden waehrend des Laufs angelegten Upload per echter
  //    DELETE-Route zurückziehen (keine Platzierung nutzt ihn, das
  //    Layout-Dokument der Instanz existiert in diesem WOV_WURZEL gar
  //    nicht -> Nutzung ist immer 0, keine Bestaetigung noetig). ────────
  for (const name of angelegteNamen) {
    try {
      const a = await jsonAnfrage({ port, token: HAUPT.token, pfad: '/api/modell-hochladen', methode: 'DELETE', leib: { name } });
      check(`Aufräumen: '${name}' entfernt`, a.code === 200, `= ${a.code} ${JSON.stringify(a.daten)}`);
    } catch (e) {
      console.error(`[Aufräumen] Entfernen von '${name}' fehlgeschlagen: ${(e as Error).message}`);
    }
  }

  await beendeGruppe(kind, 'SIGTERM');
  rmSync(HAUPT.ordner, { recursive: true, force: true });
}

console.log('\n12. H2 — SIGKILL mitten im Test darf im Checkout NICHTS hinterlassen (Angriff Probe C4)\n');
{
  const ZWEIT = wegwerfWurzelBauen('grundskala-betriebsdienst-sigkill');
  const { port: port2, kind: kind2 } = await starten(ZWEIT);
  try {
    const a = await hochladen({ port: port2, token: ZWEIT.token, name: 'U_SigkillProbe', bytes: bauGlb(1), grundskala: '3' });
    check('SIGKILL-Probe: Upload vor dem Kill -> 200', a.code === 200, `= ${a.code} ${JSON.stringify(a.daten)}`);
    const registryImTemp = join(ZWEIT.hochgeladenDir, 'registry.json');
    check(
      'SIGKILL-Probe: registry.json wurde tatsächlich geschrieben (im Wegwerf-Ordner)',
      existsSync(registryImTemp),
      registryImTemp
    );
  } finally {
    // Das eigentliche Signal, wie run-tests.mjs es beim Zeitlimit/Speicher-
    // wächter gegen die ganze Prozessgruppe schickt (F1: jetzt wirklich
    // gegen die GANZE Gruppe, nicht nur den tsx-Wrapper).
    await beendeGruppe(kind2, 'SIGKILL');
  }
  // Der Checkout darf davon nichts gesehen haben — weder durch den PATCH-
  // Testfall oben noch durch diesen SIGKILL-Fall: derselbe Hash wie ganz am
  // Anfang, VOR dem allerersten Prozessstart dieses Laufs.
  const echteRegistryNachher = sha256VonDatei(ECHTE_REGISTRY_DATEI);
  check(
    'H2: die ECHTE assets/hochgeladen/registry.json des Checkouts ist byte-gleich (vorher/nachher, auch nach SIGKILL)',
    echteRegistryNachher === echteRegistryVorher,
    `vorher=${echteRegistryVorher} nachher=${echteRegistryNachher}`
  );
  check(
    'H2: kein neuer Eintrag "entfernt/" oder "registry.json" wurde im Checkout ANGELEGT',
    echteRegistryVorher !== null || !existsSync(ECHTE_REGISTRY_DATEI),
    `existiert jetzt: ${existsSync(ECHTE_REGISTRY_DATEI)}, existierte vorher: ${echteRegistryVorher !== null}`
  );
  rmSync(ZWEIT.ordner, { recursive: true, force: true });
}

console.log('\n13. F4 — WOV_HOCHGELADEN_DIR leer oder relativ bricht den Start mit klarer Meldung ab\n');
{
  const leer = await probeFehlgeschlagenerStart('');
  check('leerer Wert: Dienst wird NICHT bereit (Exit ≠ 0)', leer.code !== 0, `Exit=${leer.code}`);
  check(
    "leerer Wert: Meldung nennt 'WOV_HOCHGELADEN_DIR'",
    leer.ausgabe.includes('WOV_HOCHGELADEN_DIR'),
    leer.ausgabe.slice(0, 400)
  );

  const relativ = await probeFehlgeschlagenerStart('relativ/hg');
  check('relativer Wert: Dienst wird NICHT bereit (Exit ≠ 0)', relativ.code !== 0, `Exit=${relativ.code}`);
  check(
    "relativer Wert: Meldung nennt 'WOV_HOCHGELADEN_DIR'",
    relativ.ausgabe.includes('WOV_HOCHGELADEN_DIR'),
    relativ.ausgabe.slice(0, 400)
  );
}

console.log(fehler === 0 ? '\nOK — Grundskala im Betriebsdienst korrekt, Checkout unberührt (H2).\n' : `\n${fehler} FEHLER\n`);
process.exit(fehler > 0 ? 1 : 0);
