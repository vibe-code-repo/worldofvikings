/**
 * AP15.4 — die drei Zell-Pinsel des neuen Dungeon-Editors: Boden heben/senken,
 * Wandflag umschalten, Materialtag malen. Diese Klasse ist NUR Bedienung und
 * Andockung an die `CellCanvas` — die eigentliche Mutation liegt rein und
 * getestet in `cellEdits.ts`, die Pick-Mathematik in `cellCanvasMath.ts`.
 *
 * Jeder Pinsel meldet sich beim Klick als aktives `ZellWerkzeug` der Canvas an
 * (genau eines ist aktiv). Ein Eingriff läuft immer über `wende()`: Dokument
 * holen → reine Editierfunktion → bei Änderung zurückschreiben und die Canvas
 * neu ausrollen. Beim ERSTEN Handeingriff kippt `cellEdits` ein
 * 'erzeugt'-Dokument auf 'gebaut' (siehe dortiger Kopfkommentar) — hier wird das
 * nur als Meldung sichtbar gemacht.
 *
 * AP15.4 — the three cell brushes: raise/lower floor, toggle wall flag, paint
 * material tag. This class is ONLY UI and docking to the `CellCanvas`; the
 * mutation itself lives, pure and tested, in `cellEdits.ts`.
 */

import { dungeon2 } from '@wov/shared';
import { F, M, SCHRIFT, auswahl, el, knopf, stil } from '../design';
import type { CellCanvas, ZellWerkzeug } from './CellCanvas';
import type { KantePos, ZellPos } from './cellCanvasMath';
import {
  BODEN_MAX_STUFEN,
  bodenSetzen,
  materialPinsel,
  wandUmschalten,
  type EingriffErgebnis,
} from './cellEdits';

type DungeonDokument2 = dungeon2.DungeonDokument2;

const MAX_MATERIAL_TAG = dungeon2.MAX_MATERIAL_TAG;

/**
 * Zugriff auf den Dokumentstand des Editors. Die Andockung (AP15.7) hält das
 * eine `DungeonDokument2` und reicht es hier herein: `hole()` liest den
 * aktuellen Stand, `setze()` übernimmt den bearbeiteten und setzt die
 * Speichern-Marke (`schmutzig`) — es aktualisiert die Canvas NICHT, das macht
 * `CellTools` selbst, damit ein Eingriff garantiert sichtbar wird.
 * Access to the editor's document state. `hole()` reads, `setze()` stores the
 * edited state and sets the dirty marker; it does NOT refresh the canvas —
 * `CellTools` does that itself.
 */
export interface WerkzeugHost {
  hole(): DungeonDokument2 | null;
  setze(neu: DungeonDokument2): void;
  meldung?(text: string, fehler?: boolean): void;
}

type WerkzeugName = 'boden' | 'wand' | 'material';

export class CellTools {
  private readonly wurzel: HTMLDivElement;
  private aktiv: WerkzeugName | null = null;
  /** Bodenrichtung: +1 hebt, -1 senkt. / floor direction. */
  private bodenRichtung: 1 | -1 = 1;
  private materialTag = 1;
  private radius = 0;

