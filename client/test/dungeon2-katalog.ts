/**
 * AP15.2 — Waechter fuer die REINE Logik der Dungeon2-Katalogseite
 * (`Dungeon2Katalog.ts`, `Dungeon2Dokument.ts`). KEIN DOM: Diese Datei baut
 * nie eine `Dungeon2Seite` — sie prueft die Antwort-Parser, die
 * Knopf-Zustandsmaschine, die Pruef-Trockenlauf-Verzweigung und das
 * ID-Muster, die unter der Seitenleiste liegen (dasselbe Prinzip wie
 * `dungeon2-zellwerkzeuge.ts`).
 * AP15.2 — guard for the PURE logic behind the Dungeon2 catalogue page. NO
 * DOM: this file never builds a `Dungeon2Seite` — it checks the response
 * parsers, the button state machine, the check-dry-run branch and the id
 * pattern underneath the sidebar.
 *
 *   npx tsx test/dungeon2-katalog.ts
 *
 * Fuer jede Invariante ein Positiv- UND ein Negativfall.
 * A positive AND a negative case per invariant.
 */

import { dungeon2 } from '@wov/shared';
import {
  Dungeon2LadeFehler,
  parseDungeon2DokumentAntwort,
  parseDungeon2ListenAntwort,
} from '../src/editor/dungeon2/Dungeon2Dokument';
import {
  alsSchmutzig,
  beginntSpeichern,
  DUNGEON2_ID_MUSTER,
  erzeugeZufallsSeeds,
  istGueltigeDungeon2Id,
  nachSpeichern,
  pruefeDungeon2Dokument,
  speichernKnopfGesperrt,
  speichernKnopfText,
  spielHost2,
  type Dungeon2SpeicherZustand,
} from '../src/editor/dungeon2/Dungeon2Katalog';

// ─────────────────────────────────────────────────────────────────────────────
// Pruefgeruest / test harness
// ─────────────────────────────────────────────────────────────────────────────

let gutZahl = 0;
const fehlerListe: string[] = [];

function pruefe(name: string, bedingung: boolean, zusatz = ''): void {
  if (bedingung) {
    gutZahl++;
    return;
  }
  fehlerListe.push(`${name}${zusatz ? ` — ${zusatz}` : ''}`);
}

function pruefeGleich(name: string, ist: unknown, soll: unknown): void {
  pruefe(name, Object.is(ist, soll), `ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`);
}

