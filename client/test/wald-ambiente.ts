/**
 * Waldambiente (client/src/engine/Audio/WaldAmbiente.ts): Dichte → Lautstärke,
 * Glättung, Tag/Nacht, Aus-Fälle, Ladeverhalten, Regler, Manifest.
 *
 * Reine Logik mit einer Attrappe der Ton-Engine (kein Browser, kein Babylon).
 * Die Dichte kommt aus shared/src/worldgen/waldDichte.ts mit einer künstlichen
 * Waldquelle (Wald ab x = 0, oder ein Baumstand ohne Dichte).
 *
 * Lauf: npx tsx client/test/wald-ambiente.ts   (aus dem Repo-Wurzel)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Biome, FRACTION_SUNRISE, FRACTION_SUNSET, WATER_LEVEL } from '@wov/shared';
import { FOLIAGE } from '@wov/shared/src/vegetation.js';
import { baeumeImUmkreis, istWaldbaum, waldStufe, type WaldQuelle } from '@wov/shared/src/worldgen/waldDichte.js';
import {
  GRUPPE_VOEGEL,
  GRUPPE_WIND,
  RAMPE_S,
  WALD_WERTE,
  WaldAmbiente,
  pegelZuLautstaerke,
  rampe,
  tagesAnteil,
  weltZuQuelle,
  zielPegel,
  type AmbienteAudio,
  type SchleifenHandle,
} from '../src/engine/Audio/WaldAmbiente';
import { readAudioManifest, groupByBus } from '../src/engine/Audio/AudioManifest';
import { AUDIO_VORGABEN, BUS_VORGABE, berechnePegel, type AudioWerte } from '../src/engine/Audio/AudioEinstellungen';
import { WeltToene, umgebungAus, type ToeneWelt } from '../src/engine/Audio/WeltToene';
import type { AudioEngine } from '../src/engine/Audio/AudioEngine';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}

const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BAUMNAMEN = FOLIAGE.filter((v) => istWaldbaum(v.prefabName)).map((v) => v.prefabName);

/** Wald ab x >= 0 (kuratierte Baumliste, Waldfaktor 0,5), davor Wiese ohne Liste. */
const waldAbNull: WaldQuelle = {
  getForestFactor: () => 0.5,
  regionAt: (x) => (x >= 0 ? { vegetation: BAUMNAMEN } : {}),
};
/** Wiese mit einzelnen Bäumen: kuratiert mit einer einzigen seltenen Art (≈ 1 Baum je Zone). */
const einzelBaeume: WaldQuelle = {
  getForestFactor: () => 0.5,
  regionAt: () => ({ vegetation: ['vegetation-massive-tree-1a3'] }),
};
const ueberallWald: WaldQuelle = { getForestFactor: () => 0.5, regionAt: () => ({ vegetation: BAUMNAMEN }) };

interface Attrappe {
  audio: AmbienteAudio;
  aufrufe: string[];
  handles: Map<string, { volume: number; gestoppt: boolean }>;
  entsperren(): void;
}
function attrappe(gesperrt = false): Attrappe {
  let gate = gesperrt;
  const aufrufe: string[] = [];
  const handles = new Map<string, { volume: number; gestoppt: boolean }>();
  const audio: AmbienteAudio = {
    diagnose: {},
    startLoopAsync: async (_bus, gruppe): Promise<SchleifenHandle | null> => {
      aufrufe.push(gruppe);
      if (gate) return null;
      const h = { volume: -1, gestoppt: false };
      handles.set(gruppe, h);
      return { get volume() { return h.volume; }, set volume(v: number) { h.volume = v; }, stop: () => { h.gestoppt = true; } };
    },
  };
  return { audio, aufrufe, handles, entsperren: () => { gate = false; } };
}

