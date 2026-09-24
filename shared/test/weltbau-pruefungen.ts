/**
 * world_check: eine präparierte Testwelt mit sechs eingebauten Fehlern (je
 * Prüfart einer) und ihre fehlerfreie Gegenfassung.
 *
 * Erwartet: alle sechs Fehler werden mit Koordinate gefunden (rot, höchstens
 * 2 m neben der Sollstelle), die saubere Welt liefert 0 Befunde. Die Geo ist
 * eine feste Attrappe (ebener Boden, ein Teich, ein 40°-Hang) und die Hüllen
 * kommen aus einer festen Tabelle — so misst der Test die Prüfungen und nicht
 * die Geländeerzeugung.
 *
 * Lauf: npx tsx shared/test/weltbau-pruefungen.ts   (aus shared/)
 */
import type { PlacementDef, RouteDef, WorldLayout } from '../src/worldlayout/types.js';
import { WATER_LEVEL } from '../src/worldgen/Heightmap.js';
import {
  BereichFehler,
  normalisiereBereich,
  pruefeWelt,
  type Befund,
  type CheckErgebnis,
  type HoehenFeld,
} from '../src/weltbau/pruefungen.js';
import { huellenAufloeser, istHaus, type Huelle, type HuellenAufloeser } from '../src/weltbau/huelle.js';
import type { EingangsTabelle } from '../src/weltbau/eingaenge.js';
import { STORE_KATALOG_NACH_PREFAB } from '../src/storeKatalogDaten.js';

let fehler = 0;
function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── Attrappen ──────────────────────────────────────────────────────────────

const TAN40 = Math.tan((40 * Math.PI) / 180);
/** Ebener Boden auf 40 m, ein Teich bei (100, 100) r=10 auf 20 m, ab x = 200 ein 40°-Hang. */
const geo: HoehenFeld = {
  getHeight(x, z) {
    if (Math.hypot(x - 100, z - 100) < 10) return 20;
    return 40 + Math.max(0, x - 200) * TAN40;
  },
};

const fest = (halbX: number, halbZ: number, hoehe: number): Huelle => ({
  fest: true,
  mitteX: 0,
  mitteZ: 0,
  halbX,
  halbZ,
  minY: 0,
  maxY: hoehe,
  gebaeude: false,
  quelle: 'extern',
});
const TABELLE: Record<string, Huelle> = {
  T_Haus: fest(5, 4, 6),
  T_Fels: { ...fest(1.5, 1.5, 3), quelle: 'store-huelle' }, // ein Store-Fels: fest, aber kein Haus
  T_Kiste: { ...fest(0.5, 0.5, 1), fest: false },
};
const huellen: HuellenAufloeser = (name) => TABELLE[name] ?? null;
/** Die Tür von T_Haus: 5 m vor der Mitte auf der −z-Seite (die Kante liegt bei 4 m). */
const eingaenge: EingangsTabelle = new Map([['T_Haus', [{ x: 0, z: -5 }]]]);

const pl = (id: string, prefab: string, x: number, z: number, extra: Partial<PlacementDef> = {}): PlacementDef => ({
  id,
  prefab,
  x,
  z,
  ...extra,
});

function kisten(prefix: string, anzahl: number, x0: number, z0: number): PlacementDef[] {
  const aus: PlacementDef[] = [];
  for (let i = 0; i < anzahl; i++) aus.push(pl(`${prefix}-${i}`, 'T_Kiste', x0 + (i % 9) * 6, z0 + Math.floor(i / 9) * 6));
  return aus;
}

function welt(placements: PlacementDef[], routes: RouteDef[]): WorldLayout {
  return {
    version: 1,
    name: 'pruefwelt',
    detailSeed: 't',
    continents: [],
    regions: [],
    placements,
    routes,
    defaultSpawn: [0, -40],
  } as unknown as WorldLayout;
}

