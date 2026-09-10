/**
 * Prüft: dass der Feinabgleich vom 09.09.2026 nicht lautlos zurückrutscht.
 *
 * Vier Regler wurden am Referenzbild kalibriert (`design/look-referenz.md`):
 * die Tönung von vier Bodenzeilen, die Tönung des Store-Gras-Materials und
 * die Halmhöhe. Jeder davon kann verlorengehen, ohne dass irgendetwas
 * rot wird — und drei der vier sieht man erst, wenn man an der richtigen
 * Stelle steht. Dagegen steht dieser Test.
 *
 *   npx tsx tools/test/look-referenz.ts
 *
 * ── Wogegen er steht, im Einzelnen ───────────────────────────────────
 *
 *  (a) EINE ZEILE FÄLLT AUF [1, 1, 1] ZURÜCK. Vier Zeilen des
 *      Stapelwerkzeugs tragen jetzt eine gemessene Tönung. Wer eine
 *      davon beim Aufräumen auf „neutral" zurücksetzt, bekommt genau
 *      den Zustand, den Mikes Sichtprüfung beanstandet hat: weisslicher
 *      Fels, olivbrauner Wiesengrund. Es gibt dafür keine Fehlermeldung.
 *
 *  (b) DIE TÖNUNG LÄUFT IN DIE KLEMME. `zuSrgb` klemmt bei 255. Eine
 *      Tönung über 2 auf einer hellen Zeile kann die Textur oben
 *      abschneiden — sichtbar als flache, strukturlose Fläche, nicht als
 *      Fehler. Geprüft wird gegen die Quelltexturen des Speichers.
 *
 *  (c) DER VORRANG DES GRASES VERSCHWINDET. `TOENUNG_VORRANG` ist die
 *      einzige Stelle, an der die Grastönung den Store-Faktor schlägt.
 *      Fehlt der Eintrag, greift wieder [0.85, 1.0, 0.6] — und zwar
 *      lautlos, denn getönt ist das Material ja.
 *
 *  (d) DIE HALMHÖHE FÄLLT ZURÜCK. Sie ist die Zahl hinter „hoch und
 *      dicht"; ohne sie ist die Wiese wieder ein Teppich.
 *
 *  (e) GRAS WIRFT PLÖTZLICH SCHATTEN. Die Halmspitze liegt jetzt über
 *      0,5 m. Dass ADR-0027 trotzdem gilt, hängt an EINER Zeile in
 *      Shadows.ts: `NIE_WERFEN` fängt alles ab, was mit `clutter`
 *      beginnt. Ändert jemand das Namensschema der Clutter-Meshes,
 *      stehen mit einem Mal Zehntausende alphagetestete Karten in der
 *      Werferliste — messbar erst als Framezeit, nicht als Fehler.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ZUORDNUNG, SCHICHTEN } from '../store-terrain-schichten.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const STORE_TEX = join(WURZEL, 'assets/store/textures');
const STORE_LAB_VEG = join(WURZEL, 'assets/store-lab/vegetation');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── (a) Die vier kalibrierten Zeilen ─────────────────────────────────
/*
  Die Werte stehen hier NICHT noch einmal ausgeschrieben — dann hätte
  man zwei Wahrheiten und müsste beide pflegen. Geprüft wird die
  EIGENSCHAFT, die der Feinabgleich hergestellt hat, und die ist je
  Zeile eine andere:

    Grass  heller und wärmer als neutral  → R > 1,2 und R > B
    Moss   wärmer als neutral             → R > 1,2 und R > G
    Cliff  deutlich wärmer, Blau gedämpft → R > 1,5 und B < 0,6

  Wer eine dieser Zeilen nachjustiert, darf das tun; wer sie neutral
  macht, kommt hier nicht durch.

  `Rock` (die dunkle Wandschicht) steht bewusst NICHT in der Liste: Die
  Gegenprobe am 24°-Zeugen hat gezeigt, dass eine Tönung dort im Bild
  nichts bewegt (Metallic 0,85 — das Bild ist der Himmelsterm, nicht die
  Albedo). Die Zeile bleibt neutral, und dass sie es bleibt, prüft der
  Block darunter.
*/
const zeile = (name: string) => ZUORDNUNG.find((z: { name: string }) => z.name === name) as
  | { name: string; schicht: string; toenung: [number, number, number] }
  | undefined;

