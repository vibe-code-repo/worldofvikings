/**
 * Prüft die Store-Labor-Pflanzen (Blumen, Farn): dass die eingecheckte
 * Messliste `tools/store-lab-katalog.json`, die erzeugte Registry und die
 * Übersetzungen zusammenpassen, und dass `store-pflanzen-quellen.mjs` aus
 * einer Export-GLB das Verlangte baut (Material, Alpha MASK, zweiseitig,
 * Bild unverändert daneben, Geometrie unberührt).
 *
 * Dazu die Strenge des Werkzeugs: Eine abgeschnittene oder beschädigte
 * Ausgangsdatei wird übersprungen (nie gebaut), die eingecheckte Liste
 * wird im Normallauf NIE geschrieben, nur verglichen, und kein Fehlerfall
 * bricht den Lauf ab. Die Form der Liste (Hash- und Grössenfelder) ist
 * auch ohne Assets festgelegt.
 *
 * Läuft ohne Assets (auch im CI): Die Liste ist eingecheckt, alle Proben
 * bauen sich ihre Dateien selbst.
 *
 *   npx tsx tools/test/store-lab-katalog.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_PREFAB_DEFS } from '@wov/shared';
import { STORE_KATALOG_NACH_ID } from '@wov/shared/src/storeKatalogDaten.js';
import { repoText } from '@wov/shared/src/texte.js';
// @ts-expect-error — .mjs ohne Typen
import { MATERIALNAMEN, MODELLE, glbLesen, pflanzenHolen, pngPruefen, umbauen } from '../store-pflanzen-quellen.mjs';
// @ts-expect-error — .mjs ohne Typen
import { exportGlb, pngKlein } from '../lib/pflanzen-probe.mjs';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

interface LabEintrag {
  id: string;
  pfad: string;
  prefab: string;
  textKey: string;
  bytes: number;
  hash: string;
  bounds: { min: number[]; max: number[] };
  dreiecke: number;
  material: string;
  alphaModus: string;
  zweiseitig: boolean;
  textur: { datei: string; bytes: number; hash: string };
}
const liste = JSON.parse(readFileSync(join(WURZEL, 'tools/store-lab-katalog.json'), 'utf8')) as {
  eintraege: LabEintrag[];
};

// ── Die Liste deckt genau die Modelle des Werkzeugs ──────────────────
const erwartet = (MODELLE as { id: string }[]).map((m) => `vegetation/${m.id}`).sort();
check(
  'Messliste führt genau die drei Modelle des Werkzeugs',
  JSON.stringify(liste.eintraege.map((e) => e.id).sort()) === JSON.stringify(erwartet),
  liste.eintraege.map((e) => e.id).join(', ')
);

// ── Je Eintrag: Registry, Katalog, Übersetzung ───────────────────────
for (const e of liste.eintraege) {
  const def = STORE_PREFAB_DEFS.find((d) => d.name === e.prefab);
  check(`${e.prefab}: Prefab ist registriert`, def !== undefined);
  check(
    `${e.prefab}: Modellpfad zeigt ins Labor`,
    def?.model === `store-lab/${e.pfad.replace(/\.glb$/, '')}`,
    String(def?.model)
  );
  const k = STORE_KATALOG_NACH_ID.get(e.id);
  check(`${e.id}: Katalogeintrag vorhanden`, k !== undefined);
  check(`${e.id}: Katalog trägt Hash und Grösse der Liste`, k?.hash === e.hash && k?.bytes === e.bytes);
  check(
    `${e.id}: Katalog trägt die Hüllbox der Liste`,
    JSON.stringify(k?.bounds) === JSON.stringify(e.bounds)
  );
  check(`${e.id}: Katalog verweist auf das Prefab`, k?.prefabName === e.prefab);
  check(`${e.id}: Lizenzstatus intern`, k?.lizenzstatus === 'intern');
  check(`${e.id}: Alpha MASK und zweiseitig`, e.alphaModus === 'MASK' && e.zweiseitig === true);
  check(`${e.id}: Materialrolle steht in der Tabelle`, Object.values(MATERIALNAMEN as Record<string, { rolle: string }>).some((m) => m.rolle === e.material));

  const de = repoText(e.textKey, 'de');
  const en = repoText(e.textKey, 'en');
  check(`${e.textKey}: deutscher Text`, typeof de === 'string' && de.length > 0);
  check(`${e.textKey}: englischer Text`, typeof en === 'string' && en.length > 0);
  check(`${e.textKey}: Sprachen unterscheiden sich`, de !== en, `${String(de)} / ${String(en)}`);
  check(`${e.textKey}: Schlüssel gehört zum Prefab`, e.textKey === `inhalt.prefab.${e.prefab.replace(/-/g, "_")}`);
  check(`${e.id}: Texturdatei liegt neben dem Modell`, /^textures\/[a-z0-9-]+\.png$/.test(e.textur.datei));
  // Form der Liste, ohne Assets prüfbar: Hash-Präfix, volle Länge, positive Grössen.
  check(`${e.id}: Hash hat die Form sha256-<64 Hex>`, /^sha256-[0-9a-f]{64}$/.test(e.hash) && /^sha256-[0-9a-f]{64}$/.test(e.textur.hash));
  check(`${e.id}: Grössen sind ganze positive Zahlen`, Number.isInteger(e.bytes) && e.bytes > 0 && Number.isInteger(e.textur.bytes) && e.textur.bytes > 0 && Number.isInteger(e.dreiecke) && e.dreiecke > 0);
  check(`${e.id}: Texturname trägt die ersten 8 Hex des Textur-Hashs`, e.textur.datei === `textures/${e.material}-${e.textur.hash.slice(7, 15)}.png`, e.textur.datei);
}

// ── Umbau-Probe mit einer selbstgebauten Export-GLB ──────────────────
const probeGlb: Buffer = exportGlb('Flowers_A 1', 1);
const probePng: Buffer = pngKlein(1);
const r = umbauen(probeGlb, 'flower-probe', 'probe.glb');
const { json: neu, bin: neuBin } = glbLesen(r.glb);
const mat = neu.materials[0];
check('Umbau: Material heisst nach der Rolle', mat.name === 'blume', mat.name);
check('Umbau: alphaMode MASK', mat.alphaMode === 'MASK');
check('Umbau: zweiseitig', mat.doubleSided === true);
check('Umbau: Cutoff 0,5', mat.alphaCutoff === 0.5);
check('Umbau: Bild als Datei neben dem Modell', /^textures\/blume-[0-9a-f]{8}\.png$/.test(neu.images[0].uri), neu.images[0].uri);
check('Umbau: kein eingebettetes Bild mehr', neu.images[0].bufferView === undefined && neu.bufferViews.length === 2);
check('Umbau: Bildbytes unverändert', r.png.equals(probePng));
check('Umbau: Bildname trägt den Hash der Bildbytes', r.bildName === `blume-${createHash('sha256').update(probePng).digest('hex').slice(0, 8)}`);
check('Umbau: Dreiecke', r.dreiecke === 1);
check('Umbau: Hüllbox aus den Positionen', JSON.stringify(r.huellbox) === JSON.stringify({ min: [0, 0, 0], max: [1, 1, 1] }));
const posNeu = neuBin.subarray(neu.bufferViews[neu.accessors[0].bufferView].byteOffset, neu.bufferViews[neu.accessors[0].bufferView].byteOffset + 36);
check('Umbau: Geometrie bitgleich', posNeu.length === 36 && posNeu.readFloatLE(12) === 1);
const idxView = neu.bufferViews[neu.accessors[1].bufferView];
check(
  'Umbau: Indexaccessor zeigt auf seinen (verschobenen) bufferView',
  idxView?.byteLength === 6 && neuBin.readUInt16LE(idxView.byteOffset + 2) === 1 && neuBin.readUInt16LE(idxView.byteOffset + 4) === 2,
  JSON.stringify(neu.accessors[1])
);
check('Umbau: Wurzelknoten trägt die Kennung', neu.nodes[neu.scenes[0].nodes[0]].name === 'flower-probe', JSON.stringify(neu.nodes));
check('Umbau: zweiter Lauf byteidentisch', umbauen(probeGlb, 'flower-probe', 'probe.glb').glb.equals(r.glb));

const farn = umbauen(exportGlb('Plant_Leaves_1A3 1', 2), 'fern-probe', 'probe.glb');
const farnMat = glbLesen(farn.glb).json.materials[0];
check('Farn: Rolle farn mit Tönungsfaktor', farnMat.name === 'farn' && farnMat.pbrMetallicRoughness.baseColorFactor?.length === 4);
check('Blume: keine Tönung', mat.pbrMetallicRoughness.baseColorFactor === undefined);

let meldung = '';
try {
  umbauen(exportGlb('Unbekannt 7', 1), 'x', 'probe.glb');
} catch (e) {
  meldung = (e as Error).message;
}
check('Unbekanntes Material wird mit Namen abgewiesen', meldung.includes('unbekanntes Material Unbekannt 7'), meldung);

// Die Ausgangsdateien, die Mike in den Speicher kopieren muss (`assets/store/vegetation-export/`).
check(
  'Ausgangsdateien heissen flower-1a4.glb, flower-1a12.glb, fern-1a1.glb',
  JSON.stringify((MODELLE as { quelle: string }[]).map((m) => m.quelle)) === JSON.stringify(['flower-1a4.glb', 'flower-1a12.glb', 'fern-1a1.glb'])
);

// ── Strenge: beschädigte Dateien werden abgewiesen ───────────────────
function wirft(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    return (e as Error).message;
  }
  return '';
}
const png = pngKlein(3) as Buffer;
check('PNG: gültiges Mini-PNG wird angenommen', pngPruefen(png).breite === 4);
for (const [name, teil] of [['90 %', 0.9], ['50 %', 0.5], ['10 %', 0.1]] as const) {
  check(`PNG auf ${name} gekürzt wird abgewiesen`, wirft(() => pngPruefen(png.subarray(0, Math.floor(png.length * teil)))) !== '');
}
check('PNG ohne IEND-Chunk (letzte 12 Byte weg) wird abgewiesen', wirft(() => pngPruefen(png.subarray(0, png.length - 12))).includes('abgeschnitten'));
const idatByte = Buffer.from(png);
idatByte[idatByte.length - 20] ^= 0xff;
check('PNG mit gekipptem Byte: Prüfsumme schlägt an', wirft(() => pngPruefen(idatByte)).includes('Prüfsumme'));
check('PNG mit Resten hinter IEND wird abgewiesen', wirft(() => pngPruefen(Buffer.concat([png, Buffer.from([1])]))).includes('Reste'));
check('PNG mit falscher Kennung wird abgewiesen', wirft(() => pngPruefen(Buffer.concat([Buffer.from('xxxxxxxx'), png.subarray(8)]))).includes('kein PNG'));

const glb: Buffer = exportGlb('Flowers_A 1', 1);
for (const [name, teil] of [['90 %', 0.9], ['50 %', 0.5], ['10 %', 0.1]] as const) {
  check(`GLB auf ${name} gekürzt wird abgewiesen`, wirft(() => umbauen(glb.subarray(0, Math.floor(glb.length * teil)), 'x', 'probe.glb')) !== '');
}
check('GLB: Länge laut Kopf stimmt nicht (1 Byte angehängt)', wirft(() => glbLesen(Buffer.concat([glb, Buffer.from([0])]))).includes('Länge laut Kopf'));
const kaputtPng = Buffer.from(glb);
kaputtPng[40] ^= 0xff; // innerhalb des eingebetteten PNG
check('GLB mit gekipptem Byte im eingebetteten PNG wird abgewiesen', wirft(() => umbauen(kaputtPng, 'x', 'probe.glb')) !== '');
const kaputtPos = Buffer.from(glb);
kaputtPos.writeFloatLE(Number.NaN, glb.length - 6 - 36 - 2 + 8); // eine Position wird NaN (Lage am Ende des BIN)
const nanBeleg = wirft(() => umbauen(kaputtPos, 'x', 'probe.glb'));
check('GLB mit NaN-Position wird abgewiesen', nanBeleg.includes('Position'), nanBeleg);
const ohneBin = Buffer.from(glb);
ohneBin.writeUInt32LE(0x41414141, 20 + ohneBin.readUInt32LE(12) + 4);
check('GLB: zweiter Chunk ist kein BIN', wirft(() => glbLesen(ohneBin)).includes('kein BIN'));

// ── pflanzenHolen: Warnungen statt Abbruch, Liste nur mit Schalter ────
const tmp = mkdtempSync(join(tmpdir(), 'grauklamm-k1-holen-'));
const modelle = MODELLE as { quelle: string; id: string }[];
const material = (m: { id: string }): string => (m.id.startsWith('fern') ? 'Plant_Leaves_1A3 1' : 'Flowers_A 1');
const sauber = (): Buffer[] => modelle.map((m, i) => exportGlb(material(m), i + 1));
const roh = (name: string, dateien: Record<string, Buffer>): string => {
  const d = join(tmp, name);
  mkdirSync(d, { recursive: true });
  for (const [n, b] of Object.entries(dateien)) writeFileSync(join(d, n), b);
  return d;
};
interface Lauf { n: number | null; warn: string; fehler: string; ziel: string; katalog: string }
function holen(name: string, quelle: string, opt: { schreiben?: boolean; katalog?: string } = {}): Lauf {
  const ziel = join(tmp, `ziel-${name}`);
  const katalog = opt.katalog ?? join(tmp, `katalog-${name}.json`);
  const warnAlt = console.warn;
  const logAlt = console.log;
  let warn = '';
  console.warn = (m: string) => {
    warn += `${m}\n`;
  };
  console.log = () => undefined;
  let n: number | null = null;
  let fehlerText = '';
  try {
    n = pflanzenHolen({ quelle, ziel, katalog, messlisteSchreiben: opt.schreiben ?? false });
  } catch (e) {
    fehlerText = (e as Error).message;
  } finally {
    console.warn = warnAlt;
    console.log = logAlt;
  }
  return { n, warn, fehler: fehlerText, ziel, katalog };
}
const gebaut = (l: Lauf): string[] => (existsSync(l.ziel) ? readdirSync(l.ziel).filter((f) => f.endsWith('.glb')).sort() : []);
const hashDatei = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
try {
  const gut = sauber();
  const ganz = roh('ganz', Object.fromEntries(modelle.map((m, i) => [m.quelle, gut[i]])));

  // Quelle fehlt / leer: Warnung, nie Fehler
  const keine = holen('keine', join(tmp, 'gibt-es-nicht'));
  check('Ordner fehlt: 0 Modelle, Warnung, kein Fehler', keine.n === 0 && keine.warn.includes('WARNUNG') && keine.fehler === '', keine.warn + keine.fehler);
  check('Ordner fehlt: nichts geschrieben', !existsSync(keine.katalog) && !existsSync(keine.ziel));
  const leer = holen('leer', roh('leer', {}));
  check('Ordner leer: Warnung statt Abbruch, nichts gebaut', leer.n === 0 && leer.warn.includes('fehlt') && leer.fehler === '' && !existsSync(leer.katalog), leer.warn + leer.fehler);

  // Liste schreiben (nur mit Schalter)
  const erst = holen('erst', ganz, { schreiben: true });
  check('Schalter: drei Modelle gebaut, Liste geschrieben', erst.n === 3 && existsSync(erst.katalog), erst.warn + erst.fehler);
  const liste1 = JSON.parse(readFileSync(erst.katalog, 'utf8')) as { eintraege: LabEintrag[] };
  check('Messliste ist sortiert und führt drei Einträge', liste1.eintraege.map((e) => e.id).join() === 'vegetation/fern-1a1,vegetation/flower-1a12,vegetation/flower-1a4');
  check('Messliste ist kanonisch formatiert (2 Leerzeichen, ein Zeilenende)', readFileSync(erst.katalog, 'utf8') === `${JSON.stringify(liste1, null, 2)}\n`);
  // B3: die GESCHRIEBENEN Werte gegen die Ausgabedateien, ohne Assets
  let werteOk = true;
  const detail: string[] = [];
  for (const e of liste1.eintraege) {
    const datei = join(erst.ziel, e.pfad.replace(/^vegetation\//, ''));
    const tex = join(erst.ziel, e.textur.datei);
    const ok =
      existsSync(datei) && existsSync(tex) &&
      e.bytes === statSync(datei).size && e.hash === `sha256-${hashDatei(datei)}` &&
      e.textur.bytes === statSync(tex).size && e.textur.hash === `sha256-${hashDatei(tex)}` &&
      /^sha256-[0-9a-f]{64}$/.test(e.hash) && e.textur.datei === `textures/${e.material}-${e.textur.hash.slice(7, 15)}.png`;
    if (!ok) {
      werteOk = false;
      detail.push(e.id);
    }
  }
  check('Geschriebene Messliste: Hash, Bytes und Texturname stimmen mit den gebauten Dateien', werteOk, detail.join(','));

  // Normallauf: nur vergleichen, nie schreiben
  const listeText = readFileSync(erst.katalog, 'utf8');
  const wieder = holen('wieder', ganz, { katalog: erst.katalog });
  check('Normallauf mit passender Liste: drei Modelle, keine Warnung', wieder.n === 3 && wieder.warn === '', wieder.warn);
  check('Normallauf schreibt die Liste nie (Bytes gleich)', readFileSync(erst.katalog, 'utf8') === listeText);
  check('zweiter Lauf: Modelle byteidentisch', gebaut(wieder).every((f) => hashDatei(join(wieder.ziel, f)) === hashDatei(join(erst.ziel, f))) && gebaut(wieder).length === 3);

  // B1: kaputte Dateien — Exit-gleich (kein Fehler), nichts Kaputtes gebaut, Liste unverändert
  for (const [name, teil] of [['90', 0.9], ['50', 0.5], ['10', 0.1]] as const) {
    const fernKurz = gut[2].subarray(0, Math.floor(gut[2].length * teil));
    const q = roh(`kurz${name}`, { [modelle[0].quelle]: gut[0], [modelle[1].quelle]: gut[1], [modelle[2].quelle]: fernKurz });
    const l = holen(`kurz${name}`, q, { katalog: erst.katalog });
    check(`Farn auf ${name} % gekürzt: Warnung, die zwei Blumen gebaut, kein Farn, kein Fehler`, l.fehler === '' && l.n === 2 && !gebaut(l).includes('fern-1a1.glb') && l.warn.includes('fern-1a1.glb'), l.warn + l.fehler);
    check(`  … Liste unverändert (${name} %)`, readFileSync(erst.katalog, 'utf8') === listeText);
  }
  const gekippt = Buffer.from(gut[2]);
  gekippt[gekippt.length - 100] ^= 0xff; // Byte im Bildteil
  const lk = holen('gekippt', roh('gekippt', { [modelle[0].quelle]: gut[0], [modelle[1].quelle]: gut[1], [modelle[2].quelle]: gekippt }), { katalog: erst.katalog });
  check('Gekipptes Byte: Warnung, Farn nicht gebaut, Liste unverändert', lk.fehler === '' && lk.n === 2 && !gebaut(lk).includes('fern-1a1.glb') && readFileSync(erst.katalog, 'utf8') === listeText, lk.warn + lk.fehler);
  const muell = holen('muell', roh('muell', { [modelle[0].quelle]: gut[0], [modelle[1].quelle]: gut[1], [modelle[2].quelle]: Buffer.from('zufallsbytes zufallsbytes zufallsbytes') }), { katalog: erst.katalog });
  check('Zufallsbytes statt GLB: Warnung, kein Fehler, Rest gebaut', muell.fehler === '' && muell.n === 2 && muell.warn.includes('fern-1a1.glb'), muell.warn + muell.fehler);

  // B1: gültiger Ersatz durch Mike (andere Datei, anderer Hash)
  const ersatz = roh('ersatz', { [modelle[0].quelle]: exportGlb('Flowers_A 1', 7), [modelle[1].quelle]: gut[1], [modelle[2].quelle]: gut[2] });
  const le = holen('ersatz', ersatz, { katalog: erst.katalog });
  check('Gültiger Ersatz: laute Warnung mit Hinweis auf PR, ersetzte Datei nicht gebaut, Rest gebaut', le.fehler === '' && le.n === 2 && le.warn.includes('Messliste weicht ab') && le.warn.includes('per PR') && !gebaut(le).includes('flower-1a4.glb'), le.warn + le.fehler);
  check('  … Liste unverändert', readFileSync(erst.katalog, 'utf8') === listeText);
  const ohneListe = holen('ohneliste', ganz);
  check('Ohne Liste (Datei fehlt): nichts gebaut, Warnung, Liste nicht angelegt', ohneListe.n === 0 && ohneListe.warn.includes('Messliste weicht ab') && !existsSync(ohneListe.katalog), ohneListe.warn);

  // B2: teilweise, Grossschreibung, Fremdes
  const teil = holen('teil', roh('teil', { [modelle[0].quelle]: gut[0] }), { katalog: erst.katalog });
  check('Teilweise gefüllt: Warnung nennt die fehlenden, das Vorhandene wird gebaut, kein Fehler', teil.fehler === '' && teil.n === 1 && teil.warn.includes('flower-1a12.glb fehlt') && teil.warn.includes('fern-1a1.glb fehlt'), teil.warn + teil.fehler);
  const gross = holen('gross', roh('gross', Object.fromEntries(modelle.map((m, i) => [m.quelle.toUpperCase().replace('.GLB', '.glb'), gut[i]]))), { katalog: erst.katalog });
  check('Grossschreibung (FLOWER-1A4.glb) wird akzeptiert', gross.n === 3 && gross.warn === '', gross.warn);
  const unterstrich = holen('unterstrich', roh('unterstrich', { 'Flower_1A4.glb': gut[0], [modelle[1].quelle]: gut[1], [modelle[2].quelle]: gut[2] }), { katalog: erst.katalog });
  check('Anderer Name (Unterstrich): Warnung mit erwartetem Namen, Rest gebaut', unterstrich.n === 2 && unterstrich.warn.includes('bitte als flower-1a4.glb benennen'), unterstrich.warn);
  const fremd = holen('fremd', roh('fremd', { ...Object.fromEntries(modelle.map((m, i) => [m.quelle, gut[i]])), '.DS_Store': Buffer.from('x'), 'flower-1a4.glb.bak': Buffer.from('x') }), { katalog: erst.katalog });
  check('Fremde Dateien daneben werden ignoriert', fremd.n === 3 && fremd.warn === '', fremd.warn);

  // Liste schreiben nur mit allen drei gültigen Dateien
  const unvollstaendig = holen('schreibteil', roh('schreibteil', { [modelle[0].quelle]: gut[0] }), { schreiben: true });
  check('Schalter mit unvollständigem Ordner: Fehler, Liste nicht geschrieben', unvollstaendig.fehler !== '' && !existsSync(unvollstaendig.katalog), unvollstaendig.fehler);
  const schreibKaputt = holen('schreibkaputt', roh('schreibkaputt', { [modelle[0].quelle]: gut[0], [modelle[1].quelle]: gut[1], [modelle[2].quelle]: gut[2].subarray(0, 100) }), { schreiben: true });
  check('Schalter mit beschädigter Datei: Fehler, Liste nicht geschrieben', schreibKaputt.fehler !== '' && !existsSync(schreibKaputt.katalog), schreibKaputt.fehler);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── Der Rollout-Hook in store-vegetation-aufbereiten.mjs ─────────────
const aufbereiten = readFileSync(join(WURZEL, 'tools/store-vegetation-aufbereiten.mjs'), 'utf8');
check(
  'Aufbereitung ruft pflanzenHolen() nur im Standardlauf (nicht bei --nur-pruefen, nicht bei Probeziel), ohne Schalter und in try/catch',
  /if \(!NUR_PRUEFEN && ZIEL === resolve\(WURZEL, ZIEL_STANDARD\) && QUELLE === resolve\(WURZEL, QUELLE_STANDARD\)\) \{\s*console\.log\(''\);\s*try \{\s*const \{ pflanzenHolen \} = await import\('\.\/store-pflanzen-quellen\.mjs'\);\s*pflanzenHolen\(\);\s*\} catch/.test(aufbereiten)
);

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) rot`);
  process.exit(1);
}
console.log('\nstore-lab-katalog: alles grün');
