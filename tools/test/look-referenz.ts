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
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ZUORDNUNG, SCHICHTEN } from '../store-terrain-schichten.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const STORE_TEX = join(WURZEL, 'assets/store/textures');

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
  ['Grass', (t) => t[0]! > 1.2 && t[0]! > t[2]!, 'Wiesengrund heller und wärmer (Bild 1)'],
  ['Moss', (t) => t[0]! > 1.2 && t[0]! > t[1]!, 'Hangmoos wärmer (Bild 3)'],
  ['Cliff', (t) => t[0]! > 1.5 && t[2]! < 0.6, 'heller Fels tan statt Beton (Bild 3)'],
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
    /const toenung = vorrang \?\? ausStore/.test(quelle),
    'die Reihenfolge in Schritt 2 ist die ganze Wirkung'
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
void klemmprobe().then(() => {
  if (fehler > 0) {
    console.error(`\n${fehler} Fehlschläge`);
    process.exit(1);
  }
  console.log('\nalles grün');
});