const erwartungen: Array<[string, (t: readonly number[]) => boolean, string]> = [
  // Grün MUSS auf dieser Zeile dominieren. Bis zum 10.09.2026 stand hier
  // R > 1,2 und R > B — beides war erfüllt, und trotzdem war der Regler
  // falsch herum: Mit [1,378, 1,279, 1,032] stand ROT über Grün, und der
  // Wiesengrund kam im Bild als Khaki heraus (gemessen Mittag, ebener
  // Blick: 62,4/62,4/40,5 — R und G auf dieselbe Zehntel gleich). Mikes
  // Sichtprüfung dazu: „es wirkt alles sehr braun". Ein Wiesengrund, der
  // aus einer Textur mit R ≈ G (terrain-grass-a: linear 0,0399/0,0401)
  // grün werden soll, braucht G ≥ R auf der Zeile — sonst kann er es gar
  // nicht.
  ['Grass', (t) => t[1]! >= t[0]! && t[1]! > 1.2, 'Wiesengrund grün-dominant und heller (Bild 1)'],
  // Die beiden Hangzeilen sind seit dem 10.09.2026 GEDÄMPFT (s.
  // HELLIGKEITS-Block darunter). Eine absolute Untergrenze wie „R > 1,5"
  // würde diese Dämpfung wieder verbieten; geprüft wird deshalb die
  // FORM der Zeile — dass sie warm bleibt und das Blau gedrückt —, und
  // die Helligkeit prüft der Block darunter gegen den Himmel.
  ['Moss', (t) => t[0]! > t[1]! * 1.2, 'Hangmoos wärmer als neutral (Bild 3, H 44,7)'],
  ['Cliff', (t) => t[0]! > t[1]! * 1.8 && t[2]! < t[0]! * 0.3, 'heller Fels tan statt Beton (Bild 3, H 30,5)'],
];
for (const [name, regel, was] of erwartungen) {
  const z = zeile(name);
  check(
    `Zeile ${name} trägt die gemessene Tönung (${was})`,
    Boolean(z?.toenung) && regel(z!.toenung),
    z ? JSON.stringify(z.toenung) : 'Zeile fehlt'
  );
}

/*
  Die Gegenprobe zur Liste oben: `Rock` MUSS neutral bleiben. Nicht aus
  Bequemlichkeit — die Messung am 24°-Zeugen sagt, dass eine Tönung dort
  im Bild nichts bewegt (B−R wandert um 0,4 bis 1,0 Byte, in beide
  Richtungen). Eine Zahl in dieser Zeile wäre ein Regler, der aussieht,
  als tue er etwas. Wer die Schicht wirklich ändern will, muss an
  `metallic` in SCHICHTEN und SCHICHT_OBERFLAECHE — und dazu steht die
  Rechnung im Kommentar der Zeile.
*/
{
  const z = zeile('Rock');
  check(
    'Zeile Rock bleibt neutral (die Tönung ist dort messbar wirkungslos)',
    Boolean(z?.toenung) && z!.toenung.every((t) => t === 1),
    z ? JSON.stringify(z.toenung) : 'Zeile fehlt'
  );
}

// ── (b) Keine Zeile läuft in die Klemme ──────────────────────────────
/*
  Gerechnet wird wie im Werkzeug: sRGB → linear → mal Tönung → sRGB.
  Geprüft wird der HELLSTE Texel je Kanal der Quelltextur, denn genau
  der klemmt zuerst. Ein Sicherheitsabstand ist bewusst nicht
  eingebaut — 254 ist erlaubt, 255 nicht.
*/
const zuLinear = (v: number): number => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const zuSrgb = (l: number): number => {
  const c = Math.min(1, Math.max(0, l));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
};