interface Bild { t: number; x: number; baeume: number; vogel: number; wind: number }
interface LaufOptionen {
  quelle: WaldQuelle | null;
  tageszeit?: number | ((t: number) => number);
  x0: number;
  vx: number; // m/s
  y?: number;
  dungeon?: boolean;
  sekunden: number;
  dt?: number;
  a?: Attrappe;
  entsperrtNach?: number;
}
async function lauf(o: LaufOptionen): Promise<{ bilder: Bild[]; a: Attrappe }> {
  const a = o.a ?? attrappe();
  const figur = { position: { x: o.x0, y: o.y ?? WATER_LEVEL + 20, z: 0 }, dungeonMode: o.dungeon ?? false };
  const feste = typeof o.tageszeit === 'number' ? o.tageszeit : 0.5;
  const zeitFn = typeof o.tageszeit === 'function' ? o.tageszeit : (): number => feste;
  let t = 0;
  const w = new WaldAmbiente(() => figur, () => o.quelle, () => zeitFn(t), () => a.audio);
  const dt = o.dt ?? 1 / 60;
  const bilder: Bild[] = [];
  for (; t < o.sekunden; t += dt) {
    if (o.entsperrtNach !== undefined && t >= o.entsperrtNach) a.entsperren();
    figur.position.x = o.x0 + o.vx * t;
    w.update(dt);
    await Promise.resolve(); // Zusagen der Attrappe abwarten
    const d = a.audio.diagnose!.wald as { baeume: number; vogelLautstaerke: number; windLautstaerke: number } | undefined;
    bilder.push({ t, x: figur.position.x, baeume: d?.baeume ?? 0, vogel: d?.vogelLautstaerke ?? 0, wind: d?.windLautstaerke ?? 0 });
  }
  return { bilder, a };
}
const db = (a: number, b: number): number => 20 * Math.log10(b / a);
const BODEN = 0.00316; // −50 dB: darunter zählt ein Sprung nicht mehr als hörbar
function groessterSprungDb(werte: number[]): number {
  let m = 0;
  for (let i = 1; i < werte.length; i++) if (werte[i] > BODEN && werte[i - 1] > BODEN) m = Math.max(m, Math.abs(db(werte[i - 1], werte[i])));
  return m;
}

