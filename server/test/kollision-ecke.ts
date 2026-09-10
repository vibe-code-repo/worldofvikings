/**
 * Der Kugel-Sweep: was die drei versetzten Strahlen nicht sahen.
 *
 * WORUM ES GEHT. Bis zum 11.09.2026 tastete `Kollisionswelt.ersterTreffer`
 * die Figur je Hoehe mit DREI Strahlen ab — Mitte und je einer um einen
 * Koerperradius quer zur Laufrichtung versetzt. Das ist eine Punktabtastung
 * eines flaechigen Koerpers: Zwischen den Abtastpunkten liegt Nichts. Ein
 * Zaunpfosten oder ein Wandende, das lateral GENAU dazwischen steht, wird
 * von keinem Strahl getroffen, und die Figur laeuft hindurch.
 *
 * Seither faehrt je Hoehe eine KUGEL vom Halbmesser r den Weg entlang. Die
 * hat keine Luecke, weil sie kein Buendel ist.
 *
 * WAS DIESE DATEI FESTHAELT, und in welcher Reihenfolge:
 *
 *  [1] Der ZAEHLBEWEIS. Ein feiner Scan ueber Winkel und Standort um ein
 *      Wandende: Wie viele Einzelschritte, die die Wand geometrisch
 *      BERUEHREN wuerden, meldet die Abfrage nicht? Die Sollzahl ist 0.
 *      Mit den drei Strahlen waren es an derselben Geometrie 782 von
 *      4141 (18,9 %) bei 2,5 cm Wanddicke, 534 von 5659 (9,4 %) bei
 *      10 cm und 336 von 6583 (5,1 %) bei 40 cm — die Zahlen stehen hier,
 *      weil eine Rueckkehr zur Punktabtastung sonst nur „ein Test wird
 *      rot" waere und nicht „so gross war das Loch".
 *
 *  [2] Der ANSCHAULICHE FALL. Ein Zaunpfosten (5 cm) seitlich versetzt.
 *      Bei 0,1 / 0,2 / 0,3 m Versatz lief die Figur frueher glatt
 *      hindurch — gemessen kam sie ihm dabei auf 0,075 / 0,175 / 0,275 m
 *      nahe, wo 0,40 die Untergrenze ist —, bei 0 und 0,39 m nicht.
 *      Genau das Muster einer Luecke ZWISCHEN den Abtastpunkten, die bei
 *      0 und ±0,4 lagen.
 *
 *  [3] Die ECKE. Diagonal in die Innenecke zweier Waende, drei Dicken mal
 *      drei Winkel — und dazu die Gegenprobe von aussen: ein
 *      geschlossener Raum, aus dem die Figur an keiner Ecke ausbricht.
 *
 *      NACHTRAG ZUM PRUEFERBERICHT: Der Angreifer-Pruefer hat die Ecke
 *      als L aus zwei Segmenten gebaut, die AN der Ecke enden. Ein L
 *      umschliesst nichts — die Figur kann am offenen Ende vorbei und
 *      aussen herum in das Zielviertel laufen, ganz ohne durch eine Wand
 *      zu gehen. Seine drei Reproduktionen melden deshalb auch mit dem
 *      Sweep noch „DURCH DIE ECKE"; nachgemessen ist das ein Fehler des
 *      PRUEFKRITERIUMS, nicht der Geometrie. Die Ecken hier sind
 *      geschlossen, und die Luecke, die er richtig erkannt hat (laterale
 *      Punktabtastung), steht in [1] und [2] mit Zahlen.
 *
 *  [4] Die BERUEHRUNG. Steht die Figur schon an der Wand (Abstand < r,
 *      weil der Client sie drangestellt hat), muss „weiter hinein"
 *      blockiert und „wieder weg" frei sein. Ohne diese Unterscheidung
 *      klebte die Figur ab der ersten Beruehrung fest — oder liefe
 *      hindurch.
 *
 *  [5] Die GRENZE. Ein Spalt, der schmaler ist als die Figur, bleibt
 *      passierbar, und das ist kein Versehen: Beide Wandflaechen stehen
 *      dann senkrecht auf der Laufrichtung, keine von beiden wird
 *      ANGENAEHERT, also blockiert keine. Der Test haelt fest, ab welcher
 *      Breite sich das aendert.
 *
 * Lauf: npx tsx server/test/kollision-ecke.ts   (aus server/)
 */
import { createWovServer } from '../src/WovServer.js';
import { Kollisionswelt } from '../src/world/Kollisionswelt.js';
import type { KollisionsForm, Vek3 } from '@wov/shared/src/kollision/form.js';
import { bewegungsSchritt } from '@wov/shared/src/bewegung/schritt.js';
import { KOERPER_RADIUS, SCHRITT_LAENGE } from '@wov/shared/src/bewegung/masse.js';