/** Sechs Fehler, je Prüfart einer. */
const FEHLERWELT = welt(
  [
    pl('h1', 'T_Haus', 0, 0),
    pl('h2', 'T_Haus', 5, 0), // 1: 50 % Überlappung mit h1
    pl('kiste-nass', 'T_Kiste', 100, 100), // 2: im Teich
    pl('h-hang', 'T_Haus', 220, 0), // 3: 40°-Hang
    pl('h-zu', 'T_Haus', -100, 0), // 4: Türen zugestellt
    pl('f1', 'T_Fels', -107, 0),
    pl('f2', 'T_Fels', -93, 0),
    pl('f3', 'T_Fels', -100, 6),
    pl('f4', 'T_Fels', -100, -6),
    pl('h-weg', 'T_Haus', 0, 60), // 5: die Route läuft hindurch
    ...kisten('k', 81, 132, 68), // 6: 81 Objekte in Zone (2, 1)
  ],
  [{ id: 'weg', points: [[-30, 60], [30, 60]], mode: 'pingpong' }]
);

/** Dieselbe Insel ohne die sechs Fehler. */
const SAUBERE_WELT = welt(
  [
    pl('h1', 'T_Haus', 0, 0),
    pl('h2', 'T_Haus', 20, 0),
    pl('kiste-nass', 'T_Kiste', 60, 100),
    pl('h-hang', 'T_Haus', 180, 0),
    pl('h-zu', 'T_Haus', -100, 0),
    pl('h-weg', 'T_Haus', 0, 60),
    ...kisten('k', 40, 132, 68),
  ],
  [{ id: 'weg', points: [[-30, 75], [30, 75]], mode: 'pingpong' }]
);

const BEREICH = { minX: -150, minZ: -60, maxX: 260, maxZ: 120 };
const lauf = (l: WorldLayout, extra = {}): CheckErgebnis =>
  pruefeWelt(l, geo, BEREICH, { huellen, eingaenge, ...extra });
const finde = (e: CheckErgebnis, art: string, schwere: string, x: number, z: number, tol = 2): Befund | undefined =>
  e.befunde.find((b) => b.pruefung === art && b.schwere === schwere && Math.hypot(b.x - x, b.z - z) <= tol);

// ── Fehlerwelt: 6/6 ────────────────────────────────────────────────────────

const e = lauf(FEHLERWELT);
console.log(`Fehlerwelt: ${e.ampel}, ${e.zaehler.rot} rot, ${e.zaehler.gelb} gelb, ${e.objekte} Objekte`);
if (process.env.ZEIGE) console.log(JSON.stringify(e.befunde.filter((b) => b.schwere !== 'rot').map((b) => [b.pruefung, b.x, b.z, b.text])));
const sollen: Array<[string, string, number, number]> = [
  ['ueberlappung', 'zwei Häuser zu 50 % überlappt', 2.5, 0],
  ['wasser', 'Truhe im Teich', 100, 100],
  ['hang', 'Haus am 40°-Hang', 220, 0],
  ['eingang', 'Haus mit zugestellten Türen', -100, 0],
  ['route', 'Route durch ein Haus', -5.4, 60],
  ['budget', 'Zone mit 81 Objekten', 160, 96],
];
let gefunden = 0;
for (const [art, name, x, z] of sollen) {
  const b = finde(e, art, 'rot', x, z);
  if (b) gefunden++;
  pruefe(`Fehler gefunden (${art}): ${name}`, b !== undefined, b ? `bei (${b.x}, ${b.z}), ids ${b.ids.join(',')}` : 'kein roter Befund an der Sollstelle');
}
pruefe('6 von 6 Fehlern gefunden', gefunden === 6, `${gefunden}/6`);
pruefe('Ampel rot', e.ampel === 'rot');
pruefe('Überlappung nennt beide Häuser', finde(e, 'ueberlappung', 'rot', 2.5, 0)?.ids.sort().join(',') === 'h1,h2');
pruefe('Überlappungsanteil 0,5', finde(e, 'ueberlappung', 'rot', 2.5, 0)?.wert === 0.5);
pruefe('Fels neben dem Haus zählt nicht als Überlappung', !e.befunde.some((b) => b.pruefung === 'ueberlappung' && b.ids.includes('f1')));
pruefe('Route nennt Route und Haus', finde(e, 'route', 'rot', -5.4, 60)?.ids.join(',') === 'weg,h-weg');
pruefe('Budget nennt die Zahl 81', finde(e, 'budget', 'rot', 160, 96)?.wert === 81);
pruefe('Hang: Höhenspanne rot und Neigung gelb am selben Haus',
  finde(e, 'hang', 'rot', 220, 0)?.grenze === 1.5 && finde(e, 'hang', 'gelb', 220, 0)?.grenze === 30);