async function main(): Promise<void> {
  // ── 1. Kurven ─────────────────────────────────────────────────────
  console.log('Kurve Baumzahl → Lautstärke (Mittag)');
  const hoerer = (b: number): number => pegelZuLautstaerke(zielPegel(waldStufe(b, WALD_WERTE.von, WALD_WERTE.voll), 0.5).vogel, WALD_WERTE.vogelMax);
  pruefe('offene Fläche (0 Bäume): Lautstärke 0', hoerer(0) === 0);
  pruefe('unter der Schwelle (von): 0', hoerer(WALD_WERTE.von) === 0);
  pruefe('ab voll: Höchstwert', Math.abs(hoerer(WALD_WERTE.voll) - WALD_WERTE.vogelMax) < 1e-12 && hoerer(1e6) === WALD_WERTE.vogelMax);
  let monoton = true;
  let vorher = -1;
  for (let b = 0; b <= 400; b += 0.25) {
    const v = hoerer(b);
    if (v < vorher) monoton = false;
    vorher = v;
  }
  pruefe('monoton steigend über 0…400 Bäume', monoton);
  pruefe('Rampe: höchstens rate·dt je Schritt, trifft das Ziel', rampe(0, 1, 0.4, 0.5) === 0.2 && rampe(0.9, 1, 0.4, 0.5) === 1 && rampe(1, 0, 0.4, 0.5) === 0.8 && rampe(0.1, 0, 0.4, 0.5) === 0);

  console.log('Tag/Nacht');
  pruefe('Mittag: Tagesanteil 1', tagesAnteil(0.5) === 1);
  pruefe('Mitternacht: Tagesanteil 0', tagesAnteil(0) === 0 && tagesAnteil(0.99) === 0);
  pruefe('Sonnenaufgang: Dämmerung (0,2)', Math.abs(tagesAnteil(FRACTION_SUNRISE) - 0.2) < 1e-9, tagesAnteil(FRACTION_SUNRISE).toFixed(3));
  pruefe('Sonnenuntergang: Dämmerung (0,2)', Math.abs(tagesAnteil(FRACTION_SUNSET) - 0.2) < 1e-9, tagesAnteil(FRACTION_SUNSET).toFixed(3));
  let morgenMonoton = true;
  let abendMonoton = true;
  let v = -1;
  for (let f = 0.05; f <= 0.3; f += 0.001) {
    const t = tagesAnteil(f);
    if (t < v) morgenMonoton = false;
    v = t;
  }
  v = 2;
  for (let f = 0.7; f <= 0.95; f += 0.001) {
    const t = tagesAnteil(f);
    if (t > v) abendMonoton = false;
    v = t;
  }
  pruefe('Morgen: Tagesanteil steigt monoton, Abend: fällt monoton', morgenMonoton && abendMonoton);
  const dd = zielPegel(1, FRACTION_SUNRISE);
  pruefe('Dämmerung: Vögel und Wind zugleich hörbar (Überblendung)', dd.vogel > 0 && dd.wind > 0, `${dd.vogel.toFixed(2)} / ${dd.wind.toFixed(2)}`);
  // Gleichleistung: Amplitudenleistung gv² + gw² (Höchstwerte 1 / 0,6) fällt in der Überblendung nie unter die leisere Seite
  // und steigt nie über die lautere (Toleranz 1,5 dB); die alte lineare Überblendung lag bis 6 dB darunter.
  {
    const leistung = (f: number): number => {
      const z = zielPegel(1, f);
      const gv = pegelZuLautstaerke(z.vogel, WALD_WERTE.vogelMax);
      const gw = pegelZuLautstaerke(z.wind, WALD_WERTE.windMax);
      return gv * gv + gw * gw;
    };
    const nachtP = leistung(0);
    const tagP = leistung(0.5);
    let tiefste = Infinity;
    let hoechste = -Infinity;
    for (let f = 0.05; f <= 0.3; f += 0.001) {
      const p = 10 * Math.log10(leistung(f));
      tiefste = Math.min(tiefste, p);
      hoechste = Math.max(hoechste, p);
    }
    const unten = 10 * Math.log10(Math.min(nachtP, tagP));
    const oben = 10 * Math.log10(Math.max(nachtP, tagP));
    pruefe('Gleichleistung Wind ↔ Vögel: Leistungssumme höchstens 1,5 dB unter der leiseren Seite', tiefste >= unten - 1.5, `tiefste ${tiefste.toFixed(2)} dB gegen ${unten.toFixed(2)} dB`);
    pruefe('… und höchstens 1,5 dB über der lauteren Seite', hoechste <= oben + 1.5, `höchste ${hoechste.toFixed(2)} dB gegen ${oben.toFixed(2)} dB`);
  }

  // ── 2. Lauf: von der Wiese in den Wald ────────────────────────────
  console.log('Lauf Wiese → Wald (60 Bilder/s, 4,5 m/s)');
  const r60 = await lauf({ quelle: waldAbNull, x0: -120, vx: 4.5, sekunden: 60 });
  const vogel = r60.bilder.map((b) => b.vogel);
  const ersteHoerbar = r60.bilder.find((b) => b.vogel > BODEN);
  pruefe('auf der Wiese still', r60.bilder.filter((b) => b.x < -80).every((b) => b.vogel === 0 && b.baeume === 0));
  pruefe('im Wald nach der Überblendung Höchstwert', vogel[vogel.length - 1] > 0.99 * WALD_WERTE.vogelMax, vogel[vogel.length - 1].toFixed(3));
  pruefe('kein Absinken beim Hineinlaufen (monoton nicht fallend)', vogel.every((x, i) => i === 0 || x >= vogel[i - 1] - 1e-12));
  const s60 = groessterSprungDb(vogel);
  pruefe('größter Sprung je Bild (60/s) ≤ 2,1 dB über −50 dBFS', s60 <= 2.1, `${s60.toFixed(2)} dB`);
  const t0 = ersteHoerbar?.t ?? 0;
  const tVoll = r60.bilder.find((b) => b.vogel > 0.99 * WALD_WERTE.vogelMax)?.t ?? 0;
  pruefe('Überblendung dauert mindestens die Rampe (2,5 s) vom Hörbaren bis Voll', tVoll - t0 >= RAMPE_S * 0.9, `${(tVoll - t0).toFixed(2)} s`);

  console.log('Lauf 30 Bilder/s');
  const r30 = await lauf({ quelle: waldAbNull, x0: -120, vx: 4.5, sekunden: 60, dt: 1 / 30 });
  const s30 = groessterSprungDb(r30.bilder.map((b) => b.vogel));
  pruefe('größter Sprung je Bild (30/s) ≤ 4,0 dB', s30 <= 4.0, `${s30.toFixed(2)} dB`);

  console.log('Lauf Wald → Wiese (zurück)');
  const zurueck = await lauf({ quelle: waldAbNull, x0: 200, vx: -4.5, sekunden: 75 });
  const vz = zurueck.bilder.map((b) => b.vogel);
  pruefe('im Wald zuerst laut, auf der Wiese am Ende 0', vz[vz.length - 1] === 0 && Math.max(...vz) > 0.9);
  const spitze = vz.indexOf(Math.max(...vz));
  pruefe('nach der Spitze nur noch fallend (kein Anstieg beim Herauslaufen)', vz.slice(spitze).every((x, i, arr) => i === 0 || x <= arr[i - 1] + 1e-12));
  pruefe('Sprung je Bild ≤ 2,1 dB', groessterSprungDb(vz) <= 2.1, `${groessterSprungDb(vz).toFixed(2)} dB`);

  console.log('Einzelne Bäume am Weg');
  const einzel = await lauf({ quelle: einzelBaeume, x0: -300, vx: 4.5, sekunden: 120 });
  const maxEinzel = Math.max(...einzel.bilder.map((b) => b.vogel));
  const maxBaeume = Math.max(...einzel.bilder.map((b) => b.baeume));
  pruefe('Wiese mit Einzelbäumen bleibt still (kein Sprung, gar keine Lautstärke)', maxEinzel === 0, `Lautstärke max ${maxEinzel}, Bäume im Umkreis max ${maxBaeume.toFixed(1)}`);
  pruefe('… weil die Erwartung unter der Schwelle liegt', maxBaeume < WALD_WERTE.von, `${maxBaeume.toFixed(1)} < ${WALD_WERTE.von}`);

  console.log('Sprung in der Quelle (Teleport in dichten Wald)');
  const teleWald = attrappe();
  const figur = { position: { x: 100, y: WATER_LEVEL + 20, z: 0 }, dungeonMode: false };
  const w = new WaldAmbiente(() => figur, () => waldAbNull, () => 0.5, () => teleWald.audio);
  const spruenge: number[] = [];
  for (let i = 0; i < 300; i++) {
    w.update(1 / 60);
    await Promise.resolve();
    spruenge.push((teleWald.audio.diagnose!.wald as { vogelLautstaerke: number }).vogelLautstaerke);
  }
  const nach1s = spruenge[59];
  pruefe('nach dem Teleport in den Wald höchstens (1 s / 2,5 s)² des Höchstwerts nach 1 s', nach1s <= (1 / RAMPE_S) ** 2 * WALD_WERTE.vogelMax + 1e-9, nach1s.toFixed(4));
  pruefe('… und Sprung je Bild ≤ 2,1 dB', groessterSprungDb(spruenge) <= 2.1, `${groessterSprungDb(spruenge).toFixed(2)} dB`);

  // ── 3. Tag und Nacht im Wald ──────────────────────────────────────
  console.log('Tag/Nacht im dichten Wald (Lauf, 20 s Stand)');
  const tag = await lauf({ quelle: ueberallWald, x0: 0, vx: 0, sekunden: 20, tageszeit: 0.5 });
  const nacht = await lauf({ quelle: ueberallWald, x0: 0, vx: 0, sekunden: 20, tageszeit: 0.0 });
  const tEnde = tag.bilder[tag.bilder.length - 1];
  const nEnde = nacht.bilder[nacht.bilder.length - 1];
  pruefe('Mittag: Vögel voll, Wind 0', tEnde.vogel > 0.99 * WALD_WERTE.vogelMax && tEnde.wind === 0, `${tEnde.vogel.toFixed(3)} / ${tEnde.wind}`);
  pruefe('Mitternacht: Vögel 0, leiser Wind', nEnde.vogel === 0 && Math.abs(nEnde.wind - WALD_WERTE.windMax) < 0.01 * WALD_WERTE.windMax, `${nEnde.vogel} / ${nEnde.wind.toFixed(3)}`);
  pruefe('Nachtwind leiser als Tagesvögel', nEnde.wind < tEnde.vogel);
  pruefe('Nacht lädt nur die Wind-Schleife, Tag nur die Vögel', nacht.a.aufrufe.length > 0 && nacht.a.aufrufe.every((g) => g === GRUPPE_WIND) && tag.a.aufrufe.every((g) => g === GRUPPE_VOEGEL) && tag.a.aufrufe.length > 0, `Nacht ${[...new Set(nacht.a.aufrufe)]}, Tag ${[...new Set(tag.a.aufrufe)]}`);
  const wechsel = await lauf({ quelle: ueberallWald, x0: 0, vx: 0, sekunden: 90, tageszeit: (t) => 0.05 + t * (0.25 / 90) }); // Nacht → Morgen in 90 s
  pruefe('Nacht → Morgen: Sprung je Bild (Vögel) ≤ 2,1 dB', groessterSprungDb(wechsel.bilder.map((b) => b.vogel)) <= 2.1, `${groessterSprungDb(wechsel.bilder.map((b) => b.vogel)).toFixed(2)} dB`);
  pruefe('Nacht → Morgen: Sprung je Bild (Wind) ≤ 2,1 dB', groessterSprungDb(wechsel.bilder.map((b) => b.wind)) <= 2.1, `${groessterSprungDb(wechsel.bilder.map((b) => b.wind)).toFixed(2)} dB`);

  // ── 3b. Schwelle, Glättung, Doppelstart, Takt, Anhalten, Allokation ──
  console.log('Schwelle, Glättung, Doppelstart, Takt, Anhalten, Allokation');
  const nurListe = (name: string): WaldQuelle => ({ getForestFactor: () => 0.5, regionAt: () => ({ vegetation: [name] }) });
  const knapp = await lauf({ quelle: nurListe('vegetation-pine-1b2'), x0: 0, vx: 0, sekunden: 20 }); // ≈ 14,7 erwartete Bäume: unter `von` (20)
  const knappE = Math.max(...knapp.bilder.map((b) => b.baeume));
  pruefe('unter der Schwelle (≈ 15 erwartete Bäume, von = 20): still', knappE > 5 && knappE < 20 && knapp.bilder.every((b) => b.vogel === 0), `${knappE.toFixed(1)} Bäume`);
  const ueber = await lauf({ quelle: nurListe('vegetation-small-thin-tree-1a2'), x0: 0, vx: 0, sekunden: 20 }); // ≈ 39,3
  pruefe('über der Schwelle (≈ 39 erwartete Bäume): leise hörbar', ueber.bilder[ueber.bilder.length - 1].vogel > 0.001, ueber.bilder[ueber.bilder.length - 1].vogel.toFixed(4));

  // Glättung: Sprung des Stufen-Ziels (Teleport in den Wald) darf `stufe` nicht sofort auf 1 heben.
  {
    const a = attrappe();
    const f = { position: { x: 100, y: WATER_LEVEL + 20, z: 0 }, dungeonMode: false };
    const w = new WaldAmbiente(() => f, () => waldAbNull, () => 0.5, () => a.audio);
    const stufen: number[] = [];
    for (let i = 0; i < 90; i++) {
      w.update(1 / 60);
      stufen.push((a.audio.diagnose!.wald as { stufe: number }).stufe);
    }
    pruefe('Glättung: nach 0,1 s erst ≈ 10 % der Stufe (Zeitkonstante 1 s)', stufen[5] > 0.05 && stufen[5] < 0.2, stufen[5].toFixed(3));
    pruefe('Glättung: nach 1 s ≈ 63 %', stufen[59] > 0.55 && stufen[59] < 0.72, stufen[59].toFixed(3));
  }

  // Doppelstart: solange der Start einer Schleife noch aussteht, kommt kein zweiter Aufruf derselben Gruppe.
  {
    const aufrufe: string[] = [];
    const wartende: ((h: SchleifenHandle | null) => void)[] = [];
    const audio: AmbienteAudio = {
      diagnose: {},
      startLoopAsync: (_b, g) => {
        aufrufe.push(g);
        return new Promise((res) => wartende.push(res));
      },
    };
    const f = { position: { x: 100, y: WATER_LEVEL + 20, z: 0 }, dungeonMode: false };
    const w = new WaldAmbiente(() => f, () => waldAbNull, () => 0.5, () => audio);
    for (let i = 0; i < 180; i++) {
      w.update(1 / 60);
      await Promise.resolve();
    }
    pruefe('ausstehender Start: genau ein Aufruf trotz 180 Bildern', aufrufe.length === 1, `${aufrufe.length}`);
  }

  // Takt: die Dichte wird höchstens alle 0,5 s gerechnet (vorher: jedes Bild).
  {
    let regionAbfragen = 0;
    const gezaehlt: WaldQuelle = { getForestFactor: () => 0.5, regionAt: () => (regionAbfragen++, { vegetation: BAUMNAMEN }) };
    const a = attrappe();
    const f = { position: { x: 0, y: WATER_LEVEL + 20, z: 0 }, dungeonMode: false };
    const w = new WaldAmbiente(() => f, () => gezaehlt, () => 0.5, () => a.audio);
    for (let i = 0; i < 120; i++) w.update(1 / 60); // 2 s
    pruefe('Dichte-Takt: in 2 s höchstens 5 Rechnungen zu 25 Abtastpunkten', regionAbfragen >= 25 && regionAbfragen <= 5 * 25, `${regionAbfragen} Abfragen`);
  }

  // Anhalten: 10 s bei Ziel 0 (Wiese) stoppt die Schleife, die Rückkehr startet sie neu (genau eine laufende Instanz).
  {
    const gestartet: { volume: number; gestoppt: boolean }[] = [];
    const audio: AmbienteAudio = {
      diagnose: {},
      startLoopAsync: async () => {
        const h = { volume: -1, gestoppt: false };
        gestartet.push(h);
        return { get volume() { return h.volume; }, set volume(v: number) { h.volume = v; }, stop: () => { h.gestoppt = true; } };
      },
    };
    const f = { position: { x: 100, y: WATER_LEVEL + 20, z: 0 }, dungeonMode: false };
    const w = new WaldAmbiente(() => f, () => waldAbNull, () => 0.5, () => audio);
    const laufe = async (sekunden: number): Promise<void> => {
      for (let i = 0; i < sekunden * 60; i++) {
        w.update(1 / 60);
        await Promise.resolve();
      }
    };
    await laufe(15);
    const erste = gestartet[0];
    pruefe('im Wald läuft genau eine Schleife mit Lautstärke', gestartet.length === 1 && erste.volume > 0.9 && !erste.gestoppt);
    f.position.x = -300;
    await laufe(12); // Ausblenden 2,5 s + Glättung, dann < 10 s Stille
    pruefe('nach dem Ausblenden, vor 10 s Stille: Schleife läuft noch (Lautstärke 0)', !erste.gestoppt && erste.volume === 0, `${erste.volume}`);
    await laufe(12);
    pruefe('nach 10 s Stille: Schleife angehalten', erste.gestoppt);
    f.position.x = 100;
    await laufe(15);
    const zweite = gestartet[1];
    pruefe('zurück im Wald: neue Schleife (kein Doppelstart, die alte bleibt gestoppt)', gestartet.length === 2 && zweite !== undefined && !zweite.gestoppt && zweite.volume > 0.9 && erste.gestoppt, `${gestartet.length} Starts`);
  }

  // Allokation: der Zeuge `diagnose.wald` ist ein einziges wiederverwendetes Objekt, `zielPegel` schreibt in eines.
  {
    const a = attrappe();
    const f = { position: { x: 100, y: WATER_LEVEL + 20, z: 0 }, dungeonMode: false };
    const w = new WaldAmbiente(() => f, () => waldAbNull, () => 0.5, () => a.audio);
    w.update(1 / 60);
    const erstes = a.audio.diagnose!.wald;
    for (let i = 0; i < 30; i++) w.update(1 / 60);
    pruefe('diagnose.wald ist über die Bilder dasselbe Objekt', a.audio.diagnose!.wald === erstes);
    const aus = { vogel: 0, wind: 0 };
    pruefe('zielPegel schreibt in das übergebene Objekt', zielPegel(0.5, 0.5, aus) === aus);
  }

  // ── 3c. Anbindung an die Welt (weltZuQuelle), WeltToene, Regler ──
  console.log('Weltanbindung, WeltToene, Regler Umgebung');
  const hmStub = (hoehe: number, ny = 1): NonNullable<ToeneWelt['heightmaps']> & Record<string, unknown> => ({
    getGroundHeight: () => hoehe,
    getZoneAt: () => ({ getWorldNormal: () => ({ y: ny }), zoneX: 0, zoneY: 0, cornerBiomes: [Biome.Meadows, Biome.Meadows, Biome.Meadows, Biome.Meadows], getBiome: () => Biome.Meadows, getVegetationMask: () => 0 }),
  }) as never;
  const weltMit = (hm?: ReturnType<typeof hmStub>): ToeneWelt => ({ geo: { getForestFactor: () => 0.5 }, regionGeo: { regionAt: () => ({ vegetation: BAUMNAMEN }) }, heightmaps: hm as never });
  const qLand = weltZuQuelle(weltMit(hmStub(WATER_LEVEL + 5)))!;
  pruefe('weltZuQuelle bindet das Gelände an (gelaende ist eine Funktion)', typeof qLand.gelaende === 'function');
  pruefe('… Land: Bäume', baeumeImUmkreis(0, 0, qLand) > 100);
  pruefe('… offenes Meer (5 m unter dem Spiegel): 0 Bäume', baeumeImUmkreis(0, 0, weltZuQuelle(weltMit(hmStub(WATER_LEVEL - 5)))!) === 0);
  pruefe('… 60°-Hang: 0 Bäume', baeumeImUmkreis(0, 0, weltZuQuelle(weltMit(hmStub(WATER_LEVEL + 5, 0.5)))!) === 0);
  pruefe('… ohne Radialwelt-Region: 0 Bäume', baeumeImUmkreis(0, 0, weltZuQuelle({ ...weltMit(hmStub(WATER_LEVEL + 5)), regionGeo: null })!) === 0);
  pruefe('… ohne Welt: null', weltZuQuelle(null) === null);

  interface Fake { aufrufeWelt: string[]; schleifen: { gruppe: string; volume: number; gestoppt: boolean }[]; engine: AudioEngine }
  const fakeEngine = (): Fake => {
    const f: Fake = { aufrufeWelt: [], schleifen: [], engine: null as never };
    f.engine = {
      diagnose: {},
      playAsync: async (bus: string, gruppe: string) => { f.aufrufeWelt.push(`${bus}:${gruppe}`); },
      startLoopAsync: async (_bus: string, gruppe: string) => {
        const h = { gruppe, volume: -1, gestoppt: false };
        f.schleifen.push(h);
        return { get volume() { return h.volume; }, set volume(v: number) { h.volume = v; }, stop: () => { h.gestoppt = true; } };
      },
    } as never;
    return f;
  };
  const figurFake = (): { position: { x: number; y: number; z: number }; inLuft: boolean; rennt: boolean; bauModus: boolean; frozen: boolean; dungeonMode: boolean; bodenSonde: null } =>
    ({ position: { x: 0, y: WATER_LEVEL + 5, z: 0 }, inLuft: false, rennt: false, bauModus: false, frozen: false, dungeonMode: false, bodenSonde: null });
  const wiese = { ...hmStub(WATER_LEVEL + 5), getGroundHeight: () => WATER_LEVEL + 5 };
  {
    const fe = fakeEngine();
    const fig = figurFake();
    const wt = new WeltToene(() => fig, () => weltMit(wiese as never), () => ({ timeOfDay: 0.5 }), () => fe.engine, { get: () => AUDIO_VORGABEN });
    for (let i = 0; i < 60 * 8; i++) {
      fig.position.x += 4.5 / 60;
      wt.update(1 / 60);
      await Promise.resolve();
    }
    pruefe('WeltToene: die Schritte laufen (Bus world, Gras)', fe.aufrufeWelt.filter((a) => a === 'world:footsteps/grass').length >= 20, `${fe.aufrufeWelt.length} Schritte in 8 s`);
    pruefe('WeltToene: das Waldambiente läuft (Vogelschleife mit Lautstärke)', fe.schleifen.length === 1 && fe.schleifen[0].gruppe === GRUPPE_VOEGEL && fe.schleifen[0].volume > 0.5, `${fe.schleifen.map((h) => `${h.gruppe} ${h.volume.toFixed(2)}`)}`);
  }

  // Regler Umgebung: bei 0 (oder Gesamt 0 / stumm) hält die Schleife nach 10 s an, danach kehrt sie zurück.
  {
    pruefe('umgebungAus: nur bei Regler Umgebung 0, Gesamt 0 oder stumm', !umgebungAus(AUDIO_VORGABEN) && umgebungAus({ ...AUDIO_VORGABEN, regler: { ...AUDIO_VORGABEN.regler, ambience: 0 } }) && umgebungAus({ ...AUDIO_VORGABEN, gesamt: 0 }) && umgebungAus({ ...AUDIO_VORGABEN, stumm: true }) && !umgebungAus({ ...AUDIO_VORGABEN, regler: { ...AUDIO_VORGABEN.regler, world: 0, music: 0 } }));
    let werte: AudioWerte = AUDIO_VORGABEN;
    const fe = fakeEngine();
    const fig = figurFake();
    const wt = new WeltToene(() => fig, () => weltMit(wiese as never), () => ({ timeOfDay: 0.5 }), () => fe.engine, { get: () => werte });
    const laufe = async (s: number): Promise<void> => {
      for (let i = 0; i < s * 60; i++) {
        wt.update(1 / 60);
        await Promise.resolve();
      }
    };
    await laufe(12);
    const erste = fe.schleifen[0];
    pruefe('im Wald bei Regler 100 %: Schleife läuft mit Lautstärke', fe.schleifen.length === 1 && erste.volume > 0.9 && !erste.gestoppt);
    werte = { ...AUDIO_VORGABEN, regler: { ...AUDIO_VORGABEN.regler, ambience: 0 } };
    await laufe(8);
    pruefe('Regler Umgebung 0: nach 8 s Lautstärke 0, Schleife noch nicht angehalten', erste.volume === 0 && !erste.gestoppt, `${erste.volume}`);
    await laufe(6);
    pruefe('Regler Umgebung 0: nach 14 s (2,5 s Rampe + 10 s Stille) angehalten', erste.gestoppt);
    await laufe(20);
    pruefe('… und bleibt aus (kein Neustart trotz Wald)', fe.schleifen.length === 1);
    werte = AUDIO_VORGABEN;
    await laufe(12);
    pruefe('Regler wieder 100 %: neue Schleife, genau eine laufende', fe.schleifen.length === 2 && !fe.schleifen[1].gestoppt && fe.schleifen[1].volume > 0.9, `${fe.schleifen.length} Starts`);
  }

  // ── 4. Aus-Fälle ──────────────────────────────────────────────────
  console.log('Aus-Fälle');
  const dung = await lauf({ quelle: ueberallWald, x0: 0, vx: 0, sekunden: 20, dungeon: true });
  pruefe('Dungeon: still', dung.bilder.every((b) => b.vogel === 0 && b.wind === 0) && dung.a.aufrufe.length === 0);
  const tief = await lauf({ quelle: ueberallWald, x0: 0, vx: 0, sekunden: 20, y: WATER_LEVEL - 0.6 });
  pruefe('unter Wasser (0,6 m tief): still', tief.bilder.every((b) => b.vogel === 0));
  const knie = await lauf({ quelle: ueberallWald, x0: 0, vx: 0, sekunden: 20, y: WATER_LEVEL - 0.3 });
  pruefe('Wasser bis Knie (0,3 m): läuft', knie.bilder[knie.bilder.length - 1].vogel > 0.9);
  const ohneWelt = await lauf({ quelle: null, x0: 0, vx: 0, sekunden: 5 });
  pruefe('ohne Welt: still', ohneWelt.bilder.every((b) => b.vogel === 0) && ohneWelt.a.aufrufe.length === 0);
  const radial = await lauf({ quelle: weltZuQuelle({ geo: { getForestFactor: () => 0.5 }, regionGeo: null }), x0: 0, vx: 0, sekunden: 5 });
  pruefe('Radialwelt (kein Layout): still', radial.bilder.every((b) => b.vogel === 0));

  // ── 5. Laden ──────────────────────────────────────────────────────
  console.log('Ladeverhalten');
  const offen = await lauf({ quelle: waldAbNull, x0: -300, vx: 0, sekunden: 30 });
  pruefe('offenes Gelände lädt nichts (die Vogel-Datei ist 203 s lang)', offen.a.aufrufe.length === 0);
  const gesperrt = attrappe(true);
  const spaet = await lauf({ quelle: ueberallWald, x0: 0, vx: 0, sekunden: 10, a: gesperrt, entsperrtNach: 5 });
  const vorher5 = spaet.a.aufrufe.length;
  pruefe('vor dem Entsperren höchstens 1 Versuch je Sekunde', vorher5 <= 11, `${vorher5} Versuche in 10 s`);
  pruefe('nach dem Entsperren läuft die Schleife und hat Lautstärke', spaet.a.handles.has(GRUPPE_VOEGEL) && (spaet.a.handles.get(GRUPPE_VOEGEL)?.volume ?? 0) > 0, String(spaet.a.handles.get(GRUPPE_VOEGEL)?.volume));
  pruefe('genau eine Schleife je Gruppe (kein Mehrfachstart)', new Set(tag.a.aufrufe).size === 1 && tag.a.aufrufe.length === 1, `${tag.a.aufrufe.length}`);

  // ── 6. Regler „Umgebung“ ──────────────────────────────────────────
  console.log('Regler Umgebung');
  const normal = berechnePegel(AUDIO_VORGABEN);
  const nullRegler = berechnePegel({ ...AUDIO_VORGABEN, regler: { ...AUDIO_VORGABEN.regler, ambience: 0 } });
  const maxLautstaerke = tEnde.vogel;
  pruefe('Regler 100 %: Bus = Vorgabe (0,5), am Ohr Schleife × Bus', normal.bus.ambience === BUS_VORGABE.ambience && Math.abs(maxLautstaerke * normal.bus.ambience - 0.5) < 0.01);
  pruefe('Regler Umgebung 0 %: Bus 0, am Ohr 0', nullRegler.bus.ambience === 0 && maxLautstaerke * nullRegler.bus.ambience === 0);
  pruefe('Regler Umgebung 0 % lässt Musik und Welt unberührt', nullRegler.bus.music === normal.bus.music && nullRegler.bus.world === normal.bus.world);

  // ── 7. Manifest und Einbau ────────────────────────────────────────
  console.log('Manifest und Einbau');
  const roh = JSON.parse(readFileSync(resolve(wurzel, 'assets/manifest.json'), 'utf-8')) as { toene?: Record<string, { dauer?: number }> };
  const gruppen = groupByBus(readAudioManifest(roh)).ambience;
  pruefe('Gruppe Vögel steht im echten toene-Manifest (Bus ambience)', gruppen.has(GRUPPE_VOEGEL) && gruppen.get(GRUPPE_VOEGEL)!.length === 1, [...(gruppen.get(GRUPPE_VOEGEL) ?? [])].join(','));
  pruefe('Gruppe Wind steht im echten toene-Manifest (Bus ambience)', gruppen.has(GRUPPE_WIND) && gruppen.get(GRUPPE_WIND)!.length === 1, [...(gruppen.get(GRUPPE_WIND) ?? [])].join(','));
  pruefe('Schleifen sind lang genug (Vögel 203 s, Wind 54 s)', (roh.toene?.['ambience/forest-birds']?.dauer ?? 0) > 200 && (roh.toene?.['ambience/forest-wind-gusts']?.dauer ?? 0) > 50);
  const modul = readFileSync(resolve(wurzel, 'client/src/engine/Audio/WaldAmbiente.ts'), 'utf-8');
  const engine = readFileSync(resolve(wurzel, 'client/src/engine/Audio/AudioEngine.ts'), 'utf-8');
  const hauptdatei = readFileSync(resolve(wurzel, 'client/src/main.ts'), 'utf-8');
  pruefe('Modul ist rein (kein Babylon-Import)', !/@babylonjs/.test(modul));
  pruefe('Ton-Engine hat startLoopAsync und diagnose', /async startLoopAsync\(/.test(engine) && /readonly diagnose/.test(engine));
  pruefe('main.ts hängt es ein (Aufrufstelle je Frame) und bleibt unter 3700 Zeilen', /weltToene\.update\(dt\)/.test(hauptdatei) && hauptdatei.split('\n').length < 3700, `${hauptdatei.split('\n').length} Zeilen`);

  if (fehler > 0) {
    console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
    process.exit(1);
  }
  console.log('\nOK');
}
void main();
