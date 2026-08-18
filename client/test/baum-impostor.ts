/**
 * Wächter für die Zuteilung echt/Sprite im Impostor-Fernfeld.
 *
 * ── Warum dieser Test in der Kernliste steht ─────────────────────────
 * Der Fehlermodus dieses Umbaus ist nicht Ruckeln, sondern FEHLENDE oder
 * DOPPELTE Darstellung: Ein Baum, den weder der Zell-Master noch das
 * Sprite-Feld zeichnet — oder den beide zeichnen. Beides ist beim
 * Durchklicken praktisch unauffindbar, weil es blickwinkel- und
 * positionsabhängig ist und keine Meldung erzeugt.
 *
 * Genau deshalb liegt die Regel als reine Arithmetik in
 * client/src/engine/BaumImpostorKern.ts (ohne Babylon, ohne DOM, ohne
 * Zustand) und wird hier festgehalten. Der Test braucht keine Assets,
 * keine GPU und läuft in Sekunden — die Bedingung, um in der Kernliste zu
 * stehen.
 *
 * Festgehalten wird:
 *  1. Das Atlasraster ist überschneidungsfrei und bricht LAUT, statt
 *     still eine Zeile auf eine andere zu legen.
 *  2. Die Kartenmasse decken jeden Gierwinkel ab (Worst-Case-Radius).
 *  3. Die drei Zelllagen greifen an den richtigen Stellen.
 *  4. DIE ZENTRALE ZUSICHERUNG: Jede Instanz landet in GENAU EINER
 *     Darstellung, und der billige Zell-Vorfilter kann der
 *     Pro-Instanz-Regel niemals widersprechen.
 *  5. Ein Prototyp ohne Atlas fällt auf die ECHTE Darstellung zurück —
 *     nie auf gar keine.
 */
import {
  ATLAS_GOSSE_PX,
  ATLAS_KANTE_PX,
  IMPOSTOR_ANSICHTEN,
  ZELL_BREITE_PX,
  ZELL_HOEHE_PX,
  ansichtRechteck,
  atlasRaster,
  karteMasse,
  teileZelle,
  yawUndSkala,
  zellFernkante,
  zellLage,
  zellNahkante,
} from '../src/engine/BaumImpostorKern.js';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('Impostor-Fernfeld: Atlasraster und Zuteilung echt/Sprite');

// ── 1. Atlasraster ───────────────────────────────────────────────────
{
  const r = atlasRaster();
  pruefe(r.spalten >= 1 && r.linien >= 1, 'Raster fasst nicht einmal eine Zeile');
  pruefe(
    r.zeilenBreitePx === ZELL_BREITE_PX * IMPOSTOR_ANSICHTEN,
    'Zeilenbreite passt nicht zur Ansichtszahl'
  );
  pruefe(r.budget === r.spalten * r.linien, 'Budget ist nicht Spalten x Linien');

  // Jede Ansicht jeder Zeile muss vollständig im Atlas liegen und darf
  // sich mit keiner anderen überschneiden. Ein Überlapp wäre kein
  // Absturz, sondern ein Baum, der die Krone eines anderen trägt.
  const belegt: Array<[number, number, number, number]> = [];
  for (let zeile = 0; zeile < r.budget; zeile++) {
    for (let a = 0; a < IMPOSTOR_ANSICHTEN; a++) {
      const rect = ansichtRechteck(zeile, a);
      pruefe(
        rect.x >= 0 && rect.y >= 0 && rect.x + rect.b <= ATLAS_KANTE_PX && rect.y + rect.h <= ATLAS_KANTE_PX,
        `Zeile ${zeile}/Ansicht ${a} ragt aus dem Atlas`
      );
      pruefe(
        rect.b === ZELL_BREITE_PX - 2 * ATLAS_GOSSE_PX &&
          rect.h === ZELL_HOEHE_PX - 2 * ATLAS_GOSSE_PX,
        `Zeile ${zeile}/Ansicht ${a} hat die falsche Grösse (Gosse fehlt?)`
      );
      belegt.push([rect.x, rect.y, rect.b, rect.h]);
    }
  }
  let ueberlapp = 0;
  for (let i = 0; i < belegt.length; i++) {
    for (let j = i + 1; j < belegt.length; j++) {
      const [ax, ay, ab, ah] = belegt[i]!;
      const [bx, by, bb, bh] = belegt[j]!;
      if (ax < bx + bb && bx < ax + ab && ay < by + bh && by < ay + ah) ueberlapp++;
    }
  }
  pruefe(ueberlapp === 0, `${ueberlapp} Paare von Atlasrechtecken überlappen sich`);

  // ── LAUT brechen, nicht still abschneiden ──────────────────────────
  // Ein gewachsenes Kit (der Vault-Merksatz sagt, dass regelmässig neue
  // Bäume dazukommen) darf nicht heimlich eine Zeile auf eine andere
  // legen. Der Kern wirft; das Babylon-Modul fängt und fällt auf die
  // echte Darstellung zurück (BaumImpostor.melde).
  let geworfen = false;
  try {
    ansichtRechteck(r.budget, 0);
  } catch {
    geworfen = true;
  }
  pruefe(geworfen, 'Zeile jenseits des Budgets wurde still akzeptiert');

  geworfen = false;
  try {
    ansichtRechteck(0, IMPOSTOR_ANSICHTEN);
  } catch {
    geworfen = true;
  }
  pruefe(geworfen, 'Ansicht jenseits der Ansichtszahl wurde still akzeptiert');
}

