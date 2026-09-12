#!/usr/bin/env node
/**
 * Asset-Paket — bauen und holen der Modelle/Texturen/Klänge, die BEWUSST
 * nicht in diesem Repo liegen (siehe .gitignore: `assets/*`, nur
 * `assets/manifest.json` bleibt getrackt — Binärdateien delta-komprimieren
 * nicht, ein Jahr Modellierarbeit wäre sonst ein Gigabyte Git-Historie, das
 * jeder Klon mitschleppen müsste).
 *
 * Damit "git clone && npm install && npm run dev" trotzdem ohne
 * Zugangsdaten läuft (Mikes Entscheidung 1), reisen die Binärdateien
 * stattdessen als EIN versioniertes Archiv in einem GitHub Release. Dieses
 * Skript ist die Gegenstelle auf beiden Seiten:
 *
 *   node tools/assets-paket.mjs bauen   — packt assets/{store,models,textures,sprites,vfx,audio,dungeon2}
 *                                          deterministisch in dist/assets-paket/
 *                                          (Betreiber-Werkzeug, nicht committen)
 *   node tools/assets-paket.mjs holen   — lädt das Paket zur Version aus
 *                                          tools/assets-version.txt herunter,
 *                                          prüft die Prüfsumme, packt nach assets/
 *                                          (das ruft scripts/dev.mjs automatisch)
 *
 * Format: eigener minimaler USTAR-Schreiber/Leser durch node:zlib-zstd
 * (zstdCompressSync/createZstdDecompress) — dieselbe Kompression, die der
 * Server schon für Spielstände benutzt (server/src/world/WorldManager.ts),
 * bewusst OHNE externes `tar`/`zstd`-Programm vorauszusetzen: Ein Klon soll
 * ohne installierte Zusatzwerkzeuge auskommen.
 *
 * Deterministisch heisst hier: sortierte Pfade, feste mtime/uid/gid/Namen im
 * Tar-Header — zwei Bauten aus demselben Plattenstand ergeben dasselbe
 * Archiv byteweise, was den Prüfsummen-Vergleich erst sinnvoll macht.
 *
 * ---
 *
 * Asset package — building and fetching the models/textures/sounds that are
 * deliberately NOT in this repository (see .gitignore: `assets/*`, only
 * `assets/manifest.json` stays tracked — binaries don't delta-compress, and
 * a year of modelling would otherwise add a gigabyte to a history every
 * clone has to carry).
 *
 * So that "git clone && npm install && npm run dev" still works without
 * credentials (Mike's decision 1), the binaries travel instead as ONE
 * versioned archive in a GitHub release. This script is the counterpart on
 * both ends — see the German subcommand names above (`bauen` = build,
 * `holen` = fetch).
 *
 * Format: a small home-grown USTAR reader/writer through node:zlib's zstd
 * (zstdCompressSync/createZstdDecompress) — the same compression the server
 * already uses for save games (server/src/world/WorldManager.ts), on
 * purpose WITHOUT requiring an external `tar`/`zstd` binary: a clone should
 * not need extra tools installed.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  readdirSync,
  chmodSync,
} from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createZstdCompress, createZstdDecompress } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');
const ASSETS_ORDNER = resolve(WURZEL, 'assets');
/**
 * Welche Ordner unter `assets/` ins Paket wandern.
 *
 * `sprites`, `vfx` und `audio` standen hier zunaechst NICHT — mit der
 * Folge, dass eine frische Installation zwar Gelaende, Baeume und
 * Figuren hatte, aber keine Gegenstandssymbole, keine Treffereffekte
 * und keine Musik. Im Spiel sah man davon: leere Leistenfelder mit den
 * ersten zwei Buchstaben des Namens (der Ersatz in `Hotbar.itemVisual`)
 * und einen Hieb ohne sichtbaren Bogen — `KampfEffekte` laedt seine
 * acht Tafeln aus `/assets/vfx/` und bekam acht 404er (gemessen auf
 * wov-dev am 12.09.2026).
 *
 * Die drei Ordner wiegen zusammen rund 6 MB gegenueber 520 MB fuer
 * `store` und `models` — die Auslassung hat also nie Platz gespart,
 * sie hat nur gefehlt.
 *
 * `dungeon2` (48 MB) steht aus demselben Grund hier, obwohl es GEBACKEN
 * ist und nicht von Hand gezeichnet: Die drei Textur-Arrays entstehen
 * aus `tools/dungeon2/make-materials.py` und `pack-material-arrays.py`,
 * aber deren Eingangsdaten liegen ebenfalls ausserhalb des Repos. Ein
 * frischer Server koennte sie also nicht selbst erzeugen, und ohne sie
 * findet `DungeonMaterialArrays` unter beiden Fundorten nichts.
 */
