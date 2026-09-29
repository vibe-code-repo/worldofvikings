/**
 * Namensschilder/Objektnamen/Anvisieren zittern nicht mehr mit TAA (G3 Stufe 1).
 *
 * Befund: `entsperreTaaJitter` (PostProcessing.ts) schreibt jedes Bild einen
 * Halton-Versatz in Zeile 2 (Spalten 8/9) der GECACHTEN Projektionsmatrix der
 * Kamera. `Namensschild.ts`, `ObjectLabels.ts` und `Anvisiert.ts` projizierten
 * bisher mit `scene.getTransformMatrix()` — also mit genau dieser verzitterten
 * Matrix — und rundeten danach auf ganze Pixel. Bei stehender Kamera sprang
 * das Ergebnis dadurch jedes Bild um den Versatz.
 *
 * `transformOhneJitter()` (PostProcessing.ts) liefert dieselbe Matrix mit den
 * beiden Spalten zurückgesetzt. Dieser Test baut eine Kamera+Szene nach, die
 * genau das tut, was Babylons TAA am echten Objekt tut (Zeile 2 der
 * gecachten Projektionsmatrix jedes Bild neu beschreiben — kein Fake auf
 * Ebene der Funktion, sondern dieselbe Mutation, die `entsperreTaaJitter`
 * auch am echten `ThinTAAPostProcess` vornimmt), lässt Kamera und Weltpunkt
 * FEST stehen und prüft:
 *
 *  A) `transformOhneJitter` selbst: 16 Bilder mit wechselndem Versatz ändern
 *     die projizierte Pixelposition um 0 px; mit der rohen
 *     `scene.getTransformMatrix()` (der alte Stand) um ≥ 1 px.
 *  B) `Namensschilder.update()` — echte Klasse, echter Code, nur DOM durch
 *     ein Attrappen-`document` ersetzt (dasselbe Muster wie in
 *     `werkzeug-platzieren.ts`): dieselben 0 px am geschriebenen
 *     `style.transform`.
 *  C) `ObjectLabels.update()` — dieselbe Prüfung an `style.left/top`.
 *  D) `Anvisiert.finde()` — ein Objekt genau am Rand von `ZIEL_RADIUS`
 *     platziert: mit der rohen Matrix kippt das Ergebnis zwischen Treffer und
 *     `null`, mit `transformOhneJitter` bleibt es über alle 16 Bilder gleich.
 *
 * Mutanten (von Hand geprüft, s. Bericht): Eine der drei Stellen
 * (`Namensschild.ts:354`, `ObjectLabels.ts:123`, `Anvisiert.ts:128`) wieder
 * auf `this.scene.getTransformMatrix()` — der jeweilige Teil (B/C/D) wird rot.
 *
 * Lauf: npx tsx client/test/schilder-transform-ohne-jitter.ts
 */

import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { EntityManager, DynamischeInstanz, StatischeInstanz } from '../src/entities/EntityManager';
import { transformOhneJitter } from '../src/engine/PostProcessing';
import { Namensschilder } from '../src/ui/Namensschild';
import { ObjectLabels } from '../src/ui/ObjectLabels';
import { Anvisiert } from '../src/ui/Anvisiert';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('Schilder ohne TAA-Zittern (G3 Stufe 1)');

// ── Attrappen-DOM (dasselbe Muster wie client/test/werkzeug-platzieren.ts) ──
interface FakeKnoten {
  tag: string;
  style: Record<string, string>;
  children: FakeKnoten[];
  textContent?: string;
  appendChild(k: FakeKnoten): FakeKnoten;
  append(...k: FakeKnoten[]): void;
  remove(): void;
}
function fakeKnoten(tag: string): FakeKnoten {
  const k: FakeKnoten = {
    tag,
    style: {},
    children: [],
    appendChild(c) {
      k.children.push(c);
      return c;
    },
    append(...c) {
      k.children.push(...c);
    },
    remove() {
      /* im Test nie gebraucht */
    },
  };
  return k;
}
const angehaengt: FakeKnoten[] = [];
(globalThis as unknown as { document: unknown }).document = {
  createElement: fakeKnoten,
  body: { appendChild: (k: FakeKnoten) => angehaengt.push(k) },
};

// ── Kamera + Szene: bildet NUR nach, was Babylon am Projektionsschritt tut ──
//
// Kamera im Weltursprung, Blick auf +Z, „oben" = +Y — bei dieser Lage ist
// Babylons LookAtLH-Sichtmatrix die Einheit (Ursprung, keine Drehung), Welt-
// und Kamerakoordinaten fallen also zusammen und die Pixel-Rechnung unten
// bleibt nachvollziehbar.
const BREITE = 1920;
const HOEHE = 1080;
const FOV = 1.0;
const view = Matrix.LookAtLH(Vector3.Zero(), new Vector3(0, 0, 1), Vector3.Up());
const projJitterbar = Matrix.PerspectiveFovLH(FOV, BREITE / HOEHE, 0.1, 1000, false);

