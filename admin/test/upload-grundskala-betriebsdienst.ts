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
 * ── Eine Besonderheit: `assets/hochgeladen/` ist NICHT über WOV_WURZEL
 *    umlenkbar ────────────────────────────────────────────────────────
 * `UPLOAD_DIR` (`shared/src/uploadedModelUpload.ts`) hängt an
 * `import.meta.url`, nicht an WOV_WURZEL (Kopfkommentar dort, und
 * `admin/test/modell-upload-verdrahtung.ts` Abschnitt „Warum das hier in
 * shared/ liegt"). Ein echter Prozess-Upload schreibt deshalb IMMER in
 * `<dieses Worktree>/assets/hochgeladen/` — hier also in den eigenen
 * Worktree, nicht in ein Wegwerfverzeichnis. Jeder Test-Upload wird
 * darum am Ende über die echte DELETE-Route wieder entfernt, und
 * `registry.json`/`entfernt/` werden danach vom Dateisystem entfernt,
 * damit der Ordner wieder genau so dasteht wie vorher (nur
 * `U_Marktstand2.glb` und `registry.json.dev-referenz`).
 *
 * Lauf:  npx tsx admin/test/upload-grundskala-betriebsdienst.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { request, type IncomingMessage } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');
const WURZEL_REPO = resolve(ADMIN, '..');
const HOCHGELADEN_DIR = resolve(WURZEL_REPO, 'assets/hochgeladen');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── Vorherigen Stand von assets/hochgeladen/ merken, um am Ende exakt
//    dahin zurückzukehren (der Ordner ist der ECHTE des Worktrees). ────
const vorherigeDateien = new Set(existsSync(HOCHGELADEN_DIR) ? readdirSync(HOCHGELADEN_DIR) : []);

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

// ── Wegwerf-WOV_WURZEL: nur server.yml mit dem Upload-Schalter, sonst
//    nichts — das Layout-Dokument fuer die Instanz existiert absichtlich
//    nicht (DELETE braucht dann nie eine Bestaetigung, Nutzung ist immer 0). ──
const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-grundskala-betriebsdienst-'));
const SERVER_DATEN = resolve(ORDNER, 'server/data');
mkdirSync(SERVER_DATEN, { recursive: true });
writeFileSync(
  resolve(SERVER_DATEN, 'server.yml'),
  'uploads:\n  modell-hochladen: true\nplayers:\n  everyone-admin: false\n'
);
const TOKEN = 'pruef-grundskala-token-4711';
const TOKEN_DATEI = resolve(ORDNER, 'token');
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);

