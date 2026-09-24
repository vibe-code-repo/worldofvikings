/**
 * Nachbesserung der Integration:
 *  - B3: Hüllen aus den Manifest-Maßen (Felsblock1..3) — kein Befund „keine Hülle bekannt“ mehr,
 *  - F3: Frist INNERHALB einer Rasterzelle und Befundkappe der Überlappungsprüfung.
 *
 * Lauf: npx tsx shared/test/weltbau-nachbesserung.ts   (aus shared/)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { PlacementDef, WorldLayout } from '../src/worldlayout/types.js';
import { pruefeWelt, type HoehenFeld } from '../src/weltbau/pruefungen.js';
import { huellenAufloeser, type Huelle, type HuellenAufloeser } from '../src/weltbau/huelle.js';
import { leseManifest, manifestHuellen } from '../src/weltbau/manifest.js';
import { BEFUNDE_JE_PRUEFUNG_MAX } from '../src/weltbau/grenzen.js';

let fehler = 0;
function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const flach: HoehenFeld = { getHeight: () => 40 };
const welt = (placements: PlacementDef[]): WorldLayout =>
  ({ version: 1, name: 'n', detailSeed: 't', continents: [], regions: [], placements, routes: [], defaultSpawn: [0, 0] }) as unknown as WorldLayout;
const pl = (id: string, prefab: string, x: number, z: number): PlacementDef => ({ id, prefab, x, z });
const BEREICH = { minX: -50, minZ: -50, maxX: 50, maxZ: 50 };

// ── B3: Manifest-Hüllen ────────────────────────────────────────────────────
const manifestPfad = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/manifest.json');
const manifest = leseManifest(readFileSync(manifestPfad, 'utf-8'));
const FELSEN = ['Felsblock1', 'Felsblock2', 'Felsblock3'];
const ohne = huellenAufloeser();
const mit = huellenAufloeser(manifestHuellen(manifest));
pruefe('Standard-Auflösung kennt Felsblock1..3 nicht (Ausgangslage)', FELSEN.every((n) => ohne(n) === null));
pruefe('Manifest-Auflösung liefert eine Hülle für alle drei', FELSEN.every((n) => mit(n) !== null), FELSEN.map((n) => mit(n)?.quelle).join(','));
const f1 = mit('Felsblock1') as Huelle;
const m1 = manifest.get('Felsblock1');
pruefe('Felsblock1: Breite/Tiefe = Manifest-Maß (±1 mm)', m1 !== undefined && Math.abs(f1.halbX * 2 - m1.breite) < 1e-3 && Math.abs(f1.halbZ * 2 - m1.tiefe) < 1e-3, `${(f1.halbX * 2).toFixed(3)} × ${(f1.halbZ * 2).toFixed(3)}`);
pruefe('Manifest-Hülle zählt nie als Haus (Quelle manifest)', FELSEN.every((n) => mit(n)?.quelle === 'manifest'));
pruefe('unbekannter Name bleibt null (nichts erfunden)', mit('Gibt_es_nicht') === null);
const eWelt = welt(FELSEN.map((n, i) => pl(`f${i}`, n, i * 20, 0)));
const eOhne = pruefeWelt(eWelt, flach, BEREICH, { huellen: ohne });
const eMit = pruefeWelt(eWelt, flach, BEREICH, { huellen: mit });
pruefe('ohne Manifest: 3 Befunde „keine Hülle bekannt“ (rot an 05a2762 = Ausgangslage)', eOhne.befunde.filter((b) => b.pruefung === 'huelle').length === 3);
pruefe('mit Manifest: 0 Befunde „keine Hülle bekannt“, nichtPruefbar leer', eMit.befunde.every((b) => b.pruefung !== 'huelle') && eMit.nichtPruefbar.length === 0, JSON.stringify(eMit.nichtPruefbar));
const fest2 = manifestHuellen(new Map([['T', { breite: 4, hoehe: 2, tiefe: 6 }]]))('T');
pruefe('ohne Hüllbox: zentrierte Box aus Breite/Tiefe/Höhe', fest2 !== null && fest2.halbX === 2 && fest2.halbZ === 3 && fest2.maxY === 2 && fest2.mitteX === 0);

// ── F3: Frist in der Zelle + Befundkappe ───────────────────────────────────
const box: Huelle = { fest: true, mitteX: 0, mitteZ: 0, halbX: 0.5, halbZ: 0.5, minY: 0, maxY: 1, gebaeude: false, quelle: 'extern' };
const klein: Huelle = { ...box, halbX: 0.1, halbZ: 0.1 };
const dicht: HuellenAufloeser = () => box;

// (a) Kappe: 2000 dichte feste Objekte, alle überlappen einander (~2 Mio. Paare), Frist 500 ms.
const dichteObjekte = Array.from({ length: 2000 }, (_, i) => pl(`d${i}`, 'T', 1 + (i % 10) * 0.05, 1 + Math.floor(i / 10) * 0.005));
const t0 = performance.now();
const a = pruefeWelt(welt(dichteObjekte), flach, BEREICH, { huellen: dicht, pruefungen: ['ueberlappung'], frist: 500 });
const dauerA = performance.now() - t0;
const stA = a.pruefstatus.ueberlappung;
const nUeb = a.befunde.filter((b) => b.pruefung === 'ueberlappung').length;
pruefe('dicht: teilweise=true, Prüfung „abgebrochen“', a.teilweise === true && stA?.status === 'abgebrochen', JSON.stringify(stA));
pruefe(`dicht: Befunde der Prüfung ≤ Kappe (${BEFUNDE_JE_PRUEFUNG_MAX}), Ausgabe ≤ 200 + frist-Befund`, nUeb <= BEFUNDE_JE_PRUEFUNG_MAX && a.befunde.length <= 201, `${nUeb} / ${a.befunde.length}`);
pruefe('dicht: Ampel nicht grün', a.ampel !== 'gruen', a.ampel);
pruefe('dicht: Hinweis nennt die Kappe und zählt ungeprüfte Paare', /weitere Befunde gekappt/.test(stA?.grund ?? '') && /\d+ Paare ungeprüft/.test(stA?.grund ?? '') && /gekappt/.test(a.hinweis ?? ''), stA?.grund);
pruefe('dicht: Laufzeit weit unter der alten 2,6 s bei Frist 500', dauerA < 2000, `${Math.round(dauerA)} ms`);

// (b) Frist innerhalb EINER Zelle: viele kleine, sich NICHT überlappende Objekte in einer 16-m-Zelle,
// eine Uhr, die je Ablesung 1 ms weiterläuft. Vorher wurde die Uhr nie innerhalb der Zelle gelesen.
const raster = Array.from({ length: 1500 }, (_, i) => pl(`r${i}`, 'T', 1 + (i % 39) * 0.35, 1 + Math.floor(i / 39) * 0.35));
let ablesungen = 0;
const uhr = (): number => ablesungen++;
const b = pruefeWelt(welt(raster), flach, BEREICH, { huellen: () => klein, pruefungen: ['ueberlappung'], frist: 100, uhr });
const stB = b.pruefstatus.ueberlappung;
pruefe('Zelle: Frist greift innerhalb der Zelle (abgebrochen, „Frist abgelaufen“)', stB?.status === 'abgebrochen' && /^Frist abgelaufen/.test(stB.grund ?? ''), JSON.stringify(stB));
pruefe('Zelle: begonnene Zelle zählt nicht als geprüft (0 von 1)', stB?.geprueft === 0 && stB?.gesamt >= 1, `${stB?.geprueft}/${stB?.gesamt}`);
pruefe('Zelle: Uhr wurde nur wenige hundert Mal gelesen (Abbruch, nicht 1,1 Mio. Paare)', ablesungen < 1000, `${ablesungen} Ablesungen`);
pruefe('Zelle: teilweise=true, Ampel nicht grün, frist-Befund vorhanden', b.teilweise && b.ampel !== 'gruen' && b.befunde.some((x) => x.pruefung === 'frist'));

// (c) Unverändert: normale Fälle vollständig
const c = pruefeWelt(welt([pl('a', 'T', 0, 0), pl('b', 'T', 5, 0)]), flach, BEREICH, { huellen: dicht, pruefungen: ['ueberlappung'] });
pruefe('normal: zwei getrennte Objekte, vollständig, 0 Befunde, grün', c.pruefstatus.ueberlappung?.status === 'vollstaendig' && !c.teilweise && c.befunde.length === 0 && c.ampel === 'gruen');
const d = pruefeWelt(welt([pl('a', 'T', 0, 0), pl('b', 'T', 0.3, 0)]), flach, BEREICH, { huellen: dicht, pruefungen: ['ueberlappung'] });
pruefe('normal: eine echte Überlappung wird gefunden, vollständig', d.befunde.length === 1 && d.pruefstatus.ueberlappung?.status === 'vollstaendig' && d.pruefstatus.ueberlappung.grund === undefined);

console.log(`\n${fehler === 0 ? 'ALLE GRUEN' : `${fehler} FEHLGESCHLAGEN`}`);
process.exit(fehler > 0 ? 1 : 0);
