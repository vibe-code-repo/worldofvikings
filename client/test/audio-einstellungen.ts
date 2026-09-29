/**
 * Player audio settings (Karte optionen-audio): slider -> bus gain mapping,
 * save/load incl. broken storage, mute restore, `?mute=1` priority, and that
 * every text of the Audio tab has a key in de.json AND en.json.
 * Pure, DOM-free.
 *
 * Lauf: npx tsx client/test/audio-einstellungen.ts   (aus der Repo-Wurzel)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIO_BUSSE,
  AUDIO_SPEICHER_SCHLUESSEL,
  AudioEinstellungen,
  BUS_VORGABE,
  berechnePegel,
  liesAudioWerte,
  reglerZuGain,
  type AudioBus,
  type AudioSpeicher,
} from '../src/engine/Audio/AudioEinstellungen';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}
const fast = (a: number, b: number): boolean => Math.abs(a - b) < 1e-12;

class Speicher implements AudioSpeicher {
  daten = new Map<string, string>();
  schreibt = 0;
  getItem(k: string): string | null { return this.daten.get(k) ?? null; }
  setItem(k: string, v: string): void { this.schreibt += 1; this.daten.set(k, v); }
}
class KaputterSpeicher implements AudioSpeicher {
  getItem(): string | null { throw new Error('SecurityError'); }
  setItem(): void { throw new Error('QuotaExceededError'); }
}

console.log('=== Audio-Einstellungen ===');

console.log('\n[1] Abbildung Regler -> Buslautstärke');
{
  const vorgabe = berechnePegel(new AudioEinstellungen(new Speicher()).get());
  pruefe('ohne Einstellung: Gesamt = 1', vorgabe.gesamt === 1);
  for (const bus of AUDIO_BUSSE) {
    pruefe(`100 % ${bus} = heutige Vorgabe ${BUS_VORGABE[bus]}`, fast(vorgabe.bus[bus], BUS_VORGABE[bus]));
  }
  pruefe('heutige Vorgaben unverändert (0,5 / 0,6 / 0,8 / 0,112)',
    BUS_VORGABE.ambience === 0.5 && BUS_VORGABE.world === 0.6 && BUS_VORGABE.ui === 0.8 && BUS_VORGABE.music === 0.112);
  pruefe('0 % = 0', reglerZuGain(0) === 0);
  pruefe('100 % = 1', reglerZuGain(100) === 1);
  pruefe('50 % = 0,25 (quadratisch)', fast(reglerZuGain(50), 0.25));
  let steigend = true;
  for (let p = 1; p <= 100; p += 1) if (!(reglerZuGain(p) > reglerZuGain(p - 1))) steigend = false;
  pruefe('streng steigend über alle 101 Stufen', steigend);
  pruefe('außerhalb 0..100 wird begrenzt', reglerZuGain(-5) === 0 && reglerZuGain(250) === 1);
  const e = new AudioEinstellungen(new Speicher());
  e.setzeBus('music', 0);
  pruefe('Musikregler 0 -> Musik-Bus 0, andere Busse unberührt',
    berechnePegel(e.get()).bus.music === 0 && fast(berechnePegel(e.get()).bus.world, BUS_VORGABE.world));
  e.setzeBus('music', 100);
  pruefe('Musikregler 100 -> Musik-Bus wieder Vorgabe', fast(berechnePegel(e.get()).bus.music, BUS_VORGABE.music));
  e.setzeGesamt(50);
  pruefe('Gesamt 50 % -> Master 0,25', fast(berechnePegel(e.get()).gesamt, 0.25));
}

console.log('\n[2] Speichern und Laden');
{
  const sp = new Speicher();
  const a = new AudioEinstellungen(sp);
  a.setzeGesamt(70);
  a.setzeBus('music', 30);
  a.setzeBus('ui', 0);
  a.setzeStumm(true);
  const b = new AudioEinstellungen(sp);
  pruefe('neue Instanz liest die gespeicherten Werte',
    b.get().gesamt === 70 && b.get().regler.music === 30 && b.get().regler.ui === 0 && b.get().stumm === true && b.get().regler.world === 100,
    JSON.stringify(b.get()));
  pruefe('gespeichert unter festem Schlüssel', sp.daten.has(AUDIO_SPEICHER_SCHLUESSEL));
  let gemeldet = 0;
  const ab = b.onChange(() => { gemeldet += 1; });
  pruefe('onChange feuert sofort', gemeldet === 1);
  b.setzeBus('world', 10);
  pruefe('onChange feuert bei Änderung', gemeldet === 2);
  ab();
  b.setzeBus('world', 20);
  pruefe('abgemeldet feuert nicht mehr', gemeldet === 2);
  b.zuruecksetzen();
  pruefe('Zurücksetzen = Vorgaben (auch gespeichert)',
    new AudioEinstellungen(sp).get().gesamt === 100 && new AudioEinstellungen(sp).get().regler.music === 100 && new AudioEinstellungen(sp).get().stumm === false);
  const ungueltig = new AudioEinstellungen(sp);
  const vorher = JSON.stringify(ungueltig.get());
  ungueltig.setzeGesamt(Number.NaN);
  ungueltig.setzeBus('music', Number.POSITIVE_INFINITY);
  ungueltig.setzeBus('nichts' as AudioBus, 5);
  pruefe('NaN/Infinity/unbekannter Bus werden ignoriert', JSON.stringify(ungueltig.get()) === vorher);
}

console.log('\n[3] Kaputter oder fehlender Speicherinhalt -> Vorgaben, kein Wurf');
{
  const vorgabe = JSON.stringify(new AudioEinstellungen(new Speicher()).get());
  const faelle: [string, string | null][] = [
    ['null', null], ['leer', ''], ['kein JSON', '{oops'], ['Zahl', '42'], ['Array', '[1,2]'],
    ['null-Literal', 'null'], ['String', '"laut"'],
  ];
  for (const [name, roh] of faelle) {
    let werte;
    let wirft = false;
    try { werte = liesAudioWerte(roh); } catch { wirft = true; }
    pruefe(`${name} -> Vorgaben`, !wirft && JSON.stringify(werte) === vorgabe);
  }
  const teil = liesAudioWerte(JSON.stringify({ gesamt: 'laut', stumm: 'ja', regler: { music: 40, world: -20, ui: 1e9, ambience: null, evil: 5 } }));
  pruefe('teilweise ungültig: gültige Felder bleiben, der Rest Vorgabe',
    teil.gesamt === 100 && teil.stumm === false && teil.regler.music === 40 && teil.regler.world === 0
      && teil.regler.ui === 100 && teil.regler.ambience === 100, JSON.stringify(teil));
  const proto = liesAudioWerte('{"regler":{"__proto__":{"music":1},"constructor":3}}');
  pruefe('Prototyp-Namen als Schlüssel ändern nichts', proto.regler.music === 100 && ({} as Record<string, unknown>).music === undefined);
  const sp = new Speicher();
  sp.setItem(AUDIO_SPEICHER_SCHLUESSEL, '{"gesamt":12.6}');
  pruefe('Kommazahl wird gerundet', new AudioEinstellungen(sp).get().gesamt === 13);
  let wirft = false;
  let kaputt: AudioEinstellungen | null = null;
  try {
    kaputt = new AudioEinstellungen(new KaputterSpeicher());
    kaputt.setzeGesamt(40);
  } catch { wirft = true; }
  pruefe('Speicher wirft beim Lesen und Schreiben -> kein Wurf', !wirft);
  pruefe('… Werte gelten trotzdem für die Sitzung', kaputt?.get().gesamt === 40);
  let ohne = false;
  try { new AudioEinstellungen(null).setzeStumm(true); } catch { ohne = true; }
  pruefe('ohne Speicher (null) -> kein Wurf', !ohne);
}

console.log('\n[4] Stumm und ?mute=1');
{
  const e = new AudioEinstellungen(new Speicher());
  e.setzeGesamt(60);
  e.setzeStumm(true);
  pruefe('Stumm -> Master 0', berechnePegel(e.get()).gesamt === 0);
  pruefe('Stumm behält den Gesamtwert (60)', e.get().gesamt === 60);
  pruefe('Bus-Pegel bleiben bei Stumm unverändert', fast(berechnePegel(e.get()).bus.world, BUS_VORGABE.world));
  e.setzeStumm(false);
  pruefe('Aufheben stellt den vorherigen Wert wieder her', fast(berechnePegel(e.get()).gesamt, 0.36) && e.get().gesamt === 60);
  e.setzeStumm(true);
  e.setzeGesamt(80);
  pruefe('Gesamtregler ziehen hebt Stumm auf', e.get().stumm === false && e.get().gesamt === 80);
  e.setzeStumm(true);
  e.setzeGesamt(0);
  pruefe('Gesamtregler auf 0 hebt Stumm nicht auf', e.get().stumm === true);
  const laut = new AudioEinstellungen(new Speicher());
  pruefe('?mute=1 gewinnt gegen gespeicherte 100 %', berechnePegel(laut.get(), true).gesamt === 0);
  laut.setzeGesamt(100);
  laut.setzeStumm(false);
  pruefe('?mute=1 gewinnt auch bei nicht gestummtem Spieler', berechnePegel(laut.get(), true).gesamt === 0 && berechnePegel(laut.get(), false).gesamt === 1);
  pruefe('?mute=1 ändert nichts am Gespeicherten', laut.get().gesamt === 100 && laut.get().stumm === false);
}

console.log('\n[5] Texte: jeder Schlüssel des Audio-Reiters in de.json UND en.json');
{
  const hier = dirname(fileURLToPath(import.meta.url));
  const lies = (p: string): string => readFileSync(resolve(hier, p), 'utf8');
  const de = JSON.parse(lies('../src/i18n/katalog/de.json')) as Record<string, string>;
  const en = JSON.parse(lies('../src/i18n/katalog/en.json')) as Record<string, string>;
  const panel = lies('../src/ui/SettingsPanel.ts');
  const schluessel = new Set(panel.match(/'settings\.(?:tab\.audio|section\.audio_[a-z]+|audio\.[a-z]+)'/g)?.map((s) => s.slice(1, -1)));
  const erwartet = ['settings.tab.audio', 'settings.section.audio_master', 'settings.section.audio_channels', 'settings.audio.master',
    'settings.audio.muted', 'settings.audio.music', 'settings.audio.ambience', 'settings.audio.world', 'settings.audio.ui', 'settings.audio.reset'];
  pruefe('SettingsPanel benutzt alle zehn Audio-Schlüssel', erwartet.every((k) => schluessel.has(k)) && schluessel.size === erwartet.length, [...schluessel].join(','));
  for (const k of schluessel) {
    pruefe(`${k} in de.json und en.json, nicht leer`, typeof de[k] === 'string' && de[k].trim() !== '' && typeof en[k] === 'string' && en[k].trim() !== '');
  }
  pruefe('de und en unterscheiden sich (echte Übersetzung)', [...schluessel].filter((k) => de[k] === en[k]).length === 0);
  const engine = lies('../src/engine/Audio/AudioEngine.ts');
  pruefe('AudioEngine legt die Busse mit den gespeicherten Pegeln an (vor der Musik)',
    /startPegel = berechnePegel\(einstellungen\.get\(\)\)/.test(engine) && /createBusAsync\('music', \{ volume: startPegel\.bus\.music \}\)/.test(engine));
  pruefe('AudioEngine hört live auf die Einstellungen', /einstellungen\.onChange\(/.test(engine));
}

if (fehler > 0) {
  console.error(`\n=== Audio-Einstellungen: ${fehler} PRÜFUNG(EN) FEHLGESCHLAGEN ===`);
  process.exit(1);
}
console.log('\n=== Audio-Einstellungen: alle Prüfungen grün ===');
