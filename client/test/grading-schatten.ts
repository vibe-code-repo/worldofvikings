/**
 * Wächter für die Schattenzeile des Farbprofils — und für die eine
 * Shaderzeile, von der die Nebelzahl daneben abhängt.
 *
 * ── Warum dieser Test ────────────────────────────────────────────────
 * Die Tabelle in `Grading.ts` hat die Schattenzeile immer schon
 * mitgerechnet. Sie stand nur auf `#ffffff` mit Offset 0 und tat
 * deshalb nichts. Seit sie den Wert des Dorfs trägt
 * (`look.grading.schatten*` in `server.yml`), hängt das halbe Bild an
 * vier Zahlen, die niemand ansieht — und jede davon kann falsch sein,
 * ohne dass irgendetwas bricht:
 *
 *  1. Das HEX ist nur eine 8-Bit-Rundung der gemessenen Farbe. Welcher
 *     VORBEREITETE Wert daraus wird, sieht man ihm nicht an: Die
 *     Aufbereitung linearisiert und addiert den Offset — und der Offset
 *     wird bei positivem Vorzeichen VERVIERFACHT und bei negativem
 *     nicht. Eine `+0,044` statt `−0,044` ist ein Vorzeichenfehler mit
 *     Faktor vier, und das Bild wäre nur „etwas heller".
 *  2. Die Bänder können überlappen. `fM = 1 − fS − fH` wird dann
 *     NEGATIV und die Tabelle kehrt Farben um. Die Profilprüfung in
 *     `shared/src/lookProfil.ts` kennt Bereiche, aber keine Reihenfolge.
 *  3. Die Lichter-Zeile darf keine Farbe verschieben. Im Dorf ist sie
 *     die Eins — das ist eine Eigenschaft der ZAHLEN, keine des
 *     Schwellenwerts, und genau so wird sie hier geprüft: die Tabelle
 *     mit der Dorf-Schwelle 0,55 muss BYTEGLEICH zu der mit 1,07 sein.
 *  4. Der Eingang der Tabelle ist LDR. Steht `lichterStart` über 1,0,
 *     feuert die Zeile nie — was für die Wildnis-Werte gilt und der
 *     Grund ist, aus dem man sie nicht „korrigieren" darf.
 *
 * ── Und warum der Nebel im selben Test steht ─────────────────────────
 * Weil er an derselben Kette hängt. `look.nebelEnde` darf nur deshalb
 * EINE Zahl für das ganze Bild sein, weil `PbrNebelFix.ts` die
 * PBR-Sonderkurve entfernt. Diese Korrektur ist eine Textersetzung im
 * Shader: Greift sie nicht, läuft alles weiter, nur Fels und Gebäude
 * nebeln auf einer anderen Kurve als der Boden — ohne Fehlermeldung. Der
 * Test prüft deshalb, ob Babylons Shader die gesuchte Zeile überhaupt
 * noch so schreibt. Ein Babylon-Update, das sie umformatiert, wird hier
 * rot statt im Bild.
 *
 * Ohne Weiche: keine GPU, kein `assets/`, kein Store. Reine Rechnung.
 *
 * Lauf:  npx tsx client/test/grading-schatten.ts
 */

import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
import '@babylonjs/core/Shaders/ShadersInclude/fogFragment';

import type { LookGrading } from '@wov/shared';
import { gradingZeile, gradingGewichte, gradingLutDaten, GRADING_LUT_KANTE } from '../src/engine/Grading';
import { RX_PBR_NEBELKURVE } from '../src/engine/PbrNebelFix';

let fehler = 0;
function pruefe(bedingung: boolean, was: string): void {
  if (bedingung) {
    console.log(`  OK   ${was}`);
  } else {
    console.log(`  FEHL ${was}`);
    fehler++;
  }
}

