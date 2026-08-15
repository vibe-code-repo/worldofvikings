/**
 * Regelungstests für den FPS-Wächter (client/src/engine/FpsWaechter.ts).
 *
 * Lauf: npx tsx test/fps-waechter.ts   (aus client/)
 *
 * Der Wächter ist absichtlich ohne Uhr und ohne Babylon gebaut — seine
 * ganze Zeitrechnung kommt aus den übergebenen Frame-Dauern. Damit ist
 * genau das prüfbar, was sich am laufenden Spiel NICHT prüfen lässt:
 * dass die Leiter in der richtigen Reihenfolge abgestiegen wird, dass
 * zwischen 45 und 58 fps nichts passiert, dass ein Grenzfall nicht
 * pendelt und dass ein Nutzereingriff die Automatik stilllegt.
 *
 * Geprüft werden EIGENSCHAFTEN, keine Zahlen aus der Implementierung:
 * „nach 10 s bei 30 fps steht mindestens Stufe 3" sagt etwas aus, „nach
 * 10 s steht Stufe 4" wäre nur eine Abschrift des Codes.
 */
import {
  FpsWaechter,
  verbindeFpsWaechter,
  wirksameRegler,
  HOECHSTE_STUFE,
  type WaechterRegler,
} from '../src/engine/FpsWaechter';
import { SettingsStore } from '../src/ui/Settings';

let fehler = 0;
function pruefe(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) fehler++;
}

const VOLL: WaechterRegler = {
  renderScale: 3,
  grassDensity: 3,
  shadowQuality: 2,
  motionBlur: true,
};

/** Baut einen Wächter, der jede Anwendung mitschreibt. */
function baue(basis: WaechterRegler = VOLL) {
  const verlauf: WaechterRegler[] = [];
  const w = new FpsWaechter((r) => verlauf.push({ ...r }));
  w.setzeGrundwerte(basis);
  return { w, verlauf };
}

/** Speist `sekunden` Sekunden mit konstanter Bildrate ein. */
function fahre(w: FpsWaechter, fps: number, sekunden: number): void {
  const dt = 1000 / fps;
  for (let t = 0; t < sekunden * 1000; t += dt) w.tick(dt);
}

// ── Die Leiter selbst ────────────────────────────────────────────────
{
  const s = [...Array(HOECHSTE_STUFE + 1).keys()].map((i) => wirksameRegler(VOLL, i));
  pruefe('Stufe 0 lässt alles wie eingestellt', JSON.stringify(s[0]) === JSON.stringify(VOLL));
  // Reihenfolge: erst Auflösung, dann Gras, dann Schatten, dann Unschärfe.
  const ersteAenderung = (feld: keyof WaechterRegler): number =>
    s.findIndex((r) => r[feld] !== VOLL[feld]);
  const rs = ersteAenderung('renderScale');
  const gd = ersteAenderung('grassDensity');
  const sq = ersteAenderung('shadowQuality');
  const mb = ersteAenderung('motionBlur');
  pruefe(
    'Reihenfolge Auflösung → Gras → Schatten → Unschärfe',
    rs > 0 && rs < gd && gd < sq && sq < mb,
    `${rs} < ${gd} < ${sq} < ${mb}`
  );
  // Monoton: keine Sprosse gibt etwas zurück, was eine tiefere genommen hat.
  let monoton = true;
  for (let i = 1; i <= HOECHSTE_STUFE; i++) {
    const a = s[i - 1]!;
    const b = s[i]!;
    if (
      b.renderScale > a.renderScale ||
      b.grassDensity > a.grassDensity ||
      b.shadowQuality > a.shadowQuality ||
      (b.motionBlur && !a.motionBlur)
    ) {
      monoton = false;
    }
  }
  pruefe('Die Leiter geht nur abwärts', monoton);
  pruefe(
    'Der Wächter geht nicht unter 75 % Renderauflösung',
    s.every((r) => r.renderScale >= 1)
  );
}

// ── Deckelung an der Nutzereinstellung ───────────────────────────────
{
  const sparsam: WaechterRegler = {
    renderScale: 1, // 75 %, schon von Hand gesenkt
    grassDensity: 1,
    shadowQuality: 0,
    motionBlur: false,
  };
  const alle = [...Array(HOECHSTE_STUFE + 1).keys()].map((i) => wirksameRegler(sparsam, i));
  pruefe(
    'Nichts wird über die Nutzereinstellung angehoben',
    alle.every(
      (r) =>
        r.renderScale <= sparsam.renderScale &&
        r.grassDensity <= sparsam.grassDensity &&
        r.shadowQuality <= sparsam.shadowQuality &&
        !r.motionBlur
    )
  );
}

