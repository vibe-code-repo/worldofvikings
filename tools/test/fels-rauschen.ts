/**
 * Prüft die Rauschmaske auf dem Felsanteil (`client/src/engine/
 * felsRauschen.ts`) — und zwar die Zusagen, die in ihrem Kopfkommentar
 * als Zahlen stehen.
 *
 * ── Wogegen dieser Test steht ────────────────────────────────────────
 * Fünf Arten, wie diese Maske still falsch wird. Keine davon wirft eine
 * Fehlermeldung, und vier davon sieht man auf dem Bild nicht:
 *
 *  (a) DER MITTELWERT WANDERT. Die Maske ist erwartungstreu KONSTRUIERT:
 *      `RAMPEN.fels.anteil` trägt die 0,425 des Vorbilds, und das
 *      Rauschen darf sie nur streuen, nicht verschieben. Seit der
 *      Ausschlag über 1,0 liegt, klemmt `max(0, …)` die untere Hälfte
 *      ab — und ein abgeschnittener Schwanz HEBT den Mittelwert. Der
 *      Ausgleich (`FELS_RAUSCHEN.ausgleich`) rechnet ihn heraus; wer an
 *      `staerke` oder `kurve` dreht und den Ausgleich stehen lässt,
 *      verschiebt den Deckel um Prozente, ohne dass es auffiele.
 *
 *  (b) REINER FELS. Das Vorbild hat auf der Ebene, um die es geht
 *      (`Terrain_Meadow_Rock_Moss_01`), **0,0 %** reine Texel
 *      (`design/original-boden.md` §A). Eine Maske, die über 0,95 kommt,
 *      malt eine Felswand, die es dort nicht gibt.
 *
 *  (c) KEIN REINES MOOS. Der Befund, der A11 ausgelöst hat: Die alte
 *      Maske (Ausschlag 0,9, keine Glättung) ließ NIRGENDS weniger als
 *      0,05 Fels stehen — der ganze Hang war Mischung. Das Vorbild hat
 *      19,2 % reine Moos-Texel.
 *
 *  (d) SHADER UND CPU LAUFEN AUSEINANDER. Die GLSL-Zeilen werden aus
 *      denselben Zahlen ERZEUGT wie die TypeScript-Fassung; dieser Test
 *      liest die erzeugten Zeilen und prüft, dass die Zahlen darin die
 *      der Tabelle sind. Ohne das ist die CPU-Fassung eine Abschrift,
 *      und eine Messmaske, die sie benutzt, misst eine andere Schicht
 *      als der Bildschirm zeigt.
 *
 *  (e) NICHT DETERMINISTISCH. Dieselbe Weltkoordinate muss denselben
 *      Wert liefern — sonst flackert der Fels beim Nachladen eines
 *      Chunks.
 *
 * ── Warum so viele Proben ────────────────────────────────────────────
 * 4·10⁶ (2000²) über 740 m Kantenlänge, also rund 31 Wellenlängen der
 * ersten Oktave. Weniger, und die Anteile an den Enden schwanken
 * zwischen zwei Läufen stärker als die Schranken, die sie prüfen.
 * Rechenzeit: knapp zwei Sekunden.
 *
 * Der Lauf braucht KEINE Assets — das ist Absicht: `felsRauschen.ts`
 * importiert bewusst kein Babylon, damit dieser Test im CI mitläuft.
 *
 *   npx tsx tools/test/fels-rauschen.ts
 */
import { FELS_RAUSCHEN, felsMaskeBei, felsRauschenGlsl } from '../../client/src/engine/felsRauschen.js';
import { RAMPEN } from '../../client/src/engine/terrainRampen.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/*
  Das Probenfeld. Der Ursprung ist der Referenzort der Messungen
  (10111 / −18649, Pose `hanghimmel`), der Schritt 0,37 m — klein genug,
  dass die zweite Oktave (≈ 9 m) mit 24 Proben je Welle abgetastet wird.
*/
const N = 2000;
const SCHRITT = 0.37;
const kF = new Float64Array(N * N);
{
  let k = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = (i - N / 2) * SCHRITT + 10111;
      const z = (j - N / 2) * SCHRITT - 18649;
      kF[k++] = RAMPEN.fels.anteil * felsMaskeBei(x, z);
    }
  }
}

let summe = 0;
let groesster = 0;
let rein = 0;
let leer = 0;
let dominant = 0;
let dominantSumme = 0;
for (const v of kF) {
  summe += v;
  if (v > groesster) groesster = v;
  if (v >= 0.95) rein++;
  if (v <= 0.05) leer++;
  if (v >= 0.5) {
    dominant++;
    dominantSumme += v;
  }
}
const n = kF.length;
const mittel = summe / n;
const anteilRein = (100 * rein) / n;
const anteilLeer = (100 * leer) / n;
const mittelDominant = dominantSumme / Math.max(1, dominant);

