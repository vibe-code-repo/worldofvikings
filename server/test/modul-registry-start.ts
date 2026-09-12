/**
 * Fremd-Installation, nie zuvor ein Saal gebaut: `assets/generiert/`
 * existiert nicht, der Client bekommt auf `modul-registry.json` ein 404 —
 * und `ModuleRegistryLoad.ts` behandelt das (richtig) als „keine gebauten
 * Säle", still.
 *
 * ── Was dieser Test misst ─────────────────────────────────────────────
 * `sorgeFuerRegistryDatei` (`server/src/world/dungeon/ModuleBuild.ts`),
 * die neue Stelle, die `server/src/main.ts` VOR `ladeModulRegistrierung`
 * aufruft:
 *
 *   (1) Fehlt der Ordner UND die Datei, legt sie beide an — mit einer
 *       Datei, die `leseRegistryAusText`/`applyModuleRegistry` (der
 *       shared-Leser, den auch der Browser fährt) als GÜLTIGE, LEERE
 *       Registry liest, und deren Prüfsumme aus `registryPruefsumme([])`
 *       kommt, nicht hart kodiert ist.
 *   (2) Existiert die Datei bereits — leer oder mit Inhalt — bleibt sie
 *       BYTE-GLEICH stehen. Ein Anlegen, das eine vorhandene Registry
 *       überschriebe, wäre der teurere Fehler: verlorene Säle, ohne dass
 *       etwas fehlschlägt.
 *   (3) Der volle Rundgang: `sorgeFuerRegistryDatei` gefolgt von
 *       `ladeModulRegistrierung`, wie in `main.ts`, ergibt auf einer
 *       frischen Installation einen Server, der `assets/generiert/` und
 *       eine lesbare Registry vorfindet — keinen Absturz, keine
 *       Ablehnung.
 *
 * Ohne Weiche: schreibt nur in os.tmpdir(), braucht kein `assets/`.
 * Zehntelsekunden.
 *
 * A fresh install has never built a hall, so assets/generiert/ never
 * existed and the client's fetch of modul-registry.json 404s — the
 * normal case, handled silently. This guards the fix: the game server
 * now creates an empty, valid registry file on startup when one is
 * missing (checksum computed via the shared reader, folder created,
 * an existing file is never touched), so that path exists from the
 * first boot instead of only after the first hall is built.
 *
 *   npx tsx server/test/modul-registry-start.ts     (aus der Wurzel)
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { moduleRegistry } from '@wov/shared';
import {
  REGISTRY_DATEI,
  ladeModulRegistrierung,
  sorgeFuerRegistryDatei,
} from '../src/world/dungeon/ModuleBuild.js';

let failures = 0;
function check(bedingung: boolean, was: string): void {
  if (bedingung) {
    console.log(`  ok   ${was}`);
  } else {
    console.log(`  FAIL ${was}`);
    failures++;
  }
}

function tempOrdner(): string {
  return mkdtempSync(join(tmpdir(), 'wov-modul-registry-start-'));
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Ordner UND Datei fehlen — beide werden angelegt
// ═══════════════════════════════════════════════════════════════════════
console.log('\n1. Frische Installation: kein Ordner, keine Datei');

const basis1 = tempOrdner();
const generiert1 = join(basis1, 'assets', 'generiert'); // existiert absichtlich noch nicht
check(!existsSync(generiert1), 'Vorbedingung: assets/generiert/ existiert noch nicht');

const erg1 = sorgeFuerRegistryDatei(generiert1);
check(erg1.angelegt === true, 'sorgeFuerRegistryDatei meldet „angelegt"');
check(existsSync(generiert1), 'assets/generiert/ existiert jetzt');
const pfad1 = join(generiert1, REGISTRY_DATEI);
check(existsSync(pfad1), 'modul-registry.json existiert jetzt');
check(erg1.pfad === pfad1, 'erg.pfad zeigt auf dieselbe Datei');

const text1 = readFileSync(pfad1, 'utf8');
const gelesen1 = moduleRegistry.leseRegistryAusText(text1);
check(gelesen1.module.length === 0, 'die angelegte Registry ist leer laut shared-Leser');
check(
  gelesen1.pruefsumme === moduleRegistry.registryPruefsumme([]),
  'ihre Prüfsumme ist die ECHTE Leer-Prüfsumme aus registryPruefsumme([]) — nicht hart kodiert'
);
const roh1 = JSON.parse(text1) as { pruefsumme: string; version: number; module: unknown[] };
check(
  roh1.pruefsumme === moduleRegistry.registryPruefsumme([]),
  'das Feld `pruefsumme` IN der Datei stimmt ebenfalls (kommt aus derselben Rechnung wie im Schreibweg)'
);
check(roh1.version === moduleRegistry.REGISTRY_VERSION, 'die Datei nennt die aktuelle REGISTRY_VERSION');
check(Array.isArray(roh1.module) && roh1.module.length === 0, '`module` ist ein leeres Array');

// ═══════════════════════════════════════════════════════════════════════
// 2a. Datei existiert bereits (leer) — bleibt unangetastet
// ═══════════════════════════════════════════════════════════════════════
console.log('\n2a. Vorhandene Datei (Sonderfall: schon eine leere Registry)');

const basis2a = tempOrdner();
const generiert2a = join(basis2a, 'assets', 'generiert');
mkdirSync(generiert2a, { recursive: true });
const pfad2a = join(generiert2a, REGISTRY_DATEI);
const vorherInhalt2a = JSON.stringify(moduleRegistry.leereRegistry(), null, 2) + '\n';
writeFileSync(pfad2a, vorherInhalt2a, 'utf8');

const erg2a = sorgeFuerRegistryDatei(generiert2a);
check(erg2a.angelegt === false, 'sorgeFuerRegistryDatei meldet „nicht angelegt" — die Datei war schon da');
check(readFileSync(pfad2a, 'utf8') === vorherInhalt2a, 'der Dateiinhalt ist BYTE-GLEICH geblieben');

// ═══════════════════════════════════════════════════════════════════════
// 2b. Datei existiert bereits MIT Inhalt (echte Module) — bleibt unangetastet
// ═══════════════════════════════════════════════════════════════════════
console.log('\n2b. Vorhandene Datei mit echten Modulen — der teure Fall');

const basis2b = tempOrdner();
const generiert2b = join(basis2b, 'assets', 'generiert');
mkdirSync(generiert2b, { recursive: true });
const pfad2b = join(generiert2b, REGISTRY_DATEI);
const modul2b: moduleRegistry.RegistryModul = {
  kit: moduleRegistry.KIT_NAME,
  name: moduleRegistry.modulName(4, 3, 2),
  zellenX: 4,
  zellenZ: 3,
  pfeilerRaster: 2,
  gewicht: 0.5,
  tris: moduleRegistry.dreiecke(4, 3, 2),
  erzeugt: '2026-09-05T00:00:00.000Z',
};
const vorherInhalt2b =
  JSON.stringify(
    {
      version: moduleRegistry.REGISTRY_VERSION,
      pruefsumme: moduleRegistry.registryPruefsumme([modul2b]),
      module: [modul2b],
    },
    null,
    2
  ) + '\n';
writeFileSync(pfad2b, vorherInhalt2b, 'utf8');

const erg2b = sorgeFuerRegistryDatei(generiert2b);
check(erg2b.angelegt === false, 'sorgeFuerRegistryDatei meldet „nicht angelegt"');
check(
  readFileSync(pfad2b, 'utf8') === vorherInhalt2b,
  'eine Registry mit echten Modulen wird NICHT durch die leere ersetzt — das wäre der teure Fehler'
);

// ═══════════════════════════════════════════════════════════════════════
// 3. Voller Rundgang wie in main.ts: sorgeFuerRegistryDatei → ladeModulRegistrierung
// ═══════════════════════════════════════════════════════════════════════
console.log('\n3. Rundgang wie beim Serverstart');

const basis3 = tempOrdner();
const generiert3 = join(basis3, 'assets', 'generiert');
check(!existsSync(generiert3), 'Vorbedingung: nichts existiert');

const erg3a = sorgeFuerRegistryDatei(generiert3);
check(erg3a.angelegt, 'erster Aufruf legt an');
const ladeErg3 = ladeModulRegistrierung(generiert3);
check(ladeErg3.geladen === 0, 'ladeModulRegistrierung liest 0 Module — keine Ablehnung, kein Absturz');
check(ladeErg3.meldungen.length === 0, 'keine Ablehnungsmeldungen');

// ein zweiter Start desselben Ordners rührt die inzwischen bestehende Datei nicht an
const erg3b = sorgeFuerRegistryDatei(generiert3);
check(erg3b.angelegt === false, 'zweiter Serverstart: Datei ist schon da, wird nicht neu angelegt');

// ── Aufräumen ────────────────────────────────────────────────────────────
for (const basis of [basis1, basis2a, basis2b, basis3]) rmSync(basis, { recursive: true, force: true });

console.log(
  failures === 0
    ? '\nModul-Registry-Anlage beim Start: alles grün.\n'
    : `\nModul-Registry-Anlage beim Start: ${failures} FEHLGESCHLAGEN.\n`
);
process.exit(failures > 0 ? 1 : 0);