const PAKET_TEILE = ['store', 'models', 'textures', 'sprites', 'vfx', 'audio', 'dungeon2'];
const PAKET_NAME = 'wov-assets-paket.tar.zst';
const DIST_ORDNER = resolve(WURZEL, 'dist/assets-paket');
const VERSION_DATEI = resolve(WURZEL, 'tools/assets-version.txt');
const ZIEL_VERSION_DATEI = resolve(ASSETS_ORDNER, '.paket-version');

/** Version, die dieser Checkout erwartet — committet, siehe Datei selbst. */
function erwarteteVersion() {
  if (!existsSync(VERSION_DATEI)) {
    throw new Error(`${VERSION_DATEI} fehlt — welche Asset-Version dieser Checkout erwartet, steht dort.`);
  }
  return readFileSync(VERSION_DATEI, 'utf-8').trim();
}

// ── USTAR schreiben ─────────────────────────────────────────────────────

function oktal(n, len) {
  return n.toString(8).padStart(len - 1, '0') + '\0';
}

/**
 * Ein Tar-Header für einen Eintrag. `typ` ist '0' (Datei) oder '5'
 * (Verzeichnis). Lange Pfade (>100 Zeichen) werden nach USTAR-Vorschrift in
 * `prefix` + `name` gesplittet.
 */
function tarHeader(relPfad, groesse, typ) {
  const block = Buffer.alloc(512);
  let name = relPfad;
  let prefix = '';
  if (Buffer.byteLength(name, 'utf-8') > 100) {
    const teile = relPfad.split('/');
    let schnitt = teile.length - 1;
    while (schnitt > 0) {
      const kandidatName = teile.slice(schnitt).join('/');
      const kandidatPrefix = teile.slice(0, schnitt).join('/');
      if (Buffer.byteLength(kandidatName, 'utf-8') <= 100 && Buffer.byteLength(kandidatPrefix, 'utf-8') <= 155) {
        name = kandidatName;
        prefix = kandidatPrefix;
        break;
      }
      schnitt--;
    }
    if (!prefix) {
      throw new Error(`Pfad zu lang für USTAR (auch mit Prefix-Split): ${relPfad}`);
    }
  }
  block.write(name, 0, 100, 'utf-8');
  block.write(oktal(typ === '5' ? 0o755 : 0o644, 8), 100, 8, 'ascii');
  block.write(oktal(0, 8), 108, 8, 'ascii'); // uid
  block.write(oktal(0, 8), 116, 8, 'ascii'); // gid
  block.write(oktal(groesse, 12), 124, 12, 'ascii');
  block.write(oktal(0, 12), 136, 12, 'ascii'); // mtime — fest, für Determinismus
  block.write('        ', 148, 8, 'ascii'); // chksum-Platzhalter (8 Leerzeichen)
  block.write(typ, 156, 1, 'ascii');
  block.write('ustar', 257, 6, 'ascii');
  block.write('00', 263, 2, 'ascii');
  block.write(prefix, 345, 155, 'utf-8');
  let summe = 0;
  for (let i = 0; i < 512; i++) summe += block[i];
  block.write(oktal(summe, 8), 148, 8, 'ascii');
  return block;
}

function padAuf512(len) {
  const rest = len % 512;
  return rest === 0 ? 0 : 512 - rest;
}

/** Sammelt alle Dateien unter `basis` (rekursiv), Pfade relativ zu `basis`, sortiert. */
function sammleDateien(basis) {
  const ergebnis = [];
  function laufe(abs, rel) {
    const eintraege = readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of eintraege) {
      const absKind = join(abs, e.name);
      const relKind = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        ergebnis.push({ relPfad: relKind, typ: '5', absPfad: absKind, groesse: 0 });
        laufe(absKind, relKind);
      } else if (e.isFile()) {
        ergebnis.push({ relPfad: relKind, typ: '0', absPfad: absKind, groesse: statSync(absKind).size });
      }
    }
  }
  if (existsSync(basis)) laufe(basis, '');
  return ergebnis;
}