function starten(): Promise<{ port: number; kind: ChildProcess }> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(resolve(WURZEL_REPO, 'node_modules/.bin/tsx'), ['src/main.ts'], {
      cwd: ADMIN,
      env: {
        ...process.env,
        WOV_WURZEL: ORDNER,
        WOV_INSTANZ: 'dev',
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        WOV_ADMIN_PORT: '0',
        WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI,
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

type Antwort = { code: number; daten: Record<string, unknown> };

/** POST mit einem GLB-Körper (application/octet-stream) und den Upload-Kopfzeilen. */
function hochladen(opt: {
  port: number;
  name: string;
  bytes: Buffer;
  grundskala?: string;
  kollision?: string;
}): Promise<Antwort> {
  return new Promise((fertig, scheitern) => {
    const kopf: Record<string, string> = {
      'x-wov-token': TOKEN,
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
function jsonAnfrage(opt: { port: number; pfad: string; methode: string; leib: unknown }): Promise<Antwort> {
  return new Promise((fertig, scheitern) => {
    const text = JSON.stringify(opt.leib);
    const req = request(
      {
        host: '127.0.0.1',
        port: opt.port,
        path: opt.pfad,
        method: opt.methode,
        headers: {
          'x-wov-token': TOKEN,
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

const { port, kind } = await starten();
console.log(`# Betriebsdienst auf 127.0.0.1:${port}, WOV_WURZEL ${ORDNER}, Uploads nach ${HOCHGELADEN_DIR}`);

// Namen der waehrend des Laufs tatsaechlich REGISTRIERTEN Modelle — am
// Ende alle per DELETE zurueckgezogen, egal wo der Test sonst abbricht.
const angelegteNamen: string[] = [];

try {
  console.log('\n1. Annahme — POST ohne Grundskala-Kopfzeile: "wie Datei" (Feld fehlt in der Registry)\n');
  {
    const a = await hochladen({ port, name: 'GrundskalaOhne', bytes: bauGlb(1) });
    check('ohne Kopfzeile -> 200', a.code === 200, `= ${a.code} ${JSON.stringify(a.daten)}`);
    const eintrag = a.daten.eintrag as { name?: string; grundskala?: number } | undefined;
    check('ohne Kopfzeile: kein grundskala-Feld im Eintrag', eintrag?.grundskala === undefined, `= ${eintrag?.grundskala}`);
    if (eintrag?.name) angelegteNamen.push(eintrag.name);
  }

  console.log('\n2. Annahme — POST MIT gültiger Grundskala-Kopfzeile (4)\n');
  {
    const a = await hochladen({ port, name: 'U_GrundskalaVier', bytes: bauGlb(1), grundskala: '4' });
    check('grundskala 4 -> 200', a.code === 200, `= ${a.code} ${JSON.stringify(a.daten)}`);
    const eintrag = a.daten.eintrag as { name?: string; grundskala?: number } | undefined;
    check('Eintrag trägt grundskala 4', eintrag?.grundskala === 4, `= ${eintrag?.grundskala}`);
    if (eintrag?.name) angelegteNamen.push(eintrag.name);
  }

  console.log('\n3. Grenzen — POST mit Grundskala GENAU an GRUNDSKALA_MAX (100) wird angenommen\n');
  {
    const a = await hochladen({ port, name: 'GrundskalaGrenzeMax', bytes: bauGlb(1), grundskala: '100' });
    check('grundskala 100 (Grenze) -> 200', a.code === 200, `= ${a.code} ${JSON.stringify(a.daten)}`);
    const eintrag = a.daten.eintrag as { name?: string; grundskala?: number } | undefined;
    check('Eintrag trägt grundskala 100', eintrag?.grundskala === 100, `= ${eintrag?.grundskala}`);
    if (eintrag?.name) angelegteNamen.push(eintrag.name);
  }

  console.log('\n4. Grenzen — POST mit Grundskala knapp ÜBER 100 wird mit 422 abgelehnt, NICHTS wird geschrieben\n');
  {
    const a = await hochladen({ port, name: 'GrundskalaZuGross', bytes: bauGlb(1), grundskala: '100.01' });
    check('grundskala 100.01 -> 422', a.code === 422, `= ${a.code} ${JSON.stringify(a.daten)}`);
    check("Fehlerkennung 'grundskala-ungueltig'", a.daten.fehler === 'grundskala-ungueltig', `= ${a.daten.fehler}`);
  }

  console.log('\n5. Grenzen — POST mit Grundskala knapp UNTER 0,01 wird mit 422 abgelehnt\n');
  {
    const a = await hochladen({ port, name: 'GrundskalaZuKlein', bytes: bauGlb(1), grundskala: '0.005' });
    check('grundskala 0.005 -> 422', a.code === 422, `= ${a.code} ${JSON.stringify(a.daten)}`);
    check("Fehlerkennung 'grundskala-ungueltig'", a.daten.fehler === 'grundskala-ungueltig', `= ${a.daten.fehler}`);
  }

  console.log('\n6. Grenzen — POST mit einer NICHT-Zahl in der Kopfzeile wird abgelehnt (NaN)\n');
  {
    const a = await hochladen({ port, name: 'GrundskalaKeineZahl', bytes: bauGlb(1), grundskala: 'abc' });
    check("grundskala 'abc' -> 422", a.code === 422, `= ${a.code} ${JSON.stringify(a.daten)}`);
  }

  console.log('\n7. Nachträglich ändern — PATCH mit gültigem Namen und gültiger Grundskala\n');
  {
    const a = await jsonAnfrage({ port, pfad: '/api/modell-hochladen', methode: 'PATCH', leib: { name: 'U_GrundskalaVier', grundskala: 2 } });
    check('PATCH auf 2 -> 200', a.code === 200, `= ${a.code} ${JSON.stringify(a.daten)}`);
    const eintrag = a.daten.eintrag as { grundskala?: number } | undefined;
    check('Antwort trägt die neue grundskala 2', eintrag?.grundskala === 2, `= ${eintrag?.grundskala}`);

    // Auf der Platte UND in einem frischen Aufruf sichtbar — kein Halbzustand.
    const registryPfad = join(HOCHGELADEN_DIR, 'registry.json');
    const aufPlatte = JSON.parse(readFileSync(registryPfad, 'utf-8')) as { modelle: { name: string; grundskala?: number }[] };
    const geschrieben = aufPlatte.modelle.find((m) => m.name === 'U_GrundskalaVier');
    check('registry.json auf der Platte trägt grundskala 2', geschrieben?.grundskala === 2, `= ${geschrieben?.grundskala}`);
  }

  console.log('\n8. PATCH — Körperfeld "name" fehlt -> 400\n');
  {
    const a = await jsonAnfrage({ port, pfad: '/api/modell-hochladen', methode: 'PATCH', leib: { grundskala: 2 } });
    check('ohne name -> 400', a.code === 400, `= ${a.code} ${JSON.stringify(a.daten)}`);
    check("Fehlerkennung 'name-fehlt'", a.daten.fehler === 'name-fehlt', `= ${a.daten.fehler}`);
  }

  console.log('\n9. PATCH — Körperfeld "grundskala" fehlt oder ist keine Zahl -> 400\n');
  {
    const a1 = await jsonAnfrage({ port, pfad: '/api/modell-hochladen', methode: 'PATCH', leib: { name: 'U_GrundskalaVier' } });
    check('ohne grundskala -> 400', a1.code === 400, `= ${a1.code} ${JSON.stringify(a1.daten)}`);
    check("Fehlerkennung 'grundskala-fehlt'", a1.daten.fehler === 'grundskala-fehlt', `= ${a1.daten.fehler}`);
    const a2 = await jsonAnfrage({ port, pfad: '/api/modell-hochladen', methode: 'PATCH', leib: { name: 'U_GrundskalaVier', grundskala: '2' } });
    check('grundskala als Text (kein number) -> 400', a2.code === 400, `= ${a2.code} ${JSON.stringify(a2.daten)}`);
  }

  console.log('\n10. PATCH — grundskala ausserhalb 0,01…100 -> 422, Eintrag bleibt unveraendert\n');
  {
    const a = await jsonAnfrage({ port, pfad: '/api/modell-hochladen', methode: 'PATCH', leib: { name: 'U_GrundskalaVier', grundskala: 500 } });
    check('grundskala 500 -> 422', a.code === 422, `= ${a.code} ${JSON.stringify(a.daten)}`);
    check("Fehlerkennung 'grundskala-ungueltig'", a.daten.fehler === 'grundskala-ungueltig', `= ${a.daten.fehler}`);
    const registryPfad = join(HOCHGELADEN_DIR, 'registry.json');
    const aufPlatte = JSON.parse(readFileSync(registryPfad, 'utf-8')) as { modelle: { name: string; grundskala?: number }[] };
    const geschrieben = aufPlatte.modelle.find((m) => m.name === 'U_GrundskalaVier');
    check('unveraendert: registry.json trägt weiter grundskala 2', geschrieben?.grundskala === 2, `= ${geschrieben?.grundskala}`);
  }

  console.log('\n11. PATCH — unbekannter Name wird abgelehnt, nicht abgestürzt\n');
  {
    const a = await jsonAnfrage({ port, pfad: '/api/modell-hochladen', methode: 'PATCH', leib: { name: 'U_GibtEsNicht', grundskala: 2 } });
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
      const a = await jsonAnfrage({ port, pfad: '/api/modell-hochladen', methode: 'DELETE', leib: { name } });
      check(`Aufräumen: '${name}' entfernt`, a.code === 200, `= ${a.code} ${JSON.stringify(a.daten)}`);
    } catch (e) {
      console.error(`[Aufräumen] Entfernen von '${name}' fehlgeschlagen: ${(e as Error).message}`);
    }
  }

  kind.kill();
  rmSync(ORDNER, { recursive: true, force: true });

  // Der echte Ordner (assets/hochgeladen/ dieses Worktrees) bekam durch
  // die Uploads oben eine registry.json und einen entfernt/-Ordner, die
  // es vorher nicht gab — hier wieder auf den Stand davor zurueckgesetzt.
  if (existsSync(HOCHGELADEN_DIR)) {
    for (const eintrag of readdirSync(HOCHGELADEN_DIR)) {
      if (vorherigeDateien.has(eintrag)) continue;
      rmSync(join(HOCHGELADEN_DIR, eintrag), { recursive: true, force: true });
    }
  }
}

console.log(fehler === 0 ? '\nOK — Grundskala im Betriebsdienst korrekt.\n' : `\n${fehler} FEHLER\n`);
process.exit(fehler > 0 ? 1 : 0);
