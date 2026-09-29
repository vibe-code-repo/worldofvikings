/**
 * AudioManifest (client/src/engine/Audio/AudioManifest.ts): reads B1's
 * `toene` section of assets/manifest.json (not `audio` — B2 N1, Befund
 * B1: the previous version read a section B1 never writes). Bus and
 * group are derived from the path, not supplied by B1. Fixture-based
 * (not wired to real assets); a second, asset-gated part checks the
 * mapping against the real `toene` section once B1's manifest.json is
 * in this worktree.
 *
 * Lauf: npx tsx client/test/audio-manifest.ts   (aus dem Repo-Wurzel)
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAudioManifest, groupByBus, FOLDER_BUS, BACKGROUND_MUSIC_NAME } from '../src/engine/Audio/AudioManifest';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}

/** Records console.warn calls during `fn()` instead of printing them. */
function fangeWarnungen<T>(fn: () => T): { ergebnis: T; warnungen: string[] } {
  const original = console.warn;
  const warnungen: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnungen.push(args.map(String).join(' '));
  };
  try {
    return { ergebnis: fn(), warnungen };
  } finally {
    console.warn = original;
  }
}

console.log('=== AudioManifest ===');

// Ein Ausschnitt echter toene-Einträge (aus origin/agent/claude/ton-manifest,
// s. Bauerbericht) als Fixture -- deckt alle acht heutigen Ordner ab, plus
// einen erfundenen neunten ("weather/") für die Warnung.
const TOENE_FIXTURE = {
  'ambience/forest-birds': { datei: 'ambience/forest-birds.ogg', bytes: 1, hash: 'x', dauer: 1, kanaele: 'stereo', abtastrate: 48000 },
  'music/changes': { datei: 'music/changes.ogg', bytes: 1, hash: 'x', dauer: 1, kanaele: 'stereo', abtastrate: 48000 },
  'music/combat-01': { datei: 'music/combat-01.ogg', bytes: 1, hash: 'x', dauer: 1, kanaele: 'stereo', abtastrate: 48000 },
  'ui/inventory-armor-drag-end': { datei: 'ui/inventory-armor-drag-end.ogg', bytes: 1, hash: 'x', dauer: 1, kanaele: 'mono', abtastrate: 48000 },
  'animals/cat-01': { datei: 'animals/cat-01.ogg', bytes: 1, hash: 'x', dauer: 1, kanaele: 'mono', abtastrate: 48000 },
  'combat/shield-metal-01': { datei: 'combat/shield-metal-01.ogg', bytes: 1, hash: 'x', dauer: 1, kanaele: 'mono', abtastrate: 48000 },
  'combat/shield-metal-02': { datei: 'combat/shield-metal-02.ogg', bytes: 1, hash: 'x', dauer: 1, kanaele: 'mono', abtastrate: 48000 },
  'creatures/demon-aggro-01': { datei: 'creatures/demon-aggro-01.ogg', bytes: 1, hash: 'x', dauer: 1, kanaele: 'mono', abtastrate: 48000 },
  'emitters/door-close': { datei: 'emitters/door-close.ogg', bytes: 1, hash: 'x', dauer: 1, kanaele: 'mono', abtastrate: 48000 },
  'footsteps/wood-01': { datei: 'footsteps/wood-01.ogg', bytes: 1, hash: 'x', dauer: 1, kanaele: 'mono', abtastrate: 48000 },
  'footsteps/wood-02': { datei: 'footsteps/wood-02.ogg', bytes: 1, hash: 'x', dauer: 1, kanaele: 'mono', abtastrate: 48000 },
  // Ordner ohne Tabelleneintrag -- muss auf 'world' fallen, mit genau einer Warnung.
  'weather/rain-01': { datei: 'weather/rain-01.ogg', bytes: 1, hash: 'x', dauer: 1, kanaele: 'stereo', abtastrate: 48000 },
  'weather/rain-02': { datei: 'weather/rain-02.ogg', bytes: 1, hash: 'x', dauer: 1, kanaele: 'stereo', abtastrate: 48000 },
};