// ── Einbruch: es geht abwärts ────────────────────────────────────────
{
  const { w, verlauf } = baue();
  fahre(w, 30, 30);
  pruefe('30 fps drückt die Stufe nach unten', w.stufe >= 3, `Stufe ${w.stufe}`);
  pruefe('… und dabei wird auch wirklich angewandt', verlauf.length === w.stufe, `${verlauf.length} Anwendungen`);
  const letzte = verlauf[verlauf.length - 1]!;
  pruefe('… zuerst an der Renderauflösung', letzte.renderScale < VOLL.renderScale);
  fahre(w, 30, 120);
  pruefe('Am Ende der Leiter ist Schluss', w.stufe === HOECHSTE_STUFE, `Stufe ${w.stufe}`);
  const ganzUnten = verlauf[verlauf.length - 1]!;
  pruefe(
    'Unterste Sprosse nimmt alle vier Regler zurück',
    ganzUnten.renderScale === 1 &&
      ganzUnten.grassDensity === 0 &&
      ganzUnten.shadowQuality === 0 &&
      !ganzUnten.motionBlur,
    JSON.stringify(ganzUnten)
  );
}

// ── Erholung: es geht wieder hoch ────────────────────────────────────
{
  const { w } = baue();
  fahre(w, 30, 30);
  const tief = w.stufe;
  fahre(w, 75, 200);
  pruefe('Bei 75 fps klettert der Wächter zurück auf 0', w.stufe === 0, `von ${tief} auf ${w.stufe}`);
}

// ── Totband: zwischen den Schwellen passiert nichts ──────────────────
{
  for (const fps of [46, 50, 57]) {
    const { w, verlauf } = baue();
    fahre(w, fps, 60);
    pruefe(`${fps} fps lässt die Automatik in Ruhe`, w.stufe === 0 && verlauf.length === 0);
  }
  // Und auch von unten aus: einmal abgestiegen, bleibt es dort stehen.
  // Die ersten Sekunden nach dem Sprung von 30 auf 52 fps zählen NICHT:
  // Das gleitende Mittel enthält dann noch die schlechten Frames, und
  // dass der Wächter darauf reagiert, ist richtig und nicht Pendeln.
  const { w } = baue();
  fahre(w, 30, 10);
  fahre(w, 52, 20);
  const stand = w.stufe;
  fahre(w, 52, 200);
  pruefe('… auch von einer tieferen Stufe aus', w.stufe === stand, `Stufe ${stand}`);
}

// ── Hysterese: ein Grenzfall darf nicht im Sekundentakt pendeln ──────
{
  // Boshafte Folge: Sobald der Wächter etwas zurücknimmt, läuft es
  // wieder gut (60 fps), und sobald er es zurückgibt, ruckelt es wieder
  // (40 fps). Genau die Situation, in der eine naive Regelung wippt.
  const zeiten: number[] = [];
  let t = 0;
  let dt = 0;
  // `t + dt`, weil `t` erst nach dem tick() weitergezählt wird — der
  // Wechsel gehört zum Ende des gerade gerechneten Frames.
  const w = new FpsWaechter(() => zeiten.push(t + dt));
  w.setzeGrundwerte(VOLL);
  const DAUER_S = 300;
  while (t < DAUER_S * 1000) {
    const fps = w.stufe > 0 ? 60 : 40;
    dt = 1000 / fps;
    w.tick(dt);
    t += dt;
  }
  let engster = Infinity;
  for (let i = 1; i < zeiten.length; i++) engster = Math.min(engster, zeiten[i]! - zeiten[i - 1]!);
  pruefe(
    'Kein Wechsel im Sekundentakt',
    engster >= 2000,
    `engster Abstand ${(engster / 1000).toFixed(1)}s`
  );
  // Der Pendelschutz muss die Sache über die Zeit BERUHIGEN, nicht nur
  // ausbremsen: in der zweiten Hälfte weniger Wechsel als in der ersten.
  const ersteHaelfte = zeiten.filter((z) => z < (DAUER_S / 2) * 1000).length;
  const zweiteHaelfte = zeiten.length - ersteHaelfte;
  pruefe(
    'Der Pendelschutz beruhigt die Regelung',
    zweiteHaelfte < ersteHaelfte,
    `${ersteHaelfte} → ${zweiteHaelfte} Wechsel je 150s`
  );
  pruefe(
    'Und bleibt insgesamt selten',
    zeiten.length <= 30,
    `${zeiten.length} Wechsel in ${DAUER_S}s`
  );
}

