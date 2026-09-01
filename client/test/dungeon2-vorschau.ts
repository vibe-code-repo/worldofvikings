/**
 * AP15.6 — Wächter für die REINE Steuerung der eingebetteten 3D-Live-Vorschau
 * (`vorschauSteuerung.ts`). KEIN WebGL, KEINE Babylon-Engine, KEIN DOM: Diese
 * Datei baut nie eine `Dungeon2Vorschau` — 3D ist in Node nicht render-testbar.
 * Sie prüft die drei Zusicherungen, die als Zustandslogik testbar SIND und es
 * bleiben müssen (dasselbe Prinzip wie `dungeon2-zellwerkzeuge.ts` neben der
 * DOM-Canvas):
 * AP15.6 — guard for the PURE control logic of the embedded 3D live preview
 * (`vorschauSteuerung.ts`). NO WebGL, NO Babylon engine, NO DOM.
 *
 *   1. Entprellung: viele schnelle `setzeLayout` → genau EIN Neubau nach Ruhe.
 *   2. Zustandsmaschine sichtbar/unsichtbar ↔ Render-Schleife an/aus.
 *   3. dispose-Idempotenz: nach dispose keine Schleife, kein Zeitgeber, keine
 *      Wirkung weiterer Aufrufe.
 *
 *   npx tsx test/dungeon2-vorschau.ts
 *
 * Für jede Invariante ein Positiv- UND ein Negativfall.
 * A positive AND a negative case per invariant.
 */

import type { dungeon2 } from '@wov/shared';
import {
  ENTPRELL_MS_VORGABE,
  VorschauSteuerung,
  type VorschauTreiber,
  type Zeitgeber,
} from '../src/editor/dungeon2/vorschauSteuerung';

// ─────────────────────────────────────────────────────────────────────────────
// Prüfgerüst / test harness
// ─────────────────────────────────────────────────────────────────────────────

let gutZahl = 0;
const fehlerListe: string[] = [];

function pruefe(name: string, bedingung: boolean, zusatz = ''): void {
  if (bedingung) {
    gutZahl++;
    return;
  }
  fehlerListe.push(`${name}${zusatz ? ` — ${zusatz}` : ''}`);
}

