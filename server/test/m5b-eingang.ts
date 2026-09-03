/**
 * Rot-Test fuer M5b — Eingaenge, die bei jedem Betreten neu wuerfeln.
 * Red test for M5b — entrances that reroll on every enter.
 *
 *   npx tsx server/test/m5b-eingang.ts   (aus dem Repo-Wurzelverzeichnis)
 *
 * Nachgebaut nach dem Muster von `g5-dungeons.ts` (DungeonManager ohne
 * Server: dieselbe `Welt`-Fabrik, dieselbe `ZDOManager`-Instanz fuer die
 * Hauptwelt, ein tmp-Verzeichnis unter server/test/).
 * Modeled on `g5-dungeons.ts` — DungeonManager without a server, same
 * `Welt` factory, tmp directory under server/test/.
 *
 * VOR DER UMSETZUNG ROT, weil:
 *   - `DungeonManager` hat noch keine Methode `vorBetreten(dungeonId)`.
 *   - `DungeonManager` hat noch keine Methode `setzeEingangsModus(dungeonId,
 *     'regen' | 'fixed')` (ANNAHME dieses Tests fuer den Admin-Weg — der
 *     Umsetzer kann sie anders nennen; dann ist NUR das hier anzupassen).
 *   - `DungeonEntrance.regenerateOnEnter` existiert noch nicht.
 *
 * SEIT DER UMSETZUNG (M5b) GRUEN. Die Umsetzung hat die angenommenen Namen
 * uebernommen (`vorBetreten`, `setzeEingangsModus`), die `@ts-expect-error`
 * sind daher entfallen; angepasst wurde nur EINE Zusicherung — der Rot-Test
 * hatte kompaktes JSON in entrances.json angenommen, geschrieben wird
 * eingerueckt (s. Kommentar bei der Stelle).
 *
 * Geprueft wird:
 *  (a) Rezept-Eingang ohne Flag: vorBetreten() ruehrt nichts an, derselbe
 *      Fingerabdruck (Layout-JSON) bleibt bestehen.
 *  (b) Flag auf 'regen', Instanz leer: vorBetreten() wuerfelt neu — neuer
 *      Fingerabdruck, neue Datei auf der Platte, entrances.json traegt
 *      regenerateOnEnter:true und einen neuen Seed.
 *  (c) Flag auf 'regen', aber ein Spieler steht in der Instanz: vorBetreten()
 *      ruehrt nichts an, Grund 'besetzt'.
 *  (d) Neu laden: das Flag ueberlebt den Plattenumweg; ein Alteintrag ohne
 *      das Feld liest sich als fest (kein regenerateOnEnter).
 *  (e) assignEntrance auf eine 2.0-Dokument-Kennung liefert false (2.0-
 *      Dokumente lassen sich ueber diesen Weg (noch) nicht zuweisen).
 */