pruefe('Befunde nach Schwere sortiert', e.befunde.every((b, i, l) => i === 0 || ['rot', 'gelb', 'hinweis'].indexOf(l[i - 1].schwere) <= ['rot', 'gelb', 'hinweis'].indexOf(b.schwere)));

// ── Saubere Welt: 0 Fehlalarme ─────────────────────────────────────────────

const sauber = lauf(SAUBERE_WELT);
pruefe('saubere Welt: 0 Befunde', sauber.befunde.length === 0, JSON.stringify(sauber.befunde));
pruefe('saubere Welt: Ampel grün, 0 rot, 0 gelb', sauber.ampel === 'gruen' && sauber.zaehler.rot === 0 && sauber.zaehler.gelb === 0);
pruefe('saubere Welt: alle Objekte im Bereich gezählt', sauber.objekte === 46, `${sauber.objekte}`);

// ── Verhalten im Einzelnen ─────────────────────────────────────────────────

const ohneMs = (x: CheckErgebnis): string => JSON.stringify({ ...x, ms: 0 });
pruefe('Determinismus: zwei Läufe sind gleich (bis auf die Zeit)', ohneMs(lauf(FEHLERWELT)) === ohneMs(e));
const nurWasser = lauf(FEHLERWELT, { pruefungen: ['wasser'] });
pruefe('pruefungen: nur wasser', nurWasser.befunde.every((b) => b.pruefung === 'wasser') && nurWasser.befunde.length === 1);
const lockerer = lauf(FEHLERWELT, { pruefungen: ['hang'], grenzen: { hangGradRot: 50, spanneRot: 99, spanneGelb: 99 } });
pruefe('grenzen überschreibbar: Hang 40° bei Grenze 50° nur noch gelb', lockerer.befunde.length === 1 && lockerer.befunde[0].schwere === 'gelb');

const ohneTuer = lauf(SAUBERE_WELT, { eingaenge: new Map() });
pruefe('Haus ohne Türangabe: „Eingang geschätzt“ gelb, nie rot', ohneTuer.befunde.filter((b) => b.pruefung === 'eingang').length === 5 &&
  ohneTuer.befunde.every((b) => b.pruefung !== 'eingang' || b.schwere === 'gelb'));

let vonFehler = '';
try {
  pruefeWelt(SAUBERE_WELT, geo, BEREICH, { huellen, eingaenge, von: [100, 100] });
} catch (f) {
  vonFehler = f instanceof BereichFehler ? f.message : 'falscher Fehlertyp';
}
pruefe('von im Wasser: Fehler mit Koordinate', vonFehler.includes('(100, 100)'), vonFehler);

const unbekannt = pruefeWelt(welt([pl('u', 'Unbekannt_X', 0, 0)], []), geo, BEREICH, { huellen });
pruefe('unbekanntes Prefab: ein gelber Befund, nichts erfunden',
  unbekannt.befunde.length === 1 && unbekannt.befunde[0].pruefung === 'huelle' && unbekannt.nichtPruefbar.join() === 'Unbekannt_X');

const steg = pruefeWelt(welt([pl('s', 'T_Steg', 100, 100)], []), geo, BEREICH, { huellen: () => fest(1, 3, 0.5) });
pruefe('Steg im Wasser: nur Hinweis', steg.befunde.length === 1 && steg.befunde[0].schwere === 'hinweis' && steg.ampel === 'gruen');

const ufer = pruefeWelt(welt([pl('t', 'T_Haus', 112, 100)], []), geo, BEREICH, { huellen, pruefungen: ['wasser'] });
pruefe('Uferlage: Ursprung trocken, Ecke nass → gelb', ufer.befunde.length === 1 && ufer.befunde[0].schwere === 'gelb');

