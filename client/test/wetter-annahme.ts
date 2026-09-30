/**
 * F9 client side: `WetterAnnahme` (client/src/net/wetterAnnahme.ts) takes the weather the server
 * drew for the player's biome and hands it to the WeatherManager as an override. DOM-free
 * (main.ts imports Babylon and cannot be loaded here).
 *
 *  [1] Packet parsing: full packet, old/short packet (fields missing), broken packet keeps the old state.
 *  [2] Nothing from the server = the local dice stays untouched (old server, not connected).
 *  [3] A state is handed over once per change and once per new manager, not every frame.
 *  [4] Forgetting the state gives the weather back to the local dice.
 *  [5] main.ts: wired through the module (packet handler, one call in the frame loop), ?env= beats the server.
 *  [6] With the real WeatherManager: the server weather wins over the local draw, and 'auto' releases it.
 *
 * Run: npx tsx client/test/wetter-annahme.ts   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import { Biome, ENVIRONMENT_DURATION, WeatherManager, selectWeather } from '@wov/shared';
import { WetterAnnahme, type WetterLeser } from '../src/net/wetterAnnahme.js';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string, detail = ''): void => {
  console.log(`  ${bedingung ? 'PASS' : 'FAIL'}  ${text}${detail ? ' — ' + detail : ''}`);
  if (!bedingung) fehler++;
};

function leser(werte: (string | number)[]): WetterLeser {
  let i = 0;
  return {
    readString: () => {
      const v = werte[i++];
      if (typeof v !== 'string') throw new Error('String erwartet');
      return v;
    },
    readInt32: () => {
      const v = werte[i++];
      if (typeof v !== 'number') throw new Error('Zahl erwartet');
      return v;
    },
    get remaining() {
      return werte.length - i;
    },
  };
}

class Ziel {
  aufrufe: (string | null)[] = [];
  setEnvironmentOverride(name: string | null): boolean {
    this.aufrufe.push(name);
    return true;
  }
}

console.log('[1] Paket lesen');
{
  const a = new WetterAnnahme();
  a.lies(leser(['Rain', 'Rain', 7]));
  pruefe(
    a.umgebung === 'Rain' && a.zustand === 'Rain' && a.fenster === 7,
    'volles Paket',
    JSON.stringify([a.umgebung, a.zustand, a.fenster]),
  );
  a.lies(leser(['Snow']));
  pruefe(
    a.umgebung === 'Snow' && a.zustand === '' && a.fenster === -1,
    'kurzes Paket (nur Umgebung): keine Ausnahme, Rest Vorgabe',
  );
  a.lies(leser([42]));
  pruefe(a.umgebung === 'Snow', 'kaputtes Paket lässt den alten Stand stehen');
  a.lies(leser(['', '', 3]));
  pruefe(a.umgebung === null, 'leere Umgebung = keine Aussage (null)');
}

console.log('[2] Ohne Servernachricht bleibt der lokale Würfel');
{
  const a = new WetterAnnahme();
  const z = new Ziel();
  pruefe(!a.uebertrage(z) && z.aufrufe.length === 0, 'kein Aufruf am WeatherManager');
}

console.log('[3] Übertragen nur bei Änderung / neuem Manager');
{
  const a = new WetterAnnahme();
  const z = new Ziel();
  a.lies(leser(['Rain', 'Rain', 1]));
  for (let i = 0; i < 100; i++) a.uebertrage(z);
  pruefe(
    z.aufrufe.length === 1 && z.aufrufe[0] === 'Rain',
    '100 Bilder, 1 Aufruf',
    JSON.stringify(z.aufrufe),
  );
  a.lies(leser(['Snow', 'Snow', 1]));
  a.uebertrage(z);
  pruefe(z.aufrufe.length === 2 && z.aufrufe[1] === 'Snow', 'neues Wetter = ein weiterer Aufruf');
  const z2 = new Ziel();
  a.uebertrage(z2);
  pruefe(
    z2.aufrufe.length === 1 && z2.aufrufe[0] === 'Snow',
    'neuer Manager (Neuanmeldung) bekommt den Stand sofort',
  );
}

console.log('[4] Vergessen gibt den Würfel zurück');
{
  const a = new WetterAnnahme();
  const z = new Ziel();
  a.lies(leser(['Rain', 'Rain', 1]));
  a.uebertrage(z);
  a.vergiss();
  a.uebertrage(z);
  pruefe(
    z.aufrufe.length === 2 && z.aufrufe[1] === null,
    'Override wird aufgehoben',
    JSON.stringify(z.aufrufe),
  );
}

console.log('[5] main.ts: Verdrahtung');
{
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf-8');
  pruefe(
    /socket\.on\(PacketType\.WetterZustand,\s*\(reader\)\s*=>\s*wetterAnnahme\.lies\(reader\)\)/.test(main),
    'Handler ruft nur das Modul',
  );
  pruefe(
    /if \(!params\.get\('env'\)\) wetterAnnahme\.uebertrage\(weather\)/.test(main),
    '?env= in der Adresszeile schlägt den Server; sonst ein Aufruf je Bild',
  );
  pruefe(
    (main.match(/wetterAnnahme\./g) ?? []).length === 3,
    'main.ts nennt das Modul an genau drei Stellen (Handler, Übergabe, Lichtentscheid)',
  );
}

console.log('[6] Mit dem echten WeatherManager');
{
  const t = 40 * ENVIRONMENT_DURATION + 3;
  const m = new WeatherManager(Biome.Meadows, t);
  const lokal = selectWeather(Biome.Meadows, t).name;
  m.update(t, 0.1);
  pruefe(m.environment.name === lokal, 'ohne Server: lokaler Würfel', lokal);
  const a = new WetterAnnahme();
  const anderes = lokal === 'Snow' ? 'Rain' : 'Snow';
  a.lies(leser([anderes, anderes, 40]));
  a.uebertrage(m);
  m.update(t, 0.1);
  pruefe(
    m.environment.name === anderes,
    'Server gewinnt gegen den lokalen Würfel',
    `${m.environment.name} (lokal ${lokal})`,
  );
  a.lies(leser(['', '', 40]));
  a.uebertrage(m);
  m.update(t, 0.1);
  pruefe(m.environment.name === lokal, 'leere Umgebung gibt den Würfel wieder frei', m.environment.name);
}

console.log('[7] M1: Der Server führt das Licht, auch bei fester Vorgabe aus server.yml (envPinned)');
{
  const a = new WetterAnnahme();
  const z = new Ziel();
  pruefe(!a.fuehrt(null), 'ohne Servernachricht führt der Server nicht (Vorgabe/Würfel wie bisher)');
  a.lies(leser(['Village', 'Village', 3]));
  a.uebertrage(z);
  pruefe(a.fuehrt(null), 'Vorgabe Village vom Server: führt das Licht (gleicher Wert wie die Pin-Vorgabe)');
  a.lies(leser(['Rain', 'Rain', 3]));
  a.uebertrage(z);
  pruefe(
    a.fuehrt(null) && z.aufrufe[z.aufrufe.length - 1] === 'Rain',
    'Admin-Override Rain: Licht folgt, Override am Manager',
    JSON.stringify(z.aufrufe),
  );
  pruefe(!a.fuehrt('Clear'), '?env= in der Adresszeile schlägt den Server (führt nicht)');
  a.lies(leser(['Village', 'Village', 3]));
  a.uebertrage(z);
  pruefe(
    a.fuehrt(null) && z.aufrufe[z.aufrufe.length - 1] === 'Village',
    'wetter auto: der Server schickt wieder die Vorgabe, das Licht kehrt zurück',
  );
  a.vergiss();
  a.uebertrage(z);
  pruefe(!a.fuehrt(null), 'nach dem Trennen führt der Server nicht mehr');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf-8');
  pruefe(
    /\} else if \(!envPinned \|\| wetterAnnahme\.fuehrt\(params\.get\('env'\)\)\) \{/.test(main),
    'main.ts: der Lichtzweig fragt fuehrt() neben envPinned',
  );
  pruefe(
    main.split('\n').length < 3700,
    'main.ts bleibt unter 3.700 Zeilen',
    String(main.split('\n').length),
  );
}

console.log('[8] N1: Unbekannte Umgebung vom Server = zurück auf den lokalen Würfel');
{
  class StrengesZiel {
    aufrufe: (string | null)[] = [];
    setEnvironmentOverride(name: string | null): boolean {
      this.aufrufe.push(name);
      return name === null || name === 'Snow';
    }
  }
  const a = new WetterAnnahme();
  const z = new StrengesZiel();
  a.lies(leser(['Snow', 'Snow', 1]));
  a.uebertrage(z);
  a.lies(leser(['Hagelsturm_Unbekannt', 'x', 1]));
  a.uebertrage(z);
  pruefe(
    z.aufrufe[z.aufrufe.length - 1] === null,
    'nach der unbekannten Umgebung ist der Override aufgehoben',
    JSON.stringify(z.aufrufe),
  );
  pruefe(!a.fuehrt(null), '… und der Server führt das Licht nicht');
  const vorher = z.aufrufe.length;
  for (let i = 0; i < 50; i++) a.uebertrage(z);
  pruefe(
    z.aufrufe.length === vorher,
    'keine Wiederholung in den nächsten Bildern',
    `${z.aufrufe.length - vorher} weitere Aufrufe`,
  );
  a.lies(leser(['Snow', 'Snow', 2]));
  a.uebertrage(z);
  pruefe(
    a.fuehrt(null) && z.aufrufe[z.aufrufe.length - 1] === 'Snow',
    'das nächste gültige Paket greift wieder',
  );

  const t = 40 * ENVIRONMENT_DURATION + 3;
  const m = new WeatherManager(Biome.Meadows, t);
  const lokal = selectWeather(Biome.Meadows, t).name;
  const b = new WetterAnnahme();
  const anderes = lokal === 'Snow' ? 'Rain' : 'Snow';
  b.lies(leser([anderes, anderes, 40]));
  b.uebertrage(m);
  b.lies(leser(['Hagelsturm_Unbekannt', 'x', 40]));
  b.uebertrage(m);
  m.update(t, 0.1);
  pruefe(
    m.environment.name === lokal,
    'echter WeatherManager: lokaler Würfel statt des alten Overrides',
    `${m.environment.name} (lokal ${lokal})`,
  );
}

console.log(
  fehler === 0
    ? '\n=== Wetter-Annahme: ALLES BESTANDEN ==='
    : `\n=== Wetter-Annahme: ${fehler} CHECK(S) FAILED ===`,
);
process.exit(fehler === 0 ? 0 : 1);