/** Schreibt den TAA-Versatz in Zeile 2 — exakt das, was `entsperreTaaJitter`
 *  am echten `ThinTAAPostProcess._updateProjectionMatrix` tut. */
function setzeJitter(dx: number, dy: number): void {
  projJitterbar.setRowFromFloats(2, dx, dy, projJitterbar.m[10]!, projJitterbar.m[11]!);
}
setzeJitter(0, 0);

const camera = {
  mode: Constants.PERSPECTIVE_CAMERA,
  globalPosition: Vector3.Zero(),
  viewport: new Viewport(0, 0, 1, 1),
  getProjectionMatrix: () => projJitterbar,
} as unknown as Camera;

const scene = {
  getEngine: () => ({ getRenderWidth: () => BREITE, getRenderHeight: () => HOEHE }),
  getViewMatrix: () => view,
  // Der alte Stand: View × die ROHE (verzitterte) Projektionsmatrix — genau
  // das, was `scene.getTransformMatrix()` in Babylon zurückgibt, solange
  // niemand sie um den Jitter bereinigt.
  getTransformMatrix: () => view.multiply(projJitterbar),
} as unknown as Scene;

/** 16 Bilder mit wechselndem Versatz (± je Achse) — Kamera steht, TAA jittert. */
const BILDER = 16;
function jitterFolge(i: number): [number, number] {
  const vz = i % 2 === 0 ? 1 : -1;
  return [0.003 * vz, 0.0025 * vz];
}

// ── A) transformOhneJitter selbst ────────────────────────────────────────
{
  const punkt = new Vector3(0, 0, 10);
  const vp = new Viewport(0, 0, BREITE, HOEHE);
  const projiziert = new Vector3();
  const einheit = Matrix.Identity();

  const altXs: number[] = [];
  const altYs: number[] = [];
  const neuXs: number[] = [];
  const neuYs: number[] = [];
  for (let i = 0; i < BILDER; i++) {
    const [dx, dy] = jitterFolge(i);
    setzeJitter(dx, dy);

    Vector3.ProjectToRef(punkt, einheit, scene.getTransformMatrix(), vp, projiziert);
    altXs.push(projiziert.x);
    altYs.push(projiziert.y);

    Vector3.ProjectToRef(punkt, einheit, transformOhneJitter(scene, camera), vp, projiziert);
    neuXs.push(projiziert.x);
    neuYs.push(projiziert.y);
  }
  const spanne = (a: number[]) => Math.max(...a) - Math.min(...a);
  const altSpanne = Math.max(spanne(altXs), spanne(altYs));
  const neuSpanne = Math.max(spanne(neuXs), spanne(neuYs));
  console.log(
    `  A) Streuung 16 Bilder — alt (roh): ${altSpanne.toFixed(3)} px, neu (transformOhneJitter): ${neuSpanne.toFixed(3)} px`
  );
  pruefe(altSpanne >= 1, `alter Stand (scene.getTransformMatrix() roh) müsste ≥ 1 px streuen, war ${altSpanne}`);
  pruefe(neuSpanne === 0, `transformOhneJitter müsste 0 px streuen, war ${neuSpanne}`);
}