// ── 2. Kartenmasse ───────────────────────────────────────────────────
{
  // Ein Baum, dessen Krone einseitig 4 m nach +x und 3 m nach +z reicht:
  // beim Drehen um die Prefab-Achse überstreicht er einen Kreis mit
  // Radius 5. Eine Karte, die nur die Boxbreite (4+1=5) nähme, schnitte
  // die Krone bei 45 Grad ab.
  const m = karteMasse(-1, -1, 4, 3, 12);
  pruefe(Math.abs(m.breite - 10) < 1e-9, `Kartenbreite ${m.breite}, erwartet 10 (2 x Radius 5)`);
  pruefe(m.hoehe === 12, `Kartenhöhe ${m.hoehe}, erwartet 12`);

  // Wurzelanläufe unter dem Ursprung zählen nicht — die Basis der Karte
  // sitzt auf der ZDO-Höhe, sonst schwebt der Sprite.
  pruefe(karteMasse(-1, -1, 1, 1, -2).hoehe === 0, 'negative Höhe nicht auf 0 geklemmt');
}

// ── 3. Zellkanten und Lagen ──────────────────────────────────────────
{
  const Z = 384;
  // Spieler mitten in Zelle (0,0).
  pruefe(zellNahkante(0, 0, Z, 100, 100) === 0, 'Nahkante der eigenen Zelle ist nicht 0');
  pruefe(
    Math.abs(zellFernkante(0, 0, Z, 0, 0) - Math.hypot(Z, Z)) < 1e-9,
    'Fernkante der Eckposition falsch'
  );
  // Zelle (2,0) beginnt bei x = 768; von x = 100 aus ist die Nahkante 668.
  pruefe(Math.abs(zellNahkante(2, 0, Z, 100, 0) - 668) < 1e-9, 'Nahkante achsparallel falsch');

  // Die drei Lagen.
  pruefe(zellLage(0, 0, Z, 100, 100, 240, true) === 'geteilt', 'eigene Zelle müsste geteilt sein');
  pruefe(zellLage(3, 3, Z, 0, 0, 240, true) === 'fern', 'weit entfernte Zelle nicht als fern erkannt');
  // Kleine Zelle vollständig innerhalb der Grenze.
  pruefe(zellLage(0, 0, 50, 25, 25, 240, true) === 'nah', 'kleine Nahzelle nicht als nah erkannt');

  // ── 5. Fail-Soft: ohne Atlas NIE ein Sprite ────────────────────────
  // Der wichtigste Einzelfall dieses Tests. Ein Prototyp, dessen Backen
  // fehlgeschlagen ist oder dessen Zeilenbudget voll war, muss ECHT
  // gezeichnet werden — nicht gar nicht.
  pruefe(zellLage(3, 3, Z, 0, 0, 240, false) === 'nah', 'ohne Atlas wurde eine Sprite-Zelle erzeugt');
  pruefe(
    zellLage(99, 99, Z, 0, 0, 10, false) === 'nah',
    'ohne Atlas wurde eine sehr ferne Zelle zum Sprite'
  );
}

