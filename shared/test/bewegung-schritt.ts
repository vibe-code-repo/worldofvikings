/**
 * Der Bewegungsschritt ohne Welt: Akkumulator, Gleitregel, Schwerkraft.
 *
 * Was hier NICHT geprueft wird und warum: Strahlhoehen, Stufen und
 * Haenge sind Eigenschaften der SERVERSEITIGEN Abfrage
 * (`Kollisionswelt`), nicht dieser reinen Regeln — sie stehen in
 * `server/test/kollision-schritt.ts` und werden dort an echten Kisten
 * gemessen. Hier steht, was ohne jede Geometrie entschieden wird.
 *
 * Lauf: npx tsx shared/test/bewegung-schritt.ts   (aus shared/)
 */
import {
  neuerAkkumulator,
  weiter,
} from '../src/bewegung/festerSchritt.js';
import { gleitBewegung } from '../src/bewegung/gleiten.js';
import { bewegungsSchritt } from '../src/bewegung/schritt.js';
import { ebenerBoden, OHNE_HINDERNISSE, type HindernisAbfrage, type Treffer } from '../src/bewegung/abfragen.js';
import {
  BODEN_KLEBEN,
  FALL_TEMPO,
  GEH_TEMPO,
  KOERPER_RADIUS,
  LAUF_TEMPO,
  KOERPER_HOEHE,
  MAX_SCHRITTE,
  SCHRITT_LAENGE,
  STEIGUNGS_GRENZE_COS,
  STEIGUNGS_GRENZE_GRAD,
  STRAHL_HOEHEN,
  STUFEN_HOEHE,
  istWand,
} from '../src/bewegung/masse.js';
import type { Vek3 } from '../src/kollision/form.js';

