/**
 * Das Look-Profil auf der Clientseite — Halter, Hex-Umrechnung und die
 * Verteilung an die vier Stellen, die es lesen.
 *
 * The look profile on the client side — holder, hex conversion and the
 * fan-out to the four places that read it.
 *
 * ── Warum ein Halter und kein Parameter ──────────────────────────────
 * Das Profil kommt aus `server.yml` und trifft ERST BEIM ANMELDEN ein
 * (Paket `WeltWetter`, s. WovServer.onPeerAuthenticated). Bis dahin
 * stehen Beleuchtung, Himmel, Schatten und Nachbearbeitung längst — sie
 * mit dem Serverwert zu bauen hiesse, den Aufbau auf das Netz warten zu
 * lassen. Deshalb baut jeder von ihnen mit LOOK_VORGABE und bekommt
 * hinterher `setzeLook()` gerufen.
 *
 * Das ist zugleich die Antwort auf die Falle aus dem Gedächtnis
 * („server.yml erreicht laufende Clients nicht"): Der Serverwert wirkt
 * genau einmal, beim Anmelden. Wer im Betrieb daran dreht, muss den
 * Client neu anmelden — und das steht hier, damit es niemand für einen
 * Fehler hält.
 *
 * ── Die Sperre, an der ein Nachtrag scheitert ────────────────────────
 * `main.ts` setzt `scene.blockMaterialDirtyMechanism = true`, nachdem die
 * Materialien übersetzt sind. Ein danach gesetzter `scene.fogMode` ruft
 * zwar `markAllMaterialsAsDirty`, aber die Sperre verschluckt es: Das
 * Define bleibt, wie es war, und der Nebel rechnet weiter auf der alten
 * Kurve — ohne Fehlermeldung, ohne Symptom ausser einem Bild, das nicht
 * stimmt. `setzeNebelmodus()` unten hebt die Sperre für die Dauer der
 * Änderung auf. Festgehalten, weil dieselbe Falle in dieser Codebasis
 * schon zugeschnappt ist (Vault: „Babylon Material-Dirty-Sperre").
 *
 * ── ZWEI Gammakurven, und beide sind richtig ─────────────────────────
 * Diese Datei linearisiert mit Babylons `toLinearSpaceToRef` — das ist
 * `pow(x, 2.2)` (`math.constants.js`), NICHT die exakte sRGB-Kurve.
 * `Grading.ts` daneben linearisiert mit der exakten sRGB-Kurve
 * (Knick bei 0,04045, Exponent 2,4). Das ist kein Widerspruch und darf
 * nicht „vereinheitlicht" werden:
 *
 *   · `hexLinear` unten füttert Babylon-Uniforms (Sonne, Nebel, Himmel,
 *     Vignette). Babylon rechnet im Shader mit 2,2 zurück — wer hier
 *     exakt sRGB linearisierte, bekäme einen Rundgang, der nicht
 *     schliesst.
 *   · `Grading.ts` baut die Tabelle des Vorbilds nach, und dort ist die
 *     exakte Kurve die Rechnung, die nachgebaut wird.
 *
 * Die Zahlen dazu: bei sRGB-Anteil 0,2 liefern die beiden Kurven 0,0290
 * (pow 2,2) gegen 0,0331 (exakt) — 14 % Unterschied, genug, um eine
 * ganze Messreihe zu verderben. Genau das ist in diesem Projekt schon
 * passiert (Analyse §G, „Gammakurve — präzisiert, mit Folgen"). Wer hier
 * misst, hält sich an EINE der beiden und schreibt dazu, welche.
 *
 * ── Was die Farbe im Bild wirklich bewegt ────────────────────────────
 * GEMESSEN am laufenden Client, Pose `weitblick`, 12:00, je Regler
 * einzeln gegen denselben Bildinhalt (Rechtecke der Analyse: Wiesenboden
 * und Himmel):
 *
 *   Regler (je gegen den Stand darüber)  Boden L   Himmel L   Vorzeichen
 *   Ausgangsstand                        44,2      146,6      —
 *   belichtung 1,42 → 2,0 (BERECHNET)    +7,4      +24,4      BEIDE hoch
 *   tonemapping neutral                  −4,3      −8,8       beide runter
 *   grading Dorf statt Wildnis           −4,4      −1,5       beide runter
 *   kontrast 1,0 → 0,84                  +12,5     −3,9       GEGENLÄUFIG
 *   saettigung 1,0 → 1,12                ±0        ±0         nur Sättigung
 *
 * (Die Belichtungszeile ist gerechnet und nicht gemessen, weil sie es
 * exakt sein kann: ohne Tonemapper ist eine Belichtung im Gammaraum ein
 * Faktor `E^(1/2,2)`, hier 1,1665 — die Kurve kürzt sich, wie im
 * `look:`-Block von `server.yml` beschrieben.)
 *
 * Der Punkt ist die letzte Spalte. Unser Bild muss am Boden HELLER und
 * am Himmel leicht DUNKLER werden (Ziel 52–58 gegen 142); `kontrast` ist
 * der einzige der fünf Regler, dessen Wirkung auf Boden und Himmel
 * entgegengesetztes Vorzeichen hat. Babylon mischt unterhalb von 1,0
 * gegen Mittelgrau (`mix(vec3(0.5), rgb, contrast)`, in GAMMA, nach dem
 * Tonemapping) — das hebt alles Dunkle und senkt alles Helle.
 *
 * Deshalb steht im ausgelieferten Profil `kontrast: 0.84` und nicht eine
 * höhere Belichtung. Eine höhere Belichtung macht die Spaltung GRÖSSER:
 * der Himmel hängt als Einziges nicht am Sonnenlicht und steigt 2–3×
 * stärker als der Boden (Analyse §A8).
 *
 * Und der Tonemapper: `neutral` trifft auf unsere Lichtwerte nicht. Er
 * zieht `min(r,g,b) − 6,25·min²` von allen drei Kanälen ab; bei einem
 * Wiesengrund mit linearem Blau von 0,0036 bleiben davon `6,25·min²`
 * übrig, also 2 % des Blaukanals.
 * GEMESSEN steigt die Sättigung des Bodens dadurch von 0,605 auf 0,93 —
 * das Gegenteil des Ziels, und mit keinem Sättigungsregler einzufangen
 * (0,3 als Faktor liefert immer noch 0,319 bei Boden L 42). `aces` ist
 * noch weiter weg (Boden L 17,5 bei gleicher Belichtung). Beide bleiben
 * eine Zeile in `server.yml` entfernt, aber keine der beiden ist der
 * Stand, gegen den hier gemessen wurde.
 */
