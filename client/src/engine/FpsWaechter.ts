/**
 * FpsWaechter — nimmt bei einbrechender Bildrate stufenweise Qualität
 * zurück und gibt sie zurück, wenn wieder Luft ist.
 *
 * ── Warum kein SceneOptimizer ────────────────────────────────────────
 * Babylons `SceneOptimizer` kennt unsere Regler nicht: Er würde an
 * `hardwareScalingLevel` und an Babylons eigenen Schaltern drehen, aber
 * weder die Grasdichte (`GrassClutter.setDensity`) noch die
 * Kaskadenschatten (`Shadows.setLevel`) noch die Post-Kette
 * (`PostProcessing.apply`) anfassen — und genau dort liegen die Kosten.
 * Alle fünfzehn Stellschrauben gibt es bereits als Hand-Regler
 * (`ui/Settings.ts`); hier fehlt nur die Automatik darüber.
 *
 * ── Die Regelung ─────────────────────────────────────────────────────
 * Gemessen wird ein gleitendes Mittel über 2 Sekunden. Fällt es unter
 * 45 fps, geht es eine Sprosse tiefer; steigt es über 58 fps, eine
 * höher. Zwischen den beiden Schwellen passiert nichts — das ist die
 * eigentliche Hysterese, und sie ist absichtlich breit: 45 und 58 liegen
 * so weit auseinander, dass eine Stufe, die von 44 auf 50 fps hilft,
 * nicht sofort wieder zurückgenommen wird.
 *
 * Gegen das Pendeln im Sekundentakt stehen drei Dinge:
 *
 *  1. Nach JEDEM Stufenwechsel wird das Messfenster geleert. Die nächste
 *     Entscheidung braucht also erst wieder 2 Sekunden frische Messung —
 *     mit den alten Werten zu entscheiden hiesse, die eben gemachte
 *     Änderung nicht abzuwarten.
 *  2. Mindestverweildauer je Stufe, und zwar UNSYMMETRISCH: nach unten
 *     2 s (der Spieler soll nicht in einer Ruckelphase festhängen),
 *     nach oben 6 s (Hochschalten ist Kür, nicht Pflicht).
 *  3. Pendelschutz: Wer gerade hochgeschaltet hat und kurz darauf wieder
 *     runter muss, hat sich geirrt. Jeder solche Fehlversuch verlängert
 *     die Sperre nach oben (mal 2, mal 3, … bis Faktor 5). Damit
 *     beruhigt sich ein Grenzfall von selbst, statt ewig zu wippen.
 *
 * ── Reihenfolge der Sprossen ─────────────────────────────────────────
 * Renderauflösung → Grasdichte → Schattenqualität → Bewegungsunschärfe,
 * so wie in der Roadmap festgelegt. Die Reihenfolge ist nicht beliebig,
 * sie folgt dem Verhältnis von Gewinn zu Verlust:
 *
 *   · Die Renderauflösung wirkt QUADRATISCH (85 % Kantenlänge = 28 %
 *     weniger Bildpunkte) und trifft jeden Fragment-Shader gleichzeitig.
 *     Der Verlust ist Schärfe — sichtbar, aber nichts verschwindet.
 *   · Grasdichte kostet Halme, keine Sichtweite (siehe
 *     `GrassClutter.setDensity`); die Wiese bleibt eine Wiese.
 *   · Schatten sind teuer (jede Kaskade rendert die Werferliste erneut),
 *     aber ihr Verlust nimmt dem Bild den warm/kalt-Kontrast — deshalb
 *     erst an dritter Stelle.
 *   · Bewegungsunschärfe zuletzt: sie kostet am wenigsten und ist am
 *     ehesten Geschmackssache.
 *
 * Die Sprossen sind ABSOLUTE Ziele, keine Abzüge, und werden gegen die
 * Einstellung des Nutzers gedeckelt: Der Wächter macht nie etwas
 * schöner, als der Nutzer es wollte, und die Leiter sieht für jeden
 * gleich aus. Wer schon auf 75 % steht, bei dem sind die ersten beiden
 * Sprossen wirkungslos — die überspringt der Wächter dann auch, statt
 * zwei Runden lang nichts zu tun.
 *
 * ── Einfrieren ───────────────────────────────────────────────────────
 * Sobald der Nutzer selbst einen Regler anfasst, schaltet sich die
 * Automatik für die Sitzung ab. Ohne das kämpft der Wächter gegen den
 * Spieler: Der stellt die Schatten hoch, der Wächter nimmt sie zwei
 * Sekunden später wieder weg. Wer regelt, hat recht — und das ist der
 * Mensch.
 *
 * Diese Datei hat mit Absicht KEINE Laufzeit-Abhängigkeiten (kein
 * Babylon, kein DOM, kein `performance.now()`): Die Uhr läuft aus den
 * übergebenen Frame-Dauern. Nur so ist die Regelung ohne GPU mit
 * synthetischen fps-Folgen durchzuspielen — siehe `client/test/fps-waechter.ts`.
 */