async function bauen() {
  const start = Date.now();
  const version = erwarteteVersion();
  const eintraege = [];
  for (const teil of PAKET_TEILE) {
    const ordner = resolve(ASSETS_ORDNER, teil);
    if (!existsSync(ordner)) {
      console.warn(`[assets-paket] ${ordner} fehlt — wird ausgelassen.`);
      continue;
    }
    for (const e of sammleDateien(ordner)) {
      eintraege.push({ ...e, relPfad: `${teil}/${e.relPfad}` });
    }
  }
  eintraege.sort((a, b) => a.relPfad.localeCompare(b.relPfad));
  if (eintraege.length === 0) {
    throw new Error(`Nichts zu packen unter ${ASSETS_ORDNER} (erwartet: ${PAKET_TEILE.join(', ')}).`);
  }

  mkdirSync(DIST_ORDNER, { recursive: true });
  const archivPfad = resolve(DIST_ORDNER, PAKET_NAME);
  const zstd = createZstdCompress({ level: 12 });
  const ausgabe = createWriteStream(archivPfad);
  const schreiben = pipeline(zstd, ausgabe);

  for (const e of eintraege) {
    zstd.write(tarHeader(e.relPfad, e.groesse, e.typ));
    if (e.typ === '0') {
      const inhalt = readFileSync(e.absPfad);
      zstd.write(inhalt);
      const pad = padAuf512(inhalt.length);
      if (pad > 0) zstd.write(Buffer.alloc(pad));
    }
  }
  zstd.end(Buffer.alloc(1024)); // zwei Nullblöcke als Tar-Ende
  await schreiben;

  const hash = createHash('sha256').update(readFileSync(archivPfad)).digest('hex');
  writeFileSync(resolve(DIST_ORDNER, `${PAKET_NAME}.sha256`), `${hash}  ${PAKET_NAME}\n`);
  writeFileSync(resolve(DIST_ORDNER, 'version.txt'), `${version}\n`);

  const groesse = statSync(archivPfad).size;
  const dauerS = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `[assets-paket] gebaut: ${archivPfad}\n` +
      `  ${eintraege.filter((e) => e.typ === '0').length} Dateien, ${(groesse / 1024 / 1024).toFixed(1)} MB, ${dauerS}s\n` +
      `  sha256 ${hash}\n` +
      `  Version ${version}`
  );
  return { archivPfad, hash, version, groesse };
}

// ── USTAR lesen ─────────────────────────────────────────────────────────

/** Liest exakt `n` Bytes aus einem AsyncIterable<Buffer>, puffert dazwischen. */
class ByteReader {
  constructor(iterable) {
    this.iter = iterable[Symbol.asyncIterator]();
    this.puffer = Buffer.alloc(0);
    this.fertig = false;
  }
  async #nachfuellen(n) {
    while (this.puffer.length < n && !this.fertig) {
      const { value, done } = await this.iter.next();
      if (done) {
        this.fertig = true;
        break;
      }
      this.puffer = Buffer.concat([this.puffer, value]);
    }
  }
  async lesen(n) {
    await this.#nachfuellen(n);
    const stueck = this.puffer.subarray(0, Math.min(n, this.puffer.length));
    this.puffer = this.puffer.subarray(stueck.length);
    return stueck;
  }
}

function leseOktal(block, start, len) {
  const roh = block.toString('ascii', start, start + len).replace(/\0.*$/, '').trim();
  return roh === '' ? 0 : parseInt(roh, 8);
}

/** Entpackt ein tar.zst-Archiv nach `zielOrdner` (muss existieren). */
async function entpacken(archivPfad, zielOrdner) {
  const quelle = createReadStream(archivPfad);
  const zstd = createZstdDecompress();
  quelle.pipe(zstd);
  const reader = new ByteReader(zstd);
  let dateien = 0;
  for (;;) {
    const header = await reader.lesen(512);
    if (header.length < 512 || header.every((b) => b === 0)) break;
    const groesse = leseOktal(header, 124, 12);
    const typ = String.fromCharCode(header[156]);
    const name = header.toString('utf-8', 0, 100).replace(/\0.*$/, '');
    const prefix = header.toString('utf-8', 345, 155 + 345).replace(/\0.*$/, '');
    const relPfad = prefix ? `${prefix}/${name}` : name;
    const zielPfad = resolve(zielOrdner, relPfad);
    if (!zielPfad.startsWith(zielOrdner + sep)) {
      throw new Error(`Unsicherer Pfad im Archiv: ${relPfad}`);
    }
    if (typ === '5') {
      mkdirSync(zielPfad, { recursive: true });
    } else if (typ === '0') {
      mkdirSync(dirname(zielPfad), { recursive: true });
      const inhalt = await reader.lesen(groesse);
      writeFileSync(zielPfad, inhalt);
      const pad = padAuf512(groesse);
      if (pad > 0) await reader.lesen(pad);
      dateien++;
    } else {
      // sonstige Typen (Links etc.) kommen aus `bauen` nie vor — überspringen
      const pad = padAuf512(groesse);
      await reader.lesen(groesse + pad);
    }
  }
  return dateien;
}

