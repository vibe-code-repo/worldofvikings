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
