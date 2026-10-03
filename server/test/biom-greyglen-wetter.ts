/**
 * K5 — greyglen weather on the wire and at the border: the server hands a player in biome 128 the new
 * clear state, a player in grassland still gets Clear; the client accepts the name and finds the same
 * environment; crossing the border sends the new state once; the cross-fade has no jump.
 * Wetter von greyglen beim Server und am Biomrand.
 *
 *   npx tsx server/test/biom-greyglen-wetter.ts   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import {
  Biome,
  ENVIRONMENT_DURATION,
  ENV_GLEN_CLEAR,
  ENVIRONMENTS,
  WETTER_AUTOMATISCH,
  WetterWuerfel,
  evaluateEnv,
  findEnvironment,
} from '@wov/shared';
import { WetterDienst, type WetterEmpfaenger } from '../src/spiel/Wetter.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { WetterAnnahme, type WetterLeser } from '../../client/src/net/wetterAnnahme.js';
import { frameSchritt, frameZustand, lerpEnvState, mischtRichtung, uebergangsZustand } from '../../client/src/engine/Lighting.js';

const nah = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;
let fehler = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fehler++;
};

// ── Server: the weather of a player in each biome ─────────────────────
let aktuellesBiom: Biome = Biome.Meadows;
const gesendet: string[][] = [];
const spieler = (): WetterEmpfaenger => ({
  position: { x: 0, y: 0, z: 0 },
  worldId: 'haupt',
  dungeonId: null,
  nurEditor: false,
  authenticated: true,
  sendPacketWith: (_t, fn) => {
    const wr = new Writer();
    fn(wr);
    const r = new Reader(wr.toBuffer());
    gesendet.push([r.readString(), r.readString(), String(r.readInt32())]);
  },
});
const dienst = new WetterDienst(new WetterWuerfel(), { umgebung: WETTER_AUTOMATISCH, nebelDichte: -1 }, () => aktuellesBiom, 'haupt');

// a window in which grassland AND greyglen are drawn as clear, so the two differ only in the state's name
let t0 = -1;
const w = new WetterWuerfel();
for (let i = 0; i < 400 && t0 < 0; i++) {
  const t = i * ENVIRONMENT_DURATION + 1;
  if (w.wetterFuer(Biome.Meadows, t).umgebung === 'Clear' && w.wetterFuer(Biome.Greyglen, t).umgebung === ENV_GLEN_CLEAR) t0 = t;
}
check('a window with clear weather in both biomes exists', t0 >= 0);

const p = spieler();
aktuellesBiom = Biome.Meadows;
check('grassland player: Clear', dienst.wetterFuer(p, t0)?.umgebung === 'Clear');
aktuellesBiom = Biome.Greyglen;
check('greyglen player: Glen clear (environment and state id)', dienst.wetterFuer(p, t0)?.umgebung === ENV_GLEN_CLEAR && dienst.wetterFuer(p, t0)?.zustand === ENV_GLEN_CLEAR);
aktuellesBiom = (Biome.Meadows | Biome.Greyglen) as Biome;
check('blend zone with the grassland bit: Clear', dienst.wetterFuer(p, t0)?.umgebung === 'Clear');

// ── Border crossing: one packet with the new state, none while nothing changes ──
const grenze = new WetterDienst(new WetterWuerfel(), { umgebung: WETTER_AUTOMATISCH, nebelDichte: -1 }, () => aktuellesBiom, 'haupt');
const q = spieler();
gesendet.length = 0;
aktuellesBiom = Biome.Meadows;
check('first packet: Clear', grenze.sendeAn(q, t0) && gesendet.at(-1)?.[0] === 'Clear');
check('no second packet while the biome stays', !grenze.sendeAn(q, t0 + 1) && gesendet.length === 1);
aktuellesBiom = Biome.Greyglen;
check('crossing into greyglen sends Glen clear', grenze.sendeAn(q, t0 + 2) && gesendet.at(-1)?.[0] === ENV_GLEN_CLEAR && gesendet.at(-1)?.[1] === ENV_GLEN_CLEAR, JSON.stringify(gesendet.at(-1)));
check('and only once', !grenze.sendeAn(q, t0 + 3) && gesendet.length === 2);
aktuellesBiom = Biome.Meadows;
check('crossing back sends Clear again', grenze.sendeAn(q, t0 + 4) && gesendet.at(-1)?.[0] === 'Clear' && gesendet.length === 3);

// ── Client: reads the same name, finds the same environment ───────────
const leser = (werte: (string | number)[]): WetterLeser => {
  let i = 0;
  return {
    readString: () => String(werte[i++]),
    readInt32: () => Number(werte[i++]),
    get remaining() {
      return werte.length - i;
    },
  };
};
const aufrufe: (string | null)[] = [];
const ziel = {
  setEnvironmentOverride(name: string | null): boolean {
    aufrufe.push(name);
    return name === null || findEnvironment(name) !== undefined;
  },
};
const annahme = new WetterAnnahme();
const paket = gesendet.find((x) => x[0] === ENV_GLEN_CLEAR)!;
annahme.lies(leser([paket[0], paket[1], Number(paket[2])]));
annahme.uebertrage(ziel);
check('client takes the packet over: Glen clear leads the light', annahme.fuehrt(null) && aufrufe.at(-1) === ENV_GLEN_CLEAR, JSON.stringify(aufrufe));
check('client and server resolve the name to one and the same state', findEnvironment(paket[0]) === findEnvironment(ENV_GLEN_CLEAR) && findEnvironment(paket[0])?.sunAngle === 50);

// ── Cross-fade: no jump (the weather change itself fades over 4 s through lerpEnvState) ──
const von = evaluateEnv(findEnvironment('Clear')!, 0.5);
const nach = evaluateEnv(findEnvironment(ENV_GLEN_CLEAR)!, 0.5);
const gl = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
  Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z))))) * 180 / Math.PI;
const start = lerpEnvState(von, nach, 0, true);
const ende = lerpEnvState(von, nach, 1, true);
check('fade start = old state (density, sun colour, strength)', start.fogDensity === von.fogDensity && start.sunColor.g === von.sunColor.g && start.lightIntensity === von.lightIntensity);
check('fade end = new state', ende.fogDensity === nach.fogDensity && ende.sunColor.g === nach.sunColor.g && ende.lightIntensity === nach.lightIntensity);
check('light direction at fade start = the old one (no jump), within 0.01°', gl(start.lightDir, von.lightDir) < 0.01 && gl(start.sunDir, von.sunDir) < 0.01,
  `${gl(start.lightDir, von.lightDir).toFixed(3)}° / ${gl(start.sunDir, von.sunDir).toFixed(3)}°`);
check('the two states really differ in direction (45° vs 50° maximum height), so the test is not vacuous', gl(von.sunDir, nach.sunDir) > 3, `${gl(von.sunDir, nach.sunDir).toFixed(2)}°`);
let schritt = 0;
let vorher = start;
for (let i = 1; i <= 40; i++) {
  const s = lerpEnvState(von, nach, i / 40, true);
  schritt = Math.max(schritt, Math.abs(s.fogDensity - vorher.fogDensity) / Math.abs(nach.fogDensity - von.fogDensity), gl(s.sunDir, vorher.sunDir) / gl(von.sunDir, nach.sunDir));
  vorher = s;
}
check('over 40 steps no step is bigger than 1/20 of the whole change (density and direction)', schritt <= 0.05, schritt.toFixed(4));
const mitte = lerpEnvState(von, nach, 0.5, true);
check('mid-fade sun direction is a unit vector (blend is renormalised)', nah(Math.hypot(mitte.sunDir.x, mitte.sunDir.y, mitte.sunDir.z), 1, 1e-9),
  String(Math.hypot(mitte.sunDir.x, mitte.sunDir.y, mitte.sunDir.z)));
// ── Other fades: exactly as before (the target's direction at once), vor und nach der Aenderung identisch ──
const alt = (a: ReturnType<typeof evaluateEnv>, b: ReturnType<typeof evaluateEnv>, t: number) => {
  const l = (x: number, y: number): number => x + (y - x) * t;
  const c = (p: { r: number; g: number; b: number }, q: { r: number; g: number; b: number }) => ({ r: l(p.r, q.r), g: l(p.g, q.g), b: l(p.b, q.b) });
  return {
    fogColor: c(a.fogColor, b.fogColor), fogColorSun: c(a.fogColorSun, b.fogColorSun), fogDensity: l(a.fogDensity, b.fogDensity),
    sunColor: c(a.sunColor, b.sunColor), ambColor: c(a.ambColor, b.ambColor), lightIntensity: l(a.lightIntensity, b.lightIntensity),
    cloudAlpha: l(a.cloudAlpha, b.cloudAlpha), lightDir: b.lightDir, sunDir: b.sunDir, isNight: b.isNight, elevation: b.elevation,
  };
};
const PAARE: [string, string][] = [['SwampRain', 'DeepNorth_dark'], ['DeepNorth_dark', 'SwampRain'], ['Ashrain', 'Mistlands_dark'], ['Mistlands_dark', 'Ashrain'],
  ['Clear', 'SwampRain'], ['Snow', 'Clear'], ['Clear', 'Heath clear'], ['Misty', 'Rain']];
let alleGleich = true;
let geprueft = 0;
for (const [x, y] of PAARE) {
  const ex = findEnvironment(x)!;
  const ey = findEnvironment(y)!;
  for (const f of [0.05, 0.2, 0.5, 0.7, 0.9]) {
    for (const t of [0, 0.25, 0.5, 1]) {
      geprueft++;
      const a = evaluateEnv(ex, f);
      const b = evaluateEnv(ey, f);
      if (JSON.stringify(lerpEnvState(a, b, t)) !== JSON.stringify(alt(a, b, t))) alleGleich = false;
    }
  }
}
check('fades between pairs without Glen clear are identical to the behaviour before (8 pairs, 5 times, 4 steps)', alleGleich && geprueft === 160, String(geprueft));
const sw = lerpEnvState(evaluateEnv(findEnvironment('SwampRain')!, 0.5), evaluateEnv(findEnvironment('DeepNorth_dark')!, 0.5), 0.5);
check('SwampRain to DeepNorth_dark at half: direction is the target\'s, not blended', gl(sw.sunDir, evaluateEnv(findEnvironment('DeepNorth_dark')!, 0.5).sunDir) === 0);
const nm = (n: string) => findEnvironment(n)!;
const glenEnv = nm(ENV_GLEN_CLEAR);
check('mischtRichtung: Glen ends yes, no Glen no (6 ordered pairs)',
  mischtRichtung(glenEnv, nm('Clear')) && mischtRichtung(nm('Clear'), glenEnv) && !mischtRichtung(nm('Clear'), nm('Rain'))
  && mischtRichtung(glenEnv, nm('Rain')) && mischtRichtung(nm('Rain'), glenEnv) && !mischtRichtung(nm('Rain'), nm('Clear'))
  && mischtRichtung(glenEnv, glenEnv) === true && !mischtRichtung(nm('SwampRain'), nm('DeepNorth_dark')));
// the state shown during a fade, for every blend step: Glen pairs are blended, the others are the old behaviour
let uebergangOk = true;
for (const [x, y] of [...PAARE, ['Clear', ENV_GLEN_CLEAR], [ENV_GLEN_CLEAR, 'Clear'], ['Rain', ENV_GLEN_CLEAR], [ENV_GLEN_CLEAR, 'Rain']] as [string, string][]) {
  for (const f of [0.2, 0.5, 0.7]) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const a = evaluateEnv(nm(x), f);
      const b = evaluateEnv(nm(y), f);
      const soll = x === ENV_GLEN_CLEAR || y === ENV_GLEN_CLEAR ? lerpEnvState(a, b, t, true) : alt(a, b, t);
      if (JSON.stringify(uebergangsZustand(nm(x), nm(y), f, t)) !== JSON.stringify(soll)) uebergangOk = false;
    }
  }
}
check('uebergangsZustand: Glen pairs blend the direction, every other pair is the old behaviour (12 pairs x 3 times x 5 steps)', uebergangOk);
check('Glen at half blend: the direction is not the target\'s (so the mix really happens)',
  gl(uebergangsZustand(nm('Clear'), glenEnv, 0.5, 0.5).sunDir, nach.sunDir) > 0.5);
// mischtRichtung over every ordered pair of ENVIRONMENTS: yes exactly when one end is Glen clear
let paare = 0;
let paarOk = true;
for (const x of ENVIRONMENTS) {
  for (const y of ENVIRONMENTS) {
    paare++;
    if (mischtRichtung(x, y) !== (x.name === ENV_GLEN_CLEAR || y.name === ENV_GLEN_CLEAR)) paarOk = false;
  }
}
check('mischtRichtung over ENVIRONMENTS x ENVIRONMENTS: yes exactly when Glen clear is one end', paarOk && paare === ENVIRONMENTS.length ** 2 && paare > 1500, String(paare));
// the frame state: no fade = the weather alone; fade = uebergangsZustand (direct, every step)
let frameOk = true;
for (const [x, y] of [...PAARE, ['Clear', ENV_GLEN_CLEAR], [ENV_GLEN_CLEAR, 'Rain']] as [string, string][]) {
  for (const f of [0.2, 0.5]) {
    for (const t of [0, 0.5, 1]) {
      if (JSON.stringify(frameZustand(nm(y), nm(x), f, t)) !== JSON.stringify(uebergangsZustand(nm(x), nm(y), f, t))) frameOk = false;
    }
    if (JSON.stringify(frameZustand(nm(y), null, f, 0.3)) !== JSON.stringify(evaluateEnv(nm(y), f))) frameOk = false;
  }
}
check('frameZustand: without a fade the weather alone, with a fade uebergangsZustand(prev, env) (10 pairs)', frameOk);
const lichtQuelle = readFileSync(new URL('../../client/src/engine/Lighting.ts', import.meta.url), 'utf-8');
check('Lighting.apply takes its state from frameSchritt only, and lerpEnvState is called in exactly one place besides its definition',
  (lichtQuelle.match(/frameSchritt\(/g) ?? []).length === 2
  && (lichtQuelle.match(/lerpEnvState\(/g) ?? []).length === 2 && (lichtQuelle.match(/uebergangsZustand\(/g) ?? []).length === 2
  && (lichtQuelle.match(/frameZustand\(/g) ?? []).length === 2
  && (lichtQuelle.match(/evaluateEnv\(/g) ?? []).length === 4
  && /const schritt = frameSchritt\(this\.env, this\.prevEnv, this\.timeOfDay, this\.blend, dtSeconds\);/.test(lichtQuelle)
  && /const state = schritt\.state;/.test(lichtQuelle)
  && /this\.blend = schritt\.blend;\s+this\.prevEnv = schritt\.prevEnv;/.test(lichtQuelle));
// one frame of the fade (what Lighting.apply writes): blend advanced first, state taken at the new blend, old weather dropped at the end
const sa = frameSchritt(nm('Clear'), nm('Rain'), 0.5, 0.2, 2); // 2 s of 4 s: blend 0.2 -> 0.7
check('frameSchritt: blend advances by dt / 4 s and the state is the one AT the new blend (not the old one)',
  nah(sa.blend, 0.7, 1e-12) && sa.prevEnv === nm('Rain') && JSON.stringify(sa.state) === JSON.stringify(uebergangsZustand(nm('Rain'), nm('Clear'), 0.5, 0.7))
  && JSON.stringify(sa.state) !== JSON.stringify(uebergangsZustand(nm('Rain'), nm('Clear'), 0.5, 0.2)));
const se = frameSchritt(nm('Clear'), nm('Rain'), 0.5, 0.9, 10); // overshoot: clamped to 1, fade over
check('frameSchritt: at blend 1 the old weather is dropped and the state is the new weather alone', se.blend === 1 && se.prevEnv === null
  && JSON.stringify(se.state) === JSON.stringify(evaluateEnv(nm('Clear'), 0.5)));
const sg = frameSchritt(nm('Clear'), nm('Rain'), 0.5, 0.25, 3); // exactly 1.0 with dt/4 = 0.75
check('frameSchritt: exactly blend 1 already ends the fade (>= 1, not > 1)', sg.blend === 1 && sg.prevEnv === null);
const sk = frameSchritt(nm('Clear'), null, 0.5, 0.3, 5);
check('frameSchritt: without a fade nothing is advanced or dropped', sk.blend === 0.3 && sk.prevEnv === null && JSON.stringify(sk.state) === JSON.stringify(evaluateEnv(nm('Clear'), 0.5)));
const sx = frameSchritt(nm('Misty'), nm('SwampRain'), 0.5, 0, 1);
check('frameSchritt: every field of the state comes from the faded state (sun colour, ambient, fog, intensity, directions)',
  JSON.stringify(sx.state) === JSON.stringify(uebergangsZustand(nm('SwampRain'), nm('Misty'), 0.5, 0.25))
  && JSON.stringify(sx.state.sunColor) !== JSON.stringify(evaluateEnv(nm('Misty'), 0.5).sunColor));
const lighting = readFileSync(new URL('../../client/src/engine/Lighting.ts', import.meta.url), 'utf-8');
check('Lighting: the biome change cross-fades over a positive time', /const ENV_BLEND_SECONDS = [1-9]/.test(lighting) && /Math\.min\(1, blend \+ dtSeconds \/ ENV_BLEND_SECONDS\)/.test(lighting));

if (fehler > 0) {
  console.error(`\n${fehler} FAIL`);
  process.exit(1);
}
console.log('\nbiom-greyglen-wetter: alle Pruefungen gruen');