import { Color3, Color4 } from '@babylonjs/core/Maths/math';
import { Scene } from '@babylonjs/core/scene';
import {
  LOOK_VORGABE,
  mischeLook,
  type LookProfil,
  type Nebelmodus,
  HORIZONT_AUS_NEBEL,
} from '@wov/shared';

export { LOOK_VORGABE, HORIZONT_AUS_NEBEL };
export type { LookProfil };

let aktuell: LookProfil = LOOK_VORGABE;

/** Das gerade geltende Profil. Vor dem Anmelden ist das LOOK_VORGABE. */
export function look(): LookProfil {
  return aktuell;
}

/**
 * Serverwert einmischen und die Beobachter benachrichtigen.
 *
 * Gemischt statt ersetzt: `server.yml` gibt fast immer nur einzelne
 * Regler an, und ein `{ bloom: { staerke: 0.4 } }`, das Schwelle und
 * Kernel auf `undefined` setzt, wäre ein Regler, der etwas anderes tut
 * als er sagt (die Falle, die ADR-0040 im Schwesterprojekt bezahlt hat).
 */
export function setzeLook(teil: unknown): LookProfil {
  aktuell = mischeLook(teil);
  for (const f of beobachter) f(aktuell);
  return aktuell;
}

type Beobachter = (p: LookProfil) => void;
const beobachter = new Set<Beobachter>();

/**
 * Auf Profiländerungen hören. Gibt eine Abmeldefunktion zurück.
 *
 * Der Beobachter wird NICHT sofort gerufen: Wer sich anmeldet, hat sein
 * Profil im Konstruktor bereits angewandt, und ein zweiter Aufruf im
 * selben Atemzug wäre nur Arbeit ohne Wirkung.
 */
export function beiLook(f: Beobachter): () => void {
  beobachter.add(f);
  return () => beobachter.delete(f);
}

/**
 * `#rrggbb` → Color3 in LINEAR.
 *
 * Die Hex-Werte des Profils sind SRGB (sie stammen aus dem
 * Unity-Inspector des Schwesterprojekts). Diese Pipeline füttert alles
 * linear — wer sie roh in ein Uniform schreibt, bekommt ein zu helles,
 * zu sattes Bild. Genau dafür gibt es diese eine Funktion, statt an vier
 * Stellen `new Color3(...)` mit der Frage „war das jetzt Gamma?".
 */