function pruefeGleich(name: string, ist: unknown, soll: unknown): void {
  pruefe(name, Object.is(ist, soll), `ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Attrappen / fakes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ein Treiber, der nur mitschreibt: WIE oft gebaut wurde, mit welchem Layout,
 * ob die Schleife gerade läuft und ob abgebaut wurde.
 * A driver that only records: how often built, with which layout, whether the
 * loop runs and whether it was torn down.
 */
class TreiberAttrappe implements VorschauTreiber {
  bauten: (dungeon2.DungeonLayout2 | null)[] = [];
  schleifeLaeuft = false;
  starts = 0;
  stopps = 0;
  abgebaut = 0;

  baueNeu(layout: dungeon2.DungeonLayout2 | null): void {
    this.bauten.push(layout);
  }
  starteSchleife(): void {
    this.schleifeLaeuft = true;
    this.starts++;
  }
  stoppeSchleife(): void {
    this.schleifeLaeuft = false;
    this.stopps++;
  }
  abbauen(): void {
    this.abgebaut++;
  }
}

/**
 * Ein Zeitgeber, den der Test von Hand ablaufen lässt — statt echt zu warten.
 * Hält höchstens einen offenen Auftrag (die Steuerung entprellt, löscht also
 * vor jedem neuen Setzen den alten). `laufen()` feuert den offenen Auftrag.
 * A timer the test fires by hand instead of really waiting.
 */
class ZeitgeberAttrappe implements Zeitgeber {
  private naechsteId = 1;
  private offen: { id: number; rueckruf: () => void } | null = null;
  gesetzt = 0;
  geloescht = 0;

  setzen(rueckruf: () => void, _ms: number): number {
    const id = this.naechsteId++;
    this.offen = { id, rueckruf };
    this.gesetzt++;
    return id;
  }
  loeschen(handle: number): void {
    if (this.offen && this.offen.id === handle) {
      this.offen = null;
      this.geloescht++;
    }
  }
  /** Ob ein Auftrag aussteht. / Whether a job is pending. */
  get steht(): boolean {
    return this.offen !== null;
  }
  /** Den offenen Auftrag feuern (wie der Ablauf der Frist). / Fire the pending job. */
  laufen(): void {
    const auftrag = this.offen;
    this.offen = null;
    auftrag?.rueckruf();
  }
}

/** Ein Platzhalter-Layout — die Steuerung reicht es nur durch, liest es nie. */
/** A placeholder layout — control only passes it through, never reads it. */
function layout(id: string): dungeon2.DungeonLayout2 {
  return { id } as unknown as dungeon2.DungeonLayout2;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Entprellung: viele schnelle setzeLayout → genau EIN Bau nach Ruhe
// ─────────────────────────────────────────────────────────────────────────────

{
  const t = new TreiberAttrappe();
  const z = new ZeitgeberAttrappe();
  const s = new VorschauSteuerung(t, z);
  s.zeige(true);

  const a = layout('a');
  const b = layout('b');
  const c = layout('c');
  s.setzeLayout(a);
  s.setzeLayout(b);
  s.setzeLayout(c);

  pruefe('Entprellung: vor Ablauf noch nicht gebaut', t.bauten.length === 0, `gebaut ${t.bauten.length}x`);
  pruefe('Entprellung: ein Auftrag steht', z.steht);
  // Jedes neue setzeLayout löscht den vorigen Auftrag (Entprellung).
  pruefeGleich('Entprellung: zwei Zwischenaufträge gelöscht', z.geloescht, 2);

  z.laufen();
  pruefeGleich('Entprellung: nach Ruhe genau EIN Bau', t.bauten.length, 1);
  pruefeGleich('Entprellung: gebaut wird das ZULETZT gesetzte Layout', t.bauten[0], c);
  pruefe('Entprellung: danach kein Auftrag mehr offen', !z.steht);
  pruefe('Entprellung: kein Bau steht mehr', !s.bauSteht);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Zustandsmaschine sichtbar/unsichtbar ↔ Render-Schleife an/aus
// ─────────────────────────────────────────────────────────────────────────────

{
  const t = new TreiberAttrappe();
  const z = new ZeitgeberAttrappe();
  const s = new VorschauSteuerung(t, z);

  // Unsichtbar gesetztes Layout baut NICHT und startet KEINE Schleife.
  s.setzeLayout(layout('a'));
  pruefe('Sichtbarkeit: unsichtbar keine Schleife', !t.schleifeLaeuft);
  pruefe('Sichtbarkeit: unsichtbar kein Bau geplant', !z.steht);
  pruefe('Sichtbarkeit: unsichtbar nichts gebaut', t.bauten.length === 0);

  // Einblenden startet die Schleife UND holt den ausstehenden Bau nach.
  s.zeige(true);
  pruefe('Sichtbarkeit: zeige(true) startet Schleife', t.schleifeLaeuft);
  pruefe('Sichtbarkeit: zeige(true) holt Bau nach (Auftrag steht)', z.steht);
  z.laufen();
  pruefeGleich('Sichtbarkeit: nachgeholter Bau gelaufen', t.bauten.length, 1);

  // Idempotenz: zweites zeige(true) startet die Schleife nicht erneut.
  s.zeige(true);
  pruefeGleich('Sichtbarkeit: zeige(true) idempotent (kein zweiter Start)', t.starts, 1);

  // Ausblenden hält die Schleife an.
  s.zeige(false);
  pruefe('Sichtbarkeit: zeige(false) stoppt Schleife', !t.schleifeLaeuft);
  pruefeGleich('Sichtbarkeit: genau ein Stopp', t.stopps, 1);
  s.zeige(false);
  pruefeGleich('Sichtbarkeit: zeige(false) idempotent (kein zweiter Stopp)', t.stopps, 1);

  // Ausblenden während ein Bau ansteht: der Auftrag wird gelöscht und feuert
  // nicht ins Leere (kein Bau in eine unsichtbare/abgebaute Szene).
  s.zeige(true);
  s.setzeLayout(layout('b'));
  pruefe('Sichtbarkeit: Bau steht vor dem Ausblenden', z.steht);
  const vorher = t.bauten.length;
  s.zeige(false);
  pruefe('Sichtbarkeit: Ausblenden löscht anstehenden Bau', !z.steht);
  pruefeGleich('Sichtbarkeit: kein Bau nach dem Ausblenden', t.bauten.length, vorher);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. dispose-Idempotenz und Endgültigkeit
// ─────────────────────────────────────────────────────────────────────────────

{
  const t = new TreiberAttrappe();
  const z = new ZeitgeberAttrappe();
  const s = new VorschauSteuerung(t, z);
  s.zeige(true);
  s.setzeLayout(layout('a'));
  pruefe('dispose: vor dispose steht ein Bau', z.steht);

  s.dispose();
  pruefe('dispose: räumt genau einmal ab', t.abgebaut === 1);
  pruefe('dispose: Schleife steht', !t.schleifeLaeuft);
  pruefe('dispose: kein Zeitgeber mehr offen', !z.steht);
  pruefe('dispose: kein Bau mehr geplant', !s.bauSteht);

  // Idempotenz: zweiter dispose tut nichts.
  s.dispose();
  pruefeGleich('dispose: idempotent (kein zweites Abräumen)', t.abgebaut, 1);

  // Endgültigkeit: Aufrufe nach dispose sind wirkungslos.
  const startsVorher = t.starts;
  const bautenVorher = t.bauten.length;
  s.zeige(true);
  s.setzeLayout(layout('b'));
  pruefeGleich('dispose: zeige() nach dispose wirkungslos', t.starts, startsVorher);
  pruefe('dispose: setzeLayout() nach dispose plant nichts', !z.steht);
  pruefe('dispose: istSichtbar bleibt falsch', !s.istSichtbar);

  // Ein etwaig noch „in der Luft" hängender Zeitgeber baut nach dispose NICHT.
  z.laufen(); // feuert nichts, da gelöscht — aber der Aufruf muss sicher sein
  pruefeGleich('dispose: kein nachträglicher Bau', t.bauten.length, bautenVorher);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Ein Auftrag, der zwischen Armierung und Ablauf ausgeblendet wird, baut nicht
// ─────────────────────────────────────────────────────────────────────────────

{
  const t = new TreiberAttrappe();
  const z = new ZeitgeberAttrappe();
  const s = new VorschauSteuerung(t, z);
  s.zeige(true);
  s.setzeLayout(layout('a'));
  // Statt regulär auszublenden: wir prüfen die Wächterbedingung im Rückruf.
  // Wir blenden aus (löscht den Auftrag) — der Rückruf darf nicht mehr feuern.
  s.zeige(false);
  z.laufen();
  pruefe('Wächter: kein Bau, wenn zwischen Armierung und Ablauf ausgeblendet', t.bauten.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Konstante plausibel / constant sane
// ─────────────────────────────────────────────────────────────────────────────

pruefe('Entprellzeit positiv und moderat', ENTPRELL_MS_VORGABE > 0 && ENTPRELL_MS_VORGABE <= 500);

// ─────────────────────────────────────────────────────────────────────────────
// Ergebnis / result
// ─────────────────────────────────────────────────────────────────────────────

console.log(`dungeon2-vorschau: ${gutZahl} Prüfungen grün, ${fehlerListe.length} rot`);
for (const f of fehlerListe) console.log(`  ROT  ${f}`);
process.exit(fehlerListe.length === 0 ? 0 : 1);
