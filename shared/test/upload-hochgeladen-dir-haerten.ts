/**
 * N4 (Nachangriff „Editor Upload-Größe N3", Befund N3-4, Info): härtet
 * `ermittleUploadDir` (`shared/src/uploadedModelUpload.ts`) gegen:
 *   - Formen, die den alten Text-Vergleich umgehen (`//proc/x`, `/./proc/x`)
 *     und in eine mkdirSync-Endlosschleife unter /proc liefen,
 *   - einen Symlink, dessen ZIEL (nicht der Pfad selbst) auf eine gesperrte
 *     Wurzel zeigt,
 *   - einen Tippfehler, der still einen mehrstufigen Ordnerbaum anlegte,
 *   - die alte, feste Schreibprobe „.wov-schreibprobe", der ein dort
 *     abgelegter Symlink aufgelauert und deren Ziel sie auf 0 Byte gekürzt
 *     hätte.
 *
 * Lauf:  npx tsx shared/test/upload-hochgeladen-dir-haerten.ts
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { ermittleUploadDir, HochgeladenDirUngueltig } from '../src/uploadedModelUpload.js';

let fehler = 0;
function pruefe(bedingung: boolean, was: string): void {
  if (bedingung) console.log(`  ok   ${was}`);
  else {
    console.log(`  FAIL ${was}`);
    fehler++;
  }
}

function erwarteUngueltig(wert: string): HochgeladenDirUngueltig | null {
  try {
    ermittleUploadDir(wert);
    return null;
  } catch (e) {
    return e instanceof HochgeladenDirUngueltig ? e : null;
  }
}

const WURZEL = mkdtempSync(resolve(tmpdir(), 'wov-hochgeladen-dir-n4-'));

try {
  console.log('\n1. Gesperrte Wurzeln — abgelehnt, egal ob sie schon existieren\n');
  {
    for (const wert of ['/', '/dev', '/dev/shm', '/proc', '/sys']) {
      const e = erwarteUngueltig(wert);
      pruefe(e !== null, `'${wert}' wird abgelehnt`);
    }
  }

  console.log('\n2. N3-4: "//proc/x" und "/./proc/x" — abgelehnt UND ohne Endlosschleife (< 1 s)\n');
  {
    for (const wert of ['//proc/angriff-n4-x', '/./proc/angriff-n4-x', '//proc/x', '/./proc/x', '/proc/../proc/x']) {
      const start = Date.now();
      const e = erwarteUngueltig(wert);
      const dauer = Date.now() - start;
      pruefe(e !== null, `'${wert}' wird abgelehnt`);
      pruefe(dauer < 1_000, `'${wert}': ${dauer} ms (< 1000 ms, keine mkdirSync-Endlosschleife unter /proc)`);
    }
  }

  console.log('\n3. Ein hängender Symlink (Ziel existiert nicht) wird abgelehnt\n');
  {
    const link = join(WURZEL, 'haengend');
    symlinkSync(join(WURZEL, 'existiert-nicht'), link);
    const e = erwarteUngueltig(link);
    pruefe(e !== null, 'hängender Symlink wird abgelehnt');
    pruefe(!!e?.message.includes('haengender Symlink'), `Meldung nennt den Grund (bekommen: ${e?.message})`);
  }

  console.log('\n4. N3-4: ein Symlink, dessen ZIEL auf /proc/self zeigt, wird über den REALPATH abgelehnt\n');
  {
    const link = join(WURZEL, 'zeigt-auf-proc-self');
    symlinkSync('/proc/self', link);
    const e = erwarteUngueltig(link);
    pruefe(e !== null, 'Symlink auf /proc/self wird abgelehnt');
    pruefe(!!e?.message.includes('/proc'), `Meldung nennt das aufgelöste Ziel, nicht "nicht beschreibbar" (bekommen: ${e?.message})`);
  }

  console.log('\n5. Eine Datei statt eines Ordners wird abgelehnt\n');
  {
    const dateiPfad = join(WURZEL, 'ist-eine-datei');
    writeFileSync(dateiPfad, 'x');
    const e = erwarteUngueltig(dateiPfad);
    pruefe(e !== null, 'Datei statt Ordner wird abgelehnt');
    pruefe(!!e?.message.includes('kein Ordner'), `Meldung nennt den Grund (bekommen: ${e?.message})`);
  }

  console.log('\n6. Gegenprobe: ein noch nicht existierender Pfad MIT vorhandenem Elternverzeichnis wird angelegt\n');
  {
    const ziel = join(WURZEL, 'noch-nicht-da');
    pruefe(!existsSync(ziel), 'Gegenprobe: der Ordner existiert vorher wirklich nicht');
    const ergebnis = ermittleUploadDir(ziel);
    pruefe(ergebnis === resolve(ziel), `ermittleUploadDir gibt den (normalisierten) Pfad zurück (bekommen: ${ergebnis})`);
    pruefe(existsSync(ziel), 'der Ordner wurde angelegt');
  }

  console.log('\n7. N3-4: ein Tippfehler (Elternverzeichnis existiert nicht) bricht ab, OHNE still einen Baum anzulegen\n');
  {
    const tippfehler = join(WURZEL, 'gibt-es-nicht', 'tief', 'verschachtelt');
    const elternordner = join(WURZEL, 'gibt-es-nicht');
    pruefe(!existsSync(elternordner), 'Gegenprobe: das Elternverzeichnis existiert vorher wirklich nicht');
    const e = erwarteUngueltig(tippfehler);
    pruefe(e !== null, 'Pfad mit fehlendem Elternverzeichnis wird abgelehnt');
    pruefe(!!e?.message.includes('Elternverzeichnis'), `Meldung nennt das fehlende Elternverzeichnis (bekommen: ${e?.message})`);
    pruefe(!existsSync(elternordner), 'kein Baum wurde still angelegt (Elternverzeichnis fehlt weiterhin)');
    pruefe(!existsSync(tippfehler), 'der Zielordner selbst wurde ebenfalls nicht angelegt');
  }

  console.log('\n8. N3-4: die Schreibprobe folgt keinem vorhandenen Symlink mehr (fester alter Name bleibt unberührt)\n');
  {
    const ordner = join(WURZEL, 'schreibprobe-symlink-falle');
    mkdirSync(ordner, { recursive: true });
    const opfer = join(WURZEL, 'opfer.txt');
    writeFileSync(opfer, 'wichtiger inhalt, darf nicht verschwinden');
    // Die ALTE, feste Stelle — ein Angreifer kann sie vorab kennen und einen
    // Symlink dorthin legen. Der neue Code benutzt nie mehr diesen Namen.
    const alteFesteStelle = join(ordner, '.wov-schreibprobe');
    symlinkSync(opfer, alteFesteStelle);
    const ergebnis = ermittleUploadDir(ordner);
    pruefe(ergebnis === resolve(ordner), 'ermittleUploadDir gelingt trotz des liegenden Symlinks (er wird nie angefasst)');
    pruefe(readFileSync(opfer, 'utf8') === 'wichtiger inhalt, darf nicht verschwinden', 'die Opferdatei ist unverändert (nicht auf 0 Byte gekürzt)');
    pruefe(readFileSync(alteFesteStelle, 'utf8') === 'wichtiger inhalt, darf nicht verschwinden', 'der alte Symlink zeigt weiterhin unverändert auf die Opferdatei');
  }
} finally {
  rmSync(WURZEL, { recursive: true, force: true });
}

console.log(fehler === 0 ? '\nOK — WOV_HOCHGELADEN_DIR-Prüfung hält.\n' : `\n${fehler} FEHLER\n`);
process.exit(fehler > 0 ? 1 : 0);