import { readFileSync, rmSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { HeightmapProvider, getStableHash } from '@wov/shared';
import { LeereGeo } from '@wov/shared/src/worldgen/LeereGeo.js';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { DungeonManager } from '../src/world/dungeon/DungeonManager.js';
import { Welt } from '../src/world/Welt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DUNGEONS_DIR = resolve(__dirname, 'tmp-m5b-eingang');

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

rmSync(DUNGEONS_DIR, { recursive: true, force: true });

/** ZDO-Raum der Hauptwelt — hier landen nur die Eingangshuellen. */
const zdos = new ZDOManager(1n);

/** Weltfabrik wie im Server, nur ohne Server (wie in g5). */
const geo = new LeereGeo();
const welten = new Map<string, Welt>();
const umgebung = { prefabName: () => undefined, kreaturTrifft: () => {} };
const weltAnlegen = (weltId: string): Welt => {
  const vorhanden = welten.get(weltId);
  if (vorhanden) return vorhanden;
  const welt = new Welt(
    {
      id: weltId,
      geo,
      heightmaps: new HeightmapProvider(geo),
      zonenSeed: getStableHash(weltId),
      zonenOptionen: { worldFeatures: false, worldVegetation: false },
      mitKreaturen: false,
      mitZonengenerierung: false,
      serverUserId: 1n,
    },
    umgebung
  );
  welten.set(weltId, welt);
  return welt;
};
const weltEntfernen = (weltId: string): void => {
  welten.delete(weltId);
};

function neuerManager(): DungeonManager {
  const mgr = new DungeonManager(zdos, DUNGEONS_DIR, weltAnlegen, weltEntfernen);
  mgr.load();
  return mgr;
}

/** Fingerabdruck eines Layouts — reicht, um "neu gewuerfelt" von "unveraendert" zu unterscheiden. */
function fingerabdruck(mgr: DungeonManager, dungeonId: string): string | undefined {
  const doc = mgr.getDocument(dungeonId);
  return doc ? JSON.stringify(doc.layout) : undefined;
}

const mgr = neuerManager();

// ── (a) Rezept-Eingang ohne Flag: vorBetreten() ruehrt nichts an ──────────
console.log('\n(a) Rezept-Eingang ohne Flag:');
const dgHash = getStableHash('DG_StoneVault');
const eingang = mgr.registerEntrance('Vault1', dgHash, '3,3', { x: 192, y: 10, z: 192 }, 1000);
pruefe('Eingang registriert', eingang !== null, eingang?.dungeonId);
const dungeonId = eingang!.dungeonId;

// Erstes Betreten materialisiert das Rezept-Dokument (lazy, wie in g5).
const inst0 = mgr.getOrCreateInstance(dungeonId);
pruefe('erste Instanz steht', inst0 !== null);
const abdruckVorher = fingerabdruck(mgr, dungeonId);
pruefe('Dokument existiert nach erstem Betreten', abdruckVorher !== undefined);

const ergA = mgr.vorBetreten(dungeonId) as { neuErzeugt: boolean; grund?: string };
pruefe('ohne Flag: neuErzeugt = false', ergA?.neuErzeugt === false, JSON.stringify(ergA));
pruefeGleich('ohne Flag: Fingerabdruck unveraendert', fingerabdruck(mgr, dungeonId), abdruckVorher);

// ── (b) Flag auf 'regen', Instanz leer: vorBetreten() wuerfelt neu ────────
console.log("\n(b) Flag 'regen', leere Instanz:");
// Der Admin-Weg 'dungeon entrance-mode' in Manager-Form (M5b umgesetzt).
const modusGesetzt = mgr.setzeEingangsModus(dungeonId, 'regen') as boolean;
pruefe('Modus auf regen gesetzt', modusGesetzt === true);

const eintragNachModus = mgr.listEntrances().find((e) => e.dungeonId === dungeonId);
pruefe('entrance.regenerateOnEnter = true', eintragNachModus?.regenerateOnEnter === true);

const dokumentPfad = join(DUNGEONS_DIR, `${dungeonId}.json`);
const mtimeVorher = statSync(dokumentPfad).mtimeMs;
const inhaltVorher = readFileSync(dokumentPfad, 'utf-8');

// Instanz muss LEER sein (kein Spieler drin), sonst darf vorBetreten() nichts tun.
pruefe('Instanz ist leer vor dem Test', mgr.getInstance(dungeonId)?.players.size === 0);

const ergB = mgr.vorBetreten(dungeonId) as { neuErzeugt: boolean; grund?: string };
pruefe('regen + leer: neuErzeugt = true', ergB?.neuErzeugt === true, JSON.stringify(ergB));
const abdruckNachher = fingerabdruck(mgr, dungeonId);
pruefe(
  'regen + leer: Fingerabdruck aendert sich',
  abdruckNachher !== undefined && abdruckNachher !== abdruckVorher
);
const mtimeNachher = statSync(dokumentPfad).mtimeMs;
const inhaltNachher = readFileSync(dokumentPfad, 'utf-8');
pruefe(
  'regen + leer: Dokumentdatei neu geschrieben (Inhalt oder mtime aendert sich)',
  inhaltNachher !== inhaltVorher || mtimeNachher !== mtimeVorher
);

const eintragNachWuerfeln = mgr.listEntrances().find((e) => e.dungeonId === dungeonId);
pruefeGleich('entrances.json: regenerateOnEnter bleibt true', eintragNachWuerfeln?.regenerateOnEnter, true);
pruefe(
  'entrances.json: Seed hat sich geaendert',
  eintragNachWuerfeln?.seed !== undefined && eintragNachWuerfeln.seed !== eingang!.seed
);
const entrancesJsonB = readFileSync(join(DUNGEONS_DIR, 'entrances.json'), 'utf-8');
// ANGEPASST bei der Umsetzung von M5b: `saveEntrances` schreibt die Datei
// eingerueckt (`JSON.stringify(data, null, 1)`), also mit einem Leerzeichen
// hinter dem Doppelpunkt. Der Rot-Test hatte kompaktes JSON angenommen.
// Geprueft wird die Aussage, nicht die Formatierung — die Leerzeichen fallen
// deshalb vor dem Vergleich weg.
pruefe(
  'entrances.json auf Platte traegt regenerateOnEnter:true',
  entrancesJsonB.replace(/\s+/g, '').includes('"regenerateOnEnter":true')
);

// ── (c) Flag auf 'regen', aber besetzt: vorBetreten() ruehrt nichts an ────
console.log("\n(c) Flag 'regen', besetzte Instanz:");
const instC = mgr.getOrCreateInstance(dungeonId);
instC!.players.add('Testspieler');
const abdruckVorC = fingerabdruck(mgr, dungeonId);
const ergC = mgr.vorBetreten(dungeonId) as { neuErzeugt: boolean; grund?: string };
pruefe('besetzt: neuErzeugt = false', ergC?.neuErzeugt === false, JSON.stringify(ergC));
pruefeGleich('besetzt: grund = besetzt', ergC?.grund, 'besetzt');
pruefeGleich('besetzt: Fingerabdruck unveraendert', fingerabdruck(mgr, dungeonId), abdruckVorC);
instC!.players.delete('Testspieler');

// ── (d) Neu laden: Flag ueberlebt, Alteintrag ohne Feld liest sich als fest ─
console.log('\n(d) Neu laden:');
const mgr2 = neuerManager();
const eintragNeuGeladen = mgr2.listEntrances().find((e) => e.dungeonId === dungeonId);
pruefeGleich('nach Neuladen: regenerateOnEnter bleibt true', eintragNeuGeladen?.regenerateOnEnter, true);

// Ein zweiter, ganz normaler Eingang OHNE das Feld — Altbestand-Simulation.
const dgHash2 = getStableHash('DG_StoneVault');
const eingangAlt = mgr2.registerEntrance('Vault2', dgHash2, '4,4', { x: 256, y: 10, z: 256 }, 2000);
pruefe('zweiter Eingang registriert (Alt-Simulation)', eingangAlt !== null);
const eintragAlt = mgr2.listEntrances().find((e) => e.dungeonId === eingangAlt!.dungeonId);
pruefe(
  'Eintrag ohne Feld liest sich als fest (kein regenerateOnEnter)',
  eintragAlt?.regenerateOnEnter !== true
);

// ── (e) assignEntrance auf ein 2.0-Dokument liefert false ─────────────────
console.log('\n(e) assignEntrance auf 2.0-Dokument:');
const doc2 = mgr2.erzeugeDungeon2('steingrab', { architektur: 4242, material: 1, deko: 2 }, 'm5b-2erz-id');
pruefe('2.0-Dokument angelegt', doc2 !== null);
const eingangFuer2 = mgr2.registerEntrance('Vault3', dgHash2, '5,5', { x: 320, y: 10, z: 320 }, 3000);
pruefe('dritter Eingang registriert', eingangFuer2 !== null);
const assignErgebnis = doc2
  ? mgr2.assignEntrance(eingangFuer2!.zoneKey, doc2.id)
  : undefined;
pruefeGleich('assignEntrance auf 2.0-Dokument liefert false', assignErgebnis, false);

rmSync(DUNGEONS_DIR, { recursive: true, force: true });

console.log(`\nm5b-eingang: ${gutZahl} Pruefungen gruen, ${fehlerListe.length} rot`);
for (const f of fehlerListe) console.log(`  ROT  ${f}`);
process.exit(fehlerListe.length === 0 ? 0 : 1);