/*
  Die gemessenen Rohwerte des Vorbilds (Gammafarbe + Offset), so wie sie
  in den Spieldaten stehen. Sie sind hier die QUELLE: das Profil führt
  nur noch das gerundete Hex, und ob dieses Hex dieselbe Zeile ergibt,
  ist genau die Frage.
*/
const DORF_ROH = {
  schatten: [0.9800831, 0.92229587, 1.0] as const,
  schattenOffset: -0.044477392,
  mitten: [1.0, 0.960438, 0.9038545] as const,
  mittenOffset: -0.014825796,
};
/** Die vorbereiteten Zahlen, unter denen die Analyse sie führt. */
const DORF_VORBEREITET = {
  schatten: [0.911, 0.788, 0.956] as const,
  mitten: [0.985, 0.898, 0.78] as const,
};

/** Das Profil, das ausgeliefert wird (Leitbild Dorf). */
const DORF: LookGrading = {
  an: true,
  schatten: '#faebff',
  schattenOffset: -0.044477392,
  schattenStart: 0,
  schattenEnde: 0.3,
  mitten: '#fff5e6',
  mittenOffset: -0.014825796,
  lichter: '#ffffff',
  lichterOffset: 0,
  lichterStart: 0.55,
  lichterEnde: 1.0,
};
/** Dasselbe mit der Wildnis-Schwelle — als Gegenprobe zu Punkt 3. */
const DORF_SCHWELLE_WILDNIS: LookGrading = { ...DORF, lichterStart: 1.07, lichterEnde: 1.58 };
/** Die Wildnis-Werte (Höhle/Nacht), bisher die Vorgabe. */
const WILDNIS: LookGrading = {
  an: true,
  schatten: '#ffffff',
  schattenOffset: 0,
  schattenStart: 0,
  schattenEnde: 0.3,
  mitten: '#fff5ef',
  mittenOffset: 0,
  lichter: '#ffe9c7',
  lichterOffset: -0.164,
  lichterStart: 1.07,
  lichterEnde: 1.58,
};
/** Alle drei Zeilen auf der Eins — die Tabelle muss dann nichts tun. */
const EINS: LookGrading = {
  an: true,
  schatten: '#ffffff',
  schattenOffset: 0,
  schattenStart: 0,
  schattenEnde: 0.3,
  mitten: '#ffffff',
  mittenOffset: 0,
  lichter: '#ffffff',
  lichterOffset: 0,
  lichterStart: 0.55,
  lichterEnde: 1.0,
};