// ── Holen ───────────────────────────────────────────────────────────────

async function ladeDatei(url, zielPfad) {
  if (url.startsWith('file://')) {
    writeFileSync(zielPfad, readFileSync(fileURLToPath(url)));
    return;
  }
  const antwort = await fetch(url);
  if (!antwort.ok) {
    throw new Error(`${url} → HTTP ${antwort.status}`);
  }
  await pipeline(antwort.body, createWriteStream(zielPfad));
}

async function holen() {
  const version = erwarteteVersion();
  if (existsSync(ZIEL_VERSION_DATEI) && readFileSync(ZIEL_VERSION_DATEI, 'utf-8').trim() === version) {
    console.log(`[assets-paket] assets/ ist schon auf Version ${version} — nichts zu tun.`);
    return { uebersprungen: true, version };
  }

  const basisUrl =
    process.env.WOV_ASSETS_URL ??
    `https://github.com/vibe-code-repo/worldofvikings/releases/download/assets-${version}/${PAKET_NAME}`;
  console.log(`[assets-paket] lade Version ${version} von ${basisUrl} …`);

  mkdirSync(DIST_ORDNER, { recursive: true });
  const archivTmp = resolve(DIST_ORDNER, `${PAKET_NAME}.download`);
  const start = Date.now();
  try {
    await ladeDatei(basisUrl, archivTmp);
  } catch (fehler) {
    rmSync(archivTmp, { force: true });
    throw new Error(
      `Herunterladen fehlgeschlagen (${fehler.message}). ` +
        `Vorgabe-URL setzt ein GitHub Release "assets-${version}" voraus (Betreiber: gh release create). ` +
        `Zum Testen: WOV_ASSETS_URL=file://<lokal gebautes Paket> npm run dev.`
    );
  }

  let erwarteterHash;
  try {
    const shaText = await (async () => {
      if (basisUrl.startsWith('file://')) return readFileSync(fileURLToPath(`${basisUrl}.sha256`), 'utf-8');
      const antwort = await fetch(`${basisUrl}.sha256`);
      if (!antwort.ok) throw new Error(`Prüfsummendatei ${basisUrl}.sha256 → HTTP ${antwort.status}`);
      return await antwort.text();
    })();
    erwarteterHash = shaText.trim().split(/\s+/)[0];
  } catch (fehler) {
    rmSync(archivTmp, { force: true });
    throw new Error(`Prüfsumme nicht ladbar: ${fehler.message}`);
  }

  const tatsaechlicherHash = createHash('sha256').update(readFileSync(archivTmp)).digest('hex');
  if (tatsaechlicherHash !== erwarteterHash) {
    rmSync(archivTmp, { force: true });
    throw new Error(
      `Prüfsumme stimmt nicht: erwartet ${erwarteterHash}, bekommen ${tatsaechlicherHash} — ` +
        `Paket verworfen, assets/ NICHT verändert.`
    );
  }

  for (const teil of PAKET_TEILE) {
    rmSync(resolve(ASSETS_ORDNER, teil), { recursive: true, force: true });
  }
  mkdirSync(ASSETS_ORDNER, { recursive: true });
  const anzahl = await entpacken(archivTmp, ASSETS_ORDNER);
  rmSync(archivTmp, { force: true });
  writeFileSync(ZIEL_VERSION_DATEI, `${version}\n`);

  const dauerS = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[assets-paket] entpackt: ${anzahl} Dateien, Version ${version}, ${dauerS}s.`);
  return { uebersprungen: false, version, anzahl };
}

// ── CLI ─────────────────────────────────────────────────────────────────

async function main() {
  const befehl = process.argv[2];
  if (befehl === 'bauen') await bauen();
  else if (befehl === 'holen') await holen();
  else {
    console.error('Verwendung: node tools/assets-paket.mjs bauen|holen');
    process.exit(1);
  }
}

const istCli = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (istCli) {
  main().catch((fehler) => {
    console.error(`[assets-paket] ${fehler.message}`);
    process.exit(1);
  });
}

export { bauen, holen, erwarteteVersion };
