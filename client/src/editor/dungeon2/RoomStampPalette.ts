/**
 * AP15.5 — die Raum-Stempel-Palette des neuen Dungeon-Editors.
 *
 * Eine Auswahl vordefinierter `RaumStempel` (`STEMPEL_VORLAGEN` aus
 * `cellEdits.ts`, Größe im Namen), vier feste Drehknöpfe (`drehung` 0/1/2/3 —
 * keine freien Winkel, Grundsatz §3.1 des Layouts), Setzen per Klick auf die
 * `CellCanvas` und Entfernen per Klick auf eine gestempelte Zelle. Das Setzen
 * hängt einen Stempel an `layout.stempel` an; das Zellergebnis entsteht danach
 * REIN aus `zellenAufbauen()` — „nach Setzen bleibt reines Zellenergebnis".
 *
 * Wie `CellTools` ist diese Klasse nur Bedienung: Die Mutationen
 * (`stempelSetzen`/`stempelEntfernen`) liegen rein und getestet in `cellEdits.ts`,
 * und beim ersten Handeingriff kippt dort ein 'erzeugt'-Dokument auf 'gebaut'.
 *
 * AP15.5 — the room-stamp palette. Predefined stamps, four fixed rotation
 * buttons, place by clicking the canvas, remove by clicking a stamped cell.
 */

import { dungeon2 } from '@wov/shared';
import { F, M, SCHRIFT, auswahl, el, knopf, stil } from '../design';
import type { CellCanvas, ZellWerkzeug } from './CellCanvas';
import type { ZellPos } from './cellCanvasMath';
import type { WerkzeugHost } from './CellTools';
import {
  STEMPEL_VORLAGEN,
  stempelEntfernen,
  stempelSetzen,
  type EingriffErgebnis,
  type StempelVorlage,
} from './cellEdits';

type DungeonDokument2 = dungeon2.DungeonDokument2;
type RaumStempel = dungeon2.RaumStempel;

type PaletteModus = 'setzen' | 'entfernen';

export class RoomStampPalette {
  private readonly wurzel: HTMLDivElement;
  private modus: PaletteModus | null = null;
  private vorlageIndex = 0;
  private drehung: 0 | 1 | 2 | 3 = 0;

