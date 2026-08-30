/**
 * Ganzzahlige Positions- und Seed-Hashes des Dungeon-Generators 2.0.
 * Integer position and seed hashes for dungeon generator 2.0.
 *
 * Quelle: `design/ARCHITECTURE.md` W6/W7/W8, vertieft in `design/woc-analysis.md`
 * §3. Der dortige Befund ist die Regel hier: Jeder Hash, den Server UND Client
 * auswerten, ist GANZZAHLIG (`Math.imul`-Kette) — niemals trigonometrisch
 * (`Math.sin`/`Math.cos` sind in ECMAScript nicht bitgenau spezifiziert, siehe
 * die Falle in WoCs `tombSlotRoll`/`hash2`).
 * Source: `design/ARCHITECTURE.md` W6/W7/W8, detailed in `design/woc-analysis.md`
 * §3. Its finding is the rule here: every hash that both server AND client
 * evaluate is INTEGER (`Math.imul` chain) — never trigonometric (`Math.sin`/
 * `Math.cos` are not bit-exactly specified in ECMAScript, see the trap in WoC's
 * `tombSlotRoll`/`hash2`).
 *
 * Dieses Modul ist rein: kein Babylon, kein DOM, kein `node:`, kein
 * `Math.random`, keine Uhr, keine Trigonometrie.
 * This module is pure: no Babylon, no DOM, no `node:`, no `Math.random`,
 * no clock, no trigonometry.
 */

/**
 * Avalanche eines 32-Bit-Zustands nach einem Murmur3-Finalizer (nur
 * `Math.imul`, Shifts und XOR — kein `Math.random`, keine Fliesskomma-
 * Multiplikation, kein Zufall ausserhalb des uebergebenen Zustands).
 * Avalanches a 32-bit state using a Murmur3-style finalizer (only
 * `Math.imul`, shifts and XOR — no `Math.random`, no floating point
 * multiplication, no randomness outside the supplied state).
 */
function avalanche32(zustand: number): number {
  let h = zustand >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Mischt einen 32-Bit-Zustand mit einem weiteren Ganzzahlwert. Interner
 * Baustein von `mische()` und `hashPos()` — EIN Verfahren, nicht zwei
 * unabhaengig geschriebene, damit sie nie auseinanderdriften koennen.
 * Mixes a 32-bit state with another integer value. Internal building block
 * of both `mische()` and `hashPos()` — ONE procedure, not two independently
 * written ones that could drift apart.
 */
function verruehren(zustand: number, wert: number): number {
  // `wert | 0` normiert auf int32, bevor XOR auf dem uint32-Zustand greift.
  // `wert | 0` normalises to int32 before XOR meets the uint32 state.
  return avalanche32((zustand ^ (wert | 0)) >>> 0);
}

/**
 * Mischt einen Basis-Seed mit einem Salzwert zu einem neuen, unabhaengigen
 * Strom-Seed. Das ist die "Seed-Mischung statt geteiltem Strom fuer getrennte
 * Belange" aus `woc-analysis.md` §3 (`mixSeed`), Grundlage von W7: ein eigener
 * `XorShiftRandom`-Strom je Stempel (`mische(seeds.deko, stempel.id)`) bzw. je
 * Anker (`mische(seeds.deko, anker.id)`), damit eine zusaetzliche Ziehung in
 * einem Strom die anderen nie verschiebt.
 * Mixes a base seed with a salt into a new, independent stream seed. This is
 * the "seed mixing instead of a shared stream for separate concerns" from
 * `woc-analysis.md` §3 (`mixSeed`), the basis of W7: an own `XorShiftRandom`
 * stream per stamp (`mische(seeds.deko, stempel.id)`) or per anchor
 * (`mische(seeds.deko, anker.id)`), so an extra draw in one stream never
 * shifts the others.
 *
 * Ergebnis ist uint32 (0..2^32-1) — gueltig als Konstruktor-Seed fuer
 * `XorShiftRandom`, das seinerseits `seed >>> 0` normiert.
 * Result is uint32 (0..2^32-1) — valid as a constructor seed for
 * `XorShiftRandom`, which itself normalises via `seed >>> 0`.
 */
export function mische(seed: number, salt: number): number {
  // Seed zuerst fuer sich avalanchen, dann erst mit dem Salz verruehren.
  // Ohne diesen ersten Schritt wuerde `seed === salt` (als Bitmuster) zu
  // `zustand ^ wert === 0` fuehren, und `avalanche32(0) === 0` ist ein
  // bekannter Fixpunkt des Murmur3-Finalizers — zwei gleich benannte Straeme
  // (z. B. `mische(5, 5)`) landen sonst beide auf 0 statt auf einem
  // unauffaelligen, unterscheidbaren Wert.
  // Avalanche the seed on its own first, then mix in the salt. Without this
  // first step, `seed === salt` (as a bit pattern) would make
  // `zustand ^ wert === 0`, and `avalanche32(0) === 0` is a known fixed point
  // of the Murmur3 finalizer — two identically-named streams (e.g.
  // `mische(5, 5)`) would otherwise both land on 0 instead of an unremarkable,
  // distinguishable value.
  return verruehren(avalanche32(seed >>> 0), salt);
}

/**
 * Stabiler Positions-Hash ueber Zellkoordinaten und einen Seed — OHNE Rng-Zug.
 * Das ist W8: CPU-Bauer und GPU-Shader benutzen DENSELBEN ganzzahligen Hash
 * ueber Weltposition und `seeds.material`, damit ein Moosfleck, den der
 * Shader zeichnet, an derselben Stelle wie eine Kante steht, die der Bauer
 * geformt hat. Deshalb ist der Bauer blockweise und in beliebiger Reihenfolge
 * aufrufbar: `hashPos` haengt nur von (x,z,ebene,seed) ab, nie von einer
 * Ziehreihenfolge.
 * Stable position hash over cell coordinates and a seed — WITHOUT drawing from
 * an rng. This is W8: the CPU builder and the GPU shader use the SAME integer
 * hash over world position and `seeds.material`, so a moss patch the shader
 * paints sits at the same place as an edge the builder shaped. That is why the
 * builder can be called per block in any order: `hashPos` depends only on
 * (x,z,ebene,seed), never on a draw order.
 *
 * Ergebnis ist uint32 (0..2^32-1). Aufrufer, die eine Gleitkommazahl in [0,1)
 * brauchen (z. B. fuer Schwellwertvergleiche im Shader), teilen selbst durch
 * 2^32 — diese Funktion bleibt ganzzahlig, wie der Grundsatz aus `layout.ts`
 * §3.1 es fuer alles verlangt, was ueber die Leitung bzw. durch beide
 * Laufzeiten (Node und Browser) gleich sein muss.
 * Result is uint32 (0..2^32-1). Callers who need a float in [0,1) (e.g. for
 * threshold comparisons in the shader) divide by 2^32 themselves — this
 * function stays integer, as the principle from `layout.ts` §3.1 demands for
 * everything that must agree across both runtimes (Node and the browser).
 */
export function hashPos(x: number, z: number, ebene: number, seed: number): number {
  // Derselbe Grund wie in `mische()`: den Seed zuerst avalanchen, damit eine
  // Koordinate von 0 bei Seed 0 nicht zum Fixpunkt fuehrt.
  // Same reason as in `mische()`: avalanche the seed first, so a coordinate
  // of 0 at seed 0 does not hit the fixed point.
  let h = avalanche32(seed >>> 0);
  h = verruehren(h, x);
  h = verruehren(h, z);
  h = verruehren(h, ebene);
  return h;
}