console.log(
  `\nMaske: skala ${String(FELS_RAUSCHEN.skala)} m · staerke ${String(FELS_RAUSCHEN.staerke)} · ` +
    `kurve ${String(FELS_RAUSCHEN.kurve)} · ausgleich ${String(FELS_RAUSCHEN.ausgleich)}\n` +
    `${String(n)} Proben: Mittel ${mittel.toFixed(4)} · groesster ${groesster.toFixed(3)} · ` +
    `>= 0,95 ${anteilRein.toFixed(2)} % · <= 0,05 ${anteilLeer.toFixed(1)} % · ` +
    `dominant ${((100 * dominant) / n).toFixed(1)} % mit Mittel ${mittelDominant.toFixed(3)}\n`
);

/*
  (a) Der Erwartungswert. 0,5 % ist die Schranke, weil der Ausgleich als
  gerundete Konstante in der Tabelle steht (fünf Nachkommastellen) und
  das Probenfeld selbst eine Stichprobe ist.
*/
check(
  'der Erwartungswert der Maske ist der Deckel aus RAMPEN',
  Math.abs(mittel / RAMPEN.fels.anteil - 1) < 0.005,
  `${mittel.toFixed(4)} gegen ${RAMPEN.fels.anteil.toFixed(4)} (${((mittel / RAMPEN.fels.anteil - 1) * 100).toFixed(2)} %)`
);

/* (b) Reiner Fels: das Vorbild hat 0,0 % davon. */
check(
  'nirgends reiner Fels (Vorbild: 0,0 % Texel über 0,95)',
  anteilRein < 0.05 && groesster < 0.95,
  `groesster ${groesster.toFixed(3)}, ${anteilRein.toFixed(2)} % über 0,95`
);

/*
  (c) Reines Moos: das Vorbild hat 19,2 %. Das Band 14…24 % lässt Platz
  für eine spätere Feinjustierung an `staerke`, ohne dass der Test bei
  jedem Zehntel rot wird — aber es schliesst die 0,0 % der alten Maske
  sicher aus.
*/
check(
  'es gibt reines Moos (Vorbild: 19,2 % Texel unter 0,05)',
  anteilLeer > 14 && anteilLeer < 24,
  `${anteilLeer.toFixed(1)} %`
);

/*
  Und der Grund, warum das Ganze überhaupt gedreht wurde: Wo der Fels
  gewinnt, soll er DEUTLICH gewinnen. 0,558 war der alte Wert; alles
  unter 0,65 wäre ein Rückbau.
*/
check(
  'wo Fels die stärkste Schicht ist, steht er deutlich vorn',
  mittelDominant > 0.65,
  `Mittel kFels dort ${mittelDominant.toFixed(3)} (alte Maske: 0,558)`
);

/* (d) Die erzeugten GLSL-Zeilen tragen die Zahlen der Tabelle. */
{
  const zeilen = felsRauschenGlsl();
  const glsl = zeilen.join('\n');
  const glaettungen = zeilen.filter((z) => z.includes('n = n * n * (3.0 - 2.0 * n)')).length;
  check(
    'das erzeugte GLSL hat so viele Glättungen wie die Tabelle sagt',
    glaettungen === FELS_RAUSCHEN.kurve,
    `${String(glaettungen)} gegen ${String(FELS_RAUSCHEN.kurve)}`
  );
  check(
    'das erzeugte GLSL trägt Wellenlänge, Ausschlag und Ausgleich',
    glsl.includes(`1.0 / ${FELS_RAUSCHEN.skala.toFixed(1)}`) &&
      glsl.includes(FELS_RAUSCHEN.staerke.toFixed(3)) &&
      glsl.includes((1 / FELS_RAUSCHEN.ausgleich).toFixed(6)),
    glsl.split('\n').slice(-3).join(' | ')
  );
  check(
    'das erzeugte GLSL klemmt nach unten',
    glsl.includes('max(0.0, 1.0 +'),
    'ohne die Klemme wird der Felsanteil negativ und der Lerp läuft rückwärts'
  );
}

/* (e) Determinismus. */
{
  const proben: [number, number][] = [
    [10111, -18649],
    [10111.5, -18649.5],
    [-27820, -5900],
    [0, 0],
    [-1e5, 7.25e4],
  ];
  const eins = proben.map(([x, z]) => felsMaskeBei(x, z));
  const zwei = proben.map(([x, z]) => felsMaskeBei(x, z));
  check(
    'dieselbe Weltkoordinate liefert denselben Wert',
    eins.every((v, i) => v === zwei[i]),
    eins.map((v) => v.toFixed(6)).join(' ')
  );
  check(
    'auch negative Koordinaten liefern einen Wert im Band',
    eins.every((v) => Number.isFinite(v) && v >= 0 && v <= 1 + FELS_RAUSCHEN.staerke),
    eins.map((v) => v.toFixed(4)).join(' ')
  );
}

console.log(fehler === 0 ? '\nalle Prüfungen grün' : `\n${String(fehler)} Prüfung(en) fehlgeschlagen`);
process.exit(fehler > 0 ? 1 : 0);