let fehler = 0;
function pruefe(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else { console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`); fehler++; }
}

console.log('=== Kugel-Sweep: Ecken, Wandenden, laterale Luecken ===');

const server = createWovServer({ port: 2473, worldSeed: 'KxSYuZquuw', worldFeatures: false });
server.init();

const kiste = (min: Vek3, max: Vek3): KollisionsForm => ({ art: 'kiste', min, max });

/** Dieselbe Kiste als Netz — 12 Dreiecke, gleiche Antwort erwartet. */
function netzKiste(min: Vek3, max: Vek3): KollisionsForm {
  const p = new Float32Array([
    min.x, min.y, min.z, max.x, min.y, min.z, max.x, max.y, min.z, min.x, max.y, min.z,
    min.x, min.y, max.z, max.x, min.y, max.z, max.x, max.y, max.z, min.x, max.y, max.z,
  ]);
  const i = new Uint32Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
    3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ]);
  return { art: 'netz', positionen: p, indizes: i, min, max };
}

// Ebener Boden auf 0: geprueft werden die Formen, nicht das Gelaende.
const eben = new Kollisionswelt(server.zdos, server.prefabs, () => 0);

function laufe(
  nah: ReturnType<Kollisionswelt['nahfeldAus']>,
  start: { x: number; y: number; z: number },
  eingabe: { x: number; z: number; rennt: boolean },
  sekunden: number
): { x: number; y: number; z: number } {
  let p = start;
  const schritte = Math.round(sekunden / SCHRITT_LAENGE);
  for (let i = 0; i < schritte; i += 1) p = bewegungsSchritt(p, eingabe, SCHRITT_LAENGE, nah, nah);
  return p;
}

/** Waagerechter Abstand eines Punktes zu einer achsenparallelen Kiste. */
function abstandXZ(x: number, z: number, min: Vek3, max: Vek3): number {
  const dx = Math.max(min.x - x, 0, x - max.x);
  const dz = Math.max(min.z - z, 0, z - max.z);
  return Math.sqrt(dx * dx + dz * dz);
}

// ── [1] Der Zaehlbeweis am Wandende ────────────────────────────────
/*
  Ein Wandstueck, das bei (0,0) ENDET. Darum herum wird jeder Standort
  (5-cm-Raster) mit jeder Richtung (5-Grad-Raster) EINEN Schritt weit
  (12,5 cm, ein 60-Hz-Takt) probiert. Gezaehlt werden nur die Schritte,
  die WIRKLICH etwas aendern: Start ausserhalb des Koerperprofils, Ziel
  innerhalb. Jeder davon naehert sich der Wand — die Abfrage MUSS ihn
  melden. Was sie nicht meldet, ist ein Loch.

  Das Kriterium rechnet die Geometrie selbst nach (Punkt-Kiste-Abstand)
  und fragt nicht die Abfrage nach ihrer eigenen Meinung — sonst pruefte
  der Test seine Vorlage statt der Sache.
*/
console.log('\n[1] Wandende, Scan ueber Winkel und Standort:');
for (const d of [0.025, 0.1, 0.4]) {
  const min = { x: -10, y: 0, z: -d }, max = { x: 0, y: 2, z: d };
  const nah = eben.nahfeldAus([{ form: kiste(min, max), position: { x: 0, y: 0, z: 0 } }]);
  let unbemerkt = 0, geprueft = 0;
  for (let grad = 5; grad < 360; grad += 5) {
    const w = (grad * Math.PI) / 180;
    const vx = Math.cos(w), vz = Math.sin(w);
    for (let ix = -24; ix <= 24; ix += 1) {
      for (let iz = -24; iz <= 24; iz += 1) {
        const px = ix * 0.05, pz = iz * 0.05;
        if (abstandXZ(px, pz, min, max) < KOERPER_RADIUS) continue;   // Fluchttuer-Fall
        const nx = px + vx * 0.125, nz = pz + vz * 0.125;
        if (abstandXZ(nx, nz, min, max) >= KOERPER_RADIUS) continue;  // Soll: frei
        geprueft += 1;
        if (nah.ersterTreffer({ x: px, y: 0, z: pz }, { x: nx, y: 0, z: nz }, KOERPER_RADIUS) === null) {
          unbemerkt += 1;
        }
      }
    }
  }
  pruefe(`Wanddicke ${d} m: kein beruehrender Schritt bleibt unbemerkt`,
    unbemerkt === 0, `${unbemerkt} von ${geprueft} (drei Strahlen: 782/534/336)`);
}

// ── [2] Zaunpfosten seitlich versetzt ──────────────────────────────
/*
  Gemessen wird NICHT „bleibt stehen", sondern der geringste Abstand, den
  die Figur unterwegs zum Pfosten hatte. Der Unterschied ist wichtig, und
  er ist kein Formalismus: Ein 5-cm-Pfosten hat eine KANTE, und eine
  Kugel, die auf eine Kante trifft, bekommt eine schraege Normale und
  RUTSCHT daran vorbei — das ist die richtige Antwort und in der Kiste nur
  deshalb nicht zu sehen, weil deren Minkowski-Naeherung (aufgeblasene
  Kiste, eckig statt rund) eine flache Flaeche vorlegt, an der es nichts
  zu rutschen gibt. „Haelt an" waere also je nach Formart ein anderes
  Ergebnis; „kommt dem Pfosten nie naeher als r" ist fuer beide dasselbe
  und ist genau das, worum es geht.
*/
console.log('\n[2] Zaunpfosten (5 cm) seitlich versetzt, Lauf in +x:');
{
  const pMin = { x: -0.025, y: 0, z: -0.025 }, pMax = { x: 0.025, y: 2, z: 0.025 };
  for (const [form, art] of [[kiste, 'Kiste'], [netzKiste, 'Netz']] as const) {
    for (const versatz of [0, 0.1, 0.2, 0.3, 0.39]) {
      const nah = eben.nahfeldAus([{ form: form(pMin, pMax), position: { x: 0, y: 0, z: versatz } }]);
      let p = { x: -3, y: 0, z: 0 };
      let naechster = Infinity;
      for (let i = 0; i < Math.round(2 / SCHRITT_LAENGE); i += 1) {
        p = bewegungsSchritt(p, { x: 1, z: 0, rennt: true }, SCHRITT_LAENGE, nah, nah);
        const a = abstandXZ(p.x, p.z - versatz, pMin, pMax);
        if (a < naechster) naechster = a;
      }
      // 1 mm Nachsicht: ein fester Schritt ist 12,5 cm lang, der Halt
      // liegt also nie exakt auf r.
      pruefe(`${art}, Versatz ${versatz.toFixed(2)} m: kommt dem Pfosten nie naeher als r`,
        naechster >= KOERPER_RADIUS - 0.001,
        `min ${naechster.toFixed(3)} m, Ende x=${p.x.toFixed(2)} z=${p.z.toFixed(2)}`);
    }
    // Gegenprobe: knapp NEBEN dem Profil muss die Figur ungebremst
    // vorbeikommen — sonst haette der Sweep nur zu grob geblockt.
    const daneben = eben.nahfeldAus([{ form: form(pMin, pMax), position: { x: 0, y: 0, z: 0.45 } }]);
    const frei = laufe(daneben, { x: -3, y: 0, z: 0 }, { x: 1, z: 0, rennt: true }, 2);
    pruefe(`${art}, Versatz 0.45 m: kommt ungebremst vorbei`, frei.x > 11.9, `x=${frei.x.toFixed(3)}`);
  }
}

// ── [3] Ecken ──────────────────────────────────────────────────────
console.log('\n[3] Diagonal in die geschlossene Innenecke:');
for (const d of [0.025, 0.1, 0.4]) {
  const nah = eben.nahfeldAus([
    { form: kiste({ x: -d, y: 0, z: -10 }, { x: d, y: 2, z: 10 }), position: { x: 0, y: 0, z: 0 } },
    { form: kiste({ x: -10, y: 0, z: -d }, { x: 10, y: 2, z: d }), position: { x: 0, y: 0, z: 0 } },
  ]);
  for (const [mx, mz, grad] of [[0.7, 1, 35], [1, 1, 45], [1, 1.3, 52]] as const) {
    const e = laufe(nah, { x: -5, y: 0, z: -5.3 }, { x: mx, z: mz, rennt: true }, 3);
    pruefe(`Dicke ${d} m, ${grad} Grad: bleibt vor der Ecke`,
      e.x < -d && e.z < -d, `(${e.x.toFixed(3)}, ${e.z.toFixed(3)})`);
  }
}

console.log('\n[3b] Geschlossener Raum: an keiner Ecke ausbrechen:');
for (const d of [0.025, 0.1, 0.4]) {
  const W = 10;
  const wand = (min: Vek3, max: Vek3) => ({ form: kiste(min, max), position: { x: 0, y: 0, z: 0 } });
  const nah = eben.nahfeldAus([
    wand({ x: -W - d, y: 0, z: -W - d }, { x: -W + d, y: 2, z: W + d }),
    wand({ x: W - d, y: 0, z: -W - d }, { x: W + d, y: 2, z: W + d }),
    wand({ x: -W - d, y: 0, z: -W - d }, { x: W + d, y: 2, z: -W + d }),
    wand({ x: -W - d, y: 0, z: W - d }, { x: W + d, y: 2, z: W + d }),
  ]);
  let ausbrueche = 0;
  for (const [mx, mz] of [[0.7, 1], [1, 1], [1, 1.3], [-1, -1], [1, -1], [-1, 1], [-1.3, 1], [1, -0.7]] as const) {
    const e = laufe(nah, { x: 0, y: 0, z: 0 }, { x: mx, z: mz, rennt: true }, 6);
    if (Math.abs(e.x) > W + d || Math.abs(e.z) > W + d) ausbrueche += 1;
  }
  pruefe(`Wanddicke ${d} m: acht Diagonalen, kein Ausbruch`, ausbrueche === 0, `${ausbrueche} Ausbrueche`);
}

// ── [4] Beruehrung beim Start ──────────────────────────────────────
/*
  Der Client stellt die Figur an die Wand; der Server bekommt eine
  Position, deren Abstand zur Flaeche KLEINER ist als der Koerperradius.
  Frueher fiel das unter „Strahl beginnt innen = frei" — die Figur waere
  ab der ersten Beruehrung durch die Wand gelaufen. Jetzt entscheidet das
  Vorzeichen des Abstands: hinein blockiert, heraus nicht.
*/
console.log('\n[4] Beruehrung beim Start (Abstand < r):');
{
  // Wand bei x = 0 (Dicke 0,1), Figur 0,3 m davor — also in Beruehrung.
  const nah = eben.nahfeldAus([
    { form: kiste({ x: -0.05, y: 0, z: -10 }, { x: 0.05, y: 2, z: 10 }), position: { x: 0, y: 0, z: 0 } },
  ]);
  const von = { x: -0.35, y: 0, z: 0 };
  const hinein = nah.ersterTreffer(von, { x: -0.325, y: 0, z: 0 }, KOERPER_RADIUS);
  pruefe('weiter in die Wand: blockiert', hinein !== null,
    hinein ? `Normale x=${hinein.normale.x.toFixed(2)}, Abstand ${hinein.abstand.toFixed(3)}` : 'frei');
  const heraus = nah.ersterTreffer(von, { x: -0.375, y: 0, z: 0 }, KOERPER_RADIUS);
  pruefe('wieder heraus: frei', heraus === null);
  const entlang = nah.ersterTreffer(von, { x: -0.35, y: 0, z: 0.125 }, KOERPER_RADIUS);
  pruefe('an der Wand entlang: frei', entlang === null);
  // Und die Figur bleibt beweglich: sie klebt nicht fest.
  const weg = laufe(nah, von, { x: -1, z: 0, rennt: true }, 1);
  pruefe('aus der Beruehrung heraus laufen: kommt weg', weg.x < -7, `x=${weg.x.toFixed(2)}`);
  const seit = laufe(nah, von, { x: 0, z: 1, rennt: true }, 1);
  pruefe('aus der Beruehrung heraus seitwaerts: laeuft', seit.z > 7, `z=${seit.z.toFixed(2)}`);
}

// ── [5] Die Spaltgrenze ────────────────────────────────────────────
/*
  Zwei Wandstuecke mit einem Spalt dazwischen, laengs durchlaufen. Ein
  Spalt, der schmaler ist als die Figur (0,8 m), bleibt passierbar: Die
  Flaechen links und rechts stehen senkrecht auf der Laufrichtung, keine
  wird angenaehert, also blockiert keine. Das war vor dem Sweep so und ist
  es danach — die Zahl steht hier, damit eine spaetere Aenderung an dieser
  Regel auffaellt statt im Spiel.

  Wer sie zumachen will, braucht eine Durchdringungspruefung am ZIEL (die
  Figur DARF dort nicht stehen), nicht einen genaueren Sweep.
*/
console.log('\n[5] Spaltbreite, laengs durchlaufen:');
{
  const ergebnisse: string[] = [];
  for (const breite of [0.5, 0.8, 1.0]) {
    const h = breite / 2;
    const nah = eben.nahfeldAus([
      { form: kiste({ x: -1, y: -1, z: -3 }, { x: 8, y: 3, z: -h }), position: { x: 0, y: 0, z: 0 } },
      { form: kiste({ x: -1, y: -1, z: h }, { x: 8, y: 3, z: 3 }), position: { x: 0, y: 0, z: 0 } },
    ]);
    const e = laufe(nah, { x: -1, y: 0, z: 0 }, { x: 1, z: 0, rennt: false }, 2);
    ergebnisse.push(`${breite.toFixed(1)} m -> x=${e.x.toFixed(2)}`);
    pruefe(`Spalt ${breite.toFixed(1)} m: kommt hindurch (unveraenderte Grenze)`,
      e.x > 3, `x=${e.x.toFixed(2)}`);
  }
  console.log(`  MESSWERT Spaltgrenze: ${ergebnisse.join(', ')} (frei waeren 8.00)`);
}

console.log(fehler === 0 ? '\nALLE GRUEN' : `\n${fehler} FEHLER`);
process.exit(fehler > 0 ? 1 : 0);