let fehler = 0;
function pruefe(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else { console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`); fehler++; }
}
const nah = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

console.log('=== Bewegungsschritt (rein) ===');

// ── [1] Akkumulator ────────────────────────────────────────────────
console.log('\n[1] Fester Schritt:');
{
  let akku = neuerAkkumulator();
  let summe = 0;
  for (let i = 0; i < 30; i += 1) {
    const e = weiter(akku, 1 / 30);
    akku = e.akku;
    summe += e.schritte;
  }
  pruefe('30 Aufrufe zu 1/30 s ergeben 60 Schritte', summe === 60, `${summe}`);

  let akku2 = neuerAkkumulator();
  let summe2 = 0;
  for (let i = 0; i < 60; i += 1) {
    const e = weiter(akku2, 1 / 60);
    akku2 = e.akku;
    summe2 += e.schritte;
  }
  pruefe('60 Aufrufe zu 1/60 s ergeben dieselben 60 Schritte', summe2 === 60, `${summe2}`);

  const klein = weiter(neuerAkkumulator(), SCHRITT_LAENGE / 2);
  pruefe('halbe Schrittzeit kauft keinen Schritt', klein.schritte === 0);
  pruefe('… und wird getragen', nah(klein.akku.rest, SCHRITT_LAENGE / 2, 1e-15));

  const lang = weiter(neuerAkkumulator(), 3);
  pruefe('3 s Rueckstand wird gedeckelt', lang.schritte === MAX_SCHRITTE, `${lang.schritte}`);
  pruefe('… der Ueberschuss wird verworfen, nicht getragen',
    lang.akku.rest === 0 && lang.verworfen > 2.9, `verworfen ${lang.verworfen.toFixed(3)} s`);

  let werfe = false;
  try { weiter(neuerAkkumulator(), Number.NaN); } catch { werfe = true; }
  pruefe('NaN als Spanne wirft', werfe);
}

// ── [2] Gleitregel ─────────────────────────────────────────────────
console.log('\n[2] Gleiten:');

/**
 * Hindernisabfrage aus senkrechten Ebenen — das Rechteck auf dem Papier.
 *
 * Jede Ebene ist ein Halbraum: `punkt` liegt darauf, `normale` zeigt
 * heraus. Eine Ebene, auf die sich die Bewegung nicht zubewegt, meldet
 * nichts — dieselbe Regel, die die echte Abfrage einhaelt, und zugleich
 * die, ohne die niemand rueckwaerts aus einer Ecke kommt.
 */
function ebenenAbfrage(
  ebenen: ReadonlyArray<{ punkt: Vek3; normale: Vek3 }>,
  zaehler?: { n: number }
): HindernisAbfrage {
  return {
    ersterTreffer(von: Vek3, nach: Vek3, radius: number): Treffer | null {
      if (zaehler) zaehler.n += 1;
      const wx = nach.x - von.x, wz = nach.z - von.z;
      const weg = Math.sqrt(wx * wx + wz * wz);
      if (weg === 0) return null;
      const dx = wx / weg, dz = wz / weg;
      const reich = weg + radius;
      let best: Treffer | null = null;
      for (const e of ebenen) {
        const naeherung = dx * e.normale.x + dz * e.normale.z;
        if (naeherung > -1e-9) continue;
        const abstand =
          ((von.x - e.punkt.x) * e.normale.x + (von.z - e.punkt.z) * e.normale.z) / -naeherung;
        if (abstand < 0 || abstand > reich) continue;
        if (best === null || abstand < best.abstand) {
          best = {
            normale: e.normale,
            abstand,
            punkt: { x: von.x + dx * abstand, y: von.y, z: von.z + dz * abstand },
          };
        }
      }
      return best;
    },
  };
}

const boden0 = ebenerBoden(0);
const wandX = { punkt: { x: 1, y: 0, z: 0 }, normale: { x: -1, y: 0, z: 0 } };
const wandZ = { punkt: { x: 0, y: 0, z: 1 }, normale: { x: 0, y: 0, z: -1 } };
const von0: Vek3 = { x: 0, y: 0, z: 0 };

{
  const frontal = gleitBewegung({
    von: von0, nachX: 2, nachZ: 0, radius: KOERPER_RADIUS,
    boden: boden0, hindernis: ebenenAbfrage([wandX]),
  });
  pruefe('frontal gegen die Wand: Stopp',
    frontal.blockiert && frontal.x === 0 && frontal.z === 0);

  // 45 Grad: die Haelfte laeuft in die Wand, die Haelfte daran entlang.
  const schraeg = gleitBewegung({
    von: von0, nachX: 2, nachZ: 2, radius: KOERPER_RADIUS,
    boden: boden0, hindernis: ebenenAbfrage([wandX]),
  });
  pruefe('45 Grad gegen die Wand: gleitet mit VOLLER Restbewegung',
    !schraeg.blockiert && nah(schraeg.x, 0) && nah(schraeg.z, 2),
    `x=${schraeg.x.toFixed(3)} z=${schraeg.z.toFixed(3)}`);

  // 30 Grad zur Wand (flach) und 60 Grad (steil) — beide gleiten, und die
  // erhaltene Strecke ist in beiden Faellen die Komponente entlang.
  for (const [name, wx, wz] of [['30 Grad', 2, 1.1547], ['60 Grad', 1.1547, 2]] as const) {
    const g = gleitBewegung({
      von: von0, nachX: wx, nachZ: wz, radius: KOERPER_RADIUS,
      boden: boden0, hindernis: ebenenAbfrage([wandX]),
    });
    pruefe(`${name} gegen die Wand: gleitet entlang`,
      !g.blockiert && nah(g.x, 0) && nah(g.z, wz), `z=${g.z.toFixed(4)}`);
  }

  const ecke = gleitBewegung({
    von: von0, nachX: 2, nachZ: 2, radius: KOERPER_RADIUS,
    boden: boden0, hindernis: ebenenAbfrage([wandX, wandZ]),
  });
  pruefe('Ecke: Stopp statt Entscheidung fuer eine Wand',
    ecke.blockiert && ecke.x === 0 && ecke.z === 0);

  // Rueckwaerts aus der Ecke: beide Waende liegen hinter der Bewegung.
  const raus = gleitBewegung({
    von: { x: 0.99, y: 0, z: 0.99 }, nachX: -0.01, nachZ: -0.01, radius: KOERPER_RADIUS,
    boden: boden0, hindernis: ebenenAbfrage([wandX, wandZ]),
  });
  pruefe('rueckwaerts aus der Ecke: frei',
    !raus.blockiert && nah(raus.x, -0.01) && nah(raus.z, -0.01));

  const zaehler = { n: 0 };
  gleitBewegung({
    von: von0, nachX: 0, nachZ: 0, radius: KOERPER_RADIUS,
    boden: boden0, hindernis: ebenenAbfrage([wandX], zaehler),
  });
  pruefe('Nullbewegung kostet keine Abfrage', zaehler.n === 0, `${zaehler.n} Abfragen`);

  // Hoechstens zwei Umlenkungen, also hoechstens drei Abfragen.
  const zaehler2 = { n: 0 };
  gleitBewegung({
    von: von0, nachX: 2, nachZ: 2, radius: KOERPER_RADIUS,
    boden: boden0, hindernis: ebenenAbfrage([wandX, wandZ], zaehler2),
  });
  pruefe('hoechstens drei Abfragen je Bewegung', zaehler2.n <= 3, `${zaehler2.n}`);
}

// ── [3] Wand oder Hang ─────────────────────────────────────────────
console.log('\n[3] Wand oder Hang:');
{
  // Normale einer Flaeche mit Neigung a: y = cos(a).
  const normaleBei = (grad: number): Vek3 => {
    const r = (grad * Math.PI) / 180;
    return { x: Math.sin(r), y: Math.cos(r), z: 0 };
  };
  // Die Grenze ist seit dem 11.09.2026 60 Grad (Originalwert des
  // Vorbilds, Entscheidung Mike). 45 und 55 sind das, was vorher Wand war
  // und jetzt Hang sein MUSS; 65 ist die Gegenprobe.
  pruefe('35 Grad ist Hang', !istWand(normaleBei(35)));
  pruefe('45 Grad ist Hang (bis 11.09.2026 Wand)', !istWand(normaleBei(45)));
  pruefe('55 Grad ist Hang', !istWand(normaleBei(55)));
  pruefe('65 Grad ist Wand', istWand(normaleBei(65)));
  pruefe('senkrecht ist Wand', istWand({ x: 1, y: 0, z: 0 }));
  pruefe('waagerecht ist Hang', !istWand({ x: 0, y: 1, z: 0 }));

  // Das Literal gegen seine Herleitung: `masse.ts` darf keine
  // Trigonometrie rufen, also steht der Kosinus als Zahl da — und genau
  // deshalb muss EIN Test nachrechnen, dass es die richtige ist.
  pruefe('STEIGUNGS_GRENZE_COS ist cos(STEIGUNGS_GRENZE_GRAD)',
    Math.abs(STEIGUNGS_GRENZE_COS - Math.cos((STEIGUNGS_GRENZE_GRAD * Math.PI) / 180)) < 1e-12,
    `${STEIGUNGS_GRENZE_COS} vs. ${Math.cos((STEIGUNGS_GRENZE_GRAD * Math.PI) / 180)}`);

  pruefe('der untere Strahl liegt zwischen Stufenhoehe und 0,5 m',
    STRAHL_HOEHEN[0]! > STUFEN_HOEHE && STRAHL_HOEHEN[0]! < 0.5,
    `${STRAHL_HOEHEN[0]} m`);

  /*
    Die beiden Sweep-Kugeln des Servers, nachgerechnet (s.
    `Kollisionswelt.ersterTreffer` und den Kopf von `STRAHL_HOEHEN`):

      untere Kugel  Mitte STRAHL_HOEHEN[0] + r   → oben  +r
      obere  Kugel  Mitte STRAHL_HOEHEN[1]       → oben  +r, unten −r

    Zwei Bedingungen, und beide haengen an der Kapselhoehe:
    der Scheitel der oberen Kugel IST der Scheitel der Kapsel, und
    zwischen den Kugeln darf keine Luecke klaffen — sonst faellt ein
    waagerechter Balken genau hindurch, ohne getroffen zu werden.
  */
  const r = KOERPER_RADIUS;
  const untenOben = STRAHL_HOEHEN[0]! + r + r;
  const obenUnten = STRAHL_HOEHEN[1]! - r;
  const obenOben = STRAHL_HOEHEN[1]! + r;
  pruefe('die obere Sweep-Kugel endet auf Kapselhoehe',
    Math.abs(obenOben - KOERPER_HOEHE) < 1e-9,
    `${obenOben.toFixed(3)} m vs. ${KOERPER_HOEHE} m`);
  pruefe('zwischen den beiden Sweep-Kugeln klafft keine Luecke',
    obenUnten <= untenOben + 1e-9,
    `untere bis ${untenOben.toFixed(3)} m, obere ab ${obenUnten.toFixed(3)} m ` +
      `(Ueberdeckung ${(untenOben - obenUnten).toFixed(3)} m)`);
}

// ── [4] Senkrecht: Kleben und Fallen ───────────────────────────────
console.log('\n[4] Schwerkraft und Bodenkleben:');
{
  const stehen = { x: 0, z: 0, rennt: false };
  const knapp = bewegungsSchritt(
    { x: 0, y: BODEN_KLEBEN - 0.01, z: 0 }, stehen, SCHRITT_LAENGE, boden0, OHNE_HINDERNISSE);
  pruefe('Boden knapp unter dem Fuss: aufgesetzt statt fallen', nah(knapp.y, 0));

  const weit = bewegungsSchritt(
    { x: 0, y: 5, z: 0 }, stehen, SCHRITT_LAENGE, boden0, OHNE_HINDERNISSE);
  pruefe('darueber: faellt mit fester Rate',
    nah(weit.y, 5 - FALL_TEMPO * SCHRITT_LAENGE, 1e-12), `${weit.y.toFixed(4)}`);

  const unten = bewegungsSchritt(
    { x: 0, y: -3, z: 0 }, stehen, SCHRITT_LAENGE, boden0, OHNE_HINDERNISSE);
  pruefe('unter dem Boden: hochgesetzt', nah(unten.y, 0));

  // Tempo: eine Sekunde geradeaus, ohne Hindernisse.
  let z = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 60; i += 1) {
    z = bewegungsSchritt(z, { x: 0, z: 1, rennt: false }, SCHRITT_LAENGE, boden0, OHNE_HINDERNISSE);
  }
  pruefe('60 Schritte gehen = Gehtempo', nah(z.z, GEH_TEMPO, 1e-9), `${z.z.toFixed(6)} m`);

  let zr = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 60; i += 1) {
    zr = bewegungsSchritt(zr, { x: 0, z: 1, rennt: true }, SCHRITT_LAENGE, boden0, OHNE_HINDERNISSE);
  }
  pruefe('60 Schritte rennen = Lauftempo', nah(zr.z, LAUF_TEMPO, 1e-9), `${zr.z.toFixed(6)} m`);
}

console.log(`\n${fehler === 0 ? 'ALLE GRUEN' : `${fehler} FEHLGESCHLAGEN`}`);
process.exit(fehler > 0 ? 1 : 0);