/*
  `sharp` ist asynchron, und `tsx` übersetzt diese Datei nach CJS — ein
  `await` auf oberster Ebene lässt sich dort nicht übersetzen. Die
  Klemmprobe läuft deshalb in einer Funktion, die ganz unten angestossen
  wird; alle übrigen Prüfungen bleiben synchron darüber stehen.
*/
async function klemmprobe(): Promise<void> {
  if (!existsSync(STORE_TEX)) {
    console.log('   (Store-Texturen fehlen — Klemmprobe übersprungen, Weiche in run-tests.mjs)');
    return;
  }
  for (const z of ZUORDNUNG as Array<{ name: string; schicht?: string; toenung?: number[]; altbestand?: boolean }>) {
    if (z.altbestand || !z.schicht || !z.toenung) continue;
    if (z.toenung.every((t) => t <= 1)) continue; // kann nicht klemmen
    const s = (SCHICHTEN as Record<string, { farbe: string }>)[z.schicht];
    if (!s) { check(`Zeile ${z.name} zeigt auf eine bekannte Schicht`, false, z.schicht); continue; }
    const datei = join(STORE_TEX, `${s.farbe}.png`);
    if (!existsSync(datei)) { check(`Quelltextur ${s.farbe}.png liegt im Store`, false, datei); continue; }
    const stat = await sharp(datei).removeAlpha().stats();
    // `.slice(0, 3)`: `removeAlpha()` wirkt auf die PIPELINE, nicht auf
    // `stats()` — der Alphakanal steht dort weiter drin. Ohne den Schnitt
    // liefe die Rechnung mit `toenung[3] === undefined` auf NaN, und
    // `NaN >= 255` ist false: Die Prüfung wäre still immer grün.
    const geklemmt = stat.channels
      .slice(0, 3)
      .map((c, i) => ({ i, aus: zuSrgb(zuLinear(c.max) * z.toenung![i]!) }))
      .filter((c) => c.aus >= 255);
    check(
      `Zeile ${z.name} klemmt nicht (${s.farbe}, hellster Texel ${stat.channels.slice(0, 3).map((c) => c.max).join('/')})`,
      geklemmt.length === 0,
      geklemmt.map((c) => `Kanal ${'RGB'[c.i]} → ${c.aus}`).join(', ')
    );
  }
}