/** sRGB-Anteil → linear, exakte Kurve (dieselbe wie in `Grading.ts`). */
function zuLinear(s: number): number {
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
const K = GRADING_LUT_KANTE;
/** Ein Texel der Tabelle: Eingang i/(K−1) je Kanal → drei Bytes. */
function texel(daten: Uint8Array, xi: number, yi: number, zi: number): [number, number, number] {
  const o = ((zi * K + yi) * K + xi) * 4;
  return [daten[o]!, daten[o + 1]!, daten[o + 2]!];
}

console.log('\n(1) Die Aufbereitung einer Zeile — Linearisierung und Offset');
{
  // Die Rechnung, die das Vorbild macht: linearisieren, Offset addieren
  // (positiv mal vier), bei null klemmen. Aus den ROHWERTEN gerechnet.
  const ausRoh = (c: readonly number[], off: number): number[] =>
    c.map((v) => Math.max(zuLinear(v) + off * (off < 0 ? 1 : 4), 0));
  const sRoh = ausRoh(DORF_ROH.schatten, DORF_ROH.schattenOffset);
  const mRoh = ausRoh(DORF_ROH.mitten, DORF_ROH.mittenOffset);
  pruefe(
    sRoh.every((v, i) => Math.abs(v - DORF_VORBEREITET.schatten[i]!) < 0.001),
    `Rohwerte → Schattenzeile ${sRoh.map((v) => v.toFixed(3)).join(' / ')} (erwartet 0,911 / 0,788 / 0,956)`
  );
  pruefe(
    mRoh.every((v, i) => Math.abs(v - DORF_VORBEREITET.mitten[i]!) < 0.001),
    `Rohwerte → Mittenzeile ${mRoh.map((v) => v.toFixed(3)).join(' / ')} (erwartet 0,985 / 0,898 / 0,780)`
  );

  // Und jetzt die Frage, um die es geht: Liefert das GERUNDETE HEX aus
  // dem Profil dieselbe Zeile? Die Toleranz ist der gerechnete
  // Rundungsfehler, nicht eine bequeme Zahl.
  const sHex = gradingZeile(DORF.schatten, DORF.schattenOffset);
  const mHex = gradingZeile(DORF.mitten, DORF.mittenOffset);
  const abwS = Math.max(...sHex.map((v, i) => Math.abs(v - sRoh[i]!)));
  const abwM = Math.max(...mHex.map((v, i) => Math.abs(v - mRoh[i]!)));
  /*
    Die Schranke 0,005 ist nicht bequem gewählt, sondern die Grenze, die
    ein einzelner 8-Bit-Schritt in diesem Bereich überhaupt erreichen
    kann: Der schlechteste der sechs Werte ist das Blau der Mittenzeile
    (roh 0,9038545 → Byte 230 oder 231; 230 liegt 0,0038 daneben, 231
    sogar 0,0041). Näher kommt man mit einem Hex nicht heran. Im Bild
    sind 0,0038 auf einem Faktor von 0,78 rund 0,3 sRGB-Byte auf dem
    Himmel — ein Drittel des kleinsten darstellbaren Schritts.
  */
  pruefe(abwS < 0.005, `Hex ${DORF.schatten} trifft die Schattenzeile (grösste Abweichung ${abwS.toFixed(4)})`);
  pruefe(abwM < 0.005, `Hex ${DORF.mitten} trifft die Mittenzeile (grösste Abweichung ${abwM.toFixed(4)})`);

  // Die Asymmetrie, die man einer Zahl nicht ansieht: +0,05 wirkt
  // VIERMAL so stark wie −0,05. Wer das Vorzeichen dreht, dreht auch
  // den Betrag.
  const plus = gradingZeile('#808080', 0.05)[0] - gradingZeile('#808080', 0)[0];
  const minus = gradingZeile('#808080', 0)[0] - gradingZeile('#808080', -0.05)[0];
  pruefe(
    Math.abs(plus - 4 * minus) < 1e-9,
    `positiver Offset wird vervierfacht (+0,05 → ${plus.toFixed(3)}, −0,05 → −${minus.toFixed(3)})`
  );
  // Und die Klemme bei null: ein Offset, der die Zeile unter null zieht,
  // darf keine negative Farbe liefern (sonst kippt die Tabelle).
  pruefe(
    gradingZeile('#101010', -0.9).every((v) => v === 0),
    'ein zu grosser negativer Offset klemmt bei 0 statt negativ zu werden'
  );
}

console.log('\n(2) Die Bänder — Summe eins, nichts negativ, und wo sie greifen');
{
  let summeOk = true;
  let negativ = 0;
  for (let i = 0; i <= 1000; i++) {
    const g = gradingGewichte(DORF, i / 1000);
    if (Math.abs(g.schatten + g.mitten + g.lichter - 1) > 1e-9) summeOk = false;
    if (g.schatten < 0 || g.mitten < 0 || g.lichter < 0) negativ++;
  }
  pruefe(summeOk, 'die drei Gewichte summieren über den ganzen Eingang auf 1');
  pruefe(negativ === 0, `kein Gewicht wird negativ (${negativ} Stützstellen von 1001 wären es)`);

  // Die zwei Luminanzen, an denen im Bild wirklich etwas hängt —
  // GEMESSEN am ausgelieferten Stand (kontrast 0,84): Wiesenboden 0,035,
  // Himmel 0,268. Kippt eine Schwelle, wandert das Bild, nicht der Test.
  const boden = gradingGewichte(DORF, 0.035);
  const himmel = gradingGewichte(DORF, 0.268);
  pruefe(boden.schatten > 0.95, `Wiesenboden (Luminanz 0,035) ist Schatten (${boden.schatten.toFixed(3)})`);
  pruefe(himmel.mitten > 0.95, `Himmel (Luminanz 0,268) ist Mitte (${himmel.mitten.toFixed(3)})`);
  pruefe(himmel.lichter === 0, 'der Himmel erreicht die Lichter-Schwelle 0,55 nicht');

  // Der Grund, aus dem die Wildnis-Lichterzeile nie feuert: Der Eingang
  // der Tabelle ist LDR, die Luminanz kann 1,0 nicht überschreiten —
  // und 1,07 liegt darüber. Weiss ist der teuerste Fall, also wird er
  // geprüft.
  pruefe(
    gradingGewichte(WILDNIS, 1.0).lichter === 0,
    'die Wildnis-Lichterzeile (Start 1,07) feuert selbst bei Weiss nicht'
  );

  // Die Falle mit dem negativen Mittengewicht — hier absichtlich
  // ausgelöst, damit die Eigenschaft dokumentiert ist und der Wächter
  // in `setzeGrading` einen Grund hat.
  const ueberlappt = gradingGewichte({ ...DORF, schattenEnde: 0.8, lichterStart: 0.2, lichterEnde: 0.6 }, 0.5);
  pruefe(
    ueberlappt.mitten < 0,
    `überlappende Bänder erzeugen ein negatives Mittengewicht (${ueberlappt.mitten.toFixed(3)}) — dafür warnt setzeGrading`
  );
}

console.log('\n(3) Die Tabelle — was sie tut und was sie nicht tun darf');
{
  const eins = gradingLutDaten(EINS);
  let groessteAbweichung = 0;
  for (let i = 0; i < K; i++) {
    const soll = Math.round((255 * i) / (K - 1));
    const [r, g, b] = texel(eins, i, i, i);
    groessteAbweichung = Math.max(groessteAbweichung, Math.abs(r - soll), Math.abs(g - soll), Math.abs(b - soll));
  }
  pruefe(
    groessteAbweichung <= 1,
    `drei Zeilen auf der Eins ergeben die unveränderte Rampe (grösste Abweichung ${groessteAbweichung} Byte)`
  );

  /*
    Punkt 3 der Kopfzeile, und die Stelle, an der eine bequeme Annahme
    beim ersten Lauf zerbrochen ist: „Die Lichterzeile ist die Eins,
    also ändert ihre Schwelle nichts" ist FALSCH. Sie ändert etwas —
    nicht durch eine eigene Farbe, sondern weil `fM = 1 − fS − fH` das
    MITTENgewicht verdrängt: über Luminanz 0,55 läuft die Mittentönung
    aus, und genau das tut das Vorbild im Dorf auch (11 296 der 131 072
    Bytes unterscheiden sich, alle im hellen Teil der Tabelle).

    Prüfbar ist deshalb die Eigenschaft, auf die es ankommt: die
    Lichterzeile kann nur ZUR unveränderten Farbe hin ziehen, nie von
    ihr weg. Keine Farbe, die das Vorbild nicht hat.
  */
  const mit055 = gradingLutDaten(DORF);
  const mit107 = gradingLutDaten(DORF_SCHWELLE_WILDNIS);
  let ungleich = 0;
  let wegVonEins = 0;
  let unterSchwelleUngleich = 0;
  for (let zi = 0; zi < K; zi++) {
    for (let yi = 0; yi < K; yi++) {
      for (let xi = 0; xi < K; xi++) {
        const luma =
          0.2126 * zuLinear(xi / (K - 1)) + 0.7152 * zuLinear(yi / (K - 1)) + 0.0722 * zuLinear(zi / (K - 1));
        const a = texel(mit055, xi, yi, zi);
        const b = texel(mit107, xi, yi, zi);
        const e = texel(eins, xi, yi, zi);
        for (let k = 0; k < 3; k++) {
          if (a[k] !== b[k]) {
            ungleich++;
            if (luma < 0.55) unterSchwelleUngleich++;
            if (Math.abs(a[k]! - e[k]!) > Math.abs(b[k]! - e[k]!)) wegVonEins++;
          }
        }
      }
    }
  }
  pruefe(
    unterSchwelleUngleich === 0,
    `unterhalb der Lichterschwelle 0,55 sind beide Tabellen gleich (${unterSchwelleUngleich} Abweichungen)`
  );
  pruefe(
    ungleich > 0 && wegVonEins === 0,
    `oberhalb zieht die Lichterzeile nur ZUR unveränderten Farbe hin (${ungleich} abweichende Kanäle, davon ${wegVonEins} in die falsche Richtung)`
  );

  /*
    Und die Wirkung selbst, an EINEM Texel: ein neutrales Grau tief im
    Schattenband. Die Zeile 0,911 / 0,788 / 0,956 muss es dunkler machen
    und dabei Grün am stärksten senken — genau das ist die bläuliche
    Schattentönung, um die es geht. Ein Vorzeichenfehler im Offset oder
    ein vertauschter Kanal fällt hier sofort auf.
  */
  const i8 = 8; // Eingang 8/31 = 0,258 sRGB → lineare Luminanz 0,053
  const [rD, gD, bD] = texel(mit055, i8, i8, i8);
  const [rE, gE, bE] = texel(eins, i8, i8, i8);
  pruefe(rD < rE && gD < gE && bD < bE, `neutrales Grau wird dunkler (${rE}/${gE}/${bE} → ${rD}/${gD}/${bD})`);
  pruefe(rE - rD < gE - gD, 'Grün wird stärker gesenkt als Rot');
  pruefe(bE - bD < rE - rD, 'Blau wird schwächer gesenkt als Rot — die Tönung geht ins Bläuliche');

  /*
    Gegenprobe am anderen Ende: Reines Weiss liegt weit über der
    Schattenschwelle 0,3 — die Schattenzeile darf es nicht anfassen.
    Im DORF liegt es zugleich auf der vollen Lichterschwelle (Luminanz
    1,0 ≥ lichterEnde 1,0), also läuft es durch die Eins und bleibt
    255/255/255. In der WILDNIS feuert die Lichterzeile nie, dort tönt
    die Mittenzeile bis ins Weiss hinein. Der Unterschied ist genau die
    Handschrift, um die es geht — und ein Weiss, das im Dorf NICHT
    neutral bliebe, hiesse, dass die Bandaufteilung verrutscht ist.
  */
  const weissDorf = texel(mit055, K - 1, K - 1, K - 1);
  const weissWildnis = texel(gradingLutDaten(WILDNIS), K - 1, K - 1, K - 1);
  pruefe(
    weissDorf[0] === 255 && weissDorf[1] === 255 && weissDorf[2] === 255,
    `Weiss bleibt im Dorf unangetastet (${weissDorf.join('/')})`
  );
  pruefe(
    weissWildnis[1] < 255 && weissWildnis[2] < weissWildnis[1]!,
    `Weiss wird in der Wildnis von der Mittenzeile gewärmt (${weissWildnis.join('/')})`
  );
}

console.log('\n(4) Der Nebel — die Shaderzeile, auf der EINE nebelEnde-Zahl steht');
{
  const shader = ShaderStore.IncludesShadersStore['fogFragment'] ?? '';
  pruefe(shader.length > 0, 'Babylons `fogFragment` ist geladen');
  // `!!` heisst beim Plugin-Manager „Regex ohne zusätzliche Flags" und
  // gehört nicht zum Muster.
  const muster = new RegExp(RX_PBR_NEBELKURVE.replace(/^!!/, ''));
  pruefe(
    muster.test(shader),
    `PbrNebelFix findet seine Zeile im Shader (Muster ${RX_PBR_NEBELKURVE})`
  );
  // Und der Zweck dahinter: Die Sonderkurve steht wirklich NUR im
  // PBR-Zweig. Stünde sie ausserhalb, träfe die Ersetzung auch den
  // Standard-Pfad und verschöbe dort den Nebel in die andere Richtung.
  const pbrZweig = shader.slice(shader.indexOf('#ifdef PBR'), shader.indexOf('#endif', shader.indexOf('#ifdef PBR')));
  pruefe(
    muster.test(pbrZweig),
    'die Zeile steht im `#ifdef PBR`-Zweig und nicht im gemeinsamen Pfad'
  );
}

console.log(
  fehler === 0
    ? '\nOK — Schattenzeile trifft die gemessenen Werte, Bänder sauber, Nebelkurve greifbar'
    : `\n${fehler} FEHLER`
);
process.exit(fehler > 0 ? 1 : 0);