const tief = pruefeWelt(
  welt([pl('a', 'T_Haus', 0, 0, { yaw: Math.PI / 4 }), pl('b', 'T_Haus', 4.24, 0, { yaw: Math.PI / 4 })], []),
  geo, BEREICH, { huellen, pruefungen: ['ueberlappung'] });
pruefe('gedrehte Häuser (45°) werden als Rechtecke verschnitten', tief.befunde.length === 1 && tief.befunde[0].schwere === 'rot', JSON.stringify(tief.befunde.map((b) => b.wert)));

const gelbUeberlapp = pruefeWelt(welt([pl('a', 'T_Haus', 0, 0), pl('b', 'T_Haus', 9.4, 0)], []), geo, BEREICH, { huellen, pruefungen: ['ueberlappung'] });
pruefe('kleine Überlappung (5 %) gelb', gelbUeberlapp.befunde.length === 1 && gelbUeberlapp.befunde[0].schwere === 'gelb', JSON.stringify(gelbUeberlapp.befunde.map((b) => b.wert)));
const beruehrung = pruefeWelt(welt([pl('a', 'T_Haus', 0, 0), pl('b', 'T_Haus', 10, 0)], []), geo, BEREICH, { huellen, pruefungen: ['ueberlappung'] });
pruefe('Berührung ohne Überschneidung: kein Befund', beruehrung.befunde.length === 0);

const skaliert = pruefeWelt(welt([pl('a', 'T_Haus', 0, 0, { scale: 2 }), pl('b', 'T_Haus', 12, 0)], []), geo, BEREICH, { huellen, pruefungen: ['ueberlappung'] });
pruefe('Skalierung verändert die Grundfläche', skaliert.befunde.length === 1);

// Bereichsgrenzen
for (const [name, b] of [
  ['513 m Kante', { minX: 0, minZ: 0, maxX: 513, maxZ: 10 }],
  ['Radius 0', { x: 0, z: 0, radius: 0 }],
  ['NaN', { x: Number.NaN, z: 0, radius: 5 }],
  ['umgekehrt', { minX: 10, minZ: 0, maxX: 0, maxZ: 10 }],
] as const) {
  let aus = '';
  try {
    normalisiereBereich(b);
  } catch (f) {
    aus = f instanceof BereichFehler ? f.message : 'falscher Fehlertyp';
  }
  pruefe(`Bereich abgelehnt: ${name}`, aus.startsWith('Bereich'), aus);
}
pruefe('512 m Kante gilt', normalisiereBereich({ minX: 0, minZ: 0, maxX: 512, maxZ: 10 }).kasten.maxX === 512);
pruefe('Kreisbereich: Objekt außerhalb des Kreises, aber im Quadrat, zählt nicht',
  pruefeWelt(welt([pl('r', 'T_Kiste', 9, 9)], []), geo, { x: 0, z: 0, radius: 10 }, { huellen }).objekte === 0);

// Ausgabegrenze
const viele = pruefeWelt(welt(Array.from({ length: 250 }, (_, i) => pl(`w${i}`, 'T_Kiste', 100 + (i % 5) - 2, 100 + Math.floor(i / 5) * 0.01)), []), geo,
  { x: 100, z: 100, radius: 10 }, { huellen, pruefungen: ['wasser'] });
pruefe('Befunde auf 200 begrenzt, Rest gezählt', viele.befunde.length === 200 && viele.ausgelassen === 50 && viele.zaehler.rot === 250,
  `${viele.befunde.length} + ${viele.ausgelassen}`);

// ── N1: Laufzeitbremse (F1) und von ohne Haus (F2) ─────────────────────────

pruefe('normaler Lauf: vollständig, kein Teilbericht, Zeit gemeldet',
  sauber.teilweise === false && sauber.hinweis === undefined && typeof sauber.ms === 'number' && sauber.frist === 15000 &&
  Object.values(sauber.pruefstatus).every((st) => st?.status === 'vollstaendig') && Object.keys(sauber.pruefstatus).length === 6,
  JSON.stringify(sauber.pruefstatus));
pruefe('Fehlerwelt bleibt vollständig 6/6 (Bremse ändert nichts)', e.teilweise === false && gefunden === 6);