function wirftFehler(name: string, f: () => void): void {
  try {
    f();
    pruefe(name, false, 'warf nicht');
  } catch (err) {
    pruefe(name, err instanceof Dungeon2LadeFehler, `warf ${String(err)}, nicht Dungeon2LadeFehler`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Testdokumente / test documents
// ─────────────────────────────────────────────────────────────────────────────

const SEEDS: dungeon2.LayoutSeeds = { architektur: 1, material: 2, deko: 3 };
const ERZEUGT = dungeon2.erzeugeDokument2('t-erzeugt', 'Testgrab', 'steingrab', SEEDS)!;
const LAYOUT_FUER_GEBAUT = dungeon2.layoutVonDokument2(ERZEUGT)!;
const GEBAUT: dungeon2.DungeonDokument2 = {
  ...ERZEUGT,
  id: 't-gebaut',
  modus: 'gebaut',
  layout: LAYOUT_FUER_GEBAUT,
};

if (!ERZEUGT || !LAYOUT_FUER_GEBAUT) {
  console.log('dungeon2-katalog: Vorbereitung fehlgeschlagen (STEINGRAB nicht gefunden?)');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. parseDungeon2ListenAntwort
// ─────────────────────────────────────────────────────────────────────────────

{
  const antwort = {
    ok: true,
    instanz: 'dev',
    dungeons: [
      { id: 'a', name: 'A', thema: 'steingrab', modus: 'erzeugt', version: 11, ambientLicht: 1, pruefsumme: 'xyz' },
      {
        id: 'b',
        name: 'B',
        thema: 'steingrab',
        modus: 'gebaut',
        version: 11,
        ambientLicht: 0.5,
        pruefsumme: 'abc',
        raeume: 4,
        tueren: 3,
      },
    ],
  };
  const { instanz, dungeons } = parseDungeon2ListenAntwort(antwort);
  pruefeGleich('Liste: Instanz uebernommen', instanz, 'dev');
  pruefeGleich('Liste: zwei Koepfe', dungeons.length, 2);
  pruefeGleich('Liste: raeume nur bei b', dungeons[1]!.raeume, 4);
  pruefeGleich('Liste: raeume fehlt bei a (erzeugt)', dungeons[0]!.raeume, undefined);
}

{
  // Ein kaputter Eintrag (fehlendes `thema`) wird uebersprungen, die guten bleiben.
  const antwort = {
    ok: true,
    instanz: 'dev',
    dungeons: [
      { id: 'gut', name: 'Gut', thema: 'steingrab', modus: 'erzeugt', version: 11, ambientLicht: 1, pruefsumme: 'x' },
      { id: 'kaputt', name: 'Kaputt', modus: 'erzeugt', version: 11, ambientLicht: 1, pruefsumme: 'y' },
    ],
  };
  const { dungeons } = parseDungeon2ListenAntwort(antwort);
  pruefeGleich('Liste: kaputter Eintrag uebersprungen', dungeons.length, 1);
  pruefeGleich('Liste: guter Eintrag bleibt', dungeons[0]?.id, 'gut');
}

wirftFehler('Liste: ok:false wirft Dungeon2LadeFehler', () => {
  parseDungeon2ListenAntwort({ ok: false, fehler: 'keine Instanz' });
});
wirftFehler('Liste: kein Objekt wirft', () => {
  parseDungeon2ListenAntwort('nicht-objekt');
});
wirftFehler('Liste: ok:true ohne dungeons-Array wirft', () => {
  parseDungeon2ListenAntwort({ ok: true, instanz: 'dev' });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. parseDungeon2DokumentAntwort
// ─────────────────────────────────────────────────────────────────────────────

{
  const doc = parseDungeon2DokumentAntwort({ ok: true, instanz: 'dev', dungeon: ERZEUGT });
  pruefeGleich('Dokument: Kennung uebernommen', doc.id, 't-erzeugt');
  pruefeGleich('Dokument: Modus uebernommen', doc.modus, 'erzeugt');
}
wirftFehler('Dokument: ok:false wirft', () => {
  parseDungeon2DokumentAntwort({ ok: false, fehler: 'nicht gefunden' });
});
wirftFehler('Dokument: unbrauchbares Dokument wirft', () => {
  parseDungeon2DokumentAntwort({ ok: true, dungeon: { version: 11, id: 'x', thema: 'unbekanntes-thema' } });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Knopf-Zustandsmaschine: sauber -> schmutzig -> speichert -> sauber
// ─────────────────────────────────────────────────────────────────────────────

{
  let z: Dungeon2SpeicherZustand = 'sauber';
  pruefeGleich('Knopf: sauber-Text', speichernKnopfText(z), 'Speichern');
  pruefe('Knopf: sauber nicht gesperrt', !speichernKnopfGesperrt(z));

  z = alsSchmutzig(z);
  pruefeGleich('Knopf: nach Bearbeitung schmutzig', z, 'schmutzig');
  pruefeGleich('Knopf: schmutzig-Text', speichernKnopfText(z), 'Speichern *');

  z = beginntSpeichern(z);
  pruefeGleich('Knopf: nach Klick speichert', z, 'speichert');
  pruefeGleich('Knopf: speichert-Text', speichernKnopfText(z), 'Speichert …');
  pruefe('Knopf: waehrend des Speicherns gesperrt', speichernKnopfGesperrt(z));

  const erfolg = nachSpeichern(z, true);
  pruefeGleich('Knopf: Erfolg -> sauber', erfolg, 'sauber');
}

{
  // Fehlerfall bleibt schmutzig, unabhaengig davon, ob vorher schmutzig war.
  const nachFehler = nachSpeichern('speichert', false);
  pruefeGleich('Knopf: Fehlerfall bleibt schmutzig', nachFehler, 'schmutzig');

  // Waehrend des Speicherns markiert eine weitere Bearbeitung NICHT als
  // "einfach schmutzig zurueck", sondern bleibt beim laufenden Roundtrip —
  // der Aufrufer entscheidet erst mit der Serverantwort ueber den Ausgang.
  pruefeGleich('Knopf: Bearbeitung waehrend des Speicherns bleibt speichert', alsSchmutzig('speichert'), 'speichert');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Pruef-Trockenlauf: 'erzeugt' vs 'gebaut'
// ─────────────────────────────────────────────────────────────────────────────

{
  const erg = pruefeDungeon2Dokument(ERZEUGT);
  pruefe('Pruefen (erzeugt, sauber): ok', erg.ok, erg.text);
}
{
  // Pruefsumme manipuliert -> Abweichung, ohne dass ein Layout je gebaut wurde.
  const kaputt: dungeon2.DungeonDokument2 = { ...ERZEUGT, pruefsumme: 'komplett-falsch' };
  const erg = pruefeDungeon2Dokument(kaputt);
  pruefe('Pruefen (erzeugt, falsche Pruefsumme): nicht ok', !erg.ok);
}

{
  const erg = pruefeDungeon2Dokument(GEBAUT);
  pruefe('Pruefen (gebaut, sauber): ok', erg.ok, erg.text);
}
{
  // Eingang auf eine Position ausserhalb jeder Zelle verschoben -> die
  // Invariante "erreichbar" (validation.ts) schlaegt fehl.
  const kaputterLayout: dungeon2.DungeonLayout2 = {
    ...LAYOUT_FUER_GEBAUT,
    // kante vom Basis-Layout uebernehmen; nur die Koordinaten verbiegen, damit
    // der Eingang ausserhalb jeder Zelle liegt (Typdrift: eingang.kante ist
    // seit shared/layout.ts Pflicht).
    // Keep the base layout's edge; only bend the coordinates so the entrance
    // lands outside every cell (type drift: eingang.kante is now required).
    eingang: { ...LAYOUT_FUER_GEBAUT.eingang, x: 99999, z: 99999 },
  };
  const kaputt: dungeon2.DungeonDokument2 = { ...GEBAUT, layout: kaputterLayout };
  const erg = pruefeDungeon2Dokument(kaputt);
  pruefe('Pruefen (gebaut, kaputter Eingang): nicht ok', !erg.ok);
}
{
  const ohneLayout: dungeon2.DungeonDokument2 = { ...GEBAUT, layout: undefined };
  const erg = pruefeDungeon2Dokument(ohneLayout);
  pruefe('Pruefen (gebaut ohne Layout): nicht ok', !erg.ok);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. ID-Muster
// ─────────────────────────────────────────────────────────────────────────────

for (const gut of ['a', 'a1', 'stein-grab_1', 'x'.repeat(64)]) {
  pruefe(`ID gueltig: "${gut}"`, istGueltigeDungeon2Id(gut));
}
for (const schlecht of ['', 'Steingrab', '-abc', '_abc', 'a b', 'a/b', 'x'.repeat(65)]) {
  pruefe(`ID ungueltig: "${schlecht}"`, !istGueltigeDungeon2Id(schlecht));
}
pruefeGleich('ID-Muster stimmt mit admin/src/main.ts ueberein (Stichprobe)', DUNGEON2_ID_MUSTER.test('a_b-1'), true);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Zufalls-Seeds
// ─────────────────────────────────────────────────────────────────────────────

{
  const werte = [0, 0.25, 0.999999];
  let i = 0;
  const seeds = erzeugeZufallsSeeds(() => werte[i++]!);
  pruefeGleich('Seeds: architektur aus 0', seeds.architektur, 0);
  pruefe('Seeds: material im uint32-Bereich', seeds.material >= 0 && seeds.material < 0x1_0000_0000);
  pruefe('Seeds: deko im uint32-Bereich', seeds.deko >= 0 && seeds.deko < 0x1_0000_0000);
  pruefe('Seeds: drei verschiedene Ziehungen', seeds.architektur !== seeds.material || seeds.material !== seeds.deko);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. spielHost2
// ─────────────────────────────────────────────────────────────────────────────

pruefeGleich('spielHost2: editor.* -> play.*', spielHost2('editor.dev.world-of-vikings.com'), 'play.dev.world-of-vikings.com');
pruefeGleich('spielHost2: unveraendert ohne Praefix', spielHost2('play.dev.world-of-vikings.com'), 'play.dev.world-of-vikings.com');

// ─────────────────────────────────────────────────────────────────────────────
// Ergebnis / result
// ─────────────────────────────────────────────────────────────────────────────

console.log(`dungeon2-katalog: ${gutZahl} Pruefungen gruen, ${fehlerListe.length} rot`);
for (const f of fehlerListe) console.log(`  ROT  ${f}`);
process.exit(fehlerListe.length === 0 ? 0 : 1);