// ── 4. Die zentrale Zusicherung: genau EINE Darstellung ──────────────
{
  const Z = 384;
  const GRENZE = 240;
  const echt: number[] = [];
  const sprite: number[] = [];

  // Leere Zelle: nichts wird gezeichnet, aber auch nichts erfunden.
  teileZelle([], () => 0, () => 0, 'geteilt', 0, 0, GRENZE, echt, sprite);
  pruefe(echt.length === 0 && sprite.length === 0, 'leere Zelle lieferte Instanzen');

  // Eine Zelle exakt auf der Grenze, mit Instanzen davor, darauf und
  // dahinter. Die Grenze selbst gehört zur SPRITE-Seite (>=), damit die
  // beiden Intervalle [0,g) und [g,inf) lückenlos aneinanderstossen.
  const px = [100, 239.999, 240, 240.001, 600];
  const punkte = px.map((x) => [x, 0] as const);
  teileZelle(
    punkte.map((_, i) => i),
    (i) => punkte[i]![0],
    (i) => punkte[i]![1],
    'geteilt',
    0,
    0,
    GRENZE,
    echt,
    sprite
  );
  pruefe(echt.join(',') === '0,1', `echt=[${echt}] erwartet [0,1]`);
  pruefe(sprite.join(',') === '2,3,4', `sprite=[${sprite}] erwartet [2,3,4]`);

  // ── Partition über ein grobes Raster ──────────────────────────────
  // Und, wichtiger: der billige Zell-Vorfilter darf der
  // Pro-Instanz-Regel NIEMALS widersprechen. Wenn er das täte, entstünde
  // genau der Fehler, den niemand findet: eine Zelle, die als 'fern'
  // durchgewinkt wird, obwohl eine ihrer Instanzen noch diesseits liegt
  // (Sprite in Reichweite) — oder umgekehrt.
  let geprueft = 0;
  let abweichungen = 0;
  let doppelt = 0;
  let verloren = 0;
  const echtG: number[] = [];
  const spriteG: number[] = [];
  for (let sx = -500; sx <= 500; sx += 137) {
    for (let sz = -500; sz <= 500; sz += 191) {
      for (let cx = -3; cx <= 3; cx++) {
        for (let cz = -3; cz <= 3; cz++) {
          // 25 Instanzen gleichmässig über die Zelle verteilt.
          const pts: Array<readonly [number, number]> = [];
          for (let a = 0; a < 5; a++) {
            for (let b = 0; b < 5; b++) {
              pts.push([cx * Z + (a * Z) / 4, cz * Z + (b * Z) / 4] as const);
            }
          }
          const idx = pts.map((_, i) => i);
          const holeX = (i: number): number => pts[i]![0];
          const holeZ = (i: number): number => pts[i]![1];
          const lage = zellLage(cx, cz, Z, sx, sz, GRENZE, true);
          teileZelle(idx, holeX, holeZ, lage, sx, sz, GRENZE, echt, sprite);
          // Dieselbe Menge, aber mit erzwungener Pro-Instanz-Prüfung.
          teileZelle(idx, holeX, holeZ, 'geteilt', sx, sz, GRENZE, echtG, spriteG);
          if (echt.join(',') !== echtG.join(',') || sprite.join(',') !== spriteG.join(',')) {
            abweichungen++;
          }
          // Partition: Vereinigung = alles, Schnitt = leer.
          const gesehen = new Set<number>();
          for (const i of echt) {
            if (gesehen.has(i)) doppelt++;
            gesehen.add(i);
          }
          for (const i of sprite) {
            if (gesehen.has(i)) doppelt++;
            gesehen.add(i);
          }
          if (gesehen.size !== idx.length) verloren++;
          geprueft++;
        }
      }
    }
  }
  pruefe(geprueft > 1000, `zu wenige Fälle geprüft (${geprueft})`);
  pruefe(abweichungen === 0, `Zell-Vorfilter widerspricht der Pro-Instanz-Regel in ${abweichungen} Fällen`);
  pruefe(doppelt === 0, `${doppelt} Instanzen in BEIDEN Darstellungen (Doppelbild)`);
  pruefe(verloren === 0, `${verloren} Zellen mit fehlenden Instanzen (Loch)`);

  // Ohne Atlas darf in demselben Raster NIE ein Sprite entstehen.
  let spritesOhneAtlas = 0;
  for (let cx = -3; cx <= 3; cx++) {
    const pts = [[cx * Z, 0] as const];
    const lage = zellLage(cx, 0, Z, 0, 0, GRENZE, false);
    teileZelle([0], () => pts[0]![0], () => pts[0]![1], lage, 0, 0, GRENZE, echt, sprite);
    spritesOhneAtlas += sprite.length;
  }
  pruefe(spritesOhneAtlas === 0, `${spritesOhneAtlas} Sprites trotz fehlendem Atlas`);
}

// ── 6. Gierwinkel und Skalierung aus der Instanzmatrix ───────────────
{
  // Babylons Matrix.RotationY(a) ist row-major
  //   [ cos a, 0, -sin a, 0,   0,1,0,0,   sin a, 0, cos a, 0,   0,0,0,1 ]
  // — die Extraktion muss -m[2] gegen m[0] nehmen, damit sich der
  // gemeinsame Skalierungsfaktor der ERSTEN Zeile exakt wegkürzt.
  const bauen = (a: number, sxz: number, sy: number): number[] => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    // prettier-ignore
    return [
      c * sxz, 0, -s * sxz, 0,
      0, sy, 0, 0,
      s * sxz, 0, c * sxz, 0,
      10, 20, 30, 1,
    ];
  };
  for (const a of [0, 0.7, 2.5, -1.9, Math.PI]) {
    const r = yawUndSkala(bauen(a, 2.5, 1.7), 0);
    pruefe(Math.abs(r.yaw - a) < 1e-6, `Yaw ${r.yaw} statt ${a}`);
    pruefe(Math.abs(r.sxz - 2.5) < 1e-6, `XZ-Skala ${r.sxz} statt 2.5`);
    pruefe(Math.abs(r.sy - 1.7) < 1e-6, `Y-Skala ${r.sy} statt 1.7`);
  }
}

console.log(
  fehler === 0
    ? '\nOK — Atlasraster überschneidungsfrei, Zuteilung partitioniert, Fail-Soft hält'
    : `\n${fehler} FEHLER`
);
process.exit(fehler > 0 ? 1 : 0);