console.log('\n[1] Bus je bekanntem Ordner (FOLDER_BUS deckt alle heutigen acht Ordner ab):');
{
  const BEKANNTE_ORDNER = ['ambience', 'animals', 'combat', 'creatures', 'emitters', 'footsteps', 'music', 'ui'];
  for (const ordner of BEKANNTE_ORDNER) {
    pruefe(`FOLDER_BUS['${ordner}'] ist gesetzt`, FOLDER_BUS[ordner] !== undefined, FOLDER_BUS[ordner]);
  }
}

console.log('\n[2] Bus/Gruppe/URL aus dem toene-Abschnitt:');
{
  const { ergebnis: manifest, warnungen } = fangeWarnungen(() => readAudioManifest({ toene: TOENE_FIXTURE }));
  pruefe('ambience/forest-birds -> Bus ambience', manifest['ambience/forest-birds']?.bus === 'ambience');
  pruefe('ambience/forest-birds -> URL unter /assets/store/audio/', manifest['ambience/forest-birds']?.url === '/assets/store/audio/ambience/forest-birds.ogg', manifest['ambience/forest-birds']?.url);
  pruefe('music/changes -> Bus music', manifest['music/changes']?.bus === 'music');
  pruefe('ui/inventory-armor-drag-end -> Bus ui', manifest['ui/inventory-armor-drag-end']?.bus === 'ui');
  pruefe('animals/cat-01 -> Bus world', manifest['animals/cat-01']?.bus === 'world');
  pruefe('combat/shield-metal-01 -> Bus world', manifest['combat/shield-metal-01']?.bus === 'world');
  pruefe('creatures/demon-aggro-01 -> Bus world', manifest['creatures/demon-aggro-01']?.bus === 'world');
  pruefe('emitters/door-close -> Bus world', manifest['emitters/door-close']?.bus === 'world');
  pruefe('footsteps/wood-01 -> Bus world', manifest['footsteps/wood-01']?.bus === 'world');

  pruefe('footsteps/wood-01 -> Gruppe footsteps/wood (Endnummer abgeschnitten)', manifest['footsteps/wood-01']?.group === 'footsteps/wood', manifest['footsteps/wood-01']?.group);
  pruefe('footsteps/wood-02 -> dieselbe Gruppe wie wood-01', manifest['footsteps/wood-02']?.group === manifest['footsteps/wood-01']?.group);
  pruefe('combat/shield-metal-01/-02 -> eine Gruppe', manifest['combat/shield-metal-01']?.group === 'combat/shield-metal' && manifest['combat/shield-metal-02']?.group === 'combat/shield-metal');
  pruefe('music/changes ohne Endnummer -> eigene Gruppe = eigener Pfad', manifest['music/changes']?.group === 'music/changes');
  pruefe('emitters/door-close ohne Endnummer -> eigene Gruppe', manifest['emitters/door-close']?.group === 'emitters/door-close');

  pruefe('unbekannter Ordner weather/ fällt auf world', manifest['weather/rain-01']?.bus === 'world' && manifest['weather/rain-02']?.bus === 'world');
  pruefe('unbekannter Ordner: genau eine Warnung (nicht je Eintrag)', warnungen.length === 1, `${warnungen.length} Warnungen: ${warnungen.join(' | ')}`);
  pruefe('Warnung nennt den Ordnernamen', warnungen[0]?.includes('weather'), warnungen[0]);
}

console.log('\n[3] Hintergrundmusik ist ein fester Eintrag, unabhängig von toene:');
{
  const ohneToene = readAudioManifest(undefined);
  pruefe('ohne toene: Hintergrundmusik trotzdem da', ohneToene[BACKGROUND_MUSIC_NAME]?.bus === 'music');
  pruefe('ohne toene: URL unter /assets/audio/', ohneToene[BACKGROUND_MUSIC_NAME]?.url === '/assets/audio/hintergrundmusik.mp3', ohneToene[BACKGROUND_MUSIC_NAME]?.url);

  const { ergebnis: mitToene } = fangeWarnungen(() => readAudioManifest({ toene: TOENE_FIXTURE }));
  pruefe('mit toene: Hintergrundmusik immer noch da (nicht nur Rückfall)', mitToene[BACKGROUND_MUSIC_NAME]?.url === '/assets/audio/hintergrundmusik.mp3');
  pruefe('mit toene: music/changes UND Hintergrundmusik sind zwei verschiedene Einträge', mitToene[BACKGROUND_MUSIC_NAME] !== mitToene['music/changes']);
}