// Angreifer-Eingabe 1: eine Route mit 512 Punkten, jede Strecke 500 m quer durch den Bereich
const zickzack = (id: string, n: number): RouteDef => ({
  id,
  points: Array.from({ length: n }, (_, i) => [i % 2 === 0 ? -250 : 250, (i % 7) - 3] as [number, number]),
  mode: 'pingpong',
});
const flach: HoehenFeld = { getHeight: () => 40 };
const b512 = { minX: -256, minZ: -256, maxX: 256, maxZ: 256 };
let t0 = performance.now();
const r512 = pruefeWelt(welt([], [zickzack('z1', 512)]), flach, b512, { huellen, pruefungen: ['route'] });
let dauer = performance.now() - t0;
pruefe('512-Punkt-Route endet in ≤ 15 s', dauer <= 15000 && r512.ms <= 15500, `${Math.round(dauer)} ms`);
pruefe('512-Punkt-Route: vollständig oder klarer Teilbericht mit Zahlen',
  r512.pruefstatus.route?.status === 'vollstaendig' || (r512.teilweise && (r512.hinweis ?? '').includes('Bereich verkleinern') && r512.pruefstatus.route !== undefined),
  JSON.stringify(r512.pruefstatus.route));

// Angreifer-Eingabe 2: 256 solche Routen
const routen256 = Array.from({ length: 256 }, (_, i) => zickzack(`z${i}`, 512));
t0 = performance.now();
const r256 = pruefeWelt(welt([], routen256), flach, b512, { huellen, pruefungen: ['route'] });
dauer = performance.now() - t0;
const st256 = r256.pruefstatus.route;
pruefe('256 Routen à 512 Punkte enden in ≤ 15 s', dauer <= 15000, `${Math.round(dauer)} ms`);
pruefe('256 Routen: Teilbericht, abgebrochen, nicht alle Routen geprüft, Zahlen im Bericht',
  r256.teilweise && st256?.status === 'abgebrochen' && st256.geprueft < 256 && st256.gesamt === 256 && (st256.grund ?? '').startsWith('Kappe'),
  JSON.stringify(st256));
pruefe('256 Routen: Hinweis nennt Zeit, Frist und „Bereich verkleinern“, Ampel nicht grün',
  (r256.hinweis ?? '').includes('TEILBERICHT') && (r256.hinweis ?? '').includes('Bereich verkleinern') && r256.ampel !== 'gruen' &&
  r256.befunde.some((b) => b.pruefung === 'frist'), r256.hinweis ?? '');

