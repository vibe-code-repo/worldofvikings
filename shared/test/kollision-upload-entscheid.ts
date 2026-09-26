/**
 * Server und Client entscheiden über dieselbe Frage — „bekommt dieses Prefab einen festen Körper?" —,
 * und für hochgeladene Modelle (Karte U1) muss die Antwort aus der Upload-Registry kommen.
 *
 * Vorfall (24.09.2026): Der Server übergab `hochgeladenFest` an `istFesterKoerper`, der Client nicht. 18 von 19
 * Startdorf-Modellen waren serverseitig fest und im Bild durchlässig: Der Spieler lief durch das Haus und wurde
 * zurückgezogen. Jetzt rufen beide Seiten `istFesterKoerperImSpiel` (shared).
 *
 * Geprüft (DOM-frei, ohne Modelldateien):
 *  (a) die Tabelle der Fälle: Upload fest, Upload durchlässig, Altbestand (fest/weich), Dungeon-Raum, begehbar;
 *  (b) BEIDE Aufrufstellen (Client `EntityManager.ts`, Server `KollisionsFormen.ts`) rufen die gemeinsame Funktion
 *      und nicht mehr das rohe `istFesterKoerper` — am Syntaxbaum, nicht am Text;
 *  (c) die Registry wird im Client VOR dem Katalog-/Entitätenaufbau geladen (`main()`: await vor `new EntityManager`).
 *
 *   npx tsx shared/test/kollision-upload-entscheid.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import * as shared from '@wov/shared';
import { PREFABS_BY_NAME, istFesterKoerper, uploadedModelRegistry } from '@wov/shared';

// Namensraum-Import: Auf einem Stand ohne die Funktion schlägt die Prüfung rot fehl, statt beim Laden abzustürzen.
const istFesterKoerperImSpiel = (shared as unknown as Record<string, unknown>).istFesterKoerperImSpiel as
  | ((def: ReturnType<typeof PREFABS_BY_NAME.get>, name: string, optionen?: { dungeonRaum?: boolean; begehbar?: boolean }) => boolean)
  | undefined;

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');

let fehler = 0;
function pruefe(bedingung: boolean, was: string, detail = ''): void {
  if (!bedingung) {
    fehler++;
    console.error(`FAIL ${was} ${detail}`);
  } else console.log(`ok   ${was}`);
}

// ── (a) die Tabelle ──────────────────────────────────────────────────────────
const eintrag = (name: string, art: 'fest' | 'durchlaessig'): uploadedModelRegistry.UploadedModelEntry => ({
  name,
  anzeigename: name,
  bytes: 1000,
  dreiecke: 12,
  meshes: 1,
  materialien: 1,
  bilder: 1,
  fehlendeTexturen: false,
  breite: 2,
  hoehe: 2,
  tiefe: 2,
  kollisionsart: art,
  hatKollisionsnetz: true,
  kollisionsnetzAbgelehnt: false,
  hochgeladenVon: 'test',
  zeitpunkt: '2026-09-24T00:00:00.000Z',
});
const erg = uploadedModelRegistry.applyUploadedModelRegistry({
  version: 1,
  modelle: [eintrag('U_TestFest', 'fest'), eintrag('U_TestDurch', 'durchlaessig')],
});
pruefe(erg.geladen === 2, 'beide Test-Uploads registriert', JSON.stringify(erg.meldungen));

pruefe(typeof istFesterKoerperImSpiel === 'function', 'shared exportiert istFesterKoerperImSpiel');
if (istFesterKoerperImSpiel) {
  const def = (n: string) => PREFABS_BY_NAME.get(n);
  // Upload fest / durchlässig — die Wahl kommt aus der Registry, nicht aus Flags (Uploads tragen nur PERSISTENT)
  pruefe(istFesterKoerperImSpiel(def('U_TestFest'), 'U_TestFest') === true, 'Upload „fest“ → fest');
  pruefe(istFesterKoerperImSpiel(def('U_TestDurch'), 'U_TestDurch') === false, 'Upload „durchlässig“ → nicht fest');
  // Dungeon-Raum und begehbar gewinnen auch über eine durchlässige Wahl (wie im rohen istFesterKoerper)
  pruefe(istFesterKoerperImSpiel(def('U_TestDurch'), 'U_TestDurch', { dungeonRaum: true }) === true, 'Dungeon-Raum → fest');
  pruefe(istFesterKoerperImSpiel(def('U_TestDurch'), 'U_TestDurch', { begehbar: true }) === true, 'begehbar → fest');
  // Altbestand: unverändert die Entscheidung des rohen istFesterKoerper (kein Upload → `undefined`)
  for (const name of ['Eiche1', 'Grabhuegel', 'Ginster2', 'Felsblock1', 'Findling3', 'Voelva', 'NichtVorhanden']) {
    const d = def(name);
    pruefe(
      istFesterKoerperImSpiel(d, name) === istFesterKoerper(d, name),
      `Altbestand ${name}: Spiel-Entscheidung = roher istFesterKoerper`,
      `${istFesterKoerperImSpiel(d, name)} vs ${istFesterKoerper(d, name)}`
    );
  }
  pruefe(istFesterKoerperImSpiel(def('Eiche1'), 'Eiche1') === true, 'Altbestand Eiche1 ist fest (Kontrolle: die Tabelle sagt auch „ja“)');
  pruefe(istFesterKoerperImSpiel(def('Ginster2'), 'Ginster2') === false, 'Altbestand Ginster2 (weich) ist nicht fest');
  // Nach dem Austragen gilt wieder „kein Upload“
  uploadedModelRegistry.applyUploadedModelRegistry(uploadedModelRegistry.leereRegistry());
  pruefe(istFesterKoerperImSpiel(undefined, 'U_TestFest') === istFesterKoerper(undefined, 'U_TestFest'), 'ausgetragener Upload: keine Registerwahl mehr');
}

// ── (b) beide Aufrufstellen am Syntaxbaum ─────────────────────────────────────
function aufrufe(datei: string): Map<string, number> {
  const quelle = readFileSync(join(WURZEL, datei), 'utf8');
  const sf = ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true);
  const zaehler = new Map<string, number>();
  const besuche = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const name = n.expression.text;
      zaehler.set(name, (zaehler.get(name) ?? 0) + 1);
    }
    ts.forEachChild(n, besuche);
  };
  besuche(sf);
  return zaehler;
}
for (const [seite, datei] of [
  ['Client', 'client/src/entities/EntityManager.ts'],
  ['Server', 'server/src/world/KollisionsFormen.ts'],
] as const) {
  const a = aufrufe(datei);
  pruefe((a.get('istFesterKoerperImSpiel') ?? 0) === 1, `${seite}: genau ein Aufruf von istFesterKoerperImSpiel`, String(a.get('istFesterKoerperImSpiel') ?? 0));
  pruefe((a.get('istFesterKoerper') ?? 0) === 0, `${seite}: kein Aufruf des rohen istFesterKoerper mehr`, String(a.get('istFesterKoerper') ?? 0));
}

// ── (c) Ladereihenfolge im Client: Registry vor dem EntityManager ─────────────
{
  const datei = 'client/src/main.ts';
  const sf = ts.createSourceFile(datei, readFileSync(join(WURZEL, datei), 'utf8'), ts.ScriptTarget.Latest, true);
  let mainFn: ts.FunctionDeclaration | undefined;
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'main') mainFn = n;
  });
  pruefe(mainFn !== undefined, 'main() gefunden');
  if (mainFn) {
    let awaitPos = -1;
    let bauPos = -1;
    const besuche = (n: ts.Node): void => {
      if (ts.isAwaitExpression(n) && ts.isCallExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'ladeHochgeladeneRegistrierung') awaitPos = n.getStart();
      if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'EntityManager' && bauPos < 0) bauPos = n.getStart();
      ts.forEachChild(n, besuche);
    };
    besuche(mainFn);
    pruefe(awaitPos >= 0 && bauPos >= 0 && awaitPos < bauPos, 'Client: await ladeHochgeladeneRegistrierung() steht in main() VOR new EntityManager', `await@${awaitPos} new@${bauPos}`);
  }
}

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== KOLLISION-UPLOAD-ENTSCHEID: ALL PASSED ===');