import type { GameSettings, SettingsStore } from '../ui/Settings';

/** Die vier Regler, an denen die Automatik dreht. */
export interface WaechterRegler {
  renderScale: number;
  grassDensity: number;
  shadowQuality: number;
  motionBlur: boolean;
}

/**
 * Eine Sprosse: absolute Obergrenzen, die ab dieser Stufe gelten.
 * Fehlende Felder bleiben unangetastet, gesetzte werden mit dem
 * Nutzerwert per Minimum verrechnet.
 */
interface Sprosse {
  renderScale?: number;
  grassDensity?: number;
  shadowQuality?: number;
  motionBlur?: false;
}

/**
 * Stufe 0 ist die Einstellung des Nutzers. Jede weitere Sprosse gilt
 * ZUSÄTZLICH zu allen darunter.
 *
 * Die 50-%-Renderauflösung (Index 0) steht bewusst NICHT in der Leiter:
 * Sie ist ein sichtbarer Bruch, kein Nachjustieren, und wer sie will,
 * stellt sie von Hand ein. Der Wächter geht bis 75 % herunter.
 */
const LEITER: readonly Sprosse[] = [
  {}, // 0 — unverändert
  { renderScale: 2 }, // 85 %
  { renderScale: 1 }, // 75 %
  { grassDensity: 2 },
  { grassDensity: 1 },
  { grassDensity: 0 },
  { shadowQuality: 1 },
  { shadowQuality: 0 },
  { motionBlur: false },
];

export const HOECHSTE_STUFE = LEITER.length - 1;

/** Länge des gleitenden Mittels (ms). */
const FENSTER_MS = 2000;
/** Unter dieser Bildrate wird eine Sprosse zurückgenommen. */
const SCHWELLE_RUNTER = 45;
/** Über dieser Bildrate wird eine Sprosse zurückgegeben. */
const SCHWELLE_HOCH = 58;
/** Mindestverweildauer, bevor es weiter nach unten geht (ms). */
const VERWEIL_RUNTER_MS = 2000;
/** Mindestverweildauer, bevor es wieder nach oben geht (ms). */
const VERWEIL_HOCH_MS = 6000;
/**
 * Geht es innerhalb dieser Spanne nach einem Hochschalten wieder
 * abwärts, war das Hochschalten ein Fehlversuch (ms).
 */
const PENDEL_FENSTER_MS = 15000;
/** Mehr als das Fünffache wird die Sperre nach oben nicht. */
const PENDEL_MAX = 4;
/**
 * Deckel für eine einzelne Frame-Dauer (ms).
 *
 * Ein Tabwechsel oder ein Nachladeruckler liefert sonst einen Frame von
 * mehreren Sekunden, der das 2-Sekunden-Fenster im Alleingang füllt und
 * die Automatik um mehrere Sprossen nach unten reisst. 200 ms entspricht
 * 5 fps — schlimm genug, um zu zählen, aber ein Ausreisser bleibt ein
 * Ausreisser.
 */
const DT_DECKEL_MS = 200;