console.log('\n[4] Fehlerhafte Einträge werden übersprungen, nicht geworfen:');
{
  const kaputt = {
    toene: {
      gut: { datei: 'ambience/forest-birds.ogg' },
      ohneDatei: { bytes: 1 },
      keinObjekt: 'x',
      leereDatei: { datei: '' },
    },
  };
  let geworfen = false;
  let manifest: ReturnType<typeof readAudioManifest> = {};
  try {
    manifest = readAudioManifest(kaputt);
  } catch {
    geworfen = true;
  }
  pruefe('kein Wurf bei kaputten Einträgen', !geworfen);
  pruefe('nur der gültige Eintrag landet im Manifest', manifest.gut !== undefined && manifest.ohneDatei === undefined && manifest.keinObjekt === undefined && manifest.leereDatei === undefined);
}

console.log('\n[5] Mutanten: falscher Abschnittsname / falsche URL-Basis werden rot:');
{
  const falscherAbschnitt = readAudioManifest({ audio: TOENE_FIXTURE }); // B2s alter (falscher) Name
  pruefe('Abschnitt "audio" statt "toene" liefert keine toene-Einträge', Object.keys(falscherAbschnitt).length === 1 && falscherAbschnitt[BACKGROUND_MUSIC_NAME] !== undefined, JSON.stringify(Object.keys(falscherAbschnitt)));

  const { ergebnis: richtig } = fangeWarnungen(() => readAudioManifest({ toene: TOENE_FIXTURE }));
  pruefe('URL-Basis ist /assets/store/audio/, nicht /assets/audio/', richtig['ambience/forest-birds']?.url.startsWith('/assets/store/audio/') === true, richtig['ambience/forest-birds']?.url);
}

console.log('\n[6] groupByBus: Gruppen landen auf dem richtigen Bus:');
{
  const { ergebnis: manifest } = fangeWarnungen(() => readAudioManifest({ toene: TOENE_FIXTURE }));
  const groups = groupByBus(manifest);
  pruefe('footsteps/wood hat zwei Mitglieder auf world', groups.world.get('footsteps/wood')?.length === 2, JSON.stringify(groups.world.get('footsteps/wood')));
  pruefe('combat/shield-metal hat zwei Mitglieder auf world', groups.world.get('combat/shield-metal')?.length === 2);
  pruefe('backgroundMusic ist auf music, eigene Gruppe', groups.music.get(BACKGROUND_MUSIC_NAME)?.length === 1);
}

// ── [7] Echtdaten, falls vorhanden (B1 gemergt) ────────────────────
console.log('\n[7] Echter toene-Abschnitt aus assets/manifest.json, falls vorhanden:');
{
  const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const manifestPfad = resolve(WURZEL, 'assets/manifest.json');
  if (!existsSync(manifestPfad)) {
    console.log('  ÜBERSPRUNGEN — assets/manifest.json fehlt (kein Checkout mit Assets)');
  } else {
    const roh = JSON.parse(readFileSync(manifestPfad, 'utf8')) as Record<string, unknown>;
    if (!roh.toene || typeof roh.toene !== 'object' || Object.keys(roh.toene as object).length === 0) {
      console.log('  ÜBERSPRUNGEN — assets/manifest.json hat noch keinen toene-Abschnitt (B1 noch nicht gemergt)');
    } else {
      const toene = roh.toene as Record<string, { datei: string }>;
      const gesamt = Object.keys(toene).length;
      const { ergebnis: manifest, warnungen } = fangeWarnungen(() => readAudioManifest(roh));
      const verworfen = Object.keys(toene).filter((k) => manifest[k] === undefined);
      pruefe(`alle ${gesamt} echten toene-Einträge zugeordnet, 0 verworfen`, verworfen.length === 0, `${verworfen.length} verworfen: ${verworfen.slice(0, 5).join(', ')}`);
      pruefe('keine unbekannten Ordner (keine Warnungen)', warnungen.length === 0, warnungen.join(' | '));
    }
  }
}

if (fehler > 0) {
  console.error(`\n=== AudioManifest: ${fehler} PRÜFUNG(EN) FEHLGESCHLAGEN ===`);
  process.exit(1);
}
console.log('\n=== AudioManifest: ALLE GRÜN ===');