  constructor(
    private readonly canvas: CellCanvas,
    private readonly host: WerkzeugHost
  ) {
    this.wurzel = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '8px' }));
    this.baue();
  }

  element(): HTMLElement {
    return this.wurzel;
  }

  abwaehlen(): void {
    this.modus = null;
    this.canvas.setzeWerkzeug(null);
    this.canvas.setzeVorschau(null);
    this.baue();
  }

  private vorlage(): StempelVorlage & { name: string } {
    return STEMPEL_VORLAGEN[this.vorlageIndex]!;
  }

  // ── Eingriffspfad / edit path ─────────────────────────────────────────────

  private wende(fn: (doc: DungeonDokument2) => EingriffErgebnis): void {
    const doc = this.host.hole();
    if (doc === null) {
      this.host.meldung?.('Kein Dungeon geladen.', true);
      return;
    }
    const ergebnis = fn(doc);
    if (!ergebnis.geaendert) return;
    this.host.setze(ergebnis.dokument);
    this.canvas.aktualisiere(dungeon2.layoutVonDokument2(ergebnis.dokument));
    if (ergebnis.gekippt) {
      this.host.meldung?.('Handarbeit übernommen — Dungeon ist jetzt „gebaut".');
    }
  }

  /**
   * Der (gedrehte) Fußabdruck der aktuellen Vorlage an einer Ankerzelle — für
   * Vorschau UND als Beleg, dass die Vorschau dieselbe Bau-Logik nutzt wie das
   * Setzen: ein Wegwerf-Stempel wird über `zellenAufbauen()` ausgerollt und
   * seine Zellpositionen abgelesen.
   * The (rotated) footprint of the current template at an anchor cell — for the
   * preview, computed through the same build logic as placement.
   */
  private fussabdruck(anker: ZellPos): { x: number; z: number }[] {
    const v = this.vorlage();
    const probe: RaumStempel = {
      id: -1,
      typ: v.typ,
      x: anker.x,
      z: anker.z,
      ebene: anker.ebene,
      breite: v.breite,
      tiefe: v.tiefe,
      hoehe: v.hoehe,
      bodenVersatz: v.bodenVersatz,
      drehung: this.drehung,
      seed: 0,
      variante: 0,
      ordnung: 0,
      tiefeImBaum: 0,
    };
    const gitter = dungeon2.stempelSetzen({ zellen: new Map() }, probe);
    return [...gitter.zellen.values()].map((z) => ({ x: z.x, z: z.z }));
  }

  // ── Werkzeuge / tools ─────────────────────────────────────────────────────

  private readonly setzWerkzeug: ZellWerkzeug = {
    pickModus: 'zelle',
    ziehMalen: false,
    onZelleKlick: (p: ZellPos) => {
      const v = this.vorlage();
      this.wende((doc) => stempelSetzen(doc, v, p.x, p.z, p.ebene, this.drehung).ergebnis);
      this.host.meldung?.(`${v.name} gesetzt.`);
    },
    onHover: (info) => {
      this.canvas.setzeVorschau(info ? this.fussabdruck(info.zelle) : null);
    },
  };

  private readonly entfernWerkzeug: ZellWerkzeug = {
    pickModus: 'zelle',
    ziehMalen: false,
    onZelleKlick: (p: ZellPos) => {
      const doc = this.host.hole();
      if (doc === null) return;
      const layout = dungeon2.layoutVonDokument2(doc);
      if (layout === null) return;
      const gitter = dungeon2.zellenAufbauen(layout);
      const zelle = dungeon2.zelleImGitter(gitter, p.x, p.z, p.ebene);
      if (zelle === undefined || zelle.stempelId < 0) {
        this.host.meldung?.('Hier steht kein Stempel (Handarbeit oder Fels).', true);
        return;
      }
      this.wende((d) => stempelEntfernen(d, zelle.stempelId));
      this.host.meldung?.(`Stempel ${zelle.stempelId} entfernt.`);
    },
  };

  private waehle(modus: PaletteModus): void {
    this.modus = this.modus === modus ? null : modus;
    if (this.modus === 'setzen') this.canvas.setzeWerkzeug(this.setzWerkzeug);
    else if (this.modus === 'entfernen') this.canvas.setzeWerkzeug(this.entfernWerkzeug);
    else this.canvas.setzeWerkzeug(null);
    if (this.modus !== 'setzen') this.canvas.setzeVorschau(null);
    this.baue();
  }

  // ── Bedienfeld / control panel ────────────────────────────────────────────

  private baue(): void {
    this.wurzel.innerHTML = '';
    this.wurzel.appendChild(
      el(
        'div',
        stil({ 'font-family': SCHRIFT.zier, 'font-size': '12px', color: F.textRuhig, 'letter-spacing': '.04em' }),
        'Raum-Stempel'
      )
    );

    // Vorlagenauswahl (Größe steht im Namen). / template picker (size in the name).
    const werte = STEMPEL_VORLAGEN.map((v, i) => ({ id: String(i), name: v.name }));
    this.wurzel.appendChild(
      auswahl(werte, String(this.vorlageIndex), (id) => {
        this.vorlageIndex = Number(id);
      })
    );

    // Vier feste Drehungen. / four fixed rotations.
    const drehReihe = el('div', stil({ display: 'flex', gap: '6px' }));
    ([0, 1, 2, 3] as const).forEach((d) => {
      const b = knopf(`${d * 90}°`, () => this.setzeDrehung(d), {
        art: this.drehung === d ? 'bronze' : 'flaeche',
        hoehe: M.knopfHoeheKlein,
      });
      b.style.flex = '1';
      drehReihe.appendChild(b);
    });
    this.wurzel.appendChild(drehReihe);

    // Setzen / Entfernen. / place / remove.
    const modusReihe = el('div', stil({ display: 'flex', gap: '6px' }));
    const setzen = knopf('Setzen', () => this.waehle('setzen'), {
      art: this.modus === 'setzen' ? 'bronze' : 'flaeche',
      hoehe: M.knopfHoeheKlein,
    });
    const entfernen = knopf('Entfernen', () => this.waehle('entfernen'), {
      art: this.modus === 'entfernen' ? 'bronze' : 'flaeche',
      hoehe: M.knopfHoeheKlein,
    });
    setzen.style.flex = '1';
    entfernen.style.flex = '1';
    modusReihe.append(setzen, entfernen);
    this.wurzel.appendChild(modusReihe);

    const hinweisText =
      this.modus === 'entfernen'
        ? 'Auf eine gestempelte Zelle klicken, um ihren Stempel zu entfernen.'
        : this.modus === 'setzen'
          ? 'Auf die Ankerzelle (kleinste x/z-Ecke) klicken.'
          : 'Vorlage und Drehung wählen, dann „Setzen".';
    this.wurzel.appendChild(
      el('div', stil({ 'font-size': '11px', color: F.gedimmt, 'line-height': '1.5' }), hinweisText)
    );
  }

  private setzeDrehung(d: 0 | 1 | 2 | 3): void {
    this.drehung = d;
    this.baue();
  }
}