/**
 * Rechnet aus Nutzereinstellung und Stufe die wirksamen Regler aus.
 * Reine Funktion — der Kern, den die Tests durchmessen.
 */
export function wirksameRegler(basis: WaechterRegler, stufe: number): WaechterRegler {
  const w: WaechterRegler = { ...basis };
  for (let i = 1; i <= Math.min(stufe, HOECHSTE_STUFE); i++) {
    const s = LEITER[i]!;
    if (s.renderScale !== undefined) w.renderScale = Math.min(w.renderScale, s.renderScale);
    if (s.grassDensity !== undefined) w.grassDensity = Math.min(w.grassDensity, s.grassDensity);
    if (s.shadowQuality !== undefined) w.shadowQuality = Math.min(w.shadowQuality, s.shadowQuality);
    if (s.motionBlur === false) w.motionBlur = false;
  }
  return w;
}

function gleich(a: WaechterRegler, b: WaechterRegler): boolean {
  return (
    a.renderScale === b.renderScale &&
    a.grassDensity === b.grassDensity &&
    a.shadowQuality === b.shadowQuality &&
    a.motionBlur === b.motionBlur
  );
}

export class FpsWaechter {
  private basis: WaechterRegler = {
    renderScale: 3,
    grassDensity: 3,
    shadowQuality: 2,
    motionBlur: true,
  };
  private aktuelleStufe = 0;
  private frostig = false;
  private frostGrund = '';
  /** Frame-Dauern im Fenster (ms) und ihre Summe. */
  private readonly dts: number[] = [];
  private summe = 0;
  /** Eigene Uhr aus den Frame-Dauern — s. Kopfkommentar. */
  private uhr = 0;
  private letzteAenderung = 0;
  private letztesHoch = -Infinity;
  private pendel = 0;

  constructor(private readonly anwenden: (r: WaechterRegler) => void) {}

  /**
   * Die Einstellung, die der Nutzer gewählt hat. Ist die Obergrenze für
   * alles, was der Wächter je einstellt.
   */
  setzeGrundwerte(r: WaechterRegler): void {
    this.basis = { ...r };
  }

  /** Automatik für diese Sitzung abschalten (Nutzer hat selbst gedreht). */
  einfrieren(grund: string): void {
    if (this.frostig) return;
    this.frostig = true;
    this.frostGrund = grund;
  }

  get eingefroren(): boolean {
    return this.frostig;
  }

  get stufe(): number {
    return this.aktuelleStufe;
  }

  /** 0, solange das Fenster noch nicht voll ist. */
  get mittelFps(): number {
    if (this.summe < FENSTER_MS) return 0;
    return this.dts.length / (this.summe / 1000);
  }

  /** Diagnosezeile fürs HUD. */
  get info(): string {
    if (this.frostig) return `aus (${this.frostGrund})`;
    const f = this.mittelFps;
    return `stufe ${this.aktuelleStufe}/${HOECHSTE_STUFE}  mittel ${f > 0 ? f.toFixed(0) : '—'}`;
  }

  /**
   * Ein Frame. `dtMs` ist die Dauer des GERADE vergangenen Frames.
   *
   * Bewusst ohne Zeitstempel-Parameter: Die Regelung soll von genau
   * denselben Zahlen abhängen, die auch der Test liefert. Ein Rückgriff
   * auf `performance.now()` hier drin würde die Tests von der
   * Wanduhr abhängig machen.
   */
  tick(dtMs: number): void {
    if (this.frostig) return;
    const dt = Math.min(Math.max(dtMs, 0.1), DT_DECKEL_MS);
    this.uhr += dt;
    this.dts.push(dt);
    this.summe += dt;
    // Alles herauswerfen, was über die 2 Sekunden hinausragt — aber nur
    // so weit, dass das Fenster die 2 Sekunden noch abdeckt.
    while (this.dts.length > 1 && this.summe - this.dts[0]! >= FENSTER_MS) {
      this.summe -= this.dts.shift()!;
    }
    if (this.summe < FENSTER_MS) return; // noch keine belastbare Aussage

    const fps = this.dts.length / (this.summe / 1000);
    const seit = this.uhr - this.letzteAenderung;

    if (fps < SCHWELLE_RUNTER) {
      if (seit < VERWEIL_RUNTER_MS) return;
      this.wechsle(+1);
      return;
    }
    if (fps > SCHWELLE_HOCH) {
      // Sperre nach oben wächst mit jedem Fehlversuch — s. Pendelschutz.
      if (seit < VERWEIL_HOCH_MS * (1 + this.pendel)) return;
      this.wechsle(-1);
    }
  }