  constructor(
    private readonly canvas: CellCanvas,
    private readonly host: WerkzeugHost
  ) {
    this.wurzel = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '8px' }));
    this.baue();
  }

  /** Das Bedienfeld für die Seitenleiste. / The control panel for the sidebar. */
  element(): HTMLElement {
    return this.wurzel;
  }

  /** Werkzeug abwählen (z. B. beim Ebenenwechsel). / Deselect the tool. */
  abwaehlen(): void {
    this.aktiv = null;
    this.canvas.setzeWerkzeug(null);
    this.baue();
  }

  // ── Der gemeinsame Eingriffspfad / the shared edit path ───────────────────

  private wende(fn: (doc: DungeonDokument2) => EingriffErgebnis): void {
    const doc = this.host.hole();
    if (doc === null) {
      this.host.meldung?.('Kein Dungeon geladen.', true);
      return;
    }
    const ergebnis = fn(doc);
    if (!ergebnis.geaendert) return;
    this.host.setze(ergebnis.dokument);
    // Die Canvas rollt das bearbeitete Layout neu aus (kein Einpassen). / re-roll.
    this.canvas.aktualisiere(dungeon2.layoutVonDokument2(ergebnis.dokument));
    if (ergebnis.gekippt) {
      this.host.meldung?.('Handarbeit übernommen — Dungeon ist jetzt „gebaut".');
    }
  }

  // ── Die drei Werkzeuge als ZellWerkzeug / the three tools ──────────────────

  private readonly bodenWerkzeug: ZellWerkzeug = {
    pickModus: 'zelle',
    ziehMalen: true,
    onZelleKlick: (p: ZellPos) => {
      this.wende((doc) => bodenSetzen(doc, p.x, p.z, p.ebene, this.bodenRichtung));
    },
  };

  private readonly wandWerkzeug: ZellWerkzeug = {
    pickModus: 'kante',
    // Kein Ziehmalen: Beim Ziehen über dieselbe Kante würde die Wand hin- und
    // herspringen. Ein Klick = ein Umschalten. / no drag paint for a toggle.
    ziehMalen: false,
    onKanteKlick: (k: KantePos) => {
      this.wende((doc) => wandUmschalten(doc, k.x, k.z, k.ebene, k.kante));
    },
  };

  private readonly materialWerkzeug: ZellWerkzeug = {
    pickModus: 'zelle',
    ziehMalen: true,
    onZelleKlick: (p: ZellPos) => {
      this.wende((doc) => materialPinsel(doc, p.x, p.z, p.ebene, this.materialTag, this.radius));
    },
  };

  private werkzeugVon(name: WerkzeugName): ZellWerkzeug {
    if (name === 'boden') return this.bodenWerkzeug;
    if (name === 'wand') return this.wandWerkzeug;
    return this.materialWerkzeug;
  }

  private waehle(name: WerkzeugName): void {
    // Erneutes Anklicken schaltet ab. / clicking again deselects.
    this.aktiv = this.aktiv === name ? null : name;
    this.canvas.setzeWerkzeug(this.aktiv ? this.werkzeugVon(this.aktiv) : null);
    this.baue();
  }

  // ── Bedienfeld / control panel ────────────────────────────────────────────

  private ueberschrift(text: string): HTMLElement {
    return el(
      'div',
      stil({ 'font-family': SCHRIFT.zier, 'font-size': '12px', color: F.textRuhig, 'letter-spacing': '.04em' }),
      text
    );
  }

  private werkzeugKnopf(name: WerkzeugName, beschriftung: string): HTMLButtonElement {
    const b = knopf(beschriftung, () => this.waehle(name), {
      art: this.aktiv === name ? 'bronze' : 'flaeche',
      hoehe: M.knopfHoeheKlein,
    });
    b.style.flex = '1';
    return b;
  }

  private baue(): void {
    this.wurzel.innerHTML = '';
    this.wurzel.appendChild(this.ueberschrift('Zell-Pinsel'));

    const reihe = el('div', stil({ display: 'flex', gap: '6px' }));
    reihe.append(
      this.werkzeugKnopf('boden', 'Boden'),
      this.werkzeugKnopf('wand', 'Wand'),
      this.werkzeugKnopf('material', 'Material')
    );
    this.wurzel.appendChild(reihe);

    if (this.aktiv === 'boden') this.wurzel.appendChild(this.bodenFeld());
    if (this.aktiv === 'wand') this.wurzel.appendChild(this.hinweis('Kante anklicken: Wand an/aus.'));
    if (this.aktiv === 'material') this.wurzel.appendChild(this.materialFeld());
  }

  private hinweis(text: string): HTMLElement {
    return el('div', stil({ 'font-size': '11px', color: F.gedimmt, 'line-height': '1.5' }), text);
  }

  private bodenFeld(): HTMLElement {
    const box = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '6px' }));
    const reihe = el('div', stil({ display: 'flex', gap: '6px' }));
    const heben = knopf('Heben +', () => this.setzeRichtung(1), {
      art: this.bodenRichtung === 1 ? 'bronze' : 'flaeche',
      hoehe: M.knopfHoeheKlein,
    });
    const senken = knopf('Senken −', () => this.setzeRichtung(-1), {
      art: this.bodenRichtung === -1 ? 'bronze' : 'flaeche',
      hoehe: M.knopfHoeheKlein,
    });
    heben.style.flex = '1';
    senken.style.flex = '1';
    reihe.append(heben, senken);
    box.append(
      reihe,
      this.hinweis(`Klick/Ziehen ändert die Bodenhöhe um eine Stufe (0,5 m). 0…${BODEN_MAX_STUFEN} Stufen.`)
    );
    return box;
  }

  private setzeRichtung(r: 1 | -1): void {
    this.bodenRichtung = r;
    this.baue();
  }

  private materialFeld(): HTMLElement {
    const box = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '6px' }));

    const tagWerte = Array.from({ length: MAX_MATERIAL_TAG + 1 }, (_, i) => ({
      id: String(i),
      name: `Material-Tag ${i}`,
    }));
    box.appendChild(
      auswahl(tagWerte, String(this.materialTag), (id) => {
        this.materialTag = Number(id);
      })
    );

    const radiusWerte = [0, 1, 2, 3].map((r) => ({ id: String(r), name: `Radius ${r} (${2 * r + 1} Zellen breit)` }));
    box.appendChild(
      auswahl(radiusWerte, String(this.radius), (id) => {
        this.radius = Number(id);
      })
    );
    box.appendChild(this.hinweis('Klick/Ziehen malt den Materialtag im Kreispinsel (nur auf Boden).'));
    return box;
  }
}
