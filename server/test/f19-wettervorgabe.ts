/**
 * F19 — Wetter und Nebel aus server.yml.
 *
 * Geprueft wird der Weg, den eine Aenderung an server.yml wirklich nimmt:
 * `leseServerKonfig()` mit einer echten Datei, nicht die interne
 * Hilfsfunktion. Eine Einstellung, die zwar geparst wird, aber nie in der
 * ServerConfig ankommt, ist genau der Fehler, den Block A14 reihenweise
 * gefunden hat (`save-interval` stand jahrelang in der Datei, ohne dass
 * irgendwer es las).
 *
 * Der Schwerpunkt liegt auf dem VERWERFEN: Ein Tippfehler im
 * Umgebungsnamen darf den Server nicht in einen Zustand bringen, in dem
 * `setEnvironmentByName` bei jedem Spieler fehlschlaegt — sichtbar dann
 * nur als Warnung in dessen Browserkonsole.
 *
 * Run: npx tsx server/test/f19-wettervorgabe.ts   (from the repo root)
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { leseServerKonfig } from '../src/ServerKonfig.js';
import {
  NEBEL_AUTOMATISCH,
  NEBEL_DICHTE_MAX,
  WETTER_AUTOMATISCH,
  istNebelDichte,
} from '@wov/shared';

let fehler = 0;

function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (bedingung) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler++;
  }
}

/**
 * Liest eine server.yml aus einem Wegwerfverzeichnis.
 *
 * `mode: valheim` ist Absicht: Im Layout-Modus beendet leseServerKonfig
 * den Prozess, wenn die Weltdatei fehlt (bewusst, s. dort) — der Test
 * wuerde dann nicht scheitern, sondern verschwinden.
 */
function konfigMit(wetterBlock: string): ReturnType<typeof leseServerKonfig> {
  const dir = mkdtempSync(join(tmpdir(), 'wov-wetter-'));
  try {
    mkdirSync(join(dir, 'welten'), { recursive: true });
    writeFileSync(
      join(dir, 'server.yml'),
      `server:\n  name: Test\nworld:\n  mode: valheim\n${wetterBlock}`,
      'utf-8'
    );
    return leseServerKonfig(dir, 'test');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n[1] Die Vorgabe kommt in der ServerConfig an');
const gesetzt = konfigMit('wetter:\n  umgebung: Misty\n  nebeldichte: 0.0171\n');
pruefe('Umgebung uebernommen', gesetzt.wetterVorgabe?.umgebung === 'Misty', gesetzt.wetterVorgabe?.umgebung);
pruefe(
  'Nebeldichte uebernommen',
  Math.abs((gesetzt.wetterVorgabe?.nebelDichte ?? 0) - 0.0171) < 1e-9,
  String(gesetzt.wetterVorgabe?.nebelDichte)
);

console.log('\n[2] Ohne Abschnitt bleibt alles wie bisher');
const ohne = konfigMit('');
pruefe('Umgebung automatisch', ohne.wetterVorgabe?.umgebung === WETTER_AUTOMATISCH);
pruefe('Nebel automatisch', ohne.wetterVorgabe?.nebelDichte === NEBEL_AUTOMATISCH);

console.log('\n[3] Unbrauchbares wird verworfen, nicht uebernommen');
const tippfehler = konfigMit('wetter:\n  umgebung: Mistyy\n');
pruefe(
  'unbekannte Umgebung faellt auf automatisch',
  tippfehler.wetterVorgabe?.umgebung === WETTER_AUTOMATISCH,
  tippfehler.wetterVorgabe?.umgebung
);
for (const [bez, block] of [
  ['zu gross', 'wetter:\n  nebeldichte: 5\n'],
  ['negativ', 'wetter:\n  nebeldichte: -0.5\n'],
  ['kein Zahlwert', 'wetter:\n  nebeldichte: dicht\n'],
] as const) {
  const k = konfigMit(block);
  pruefe(
    `Nebeldichte ${bez} verworfen`,
    k.wetterVorgabe?.nebelDichte === NEBEL_AUTOMATISCH,
    String(k.wetterVorgabe?.nebelDichte)
  );
}
const leer = konfigMit('wetter:\n  umgebung: ""\n  nebeldichte:\n');
pruefe('leere Werte = automatisch', leer.wetterVorgabe?.umgebung === WETTER_AUTOMATISCH &&
  leer.wetterVorgabe?.nebelDichte === NEBEL_AUTOMATISCH);

console.log('\n[4] Die Grenzen der Dichtepruefung');
pruefe('0 erlaubt (Nebel aus)', istNebelDichte(0));
pruefe('Obergrenze erlaubt', istNebelDichte(NEBEL_DICHTE_MAX));
pruefe('knapp darueber abgelehnt', !istNebelDichte(NEBEL_DICHTE_MAX + 0.001));
pruefe('NEBEL_AUTOMATISCH erlaubt', istNebelDichte(NEBEL_AUTOMATISCH));
for (const boese of ['0.02', null, undefined, NaN, Infinity, {}]) {
  pruefe(`abgelehnt: ${JSON.stringify(boese) ?? String(boese)}`, !istNebelDichte(boese));
}

if (fehler === 0) {
  console.log('\n=== F19 Wettervorgabe: ALLE PRUEFUNGEN BESTANDEN ===');
  process.exit(0);
} else {
  console.error(`\n=== F19 Wettervorgabe: ${fehler} FEHLGESCHLAGEN ===`);
  process.exit(1);
}
