/**
 * Bausatz-Datei: Sanitizer, kanonische Ausgabe (`bausatzText`), Version, Grenzen, Reihenfolge, Texte.
 *
 * Lauf: npx tsx shared/test/bausatz-format.ts   (aus shared/)
 */
import { bausatzText, sanitizeBausatz, sanitizeBausatzMitBericht } from '../src/bausatz/sanitize.js';
import { BAUSATZ_TEILE_MAX } from '../src/bausatz/types.js';

let fehler = 0;
function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const teil = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  prefab: 'house_a',
  dx: 1.23456,
  dz: -2,
  yaw: 0.1234567891,
  scale: 1,
  ...extra,
});
const datei = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  bausatzVersion: 1,
  id: 'village1',
  name: 'Größe Schmiede — Dorf  Ost',
  grundflaeche: { halbX: 30, halbZ: 20.0004 },
  teile: [teil('b'), teil('a', { scale: [1, -2, 3], dy: 0.5, pitch: 0.2, roll: 0, gruppe: 'g' })],
  gruppen: [{ id: 'g', name: 'Häuser' }],
  ...extra,
});

// Rundlauf und kanonische Ausgabe
const t1 = bausatzText(datei());
const t2 = bausatzText(JSON.parse(t1));
pruefe('Rundlauf: byte-gleich', t1 === t2);
pruefe('Ausgabe endet mit genau einem Zeilenumbruch', t1.endsWith('}\n') && !t1.endsWith('\n\n'));
pruefe('Ausgabe = JSON.stringify(…, null, 2) + Zeilenumbruch', t1 === JSON.stringify(JSON.parse(t1), null, 2) + '\n');
const k = sanitizeBausatz(datei())!;
pruefe('Teile nach id sortiert', k.teile.map((t) => t.id).join() === 'a,b');
pruefe('Schlüsselreihenfolge fest', Object.keys(JSON.parse(t1)).join() === 'bausatzVersion,id,name,grundflaeche,gruppen,teile');
pruefe('Teil-Schlüsselreihenfolge fest', Object.keys(k.teile[0]!).join() === 'id,prefab,dx,dz,dy,yaw,pitch,scale,gruppe', Object.keys(k.teile[0]!).join());
pruefe('Rundung: dx 1e-3, yaw 1e-6', k.teile[1]!.dx === 1.235 && k.teile[1]!.yaw === 0.123457);
pruefe('roll 0 entfällt', k.teile[0]!.roll === undefined);
pruefe('Skala-Tripel negativ bleibt', JSON.stringify(k.teile[0]!.scale) === '[1,-2,3]');

// Reihenfolge der Teile ist egal
const d = datei();
const vertauscht = { ...d, teile: [...(d.teile as unknown[])].reverse() };
pruefe('Vertauschte Teile-Reihenfolge: gleiche Ausgabe', bausatzText(vertauscht) === t1);

// Texte
const name = sanitizeBausatz(JSON.parse(t1))!.name;
pruefe('Umlaute und doppelte Leerzeichen im Namen überstehen den Rundlauf', name === 'Größe Schmiede — Dorf  Ost');

// Version
const v2 = sanitizeBausatzMitBericht(datei({ bausatzVersion: 2 }));
pruefe('Version 2: benannte Meldung', v2.bausatz === null && v2.fehler[0] === 'Bausatz-Version 2 unbekannt (kann 1)', v2.fehler[0]);
const v0 = sanitizeBausatzMitBericht({ ...datei(), bausatzVersion: undefined });
pruefe('Version fehlt: benannte Meldung', v0.bausatz === null && v0.fehler[0] === 'Bausatz-Version fehlt (kann 1)', v0.fehler[0]);

// Grenzen: Meldung, kein Kappen
const viele = Array.from({ length: BAUSATZ_TEILE_MAX + 1 }, (_, i) => teil(`t${i}`));
const r4001 = sanitizeBausatzMitBericht(datei({ teile: viele, gruppen: undefined }));
pruefe('4001 Teile: Meldung, kein Bausatz', r4001.bausatz === null && /4001 Teile/.test(r4001.fehler.join()), r4001.fehler[0]);
const r4000 = sanitizeBausatzMitBericht(datei({ teile: viele.slice(0, BAUSATZ_TEILE_MAX), gruppen: undefined }));
pruefe('4000 Teile: angenommen, alle da', r4000.bausatz?.teile.length === BAUSATZ_TEILE_MAX);

const grenzfaelle: Array<[string, Record<string, unknown>, RegExp]> = [
  ['dx 1001', { teile: [teil('a', { dx: 1001 })] }, /dx außerhalb/],
  ['dy 201', { teile: [teil('a', { dy: 201 })] }, /dy außerhalb/],
  ['yaw 7', { teile: [teil('a', { yaw: 7 })] }, /yaw/],
  ['scale 0', { teile: [teil('a', { scale: 0 })] }, /scale/],
  ['scale 21', { teile: [teil('a', { scale: 21 })] }, /scale/],
  ['scale 0,04', { teile: [teil('a', { scale: -0.04 })] }, /scale/],
  ['Ebnung halbX 0', { ebnung: { halbX: 0, halbZ: 5, boeschung: 4 } }, /ebnung/],
  ['Ebnung Böschung 65', { ebnung: { halbX: 5, halbZ: 5, boeschung: 65 } }, /ebnung/],
  ['doppelte Teil-id', { teile: [teil('a'), teil('a')] }, /doppelt/],
  ['Gruppe unbekannt', { teile: [teil('a', { gruppe: 'x' })] }, /Gruppe/],
  ['fremder Schlüssel', { npc: 1 }, /unbekannter Schlüssel/],
  ['Teil mit npc-Feld', { teile: [teil('a', { npc: 'x' })] }, /unbekannter Schlüssel/],
];
for (const [n, extra, re] of grenzfaelle) {
  const r = sanitizeBausatzMitBericht(datei(extra));
  pruefe(`Grenze ${n}: Meldung`, r.bausatz === null && re.test(r.fehler.join(' | ')), r.fehler[0]);
}
pruefe('id ≠ Dateiname: Meldung', sanitizeBausatzMitBericht(datei(), { erwarteteId: 'anders' }).fehler.length === 1);
pruefe('gültige Ebnung bleibt', sanitizeBausatz(datei({ ebnung: { halbX: 5, halbZ: 500, boeschung: 64 } }))?.ebnung?.halbZ === 500);
pruefe('Skala negativ (Zahl) erlaubt', sanitizeBausatz(datei({ teile: [teil('a', { scale: -1 })] }))?.teile[0]?.scale === -1);
pruefe('kein Objekt: Meldung, kein Wurf', sanitizeBausatz(null) === null && sanitizeBausatz([]) === null);
let geworfen = false;
try {
  bausatzText({});
} catch {
  geworfen = true;
}
pruefe('bausatzText wirft bei ungültigem Bausatz', geworfen);

console.log(fehler === 0 ? '\nalle grün' : `\n${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