export function hexLinear(hex: string, ziel = new Color3()): Color3 {
  const h = hex.trim().replace(/^#/, '');
  const n = h.length === 3
    ? parseInt(h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!, 16)
    : parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return ziel.set(0, 0, 0);
  ziel.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  return ziel.toLinearSpaceToRef(ziel);
}

/** Dasselbe als Color4 mit Alpha 0 — Babylons `vignetteColor` ist Color4. */
export function hexLinear4(hex: string, ziel = new Color4()): Color4 {
  const c = hexLinear(hex);
  return ziel.set(c.r, c.g, c.b, 0);
}

/**
 * Nebelkurve setzen, ohne an der Dirty-Sperre zu scheitern.
 *
 * Babylons `set fogMode` ruft `markAllMaterialsAsDirty(MiscDirtyFlag)`;
 * bei gesetztem `blockMaterialDirtyMechanism` verpufft das. Deshalb:
 * Sperre merken, öffnen, setzen, Sperre zurück. Der Sonderfall „Modus
 * ist schon richtig" wird VOR dem Öffnen abgefangen — Babylons Setter
 * steigt bei Gleichheit selbst aus, und ein unnötiges Neuübersetzen
 * aller Shader kostet auf dieser Szene rund eine Sekunde.
 *
 * ── Warum `nebelEnde` 800 m heisst und nicht 200 ─────────────────────
 * Das ist die EINE Stelle im Client, an der `fogEnd` geschrieben wird —
 * also der Ort für die Begründung. Der Boden liest denselben Wert je
 * Bild aus der Szene (`TerrainSplat.syncLighting`), die PBR-Kette über
 * `vFogInfos`, und beide rechnen seit `PbrNebelFix.ts` auf derselben
 * Kurve; eine Zahl gilt damit für das ganze Bild.
 *
 * Die 200 m stammen aus einem 300-m-Spielfeld mit gemalten Bergkulissen.
 * Bei uns läuft dieselbe Zahl in einer 4000-m-Kamera und macht aus der
 * Ferne eine Wand in Nebelfarbe. GEMESSEN, Pose `weitblick` / 12:00, nur
 * `nebelEnde` gedreht, alles andere im ausgelieferten Stand:
 *
 *   nebelEnde     200     600     700     800    1000    1400
 *   Ferne B−R    26,1     5,5     3,7     2,1      —       —
 *   Ferne/Himmel 0,628   0,559   0,554   0,550     —       —
 *   Spanne*      68,4    81,1    82,1    83,0    84,1    85,5
 *
 *   * p95 − p5 der Luma im Fern-Rechteck der Pose `steinkreis` — das
 *     Mass dafür, ob die Ferne überhaupt noch Struktur hat oder nur eine
 *     Fläche ist.
 *
 * Drei Zeugen, dieselbe Antwort:
 *  1. B−R fällt von 26,1 auf 2,1 — bei 800 m FÄRBT der Nebel die Ferne
 *     nicht mehr blau, er verschleiert sie nur noch.
 *  2. Die Struktur in der Ferne wächst bis 800 m um 14,6 Luma und danach
 *     nur noch um rund 1 Luma je 100 m. 800 ist der Punkt, an dem mehr
 *     Sichtweite nichts Sichtbares mehr kauft.
 *  3. Ferne/Himmel landet bei 0,550 — von den drei Kandidaten der
 *     nächste am gemessenen Referenzwert 0,53.
 *
 * Was 800 m NICHT leistet: die Fernschale des Geländes reicht an dieser
 * Pose bis 1091 m und der Wasserring bis 1498 m (aus den Hüllkörpern
 * gemessen). Alles dahinter steht weiterhin in voller Nebelfarbe. Wer
 * das auch noch wegräumen will, braucht 1500 m — das ist die nächste
 * Stufe und eine eigene Entscheidung, keine Feinjustage dieser Zahl.
 */
export function setzeNebelmodus(
  scene: Scene,
  modus: Nebelmodus,
  start = 0,
  ende = 0
): void {
  /*
    Start und Ende ZUERST, und ohne die Sperre anzufassen: `fogStart`
    und `fogEnd` sind gewöhnliche Zahlen, die Babylon je Bild in
    `vFogInfos` schiebt — sie brauchen kein neues Define. Nur der MODUS
    ist eins, und nur er läuft deshalb durch die Sperre unten.

    Sie werden auch dann gesetzt, wenn der Modus schon stimmt: Sonst
    bliebe ein geändertes `nebelEnde` beim Profilwechsel liegen, weil
    die Funktion vorher am `if` aussteigt. Genau diese Sorte Rückkehr
    ist der Grund, aus dem hier überhaupt eine Funktion steht.
  */
  if (modus === 'linear') {
    scene.fogStart = start;
    scene.fogEnd = ende;
  }
  const ziel =
    modus === 'exp'
      ? Scene.FOGMODE_EXP
      : modus === 'linear'
        ? Scene.FOGMODE_LINEAR
        : Scene.FOGMODE_EXP2;
  if (scene.fogMode === ziel) return;
  const vorher = scene.blockMaterialDirtyMechanism;
  scene.blockMaterialDirtyMechanism = false;
  scene.fogMode = ziel;
  scene.blockMaterialDirtyMechanism = vorher;
}