  /**
   * Geht `richtung` Sprossen weiter und überspringt dabei alles, was
   * beim aktuellen Nutzerprofil gar nichts ändern würde.
   */
  private wechsle(richtung: 1 | -1): void {
    const jetzige = wirksameRegler(this.basis, this.aktuelleStufe);
    let ziel = this.aktuelleStufe;
    for (let s = this.aktuelleStufe + richtung; s >= 0 && s <= HOECHSTE_STUFE; s += richtung) {
      if (!gleich(wirksameRegler(this.basis, s), jetzige)) {
        ziel = s;
        break;
      }
      // Beim Hochgehen ist Stufe 0 immer ein gültiges Ziel, auch wenn sie
      // sich nicht von der aktuellen unterscheidet: nur dort ist der
      // Wächter wirklich aus dem Weg.
      if (richtung === -1 && s === 0) {
        ziel = 0;
        break;
      }
    }
    if (ziel === this.aktuelleStufe) return; // Ende der Leiter erreicht

    if (richtung === 1 && this.uhr - this.letztesHoch < PENDEL_FENSTER_MS) {
      // Kurz nach einem Hochschalten wieder runter: Fehlversuch.
      this.pendel = Math.min(this.pendel + 1, PENDEL_MAX);
    }
    if (richtung === -1) this.letztesHoch = this.uhr;

    this.aktuelleStufe = ziel;
    this.letzteAenderung = this.uhr;
    // Frisch messen: Die Wirkung der eben gemachten Änderung steht in den
    // alten Frame-Dauern nicht drin.
    this.dts.length = 0;
    this.summe = 0;
    this.anwenden(wirksameRegler(this.basis, ziel));
  }
}

/**
 * Hängt den Wächter an den Einstellungsspeicher.
 *
 * Die Schreibvorgänge des Wächters laufen FLÜCHTIG (siehe
 * `SettingsStore.set`): Was die Automatik einstellt, darf die Wahl des
 * Nutzers nicht dauerhaft überschreiben — sonst startet die nächste
 * Sitzung mit dem heruntergeregelten Stand als neuer Ausgangslage, und
 * die Automatik hätte sich selbst nach unten festgeschrieben.
 *
 * Und sie laufen mit gesetztem Merker, damit die eigene Änderung nicht
 * als Nutzereingriff missverstanden wird und die Automatik beim ersten
 * eigenen Schritt einfriert.
 */
export function verbindeFpsWaechter(settings: SettingsStore): FpsWaechter {
  let eigen = false;
  let ersterAufruf = true;
  const waechter = new FpsWaechter((r) => {
    eigen = true;
    try {
      settings.set(
        {
          renderScale: r.renderScale,
          grassDensity: r.grassDensity,
          shadowQuality: r.shadowQuality,
          motionBlur: r.motionBlur,
        },
        true
      );
    } finally {
      eigen = false;
    }
  });
  settings.onChange((s: Readonly<GameSettings>) => {
    if (eigen) return;
    if (ersterAufruf) {
      // `onChange` meldet sich sofort mit dem aktuellen Stand — das ist
      // die Ausgangslage des Nutzers, nicht sein Eingriff.
      ersterAufruf = false;
      waechter.setzeGrundwerte({
        renderScale: s.renderScale,
        grassDensity: s.grassDensity,
        shadowQuality: s.shadowQuality,
        motionBlur: s.motionBlur,
      });
      return;
    }
    waechter.einfrieren('Regler von Hand geaendert');
  });
  return waechter;
}