// ── Ausreisser: ein einzelner Hänger reisst nicht die Leiter herunter ─
{
  const { w, verlauf } = baue();
  fahre(w, 100, 10);
  w.tick(5000); // Tabwechsel / Nachladeruckler: ein Frame, 5 Sekunden
  fahre(w, 100, 10);
  pruefe('Ein einzelner 5-s-Frame ändert nichts', w.stufe === 0 && verlauf.length === 0);
}

// ── Einfrieren bei Nutzereingriff ────────────────────────────────────
{
  const { w, verlauf } = baue();
  fahre(w, 30, 8);
  const vorher = w.stufe;
  pruefe('Vor dem Eingriff hat der Wächter geregelt', vorher > 0, `Stufe ${vorher}`);
  w.einfrieren('Test');
  fahre(w, 30, 120);
  pruefe('Nach dem Eingriff regelt er nicht mehr', w.stufe === vorher, `Stufe ${w.stufe}`);
  const anzahl = verlauf.length;
  fahre(w, 100, 120);
  pruefe('… und auch nicht wieder hoch', w.stufe === vorher && verlauf.length === anzahl);
  pruefe('Eingefroren wird gemeldet', w.eingefroren && w.info.startsWith('aus'));
}

// ── Das Messfenster braucht seine 2 Sekunden ─────────────────────────
{
  // Bei 20 fps: vor Ablauf der 2 s darf noch nichts passieren.
  {
    const { w, verlauf } = baue();
    fahre(w, 20, 1.5);
    pruefe('Vor 2 s Messung wird nicht entschieden', verlauf.length === 0 && w.mittelFps === 0);
    fahre(w, 20, 1.0);
    pruefe('Danach schon', verlauf.length > 0, `${verlauf.length} Anwendungen`);
  }
  // Und im Totband, wo kein Stufenwechsel das Fenster leert, lässt sich
  // das gleitende Mittel selbst nachmessen.
  {
    const { w, verlauf } = baue();
    fahre(w, 50, 1.5);
    pruefe('Fenster noch nicht voll → kein Mittelwert', w.mittelFps === 0);
    fahre(w, 50, 3);
    pruefe(
      'Das gleitende Mittel trifft die eingespeiste Bildrate',
      verlauf.length === 0 && Math.abs(w.mittelFps - 50) < 1.5,
      `${w.mittelFps.toFixed(2)} statt 50`
    );
  }
}

// ── Anbindung an den Einstellungsspeicher ────────────────────────────
// Der heikle Teil: Der Wächter schreibt in denselben Speicher, den er
// beobachtet. Verwechselt er seine eigene Änderung mit einem
// Nutzereingriff, friert er beim allerersten eigenen Schritt ein.
{
  const speicher = new SettingsStore();
  const waechter = verbindeFpsWaechter(speicher);
  pruefe('Der erste onChange ist die Ausgangslage, kein Eingriff', !waechter.eingefroren);
  fahre(waechter, 30, 10);
  pruefe(
    'Eigene Änderungen frieren die Automatik NICHT ein',
    !waechter.eingefroren && waechter.stufe > 0,
    `Stufe ${waechter.stufe}`
  );
  pruefe(
    'Die Regler im Speicher sind wirklich heruntergedreht',
    speicher.get().renderScale < 3,
    `renderScale ${speicher.get().renderScale}`
  );
  // Jetzt der Mensch — und zwar an einem Regler, den der Wächter gar
  // nicht anfasst. Auch der friert ein: Wer im Menü steht, will nicht,
  // dass ihm nebenbei die Auflösung verstellt wird.
  speicher.set({ bloom: false });
  pruefe('Ein Nutzereingriff friert ein', waechter.eingefroren);
  const stand = waechter.stufe;
  fahre(waechter, 20, 60);
  pruefe('… und danach bleibt alles stehen', waechter.stufe === stand);
}

console.log(`\n${fehler === 0 ? 'alle Prüfungen grün' : `${fehler} Prüfung(en) rot`}`);
process.exit(fehler > 0 ? 1 : 0);