// ── B) Namensschilder — echte Klasse ─────────────────────────────────────
{
  const npc: DynamischeInstanz = {
    key: 'npc1',
    prefab: 'unbekanntes-testprefab',
    x: 0,
    // kopfHoehe() liefert ohne Prefab-Daten SPIELER_HOEHE(1.8)+KOPF_LUFT(0.35) = 2.15;
    // y so gewählt, dass der Scheitelpunkt exakt auf der Bildmitte liegt.
    y: -2.15,
    z: 10,
    skalierungY: 1,
    leben: -1,
  };
  const entities = (): EntityManager | null =>
    ({
      dynamischeInstanzen: (out: DynamischeInstanz[]) => {
        out[0] = npc;
        out.length = 1;
        return 1;
      },
    }) as unknown as EntityManager;

  const schilder = new Namensschilder(scene, camera, entities, {
    bodenHoehe: () => -1000, // Gelände nie im Weg — nichts wird verdeckt.
    einordnung: () => ({ name: 'Testfigur', rolle: 'zivil', fraktion: 'wikinger', stufe: 1, quest: 'keine' }),
  });

  const positionen: Array<{ x: number; y: number }> = [];
  const RE = /translate3d\((-?[\d.]+)px,(-?[\d.]+)px,0\)/;
  for (let i = 0; i < BILDER; i++) {
    const [dx, dy] = jitterFolge(i);
    setzeJitter(dx, dy);
    schilder.update(0.016, { x: 0, y: 0, z: 0 });
    const slot = angehaengt[0]!.children[0]!;
    const treffer = RE.exec(slot.style.transform ?? '');
    pruefe(!!treffer, `Bild ${i}: kein translate3d im style.transform (${slot.style.transform})`);
    if (treffer) positionen.push({ x: Number(treffer[1]), y: Number(treffer[2]) });
  }
  const xs = positionen.map((p) => p.x);
  const ys = positionen.map((p) => p.y);
  const spanneX = Math.max(...xs) - Math.min(...xs);
  const spanneY = Math.max(...ys) - Math.min(...ys);
  console.log(`  B) Namensschild: Bildschirmposition über ${BILDER} Bilder — Streuung x=${spanneX} px, y=${spanneY} px`);
  pruefe(positionen.length === BILDER, `Namensschild: nicht in jedem Bild gezeichnet (${positionen.length}/${BILDER})`);
  pruefe(spanneX === 0 && spanneY === 0, `Namensschild springt trotz stehender Kamera (Δx=${spanneX}, Δy=${spanneY})`);
}

// ── C) ObjectLabels — echte Klasse ───────────────────────────────────────
{
  const obj: StatischeInstanz = { prefab: 'testobjekt', x: 0, y: -1.2, z: 10 };
  const entities = (): EntityManager | null =>
    ({
      nearbyInstances: () => [obj],
    }) as unknown as EntityManager;

  const labels = new ObjectLabels(scene, camera, entities);
  labels.setEnabled(true);

  const positionen: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < BILDER; i++) {
    const [dx, dy] = jitterFolge(i);
    setzeJitter(dx, dy);
    labels.update(0, 0);
    const wurzel = angehaengt[1]!;
    const slot = wurzel.children[0]!;
    positionen.push({ x: Number.parseFloat(slot.style.left), y: Number.parseFloat(slot.style.top) });
  }
  const xs = positionen.map((p) => p.x);
  const ys = positionen.map((p) => p.y);
  const spanneX = Math.max(...xs) - Math.min(...xs);
  const spanneY = Math.max(...ys) - Math.min(...ys);
  console.log(`  C) ObjectLabels: Bildschirmposition über ${BILDER} Bilder — Streuung x=${spanneX} px, y=${spanneY} px`);
  pruefe(spanneX === 0 && spanneY === 0, `ObjectLabels springt trotz stehender Kamera (Δx=${spanneX}, Δy=${spanneY})`);
}

// ── D) Anvisiert — echte Klasse, Objekt genau am Rand von ZIEL_RADIUS ────
{
  // ZIEL_RADIUS = 90 px (bei 1080 Bildhöhe, wie hier). x so gewählt (siehe
  // Bericht für die Herleitung aus fov/aspect), dass das Objekt ohne Jitter
  // bei 88 px vom Fadenkreuz liegt — knapp INNERHALB des Radius. Der Jitter
  // unten (± 0,006 in NDC ≈ ± 5,76 px) reicht, um die ROHE Matrix über die
  // 90-px-Grenze zu treiben, ohne die bereinigte zu berühren.
  const OBJ_X = 0.8905;
  const objekt: StatischeInstanz = { prefab: 'anvisiert-testobjekt', x: OBJ_X, y: 0, z: 10 };
  const entities = (): EntityManager | null =>
    ({
      nearbyInstances: () => [objekt],
    }) as unknown as EntityManager;

  const anvisiert = new Anvisiert(scene, camera, entities);
  const treffer: Array<string | null> = [];
  for (let i = 0; i < BILDER; i++) {
    const vz = i % 2 === 0 ? 1 : -1;
    setzeJitter(0.006 * vz, 0);
    (anvisiert as unknown as { letzteZeit: number }).letzteZeit = Number.NEGATIVE_INFINITY;
    treffer.push(anvisiert.finde(0, 0));
  }
  const treffen = treffer.filter((t) => t !== null).length;
  console.log(`  D) Anvisiert: Treffer in ${treffen}/${BILDER} Bildern (muss ${BILDER}/${BILDER} sein)`);
  pruefe(treffen === BILDER, `Anvisiert kippt zwischen Treffer und "nichts" (${treffen}/${BILDER} Treffer): ${JSON.stringify(treffer)}`);
}

if (fehler > 0) {
  console.error(`\n${fehler} Fehler`);
  process.exit(1);
}
console.log('\nSchilder, Objektnamen und Anvisieren stehen still, solange die Kamera steht.');