// Eine Strecke außerhalb des Bereichs kostet nichts: nur der Ausschnitt wird abgetastet
const lang = pruefeWelt(welt([], [{ id: 'lang', points: [[-40000, 0], [40000, 0]], mode: 'pingpong' }]), flach, b512, { huellen, pruefungen: ['route'] });
const proben = Number(/\((\d+) Stützpunkte/.exec(lang.pruefstatus.route?.einheit ?? '')?.[1]);
pruefe('80-km-Strecke: nur der Ausschnitt im Bereich wird abgetastet (< 4000 Proben)',
  lang.pruefstatus.route?.status === 'vollstaendig' && proben > 0 && proben < 4000, lang.pruefstatus.route?.einheit);

// Frist mit austauschbarer Uhr: jede Abfrage kostet 1 ms
let takt = 0;
const zeitraffer = (): number => takt++;
takt = 0;
const knapp = pruefeWelt(SAUBERE_WELT, geo, BEREICH, { huellen, eingaenge, frist: 30, uhr: zeitraffer });
pruefe('Frist 30 ms (Zeitraffer): Teilbericht statt Grün',
  knapp.teilweise && knapp.ampel !== 'gruen' && (knapp.hinweis ?? '').includes('TEILBERICHT') && knapp.frist === 30,
  knapp.hinweis ?? '');
pruefe('Frist: jede Prüfung meldet vollständig, abgebrochen oder übersprungen mit Zahlen',
  Object.values(knapp.pruefstatus).every((st) => st !== undefined && ['vollstaendig', 'abgebrochen', 'uebersprungen'].includes(st.status) && st.gesamt >= st.geprueft));
pruefe('Frist: mindestens eine Prüfung ist nicht vollständig gelaufen',
  Object.values(knapp.pruefstatus).some((st) => st?.status !== 'vollstaendig'));

// Kein falsches Rot bei jedem möglichen Abbruchpunkt (die Wegsuche wird nie halb ausgewertet)
let falschRot = 0;
let teilLaeufe = 0;
for (let frist = 0; frist <= 20000; frist += 250) {
  takt = 0;
  const x = pruefeWelt(SAUBERE_WELT, geo, BEREICH, { huellen, eingaenge, frist, uhr: zeitraffer });
  if (x.teilweise) teilLaeufe++;
  falschRot += x.befunde.filter((b) => b.schwere === 'rot').length;
}
pruefe('saubere Welt: bei jedem Abbruchpunkt (81 Fristen) 0 rote Befunde', falschRot === 0 && teilLaeufe > 0, `${teilLaeufe} Teilläufe, ${falschRot} rot`);

// F2: von ohne Haus im Bereich
const nurKisten = welt(kisten('k', 3, 130, 68), []);
const vonOhneHaus = (v: readonly [number, number]): string => {
  try {
    pruefeWelt(nurKisten, geo, BEREICH, { huellen, eingaenge, pruefungen: ['eingang'], von: v });
  } catch (f) {
    return f instanceof BereichFehler ? f.message : 'falscher Fehlertyp';
  }
  return '';
};
pruefe('von im Wasser ohne Haus im Bereich: Fehler mit Koordinate', vonOhneHaus([100, 100]).includes('(100, 100)') && vonOhneHaus([100, 100]).includes('Wasser'), vonOhneHaus([100, 100]));
pruefe('von außerhalb des Bereichs ohne Haus: Fehler', vonOhneHaus([5000, 0]).includes('außerhalb'), vonOhneHaus([5000, 0]));
pruefe('von im festen Körper ohne Haus: Fehler', (() => {
  try {
    pruefeWelt(welt([pl('f', 'T_Fels', 0, 0)], []), geo, BEREICH, { huellen, pruefungen: ['eingang'], von: [0.5, 0] });
  } catch (f) {
    return f instanceof BereichFehler && f.message.includes('festen Körper');
  }
  return false;
})());
pruefe('von gültig ohne Haus: kein Fehler', vonOhneHaus([0, 0]) === '');

// ── Standard-Auflösung gegen den echten Katalog ────────────────────────────

const auf = huellenAufloeser();
pruefe('unbekannter Name: keine Hülle', auf('Gibt_es_nicht') === null);
const gebaeude = [...STORE_KATALOG_NACH_PREFAB.values()].find((k) => k.gruppe === 'Gebäude' && k.bounds !== undefined && auf(k.prefabName as string)?.fest === true);
pruefe('Katalog: ein Gebäude-Bausatzteil liefert eine feste Hülle', gebaeude !== undefined && auf(gebaeude.prefabName as string)?.gebaeude === true);
if (gebaeude) {
  const h = auf(gebaeude.prefabName as string) as Huelle;
  const b = gebaeude.bounds as NonNullable<typeof gebaeude.bounds>;
  pruefe('Katalog: Weltraum-Hülle spiegelt x (Mitte x = −(min+max)/2)', Math.abs(h.mitteX + (b.min[0] + b.max[0]) / 2) < 1e-9 || h.quelle === 'store-kollisionskiste', h.quelle);
  pruefe('Katalog: zweiter Aufruf liefert dasselbe Objekt (Zwischenspeicher)', auf(gebaeude.prefabName as string) === h);
}
pruefe('istHaus: 10×8×6 ja, 3×3×2 nein, Store-Fels 3×3×3 nein', istHaus(TABELLE.T_Haus) && !istHaus(fest(1.5, 1.5, 2)) && !istHaus(TABELLE.T_Fels));
pruefe('WATER_LEVEL im Test = 30', WATER_LEVEL === 30);

console.log(`\n${fehler === 0 ? 'ALLE GRUEN' : `${fehler} FEHLGESCHLAGEN`}`);
process.exit(fehler > 0 ? 1 : 0);