// ── (c) Der Vorrang des Grases ───────────────────────────────────────
/*
  Nicht über einen Import geprüft, sondern am QUELLTEXT: Das Werkzeug
  ist ein .mjs mit Seiteneffekten beim Import (es liest den Store und
  schreibt Dateien). Ein Import hier hiesse, den ganzen Lauf noch einmal
  zu fahren.
*/
{
  const quelle = readFileSync(join(WURZEL, 'tools/store-vegetation-aufbereiten.mjs'), 'utf8');
  check(
    'TOENUNG_VORRANG führt die Rolle gras',
    /const TOENUNG_VORRANG = new Set\(\[[^\]]*'gras'/.test(quelle),
    'ohne den Eintrag greift wieder der Store-Faktor [0.85, 1.0, 0.6]'
  );
  check(
    'der Vorrang wird vor dem Store-Faktor gelesen',
    /const gewaehlt = vorrang \?\? ausStore/.test(quelle),
    'die Reihenfolge in Schritt 2 ist die ganze Wirkung'
  );
  check(
    'TOENUNG_VORRANG führt die Rolle ahorn',
    /const TOENUNG_VORRANG = new Set\(\[[^\]]*'ahorn'/.test(quelle),
    'ohne den Eintrag greift wieder der Store-Faktor [0.62, 1.0, 0.2] — der Ahorn ist dann 2,39 × Median'
  );
  check(
    'die Dämpfung wird auf den gewählten Faktor angewandt',
    /const daempfung = TOENUNG_DAEMPFUNG\[eintrag\.rolle\]/.test(quelle)
      && /gewaehlt && daempfung/.test(quelle),
    'ohne diese Zeile steht die Tabelle da und wirkt nicht'
  );
  const gras = /gras: \[([0-9.]+), ([0-9.]+), ([0-9.]+), 1\],/.exec(quelle);
  check('TOENUNG_VORGABE.gras ist gesetzt', Boolean(gras), 'Zeile nicht gefunden');
  if (gras) {
    const [r, g, b] = [Number(gras[1]), Number(gras[2]), Number(gras[3])];
    // Gemessen: der Halm des Vorbilds ist GELBGRÜN (R ≥ G) und fast ohne
    // Blau. Der Store-Faktor war das Gegenteil (R < G, viel Blau).
    check(
      'die Grastönung ist gelbgrün und blauarm (Bild 1, Büschel)',
      r > g && b < 0.15,
      `[${r}, ${g}, ${b}]`
    );
  }
}

// ── (d) Die Halmhöhe ─────────────────────────────────────────────────
/*
  Die Höhe steht als `storeScale.prefabScale[1]` im Clutter-Eintrag.
  Gemessen am Referenzbild sind die Büschel 0,64 bis 1,04 m hoch; das
  Store-Modell ist 0,223 m hoch, `scaleMax` streut darüber.
*/
{
  const quelle = readFileSync(join(WURZEL, 'client/src/engine/GrassClutter.ts'), 'utf8');
  const MODELL_HOEHE = 0.223;
  for (const [key, mindestens] of [['meadowsGrass', 0.7], ['meadowsGrassShort', 0.4]] as const) {
    const m = new RegExp(
      `key: '${key}'[^\\n]*?storeScale: \\{ prefabScale: \\[[0-9.]+, ([0-9.]+), [0-9.]+\\], scaleMin: [0-9.]+, scaleMax: ([0-9.]+) \\}`
    ).exec(quelle);
    check(`${key} führt eine storeScale`, Boolean(m), 'Muster nicht gefunden');
    if (!m) continue;
    const spitze = MODELL_HOEHE * Number(m[1]) * Number(m[2]);
    check(
      `${key}: höchste Halmspitze ${spitze.toFixed(2)} m ≥ ${mindestens} m (Bild 1: 0,64–1,04 m)`,
      spitze >= mindestens,
      `prefabScale.y ${m[1]}, scaleMax ${m[2]}`
    );
  }
}

// ── (e) Gras wirft weiterhin keinen Schatten ─────────────────────────
/*
  Zwei Hälften einer Zusage, und sie stehen in zwei Dateien: GrassClutter
  benennt seine Meshes `clutter_<zelle>_<eintrag>`, Shadows.ts wirft alles
  aus der Werferliste, was mit `clutter` beginnt. Beide Hälften werden
  hier gegeneinander gehalten — eine Umbenennung auf der einen Seite
  bricht die Zusage auf der anderen, ohne dass irgendwo etwas rot wird.
*/
{
  const gras = readFileSync(join(WURZEL, 'client/src/engine/GrassClutter.ts'), 'utf8');
  const schatten = readFileSync(join(WURZEL, 'client/src/engine/Shadows.ts'), 'utf8');
  const name = /new Mesh\(`([a-z_]+)_\$\{key\}_\$\{variant\.entry\.key\}`/.exec(gras);
  check('GrassClutter benennt seine Zell-Meshes nach festem Muster', Boolean(name), 'new Mesh(...) nicht gefunden');
  const regexZeile = /const NIE_WERFEN =\s*\n?\s*(\/\^\([^\n]*\/i);/.exec(schatten);
  check('Shadows.ts führt NIE_WERFEN als verankerten Regex', Boolean(regexZeile), 'Muster nicht gefunden');
  if (name && regexZeile) {
    // Der Regex kommt aus dem EIGENEN Quelltext (Shadows.ts), nicht von
    // aussen; `Function` statt einer Nachbildung, damit hier nicht eine
    // zweite, abweichende Kopie der Regel entsteht.
    const re = new Function(`return ${regexZeile[1]!};`)() as RegExp;
    const beispiel = `${name[1]!}_12_-7_meadowsGrass`;
    check(
      `ein Clutter-Mesh (${beispiel}) fällt aus der Werferliste — ADR-0027 hängt nicht an der Halmhöhe`,
      re.test(beispiel)
    );
  }
}

// ── (f) Kein Laubmaterial reisst aus ─────────────────────────────────
/*
  Wogegen dieser Block steht: EIN Baum, der doppelt so hell ist wie
  seine Nachbarn. Das ist Mikes Befund vom 10.09.2026 („Bäume sind
  stellenweise sehr hell vom Blattlaub her, nicht alle, einzelne"), und
  es gibt dafür keine Fehlermeldung — die Datei lädt, das Material
  rendert, nur die Zahl darin ist eine andere als bei allen anderen.

  Gemessen wird, was am Bildschirm ankommt: der Atlasmittelwert über die
  DECKENDEN Texel (Alpha >= 128, linear gerechnet) MAL dem
  `baseColorFactor` des Materials. Beides steht in den AUFBEREITETEN
  GLBs unter `assets/store-lab/vegetation/` — also in dem, was
  `store-vegetation-aufbereiten.mjs` tatsächlich geschrieben hat, und
  nicht in einer zweiten Tabelle daneben.

  Die Schranke ist relativ (1,3 x Median) und nicht absolut. Eine feste
  Zahl wäre eine dritte Wahrheit neben Atlas und Faktor und müsste bei
  jedem neuen Modell nachgezogen werden; der Median wandert mit dem
  Bestand mit, und was hier auffällt, ist genau das, was auch im Bild
  auffällt: ein Blatt, das aus der Reihe tanzt.

  Zwei Ausnahmen, beide mit Grund:

    grasSchnee / laubSchnee  Schnee IST hell. Beide Rollen stehen
      ausschliesslich in `GRAS_BUESCHEL_HOCHNORD` beziehungsweise der
      Hochnord-Liste von `shared/src/storeFlora.ts` — auf der Wiese
      kommen sie nicht vor. Dass das so BLEIBT, prüft der Block
      darunter: Sobald ein `-snow`-Modell in einer anderen Biomliste
      auftaucht, greift die Ausnahme nicht mehr.
*/
async function laubZensus(): Promise<void> {
  if (!existsSync(STORE_LAB_VEG)) {
    console.log('   (assets/store-lab/vegetation fehlt — Laub-Zensus übersprungen, Weiche in run-tests.mjs)');
    return;
  }
  const atlas = new Map<string, [number, number, number]>();
  const zuLin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  /** Mittel der DECKENDEN Texel eines Atlas, linear. */
  async function atlasMittel(pfad: string): Promise<[number, number, number] | null> {
    const zwischen = atlas.get(pfad);
    if (zwischen) return zwischen;
    if (!existsSync(pfad)) return null;
    const { data, info } = await sharp(pfad).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const k = info.channels;
    const summe = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < data.length; i += k) {
      if (data[i + 3]! < 128) continue;
      summe[0]! += zuLin(data[i]!);
      summe[1]! += zuLin(data[i + 1]!);
      summe[2]! += zuLin(data[i + 2]!);
      n++;
    }
    if (!n) return null;
    const m: [number, number, number] = [summe[0]! / n, summe[1]! / n, summe[2]! / n];
    atlas.set(pfad, m);
    return m;
  }

  /** Der JSON-Teil eines GLB. */
  function glbJson(pfad: string): Record<string, unknown> {
    const buf = readFileSync(pfad);
    const len = buf.readUInt32LE(12);
    return JSON.parse(buf.toString('utf8', 20, 20 + len)) as Record<string, unknown>;
  }

  type Zeile = { modell: string; material: string; luma: number; faktor: number[]; atlas: string };
  const zeilen: Zeile[] = [];
  /*
    NUR Laub. Die Grasbüschel (`gras`, `grasGelb`, `grasBunt`,
    `grasSchnee`) stehen bewusst NICHT in dieser Familie, und zwar aus
    einem messbaren Grund: Sie haben ihre EIGENE Zielzahl im Vorbild
    (Bild 1, Büschel: Luma 64,3 gegen Grund 57,5, also Büschel/Grund
    1,12), während das Laub gegen Krone/Boden und Krone/Himmel gemessen
    wird. Beide in einen Median zu werfen hiesse, zwei Zielvorgaben
    gegeneinander zu mitteln — und nach der Laubdämpfung vom 10.09.2026
    wären prompt die BÜSCHEL die „Ausreisser" gewesen (grasBunt 2,58 ×,
    grasGelb 2,48 ×), obwohl an ihnen nichts geändert wurde.
  */
  const LAUB_ROLLE = /^(laub|laubDunkel|laubSchnee|nadeln|ahorn)$/;
  for (const datei of readdirSync(STORE_LAB_VEG).filter((f) => f.endsWith('.glb')).sort()) {
    const j = glbJson(join(STORE_LAB_VEG, datei)) as {
      materials?: Array<{ name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: { index: number } } }>;
      textures?: Array<{ source: number }>;
      images?: Array<{ uri?: string }>;
    };
    for (const mat of j.materials ?? []) {
      const name = mat.name ?? '';
      if (!LAUB_ROLLE.test(name)) continue;
      const pbr = mat.pbrMetallicRoughness ?? {};
      const f = pbr.baseColorFactor ?? [1, 1, 1, 1];
      const ti = pbr.baseColorTexture?.index;
      if (ti === undefined) continue;
      const uri = j.images?.[j.textures?.[ti]?.source ?? -1]?.uri;
      if (!uri) continue;
      const m = await atlasMittel(join(STORE_LAB_VEG, uri));
      if (!m) continue;
      const a = [m[0] * f[0]!, m[1] * f[1]!, m[2] * f[2]!];
      zeilen.push({
        modell: datei.replace(/\.glb$/, ''),
        material: name,
        luma: 0.2126 * a[0]! + 0.7152 * a[1]! + 0.0722 * a[2]!,
        faktor: f.slice(0, 3),
        atlas: basename(uri),
      });
    }
  }
  check('der Laub-Zensus findet Materialien', zeilen.length > 40, `${zeilen.length} Zeilen`);
  if (!zeilen.length) return;

  const sortiert = zeilen.map((z) => z.luma).sort((a, b) => a - b);
  const median = sortiert[Math.floor(sortiert.length / 2)]!;
  const schranke = 1.3 * median;
  // Schnee darf hell sein — solange er im Hohen Norden bleibt.
  const schnee = /schnee|snow/i;
  const ausreisser = zeilen.filter((z) => z.luma > schranke && !(schnee.test(z.material) || schnee.test(z.modell)));
  check(
    `kein Laubmaterial über 1,3 × Median (Median ${median.toFixed(4)}, Schranke ${schranke.toFixed(4)}, ${zeilen.length} Materialien)`,
    ausreisser.length === 0,
    ausreisser.map((z) => `${z.modell}/${z.material} ${z.luma.toFixed(4)} = ${(z.luma / median).toFixed(2)} × [${z.faktor.join(', ')}]`).join('; ')
  );
  // Der Ahorn ist der Anlass dieses Blocks — er steht namentlich drin,
  // damit ein Rückfall auf den Store-Faktor [0.62, 1, 0.2] hier sofort
  // auffällt und nicht erst, wenn der Median irgendwann mitgewandert ist.
  const ahorn = zeilen.filter((z) => z.material === 'ahorn');
  check('der Ahorn steht in der Familie (≤ 1,3 × Median)', ahorn.length > 0 && ahorn.every((z) => z.luma <= schranke),
    ahorn.map((z) => `${z.modell} ${z.luma.toFixed(4)} = ${(z.luma / median).toFixed(2)} ×`).join('; ') || 'kein ahorn-Material gefunden');
}

/*
  Die andere Hälfte der Schnee-Ausnahme: Sie gilt nur, weil die
  `-snow`-Modelle ausschliesslich im Hohen Norden stehen. Das ist eine
  Zusage aus einer ANDEREN Datei, und ohne diese Prüfung könnte jemand
  ein Schneemodell in die Wiesenliste schieben, ohne dass der Zensus
  darüber etwas sagt — die Ausnahme würde es stumm decken.
*/
{
  const flora = readFileSync(join(WURZEL, 'shared/src/storeFlora.ts'), 'utf8');
  const schneeZeilen = flora.split('\n').filter((l) => /name: '[^']*-snow'/.test(l));
  check('storeFlora führt Schnee-Modelle', schneeZeilen.length > 0, `${schneeZeilen.length}`);
  // Der Abschnitt, in dem eine Zeile steht, ergibt sich aus der letzten
  // Listen-Überschrift davor. Statt den Quelltext zu parsen: Jede
  // `-snow`-Zeile muss in einem Block stehen, dessen Name HOCHNORD
  // enthält.
  const zeilen = flora.split('\n');
  let block = '';
  const falsch: string[] = [];
  for (const l of zeilen) {
    const m = /^const ([A-Z_0-9]+):/.exec(l) ?? /^export const ([A-Z_0-9]+):/.exec(l);
    if (m) block = m[1]!;
    if (/name: '[^']*-snow'/.test(l) && !/HOCHNORD/.test(block)) falsch.push(`${block}: ${l.trim().slice(0, 60)}`);
  }
  check('jedes -snow-Modell steht in einer HOCHNORD-Liste', falsch.length === 0, falsch.join(' | '));
}

// ── Die Referenzdatei selbst ─────────────────────────────────────────
{
  const pfad = join(WURZEL, 'design/look-referenz.md');
  check('design/look-referenz.md liegt im Repo', existsSync(pfad));
  if (existsSync(pfad)) {
    const text = readFileSync(pfad, 'utf8');
    // Ohne Rechtecke ist die Datei eine Meinung. Jede Messzeile muss ihr
    // Rechteck mitführen, sonst kann niemand nachmessen.
    const zeilen = text.split('\n').filter((l) => /^\| .+ \| \d+,\d+–\d+,\d+ \|/.test(l));
    check(`jede Messzeile führt ihr Rechteck mit (${zeilen.length} Zeilen)`, zeilen.length >= 18, String(zeilen.length));
  }
}

// ── Zum Schluss die asynchrone Klemmprobe, dann das Urteil ───────────
void klemmprobe().then(laubZensus).then(() => {
  if (fehler > 0) {
    console.error(`\n${fehler} Fehlschläge`);
    process.exit(1);
  }
  console.log('\nalles grün');
});
